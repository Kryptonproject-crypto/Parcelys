import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  AdminFarmRow,
  AdminUserFilter,
  AdminUserRow,
} from '@/lib/admin/shared';

/**
 * Lectures de la section d'administration.
 *
 * Volontairement limité aux comptes, aux exploitations et aux compteurs : un
 * administrateur d'instance gère l'accès au service, pas les données
 * agronomiques des exploitations dont il n'est pas membre.
 */

export type {
  AdminFarmRow,
  AdminInvitationRow,
  AdminUserFilter,
  AdminUserRow,
} from '@/lib/admin/shared';
export { USER_FILTER_LABELS } from '@/lib/admin/shared';

function userWhere(
  filter: AdminUserFilter,
  search: string,
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (filter === 'actifs') where.suspendedAt = null;
  if (filter === 'suspendus') where.suspendedAt = { not: null };
  if (filter === 'non-verifies') where.emailVerifiedAt = null;
  if (filter === 'experts') where.accountType = 'AGRONOMIST';
  if (filter === 'admins') where.isPlatformAdmin = true;

  const term = search.trim();
  if (term.length > 0) {
    where.OR = [
      { emailNormalized: { contains: term.toLowerCase() } },
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function listAdminUsers(params: {
  filter?: AdminUserFilter;
  search?: string;
  take?: number;
}): Promise<AdminUserRow[]> {
  const now = new Date();
  const users = await prisma.user.findMany({
    where: userWhere(params.filter ?? 'tous', params.search ?? ''),
    orderBy: [{ isPlatformAdmin: 'desc' }, { createdAt: 'asc' }],
    take: params.take ?? 200,
    include: {
      memberships: {
        include: { farm: { select: { id: true, name: true, deletedAt: true } } },
        orderBy: { createdAt: 'asc' },
      },
      // Le portefeuille d'un expert : ses exploitations n'apparaissent pas dans
      // `memberships`, puisqu'il n'en est membre d'aucune.
      engagements: {
        where: { status: 'ACTIVE' },
        include: { farm: { select: { id: true, name: true, deletedAt: true } } },
        orderBy: { startedAt: 'asc' },
      },
      _count: {
        select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    accountType: user.accountType,
    organization: user.organization,
    advisedFarms: user.engagements
      .filter((e) => !e.farm.deletedAt)
      .map((e) => ({ farmId: e.farm.id, farmName: e.farm.name })),
    isPlatformAdmin: user.isPlatformAdmin,
    emailVerified: user.emailVerifiedAt !== null,
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    suspendedReason: user.suspendedReason,
    lockedUntil:
      user.lockedUntil && user.lockedUntil > now
        ? user.lockedUntil.toISOString()
        : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    isDemo: user.isDemo,
    activeSessions: user._count.sessions,
    memberships: user.memberships
      .filter((m) => !m.farm.deletedAt)
      .map((m) => ({ farmId: m.farm.id, farmName: m.farm.name, role: m.role })),
  }));
}

export type AdminStats = {
  users: {
    total: number;
    active: number;
    suspended: number;
    unverified: number;
    admins: number;
    newLast30Days: number;
  };
  farms: { total: number; demo: number };
  parcels: { total: number; areaHa: number };
  sessions: { active: number };
  invitations: { active: number; used: number; expired: number; revoked: number };
  records: { fertilizations: number; phyto: number; operations: number; documents: number };
};

export async function getAdminStats(): Promise<AdminStats> {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [
    total,
    suspended,
    unverified,
    admins,
    newUsers,
    farms,
    demoFarms,
    parcelAggregate,
    activeSessions,
    invitationRows,
    fertilizations,
    phyto,
    operations,
    documents,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
    prisma.user.count({ where: { deletedAt: null, emailVerifiedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, isPlatformAdmin: true } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: monthAgo } } }),
    prisma.farm.count({ where: { deletedAt: null } }),
    prisma.farm.count({ where: { deletedAt: null, isDemo: true } }),
    prisma.parcel.aggregate({
      where: { deletedAt: null },
      _count: true,
      _sum: { areaHa: true },
    }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prisma.invitationCode.findMany({
      select: { usedAt: true, revokedAt: true, expiresAt: true },
    }),
    prisma.fertilizerApplication.count(),
    prisma.phytosanitaryApplication.count(),
    prisma.agriculturalOperation.count(),
    prisma.document.count(),
  ]);

  const invitations = { active: 0, used: 0, expired: 0, revoked: 0 };
  for (const row of invitationRows) {
    if (row.usedAt) invitations.used += 1;
    else if (row.revokedAt) invitations.revoked += 1;
    else if (row.expiresAt <= now) invitations.expired += 1;
    else invitations.active += 1;
  }

  return {
    users: {
      total,
      active: total - suspended,
      suspended,
      unverified,
      admins,
      newLast30Days: newUsers,
    },
    farms: { total: farms, demo: demoFarms },
    parcels: {
      total: parcelAggregate._count,
      areaHa: Number(parcelAggregate._sum.areaHa ?? 0),
    },
    sessions: { active: activeSessions },
    invitations,
    records: { fertilizations, phyto, operations, documents },
  };
}

export async function listAdminFarms(): Promise<AdminFarmRow[]> {
  const farms = await prisma.farm.findMany({
    // Les exploitations supprimées restent listées : une suppression logique
    // qu'on ne verrait plus ne pourrait pas être défaite.
    orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
    include: {
      _count: { select: { members: true } },
      members: {
        where: { role: 'OWNER' },
        include: { user: { select: { email: true } } },
      },
      parcels: { where: { deletedAt: null }, select: { areaHa: true } },
    },
  });

  return farms.map((farm) => ({
    id: farm.id,
    name: farm.name,
    deleted: farm.deletedAt !== null,
    city: farm.city,
    department: farm.department,
    isDemo: farm.isDemo,
    createdAt: farm.createdAt.toISOString(),
    members: farm._count.members,
    parcels: farm.parcels.length,
    areaHa: farm.parcels.reduce((sum, p) => sum + Number(p.areaHa), 0),
    owners: farm.members.map((m) => m.user.email),
  }));
}
