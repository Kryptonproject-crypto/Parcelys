import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { currentCampaignYear } from '@/lib/constants/agronomy';

/**
 * GET /api/regulatory/compliance?year=
 *
 * Synthèse de conformité d'une campagne. Recalculée à chaque appel : une
 * anomalie corrigée doit disparaître immédiatement, sinon l'agriculteur cesse
 * de faire confiance à toutes les autres.
 *
 * La réponse ne dit jamais « conforme » — voir `buildComplianceReport`.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read');
  const annee = Number(request.nextUrl.searchParams.get('year')) || currentCampaignYear();

  return ok(
    await buildComplianceReport({ farmId: ctx.farmId, campaignYear: annee }),
  );
});
