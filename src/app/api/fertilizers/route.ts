import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';

/** GET /api/fertilizers — engrais minéraux disponibles pour l'exploitation. */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('record:read');

  const items = await prisma.fertilizer.findMany({
    where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return ok({ items });
});
