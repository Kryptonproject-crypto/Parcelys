import Link from 'next/link';
import { cn } from '@/components/ui';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

/**
 * Pagination des listes d'administration, par liens : chaque page a son
 * adresse, se partage et survit au rafraîchissement. Les autres paramètres de
 * la liste (filtre, recherche) sont conservés.
 */
export function AdminPagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const href = (p: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
    if (p > 1) search.set('page', String(p));
    const suffix = search.toString();
    return suffix ? `${basePath}?${suffix}` : basePath;
  };

  const debut = (page - 1) * pageSize + 1;
  const fin = Math.min(total, page * pageSize);
  const lien = 'inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-[13px] font-medium';

  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
      <p className="text-[13px] text-ink-3">
        {debut}–{fin} sur {total}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cn(lien, 'text-ink-2 hover:bg-surface-2')} rel="prev">
            <IconChevronLeft size={15} aria-hidden /> Précédente
          </Link>
        ) : (
          <span className={cn(lien, 'text-ink-3 opacity-50')} aria-disabled>
            <IconChevronLeft size={15} aria-hidden /> Précédente
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={cn(lien, 'text-ink-2 hover:bg-surface-2')} rel="next">
            Suivante <IconChevronRight size={15} aria-hidden />
          </Link>
        ) : (
          <span className={cn(lien, 'text-ink-3 opacity-50')} aria-disabled>
            Suivante <IconChevronRight size={15} aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
