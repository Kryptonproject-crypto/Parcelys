/**
 * Unités de stock — des quantités absolues, pas des doses.
 *
 * À ne pas confondre avec `src/lib/ephy/dose.ts`, qui manipule des doses **par
 * hectare** (L/ha, kg/ha…). Ici on compte ce qu'il y a dans le local phyto :
 * des litres, des kilos, des bidons.
 *
 * ## La règle qui ne souffre aucune exception
 *
 * On ne convertit **jamais** une masse en volume. Un produit acheté en kilos et
 * appliqué en litres suppose une densité que Parcelys ne connaît pas — elle
 * varie d'un produit à l'autre, et l'étiquette ne la donne pas toujours. Une
 * conversion approximative sortirait un solde faux, et un solde faux sur un
 * produit phytosanitaire, c'est un écart de traçabilité lors d'un contrôle.
 *
 * Face à deux unités incomparables, ce module rend `null`. L'appelant le dit à
 * l'utilisateur, qui tranche. C'est moins commode qu'un chiffre, et c'est le
 * seul comportement défendable.
 */

type Famille = 'volume' | 'masse' | 'unité';

const UNITES: Record<string, { famille: Famille; facteur: number }> = {
  // Volume — référence : le litre
  ml: { famille: 'volume', facteur: 0.001 },
  cl: { famille: 'volume', facteur: 0.01 },
  dl: { famille: 'volume', facteur: 0.1 },
  l: { famille: 'volume', facteur: 1 },
  hl: { famille: 'volume', facteur: 100 },
  m3: { famille: 'volume', facteur: 1000 },

  // Masse — référence : le kilogramme
  mg: { famille: 'masse', facteur: 0.000001 },
  g: { famille: 'masse', facteur: 0.001 },
  kg: { famille: 'masse', facteur: 1 },
  q: { famille: 'masse', facteur: 100 },
  t: { famille: 'masse', facteur: 1000 },

  // Dénombrables — un sac de semences, un bidon, une dose. Aucun facteur ne
  // les relie : un « sac » n'a pas de contenance universelle. Ils ne se
  // convertissent qu'en eux-mêmes.
  unité: { famille: 'unité', facteur: 1 },
  unite: { famille: 'unité', facteur: 1 },
  u: { famille: 'unité', facteur: 1 },
  dose: { famille: 'unité', facteur: 1 },
  sac: { famille: 'unité', facteur: 1 },
  bidon: { famille: 'unité', facteur: 1 },
  palette: { famille: 'unité', facteur: 1 },
  bigbag: { famille: 'unité', facteur: 1 },
};

/** Formes acceptées à la saisie, du plus courant au moins. */
export const UNITES_COURANTES = ['L', 'mL', 'hL', 'kg', 'g', 't', 'q', 'unité'] as const;

export function normaliserUnite(unite: string): string {
  const base = unite
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.]/g, '')
    .replace(/^litres?$/, 'l')
    .replace(/^kilos?$/, 'kg')
    .replace(/^kilogrammes?$/, 'kg')
    .replace(/^grammes?$/, 'g')
    .replace(/^tonnes?$/, 't')
    .replace(/^(quintaux|quintal)$/, 'q')
    .replace(/^m³$/, 'm3')
    .replace(/^big-?bags?$/, 'bigbag')
    .replace(/^(unités?|unites?)$/, 'unité');

  // Le pluriel ne se retire que s'il donne une unité connue. Une règle
  // générale « enlever le s final » transformerait un jour une unité valide en
  // unité inconnue, et le solde deviendrait incalculable sans qu'on comprenne
  // pourquoi.
  if (!(base in UNITES) && base.endsWith('s') && base.slice(0, -1) in UNITES) {
    return base.slice(0, -1);
  }
  return base;
}

/** La famille d'une unité, ou `null` si Parcelys ne la connaît pas. */
export function familleDe(unite: string): Famille | null {
  return UNITES[normaliserUnite(unite)]?.famille ?? null;
}

export function uniteConnue(unite: string): boolean {
  return familleDe(unite) !== null;
}

/**
 * Convertit une quantité, ou rend `null` quand c'est impossible.
 *
 * `null` couvre trois cas, et l'appelant doit les distinguer pour son message :
 * unité inconnue, familles différentes, ou dénombrables de noms différents
 * (des « sacs » ne sont pas des « bidons »).
 */
export function convertirQuantite(
  valeur: number,
  depuis: string,
  vers: string,
): number | null {
  const a = normaliserUnite(depuis);
  const b = normaliserUnite(vers);
  const source = UNITES[a];
  const cible = UNITES[b];

  if (!source || !cible) return null;
  if (source.famille !== cible.famille) return null;
  // Deux dénombrables ne se valent que s'ils portent le même nom.
  if (source.famille === 'unité' && a !== b) return null;

  return (valeur * source.facteur) / cible.facteur;
}

/** Pourquoi une conversion a échoué, en clair pour l'utilisateur. */
export function expliquerConversion(depuis: string, vers: string): string {
  const a = familleDe(depuis);
  const b = familleDe(vers);

  if (!a) return `Unité « ${depuis} » inconnue de Parcelys.`;
  if (!b) return `Unité « ${vers} » inconnue de Parcelys.`;

  if (a !== b) {
    if ((a === 'masse' && b === 'volume') || (a === 'volume' && b === 'masse')) {
      return (
        `Impossible de convertir des ${a === 'masse' ? 'kilos' : 'litres'} en ` +
        `${b === 'masse' ? 'kilos' : 'litres'} sans connaître la densité du produit. ` +
        'Parcelys ne la devine pas : tenez ce stock dans une seule unité, ou ' +
        'créez deux articles distincts.'
      );
    }
    return `Les unités « ${depuis} » et « ${vers} » ne se comparent pas.`;
  }

  return (
    `« ${depuis} » et « ${vers} » sont deux dénombrables différents : rien ne dit ` +
    'combien l’un vaut de l’autre.'
  );
}
