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
      const { culture, recolte } = evenementsCulture(cy, cy.parcel);
      if (wants('CROP') && withinRange(new Date(culture.date), params)) events.push(culture);
      if (wants('HARVEST') && recolte && withinRange(new Date(recolte.date), params)) {
        events.push(recolte);
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

    for (const row of rows) events.push(evenementApport(row, row.parcel));
  }

  if (wants('PHYTO')) {
    const rows = await prisma.phytosanitaryApplication.findMany({
      where: { ...parcelFilter, ...(dateFilter ? { appliedOn: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { appliedOn: 'desc' },
      take: limit,
    });

    for (const row of rows) events.push(evenementPhyto(row, row.parcel));
  }

  if (wants('OPERATION')) {
    const rows = await prisma.agriculturalOperation.findMany({
      where: { ...parcelFilter, ...(dateFilter ? { performedOn: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { performedOn: 'desc' },
      take: limit,
    });

    for (const row of rows) events.push(evenementTravail(row, row.parcel));
  }

  if (wants('DOCUMENT')) {
    const rows = await prisma.document.findMany({
      where: { parcelId: { in: parcelIds }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const row of rows) {
      if (row.parcel) events.push(evenementDocument(row, row.parcel));
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

// ---------------------------------------------------------------------------
// Un événement par enregistrement
// ---------------------------------------------------------------------------
//
// Fonctions pures, partagées par l'historique du site (`buildHistory`) et par
// les registres envoyés à l'application (`src/lib/services/registres-mobile.ts`) :
// une intervention se raconte de la même façon sur l'écran du bureau et sur
// le téléphone.

type ParcelleRef = { id: string; name: string };
type Nombre = { toString(): string } | number;

export function evenementsCulture(
  cy: {
    id: string;
    campaignYear: number;
    variety: string | null;
    sowingDate: Date | null;
    actualHarvestDate: Date | null;
    yieldValue: Nombre | null;
    yieldUnit: string | null;
    crop: { name: string };
  },
  parcel: ParcelleRef,
): { culture: HistoryEvent; recolte: HistoryEvent | null } {
  const implantation = cy.sowingDate ?? new Date(cy.campaignYear, 0, 1);
  return {
    culture: {
      id: `crop-${cy.id}`,
      kind: 'CROP',
      date: implantation.toISOString(),
      parcelId: parcel.id,
      parcelName: parcel.name,
      title: `Culture : ${cy.crop.name}`,
      details: [
        cy.variety ? `Variété : ${cy.variety}` : null,
        `Campagne ${cy.campaignYear}`,
        cy.sowingDate ? `Semis le ${formatDate(cy.sowingDate)}` : 'Date de semis non renseignée',
      ].filter((d): d is string => d !== null),
      link: `/parcelles/${parcel.id}?onglet=culture`,
    },
    recolte: cy.actualHarvestDate
      ? {
          id: `harvest-${cy.id}`,
          kind: 'HARVEST',
          date: cy.actualHarvestDate.toISOString(),
          parcelId: parcel.id,
          parcelName: parcel.name,
          title: `Récolte : ${cy.crop.name}`,
          details: [
            cy.yieldValue
              ? `Rendement : ${fmtNumber(cy.yieldValue)} ${cy.yieldUnit ?? ''}`.trim()
              : 'Rendement non renseigné',
          ],
          link: `/parcelles/${parcel.id}?onglet=culture`,
        }
      : null,
  };
}

export function evenementApport(
  row: {
    id: string;
    appliedOn: Date;
    inputType: string;
    productLabel: string;
    dose: Nombre;
    doseUnit: string;
    totalQuantity: Nombre;
    totalUnit: string;
    treatedAreaHa: Nombre;
    nSupplied: Nombre | null;
    pSupplied: Nombre | null;
    kSupplied: Nombre | null;
  },
  parcel: ParcelleRef,
): HistoryEvent {
  const nutrients = [
    row.nSupplied ? `N ${fmtNumber(row.nSupplied)}` : null,
    row.pSupplied ? `P ${fmtNumber(row.pSupplied)}` : null,
    row.kSupplied ? `K ${fmtNumber(row.kSupplied)}` : null,
  ].filter(Boolean);

  return {
    id: `fert-${row.id}`,
    kind: 'FERTILIZATION',
    date: row.appliedOn.toISOString(),
    parcelId: parcel.id,
    parcelName: parcel.name,
    title: `Apport ${row.inputType === 'ORGANIC' ? 'organique' : 'minéral'} : ${row.productLabel}`,
    details: [
      `Dose : ${fmtNumber(row.dose, 3)} ${row.doseUnit}`,
      `Quantité totale : ${fmtNumber(row.totalQuantity, 2)} ${row.totalUnit} sur ${fmtNumber(row.treatedAreaHa, 4)} ha`,
      nutrients.length ? `Éléments apportés (kg/ha) : ${nutrients.join(' · ')}` : null,
    ].filter((d): d is string => d !== null),
    link: `/parcelles/${parcel.id}?onglet=apports`,
  };
}

export function evenementPhyto(
  row: {
    id: string;
    appliedOn: Date;
    productName: string;
    amm: string | null;
    activeSubstances: string | null;
    targetLabel: string | null;
    dose: Nombre;
    doseUnit: string;
    treatedAreaHa: Nombre;
    weatherSummary: string | null;
    weatherWindKmh: Nombre | null;
  },
  parcel: ParcelleRef,
): HistoryEvent {
  return {
    id: `phyto-${row.id}`,
    kind: 'PHYTO',
    date: row.appliedOn.toISOString(),
    parcelId: parcel.id,
    parcelName: parcel.name,
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
    link: `/parcelles/${parcel.id}?onglet=phytosanitaire`,
  };
}

export function evenementTravail(
  row: {
    id: string;
    performedOn: Date;
    type: string;
    equipment: string | null;
    operator: string | null;
    durationHours: Nombre | null;
  },
  parcel: ParcelleRef,
): HistoryEvent {
  return {
    id: `op-${row.id}`,
    kind: 'OPERATION',
    date: row.performedOn.toISOString(),
    parcelId: parcel.id,
    parcelName: parcel.name,
    title: `Travail : ${OPERATION_LABELS[row.type] ?? row.type}`,
    details: [
      row.equipment ? `Matériel : ${row.equipment}` : null,
      row.operator ? `Opérateur : ${row.operator}` : null,
      row.durationHours ? `Durée : ${fmtNumber(row.durationHours, 1)} h` : null,
    ].filter((d): d is string => d !== null),
    link: `/parcelles/${parcel.id}?onglet=travaux`,
  };
}

export function evenementDocument(
  row: {
    id: string;
    createdAt: Date;
    fileName: string;
    description: string | null;
    category: string;
  },
  parcel: ParcelleRef,
): HistoryEvent {
  return {
    id: `doc-${row.id}`,
    kind: 'DOCUMENT',
    date: row.createdAt.toISOString(),
    parcelId: parcel.id,
    parcelName: parcel.name,
    title: `Document ajouté : ${row.fileName}`,
    details: [row.description ?? `Catégorie : ${row.category}`],
    link: `/parcelles/${parcel.id}?onglet=documents`,
  };
}
