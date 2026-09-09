import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import type { AdminExpertRow, AdminFarmOption } from '@/lib/admin/shared';
import { ExpertsPanel } from '@/app/(admin)/administration/experts/ExpertsPanel';
import { PageHeader } from '@/components/ui';
import { IconUsers } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Experts — Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminExpertsPage() {
  await requirePageAdmin();

  const [experts, farms] = await Promise.all([
    prisma.user.findMany({
      where: { accountType: 'AGRONOMIST', deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organization: true,
        advisorCertificate: true,
        suspendedAt: true,
        emailVerifiedAt: true,
        createdAt: true,
        engagements: {
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            farm: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.farm.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows: AdminExpertRow[] = experts.map((expert) => ({
    id: expert.id,
    email: expert.email,
    firstName: expert.firstName,
    lastName: expert.lastName,
    organization: expert.organization,
    advisorCertificate: expert.advisorCertificate,
    suspended: expert.suspendedAt !== null,
    emailVerified: expert.emailVerifiedAt !== null,
    createdAt: expert.createdAt.toISOString(),
    engagements: expert.engagements.map((engagement) => ({
      id: engagement.id,
      farmId: engagement.farm.id,
      farmName: engagement.farm.name,
      status: engagement.status,
      startedAt: engagement.startedAt.toISOString(),
      endedAt: engagement.endedAt?.toISOString() ?? null,
    })),
  }));

  const farmOptions: AdminFarmOption[] = farms;

  return (
    <>
      <PageHeader
        icon={IconUsers}
        title="Experts agronomiques"
        description="Qui suit quelle exploitation, et comment ouvrir ou retirer un accès."
      />
      <ExpertsPanel experts={rows} farms={farmOptions} />
    </>
  );
}
