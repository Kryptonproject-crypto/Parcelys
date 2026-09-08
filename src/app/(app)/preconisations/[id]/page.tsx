import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getAuthContext } from '@/lib/auth/session';
import { roleHasPermission } from '@/lib/auth/rbac';
import {
  loadRecommendation,
  serializeRecommendation,
} from '@/lib/services/advisory';
import { RecommendationDetail } from '@/components/advisory/RecommendationDetail';
import { FarmerActions } from '@/app/(app)/preconisations/[id]/FarmerActions';
import { PageHeader } from '@/components/ui';
import { IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Préconisation' };
export const dynamic = 'force-dynamic';

export default async function FarmRecommendationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) notFound();

  const row = await loadRecommendation(
    id,
    auth.memberships.map((m) => m.farmId),
  ).catch(() => null);

  // Un brouillon n'a jamais été transmis : il n'existe pas pour l'exploitation.
  if (!row || row.status === 'DRAFT') notFound();

  const ctx = await requirePageFarmAccess('recommendation:read', row.farmId);
  const recommendation = serializeRecommendation(row);
  const canRespond = roleHasPermission(ctx.role, 'recommendation:respond');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={IconRegistry}
        title="Préconisation"
        description={`${recommendation.author.name}${
          recommendation.author.organization
            ? ` · ${recommendation.author.organization}`
            : ''
        }`}
        breadcrumb={
          <Link href="/preconisations" className="hover:text-ink">
            ← Préconisations
          </Link>
        }
      />

      <div className="space-y-5">
        <FarmerActions recommendation={recommendation} canRespond={canRespond} />
        <RecommendationDetail
          recommendation={recommendation}
          farmLink={
            recommendation.parcelId
              ? { parcelHref: `/parcelles/${recommendation.parcelId}` }
              : null
          }
        />
      </div>
    </div>
  );
}
