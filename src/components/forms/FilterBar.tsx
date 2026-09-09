import type { ReactNode } from 'react';
import { Card, cn } from '@/components/ui';
import { IconFilter } from '@/components/ui/icons';

/**
 * Barre de filtres des pages de consultation.
 *
 * Formulaire `GET` classique : les filtres restent dans l'URL, donc
 * partageables, mémorisables et fonctionnels sans JavaScript. Le rendu est
 * centralisé ici pour que toutes les pages partagent la même grammaire visuelle.
 */
export function FilterBar({
  children,
  action,
  className,
}: {
  children: ReactNode;
  /** Actions secondaires à droite du bouton « Filtrer ». */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('mb-5', className)}>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {children}

        <div className="ml-auto flex items-end gap-2">
          {action}
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-champ-600 px-4 text-sm font-medium text-white shadow-card transition-all hover:bg-champ-700 hover:shadow-raised dark:bg-champ-500 dark:text-champ-950 dark:hover:bg-champ-400"
          >
            <IconFilter size={15} aria-hidden />
            Filtrer
          </button>
        </div>
      </form>
    </Card>
  );
}

/** Champ d'une barre de filtres : libellé court au-dessus du contrôle. */
export function FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-40 flex-1', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
