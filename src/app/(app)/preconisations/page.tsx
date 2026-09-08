import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { prisma } from '@/lib/prisma';
import { listRecommendations } from '@/lib/services/advisory';
import { RecommendationList } from '@/components/advisory/RecommendationList';
import { Alert, EmptyState, PageHeader, StatCard, cn } from '@/components/ui';
import { IconRegistry, IconSecurity } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Préconisations' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'attente', label: 'En attente', statuses: ['PROPOSED'] as const },
  { key: 'acceptees', label: 'Acceptées', statuses: ['ACCEPTED'] as const },
  { key: 'realisees', label: 'Réalisées', statuses: ['APPLIED'] as const },
  { key: 'ecartees', label: 'Écartées', statuses: ['DECLINED', 'WITHDRAWN'] as const },
  { key: 'toutes', label: 'Toutes', statuses: undefined },
] as const;

/**
 * Préconisations reçues des experts agronomiques.
 *
 * L'exploitant décide : accepter, écarter, ou reporter la préconisation dans
 * son registre. Rien ne s'écrit automatiquement dans un registre réglementaire
 * — c'est une décision, pas une synchronisation.
 */
export default async function FarmRecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const ctx = await requirePageFarmAccess('recommendation:read');
  const params = await searchParams;

  const filter = FILTERS.find((entry) => entry.key === params.statut) ?? FILTERS[0];

  const [all, filtered, advisors] = await Promise.all([
    listRecommendations({ farmId: ctx.farmId, visibleToFarmOnly: true, take: 500 }),
    listRecommendations({
      farmId: ctx.farmId,
      visibleToFarmOnly: true,
      ...(filter.statuses ? { status: [...filter.statuses] } : {}),
      take: 300,
    }),
    prisma.advisoryEngagement.count({
      where: { farmId: ctx.farmId, status: 'ACTIVE' },
    }),
  ]);

  const count = (status: string): number =>
    all.filter((item) => item.status === status).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={IconRegistry}
        title="Préconisations"
        description={
          advisors === 0
            ? "Aucun expert agronomique ne suit votre exploitation."
            : `${advisors} expert(s) suivent votre exploitation`
        }
      />

      {advisors === 0 ? (
        <EmptyState
          icon={IconSecurity}
          title="Aucun expert ne vous suit"
          description="Depuis les paramètres de l'exploitation, vous pouvez délivrer un code d'accès à un expert agronomique. Il verra alors votre parcellaire et vos registres, et pourra vous transmettre des préconisations."
          action={
            <Link
              href="/parametres"
              className="text-sm font-medium text-champ-700 hover:underline dark:text-champ-400"
            >
              Ouvrir les paramètres
            </Link>
          }
        />
      ) : (
        <>
          <section aria-label="Suivi" className="mb-5 grid gap-3 sm:grid-cols-3">
            <StatCard
              label="En attente de votre réponse"
              value={count('PROPOSED')}
              hint="À accepter ou écarter"
              accent
            />
            <StatCard label="Acceptées" value={count('ACCEPTED')} hint="À réaliser" />
            <StatCard
              label="Réalisées"
              value={count('APPLIED')}
              hint="Reportées au registre"
            />
          </section>

          <div className="mb-4">
            <Alert tone="info">
              Une préconisation est un avis. Accepter ne remplit aucun registre :
              c&apos;est vous qui enregistrez l&apos;intervention, quand elle a
              réellement eu lieu.
            </Alert>
          </div>

          <nav aria-label="Filtrer" className="mb-4">
            <ul className="flex flex-wrap gap-1">
              {FILTERS.map((entry) => (
                <li key={entry.key}>
                  <Link
                    href={`/preconisations?statut=${entry.key}`}
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
            viewer="farm"
            emptyLabel="Aucune préconisation ne correspond à ce filtre."
          />
        </>
      )}
    </div>
  );
}
