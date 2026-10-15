/**
 * Une unité de stock telle qu'on l'écrit.
 *
 * Le stock range ses unités en minuscules (« l », « ml », « kg ») pour les
 * comparer et les convertir ; à l'écran, le litre s'écrit « L » — un « l »
 * seul se confond avec le chiffre 1.
 */
const AFFICHAGE: Record<string, string> = { l: 'L', ml: 'mL', hl: 'hL', cl: 'cL' };

export function uniteAffichee(unite: string | null | undefined): string {
  const u = (unite ?? '').trim();
  return AFFICHAGE[u.toLowerCase()] ?? u;
}
