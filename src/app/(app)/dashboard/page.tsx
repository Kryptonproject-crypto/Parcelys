import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getDashboardData } from '@/lib/services/dashboard';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { ParcelsMapLoader } from '@/components/map/ParcelsMapLoader';
import type { MapParcel } from '@/components/map/ParcelsMap';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

const HISTORY_TONES: Record<string, 'green' | 'blue' | 'amber' | 'neutral' | 'red'> = {
  CROP: 'green',
  HARVEST: 'green',
  FERTILIZATION: 'blue',
  PHYTO: 'amber',
  OPERATION: 'neutral',
  DOCUMENT: 'neutral',
};

export default async function DashboardPage() {
  const auth = await getAuthContext();
  if (!auth) redirect('/connexion');

  if (!auth.activeFarmId) {
    return (
      <EmptyState
        title="Aucune exploitation"
        description="Votre compte n'est rattaché à aucune exploitation. Contactez l'administrateur qui doit vous inviter."
      />
    );
  }

  const env = getEnv();
  const campaignYear = currentCampaignYear();

  const [data, geojson, farm] = await Promise.all([
    getDashboardData(auth.activeFarmId, campaignYear),
    getFarmParcelsGeoJSON(auth.activeFarmId, campaignYear),
    prisma.farm.findUniqueOrThrow({
      where: { id: auth.activeFarmId },
      select: { name: true, city: true, isDemo: true },
    }),
  ]);

  const mapParcels: MapParcel[] = geojson.features.map((feature) => ({
    id: feature.properties.id,
    name: feature.properties.name,
    internalNumber: feature.properties.internalNumber,
    commune: feature.properties.commune,
    areaHa: feature.properties.areaHa,
    crop: feature.properties.crop,
    geometry: feature.geometry,
  }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`Bonjour ${auth.user.firstName}`}
        description={
          <>
            {farm.name}
            {farm.city ? ` — ${farm.city}` : ''} · Campagne {campaignYear}
          </>
        }
        actions={
          <>
            <LinkButton href="/parcelles/nouvelle">+ Nouvelle parcelle</LinkButton>
            <LinkButton href="/exports" variant="outline">
              Exporter
            </LinkButton>
          </>
        }
      />

      {farm.isDemo ? (
        <div className="mb-5">
          <Alert tone="warning" title="Exploitation de démonstration">
            Ces données sont fictives et destinées uniquement aux tests. Créez votre
            propre exploitation pour vos données réelles.
          </Alert>
        </div>
      ) : null}

      {/* Cartes statistiques */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Parcelles"
          value={data.stats.parcelCount}
          icon="🗺️"
          href="/parcelles"
          hint={`${data.stats.currentCrops.length} culture(s) en place`}
        />
        <StatCard
          label="Superficie totale"
          value={formatNumberFr(data.stats.totalAreaHa, 2)}
          unit="ha"
          icon="📐"
          href="/parcelles"
        />
        <StatCard
          label="Interventions"
          value={data.stats.interventionCount}
          icon="📋"
          href="/historique"
          hint={`${data.stats.fertilizationCount} apports · ${data.stats.phytoCount} traitements`}
        />
        <StatCard
          label="Travaux"
          value={data.stats.operationCount}
          icon="🚜"
          href="/historique"
          hint={`Campagne ${campaignYear}`}
        />
      </div>

      {/* À faire */}
      {data.todo.length > 0 ? (
        <Card className="mt-5">
          <CardHeader
            title="À faire"
            description="Points relevés automatiquement dans vos données"
          />
          <ul className="space-y-2">
            {data.todo.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.link}
                  className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition hover:shadow-sm ${
                    item.severity === 'warning'
                      ? 'border-ble-500/30 bg-amber-50 text-amber-900 hover:border-ble-500/60'
                      : 'border-ardoise-200 bg-ardoise-50 text-ardoise-700 hover:border-ardoise-300'
                  }`}
                >
                  <span className="text-base" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <span aria-hidden className="text-ardoise-400">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Carte de l'exploitation */}
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between px-5 pt-5">
            <div>
              <h2 className="text-base font-semibold text-ardoise-900">
                Carte de l&apos;exploitation
              </h2>
              <p className="mt-0.5 text-sm text-ardoise-500">
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
                heightClass="h-[420px]"
              />
            ) : (
              <EmptyState
                icon="🗺️"
                title="Aucune parcelle dessinée"
                description="Commencez par tracer votre première parcelle sur la carte : la superficie sera calculée automatiquement."
                action={
                  <LinkButton href="/parcelles/nouvelle">
                    Dessiner ma première parcelle
                  </LinkButton>
                }
              />
            )}
          </div>
        </Card>

        {/* Activité récente */}
        <Card padded={false} className="flex flex-col">
          <div className="px-5 pt-5">
            <h2 className="text-base font-semibold text-ardoise-900">Activité récente</h2>
            <p className="mt-0.5 text-sm text-ardoise-500">
              Dernières interventions enregistrées
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {data.recentActivity.length > 0 ? (
              <ol className="space-y-3">
                {data.recentActivity.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={event.link}
                      className="block rounded-lg border border-ardoise-200 p-3 transition hover:border-champ-300 hover:bg-champ-50/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ardoise-900">
                          {event.parcelName}
                        </span>
                        <Badge tone={HISTORY_TONES[event.kind] ?? 'neutral'}>
                          {formatDateFr(event.date)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-ardoise-700">{event.title}</p>
                      {event.details[0] ? (
                        <p className="mt-0.5 truncate text-xs text-ardoise-500">
                          {event.details[0]}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-sm text-ardoise-500">
                Aucune intervention enregistrée pour le moment.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Assolement */}
      {data.stats.currentCrops.length > 0 ? (
        <Card className="mt-5">
          <CardHeader
            title={`Assolement ${campaignYear}`}
            description={`${formatNumberFr(data.stats.totalAreaHa, 2)} ha au total`}
            action={
              <LinkButton href="/cultures" variant="ghost" size="sm">
                Gérer les cultures
              </LinkButton>
            }
          />

          <div className="space-y-2.5">
            {data.stats.currentCrops.map((crop) => {
              const share =
                data.stats.totalAreaHa > 0
                  ? (crop.areaHa / data.stats.totalAreaHa) * 100
                  : 0;
              return (
                <div key={crop.cropName}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ardoise-800">{crop.cropName}</span>
                    <span className="tabular-nums text-ardoise-500">
                      {formatNumberFr(crop.areaHa, 2)} ha · {crop.parcelCount} parcelle
                      {crop.parcelCount > 1 ? 's' : ''} · {share.toFixed(0)} %
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ardoise-100">
                    <div
                      className="h-full rounded-full bg-champ-500"
                      style={{ width: `${Math.max(share, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* Derniers apports & traitements */}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Derniers apports"
            action={
              <LinkButton href="/apports" variant="ghost" size="sm">
                Tout voir
              </LinkButton>
            }
          />
          {data.lastFertilizations.length > 0 ? (
            <ul className="divide-y divide-ardoise-100">
              {data.lastFertilizations.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ardoise-900">
                      {item.productLabel}
                    </p>
                    <p className="truncate text-xs text-ardoise-500">{item.parcelName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-ardoise-800">
                      {formatNumberFr(item.dose, 1)} {item.doseUnit}
                    </p>
                    <p className="text-xs text-ardoise-500">
                      {formatDateFr(item.appliedOn)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-ardoise-500">Aucun apport enregistré.</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Derniers traitements"
            action={
              <LinkButton href="/phytosanitaire" variant="ghost" size="sm">
                Tout voir
              </LinkButton>
            }
          />
          {data.lastPhyto.length > 0 ? (
            <ul className="divide-y divide-ardoise-100">
              {data.lastPhyto.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ardoise-900">
                      {item.productName}
                    </p>
                    <p className="truncate text-xs text-ardoise-500">{item.parcelName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-ardoise-800">
                      {formatNumberFr(item.dose, 2)} {item.doseUnit}
                    </p>
                    <p className="text-xs text-ardoise-500">
                      {formatDateFr(item.appliedOn)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-ardoise-500">Aucun traitement enregistré.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
