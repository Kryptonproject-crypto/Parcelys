import type { PolygonGeometry, Position } from './types';

/**
 * Géométrie du contour relevé au GPS.
 *
 * Toutes les valeurs calculées ici sont des **estimations d'affichage**. La
 * superficie qui fait foi est celle que PostGIS calcule à l'enregistrement,
 * sur l'ellipsoïde WGS84 ; l'application le dit explicitement à l'écran plutôt
 * que de laisser croire que le chiffre du téléphone est définitif.
 */

/** Rayon moyen de la Terre (IUGG), en mètres. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Distance orthodromique entre deux points, en mètres (formule de haversine). */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Superficie approchée d'un contour, en hectares.
 *
 * Excès sphérique : exact sur une sphère, à quelques pour mille de l'ellipsoïde
 * aux latitudes françaises. Suffisant pour dire « environ 4,2 ha » pendant le
 * relevé ; c'est le serveur qui tranche ensuite.
 */
export function estimateAreaHa(points: Position[]): number {
  if (points.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;

    total +=
      toRad(next.lng - current.lng) *
      (2 + Math.sin(toRad(current.lat)) + Math.sin(toRad(next.lat)));
  }

  const areaM2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return areaM2 / 10_000;
}

/** Périmètre du contour fermé, en mètres. */
export function perimeterMeters(points: Position[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (current && next) total += distanceMeters(current, next);
  }
  return total;
}

/**
 * Contour en GeoJSON, prêt pour l'API.
 *
 * L'anneau est refermé sur son premier point : PostGIS refuse un polygone
 * ouvert, et c'est le genre d'erreur qu'on ne veut pas découvrir au moment de
 * la synchronisation, une fois rentré du champ.
 */
export function toPolygon(points: Position[]): PolygonGeometry | null {
  if (points.length < 3) return null;

  const ring: Array<[number, number]> = points.map((point) => [point.lng, point.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Faut-il retenir ce point pendant la marche du contour ?
 *
 * Deux filtres : la précision annoncée par le GPS, et la distance parcourue
 * depuis le dernier point retenu. Sans eux, un téléphone immobile accumule des
 * dizaines de points erratiques qui déforment le contour.
 */
export function shouldRecordPoint(
  previous: Position | undefined,
  candidate: Position,
  options: { minDistanceM: number; maxAccuracyM: number },
): boolean {
  if (candidate.accuracy !== undefined && candidate.accuracy > options.maxAccuracyM) {
    return false;
  }
  if (!previous) return true;
  return distanceMeters(previous, candidate) >= options.minDistanceM;
}

/** Centre approximatif d'un ensemble de points, pour cadrer un aperçu. */
export function centroid(points: Position[]): Position | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (accumulator, point) => ({
      lat: accumulator.lat + point.lat,
      lng: accumulator.lng + point.lng,
    }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Formatage court d'une distance, pour l'affichage pendant le relevé. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km`;
}

export function formatAreaHa(hectares: number): string {
  return `${hectares.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ha`;
}

// `dansLaParcelle` vit désormais dans le terrain commun (`@commun/geometrie`) :
// elle doit pouvoir être testée avec le reste, et un module mobile ne peut pas
// l'être sans casser la compilation du serveur.
export { dansLaParcelle } from '@commun/geometrie';
