/**
 * Correspondance des colonnes du jeu de données officiel E-Phy.
 *
 * L'export publié sur data.gouv.fr est un ZIP de fichiers CSV (séparateur `;`,
 * encodage Windows-1252). Les intitulés de colonnes varient légèrement d'une
 * édition à l'autre : on associe donc chaque champ interne à une liste d'alias,
 * comparés après normalisation (minuscules, sans accents ni ponctuation).
 *
 * Aucune valeur n'est déduite ni complétée : si une colonne est absente du
 * fichier, le champ correspondant reste vide en base.
 */

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalisation utilisée pour la recherche insensible aux accents/casse. */
export function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type ColumnMap<T extends string> = Record<T, string[]>;

export type ProductField =
  | 'amm'
  | 'name'
  | 'secondNames'
  | 'holder'
  | 'productType'
  | 'commercialType'
  | 'formulation'
  | 'status'
  | 'substances'
  | 'authorizedMentions'
  | 'usageRestrictions'
  | 'withdrawnAt';

export const PRODUCT_COLUMNS: ColumnMap<ProductField> = {
  amm: ['numero amm', 'numero d amm', 'n amm', 'amm'],
  name: ['nom produit', 'nom du produit', 'denomination'],
  secondNames: ['seconds noms commerciaux', 'second nom commercial', 'autres noms commerciaux'],
  holder: ['titulaire', 'detenteur', 'titulaire de l autorisation'],
  productType: ['fonctions', 'fonction', 'type produit', 'gamme usage'],
  commercialType: ['type commercial'],
  formulation: ['formulations', 'formulation'],
  status: ['etat d autorisation', 'etat autorisation', 'etat d administration', 'etat'],
  substances: ['substances actives', 'substance active', 'substances'],
  authorizedMentions: ['mentions autorisees', 'mention autorisee'],
  usageRestrictions: ['restrictions usage libelle', 'restrictions usage', 'restriction usage'],
  withdrawnAt: ['date de retrait du produit', 'date retrait', 'date de retrait'],
};

export type UsageField =
  | 'amm'
  | 'usageId'
  | 'usageLabel'
  | 'status'
  | 'dose'
  | 'doseUnit'
  | 'preHarvestDelay'
  | 'maxApplications'
  | 'conditions'
  | 'zntAquatic'
  | 'decisionDate';

export const USAGE_COLUMNS: ColumnMap<UsageField> = {
  amm: ['numero amm', 'numero d amm', 'n amm', 'amm'],
  usageId: ['identifiant usage', 'id usage'],
  usageLabel: [
    'identifiant usage lib court',
    'identifiant usage libelle court',
    'libelle usage',
    'usage',
  ],
  status: ['etat usage', 'etat d usage', 'etat'],
  dose: ['dose retenue', 'dose', 'dose max'],
  doseUnit: ['dose retenue unite', 'unite dose', 'dose unite'],
  preHarvestDelay: [
    'delai avant recolte jour',
    'delai avant recolte j',
    'delai avant recolte',
    'dar',
  ],
  maxApplications: [
    'nombre max d application',
    'nombre max d applications',
    'nombre maximum d applications',
  ],
  conditions: ['condition emploi', 'conditions d emploi', 'condition d emploi'],
  zntAquatic: ['znt aquatique m', 'znt aquatique', 'znt eau'],
  decisionDate: ['date decision', 'date de decision'],
};

export type SubstanceField = 'name' | 'casNumber' | 'status';

export const SUBSTANCE_COLUMNS: ColumnMap<SubstanceField> = {
  name: ['nom substance active', 'substance active', 'nom de la substance active', 'nom'],
  casNumber: ['numero cas', 'num cas', 'cas'],
  status: ['etat d approbation', 'etat approbation', 'etat'],
};

/**
 * Le libellé d'usage E-Phy suit la forme `culture*traitement*cible`
 * (ex. « Blé*Trt Part.Aer.*Oïdium »). On le découpe sans reformuler :
 * les segments sont restitués tels quels.
 */
export function splitUsageLabel(label: string | undefined): {
  crop: string | null;
  target: string | null;
} {
  if (!label) return { crop: null, target: null };
  const parts = label.split('*').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { crop: null, target: null };
  return {
    crop: parts[0] ?? null,
    target: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null,
  };
}

/** Fichiers reconnus dans l'archive, par motif de nom. */
export const FILE_PATTERNS = {
  products: /produit/i,
  usages: /usage/i,
  substances: /substance/i,
} as const;
