import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { sprayerSchema } from '@/lib/validation/farming';
import { logAudit } from '@/lib/audit';

/**
 * PUT /api/farms/pulverisateur — le pulvérisateur de l'exploitation active.
 *
 * Il sert, à la saisie d'un traitement, à dire si la ZNT d'un point d'eau ou
 * la distance aux habitations peut être réduite.
 */
export const PUT = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('farm:update');
  const input = await parseBody(request, sprayerSchema);

  const farm = await prisma.farm.update({
    where: { id: ctx.farmId },
    data: {
      sprayerType: input.sprayerType,
      sprayerDriftReductionPct: input.driftReductionPct,
      sprayerDriftEquipment: input.driftEquipment,
      riverainCharterApplied: input.riverainCharterApplied,
    },
    select: {
      sprayerType: true,
      sprayerDriftReductionPct: true,
      sprayerDriftEquipment: true,
      riverainCharterApplied: true,
    },
  });

  await logAudit({
    action: 'farm.sprayer_updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'farm',
    entityId: ctx.farmId,
    ipAddress: clientIp(request),
    metadata: farm,
  });

  return ok({ sprayer: farm, message: 'Pulvérisateur enregistré' });
});
