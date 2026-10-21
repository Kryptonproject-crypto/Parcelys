import 'server-only';
import { prisma } from '@/lib/prisma';
import { OPERATION_LABELS, PARCEL_STATUS_LABELS } from '@/lib/constants/agronomy';
import {
  cahierEpandage,
  plafondAzoteOrganique,
} from '@/lib/regulatory/organic-nitrogen';

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
      'Catalogue officiel E-Phy non importé sur ce serveur : les produits, ' +
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

  const [rows, provenance, farm] = await Promise.all([
    prisma.phytosanitaryApplication.findMany({
      where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
      include: {
        parcel: { select: { name: true, internalNumber: true } },
        cropYear: { include: { crop: true } },
      },
      orderBy: { appliedOn: 'desc' },
    }),
    ephyProvenance(),
    prisma.farm.findUnique({
      where: { id: filters.farmId },
      select: { siret: true, organicFarming: true },
    }),
  ]);
  const bioDuProfil =
    farm?.organicFarming === 'TOTALE' ? true : farm?.organicFarming === 'AUCUNE' ? false : null;
  const TIERS: Record<string, string> = { PRESTATAIRE: 'prestataire', ENTRAIDE: 'entraide' };

  const treatedArea = rows.reduce((sum, r) => sum + Number(r.treatedAreaHa), 0);
  const products = new Set(rows.map((r) => r.productName.toLowerCase()));
  const withoutAmm = rows.filter((r) => !r.amm).length;

  return {
    title: 'Registre phytosanitaire',
    subtitle: `${filters.farmName}${farm?.siret ? ` — SIRET ${farm.siret}` : ''} — ${periodLabel(filters)}`,
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
    notices: (() => {
      const avis: string[] = [];
      if (withoutAmm > 0) {
        avis.push(
          `${withoutAmm} intervention(s) sans numéro d’AMM renseigné : le numéro ` +
            'figure sur l’étiquette du produit et doit être porté au registre.',
        );
      }
      if (rows.length > 0 && !farm?.siret) {
        avis.push('SIRET de l’exploitation non renseigné (Paramètres) : le registre le mentionne depuis le 1er janvier 2026.');
      }
      const sansBio = rows.filter((r) => (r.organicProduction ?? bioDuProfil) === null).length;
      if (sansBio > 0) {
        avis.push(`${sansBio} intervention(s) sans mention « agriculture biologique » (conduite bio à renseigner dans les Paramètres).`);
      }
      return avis.length > 0 ? avis : undefined;
    })(),
    columns: [
      { key: 'date', header: 'Date', width: 13 },
      { key: 'hours', header: 'Heures', width: 11 },
      { key: 'parcel', header: 'Parcelle', width: 20 },
      { key: 'areaHa', header: 'Surface traitée (ha)', width: 13, align: 'right' },
      { key: 'crop', header: 'Culture', width: 15 },
      { key: 'stage', header: 'Stade', width: 8 },
      { key: 'organic', header: 'Bio', width: 6 },
      { key: 'product', header: 'Produit', width: 22 },
      { key: 'amm', header: 'N° AMM', width: 12 },
      { key: 'substances', header: 'Substances actives', width: 24 },
      { key: 'target', header: 'Cible', width: 17 },
      { key: 'dose', header: 'Dose', width: 13, align: 'right' },
      { key: 'quantity', header: 'Quantité utilisée', width: 14, align: 'right' },
      { key: 'sprayVolume', header: 'Bouillie L/ha', width: 11, align: 'right' },
      { key: 'weather', header: 'Conditions météo', width: 20 },
      { key: 'operator', header: 'Opérateur', width: 18 },
    ],
    rows: rows.map((r) => ({
      date: fmtDate(r.appliedOn),
      hours: r.startTime || r.endTime ? `${r.startTime ?? '?'}–${r.endTime ?? '?'}` : '',
      stage: r.bbchStage ?? '',
      organic: (() => {
        const bio = r.organicProduction ?? bioDuProfil;
        return bio === true ? 'Oui' : bio === false ? 'Non' : '';
      })(),
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
      operator: [
        r.operator,
        r.appliedBy && TIERS[r.appliedBy]
          ? `${TIERS[r.appliedBy]}${r.contractorName ? ` ${r.contractorName}` : ''}${r.contractorSiret ? ` (SIRET ${r.contractorSiret})` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' — '),
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
      fertilizer: { select: { nPercent: true } },
      organicInput: { select: { nContent: true, defaultUnit: true } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  /**
   * Teneur en azote du produit, telle que le cahier d'enregistrement « nitrates »
   * la demande : en % pour un engrais minéral, en kg N par tonne ou par m³ pour
   * un produit organique. Vide pour un produit saisi hors référentiel.
   */
  const teneurN = (r: (typeof rows)[number]): string => {
    if (r.fertilizer?.nPercent != null) return `${fmtNum(r.fertilizer.nPercent, 1)} %`;
    if (r.organicInput?.nContent != null) {
      const unite = r.organicInput.defaultUnit === 'm3/ha' ? 'kg N/m³' : 'kg N/t';
      return `${fmtNum(r.organicInput.nContent, 2)} ${unite}`;
    }
    return '';
  };

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
      { key: 'teneur', header: 'Teneur en N', width: 12, align: 'right' },
      { key: 'n', header: 'N kg/ha', width: 11, align: 'right' },
      { key: 'nTotal', header: 'N total (kg)', width: 12, align: 'right' },
      { key: 'p', header: 'P₂O₅ kg/ha', width: 12, align: 'right' },
      { key: 'k', header: 'K₂O kg/ha', width: 12, align: 'right' },
      { key: 'supplier', header: 'Fournisseur', width: 17 },
      { key: 'batch', header: 'N° de lot', width: 12 },
      { key: 'operator', header: 'Opérateur', width: 15 },
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
      teneur: teneurN(r),
      n: r.nSupplied != null ? fmtNum(r.nSupplied, 1) : '',
      // L'azote total de l'apport : ce que le cahier d'enregistrement
      // demande ligne à ligne, à côté de la dose à l'hectare.
      nTotal:
        r.nSupplied != null ? fmtNum(Number(r.nSupplied) * Number(r.treatedAreaHa), 1) : '',
      p: r.pSupplied != null ? fmtNum(r.pSupplied, 1) : '',
      k: r.kSupplied != null ? fmtNum(r.kSupplied, 1) : '',
      supplier: r.supplier ?? '',
      batch: r.batchNumber ?? '',
      operator: r.operator ?? '',
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

/**
 * Cahier d'épandage.
 *
 * ## Produit, jamais saisi
 *
 * Chaque ligne vient d'un apport organique déjà enregistré. Un cahier saisi à
 * part aurait divergé du registre dès le premier oubli — et c'est le cahier
 * qu'un contrôle lirait.
 *
 * ## Les lignes incomplètes restent
 *
 * Un cahier amputé de ses lignes gênantes se présenterait mieux et vaudrait
 * moins. Ce qui manque est écrit sur la ligne elle-même, et compté en tête.
 *
 * ## Aucun plafond n'est imprimé sans sa source
 *
 * Le ratio d'azote organique à l'hectare figure dans la synthèse. Il n'est
 * confronté à un plafond que si le programme d'actions en fournit un, et ce
 * plafond est alors imprimé **avec sa référence de texte**. Sans règle
 * importée, le document dit qu'il n'y a rien à quoi comparer — il n'écrit pas
 * 170.
 */
export async function buildSpreadingLogDataset(
  filters: DatasetFilters,
): Promise<ExportDataset> {
  const annee = filters.year ?? new Date().getFullYear();
  const [cahier, plafond] = await Promise.all([
    cahierEpandage({ farmId: filters.farmId, campaignYear: annee }),
    plafondAzoteOrganique({ farmId: filters.farmId, campaignYear: annee }),
  ]);

  const notices: string[] = [];
  if (cahier.lignesIncompletes > 0) {
    notices.push(
      `${cahier.lignesIncompletes} ligne(s) incomplète(s), conservées et signalées : ` +
        'un cahier amputé de ses lignes gênantes vaudrait moins.',
    );
  }
  if (plafond.manque) notices.push(plafond.manque);

  const summary = [
    { label: 'Épandages', value: String(cahier.lignes.length) },
    {
      label: 'Azote organique',
      value: `${cahier.totalAzoteKg.toLocaleString('fr-FR')} kg`,
    },
    {
      label: 'Par hectare',
      value:
        plafond.parHectare === null
          ? 'non calculable'
          : `${plafond.parHectare.toLocaleString('fr-FR')} kg N/ha`,
    },
    {
      label: 'Plafond opposable',
      value: plafond.plafond
        ? `${plafond.plafond.valeurKgHa} ${plafond.plafond.unite}`
        : 'non configuré',
    },
  ];

  return {
    title: 'Cahier d’épandage',
    subtitle: `${filters.farmName} — campagne ${annee}`,
    summary,
    notices,
    orientation: 'landscape',
    columns: [
      { key: 'date', header: 'Date' },
      { key: 'parcelle', header: 'Parcelle' },
      { key: 'ilot', header: 'Îlot PAC' },
      { key: 'culture', header: 'Culture' },
      { key: 'produit', header: 'Effluent' },
      { key: 'dose', header: 'Dose', align: 'right' },
      { key: 'surface', header: 'Surface (ha)', align: 'right' },
      { key: 'quantite', header: 'Quantité totale', align: 'right' },
      { key: 'azote', header: 'N (kg)', align: 'right' },
      { key: 'azoteHa', header: 'N (kg/ha)', align: 'right' },
      { key: 'operateur', header: 'Opérateur' },
      { key: 'manque', header: 'À compléter' },
    ],
    rows: cahier.lignes.map((l) => ({
      date: l.appliedOn.toLocaleDateString('fr-FR'),
      parcelle: l.parcelName,
      ilot: l.pacId ?? '—',
      culture: l.cropName ?? '—',
      produit: l.organicInputName ?? l.productLabel,
      dose: `${l.dose.toLocaleString('fr-FR')} ${l.doseUnit}`,
      surface: l.treatedAreaHa.toLocaleString('fr-FR'),
      quantite: `${l.totalQuantity.toLocaleString('fr-FR')} ${l.totalUnit}`,
      azote: l.nSupplied === null ? '—' : l.nSupplied.toLocaleString('fr-FR'),
      azoteHa: l.nParHectare === null ? '—' : l.nParHectare.toLocaleString('fr-FR'),
      operateur: l.operator ?? '—',
      manque: l.lacunes.join(' · ') || '',
    })),
    totals: {
      parcelle: 'Total',
      azote: cahier.totalAzoteKg.toLocaleString('fr-FR'),
    },
    footnote: plafond.plafond
      ? `Plafond opposé : ${plafond.plafond.valeurKgHa} ${plafond.plafond.unite} — ` +
        `${plafond.plafond.sourceRef ?? plafond.plafond.sourceLabel} ` +
        `(${plafond.plafond.referentialCode} ${plafond.plafond.referentialVersion}). ` +
        'Document produit à partir des apports enregistrés dans Parcelys.'
      : 'Aucun plafond d’azote organique n’est configuré : ce document ne compare ' +
        'la quantité épandue à aucune valeur. Document produit à partir des apports ' +
        'enregistrés dans Parcelys.',
  };
}

/**
 * Registre phytopharmaceutique au format électronique.
 *
 * ## Pourquoi un second registre phyto
 *
 * Le registre « Registre phytosanitaire » est fait pour être **lu** : dates à
 * la française, dose et unité dans la même case, nombres avec virgule. Le
 * format électronique exigé à partir du 1er janvier 2027 (règlement
 * d'exécution (UE) 2023/564 modifié par le règlement (UE) 2025/2203 ; arrêté
 * du 24 décembre 2025) doit être **lisible par machine** : une information par
 * colonne, dates ISO 8601, nombres à point décimal, codes plutôt que libellés
 * quand il en existe. C'est ce que produit ce jeu-ci.
 *
 * ## Année civile
 *
 * La conversion au format électronique se compte par année civile (« avant le
 * 31 janvier de l'année suivant l'utilisation »). `year` désigne donc ici
 * l'année civile, et non la campagne culturale comme pour les autres
 * registres.
 *
 * ## Rien n'est complété
 *
 * Une mention absente reste une case vide, comptée en tête du document. Le
 * code culture est celui de la déclaration PAC quand la parcelle y est
 * rapprochée ; le code OEPP, que le règlement européen prévoit, n'est pas
 * connu de Parcelys et n'est pas deviné. La conduite biologique vient du
 * traitement, ou à défaut du profil de l'exploitation quand celui-ci la tranche
 * (toute en bio, ou sans bio).
 */
export async function buildPhytoElectronicDataset(
  filters: DatasetFilters,
): Promise<ExportDataset> {
  const parcelIds = await resolveParcelIds(filters);
  const range =
    filters.from || filters.to
      ? { gte: filters.from, lte: filters.to }
      : filters.year
        ? {
            gte: new Date(Date.UTC(filters.year, 0, 1)),
            lte: new Date(Date.UTC(filters.year, 11, 31, 23, 59, 59)),
          }
        : undefined;

  const [rows, farm, provenance] = await Promise.all([
    prisma.phytosanitaryApplication.findMany({
      where: { parcelId: { in: parcelIds }, ...(range ? { appliedOn: range } : {}) },
      include: {
        parcel: {
          select: {
            name: true,
            internalNumber: true,
            centroidLat: true,
            centroidLng: true,
            pacFeatures: {
              where: { kind: 'PARCELLE' },
              select: {
                numero: true,
                cropCode: true,
                ilot: { select: { numero: true } },
                campaign: { select: { year: true } },
              },
            },
          },
        },
        cropYear: { include: { crop: true } },
      },
      orderBy: [{ appliedOn: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.farm.findUnique({
      where: { id: filters.farmId },
      select: { siret: true, organicFarming: true },
    }),
    ephyProvenance(),
  ]);

  const siret = farm?.siret?.replace(/\s/g, '') || '';
  const bioDuProfil =
    farm?.organicFarming === 'TOTALE' ? true : farm?.organicFarming === 'AUCUNE' ? false : null;
  const nombre = (v: unknown): number | string => {
    if (v === null || v === undefined) return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  };
  const ouiNon = (v: boolean | null): string => (v === true ? 'oui' : v === false ? 'non' : '');
  const APPLICATEUR: Record<string, string> = {
    EXPLOITATION: 'exploitation',
    PRESTATAIRE: 'prestataire',
    ENTRAIDE: 'entraide',
  };

  /** Déclaration PAC de la parcelle pour l'année du traitement, ou la plus proche. */
  const declaration = (
    features: Array<{ numero: string | null; cropCode: string | null; ilot: { numero: string } | null; campaign: { year: number } }>,
    annee: number,
  ) =>
    [...features].sort(
      (a, b) => Math.abs(a.campaign.year - annee) - Math.abs(b.campaign.year - annee) || b.campaign.year - a.campaign.year,
    )[0] ?? null;

  let sansAmm = 0;
  let sansBio = 0;
  let sansLieu = 0;
  let sansCible = 0;
  let sansOperateur = 0;

  const lignes = rows.map((r) => {
    const pac = declaration(r.parcel.pacFeatures, r.appliedOn.getUTCFullYear());
    const bio = r.organicProduction ?? bioDuProfil;
    if (!r.amm) sansAmm += 1;
    if (bio === null) sansBio += 1;
    if (!pac?.ilot && (r.parcel.centroidLat === null || r.parcel.centroidLng === null)) sansLieu += 1;
    if (!r.targetLabel) sansCible += 1;
    if (!r.operator) sansOperateur += 1;
    return {
      identifiant: r.id,
      date_utilisation: r.appliedOn.toISOString().slice(0, 10),
      heure_debut: r.startTime ?? '',
      heure_fin: r.endTime ?? '',
      siret_exploitation: siret,
      application_par: r.appliedBy ? APPLICATEUR[r.appliedBy] ?? '' : '',
      intervenant_nom: r.contractorName ?? '',
      intervenant_siret: r.contractorSiret ?? '',
      parcelle: r.parcel.name,
      numero_interne: r.parcel.internalNumber ?? '',
      campagne_pac: pac ? pac.campaign.year : '',
      ilot_pac: pac?.ilot?.numero ?? '',
      parcelle_pac: pac?.numero ?? '',
      latitude: r.parcel.centroidLat === null ? '' : Number(r.parcel.centroidLat.toFixed(6)),
      longitude: r.parcel.centroidLng === null ? '' : Number(r.parcel.centroidLng.toFixed(6)),
      surface_traitee_ha: nombre(r.treatedAreaHa),
      culture: r.cropYear?.crop.name ?? r.cropLabel ?? '',
      code_culture_pac: pac?.cropCode ?? '',
      stade_bbch: r.bbchStage ?? '',
      agriculture_biologique: ouiNon(bio),
      produit: r.productName,
      numero_amm: r.amm ?? '',
      substances_actives: r.activeSubstances ?? '',
      dose: nombre(r.dose),
      unite_dose: r.doseUnit,
      quantite_utilisee: nombre(r.quantityUsed),
      unite_quantite: r.quantityUnit,
      volume_bouillie_l_ha: nombre(r.sprayVolumeLHa),
      cible: r.targetLabel ?? '',
      operateur: r.operator ?? '',
      observations: r.notes ?? '',
      enregistre_le: r.createdAt.toISOString(),
      modifie_le: r.updatedAt.toISOString(),
    };
  });

  const notices: string[] = [];
  if (!siret) notices.push('SIRET de l’exploitation non renseigné (Paramètres) : la colonne siret_exploitation est vide.');
  if (sansBio > 0)
    notices.push(
      `${sansBio} ligne(s) sans mention « agriculture biologique » : renseignez la conduite bio de l’exploitation (Paramètres), ou la mention sur chaque traitement si l’exploitation est en partie en bio.`,
    );
  if (sansAmm > 0) notices.push(`${sansAmm} ligne(s) sans numéro d’AMM.`);
  if (sansLieu > 0)
    notices.push(`${sansLieu} ligne(s) sans localisation : ni îlot PAC rapproché, ni contour de parcelle.`);
  if (sansCible > 0) notices.push(`${sansCible} ligne(s) sans cible.`);
  if (sansOperateur > 0) notices.push(`${sansOperateur} ligne(s) sans opérateur.`);

  const periode =
    filters.from || filters.to
      ? `Période : ${fmtDate(filters.from) || '…'} → ${fmtDate(filters.to) || '…'}`
      : filters.year
        ? `Année civile ${filters.year}`
        : 'Toutes périodes';

  const col = (key: string, header: string, align?: 'left' | 'right'): ExportColumn => ({
    key,
    header,
    ...(align ? { align } : {}),
  });

  return {
    title: 'Registre phytosanitaire numérique',
    subtitle: `${filters.farmName}${siret ? ` — SIRET ${siret}` : ''} — ${periode}`,
    summary: [
      { label: 'Utilisations', value: String(lignes.length) },
      { label: 'Mentions à compléter', value: String(notices.length) },
    ],
    notices: notices.length > 0 ? notices : undefined,
    orientation: 'landscape',
    footnote:
      'Format électronique structuré : une information par colonne, dates ISO 8601 ' +
      '(AAAA-MM-JJ), heures HH:MM, nombres à point décimal. Heures et stade BBCH ne sont ' +
      'renseignés que lorsque l’autorisation du produit les encadre. Localisation : îlot et ' +
      'parcelle de la déclaration PAC la plus proche de la date du traitement, et ' +
      'coordonnées du centre de la parcelle (WGS 84). Code culture : nomenclature PAC ; le ' +
      'code OEPP n’est pas connu de Parcelys et n’est pas deviné. ' +
      provenance,
    columns: [
      col('identifiant', 'identifiant'),
      col('date_utilisation', 'date_utilisation'),
      col('heure_debut', 'heure_debut'),
      col('heure_fin', 'heure_fin'),
      col('siret_exploitation', 'siret_exploitation'),
      col('application_par', 'application_par'),
      col('intervenant_nom', 'intervenant_nom'),
      col('intervenant_siret', 'intervenant_siret'),
      col('parcelle', 'parcelle'),
      col('numero_interne', 'numero_interne'),
      col('campagne_pac', 'campagne_pac'),
      col('ilot_pac', 'ilot_pac'),
      col('parcelle_pac', 'parcelle_pac'),
      col('latitude', 'latitude', 'right'),
      col('longitude', 'longitude', 'right'),
      col('surface_traitee_ha', 'surface_traitee_ha', 'right'),
      col('culture', 'culture'),
      col('code_culture_pac', 'code_culture_pac'),
      col('stade_bbch', 'stade_bbch'),
      col('agriculture_biologique', 'agriculture_biologique'),
      col('produit', 'produit'),
      col('numero_amm', 'numero_amm'),
      col('substances_actives', 'substances_actives'),
      col('dose', 'dose', 'right'),
      col('unite_dose', 'unite_dose'),
      col('quantite_utilisee', 'quantite_utilisee', 'right'),
      col('unite_quantite', 'unite_quantite'),
      col('volume_bouillie_l_ha', 'volume_bouillie_l_ha', 'right'),
      col('cible', 'cible'),
      col('operateur', 'operateur'),
      col('observations', 'observations'),
      col('enregistre_le', 'enregistre_le'),
      col('modifie_le', 'modifie_le'),
    ],
    rows: lignes,
  };
}

export const DATASET_BUILDERS = {
  parcelles: buildParcelDataset,
  phytosanitaire: buildPhytoDataset,
  'registre-phyto-numerique': buildPhytoElectronicDataset,
  apports: buildFertilizationDataset,
  'bilan-engrais': buildFertilizerBalanceDataset,
  travaux: buildOperationsDataset,
  cultures: buildCropsDataset,
  historique: buildHistoryDataset,
  'cahier-epandage': buildSpreadingLogDataset,
} as const;

export type DatasetName = keyof typeof DATASET_BUILDERS;
