'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV_GROUPS, adminSectionsFor } from '@/components/layout/navigation';
import type { AdminRole } from '@/lib/admin/roles';
import { cn } from '@/components/ui';

/**
 * Onglets de la section d'administration, groupés et filtrés par rôle.
 *
 * Un administrateur secondaire ne voit que ses sections : Pilotage et Clients.
 * Ce filtrage est un confort ; chaque page revérifie côté serveur.
 *
 * La vue d'ensemble se compare exactement : sans cela, elle resterait active
 * sur toutes les sous-pages, qui commencent toutes par `/administration`.
 */
export function AdminTabs({
  role,
  sidebarHasSections = false,
}: {
  role: AdminRole;
  /**
   * La barre latérale montre déjà les sections (compte d'administration) :
   * sur grand écran, les onglets feraient doublon. Ils restent sur téléphone,
   * où la barre latérale est repliée.
   */
  sidebarHasSections?: boolean;
}) {
  const pathname = usePathname();
  const sections = adminSectionsFor(role);

  return (
    <nav
      aria-label="Sections d'administration"
      // `relative` : les libellés de groupe réservés aux lecteurs d'écran
      // (`sr-only`, positionnés en absolu) prendraient sinon la page entière
      // pour bloc conteneur — la barre défilante ne les découperait plus, et
      // ils élargiraient la page à mesure que les onglets s'allongent.
      className={cn(
        'relative mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 no-print',
        sidebarHasSections && 'lg:hidden',
      )}
    >
      <ul className="flex min-w-max items-stretch gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {ADMIN_NAV_GROUPS.map((group, index) => {
          const items = sections.filter((s) => s.adminGroup === group.key);
          if (items.length === 0) return null;
          return (
            <li key={group.key} className="flex items-stretch">
              {index > 0 ? (
                <span aria-hidden className="mx-1 my-1.5 w-px self-stretch bg-line" />
              ) : null}
              <span className="sr-only">{group.label}</span>
              <ul className="flex gap-1">
                {items.map((section) => {
                  const active =
                    section.href === '/administration'
                      ? pathname === '/administration'
                      : pathname === section.href || pathname.startsWith(`${section.href}/`);
                  const Icon = section.icon;
                  return (
                    <li key={section.href}>
                      <Link
                        href={section.href}
                        aria-current={active ? 'page' : undefined}
                        title={group.label}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                          active
                            ? 'bg-accent-soft text-accent-ink'
                            : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                        )}
                      >
                        <Icon size={16} aria-hidden />
                        {section.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
