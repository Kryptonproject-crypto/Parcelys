/**
 * Lecture des conditions d'emploi officielles.
 *
 * L'ANSES publie les conditions d'emploi en texte libre, une ligne par
 * condition, rangées par catégorie (« Environnement faune », « Riverains »,
 * « Délai de rentrée »…). Ce sont ces phrases — les mentions SPe notamment —
 * qui portent les restrictions de sol drainé et de dispositif végétalisé.
 *
 * Ce module ne reformule rien et ne décide rien : il repère les conditions qui
 * *parlent* de drainage pour pouvoir les remonter à l'exploitant au moment de
 * la saisie. Le texte affiché reste celui de l'ANSES, mot pour mot. Il n'y a
 * pas de règle déduite : si la phrase n'existe pas dans le catalogue, Parcelys
 * n'a rien à dire.
 */

/**
 * La condition vise-t-elle les sols drainés ?
 *
 * Les formulations rencontrées dans l'édition 2026-09 :
 *
 *   « SPe 2 : Pour protéger les organismes aquatiques, ne pas appliquer sur
 *     sol artificiellement drainé. »
 *   « Ne pas appliquer ce produit sur sols drainés. »
 *   « … ne pas appliquer ce produit sur sols artificiellement drainés en
 *     période de drainage »
 *
 * On cherche la racine « drain » : le mot ne survient pas ailleurs que dans ce
 * contexte dans le fichier. Repérer large et laisser lire la phrase entière
 * vaut mieux que rater une interdiction en voulant être précis.
 */
export function conditionConcernsDrainedSoil(label: string): boolean {
  return /drain/i.test(label);
}

/**
 * La condition interdit-elle l'application, ou la conditionne-t-elle seulement ?
 *
 * Une phrase peut mentionner le drainage sans rien interdire (« … en dehors des
 * périodes de drainage »). On distingue donc la négation explicite du reste,
 * sans jamais transformer un silence en autorisation : hors interdiction
 * reconnue, la condition est présentée comme « à vérifier », pas comme neutre.
 */
export function drainedSoilSeverity(label: string): 'interdit' | 'a-verifier' {
  const negation = /\bne\s+pas\s+(?:appliquer|utiliser|traiter)\b|\binterdit\b|\bproscrit\b/i;
  return negation.test(label) ? 'interdit' : 'a-verifier';
}
