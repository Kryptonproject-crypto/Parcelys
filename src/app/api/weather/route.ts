import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { assessSprayingWindow, fetchWeather, WeatherUnavailableError } from '@/lib/weather';
import { ApiError, badRequest } from '@/lib/api/errors';

/**
 * GET /api/weather — météo locale de l'exploitation.
 *
 * Coordonnées, par ordre de priorité : paramètres `lat`/`lng`, sinon parcelle
 * demandée, sinon siège de l'exploitation, sinon centroïde d'une parcelle.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('farm:read');
  await enforceRateLimit(`weather:${clientIp(request)}`, RateLimits.externalApi);

  const params = request.nextUrl.searchParams;
  let latitude = Number(params.get('lat'));
  let longitude = Number(params.get('lng'));
  const parcelId = params.get('parcelId');

  if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && parcelId) {
    const parcel = await prisma.parcel.findFirst({
      where: { id: parcelId, farmId: ctx.farmId, deletedAt: null },
      select: { centroidLat: true, centroidLng: true },
    });
    if (parcel?.centroidLat != null && parcel.centroidLng != null) {
      latitude = parcel.centroidLat;
      longitude = parcel.centroidLng;
    }
  }

  const farm = await prisma.farm.findUniqueOrThrow({
    where: { id: ctx.farmId },
    select: { latitude: true, longitude: true, weatherProvider: true, name: true },
  });

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    if (farm.latitude != null && farm.longitude != null) {
      latitude = farm.latitude;
      longitude = farm.longitude;
    } else {
      const fallback = await prisma.parcel.findFirst({
        where: { farmId: ctx.farmId, deletedAt: null, centroidLat: { not: null } },
        select: { centroidLat: true, centroidLng: true },
      });
      if (fallback?.centroidLat != null && fallback.centroidLng != null) {
        latitude = fallback.centroidLat;
        longitude = fallback.centroidLng;
      }
    }
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw badRequest(
      "Aucune localisation connue. Renseignez l'adresse de l'exploitation dans votre profil " +
        'ou créez une première parcelle.',
    );
  }

  try {
    const bundle = await fetchWeather(latitude, longitude, farm.weatherProvider);
    return ok({ ...bundle, spraying: assessSprayingWindow(bundle) });
  } catch (error) {
    if (error instanceof WeatherUnavailableError) {
      throw new ApiError(502, error.message, 'WEATHER_UNAVAILABLE');
    }
    throw error;
  }
});
