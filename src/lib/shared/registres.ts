/**
 * Registres d'une parcelle, tels que l'application de terrain les affiche.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FORMAT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Au champ, la question qui précède une intervention est presque toujours la
 * même : « qu'est-ce qui a déjà été fait ici ? » — quel produit, à quelle
 * date, combien d'azote depuis le début de la campagne. L'application ne savait
 * que **saisir** ; pour relire, il fallait le site, donc le bureau.
 *
 * Ce module décrit la fiche que le serveur envoie
 * (`GET /api/mobile/registres`) : les mêmes rubriques que la fiche parcelle du
 * site — général, cultures et couverts, apports, phytosanitaire, travaux,
 * historique —, déjà mises en forme côté serveur (libellés, conditions,
 * événements d'historique) pour que le téléphone n'ait rien à réinterpréter.
 *
 * Les nombres voyagent en `number` et les dates en chaîne ISO : rien qui
 * demande une bibliothèque à l'arrivée.
 *
 * Partagé avec l'application (`@commun/registres`) : une seule définition, que
 * le compilateur vérifie des deux côtés.
 */

/**
 * Change quand le format change : l'application jette alors son cache.
 *
 * 2 (0.11.2) : chaque enregistrement porte aussi ses valeurs brutes (codes,
 * identifiants, champs que la fiche n'affiche pas), pour être **corrigé**
 * depuis le téléphone sans rien perdre de ce que le formulaire ne montre pas.
 *
 * 3 (0.12.0) : les traitements portent les mentions du registre en vigueur au
 * 1er janvier 2026 — heures, stade, conduite bio, prestataire.
 */
export const FORMAT_REGISTRES = 3;

export type TypeEvenement = 'CROP' | 'HARVEST' | 'FERTILIZATION' | 'PHYTO' | 'OPERATION' | 'DOCUMENT';

export const LIBELLES_EVENEMENT: Record<TypeEvenement, string> = {
  CROP: 'Culture',
  HARVEST: 'Récolte',
  FERTILIZATION: 'Apport',
  PHYTO: 'Phytosanitaire',
  OPERATION: 'Travail',
  DOCUMENT: 'Document',
};

export type EvenementFiche = {
  id: string;
  kind: TypeEvenement;
  date: string;
  title: string;
  details: string[];
};

export type CultureFiche = {
  id: string;
  cropId: string;
  campaignYear: number;
  notes: string | null;
  cropName: string;
  variety: string | null;
  sowingDate: string | null;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  yieldValue: number | null;
  yieldUnit: string | null;
  /** Plan prévisionnel de fumure enregistré ; `null` = pas encore établi. */
  planFumure: { doseKgHa: number | null; bloquants: number } | null;
};

export type CouvertFiche = {
  id: string;
  /** Code (`CIPAN`…), pour la correction. */
  kind: string;
  kindLabel: string;
  destructionMethod: string | null;
  cropYearId: string | null;
  areaHa: number | null;
  notes: string | null;
  species: string | null;
  sownOn: string | null;
  emergedOn: string | null;
  destroyedOn: string | null;
  destructionLabel: string | null;
  /** Dates incohérentes (levée avant semis…), dites telles quelles. */
  incoherences: string[];
};

export type ApportFiche = {
  id: string;
  appliedOn: string;
  organique: boolean;
  inputType: 'MINERAL' | 'ORGANIC';
  fertilizerId: string | null;
  organicInputId: string | null;
  cropYearId: string | null;
  supplier: string | null;
  batchNumber: string | null;
  operator: string | null;
  productLabel: string;
  dose: number;
  doseUnit: string;
  treatedAreaHa: number;
  totalQuantity: number;
  totalUnit: string;
  /** kg/ha ; `null` = teneur inconnue, et non zéro. */
  n: number | null;
  p: number | null;
  k: number | null;
  cropName: string | null;
  notes: string | null;
};

export type BilanFiche = {
  totalN: number;
  totalP: number;
  totalK: number;
  perHectareN: number;
  perHectareP: number;
  perHectareK: number;
  /** Apports sans teneur en azote connue : le bilan est alors sous-estimé. */
  incompleteCount: number;
};

export type TraitementFiche = {
  id: string;
  appliedOn: string;
  /** Produit du catalogue E-Phy ; `null` en saisie libre. */
  productId: string | null;
  cropYearId: string | null;
  cropLabel: string | null;
  sprayVolumeLHa: number | null;
  /** Lot de stock de la sortie rattachée, s'il n'y en a qu'une. */
  stockLotId: string | null;
  productName: string;
  amm: string | null;
  activeSubstances: string | null;
  targetLabel: string | null;
  dose: number;
  doseUnit: string;
  treatedAreaHa: number;
  quantityUsed: number;
  quantityUnit: string;
  /** Conditions relevées, en clair ; `null` = non renseignées. */
  conditions: string | null;
  operator: string | null;
  notes: string | null;
  /** Mentions du registre en vigueur au 1er janvier 2026 ; `null` = non renseigné. */
  startTime: string | null;
  endTime: string | null;
  bbchStage: string | null;
  organicProduction: boolean | null;
  appliedBy: 'EXPLOITATION' | 'PRESTATAIRE' | 'ENTRAIDE' | null;
  contractorName: string | null;
  contractorSiret: string | null;
};

/** Qui a appliqué, en clair. */
export const LIBELLES_APPLICATEUR: Record<'EXPLOITATION' | 'PRESTATAIRE' | 'ENTRAIDE', string> = {
  EXPLOITATION: 'L’exploitation',
  PRESTATAIRE: 'Un prestataire',
  ENTRAIDE: 'Entraide',
};

export type TravailFiche = {
  id: string;
  performedOn: string;
  /** Code (`LABOUR`…), pour la correction. */
  type: string;
  typeLabel: string;
  notes: string | null;
  irrigationMm: number | null;
  irrigationVolumeM3Ha: number | null;
  waterSource: string | null;
  waterNitrateMgL: number | null;
  waterAnalysisOn: string | null;
  equipment: string | null;
  operator: string | null;
  durationHours: number | null;
  /** Observations ; pour une irrigation, volume et analyse d'eau en tête. */
  observations: string | null;
};

export type FicheParcelle = {
  parcelId: string;
  general: {
    inseeCode: string | null;
    cadastralRef: string | null;
    pacId: string | null;
    parcelType: string | null;
    statusLabel: string;
    notes: string | null;
    createdAt: string;
    centroid: { lat: number; lng: number } | null;
    declarationsPac: Array<{
      campagne: number;
      ilot: string | null;
      numero: string | null;
      culture: string | null;
    }>;
  };
  cultures: CultureFiche[];
  couverts: CouvertFiche[];
  apports: ApportFiche[];
  /** Cumul de tous les apports, comme sur le site ; `null` sans apport. */
  bilan: BilanFiche | null;
  traitements: TraitementFiche[];
  travaux: TravailFiche[];
  historique: EvenementFiche[];
  /** Documents rattachés : ils se consultent sur le site. */
  documents: number;
};

export type RegistresMobile =
  | {
      format: number;
      /** Empreinte des données : identique, rien n'a changé depuis. */
      version: string;
      unchanged: true;
    }
  | {
      format: number;
      version: string;
      unchanged: false;
      farmId: string;
      campaignYear: number;
      generatedAt: string;
      parcels: Record<string, FicheParcelle>;
    };
