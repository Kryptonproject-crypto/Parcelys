import 'server-only';
import { prisma } from '@/lib/prisma';
import { ApiError, notFound } from '@/lib/api/errors';

/**
 * Garde-fous de l'administration des comptes.
 *
 * Deux erreurs sont irréversibles depuis l'interface : se suspendre soi-même,
 * et retirer le dernier administrateur. Les deux laisseraient l'instance sans
 * personne pour la déverrouiller — il faudrait alors une intervention en base.
 */

export type AdminUserRecord = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

export async function loadManagedUser(id: string): Promise<AdminUserRecord> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isPlatformAdmin: true,
      suspendedAt: true,
      deletedAt: true,
    },
  });
  if (!user) throw notFound('Compte introuvable');
  return user;
}

export function assertNotSelf(
  actorId: string,
  targetId: string,
  message: string,
): void {
  if (actorId === targetId) {
    throw new ApiError(409, message, 'SELF_ACTION_FORBIDDEN');
  }
}

/** Refuse toute opération qui laisserait l'instance sans administrateur actif. */
export async function assertNotLastAdmin(
  target: AdminUserRecord,
  message: string,
): Promise<void> {
  if (!target.isPlatformAdmin) return;

  const remaining = await prisma.user.count({
    where: {
      isPlatformAdmin: true,
      deletedAt: null,
      suspendedAt: null,
      id: { not: target.id },
    },
  });

  if (remaining === 0) {
    throw new ApiError(409, message, 'LAST_ADMIN');
  }
}
