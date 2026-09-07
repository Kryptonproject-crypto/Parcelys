import type { Metadata } from 'next';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { EphyExplorer } from '@/app/(app)/phytosanitaire/EphyExplorer';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Select,
  TableWrapper,
  Td,
  Th,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import { IconPhyto } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Phytosanitaire' };
export const dynamic = 'force-dynamic';

export default async function PhytosanitaryPage({
  searchParams,
}: {
  searchParams: Promise<{
    annee?: string;
    parcelle?: string;
    q?: string;
    substance?: string;
    filtre?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('record:read');
  const year = Number(params.annee) || currentCampaignYear();

  const parcels = await prisma.parcel.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    select: { id: true, name: true, internalNumber: true },
    orderBy: { name: 'asc' },
  });
  const parcelIds = parcels.map((p) => p.id);

  const where: Prisma.PhytosanitaryApplicationWhereInput = {
    parcelId:
      params.parcelle && parcelIds.includes(params.parcelle)
        ? params.parcelle
        : { in: parcelIds },
    ...(params.filtre === 'incomplet'
      ? {}
      : {
          appliedOn: {
            gte: new Date(Date.UTC(year - 1, 7, 1)),
            lte: new Date(Date.UTC(year, 6, 31, 23, 59, 59)),
          },
        }),
    ...(params.q
      ? {
          OR: [
            { productName: { contains: params.q, mode: 'insensitive' } },
            { amm: { contains: params.q } },
            { targetLabel: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(params.substance
      ? { activeSubstances: { contains: params.substance, mode: 'insensitive' } }
      : {}),
    ...(params.filtre === 'incomplet'
      ? { OR: [{ amm: null }, { targetLabel: null }, { operator: null }] }
      : {}),
  };

  const [applications, source] = await Promise.all([
    prisma.phytosanitaryApplication.findMany({
      where,
      include: {
        parcel: { select: { id: true, name: true, internalNumber: true } },
        cropYear: { include: { crop: { select: { name: true } } } },
        product: { select: { status: true } },
      },
      orderBy: { appliedOn: 'desc' },
      take: 1000,
    }),
    getEphySourceInfo(),
  ]);

  const lastSync = source.lastSyncAt
    ? new Date(source.lastSyncAt).toLocaleDateString('fr-FR')
    : null;

  const years = Array.from({ length: 8 }, (_, i) => currentCampaignYear() + 1 - i);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Phytosanitaire"
        description={
          params.filtre === 'incomplet'
            ? `${applications.length} intervention(s) à compléter`
            : `Campagne ${year} — ${applications.length} intervention${applications.length > 1 ? 's' : ''}`
        }
        actions={
          <>
            <LinkButton href="/registres" variant="outline">
              Registre
            </LinkButton>
            <LinkButton href={`/exports?dataset=phytosanitaire&year=${year}`} variant="outline">
              Exporter
            </LinkButton>
          </>
        }
      />

      <div className="mb-5">
        <Alert tone={source.configured ? 'info' : 'warning'}>
          {source.label}
          {lastSync
            ? ` — dernière synchronisation : ${lastSync}`
            : ' — aucune synchronisation enregistrée'}
          {source.productsInBase > 0
            ? ` (${source.productsInBase.toLocaleString('fr-FR')} produits en base).`
            : '. '}
          {!source.configured ? (
            <>
              {' '}
              Parcelys ne génère aucune donnée réglementaire. Pour activer la recherche de
              produits, renseignez <code>EPHY_DATA_URL</code> dans votre configuration puis
              lancez <code>npm run ephy:sync</code>.
            </>
          ) : null}
        </Alert>
      </div>

      {/* Recherche dans le catalogue officiel */}
      <Card className="mb-5">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Rechercher un produit dans le catalogue officiel
        </h2>
        <p className="mb-3 text-sm text-ink-3">
          Nom commercial ou numéro d&apos;AMM. Les informations affichées proviennent
          intégralement de l&apos;import E-Phy et ne remplacent pas l&apos;étiquette du
          produit.
        </p>
        <EphyExplorer />
      </Card>

      {/* Filtres du registre */}
      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-ink-2">
              Recherche
            </label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Produit, AMM, cible…"
            />
          </div>

          <div>
            <label htmlFor="annee" className="mb-1 block text-xs font-medium text-ink-2">
              Campagne
            </label>
            <Select
              id="annee"
              name="annee"
              defaultValue={String(year)}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="parcelle" className="mb-1 block text-xs font-medium text-ink-2">
              Parcelle
            </label>
            <Select
              id="parcelle"
              name="parcelle"
              defaultValue={params.parcelle ?? ''}
            >
              <option value="">Toutes</option>
              {parcels.map((parcel) => (
                <option key={parcel.id} value={parcel.id}>
                  {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                  {parcel.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="h-10 flex-1 rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
            >
              Filtrer
            </button>
            <Link
              href="/phytosanitaire?filtre=incomplet"
              className="flex h-10 items-center whitespace-nowrap rounded-lg border border-ble-500/40 bg-ble-50 dark:bg-ble-700/15 px-3 text-sm text-ble-700 dark:text-ble-100"
            >
              À compléter
            </Link>
          </div>
        </form>
      </Card>

      {applications.length === 0 ? (
        <EmptyState
          icon={IconPhyto}
          title="Aucune intervention phytosanitaire"
          description="Les traitements s'enregistrent depuis la fiche d'une parcelle, onglet « Phytosanitaire »."
          action={
            <LinkButton href="/parcelles" variant="outline">
              Choisir une parcelle
            </LinkButton>
          }
        />
      ) : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Parcelle</Th>
              <Th>Culture</Th>
              <Th>Produit</Th>
              <Th>AMM</Th>
              <Th>Substances actives</Th>
              <Th>Cible</Th>
              <Th align="right">Dose</Th>
              <Th align="right">Surface</Th>
              <Th>Conditions</Th>
              <Th>Opérateur</Th>
            </tr>
          </thead>
          <tbody>
            {applications.map((row) => (
              <tr key={row.id} className="transition hover:bg-accent-soft/40">
                <Td>{formatDateFr(row.appliedOn)}</Td>
                <Td>
                  <Link
                    href={`/parcelles/${row.parcel.id}?onglet=phytosanitaire`}
                    className="font-medium text-champ-700 dark:text-champ-400 hover:underline"
                  >
                    {row.parcel.internalNumber ? `${row.parcel.internalNumber} — ` : ''}
                    {row.parcel.name}
                  </Link>
                </Td>
                <Td>{row.cropYear?.crop.name ?? row.cropLabel ?? '—'}</Td>
                <Td className="font-medium">{row.productName}</Td>
                <Td>
                  {row.amm ? (
                    <span className="tabular-nums">{row.amm}</span>
                  ) : (
                    <Badge tone="amber">Manquant</Badge>
                  )}
                </Td>
                <Td className="max-w-[200px] truncate">{row.activeSubstances ?? '—'}</Td>
                <Td>
                  {row.targetLabel ?? <Badge tone="amber">Manquante</Badge>}
                </Td>
                <Td align="right">
                  {formatNumberFr(row.dose, 2)} {row.doseUnit}
                </Td>
                <Td align="right">{formatNumberFr(row.treatedAreaHa, 4)} ha</Td>
                <Td className="text-xs">
                  {row.weatherSummary ? (
                    <>
                      {row.weatherSummary}
                      {row.weatherWindKmh
                        ? `, vent ${formatNumberFr(row.weatherWindKmh, 1)} km/h`
                        : ''}
                    </>
                  ) : (
                    <span className="text-ble-600">Non renseignées</span>
                  )}
                </Td>
                <Td>{row.operator ?? <Badge tone="amber">Manquant</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}
    </div>
  );
}
