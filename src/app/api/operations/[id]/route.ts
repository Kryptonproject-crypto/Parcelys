import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/operations/:id — supprime un travail agricole. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Travail introuvable');

  const record = await prisma.agriculturalOperation.findUnique({
    where: { id },
    select: { id: true, parcelId: true, type: true },
  });
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
    metadata: { type: record.type },
  });

  return ok({ message: 'Travail supprimé' });
});
