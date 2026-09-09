import type { AccountType } from '@prisma/client';

/**
 * Les trois natures de compte, et ce qu'elles impliquent.
 *
 *   FARMER      possède ou rejoint une exploitation ; c'est le compte de terrain.
 *   AGRONOMIST  n'a pas d'exploitation à lui ; il suit celles qui lui ouvrent
 *               l'accès, depuis son portefeuille.
 *   ADMIN       n'a ni exploitation ni portefeuille ; il administre l'instance.
 *
 * Deux notions à ne pas confondre, parce qu'elles ne se recouvrent pas :
 *
 *   · le **type de compte** dit ce que le compte est ;
 *   · `isPlatformAdmin` dit ce qu'il a le **droit** de faire.
 *
 * Un exploitant peut être administrateur de son instance sans cesser d'être
 * exploitant — c'est le cas de quiconque installe Parcelys chez lui, et le
 * premier compte créé sur une base vide. Le type `ADMIN`, lui, désigne un compte
 * créé *pour* l'administration, qui n'a pas de parcelles à suivre.
 */

/** Ce compte dispose-t-il d'un espace d'exploitation ? */
export function hasFarmSpace(accountType: AccountType): boolean {
  return accountType === 'FARMER';
}

/** Ce compte dispose-t-il d'un portefeuille de conseil ? */
export function hasPortfolio(accountType: AccountType): boolean {
  return accountType === 'AGRONOMIST';
}

/**
 * Où envoyer ce compte à la connexion, et quand il atterrit au mauvais endroit.
 *
 * Un expert renvoyé vers le tableau de bord d'exploitation n'y verrait qu'un
 * sélecteur vide ; un administrateur, la même chose. Mieux vaut les conduire
 * d'emblée là où ils ont quelque chose à faire.
 */
export function homePathFor(accountType: AccountType): string {
  switch (accountType) {
    case 'AGRONOMIST':
      return '/portefeuille';
    case 'ADMIN':
      return '/administration';
    default:
      return '/dashboard';
  }
}

/**
 * Ce compte crée-t-il une exploitation à l'inscription ?
 *
 * Ni l'expert ni l'administrateur : leur en faire créer une leur donnerait des
 * parcelles fictives à gérer, et fausserait les décomptes de l'instance.
 */
export function createsFarmOnRegistration(accountType: AccountType): boolean {
  return accountType === 'FARMER';
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  FARMER: 'Exploitation',
  AGRONOMIST: 'Expert agronomique',
  ADMIN: 'Administration',
};

/**
 * Un compte d'administration sans le droit d'administrer ne pourrait rien
 * faire : ni parcelles, ni portefeuille, ni écrans de gestion. Le type implique
 * donc le droit.
 */
export function impliesPlatformAdmin(accountType: AccountType): boolean {
  return accountType === 'ADMIN';
}
