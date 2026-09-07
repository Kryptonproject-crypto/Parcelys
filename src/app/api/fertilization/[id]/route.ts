import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * DELETE /api/fertilization/:id
 * L'accès est vérifié via la parcelle porteuse : un identifiant appartenant à
 * une autre exploitation renvoie 404.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Apport introuvable');

  const record = await prisma.fertilizerApplication.findUnique({
    where: { id },
    select: { id: true, parcelId: true, productLabel: true },
  });
  if (!record) throw notFound('Apport introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.fertilizerApplication.delete({ where: { id } });

  await logAudit({
    action: 'fertilization.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'fertilizerApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { productLabel: record.productLabel },
  });

  return ok({ message: 'Apport supprimé' });
});
