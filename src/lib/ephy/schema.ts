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
  | 'preHarvestBbch'
  | 'bbchMin'
  | 'bbchMax'
  | 'maxApplications'
  | 'minIntervalDays'
  | 'conditions'
  | 'zntAquatic'
  | 'zntArthropod'
  | 'zntPlant'
  | 'endDistribution'
  | 'endUsage'
  | 'decisionDate';

/**
 * Colonnes des fichiers d'usages.
 *
 * Deux fichiers de l'archive portent des usages, et ils ne nomment pas les
 * choses pareil — voir `USAGE_LABEL_IS_ID` plus bas, qui documente le piège.
 * Les intitulés réels de l'édition 2026-09 sont, pour
 * `usages_des_produits_autorises_utf8.csv` :
 *
 *   identifiant usage lib court · identifiant usage · date decision ·
 *   stade cultural min (BBCH) · stade cultural max (BBCH) · etat usage ·
 *   dose retenue · dose retenue unite · delai avant recolte jour ·
 *   delai avant recolte bbch · nombre max d'application · date fin distribution ·
 *   date fin utilisation · condition emploi · ZNT aquatique (en m) ·
 *   ZNT arthropodes non cibles (en m) · ZNT plantes non cibles (en m)
 *
 * `produits_usages_utf8.csv` y ajoute
 * `intervalle minimum entre applications (jour)` et écrit, faute de frappe
 * comprise dans le fichier officiel, `tade cultural max (BBCH)`. Cet alias-là
 * n'est pas une coquille de notre côté : c'est celle du fichier, et la corriger
 * reviendrait à ne plus lire la colonne.
 */
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
  preHarvestBbch: ['delai avant recolte bbch'],
  bbchMin: ['stade cultural min bbch', 'stade cultural min'],
  bbchMax: ['stade cultural max bbch', 'tade cultural max bbch', 'stade cultural max'],
  maxApplications: [
    'nombre max d application',
    'nombre max d applications',
    'nombre maximum d applications',
  ],
  minIntervalDays: [
    'intervalle minimum entre applications jour',
    'intervalle minimum entre applications',
  ],
  conditions: ['condition emploi', 'conditions d emploi', 'condition d emploi'],
  zntAquatic: ['znt aquatique en m', 'znt aquatique m', 'znt aquatique', 'znt eau'],
  zntArthropod: [
    'znt arthropodes non cibles en m',
    'znt arthropodes non cibles',
    'znt arthropodes',
  ],
  zntPlant: ['znt plantes non cibles en m', 'znt plantes non cibles', 'znt plantes'],
  endDistribution: ['date fin distribution', 'date de fin de distribution'],
  endUsage: ['date fin utilisation', 'date de fin d utilisation'],
  decisionDate: ['date decision', 'date de decision'],
};

export type ConditionField = 'amm' | 'category' | 'label';

/** Colonnes de `produits_condition_emploi_utf8.csv`. */
export const CONDITION_COLUMNS: ColumnMap<ConditionField> = {
  amm: ['numero amm', 'numero d amm', 'n amm', 'amm'],
  category: ['categorie de condition d emploi', 'categorie condition d emploi'],
  label: ['condition d emploi libelle', 'condition emploi libelle', 'libelle'],
};

/**
 * Où se trouve vraiment le libellé d'usage ?
 *
 * Les deux colonnes candidates ne portent pas ce que leur intitulé annonce, et
 * pas de la même façon d'un fichier à l'autre.
 *
 * Dans `usages_des_produits_autorises_utf8.csv`, l'en-tête déclare
 * « identifiant usage lib court » puis « identifiant usage » ; les valeurs
 * arrivent dans l'ordre inverse de ce qu'on attendrait — le code `15105913`
 * sous « lib court », le libellé `Orge*Désherbage` sous « identifiant usage ».
 * Dans `produits_usages_utf8.csv`, il n'y a qu'une colonne, « identifiant
 * usage », et elle porte le libellé.
 *
 * Se fier aux intitulés produirait, au choix, des cultures vides ou des
 * cultures nommées `00610005` — dans les deux cas un catalogue d'apparence
 * complète dont plus aucune dose ne serait rattachée à une culture lisible.
 *
 * On tranche donc sur le contenu : un libellé d'usage E-Phy s'écrit
 * `culture*traitement*cible` et contient toujours des `*`. C'est la seule
 * propriété que les deux fichiers partagent réellement.
 */
export function looksLikeUsageLabel(values: Array<string | undefined>): boolean {
  const renseignes = values.filter((v): v is string => Boolean(v && v.trim()));
  if (renseignes.length === 0) return false;
  const avecEtoile = renseignes.filter((v) => v.includes('*')).length;
  return avecEtoile / renseignes.length > 0.5;
}

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

/**
 * Choix des fichiers de l'archive officielle.
 *
 * L'archive E-Phy contient une dizaine de CSV dont les noms se ressemblent :
 * « produits_utf8.csv » côtoie « produits_classe_et_mention_danger_utf8.csv »,
 * « produits_condition_emploi_utf8.csv », « produits_phrases_de_risque_utf8.csv »…
 * et « usages_des_produits_autorises_utf8.csv » côtoie
 * « mfsc_et_mixte_usage_utf8.csv », qui ne concerne pas les produits
 * phytopharmaceutiques.
 *
 * Un motif large (`/produit/`, `/usage/`) correspond donc à plusieurs fichiers,
 * et retenir « le premier » revient à tirer au sort le référentiel réglementaire.
 * On énumère les noms attendus du plus précis au plus général, et **on refuse de
 * choisir** dès qu'un motif désigne plusieurs fichiers : mieux vaut une erreur
 * explicite qu'un catalogue d'apparence complète bâti sur le mauvais fichier.
 */
export const DATA_FILE_PATTERNS: Record<EphyRole, RegExp[]> = {
  products: [/^produits(?:_utf8)?\.csv$/i, /^produits?_?\d*(?:_utf8)?\.csv$/i],
  usages: [
    /^usages?_des_produits_autorises(?:_utf8)?\.csv$/i,
    /^produits_usages(?:_utf8)?\.csv$/i,
  ],
  substances: [/^substances?_actives?(?:_utf8)?\.csv$/i],
  conditions: [/^produits_condition_emploi(?:_utf8)?\.csv$/i],
};

export type EphyRole = 'products' | 'usages' | 'substances' | 'conditions';

const ROLE_LABELS: Record<EphyRole, string> = {
  products: 'produits',
  usages: 'usages autorisés',
  substances: 'substances actives',
  conditions: "conditions d'emploi",
};

/**
 * Désigne le fichier de l'archive tenant un rôle donné.
 *
 * `names` est la liste des noms de base des CSV présents. Renvoie le nom retenu,
 * ou `null` si aucun ne convient — au contraire d'une ambiguïté, qui lève une
 * erreur : elle signale que l'édition du jeu de données a changé de forme, et
 * c'est à un humain de trancher, pas au programme de deviner.
 */
export function resolveDataFile(names: string[], role: EphyRole): string | null {
  for (const pattern of DATA_FILE_PATTERNS[role]) {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) {
      throw new Error(
        `Plusieurs fichiers « ${ROLE_LABELS[role]} » possibles dans l'archive : ` +
          `${matches.join(', ')}. Le catalogue officiel a probablement changé de ` +
          `structure ; vérifiez l'édition du jeu de données avant d'importer.`,
      );
    }
  }
  return null;
}

/**
 * Champs sans lesquels le catalogue ne doit pas être importé.
 *
 * `status` porte l'état d'autorisation. Sans lui, un produit retiré du marché
 * entrerait en base indistinguable d'un produit autorisé, et l'interface le
 * présenterait comme « vérifié au catalogue » — exactement l'inverse de ce que
 * cette vérification est censée garantir. Un référentiel incomplet est ici plus
 * dangereux qu'un référentiel absent, qui affiche au moins « non vérifié ».
 */
export const REQUIRED_PRODUCT_FIELDS: ProductField[] = ['status'];
