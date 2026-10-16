import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, notFound } from '@/lib/api/errors';
import { assertNotUnderMaintenance, requireVerifiedAuth } from '@/lib/auth/rbac';
import type { AuthContext } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';
import {
  ADMIN_ROLE_LABELS,
  adminCan,
  adminRoleOf,
  type AdminPermission,
  type AdminRole,
} from '@/lib/admin/roles';

/**
 * Périmètre d'un administrateur, résolu côté serveur à chaque requête.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le périmètre se lit dans la base, depuis la session — jamais depuis la
 * requête. Un identifiant d'exploitation, un numéro client, un portefeuille
 * envoyés par le navigateur ne font que **désigner** ; c'est le filtre
 * ci-dessous qui décide si la chose désignée est visible.
 *
 * Hors périmètre, une ressource est **introuvable** (404), exactement comme
 * une ressource qui n'existe pas : répondre 403 dirait à un curieux lesquels
 * de ses identifiants tombent juste. Le 403 est réservé aux fonctions qu'un
 * rôle n'a pas du tout (maintenance, journal…), dont l'existence n'a rien de
 * secret.
 *
 * Les filtres s'appliquent dans la requête SQL elle-même (`where`), et non
 * après coup sur une liste chargée : un compteur, une recherche ou un export
 * ne peuvent pas compter ce qu'ils ne lisent pas.
 */

export type AdminScope = {
  role: AdminRole;
  userId: string;
  /** `true` pour l'administrateur général : aucun filtre. */
  all: boolean;
  /** Portefeuilles gérés (vide pour le général, qui les voit tous). */
  portfolioIds: string[];
  portfolios: Array<{ id: string; name: string }>;
};

export type AdminContext = AuthContext & { scope: AdminScope };

async function loadScope(userId: string, role: AdminRole): Promise<AdminScope> {
  if (role === 'GENERAL') {
    return { role, userId, all: true, portfolioIds: [], portfolios: [] };
  }
  const rows = await prisma.portfolioManager.findMany({
    where: { userId },
    select: { portfolio: { select: { id: true, name: true } } },
    orderBy: { portfolio: { name: 'asc' } },
  });
  const portfolios = rows.map((r) => r.portfolio);
  return {
    role,
    userId,
    all: false,
    portfolioIds: portfolios.map((p) => p.id),
    portfolios,
  };
}

/**
 * Administrateur (général ou secondaire) disposant de `permission`.
 *
 *   · pas de session              → 401
 *   · pas administrateur          → 403
 *   · rôle sans cette permission  → 403, et la tentative est journalisée
 *   · maintenance en cours        → 503 pour le secondaire (le général passe,
 *                                   c'est lui qui la lève)
 */
export async function requireAdmin(permission: AdminPermission): Promise<AdminContext> {
  const auth = await requireVerifiedAuth();
  const role = adminRoleOf(auth.user);
  if (!role) {
    throw new ApiError(403, "Réservé aux administrateurs de l'instance", 'FORBIDDEN');
  }
  await assertNotUnderMaintenance(auth);

  if (!adminCan(role, permission)) {
    await logAudit({
      action: 'access.denied',
      userId: auth.user.id,
      metadata: { permission, role },
    });
    throw new ApiError(
      403,
      `Réservé à l'administrateur général (vous êtes ${ADMIN_ROLE_LABELS[role].toLowerCase()}).`,
      'ADMIN_GENERAL_ONLY',
    );
  }

  return { ...auth, scope: await loadScope(auth.user.id, role) };
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

/**
 * Exploitations visibles. Le secondaire ne voit pas les exploitations
 * supprimées : les rétablir est un geste de l'administrateur général.
 */
export function farmScope(scope: AdminScope): Prisma.FarmWhereInput {
  if (scope.all) return {};
  return { portfolioId: { in: scope.portfolioIds }, deletedAt: null };
}

/** Techniciens (comptes experts agronomiques) visibles. */
export function technicianScope(scope: AdminScope): Prisma.UserWhereInput {
  if (scope.all) return { accountType: 'AGRONOMIST' };
  return { accountType: 'AGRONOMIST', portfolioId: { in: scope.portfolioIds } };
}

/**
 * Comptes visibles : membres d'une exploitation du périmètre, ou techniciens
 * du périmètre. Jamais un compte administrateur pour le secondaire — ni le
 * sien, ni celui d'un autre.
 */
export function userScope(scope: AdminScope): Prisma.UserWhereInput {
  if (scope.all) return {};
  return {
    isPlatformAdmin: false,
    isSecondaryAdmin: false,
    OR: [
      {
        memberships: {
          some: { farm: { portfolioId: { in: scope.portfolioIds }, deletedAt: null } },
        },
      },
      { accountType: 'AGRONOMIST', portfolioId: { in: scope.portfolioIds } },
    ],
  };
}

/** Appartenances affichées : celles du périmètre seulement. */
export function membershipScope(scope: AdminScope): Prisma.FarmMemberWhereInput {
  if (scope.all) return {};
  return { farm: { portfolioId: { in: scope.portfolioIds }, deletedAt: null } };
}

/** Missions de conseil affichées : celles qui portent sur une exploitation du périmètre. */
export function engagementScope(scope: AdminScope): Prisma.AdvisoryEngagementWhereInput {
  if (scope.all) return {};
  return { farm: { portfolioId: { in: scope.portfolioIds }, deletedAt: null } };
}

export function ticketScope(scope: AdminScope): Prisma.SupportTicketWhereInput {
  if (scope.all) return {};
  return { portfolioId: { in: scope.portfolioIds } };
}

export function invitationScope(scope: AdminScope): Prisma.InvitationCodeWhereInput {
  if (scope.all) return {};
  return { portfolioId: { in: scope.portfolioIds } };
}

/** Le portefeuille est-il dans le périmètre ? (le général : tous) */
export function portfolioInScope(scope: AdminScope, portfolioId: string | null | undefined): boolean {
  if (scope.all) return true;
  return portfolioId != null && scope.portfolioIds.includes(portfolioId);
}

// ---------------------------------------------------------------------------
// Chargements bornés : 404 hors périmètre
// ---------------------------------------------------------------------------

export async function loadFarmInScope(scope: AdminScope, farmId: string) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, ...farmScope(scope) },
    select: {
      id: true,
      name: true,
      customerNumber: true,
      portfolioId: true,
      deletedAt: true,
    },
  });
  if (!farm) throw notFound('Exploitation introuvable');
  return farm;
}

export async function loadTechnicianInScope(scope: AdminScope, userId: string) {
  const technician = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, ...technicianScope(scope) },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      technicianNumber: true,
      portfolioId: true,
      suspendedAt: true,
    },
  });
  if (!technician) throw notFound('Technicien introuvable');
  return technician;
}

/**
 * Un compte sur lequel cet administrateur peut **agir** (suspendre,
 * déverrouiller…).
 *
 * Voir un compte ne suffit pas à pouvoir agir dessus : un exploitant membre
 * d'une exploitation du périmètre **et** d'une autre, hors périmètre, serait
 * suspendu pour les deux. Le secondaire n'agit donc que sur un compte dont
 * tous les rattachements sont chez lui. Le refus reste peu bavard : il ne dit
 * pas où est l'autre rattachement.
 */
export async function loadManageableUser(scope: AdminScope, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...userScope(scope) },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isPlatformAdmin: true,
      isSecondaryAdmin: true,
      accountType: true,
      portfolioId: true,
      suspendedAt: true,
      deletedAt: true,
      memberships: {
        where: { farm: { deletedAt: null } },
        select: { farm: { select: { portfolioId: true } } },
      },
    },
  });
  if (!user) throw notFound('Compte introuvable');

  if (!scope.all) {
    const horsPerimetre =
      user.memberships.some((m) => !portfolioInScope(scope, m.farm.portfolioId)) ||
      (user.accountType === 'AGRONOMIST' && !portfolioInScope(scope, user.portfolioId));
    if (horsPerimetre) {
      throw new ApiError(
        403,
        "Ce compte est rattaché ailleurs que dans votre portefeuille : l'action est réservée à l'administrateur général.",
        'ADMIN_GENERAL_ONLY',
      );
    }
  }
  return user;
}
