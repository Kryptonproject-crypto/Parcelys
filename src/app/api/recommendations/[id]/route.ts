import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { recommendationUpdateSchema } from '@/lib/validation/advisory';
import {
  assertParcelInFarm,
  assertPhytoComplete,
  assertTransition,
  auditRecommendation,
  loadRecommendation,
  notifyProposed,
  resolveEphyProduct,
  serializeRecommendation,
} from '@/lib/services/advisory';
import { conflict, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Préconisation introuvable');
  return id;
};

/** GET /api/recommendations/:id — fiche complète. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const auth = await requireVerifiedAuth();

  const row = await loadRecommendation(id, auth.memberships.map((m) => m.farmId));

  // Un brouillon n'appartient qu'à son auteur : il n'a pas encore été transmis.
  if (row.status === 'DRAFT' && row.authorId !== auth.user.id) {
    throw notFound('Préconisation introuvable');
  }

  await requireFarmAccess('recommendation:read', row.farmId);
  return ok(serializeRecommendation(row));
});

/**
 * PUT /api/recommendations/:id — modifie une préconisation.
 *
 * L'auteur seul peut la modifier, et seulement tant que l'exploitation ne s'est
 * pas prononcée : réécrire un conseil déjà accepté changerait rétroactivement
 * ce sur quoi l'exploitant s'est engagé.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const auth = await requireVerifiedAuth();
  const existing = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  );

  const ctx = await requireFarmAccess('recommendation:write', existing.farmId);
  if (existing.authorId !== ctx.user.id) {
    throw notFound('Préconisation introuvable');
  }
  if (!['DRAFT', 'PROPOSED', 'WITHDRAWN'].includes(existing.status)) {
    throw conflict(
      "L'exploitation s'est déjà prononcée : cette préconisation n'est plus modifiable.",
    );
  }

  const input = await parseBody(request, recommendationUpdateSchema);
  const parcelId = await assertParcelInFarm(input.parcelId || null, ctx.farmId);

  assertPhytoComplete({
    kind: input.kind,
    productName: input.productName,
    dose: input.dose ?? null,
    doseUnit: input.doseUnit ?? null,
  });

  const becomesProposed = input.send && existing.status !== 'PROPOSED';
  if (becomesProposed) assertTransition(existing.status, 'PROPOSED');

  await prisma.recommendation.update({
    where: { id },
    data: {
      parcelId,
      kind: input.kind,
      priority: input.priority,
      ...(becomesProposed ? { status: 'PROPOSED' as const } : {}),
      title: input.title,
      rationale: input.rationale,
      productName: input.productName || null,
      amm: input.amm || null,
      ephyProductId: await resolveEphyProduct(input.amm),
      dose: input.dose ?? null,
      doseUnit: input.doseUnit ?? null,
      targetLabel: input.targetLabel || null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
    },
  });

  const row = await loadRecommendation(id, [ctx.farmId]);

  await auditRecommendation({
    action: becomesProposed ? 'recommendation.proposed' : 'recommendation.updated',
    userId: ctx.user.id,
    row,
    ipAddress: clientIp(request),
  });

  if (becomesProposed) await notifyProposed(row);

  return ok(serializeRecommendation(row));
});

/**
 * DELETE /api/recommendations/:id — retire une préconisation.
 *
 * Un brouillon est effacé ; une préconisation déjà transmise est **retirée**,
 * pas supprimée : l'exploitation l'a vue, la trace doit rester.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const auth = await requireVerifiedAuth();
  const existing = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  );

  const ctx = await requireFarmAccess('recommendation:write', existing.farmId);
  if (existing.authorId !== ctx.user.id) {
    throw notFound('Préconisation introuvable');
  }

  if (existing.status === 'DRAFT') {
    await prisma.recommendation.delete({ where: { id } });
    await auditRecommendation({
      action: 'recommendation.withdrawn',
      userId: ctx.user.id,
      row: existing,
      ipAddress: clientIp(request),
      metadata: { deleted: true },
    });
    return ok({ message: 'Brouillon supprimé.', id });
  }

  assertTransition(existing.status, 'WITHDRAWN');
  await prisma.recommendation.update({
    where: { id },
    data: { status: 'WITHDRAWN' },
  });

  await auditRecommendation({
    action: 'recommendation.withdrawn',
    userId: ctx.user.id,
    row: existing,
    ipAddress: clientIp(request),
  });

  return ok({ message: 'Préconisation retirée.', id });
});
