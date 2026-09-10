import type { HistoryEvent } from '@/lib/services/history';
import type { NutrientBalance } from '@/lib/services/fertilization';

export type ParcelSummary = {
  id: string;
  name: string;
  internalNumber: string | null;
  commune: string | null;
  inseeCode: string | null;
  lieuDit: string | null;
  cadastralRef: string | null;
  pacId: string | null;
  parcelType: string | null;
  status: string;
  notes: string | null;
  areaHa: number;
  centroidLat: number | null;
  centroidLng: number | null;
  /** Sol artificiellement drainé. `null` = non renseigné, pas « non drainé ». */
  drainedSoil: boolean | null;
  createdAt: string;
};

export type CropYearRow = {
  id: string;
  cropId: string;
  cropName: string;
  campaignYear: number;
  variety: string | null;
  sowingDate: string | null;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  yieldValue: string | null;
  yieldUnit: string | null;
  notes: string | null;
};

export type FertilizationRow = {
  id: string;
  appliedOn: string;
  inputType: 'ORGANIC' | 'MINERAL';
  productLabel: string;
  dose: string;
  doseUnit: string;
  treatedAreaHa: string;
  totalQuantity: string;
  totalUnit: string;
  nSupplied: string | null;
  pSupplied: string | null;
  kSupplied: string | null;
  supplier: string | null;
  batchNumber: string | null;
  cropName: string | null;
  notes: string | null;
};

export type PhytoRow = {
  id: string;
  appliedOn: string;
  productName: string;
  amm: string | null;
  activeSubstances: string | null;
  targetLabel: string | null;
  dose: string;
  doseUnit: string;
  sprayVolumeLHa: string | null;
  treatedAreaHa: string;
  quantityUsed: string;
  quantityUnit: string;
  weatherSummary: string | null;
  weatherTempC: string | null;
  weatherWindKmh: string | null;
  weatherHumidity: string | null;
  operator: string | null;
  productStatus: string | null;
  notes: string | null;
};

export type OperationRow = {
  id: string;
  performedOn: string;
  type: string;
  equipment: string | null;
  operator: string | null;
  durationHours: string | null;
  notes: string | null;
  /** Renseigné pour `type === 'IRRIGATION'` seulement. */
  irrigationMm: string | null;
  irrigationVolumeM3Ha: string | null;
  waterSource: string | null;
  waterNitrateMgL: string | null;
};

/**
 * Un couvert d'interculture.
 *
 * `incoherences` porte les erreurs de saisie repérées sans aucun référentiel —
 * une destruction avant le semis. Rien de réglementaire n'y figure : les
 * périodes obligatoires relèvent du programme d'actions régional.
 */
export type SoilCoverRow = {
  id: string;
  kind: string;
  species: string | null;
  sownOn: string | null;
  emergedOn: string | null;
  destroyedOn: string | null;
  destructionMethod: string | null;
  areaHa: string | null;
  incoherences: string[];
};

export type DocumentRow = {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  category: string;
  description: string | null;
  createdAt: string;
};

export type Referentials = {
  crops: Array<{ id: string; name: string; category: string | null }>;
  fertilizers: Array<{
    id: string;
    name: string;
    category: string | null;
    nPercent: string | null;
    pPercent: string | null;
    kPercent: string | null;
    defaultUnit: string;
  }>;
  organicInputs: Array<{
    id: string;
    name: string;
    category: string | null;
    nContent: string | null;
    pContent: string | null;
    kContent: string | null;
    defaultUnit: string;
  }>;
};

export type EphySource = {
  label: string;
  lastSyncAt: string | null;
  productsInBase: number;
  configured: boolean;
};

export type ParcelTabsProps = {
  activeTab: string;
  canWrite: boolean;
  parcel: ParcelSummary;
  campaignYear: number;
  cropYears: CropYearRow[];
  fertilizations: FertilizationRow[];
  balance: NutrientBalance;
  phytoTreatments: PhytoRow[];
  operations: OperationRow[];
  soilCovers: SoilCoverRow[];
  documents: DocumentRow[];
  history: HistoryEvent[];
  referentials: Referentials;
  ephySource: EphySource;
  /**
   * Contexte réglementaire déduit de la géométrie : zonages recoupant la
   * parcelle et surfaces concernées. `null` quand il n'a jamais été calculé,
   * `undefined` quand l'appelant ne le fournit pas (vue expert, par exemple).
   */
  regulatoryContext?:
    | (import('@/lib/regulatory/geography').ParcelContext & {
        computedAt: string;
        commune: string | null;
      })
    | null;
};
