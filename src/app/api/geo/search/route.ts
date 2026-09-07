import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { searchAddress } from '@/lib/geo/geocode';
import { ApiError } from '@/lib/api/errors';

/** GET /api/geo/search?q= — recherche d'adresse (Base Adresse Nationale). */
export const GET = route(async (request: NextRequest) => {
  await requireVerifiedAuth();
  await enforceRateLimit(`geocode:${clientIp(request)}`, RateLimits.externalApi);

  const query = request.nextUrl.searchParams.get('q') ?? '';

  try {
    const results = await searchAddress(query);
    return ok({ results });
  } catch (error) {
    throw new ApiError(
      502,
      error instanceof Error ? error.message : 'Service de géocodage indisponible',
      'GEOCODER_UNAVAILABLE',
    );
  }
});
