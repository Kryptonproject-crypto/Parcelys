import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { copieDeRegistre, logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';
import { operationSchema } from '@/lib/validation/farming';
import { differences, preparerTravail } from '@/lib/services/saisies';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/operations/:id — supprime un travail agricole. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Travail introuvable');

  const record = await prisma.agriculturalOperation.findUnique({ where: { id } });
  if (!record) throw notFound('Travail introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.agriculturalOperation.delete({ where: { id } });

  await logAudit({
    action: 'operation.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'agriculturalOperation',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { type: record.type, supprime: copieDeRegistre(record) },
  });

  return ok({ message: 'Travail supprimé' });
});

/**
 * PUT /api/operations/:id — corriger un travail.
 *
 * Mêmes champs et mêmes contrôles qu'à la création ; la météo enregistrée est
 * gardée si la correction n'en porte pas. Journalisé avec l'avant et l'après.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Travail introuvable');

  const existant = await prisma.agriculturalOperation.findUnique({ where: { id } });
  if (!existant) throw notFound('Travail introuvable');

  const { ctx } = await requireParcelAccess(existant.parcelId, 'record:write');
  const input = await parseBody(request, operationSchema);

  const data = await preparerTravail({ parcel: { id: existant.parcelId }, input, modification: true });
  const item = await prisma.agriculturalOperation.update({ where: { id }, data });

  await logAudit({
    action: 'operation.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'agriculturalOperation',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: {
      modifications: differences(existant, data, [
        'performedOn',
        'type',
        'equipment',
        'operator',
        'durationHours',
        'irrigationMm',
        'irrigationVolumeM3Ha',
        'waterSource',
        'waterNitrateMgL',
        'notes',
      ]),
    },
  });

  return ok({ item, id, message: 'Travail corrigé' });
});
