import { cultureReglementaire } from '@/lib/regulatory/culture-reglementaire';
import type { Pulverisateur } from '@/lib/shared/pulverisateur';
import { familleDeLaCondition, type ZntAquatique } from './limites';

/**
 * Ce que le pulvérisateur de l'exploitation change aux distances à respecter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX DISTANCES, DEUX RÈGLES DE RÉDUCTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **ZNT des points d'eau.** Une ZNT de 20 m ou de 50 m peut être ramenée à
 * 5 m si trois conditions sont réunies : un dispositif végétalisé permanent
 * d'au moins 5 m de large borde le point d'eau, le traitement est fait avec un
 * moyen inscrit sur la liste officielle réduisant la dérive d'au moins 66 %,
 * et il est enregistré au registre. Une ZNT de 100 m ou plus ne se réduit pas
 * (arrêté du 4 mai 2017, annexe 3 ; DRAAF Auvergne-Rhône-Alpes, « Protection
 * des points d'eau »).
 *
 * **Habitations.** Quand l'autorisation du produit ne fixe pas de distance,
 * l'arrêté du 4 mai 2017 modifié en fixe une : 20 m incompressibles pour les
 * produits portant les mentions de danger les plus graves, 10 m pour les
 * cultures hautes, 5 m pour les autres. Dans le cadre d'une charte
 * d'engagements approuvée par le préfet, et avec un matériel réduisant la
 * dérive, 5 m deviennent 3 m (matériel d'au moins 66 %). Les produits de
 * biocontrôle et à faible risque en sont exemptés. Depuis 2023, une partie
 * des produits suspectés CMR (catégorie 2) est soumise à 10 m incompressibles,
 * selon une liste du ministère. (Ministère de l'Agriculture, « Distances de
 * sécurité à proximité des habitations » ; DRAAF Bourgogne-Franche-Comté,
 * support ZNT 2024 ; préfecture des Deux-Sèvres, charte riverains.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE PARCELYS NE SAIT PAS, ET DIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · s'il y a un dispositif végétalisé le long du point d'eau : la réduction
 *     de la ZNT est donc toujours dite **sous condition** ;
 *   · si le produit figure sur la liste ministérielle des CMR 2 à 10 m : elle
 *     n'est pas importée ;
 *   · si la charte du département est approuvée : c'est l'exploitant qui le
 *     déclare, en disant s'il l'applique ;
 *   · de combien se réduit la distance d'une culture haute : la réduction
 *     dépend de la culture et du matériel, et les textes consultés ne
 *     concordent pas — elle n'est pas chiffrée.
 *
 * Le pulvérisateur non renseigné n'est jamais supposé équipé : la phrase dit
 * alors ce que la réduction demanderait.
 */

export const SOURCE_REDUCTION_ZNT = 'arrêté du 4 mai 2017, annexe 3';
export const SOURCE_RIVERAINS =
  'arrêté du 4 mai 2017 modifié, distances de sécurité au voisinage des habitations';

function normaliser(texte: string | null | undefined): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function materielDeclare(p: Pulverisateur): string {
  return `réduction de la dérive d’au moins ${p.reductionDerivePct} % déclarée${p.materiel ? ` — ${p.materiel}` : ''}`;
}

// ---------------------------------------------------------------------------
// Culture haute ou basse
// ---------------------------------------------------------------------------

/**
 * Les cultures hautes de l'arrêté : arboriculture, viticulture, arbres et
 * arbustes, forêt, petits fruits, cultures ornementales de plus de 50 cm,
 * bananiers, houblon. Toutes les autres sont des cultures basses.
 */
const HAUTES =
  /\b(vignes?|viticult\w*|vergers?|fruits? a (pepins|noyau|coque)|cultures? fruitieres?|arboricult\w*|pommiers?|poiriers?|cognassiers?|pechers?|abricotiers?|pruniers?|cerisiers?|amandiers?|noyers?|noisetiers?|chataigniers?|oliviers?|agrumes?|kiwis?|figuiers?|avocatiers?|manguiers?|papayers?|arbres? et arbustes|forets?|sylvicult\w*|peupliers?|bananiers?|houblons?|cassissiers?|framboisiers?|groseilliers?|myrtilliers?|petits? fruits)\b/;

/** Haute ou basse selon la hauteur, ou sans culture désignée : Parcelys ne tranche pas. */
const AMBIGUES =
  /\b(fraisiers?|rosiers?|ornement\w*|florales?|plantes vertes|traitements generaux|jevi|jardins?|porte graines?|adjuvants?|pepinieres?|sapins?)\b/;

/** Cultures basses reconnaissables à leur nom, au-delà des familles du moteur. */
const BASSES =
  /\b(tournesol|soja|pois|feveroles?|lupins?|luzernes?|trefles?|sainfoin|vesces?|betteraves?|pommes? de terre|lin|lentilles?|sarrasin|millet|moha|chanvre|tabac|jacheres?|couverts?|cipan|melanges?|ray grass|fetuques?|dactyles?|legum\w*|potag\w*|carottes?|oignons?|salades?|laitues?|choux?|epinards?|haricots?|courges?|melons?|tomates?|moutardes?|phacelies?|radis|navettes?|gazons?)\b/;

export type ClasseCulture = { classe: 'haute' | 'basse' | null; preuve: string };

export function classeDeCulture(params: {
  /** Nom de la culture de la parcelle. */
  culture: string | null;
  /** Culture de l'usage E-Phy retenu (« Blé*Trt Part.Aer.*Désherbage »). */
  usage: string | null;
}): ClasseCulture {
  const usage = params.usage?.split('*')[0]?.trim() || null;
  const textes = [usage, params.culture].filter((t): t is string => Boolean(t && t.trim()));

  for (const t of textes) {
    if (HAUTES.test(normaliser(t))) return { classe: 'haute', preuve: `« ${t} » est une culture haute` };
  }
  for (const t of textes) {
    if (AMBIGUES.test(normaliser(t))) {
      return { classe: null, preuve: `« ${t} » peut être une culture haute ou basse selon sa hauteur` };
    }
  }
  // L'usage E-Phy vient d'une liste fermée : ce qui n'y est ni haut ni
  // ambigu est une culture basse.
  if (usage) return { classe: 'basse', preuve: `usage « ${usage} »` };
  if (params.culture) {
    const famille = cultureReglementaire({ nom: params.culture }).famille;
    if ((famille && famille !== 'noyer') || BASSES.test(normaliser(params.culture))) {
      return { classe: 'basse', preuve: `« ${params.culture} »` };
    }
    return { classe: null, preuve: `« ${params.culture} » n’est pas reconnue` };
  }
  return { classe: null, preuve: 'culture non renseignée' };
}

// ---------------------------------------------------------------------------
// ZNT des points d'eau
// ---------------------------------------------------------------------------

/**
 * La ZNT aquatique peut-elle être réduite, avec ce pulvérisateur ?
 *
 * Ne dit rien d'une ZNT de 5 m (la plus étroite) ni d'une largeur que
 * l'annexe 3 ne vise pas.
 */
export function reductionZntAquatique(params: {
  produit: string;
  aquatique: ZntAquatique;
  conditions: Array<{ label: string }>;
  pulverisateur: Pulverisateur;
}): string | null {
  const a = params.aquatique;
  const metres = a.origine === 'indeterminee' ? null : a.metres;
  if (metres === null || metres <= 5) return null;

  const tete = `ZNT aquatique de ${metres} m pour ${params.produit}`;
  if (metres >= 100) {
    return `${tete} : non réductible, quel que soit le matériel (${SOURCE_REDUCTION_ZNT}).`;
  }
  if (metres !== 20 && metres !== 50) return null;

  // Une autorisation qui impose elle-même un dispositif végétalisé en fixe la
  // largeur, souvent selon la saison : la réduction se lit sur l'étiquette, et
  // la phrase de l'ANSES est rendue telle quelle.
  const dvp = [
    ...new Set(
      params.conditions
        .map((c) => c.label.replace(/^\s*condition\s*:\s*/i, '').replace(/\s+/g, ' ').trim())
        .filter(
          (t) =>
            /dispositif\s+v[ée]g[ée]talis[ée]/i.test(t) &&
            /zone non trait/i.test(t) &&
            /points? d['’]eau|aquatique/i.test(t),
        ),
    ),
  ];
  if (dvp.length > 0) {
    return (
      `${tete} : l’autorisation impose un dispositif végétalisé permanent — ` +
      `${dvp.slice(0, 2).map((t) => `« ${t} »`).join(' ; ')}. ` +
      'La réduction possible se lit sur l’étiquette : Parcelys ne la calcule pas.'
    );
  }

  const conditions =
    'un dispositif végétalisé permanent d’au moins 5 m de large borde le point d’eau et le traitement est enregistré au registre';
  const p = params.pulverisateur;
  if (p.reductionDerivePct === null) {
    return (
      `${tete} : réductible à 5 m avec un moyen inscrit sur la liste officielle réduisant la dérive d’au moins 66 %, ` +
      `si ${conditions} (${SOURCE_REDUCTION_ZNT}). Renseignez votre pulvérisateur dans Paramètres : Parcelys vous dira si le vôtre le permet.`
    );
  }
  if (p.reductionDerivePct >= 66) {
    return (
      `${tete} : avec votre pulvérisateur (${materielDeclare(p)}), elle peut être ramenée à 5 m le long d’un point d’eau où ` +
      `${conditions}. Sans dispositif végétalisé : ${metres} m (${SOURCE_REDUCTION_ZNT}).`
    );
  }
  return (
    `${tete} : non réductible avec votre pulvérisateur (` +
    `${p.reductionDerivePct === 0 ? 'aucun moyen anti-dérive déclaré' : `réduction de la dérive déclarée : ${p.reductionDerivePct} %`}) — ` +
    `la réduction à 5 m demande un moyen inscrit sur la liste officielle réduisant la dérive d’au moins 66 % (${SOURCE_REDUCTION_ZNT}).`
  );
}

// ---------------------------------------------------------------------------
// Habitations
// ---------------------------------------------------------------------------

/** Mentions de danger qui imposent 20 m incompressibles. */
const VINGT_METRES = /^H(300|310|330|331|334|340|350i?|360(F|D|FD|Fd|Df)?)$/;
/**
 * Mentions que les sources consultées laissent en suspens : la liste
 * officielle se termine par « … » après H360Df. Parcelys ne tranche pas.
 */
const VINGT_METRES_A_VERIFIER = /^H(370|372)$/;
/** Suspectés cancérogènes, mutagènes ou toxiques pour la reproduction. */
const CMR2 = /^H(341|351|361(d|f|fd)?)$/;

type Option = { metres: number; derive: number | 'liste' | null };

/**
 * Les options d'une condition d'emploi « riverains » de l'ANSES :
 * « Respecter une distance d'au moins 10 mètres … et utiliser un matériel
 * permettant une atténuation de la dérive d'au moins 90 %. Ou à défaut,
 * respecter une distance d'au moins 20 mètres … d'au moins 66 %. »
 *
 * `null` quand le texte ne se lit pas sans risque : une portée particulière
 * (« Pour les usages sur vigne… », « en mélange avec… »), un autre repère
 * (« autour du local de traitement »), ou aucune distance chiffrée.
 */
function optionsDeLaCondition(texte: string): Option[] | null {
  const t = texte.replace(/^\s*condition\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (/^(-\s*)?(pour|selon|en cas|si|lors)\b/i.test(t)) return null;
  if (/autour du local/i.test(t)) return null;
  const options: Option[] = [];
  for (const morceau of t.split(/ou à défaut,?/i)) {
    const distance = morceau.match(/distance(?: de s[ée]curit[ée])? (?:d['’]au moins |de )(\d+(?:[.,]\d+)?)\s*m/i);
    if (!distance) return null;
    const pct = morceau.match(/d[ée]rive d['’]au moins (\d+)\s*%/i);
    const liste = /mat[ée]riel\s+homologu[ée]/i.test(morceau);
    options.push({
      metres: Number(distance[1]!.replace(',', '.')),
      derive: pct ? Number(pct[1]) : liste ? 'liste' : null,
    });
  }
  return options.length > 0 ? options : null;
}

function exigence(o: Option): string {
  if (o.derive === null) return `${o.metres} m`;
  if (o.derive === 'liste') return `${o.metres} m avec un matériel inscrit sur la liste officielle`;
  return `${o.metres} m avec un matériel réduisant la dérive d’au moins ${o.derive} %`;
}

function satisfaite(o: Option, p: Pulverisateur): boolean | null {
  if (o.derive === null) return true;
  if (p.reductionDerivePct === null) return null;
  if (o.derive === 'liste') return p.reductionDerivePct > 0;
  return p.reductionDerivePct >= o.derive;
}

/** La distance réglementaire quand l'autorisation se tait, pour une culture. */
function distanceParDefaut(culture: ClasseCulture, p: Pulverisateur): string {
  if (culture.classe === 'haute') {
    return (
      `10 m (culture haute : ${culture.preuve}), réductible dans le cadre de la charte départementale ` +
      'avec un matériel anti-dérive performant — Parcelys ne chiffre pas cette réduction'
    );
  }
  if (culture.classe === null) {
    return `5 m pour une culture basse, 10 m pour une culture haute (${culture.preuve})`;
  }
  const base = `5 m (culture basse : ${culture.preuve})`;
  const pct = p.reductionDerivePct;
  if (pct === null) {
    return `${base}, réductible à 3 m avec un matériel réduisant la dérive d’au moins 66 % et la charte d’engagements de votre département — renseignez votre pulvérisateur dans Paramètres`;
  }
  if (pct < 66) {
    return `${base} : la réduction à 3 m demande un matériel réduisant la dérive d’au moins 66 % (${pct === 0 ? 'aucun déclaré' : `${pct} % déclaré`})`;
  }
  if (p.charteRiverains === true) {
    return `3 m avec votre pulvérisateur (${materielDeclare(p)}) dans le cadre de la charte d’engagements que vous appliquez ; ${base} sinon`;
  }
  if (p.charteRiverains === false) {
    return `${base} : la réduction à 3 m demande d’appliquer la charte d’engagements approuvée par le préfet`;
  }
  return `${base}, réductible à 3 m avec votre matériel si vous appliquez la charte d’engagements approuvée par le préfet (à indiquer dans Paramètres)`;
}

/**
 * La distance à respecter vis-à-vis des habitations, pour ce produit, cette
 * culture et ce pulvérisateur.
 *
 * Dans l'ordre : l'autorisation du produit, qui prévaut toujours ;
 * l'exemption des produits de biocontrôle et à faible risque ; les mentions
 * de danger ; enfin la distance de l'arrêté selon la culture.
 */
export function rappelRiverains(params: {
  produit: string;
  mentionsAutorisees: string | null;
  dangers: Array<{ code: string; label: string | null }>;
  conditions: Array<{ category: string; label: string }>;
  culture: ClasseCulture;
  pulverisateur: Pulverisateur;
}): string {
  const tete = `Riverains — ${params.produit}`;
  const p = params.pulverisateur;
  const pres =
    'Près des lieux accueillant des personnes vulnérables (écoles, établissements de santé…), aucune réduction.';

  // 1. L'autorisation du produit fixe la distance.
  const textes = [
    ...new Set(
      params.conditions
        .filter((c) => familleDeLaCondition(c.category, c.label) === 'riverains')
        .map((c) => c.label.replace(/\s+/g, ' ').trim()),
    ),
  ];
  if (textes.length > 0) {
    const lues = textes.map(optionsDeLaCondition);
    const options = lues.length === 1 ? lues[0] : null;
    if (!options) {
      return (
        `${tete} : l’autorisation du produit fixe la distance aux habitations selon l’usage ou le mélange — ` +
        `${textes
          .slice(0, 3)
          .map((t) => `« ${t.replace(/^\s*condition\s*:\s*/i, '')} »`)
          .join(' ; ')}${textes.length > 3 ? ` (et ${textes.length - 3} autre(s))` : ''}.`
      );
    }
    const triees = [...options].sort((a, b) => a.metres - b.metres);
    const retenue = triees.find((o) => satisfaite(o, p) === true);
    const inconnu = triees.some((o) => satisfaite(o, p) === null);
    if (triees.length === 1 && triees[0]!.derive === null) {
      return `${tete} : ${triees[0]!.metres} m des habitations, fixés par l’autorisation du produit, qui prévaut sur l’arrêté.`;
    }
    if (retenue) {
      // Une option plus courte reste peut-être ouverte, si le pulvérisateur
      // n'est pas renseigné : le dire plutôt que de la taire.
      const plusCourteInconnue = triees.some((o) => o.metres < retenue.metres && satisfaite(o, p) === null);
      return (
        `${tete} : ${retenue.metres} m des habitations ${retenue.derive === null ? 'sans exigence de matériel' : `avec votre pulvérisateur (${materielDeclare(p)})`}, ` +
        `d’après l’autorisation du produit (${triees.map(exigence).join(', ou à défaut ')}).` +
        (plusCourteInconnue ? ' Renseignez votre pulvérisateur dans Paramètres : une distance plus courte est peut-être permise.' : '')
      );
    }
    if (inconnu) {
      return (
        `${tete} : l’autorisation du produit prévoit ${triees.map(exigence).join(', ou à défaut ')}. ` +
        'Renseignez votre pulvérisateur dans Paramètres : Parcelys vous dira laquelle s’applique.'
      );
    }
    return (
      `${tete} : aucune option de l’autorisation ne correspond au pulvérisateur déclaré ` +
      `(${triees.map(exigence).join(', ou à défaut ')}). Lisez l’étiquette avant de traiter près d’habitations.`
    );
  }

  // 2. Biocontrôle et faible risque : exemptés.
  const mentions = params.mentionsAutorisees ?? '';
  if (/biocontr[oô]le|faible risque/i.test(mentions)) {
    return `${tete} : pas de distance réglementaire aux habitations — produit ${/biocontr/i.test(mentions) ? 'de biocontrôle' : 'à faible risque'}, exempté (${SOURCE_RIVERAINS}). L’étiquette fait foi.`;
  }

  const codes = params.dangers.map((d) => ({ ...d, code: d.code.trim() }));
  const decrire = (liste: typeof codes) =>
    liste.map((d) => `${d.code}${d.label ? ` (${d.label.replace(/\.$/, '')})` : ''}`).join(', ');

  // 3. Mentions de danger.
  const graves = codes.filter((d) => VINGT_METRES.test(d.code));
  if (graves.length > 0) {
    return (
      `${tete} : 20 m des habitations, incompressibles — le produit porte ${decrire(graves)} (${SOURCE_RIVERAINS}). ` +
      'Aucune réduction, quel que soit le matériel.'
    );
  }
  const defaut = distanceParDefaut(params.culture, p);
  const aVerifier = codes.filter((d) => VINGT_METRES_A_VERIFIER.test(d.code));
  if (aVerifier.length > 0) {
    return (
      `${tete} : distance indéterminée — 20 m incompressibles si la mention ${decrire(aVerifier)} fait partie de celles que vise l’arrêté, ` +
      `ce que Parcelys n’a pas pu vérifier ; sinon ${defaut}. Lisez l’étiquette.`
    );
  }
  const cmr2 = codes.filter((d) => CMR2.test(d.code));
  if (cmr2.length > 0) {
    return (
      `${tete} : distance indéterminée — produit suspecté CMR (${decrire(cmr2)}) : 10 m incompressibles s’il figure sur la liste ` +
      `ministérielle des produits CMR 2 concernés, que Parcelys n’a pas ; sinon ${defaut}. Lisez l’étiquette.`
    );
  }

  // 4. La distance de l'arrêté.
  const bio = /agriculture biologique/i.test(mentions)
    ? ' Produit utilisable en agriculture biologique : il peut en être exempté — vérifiez.'
    : '';
  return `${tete} : ${defaut} (${SOURCE_RIVERAINS}). ${pres}${bio}`;
}
