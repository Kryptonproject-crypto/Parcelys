/**
 * La campagne culturale : une seule définition, pour le site et l'application.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il y en avait deux. `currentCampaignYear()` basculait au 1ᵉʳ août ; la page
 * PAC, elle, prenait l'année civile. Le 11 septembre 2026, le même logiciel
 * affichait donc « Campagne 2027 » sur la liste des parcelles et
 * « Campagne 2026 » sur la page PAC, sans que rien n'explique l'écart.
 *
 * La conséquence n'était pas seulement de la confusion. Un dossier TéléPAC
 * 2026 importé ce jour-là rattache ses cultures à la campagne 2026 ; la liste
 * des parcelles, elle, affiche la campagne en cours — 2027 — et donc
 * « sans culture déclarée » sur les 141 parcelles. Les cultures étaient bien
 * en base, invisibles.
 *
 * Ce module tient la définition, et une seule. Les écrans, eux, ont désormais
 * l'obligation de **dire** quelle campagne ils affichent et sur quelle période
 * elle court : c'est cette phrase-là qui manquait, pas le calcul.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE DATE DE BASCULE EST, ET CE QU'ELLE N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le 1ᵉʳ août est un **usage** des grandes cultures : la campagne 2027 est
 * celle qu'on sème à l'automne 2026 et qu'on récolte à l'été 2027. Ce n'est pas
 * une date réglementaire, et Parcelys ne la présente jamais comme telle.
 *
 * La campagne PAC porte le même numéro — la déclaration de mai 2027 est celle
 * de la campagne 2027 — mais ses dates propres relèvent de la réglementation
 * en vigueur, qui n'est pas reprise ici faute de source vérifiable : aucune
 * fonction de ce module ne prétend dire à quelle date ouvre ou ferme une
 * télédéclaration.
 *
 * Pur, sans import : l'application mobile s'en sert via `@commun/campagne`, et
 * les deux doivent compter la campagne de la même façon — une saisie faite au
 * champ ne doit pas atterrir dans une autre campagne que celle de l'écran de
 * bureau.
 */

/** Mois de bascule, en base 0 : 7 = août. */
const MOIS_BASCULE = 7;

/** Libellé de la convention, affiché tel quel à côté de la campagne. */
export const CONVENTION_CAMPAGNE =
  'Campagne culturale : du 1ᵉʳ août au 31 juillet (usage des grandes cultures).';

/**
 * Campagne en cours à la date donnée.
 *
 * Elle s'incrémente d'elle-même : rien à basculer à la main, aucune tâche
 * annuelle. Le 31 juillet 2027 rend 2027, le 1ᵉʳ août 2027 rend 2028.
 */
export function campagneCourante(date = new Date()): number {
  return date.getMonth() >= MOIS_BASCULE ? date.getFullYear() + 1 : date.getFullYear();
}

/** Premier et dernier jour de la campagne, aux bornes incluses. */
export function periodeCampagne(annee: number): { debut: Date; fin: Date } {
  return {
    debut: new Date(annee - 1, MOIS_BASCULE, 1),
    fin: new Date(annee, MOIS_BASCULE, 0),
  };
}

/** Campagne à laquelle appartient une date : l'inverse de `periodeCampagne`. */
export function campagneDeLaDate(date: Date): number {
  return campagneCourante(date);
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

function jourFr(date: Date): string {
  const jour = date.getDate();
  return `${jour === 1 ? '1ᵉʳ' : jour} ${MOIS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * « 1ᵉʳ août 2026 → 31 juillet 2027 ».
 *
 * Affiché à côté du numéro de campagne partout où l'utilisateur peut se
 * demander de quelle année on lui parle — c'est-à-dire partout.
 */
export function periodeCampagneLabel(annee: number): string {
  const { debut, fin } = periodeCampagne(annee);
  return `${jourFr(debut)} → ${jourFr(fin)}`;
}

/**
 * Les campagnes proposées dans un sélecteur.
 *
 * La campagne suivante est offerte — on prépare un assolement avant de le
 * semer — et les précédentes remontent aussi loin qu'on peut raisonnablement
 * avoir saisi. Le nombre est décidé par l'appelant plutôt que fixé ici :
 * l'écran des exports n'a pas les mêmes besoins que la liste des parcelles.
 */
export function campagnesProposees(
  nombre = 8,
  date = new Date(),
): number[] {
  const courante = campagneCourante(date);
  return Array.from({ length: nombre }, (_, i) => courante + 1 - i);
}
