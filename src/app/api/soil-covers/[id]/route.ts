import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoverDestructionMethod, SoilCoverKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireParcelAccess } from '@/lib/auth/rbac';
import { badRequest, notFound } from '@/lib/api/errors';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { incoherencesDates } from '@/lib/regulatory/soil-cover';
import { differences } from '@/lib/services/saisies';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * DELETE /api/soil-covers/:id — retirer un couvert.
 *
 * Journalisé, comme toute suppression : un couvert supprimé disparaît du
 * dossier de contrôle, et il faut pouvoir dire quand et par qui.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const ctx = await requireFarmAccess('record:delete');
  const { id } = await context.params;

  // La jointure sur l'exploitation fait l'autorisation : modifier l'identifiant
  // dans l'URL ne donne accès à rien.
  const couvert = await prisma.soilCover.findFirst({
    where: { id, parcel: { farmId: ctx.farmId, deletedAt: null } },
    select: { id: true, kind: true, parcelId: true },
  });
  if (!couvert) throw notFound('Couvert introuvable');

  await prisma.soilCover.delete({ where: { id: couvert.id } });

  await logAudit({
    action: 'soilCover.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'soilCover',
    entityId: couvert.id,
    ipAddress: clientIp(request),
    metadata: { kind: couvert.kind, parcelId: couvert.parcelId },
  });

  return ok({ message: 'Couvert supprimé' });
});

const CouvertModifie = z.object({
  cropYearId: z.string().min(1).nullable().optional(),
  kind: z.nativeEnum(SoilCoverKind),
  species: z.string().trim().max(300).nullable().optional(),
  sownOn: z.coerce.date().nullable().optional(),
  emergedOn: z.coerce.date().nullable().optional(),
  destroyedOn: z.coerce.date().nullable().optional(),
  destructionMethod: z.nativeEnum(CoverDestructionMethod).nullable().optional(),
  areaHa: z.number().positive().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * PUT /api/soil-covers/:id — corriger un couvert : nature, espèces, dates de
 * semis, de levée, de destruction, mode de destruction.
 *
 * Les mêmes refus qu'à la création — des dates incohérentes —, et rien
 * d'autre. L'accès se vérifie par la parcelle du couvert.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const { id } = await context.params;
  const existant = id ? await prisma.soilCover.findUnique({ where: { id } }) : null;
  if (!existant) throw notFound('Couvert introuvable');

  const { ctx } = await requireParcelAccess(existant.parcelId, 'record:write');
  const body = await parseBody(request, CouvertModifie);

  const problemes = incoherencesDates({
    sownOn: body.sownOn ?? null,
    emergedOn: body.emergedOn ?? null,
    destroyedOn: body.destroyedOn ?? null,
  });
  if (problemes.length > 0) throw badRequest(problemes.join(' '));

  if (body.cropYearId) {
    const campagne = await prisma.cropYear.findFirst({
      where: { id: body.cropYearId, parcelId: existant.parcelId },
      select: { id: true },
    });
    if (!campagne) throw badRequest('Cette campagne n’appartient pas à cette parcelle.');
  }

  const data = {
    cropYearId: body.cropYearId ?? null,
    kind: body.kind,
    species: body.species ?? null,
    sownOn: body.sownOn ?? null,
    emergedOn: body.emergedOn ?? null,
    destroyedOn: body.destroyedOn ?? null,
    destructionMethod: body.destructionMethod ?? null,
    areaHa: body.areaHa ?? null,
    notes: body.notes ?? null,
  };
  const item = await prisma.soilCover.update({ where: { id: existant.id }, data });

  await logAudit({
    action: 'soilCover.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'soilCover',
    entityId: existant.id,
    ipAddress: clientIp(request),
    metadata: {
      modifications: differences(existant, data, [
        'kind',
        'species',
        'sownOn',
        'emergedOn',
        'destroyedOn',
        'destructionMethod',
        'notes',
      ]),
    },
  });

  return ok({ item, id: existant.id, message: 'Couvert corrigé' });
});
