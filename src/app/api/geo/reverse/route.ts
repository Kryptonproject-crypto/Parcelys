import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { reverseGeocode } from '@/lib/geo/geocode';
import { badRequest } from '@/lib/api/errors';

/** GET /api/geo/reverse?lat=&lng= — commune correspondant à un point. */
export const GET = route(async (request: NextRequest) => {
  await requireVerifiedAuth();
  await enforceRateLimit(`reverse:${clientIp(request)}`, RateLimits.externalApi);

  const lat = Number(request.nextUrl.searchParams.get('lat'));
  const lng = Number(request.nextUrl.searchParams.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw badRequest('Coordonnées invalides');
  }

  const result = await reverseGeocode(lat, lng);
  return ok(result ?? { city: null, postcode: null, citycode: null });
});
