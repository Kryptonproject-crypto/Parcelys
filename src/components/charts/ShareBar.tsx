'use client';

import { useState } from 'react';
import { SeriesDot, cn, formatCompactFr } from '@/components/ui';
import type { ShareSlice } from '@/components/charts/palette';

/**
 * Barre empilée horizontale : répartition d'un tout entre plusieurs parts
 * (l'assolement d'une exploitation, par exemple).
 *
 * Forme retenue pour un « part-à-tout » avec des libellés longs. Chaque segment
 * est séparé de 2 px par la couleur de surface, ce qui garde les limites nettes
 * même entre deux teintes proches. La légende liste toutes les parts avec leur
 * valeur : la couleur n'est jamais le seul porteur d'information.
 */
export function ShareBar({
  slices,
  total,
  unit = 'ha',
  emptyLabel = 'Aucune donnée',
  className,
}: {
  slices: ShareSlice[];
  /** Total de référence : peut dépasser la somme des parts (surface non couverte). */
  total: number;
  unit?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const covered = slices.reduce((sum, slice) => sum + slice.value, 0);
  const scale = total > 0 ? total : covered;
  const uncovered = Math.max(0, scale - covered);

  if (scale <= 0 || slices.length === 0) {
    return (
      <div className={cn('py-6 text-center text-sm text-ink-3', className)}>
        {emptyLabel}
      </div>
    );
  }

  const share = (value: number): number => (value / scale) * 100;

  return (
    <div className={className}>
      {/* Barre */}
      <div
        className="flex h-9 w-full gap-[2px] overflow-hidden rounded-lg"
        role="img"
        aria-label={`Répartition : ${slices
          .map((s) => `${s.label} ${formatCompactFr(s.value)} ${unit}`)
          .join(', ')}`}
      >
        {slices.map((slice) => {
          const percent = share(slice.value);
          const dimmed = hovered !== null && hovered !== slice.label;
          return (
            <div
              key={slice.label}
              onMouseEnter={() => setHovered(slice.label)}
              onMouseLeave={() => setHovered(null)}
              title={`${slice.label} — ${formatCompactFr(slice.value)} ${unit} (${percent.toFixed(0)} %)`}
              className="group relative origin-left animate-grow-x transition-opacity duration-150"
              style={{
                width: `${percent}%`,
                backgroundColor: slice.color,
                opacity: dimmed ? 0.35 : 1,
              }}
            >
              {/* Libellé direct dès que le segment est assez large. */}
              {percent > 14 ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-1 text-[12.5px] sm:text-[11px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                  {percent.toFixed(0)} %
                </span>
              ) : null}
            </div>
          );
        })}

        {uncovered > 0.01 ? (
          <div
            title={`Sans culture renseignée — ${formatCompactFr(uncovered)} ${unit}`}
            className="origin-left animate-grow-x bg-surface-3 bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,var(--color-line-strong)_5px,var(--color-line-strong)_6px)]"
            style={{ width: `${share(uncovered)}%` }}
          />
        ) : null}
      </div>

      {/* Légende — toujours présente, avec la valeur en clair. */}
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {slices.map((slice) => (
          <li
            key={slice.label}
            onMouseEnter={() => setHovered(slice.label)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              'flex items-baseline gap-2 rounded-md px-1 py-0.5 transition-colors',
              hovered === slice.label && 'bg-surface-2',
            )}
          >
            <SeriesDot color={slice.color} className="translate-y-[1px]" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {slice.label}
              {slice.detail ? (
                <span className="ml-1.5 text-ink-3">· {slice.detail}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-ink">
              {formatCompactFr(slice.value)} {unit}
            </span>
          </li>
        ))}

        {uncovered > 0.01 ? (
          <li className="flex items-baseline gap-2 px-1 py-0.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-sm border border-line-strong bg-surface-3"
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-3">
              Sans culture renseignée
            </span>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-ink-3">
              {formatCompactFr(uncovered)} {unit}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
