import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { restoreSnapshot } from '@/lib/pac/apply';

/** GET — sauvegardes disponibles, la plus récente en premier. */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('parcel:read');

  const snapshots = await prisma.pacSnapshot.findMany({
    where: { campaign: { farmId: ctx.farmId } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      label: true,
      parcelCount: true,
      areaHa: true,
      restoredAt: true,
      createdAt: true,
      campaign: { select: { year: true } },
    },
  });

  return ok({
    snapshots: snapshots.map((s) => ({
      id: s.id,
      label: s.label,
      year: s.campaign.year,
      parcelCount: s.parcelCount,
      areaHa: s.areaHa === null ? null : Number(s.areaHa),
      restoredAt: s.restoredAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

const restoreSchema = z.object({ snapshotId: z.string().trim().min(1).max(40) });

/**
 * POST — rétablit une sauvegarde.
 *
 * Les parcelles créées depuis sont marquées supprimées, jamais effacées : une
 * restauration ne doit pas être plus destructrice que l'import qu'elle répare.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:write');
  const input = await parseBody(request, restoreSchema);

  const resultat = await restoreSnapshot({
    farmId: ctx.farmId,
    snapshotId: input.snapshotId,
    userId: ctx.user.id,
  });

  await logAudit({
    action: 'pac.snapshot_restored',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'PacSnapshot',
    entityId: input.snapshotId,
    ipAddress: clientIp(request),
    metadata: resultat,
  });

  return ok({
    ...resultat,
    message:
      `${resultat.restored} parcelle(s) rétablie(s), ${resultat.softDeleted} retirée(s) du parcellaire actif. ` +
      'Rien n’a été effacé définitivement.',
  });
});
