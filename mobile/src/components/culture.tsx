import { COULEUR_FAMILLE, LIBELLE_FAMILLE, familleVisuelle, type FamilleVisuelle } from '@commun/cultures';

/** Le point de couleur d'une culture : il aide à parcourir, le nom dit le reste. */
export function PointCulture({ nom, className }: { nom: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className ?? ''}`}
      style={{ backgroundColor: COULEUR_FAMILLE[familleVisuelle(nom)] }}
    />
  );
}

/** Les familles de cultures présentes, avec leur couleur : la légende de la carte. */
export function LegendeCultures({ noms }: { noms: Array<string | null> }) {
  const familles = new Map<FamilleVisuelle, number>();
  for (const nom of noms) {
    if (!nom) continue;
    const famille = familleVisuelle(nom);
    familles.set(famille, (familles.get(famille) ?? 0) + 1);
  }
  if (familles.size === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[12px] text-ink-2" aria-label="Couleurs des cultures">
      {[...familles]
        .sort((a, b) => b[1] - a[1])
        .map(([famille, nombre]) => (
          <li key={famille} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: COULEUR_FAMILLE[famille] }}
            />
            {LIBELLE_FAMILLE[famille]} <span className="tabular-nums text-ink-3">{nombre}</span>
          </li>
        ))}
    </ul>
  );
}
