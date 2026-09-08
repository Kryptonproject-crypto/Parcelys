import Link from 'next/link';
import type { RecommendationView } from '@/lib/services/advisory';
import {
  KIND_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from '@/lib/services/advisory.shared';
import { Badge, EmptyState, cn, formatDateFr, formatNumberFr } from '@/components/ui';
import { IconRegistry, IconWarning } from '@/components/ui/icons';

type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  PROPOSED: 'amber',
  ACCEPTED: 'green',
  DECLINED: 'red',
  APPLIED: 'blue',
  WITHDRAWN: 'neutral',
};

/**
 * Liste de préconisations, partagée par l'expert et l'exploitant.
 *
 * Deux points de lecture comptent et sont donc toujours visibles : l'état
 * — savoir ce qui attend une réponse — et la provenance du produit cité. Un
 * produit dont l'AMM n'a pas pu être rapprochée du catalogue officiel est
 * signalé comme tel, jamais présenté comme vérifié.
 */
export function RecommendationList({
  recommendations,
  viewer,
  emptyLabel,
  compact = false,
  linkBase = '/preconisations',
}: {
  recommendations: RecommendationView[];
  viewer: 'expert' | 'farm';
  emptyLabel: string;
  compact?: boolean;
  linkBase?: string;
}) {
  if (recommendations.length === 0) {
    return compact ? (
      <p className="py-6 text-center text-sm text-ink-3">{emptyLabel}</p>
    ) : (
      <EmptyState icon={IconRegistry} title="Aucune préconisation" description={emptyLabel} />
    );
  }

  return (
    <ul className={cn('space-y-2.5', compact && 'space-y-2')}>
      {recommendations.map((item) => (
        <li key={item.id}>
          <Link
            href={`${linkBase}/${item.id}`}
            className={cn(
              'block rounded-xl border border-line bg-surface p-3.5 transition-colors',
              'hover:border-champ-300 hover:bg-accent-soft/25',
              item.priority === 'HIGH' && item.status === 'PROPOSED' &&
                'border-ble-500/50',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
                  {KIND_LABELS[item.kind]}
                  {item.parcelName ? ` · ${item.parcelName}` : " · toute l'exploitation"}
                  {viewer === 'expert' ? ` · ${item.farmName}` : ` · ${item.author.name}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={STATUS_TONES[item.status] ?? 'neutral'}>
                  {STATUS_LABELS[item.status]}
                </Badge>
                {item.priority === 'HIGH' ? (
                  <Badge tone="red" icon={IconWarning}>
                    {PRIORITY_LABELS.HIGH}
                  </Badge>
                ) : null}
              </div>
            </div>

            {!compact ? (
              <>
                {item.productName ? (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    <span className="font-medium text-ink">{item.productName}</span>
                    {item.dose !== null ? (
                      <span className="tabular-nums">
                        {formatNumberFr(item.dose, 2)} {item.doseUnit}
                      </span>
                    ) : null}
                    {item.productSource === 'catalogue' ? (
                      <Badge tone="green">AMM {item.amm} · catalogue officiel</Badge>
                    ) : (
                      <Badge tone="amber">Produit non vérifié au catalogue</Badge>
                    )}
                  </p>
                ) : null}

                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">
                  {item.rationale}
                </p>
              </>
            ) : null}

            <p className="mt-2 text-[11.5px] text-ink-3">
              {item.windowStart || item.windowEnd
                ? `Fenêtre : ${item.windowStart ? formatDateFr(item.windowStart) : '…'} → ${
                    item.windowEnd ? formatDateFr(item.windowEnd) : '…'
                  } · `
                : ''}
              {item.status === 'DRAFT'
                ? `Brouillon du ${formatDateFr(item.createdAt)}`
                : `Transmise le ${formatDateFr(item.createdAt)}`}
              {item.respondedAt ? ` · réponse le ${formatDateFr(item.respondedAt)}` : ''}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
