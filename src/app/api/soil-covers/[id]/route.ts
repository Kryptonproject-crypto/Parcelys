import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { notFound } from '@/lib/api/errors';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';

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
