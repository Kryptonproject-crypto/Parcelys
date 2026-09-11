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

/**
 * Le fuseau de référence : celui de l'exploitation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE N'EST PAS UN DÉTAIL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `getMonth()` et `getFullYear()` lisent la date dans le fuseau **du
 * processus**. Le serveur tourne en UTC, le navigateur de l'exploitant à
 * l'heure de Paris. Les deux ne lisent donc pas toujours le même jour.
 *
 * Le 31 juillet 2027 à 23 h 00 UTC, il est déjà le 1ᵉʳ août à Saint-Étienne.
 * Le serveur comptait la campagne 2027, le navigateur la campagne 2028 — pour
 * le même instant, dans le même logiciel. Une saisie faite ce soir-là
 * atterrissait dans une campagne, et s'affichait dans l'autre.
 *
 * C'est exactement ce que l'en-tête de ce module dit qu'il ne faut pas : « une
 * saisie faite au champ ne doit pas atterrir dans une autre campagne que celle
 * de l'écran de bureau ». La règle y était ; le calcul ne la tenait pas.
 *
 * Une campagne culturale française se compte donc à l'heure française, quelle
 * que soit la machine qui fait le calcul.
 *
 * `Intl` est un objet global : ce module reste pur, sans import, comme
 * `tests/cloisonnement-mobile.test.ts` l'exige — l'application de terrain
 * l'utilise via `@commun/campagne` et doit compter pareil.
 */
export const FUSEAU_EXPLOITATION = 'Europe/Paris';

const PARTIES = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_EXPLOITATION,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Le jour civil français d'un instant : année, mois (base 0), jour. */
export function partiesFr(date: Date): {
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  seconde: number;
} {
  const p = Object.fromEntries(
    PARTIES.formatToParts(date)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;

  return {
    annee: p.year ?? 0,
    mois: (p.month ?? 1) - 1,
    jour: p.day ?? 1,
    // À minuit, `hour12: false` rend « 24 » plutôt que « 0 » dans certaines
    // versions d'ICU. Le ramener, sinon la journée déborde sur la suivante.
    heure: (p.hour ?? 0) % 24,
    minute: p.minute ?? 0,
    seconde: p.second ?? 0,
  };
}

/** L'écart du fuseau de l'exploitation à UTC, en millisecondes, à cet instant. */
function decalageFr(date: Date): number {
  const { annee, mois, jour, heure, minute, seconde } = partiesFr(date);
  const commeUtc = Date.UTC(annee, mois, jour, heure, minute, seconde, date.getMilliseconds());
  return commeUtc - date.getTime();
}

/**
 * L'instant où commence une date civile française.
 *
 * `new Date(2026, 7, 1)` donne minuit **dans le fuseau du processus** : sur le
 * serveur en UTC, cela tombe deux heures après le vrai début de la journée
 * française. Une campagne bornée ainsi laissait dehors les saisies du 1ᵉʳ août
 * entre 00 h 00 et 02 h 00.
 */
function instantFr(annee: number, mois: number, jour: number): Date {
  const approche = Date.UTC(annee, mois, jour, 0, 0, 0, 0);
  // Deux passes : la première peut tomber du mauvais côté d'un changement
  // d'heure, la seconde se cale dessus.
  const premier = approche - decalageFr(new Date(approche));
  return new Date(approche - decalageFr(new Date(premier)));
}

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
  const { annee, mois } = partiesFr(date);
  return mois >= MOIS_BASCULE ? annee + 1 : annee;
}

/**
 * Premier et dernier jour de la campagne, aux bornes incluses.
 *
 * `debut` est l'instant où commence le 1ᵉʳ août français ; `fin` celui où
 * commence le 31 juillet français. Les deux sont des instants réels, pas des
 * minuits du fuseau de la machine.
 */
export function periodeCampagne(annee: number): { debut: Date; fin: Date } {
  // `mois: 7, jour: 0` = le dernier jour de juillet, sans avoir à savoir s'il
  // en compte 30 ou 31.
  const finParties = new Date(Date.UTC(annee, MOIS_BASCULE, 0));
  return {
    debut: instantFr(annee - 1, MOIS_BASCULE, 1),
    fin: instantFr(annee, finParties.getUTCMonth(), finParties.getUTCDate()),
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
  const { annee, mois, jour } = partiesFr(date);
  return `${jour === 1 ? '1ᵉʳ' : jour} ${MOIS[mois]} ${annee}`;
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
