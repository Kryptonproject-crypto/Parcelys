import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { cropYearSchema } from '@/lib/validation/farming';
import { logAudit } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/crops — assolement de la parcelle, campagnes décroissantes. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'record:read');

  const cropYears = await prisma.cropYear.findMany({
    where: { parcelId: id },
    include: { crop: true },
    orderBy: [{ campaignYear: 'desc' }, { createdAt: 'desc' }],
  });

  return ok({ items: cropYears });
});

/**
 * POST /api/parcels/:id/crops — enregistre la culture d'une campagne.
 * Réenregistrer la même culture sur la même campagne met à jour l'existant.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, cropYearSchema);

  // La culture doit appartenir au référentiel global ou à cette exploitation.
  const crop = await prisma.crop.findFirst({
    where: { id: input.cropId, OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    select: { id: true, name: true },
  });
  if (!crop) throw badRequest('Culture inconnue pour cette exploitation.');

  if (
    input.sowingDate &&
    input.actualHarvestDate &&
    input.actualHarvestDate < input.sowingDate
  ) {
    throw badRequest('La date de récolte ne peut pas précéder la date de semis.');
  }

  const data = {
    variety: input.variety ?? null,
    sowingDate: input.sowingDate ?? null,
    expectedHarvestDate: input.expectedHarvestDate ?? null,
    actualHarvestDate: input.actualHarvestDate ?? null,
    yieldValue:
      input.yieldValue !== undefined ? new Prisma.Decimal(input.yieldValue) : null,
    yieldUnit: input.yieldUnit ?? null,
    notes: input.notes ?? null,
  };

  const cropYear = await prisma.cropYear.upsert({
    where: {
      parcelId_campaignYear_cropId: {
        parcelId: id,
        campaignYear: input.campaignYear,
        cropId: crop.id,
      },
    },
    create: {
      parcelId: id,
      cropId: crop.id,
      campaignYear: input.campaignYear,
      ...data,
    },
    update: data,
    include: { crop: true },
  });

  await logAudit({
    action: 'cropyear.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'cropYear',
    entityId: cropYear.id,
    ipAddress: clientIp(request),
    metadata: { crop: crop.name, campaignYear: input.campaignYear },
  });

  return ok({ item: cropYear, message: 'Culture enregistrée' }, 201);
});
