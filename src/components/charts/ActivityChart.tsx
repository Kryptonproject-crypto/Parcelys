'use client';

import { useState } from 'react';
import { SeriesDot, cn } from '@/components/ui';

export type ActivityMonth = {
  /** `AAAA-MM` */
  month: string;
  label: string;
  fertilization: number;
  phyto: number;
  operation: number;
};

/**
 * Interventions par mois, en colonnes empilées.
 *
 * Trois natures d'intervention seulement : la couleur suffit à les distinguer,
 * et la légende reste présente. Une seule échelle verticale — jamais deux axes.
 * Un survol fait apparaître le détail chiffré du mois.
 */
export function ActivityChart({
  data,
  className,
}: {
  data: ActivityMonth[];
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const totals = data.map((d) => d.fertilization + d.phyto + d.operation);
  const max = Math.max(1, ...totals);

  const series = [
    { key: 'fertilization', label: 'Apports', color: 'var(--serie-1)' },
    { key: 'phyto', label: 'Traitements', color: 'var(--serie-2)' },
    { key: 'operation', label: 'Travaux', color: 'var(--serie-3)' },
  ] as const;

  const grandTotal = totals.reduce((sum, n) => sum + n, 0);

  if (grandTotal === 0) {
    return (
      <div className={cn('py-10 text-center text-sm text-ink-3', className)}>
        Aucune intervention enregistrée sur la période.
      </div>
    );
  }

  const active = hovered ? data.find((d) => d.month === hovered) : null;

  return (
    <div className={className}>
      {/* Détail du mois survolé — sinon, le total de la campagne. */}
      <div className="mb-3 flex min-h-[1.75rem] items-baseline gap-2 text-sm">
        {active ? (
          <>
            <span className="font-medium capitalize text-ink">{active.label}</span>
            <span className="text-ink-3">
              {active.fertilization} apport{active.fertilization > 1 ? 's' : ''} ·{' '}
              {active.phyto} traitement{active.phyto > 1 ? 's' : ''} · {active.operation}{' '}
              travau{active.operation > 1 ? 'x' : ''}
            </span>
          </>
        ) : (
          <span className="text-ink-3">
            <span className="font-medium text-ink">{grandTotal}</span> intervention
            {grandTotal > 1 ? 's' : ''} sur 12 mois
          </span>
        )}
      </div>

      {/* Colonnes — la piste grisée matérialise le maximum de l'échelle. */}
      <div className="relative flex h-36 items-end gap-1.5">
        {data.map((month) => {
          const total = month.fertilization + month.phyto + month.operation;
          const dimmed = hovered !== null && hovered !== month.month;

          return (
            <div
              key={month.month}
              onMouseEnter={() => setHovered(month.month)}
              onMouseLeave={() => setHovered(null)}
              className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
            >
              {/* Piste de fond : rend l'échelle lisible même sur un mois vide. */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 top-0 rounded-[3px] bg-surface-2 transition-colors group-hover:bg-surface-3"
              />
              <div
                className="relative flex flex-col-reverse gap-[2px] transition-opacity duration-150"
                style={{
                  // Plancher de 6 % : une intervention isolée reste visible.
                  height: total > 0 ? `${Math.max(6, (total / max) * 100)}%` : '0%',
                  opacity: dimmed ? 0.4 : 1,
                }}
              >
                {series.map((serie) => {
                  const value = month[serie.key];
                  if (value === 0) return null;
                  return (
                    <div
                      key={serie.key}
                      className="w-full origin-bottom animate-grow-y first:rounded-t-[3px]"
                      style={{
                        height: `${(value / total) * 100}%`,
                        backgroundColor: serie.color,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Axe : un mois sur deux pour éviter les collisions de libellés. */}
      <div className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
        {data.map((month, index) => (
          <span
            key={month.month}
            className="flex-1 text-center text-[10px] uppercase tracking-wide text-ink-3"
          >
            {index % 2 === 0 ? month.label.slice(0, 3) : ''}
          </span>
        ))}
      </div>

      {/* Légende */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((serie) => (
          <li key={serie.key} className="flex items-center gap-1.5">
            <SeriesDot color={serie.color} />
            <span className="text-[13px] text-ink-2">{serie.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
