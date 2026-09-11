/**
 * Le voyant de synchronisation de l'application de terrain.
 *
 * Placé ici plutôt que dans `mobile/` pour la même raison que
 * `src/lib/ephy/catalogue-local.ts` : un test de la racine qui importe un
 * module mobile rattrape tout le graphe mobile dans la compilation du serveur,
 * où les dépendances de l'application ne sont pas installées. Sur un dépôt
 * fraîchement cloné, cela fait échouer `npm run build` sur un module
 * introuvable — panne invisible tant qu'on développe les deux côte à côte.
 *
 * Ce fichier n'importe rien : ni du serveur, ni de l'application. C'est la
 * condition pour vivre dans le terrain commun.
 */

export type SyncStatus =
  /** Rien en attente, réseau présent : tout est chez le serveur. */
  | 'synchronise'
  /** Envoi en cours. */
  | 'en-cours'
  /** Des saisies attendent, réseau présent : il reste à envoyer. */
  | 'en-attente'
  /** Le dernier envoi a échoué, ou des saisies ont été refusées. */
  | 'erreur'
  /** Pas de réseau. Ce n'est pas une panne. */
  | 'hors-ligne';

/**
 * Le voyant, dérivé de ce qui est vrai.
 *
 * Fonction pure, et pas un état tenu à jour par écriture : un indicateur qu'on
 * met à jour à la main finit toujours par mentir, il suffit d'un chemin qui
 * oublie de le remettre à zéro. Celui-ci se recalcule du réseau, de la file et
 * du dernier envoi.
 *
 * L'ordre des cas n'est pas indifférent :
 *
 *  · l'envoi en cours passe avant tout — c'est la seule information qui
 *    demande de patienter plutôt que d'agir ;
 *  · l'absence de réseau passe avant l'erreur, sinon un échec constaté à
 *    l'entrée d'un bâtiment resterait rouge une fois le téléphone hors
 *    couverture, alors que la vraie raison n'est plus la même ;
 *  · l'erreur passe avant l'attente : une saisie refusée attend, elle aussi,
 *    mais elle ne partira pas toute seule.
 */
export function syncStatusFrom(etat: {
  online: boolean;
  pending: number;
  syncing: boolean;
  error: string | null;
}): SyncStatus {
  if (etat.syncing) return 'en-cours';
  if (!etat.online) return 'hors-ligne';
  if (etat.error) return 'erreur';
  if (etat.pending > 0) return 'en-attente';
  return 'synchronise';
}
