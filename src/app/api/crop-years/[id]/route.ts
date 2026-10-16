import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { badRequest, conflict, notFound } from '@/lib/api/errors';
import { cropYearSchema } from '@/lib/validation/farming';
import { differences } from '@/lib/services/saisies';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/crop-years/:id — retire une culture de l'assolement. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Culture introuvable');

  const record = await prisma.cropYear.findUnique({
    where: { id },
    select: { id: true, parcelId: true, campaignYear: true },
  });
  if (!record) throw notFound('Culture introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.cropYear.delete({ where: { id } });

  await logAudit({
    action: 'cropyear.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'cropYear',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { campaignYear: record.campaignYear },
  });

  return ok({ message: 'Culture retirée de l’assolement' });
});

/**
 * PUT /api/crop-years/:id — corriger la culture d'une campagne : la culture
 * elle-même, la campagne, la variété, les dates, le rendement.
 *
 * Refusé (409) si la parcelle porte déjà cette culture sur cette campagne :
 * deux lignes identiques dans l'assolement ne voudraient rien dire.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Culture introuvable');

  const existant = await prisma.cropYear.findUnique({ where: { id } });
  if (!existant) throw notFound('Culture introuvable');

  const { ctx } = await requireParcelAccess(existant.parcelId, 'record:write');
  const input = await parseBody(request, cropYearSchema);

  const crop = await prisma.crop.findFirst({
    where: { id: input.cropId, OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    select: { id: true, name: true },
  });
  if (!crop) throw badRequest('Culture inconnue pour cette exploitation.');

  if (input.sowingDate && input.actualHarvestDate && input.actualHarvestDate < input.sowingDate) {
    throw badRequest('La date de récolte ne peut pas précéder la date de semis.');
  }

  const doublon = await prisma.cropYear.findFirst({
    where: {
      parcelId: existant.parcelId,
      campaignYear: input.campaignYear,
      cropId: crop.id,
      id: { not: id },
    },
    select: { id: true },
  });
  if (doublon) {
    throw conflict(`La parcelle porte déjà « ${crop.name} » pour la campagne ${input.campaignYear}.`);
  }

  const data = {
    cropId: crop.id,
    campaignYear: input.campaignYear,
    variety: input.variety ?? null,
    sowingDate: input.sowingDate ?? null,
    expectedHarvestDate: input.expectedHarvestDate ?? null,
    actualHarvestDate: input.actualHarvestDate ?? null,
    yieldValue: input.yieldValue !== undefined ? new Prisma.Decimal(input.yieldValue) : null,
    yieldUnit: input.yieldUnit ?? null,
    notes: input.notes ?? null,
  };
  const item = await prisma.cropYear.update({ where: { id }, data, include: { crop: true } });

  await logAudit({
    action: 'cropyear.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'cropYear',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: {
      crop: crop.name,
      modifications: differences(existant, data, [
        'cropId',
        'campaignYear',
        'variety',
        'sowingDate',
        'expectedHarvestDate',
        'actualHarvestDate',
        'yieldValue',
        'yieldUnit',
        'notes',
      ]),
    },
  });

  return ok({ item, id, message: 'Culture corrigée' });
});
