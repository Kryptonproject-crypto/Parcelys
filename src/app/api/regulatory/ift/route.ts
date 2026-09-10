import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { computeFarmIft } from '@/lib/regulatory/ift';
import { currentCampaignYear } from '@/lib/constants/agronomy';

/**
 * GET /api/regulatory/ift?year=&parcelId=
 *
 * IFT de l'exploitation, calculé depuis le registre existant : aucune
 * ressaisie, et toute correction d'un traitement se répercute aussitôt.
 *
 * Sans référentiel de doses de référence importé, `configured` vaut false et
 * `total` est nul — jamais zéro, qui se lirait comme « aucun impact ».
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read');
  const params = request.nextUrl.searchParams;
  const annee = Number(params.get('year')) || currentCampaignYear();
  const parcelId = params.get('parcelId') ?? undefined;

  return ok(await computeFarmIft({ farmId: ctx.farmId, campaignYear: annee, parcelId }));
});
