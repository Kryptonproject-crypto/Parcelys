/**
 * Couche d'adaptation TéléPAC, versionnée par campagne.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE SAIT, ET CE QU'IL NE SAIT PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le format d'échange de TéléPAC est décrit dans les notices officielles
 * publiées chaque campagne par le ministère de l'Agriculture et l'ASP. Ces
 * notices n'ont **pas** pu être consultées lors de l'écriture de ce module.
 * Conformément à la règle que s'est donnée le projet — ne jamais présenter une
 * donnée réglementaire non vérifiée —, le schéma exact n'est donc pas codé en
 * dur ici.
 *
 * Ce que fait ce module à la place :
 *
 *   · il lit ce qu'on lui donne, quel que soit le nom des colonnes ;
 *   · il **propose** une correspondance, à partir de noms de colonnes
 *     couramment rencontrés dans les exports parcellaires français ;
 *   · il présente cette proposition à l'utilisateur, qui la confirme ou la
 *     corrige avant tout écriture en base.
 *
 * Autrement dit : le programme suggère, l'agriculteur tranche. C'est plus lent
 * qu'une correspondance automatique, et c'est le seul comportement défendable
 * tant que le schéma n'a pas été vérifié sur la notice de la campagne.
 *
 * Quand la notice d'une campagne aura été lue, il suffira d'ajouter un adaptateur
 * (`TELEPAC_2027`) déclarant ses colonnes comme certaines : rien d'autre ne
 * bouge dans Parcelys. Voir docs/telepac.md, section « Limites ».
 */

import type { PacFeatureKind } from '@prisma/client';

/** Degré de confiance d'une correspondance de colonne. */
export type MappingConfidence =
  /** Nom relevé dans une source officielle vérifiée. */
  | 'officiel'
  /** Nom courant, proposé — à confirmer par l'utilisateur. */
  | 'propose'
  /** Rien de reconnu. */
  | 'inconnu';

export type FieldGuess = {
  /** Colonne du fichier retenue, ou `null` si rien ne correspond. */
  column: string | null;
  confidence: MappingConfidence;
  /** Les autres colonnes qui pourraient convenir, pour le sélecteur. */
  candidates: string[];
};

/** Correspondance complète, telle que présentée à l'utilisateur. */
export type FieldMapping = {
  externalId: FieldGuess;
  ilot: FieldGuess;
  numero: FieldGuess;
  cropCode: FieldGuess;
  cropLabel: FieldGuess;
  area: FieldGuess;
};

export type MappingChoice = Partial<Record<keyof FieldMapping, string | null>>;

export type TelepacAdapter = {
  /** Campagne couverte. */
  readonly year: number;
  readonly label: string;
  /**
   * Ce que l'adaptateur peut affirmer de la campagne. Affiché tel quel dans
   * l'interface : l'utilisateur doit savoir sur quoi il s'appuie.
   */
  readonly provenance: string;
  /** Devine la correspondance des colonnes d'un fichier. */
  guessMapping(columns: string[]): FieldMapping;
  /** Devine la nature d'une couche d'après le nom de son fichier. */
  guessKind(filename: string): PacFeatureKind;
};

// ---------------------------------------------------------------------------
// Heuristique de correspondance
// ---------------------------------------------------------------------------

/** Comparaison insensible à la casse, aux accents et à la ponctuation. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Noms de colonnes couramment rencontrés, du plus précis au plus général.
 *
 * Ce sont des **propositions**, pas une spécification. Un nom trouvé ici est
 * présenté à l'utilisateur comme « proposé », jamais comme certain.
 */
const CANDIDATS: Record<keyof FieldMapping, string[]> = {
  externalId: ['idparcel', 'id_parcel', 'identifiant', 'idparcelle', 'pacage', 'id'],
  ilot: ['numilot', 'num_ilot', 'ilot', 'numeroilot', 'idilot', 'codeilot'],
  numero: ['numparcel', 'num_parcel', 'numparcelle', 'numero', 'nparcelle', 'parcelle'],
  cropCode: ['codecultu', 'code_cultu', 'codeculture', 'cultucode', 'culture', 'codegroup'],
  cropLabel: ['libcultu', 'libelleculture', 'nomculture', 'libelle', 'culturelib'],
  area: ['surfparc', 'surf_parc', 'surface', 'surfadm', 'surfacegraphique', 'surfha', 'contenance'],
};

function guessField(columns: string[], champ: keyof FieldMapping): FieldGuess {
  const parNormalise = new Map(columns.map((c) => [normalize(c), c]));

  for (const candidat of CANDIDATS[champ]) {
    const trouve = parNormalise.get(candidat);
    if (trouve) return { column: trouve, confidence: 'propose', candidates: columns };
  }

  // Correspondance partielle : « SURF_PARC_HA » pour « surfparc ».
  for (const candidat of CANDIDATS[champ]) {
    for (const [normalise, original] of parNormalise) {
      if (normalise.includes(candidat)) {
        return { column: original, confidence: 'propose', candidates: columns };
      }
    }
  }

  return { column: null, confidence: 'inconnu', candidates: columns };
}

function guessMapping(columns: string[]): FieldMapping {
  return {
    externalId: guessField(columns, 'externalId'),
    ilot: guessField(columns, 'ilot'),
    numero: guessField(columns, 'numero'),
    cropCode: guessField(columns, 'cropCode'),
    cropLabel: guessField(columns, 'cropLabel'),
    area: guessField(columns, 'area'),
  };
}

/**
 * Nature d'une couche, d'après le nom du fichier.
 *
 * Une couche non reconnue devient `AUTRE` : elle est conservée telle quelle
 * plutôt qu'écartée ou, pire, transformée d'office en parcelles. Un dossier PAC
 * ne contient pas que des parcelles, et tout ranger sous ce nom ferait perdre
 * la distinction que la déclaration exige.
 */
function guessKind(filename: string): PacFeatureKind {
  const nom = normalize(filename);
  if (nom.includes('sna')) return 'SNA';
  if (nom.includes('zdh')) return 'ZDH';
  if (nom.includes('parcel')) return 'PARCELLE';
  if (nom.includes('ilot')) return 'AUTRE'; // traité à part, comme îlot
  return 'AUTRE';
}

/** Un nom de fichier désigne-t-il la couche des îlots ? */
export function looksLikeIlotLayer(filename: string): boolean {
  const nom = normalize(filename);
  return nom.includes('ilot') && !nom.includes('parcel');
}

// ---------------------------------------------------------------------------
// Adaptateurs par campagne
// ---------------------------------------------------------------------------

const PROVENANCE_NON_VERIFIEE =
  "Correspondance proposée d'après des noms de colonnes courants. La notice " +
  "officielle de la campagne n'a pas pu être consultée : vérifiez les colonnes " +
  "ci-dessous avant d'importer.";

function makeAdapter(year: number): TelepacAdapter {
  return {
    year,
    label: `Campagne PAC ${year}`,
    provenance: PROVENANCE_NON_VERIFIEE,
    guessMapping,
    guessKind,
  };
}

/**
 * Adaptateurs connus.
 *
 * Ajouter une campagne revient à ajouter une entrée : le reste de Parcelys
 * n'a pas à changer. C'est tout l'objet de cette couche.
 */
const ADAPTERS = new Map<number, TelepacAdapter>([
  [2024, makeAdapter(2024)],
  [2025, makeAdapter(2025)],
  [2026, makeAdapter(2026)],
  [2027, makeAdapter(2027)],
]);

/**
 * Adaptateur d'une campagne.
 *
 * Une campagne inconnue reçoit un adaptateur générique plutôt qu'une erreur :
 * refuser d'ouvrir un dossier parce que l'année n'est pas dans une liste serait
 * gênant sans rien protéger — la correspondance est de toute façon confirmée
 * par l'utilisateur.
 */
export function getTelepacAdapter(year: number): TelepacAdapter {
  return ADAPTERS.get(year) ?? makeAdapter(year);
}

export function knownCampaigns(): number[] {
  return [...ADAPTERS.keys()].sort((a, b) => b - a);
}

/** Applique les choix de l'utilisateur par-dessus la proposition. */
export function applyChoice(mapping: FieldMapping, choice: MappingChoice): FieldMapping {
  const applique = { ...mapping };
  for (const cle of Object.keys(choice) as Array<keyof FieldMapping>) {
    const colonne = choice[cle];
    if (colonne === undefined) continue;
    applique[cle] = {
      column: colonne,
      // Un choix de l'utilisateur vaut mieux qu'une proposition du programme.
      confidence: colonne ? 'officiel' : 'inconnu',
      candidates: mapping[cle].candidates,
    };
  }
  return applique;
}

/** Lit une valeur d'attribut selon la correspondance retenue. */
export function pickAttribute(
  attributes: Record<string, string | number | null>,
  guess: FieldGuess,
): string | null {
  if (!guess.column) return null;
  const valeur = attributes[guess.column];
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return String(valeur);
}
