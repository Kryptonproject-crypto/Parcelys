import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import type { AdminInvitationRow } from '@/lib/admin/shared';
import { InvitationsPanel } from '@/app/(admin)/administration/invitations/InvitationsPanel';
import { PageHeader } from '@/components/ui';
import { IconInvitation } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Invitations — Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminInvitationsPage() {
  await requirePageAdmin();

  const [invitations, farms] = await Promise.all([
    prisma.invitationCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        farm: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        usedBy: { select: { email: true } },
      },
    }),
    prisma.farm.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows: AdminInvitationRow[] = invitations.map((invitation) => ({
    id: invitation.id,
    codeHint: invitation.codeHint,
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
        description="L'inscription publique est fermée : un compte ne peut être créé qu'avec un code délivré ici."
      />

      <InvitationsPanel invitations={rows} farms={farms} />
    </>
  );
}
