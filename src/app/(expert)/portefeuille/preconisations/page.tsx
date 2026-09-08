import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageAgronomist } from '@/lib/auth/page-guards';
import { listRecommendations } from '@/lib/services/advisory';
import { RecommendationList } from '@/components/advisory/RecommendationList';
import { PageHeader, StatCard, cn } from '@/components/ui';
import { IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Mes préconisations' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'tous', label: 'Toutes', statuses: undefined },
  { key: 'attente', label: 'En attente', statuses: ['PROPOSED'] as const },
  { key: 'acceptees', label: 'Acceptées', statuses: ['ACCEPTED'] as const },
  { key: 'realisees', label: 'Réalisées', statuses: ['APPLIED'] as const },
  { key: 'ecartees', label: 'Écartées', statuses: ['DECLINED', 'WITHDRAWN'] as const },
  { key: 'brouillons', label: 'Brouillons', statuses: ['DRAFT'] as const },
] as const;

/**
 * Toutes les préconisations de l'expert, portefeuille confondu.
 *
 * C'est son écran de suivi : ce qui attend une réponse, ce qui a été retenu, ce
 * qui a effectivement été réalisé.
 */
export default async function AllRecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const auth = await requirePageAgronomist();
  const params = await searchParams;

  const filter =
    FILTERS.find((entry) => entry.key === params.statut) ?? FILTERS[0];

  const [all, filtered] = await Promise.all([
    listRecommendations({ authorId: auth.user.id, take: 500 }),
    listRecommendations({
      authorId: auth.user.id,
      ...(filter.statuses ? { status: [...filter.statuses] } : {}),
      take: 300,
    }),
  ]);

  const count = (status: string): number =>
    all.filter((item) => item.status === status).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={IconRegistry}
        title="Mes préconisations"
        description={`${all.length} au total, sur l'ensemble de votre portefeuille`}
      />

      <section aria-label="Suivi" className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="En attente de réponse"
          value={count('PROPOSED')}
          hint="Transmises, sans décision"
          accent
        />
        <StatCard label="Acceptées" value={count('ACCEPTED')} hint="À réaliser" />
        <StatCard
          label="Réalisées"
          value={count('APPLIED')}
          hint="Rattachées à une intervention"
        />
      </section>

      <nav aria-label="Filtrer" className="mb-4">
        <ul className="flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <li key={entry.key}>
              <Link
                href={
                  entry.key === 'tous'
                    ? '/portefeuille/preconisations'
                    : `/portefeuille/preconisations?statut=${entry.key}`
                }
                aria-current={entry.key === filter.key ? 'page' : undefined}
                className={cn(
                  'inline-flex rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  entry.key === filter.key
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <RecommendationList
        recommendations={filtered}
        viewer="expert"
        linkBase="/portefeuille/preconisations"
        emptyLabel="Aucune préconisation ne correspond à ce filtre."
      />
    </div>
  );
}
