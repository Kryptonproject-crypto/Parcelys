import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { PrintButton } from '@/app/(app)/registres/PrintButton';
import {
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
import { IconRegistry } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Registres' };
export const dynamic = 'force-dynamic';

/**
 * Registre phytosanitaire, généré à partir des interventions saisies.
 * Optimisé pour l'impression (les filtres et la navigation sont masqués).
 */
export default async function RegistersPage({
  searchParams,
}: {
  searchParams: Promise<{
    annee?: string;
    parcelle?: string;
    culture?: string;
    produit?: string;
    substance?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('record:read');
  const year = Number(params.annee) || currentCampaignYear();

  const [farm, parcels, source] = await Promise.all([
    prisma.farm.findUniqueOrThrow({
      where: { id: ctx.farmId },
      select: { name: true, siret: true, city: true, addressLine: true, postalCode: true },
    }),
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null },
      select: { id: true, name: true, internalNumber: true },
      orderBy: { name: 'asc' },
    }),
    getEphySourceInfo(),
  ]);

  const parcelIds = parcels.map((p) => p.id);

  const applications = await prisma.phytosanitaryApplication.findMany({
    where: {
      parcelId:
        params.parcelle && parcelIds.includes(params.parcelle)
          ? params.parcelle
          : { in: parcelIds },
      appliedOn: {
        gte: new Date(Date.UTC(year - 1, 7, 1)),
        lte: new Date(Date.UTC(year, 6, 31, 23, 59, 59)),
      },
      ...(params.produit
        ? { productName: { contains: params.produit, mode: 'insensitive' } }
        : {}),
      ...(params.substance
        ? { activeSubstances: { contains: params.substance, mode: 'insensitive' } }
        : {}),
    },
    include: {
      parcel: { select: { name: true, internalNumber: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'asc' },
    take: 2000,
  });

  const years = Array.from({ length: 8 }, (_, i) => currentCampaignYear() + 1 - i);
  const lastSync = source.lastSyncAt
    ? new Date(source.lastSyncAt).toLocaleDateString('fr-FR')
    : null;

  const exportBase = `/api/exports?dataset=phytosanitaire&year=${year}`;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="no-print">
        <PageHeader
          title="Registre phytosanitaire"
          description={`Campagne ${year} — ${applications.length} intervention${applications.length > 1 ? 's' : ''}`}
          actions={
            <>
              <PrintButton />
              <LinkButton href={`${exportBase}&format=pdf`} variant="outline">
                PDF
              </LinkButton>
              <LinkButton href={`${exportBase}&format=xlsx`} variant="outline">
                Excel
              </LinkButton>
              <LinkButton href={`${exportBase}&format=csv`} variant="outline">
                CSV
              </LinkButton>
            </>
          }
        />

        <Card className="mb-5">
          <form method="get" className="grid gap-3 sm:grid-cols-5">
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

            <div>
              <label htmlFor="produit" className="mb-1 block text-xs font-medium text-ink-2">
                Produit
              </label>
              <Input
                id="produit"
                name="produit"
                defaultValue={params.produit ?? ''}
              />
            </div>

            <div>
              <label
                htmlFor="substance"
                className="mb-1 block text-xs font-medium text-ink-2"
              >
                Substance active
              </label>
              <Input
                id="substance"
                name="substance"
                defaultValue={params.substance ?? ''}
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="h-10 w-full rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
              >
                Filtrer
              </button>
            </div>
          </form>
        </Card>
      </div>

      {/* En-tête du registre (visible à l'impression) */}
      <div className="print-full mb-5 rounded-xl border border-line bg-surface p-5">
        <h1 className="text-lg font-bold text-ink">
          Registre des traitements phytopharmaceutiques
        </h1>
        <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-ink-3">Exploitation :</dt>
            <dd className="font-medium text-ink">{farm.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">SIRET :</dt>
            <dd className="text-ink">{farm.siret ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Adresse :</dt>
            <dd className="text-ink">
              {[farm.addressLine, farm.postalCode, farm.city].filter(Boolean).join(', ') ||
                '—'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Campagne :</dt>
            <dd className="text-ink">{year}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Édité le :</dt>
            <dd className="text-ink">{new Date().toLocaleDateString('fr-FR')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Interventions :</dt>
            <dd className="text-ink">{applications.length}</dd>
          </div>
        </dl>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          icon={IconRegistry}
          title="Aucune intervention sur cette campagne"
          description="Le registre se remplit automatiquement à partir des traitements saisis sur vos parcelles."
        />
      ) : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Parcelle</Th>
              <Th>Culture</Th>
              <Th>Produit</Th>
              <Th>N° AMM</Th>
              <Th>Substance active</Th>
              <Th>Cible</Th>
              <Th align="right">Dose</Th>
              <Th align="right">Surface traitée</Th>
              <Th align="right">Quantité</Th>
              <Th>Opérateur</Th>
            </tr>
          </thead>
          <tbody>
            {applications.map((row) => (
              <tr key={row.id}>
                <Td>{formatDateFr(row.appliedOn)}</Td>
                <Td>
                  {row.parcel.internalNumber ? `${row.parcel.internalNumber} — ` : ''}
                  {row.parcel.name}
                </Td>
                <Td>{row.cropYear?.crop.name ?? row.cropLabel ?? '—'}</Td>
                <Td className="font-medium">{row.productName}</Td>
                <Td className="tabular-nums">{row.amm ?? '—'}</Td>
                <Td className="max-w-[200px] text-xs">{row.activeSubstances ?? '—'}</Td>
                <Td>{row.targetLabel ?? '—'}</Td>
                <Td align="right">
                  {formatNumberFr(row.dose, 3)} {row.doseUnit}
                </Td>
                <Td align="right">{formatNumberFr(row.treatedAreaHa, 4)} ha</Td>
                <Td align="right">
                  {formatNumberFr(row.quantityUsed, 3)} {row.quantityUnit}
                </Td>
                <Td>{row.operator ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      <p className="mt-4 text-xs text-ink-3">
        Registre généré par Parcelys à partir des interventions saisies. Les
        caractéristiques des produits (numéro d&apos;AMM, substances actives) proviennent du
        catalogue officiel E-Phy publié par l&apos;ANSES
        {lastSync ? ` — dernière synchronisation : ${lastSync}` : ' (aucune synchronisation enregistrée)'}.
        Ce document ne se substitue pas aux obligations réglementaires de tenue du registre.
      </p>
    </div>
  );
}
