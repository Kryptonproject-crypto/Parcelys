/**
 * Numéros publics : exploitations (`EXP-000001`), techniciens (`TEC-000001`)
 * et demandes de support (`DEM-000001`).
 *
 * Ici seulement la **lecture** de ce qu'une personne tape : la base seule
 * attribue les numéros (voir la migration 0.11.0). Partagé avec l'application
 * mobile, qui affiche le numéro et le prérempli du formulaire de contact.
 *
 * Un numéro n'est jamais une preuve d'identité ni une autorisation : c'est un
 * repère pour se parler. Le reconnaître ne donne accès à rien.
 */

export type PrefixeNumero = 'EXP' | 'TEC' | 'DEM';

export const LIBELLES_PREFIXE: Record<PrefixeNumero, string> = {
  EXP: 'Exploitation',
  TEC: 'Technicien',
  DEM: 'Demande',
};

/** Largeur minimale de la partie chiffrée ; au-delà, rien n'est tronqué. */
const LARGEUR = 6;

export function formaterNumero(prefixe: PrefixeNumero, valeur: number): string {
  const chiffres = String(Math.trunc(valeur));
  return `${prefixe}-${chiffres.padStart(LARGEUR, '0')}`;
}

/**
 * Reconnaît un numéro tapé à la main : `exp-12`, `EXP 000012`, `EXP000012`,
 * `Exp–12` (tiret long d'un traitement de texte) deviennent `EXP-000012`.
 * Rend `null` pour tout le reste — y compris un nombre seul, qui serait
 * ambigu entre les trois séries.
 */
export function lireNumero(
  saisie: string | null | undefined,
): { prefixe: PrefixeNumero; valeur: number; numero: string } | null {
  if (!saisie) return null;
  const nettoye = saisie.trim().toUpperCase().replace(/[\s‐-―_.]+/g, '-');
  const trouve = /^(EXP|TEC|DEM)-?0*(\d{1,12})$/.exec(nettoye);
  if (!trouve) return null;
  const prefixe = trouve[1] as PrefixeNumero;
  const valeur = Number(trouve[2]);
  if (!Number.isSafeInteger(valeur) || valeur <= 0) return null;
  return { prefixe, valeur, numero: formaterNumero(prefixe, valeur) };
}
