import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import { RecommendationForm } from '@/components/advisory/RecommendationForm';
import { PageHeader } from '@/components/ui';
import { IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Nouvelle préconisation' };
export const dynamic = 'force-dynamic';

export default async function NewRecommendationPage({
  params,
}: {
  params: Promise<{ farmId: string }>;
}) {
  const { farmId } = await params;
  const ctx = await requirePageFarmAccess('recommendation:write', farmId);

  const [farm, parcels, ephy] = await Promise.all([
    prisma.farm.findUniqueOrThrow({
      where: { id: ctx.farmId },
      select: { id: true, name: true },
    }),
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null },
      select: { id: true, name: true, areaHa: true },
      orderBy: { name: 'asc' },
    }),
    getEphySourceInfo(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={IconRegistry}
        title="Nouvelle préconisation"
        description={`Pour « ${farm.name} »`}
        breadcrumb={
          <Link href={`/portefeuille/${farm.id}`} className="hover:text-ink">
            ← {farm.name}
          </Link>
        }
      />

      <RecommendationForm
        farmId={farm.id}
        parcels={parcels.map((parcel) => ({
          id: parcel.id,
          name: parcel.name,
          areaHa: Number(parcel.areaHa),
        }))}
        doseUnits={DOSE_UNITS}
        ephyConfigured={ephy.configured}
      />
    </div>
  );
}
