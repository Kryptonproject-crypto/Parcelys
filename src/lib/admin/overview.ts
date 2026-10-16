import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { adminRoleOf } from '@/lib/admin/roles';
import {
  engagementScope,
  farmScope,
  portfolioInScope,
  technicianScope,
  ticketScope,
  invitationScope,
  userScope,
  type AdminScope,
} from '@/lib/admin/scope';
import {
  ADMIN_PAGE_SIZE,
  type AdminExpertRow,
  type AdminFarmRow,
  type AdminPage,
  type AdminUserFilter,
  type AdminUserRow,
} from '@/lib/admin/shared';
import { lireNumero } from '@/lib/shared/numeros';

/**
 * Lectures de la section d'administration.
 *
 * Toutes prennent le **périmètre** de l'administrateur en premier argument, et
 * l'appliquent dans la requête : un administrateur secondaire ne peut ni
 * lister, ni compter, ni retrouver par recherche ce qui n'est pas dans ses
 * portefeuilles.
 *
 * Volontairement limité aux comptes, aux exploitations et aux compteurs : un
 * administrateur — général ou secondaire — gère l'accès au service, pas les
 * données agronomiques des exploitations dont il n'est pas membre.
 */

export type {
  AdminFarmRow,
  AdminInvitationRow,
  AdminUserFilter,
  AdminUserRow,
} from '@/lib/admin/shared';
export { USER_FILTER_LABELS } from '@/lib/admin/shared';

function pageOf(page: number | undefined): number {
  return Number.isFinite(page) && (page ?? 1) >= 1 ? Math.floor(page ?? 1) : 1;
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

function userWhere(
  scope: AdminScope,
  filter: AdminUserFilter,
  search: string,
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ deletedAt: null }, userScope(scope)];

  if (filter === 'actifs') and.push({ suspendedAt: null });
  if (filter === 'suspendus') and.push({ suspendedAt: { not: null } });
  if (filter === 'non-verifies') and.push({ emailVerifiedAt: null });
  if (filter === 'experts') and.push({ accountType: 'AGRONOMIST' });
  if (filter === 'admins') and.push({ OR: [{ isPlatformAdmin: true }, { isSecondaryAdmin: true }] });

  const term = search.trim();
  if (term.length > 0) {
    const numero = lireNumero(term);
    if (numero?.prefixe === 'TEC') {
      and.push({ technicianNumber: numero.numero });
    } else if (numero?.prefixe === 'EXP') {
      // Les membres de l'exploitation portant ce numéro — et seulement si elle
      // est dans le périmètre : `userScope` reste appliqué à côté.
      and.push({
        memberships: { some: { farm: { customerNumber: numero.numero, ...farmScope(scope) } } },
      });
    } else {
      and.push({
        OR: [
          { emailNormalized: { contains: term.toLowerCase() } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { organization: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return { AND: and };
}

export async function listAdminUsers(params: {
  scope: AdminScope;
  filter?: AdminUserFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminPage<AdminUserRow>> {
  const { scope } = params;
  const now = new Date();
  const page = pageOf(params.page);
  const pageSize = params.pageSize ?? ADMIN_PAGE_SIZE;
  const where = userWhere(scope, params.filter ?? 'tous', params.search ?? '');

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [
        { isPlatformAdmin: 'desc' },
        { isSecondaryAdmin: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        memberships: {
          where: { farm: { deletedAt: null, ...farmScope(scope) } },
          include: {
            farm: { select: { id: true, name: true, customerNumber: true, portfolioId: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        // Le portefeuille d'un expert : ses exploitations n'apparaissent pas
        // dans `memberships`, puisqu'il n'en est membre d'aucune.
        engagements: {
          where: { status: 'ACTIVE', farm: { deletedAt: null, ...farmScope(scope) } },
          include: { farm: { select: { id: true, name: true, customerNumber: true } } },
          orderBy: { startedAt: 'asc' },
        },
        portfolio: { select: { name: true } },
        _count: {
          select: {
            sessions: { where: { revokedAt: null, expiresAt: { gt: now } } },
            // Rattachements hors périmètre, comptés sans être montrés : ils
            // décident seulement si l'on peut agir sur le compte.
            memberships: scope.all
              ? undefined
              : {
                  where: {
                    farm: {
                      deletedAt: null,
                      OR: [
                        { portfolioId: null },
                        { portfolioId: { notIn: scope.portfolioIds } },
                      ],
                    },
                  },
                },
          },
        },
      },
    }),
  ]);

  const rows = users.map((user): AdminUserRow => {
    const adminRole = adminRoleOf(user);
    const horsPerimetre =
      !scope.all &&
      (((user._count as { memberships?: number }).memberships ?? 0) > 0 ||
        (user.accountType === 'AGRONOMIST' && !portfolioInScope(scope, user.portfolioId)));

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      technicianNumber: user.technicianNumber,
      adminRole,
      portfolioName: user.portfolio?.name ?? null,
      manageable: scope.all || (adminRole === null && !horsPerimetre),
      accountType: user.accountType,
      organization: user.organization,
      advisedFarms: user.engagements.map((e) => ({
        farmId: e.farm.id,
        farmName: e.farm.name,
        customerNumber: e.farm.customerNumber,
      })),
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerified: user.emailVerifiedAt !== null,
      suspendedAt: user.suspendedAt?.toISOString() ?? null,
      suspendedReason: user.suspendedReason,
      lockedUntil:
        user.lockedUntil && user.lockedUntil > now ? user.lockedUntil.toISOString() : null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      isDemo: user.isDemo,
      activeSessions: user._count.sessions,
      memberships: user.memberships.map((m) => ({
        farmId: m.farm.id,
        farmName: m.farm.name,
        role: m.role,
        customerNumber: m.farm.customerNumber,
      })),
    };
  });

  return { rows, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

export type AdminStats = {
  users: {
    total: number;
    active: number;
    suspended: number;
    unverified: number;
    admins: number;
    newLast30Days: number;
  };
  farms: { total: number; demo: number; unassigned: number };
  technicians: { total: number; unassigned: number };
  parcels: { total: number; areaHa: number };
  sessions: { active: number };
  invitations: { active: number; used: number; expired: number; revoked: number };
  records: { fertilizations: number; phyto: number; operations: number; documents: number };
  support: { open: number; new: number; waiting: number; resolved: number };
  portfolios: number;
};

/**
 * Chiffres du tableau de bord, bornés au périmètre.
 *
 * Pour un administrateur secondaire, chaque compteur passe par le même filtre
 * que les listes : il ne peut pas déduire de ses chiffres l'existence de ce
 * qu'il ne voit pas. Les comptes administrateurs et les portefeuilles des
 * autres ne sont pas comptés du tout.
 */
export async function getAdminStats(scope: AdminScope): Promise<AdminStats> {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const users = { deletedAt: null, ...userScope(scope) } satisfies Prisma.UserWhereInput;
  const farms = { deletedAt: null, ...farmScope(scope) } satisfies Prisma.FarmWhereInput;
  const parcelsOfScope: Prisma.ParcelWhereInput = { deletedAt: null, farm: farms };
  const recordsOfScope = { parcel: { farm: farms } };

  const [
    total,
    suspended,
    unverified,
    admins,
    newUsers,
    farmCount,
    demoFarms,
    unassignedFarms,
    technicians,
    unassignedTechnicians,
    parcelAggregate,
    activeSessions,
    invitationRows,
    fertilizations,
    phyto,
    operations,
    documents,
    tickets,
    portfolios,
  ] = await Promise.all([
    prisma.user.count({ where: users }),
    prisma.user.count({ where: { ...users, suspendedAt: { not: null } } }),
    prisma.user.count({ where: { ...users, emailVerifiedAt: null } }),
    scope.all
      ? prisma.user.count({
          where: { deletedAt: null, OR: [{ isPlatformAdmin: true }, { isSecondaryAdmin: true }] },
        })
      : Promise.resolve(0),
    prisma.user.count({ where: { ...users, createdAt: { gte: monthAgo } } }),
    prisma.farm.count({ where: farms }),
    prisma.farm.count({ where: { ...farms, isDemo: true } }),
    scope.all ? prisma.farm.count({ where: { deletedAt: null, portfolioId: null } }) : Promise.resolve(0),
    prisma.user.count({ where: { deletedAt: null, ...technicianScope(scope) } }),
    scope.all
      ? prisma.user.count({ where: { deletedAt: null, accountType: 'AGRONOMIST', portfolioId: null } })
      : Promise.resolve(0),
    prisma.parcel.aggregate({ where: parcelsOfScope, _count: true, _sum: { areaHa: true } }),
    prisma.session.count({
      where: { revokedAt: null, expiresAt: { gt: now }, user: users },
    }),
    prisma.invitationCode.findMany({
      where: invitationScope(scope),
      select: { usedAt: true, revokedAt: true, expiresAt: true },
    }),
    prisma.fertilizerApplication.count({ where: recordsOfScope }),
    prisma.phytosanitaryApplication.count({ where: recordsOfScope }),
    prisma.agriculturalOperation.count({ where: recordsOfScope }),
    prisma.document.count({ where: { farm: farms } }),
    prisma.supportTicket.groupBy({
      by: ['status'],
      where: ticketScope(scope),
      _count: { _all: true },
    }),
    scope.all ? prisma.managementPortfolio.count() : Promise.resolve(scope.portfolioIds.length),
  ]);

  const invitations = { active: 0, used: 0, expired: 0, revoked: 0 };
  for (const row of invitationRows) {
    if (row.usedAt) invitations.used += 1;
    else if (row.revokedAt) invitations.revoked += 1;
    else if (row.expiresAt <= now) invitations.expired += 1;
    else invitations.active += 1;
  }

  const parStatut = new Map(tickets.map((t) => [t.status, t._count._all]));
  const support = {
    new: parStatut.get('NEW') ?? 0,
    open: (parStatut.get('NEW') ?? 0) + (parStatut.get('IN_PROGRESS') ?? 0),
    waiting: parStatut.get('WAITING_CUSTOMER') ?? 0,
    resolved: parStatut.get('RESOLVED') ?? 0,
  };

  return {
    users: {
      total,
      active: total - suspended,
      suspended,
      unverified,
      admins,
      newLast30Days: newUsers,
    },
    farms: { total: farmCount, demo: demoFarms, unassigned: unassignedFarms },
    technicians: { total: technicians, unassigned: unassignedTechnicians },
    parcels: {
      total: parcelAggregate._count,
      areaHa: Number(parcelAggregate._sum.areaHa ?? 0),
    },
    sessions: { active: activeSessions },
    invitations,
    records: { fertilizations, phyto, operations, documents },
    support,
    portfolios,
  };
}

// ---------------------------------------------------------------------------
// Exploitations
// ---------------------------------------------------------------------------

export type AdminFarmFilter = 'toutes' | 'actives' | 'supprimees' | 'sans-portefeuille';

export const FARM_FILTER_LABELS: Record<AdminFarmFilter, string> = {
  toutes: 'Toutes',
  actives: 'Actives',
  supprimees: 'Supprimées',
  'sans-portefeuille': 'Sans portefeuille',
};

function farmWhere(
  scope: AdminScope,
  filter: AdminFarmFilter,
  search: string,
  portfolioId?: string | null,
): Prisma.FarmWhereInput {
  const and: Prisma.FarmWhereInput[] = [farmScope(scope)];
  if (filter === 'actives') and.push({ deletedAt: null });
  if (filter === 'supprimees') and.push({ deletedAt: { not: null } });
  if (filter === 'sans-portefeuille') and.push({ portfolioId: null, deletedAt: null });
  if (portfolioId) and.push({ portfolioId });

  const term = search.trim();
  if (term.length > 0) {
    const numero = lireNumero(term);
    if (numero?.prefixe === 'EXP') {
      and.push({ customerNumber: numero.numero });
    } else {
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { city: { contains: term, mode: 'insensitive' } },
          { customerNumber: { contains: term.toUpperCase() } },
          {
            members: {
              some: {
                role: 'OWNER',
                user: { emailNormalized: { contains: term.toLowerCase() } },
              },
            },
          },
        ],
      });
    }
  }
  return { AND: and };
}

export async function listAdminFarms(params: {
  scope: AdminScope;
  filter?: AdminFarmFilter;
  search?: string;
  portfolioId?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<AdminPage<AdminFarmRow>> {
  const { scope } = params;
  const page = pageOf(params.page);
  const pageSize = params.pageSize ?? ADMIN_PAGE_SIZE;
  const where = farmWhere(scope, params.filter ?? 'toutes', params.search ?? '', params.portfolioId);

  const [total, farms] = await Promise.all([
    prisma.farm.count({ where }),
    prisma.farm.findMany({
      // Les exploitations supprimées restent listées pour le général : une
      // suppression logique qu'on ne verrait plus ne pourrait pas être défaite.
      where,
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { members: true } },
        members: {
          where: { role: 'OWNER' },
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
        portfolio: { select: { name: true } },
      },
    }),
  ]);

  const ids = farms.map((f) => f.id);
  // Surfaces, parcelles et registres, comptés par la base pour la page
  // affichée seulement — et non en chargeant toutes les parcelles.
  const [surfaces, registres] = ids.length
    ? await Promise.all([
        prisma.parcel.groupBy({
          by: ['farmId'],
          where: { farmId: { in: ids }, deletedAt: null },
          _count: { _all: true },
          _sum: { areaHa: true },
        }),
        // Le décompte du registre phytosanitaire : c'est le nombre que l'écran
        // d'effacement définitif affiche avant de détruire.
        prisma.$queryRaw<Array<{ farm_id: string; n: bigint }>>`
          SELECT p.farm_id, count(*)::bigint AS n
          FROM phytosanitary_applications a
          JOIN parcels p ON p.id = a.parcel_id
          WHERE p.farm_id IN (${Prisma.join(ids)})
          GROUP BY p.farm_id
        `,
      ])
    : [[], []];
  const surfaceParFerme = new Map(surfaces.map((s) => [s.farmId, s]));
  const phytoParFerme = new Map(registres.map((r) => [r.farm_id, Number(r.n)]));

  const rows = farms.map((farm): AdminFarmRow => {
    const surface = surfaceParFerme.get(farm.id);
    return {
      id: farm.id,
      name: farm.name,
      customerNumber: farm.customerNumber,
      portfolioId: farm.portfolioId,
      portfolioName: farm.portfolio?.name ?? null,
      deleted: farm.deletedAt !== null,
      city: farm.city,
      department: farm.department,
      isDemo: farm.isDemo,
      createdAt: farm.createdAt.toISOString(),
      members: farm._count.members,
      parcels: surface?._count._all ?? 0,
      phytoRecords: phytoParFerme.get(farm.id) ?? 0,
      areaHa: Number(surface?._sum.areaHa ?? 0),
      owners: farm.members.map((m) => m.user.email),
      ownerAccounts: farm.members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: `${m.user.firstName} ${m.user.lastName}`,
      })),
      siret: farm.siret,
      deletedAt: farm.deletedAt?.toISOString() ?? null,
    };
  });

  return { rows, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Techniciens (experts agronomiques)
// ---------------------------------------------------------------------------

export async function listAdminTechnicians(params: {
  scope: AdminScope;
  search?: string;
  portfolioId?: string | null;
  sansPortefeuille?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AdminPage<AdminExpertRow>> {
  const { scope } = params;
  const page = pageOf(params.page);
  const pageSize = params.pageSize ?? ADMIN_PAGE_SIZE;

  const and: Prisma.UserWhereInput[] = [{ deletedAt: null }, technicianScope(scope)];
  if (params.portfolioId) and.push({ portfolioId: params.portfolioId });
  if (params.sansPortefeuille) and.push({ portfolioId: null });
  const term = params.search?.trim() ?? '';
  if (term) {
    const numero = lireNumero(term);
    if (numero?.prefixe === 'TEC') {
      and.push({ technicianNumber: numero.numero });
    } else {
      and.push({
        OR: [
          { emailNormalized: { contains: term.toLowerCase() } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { organization: { contains: term, mode: 'insensitive' } },
          { technicianNumber: { contains: term.toUpperCase() } },
        ],
      });
    }
  }
  const where: Prisma.UserWhereInput = { AND: and };

  const [total, experts] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { email: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        technicianNumber: true,
        portfolioId: true,
        portfolio: { select: { name: true } },
        organization: true,
        advisorCertificate: true,
        suspendedAt: true,
        emailVerifiedAt: true,
        createdAt: true,
        engagements: {
          // Les missions sur une exploitation hors périmètre ne sont ni
          // montrées ni comptées.
          where: engagementScope(scope),
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            farm: { select: { id: true, name: true, customerNumber: true } },
          },
        },
      },
    }),
  ]);

  const rows = experts.map(
    (expert): AdminExpertRow => ({
      id: expert.id,
      email: expert.email,
      firstName: expert.firstName,
      lastName: expert.lastName,
      technicianNumber: expert.technicianNumber,
      portfolioId: expert.portfolioId,
      portfolioName: expert.portfolio?.name ?? null,
      organization: expert.organization,
      advisorCertificate: expert.advisorCertificate,
      suspended: expert.suspendedAt !== null,
      emailVerified: expert.emailVerifiedAt !== null,
      createdAt: expert.createdAt.toISOString(),
      engagements: expert.engagements.map((engagement) => ({
        id: engagement.id,
        farmId: engagement.farm.id,
        farmName: engagement.farm.name,
        customerNumber: engagement.farm.customerNumber,
        status: engagement.status,
        startedAt: engagement.startedAt.toISOString(),
        endedAt: engagement.endedAt?.toISOString() ?? null,
      })),
    }),
  );

  return { rows, total, page, pageSize };
}

/** Exploitations proposables dans un sélecteur, bornées au périmètre. */
export async function listFarmOptions(scope: AdminScope) {
  return prisma.farm.findMany({
    where: { deletedAt: null, ...farmScope(scope) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, customerNumber: true },
  });
}

/** Portefeuilles proposables : tous pour le général, les siens pour le secondaire. */
export async function listPortfolioOptions(scope: AdminScope) {
  if (!scope.all) return scope.portfolios;
  return prisma.managementPortfolio.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
