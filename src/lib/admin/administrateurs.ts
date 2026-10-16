import 'server-only';
import { prisma } from '@/lib/prisma';
import { invitationStatus } from '@/lib/auth/invitations.shared';

/**
 * Les administrateurs de l'instance, vus par l'administrateur général.
 *
 * Trois groupes : les généraux, les secondaires (avec leurs portefeuilles),
 * et les comptes d'administration restés sans rôle — un secondaire révoqué,
 * par exemple — qu'on peut nommer à nouveau.
 */

export type AdminAccount = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  suspended: boolean;
  suspendedReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  portfolios: Array<{ id: string; name: string }>;
};

export type PendingAdminInvitation = {
  id: string;
  codeHint: string;
  email: string | null;
  portfolioName: string | null;
  expiresAt: string;
};

export async function listAdministrators(): Promise<{
  general: AdminAccount[];
  secondary: AdminAccount[];
  withoutRole: AdminAccount[];
  pending: PendingAdminInvitation[];
}> {
  const select = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    suspendedAt: true,
    suspendedReason: true,
    lastLoginAt: true,
    createdAt: true,
    managedPortfolios: {
      orderBy: { portfolio: { name: 'asc' } },
      select: { portfolio: { select: { id: true, name: true } } },
    },
  } as const;

  const [general, secondary, withoutRole, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isPlatformAdmin: true },
      orderBy: { createdAt: 'asc' },
      select,
    }),
    prisma.user.findMany({
      where: { deletedAt: null, isSecondaryAdmin: true },
      orderBy: [{ lastName: 'asc' }, { email: 'asc' }],
      select,
    }),
    prisma.user.findMany({
      where: {
        deletedAt: null,
        accountType: 'ADMIN',
        isPlatformAdmin: false,
        isSecondaryAdmin: false,
      },
      orderBy: { createdAt: 'asc' },
      select,
    }),
    prisma.invitationCode.findMany({
      where: { grantsSecondaryAdmin: true, usedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { portfolio: { select: { name: true } } },
    }),
  ]);

  const map = (u: (typeof general)[number]): AdminAccount => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    suspended: u.suspendedAt !== null,
    suspendedReason: u.suspendedReason,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    portfolios: u.managedPortfolios.map((m) => m.portfolio),
  });

  return {
    general: general.map(map),
    secondary: secondary.map(map),
    withoutRole: withoutRole.map(map),
    pending: invitations
      .filter((i) => invitationStatus(i) === 'ACTIVE')
      .map((i) => ({
        id: i.id,
        codeHint: i.codeHint,
        email: i.email,
        portfolioName: i.portfolio?.name ?? null,
        expiresAt: i.expiresAt.toISOString(),
      })),
  };
}
