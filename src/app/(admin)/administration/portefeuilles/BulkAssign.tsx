'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Checkbox, EmptyState } from '@/components/ui';
import { IconFarm } from '@/components/ui/icons';
import { AssignPortfolio } from '@/app/(admin)/administration/AssignPortfolio';

/**
 * Sélection groupée de clients, puis transfert vers un autre portefeuille (ou
 * attribution de clients sans portefeuille). Chaque client déplacé est
 * journalisé un par un, côté serveur.
 */
export function BulkAssign({
  kind,
  items,
  current,
  portfolios,
  emptyLabel,
}: {
  kind: 'farm' | 'technician';
  items: Array<{ id: string; label: string; number: string | null; href: string; detail?: string | null }>;
  current: string | null;
  portfolios: Array<{ id: string; name: string }>;
  emptyLabel: string;
}) {
  const [choisis, setChoisis] = useState<string[]>([]);
  if (items.length === 0) return <EmptyState icon={IconFarm} title={emptyLabel} />;
  const tous = choisis.length === items.length;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <Checkbox checked={tous} onChange={() => setChoisis(tous ? [] : items.map((i) => i.id))} />
        Tout sélectionner ({items.length})
      </label>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Checkbox
              checked={choisis.includes(item.id)}
              onChange={(event) =>
                setChoisis((c) => (event.target.checked ? [...c, item.id] : c.filter((x) => x !== item.id)))
              }
              aria-label={`Sélectionner ${item.label}`}
            />
            <Link href={item.href} className="min-w-0 flex-1 truncate hover:underline">
              <span className="font-medium text-ink">{item.label}</span>{' '}
              <span className="font-mono text-[12px] text-ink-3">{item.number}</span>
              {item.detail ? <span className="text-[12.5px] text-ink-3"> · {item.detail}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <AssignPortfolio
        kind={kind}
        ids={choisis}
        label={`${choisis.length} ${kind === 'farm' ? 'exploitation(s)' : 'technicien(s)'}`}
        current={current}
        portfolios={portfolios}
      />
    </div>
  );
}
