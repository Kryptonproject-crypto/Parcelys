import 'server-only';
import { FarmRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { ApiError } from '@/lib/api/errors';

/**
 * Permissions vérifiées côté serveur. Le frontend n'est jamais l'autorité :
 * chaque route API et chaque page passe par `requireFarmAccess`.
 */
/**
 * Permissions vérifiées côté serveur. Le frontend n'est jamais l'autorité :
 * chaque route API et chaque page passe par `requireFarmAccess`.
 *
 * `ADVISOR` est l'expert agronomique missionné. Sa liste est volontairement
 * courte, et c'est le cœur du dispositif : il lit le parcellaire et les
 * registres pour conseiller, il rédige des préconisations — et il n'écrit rien
 * d'autre. Aucune saisie dans un registre réglementaire, aucune modification de
 * parcelle, aucun accès aux membres ni aux paramètres de l'exploitation.
 */
export const PERMISSIONS = {
  'farm:read': [
    FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER, FarmRole.ADVISOR,
  ],
  'farm:update': [FarmRole.OWNER, FarmRole.ADMIN],
  'farm:delete': [FarmRole.OWNER],
  'member:read': [FarmRole.OWNER, FarmRole.ADMIN],
  'member:manage': [FarmRole.OWNER, FarmRole.ADMIN],
  'advisor:manage': [FarmRole.OWNER, FarmRole.ADMIN],
  'parcel:read': [
    FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER, FarmRole.ADVISOR,
  ],
  'parcel:write': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],
  'parcel:delete': [FarmRole.OWNER, FarmRole.ADMIN],
  'record:read': [
    FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER, FarmRole.ADVISOR,
  ],
  'record:write': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],
  'record:delete': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],
  'document:read': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER],
  'document:write': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],
  'document:delete': [FarmRole.OWNER, FarmRole.ADMIN],
  'export:read': [
    FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER, FarmRole.ADVISOR,
  ],
  'referential:write': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],

  /** Lire les préconisations de l'exploitation — les deux parties. */
  'recommendation:read': [
    FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE, FarmRole.VIEWER, FarmRole.ADVISOR,
  ],
  /** Rédiger, modifier et transmettre une préconisation : l'expert seul. */
  'recommendation:write': [FarmRole.ADVISOR],
  /** Accepter ou écarter une préconisation : l'exploitation seule. */
  'recommendation:respond': [FarmRole.OWNER, FarmRole.ADMIN, FarmRole.EMPLOYEE],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(
  role: FarmRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly FarmRole[]).includes(role);
}

export const ROLE_LABELS: Record<FarmRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EMPLOYEE: 'Salarié',
  VIEWER: 'Lecture seule',
  ADVISOR: 'Expert agronomique',
};

/** Rôles réellement attribuables à un membre : l'expert n'en est pas un. */
export const MEMBER_ROLES = [
  FarmRole.OWNER,
  FarmRole.ADMIN,
  FarmRole.EMPLOYEE,
  FarmRole.VIEWER,
] as const;

/** Contexte authentifié, sinon erreur 401. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw new ApiError(401, 'Authentification requise', 'UNAUTHENTICATED');
  return auth;
}

/** Contexte authentifié + e-mail vérifié. */
export async function requireVerifiedAuth(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!auth.user.emailVerified) {
    throw new ApiError(
      403,
      'Adresse e-mail non vérifiée',
      'EMAIL_NOT_VERIFIED',
    );
  }
  return auth;
}

/**
 * Mode maintenance : tout le monde est arrêté ici, sauf les administrateurs de
 * l'instance — ce sont eux qui doivent pouvoir intervenir et lever le mode.
 * Le contrôle passe par un cache de quelques secondes, il ne coûte pas une
 * requête par appel.
 */
export async function assertNotUnderMaintenance(
  auth: AuthContext,
): Promise<void> {
  if (auth.user.isPlatformAdmin) return;
  const mode = await getMaintenanceMode();
  if (mode.enabled) {
    throw new ApiError(503, mode.message, 'MAINTENANCE');
  }
}

/**
 * Administrateur de l'instance : gestion des comptes, des invitations et de la
 * maintenance.
 *
 * C'est une autorité distincte de `FarmRole.ADMIN`, qui ne vaut que dans une
 * exploitation. Un administrateur plateforme n'hérite d'aucun accès aux données
 * agronomiques : il ne voit pas les parcelles des exploitations dont il n'est
 * pas membre, seulement les comptes et les compteurs d'administration.
 */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const auth = await requireVerifiedAuth();
  if (!auth.user.isPlatformAdmin) {
    throw new ApiError(
      403,
      "Réservé aux administrateurs de l'instance",
      'FORBIDDEN',
    );
  }
  return auth;
}

/**
 * Espace de travail par défaut d'un compte.
 *
 * Un exploitant ouvre son tableau de bord ; un expert ouvre son portefeuille.
 * Ce sont deux métiers différents, et mélanger les deux écrans n'aiderait
 * personne.
 */
export function homePathFor(auth: AuthContext): string {
  return auth.user.accountType === 'AGRONOMIST' ? '/portefeuille' : '/dashboard';
}

/** Compte expert agronomique, sinon 403. */
export async function requireAgronomist(): Promise<AuthContext> {
  const auth = await requireVerifiedAuth();
  await assertNotUnderMaintenance(auth);
  if (auth.user.accountType !== 'AGRONOMIST') {
    throw new ApiError(
      403,
      'Réservé aux comptes experts agronomiques',
      'NOT_AGRONOMIST',
    );
  }
  return auth;
}

/** Compte exploitant, sinon 403. */
export async function requireFarmer(): Promise<AuthContext> {
  const auth = await requireVerifiedAuth();
  await assertNotUnderMaintenance(auth);
  if (auth.user.accountType !== 'FARMER') {
    throw new ApiError(
      403,
      "Réservé aux comptes d'exploitation",
      'NOT_FARMER',
    );
  }
  return auth;
}

export type FarmContext = AuthContext & {
  farmId: string;
  role: FarmRole;
  /** `advisory` quand l'accès vient d'une mission de conseil. */
  accessKind: 'member' | 'advisory';
};

/**
 * Résout l'exploitation ciblée et vérifie l'appartenance ET la permission.
 *
 * `farmId` explicite (paramètre de requête) ou, à défaut, exploitation active de
 * la session. Un identifiant d'exploitation dont l'utilisateur n'est pas membre
 * renvoie 404 — et non 403 — pour ne pas divulguer l'existence de la ressource.
 */
export async function requireFarmAccess(
  permission: Permission,
  explicitFarmId?: string | null,
): Promise<FarmContext> {
  const auth = await requireVerifiedAuth();
  await assertNotUnderMaintenance(auth);
  const farmId = explicitFarmId ?? auth.activeFarmId;

  if (!farmId) {
    throw new ApiError(
      404,
      'Aucune exploitation associée à ce compte',
      'NO_FARM',
    );
  }

  const membership = auth.memberships.find((m) => m.farmId === farmId);
  if (!membership) {
    throw new ApiError(404, 'Ressource introuvable', 'NOT_FOUND');
  }

  if (!roleHasPermission(membership.role, permission)) {
    throw new ApiError(
      403,
      `Votre rôle (${ROLE_LABELS[membership.role]}) ne permet pas cette action`,
      'FORBIDDEN',
    );
  }

  return { ...auth, farmId, role: membership.role, accessKind: membership.kind };
}

/**
 * Charge une parcelle en garantissant qu'elle appartient bien à une exploitation
 * de l'utilisateur. C'est le point de passage obligé de toutes les routes
 * `/api/parcels/:id/...` : modifier l'ID dans l'URL ne donne accès à rien.
 */
export async function requireParcelAccess(
  parcelId: string,
  permission: Permission,
): Promise<{ ctx: FarmContext; parcel: { id: string; farmId: string; name: string; areaHa: string } }> {
  const auth = await requireVerifiedAuth();

  const parcel = await prisma.parcel.findFirst({
    where: {
      id: parcelId,
      deletedAt: null,
      farmId: { in: auth.memberships.map((m) => m.farmId) },
    },
    select: { id: true, farmId: true, name: true, areaHa: true },
  });

  if (!parcel) throw new ApiError(404, 'Parcelle introuvable', 'NOT_FOUND');

  const ctx = await requireFarmAccess(permission, parcel.farmId);
  return {
    ctx,
    parcel: {
      id: parcel.id,
      farmId: parcel.farmId,
      name: parcel.name,
      areaHa: parcel.areaHa.toString(),
    },
  };
}
