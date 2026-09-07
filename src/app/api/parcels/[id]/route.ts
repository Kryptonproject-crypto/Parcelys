import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { parcelUpdateSchema } from '@/lib/validation/farming';
import { getParcelGeometry, saveParcelGeometry } from '@/lib/geo/repository';
import { logAudit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/api/errors';
import { currentCampaignYear } from '@/lib/constants/agronomy';

type Ctx = { params: Promise<Record<string, string>> };

function parcelId(params: Record<string, string>): string {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
}

/** GET /api/parcels/:id — fiche complète (géométrie incluse). */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = parcelId(await context.params);
  await requireParcelAccess(id, 'parcel:read');

  const [parcel, geometry] = await Promise.all([
    prisma.parcel.findUniqueOrThrow({
      where: { id },
      include: {
        cropYears: {
          include: { crop: true },
          orderBy: { campaignYear: 'desc' },
        },
        _count: {
          select: {
            fertilizations: true,
            phytoTreatments: true,
            operations: true,
            documents: true,
          },
        },
      },
    }),
    getParcelGeometry(id),
  ]);

  const year = currentCampaignYear();

  return ok({
    id: parcel.id,
    name: parcel.name,
    internalNumber: parcel.internalNumber,
    commune: parcel.commune,
    inseeCode: parcel.inseeCode,
    lieuDit: parcel.lieuDit,
    cadastralRef: parcel.cadastralRef,
    pacId: parcel.pacId,
    parcelType: parcel.parcelType,
    status: parcel.status,
    notes: parcel.notes,
    areaHa: Number(parcel.areaHa),
    centroid:
      parcel.centroidLat !== null && parcel.centroidLng !== null
        ? { lat: parcel.centroidLat, lng: parcel.centroidLng }
        : null,
    geometry,
    currentCrop:
      parcel.cropYears.find((cy) => cy.campaignYear === year) ?? null,
    cropYears: parcel.cropYears,
    counts: parcel._count,
    createdAt: parcel.createdAt,
    updatedAt: parcel.updatedAt,
  });
});

/** PUT /api/parcels/:id — met à jour les attributs et/ou la géométrie. */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = parcelId(await context.params);
  const { ctx } = await requireParcelAccess(id, 'parcel:write');
  const input = await parseBody(request, parcelUpdateSchema);

  if (input.internalNumber) {
    const duplicate = await prisma.parcel.findFirst({
      where: {
        farmId: ctx.farmId,
        internalNumber: input.internalNumber,
        deletedAt: null,
        id: { not: id },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict(
        `Le numéro interne « ${input.internalNumber} » est déjà utilisé par une autre parcelle.`,
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.parcel.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.internalNumber !== undefined ? { internalNumber: input.internalNumber ?? null } : {}),
        ...(input.commune !== undefined ? { commune: input.commune ?? null } : {}),
        ...(input.inseeCode !== undefined ? { inseeCode: input.inseeCode ?? null } : {}),
        ...(input.lieuDit !== undefined ? { lieuDit: input.lieuDit ?? null } : {}),
        ...(input.cadastralRef !== undefined ? { cadastralRef: input.cadastralRef ?? null } : {}),
        ...(input.pacId !== undefined ? { pacId: input.pacId ?? null } : {}),
        ...(input.parcelType !== undefined ? { parcelType: input.parcelType ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      },
    });

    if (input.geometry) {
      await saveParcelGeometry(tx, id, input.geometry);
    }

    return tx.parcel.findUniqueOrThrow({ where: { id } });
  });

  await logAudit({
    action: input.geometry ? 'parcel.geometry_updated' : 'parcel.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'parcel',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { areaHa: Number(updated.areaHa) },
  });

  return ok({
    id: updated.id,
    name: updated.name,
    areaHa: Number(updated.areaHa),
    message: 'Parcelle mise à jour',
  });
});

/**
 * DELETE /api/parcels/:id — suppression logique.
 * Les interventions restent en base : le registre reste consultable et
 * exportable, conformément aux obligations de traçabilité.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = parcelId(await context.params);
  const { ctx, parcel } = await requireParcelAccess(id, 'parcel:delete');

  await prisma.parcel.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  });

  await logAudit({
    action: 'parcel.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'parcel',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { name: parcel.name },
  });

  return ok({
    message: `Parcelle « ${parcel.name} » supprimée. Son historique reste conservé pour vos registres.`,
  });
});
