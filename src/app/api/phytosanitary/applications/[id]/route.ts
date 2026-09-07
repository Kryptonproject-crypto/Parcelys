import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/phytosanitary/applications/:id — retire un traitement du registre. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Traitement introuvable');

  const record = await prisma.phytosanitaryApplication.findUnique({
    where: { id },
    select: { id: true, parcelId: true, productName: true },
  });
  if (!record) throw notFound('Traitement introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.phytosanitaryApplication.delete({ where: { id } });

  await logAudit({
    action: 'phyto.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'phytosanitaryApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { productName: record.productName },
  });

  return ok({ message: 'Traitement supprimé du registre' });
});
