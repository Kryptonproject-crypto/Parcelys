import { z } from 'zod';

/**
 * Dose prévisionnelle d'azote selon le référentiel GREN, calculée **à partir
 * des fiches importées** — aucune valeur, aucun tableau, aucune formule n'est
 * écrit ici.
 *
 * Le module est pur : il reçoit les règles lues en base (`ReglesGren`), ce que
 * l'on sait de la parcelle et de la campagne (`ContexteGren`) et ce que
 * l'exploitant a déclaré (`SaisieGren`), et rend le calcul **avec son
 * raisonnement** : chaque terme dit sa valeur, la règle dont elle vient et, s'il
 * manque, pourquoi. Un seul terme indispensable manquant suffit : la dose n'est
 * pas calculée, et le calcul dit lequel.
 *
 * ## Ce que fait le moteur
 *
 *  · choisit la fiche par la culture (fiche 1) et la formule par l'ex-région
 *    (les fiches distinguent Auvergne et Rhône-Alpes) ;
 *  · lit chaque terme de la formule dans le tableau de la fiche correspondant,
 *    selon les choix de l'exploitant (type de sol, précédent, système…) ;
 *  · calcule ce que les fiches calculent : Pf = b × y, Nirr = V × C / 443,
 *    Xpro = quantité × teneur × Kéq, Pi du colza par la matière verte ;
 *  · applique la formule telle que transcrite (termes ajoutés, retranchés,
 *    facteur 1/CAU, termes retranchés après le facteur) ;
 *  · applique la règle des petites doses (entre 0 et 30 u : 30 u possibles ;
 *    bilan négatif : aucun apport).
 *
 * ## Ce qu'il refuse
 *
 *  · une cellule vide d'un tableau n'est pas un zéro ;
 *  · un terme dont la fiche n'a pas été transcrite pour l'ex-région (Rf et Mh
 *    de la betterave en Rhône-Alpes, par exemple) bloque le calcul ;
 *  · une formule ambiguë (Pi du maïs en Auvergne) ne se tranche pas : seul
 *    Pi = 0 la rend sans effet ;
 *  · un terme « sans objet » (aucune prairie retournée, aucune culture
 *    intermédiaire, parcelle non irriguée…) n'est nul que si l'exploitant le
 *    déclare — jamais par défaut.
 */

// ---------------------------------------------------------------------------
// Les règles
// ---------------------------------------------------------------------------

export type RegleGren<T = unknown> = {
  code: string;
  valeur: Record<string, unknown>;
  trace: T;
};

export type ReglesGren<T = unknown> = ReadonlyMap<string, RegleGren<T>>;

export function reglesGren<T>(regles: RegleGren<T>[]): ReglesGren<T> {
  return new Map(regles.map((r) => [r.code, r]));
}

type Cle = { nom: string; libelle: string; valeurs: unknown };
type Tableau = { cles: Cle[]; lignes: Array<Record<string, unknown>>; sousRegion?: unknown };

function tableauDe(regle: RegleGren | undefined): Tableau | null {
  if (!regle) return null;
  const { cles, lignes } = regle.valeur as { cles?: unknown; lignes?: unknown };
  if (!Array.isArray(cles) || !Array.isArray(lignes)) return null;
  return regle.valeur as unknown as Tableau;
}

export type OptionCle = { code: string; libelle: string };

function optionsDeCle(tableau: Tableau, cle: Cle): OptionCle[] {
  if (Array.isArray(cle.valeurs)) {
    return (cle.valeurs as Array<{ code?: unknown; libelle?: unknown }>).flatMap((v) =>
      typeof v.code === 'string' ? [{ code: v.code, libelle: String(v.libelle ?? v.code) }] : [],
    );
  }
  // Clé dont les valeurs ne figurent que dans les lignes (fiche 8 : la
  // production dépend de l'utilisation).
  const vues = new Map<string, string>();
  for (const ligne of tableau.lignes) {
    const code = ligne[cle.nom];
    if (typeof code === 'string' && !vues.has(code)) {
      const libelle = ligne[`${cle.nom}Libelle`];
      vues.set(code, typeof libelle === 'string' ? libelle : code);
    }
  }
  return [...vues].map(([code, libelle]) => ({ code, libelle }));
}

const nombreOuNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// La saisie
// ---------------------------------------------------------------------------

const code = z.string().trim().min(1).max(80);
const justification = z.string().trim().min(3, 'Justification requise').max(300);
const valeurJustifiee = z.object({
  valeur: z.number().min(-500).max(2000),
  justification,
});

/** Termes qu'un exploitant peut déclarer sans objet pour sa parcelle. */
export const TERMES_SANS_OBJET = {
  Mhp: 'aucune prairie retournée au cours des deux dernières années',
  MrCI: 'aucune culture intermédiaire avant cette culture',
  Mpro: 'aucun apport organique régulier lors des campagnes antérieures',
  Mha: 'aucun historique d’apport de produit organique',
  Nirr: 'parcelle non irriguée pendant la campagne',
} as const;
export type TermeSansObjet = keyof typeof TERMES_SANS_OBJET;

export const saisieGrenSchema = z.object({
  /** Culture au sens de la fiche 1 (`gren-cultures`). */
  culture: code,
  /** Type de sol de la fiche 21, commun à tous les tableaux qui le demandent. */
  typeSol: code.optional(),
  /** Espèce, pour le besoin unitaire b (fiches 2 et 3). */
  espece: code.optional(),
  /**
   * Besoin unitaire quand la fiche renvoie au tableau des variétés (blé) ou à
   * une règle (méteil, mélange) : soit la valeur « variété non référencée »
   * de la fiche, soit la valeur de la variété, déclarée et justifiée.
   */
  besoin: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('variete-non-referencee') }),
      z.object({ mode: z.literal('declare'), valeur: z.number().positive().max(50), justification }),
    ])
    .optional(),
  objectif: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('historique') }),
      z.object({ mode: z.literal('defaut'), cultureFiche20: code, regimeHydrique: code }),
      z.object({ mode: z.literal('declare'), valeur: z.number().positive().max(2000), justification }),
    ])
    .optional(),
  /** Choix faits dans les tableaux, par terme puis par clé. */
  choix: z.record(z.string().max(20), z.record(z.string().max(40), code)).default({}),
  /** Valeurs mesurées (reliquat Ri, Pi), avec leur justification. */
  mesures: z.record(z.string().max(20), valeurJustifiee).default({}),
  sansObjet: z.array(z.enum(['Mhp', 'MrCI', 'Mpro', 'Mha', 'Nirr'])).default([]),
  irrigation: z
    .object({ volumeMm: z.number().min(0).max(2000), nitratesMgL: z.number().min(0).max(1000) })
    .optional(),
  colza: z
    .object({
      mvSortieHiver: z.number().min(0).max(20).optional(),
      mvEntreeHiver: z.number().min(0).max(20).optional(),
      profondeur: z.enum(['superficiel', 'profond']).optional(),
      precedentPois: z.boolean().optional(),
      legumineusesGelives: z.boolean().optional(),
    })
    .optional(),
  maisSemence: z
    .object({
      rendementReference: z.number().min(0).max(200).optional(),
      dispositif: code.optional(),
      cau: code.optional(),
    })
    .optional(),
  /** Groupe de culture du tableau Kéq de la fiche 19. */
  groupeCultureKeq: code.optional(),
  /**
   * Apports organiques **prévus** sur la culture. Les apports déjà réalisés
   * et rattachés à la culture s'y ajoutent d'eux-mêmes : on ne les ressaisit
   * pas.
   */
  apportsPrevus: z
    .array(
      z.object({
        organicInputId: z.string().trim().min(1).max(40),
        dose: z.number().positive().max(1000),
        unite: z.enum(['t/ha', 'm3/ha', 'kg/ha', 'L/ha']),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .max(20)
    .default([]),
  /** Ligne de plafond retenue, pour une culture conduite au plafond. */
  plafond: z
    .object({ option: code, choix: z.record(z.string().max(40), code).optional() })
    .optional(),
});

export type SaisieGren = z.infer<typeof saisieGrenSchema>;

// ---------------------------------------------------------------------------
// Le contexte
// ---------------------------------------------------------------------------

export type ApportOrganiqueGren = {
  id: string;
  libelle: string;
  /** AAAA-MM-JJ. */
  date: string;
  /** Quantité épandue par hectare, dans l'unité des teneurs (t ou m³). `null` : non convertible. */
  quantiteParHa: number | null;
  /** Teneur en azote de l'analyse du produit, kg N/t ou m³. */
  teneurAnalyse: number | null;
  classement: { keq: string | null; teneur: string | null; aplsh: string | null };
  /** Apport prévu au plan, ou déjà réalisé. */
  prevu: boolean;
};

export type ContexteGren = {
  campagne: number;
  /** Département de la parcelle, d'après son code INSEE. */
  departement: string | null;
  /**
   * Rendements de la culture sur l'exploitation, par campagne antérieure,
   * déjà ramenés à l'hectare (moyenne pondérée par la surface).
   */
  rendements: Array<{ campagne: number; valeur: number; unite: string | null }>;
  apportsOrganiques: ApportOrganiqueGren[];
  /** La culture est-elle d'hiver (semée l'année précédant la récolte) ? */
  cultureDHiver: boolean | null;
};

// ---------------------------------------------------------------------------
// Le résultat
// ---------------------------------------------------------------------------

export type TermeCalcule = {
  terme: string;
  libelle: string;
  valeur: number | null;
  /** D'où vient la valeur, en clair. */
  origine: string;
  /** Codes des règles employées. */
  regles: string[];
  /** Pourquoi la valeur manque. */
  manque?: string;
  /** Détail, quand il y en a un (lignes de Xpro, calcul de Pi…). */
  detail?: string[];
  /** Unité, quand ce n'est pas des kg N/ha (objectif de rendement). */
  unite?: string;
};

export type CalculGren = {
  culture: { code: string; libelle: string; fiche: number | null; methode: string } | null;
  sousRegion: 'auvergne' | 'rhone-alpes' | null;
  methode: 'bilan' | 'plafond' | null;
  expression: string | null;
  termes: TermeCalcule[];
  /** Résultat de la formule, avant la règle des petites doses. */
  doseCalculeeKgHa: number | null;
  /** Dose prévisionnelle à retenir, en kg N/ha d'engrais minéral. */
  doseKgHa: number | null;
  /** Pour une culture au plafond : la dose plafond lue. */
  plafondKgHa: number | null;
  /** Ce que la règle des petites doses a changé, s'il y a lieu. */
  regleDose: string | null;
  bloquants: Array<{ terme: string; raison: string }>;
  /** Toutes les règles employées, pour la traçabilité. */
  regles: string[];
  avertissements: string[];
};

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

const LIBELLES_TERMES: Record<string, string> = {
  Pf: 'Azote absorbé à la fermeture du bilan (Pf)',
  Rf: 'Reliquat à la fermeture du bilan (Rf)',
  Pi: 'Azote absorbé à l’ouverture du bilan (Pi)',
  Ri: 'Reliquat à l’ouverture du bilan (Ri)',
  Mh: 'Minéralisation de l’humus (Mh)',
  MhMS: 'Minéralisation de l’humus, maïs semence (Mh MS)',
  Mhp: 'Minéralisation due au retournement de prairie (Mhp)',
  Mr: 'Minéralisation des résidus du précédent (Mr)',
  MrCI: 'Minéralisation des résidus de culture intermédiaire (MrCI)',
  Nirr: 'Azote de l’eau d’irrigation (Nirr)',
  Xpro: 'Azote disponible des produits organiques de la campagne (Xpro)',
  Mpro: 'Arrière-effet des apports organiques antérieurs (Mpro)',
  Np: 'Fourniture du sol à l’ouverture du bilan (Np)',
  Mha: 'Historique d’apports organiques (Mha)',
  Fleg: 'Effet d’un précédent pois protéagineux (Fleg)',
  Fass: 'Effet de cultures compagnes (Fass)',
  CAU: 'Coefficient apparent d’utilisation (CAU)',
  y: 'Objectif de rendement (y)',
  b: 'Besoin unitaire (b)',
};

export function libelleTerme(terme: string): string {
  return LIBELLES_TERMES[terme] ?? terme;
}

const arrondi = (v: number, d = 1) => Number(v.toFixed(d));

// ---------------------------------------------------------------------------
// Culture, sous-région, formule
// ---------------------------------------------------------------------------

type CultureFiche1 = { code: string; libelle: string; methode: string; fiche: number | null; plafondKgHaAzoteEfficace?: number };

export function culturesGren(regles: ReglesGren): CultureFiche1[] {
  const liste = regles.get('gren-cultures')?.valeur.cultures;
  return Array.isArray(liste) ? (liste as CultureFiche1[]) : [];
}

export function sousRegionDe(
  regles: ReglesGren,
  departement: string | null,
): 'auvergne' | 'rhone-alpes' | null {
  if (!departement) return null;
  const v = regles.get('gren-sous-regions')?.valeur as
    | Record<string, { departements?: string[] }>
    | undefined;
  if (!v) return null;
  if (v.auvergne?.departements?.includes(departement)) return 'auvergne';
  if (v['rhone-alpes']?.departements?.includes(departement)) return 'rhone-alpes';
  return null;
}

type Formule = {
  expression: string;
  plus?: string[];
  moins?: string[];
  facteur?: 'inverse-cau' | 'un-sur-cau';
  moinsApresFacteur?: string[];
  ambigus?: Array<{ terme: string; explication: string }>;
  nuls?: Record<string, string>;
  plafond?: boolean;
};

function formuleDe(
  regles: ReglesGren,
  fiche: number,
  sousRegion: string,
): { regle: string; formule: Formule; pf: Record<string, unknown> } | null {
  const regle = regles.get(`gren-formule-ft${fiche}`);
  if (!regle) return null;
  const sr = regle.valeur.sousRegions as Record<string, Formule> | undefined;
  const formule = sr?.[sousRegion] ?? sr?.toutes;
  if (!formule) return null;
  return { regle: regle.code, formule, pf: (regle.valeur.pf as Record<string, unknown>) ?? {} };
}

// ---------------------------------------------------------------------------
// Lecture d'un tableau
// ---------------------------------------------------------------------------

type Lecture = { valeur: number | null; manque?: string; detail?: string };

function lireTableau(
  regle: RegleGren,
  choix: Record<string, string> | undefined,
  saisie: SaisieGren,
): Lecture {
  const tableau = tableauDe(regle);
  if (!tableau) return { valeur: null, manque: `Tableau ${regle.code} illisible.` };
  // Une clé ne se demande que si les lignes restantes la portent : dans le
  // tableau Mpro, « apports tous les 2 ans » ne distingue pas le précédent.
  const retenus: Record<string, string> = {};
  const manquants: string[] = [];
  let candidates = tableau.lignes;
  for (const cle of tableau.cles) {
    if (!candidates.some((l) => cle.nom in l)) continue;
    let valeur = choix?.[cle.nom];
    if (!valeur && cle.nom === 'typeSol' && saisie.typeSol) valeur = saisie.typeSol;
    // Une clé dont chaque valeur énumère ses types de sol (la grille Ri de
    // Rhône-Alpes : sols filtrants ou non) se déduit du type de sol déclaré.
    if (!valeur && saisie.typeSol && Array.isArray(cle.valeurs)) {
      const parSol = (cle.valeurs as Array<{ code?: string; typesSol?: unknown }>).find(
        (v) => Array.isArray(v.typesSol) && (v.typesSol as string[]).includes(saisie.typeSol!),
      );
      if (parSol?.code) valeur = parSol.code;
    }
    if (!valeur) {
      manquants.push(cle.libelle);
      continue;
    }
    retenus[cle.nom] = valeur;
    candidates = candidates.filter((l) => !(cle.nom in l) || l[cle.nom] === valeur);
  }
  if (manquants.length > 0) {
    return { valeur: null, manque: `À choisir dans la fiche : ${manquants.join(', ')}.` };
  }
  const enClair = tableau.cles
    .filter((c) => retenus[c.nom] !== undefined)
    .map((c) => {
      const option = optionsDeCle(tableau, c).find((o) => o.code === retenus[c.nom]);
      return `${c.libelle} : ${option?.libelle ?? retenus[c.nom]}`;
    })
    .join(' · ');
  if (candidates.length !== 1) {
    return {
      valeur: null,
      manque:
        candidates.length === 0
          ? `Cette combinaison ne figure pas au tableau (${enClair}).`
          : `Plusieurs lignes du tableau correspondent (${enClair}) : précisez le choix.`,
    };
  }
  const ligne = candidates[0]!;
  const valeur = nombreOuNull(ligne.valeur);
  if (valeur === null) {
    return {
      valeur: null,
      manque: `La cellule du tableau est vide pour cette combinaison (${enClair}) : la fiche ne donne pas de valeur.`,
    };
  }
  return { valeur, detail: enClair };
}

/** Le tableau d'un terme pour une fiche et une ex-région, s'il existe. */
export function tableauDuTerme(
  regles: ReglesGren,
  fiche: number,
  terme: string,
  sousRegion: string,
  departement: string | null,
): RegleGren | null {
  const t = terme.toLowerCase();
  const candidats: string[] = [];
  if (terme === 'Ri' && sousRegion === 'auvergne') {
    const deps = regles.get('gren-ri-departements')?.valeur as Record<string, string> | undefined;
    const nom = deps ? Object.entries(deps).find(([, d]) => d === departement)?.[0] : undefined;
    if (nom) candidats.push(`gren-ft${fiche}-ri-${nom}`);
  } else {
    candidats.push(`gren-ft${fiche}-${t}-${sousRegion}`, `gren-ft${fiche}-${t}`);
  }
  for (const c of candidats) {
    const regle = regles.get(c);
    if (!regle || !tableauDe(regle)) continue;
    const sr = regle.valeur.sousRegion;
    if (typeof sr === 'string' && sr !== sousRegion) continue;
    return regle;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classes (besoin unitaire du maïs, 1/CAU, Pf des femelles)
// ---------------------------------------------------------------------------

type Classe = { min: number | null; max: number | null; inclusMin: boolean; inclusMax: boolean; libelle: string; valeur: number };

function classeDe(classes: Classe[], x: number): Classe | null {
  return (
    classes.find((c) => {
      const auDessus = c.min === null || (c.inclusMin ? x >= c.min : x > c.min);
      const auDessous = c.max === null || (c.inclusMax ? x <= c.max : x < c.max);
      return auDessus && auDessous;
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// Objectif de rendement
// ---------------------------------------------------------------------------

const VERS_QUINTAUX: Record<string, number> = { 'q/ha': 1, 't/ha': 10, 'kg/ha': 0.01 };

function objectifDeRendement(
  regles: ReglesGren,
  contexte: ContexteGren,
  saisie: SaisieGren,
  sousRegion: string,
  uniteAttendue: string,
): TermeCalcule {
  const base = { terme: 'y', libelle: libelleTerme('y'), unite: uniteAttendue };
  const o = saisie.objectif;
  if (!o) {
    return { ...base, valeur: null, origine: '—', regles: [], manque: 'Méthode de l’objectif de rendement non choisie.' };
  }
  if (o.mode === 'declare') {
    return {
      ...base,
      valeur: o.valeur,
      origine: `Déclaré par l’exploitant (${uniteAttendue}) — justification : ${o.justification}`,
      regles: ['gren-objectif-rendement'],
    };
  }
  if (o.mode === 'historique') {
    const regle = regles.get('gren-objectif-rendement');
    const annees = nombreOuNull(regle?.valeur.anneesRetenues) ?? null;
    if (!regle || annees === null) {
      return { ...base, valeur: null, origine: '—', regles: [], manque: 'Méthode de l’objectif de rendement non disponible dans le référentiel.' };
    }
    const fenetre = contexte.rendements.filter(
      (r) => r.campagne >= contexte.campagne - annees && r.campagne < contexte.campagne,
    );
    if (uniteAttendue !== 'q/ha') {
      return {
        ...base,
        valeur: null,
        origine: '—',
        regles: [regle.code],
        manque: `L’objectif s’exprime en ${uniteAttendue} : les rendements enregistrés ne précisent pas la matière sèche. Choisissez la valeur par défaut de la fiche 20 ou déclarez l’objectif.`,
      };
    }
    const convertis = fenetre.map((r) => ({
      ...r,
      q: r.unite && VERS_QUINTAUX[r.unite] !== undefined ? r.valeur * VERS_QUINTAUX[r.unite]! : null,
    }));
    if (convertis.some((r) => r.q === null)) {
      return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Un rendement enregistré a une unité non convertible en q/ha.' };
    }
    if (convertis.length < annees) {
      return {
        ...base,
        valeur: null,
        origine: '—',
        regles: [regle.code],
        manque:
          `${convertis.length} campagne(s) de rendement enregistrée(s) sur les ${annees} demandées : ` +
          'choisissez la valeur par défaut de la fiche 20, ou déclarez l’objectif avec sa justification.',
      };
    }
    const tries = convertis.map((r) => r.q as number).sort((a, b) => a - b);
    const retenus = tries.slice(1, -1);
    const moyenne = retenus.reduce((s, v) => s + v, 0) / retenus.length;
    return {
      ...base,
      valeur: arrondi(moyenne),
      origine: `Moyenne de l’exploitation sur les ${annees} dernières campagnes, hors valeurs extrêmes (${retenus.map((v) => arrondi(v)).join(', ')} q/ha)`,
      regles: [regle.code],
      detail: convertis.map((r) => `${r.campagne} : ${arrondi(r.q as number)} q/ha`),
    };
  }
  // Valeur par défaut de la fiche 20.
  const regle = regles.get('gren-rendements-defaut');
  const lignes = regle?.valeur.lignes as Array<Record<string, unknown>> | undefined;
  if (!regle || !lignes) {
    return { ...base, valeur: null, origine: '—', regles: [], manque: 'Fiche 20 (rendements par défaut) non disponible.' };
  }
  if (!saisie.typeSol) {
    return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Type de sol non choisi.' };
  }
  const ligne = lignes.find(
    (l) =>
      l.sousRegion === sousRegion &&
      l.typeSol === saisie.typeSol &&
      l.regimeHydrique === o.regimeHydrique &&
      l.culture === o.cultureFiche20,
  );
  const valeur = nombreOuNull(ligne?.valeur);
  const cultures = regle.valeur.cultures as Array<{ code: string; libelle: string; unite: string }> | undefined;
  const culture = cultures?.find((c) => c.code === o.cultureFiche20);
  if (culture && culture.unite !== uniteAttendue) {
    return {
      ...base,
      valeur: null,
      origine: '—',
      regles: [regle.code],
      manque: `La culture choisie dans la fiche 20 (${culture.libelle}) s’exprime en ${culture.unite}, la formule attend des ${uniteAttendue}.`,
    };
  }
  if (valeur === null) {
    return {
      ...base,
      valeur: null,
      origine: '—',
      regles: [regle.code],
      manque: ligne
        ? 'La fiche 20 ne donne pas de rendement pour ce sol, ce régime hydrique et cette culture (cellule vide).'
        : 'Cette combinaison ne figure pas à la fiche 20.',
    };
  }
  return {
    ...base,
    valeur,
    origine: `Valeur par défaut de la fiche 20 (${culture?.libelle ?? o.cultureFiche20}, ${o.regimeHydrique === 'irrigue' ? 'irrigué' : 'pluvial'})`,
    regles: [regle.code],
  };
}

// ---------------------------------------------------------------------------
// Pf
// ---------------------------------------------------------------------------

function besoinUnitaire(
  regles: ReglesGren,
  fiche: number,
  saisie: SaisieGren,
  y: number,
): { b: number | null; origine: string; regles: string[]; manque?: string; uniteRendement: string } {
  if (fiche === 2) {
    const regle = regles.get('gren-ft2-besoin-unitaire');
    const especes = (regle?.valeur.especes as Array<Record<string, unknown>> | undefined) ?? [];
    const espece = especes.find((e) => e.code === saisie.espece);
    if (!regle) return { b: null, origine: '—', regles: [], manque: 'Besoins unitaires de la fiche 2 non disponibles.', uniteRendement: 'q/ha' };
    if (!espece) return { b: null, origine: '—', regles: [regle.code], manque: 'Espèce de céréale non choisie.', uniteRendement: 'q/ha' };
    const b = nombreOuNull(espece.b);
    if (b !== null) return { b, origine: `${espece.libelle} : ${b} kg N/q (fiche 2)`, regles: [regle.code], uniteRendement: 'q/ha' };
    const parDefaut = nombreOuNull(espece.bVarieteNonReferencee) ?? nombreOuNull(espece.bqVarieteNonReferencee);
    if (saisie.besoin?.mode === 'declare') {
      return {
        b: saisie.besoin.valeur,
        origine: `${espece.libelle} : ${saisie.besoin.valeur} kg N/q, déclaré — ${saisie.besoin.justification}`,
        regles: [regle.code],
        uniteRendement: 'q/ha',
      };
    }
    if (saisie.besoin?.mode === 'variete-non-referencee' && parDefaut !== null) {
      return {
        b: parDefaut,
        origine: `${espece.libelle}, variété non référencée : ${parDefaut} kg N/q (fiche 2)`,
        regles: [regle.code],
        uniteRendement: 'q/ha',
      };
    }
    return {
      b: null,
      origine: '—',
      regles: [regle.code],
      manque:
        parDefaut !== null
          ? `${espece.libelle} : le besoin dépend de la variété (${String(espece.regle)}). Déclarez celui de votre variété, ou indiquez qu’elle n’est pas référencée.`
          : `${espece.libelle} : ${String(espece.regle)} — déclarez le besoin retenu et sa justification.`,
      uniteRendement: 'q/ha',
    };
  }
  if (fiche === 3) {
    const regle = regles.get('gren-ft3-besoin-unitaire');
    const especes = regle?.valeur.especes as Record<string, { unite: string; rendementUnite: string; classes: Classe[] }> | undefined;
    const espece = saisie.espece ? especes?.[saisie.espece] : undefined;
    if (!regle) return { b: null, origine: '—', regles: [], manque: 'Besoins unitaires de la fiche 3 non disponibles.', uniteRendement: 'q/ha' };
    if (!espece) return { b: null, origine: '—', regles: [regle.code], manque: 'Espèce (maïs grain, ensilage, sorgho…) non choisie.', uniteRendement: 'q/ha' };
    const classe = classeDe(espece.classes, y);
    if (!classe) return { b: null, origine: '—', regles: [regle.code], manque: 'L’objectif de rendement ne tombe dans aucune classe de la fiche 3.', uniteRendement: espece.rendementUnite };
    return { b: classe.valeur, origine: `${classe.valeur} ${espece.unite} (objectif ${classe.libelle} ${espece.rendementUnite}, fiche 3)`, regles: [regle.code], uniteRendement: espece.rendementUnite };
  }
  if (fiche === 4) {
    const regle = regles.get('gren-ft4-colza');
    const b = nombreOuNull(regle?.valeur.b);
    if (!regle || b === null) return { b: null, origine: '—', regles: [], manque: 'Besoin unitaire du colza non disponible.', uniteRendement: 'q/ha' };
    return { b, origine: `${b} ${String(regle.valeur.bUnite ?? 'kg N/q')} (fiche 4)`, regles: [regle.code], uniteRendement: 'q/ha' };
  }
  return { b: null, origine: '—', regles: [], manque: `Besoin unitaire non défini pour la fiche ${fiche}.`, uniteRendement: 'q/ha' };
}

/** Unité de l'objectif de rendement attendue par la fiche, avant tout calcul. */
function uniteObjectif(regles: ReglesGren, fiche: number, saisie: SaisieGren): string {
  if (fiche === 3) {
    const especes = regles.get('gren-ft3-besoin-unitaire')?.valeur.especes as Record<string, { rendementUnite: string }> | undefined;
    return (saisie.espece && especes?.[saisie.espece]?.rendementUnite) || 'q/ha';
  }
  return 'q/ha';
}

function calculerPf(
  regles: ReglesGren,
  fiche: number,
  pf: Record<string, unknown>,
  contexte: ContexteGren,
  saisie: SaisieGren,
  sousRegion: string,
  departement: string | null,
): { pf: TermeCalcule; y: TermeCalcule | null } {
  const base = { terme: 'Pf', libelle: libelleTerme('Pf') };
  const mode = pf.mode;
  if (mode === 'constante') {
    const v = nombreOuNull(pf.valeur);
    return { pf: { ...base, valeur: v, origine: `Valeur fixée par la fiche ${fiche}`, regles: [`gren-formule-ft${fiche}`], ...(v === null ? { manque: 'Valeur absente.' } : {}) }, y: null };
  }
  if (mode === 'table') {
    const regle = tableauDuTerme(regles, fiche, 'Pf', sousRegion, departement);
    if (!regle) return { pf: { ...base, valeur: null, origine: '—', regles: [], manque: `Aucun tableau Pf de la fiche ${fiche} pour cette ex-région.` }, y: null };
    const l = lireTableau(regle, saisie.choix.Pf, saisie);
    return { pf: { ...base, valeur: l.valeur, origine: l.detail ? `Fiche ${fiche} — ${l.detail}` : '—', regles: [regle.code], ...(l.manque ? { manque: l.manque } : {}) }, y: null };
  }
  if (mode === 'femelles-sur-occupation') {
    const regle = regles.get('gren-ft6-mais-semence');
    const v = regle?.valeur as { pfFemelles?: { classes: Classe[] }; coefficientsOccupation?: Array<{ dispositif: string; valeur: number }> } | undefined;
    const ms = saisie.maisSemence;
    if (!regle || !v?.pfFemelles) return { pf: { ...base, valeur: null, origine: '—', regles: [], manque: 'Tableaux du maïs semence non disponibles.' }, y: null };
    if (ms?.rendementReference === undefined) return { pf: { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Rendement de référence du contrat (Rr) non renseigné.' }, y: null };
    const classe = classeDe(v.pfFemelles.classes, ms.rendementReference);
    const coef = v.coefficientsOccupation?.find((c) => c.dispositif === ms.dispositif)?.valeur ?? null;
    if (!classe) return { pf: { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Le rendement de référence ne tombe dans aucune classe de la fiche 6.' }, y: null };
    if (coef === null) return { pf: { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Dispositif de semis non choisi parmi ceux de la fiche 6.' }, y: null };
    return {
      pf: { ...base, valeur: arrondi(classe.valeur / coef), origine: `Pf des femelles ${classe.valeur} (Rr ${classe.libelle} q/ha) ÷ coefficient d’occupation ${coef} (${ms.dispositif})`, regles: [regle.code] },
      y: null,
    };
  }
  // b × y
  const y = objectifDeRendement(regles, contexte, saisie, sousRegion, uniteObjectif(regles, fiche, saisie));
  if (y.valeur === null) {
    return { pf: { ...base, valeur: null, origine: '—', regles: y.regles, manque: `Objectif de rendement : ${y.manque}` }, y };
  }
  const b = besoinUnitaire(regles, fiche, saisie, y.valeur);
  if (b.b === null) {
    return { pf: { ...base, valeur: null, origine: '—', regles: b.regles, manque: `Besoin unitaire : ${b.manque}` }, y };
  }
  let valeur = b.b * y.valeur;
  let origine = `b × y = ${b.origine} × ${y.valeur} ${b.uniteRendement}`;
  const plafond = nombreOuNull(pf.plafond);
  if (plafond !== null && valeur > plafond) {
    origine += ` = ${arrondi(valeur)}, plafonné à ${plafond} (fiche ${fiche})`;
    valeur = plafond;
  }
  return { pf: { ...base, valeur: arrondi(valeur), origine, regles: [...b.regles, ...y.regles] }, y };
}

// ---------------------------------------------------------------------------
// Les autres termes
// ---------------------------------------------------------------------------

function saisonKeq(date: string): 'automne' | 'printemps' | null {
  const mois = Number(date.slice(5, 7));
  if (mois >= 8 && mois <= 12) return 'automne';
  if (mois >= 1 && mois <= 6) return 'printemps';
  return null;
}

function calculerXpro(regles: ReglesGren, contexte: ContexteGren, saisie: SaisieGren): TermeCalcule {
  const base = { terme: 'Xpro', libelle: libelleTerme('Xpro') };
  if (contexte.apportsOrganiques.length === 0) {
    return { ...base, valeur: 0, origine: 'Aucun produit organique apporté ni prévu sur la campagne', regles: [] };
  }
  const keq = regles.get('gren-keq');
  const teneurs = regles.get('gren-teneurs-pro');
  if (!keq) {
    return {
      ...base,
      valeur: null,
      origine: '—',
      regles: [],
      manque:
        'Les coefficients Kéq de la fiche 19 ne sont pas disponibles à cette date (la version de la fiche antérieure au 15/07/2025 n’a pas été fournie).',
    };
  }
  if (!saisie.groupeCultureKeq) {
    return { ...base, valeur: null, origine: '—', regles: [keq.code], manque: 'Groupe de culture du tableau Kéq (fiche 19) non choisi.' };
  }
  const lignesKeq = (keq.valeur.lignes as Array<Record<string, unknown>> | undefined) ?? [];
  const detail: string[] = [];
  const manques: string[] = [];
  const reglesEmployees = new Set<string>([keq.code]);
  let total = 0;
  for (const a of contexte.apportsOrganiques) {
    const nom = `${a.libelle} du ${a.date.split('-').reverse().join('/')}${a.prevu ? ' (prévu)' : ''}`;
    if (a.classement.aplsh?.startsWith('digestats') || a.classement.teneur?.startsWith('digestats')) {
      manques.push(`${nom} : digestat — la fiche 19 ne donne qu’un Kéq indicatif (lisier de porcs majoré de 15 % selon le mode d’épandage)`);
      continue;
    }
    if (a.quantiteParHa === null) {
      manques.push(`${nom} : quantité non convertible dans l’unité des teneurs`);
      continue;
    }
    let teneur = a.teneurAnalyse;
    let origineTeneur = 'analyse';
    if (teneur === null && a.classement.teneur) {
      const produits = (teneurs?.valeur.produits as Array<{ code: string; teneur: unknown }> | undefined) ?? [];
      teneur = nombreOuNull(produits.find((p) => p.code === a.classement.teneur)?.teneur);
      origineTeneur = 'référence fiche 19';
      if (teneurs) reglesEmployees.add(teneurs.code);
    }
    if (teneur === null) {
      manques.push(`${nom} : teneur en azote inconnue (ni analyse, ni teneur de référence de la fiche 19 déclarée)`);
      continue;
    }
    if (!a.classement.keq) {
      manques.push(`${nom} : dénomination Kéq de la fiche 19 non déclarée sur le produit`);
      continue;
    }
    const saison = saisonKeq(a.date);
    if (!saison) {
      manques.push(`${nom} : apport de juillet, ni d’automne ni de printemps au sens du tableau Kéq`);
      continue;
    }
    const ligne = lignesKeq.find(
      (l) => l.pro === a.classement.keq && l.groupeCulture === saisie.groupeCultureKeq && l.saisonApport === saison,
    );
    const k = nombreOuNull(ligne?.valeur);
    if (k === null) {
      manques.push(`${nom} : le tableau Kéq n’a pas de valeur pour ce produit, ce groupe de culture et un apport ${saison === 'automne' ? 'd’automne' : 'de printemps'}`);
      continue;
    }
    const x = a.quantiteParHa * teneur * k;
    total += x;
    detail.push(`${nom} : ${arrondi(a.quantiteParHa, 2)} × ${teneur} kg N (${origineTeneur}) × Kéq ${k} (apport ${saison === 'automne' ? 'd’automne' : 'de printemps'}) = ${arrondi(x)} kg N/ha`);
  }
  if (manques.length > 0) {
    return { ...base, valeur: null, origine: '—', regles: [...reglesEmployees, 'gren-xpro'], manque: manques.join(' ; '), detail };
  }
  return {
    ...base,
    valeur: arrondi(total),
    origine: 'Somme des apports organiques de la campagne : quantité × teneur × Kéq',
    regles: [...reglesEmployees, 'gren-xpro'],
    detail,
  };
}

function calculerNirr(regles: ReglesGren, saisie: SaisieGren): TermeCalcule {
  const base = { terme: 'Nirr', libelle: libelleTerme('Nirr') };
  if (saisie.sansObjet.includes('Nirr')) {
    return { ...base, valeur: 0, origine: `Déclaré : ${TERMES_SANS_OBJET.Nirr}`, regles: [] };
  }
  const regle = regles.get('gren-nirr');
  const diviseur = nombreOuNull(regle?.valeur.diviseur);
  if (!regle || diviseur === null) {
    return { ...base, valeur: null, origine: '—', regles: [], manque: 'Formule de Nirr non disponible.' };
  }
  if (!saisie.irrigation) {
    return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Volume d’irrigation et teneur en nitrates de l’eau non renseignés (ou parcelle non irriguée à déclarer).' };
  }
  const { volumeMm, nitratesMgL } = saisie.irrigation;
  return {
    ...base,
    valeur: arrondi((volumeMm * nitratesMgL) / diviseur),
    origine: `V × C / ${diviseur} = ${volumeMm} mm × ${nitratesMgL} mg NO₃/L / ${diviseur}`,
    regles: [regle.code],
  };
}

function calculerPiColza(regles: ReglesGren, saisie: SaisieGren): TermeCalcule {
  const base = { terme: 'Pi', libelle: libelleTerme('Pi') };
  const regle = regles.get('gren-ft4-colza');
  const pi = regle?.valeur.pi as { coeffEntreeHiver?: number; coeffSortieHiver?: number } | undefined;
  if (!regle || !pi?.coeffEntreeHiver || !pi.coeffSortieHiver) {
    return { ...base, valeur: null, origine: '—', regles: [], manque: 'Règles de Pi du colza non disponibles.' };
  }
  const sh = saisie.colza?.mvSortieHiver;
  const eh = saisie.colza?.mvEntreeHiver;
  if (sh === undefined) {
    return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Matière verte en sortie d’hiver non renseignée : la fiche 4 rend alors le calcul de Pi impossible.' };
  }
  const nabsSh = sh * pi.coeffSortieHiver;
  if (eh === undefined) {
    return { ...base, valeur: arrondi(nabsSh), origine: `MV sortie d’hiver ${sh} kg/m² × ${pi.coeffSortieHiver}`, regles: [regle.code] };
  }
  const nabsEh = eh * pi.coeffEntreeHiver;
  if (nabsSh >= nabsEh) {
    return { ...base, valeur: arrondi(nabsSh), origine: `MV SH ${sh} × ${pi.coeffSortieHiver} ≥ MV EH ${eh} × ${pi.coeffEntreeHiver} : Pi = ${arrondi(nabsSh)}`, regles: [regle.code] };
  }
  const v = nabsSh + (nabsEh - nabsSh) / 2 / 1.35;
  return {
    ...base,
    valeur: arrondi(v),
    origine: `Nabs SH ${arrondi(nabsSh)} + ½ (Nabs EH ${arrondi(nabsEh)} − Nabs SH) / 1,35`,
    regles: [regle.code],
  };
}

function calculerTerme(
  regles: ReglesGren,
  fiche: number,
  terme: string,
  formule: Formule,
  contexte: ContexteGren,
  saisie: SaisieGren,
  sousRegion: string,
): TermeCalcule {
  const base = { terme, libelle: libelleTerme(terme) };
  const departement = contexte.departement;

  // Nul par la fiche elle-même.
  if (formule.nuls?.[terme]) {
    return { ...base, valeur: 0, origine: formule.nuls[terme]!, regles: [`gren-formule-ft${fiche}`] };
  }
  if (terme === 'Xpro') return calculerXpro(regles, contexte, saisie);
  if (terme === 'Nirr') return calculerNirr(regles, saisie);
  if (fiche === 4 && terme === 'Pi') return calculerPiColza(regles, saisie);

  if (fiche === 4 && (terme === 'Np' || terme === 'Fleg' || terme === 'Fass')) {
    const regle = regles.get('gren-ft4-colza');
    const v = regle?.valeur as Record<string, Record<string, number | string>> | undefined;
    if (!regle || !v) return { ...base, valeur: null, origine: '—', regles: [], manque: 'Règles du colza non disponibles.' };
    if (terme === 'Np') {
      const categories = regles.get('gren-rendements-defaut')?.valeur.categorieProfondeur as Record<string, string> | undefined;
      const categorie = saisie.typeSol ? categories?.[`${sousRegion}:${saisie.typeSol}`] : undefined;
      const profondeur = categorie === 'P' ? 'profond' : saisie.colza?.profondeur;
      if (!profondeur) {
        return {
          ...base,
          valeur: null,
          origine: '—',
          regles: [regle.code],
          manque:
            categorie === 'L'
              ? 'Le type de sol n’est pas classé « profond » par la fiche 20, dont la légende ne définit pas l’autre catégorie : déclarez si le sol est superficiel ou profond.'
              : 'Profondeur du sol (superficiel ou profond) non déterminée.',
        };
      }
      const valeur = nombreOuNull(v.np?.[profondeur === 'profond' ? 'solProfond' : 'solSuperficiel']);
      return {
        ...base,
        valeur,
        origine: categorie === 'P' ? 'Sol profond (catégorie P de la fiche 20)' : `Sol ${profondeur} (déclaré)`,
        regles: [regle.code, ...(categorie ? ['gren-rendements-defaut'] : [])],
        ...(valeur === null ? { manque: 'Valeur absente de la fiche 4.' } : {}),
      };
    }
    const declare = terme === 'Fleg' ? saisie.colza?.precedentPois : saisie.colza?.legumineusesGelives;
    if (declare === undefined) {
      return {
        ...base,
        valeur: null,
        origine: '—',
        regles: [regle.code],
        manque: terme === 'Fleg' ? 'Précédent pois protéagineux : oui ou non ?' : 'Colza associé à un couvert de légumineuses gélives : oui ou non ?',
      };
    }
    const bloc = terme === 'Fleg' ? v.fleg : v.fass;
    const cle = terme === 'Fleg' ? 'precedentPoisProteagineux' : 'colzaAssocieACouvertDeLegumineusesGelif';
    const valeur = nombreOuNull(declare ? bloc?.[cle] : bloc?.sinon);
    return { ...base, valeur, origine: declare ? 'Oui (déclaré)' : 'Non (déclaré)', regles: [regle.code] };
  }

  // Termes déclarables sans objet.
  if ((Object.keys(TERMES_SANS_OBJET) as string[]).includes(terme) && saisie.sansObjet.includes(terme as TermeSansObjet)) {
    return { ...base, valeur: 0, origine: `Déclaré : ${TERMES_SANS_OBJET[terme as TermeSansObjet]}`, regles: [] };
  }

  // MrCI nul pour les cultures d'hiver.
  if (terme === 'MrCI' && contexte.cultureDHiver === true) {
    const regle = regles.get('gren-mrci-cultures-hiver');
    if (regle) return { ...base, valeur: 0, origine: 'Culture d’hiver : MrCI absent ou négligeable', regles: [regle.code] };
  }

  // Mesure (reliquat sortie d'hiver, Pi mesuré).
  const mesure = saisie.mesures[terme];
  if (mesure && (terme === 'Ri' || terme === 'Pi')) {
    return { ...base, valeur: mesure.valeur, origine: `Mesuré — ${mesure.justification}`, regles: [] };
  }

  const regle = tableauDuTerme(regles, fiche, terme, sousRegion, departement);
  if (!regle) {
    const raison =
      terme === 'Ri'
        ? sousRegion === 'auvergne' && !departement
          ? 'Département de la parcelle inconnu (code INSEE) : le tableau des reliquats moyens ne peut pas être choisi. Saisissez un reliquat mesuré.'
          : `Pas de tableau de reliquats pour cette fiche et ce territoire : saisissez un reliquat mesuré.`
        : `La fiche ${fiche} transcrite ne donne pas de tableau ${terme} pour l’ex-région ${sousRegion === 'auvergne' ? 'Auvergne' : 'Rhône-Alpes'}.`;
    return { ...base, valeur: null, origine: '—', regles: [], manque: raison };
  }
  const l = lireTableau(regle, saisie.choix[terme], saisie);
  if (l.valeur === null) {
    return { ...base, valeur: null, origine: '—', regles: [regle.code], ...(l.manque ? { manque: l.manque } : {}) };
  }
  if (terme === 'Mhp') {
    const coef = regles.get(`${regle.code}-coefficient`);
    if (!coef) {
      return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Coefficient correcteur du mode d’exploitation de la prairie non disponible.' };
    }
    const c = lireTableau(coef, saisie.choix['Mhp-coefficient'], saisie);
    if (c.valeur === null) {
      return { ...base, valeur: null, origine: '—', regles: [regle.code, coef.code], manque: `Coefficient correcteur : ${c.manque}` };
    }
    return {
      ...base,
      valeur: arrondi(l.valeur * c.valeur),
      origine: `Fiche ${fiche} — ${l.detail} ; × ${c.valeur} (${c.detail})`,
      regles: [regle.code, coef.code],
    };
  }
  return { ...base, valeur: l.valeur, origine: `Fiche ${fiche} — ${l.detail}`, regles: [regle.code] };
}

function calculerCau(
  regles: ReglesGren,
  fiche: number,
  facteur: 'inverse-cau' | 'un-sur-cau',
  saisie: SaisieGren,
  y: number | null,
): TermeCalcule {
  const base = { terme: 'CAU', libelle: libelleTerme('CAU') };
  if (fiche === 3) {
    const regle = regles.get('gren-ft3-cau-rhone-alpes');
    const especes = regle?.valeur.especes as Record<string, { valeur?: number; classes?: Classe[]; rendementUnite?: string }> | undefined;
    const e = saisie.espece ? especes?.[saisie.espece] : undefined;
    if (!regle || !e) return { ...base, valeur: null, origine: '—', regles: regle ? [regle.code] : [], manque: 'Espèce non choisie pour le 1/CAU de la fiche 3.' };
    if (typeof e.valeur === 'number') return { ...base, valeur: e.valeur, origine: `1/CAU = ${e.valeur} (fiche 3)`, regles: [regle.code] };
    if (y === null || !e.classes) return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'Objectif de rendement nécessaire pour lire le 1/CAU.' };
    const classe = classeDe(e.classes, y);
    if (!classe) return { ...base, valeur: null, origine: '—', regles: [regle.code], manque: 'L’objectif ne tombe dans aucune classe de 1/CAU.' };
    return { ...base, valeur: classe.valeur, origine: `1/CAU = ${classe.valeur} (objectif ${classe.libelle}, fiche 3)`, regles: [regle.code] };
  }
  if (fiche === 4) {
    const regle = regles.get('gren-ft4-colza');
    const v = nombreOuNull(regle?.valeur.CAU);
    return v === null
      ? { ...base, valeur: null, origine: '—', regles: [], manque: 'CAU du colza non disponible.' }
      : { ...base, valeur: v, origine: `CAU = ${v} (fiche 4)`, regles: [regle!.code] };
  }
  if (fiche === 6) {
    const regle = regles.get('gren-ft6-mais-semence');
    const cas = (regle?.valeur.cau as Array<{ cas: string; libelle: string; valeur: number }> | undefined) ?? [];
    const c = cas.find((x) => x.cas === saisie.maisSemence?.cau);
    if (!regle || !c) return { ...base, valeur: null, origine: '—', regles: regle ? [regle.code] : [], manque: 'Cas du CAU du maïs semence non choisi (stade de l’apport, rendement).' };
    return { ...base, valeur: c.valeur, origine: `CAU = ${c.valeur} (${c.libelle}, fiche 6)`, regles: [regle.code] };
  }
  void facteur;
  return { ...base, valeur: null, origine: '—', regles: [], manque: `CAU non défini pour la fiche ${fiche}.` };
}

// ---------------------------------------------------------------------------
// Plafonds
// ---------------------------------------------------------------------------

export type OptionPlafond = {
  id: string;
  libelle: string;
  plafond: number | null;
  /** Dose fruits à multiplier par l'objectif de rendement (fiche 11). */
  parTonne?: number;
  note?: string;
};

const enClair = (slug: string) => {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Le code de la règle de plafond d'une culture de la fiche 1. */
export function reglePlafondDe(
  regles: ReglesGren,
  culture: CultureFiche1,
  sousRegion: string,
): RegleGren | null {
  if (culture.fiche === null) return regles.get('gren-plafond-autres-cultures') ?? null;
  return (
    regles.get(`gren-plafond-ft${culture.fiche}-${sousRegion}`) ??
    regles.get(`gren-plafond-ft${culture.fiche}`) ??
    null
  );
}

export function optionsPlafond(regle: RegleGren): OptionPlafond[] {
  const v = regle.valeur;
  const options: OptionPlafond[] = [];
  const parAntecedent = (prefixe: string, c: { code: string; libelle: string; parAntecedent?: Record<string, number | null>; plafondUnique?: number }) => {
    if (c.plafondUnique !== undefined) options.push({ id: `${prefixe}${c.code}`, libelle: c.libelle, plafond: c.plafondUnique });
    for (const [ant, p] of Object.entries(c.parAntecedent ?? {})) {
      options.push({
        id: `${prefixe}${c.code}:${ant}`,
        libelle: `${c.libelle} — antécédent ${ant}`,
        plafond: p,
        ...(p === null ? { note: 'non concerné (NC)' } : {}),
      });
    }
  };
  if (regle.code === 'gren-plafond-autres-cultures') {
    options.push({ id: 'autres-cultures', libelle: 'Autres cultures', plafond: nombreOuNull(v.plafond) });
    return options;
  }
  if (Array.isArray(v.cultures)) {
    for (const c of v.cultures as Array<{ code: string; libelle: string; plafond?: number; parAntecedent?: Record<string, number | null> }>) {
      if (c.parAntecedent) parAntecedent('', c);
      else options.push({ id: c.code, libelle: c.libelle, plafond: nombreOuNull(c.plafond) });
    }
  }
  if (Array.isArray(v.monoculture)) {
    for (const c of v.monoculture as Array<{ code: string; libelle: string; parAntecedent?: Record<string, number | null>; plafondUnique?: number }>) {
      parAntecedent('monoculture:', c);
    }
  }
  if (Array.isArray(v.polyculture)) {
    for (const c of v.polyculture as Array<{ cas: string; plafond: number }>) {
      options.push({ id: `polyculture:${c.cas}`, libelle: `Polyculture — ${enClair(c.cas)}`, plafond: c.plafond });
    }
  }
  for (const groupe of ['fourrageres', 'potageres', 'categories', 'totaux'] as const) {
    const m = v[groupe];
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      for (const [k, p] of Object.entries(m as Record<string, unknown>)) {
        if (typeof p === 'number') options.push({ id: `${groupe}:${k}`, libelle: enClair(k), plafond: p });
      }
    }
  }
  if (typeof v.betteraveSucrierePorteGraine === 'number') {
    options.push({ id: 'betterave-sucriere-porte-graine', libelle: 'Betterave sucrière porte-graine', plafond: v.betteraveSucrierePorteGraine });
  }
  if (typeof v.fourrageresAvecRecolteFourragere === 'string' && v.fourrageres && typeof v.fourrageres === 'object') {
    const plus = Number(/ajouter (\d+)/.exec(v.fourrageresAvecRecolteFourragere)?.[1]);
    if (Number.isFinite(plus)) {
      for (const [k, p] of Object.entries(v.fourrageres as Record<string, unknown>)) {
        if (typeof p === 'number') {
          options.push({ id: `fourrageres-recolte:${k}`, libelle: `${enClair(k)}, avec récolte fourragère`, plafond: p + plus, note: v.fourrageresAvecRecolteFourragere });
        }
      }
    }
  }
  // Fiche 9.
  if (typeof v.luzerne === 'number') options.push({ id: 'luzerne', libelle: 'Luzerne', plafond: v.luzerne });
  for (const groupe of ['culturePrincipale', 'derobee'] as const) {
    const m = v[groupe] as Record<string, unknown> | undefined;
    if (!m) continue;
    for (const [k, p] of Object.entries(m)) {
      if (typeof p === 'number') options.push({ id: `${groupe}:${k}`, libelle: `${enClair(k)} (${groupe === 'derobee' ? 'dérobée' : 'culture principale'})`, plafond: p });
    }
    const parts = m.selonPartLegumineuses as Record<string, unknown> | undefined;
    const classes = parts?.classes as string[] | undefined;
    if (parts && classes) {
      for (const [k, liste] of Object.entries(parts)) {
        if (!Array.isArray(liste) || k === 'classes') continue;
        liste.forEach((p, i) => {
          if (typeof p === 'number') {
            options.push({ id: `${groupe}:${k}:${i}`, libelle: `${enClair(k)} (${groupe === 'derobee' ? 'dérobée' : 'culture principale'}), légumineuses ${classes[i]}`, plafond: p });
          }
        });
      }
    }
  }
  // Fiche 11 : dose végétative selon l'âge + dose fruits × objectif.
  if (Array.isArray(v.especes) && regle.code.includes('ft11')) {
    for (const e of v.especes as Array<{ code: string; libelle: string; vegetativeParAnnee: Record<string, number>; fruitsParTonne: number }>) {
      for (const [age, veg] of Object.entries(e.vegetativeParAnnee)) {
        options.push({
          id: `especes:${e.code}:${age}`,
          libelle: `${e.libelle}, ${age === '5-et-plus' ? '5 ans et plus' : `${age}e année`}`,
          plafond: veg,
          parTonne: e.fruitsParTonne,
        });
      }
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Le calcul
// ---------------------------------------------------------------------------

function vide(saisie: SaisieGren | null, avertissements: string[] = []): Omit<CalculGren, 'bloquants'> {
  void saisie;
  return {
    culture: null,
    sousRegion: null,
    methode: null,
    expression: null,
    termes: [],
    doseCalculeeKgHa: null,
    doseKgHa: null,
    plafondKgHa: null,
    regleDose: null,
    regles: [],
    avertissements,
  };
}

export function calculerDoseGren(
  regles: ReglesGren,
  contexte: ContexteGren,
  saisie: SaisieGren,
): CalculGren {
  if (regles.size === 0) {
    return { ...vide(saisie), bloquants: [{ terme: 'référentiel', raison: 'Référentiel GREN non disponible pour cette parcelle à cette date.' }] };
  }
  const culture = culturesGren(regles).find((c) => c.code === saisie.culture) ?? null;
  if (!culture) {
    return { ...vide(saisie), bloquants: [{ terme: 'culture', raison: 'Culture non choisie parmi celles de la fiche 1.' }] };
  }
  const sousRegion = sousRegionDe(regles, contexte.departement);
  const base = { ...vide(saisie), culture: { code: culture.code, libelle: culture.libelle, fiche: culture.fiche, methode: culture.methode } };
  if (!sousRegion) {
    return {
      ...base,
      bloquants: [
        {
          terme: 'territoire',
          raison: contexte.departement
            ? `Le département ${contexte.departement} n’appartient à aucune des deux ex-régions des fiches GREN.`
            : 'Département de la parcelle inconnu (code INSEE non renseigné) : les fiches distinguent l’Auvergne et Rhône-Alpes.',
        },
      ],
    };
  }

  // Méthode : bilan ou plafond. La pomme de terre suit le bilan en Auvergne
  // et le plafond en Rhône-Alpes (formule de la fiche 13).
  const formule = culture.fiche !== null ? formuleDe(regles, culture.fiche, sousRegion) : null;
  const auPlafond =
    culture.methode === 'plafond' || (formule?.formule.plafond === true) || (culture.methode !== 'bilan' && !formule);

  if (auPlafond) return calculerPlafond(regles, contexte, saisie, culture, sousRegion, base);
  if (!formule || culture.fiche === null) {
    return { ...base, sousRegion, bloquants: [{ terme: 'formule', raison: `Formule de la fiche ${culture.fiche} non disponible.` }] };
  }
  const { formule: f, pf, regle: regleFormule } = formule;
  const termes: TermeCalcule[] = [];
  const avertissements: string[] = [];
  const reglesEmployees = new Set<string>(['gren-cultures', 'gren-sous-regions', regleFormule]);

  const { pf: termePf, y } = calculerPf(regles, culture.fiche, pf, contexte, saisie, sousRegion, contexte.departement);
  if (y) termes.push(y);

  const valeurDe = (terme: string): TermeCalcule => {
    if (terme === 'Pf') return termePf;
    return calculerTerme(regles, culture.fiche!, terme, f, contexte, saisie, sousRegion);
  };

  const plus = (f.plus ?? []).map(valeurDe);
  const moins = (f.moins ?? []).map(valeurDe);
  const apres = (f.moinsApresFacteur ?? []).map(valeurDe);
  termes.push(...plus, ...moins, ...apres);

  // Une formule ambiguë dans la fiche ne se tranche pas : seule une valeur
  // nulle la rend sans effet.
  for (const amb of f.ambigus ?? []) {
    const t = valeurDe(amb.terme);
    if (t.valeur === null) {
      termes.push({ ...t, manque: `${amb.explication} Renseignez la valeur mesurée : seule une valeur nulle permet de calculer.` });
    } else if (t.valeur !== 0) {
      termes.push({ ...t, valeur: null, manque: `${amb.explication} Avec ${amb.terme} = ${t.valeur}, les deux écritures de la fiche donnent des doses différentes : le calcul n’est pas tranché.` });
    } else {
      termes.push(t);
      avertissements.push(`${amb.terme} = 0 : l’ambiguïté de la formule de la fiche ${culture.fiche} est sans effet.`);
    }
  }

  let cau: TermeCalcule | null = null;
  if (f.facteur) {
    cau = calculerCau(regles, culture.fiche, f.facteur, saisie, y?.valeur ?? null);
    termes.push(cau);
  }

  for (const t of termes) for (const r of t.regles) reglesEmployees.add(r);
  const bloquants = termes.filter((t) => t.valeur === null).map((t) => ({ terme: t.libelle, raison: t.manque ?? 'Valeur manquante.' }));

  if (bloquants.length > 0) {
    return { ...base, sousRegion, methode: 'bilan', expression: f.expression, termes, bloquants, regles: [...reglesEmployees], avertissements };
  }

  const somme = (ts: TermeCalcule[]) => ts.reduce((s, t) => s + (t.valeur as number), 0);
  let x = somme(plus) - somme(moins);
  if (f.facteur === 'inverse-cau') x *= cau!.valeur as number;
  if (f.facteur === 'un-sur-cau') x /= cau!.valeur as number;
  x -= somme(apres);
  const doseCalculee = arrondi(x);

  const { dose, regle: regleDose, code: codeDose } = regleDesPetitesDoses(regles, doseCalculee);
  if (codeDose) reglesEmployees.add(codeDose);

  return {
    ...base,
    sousRegion,
    methode: 'bilan',
    expression: f.expression,
    termes,
    doseCalculeeKgHa: doseCalculee,
    doseKgHa: dose,
    regleDose,
    bloquants: [],
    regles: [...reglesEmployees],
    avertissements,
  };
}

function regleDesPetitesDoses(regles: ReglesGren, x: number): { dose: number; regle: string | null; code: string | null } {
  const r = regles.get('gren-dose-minimale-bilan-negatif');
  const haut = nombreOuNull(r?.valeur.seuilHautKgHa);
  const possible = nombreOuNull(r?.valeur.dosePossibleKgHa);
  if (x <= 0) {
    return {
      dose: 0,
      regle: r ? `Bilan négatif ou nul : ${String(r.valeur.bilanNegatif)}.` : 'Bilan négatif ou nul : aucun apport.',
      code: r?.code ?? null,
    };
  }
  if (r && haut !== null && possible !== null && x < haut) {
    return { dose: possible, regle: `Dose calculée entre 0 et ${haut} kg N/ha : ${possible} kg N/ha possibles (fiche 1).`, code: r.code };
  }
  return { dose: x, regle: null, code: null };
}

function calculerPlafond(
  regles: ReglesGren,
  contexte: ContexteGren,
  saisie: SaisieGren,
  culture: CultureFiche1,
  sousRegion: 'auvergne' | 'rhone-alpes',
  base: Omit<CalculGren, 'bloquants'>,
): CalculGren {
  const regle = reglePlafondDe(regles, culture, sousRegion);
  const reglesEmployees = new Set<string>(['gren-cultures', 'gren-sous-regions']);
  const termes: TermeCalcule[] = [];
  const basePlafond = { terme: 'plafond', libelle: 'Dose plafond (azote efficace)' };
  let plafond: TermeCalcule;
  if (!regle) {
    plafond = { ...basePlafond, valeur: null, origine: '—', regles: [], manque: `Plafond de la fiche ${culture.fiche} non disponible.` };
  } else if (tableauDe(regle)) {
    const l = lireTableau(regle, saisie.plafond?.choix, saisie);
    plafond = { ...basePlafond, valeur: l.valeur, origine: l.detail ? `Fiche ${culture.fiche} — ${l.detail}` : '—', regles: [regle.code], ...(l.manque ? { manque: l.manque } : {}) };
  } else {
    const options = optionsPlafond(regle);
    const option = options.find((o) => o.id === saisie.plafond?.option);
    if (!option) {
      plafond = { ...basePlafond, valeur: null, origine: '—', regles: [regle.code], manque: options.length > 0 ? 'Ligne de plafond non choisie dans la fiche.' : 'Cette fiche ne se lit pas automatiquement : le plafond est à déterminer depuis la fiche.' };
    } else if (option.plafond === null) {
      plafond = { ...basePlafond, valeur: null, origine: '—', regles: [regle.code], manque: `${option.libelle} : ${option.note ?? 'pas de valeur dans la fiche'}.` };
    } else if (option.parTonne !== undefined) {
      const y = saisie.objectif?.mode === 'declare' ? saisie.objectif : null;
      if (!y) {
        plafond = { ...basePlafond, valeur: null, origine: '—', regles: [regle.code], manque: 'La dose plafond des fruits se multiplie par l’objectif de rendement (t/ha) : déclarez-le avec sa justification.' };
      } else {
        plafond = {
          ...basePlafond,
          valeur: arrondi(option.plafond + option.parTonne * y.valeur),
          origine: `${option.libelle} : ${option.plafond} + ${option.parTonne} × ${y.valeur} t/ha (fiche 11)`,
          regles: [regle.code],
        };
      }
    } else {
      plafond = { ...basePlafond, valeur: option.plafond, origine: `${option.libelle} (fiche ${culture.fiche ?? 1})`, regles: [regle.code] };
    }
  }
  termes.push(plafond);
  const nirr = calculerNirr(regles, saisie);
  const xpro = calculerXpro(regles, contexte, saisie);
  termes.push(nirr, xpro);
  for (const t of termes) for (const r of t.regles) reglesEmployees.add(r);
  const expression = (regle?.valeur.formule as string | undefined) ?? 'X ≤ Dose plafond – Nirr – Xpro';
  const bloquants = termes.filter((t) => t.valeur === null).map((t) => ({ terme: t.libelle, raison: t.manque ?? 'Valeur manquante.' }));
  if (bloquants.length > 0) {
    return { ...base, sousRegion, methode: 'plafond', expression, termes, bloquants, regles: [...reglesEmployees] };
  }
  const x = arrondi((plafond.valeur as number) - (nirr.valeur as number) - (xpro.valeur as number));
  return {
    ...base,
    sousRegion,
    methode: 'plafond',
    expression,
    termes,
    doseCalculeeKgHa: x,
    doseKgHa: Math.max(x, 0),
    plafondKgHa: plafond.valeur,
    regleDose: x < 0 ? 'Les fournitures dépassent le plafond : aucun apport d’engrais minéral.' : null,
    bloquants: [],
    regles: [...reglesEmployees],
  };
}

// ---------------------------------------------------------------------------
// Ce que l'écran doit demander
// ---------------------------------------------------------------------------

export type ChampTableau = {
  terme: string;
  libelle: string;
  regle: string;
  cles: Array<{ nom: string; libelle: string; options: OptionCle[]; partage?: 'typeSol' }>;
};

export type DescriptionSaisie = {
  /** Les cultures de la fiche 1, pour le choix. */
  cultures: Array<OptionCle & { methode: string; fiche: number | null }>;
  culture: CultureFiche1 | null;
  sousRegion: 'auvergne' | 'rhone-alpes' | null;
  methode: 'bilan' | 'plafond' | null;
  expression: string | null;
  fiche: number | null;
  typesSol: OptionCle[];
  especes: OptionCle[];
  /** Termes de la formule, et ce que chacun demande. */
  termes: Array<{
    terme: string;
    libelle: string;
    tableau: ChampTableau | null;
    coefficient: ChampTableau | null;
    mesurable: boolean;
    sansObjet: string | null;
    calcule: string | null;
    nulParLaFiche: string | null;
    ambigu: string | null;
  }>;
  besoinParVariete: boolean;
  objectif: { utile: boolean; cultures20: OptionCle[]; unite: string };
  plafond: { options: OptionPlafond[]; tableau: ChampTableau | null } | null;
  groupesKeq: OptionCle[];
  colza: boolean;
  maisSemence: { dispositifs: OptionCle[]; cau: OptionCle[] } | null;
};

function champTableau(regle: RegleGren, terme: string): ChampTableau | null {
  const t = tableauDe(regle);
  if (!t) return null;
  return {
    terme,
    libelle: libelleTerme(terme),
    regle: regle.code,
    cles: t.cles.map((c) => ({
      nom: c.nom,
      libelle: c.libelle,
      options: optionsDeCle(t, c),
      ...(c.nom === 'typeSol' ? { partage: 'typeSol' as const } : {}),
    })),
  };
}

export function decrireSaisie(
  regles: ReglesGren,
  contexte: Pick<ContexteGren, 'departement' | 'cultureDHiver'>,
  saisie: Partial<SaisieGren> & { culture?: string },
): DescriptionSaisie {
  const culture = culturesGren(regles).find((c) => c.code === saisie.culture) ?? null;
  const sousRegion = sousRegionDe(regles, contexte.departement);
  const typesSolBruts = regles.get('gren-types-sols')?.valeur as Record<string, Array<{ code: string; libelle: string }>> | undefined;
  const typesSol = sousRegion
    ? (typesSolBruts?.[sousRegion === 'auvergne' ? 'auvergne' : 'rhoneAlpes'] ?? []).map((t) => ({ code: t.code, libelle: t.libelle }))
    : [];
  const keqCles = regles.get('gren-keq')?.valeur.cles as Array<{ nom: string; valeurs: OptionCle[] }> | undefined;
  const groupesKeq = keqCles?.find((c) => c.nom === 'groupeCulture')?.valeurs ?? [];
  const vide: DescriptionSaisie = {
    cultures: culturesGren(regles).map((c) => ({ code: c.code, libelle: c.libelle, methode: c.methode, fiche: c.fiche })),
    culture,
    sousRegion,
    methode: null,
    expression: null,
    fiche: culture?.fiche ?? null,
    typesSol,
    especes: [],
    termes: [],
    besoinParVariete: false,
    objectif: { utile: false, cultures20: [], unite: 'q/ha' },
    plafond: null,
    groupesKeq,
    colza: false,
    maisSemence: null,
  };
  if (!culture || !sousRegion) return vide;

  const formule = culture.fiche !== null ? formuleDe(regles, culture.fiche, sousRegion) : null;
  const auPlafond = culture.methode === 'plafond' || formule?.formule.plafond === true || (culture.methode !== 'bilan' && !formule);
  if (auPlafond) {
    const regle = reglePlafondDe(regles, culture, sousRegion);
    return {
      ...vide,
      methode: 'plafond',
      expression: (regle?.valeur.formule as string | undefined) ?? null,
      plafond: regle ? { options: tableauDe(regle) ? [] : optionsPlafond(regle), tableau: tableauDe(regle) ? champTableau(regle, 'plafond') : null } : { options: [], tableau: null },
      termes: ['Nirr', 'Xpro'].map((t) => ({
        terme: t,
        libelle: libelleTerme(t),
        tableau: null,
        coefficient: null,
        mesurable: false,
        sansObjet: t === 'Nirr' ? TERMES_SANS_OBJET.Nirr : null,
        calcule: t === 'Nirr' ? 'V × C / 443' : 'quantité × teneur × Kéq, depuis les apports organiques',
        nulParLaFiche: null,
        ambigu: null,
      })),
      objectif: { utile: culture.fiche === 11, cultures20: [], unite: 't/ha' },
    };
  }
  if (!formule || culture.fiche === null) return vide;
  const f = formule.formule;
  const fiche = culture.fiche;

  let especes: OptionCle[] = [];
  let besoinParVariete = false;
  if (fiche === 2) {
    const liste = (regles.get('gren-ft2-besoin-unitaire')?.valeur.especes as Array<Record<string, unknown>> | undefined) ?? [];
    especes = liste.map((e) => ({ code: String(e.code), libelle: String(e.libelle) }));
    const e = liste.find((x) => x.code === saisie.espece);
    besoinParVariete = Boolean(e && nombreOuNull(e.b) === null);
  }
  if (fiche === 3) {
    const m = regles.get('gren-ft3-besoin-unitaire')?.valeur.especes as Record<string, unknown> | undefined;
    especes = Object.keys(m ?? {}).map((k) => ({ code: k, libelle: enClair(k) }));
  }
  const cultures20 = ((regles.get('gren-rendements-defaut')?.valeur.cultures as Array<{ code: string; libelle: string; unite: string }> | undefined) ?? []).map(
    (c) => ({ code: c.code, libelle: `${c.libelle} (${c.unite})` }),
  );

  const termesFormule = [...(f.plus ?? []), ...(f.moins ?? []), ...(f.moinsApresFacteur ?? []), ...(f.ambigus ?? []).map((a) => a.terme)];
  const termes = termesFormule.map((terme) => {
    const calcule =
      terme === 'Pf'
        ? formule.pf.mode === 'b-x-y'
          ? 'b × y'
          : formule.pf.mode === 'constante'
            ? `${String(formule.pf.valeur)} kg N/ha (fiche)`
            : formule.pf.mode === 'femelles-sur-occupation'
              ? 'Pf des femelles ÷ coefficient d’occupation'
              : null
        : terme === 'Nirr'
          ? 'V × C / 443'
          : terme === 'Xpro'
            ? 'quantité × teneur × Kéq, depuis les apports organiques'
            : fiche === 4 && ['Pi', 'Np', 'Fleg', 'Fass'].includes(terme)
              ? 'règles de la fiche 4'
              : null;
    const tableauRegle =
      calcule && !(terme === 'Pf' && formule.pf.mode === 'table')
        ? null
        : tableauDuTerme(regles, fiche, terme, sousRegion, contexte.departement);
    const coefficient = terme === 'Mhp' && tableauRegle ? regles.get(`${tableauRegle.code}-coefficient`) : undefined;
    const ambigu = f.ambigus?.find((a) => a.terme === terme)?.explication ?? null;
    return {
      terme,
      libelle: libelleTerme(terme),
      tableau: tableauRegle ? champTableau(tableauRegle, terme) : null,
      coefficient: coefficient ? champTableau(coefficient, 'Mhp-coefficient') : null,
      mesurable: terme === 'Ri' || (terme === 'Pi' && ambigu !== null),
      sansObjet: (TERMES_SANS_OBJET as Record<string, string>)[terme] ?? null,
      calcule,
      nulParLaFiche: f.nuls?.[terme] ?? (terme === 'MrCI' && contexte.cultureDHiver === true && regles.has('gren-mrci-cultures-hiver') ? 'Culture d’hiver : MrCI absent ou négligeable' : null),
      ambigu,
    };
  });

  const ms = regles.get('gren-ft6-mais-semence')?.valeur as { coefficientsOccupation?: Array<{ dispositif: string }>; cau?: Array<{ cas: string; libelle: string }> } | undefined;
  return {
    ...vide,
    methode: 'bilan',
    expression: f.expression,
    especes,
    besoinParVariete,
    termes,
    objectif: { utile: formule.pf.mode === 'b-x-y', cultures20, unite: uniteObjectif(regles, fiche, saisie as SaisieGren) },
    colza: fiche === 4,
    maisSemence:
      fiche === 6
        ? {
            dispositifs: (ms?.coefficientsOccupation ?? []).map((d) => ({ code: d.dispositif, libelle: d.dispositif })),
            cau: (ms?.cau ?? []).map((c) => ({ code: c.cas, libelle: c.libelle })),
          }
        : null,
  };
}
