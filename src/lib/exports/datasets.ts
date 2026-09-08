import 'server-only';
import { prisma } from '@/lib/prisma';
import { OPERATION_LABELS, PARCEL_STATUS_LABELS } from '@/lib/constants/agronomy';

export type ExportColumn = {
  key: string;
  header: string;
  width?: number;
  /** Les nombres se lisent alignés à droite, les libellés à gauche. */
  align?: 'left' | 'right';
};

export type ExportDataset = {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number>>;
  /**
   * Chiffres clés imprimés en tête du PDF. Un contrôleur ou un conseiller
   * cherche d'abord un ordre de grandeur ; le détail vient après.
   */
  summary?: Array<{ label: string; value: string }>;
  /** Ligne de totaux, mise en évidence sous le tableau. */
  totals?: Record<string, string | number>;
  /** Mention de provenance imprimée en pied de document. */
  footnote?: string;
  /**
   * Avertissements sur la complétude des données — jamais une estimation à la
   * place d'une valeur manquante, toujours la mention de ce qui manque.
   */
  notices?: string[];
  /** Un tableau étroit se lit mieux en portrait. */
  orientation?: 'portrait' | 'landscape';
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

  const totalArea = parcels.reduce((sum, p) => sum + Number(p.areaHa), 0);
  const communes = new Set(parcels.map((p) => p.commune).filter(Boolean));

  return {
    title: 'Registre parcellaire',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    summary: [
      { label: 'Parcelles', value: String(parcels.length) },
      { label: 'Surface totale', value: `${fmtNum(totalArea, 2)} ha` },
      { label: 'Communes', value: String(communes.size) },
    ],
    footnote:
      'Superficies calculées par PostGIS à partir des géométries relevées, en ' +
      'projection géodésique. Elles font foi dans Parcelys.',
    totals: {
      name: `Total — ${parcels.length} parcelle(s)`,
      areaHa: fmtNum(totalArea, 4),
    },
    columns: [
      { key: 'internalNumber', header: 'N° interne', width: 14 },
      { key: 'name', header: 'Parcelle', width: 26 },
      { key: 'commune', header: 'Commune', width: 20 },
      { key: 'lieuDit', header: 'Lieu-dit', width: 20 },
      { key: 'areaHa', header: 'Superficie (ha)', width: 16, align: 'right' },
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

/**
 * Provenance du catalogue réglementaire, imprimée sur le registre.
 *
 * Exigence de traçabilité : un registre phytosanitaire doit dire d'où viennent
 * les caractéristiques des produits, et de quand elles datent. Sans import
 * E-Phy, le document le dit franchement plutôt que de laisser croire à une
 * vérification qui n'a pas eu lieu.
 */
async function ephyProvenance(): Promise<string> {
  const run = await prisma.ephySyncRun.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true, source: true, version: true },
  });

  if (!run) {
    return (
      'Catalogue officiel E-Phy non importé sur cette instance : les produits, ' +
      'AMM et substances actives ci-dessous sont ceux saisis par l’exploitation, ' +
      'sans vérification automatique.'
    );
  }

  return [
    `Caractéristiques des produits issues du catalogue officiel E-Phy (${run.source}`,
    run.version ? `, version ${run.version}` : '',
    `), dernière synchronisation le ${fmtDate(run.finishedAt)}.`,
  ].join('');
}

export async function buildPhytoDataset(filters: DatasetFilters): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);

  const [rows, provenance] = await Promise.all([
    prisma.phytosanitaryApplication.findMany({
      where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
      include: {
        parcel: { select: { name: true, internalNumber: true } },
        cropYear: { include: { crop: true } },
      },
      orderBy: { appliedOn: 'desc' },
    }),
    ephyProvenance(),
  ]);

  const treatedArea = rows.reduce((sum, r) => sum + Number(r.treatedAreaHa), 0);
  const products = new Set(rows.map((r) => r.productName.toLowerCase()));
  const withoutAmm = rows.filter((r) => !r.amm).length;

  return {
    title: 'Registre phytosanitaire',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    footnote:
      'Registre généré à partir des interventions saisies dans Parcelys. ' + provenance,
    summary: [
      { label: 'Interventions', value: String(rows.length) },
      { label: 'Produits différents', value: String(products.size) },
      { label: 'Surface traitée cumulée', value: `${fmtNum(treatedArea, 2)} ha` },
      {
        label: 'Parcelles concernées',
        value: String(new Set(rows.map((r) => r.parcelId)).size),
      },
    ],
    notices: withoutAmm > 0
      ? [
          `${withoutAmm} intervention(s) sans numéro d’AMM renseigné : le numéro ` +
            'figure sur l’étiquette du produit et doit être porté au registre.',
        ]
      : undefined,
    columns: [
      { key: 'date', header: 'Date', width: 15 },
      { key: 'parcel', header: 'Parcelle', width: 22 },
      { key: 'areaHa', header: 'Surface traitée (ha)', width: 15, align: 'right' },
      { key: 'crop', header: 'Culture', width: 16 },
      { key: 'product', header: 'Produit', width: 26 },
      { key: 'amm', header: 'N° AMM', width: 13 },
      { key: 'substances', header: 'Substances actives', width: 28 },
      { key: 'target', header: 'Cible', width: 19 },
      { key: 'dose', header: 'Dose', width: 14, align: 'right' },
      { key: 'quantity', header: 'Quantité utilisée', width: 15, align: 'right' },
      { key: 'sprayVolume', header: 'Bouillie L/ha', width: 14, align: 'right' },
      { key: 'weather', header: 'Conditions météo', width: 22 },
      { key: 'operator', header: 'Opérateur', width: 16 },
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

  const organic = rows.filter((r) => r.inputType === 'ORGANIC').length;
  const withoutContent = rows.filter((r) => r.nSupplied == null).length;

  return {
    title: 'Registre des apports',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    summary: [
      { label: 'Apports', value: String(rows.length) },
      { label: 'Minéraux', value: String(rows.length - organic) },
      { label: 'Organiques', value: String(organic) },
      {
        label: 'Parcelles concernées',
        value: String(new Set(rows.map((r) => r.parcelId)).size),
      },
    ],
    notices: withoutContent > 0
      ? [
          `${withoutContent} apport(s) sans teneur en éléments fertilisants : les ` +
            'colonnes N, P et K restent vides plutôt que d’afficher une estimation.',
        ]
      : undefined,
    footnote:
      'Teneurs issues du référentiel d’engrais et de produits organiques de ' +
      'l’exploitation. Une teneur non renseignée n’est jamais estimée.',
    columns: [
      { key: 'date', header: 'Date', width: 14 },
      { key: 'parcel', header: 'Parcelle', width: 24 },
      { key: 'crop', header: 'Culture', width: 18 },
      { key: 'type', header: 'Type', width: 12 },
      { key: 'product', header: 'Produit', width: 26 },
      { key: 'dose', header: 'Dose', width: 15, align: 'right' },
      { key: 'areaHa', header: 'Surface (ha)', width: 14, align: 'right' },
      { key: 'total', header: 'Quantité totale', width: 16, align: 'right' },
      { key: 'n', header: 'N kg/ha', width: 11, align: 'right' },
      { key: 'p', header: 'P₂O₅ kg/ha', width: 12, align: 'right' },
      { key: 'k', header: 'K₂O kg/ha', width: 12, align: 'right' },
      { key: 'supplier', header: 'Fournisseur', width: 19 },
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

/**
 * Bilan de fertilisation, parcelle par parcelle.
 *
 * C'est le document que l'on présente en contrôle ou que l'on remet à son
 * conseiller : pour chaque parcelle, la culture, la surface et les unités
 * d'azote, de phosphore et de potasse réellement apportées, en kg/ha et en kg.
 *
 * Une teneur inconnue n'est jamais estimée : l'apport est compté dans la
 * colonne « apports sans teneur », et le document le signale. Un bilan qui
 * inventerait les unités manquantes serait pire qu'un bilan incomplet.
 */
export async function buildFertilizerBalanceDataset(
  filters: DatasetFilters,
): Promise<ExportDataset> {
  const { computeNutrientBalance } = await import('@/lib/services/fertilization');
  const parcelIds = await resolveParcelIds(filters);
  const range = dateRange(filters);
  const year = filters.year;

  const parcels = await prisma.parcel.findMany({
    where: { id: { in: parcelIds } },
    select: {
      id: true,
      name: true,
      internalNumber: true,
      areaHa: true,
      cropYears: {
        where: year ? { campaignYear: year } : undefined,
        include: { crop: { select: { name: true } } },
        orderBy: { campaignYear: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  const applications = await prisma.fertilizerApplication.findMany({
    where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
    select: {
      parcelId: true,
      inputType: true,
      treatedAreaHa: true,
      nSupplied: true,
      pSupplied: true,
      kSupplied: true,
    },
  });

  const byParcel = new Map<string, typeof applications>();
  for (const application of applications) {
    const bucket = byParcel.get(application.parcelId) ?? [];
    bucket.push(application);
    byParcel.set(application.parcelId, bucket);
  }

  const rows: Array<Record<string, string | number>> = [];
  let farmN = 0;
  let farmP = 0;
  let farmK = 0;
  let farmArea = 0;
  let incomplete = 0;
  let parcelsWithInputs = 0;

  for (const parcel of parcels) {
    const inputs = byParcel.get(parcel.id) ?? [];
    if (inputs.length === 0) continue;
    parcelsWithInputs += 1;

    const balance = computeNutrientBalance(
      inputs.map((i) => ({
        treatedAreaHa: i.treatedAreaHa.toString(),
        nSupplied: i.nSupplied?.toString() ?? null,
        pSupplied: i.pSupplied?.toString() ?? null,
        kSupplied: i.kSupplied?.toString() ?? null,
      })),
    );

    const area = Number(parcel.areaHa);
    farmN += balance.totalN;
    farmP += balance.totalP;
    farmK += balance.totalK;
    farmArea += area;
    incomplete += balance.incompleteCount;

    const organic = inputs.filter((i) => i.inputType === 'ORGANIC').length;

    rows.push({
      parcel: parcel.internalNumber
        ? `${parcel.internalNumber} — ${parcel.name}`
        : parcel.name,
      crop: parcel.cropYears[0]?.crop.name ?? '',
      areaHa: fmtNum(area, 4),
      inputs: inputs.length,
      split: `${inputs.length - organic} min. / ${organic} org.`,
      nHa: area > 0 ? fmtNum(balance.totalN / area, 1) : '',
      pHa: area > 0 ? fmtNum(balance.totalP / area, 1) : '',
      kHa: area > 0 ? fmtNum(balance.totalK / area, 1) : '',
      nTotal: fmtNum(balance.totalN, 1),
      pTotal: fmtNum(balance.totalP, 1),
      kTotal: fmtNum(balance.totalK, 1),
      unknown: balance.incompleteCount > 0 ? String(balance.incompleteCount) : '',
    });
  }

  return {
    title: 'Bilan de fertilisation',
    subtitle: `${filters.farmName} — ${periodLabel(filters)}`,
    orientation: 'landscape',
    summary: [
      { label: 'Parcelles fertilisées', value: String(parcelsWithInputs) },
      { label: 'Surface concernée', value: `${fmtNum(farmArea, 2)} ha` },
      {
        label: 'Azote (N)',
        value: `${fmtNum(farmN, 0)} kg${farmArea > 0 ? ` · ${fmtNum(farmN / farmArea, 1)} kg/ha` : ''}`,
      },
      {
        label: 'Phosphore (P2O5)',
        value: `${fmtNum(farmP, 0)} kg${farmArea > 0 ? ` · ${fmtNum(farmP / farmArea, 1)} kg/ha` : ''}`,
      },
      {
        label: 'Potasse (K2O)',
        value: `${fmtNum(farmK, 0)} kg${farmArea > 0 ? ` · ${fmtNum(farmK / farmArea, 1)} kg/ha` : ''}`,
      },
    ],
    notices: incomplete > 0
      ? [
          `${incomplete} apport(s) sans teneur en éléments fertilisants renseignée : ` +
            'ils comptent dans les surfaces et le nombre d’apports, mais pas dans les ' +
            'unités ci-dessous. Complétez la composition du produit pour un bilan exact.',
        ]
      : undefined,
    columns: [
      { key: 'parcel', header: 'Parcelle', width: 30 },
      { key: 'crop', header: 'Culture', width: 20 },
      { key: 'areaHa', header: 'Surface (ha)', width: 14, align: 'right' },
      { key: 'inputs', header: 'Apports', width: 11, align: 'right' },
      { key: 'split', header: 'Minéral / organique', width: 18 },
      { key: 'nHa', header: 'N (kg/ha)', width: 13, align: 'right' },
      { key: 'pHa', header: 'P₂O₅ (kg/ha)', width: 14, align: 'right' },
      { key: 'kHa', header: 'K₂O (kg/ha)', width: 14, align: 'right' },
      { key: 'nTotal', header: 'N total (kg)', width: 14, align: 'right' },
      { key: 'pTotal', header: 'P₂O₅ total (kg)', width: 15, align: 'right' },
      { key: 'kTotal', header: 'K₂O total (kg)', width: 15, align: 'right' },
      { key: 'unknown', header: 'Apports sans teneur', width: 15, align: 'right' },
    ],
    rows,
    totals: {
      parcel: `Total — ${parcelsWithInputs} parcelle(s)`,
      areaHa: fmtNum(farmArea, 4),
      inputs: applications.length,
      nHa: farmArea > 0 ? fmtNum(farmN / farmArea, 1) : '',
      pHa: farmArea > 0 ? fmtNum(farmP / farmArea, 1) : '',
      kHa: farmArea > 0 ? fmtNum(farmK / farmArea, 1) : '',
      nTotal: fmtNum(farmN, 1),
      pTotal: fmtNum(farmP, 1),
      kTotal: fmtNum(farmK, 1),
      unknown: incomplete > 0 ? String(incomplete) : '',
    },
    footnote:
      'Unités calculées à partir des doses saisies et de la composition des produits ' +
      'du référentiel de l’exploitation. Les moyennes en kg/ha sont pondérées par la surface.',
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
      { key: 'duration', header: 'Durée (h)', width: 12, align: 'right' },
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
      { key: 'year', header: 'Campagne', width: 12, align: 'right' },
      { key: 'parcel', header: 'Parcelle', width: 24 },
      { key: 'areaHa', header: 'Superficie (ha)', width: 16, align: 'right' },
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
  'bilan-engrais': buildFertilizerBalanceDataset,
  travaux: buildOperationsDataset,
  cultures: buildCropsDataset,
  historique: buildHistoryDataset,
} as const;

export type DatasetName = keyof typeof DATASET_BUILDERS;
