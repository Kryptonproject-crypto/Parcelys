'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, cn } from '@/components/ui';
import { IconSearch } from '@/components/ui/icons';

/**
 * Filtres et recherche d'une liste d'administration, portés par l'adresse :
 * la liste filtrée se partage et survit au rafraîchissement.
 */
export function ListFilters({
  basePath,
  filters,
  current,
  search,
  placeholder,
  extraParams = {},
}: {
  basePath: string;
  filters?: Array<{ value: string; label: string }>;
  current?: string;
  search: string;
  placeholder: string;
  extraParams?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const defaut = filters?.[0]?.value;

  function href(next: { statut?: string; q?: string }): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) if (v) params.set(k, v);
    const statut = next.statut ?? current;
    const q = next.q ?? query;
    if (statut && statut !== defaut) params.set('statut', statut);
    if (q.trim()) params.set('q', q.trim());
    const suffix = params.toString();
    return suffix ? `${basePath}?${suffix}` : basePath;
  }

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    router.push(href({ q: query }));
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {filters ? (
        <ul className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <li key={f.value}>
              <Link
                href={href({ statut: f.value })}
                aria-current={f.value === current ? 'page' : undefined}
                className={cn(
                  'inline-flex rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  f.value === current
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <span />
      )}
      <form onSubmit={onSearch} className="flex gap-2" role="search">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Rechercher"
          className="sm:w-64"
        />
        <Button type="submit" variant="outline" icon={IconSearch}>
          Chercher
        </Button>
      </form>
    </div>
  );
}
