/**
 * Préparation de l'export PAC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CET EXPORT EST, ET CE QU'IL N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Parcelys **prépare** des fichiers. Il ne dépose rien, ne signe rien, et ne se
 * connecte pas à TéléPAC : aucune interface publique ne le permet, et prétendre
 * le contraire ferait croire à un agriculteur que sa déclaration est faite alors
 * qu'elle ne le serait pas. Le libellé est donc « Export préparé pour TéléPAC »,
 * jamais « déclaration envoyée ».
 *
 * Le format produit est le **Shapefile en Lambert-93 (EPSG:2154)** : c'est un
 * format public, spécifié par ESRI, et la projection légale de la métropole. Ce
 * que ce module ne peut pas garantir, faute d'avoir pu consulter la notice
 * officielle de la campagne, c'est que la fonction d'import de TéléPAC accepte
 * ce fichier tel quel — noms de colonnes attendus, couches exigées, contraintes
 * propres à l'année. Cette limite est écrite dans docs/telepac.md et rappelée à
 * l'écran, plutôt que passée sous silence.
 *
 * En pratique, le fichier produit est un Shapefile valide, lisible par QGIS et
 * par tout outil SIG, ce qui permet à l'agriculteur de le vérifier avant de s'en
 * servir.
 */

import { prisma } from '@/lib/prisma';
import {
  LAMBERT_93_PRJ,
  writeShapefile,
  type Ring,
  type WriteFeature,
  type WriteField,
} from '@/lib/pac/shapefile';

/** Colonnes de l'export. Volontairement descriptives et courtes (dBASE : 10 caractères). */
const CHAMPS: WriteField[] = [
  { name: 'ID_PARCEL', type: 'C', length: 40 },
  { name: 'NOM', type: 'C', length: 64 },
  { name: 'NUM_ILOT', type: 'C', length: 16 },
  { name: 'NUM_PARCEL', type: 'C', length: 16 },
  { name: 'CODE_CULTU', type: 'C', length: 12 },
  { name: 'LIB_CULTU', type: 'C', length: 64 },
  { name: 'SURF_HA', type: 'N', length: 14, decimals: 4 },
  { name: 'CAMPAGNE', type: 'N', length: 4, decimals: 0 },
];

export type ExportResult = {
  /** Nom de base commun aux quatre fichiers. */
  basename: string;
  files: Array<{ name: string; content: Buffer }>;
  parcelCount: number;
  areaHa: number;
  srid: number;
  /** À afficher tel quel : ce que l'export est, et ce qu'il reste à faire. */
  notice: string;
};

const NOTICE =
  "Export préparé pour TéléPAC — la déclaration n'est pas déposée. " +
  "Ces fichiers sont un Shapefile en Lambert-93 (EPSG:2154), à importer " +
  "vous-même dans TéléPAC, puis à vérifier et à signer sur le portail. " +
  "Parcelys ne se connecte jamais à TéléPAC.";

/** GeoJSON → anneaux, en aplatissant les multipolygones. */
function geojsonToRings(geojson: {
  type: string;
  coordinates: unknown;
}): Ring[] {
  if (geojson.type === 'Polygon') {
    return (geojson.coordinates as number[][][]).map(
      (ring) => ring.map(([x, y]) => [x, y]) as Ring,
    );
  }
  if (geojson.type === 'MultiPolygon') {
    // Un Shapefile accepte plusieurs anneaux dans un même enregistrement :
    // les polygones d'un multipolygone y tiennent tous.
    return (geojson.coordinates as number[][][][]).flatMap((polygon) =>
      polygon.map((ring) => ring.map(([x, y]) => [x, y]) as Ring),
    );
  }
  return [];
}

/**
 * Prépare l'export d'une campagne.
 *
 * Les géométries sont reprojetées en Lambert-93 par PostGIS, qui porte PROJ et
 * qui fait déjà foi pour les surfaces : une seconde bibliothèque de projection
 * donnerait une seconde vérité.
 */
export async function prepareExport(params: {
  farmId: string;
  farmName: string;
  year: number;
}): Promise<ExportResult> {
  const { farmId, year } = params;

  const lignes = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      pac_id: string | null;
      geojson: string | null;
      area: number | null;
      numero: string | null;
      ilot: string | null;
      crop_code: string | null;
      crop_label: string | null;
    }>
  >`
    SELECT
      p.id,
      p.name,
      p.pac_id,
      -- Reprojection vers le Lambert-93 : c'est le système attendu en métropole.
      ST_AsGeoJSON(ST_Transform(pg.geom, 2154)) AS geojson,
      -- La surface, elle, reste mesurée sur l'ellipsoïde : c'est la mesure
      -- qui fait foi partout ailleurs dans Parcelys.
      ST_Area(pg.geom::geography) / 10000.0 AS area,
      f.numero,
      i.numero AS ilot,
      COALESCE(f.crop_code, c.code)  AS crop_code,
      COALESCE(f.crop_label, c.name) AS crop_label
    FROM parcels p
    JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
    LEFT JOIN pac_campaigns pc ON pc.farm_id = p.farm_id AND pc.year = ${year}
    LEFT JOIN pac_features f ON f.parcel_id = p.id AND f.campaign_id = pc.id AND f.kind = 'PARCELLE'
    LEFT JOIN pac_ilots i ON i.id = f.ilot_id
    LEFT JOIN crop_years cy ON cy.parcel_id = p.id AND cy.campaign_year = ${year}
    LEFT JOIN crops c ON c.id = cy.crop_id
    WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL
    ORDER BY i.numero NULLS LAST, f.numero NULLS LAST, p.name
  `;

  const features: WriteFeature[] = [];
  let areaHa = 0;

  for (const ligne of lignes) {
    if (!ligne.geojson) continue;
    const geojson = JSON.parse(ligne.geojson) as { type: string; coordinates: unknown };
    const rings = geojsonToRings(geojson);
    if (rings.length === 0) continue;

    const surface = Number(ligne.area ?? 0);
    areaHa += surface;

    features.push({
      rings,
      attributes: {
        ID_PARCEL: ligne.pac_id ?? ligne.id,
        NOM: ligne.name,
        NUM_ILOT: ligne.ilot,
        NUM_PARCEL: ligne.numero,
        CODE_CULTU: ligne.crop_code,
        LIB_CULTU: ligne.crop_label,
        SURF_HA: surface,
        CAMPAGNE: year,
      },
    });
  }

  const basename = `parcelys-pac-${year}`;
  const ecrit = writeShapefile(features, CHAMPS, LAMBERT_93_PRJ);

  return {
    basename,
    files: [
      { name: `${basename}.shp`, content: ecrit.shp },
      { name: `${basename}.shx`, content: ecrit.shx },
      { name: `${basename}.dbf`, content: ecrit.dbf },
      { name: `${basename}.prj`, content: Buffer.from(ecrit.prj, 'utf8') },
      // Le .cpg déclare l'encodage du .dbf. Sans lui, un lecteur suppose, et
      // les accents des noms de parcelles arrivent abîmés.
      { name: `${basename}.cpg`, content: Buffer.from('ISO-8859-1', 'utf8') },
    ],
    parcelCount: features.length,
    areaHa,
    srid: 2154,
    notice: NOTICE,
  };
}
