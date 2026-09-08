import type { Metadata } from 'next';
import { requirePageAgronomist } from '@/lib/auth/page-guards';
import { listPortfolio } from '@/lib/services/advisory';
import { JoinFarmCard } from '@/app/(expert)/portefeuille/JoinFarmCard';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import { IconArea, IconFarm, IconParcels, IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Portefeuille' };
export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const auth = await requirePageAgronomist();
  const farms = await listPortfolio(auth.user.id);

  const totalArea = farms.reduce((sum, farm) => sum + farm.areaHa, 0);
  const totalParcels = farms.reduce((sum, farm) => sum + farm.parcels, 0);
  const totalPending = farms.reduce((sum, farm) => sum + farm.pending, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={IconFarm}
        title="Portefeuille"
        description={
          farms.length === 0
            ? 'Aucune exploitation suivie pour le moment.'
            : `${farms.length} exploitation(s) suivie(s)`
        }
      />

      {farms.length > 0 ? (
        <section
          aria-label="Chiffres du portefeuille"
          className="mb-5 grid gap-3 sm:grid-cols-3"
        >
          <StatCard
            label="Surface suivie"
            value={formatNumberFr(totalArea, 1)}
            unit="ha"
            hint={`${farms.length} exploitation(s)`}
            icon={IconArea}
            accent
          />
          <StatCard
            label="Parcelles"
            value={totalParcels}
            hint="Sur l'ensemble du portefeuille"
            icon={IconParcels}
          />
          <StatCard
            label="Préconisations en attente"
            value={totalPending}
            hint="Transmises, sans réponse"
            icon={IconRegistry}
            href="/portefeuille/preconisations"
          />
        </section>
      ) : null}

      <div className="mb-5">
        <JoinFarmCard />
      </div>

      {farms.length === 0 ? (
        <EmptyState
          icon={IconFarm}
          title="Votre portefeuille est vide"
          description="Demandez à l'exploitation que vous conseillez de vous délivrer un code d'accès depuis ses paramètres, puis activez-le ci-dessus."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {farms.map((farm) => (
            <li key={farm.farmId}>
              <Card className="h-full">
                <div className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-ink">
                        {farm.farmName}
                      </h2>
                      <p className="truncate text-[13px] text-ink-3">
                        {[farm.city, farm.department].filter(Boolean).join(' · ') ||
                          'Localisation non renseignée'}
                      </p>
                    </div>
                    {farm.pending > 0 ? (
                      <Badge tone="amber">{farm.pending} en attente</Badge>
                    ) : null}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <div className="rounded-lg bg-surface-2 px-3 py-2">
                      <dt className="text-ink-3">Parcelles</dt>
                      <dd className="font-semibold tabular-nums text-ink">
                        {farm.parcels}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-surface-2 px-3 py-2">
                      <dt className="text-ink-3">Surface</dt>
                      <dd className="font-semibold tabular-nums text-ink">
                        {formatNumberFr(farm.areaHa, 1)} ha
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-[12.5px] text-ink-3">
                    Suivi depuis le {formatDateFr(farm.startedAt)}
                    {farm.lastPhytoAt
                      ? ` · dernier traitement le ${formatDateFr(farm.lastPhytoAt)}`
                      : ' · aucun traitement enregistré'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 pt-1">
                    <LinkButton href={`/portefeuille/${farm.farmId}`} size="sm">
                      Ouvrir
                    </LinkButton>
                    <LinkButton
                      href={`/portefeuille/${farm.farmId}/preconisations`}
                      size="sm"
                      variant="outline"
                    >
                      Préconisations
                    </LinkButton>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
