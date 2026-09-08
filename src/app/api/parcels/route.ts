import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import {
  clientIp,
  enforceRateLimit,
  ok,
  parseBody,
  parseQuery,
  route,
} from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { parcelCreateSchema, parcelQuerySchema } from '@/lib/validation/farming';
import { findOverlappingParcels, saveParcelGeometry } from '@/lib/geo/repository';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { logAudit } from '@/lib/audit';
import { conflict } from '@/lib/api/errors';

/**
 * GET /api/parcels — liste paginée des parcelles de l'exploitation active.
 * Recherche sur le nom, le numéro interne, la commune et le lieu-dit.
 */
export const GET = route(async (request: NextRequest) => {
  const query = parseQuery(request, parcelQuerySchema);
  const ctx = await requireFarmAccess('parcel:read', query.farmId);
  const year = query.year ?? currentCampaignYear();

  const where: Prisma.ParcelWhereInput = {
    farmId: ctx.farmId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.parcelType ? { parcelType: query.parcelType } : {}),
    ...(query.commune ? { commune: { equals: query.commune, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { internalNumber: { contains: query.search, mode: 'insensitive' } },
            { commune: { contains: query.search, mode: 'insensitive' } },
            { lieuDit: { contains: query.search, mode: 'insensitive' } },
            { cadastralRef: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.cropId
      ? { cropYears: { some: { cropId: query.cropId, campaignYear: year } } }
      : {}),
  };

  const orderBy: Prisma.ParcelOrderByWithRelationInput =
    query.sort === 'area'
      ? { areaHa: 'desc' }
      : query.sort === 'commune'
        ? { commune: 'asc' }
        : query.sort === 'recent'
          ? { createdAt: 'desc' }
          : { name: 'asc' };

  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        cropYears: {
          where: { campaignYear: year },
          include: { crop: { select: { id: true, name: true } } },
          take: 1,
        },
        _count: {
          select: { fertilizations: true, phytoTreatments: true, operations: true },
        },
      },
    }),
  ]);

  return ok({
    campaignYear: year,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalAreaHa: parcels.reduce((sum, p) => sum + Number(p.areaHa), 0),
    items: parcels.map((parcel) => ({
      id: parcel.id,
      name: parcel.name,
      internalNumber: parcel.internalNumber,
      commune: parcel.commune,
      lieuDit: parcel.lieuDit,
      parcelType: parcel.parcelType,
      status: parcel.status,
      areaHa: Number(parcel.areaHa),
      centroid:
        parcel.centroidLat !== null && parcel.centroidLng !== null
          ? { lat: parcel.centroidLat, lng: parcel.centroidLng }
          : null,
      crop: parcel.cropYears[0]
        ? {
            id: parcel.cropYears[0].crop.id,
            name: parcel.cropYears[0].crop.name,
            variety: parcel.cropYears[0].variety,
          }
        : null,
      counts: {
        fertilizations: parcel._count.fertilizations,
        phyto: parcel._count.phytoTreatments,
        operations: parcel._count.operations,
      },
    })),
  });
});

/**
 * POST /api/parcels — crée une parcelle à partir d'une géométrie dessinée.
 * La superficie est calculée par PostGIS et non reprise du client.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:write');
  await enforceRateLimit(`parcel-create:${ctx.user.id}`, RateLimits.mutation);

  const input = await parseBody(request, parcelCreateSchema);

  if (input.internalNumber) {
    const duplicate = await prisma.parcel.findFirst({
      where: {
        farmId: ctx.farmId,
        internalNumber: input.internalNumber,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict(
        `Le numéro interne « ${input.internalNumber} » est déjà utilisé par une autre parcelle.`,
      );
    }
  }

  // Information (non bloquante) sur un éventuel recouvrement.
  const overlaps = await findOverlappingParcels(ctx.farmId, input.geometry);

  const parcel = await prisma.$transaction(async (tx) => {
    const created = await tx.parcel.create({
      data: {
        farmId: ctx.farmId,
        name: input.name,
        internalNumber: input.internalNumber ?? null,
        commune: input.commune ?? null,
        inseeCode: input.inseeCode ?? null,
        lieuDit: input.lieuDit ?? null,
        cadastralRef: input.cadastralRef ?? null,
        pacId: input.pacId ?? null,
        parcelType: input.parcelType ?? null,
        status: input.status,
        notes: input.notes ?? null,
      },
    });

    await saveParcelGeometry(tx, created.id, input.geometry);

    return tx.parcel.findUniqueOrThrow({ where: { id: created.id } });
  });

  await logAudit({
    action: 'parcel.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'parcel',
    entityId: parcel.id,
    ipAddress: clientIp(request),
    metadata: { name: parcel.name, areaHa: Number(parcel.areaHa) },
  });

  return ok(
    {
      id: parcel.id,
      name: parcel.name,
      areaHa: Number(parcel.areaHa),
      centroid:
        parcel.centroidLat !== null && parcel.centroidLng !== null
          ? { lat: parcel.centroidLat, lng: parcel.centroidLng }
          : null,
      warnings: overlaps.length
        ? [
            `Cette parcelle recouvre ${overlaps.length} parcelle(s) existante(s) : ` +
              overlaps
                .map((o) => `${o.name} (${o.overlapHa.toFixed(4)} ha)`)
                .join(', '),
          ]
        : [],
    },
    201,
  );
});
