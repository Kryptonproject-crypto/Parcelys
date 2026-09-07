import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { phytoApplicationSchema } from '@/lib/validation/farming';
import { computeTotalQuantity } from '@/lib/services/fertilization';
import { captureTreatmentConditions } from '@/lib/weather';
import { logAudit } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/phytosanitary — traitements de la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'record:read');

  const items = await prisma.phytosanitaryApplication.findMany({
    where: { parcelId: id },
    include: {
      product: { select: { id: true, amm: true, name: true, status: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  return ok({ items });
});

/**
 * POST /api/parcels/:id/phytosanitary — enregistre un traitement.
 *
 * Les caractéristiques réglementaires (AMM, substances actives) sont reprises
 * du référentiel E-Phy lorsque le produit y est référencé ; elles ne sont
 * jamais devinées. En saisie libre, le champ AMM reste vide et l'intervention
 * apparaît comme « à compléter » dans le tableau de bord.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx, parcel } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, phytoApplicationSchema);

  const parcelAreaHa = Number(parcel.areaHa);
  const treatedAreaHa = input.treatedAreaHa ?? parcelAreaHa;

  if (treatedAreaHa <= 0) {
    throw badRequest('La surface traitée doit être supérieure à 0.');
  }
  if (treatedAreaHa > parcelAreaHa * 1.05) {
    throw badRequest(
      `La surface traitée (${treatedAreaHa.toFixed(4)} ha) dépasse la superficie de la parcelle (${parcelAreaHa.toFixed(4)} ha).`,
    );
  }

  let productName = input.productName;
  let amm = input.amm ?? null;
  let activeSubstances = input.activeSubstances ?? null;
  let productId: string | null = null;

  if (input.productId) {
    const product = await prisma.phytosanitaryProduct.findUnique({
      where: { id: input.productId },
      include: { substances: { include: { substance: { select: { name: true } } } } },
    });
    if (!product) {
      throw badRequest(
        'Produit introuvable dans le référentiel E-Phy. Relancez une synchronisation ou saisissez le produit manuellement.',
      );
    }
    productId = product.id;
    productName = product.name;
    amm = product.amm;
    activeSubstances =
      product.substances.map((s) => s.substance.name).join(', ') || null;
  }

  if (input.cropYearId) {
    const cropYear = await prisma.cropYear.findFirst({
      where: { id: input.cropYearId, parcelId: id },
      select: { id: true },
    });
    if (!cropYear) throw badRequest('Culture inconnue pour cette parcelle.');
  }

  const { totalQuantity, totalUnit } = computeTotalQuantity(
    input.dose,
    input.doseUnit,
    treatedAreaHa,
  );

  // Conditions météo : relevé automatique si demandé et si la parcelle est localisée.
  let weather = {
    temperatureC: input.weatherTempC ?? null,
    windKmh: input.weatherWindKmh ?? null,
    humidity: input.weatherHumidity ?? null,
    precipitationMm: input.weatherRainMm ?? null,
    summary: input.weatherSummary ?? null,
    provider: null as string | null,
  };

  if (input.captureWeather) {
    const location = await prisma.parcel.findUnique({
      where: { id },
      select: { centroidLat: true, centroidLng: true },
    });
    if (location?.centroidLat != null && location.centroidLng != null) {
      const captured = await captureTreatmentConditions(
        location.centroidLat,
        location.centroidLng,
      );
      if (captured) weather = captured;
    }
  }

  const created = await prisma.phytosanitaryApplication.create({
    data: {
      parcelId: id,
      cropYearId: input.cropYearId ?? null,
      appliedOn: input.appliedOn,
      productId,
      productName,
      amm,
      activeSubstances,
      cropLabel: input.cropLabel ?? null,
      targetLabel: input.targetLabel ?? null,
      dose: new Prisma.Decimal(input.dose),
      doseUnit: input.doseUnit,
      sprayVolumeLHa:
        input.sprayVolumeLHa !== undefined ? new Prisma.Decimal(input.sprayVolumeLHa) : null,
      treatedAreaHa: new Prisma.Decimal(treatedAreaHa.toFixed(4)),
      quantityUsed: new Prisma.Decimal(totalQuantity),
      quantityUnit: totalUnit,
      weatherTempC:
        weather.temperatureC !== null ? new Prisma.Decimal(weather.temperatureC) : null,
      weatherWindKmh:
        weather.windKmh !== null ? new Prisma.Decimal(weather.windKmh) : null,
      weatherHumidity:
        weather.humidity !== null ? new Prisma.Decimal(weather.humidity) : null,
      weatherRainMm:
        weather.precipitationMm !== null ? new Prisma.Decimal(weather.precipitationMm) : null,
      weatherSummary: weather.summary,
      weatherSource: weather.provider,
      operator: input.operator ?? null,
      notes: input.notes ?? null,
      createdById: ctx.user.id,
    },
  });

  await logAudit({
    action: 'phyto.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'phytosanitaryApplication',
    entityId: created.id,
    ipAddress: clientIp(request),
    metadata: { productName, amm, dose: input.dose },
  });

  return ok(
    {
      item: created,
      message: 'Traitement enregistré',
      warnings: amm
        ? []
        : [
            'Aucun numéro d’AMM associé : cette intervention apparaîtra comme incomplète dans votre registre.',
          ],
    },
    201,
  );
});
