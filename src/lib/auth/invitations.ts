import 'server-only';
import { randomInt } from 'node:crypto';
import type { FarmRole, InvitationCode, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/auth/tokens';
import { ApiError } from '@/lib/api/errors';
import {
  CODE_GROUP_SIZE,
  CODE_GROUPS,
  CODE_PREFIX,
  DEFAULT_VALIDITY_DAYS,
  MAX_VALIDITY_DAYS,
  invitationStatus,
  normalizeInvitationCode,
} from '@/lib/auth/invitations.shared';

/**
 * Codes d'invitation — partie serveur.
 *
 * L'inscription publique est fermée : créer un compte exige un code délivré par
 * un administrateur. Le code suit les mêmes règles que les autres secrets de
 * l'application — seule son empreinte SHA-256 est stockée, la valeur en clair
 * n'est affichée qu'une fois, au moment de sa création.
 */

/**
 * Alphabet sans caractères ambigus (ni I, L, O, U, 0, 1) : un code est fait
 * pour être dicté au téléphone ou recopié depuis un papier.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomGroup(): string {
  let group = '';
  for (let i = 0; i < CODE_GROUP_SIZE; i += 1) {
    group += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return group;
}

/** Génère un code lisible : `PRCL-8F3A-KT2M-QWX7` (≈ 59 bits d'entropie). */
export function generateInvitationCode(): { code: string; hint: string } {
  const groups = Array.from({ length: CODE_GROUPS }, randomGroup);
  const code = [CODE_PREFIX, ...groups].join('-');
  // L'indice reprend le premier groupe : de quoi reconnaître un code dans la
  // liste sans révéler la partie secrète.
  return { code, hint: `${CODE_PREFIX}-${groups[0]}` };
}

export function hashInvitationCode(raw: string): string {
  return hashToken(normalizeInvitationCode(raw));
}

export type CreateInvitationInput = {
  createdById: string;
  email?: string | null;
  farmId?: string | null;
  role: FarmRole;
  grantsPlatformAdmin?: boolean;
  note?: string | null;
  validityDays?: number;
};

/**
 * Crée une invitation et renvoie le code en clair — la seule et unique fois où
 * il est lisible. L'administrateur doit le transmettre lui-même.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationCode; code: string }> {
  const days = Math.min(
    Math.max(input.validityDays ?? DEFAULT_VALIDITY_DAYS, 1),
    MAX_VALIDITY_DAYS,
  );
  const { code, hint } = generateInvitationCode();

  const invitation = await prisma.invitationCode.create({
    data: {
      codeHash: hashInvitationCode(code),
      codeHint: hint,
      email: input.email ? input.email.trim().toLowerCase() : null,
      farmId: input.farmId ?? null,
      role: input.role,
      grantsPlatformAdmin: input.grantsPlatformAdmin ?? false,
      note: input.note?.trim() || null,
      expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000),
      createdById: input.createdById,
    },
  });

  return { invitation, code };
}

/**
 * Vérifie un code sans le consommer.
 *
 * Les messages restent volontairement peu bavards : un code invalide, expiré ou
 * déjà utilisé renvoie la même erreur, pour ne pas transformer le formulaire
 * d'inscription en oracle. Seule la restriction d'adresse est explicite, car
 * elle n'apprend rien à qui ne détient pas déjà le code.
 */
export async function findUsableInvitation(
  rawCode: string,
  email?: string | null,
): Promise<InvitationCode & { farm: { id: string; name: string } | null }> {
  const generic = new ApiError(
    403,
    "Code d'invitation invalide ou expiré. Demandez-en un nouveau à votre administrateur.",
    'INVITATION_INVALID',
  );

  const normalized = normalizeInvitationCode(rawCode);
  if (normalized.length < 8) throw generic;

  const invitation = await prisma.invitationCode.findUnique({
    where: { codeHash: hashToken(normalized) },
    include: { farm: { select: { id: true, name: true, deletedAt: true } } },
  });

  if (!invitation) throw generic;
  if (invitationStatus(invitation) !== 'ACTIVE') throw generic;
  // Exploitation supprimée entre-temps : le code ne mène plus nulle part.
  if (invitation.farmId && (!invitation.farm || invitation.farm.deletedAt)) {
    throw generic;
  }

  const candidate = email?.trim().toLowerCase();
  if (invitation.email && candidate && invitation.email !== candidate) {
    throw new ApiError(
      403,
      "Ce code d'invitation est réservé à une autre adresse e-mail.",
      'INVITATION_EMAIL_MISMATCH',
    );
  }

  return {
    ...invitation,
    farm: invitation.farm
      ? { id: invitation.farm.id, name: invitation.farm.name }
      : null,
  };
}

/**
 * Marque l'invitation comme consommée. Le `where` reprend `usedAt: null` pour
 * que deux inscriptions simultanées ne puissent pas utiliser le même code : la
 * seconde ne met à jour aucune ligne.
 */
export async function consumeInvitation(
  tx: Prisma.TransactionClient,
  invitationId: string,
  userId: string,
): Promise<void> {
  const { count } = await tx.invitationCode.updateMany({
    where: { id: invitationId, usedAt: null, revokedAt: null },
    data: { usedAt: new Date(), usedById: userId },
  });

  if (count === 0) {
    throw new ApiError(
      409,
      "Ce code d'invitation vient d'être utilisé.",
      'INVITATION_ALREADY_USED',
    );
  }
}

/**
 * Amorçage de l'instance : tant qu'aucun compte n'existe, l'inscription reste
 * ouverte pour créer le tout premier administrateur. Dès ce compte créé, un
 * code devient obligatoire.
 */
export async function isBootstrapAllowed(): Promise<boolean> {
  const existing = await prisma.user.count();
  return existing === 0;
}
