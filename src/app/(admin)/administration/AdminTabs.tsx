'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_SECTIONS } from '@/components/layout/navigation';
import { cn } from '@/components/ui';

/**
 * Onglets de la section d'administration.
 *
 * La vue d'ensemble se compare exactement : sans cela, elle resterait active
 * sur toutes les sous-pages, qui commencent toutes par `/administration`.
 */
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections d'administration"
      className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 no-print"
    >
      <ul className="flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {ADMIN_SECTIONS.map((section) => {
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
    </nav>
  );
}
