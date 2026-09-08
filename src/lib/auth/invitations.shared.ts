/**
 * Partie des codes d'invitation utilisable des deux côtés.
 *
 * Le module serveur `invitations.ts` importe `server-only` : les formulaires et
 * les schémas de validation, eux, ont besoin du format et des libellés. Tout ce
 * qui touche au secret (génération, empreinte, consommation) reste côté
 * serveur.
 */

export const CODE_PREFIX = 'PRCL';
export const CODE_GROUPS = 3;
export const CODE_GROUP_SIZE = 4;

/** Durée de validité par défaut d'une invitation, en jours. */
export const DEFAULT_VALIDITY_DAYS = 14;
export const MAX_VALIDITY_DAYS = 90;

/** Forme imprimée, montrée en exemple dans les formulaires. */
export const CODE_PLACEHOLDER = 'PRCL-XXXX-XXXX-XXXX';

/**
 * Forme canonique : majuscules, séparateurs et espaces retirés. Permet
 * d'accepter « prcl 8f3a-kt2m qwx7 » aussi bien que la forme imprimée.
 */
export function normalizeInvitationCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Ajoute les tirets pendant la saisie, sans gêner le collage. */
export function formatInvitationCode(raw: string): string {
  const normalized = normalizeInvitationCode(raw).slice(
    0,
    CODE_PREFIX.length + CODE_GROUPS * CODE_GROUP_SIZE,
  );
  const body = normalized.startsWith(CODE_PREFIX)
    ? normalized.slice(CODE_PREFIX.length)
    : normalized;
  const groups = body.match(/.{1,4}/g) ?? [];
  return [CODE_PREFIX, ...groups].join('-');
}

export type InvitationStatus = 'ACTIVE' | 'USED' | 'REVOKED' | 'EXPIRED';

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  ACTIVE: 'Active',
  USED: 'Utilisée',
  REVOKED: 'Révoquée',
  EXPIRED: 'Expirée',
};

export function invitationStatus(
  invitation: {
    usedAt: Date | string | null;
    revokedAt: Date | string | null;
    expiresAt: Date | string;
  },
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.usedAt) return 'USED';
  if (invitation.revokedAt) return 'REVOKED';
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}
