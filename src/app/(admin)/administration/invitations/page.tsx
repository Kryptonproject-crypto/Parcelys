import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import { invitationScope } from '@/lib/admin/scope';
import { listFarmOptions, listPortfolioOptions } from '@/lib/admin/overview';
import type { AdminInvitationRow } from '@/lib/admin/shared';
import { InvitationsPanel } from '@/app/(admin)/administration/invitations/InvitationsPanel';
import { PageHeader } from '@/components/ui';
import { IconInvitation } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Invitations — Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminInvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ exploitation?: string }>;
}) {
  const { scope } = await requirePageAdminScope('invitations:read');
  const { exploitation } = await searchParams;

  const [invitations, farms, portfolios] = await Promise.all([
    prisma.invitationCode.findMany({
      where: invitationScope(scope),
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        farm: { select: { id: true, name: true } },
        portfolio: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        usedBy: { select: { email: true } },
      },
    }),
    listFarmOptions(scope),
    listPortfolioOptions(scope),
  ]);

  const rows: AdminInvitationRow[] = invitations.map((invitation) => ({
    id: invitation.id,
    codeHint: invitation.codeHint,
    accountType: invitation.accountType,
    grantsSecondaryAdmin: invitation.grantsSecondaryAdmin,
    portfolioName: invitation.portfolio?.name ?? null,
    status: invitationStatus(invitation),
    email: invitation.email,
    farmId: invitation.farmId,
    farmName: invitation.farm?.name ?? null,
    role: invitation.role,
    grantsPlatformAdmin: invitation.grantsPlatformAdmin,
    note: invitation.note,
    expiresAt: invitation.expiresAt.toISOString(),
    usedAt: invitation.usedAt?.toISOString() ?? null,
    usedByEmail: invitation.usedBy?.email ?? null,
    createdAt: invitation.createdAt.toISOString(),
    createdBy: `${invitation.createdBy.firstName} ${invitation.createdBy.lastName}`,
  }));

  return (
    <>
      <PageHeader
        icon={IconInvitation}
        title="Invitations"
        description={
          scope.all
            ? "L'inscription publique est fermée : un compte ne peut être créé qu'avec un code délivré ici."
            : 'Vous délivrez des codes pour les exploitations et techniciens de vos portefeuilles.'
        }
      />

      <InvitationsPanel
        invitations={rows}
        farms={farms}
        portfolios={portfolios}
        general={scope.all}
        initialFarmId={farms.some((f) => f.id === exploitation) ? (exploitation ?? '') : ''}
      />
    </>
  );
}
