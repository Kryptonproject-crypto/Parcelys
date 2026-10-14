/**
 * Ce qu'une culture est, au sens des règles qui la visent.
 *
 * Le 7e programme d'actions régional nomme des cultures : « maïs », « céréales
 * à paille d'hiver », « colza d'hiver », « vergers de noyers », « cultures
 * maraîchères ». Parcelys, lui, connaît des cultures saisies par l'exploitant
 * ou importées de TéléPAC sous leur code de déclaration.
 *
 * ## Ce que ce module s'autorise
 *
 * Reconnaître une famille **quand le nom ou la catégorie de la culture la dit
 * sans ambiguïté** — « Maïs grain », « Orge d'hiver », « Colza d'hiver ». Et
 * en déduire la saison d'implantation de la date de semis enregistrée, ou du
 * nom quand il la porte.
 *
 * ## Ce qu'il s'interdit
 *
 * Traduire un code TéléPAC (« BTH », « CZH ») : aucun fichier fourni ne publie
 * la nomenclature, et Parcelys ne l'écrit pas de mémoire. Une culture dont le
 * nom n'est qu'un code reste **non reconnue**, et la règle qui en dépend reste
 * indéterminée — l'exploitant renomme la culture une fois, et c'est réglé pour
 * toutes les campagnes.
 *
 * Pur : sans base, sans date courante. Testable tel quel.
 */

export type Famille =
  | 'cereale-paille'
  | 'mais'
  | 'sorgho'
  | 'colza'
  | 'noyer'
  | 'maraichage'
  | 'prairie'
  | 'autre';

export type CultureReglementaire = {
  /** `null` : non reconnue. */
  famille: Famille | null;
  /** Saison d'implantation, quand elle se lit. */
  saison: 'hiver' | 'printemps' | null;
  /** Comment la famille et la saison ont été établies, en clair. */
  preuve: string;
};

function normaliser(texte: string | null | undefined): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CEREALES = /\b(ble|bles|orge|orges|avoine|avoines|seigle|seigles|triticale|triticales|epeautre|epeautres)\b/;

export function cultureReglementaire(params: {
  nom: string | null;
  categorie?: string | null;
  /** Date de semis enregistrée, si elle l'est. */
  semis?: Date | null;
}): CultureReglementaire {
  const nom = normaliser(params.nom);
  const categorie = normaliser(params.categorie);

  let famille: Famille | null = null;
  if (/\bmais\b/.test(nom)) famille = 'mais';
  else if (/\bsorgho\b/.test(nom)) famille = 'sorgho';
  else if (/\bcolza\b/.test(nom)) famille = 'colza';
  else if (/\bnoyer|\bnoix\b/.test(nom)) famille = 'noyer';
  else if (/\bmeteil\b/.test(nom)) famille = 'autre';
  else if (CEREALES.test(nom)) famille = 'cereale-paille';
  else if (/\bprairie|\bpature\b|\bray grass\b/.test(nom)) famille = 'prairie';
  else if (/legume|maraich/.test(categorie) || /maraich/.test(nom)) famille = 'maraichage';

  let saison: CultureReglementaire['saison'] = null;
  let preuveSaison = '';
  if (/\bhiver\b/.test(nom)) {
    saison = 'hiver';
    preuveSaison = 'le nom de la culture dit « hiver »';
  } else if (/\bprintemps\b/.test(nom)) {
    saison = 'printemps';
    preuveSaison = 'le nom de la culture dit « printemps »';
  } else if (params.semis) {
    // Semis d'août à décembre : culture implantée à l'automne, donc d'hiver ;
    // de janvier à juin : culture de printemps. Juillet ne tranche pas.
    const mois = params.semis.getUTCMonth() + 1;
    if (mois >= 8 && mois <= 12) {
      saison = 'hiver';
      preuveSaison = `semis enregistré le ${params.semis.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`;
    } else if (mois >= 1 && mois <= 6) {
      saison = 'printemps';
      preuveSaison = `semis enregistré le ${params.semis.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`;
    }
  }

  const preuve = famille
    ? `« ${params.nom} » reconnue comme ${LIBELLES[famille]}${preuveSaison ? `, ${saison === 'hiver' ? 'd’hiver' : 'de printemps'} (${preuveSaison})` : ''}`
    : `« ${params.nom ?? 'culture sans nom'} » n’est pas reconnue : renommez-la (ex. « Blé tendre d’hiver ») pour que les règles qui la visent s’appliquent`;

  return { famille, saison, preuve };
}

export const LIBELLES: Record<Famille, string> = {
  'cereale-paille': 'céréale à paille',
  mais: 'maïs',
  sorgho: 'sorgho',
  colza: 'colza',
  noyer: 'noyer',
  maraichage: 'culture maraîchère',
  prairie: 'prairie',
  autre: 'autre culture',
};

/**
 * Composition d'un couvert d'après les espèces saisies.
 *
 * Seules des espèces nommément légumineuses, et rien d'autre, font des
 * « légumineuses pures » ; une seule autre espèce en fait un mélange. Rien de
 * saisi : inconnu.
 */
const LEGUMINEUSES = /\b(trefle|trefles|vesce|vesces|feverole|feveroles|pois|luzerne|lentille|lentilles|soja|lupin|lupins|sainfoin|lotier|fenugrec|gesse|serradelle|minette|fenu grec)\b/;
const GRAMINEES = /\b(seigle|avoine|ray grass|raygrass|orge|ble|triticale|moha|fetuque|dactyle|brome|fleole|sorgho|millet)\b/;

export function compositionCouvert(especes: string | null | undefined): {
  legumineusesPures: boolean | null;
  contientLegumineuses: boolean | null;
  gramineesPures: boolean | null;
  especes: string[];
} {
  const brut = (especes ?? '').trim();
  if (!brut) return { legumineusesPures: null, contientLegumineuses: null, gramineesPures: null, especes: [] };
  const liste = brut
    .split(/[,;+/]|\bet\b/i)
    .map((e) => e.trim())
    .filter(Boolean);
  const leg = liste.map((e) => LEGUMINEUSES.test(normaliser(e)));
  const gram = liste.map((e) => GRAMINEES.test(normaliser(e)));
  return {
    legumineusesPures: leg.every(Boolean),
    contientLegumineuses: leg.some(Boolean),
    gramineesPures: gram.every(Boolean),
    especes: liste,
  };
}
