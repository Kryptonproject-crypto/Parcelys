import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { listPortfolios } from '@/lib/admin/portefeuilles';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconPortfolio } from '@/components/ui/icons';
import { PortfolioForm } from '@/app/(admin)/administration/portefeuilles/PortfolioForm';

export const metadata: Metadata = { title: 'Portefeuilles — Administration' };
export const dynamic = 'force-dynamic';

/** Portefeuilles de gestion — administrateur général seul. */
export default async function AdminPortfoliosPage() {
  await requirePageAdminScope('portfolios:manage');
  const [portfolios, sansFermes, sansTechniciens] = await Promise.all([
    listPortfolios(),
    prisma.farm.count({ where: { deletedAt: null, portfolioId: null } }),
    prisma.user.count({ where: { deletedAt: null, accountType: 'AGRONOMIST', portfolioId: null } }),
  ]);

  return (
    <>
      <PageHeader
        icon={IconPortfolio}
        title="Portefeuilles"
        description="Un portefeuille regroupe des exploitations et des techniciens ; ses administrateurs secondaires ne voient que lui."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {portfolios.length === 0 ? (
            <EmptyState
              icon={IconPortfolio}
              title="Aucun portefeuille"
              description="Créez-en un, puis attribuez-lui des clients et un administrateur secondaire."
            />
          ) : (
            portfolios.map((p) => (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/administration/portefeuilles/${p.id}`}
                      className="text-[15px] font-semibold text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.description ? <p className="text-sm text-ink-3">{p.description}</p> : null}
                    <p className="mt-1 text-[13px] text-ink-2">
                      {p.managers.length === 0 ? (
                        <span className="text-brique-600 dark:text-brique-300">
                          Aucun administrateur : ses clients ne sont suivis que par vous.
                        </span>
                      ) : (
                        <>
                          Géré par{' '}
                          {p.managers.map((m, i) => (
                            <span key={m.id}>
                              {i > 0 ? ', ' : ''}
                              {m.firstName} {m.lastName}
                              {m.suspended ? ' (désactivé)' : ''}
                            </span>
                          ))}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge>{p.farms} exploitation(s)</Badge>
                    <Badge>{p.technicians} technicien(s)</Badge>
                    <Badge tone={p.openTickets > 0 ? 'amber' : 'neutral'}>{p.openTickets} demande(s) ouverte(s)</Badge>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Nouveau portefeuille" />
            <PortfolioForm />
          </Card>
          <Card>
            <CardHeader title="Clients sans portefeuille" />
            <p className="text-sm text-ink-2">
              <Link className="underline" href="/administration/exploitations?statut=sans-portefeuille">
                {sansFermes} exploitation(s)
              </Link>{' '}
              et{' '}
              <Link className="underline" href="/administration/experts?statut=sans-portefeuille">
                {sansTechniciens} technicien(s)
              </Link>{' '}
              ne relèvent que de l&apos;administration générale. Attribuez-les depuis leur fiche, ou
              en groupe depuis la fiche d&apos;un portefeuille.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
