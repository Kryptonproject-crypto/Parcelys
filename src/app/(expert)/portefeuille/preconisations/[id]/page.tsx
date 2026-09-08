import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageAgronomist, requirePageFarmAccess } from '@/lib/auth/page-guards';
import {
  loadRecommendation,
  serializeRecommendation,
} from '@/lib/services/advisory';
import { RecommendationDetail } from '@/components/advisory/RecommendationDetail';
import { ExpertActions } from '@/app/(expert)/portefeuille/preconisations/[id]/ExpertActions';
import { PageHeader } from '@/components/ui';
import { IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Préconisation' };
export const dynamic = 'force-dynamic';

export default async function ExpertRecommendationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requirePageAgronomist();

  const row = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  ).catch(() => null);

  // L'expert ne voit que ses propres préconisations : celles d'un confrère sur
  // la même exploitation ne le regardent pas.
  if (!row || row.authorId !== auth.user.id) notFound();

  await requirePageFarmAccess('recommendation:read', row.farmId);
  const recommendation = serializeRecommendation(row);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={IconRegistry}
        title="Préconisation"
        description={recommendation.farmName}
        breadcrumb={
          <Link
            href={`/portefeuille/${recommendation.farmId}/preconisations`}
            className="hover:text-ink"
          >
            ← Préconisations de {recommendation.farmName}
          </Link>
        }
      />

      <div className="space-y-5">
        <ExpertActions recommendation={recommendation} />
        <RecommendationDetail
          recommendation={recommendation}
          farmLink={
            recommendation.parcelId
              ? {
                  parcelHref: `/portefeuille/${recommendation.farmId}/parcelles/${recommendation.parcelId}`,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
