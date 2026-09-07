import type { Metadata } from 'next';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { getEnv } from '@/lib/env';
import {
  PARCEL_STATUS_LABELS,
  PARCEL_TYPES,
  currentCampaignYear,
} from '@/lib/constants/agronomy';
import { ParcelsMapLoader } from '@/components/map/ParcelsMapLoader';
import type { MapParcel } from '@/components/map/ParcelsMap';
import { ParcelsViewSwitch } from '@/app/(app)/parcelles/ParcelsViewSwitch';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Td,
  Th,
  TableWrapper,
  formatNumberFr,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Parcelles' };
export const dynamic = 'force-dynamic';

type SearchParams = {
  q?: string;
  culture?: string;
  statut?: string;
  type?: string;
  commune?: string;
  annee?: string;
  vue?: string;
  filtre?: string;
};

const STATUS_TONES: Record<string, 'green' | 'amber' | 'neutral'> = {
  ACTIVE: 'green',
  FALLOW: 'amber',
  ARCHIVED: 'neutral',
};

export default async function ParcelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('parcel:read');
  const env = getEnv();

  const year = Number(params.annee) || currentCampaignYear();
  const view = params.vue === 'carte' ? 'carte' : params.vue === 'tableau' ? 'tableau' : 'liste';

  const where: Prisma.ParcelWhereInput = {
    farmId: ctx.farmId,
    deletedAt: null,
    ...(params.statut ? { status: params.statut as Prisma.EnumParcelStatusFilter['equals'] } : {}),
    ...(params.type ? { parcelType: params.type } : {}),
    ...(params.commune ? { commune: { equals: params.commune, mode: 'insensitive' } } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' } },
            { internalNumber: { contains: params.q, mode: 'insensitive' } },
            { commune: { contains: params.q, mode: 'insensitive' } },
            { lieuDit: { contains: params.q, mode: 'insensitive' } },
            { cadastralRef: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(params.culture
      ? { cropYears: { some: { cropId: params.culture, campaignYear: year } } }
      : {}),
    // Raccourci depuis la zone « À faire » du tableau de bord.
    ...(params.filtre === 'sans-culture'
      ? { cropYears: { none: { campaignYear: year } } }
      : {}),
  };

  const [parcels, crops, communes, geojson, totalCount] = await Promise.all([
    prisma.parcel.findMany({
      where,
      include: {
        cropYears: {
          where: { campaignYear: year },
          include: { crop: { select: { id: true, name: true } } },
          take: 1,
        },
        _count: {
          select: { fertilizations: true, phytoTreatments: true, operations: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.crop.findMany({
      where: {
        OR: [{ farmId: null }, { farmId: ctx.farmId }],
        cropYears: { some: { parcel: { farmId: ctx.farmId, deletedAt: null } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null, commune: { not: null } },
      select: { commune: true },
      distinct: ['commune'],
      orderBy: { commune: 'asc' },
    }),
    getFarmParcelsGeoJSON(ctx.farmId, year),
    prisma.parcel.count({ where: { farmId: ctx.farmId, deletedAt: null } }),
  ]);

  const visibleIds = new Set(parcels.map((p) => p.id));
  const mapParcels: MapParcel[] = geojson.features
    .filter((f) => visibleIds.has(f.properties.id))
    .map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      internalNumber: f.properties.internalNumber,
      commune: f.properties.commune,
      areaHa: f.properties.areaHa,
      crop: f.properties.crop,
      geometry: f.geometry,
    }));

  const totalArea = parcels.reduce((sum, p) => sum + Number(p.areaHa), 0);
  const hasFilters = Boolean(
    params.q || params.culture || params.statut || params.type || params.commune || params.filtre,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Parcelles"
        description={`${parcels.length} parcelle${parcels.length > 1 ? 's' : ''} · ${formatNumberFr(totalArea, 2)} ha`}
        actions={<LinkButton href="/parcelles/nouvelle">+ Nouvelle parcelle</LinkButton>}
      />

      {totalCount === 0 ? (
        <EmptyState
          icon="🗺️"
          title="Aucune parcelle enregistrée"
          description="Dessinez votre première parcelle sur la carte. La superficie sera calculée automatiquement à partir du contour."
          action={
            <LinkButton href="/parcelles/nouvelle" size="lg">
              Dessiner ma première parcelle
            </LinkButton>
          }
        />
      ) : (
        <>
          {/* Filtres */}
          <Card className="mb-5">
            <form method="get" className="grid gap-3 md:grid-cols-5">
              <div className="md:col-span-2">
                <label htmlFor="q" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Recherche
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={params.q ?? ''}
                  placeholder="Nom, n° interne, commune, lieu-dit…"
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-3 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                />
              </div>

              <div>
                <label htmlFor="culture" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Culture
                </label>
                <select
                  id="culture"
                  name="culture"
                  defaultValue={params.culture ?? ''}
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                >
                  <option value="">Toutes</option>
                  {crops.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="statut" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Statut
                </label>
                <select
                  id="statut"
                  name="statut"
                  defaultValue={params.statut ?? ''}
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                >
                  <option value="">Tous</option>
                  {Object.entries(PARCEL_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="annee" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Campagne
                </label>
                <select
                  id="annee"
                  name="annee"
                  defaultValue={String(year)}
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                >
                  {Array.from({ length: 8 }, (_, i) => currentCampaignYear() + 1 - i).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="type" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Type de parcelle
                </label>
                <select
                  id="type"
                  name="type"
                  defaultValue={params.type ?? ''}
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                >
                  <option value="">Tous</option>
                  {PARCEL_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="commune" className="mb-1 block text-xs font-medium text-ardoise-600">
                  Commune
                </label>
                <select
                  id="commune"
                  name="commune"
                  defaultValue={params.commune ?? ''}
                  className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
                >
                  <option value="">Toutes</option>
                  {communes.map((c) =>
                    c.commune ? (
                      <option key={c.commune} value={c.commune}>
                        {c.commune}
                      </option>
                    ) : null,
                  )}
                </select>
              </div>

              <input type="hidden" name="vue" value={view} />

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="h-10 flex-1 rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
                >
                  Filtrer
                </button>
                {hasFilters ? (
                  <Link
                    href="/parcelles"
                    className="flex h-10 items-center rounded-lg border border-ardoise-300 px-3 text-sm text-ardoise-700 transition hover:bg-ardoise-50"
                  >
                    Réinitialiser
                  </Link>
                ) : null}
              </div>
            </form>
          </Card>

          <ParcelsViewSwitch current={view} />

          {parcels.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Aucune parcelle ne correspond"
              description="Modifiez ou réinitialisez les filtres."
              action={
                <LinkButton href="/parcelles" variant="outline">
                  Réinitialiser les filtres
                </LinkButton>
              }
            />
          ) : view === 'carte' ? (
            <Card padded={false} className="p-3">
              {mapParcels.length > 0 ? (
                <ParcelsMapLoader
                  parcels={mapParcels}
                  tileUrl={env.MAP_TILE_URL}
                  attribution={env.MAP_TILE_ATTRIBUTION}
                  heightClass="h-[620px]"
                />
              ) : (
                <div className="p-8">
                  <EmptyState
                    icon="🗺️"
                    title="Aucune géométrie à afficher"
                    description="Les parcelles filtrées n'ont pas de contour enregistré."
                  />
                </div>
              )}
            </Card>
          ) : view === 'tableau' ? (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>N°</Th>
                  <Th>Parcelle</Th>
                  <Th>Commune</Th>
                  <Th>Lieu-dit</Th>
                  <Th align="right">Superficie</Th>
                  <Th>Culture {year}</Th>
                  <Th>Type</Th>
                  <Th>Statut</Th>
                  <Th align="right">Interventions</Th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((parcel) => (
                  <tr key={parcel.id} className="transition hover:bg-champ-50/50">
                    <Td className="text-ardoise-500">{parcel.internalNumber ?? '—'}</Td>
                    <Td>
                      <Link
                        href={`/parcelles/${parcel.id}`}
                        className="font-medium text-champ-700 hover:underline"
                      >
                        {parcel.name}
                      </Link>
                    </Td>
                    <Td>{parcel.commune ?? '—'}</Td>
                    <Td>{parcel.lieuDit ?? '—'}</Td>
                    <Td align="right">{formatNumberFr(parcel.areaHa, 4)} ha</Td>
                    <Td>
                      {parcel.cropYears[0] ? (
                        <span>
                          {parcel.cropYears[0].crop.name}
                          {parcel.cropYears[0].variety ? (
                            <span className="text-ardoise-500">
                              {' '}
                              · {parcel.cropYears[0].variety}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ardoise-400">Non renseignée</span>
                      )}
                    </Td>
                    <Td>{parcel.parcelType ?? '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[parcel.status] ?? 'neutral'}>
                        {PARCEL_STATUS_LABELS[parcel.status] ?? parcel.status}
                      </Badge>
                    </Td>
                    <Td align="right" className="text-ardoise-500">
                      {parcel._count.fertilizations +
                        parcel._count.phytoTreatments +
                        parcel._count.operations}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {parcels.map((parcel) => (
                <Link
                  key={parcel.id}
                  href={`/parcelles/${parcel.id}`}
                  className="rounded-xl border border-ardoise-200 bg-white p-4 transition hover:border-champ-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-ardoise-900">
                        {parcel.name}
                      </h3>
                      {parcel.internalNumber ? (
                        <p className="text-xs text-ardoise-500">
                          N° {parcel.internalNumber}
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={STATUS_TONES[parcel.status] ?? 'neutral'}>
                      {PARCEL_STATUS_LABELS[parcel.status] ?? parcel.status}
                    </Badge>
                  </div>

                  <p className="mt-3 text-2xl font-semibold tabular-nums text-champ-700">
                    {formatNumberFr(parcel.areaHa, 2)}
                    <span className="ml-1 text-sm font-normal text-ardoise-500">ha</span>
                  </p>

                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-ardoise-500">Commune :</dt>
                      <dd className="truncate text-ardoise-800">
                        {parcel.commune ?? '—'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ardoise-500">Culture :</dt>
                      <dd className="truncate text-ardoise-800">
                        {parcel.cropYears[0]?.crop.name ?? (
                          <span className="text-ble-600">Non renseignée</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex gap-3 border-t border-ardoise-100 pt-2.5 text-xs text-ardoise-500">
                    <span>💧 {parcel._count.fertilizations}</span>
                    <span>🧪 {parcel._count.phytoTreatments}</span>
                    <span>🚜 {parcel._count.operations}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
