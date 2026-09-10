import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { fertilizationSchema } from '@/lib/validation/farming';
import {
  computeNutrientBalance,
  computeNutrients,
  computeTotalQuantity,
} from '@/lib/services/fertilization';
import { logAudit } from '@/lib/audit';
import { decimalWeather, resolveInterventionWeather } from '@/lib/weather';
import { badRequest, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/fertilization — apports + bilan NPK de la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'record:read');

  const items = await prisma.fertilizerApplication.findMany({
    where: { parcelId: id },
    include: {
      fertilizer: { select: { name: true } },
      organicInput: { select: { name: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  const balance = computeNutrientBalance(
    items.map((i) => ({
      treatedAreaHa: i.treatedAreaHa.toString(),
      nSupplied: i.nSupplied?.toString() ?? null,
      pSupplied: i.pSupplied?.toString() ?? null,
      kSupplied: i.kSupplied?.toString() ?? null,
    })),
  );

  return ok({ items, balance });
});

/**
 * POST /api/parcels/:id/fertilization — enregistre un apport.
 *
 * La quantité totale (`dose × surface`) et les éléments fertilisants sont
 * calculés côté serveur à partir du référentiel : le client ne peut pas les
 * imposer.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx, parcel } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, fertilizationSchema);

  const parcelAreaHa = Number(parcel.areaHa);
  const treatedAreaHa = input.treatedAreaHa ?? parcelAreaHa;

  if (treatedAreaHa <= 0) {
    throw badRequest(
      'La surface traitée doit être supérieure à 0. Dessinez d’abord la géométrie de la parcelle.',
    );
  }
  if (treatedAreaHa > parcelAreaHa * 1.05) {
    throw badRequest(
      `La surface traitée (${treatedAreaHa.toFixed(4)} ha) dépasse la superficie de la parcelle (${parcelAreaHa.toFixed(4)} ha).`,
    );
  }

  // Teneurs issues du référentiel de l'exploitation (jamais du client).
  let mineral = null;
  let organic = null;
  let productLabel = input.productLabel;

  if (input.inputType === 'MINERAL' && input.fertilizerId) {
    const fertilizer = await prisma.fertilizer.findFirst({
      where: { id: input.fertilizerId, OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    });
    if (!fertilizer) throw badRequest('Engrais inconnu pour cette exploitation.');
    mineral = {
      nPercent: fertilizer.nPercent ? Number(fertilizer.nPercent) : null,
      pPercent: fertilizer.pPercent ? Number(fertilizer.pPercent) : null,
      kPercent: fertilizer.kPercent ? Number(fertilizer.kPercent) : null,
    };
    productLabel = fertilizer.name;
  }

  if (input.inputType === 'ORGANIC' && input.organicInputId) {
    const organicInput = await prisma.organicInput.findFirst({
      where: { id: input.organicInputId, OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    });
    if (!organicInput) throw badRequest('Produit organique inconnu pour cette exploitation.');
    organic = {
      nContent: organicInput.nContent ? Number(organicInput.nContent) : null,
      pContent: organicInput.pContent ? Number(organicInput.pContent) : null,
      kContent: organicInput.kContent ? Number(organicInput.kContent) : null,
    };
    productLabel = organicInput.name;
  }

  const { totalQuantity, totalUnit } = computeTotalQuantity(
    input.dose,
    input.doseUnit,
    treatedAreaHa,
  );

  const computed = computeNutrients({
    dose: input.dose,
    doseUnit: input.doseUnit,
    mineral,
    organic,
  });

  // Une saisie manuelle des éléments prime sur le calcul (analyse de produit).
  const nSupplied = input.nSupplied ?? computed.nSupplied;
  const pSupplied = input.pSupplied ?? computed.pSupplied;
  const kSupplied = input.kSupplied ?? computed.kSupplied;

  if (input.cropYearId) {
    const cropYear = await prisma.cropYear.findFirst({
      where: { id: input.cropYearId, parcelId: id },
      select: { id: true },
    });
    if (!cropYear) throw badRequest('Culture inconnue pour cette parcelle.');
  }

  // Conditions au moment de l'intervention : celles relevées au champ priment,
  // sinon relevé ici si la parcelle est localisée.
  const location = await prisma.parcel.findUnique({
    where: { id },
    select: { centroidLat: true, centroidLng: true },
  });
  const weather = await resolveInterventionWeather(
    input,
    location ? { latitude: location.centroidLat, longitude: location.centroidLng } : null,
  );

  const created = await prisma.fertilizerApplication.create({
    data: {
      ...decimalWeather(weather),
      parcelId: id,
      cropYearId: input.cropYearId ?? null,
      appliedOn: input.appliedOn,
      inputType: input.inputType,
      fertilizerId: input.inputType === 'MINERAL' ? (input.fertilizerId ?? null) : null,
      organicInputId: input.inputType === 'ORGANIC' ? (input.organicInputId ?? null) : null,
      productLabel,
      dose: new Prisma.Decimal(input.dose),
      doseUnit: input.doseUnit,
      treatedAreaHa: new Prisma.Decimal(treatedAreaHa.toFixed(4)),
      totalQuantity: new Prisma.Decimal(totalQuantity),
      totalUnit: input.totalUnit ?? totalUnit,
      nSupplied: nSupplied !== null ? new Prisma.Decimal(nSupplied) : null,
      pSupplied: pSupplied !== null ? new Prisma.Decimal(pSupplied) : null,
      kSupplied: kSupplied !== null ? new Prisma.Decimal(kSupplied) : null,
      supplier: input.supplier ?? null,
      batchNumber: input.batchNumber ?? null,
      operator: input.operator ?? null,
      notes: input.notes ?? null,
      createdById: ctx.user.id,
    },
  });

  await logAudit({
    action: 'fertilization.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'fertilizerApplication',
    entityId: created.id,
    ipAddress: clientIp(request),
    metadata: { productLabel, dose: input.dose, doseUnit: input.doseUnit },
  });

  return ok(
    {
      item: created,
      computed: { totalQuantity, totalUnit, nSupplied, pSupplied, kSupplied },
      message: 'Apport enregistré',
    },
    201,
  );
});
