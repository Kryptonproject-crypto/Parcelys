import 'server-only';
import { prisma } from '@/lib/prisma';
import { OPERATION_LABELS } from '@/lib/constants/agronomy';

export type HistoryEventKind =
  | 'CROP'
  | 'HARVEST'
  | 'FERTILIZATION'
  | 'PHYTO'
  | 'OPERATION'
  | 'DOCUMENT';

export type HistoryEvent = {
  id: string;
  kind: HistoryEventKind;
  date: string;
  parcelId: string;
  parcelName: string;
  title: string;
  /** Lignes de détail affichées sous le titre. */
  details: string[];
  link: string;
};

function fmtNumber(value: unknown, digits = 2): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString('fr-FR', { maximumFractionDigits: digits })
    : '—';
}

/**
 * Historique chronologique d'une ou plusieurs parcelles.
 *
 * Toutes les requêtes sont contraintes par `parcelIds`, lui-même issu d'une
 * vérification d'appartenance en amont : aucun événement d'une autre
 * exploitation ne peut remonter.
 */
export async function buildHistory(params: {
  parcelIds: string[];
  from?: Date;
  to?: Date;
  kinds?: HistoryEventKind[];
  limit?: number;
}): Promise<HistoryEvent[]> {
  const { parcelIds } = params;
  if (parcelIds.length === 0) return [];

  const limit = params.limit ?? 300;
  const wants = (kind: HistoryEventKind) =>
    !params.kinds || params.kinds.length === 0 || params.kinds.includes(kind);

  const dateFilter =
    params.from || params.to
      ? { gte: params.from ?? undefined, lte: params.to ?? undefined }
      : undefined;

  const parcelFilter = { parcelId: { in: parcelIds } };
  const events: HistoryEvent[] = [];

  if (wants('CROP') || wants('HARVEST')) {
    const cropYears = await prisma.cropYear.findMany({
      where: parcelFilter,
      include: {
        crop: { select: { name: true } },
        parcel: { select: { id: true, name: true } },
      },
      orderBy: { campaignYear: 'desc' },
      take: limit,
    });

    for (const cy of cropYears) {
      const implantation = cy.sowingDate ?? new Date(cy.campaignYear, 0, 1);
      if (wants('CROP') && withinRange(implantation, params)) {
        events.push({
          id: `crop-${cy.id}`,
          kind: 'CROP',
          date: implantation.toISOString(),
          parcelId: cy.parcel.id,
          parcelName: cy.parcel.name,
          title: `Culture : ${cy.crop.name}`,
          details: [
            cy.variety ? `Variété : ${cy.variety}` : null,
            `Campagne ${cy.campaignYear}`,
            cy.sowingDate ? `Semis le ${formatDate(cy.sowingDate)}` : 'Date de semis non renseignée',
          ].filter((d): d is string => d !== null),
          link: `/parcelles/${cy.parcel.id}?onglet=culture`,
        });
      }

      if (wants('HARVEST') && cy.actualHarvestDate && withinRange(cy.actualHarvestDate, params)) {
        events.push({
          id: `harvest-${cy.id}`,
          kind: 'HARVEST',
          date: cy.actualHarvestDate.toISOString(),
          parcelId: cy.parcel.id,
          parcelName: cy.parcel.name,
          title: `Récolte : ${cy.crop.name}`,
          details: [
            cy.yieldValue
              ? `Rendement : ${fmtNumber(cy.yieldValue)} ${cy.yieldUnit ?? ''}`.trim()
              : 'Rendement non renseigné',
          ],
          link: `/parcelles/${cy.parcel.id}?onglet=culture`,
        });
      }
    }
  }

  if (wants('FERTILIZATION')) {
    const rows = await prisma.fertilizerApplication.findMany({
      where: { ...parcelFilter, ...(dateFilter ? { appliedOn: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { appliedOn: 'desc' },
      take: limit,
    });

    for (const row of rows) {
      const nutrients = [
        row.nSupplied ? `N ${fmtNumber(row.nSupplied)}` : null,
        row.pSupplied ? `P ${fmtNumber(row.pSupplied)}` : null,
        row.kSupplied ? `K ${fmtNumber(row.kSupplied)}` : null,
      ].filter(Boolean);

      events.push({
        id: `fert-${row.id}`,
        kind: 'FERTILIZATION',
        date: row.appliedOn.toISOString(),
        parcelId: row.parcel.id,
        parcelName: row.parcel.name,
        title: `Apport ${row.inputType === 'ORGANIC' ? 'organique' : 'minéral'} : ${row.productLabel}`,
        details: [
          `Dose : ${fmtNumber(row.dose, 3)} ${row.doseUnit}`,
          `Quantité totale : ${fmtNumber(row.totalQuantity, 2)} ${row.totalUnit} sur ${fmtNumber(row.treatedAreaHa, 4)} ha`,
          nutrients.length ? `Éléments apportés (kg/ha) : ${nutrients.join(' · ')}` : null,
        ].filter((d): d is string => d !== null),
        link: `/parcelles/${row.parcel.id}?onglet=apports`,
      });
    }
  }

  if (wants('PHYTO')) {
    const rows = await prisma.phytosanitaryApplication.findMany({
      where: { ...parcelFilter, ...(dateFilter ? { appliedOn: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { appliedOn: 'desc' },
      take: limit,
    });

    for (const row of rows) {
      events.push({
        id: `phyto-${row.id}`,
        kind: 'PHYTO',
        date: row.appliedOn.toISOString(),
        parcelId: row.parcel.id,
        parcelName: row.parcel.name,
        title: `Traitement phytosanitaire : ${row.productName}`,
        details: [
          row.amm ? `AMM ${row.amm}` : null,
          row.activeSubstances ? `Substances : ${row.activeSubstances}` : null,
          row.targetLabel ? `Cible : ${row.targetLabel}` : null,
          `Dose : ${fmtNumber(row.dose, 3)} ${row.doseUnit} — surface traitée ${fmtNumber(row.treatedAreaHa, 4)} ha`,
          row.weatherSummary
            ? `Conditions : ${row.weatherSummary}` +
              (row.weatherWindKmh ? `, vent ${fmtNumber(row.weatherWindKmh, 1)} km/h` : '')
            : null,
        ].filter((d): d is string => d !== null),
        link: `/parcelles/${row.parcel.id}?onglet=phytosanitaire`,
      });
    }
  }

  if (wants('OPERATION')) {
    const rows = await prisma.agriculturalOperation.findMany({
      where: { ...parcelFilter, ...(dateFilter ? { performedOn: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { performedOn: 'desc' },
      take: limit,
    });

    for (const row of rows) {
      events.push({
        id: `op-${row.id}`,
        kind: 'OPERATION',
        date: row.performedOn.toISOString(),
        parcelId: row.parcel.id,
        parcelName: row.parcel.name,
        title: `Travail : ${OPERATION_LABELS[row.type] ?? row.type}`,
        details: [
          row.equipment ? `Matériel : ${row.equipment}` : null,
          row.operator ? `Opérateur : ${row.operator}` : null,
          row.durationHours ? `Durée : ${fmtNumber(row.durationHours, 1)} h` : null,
        ].filter((d): d is string => d !== null),
        link: `/parcelles/${row.parcel.id}?onglet=travaux`,
      });
    }
  }

  if (wants('DOCUMENT')) {
    const rows = await prisma.document.findMany({
      where: { parcelId: { in: parcelIds }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const row of rows) {
      if (!row.parcel) continue;
      events.push({
        id: `doc-${row.id}`,
        kind: 'DOCUMENT',
        date: row.createdAt.toISOString(),
        parcelId: row.parcel.id,
        parcelName: row.parcel.name,
        title: `Document ajouté : ${row.fileName}`,
        details: [row.description ?? `Catégorie : ${row.category}`],
        link: `/parcelles/${row.parcel.id}?onglet=documents`,
      });
    }
  }

  return events
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

function withinRange(
  date: Date,
  params: { from?: Date; to?: Date },
): boolean {
  if (params.from && date < params.from) return false;
  if (params.to && date > params.to) return false;
  return true;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR');
}
