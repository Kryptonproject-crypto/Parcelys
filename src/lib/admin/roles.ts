/**
 * Rôles d'administration et matrice des autorisations.
 *
 * Module partagé — sans `server-only` — parce que la navigation en a besoin
 * pour n'afficher que les sections permises. Ce n'est qu'un confort : chaque
 * route et chaque page revérifient côté serveur (`src/lib/admin/scope.ts`),
 * et une section masquée dont on taperait l'adresse répond 403 ou 404.
 *
 *   GENERAL    l'administrateur général : toute l'instance, et seul à pouvoir
 *              toucher à la configuration, à la maintenance, au serveur, aux
 *              référentiels, au journal, aux administrateurs, aux
 *              portefeuilles et à la FAQ ;
 *   SECONDARY  l'administrateur secondaire : les clients des portefeuilles
 *              qu'il gère, et rien au-delà.
 *
 * Deux colonnes portent ces rôles — `is_platform_admin` (général, colonne
 * historique dont le sens est conservé) et `is_secondary_admin` — qu'une
 * contrainte de la base rend exclusives.
 */

export type AdminRole = 'GENERAL' | 'SECONDARY';

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  GENERAL: 'Administrateur général',
  SECONDARY: 'Administrateur secondaire',
};

export function adminRoleOf(user: {
  isPlatformAdmin: boolean;
  isSecondaryAdmin?: boolean | null;
}): AdminRole | null {
  if (user.isPlatformAdmin) return 'GENERAL';
  if (user.isSecondaryAdmin) return 'SECONDARY';
  return null;
}

const LES_DEUX = ['GENERAL', 'SECONDARY'] as const;
const GENERAL_SEUL = ['GENERAL'] as const;

/**
 * Qui peut quoi. Une permission absente pour un rôle est un refus (403) ;
 * une ressource hors du périmètre d'un rôle autorisé est introuvable (404).
 */
export const ADMIN_PERMISSIONS = {
  /** Tableau de bord, borné au périmètre. */
  'dashboard:read': LES_DEUX,
  /** Exploitations : liste et fiches, bornées au périmètre. */
  'farms:read': LES_DEUX,
  /** Supprimer, rétablir, purger une exploitation. */
  'farms:delete': GENERAL_SEUL,
  /** Comptes : liste et fiches, bornées au périmètre. */
  'users:read': LES_DEUX,
  /** Suspendre, réactiver, déverrouiller, vérifier l'adresse, fermer les sessions. */
  'users:manage': LES_DEUX,
  /** Supprimer un compte. */
  'users:delete': GENERAL_SEUL,
  /** Techniciens (experts agronomiques) : liste et fiches, bornées au périmètre. */
  'technicians:read': LES_DEUX,
  /** Ouvrir ou clore la mission d'un technicien sur une exploitation. */
  'technicians:missions': LES_DEUX,
  /** Codes d'invitation : lire, créer (exploitants et techniciens seulement pour le secondaire), révoquer. */
  'invitations:read': LES_DEUX,
  'invitations:create': LES_DEUX,
  'invitations:revoke': LES_DEUX,
  /** Attribuer un client à un portefeuille, ou l'en transférer. */
  'clients:assign': GENERAL_SEUL,
  /** Créer, renommer, supprimer un portefeuille. */
  'portfolios:manage': GENERAL_SEUL,
  /** Créer, inviter, modifier, désactiver, révoquer un administrateur. */
  'admins:manage': GENERAL_SEUL,
  /** Demandes de support : lire, répondre, changer le statut, attribuer. */
  'support:read': LES_DEUX,
  'support:manage': LES_DEUX,
  /** Changer le portefeuille d'une demande. */
  'support:transfer': GENERAL_SEUL,
  /** Exports CSV de l'administration, bornés au périmètre. */
  'exports:read': LES_DEUX,
  'faq:manage': GENERAL_SEUL,
  'referentials:manage': GENERAL_SEUL,
  'audit:read': GENERAL_SEUL,
  'maintenance:manage': GENERAL_SEUL,
  'server:read': GENERAL_SEUL,
} as const satisfies Record<string, readonly AdminRole[]>;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export function adminCan(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  return (ADMIN_PERMISSIONS[permission] as readonly AdminRole[]).includes(role);
}
