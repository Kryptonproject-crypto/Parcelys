import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { badRequest } from '@/lib/api/errors';
import { controlDossier } from '@/lib/pac/control';

/**
 * GET /api/pac/control?year=2026 — contrôle du dossier avant export.
 *
 * En lecture : le contrôle ne modifie rien, et doit pouvoir être relancé autant
 * de fois qu'on veut pendant qu'on corrige.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:read');

  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('Campagne invalide.');
  }

  return ok(await controlDossier({ farmId: ctx.farmId, year }));
});
