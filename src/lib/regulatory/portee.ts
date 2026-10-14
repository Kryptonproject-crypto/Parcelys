/**
 * Portée d'un classement publié — module pur, sans base.
 *
 * Partagé par le moteur (côté serveur) et par l'affichage du contexte d'une
 * parcelle (côté navigateur) : les deux doivent lire un classement « quelques
 * sections », « retirée en 2024 » ou « périmètre non fourni » de la même façon,
 * sans quoi l'écran afficherait « parcelle concernée » là où le moteur répond
 * « indéterminé ».
 */

/**
 * Jusqu'où le classement publié engage-t-il la parcelle ?
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE QUESTION SE POSE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Les zones vulnérables d'Auvergne-Rhône-Alpes sont publiées **à la commune** :
 * la généalogie du jeu de la DREAL le dit mot pour mot — « Établi à partir
 * d'une liste des communes par arrêté préfectoral », au 1:50 000. Le polygone
 * fourni est donc le contour communal, pas celui de la zone.
 *
 * Pour 907 des 1 125 communes classées, l'arrêté vise « toutes sections » : le
 * contour communal **est** la zone, et une parcelle qui le recoupe est dedans.
 *
 * Pour 218 autres, il ne vise que « quelques sections » cadastrales — et le
 * fichier ne dit pas lesquelles. Conclure « dedans » parce que la parcelle est
 * dans la commune classerait à tort ; conclure « dehors » dispenserait à tort
 * de règles qui s'appliquent peut-être. La seule réponse honnête est
 * **indéterminé**, avec ce qu'il faut consulter pour trancher.
 *
 * Quand la source ne précise rien, c'est que le polygone est la zone : la
 * géométrie parle d'elle-même, et le recoupement suffit.
 */
export type PorteeDuClassement =
  /** Toute la commune est classée : le recoupement tranche. */
  | 'totale'
  /** Seules certaines sections cadastrales, non nommées par la source. */
  | 'partielle'
  /** La commune a été retirée du zonage à cette date. */
  | 'hors-zone'
  /** Ce zonage n'était pas encore en vigueur à cette date. */
  | 'non-en-vigueur'
  /** La source ne précise rien : la géométrie est la zone. */
  | 'non-precisee';

export function porteeDuClassement(
  attributes: Record<string, unknown> | null | undefined,
  date: Date = new Date(),
): PorteeDuClassement {
  /*
   * Le classement en vigueur se lit **à une date**.
   *
   * Les décisions du tribunal administratif du 6 juin 2024 ont retiré sept
   * communes de l'Allier de la zone vulnérable et en ont réduit deux à
   * « quelques sections ». Lire le seul classement de 2021 classerait encore
   * Bost ou Billezois en zone vulnérable ; lire la seule colonne de 2024
   * effacerait rétroactivement des obligations qui s'appliquaient en 2023.
   *
   * L'import transcrit donc l'historique publié par la source — chaque
   * classement avec sa date d'effet et son texte — et c'est ici qu'on choisit
   * celui de la date demandée. Avant le premier, le zonage n'était pas en
   * vigueur : on ne sait pas, et l'on ne présume pas.
   */
  const historique = attributes?.classements;
  let valeur: unknown = attributes?.classement;

  if (Array.isArray(historique) && historique.length > 0) {
    const applicables = historique
      .filter(
        (entree): entree is { depuis: string; valeur: unknown } =>
          typeof entree === 'object' &&
          entree !== null &&
          typeof (entree as { depuis?: unknown }).depuis === 'string' &&
          !Number.isNaN(new Date((entree as { depuis: string }).depuis).getTime()) &&
          new Date((entree as { depuis: string }).depuis).getTime() <= date.getTime(),
      )
      .sort((a, b) => a.depuis.localeCompare(b.depuis));
    const enVigueur = applicables[applicables.length - 1];
    if (!enVigueur) return 'non-en-vigueur';
    valeur = enVigueur.valeur;
  }

  if (typeof valeur !== 'string') return 'non-precisee';
  const v = valeur.trim().toLowerCase();
  if (/suppress|retir|d[ée]class/.test(v)) return 'hors-zone';
  if (v.includes('toutes')) return 'totale';
  // « incertaine » : le périmètre n'est pas publié et seule la commune est
  // citée — c'est le cas des zones d'actions renforcées sans aire
  // d'alimentation connue. Même conséquence qu'un classement partiel.
  if (v.includes('quelques') || v.includes('partie') || v.includes('incertain')) {
    return 'partielle';
  }
  return 'non-precisee';
}
