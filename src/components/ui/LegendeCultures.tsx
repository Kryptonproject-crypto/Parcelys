import {
  COULEUR_FAMILLE,
  LIBELLE_FAMILLE,
  familleVisuelle,
  type FamilleVisuelle,
} from '@/lib/shared/cultures';

/**
 * Les familles de cultures présentes et leur couleur : la légende des cartes
 * et des listes. La même que dans l'application de terrain.
 */
export function LegendeCultures({ noms, className }: { noms: Array<string | null>; className?: string }) {
  const familles = new Map<FamilleVisuelle, number>();
  for (const nom of noms) {
    if (!nom) continue;
    const famille = familleVisuelle(nom);
    familles.set(famille, (familles.get(famille) ?? 0) + 1);
  }
  if (familles.size === 0) return null;
  return (
    <ul
      className={`flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2 ${className ?? ''}`}
      aria-label="Couleurs des cultures"
    >
      {[...familles]
        .sort((a, b) => b[1] - a[1])
        .map(([famille, nombre]) => (
          <li key={famille} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: COULEUR_FAMILLE[famille] }}
            />
            {LIBELLE_FAMILLE[famille]}
            <span className="tabular-nums text-ink-3">{nombre}</span>
          </li>
        ))}
    </ul>
  );
}
