/**
 * L'état d'un produit phytosanitaire, dit en clair, sur le site comme dans
 * l'application.
 *
 * Un produit retiré n'est pas forcément interdit : l'ANSES publie, usage par
 * usage, une date de fin d'utilisation — le délai d'écoulement des stocks.
 * Jusque-là, un bidon acheté avant le retrait s'emploie légalement. Dire
 * « retiré » sans la date faisait croire le contraire.
 */

export type EtatProduit = {
  ton: 'autorise' | 'delai' | 'interdit';
  libelle: string;
};

function jour(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
}

export function etatDuProduit(
  produit: { authorized: boolean; withdrawnAt: string | null; finUtilisation?: string | null },
  /** Date de référence : aujourd'hui, ou la date du traitement saisi. */
  le: Date = new Date(),
): EtatProduit {
  if (produit.authorized) return { ton: 'autorise', libelle: 'Autorisé' };
  const retrait = jour(produit.withdrawnAt);
  const tete = retrait ? `Retiré le ${retrait}` : 'Retiré du marché';
  const fin = produit.finUtilisation ? new Date(produit.finUtilisation) : null;
  if (fin && !Number.isNaN(fin.getTime())) {
    return fin.getTime() >= le.getTime() - 86_400_000 + 1
      ? { ton: 'delai', libelle: `${tete} — utilisable jusqu’au ${jour(produit.finUtilisation)}` }
      : { ton: 'interdit', libelle: `${tete} — utilisation interdite depuis le ${jour(produit.finUtilisation)}` };
  }
  return { ton: 'interdit', libelle: tete };
}
