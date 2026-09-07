import { getEnv } from '@/lib/env';

export type GeocodeResult = {
  label: string;
  city: string | null;
  postcode: string | null;
  context: string | null;
  citycode: string | null;
  latitude: number;
  longitude: number;
  score: number;
};

type BanFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    city?: string;
    postcode?: string;
    context?: string;
    citycode?: string;
    score?: number;
  };
};

/**
 * Recherche d'adresse via la Base Adresse Nationale (api-adresse.data.gouv.fr),
 * service public gratuit et sans clé. L'URL est configurable
 * (`GEOCODER_URL`) pour permettre l'usage d'une instance auto-hébergée.
 */
export async function searchAddress(
  query: string,
  limit = 8,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const url = new URL(getEnv().GEOCODER_URL);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('limit', String(Math.min(limit, 20)));

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Parcelys' },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Service de géocodage indisponible (${response.status})`);
  }

  const payload = (await response.json()) as { features?: BanFeature[] };

  return (payload.features ?? [])
    .map((feature): GeocodeResult | null => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      const [longitude, latitude] = coords;
      return {
        label: feature.properties?.label ?? '',
        city: feature.properties?.city ?? null,
        postcode: feature.properties?.postcode ?? null,
        context: feature.properties?.context ?? null,
        citycode: feature.properties?.citycode ?? null,
        latitude,
        longitude,
        score: feature.properties?.score ?? 0,
      };
    })
    .filter((r): r is GeocodeResult => r !== null && r.label.length > 0);
}

/** Géocodage inverse : retrouve la commune à partir d'un point (centroïde). */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<{ city: string | null; postcode: string | null; citycode: string | null } | null> {
  const base = getEnv().GEOCODER_URL.replace(/\/search\/?$/, '/reverse/');
  const url = new URL(base);
  url.searchParams.set('lat', latitude.toFixed(6));
  url.searchParams.set('lon', longitude.toFixed(6));

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Parcelys' },
      next: { revalidate: 86400 },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { features?: BanFeature[] };
    const props = payload.features?.[0]?.properties;
    if (!props) return null;

    return {
      city: props.city ?? null,
      postcode: props.postcode ?? null,
      citycode: props.citycode ?? null,
    };
  } catch {
    return null;
  }
}
