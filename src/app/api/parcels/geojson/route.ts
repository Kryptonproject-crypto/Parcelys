import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import type { NextRequest } from 'next/server';

/** GET /api/parcels/geojson — parcelles de l'exploitation au format GeoJSON. */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:read');
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : currentCampaignYear();

  const collection = await getFarmParcelsGeoJSON(
    ctx.farmId,
    Number.isFinite(year) ? year : undefined,
  );

  return ok(collection);
});
