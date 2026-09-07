'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconGrid, IconParcels, IconTable } from '@/components/ui/icons';

const VIEWS = [
  { key: 'liste', label: 'Liste', icon: IconGrid },
  { key: 'tableau', label: 'Tableau', icon: IconTable },
  { key: 'carte', label: 'Carte', icon: IconParcels },
] as const;

/** Bascule liste / tableau / carte en conservant les filtres actifs. */
export function ParcelsViewSwitch({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(view: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('vue', view);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const active = current === view.key;
        return (
          <button
            key={view.key}
            type="button"
            onClick={() => select(view.key)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? 'bg-champ-600 text-white dark:bg-champ-500 dark:text-champ-950'
                : 'text-ink-2 hover:bg-surface-3'
            }`}
          >
            <Icon size={14} aria-hidden />
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
