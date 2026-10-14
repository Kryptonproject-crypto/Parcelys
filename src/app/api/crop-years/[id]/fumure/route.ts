import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/api/errors';
import { comparePlanToActual } from '@/lib/regulatory/nitrogen';
import { saisieGrenSchema } from '@/lib/regulatory/gren-calcul';
import {
  calculEnregistre,
  calculerPlan,
  descriptionDuPlan,
  enregistrerPlanGren,
} from '@/lib/regulatory/gren';

type Ctx = { params: Promise<Record<string, string>> };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

const corps = z.discriminatedUnion('action', [
  // Ce que la fiche demande pour cette culture : se recalcule à chaque choix.
  z.object({ action: z.literal('decrire'), saisie: saisieGrenSchema.partial().default({}) }),
  // Le calcul, sans rien enregistrer.
  z.object({ action: z.literal('calculer'), saisie: saisieGrenSchema, ouverture: date.nullable().optional() }),
  // Le calcul, enregistré dans le plan prévisionnel de fumure.
  z.object({ action: z.literal('enregistrer'), saisie: saisieGrenSchema, ouverture: date.nullable().optional() }),
  // La justification d'un dépassement de la dose prévisionnelle (GREN, art. 8).
  z.object({
    action: z.literal('justifier'),
    cause: z.string().trim().min(3).max(300),
    survenuLe: date.nullable().optional(),
    outil: z.string().trim().max(160).optional(),
    commentaire: z.string().trim().max(2000).optional(),
  }),
]);

async function cultureDe(id: string | undefined) {
  if (!id) throw notFound('Culture introuvable');
  const cropYear = await prisma.cropYear.findUnique({
    where: { id },
    select: { id: true, parcelId: true, campaignYear: true },
  });
  if (!cropYear) throw notFound('Culture introuvable');
  return cropYear;
}

/** GET /api/crop-years/:id/fumure — le plan enregistré, avec son calcul. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const cropYear = await cultureDe((await context.params).id);
  await requireParcelAccess(cropYear.parcelId, 'record:read');
  const plan = await prisma.nitrogenPlan.findUnique({
    where: { cropYearId: cropYear.id },
    select: { id: true, grenInputs: true, computation: true, openedOn: true, lockedAt: true, updatedAt: true },
  });
  return ok({
    plan: plan
      ? {
          id: plan.id,
          saisie: plan.grenInputs,
          calcul: calculEnregistre(plan.computation),
          ouverture: plan.openedOn?.toISOString().slice(0, 10) ?? null,
          verrouille: plan.lockedAt !== null,
          modifieLe: plan.updatedAt.toISOString(),
        }
      : null,
  });
});

/** POST /api/crop-years/:id/fumure — décrire, calculer ou enregistrer. */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const cropYear = await cultureDe((await context.params).id);
  const input = await parseBody(request, corps);

  if (input.action === 'decrire') {
    const { ctx } = await requireParcelAccess(cropYear.parcelId, 'record:read');
    return ok(await descriptionDuPlan({ cropYearId: cropYear.id, farmId: ctx.farmId, saisie: input.saisie }));
  }

  if (input.action === 'calculer') {
    const { ctx } = await requireParcelAccess(cropYear.parcelId, 'record:read');
    return ok(
      await calculerPlan({
        cropYearId: cropYear.id,
        farmId: ctx.farmId,
        saisie: input.saisie,
        ...(input.ouverture !== undefined
          ? { ouverture: input.ouverture ? new Date(`${input.ouverture}T00:00:00Z`) : null }
          : {}),
      }),
    );
  }

  if (input.action === 'justifier') {
    const { ctx } = await requireParcelAccess(cropYear.parcelId, 'record:write');
    const plan = await prisma.nitrogenPlan.findUnique({ where: { cropYearId: cropYear.id }, select: { id: true } });
    if (!plan) throw notFound('Aucun plan prévisionnel pour cette culture');
    const comparaison = await comparePlanToActual(plan.id);
    if (!comparaison || !comparaison.exceeds) {
      throw badRequest('Le réalisé ne dépasse pas la dose prévisionnelle : rien à justifier.');
    }
    const ecart = await prisma.nitrogenPlanDeviation.create({
      data: {
        planId: plan.id,
        deviationKgHa: comparaison.deviationKgHa,
        cause: input.cause,
        occurredOn: input.survenuLe ? new Date(`${input.survenuLe}T00:00:00Z`) : null,
        tool: input.outil || null,
        comment: input.commentaire || null,
        createdById: ctx.user.id,
      },
    });
    await logAudit({
      action: 'nitrogenplan.deviation_justified',
      userId: ctx.user.id,
      farmId: ctx.farmId,
      entity: 'nitrogenPlan',
      entityId: plan.id,
      ipAddress: clientIp(request),
      metadata: { deviationId: ecart.id, deviationKgHa: comparaison.deviationKgHa },
    });
    return ok({ message: 'Justification enregistrée' }, 201);
  }

  const { ctx } = await requireParcelAccess(cropYear.parcelId, 'record:write');
  const { planId, resultat } = await enregistrerPlanGren({
    cropYearId: cropYear.id,
    farmId: ctx.farmId,
    saisie: input.saisie,
    ...(input.ouverture !== undefined ? { ouverture: input.ouverture } : {}),
  });
  await logAudit({
    action: 'nitrogenplan.saved',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'nitrogenPlan',
    entityId: planId,
    ipAddress: clientIp(request),
    metadata: {
      campaignYear: cropYear.campaignYear,
      doseKgHa: resultat.calcul.doseKgHa,
      referentiel: resultat.referentiel?.version ?? null,
    },
  });
  return ok({
    planId,
    ...resultat,
    message:
      resultat.calcul.doseKgHa === null
        ? 'Plan enregistré — dose non calculable en l’état'
        : 'Plan enregistré',
  });
});
