/**
 * Afficher une culture et une parcelle, sur le site comme dans l'application.
 *
 * Les libellés de la nomenclature PAC sont exacts mais longs : « Prairie
 * permanente - herbe prédominante (ressources fourragères ligneuses absentes
 * ou peu présentes) » ne tient pas dans une ligne de liste. La fiche garde le
 * libellé entier ; les listes en montrent la forme courte, et une couleur par
 * famille pour s'y retrouver d'un coup d'œil sur cent parcelles.
 *
 * Purement visuel : aucune règle ne lit la forme courte ni la couleur. Le
 * moteur réglementaire lit le nom entier.
 */

function sansAccents(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Le nom sans ses précisions entre parenthèses : « Maïs (hors maïs doux) »
 * → « Maïs ». Un nom qui ne serait plus rien sans elles est rendu tel quel.
 */
export function nomCourtDeCulture(nom: string | null | undefined): string | null {
  const brut = (nom ?? '').trim();
  if (!brut) return null;
  let court = brut
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:,]+$/, '')
    .trim();
  // « Prairie permanente - herbe prédominante » : ce qui suit le tiret précise
  // le couvert ; la liste dit « Prairie permanente », la fiche dit le reste.
  const tete = court.split(/\s+[-–—]\s+/)[0]!.trim();
  if (tete.length >= 4 && tete !== court) court = tete;
  return court.length >= 2 ? court : brut;
}

export type FamilleVisuelle =
  | 'prairie'
  | 'fourrage'
  | 'cereale'
  | 'mais'
  | 'oleagineux'
  | 'proteagineux'
  | 'non-cultive'
  | 'autre';

const FAMILLES: Array<[FamilleVisuelle, RegExp]> = [
  ['non-cultive', /\b(non exploitee|bande tampon|bordure|jachere|haie|bosquet|mare|surface non agricole)\b/],
  ['mais', /\bmais\b/],
  // Prairie avant fourrage : « Prairie permanente (ressources fourragères…) »
  // est une prairie, « Mélange de légumineuses fourragères » un fourrage.
  ['prairie', /\b(prairies?|herbe|pature|paturage|surface pastorale|parcours)\b/],
  ['fourrage', /\b(luzerne|trefle|sainfoin|vesce|melange|meteil|legumineuses? fourrageres?|ray ?grass|fetuque|dactyle|fourrag)/],
  ['cereale', /\b(bles?|orges?|triticale|avoine|seigle|epeautre|sorgho|millet|sarrasin|riz|cereales?)\b/],
  ['oleagineux', /\b(colza|tournesol|soja|lin|navette|moutarde|cameline|chanvre|oleagineu)/],
  ['proteagineux', /\b(pois|feveroles?|lupin|lentilles?|haricots?|proteagineu)/],
];

/** La famille d'une culture, d'après son nom — pour la couleur seulement. */
export function familleVisuelle(nom: string | null | undefined): FamilleVisuelle {
  const texte = sansAccents(nom ?? '').replace(/[^a-z0-9]+/g, ' ');
  for (const [famille, motif] of FAMILLES) if (motif.test(texte)) return famille;
  return 'autre';
}

/**
 * Une couleur par famille, lisible sur fond clair comme sombre. Toujours
 * accompagnée du nom : la couleur aide à parcourir, elle ne dit rien seule.
 */
export const COULEUR_FAMILLE: Record<FamilleVisuelle, string> = {
  prairie: '#4f9a47',
  fourrage: '#2c8c7f',
  cereale: '#c4922a',
  mais: '#dcae0c',
  oleagineux: '#95ad1c',
  proteagineux: '#8a68b5',
  'non-cultive': '#9aa1a8',
  autre: '#6f7c8a',
};

export const LIBELLE_FAMILLE: Record<FamilleVisuelle, string> = {
  prairie: 'Prairies',
  fourrage: 'Fourrages',
  cereale: 'Céréales',
  mais: 'Maïs',
  oleagineux: 'Oléagineux',
  proteagineux: 'Protéagineux',
  'non-cultive': 'Non cultivé',
  autre: 'Autres',
};

/**
 * Tri naturel des parcelles : « 4-3 » avant « 4-26 », « Îlot 2 » avant
 * « Îlot 10 ». Par numéro interne d'abord, puis par nom.
 */
export function comparerParcelles(
  a: { internalNumber?: string | null; name: string },
  b: { internalNumber?: string | null; name: string },
): number {
  const options = { numeric: true, sensitivity: 'base' } as const;
  const na = a.internalNumber?.trim() || '';
  const nb = b.internalNumber?.trim() || '';
  if (na && nb) {
    const parNumero = na.localeCompare(nb, 'fr', options);
    if (parNumero !== 0) return parNumero;
  } else if (na || nb) {
    // Les parcelles numérotées d'abord.
    return na ? -1 : 1;
  }
  return a.name.localeCompare(b.name, 'fr', options);
}

/**
 * Le nom dit-il déjà le numéro ? « Îlot 4 — parcelle 3 » et « 4-3 » : le
 * répéter sous le nom n'apprend rien.
 */
export function nomDitLeNumero(name: string, internalNumber: string | null | undefined): boolean {
  const numero = internalNumber?.trim();
  if (!numero) return true;
  const m = name.match(/^\s*[îi]lot\s+(\S+)\s*[—–-]\s*parcelle\s+(\S+)\s*$/i);
  return Boolean(m && `${m[1]}-${m[2]}` === numero);
}

/**
 * Le nom d'une parcelle dans une liste de choix : « 4-3 — La Croix Rouge »,
 * mais « Îlot 4 — parcelle 3 » seul quand le nom dit déjà le numéro.
 */
export function libelleParcelle(parcelle: { name: string; internalNumber?: string | null }): string {
  return parcelle.internalNumber && !nomDitLeNumero(parcelle.name, parcelle.internalNumber)
    ? `${parcelle.internalNumber} — ${parcelle.name}`
    : parcelle.name;
}
