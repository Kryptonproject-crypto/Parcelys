/**
 * Analyse d'un dossier PAC avant import.
 *
 * Rien n'est écrit ici. Cette étape lit, projette, mesure, contrôle et compare
 * aux parcelles déjà présentes, puis rend un aperçu que l'utilisateur valide ou
 * refuse. Un import PAC touche au parcellaire d'une exploitation : il n'a pas à
 * s'appliquer sans que quelqu'un l'ait regardé.
 *
 * Les surfaces annoncées ici sont celles calculées par PostGIS
 * (`ST_Area(geom::geography)`), pas celles lues dans le fichier. Les deux sont
 * affichées côte à côte quand elles diffèrent : l'écart est une information, pas
 * une erreur à masquer.
 */

import { prisma } from '@/lib/prisma';
import type { PacFeatureKind } from '@prisma/client';
import type { DossierLayer } from '@/lib/pac/dossier';
import {
  applyChoice,
  getTelepacAdapter,
  pickAttribute,
  type FieldMapping,
  type MappingChoice,
} from '@/lib/pac/adapter';
import type { Ring } from '@/lib/pac/shapefile';

/** Ce qu'on propose de faire d'une entité importée. */
export type MatchDecision = 'update' | 'create' | 'ignore';

export type AnalyzedFeature = {
  /** Position dans la couche, pour que l'utilisateur retrouve la ligne. */
  index: number;
  layer: string;
  kind: PacFeatureKind;
  externalId: string | null;
  ilot: string | null;
  numero: string | null;
  cropCode: string | null;
  cropLabel: string | null;

  /** Géométrie ramenée au système interne, prête à afficher. */
  geojson: unknown | null;
  /** Surface calculée par PostGIS. Fait foi. */
  areaHa: number | null;
  /** Surface telle qu'annoncée par le fichier, quand elle y figure. */
  declaredAreaHa: number | null;

  /** Géométrie d'origine, conservée sans reprojection. */
  sourceWkt: string | null;
  sourceSrid: number | null;

  attributes: Record<string, string | number | null>;

  /** Anomalie bloquante : cette entité ne peut pas être importée telle quelle. */
  error: string | null;
  /** Anomalie non bloquante. */
  warnings: string[];

  /** Rapprochement proposé avec une parcelle déjà présente. */
  match: {
    parcelId: string;
    parcelName: string;
    parcelAreaHa: number;
    /** Part commune aux deux géométries, de 0 à 1. */
    overlap: number;
    reason: string;
    decision: MatchDecision;
  } | null;
};

export type LayerAnalysis = {
  name: string;
  kind: PacFeatureKind;
  isIlotLayer: boolean;
  srid: number | null;
  sridLabel: string;
  columns: string[];
  mapping: FieldMapping;
  featureCount: number;
  warnings: string[];
};

export type DossierAnalysis = {
  year: number;
  adapterLabel: string;
  /** Ce sur quoi s'appuie la correspondance des colonnes. Affiché tel quel. */
  provenance: string;
  layers: LayerAnalysis[];
  features: AnalyzedFeature[];
  ignoredFiles: string[];
  problems: string[];
  totals: {
    features: number;
    ilots: number;
    valid: number;
    matched: number;
    invalid: number;
    areaHa: number;
  };
};

/** Anneaux → WKT MULTIPOLYGON, sans passer par une bibliothèque. */
function ringsToWkt(rings: Ring[]): string | null {
  const utiles = rings.filter((r) => r.length >= 4);
  if (utiles.length === 0) return null;

  const anneau = (r: Ring) => {
    const points = [...r];
    // Un anneau WKT doit être fermé ; les Shapefile le sont déjà, mais un
    // fichier produit par un autre outil ne l'est pas toujours.
    const premier = points[0];
    const dernier = points[points.length - 1];
    if (premier && dernier && (premier[0] !== dernier[0] || premier[1] !== dernier[1])) {
      points.push(premier);
    }
    return `(${points.map(([x, y]) => `${x} ${y}`).join(', ')})`;
  };

  // Les anneaux d'un même enregistrement Shapefile appartiennent au même
  // polygone : le premier est le contour, les suivants ses trous.
  return `MULTIPOLYGON((${utiles.map(anneau).join(', ')}))`;
}

type Projected = {
  geojson: unknown | null;
  areaHa: number | null;
  error: string | null;
  warning: string | null;
};

/**
 * Projette et mesure un lot de géométries.
 *
 * Tout passe par PostGIS : c'est lui qui porte PROJ, et c'est déjà lui qui fait
 * foi pour les surfaces dans le reste de Parcelys. Ajouter une seconde
 * bibliothèque de projection ferait deux vérités possibles pour une même
 * parcelle.
 */
async function projectAndMeasure(wkts: Array<string | null>, srid: number): Promise<Projected[]> {
  const resultats: Projected[] = [];

  // Par paquets : une requête par géométrie serait lente sur un dossier de
  // plusieurs centaines de parcelles.
  const TAILLE = 100;
  for (let debut = 0; debut < wkts.length; debut += TAILLE) {
    const lot = wkts.slice(debut, debut + TAILLE);
    const indices = lot.map((_, i) => i);
    const valeurs = lot.map((w) => w ?? '');

    const lignes = await prisma.$queryRaw<
      Array<{ i: number; geojson: string | null; area: number | null; reason: string | null }>
    >`
      WITH entrees AS (
        SELECT * FROM unnest(
          ${indices}::int[],
          ${valeurs}::text[]
        ) AS t(i, wkt)
      ),
      lues AS (
        SELECT
          i,
          CASE WHEN wkt = '' THEN NULL
               ELSE ST_Multi(ST_SetSRID(ST_GeomFromText(wkt), ${srid}::int))
          END AS g
        FROM entrees
      ),
      corrigees AS (
        -- ST_MakeValid répare les auto-intersections, très fréquentes dans un
        -- parcellaire numérisé à la main. La raison de l'invalidité d'origine
        -- est conservée pour être signalée à l'utilisateur.
        SELECT
          i,
          g,
          CASE WHEN g IS NULL OR ST_IsValid(g) THEN NULL ELSE ST_IsValidReason(g) END AS reason,
          CASE WHEN g IS NULL THEN NULL
               WHEN ST_IsValid(g) THEN g
               ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(g), 3))
          END AS gv
        FROM lues
      )
      SELECT
        i,
        CASE WHEN gv IS NULL THEN NULL
             ELSE ST_AsGeoJSON(ST_Transform(gv, 4326))
        END AS geojson,
        CASE WHEN gv IS NULL THEN NULL
             ELSE ST_Area(ST_Transform(gv, 4326)::geography) / 10000.0
        END AS area,
        reason
      FROM corrigees
      ORDER BY i
    `;

    const parIndice = new Map(lignes.map((l) => [Number(l.i), l]));
    for (let i = 0; i < lot.length; i += 1) {
      const ligne = parIndice.get(i);
      if (!ligne || ligne.geojson === null) {
        resultats.push({
          geojson: null,
          areaHa: null,
          error:
            wkts[debut + i] === null
              ? "Géométrie vide ou incomplète (moins de quatre points)."
              : "Géométrie irrécupérable : elle ne décrit aucune surface exploitable.",
          warning: null,
        });
        continue;
      }
      resultats.push({
        geojson: JSON.parse(ligne.geojson),
        areaHa: ligne.area === null ? null : Number(ligne.area),
        error: null,
        warning: ligne.reason
          ? `Géométrie invalide à l'origine (${ligne.reason}), réparée automatiquement.`
          : null,
      });
    }
  }

  return resultats;
}

/** Cherche, pour chaque géométrie importée, la parcelle existante qui lui ressemble. */
async function findMatches(
  farmId: string,
  geojsons: Array<unknown | null>,
): Promise<Array<{ parcelId: string; parcelName: string; parcelAreaHa: number; overlap: number } | null>> {
  const resultats: Array<{ parcelId: string; parcelName: string; parcelAreaHa: number; overlap: number } | null> = [];

  for (const geojson of geojsons) {
    if (!geojson) {
      resultats.push(null);
      continue;
    }
    const texte = JSON.stringify(geojson);

    // Indice de Jaccard : la part commune rapportée à l'union. Deux découpages
    // du même champ donnent une valeur proche de 1, deux parcelles voisines une
    // valeur proche de 0. Le seuil est volontairement bas — c'est une
    // proposition soumise à l'utilisateur, pas une décision.
    const lignes = await prisma.$queryRaw<
      Array<{ id: string; name: string; area: number; overlap: number }>
    >`
      WITH candidate AS (
        SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${texte}), 4326)) AS g
      )
      SELECT
        p.id,
        p.name,
        ST_Area(pg.geom::geography) / 10000.0 AS area,
        ST_Area(ST_Intersection(pg.geom, c.g)::geography)
          / NULLIF(ST_Area(ST_Union(pg.geom, c.g)::geography), 0) AS overlap
      FROM parcels p
      JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
      CROSS JOIN candidate c
      WHERE p.farm_id = ${farmId}
        AND p.deleted_at IS NULL
        AND ST_Intersects(pg.geom, c.g)
      ORDER BY overlap DESC NULLS LAST
      LIMIT 1
    `;

    const meilleur = lignes[0];
    if (!meilleur || Number(meilleur.overlap) < 0.3) {
      resultats.push(null);
    } else {
      resultats.push({
        parcelId: meilleur.id,
        parcelName: meilleur.name,
        parcelAreaHa: Number(meilleur.area),
        overlap: Number(meilleur.overlap),
      });
    }
  }

  return resultats;
}

/** Analyse un dossier déjà lu, sans rien écrire. */
export async function analyzeDossier(params: {
  farmId: string;
  year: number;
  layers: DossierLayer[];
  ignoredFiles: string[];
  problems: string[];
  /** Correspondances choisies par l'utilisateur, par nom de couche. */
  choices?: Record<string, MappingChoice>;
  /** SRID imposé par l'utilisateur quand le .prj est absent ou illisible. */
  sridOverride?: Record<string, number>;
}): Promise<DossierAnalysis> {
  const adapter = getTelepacAdapter(params.year);

  const layerAnalyses: LayerAnalysis[] = [];
  const features: AnalyzedFeature[] = [];

  for (const layer of params.layers) {
    const propose = adapter.guessMapping(layer.columns);
    const mapping = applyChoice(propose, params.choices?.[layer.name] ?? {});
    const srid = params.sridOverride?.[layer.name] ?? layer.srid;

    const warnings = [...layer.warnings];
    if (srid === null) {
      warnings.push(
        "Le système de coordonnées n'a pas pu être déterminé. Indiquez-le avant " +
          "d'importer : une conversion au jugé déplacerait le parcellaire.",
      );
    }

    layerAnalyses.push({
      name: layer.name,
      kind: layer.kind,
      isIlotLayer: layer.isIlotLayer,
      srid,
      sridLabel: srid === null ? layer.sridLabel : srid === 2154 ? 'Lambert-93 (EPSG:2154)' : `EPSG:${srid}`,
      columns: layer.columns,
      mapping,
      featureCount: layer.features.length,
      warnings,
    });

    // Sans système de coordonnées connu, on ne projette rien : les entités sont
    // listées avec leurs attributs, mais sans géométrie ni surface.
    if (srid === null) {
      layer.features.forEach((f, index) => {
        features.push({
          index,
          layer: layer.name,
          kind: layer.kind,
          externalId: pickAttribute(f.attributes, mapping.externalId),
          ilot: pickAttribute(f.attributes, mapping.ilot),
          numero: pickAttribute(f.attributes, mapping.numero),
          cropCode: pickAttribute(f.attributes, mapping.cropCode),
          cropLabel: pickAttribute(f.attributes, mapping.cropLabel),
          geojson: null,
          areaHa: null,
          declaredAreaHa: toNumber(pickAttribute(f.attributes, mapping.area)),
          sourceWkt: null,
          sourceSrid: null,
          attributes: f.attributes,
          error: 'Système de coordonnées inconnu : géométrie non exploitable.',
          warnings: [],
          match: null,
        });
      });
      continue;
    }

    const wkts = layer.features.map((f) => ringsToWkt(f.rings));
    const projetees = await projectAndMeasure(wkts, srid);
    const correspondances = layer.isIlotLayer
      ? projetees.map(() => null)
      : await findMatches(params.farmId, projetees.map((p) => p.geojson));

    layer.features.forEach((f, index) => {
      const projete = projetees[index];
      const match = correspondances[index];
      const declared = toNumber(pickAttribute(f.attributes, mapping.area));

      const avertissements: string[] = [];
      if (projete?.warning) avertissements.push(projete.warning);
      if (declared !== null && projete?.areaHa !== null && projete?.areaHa !== undefined) {
        const ecart = Math.abs(declared - projete.areaHa);
        // Un écart de plus de 5 ares entre la surface déclarée et la surface
        // mesurée mérite un regard : c'est l'ordre de grandeur d'une erreur de
        // saisie, pas d'un arrondi.
        if (ecart > 0.05) {
          avertissements.push(
            `Surface annoncée par le fichier : ${declared.toFixed(2)} ha ; ` +
              `mesurée sur la géométrie : ${projete.areaHa.toFixed(2)} ha.`,
          );
        }
      }

      features.push({
        index,
        layer: layer.name,
        kind: layer.kind,
        externalId: pickAttribute(f.attributes, mapping.externalId),
        ilot: pickAttribute(f.attributes, mapping.ilot),
        numero: pickAttribute(f.attributes, mapping.numero),
        cropCode: pickAttribute(f.attributes, mapping.cropCode),
        cropLabel: pickAttribute(f.attributes, mapping.cropLabel),
        geojson: projete?.geojson ?? null,
        areaHa: projete?.areaHa ?? null,
        declaredAreaHa: declared,
        sourceWkt: wkts[index] ?? null,
        sourceSrid: srid,
        attributes: f.attributes,
        error: projete?.error ?? null,
        warnings: avertissements,
        match: match
          ? {
              ...match,
              reason:
                match.overlap > 0.9
                  ? 'Même emprise que cette parcelle.'
                  : `Recouvre ${Math.round(match.overlap * 100)} % de cette parcelle.`,
              decision: 'update',
            }
          : null,
      });
    });
  }

  const parcellaires = features.filter((f) => !layerIsIlot(layerAnalyses, f.layer));
  const totals = {
    features: parcellaires.length,
    ilots: features.length - parcellaires.length,
    valid: parcellaires.filter((f) => !f.error).length,
    matched: parcellaires.filter((f) => f.match).length,
    invalid: parcellaires.filter((f) => f.error).length,
    areaHa: parcellaires.reduce((sum, f) => sum + (f.areaHa ?? 0), 0),
  };

  return {
    year: params.year,
    adapterLabel: adapter.label,
    provenance: adapter.provenance,
    layers: layerAnalyses,
    features,
    ignoredFiles: params.ignoredFiles,
    problems: params.problems,
    totals,
  };
}

function layerIsIlot(layers: LayerAnalysis[], name: string): boolean {
  return layers.find((l) => l.name === name)?.isIlotLayer ?? false;
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
