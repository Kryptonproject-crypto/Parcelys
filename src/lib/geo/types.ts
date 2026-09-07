import { z } from 'zod';

/** [longitude, latitude] — ordre GeoJSON (RFC 7946). */
export const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const linearRingSchema = z
  .array(positionSchema)
  .min(4, 'Un anneau doit contenir au moins 4 points (premier = dernier)');

export const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(linearRingSchema).min(1),
});

export const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(linearRingSchema).min(1)).min(1),
});

export const geometrySchema = z.union([polygonSchema, multiPolygonSchema]);

export type Position = z.infer<typeof positionSchema>;
export type PolygonGeometry = z.infer<typeof polygonSchema>;
export type MultiPolygonGeometry = z.infer<typeof multiPolygonSchema>;
export type ParcelGeometryInput = z.infer<typeof geometrySchema>;

/** Normalise en MultiPolygon : un seul type stocké côté PostGIS. */
export function toMultiPolygon(
  geometry: ParcelGeometryInput,
): MultiPolygonGeometry {
  if (geometry.type === 'MultiPolygon') return geometry;
  return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
}

/** Ferme les anneaux non fermés (le dessin client peut omettre le dernier point). */
export function closeRings(geometry: MultiPolygonGeometry): MultiPolygonGeometry {
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!first || !last) return ring;
        if (first[0] === last[0] && first[1] === last[1]) return ring;
        return [...ring, first];
      }),
    ),
  };
}
