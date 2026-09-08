import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import {
  recommendationApplySchema,
  recommendationResponseSchema,
} from '@/lib/validation/advisory';
import {
  assertTransition,
  auditRecommendation,
  loadRecommendation,
  notifyResponded,
  serializeRecommendation,
} from '@/lib/services/advisory';
import { badRequest, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Préconisation introuvable');
  return id;
};

/**
 * POST /api/recommendations/:id/response — décision de l'exploitation.
 *
 * Accepter ou écarter appartient à l'exploitant, et à lui seul : la permission
 * `recommendation:respond` n'est accordée à aucun expert. Le motif d'un refus
 * est conservé — il fait partie du dialogue, et il justifie la décision en cas
 * de contrôle.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const auth = await requireVerifiedAuth();
  const existing = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  );

  const ctx = await requireFarmAccess('recommendation:respond', existing.farmId);
  const input = await parseBody(request, recommendationResponseSchema);

  // Un brouillon n'a jamais été transmis : l'exploitation ne peut pas y répondre.
  if (existing.status === 'DRAFT') throw notFound('Préconisation introuvable');
  assertTransition(existing.status, input.decision);

  await prisma.recommendation.update({
    where: { id },
    data: {
      status: input.decision,
      respondedById: ctx.user.id,
      respondedAt: new Date(),
      responseNote: input.note || null,
    },
  });

  const row = await loadRecommendation(id, [ctx.farmId]);

  await auditRecommendation({
    action: 'recommendation.responded',
    userId: ctx.user.id,
    row,
    ipAddress: clientIp(request),
    metadata: { decision: input.decision },
  });

  await notifyResponded(row, input.decision);

  return ok(serializeRecommendation(row));
});

/**
 * PUT /api/recommendations/:id/response — rattache l'intervention réalisée.
 *
 * C'est ce qui referme la boucle : la préconisation cesse d'être une intention
 * et pointe l'enregistrement qui en découle, consultable depuis les deux côtés.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const auth = await requireVerifiedAuth();
  const existing = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  );

  const ctx = await requireFarmAccess('recommendation:respond', existing.farmId);
  const input = await parseBody(request, recommendationApplySchema);

  assertTransition(existing.status, 'APPLIED');

  // L'intervention citée doit appartenir à l'exploitation : sans ce contrôle,
  // un identifiant étranger relierait deux exploitations entre elles.
  const [phyto, fertilization, operation] = await Promise.all([
    input.phytoId
      ? prisma.phytosanitaryApplication.findFirst({
          where: { id: input.phytoId, parcel: { farmId: ctx.farmId } },
          select: { id: true },
        })
      : null,
    input.fertilizationId
      ? prisma.fertilizerApplication.findFirst({
          where: { id: input.fertilizationId, parcel: { farmId: ctx.farmId } },
          select: { id: true },
        })
      : null,
    input.operationId
      ? prisma.agriculturalOperation.findFirst({
          where: { id: input.operationId, parcel: { farmId: ctx.farmId } },
          select: { id: true },
        })
      : null,
  ]);

  if (input.phytoId && !phyto) throw badRequest('Traitement introuvable.');
  if (input.fertilizationId && !fertilization) throw badRequest('Apport introuvable.');
  if (input.operationId && !operation) throw badRequest('Travail introuvable.');
  if (!phyto && !fertilization && !operation) {
    throw badRequest("Précisez l'intervention qui met en œuvre cette préconisation.");
  }

  await prisma.recommendation.update({
    where: { id },
    data: {
      status: 'APPLIED',
      appliedPhytoId: phyto?.id ?? null,
      appliedFertilizationId: fertilization?.id ?? null,
      appliedOperationId: operation?.id ?? null,
      respondedById: existing.respondedById ?? ctx.user.id,
      respondedAt: existing.respondedAt ?? new Date(),
    },
  });

  const row = await loadRecommendation(id, [ctx.farmId]);

  await auditRecommendation({
    action: 'recommendation.applied',
    userId: ctx.user.id,
    row,
    ipAddress: clientIp(request),
  });

  await notifyResponded(row, 'APPLIED');

  return ok(serializeRecommendation(row));
});
