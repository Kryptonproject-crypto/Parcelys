import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { listRecommendations } from '@/lib/services/advisory';
import { RecommendationList } from '@/components/advisory/RecommendationList';
import { LinkButton, PageHeader } from '@/components/ui';
import { IconPlus, IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Préconisations' };
export const dynamic = 'force-dynamic';

export default async function FarmRecommendationsPage({
  params,
}: {
  params: Promise<{ farmId: string }>;
}) {
  const { farmId } = await params;
  const ctx = await requirePageFarmAccess('recommendation:read', farmId);

  const [farm, recommendations] = await Promise.all([
    prisma.farm.findUniqueOrThrow({
      where: { id: ctx.farmId },
      select: { id: true, name: true },
    }),
    listRecommendations({ farmId: ctx.farmId, authorId: ctx.user.id }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={IconRegistry}
        title="Préconisations"
        description={`${recommendations.length} pour « ${farm.name} »`}
        breadcrumb={
          <Link href={`/portefeuille/${farm.id}`} className="hover:text-ink">
            ← {farm.name}
          </Link>
        }
        actions={
          <LinkButton
            href={`/portefeuille/${farm.id}/preconisations/nouvelle`}
            icon={IconPlus}
          >
            Nouvelle préconisation
          </LinkButton>
        }
      />

      <RecommendationList
        recommendations={recommendations}
        viewer="expert"
        linkBase="/portefeuille/preconisations"
        emptyLabel="Vous n'avez encore rien transmis à cette exploitation."
      />
    </div>
  );
}
