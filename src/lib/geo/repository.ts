import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { badRequest } from '@/lib/api/errors';
import { campagneCourante } from '@/lib/shared/campagne';
import {
  closeRings,
  toMultiPolygon,
  type MultiPolygonGeometry,
  type ParcelGeometryInput,
} from '@/lib/geo/types';

/**
 * Accès aux géométries PostGIS.
 *
 * Prisma ne modélise pas le type `geometry`, ces opérations passent donc par du
 * SQL — toujours en requêtes paramétrées (`$queryRaw` en template balisé), donc
 * insensibles à l'injection.
 */

/**
 * Décimales à conserver quand une géométrie transite en GeoJSON.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE NOMBRE N'EST PAS LAISSÉ AU HASARD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `ST_AsGeoJSON` arrondit à neuf décimales par défaut. En degrés, la neuvième
 * décimale vaut environ 0,1 mm : largement assez pour afficher une carte, et
 * pas assez pour faire l'aller-retour.
 *
 * Constaté sur le dossier TéléPAC 2022 réel, îlot 28 parcelle 40 : 55 sommets,
 * géométrie **valide** dans le fichier, valide après `ST_MakeValid`, valide
 * après projection en 4326 — et invalide dès qu'elle passait par le GeoJSON à
 * neuf décimales, l'arrondi ramenant deux sommets voisins au même point.
 * PostGIS renvoyait alors `Self-intersection`, et l'import de toute la campagne
 * s'arrêtait là. La donnée n'avait rien : c'est le format de transport qui la
 * cassait.
 *
 * Quinze décimales suffisent à retrouver un `double` sans perte (un flottant
 * IEEE 754 porte quinze à dix-sept chiffres significatifs). Vérifié sur cette
 * parcelle-là : invalide à 9, valide à 12, valide à 15, pour 2 140 octets au
 * lieu de 1 516 — le prix d'une géométrie qui survit à son propre transport.
 *
 * À employer partout où une géométrie **revient en base** : analyse d'import,
 * sauvegarde avant import, lecture pour modification. Pas pour l'affichage,
 * où la charge utile compte davantage que le dixième de millimètre.
 */
export const GEOJSON_DECIMALES = 15;

export type GeometryMetrics = {
  areaHa: number;
  perimeterM: number;
  centroidLat: number;
  centroidLng: number;
};

type MetricsRow = {
  area_m2: number;
  perimeter_m: number;
  lat: number;
  lng: number;
  is_valid: boolean;
  invalid_reason: string | null;
};

/**
 * Mesure une géométrie via PostGIS. La superficie est calculée sur le type
 * `geography` (ellipsoïde WGS84) : c'est la valeur qui fait foi dans Parcelys.
 */
export async function measureGeometry(
  input: ParcelGeometryInput,
): Promise<GeometryMetrics> {
  const geometry = closeRings(toMultiPolygon(input));
  const geojson = JSON.stringify(geometry);

  const rows = await prisma.$queryRaw<MetricsRow[]>`
    WITH g AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom
    )
    SELECT
      ST_Area(geom::geography)      AS area_m2,
      ST_Perimeter(geom::geography) AS perimeter_m,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      ST_IsValid(geom)              AS is_valid,
      ST_IsValidReason(geom)        AS invalid_reason
    FROM g
  `;

  const row = rows[0];
  if (!row) throw badRequest('Géométrie illisible');
  if (!row.is_valid) {
    throw badRequest(
      `Géométrie invalide : ${row.invalid_reason ?? 'contour auto-sécant'}. ` +
        'Vérifiez que le polygone ne se croise pas.',
    );
  }

  const areaM2 = Number(row.area_m2);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) {
    throw badRequest('La superficie calculée est nulle : polygone trop petit.');
  }

  return {
    areaHa: areaM2 / 10_000,
    perimeterM: Number(row.perimeter_m),
    centroidLat: Number(row.lat),
    centroidLng: Number(row.lng),
  };
}

/**
 * Enregistre une nouvelle version de géométrie et met à jour les métriques
 * dénormalisées de la parcelle. Les versions précédentes sont conservées
 * (historisation) mais marquées `is_current = false`.
 */
export async function saveParcelGeometry(
  tx: Prisma.TransactionClient,
  parcelId: string,
  input: ParcelGeometryInput,
  source = 'manual',
): Promise<GeometryMetrics> {
  const metrics = await measureGeometry(input);
  const geojson = JSON.stringify(closeRings(toMultiPolygon(input)));

  await tx.$executeRaw`
    UPDATE parcel_geometries SET is_current = false
    WHERE parcel_id = ${parcelId} AND is_current = true
  `;

  await tx.$executeRaw`
    INSERT INTO parcel_geometries
      (id, parcel_id, geom, area_ha, perimeter_m, source, is_current, created_at)
    VALUES (
      gen_random_uuid()::text,
      ${parcelId},
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
      ${metrics.areaHa}::numeric,
      ${metrics.perimeterM}::numeric,
      ${source},
      true,
      now()
    )
  `;

  await tx.parcel.update({
    where: { id: parcelId },
    data: {
      areaHa: new Prisma.Decimal(metrics.areaHa.toFixed(4)),
      centroidLat: metrics.centroidLat,
      centroidLng: metrics.centroidLng,
    },
  });

  return metrics;
}

export async function getParcelGeometry(
  parcelId: string,
): Promise<MultiPolygonGeometry | null> {
  const rows = await prisma.$queryRaw<Array<{ geojson: string }>>`
    -- Pleine précision : cette géométrie est relue par l'assistant de
    -- modification, puis réenregistrée telle quelle. Un arrondi au passage
    -- ferait dériver le contour à chaque ouverture de la fiche.
    SELECT ST_AsGeoJSON(geom, ${GEOJSON_DECIMALES}::int) AS geojson
    FROM parcel_geometries
    WHERE parcel_id = ${parcelId} AND is_current = true
    LIMIT 1
  `;
  const raw = rows[0]?.geojson;
  if (!raw) return null;
  return JSON.parse(raw) as MultiPolygonGeometry;
}

export type ParcelFeature = {
  type: 'Feature';
  id: string;
  geometry: MultiPolygonGeometry;
  properties: {
    id: string;
    name: string;
    internalNumber: string | null;
    commune: string | null;
    /** Lieu-dit : l'une des façons dont on désigne une parcelle, donc cherchable. */
    lieuDit: string | null;
    areaHa: number;
    status: string;
    crop: string | null;
    /** Sol drainé. `null` = non renseigné, pas « non drainé ». */
    drainedSoil: boolean | null;
  };
};

/**
 * Toutes les parcelles d'une exploitation au format GeoJSON, avec la culture de
 * la campagne demandée. Le filtre `farm_id` est appliqué en base : impossible de
 * récupérer les parcelles d'une autre exploitation.
 */
export async function getFarmParcelsGeoJSON(
  farmId: string,
  campaignYear?: number,
): Promise<{ type: 'FeatureCollection'; features: ParcelFeature[] }> {
  /*
   * La campagne, pas l'année civile.
   *
   * Ce défaut prenait `getFullYear()` alors que tout le reste du site emploie
   * la campagne culturale : le 11 septembre 2026, cette fonction cherchait la
   * culture de 2026 quand la page affichait 2027. Une seule définition
   * désormais, celle de `@/lib/shared/campagne`.
   */
  const year = campaignYear ?? campagneCourante();

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      internal_number: string | null;
      commune: string | null;
      lieu_dit: string | null;
      area_ha: string;
      status: string;
      crop_name: string | null;
      drained_soil: boolean | null;
      geojson: string | null;
    }>
  >`
    SELECT
      p.id,
      p.name,
      p.internal_number,
      p.commune,
      p.lieu_dit,
      p.area_ha::text AS area_ha,
      p.status::text  AS status,
      p.drained_soil,
      c.name          AS crop_name,
      ST_AsGeoJSON(pg.geom) AS geojson
    FROM parcels p
    LEFT JOIN parcel_geometries pg
      ON pg.parcel_id = p.id AND pg.is_current = true
    LEFT JOIN LATERAL (
      SELECT cy.crop_id
      FROM crop_years cy
      WHERE cy.parcel_id = p.id AND cy.campaign_year = ${year}
      ORDER BY cy.created_at DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN crops c ON c.id = latest.crop_id
    WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL
    ORDER BY p.name ASC
  `;

  const features: ParcelFeature[] = [];
  for (const row of rows) {
    if (!row.geojson) continue;
    features.push({
      type: 'Feature',
      id: row.id,
      geometry: JSON.parse(row.geojson) as MultiPolygonGeometry,
      properties: {
        id: row.id,
        name: row.name,
        internalNumber: row.internal_number,
        commune: row.commune,
        lieuDit: row.lieu_dit,
        areaHa: Number(row.area_ha),
        status: row.status,
        crop: row.crop_name,
        drainedSoil: row.drained_soil,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** Emprise (bbox) des parcelles d'une exploitation, pour centrer la carte. */
export async function getFarmBounds(
  farmId: string,
): Promise<[[number, number], [number, number]] | null> {
  const rows = await prisma.$queryRaw<
    Array<{ minx: number | null; miny: number | null; maxx: number | null; maxy: number | null }>
  >`
    SELECT
      ST_XMin(ext) AS minx, ST_YMin(ext) AS miny,
      ST_XMax(ext) AS maxx, ST_YMax(ext) AS maxy
    FROM (
      SELECT ST_Extent(pg.geom) AS ext
      FROM parcel_geometries pg
      JOIN parcels p ON p.id = pg.parcel_id
      WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL AND pg.is_current = true
    ) s
  `;

  const row = rows[0];
  if (!row || row.minx === null || row.miny === null || row.maxx === null || row.maxy === null) {
    return null;
  }
  return [
    [Number(row.miny), Number(row.minx)],
    [Number(row.maxy), Number(row.maxx)],
  ];
}

/** Détecte les recouvrements avec les autres parcelles de l'exploitation. */
export async function findOverlappingParcels(
  farmId: string,
  input: ParcelGeometryInput,
  excludeParcelId?: string,
): Promise<Array<{ id: string; name: string; overlapHa: number }>> {
  const geojson = JSON.stringify(closeRings(toMultiPolygon(input)));

  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; overlap_m2: number }>
  >`
    WITH candidate AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom
    )
    SELECT p.id, p.name,
           ST_Area(ST_Intersection(pg.geom, candidate.geom)::geography) AS overlap_m2
    FROM parcel_geometries pg
    JOIN parcels p ON p.id = pg.parcel_id
    CROSS JOIN candidate
    WHERE p.farm_id = ${farmId}
      AND p.deleted_at IS NULL
      AND pg.is_current = true
      AND (${excludeParcelId ?? null}::text IS NULL OR p.id <> ${excludeParcelId ?? null}::text)
      AND ST_Intersects(pg.geom, candidate.geom)
    ORDER BY overlap_m2 DESC
    LIMIT 10
  `;

  return rows
    .map((r) => ({ id: r.id, name: r.name, overlapHa: Number(r.overlap_m2) / 10_000 }))
    .filter((r) => r.overlapHa > 0.0001);
}
