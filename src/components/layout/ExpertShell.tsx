'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiPost } from '@/lib/client/api';
import { useTheme } from '@/components/ui/Toast';
import { cn } from '@/components/ui';
import {
  IconAdmin,
  IconClose,
  IconFarm,
  IconLogout,
  IconMenu,
  IconMoon,
  IconNotification,
  IconProfile,
  IconRegistry,
  IconSun,
} from '@/components/ui/icons';

export type ExpertUser = {
  firstName: string;
  lastName: string;
  email: string;
  organization: string | null;
  isPlatformAdmin: boolean;
};

/**
 * Coque de l'espace expert agronomique.
 *
 * Distincte de celle de l'exploitant, et volontairement plus courte : un expert
 * ne saisit pas de registre, ne dessine pas de parcelle et n'exporte pas de
 * déclaration. Il consulte, il conseille. Trois entrées suffisent, et un
 * sélecteur d'exploitation serait trompeur — son portefeuille est une liste,
 * pas un contexte de travail unique.
 */
const NAV = [
  { href: '/portefeuille', label: 'Portefeuille', icon: IconFarm, exact: true },
  {
    href: '/portefeuille/preconisations',
    label: 'Mes préconisations',
    icon: IconRegistry,
    exact: false,
  },
  { href: '/profil', label: 'Profil', icon: IconProfile, exact: false },
];

export function ExpertShell({
  user,
  portfolioCount,
  pendingCount,
  unreadCount,
  children,
}: {
  user: ExpertUser;
  portfolioCount: number;
  pendingCount: number;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  async function logout(): Promise<void> {
    await apiPost('/api/auth/logout', {}).catch(() => undefined);
    router.push('/connexion-expert');
    router.refresh();
  }

  const isActive = (href: string, exact: boolean): boolean =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const sidebar = (
    <div className="flex h-full flex-col bg-ardoise-900 text-ardoise-100 dark:bg-ardoise-950 dark:border-r dark:border-line">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <Link
          href="/portefeuille"
          className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-white"
        >
          <Image
            src="/icone.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg bg-ciel-500/20 p-1"
            priority
          />
          Parcelys
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
          className="rounded-lg p-1.5 text-ardoise-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
        >
          <IconClose size={18} aria-hidden />
        </button>
      </div>

      <div className="px-3 pb-3">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <p className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-ciel-500">
            Expert agronomique
          </p>
          <p className="mt-0.5 truncate text-[13px] font-medium text-white">
            {user.organization ?? 'Indépendant'}
          </p>
          <p className="text-[12.5px] sm:text-[11.5px] text-ardoise-300">
            {portfolioCount} exploitation(s) suivie(s)
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Navigation experte">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                    active
                      ? 'bg-white/12 font-medium text-white'
                      : 'text-ardoise-100/80 hover:bg-white/8 hover:text-white',
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ciel-500"
                    />
                  ) : null}
                  <Icon
                    size={17}
                    aria-hidden
                    className={cn(
                      'shrink-0 transition-colors',
                      active ? 'text-ciel-500' : 'text-ardoise-300 group-hover:text-white',
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/portefeuille/preconisations' && pendingCount > 0 ? (
                    <span className="rounded-full bg-ble-500 px-1.5 text-[12px] sm:text-[10.5px] font-bold text-champ-950">
                      {pendingCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 p-3">
        {user.isPlatformAdmin ? (
          <Link
            href="/administration"
            className="mb-2 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13.5px] text-ardoise-100/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconAdmin size={17} aria-hidden className="shrink-0 text-ciel-500" />
            Administration
          </Link>
        ) : null}

        <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ciel-500 text-[12px] font-semibold text-white">
            {`${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">
              {user.firstName} {user.lastName}
            </span>
            <span className="block truncate text-[12.5px] sm:text-[11px] text-ardoise-300">
              {user.email}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="shrink-0 rounded-md p-1.5 text-ardoise-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconLogout size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[264px] shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-[264px]">{sidebar}</div>
      </aside>

      {/* Tiroir mobile — z-[1200] : au-dessus de tout ce que le contenu peut
          atteindre. Une carte, un menu de recherche ou une info-bulle montent
          volontiers jusqu'à 1000 ; le tiroir doit les dominer sans discussion,
          sinon il s'ouvre « derrière » la page et paraît cassé. */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 animate-fade-in bg-ardoise-950/60 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 w-[280px] animate-rise shadow-float">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6 no-print">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
            className="-ml-1 rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink lg:hidden"
          >
            <IconMenu size={19} aria-hidden />
          </button>

          <Link
            href="/portefeuille"
            className="flex items-center gap-2 font-semibold text-ink lg:hidden"
          >
            <Image src="/icone.svg" alt="" width={20} height={20} className="h-5 w-5" /> Parcelys
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
              className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {theme === 'dark' ? <IconSun size={18} aria-hidden /> : <IconMoon size={18} aria-hidden />}
            </button>

            <Link
              href="/notifications"
              aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} non lues` : ''}`}
              className="relative rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <IconNotification size={18} aria-hidden />
              {unreadCount > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brique-500 px-1 text-[12px] sm:text-[10px] font-semibold text-white ring-2 ring-canvas">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-8">{children}</main>

        {/* Navigation basse mobile : trois entrées, à portée du pouce. */}
        <nav
          aria-label="Navigation rapide"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden no-print"
        >
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // `min-w-0` : même raison que dans AppShell — un intitulé plus
                // large que sa colonne ferait déborder la barre de l'écran.
                className={cn(
                  'relative flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[12px] sm:text-[10.5px] font-medium transition-colors',
                  active ? 'text-ciel-600 dark:text-ciel-500' : 'text-ink-3',
                )}
              >
                <Icon size={19} aria-hidden />
                {item.href === '/portefeuille/preconisations' && pendingCount > 0 ? (
                  <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-ble-500" />
                ) : null}
                <span className="max-w-full truncate">
                  {item.label === 'Mes préconisations' ? 'Conseils' : item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
