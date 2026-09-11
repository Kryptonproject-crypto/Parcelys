import type { Metadata } from 'next';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { computeNutrientBalance } from '@/lib/services/fertilization';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { CampagneChamp } from '@/components/campagne/CampagneChamp';
import { resumeCampagnes } from '@/lib/services/campagnes';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Select,
  TableWrapper,
  Td,
  Th,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import { IconInputs } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Apports' };
export const dynamic = 'force-dynamic';

export default async function FertilizationPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string; parcelle?: string; type?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('record:read');
  const year = Number(params.annee) || currentCampaignYear();
  const campagnes = await resumeCampagnes(ctx.farmId);

  const parcels = await prisma.parcel.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    select: { id: true, name: true, internalNumber: true },
    orderBy: { name: 'asc' },
  });
  const parcelIds = parcels.map((p) => p.id);

  const where: Prisma.FertilizerApplicationWhereInput = {
    parcelId:
      params.parcelle && parcelIds.includes(params.parcelle)
        ? params.parcelle
        : { in: parcelIds },
    appliedOn: {
      gte: new Date(Date.UTC(year - 1, 7, 1)),
      lte: new Date(Date.UTC(year, 6, 31, 23, 59, 59)),
    },
    ...(params.type === 'ORGANIC' || params.type === 'MINERAL'
      ? { inputType: params.type }
      : {}),
  };

  const applications = await prisma.fertilizerApplication.findMany({
    where,
    include: {
      parcel: { select: { id: true, name: true, internalNumber: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
    take: 1000,
  });

  const balance = computeNutrientBalance(
    applications.map((a) => ({
      treatedAreaHa: a.treatedAreaHa.toString(),
      nSupplied: a.nSupplied?.toString() ?? null,
      pSupplied: a.pSupplied?.toString() ?? null,
      kSupplied: a.kSupplied?.toString() ?? null,
    })),
  );


  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Registre des apports"
        description={`Campagne ${year} — ${applications.length} apport${applications.length > 1 ? 's' : ''}`}
        actions={
          <>
            <LinkButton
              href={`/api/exports?dataset=bilan-engrais&year=${year}&format=pdf`}
              variant="outline"
            >
              Bilan PDF
            </LinkButton>
            <LinkButton href={`/exports?dataset=apports&year=${year}`} variant="outline">
              Exporter
            </LinkButton>
          </>
        }
      />

      {/* Filtres */}
      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <CampagneChamp campagnes={campagnes} annee={year} />

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
            <label htmlFor="type" className="mb-1 block text-xs font-medium text-ink-2">
              Type d&apos;apport
            </label>
            <Select
              id="type"
              name="type"
              defaultValue={params.type ?? ''}
            >
              <option value="">Tous</option>
              <option value="MINERAL">Minéral</option>
              <option value="ORGANIC">Organique</option>
            </Select>
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

      {/* Bilan */}
      {applications.length > 0 ? (
        <Card className="mb-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Bilan des éléments fertilisants — campagne {year}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-4">
            {[
              ['Azote (N)', balance.totalN, balance.perHectareN],
              ['Phosphore (P₂O₅)', balance.totalP, balance.perHectareP],
              ['Potassium (K₂O)', balance.totalK, balance.perHectareK],
            ].map(([label, total, perHa]) => (
              <div key={String(label)} className="rounded-lg bg-surface-2 p-3">
                <p className="text-xs text-ink-3">{label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                  {formatNumberFr(perHa, 1)}
                  <span className="ml-1 text-xs font-normal text-ink-3">kg/ha</span>
                </p>
                <p className="text-xs tabular-nums text-ink-3">
                  {formatNumberFr(total, 1)} kg au total
                </p>
              </div>
            ))}
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-ink-3">Surface fertilisée cumulée</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {formatNumberFr(balance.areaHa, 2)}
                <span className="ml-1 text-xs font-normal text-ink-3">ha</span>
              </p>
            </div>
          </div>

          {balance.incompleteCount > 0 ? (
            <p className="mt-3 text-sm text-ble-600">
              ⚠ {balance.incompleteCount} apport
              {balance.incompleteCount > 1 ? 's sont' : ' est'} sans teneur en azote
              renseignée : le bilan est sous-estimé.
            </p>
          ) : null}
        </Card>
      ) : null}

      {applications.length === 0 ? (
        <EmptyState
          icon={IconInputs}
          title="Aucun apport sur cette campagne"
          description="Les apports s'enregistrent depuis la fiche d'une parcelle, onglet « Apports »."
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
              <Th>Type</Th>
              <Th>Produit</Th>
              <Th align="right">Dose</Th>
              <Th align="right">Surface</Th>
              <Th align="right">Quantité totale</Th>
              <Th align="right">N</Th>
              <Th align="right">P₂O₅</Th>
              <Th align="right">K₂O</Th>
            </tr>
          </thead>
          <tbody>
            {applications.map((row) => (
              <tr key={row.id} className="transition hover:bg-accent-soft/40">
                <Td>{formatDateFr(row.appliedOn)}</Td>
                <Td>
                  <Link
                    href={`/parcelles/${row.parcel.id}?onglet=apports`}
                    className="font-medium text-champ-700 dark:text-champ-400 hover:underline"
                  >
                    {row.parcel.internalNumber ? `${row.parcel.internalNumber} — ` : ''}
                    {row.parcel.name}
                  </Link>
                </Td>
                <Td>{row.cropYear?.crop.name ?? '—'}</Td>
                <Td>
                  <Badge tone={row.inputType === 'ORGANIC' ? 'green' : 'blue'}>
                    {row.inputType === 'ORGANIC' ? 'Organique' : 'Minéral'}
                  </Badge>
                </Td>
                <Td className="font-medium">{row.productLabel}</Td>
                <Td align="right">
                  {formatNumberFr(row.dose, 2)} {row.doseUnit}
                </Td>
                <Td align="right">{formatNumberFr(row.treatedAreaHa, 4)} ha</Td>
                <Td align="right">
                  {formatNumberFr(row.totalQuantity, 2)} {row.totalUnit}
                </Td>
                <Td align="right">{row.nSupplied ? formatNumberFr(row.nSupplied, 1) : '—'}</Td>
                <Td align="right">{row.pSupplied ? formatNumberFr(row.pSupplied, 1) : '—'}</Td>
                <Td align="right">{row.kSupplied ? formatNumberFr(row.kSupplied, 1) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}
    </div>
  );
}
