/**
 * Le dernier opérateur saisi sur cet appareil.
 *
 * Sur une exploitation, c'est presque toujours la même personne qui traite :
 * lui faire retaper son nom à chaque traitement, c'est s'assurer qu'il finira
 * par ne plus le taper — et le registre portera « opérateur non renseigné ».
 * Le nom est proposé, jamais imposé : il se change dans le champ.
 *
 * Gardé dans le stockage local du navigateur ou de l'application, pas sur le
 * serveur : c'est une commodité de l'appareil, pas une donnée du registre.
 * Le stockage peut être indisponible (navigation privée) : rien ne casse, le
 * champ reste simplement vide.
 */
const CLE = 'parcelys.dernier-operateur';

export function dernierOperateur(): string {
  try {
    return globalThis.localStorage?.getItem(CLE) ?? '';
  } catch {
    return '';
  }
}

export function retenirOperateur(nom: string | null | undefined): void {
  const propre = nom?.trim();
  if (!propre) return;
  try {
    globalThis.localStorage?.setItem(CLE, propre.slice(0, 120));
  } catch {
    // Stockage indisponible : rien à retenir, rien de cassé.
  }
}
