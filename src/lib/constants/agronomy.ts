/**
 * Référentiels agronomiques généraux (cultures, types d'apports, travaux).
 *
 * Attention : ces listes sont des libellés d'usage courant, elles ne contiennent
 * AUCUNE donnée réglementaire. Toutes les informations relatives aux produits
 * phytopharmaceutiques (AMM, usages, doses autorisées, substances actives)
 * proviennent exclusivement de l'import E-Phy (cf. src/lib/ephy).
 */

export type CropSeed = {
  code: string;
  name: string;
  category: string;
};

export const DEFAULT_CROPS: CropSeed[] = [
  { code: 'BLE_TENDRE', name: 'Blé tendre', category: 'Céréales' },
  { code: 'BLE_DUR', name: 'Blé dur', category: 'Céréales' },
  { code: 'ORGE_HIVER', name: "Orge d'hiver", category: 'Céréales' },
  { code: 'ORGE_PRINTEMPS', name: 'Orge de printemps', category: 'Céréales' },
  { code: 'TRITICALE', name: 'Triticale', category: 'Céréales' },
  { code: 'AVOINE', name: 'Avoine', category: 'Céréales' },
  { code: 'SEIGLE', name: 'Seigle', category: 'Céréales' },
  { code: 'MAIS_GRAIN', name: 'Maïs grain', category: 'Céréales' },
  { code: 'MAIS_ENSILAGE', name: 'Maïs ensilage', category: 'Céréales' },
  { code: 'COLZA', name: "Colza d'hiver", category: 'Oléagineux' },
  { code: 'TOURNESOL', name: 'Tournesol', category: 'Oléagineux' },
  { code: 'SOJA', name: 'Soja', category: 'Oléagineux' },
  { code: 'LIN', name: 'Lin oléagineux', category: 'Oléagineux' },
  { code: 'POIS', name: 'Pois protéagineux', category: 'Protéagineux' },
  { code: 'FEVEROLE', name: 'Féverole', category: 'Protéagineux' },
  { code: 'LUPIN', name: 'Lupin', category: 'Protéagineux' },
  { code: 'LUZERNE', name: 'Luzerne', category: 'Fourrages' },
  { code: 'PRAIRIE_TEMPORAIRE', name: 'Prairie temporaire', category: 'Fourrages' },
  { code: 'PRAIRIE_PERMANENTE', name: 'Prairie permanente', category: 'Fourrages' },
  { code: 'PATURE', name: 'Pâture', category: 'Fourrages' },
  { code: 'RAY_GRASS', name: 'Ray-grass', category: 'Fourrages' },
  { code: 'TREFLE', name: 'Trèfle', category: 'Fourrages' },
  { code: 'SORGHO', name: 'Sorgho', category: 'Fourrages' },
  { code: 'BETTERAVE', name: 'Betterave sucrière', category: 'Cultures industrielles' },
  { code: 'POMME_DE_TERRE', name: 'Pomme de terre', category: 'Cultures industrielles' },
  { code: 'VIGNE', name: 'Vigne', category: 'Cultures pérennes' },
  { code: 'VERGER', name: 'Verger', category: 'Cultures pérennes' },
  { code: 'JACHERE', name: 'Jachère', category: 'Autres' },
  { code: 'COUVERT_VEGETAL', name: 'Couvert végétal / CIPAN', category: 'Autres' },
];

export type FertilizerSeed = {
  name: string;
  category: string;
  nPercent?: number;
  pPercent?: number;
  kPercent?: number;
  defaultUnit: string;
};

/** Engrais minéraux courants. Les teneurs sont les formulations standards du
 *  commerce ; elles restent modifiables et l'utilisateur peut créer les siennes. */
export const DEFAULT_FERTILIZERS: FertilizerSeed[] = [
  { name: 'Ammonitrate 33,5 %', category: 'Azote', nPercent: 33.5, defaultUnit: 'kg/ha' },
  { name: 'Ammonitrate 27 %', category: 'Azote', nPercent: 27, defaultUnit: 'kg/ha' },
  { name: 'Urée 46 %', category: 'Azote', nPercent: 46, defaultUnit: 'kg/ha' },
  { name: 'Solution azotée 39', category: 'Azote', nPercent: 39, defaultUnit: 'L/ha' },
  { name: 'Solution azotée 30', category: 'Azote', nPercent: 30, defaultUnit: 'L/ha' },
  { name: 'Sulfate d’ammoniaque 21 %', category: 'Azote', nPercent: 21, defaultUnit: 'kg/ha' },
  { name: 'Superphosphate 45 %', category: 'Phosphore', pPercent: 45, defaultUnit: 'kg/ha' },
  { name: 'Chlorure de potassium 60 %', category: 'Potassium', kPercent: 60, defaultUnit: 'kg/ha' },
  { name: 'Sulfate de potasse 50 %', category: 'Potassium', kPercent: 50, defaultUnit: 'kg/ha' },
  { name: 'NPK 15-15-15', category: 'NPK', nPercent: 15, pPercent: 15, kPercent: 15, defaultUnit: 'kg/ha' },
  { name: 'NPK 18-46-0 (DAP)', category: 'NPK', nPercent: 18, pPercent: 46, defaultUnit: 'kg/ha' },
  { name: 'NPK 0-25-25', category: 'NPK', pPercent: 25, kPercent: 25, defaultUnit: 'kg/ha' },
];

export type OrganicSeed = {
  name: string;
  category: string;
  defaultUnit: string;
};

/** Types d'apports organiques. Les teneurs NPK sont laissées vides : elles
 *  doivent provenir d'une analyse du produit propre à l'exploitation. */
export const DEFAULT_ORGANIC_INPUTS: OrganicSeed[] = [
  { name: 'Fumier bovin', category: 'Fumier', defaultUnit: 't/ha' },
  { name: 'Fumier ovin', category: 'Fumier', defaultUnit: 't/ha' },
  { name: 'Fumier de volaille', category: 'Fumier', defaultUnit: 't/ha' },
  { name: 'Lisier bovin', category: 'Lisier', defaultUnit: 'm3/ha' },
  { name: 'Lisier porcin', category: 'Lisier', defaultUnit: 'm3/ha' },
  { name: 'Compost de déchets verts', category: 'Compost', defaultUnit: 't/ha' },
  { name: 'Digestat de méthanisation', category: 'Digestat', defaultUnit: 'm3/ha' },
  { name: 'Boues de station d’épuration', category: 'Boues', defaultUnit: 't/ha' },
  { name: 'Autre apport organique', category: 'Autre', defaultUnit: 't/ha' },
];

export const DOSE_UNITS = [
  'kg/ha',
  'L/ha',
  't/ha',
  'm3/ha',
  'g/ha',
  'unité/ha',
] as const;

export const TOTAL_UNITS = ['kg', 'L', 't', 'm3', 'g', 'unité'] as const;

/** Unité totale correspondant à une unité de dose (dose × ha). */
export const DOSE_TO_TOTAL_UNIT: Record<string, string> = {
  'kg/ha': 'kg',
  'L/ha': 'L',
  't/ha': 't',
  'm3/ha': 'm3',
  'g/ha': 'g',
  'unité/ha': 'unité',
};

export const YIELD_UNITS = ['q/ha', 't/ha', 'kg/ha', 'hL/ha', 'bottes/ha'] as const;

export const OPERATION_LABELS: Record<string, string> = {
  LABOUR: 'Labour',
  DECHAUMAGE: 'Déchaumage',
  SEMIS: 'Semis',
  ROULAGE: 'Roulage',
  HERSAGE: 'Hersage',
  BROYAGE: 'Broyage',
  FAUCHE: 'Fauche',
  RECOLTE: 'Récolte',
  TRANSPORT: 'Transport',
  IRRIGATION: 'Irrigation',
  AUTRE: 'Autre',
};

export const PARCEL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'En production',
  FALLOW: 'Jachère',
  ARCHIVED: 'Archivée',
};

export const PARCEL_TYPES = [
  'Terre labourable',
  'Prairie permanente',
  'Prairie temporaire',
  'Verger',
  'Vigne',
  'Bois / haie',
  'Autre',
] as const;

export const DOCUMENT_CATEGORIES = [
  'FACTURE',
  'ANALYSE_SOL',
  'PHOTO',
  'ADMINISTRATIF',
  'RESULTAT_ANALYSE',
  'AUTRE',
] as const;

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  FACTURE: 'Facture',
  ANALYSE_SOL: 'Analyse de sol',
  PHOTO: 'Photo',
  ADMINISTRATIF: 'Document administratif',
  RESULTAT_ANALYSE: "Résultat d'analyse",
  AUTRE: 'Autre',
};

/** Campagne culturale : bascule au 1er août (usage courant en grandes cultures). */
export function currentCampaignYear(date = new Date()): number {
  return date.getMonth() >= 7 ? date.getFullYear() + 1 : date.getFullYear();
}
