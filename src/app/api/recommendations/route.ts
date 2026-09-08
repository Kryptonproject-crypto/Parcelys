import type { NextRequest } from 'next/server';
import type { RecommendationStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, parseQuery, route } from '@/lib/api/handler';
import {
  recommendationCreateSchema,
  recommendationQuerySchema,
} from '@/lib/validation/advisory';
import {
  assertParcelInFarm,
  assertPhytoComplete,
  auditRecommendation,
  listRecommendations,
  loadRecommendation,
  notifyProposed,
  resolveEphyProduct,
  serializeRecommendation,
} from '@/lib/services/advisory';
import { badRequest } from '@/lib/api/errors';

/** Traduction des filtres d'interface en états. */
const STATUS_FILTERS: Record<string, RecommendationStatus[] | undefined> = {
  tous: undefined,
  attente: ['PROPOSED'],
  acceptees: ['ACCEPTED'],
  ecartees: ['DECLINED', 'WITHDRAWN'],
  realisees: ['APPLIED'],
  brouillons: ['DRAFT'],
};

/**
 * GET /api/recommendations — préconisations visibles par le compte.
 *
 * Un expert voit les siennes, brouillons compris. Une exploitation voit celles
 * qui lui ont été transmises, jamais les brouillons de l'expert : tant qu'une
 * préconisation n'est pas envoyée, elle n'existe pas pour elle.
 */
export const GET = route(async (request: NextRequest) => {
  const auth = await requireVerifiedAuth();
  const query = parseQuery(request, recommendationQuerySchema);
  const isExpert = auth.user.accountType === 'AGRONOMIST';

  // Le filtre par exploitation ne peut viser qu'une exploitation accessible.
  const accessibleFarmIds = auth.memberships.map((m) => m.farmId);
  if (query.farmId && !accessibleFarmIds.includes(query.farmId)) {
    return ok({ recommendations: [], count: 0 });
  }

  const farmIds = query.farmId ? [query.farmId] : accessibleFarmIds;
  if (farmIds.length === 0) return ok({ recommendations: [], count: 0 });

  const recommendations = await listRecommendations({
    ...(query.farmId ? { farmId: query.farmId } : {}),
    ...(query.parcelId ? { parcelId: query.parcelId } : {}),
    ...(isExpert ? { authorId: auth.user.id } : { visibleToFarmOnly: true }),
    ...(STATUS_FILTERS[query.statut] ? { status: STATUS_FILTERS[query.statut] } : {}),
  });

  // Sans filtre d'exploitation, on borne au périmètre accessible.
  const scoped = query.farmId
    ? recommendations
    : recommendations.filter((r) => farmIds.includes(r.farmId));

  return ok({ recommendations: scoped, count: scoped.length });
});

/**
 * POST /api/recommendations — rédige une préconisation.
 *
 * Réservé à l'expert missionné (`recommendation:write` n'est accordée qu'au
 * rôle ADVISOR). Le brouillon reste privé jusqu'à son envoi.
 */
export const POST = route(async (request: NextRequest) => {
  const input = await parseBody(request, recommendationCreateSchema);

  const farmId = request.nextUrl.searchParams.get('farmId');
  if (!farmId) throw badRequest('Exploitation non précisée.');

  const ctx = await requireFarmAccess('recommendation:write', farmId);
  const parcelId = await assertParcelInFarm(input.parcelId || null, ctx.farmId);

  assertPhytoComplete({
    kind: input.kind,
    productName: input.productName,
    dose: input.dose ?? null,
    doseUnit: input.doseUnit ?? null,
  });

  const created = await prisma.recommendation.create({
    data: {
      farmId: ctx.farmId,
      parcelId,
      authorId: ctx.user.id,
      kind: input.kind,
      priority: input.priority,
      status: input.send ? 'PROPOSED' : 'DRAFT',
      title: input.title,
      rationale: input.rationale,
      productName: input.productName || null,
      amm: input.amm || null,
      // Correspondance au catalogue officiel : sert à afficher la provenance,
      // jamais à compléter la saisie de l'expert.
      ephyProductId: await resolveEphyProduct(input.amm),
      dose: input.dose ?? null,
      doseUnit: input.doseUnit ?? null,
      targetLabel: input.targetLabel || null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
    },
  });

  const row = await loadRecommendation(created.id, [ctx.farmId]);

  await auditRecommendation({
    action: input.send ? 'recommendation.proposed' : 'recommendation.created',
    userId: ctx.user.id,
    row,
    ipAddress: clientIp(request),
    metadata: { kind: input.kind, priority: input.priority },
  });

  if (input.send) await notifyProposed(row);

  return ok(serializeRecommendation(row), 201);
});
