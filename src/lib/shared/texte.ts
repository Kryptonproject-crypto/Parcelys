/**
 * Comparer deux textes comme un exploitant les tape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les parcelles portent des noms de lieux français : la Côte, le Chêne, les
 * Prés Salés, le Pré du Curé. Au champ, sur un téléphone, on tape « cote »,
 * « chene », « pres sales ». Une recherche qui exige l'accent ne sert jamais au
 * moment où elle servirait.
 *
 * Ce module tient la règle **du côté JavaScript** — l'application mobile, qui
 * cherche hors ligne dans son instantané, et les filtres de page qui se font
 * dans le navigateur.
 *
 * Côté base, la même règle est écrite en SQL : `parcelys_sans_accent`, créée
 * par la migration `20260911080000_recherche_sans_accent` (une fonction plutôt
 * que l'extension `unaccent`, qui réclame des droits de superutilisateur que la
 * base n'a pas sur le Raspberry Pi).
 *
 * Deux implémentations, donc un risque de divergence : `tests/recherche.test.ts`
 * les confronte sur un jeu de noms réels et échoue si elles ne rendent pas la
 * même chose. C'est ce test, et non la bonne volonté, qui les tient ensemble.
 */

/**
 * Minuscules, sans accent.
 *
 * `normalize('NFD')` décompose « é » en « e » + accent combinant, que l'on
 * retire ensuite. Cette voie couvre bien plus de caractères qu'une table de
 * correspondance, et c'est elle qui fait foi côté JavaScript ; la table SQL en
 * reprend le domaine utile.
 */
export function sansAccent(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** `aiguille` se trouve-t-elle dans `botte`, accents et casse mis de côté ? */
export function contientSansAccent(botte: string, aiguille: string): boolean {
  const cherche = sansAccent(aiguille.trim());
  if (!cherche) return true;
  return sansAccent(botte).includes(cherche);
}
