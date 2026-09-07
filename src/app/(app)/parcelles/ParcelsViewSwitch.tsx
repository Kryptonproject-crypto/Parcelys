'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const VIEWS = [
  { key: 'liste', label: 'Liste', icon: '▤' },
  { key: 'tableau', label: 'Tableau', icon: '▦' },
  { key: 'carte', label: 'Carte', icon: '🗺️' },
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
    <div className="mb-4 inline-flex rounded-lg border border-ardoise-200 bg-white p-0.5">
      {VIEWS.map((view) => (
        <button
          key={view.key}
          type="button"
          onClick={() => select(view.key)}
          aria-pressed={current === view.key}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            current === view.key
              ? 'bg-champ-600 text-white'
              : 'text-ardoise-600 hover:bg-ardoise-100'
          }`}
        >
          <span aria-hidden>{view.icon}</span>
          {view.label}
        </button>
      ))}
    </div>
  );
}
