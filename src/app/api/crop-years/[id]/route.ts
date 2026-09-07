import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/crop-years/:id — retire une culture de l'assolement. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Culture introuvable');

  const record = await prisma.cropYear.findUnique({
    where: { id },
    select: { id: true, parcelId: true, campaignYear: true },
  });
  if (!record) throw notFound('Culture introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.cropYear.delete({ where: { id } });

  await logAudit({
    action: 'cropyear.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'cropYear',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { campaignYear: record.campaignYear },
  });

  return ok({ message: 'Culture retirée de l’assolement' });
});
