import 'server-only';
import { prisma } from '@/lib/prisma';
import { OPERATION_LABELS, PARCEL_STATUS_LABELS } from '@/lib/constants/agronomy';

export type ExportColumn = { key: string; header: string; width?: number };

export type ExportDataset = {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number>>;
  /** Mention de provenance imprimée en pied de document. */
  footnote?: string;
};

export type DatasetFilters = {
  farmId: string;
  farmName: string;
  year?: number;
  from?: Date;
  to?: Date;
  parcelIds?: string[];
  cropIds?: string[];
};

const fmtDate = (d: Date | null | undefined): string =>
  d ? d.toLocaleDateString('fr-FR') : '';

const fmtNum = (v: unknown, digits = 2): string => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '';
};

/** Restreint la sélection aux parcelles de l'exploitation demandée. */
async function resolveParcelIds(filters: DatasetFilters): Promise<string[]> {
  const parcels = await prisma.parcel.findMany({
    where: {
      farmId: filters.farmId,
      deletedAt: null,
      ...(filters.parcelIds?.length ? { id: { in: filters.parcelIds } } : {}),
    },
    select: { id: true },
  });
  return parcels.map((p) => p.id);
}

function dateRange(filters: DatasetFilters): { gte?: Date; lte?: Date } | undefined {
  if (filters.from || filters.to) {
    return { gte: filters.from, lte: filters.to };
  }
  if (filters.year) {
    return {
      gte: new Date(Date.UTC(filters.year - 1, 7, 1)),
      lte: new Date(Date.UTC(filters.year, 6, 31, 23, 59, 59)),
    };
  }
  return undefined;
}

function periodLabel(filters: DatasetFilters): string {
  if (filters.from || filters.to) {
    return `Période : ${fmtDate(filters.from) || '…'} → ${fmtDate(filters.to) || '…'}`;
  }
  if (filters.year) return `Campagne ${filters.year}`;
  return 'Toutes périodes';
}

export async function buildParcelDataset(filters: DatasetFilters): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const year = filters.year;

  const parcels = await prisma.parcel.findMany({
    where: { id: { in: parcelIds } },
    include: {
      cropYears: {
        where: year ? { campaignYear: year } : undefined,
        include: { crop: true },
        orderBy: { campaignYear: 'desc' },
        take: year ? undefined : 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  return {
    title: 'Registre parcellaire',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    columns: [
      { key: 'internalNumber', header: 'N° interne', width: 14 },
      { key: 'name', header: 'Parcelle', width: 26 },
      { key: 'commune', header: 'Commune', width: 20 },
      { key: 'lieuDit', header: 'Lieu-dit', width: 20 },
      { key: 'areaHa', header: 'Superficie (ha)', width: 16 },
      { key: 'parcelType', header: 'Type', width: 18 },
      { key: 'status', header: 'Statut', width: 14 },
      { key: 'crop', header: 'Culture', width: 20 },
      { key: 'variety', header: 'Variété', width: 18 },
      { key: 'cadastralRef', header: 'Réf. cadastrale', width: 18 },
      { key: 'pacId', header: 'Identifiant PAC', width: 16 },
    ],
    rows: parcels.map((p) => {
      const cropYear = p.cropYears[0];
      return {
        internalNumber: p.internalNumber ?? '',
        name: p.name,
        commune: p.commune ?? '',
        lieuDit: p.lieuDit ?? '',
        areaHa: fmtNum(p.areaHa, 4),
        parcelType: p.parcelType ?? '',
        status: PARCEL_STATUS_LABELS[p.status] ?? p.status,
        crop: cropYear?.crop.name ?? '',
        variety: cropYear?.variety ?? '',
        cadastralRef: p.cadastralRef ?? '',
        pacId: p.pacId ?? '',
      };
    }),
  };
}

export async function buildPhytoDataset(filters: DatasetFilters): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);

  const rows = await prisma.phytosanitaryApplication.findMany({
    where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
    include: {
      parcel: { select: { name: true, internalNumber: true } },
      cropYear: { include: { crop: true } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  return {
    title: 'Registre phytosanitaire',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    footnote:
      "Registre généré à partir des interventions saisies dans Parcelys. Les caractéristiques " +
      'des produits (AMM, substances actives) proviennent du catalogue officiel E-Phy.',
    columns: [
      { key: 'date', header: 'Date', width: 12 },
      { key: 'parcel', header: 'Parcelle', width: 22 },
      { key: 'areaHa', header: 'Surface traitée (ha)', width: 18 },
      { key: 'crop', header: 'Culture', width: 18 },
      { key: 'product', header: 'Produit', width: 26 },
      { key: 'amm', header: 'N° AMM', width: 12 },
      { key: 'substances', header: 'Substances actives', width: 30 },
      { key: 'target', header: 'Cible', width: 22 },
      { key: 'dose', header: 'Dose', width: 14 },
      { key: 'quantity', header: 'Quantité utilisée', width: 16 },
      { key: 'sprayVolume', header: 'Volume bouillie (L/ha)', width: 18 },
      { key: 'weather', header: 'Conditions météo', width: 26 },
      { key: 'operator', header: 'Opérateur', width: 18 },
    ],
    rows: rows.map((r) => ({
      date: fmtDate(r.appliedOn),
      parcel: r.parcel.internalNumber
        ? `${r.parcel.internalNumber} — ${r.parcel.name}`
        : r.parcel.name,
      areaHa: fmtNum(r.treatedAreaHa, 4),
      crop: r.cropYear?.crop.name ?? r.cropLabel ?? '',
      product: r.productName,
      amm: r.amm ?? '',
      substances: r.activeSubstances ?? '',
      target: r.targetLabel ?? '',
      dose: `${fmtNum(r.dose, 3)} ${r.doseUnit}`,
      quantity: `${fmtNum(r.quantityUsed, 3)} ${r.quantityUnit}`,
      sprayVolume: r.sprayVolumeLHa ? fmtNum(r.sprayVolumeLHa, 1) : '',
      weather: [
        r.weatherSummary,
        r.weatherTempC != null ? `${fmtNum(r.weatherTempC, 1)} °C` : null,
        r.weatherWindKmh != null ? `vent ${fmtNum(r.weatherWindKmh, 1)} km/h` : null,
        r.weatherHumidity != null ? `HR ${fmtNum(r.weatherHumidity, 0)} %` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      operator: r.operator ?? '',
    })),
  };
}

export async function buildFertilizationDataset(
  filters: DatasetFilters,
): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);

  const rows = await prisma.fertilizerApplication.findMany({
    where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
    include: {
      parcel: { select: { name: true, internalNumber: true } },
      cropYear: { include: { crop: true } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  return {
    title: 'Registre des apports',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    columns: [
      { key: 'date', header: 'Date', width: 12 },
      { key: 'parcel', header: 'Parcelle', width: 22 },
      { key: 'crop', header: 'Culture', width: 18 },
      { key: 'type', header: 'Type', width: 12 },
      { key: 'product', header: 'Produit', width: 26 },
      { key: 'dose', header: 'Dose', width: 14 },
      { key: 'areaHa', header: 'Surface (ha)', width: 14 },
      { key: 'total', header: 'Quantité totale', width: 16 },
      { key: 'n', header: 'N (kg/ha)', width: 12 },
      { key: 'p', header: 'P₂O₅ (kg/ha)', width: 12 },
      { key: 'k', header: 'K₂O (kg/ha)', width: 12 },
      { key: 'supplier', header: 'Fournisseur', width: 20 },
      { key: 'batch', header: 'N° de lot', width: 14 },
    ],
    rows: rows.map((r) => ({
      date: fmtDate(r.appliedOn),
      parcel: r.parcel.internalNumber
        ? `${r.parcel.internalNumber} — ${r.parcel.name}`
        : r.parcel.name,
      crop: r.cropYear?.crop.name ?? '',
      type: r.inputType === 'ORGANIC' ? 'Organique' : 'Minéral',
      product: r.productLabel,
      dose: `${fmtNum(r.dose, 3)} ${r.doseUnit}`,
      areaHa: fmtNum(r.treatedAreaHa, 4),
      total: `${fmtNum(r.totalQuantity, 2)} ${r.totalUnit}`,
      n: r.nSupplied != null ? fmtNum(r.nSupplied, 1) : '',
      p: r.pSupplied != null ? fmtNum(r.pSupplied, 1) : '',
      k: r.kSupplied != null ? fmtNum(r.kSupplied, 1) : '',
      supplier: r.supplier ?? '',
      batch: r.batchNumber ?? '',
    })),
  };
}

export async function buildOperationsDataset(
  filters: DatasetFilters,
): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);

  const rows = await prisma.agriculturalOperation.findMany({
    where: { parcelId: { in: parcelIds }, ...(range ? { performedOn: range } : {}) },
    include: { parcel: { select: { name: true, internalNumber: true } } },
    orderBy: { performedOn: 'desc' },
  });

  return {
    title: 'Registre des travaux',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    columns: [
      { key: 'date', header: 'Date', width: 12 },
      { key: 'parcel', header: 'Parcelle', width: 24 },
      { key: 'type', header: 'Type de travail', width: 18 },
      { key: 'equipment', header: 'Matériel', width: 24 },
      { key: 'operator', header: 'Opérateur', width: 18 },
      { key: 'duration', header: 'Durée (h)', width: 12 },
      { key: 'notes', header: 'Observations', width: 34 },
    ],
    rows: rows.map((r) => ({
      date: fmtDate(r.performedOn),
      parcel: r.parcel.internalNumber
        ? `${r.parcel.internalNumber} — ${r.parcel.name}`
        : r.parcel.name,
      type: OPERATION_LABELS[r.type] ?? r.type,
      equipment: r.equipment ?? '',
      operator: r.operator ?? '',
      duration: r.durationHours != null ? fmtNum(r.durationHours, 1) : '',
      notes: r.notes ?? '',
    })),
  };
}

export async function buildCropsDataset(filters: DatasetFilters): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);

  const rows = await prisma.cropYear.findMany({
    where: {
      parcelId: { in: parcelIds },
      ...(filters.year ? { campaignYear: filters.year } : {}),
      ...(filters.cropIds?.length ? { cropId: { in: filters.cropIds } } : {}),
    },
    include: {
      parcel: { select: { name: true, internalNumber: true, areaHa: true } },
      crop: true,
    },
    orderBy: [{ campaignYear: 'desc' }, { parcel: { name: 'asc' } }],
  });

  return {
    title: 'Assolement et cultures',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    columns: [
      { key: 'year', header: 'Campagne', width: 12 },
      { key: 'parcel', header: 'Parcelle', width: 24 },
      { key: 'areaHa', header: 'Superficie (ha)', width: 16 },
      { key: 'crop', header: 'Culture', width: 20 },
      { key: 'variety', header: 'Variété', width: 18 },
      { key: 'sowing', header: 'Semis', width: 12 },
      { key: 'harvestPlanned', header: 'Récolte prévue', width: 14 },
      { key: 'harvest', header: 'Récolte réelle', width: 14 },
      { key: 'yield', header: 'Rendement', width: 16 },
    ],
    rows: rows.map((r) => ({
      year: r.campaignYear,
      parcel: r.parcel.internalNumber
        ? `${r.parcel.internalNumber} — ${r.parcel.name}`
        : r.parcel.name,
      areaHa: fmtNum(r.parcel.areaHa, 4),
      crop: r.crop.name,
      variety: r.variety ?? '',
      sowing: fmtDate(r.sowingDate),
      harvestPlanned: fmtDate(r.expectedHarvestDate),
      harvest: fmtDate(r.actualHarvestDate),
      yield: r.yieldValue != null ? `${fmtNum(r.yieldValue, 2)} ${r.yieldUnit ?? ''}`.trim() : '',
    })),
  };
}

export async function buildHistoryDataset(filters: DatasetFilters): Promise<ExportDataset> {
  const { buildHistory } = await import('@/lib/services/history');
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);

  const events = await buildHistory({
    parcelIds,
    from: range?.gte,
    to: range?.lte,
    limit: 5000,
  });

  return {
    title: 'Historique des interventions',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    columns: [
      { key: 'date', header: 'Date', width: 12 },
      { key: 'parcel', header: 'Parcelle', width: 24 },
      { key: 'kind', header: 'Nature', width: 18 },
      { key: 'title', header: 'Intervention', width: 40 },
      { key: 'details', header: 'Détails', width: 60 },
    ],
    rows: events.map((e) => ({
      date: fmtDate(new Date(e.date)),
      parcel: e.parcelName,
      kind: HISTORY_KIND_LABELS[e.kind] ?? e.kind,
      title: e.title,
      details: e.details.join(' — '),
    })),
  };
}

const HISTORY_KIND_LABELS: Record<string, string> = {
  CROP: 'Culture',
  HARVEST: 'Récolte',
  FERTILIZATION: 'Apport',
  PHYTO: 'Phytosanitaire',
  OPERATION: 'Travail',
  DOCUMENT: 'Document',
};

export const DATASET_BUILDERS = {
  parcelles: buildParcelDataset,
  phytosanitaire: buildPhytoDataset,
  apports: buildFertilizationDataset,
  travaux: buildOperationsDataset,
  cultures: buildCropsDataset,
  historique: buildHistoryDataset,
} as const;

export type DatasetName = keyof typeof DATASET_BUILDERS;
