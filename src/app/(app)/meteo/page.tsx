import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import {
  assessSprayingWindow,
  fetchWeather,
  WeatherUnavailableError,
  type WeatherBundle,
} from '@/lib/weather';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Select,
  StatCard,
} from '@/components/ui';
import { IconInputs, IconRain, IconTemperature, IconWeather, IconWind } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Météo' };
export const dynamic = 'force-dynamic';

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

const num = (value: number | null, digits = 0, unit = ''): string =>
  value === null
    ? '—'
    : `${value.toLocaleString('fr-FR', { maximumFractionDigits: digits })}${unit}`;

export default async function WeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ parcelle?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('farm:read');

  const [farm, parcels] = await Promise.all([
    prisma.farm.findUniqueOrThrow({
      where: { id: ctx.farmId },
      select: {
        name: true,
        city: true,
        latitude: true,
        longitude: true,
        weatherProvider: true,
      },
    }),
    prisma.parcel.findMany({
      where: {
        farmId: ctx.farmId,
        deletedAt: null,
        centroidLat: { not: null },
        centroidLng: { not: null },
      },
      select: {
        id: true,
        name: true,
        internalNumber: true,
        centroidLat: true,
        centroidLng: true,
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const selectedParcel = params.parcelle
    ? (parcels.find((p) => p.id === params.parcelle) ?? null)
    : null;

  const latitude = selectedParcel?.centroidLat ?? farm.latitude ?? parcels[0]?.centroidLat ?? null;
  const longitude =
    selectedParcel?.centroidLng ?? farm.longitude ?? parcels[0]?.centroidLng ?? null;

  const locationLabel = selectedParcel
    ? `Parcelle « ${selectedParcel.name} »`
    : farm.latitude !== null
      ? `${farm.name}${farm.city ? ` — ${farm.city}` : ''}`
      : parcels[0]
        ? `Parcelle « ${parcels[0].name} »`
        : null;

  if (latitude === null || longitude === null) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Météo locale" />
        <EmptyState
          icon={IconWeather}
          title="Aucune localisation connue"
          description="Renseignez l'adresse de votre exploitation dans les paramètres, ou créez une première parcelle : ses coordonnées serviront de point de référence."
          action={
            <LinkButton href="/parametres" variant="outline">
              Configurer l&apos;exploitation
            </LinkButton>
          }
        />
      </div>
    );
  }

  let bundle: WeatherBundle | null = null;
  let error: string | null = null;

  try {
    bundle = await fetchWeather(latitude, longitude, farm.weatherProvider);
  } catch (err) {
    error =
      err instanceof WeatherUnavailableError
        ? err.message
        : 'Le service météo est momentanément indisponible.';
  }

  const spraying = bundle ? assessSprayingWindow(bundle) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Météo locale"
        description={
          locationLabel
            ? `${locationLabel} · ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
            : undefined
        }
      />

      {/* Sélection du point d'observation */}
      {parcels.length > 0 ? (
        <Card className="mb-5">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <label
                htmlFor="parcelle"
                className="mb-1 block text-xs font-medium text-ink-2"
              >
                Point d&apos;observation
              </label>
              <Select
                id="parcelle"
                name="parcelle"
                defaultValue={params.parcelle ?? ''}
              >
                <option value="">Siège de l&apos;exploitation</option>
                {parcels.map((parcel) => (
                  <option key={parcel.id} value={parcel.id}>
                    {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                    {parcel.name}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="submit"
              className="h-10 rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
            >
              Afficher
            </button>
          </form>
        </Card>
      ) : null}

      {error ? (
        <Alert tone="warning" title="Météo indisponible">
          {error} Aucune donnée n&apos;est affichée : Parcelys n&apos;estime jamais de
          valeur météorologique.
        </Alert>
      ) : null}

      {bundle ? (
        <>
          {/* Conditions actuelles */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Température"
              value={num(bundle.current.temperatureC, 1)}
              unit="°C"
              icon={IconTemperature}
              hint={
                bundle.current.apparentTemperatureC !== null
                  ? `Ressenti ${num(bundle.current.apparentTemperatureC, 1)} °C`
                  : undefined
              }
            />
            <StatCard
              label="Précipitations"
              value={num(bundle.current.precipitationMm, 1)}
              unit="mm"
              icon={IconRain}
              hint={bundle.current.summary}
            />
            <StatCard
              label="Vent"
              value={num(bundle.current.windKmh, 1)}
              unit="km/h"
              icon={IconWind}
              hint={
                bundle.current.windGustKmh !== null
                  ? `Rafales ${num(bundle.current.windGustKmh, 0)} km/h`
                  : undefined
              }
            />
            <StatCard
              label="Humidité"
              value={num(bundle.current.humidity, 0)}
              unit="%"
              icon={IconInputs}
              hint={
                bundle.current.pressureHpa !== null
                  ? `Pression ${num(bundle.current.pressureHpa, 0)} hPa`
                  : undefined
              }
            />
          </div>

          {/* Fenêtre de traitement */}
          {spraying ? (
            <div className="mt-5">
              <Alert
                tone={spraying.suitable ? 'success' : 'warning'}
                title={
                  spraying.suitable
                    ? 'Conditions favorables à une pulvérisation'
                    : 'Conditions défavorables à une pulvérisation'
                }
              >
                {spraying.suitable ? (
                  <>
                    Vent, précipitations et température sont dans des plages
                    habituellement compatibles avec un traitement. Vérifiez toujours les
                    conditions réelles sur la parcelle et les prescriptions de
                    l&apos;étiquette du produit.
                  </>
                ) : (
                  <ul className="list-inside list-disc space-y-0.5">
                    {spraying.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            </div>
          ) : null}

          {/* Prévisions horaires */}
          <Card className="mt-5">
            <CardHeader
              title="Prévisions horaires"
              description="Prochaines 24 heures"
            />
            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-2">
                {bundle.hourly.slice(0, 24).map((hour) => (
                  <div
                    key={hour.time}
                    className="w-24 shrink-0 rounded-lg border border-line p-2.5 text-center"
                  >
                    <p className="text-xs font-medium text-ink-3">
                      {formatHour(hour.time)}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                      {num(hour.temperatureC, 0)}°
                    </p>
                    <p className="mt-0.5 text-[11px] leading-tight text-ink-3">
                      {hour.summary}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-ciel-600">
                      {num(hour.precipitationMm, 1)} mm
                    </p>
                    <p className="flex items-center justify-center gap-1 text-[11px] tabular-nums text-ink-3">
                      <IconWind size={11} aria-hidden />
                      {num(hour.windKmh, 0)} km/h
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Prévisions journalières */}
          <Card className="mt-5">
            <CardHeader title="Prévisions à plusieurs jours" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {bundle.daily.map((day) => (
                <div
                  key={day.date}
                  className="rounded-lg border border-line p-3 text-center"
                >
                  <p className="text-xs font-medium capitalize text-ink-2">
                    {formatDay(day.date)}
                  </p>
                  <p className="mt-1.5 text-sm leading-tight text-ink-3">
                    {day.summary}
                  </p>
                  <p className="mt-1.5 tabular-nums">
                    <span className="text-lg font-semibold text-ink">
                      {num(day.temperatureMaxC, 0)}°
                    </span>
                    <span className="ml-1.5 text-sm text-ink-3">
                      {num(day.temperatureMinC, 0)}°
                    </span>
                  </p>
                  <p className="mt-1 flex items-center justify-center gap-1 text-xs tabular-nums text-ciel-600">
                    <IconRain size={12} aria-hidden />
                    {num(day.precipitationMm, 1)} mm
                    {day.precipitationProbability !== null
                      ? ` · ${day.precipitationProbability} %`
                      : ''}
                  </p>
                  <p className="flex items-center justify-center gap-1 text-xs tabular-nums text-ink-3">
                    <IconWind size={12} aria-hidden />
                    {num(day.windMaxKmh, 0)} km/h
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <p className="mt-4 text-xs text-ink-3">
            Données fournies par « {bundle.provider} », relevées le{' '}
            {new Date(bundle.fetchedAt).toLocaleString('fr-FR')} (fuseau {bundle.timezone}).
            Le fournisseur météo est configurable dans{' '}
            <Link href="/profil" className="text-champ-700 dark:text-champ-400 hover:underline">
              vos préférences
            </Link>
            .
          </p>
        </>
      ) : null}
    </div>
  );
}
