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

/**
 * Ce qu'un compte supprimé rend, et ce qu'il garde.
 *
 * La suppression par l'administration est **logique** : la ligne survit, parce
 * que les interventions phytosanitaires et les apports pointent vers leur
 * auteur. Effacer le compte effacerait la traçabilité d'un registre que
 * l'exploitant doit conserver.
 *
 * Mais garder la ligne, c'était garder l'adresse : `email_normalized` est
 * unique, et rien ne permettait de recréer un compte avec la même adresse —
 * l'inscription répondait « un compte existe déjà », en parlant d'un compte
 * supprimé et invisible. Impasse, et incompréhensible de l'extérieur.
 *
 * L'adresse est donc remplacée par une pierre tombale, à `.invalid` : ce
 * domaine de premier niveau est réservé par la RFC 2606 et ne peut être ni
 * enregistré ni routé, donc rien ne partira jamais vers cette adresse. L'unicité
 * tient par l'identifiant du compte, et l'adresse d'origine reste dans le
 * journal d'audit — c'est la trace qui compte, pas la ligne.
 *
 * Le téléphone part avec : un compte supprimé n'a plus à porter de coordonnées.
 */
export function tombstoneEmail(userId: string): string {
  return `supprime+${userId}@parcelys.invalid`;
}

/** Reconnaît une adresse déjà libérée. */
export function isTombstoneEmail(email: string): boolean {
  return email.endsWith('@parcelys.invalid');
}
