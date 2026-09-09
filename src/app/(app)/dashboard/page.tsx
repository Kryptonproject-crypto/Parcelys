import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getDashboardData } from '@/lib/services/dashboard';
import { getMonthlyActivity } from '@/lib/services/activity';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { ParcelsMapLoader } from '@/components/map/ParcelsMapLoader';
import type { MapParcel } from '@/components/map/ParcelsMap';
import { ShareBar } from '@/components/charts/ShareBar';
import { ActivityChart } from '@/components/charts/ActivityChart';
import { buildShares } from '@/components/charts/palette';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  formatCompactFr,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import {
  IconAdvisor,
  IconArea,
  IconChevronRight,
  IconCrops,
  IconHistory,
  IconInputs,
  IconOperation,
  IconParcels,
  IconPhyto,
  IconPlus,
  IconRegistry,
  IconTodo,
  IconWarning,
  IconWeather,
  type LucideIcon,
} from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

const TODO_ICONS: Record<string, LucideIcon> = {
  crop: IconCrops,
  phyto: IconPhyto,
  registry: IconRegistry,
  ephy: IconWarning,
  weather: IconWeather,
  advisory: IconAdvisor,
};

const HISTORY_STYLE: Record<string, { icon: LucideIcon }> = {
  CROP: { icon: IconCrops },
  HARVEST: { icon: IconCrops },
  FERTILIZATION: { icon: IconInputs },
  PHYTO: { icon: IconPhyto },
  OPERATION: { icon: IconOperation },
  DOCUMENT: { icon: IconRegistry },
};

export default async function DashboardPage() {
  const auth = await getAuthContext();
  if (!auth) redirect('/connexion');

  if (!auth.activeFarmId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={IconParcels}
          title="Aucune exploitation"
          description="Votre compte n'est rattaché à aucune exploitation. Contactez l'administrateur qui doit vous inviter."
        />
      </div>
    );
  }

  const env = getEnv();
  const campaignYear = currentCampaignYear();

  const [data, geojson, farm, parcelIds] = await Promise.all([
    getDashboardData(auth.activeFarmId, campaignYear),
    getFarmParcelsGeoJSON(auth.activeFarmId, campaignYear),
    prisma.farm.findUniqueOrThrow({
      where: { id: auth.activeFarmId },
      select: { name: true, city: true, isDemo: true },
    }),
    prisma.parcel
      .findMany({
        where: { farmId: auth.activeFarmId, deletedAt: null },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id)),
  ]);

  const activity = await getMonthlyActivity(parcelIds);

  const mapParcels: MapParcel[] = geojson.features.map((feature) => ({
    id: feature.properties.id,
    name: feature.properties.name,
    internalNumber: feature.properties.internalNumber,
    commune: feature.properties.commune,
    areaHa: feature.properties.areaHa,
    crop: feature.properties.crop,
    geometry: feature.geometry,
  }));

  const shares = buildShares(
    data.stats.currentCrops.map((crop) => ({
      label: crop.cropName,
      value: crop.areaHa,
      detail: `${crop.parcelCount} parcelle${crop.parcelCount > 1 ? 's' : ''}`,
    })),
  );

  const hasParcels = data.stats.parcelCount > 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`Bonjour ${auth.user.firstName}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink-2">{farm.name}</span>
            {farm.city ? <span>· {farm.city}</span> : null}
            <span>· Campagne {campaignYear}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href="/parcelles/nouvelle" icon={IconPlus}>
              Nouvelle parcelle
            </LinkButton>
            <LinkButton href="/exports" variant="outline">
              Exporter
            </LinkButton>
          </>
        }
      />

      {farm.isDemo ? (
        <div className="mb-6">
          <Alert tone="warning" icon={IconWarning} title="Exploitation de démonstration">
            Ces données sont fictives et destinées aux tests. Créez votre propre
            exploitation pour vos données réelles.
          </Alert>
        </div>
      ) : null}

      {!hasParcels ? (
        <EmptyState
          icon={IconParcels}
          title="Bienvenue sur Parcelys"
          description="Commencez par tracer votre première parcelle sur la carte : la superficie sera calculée automatiquement, et vos registres se construiront au fil de vos saisies."
          action={
            <LinkButton href="/parcelles/nouvelle" size="lg" icon={IconPlus}>
              Dessiner ma première parcelle
            </LinkButton>
          }
        />
      ) : (
        <>
          {/* Indicateurs */}
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Superficie totale"
              value={formatCompactFr(data.stats.totalAreaHa)}
              unit="ha"
              icon={IconArea}
              href="/parcelles"
              accent
              hint={`${data.stats.parcelCount} parcelle${data.stats.parcelCount > 1 ? 's' : ''}`}
            />
            <StatCard
              label="Cultures en place"
              value={data.stats.cropCount}
              icon={IconCrops}
              href="/cultures"
              hint={
                shares[0] ? `Principale : ${shares[0].label}` : 'Aucune culture renseignée'
              }
            />
            <StatCard
              label="Interventions"
              value={data.stats.interventionCount}
              icon={IconHistory}
              href="/historique"
              hint={`${data.stats.fertilizationCount} apports · ${data.stats.phytoCount} traitements`}
            />
            <StatCard
              label="Travaux"
              value={data.stats.operationCount}
              icon={IconOperation}
              href="/historique"
              hint={`Campagne ${campaignYear}`}
            />
          </div>

          {/* À faire */}
          {data.todo.length > 0 ? (
            <Card className="mt-6">
              <CardHeader
                icon={IconTodo}
                title="À faire"
                description="Points relevés automatiquement dans vos données"
              />
              <ul className="space-y-2">
                {data.todo.map((item) => {
                  const TodoIcon = TODO_ICONS[item.kind] ?? IconTodo;
                  return (
                  <li key={item.id}>
                    <Link
                      href={item.link}
                      className={`group flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[13.5px] transition-all hover:shadow-card ${
                        item.severity === 'warning'
                          ? 'border-ble-500/30 bg-ble-50 text-ble-700 hover:border-ble-500/60 dark:bg-ble-700/15 dark:text-ble-100'
                          : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong'
                      }`}
                    >
                      <TodoIcon size={16} aria-hidden className="shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      <IconChevronRight
                        size={15}
                        aria-hidden
                        className="shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-70"
                      />
                    </Link>
                  </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {/* Carte */}
            <Card className="lg:col-span-2" padded={false}>
              <div className="flex items-center justify-between px-5 pt-5">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                    Carte de l&apos;exploitation
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-3">
                    Cliquez sur une parcelle pour ouvrir sa fiche
                  </p>
                </div>
                <LinkButton href="/parcelles" variant="ghost" size="sm">
                  Voir la liste
                </LinkButton>
              </div>

              <div className="p-5 pt-4">
                {mapParcels.length > 0 ? (
                  <ParcelsMapLoader
                    parcels={mapParcels}
                    tileUrl={env.MAP_TILE_URL}
                    attribution={env.MAP_TILE_ATTRIBUTION}
                    heightClass="h-[380px]"
                  />
                ) : (
                  <EmptyState
                    icon={IconParcels}
                    title="Aucun contour enregistré"
                    description="Vos parcelles existent, mais aucune n'a de géométrie. Dessinez leur contour pour les voir apparaître ici."
                    action={
                      <LinkButton href="/parcelles/nouvelle" icon={IconPlus}>
                        Dessiner une parcelle
                      </LinkButton>
                    }
                  />
                )}
              </div>
            </Card>

            {/* Activité récente */}
            <Card padded={false} className="flex flex-col">
              <div className="px-5 pt-5">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                  Activité récente
                </h2>
                <p className="mt-0.5 text-sm text-ink-3">
                  Dernières interventions enregistrées
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {data.recentActivity.length > 0 ? (
                  <ol className="space-y-2.5">
                    {data.recentActivity.map((event) => {
                      const Icon = HISTORY_STYLE[event.kind]?.icon ?? IconHistory;
                      return (
                        <li key={event.id}>
                          <Link
                            href={event.link}
                            className="group flex gap-3 rounded-lg border border-line p-3 transition-all hover:border-champ-300 hover:bg-accent-soft/30"
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3 transition-colors group-hover:bg-surface">
                              <Icon size={14} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[13.5px] font-medium text-ink">
                                  {event.parcelName}
                                </span>
                                <span className="shrink-0 text-[12.5px] sm:text-[11.5px] tabular-nums text-ink-3">
                                  {formatDateFr(event.date)}
                                </span>
                              </span>
                              <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                                {event.title}
                              </span>
                              {event.details[0] ? (
                                <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                                  {event.details[0]}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="py-10 text-center text-sm text-ink-3">
                    Aucune intervention enregistrée pour le moment.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Assolement & activité */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                icon={IconCrops}
                title={`Assolement ${campaignYear}`}
                description={`${formatNumberFr(data.stats.totalAreaHa, 2)} ha au total`}
                action={
                  <LinkButton href="/cultures" variant="ghost" size="sm">
                    Détail
                  </LinkButton>
                }
              />
              <ShareBar
                slices={shares}
                total={data.stats.totalAreaHa}
                emptyLabel="Aucune culture renseignée pour cette campagne."
              />
            </Card>

            <Card>
              <CardHeader
                icon={IconHistory}
                title="Interventions par mois"
                description="Douze derniers mois"
                action={
                  <LinkButton href="/historique" variant="ghost" size="sm">
                    Historique
                  </LinkButton>
                }
              />
              <ActivityChart data={activity} />
            </Card>
          </div>

          {/* Derniers apports & traitements */}
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader
                icon={IconInputs}
                title="Derniers apports"
                action={
                  <LinkButton href="/apports" variant="ghost" size="sm">
                    Tout voir
                  </LinkButton>
                }
              />
              {data.lastFertilizations.length > 0 ? (
                <ul className="divide-y divide-line">
                  {data.lastFertilizations.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {item.productLabel}
                        </p>
                        <p className="truncate text-[12px] text-ink-3">{item.parcelName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13.5px] tabular-nums text-ink-2">
                          {formatCompactFr(item.dose)} {item.doseUnit}
                        </p>
                        <p className="text-[12.5px] sm:text-[11.5px] tabular-nums text-ink-3">
                          {formatDateFr(item.appliedOn)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-ink-3">
                  Aucun apport enregistré.
                </p>
              )}
            </Card>

            <Card>
              <CardHeader
                icon={IconPhyto}
                title="Derniers traitements"
                action={
                  <LinkButton href="/phytosanitaire" variant="ghost" size="sm">
                    Tout voir
                  </LinkButton>
                }
              />
              {data.lastPhyto.length > 0 ? (
                <ul className="divide-y divide-line">
                  {data.lastPhyto.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {item.productName}
                        </p>
                        <p className="truncate text-[12px] text-ink-3">{item.parcelName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13.5px] tabular-nums text-ink-2">
                          {formatCompactFr(item.dose)} {item.doseUnit}
                        </p>
                        <p className="text-[12.5px] sm:text-[11.5px] tabular-nums text-ink-3">
                          {formatDateFr(item.appliedOn)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-ink-3">
                  Aucun traitement enregistré.
                </p>
              )}
            </Card>
          </div>

          <p className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-center text-[12px] text-ink-3">
            <Badge tone="neutral">E-Phy</Badge>
            Les données phytosanitaires proviennent du catalogue officiel de l&apos;ANSES.
          </p>
        </>
      )}
    </div>
  );
}
