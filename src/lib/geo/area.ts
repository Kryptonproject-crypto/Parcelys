import type { MultiPolygonGeometry, Position } from '@/lib/geo/types';

const EARTH_RADIUS_M = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Aire géodésique d'un anneau (formule de l'excès sphérique), en m².
 * Utilisée uniquement pour l'aperçu temps réel pendant le dessin — la valeur
 * enregistrée est toujours celle calculée par PostGIS (`ST_Area(geography)`).
 */
function ringAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    if (!p1 || !p2) continue;
    total +=
      (p2[0] - p1[0]) *
      DEG_TO_RAD *
      (2 + Math.sin(p1[1] * DEG_TO_RAD) + Math.sin(p2[1] * DEG_TO_RAD));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Superficie d'un MultiPolygon en m² (trous soustraits). */
export function geodesicAreaM2(geometry: MultiPolygonGeometry): number {
  return geometry.coordinates.reduce((sum, polygon) => {
    const [outer, ...holes] = polygon;
    if (!outer) return sum;
    const outerArea = ringAreaM2(outer);
    const holesArea = holes.reduce((h, ring) => h + ringAreaM2(ring), 0);
    return sum + Math.max(0, outerArea - holesArea);
  }, 0);
}

export function m2ToHectares(m2: number): number {
  return m2 / 10_000;
}

export function formatHectares(value: number | string, digits = 4): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  return `${num.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ha`;
}

/** Centroïde approximatif (moyenne des sommets de l'anneau extérieur). */
export function approximateCentroid(
  geometry: MultiPolygonGeometry,
): { lat: number; lng: number } | null {
  const points: Position[] = [];
  for (const polygon of geometry.coordinates) {
    const outer = polygon[0];
    if (outer) points.push(...outer);
  }
  if (points.length === 0) return null;

  const sum = points.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 },
  );
  return { lng: sum.lng / points.length, lat: sum.lat / points.length };
}
