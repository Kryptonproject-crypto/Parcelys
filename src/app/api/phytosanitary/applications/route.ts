import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';

/**
 * GET /api/phytosanitary/applications — registre phytosanitaire de
 * l'exploitation, filtrable (année, parcelle, culture, produit, substance).
 */
export const GET = route(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const ctx = await requireFarmAccess('record:read', params.get('farmId'));

  const year = Number(params.get('year'));
  const parcelId = params.get('parcelId');
  const search = params.get('q');
  const substance = params.get('substance');
  const incompleteOnly = params.get('filtre') === 'incomplet';

  const parcels = await prisma.parcel.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    select: { id: true },
  });
  const parcelIds = parcels.map((p) => p.id);

  const where: Prisma.PhytosanitaryApplicationWhereInput = {
    parcelId: parcelId && parcelIds.includes(parcelId) ? parcelId : { in: parcelIds },
    ...(Number.isFinite(year) && year > 1900
      ? {
          appliedOn: {
            gte: new Date(Date.UTC(year - 1, 7, 1)),
            lte: new Date(Date.UTC(year, 6, 31, 23, 59, 59)),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { productName: { contains: search, mode: 'insensitive' } },
            { amm: { contains: search } },
            { targetLabel: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(substance
      ? { activeSubstances: { contains: substance, mode: 'insensitive' } }
      : {}),
    ...(incompleteOnly
      ? { OR: [{ amm: null }, { targetLabel: null }, { operator: null }] }
      : {}),
  };

  const items = await prisma.phytosanitaryApplication.findMany({
    where,
    include: {
      parcel: { select: { id: true, name: true, internalNumber: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
      product: { select: { id: true, status: true } },
    },
    orderBy: { appliedOn: 'desc' },
    take: 1000,
  });

  return ok({
    total: items.length,
    items: items.map((i) => ({
      id: i.id,
      appliedOn: i.appliedOn,
      parcel: i.parcel,
      crop: i.cropYear?.crop.name ?? i.cropLabel,
      productName: i.productName,
      amm: i.amm,
      activeSubstances: i.activeSubstances,
      targetLabel: i.targetLabel,
      dose: i.dose.toString(),
      doseUnit: i.doseUnit,
      treatedAreaHa: i.treatedAreaHa.toString(),
      quantityUsed: i.quantityUsed.toString(),
      quantityUnit: i.quantityUnit,
      sprayVolumeLHa: i.sprayVolumeLHa?.toString() ?? null,
      weatherSummary: i.weatherSummary,
      weatherTempC: i.weatherTempC?.toString() ?? null,
      weatherWindKmh: i.weatherWindKmh?.toString() ?? null,
      operator: i.operator,
      productStatus: i.product?.status ?? null,
    })),
  });
});
