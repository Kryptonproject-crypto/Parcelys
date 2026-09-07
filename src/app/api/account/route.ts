import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { verifyPassword } from '@/lib/auth/password';
import { destroyCurrentSession, revokeAllSessions } from '@/lib/auth/session';
import { deleteDocument } from '@/lib/storage/documents';
import { ApiError } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

const deleteSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis'),
  confirmation: z.literal('SUPPRIMER', {
    errorMap: () => ({ message: 'Saisissez SUPPRIMER pour confirmer' }),
  }),
});

/**
 * DELETE /api/account — suppression du compte (RGPD, art. 17).
 *
 * Les exploitations dont l'utilisateur est le seul propriétaire sont supprimées
 * avec leurs données et leurs fichiers. Celles partagées avec d'autres membres
 * sont conservées : seule l'appartenance de l'utilisateur est retirée, afin de
 * ne pas détruire les registres de tiers.
 */
export const DELETE = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  await enforceRateLimit(`delete-account:${auth.user.id}`, {
    limit: 3,
    windowSeconds: 3600,
  });

  const input = await parseBody(request, deleteSchema);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { id: true, passwordHash: true },
  });

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(400, 'Mot de passe incorrect.', 'INVALID_PASSWORD');
  }

  // Exploitations dont l'utilisateur est l'unique propriétaire.
  const ownedFarms = await prisma.farm.findMany({
    where: {
      members: { some: { userId: user.id, role: 'OWNER' } },
    },
    select: { id: true, members: { select: { userId: true, role: true } } },
  });

  const soleOwnerFarmIds = ownedFarms
    .filter(
      (farm) =>
        farm.members.filter((m) => m.role === 'OWNER' && m.userId !== user.id).length === 0 &&
        farm.members.filter((m) => m.userId !== user.id).length === 0,
    )
    .map((farm) => farm.id);

  // Suppression des fichiers avant la suppression en cascade des lignes.
  const documents = await prisma.document.findMany({
    where: { farmId: { in: soleOwnerFarmIds } },
    select: { storageKey: true },
  });
  for (const document of documents) {
    await deleteDocument(document.storageKey).catch(() => undefined);
  }

  await logAudit({
    action: 'account.deleted',
    userId: user.id,
    ipAddress: clientIp(request),
    metadata: {
      deletedFarms: soleOwnerFarmIds.length,
      keptSharedFarms: ownedFarms.length - soleOwnerFarmIds.length,
    },
  });

  await revokeAllSessions(user.id);

  await prisma.$transaction([
    prisma.farm.deleteMany({ where: { id: { in: soleOwnerFarmIds } } }),
    // La suppression en cascade retire les appartenances, sessions et jetons.
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  await destroyCurrentSession();

  return ok({
    message:
      'Votre compte et vos données ont été supprimés. ' +
      (ownedFarms.length > soleOwnerFarmIds.length
        ? 'Les exploitations partagées avec d’autres utilisateurs ont été conservées.'
        : ''),
  });
});
