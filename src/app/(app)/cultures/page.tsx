import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import {
  Badge,
  Card,
  CardHeader,
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
import { IconCrops } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Cultures' };
export const dynamic = 'force-dynamic';

/** Assolement de l'exploitation, campagne par campagne. */
export default async function CropsPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('record:read');
  const year = Number(params.annee) || currentCampaignYear();

  const [parcels, cropYears, referential] = await Promise.all([
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null },
      select: { id: true, name: true, internalNumber: true, areaHa: true, commune: true },
      orderBy: { name: 'asc' },
    }),
    prisma.cropYear.findMany({
      where: {
        campaignYear: year,
        parcel: { farmId: ctx.farmId, deletedAt: null },
      },
      include: {
        crop: true,
        parcel: { select: { id: true, name: true, internalNumber: true, areaHa: true } },
      },
      orderBy: { parcel: { name: 'asc' } },
    }),
    prisma.crop.findMany({
      where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const byCrop = new Map<string, { areaHa: number; parcelCount: number }>();
  for (const cy of cropYears) {
    const entry = byCrop.get(cy.crop.name) ?? { areaHa: 0, parcelCount: 0 };
    entry.areaHa += Number(cy.parcel.areaHa);
    entry.parcelCount += 1;
    byCrop.set(cy.crop.name, entry);
  }

  const totalArea = parcels.reduce((sum, p) => sum + Number(p.areaHa), 0);
  const coveredIds = new Set(cropYears.map((cy) => cy.parcel.id));
  const uncovered = parcels.filter((p) => !coveredIds.has(p.id));

  const years = Array.from({ length: 8 }, (_, i) => currentCampaignYear() + 1 - i);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Cultures et assolement"
        description={`Campagne ${year} — ${cropYears.length} parcelle(s) renseignée(s) sur ${parcels.length}`}
        actions={
          <LinkButton href={`/exports?dataset=cultures&year=${year}`} variant="outline">
            Exporter
          </LinkButton>
        }
      />

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
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
          <button
            type="submit"
            className="h-10 rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
          >
            Afficher
          </button>
        </form>
      </Card>

      {/* Répartition */}
      {byCrop.size > 0 ? (
        <Card className="mb-5">
          <CardHeader
            title={`Répartition des surfaces — campagne ${year}`}
            description={`${formatNumberFr(totalArea, 2)} ha au total sur l'exploitation`}
          />
          <div className="space-y-2.5">
            {[...byCrop.entries()]
              .sort((a, b) => b[1].areaHa - a[1].areaHa)
              .map(([name, stats]) => {
                const share = totalArea > 0 ? (stats.areaHa / totalArea) * 100 : 0;
                return (
                  <div key={name}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-ink">{name}</span>
                      <span className="tabular-nums text-ink-3">
                        {formatNumberFr(stats.areaHa, 2)} ha · {stats.parcelCount} parcelle
                        {stats.parcelCount > 1 ? 's' : ''} · {share.toFixed(0)} %
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
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

      {/* Parcelles sans culture */}
      {uncovered.length > 0 ? (
        <Card className="mb-5 border-ble-500/30 bg-ble-50/50 dark:bg-ble-700/15">
          <CardHeader
            title={`${uncovered.length} parcelle(s) sans culture renseignée`}
            description={`Campagne ${year} — renseignez-les pour compléter vos registres.`}
          />
          <ul className="flex flex-wrap gap-2">
            {uncovered.map((parcel) => (
              <li key={parcel.id}>
                <Link
                  href={`/parcelles/${parcel.id}?onglet=culture`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm transition hover:border-champ-400"
                >
                  <span className="font-medium text-ink">{parcel.name}</span>
                  <span className="tabular-nums text-ink-3">
                    {formatNumberFr(parcel.areaHa, 2)} ha
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Détail */}
      {cropYears.length === 0 ? (
        <EmptyState
          icon={IconCrops}
          title="Aucune culture renseignée pour cette campagne"
          description="La culture se renseigne depuis la fiche d'une parcelle, onglet « Culture »."
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
              <Th>Parcelle</Th>
              <Th align="right">Superficie</Th>
              <Th>Culture</Th>
              <Th>Variété</Th>
              <Th>Semis</Th>
              <Th>Récolte prévue</Th>
              <Th>Récolte réelle</Th>
              <Th align="right">Rendement</Th>
            </tr>
          </thead>
          <tbody>
            {cropYears.map((cy) => (
              <tr key={cy.id} className="transition hover:bg-accent-soft/40">
                <Td>
                  <Link
                    href={`/parcelles/${cy.parcel.id}?onglet=culture`}
                    className="font-medium text-champ-700 dark:text-champ-400 hover:underline"
                  >
                    {cy.parcel.internalNumber ? `${cy.parcel.internalNumber} — ` : ''}
                    {cy.parcel.name}
                  </Link>
                </Td>
                <Td align="right">{formatNumberFr(cy.parcel.areaHa, 4)} ha</Td>
                <Td className="font-medium">{cy.crop.name}</Td>
                <Td>{cy.variety ?? '—'}</Td>
                <Td>{formatDateFr(cy.sowingDate)}</Td>
                <Td>{formatDateFr(cy.expectedHarvestDate)}</Td>
                <Td>{formatDateFr(cy.actualHarvestDate)}</Td>
                <Td align="right">
                  {cy.yieldValue
                    ? `${formatNumberFr(cy.yieldValue, 2)} ${cy.yieldUnit ?? ''}`
                    : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      {/* Référentiel */}
      <Card className="mt-6">
        <CardHeader
          title="Référentiel de cultures"
          description={`${referential.length} cultures disponibles, dont ${referential.filter((c) => c.isCustom).length} personnalisée(s).`}
        />
        <div className="flex flex-wrap gap-1.5">
          {referential.map((crop) => (
            <Badge key={crop.id} tone={crop.isCustom ? 'blue' : 'neutral'}>
              {crop.name}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Une culture personnalisée se crée depuis le formulaire « Renseigner une culture »
          d&apos;une parcelle.
        </p>
      </Card>
    </div>
  );
}
