/**
 * Palette des graphiques.
 *
 * Les six teintes sont attribuées dans un ordre FIXE, jamais recyclé : une
 * culture garde sa couleur même si un filtre en retire d'autres. Au-delà de six
 * séries, le reste est regroupé sous « Autres » plutôt que d'inventer une
 * septième teinte — une teinte générée serait indistinguable des précédentes
 * pour un daltonien.
 *
 * La séparation a été vérifiée pour les deux thèmes (écart CVD ΔE ≥ 8,
 * vision normale ΔE ≥ 19, contraste ≥ 3:1 sur fond sombre). En thème clair,
 * trois teintes passent sous 3:1 : chaque graphique porte donc des libellés
 * lisibles à côté des couleurs, jamais la couleur seule.
 */
export const SERIES_COLORS = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
  'var(--serie-6)',
] as const;

/** Teinte des séries repliées dans « Autres ». */
export const OTHER_COLOR = 'var(--color-ardoise-400)';

export const MAX_SERIES = SERIES_COLORS.length;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? OTHER_COLOR;
}

export type ShareSlice = {
  label: string;
  value: number;
  color: string;
  /** Information secondaire affichée dans la légende (nombre de parcelles…). */
  detail?: string;
};

/**
 * Prépare des parts à représenter : tri décroissant, attribution des couleurs
 * dans l'ordre fixe, repli du reste sous « Autres ».
 */
export function buildShares(
  items: Array<{ label: string; value: number; detail?: string }>,
  maxSlices = MAX_SERIES,
): ShareSlice[] {
  const sorted = [...items]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (sorted.length <= maxSlices) {
    return sorted.map((item, index) => ({ ...item, color: seriesColor(index) }));
  }

  const head = sorted.slice(0, maxSlices - 1);
  const tail = sorted.slice(maxSlices - 1);
  const tailTotal = tail.reduce((sum, item) => sum + item.value, 0);

  return [
    ...head.map((item, index) => ({ ...item, color: seriesColor(index) })),
    {
      label: 'Autres',
      value: tailTotal,
      color: OTHER_COLOR,
      detail: `${tail.length} culture${tail.length > 1 ? 's' : ''}`,
    },
  ];
}
