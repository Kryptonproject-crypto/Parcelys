import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { farmSchema } from '@/lib/validation/farming';
import { logAudit } from '@/lib/audit';

/** GET /api/farms — fiche de l'exploitation active. */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('farm:read');
  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: ctx.farmId } });
  return ok({ farm, role: ctx.role });
});

/** PUT /api/farms — met à jour l'exploitation active. */
export const PUT = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('farm:update');
  const input = await parseBody(request, farmSchema);

  const farm = await prisma.farm.update({
    where: { id: ctx.farmId },
    data: {
      name: input.name,
      siret: input.siret ?? null,
      addressLine: input.addressLine ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      department: input.department ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    },
  });

  await logAudit({
    action: 'farm.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'farm',
    entityId: ctx.farmId,
    ipAddress: clientIp(request),
  });

  return ok({ farm, message: 'Exploitation mise à jour' });
});
