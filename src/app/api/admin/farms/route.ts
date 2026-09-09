import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { conflict, notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

/**
 * Exploitations, côté administration.
 *
 * La suppression est **logique** : `deleted_at` est renseigné, rien n'est
 * effacé. Une exploitation porte des registres phytosanitaires et des bilans de
 * fertilisation — des documents que l'exploitant doit conserver, et qu'un clic
 * ne doit pas pouvoir détruire. Elle se rétablit donc aussi.
 */

const farmActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), farmId: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('restore'), farmId: z.string().trim().min(1).max(40) }),
]);

/** GET — exploitations de l'instance, supprimées comprises. */
export const GET = route(async () => {
  await requirePlatformAdmin();

  const farms = await prisma.farm.findMany({
    orderBy: [{ deletedAt: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      siret: true,
      isDemo: true,
      deletedAt: true,
      createdAt: true,
      _count: { select: { members: true, parcels: true } },
      members: {
        where: { role: 'OWNER' },
        select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      },
    },
  });

  // Le décompte des enregistrements réglementaires : c'est lui qui dit ce
  // qu'une suppression rendrait inaccessible.
  const registres = await prisma.$queryRaw<Array<{ farm_id: string; n: bigint }>>`
    SELECT p.farm_id, count(*)::bigint AS n
    FROM phytosanitary_applications a
    JOIN parcels p ON p.id = a.parcel_id
    GROUP BY p.farm_id
  `;
  const parFerme = new Map(registres.map((r) => [r.farm_id, Number(r.n)]));

  return ok({
    farms: farms.map((farm) => ({
      id: farm.id,
      name: farm.name,
      siret: farm.siret,
      isDemo: farm.isDemo,
      deleted: farm.deletedAt !== null,
      deletedAt: farm.deletedAt?.toISOString() ?? null,
      createdAt: farm.createdAt.toISOString(),
      memberCount: farm._count.members,
      parcelCount: farm._count.parcels,
      phytoRecordCount: parFerme.get(farm.id) ?? 0,
      owners: farm.members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: `${m.user.firstName} ${m.user.lastName}`,
      })),
    })),
  });
});

/** POST — supprime ou rétablit une exploitation. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin();
  const input = await parseBody(request, farmActionSchema);

  const farm = await prisma.farm.findUnique({
    where: { id: input.farmId },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!farm) throw notFound('Exploitation introuvable');

  if (input.action === 'restore') {
    if (farm.deletedAt === null) {
      return ok({ message: `« ${farm.name} » n'était pas supprimée.`, id: farm.id });
    }
    await prisma.farm.update({ where: { id: farm.id }, data: { deletedAt: null } });
    await logAudit({
      action: 'farm.restored_by_admin',
      userId: auth.user.id,
      farmId: farm.id,
      entity: 'Farm',
      entityId: farm.id,
      ipAddress: clientIp(request),
      metadata: { farmName: farm.name },
    });
    return ok({ message: `« ${farm.name} » a été rétablie.`, id: farm.id });
  }

  if (farm.deletedAt !== null) {
    throw conflict('Cette exploitation est déjà supprimée.');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.farm.update({ where: { id: farm.id }, data: { deletedAt: now } });

    // Les experts qui la suivaient perdent l'accès immédiatement : laisser une
    // mission ouverte sur une exploitation supprimée n'aurait aucun sens.
    await tx.advisoryEngagement.updateMany({
      where: { farmId: farm.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: now },
    });
  });

  await logAudit({
    action: 'farm.deleted_by_admin',
    userId: auth.user.id,
    farmId: farm.id,
    entity: 'Farm',
    entityId: farm.id,
    ipAddress: clientIp(request),
    metadata: { farmName: farm.name },
  });

  return ok({
    message:
      `« ${farm.name} » a été supprimée. Ses registres sont conservés et ` +
      'l’exploitation peut être rétablie.',
    id: farm.id,
  });
});
