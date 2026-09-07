import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { ExportBuilder } from '@/app/(app)/exports/ExportBuilder';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Exportations' };
export const dynamic = 'force-dynamic';

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string; year?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('export:read');

  const parcels = await prisma.parcel.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    select: { id: true, name: true, internalNumber: true },
    orderBy: { name: 'asc' },
  });

  const years = Array.from({ length: 10 }, (_, i) => currentCampaignYear() + 1 - i);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Exportations"
        description="Générez vos registres au format PDF, Excel ou CSV, filtrés par campagne et par parcelle."
      />

      <ExportBuilder
        parcels={parcels}
        years={years}
        defaultYear={Number(params.year) || currentCampaignYear()}
        defaultDataset={params.dataset}
      />
    </div>
  );
}
