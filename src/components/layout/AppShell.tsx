'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { FarmRole } from '@prisma/client';
import { FOOTER_NAV, MAIN_NAV, isNavActive } from '@/components/layout/navigation';
import { apiPost } from '@/lib/client/api';
import { cn } from '@/components/ui';

export type ShellUser = {
  firstName: string;
  lastName: string;
  email: string;
};

export type ShellFarm = {
  farmId: string;
  farmName: string;
  role: FarmRole;
};

const ROLE_LABELS: Record<FarmRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EMPLOYEE: 'Salarié',
  VIEWER: 'Lecture seule',
};

export function AppShell({
  user,
  farms,
  activeFarmId,
  unreadCount,
  children,
}: {
  user: ShellUser;
  farms: ShellFarm[];
  activeFarmId: string | null;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Le menu mobile se referme à chaque navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const activeFarm = farms.find((f) => f.farmId === activeFarmId) ?? farms[0] ?? null;

  async function switchFarm(farmId: string): Promise<void> {
    if (farmId === activeFarmId) return;
    setSwitching(true);
    try {
      await apiPost('/api/farms/switch', { farmId });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  async function logout(): Promise<void> {
    await apiPost('/api/auth/logout', {}).catch(() => undefined);
    router.push('/connexion');
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-champ-900 text-champ-100">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-white/10 px-5">
        <Link href="/dashboard" className="text-lg font-bold text-white">
          <span aria-hidden>🌾</span> Parcelys
        </Link>
      </div>

      {/* Sélecteur d'exploitation */}
      {farms.length > 0 ? (
        <div className="border-b border-white/10 px-4 py-3">
          <label
            htmlFor="farm-switcher"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-champ-300"
          >
            Exploitation
          </label>
          {farms.length > 1 ? (
            <select
              id="farm-switcher"
              value={activeFarm?.farmId ?? ''}
              onChange={(e) => void switchFarm(e.target.value)}
              disabled={switching}
              className="w-full rounded-md border border-white/15 bg-champ-800 px-2.5 py-1.5 text-sm text-white
                         focus:border-champ-300 focus:ring-2 focus:ring-champ-300/30"
            >
              {farms.map((farm) => (
                <option key={farm.farmId} value={farm.farmId}>
                  {farm.farmName}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate text-sm font-medium text-white">
              {activeFarm?.farmName}
            </p>
          )}
          {activeFarm ? (
            <p className="mt-1 text-[11px] text-champ-300">
              {ROLE_LABELS[activeFarm.role]}
            </p>
          ) : null}
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-0.5">
          {MAIN_NAV.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                    active
                      ? 'bg-white/15 font-semibold text-white'
                      : 'text-champ-100/85 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <span className="w-5 text-center text-base" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <ul className="space-y-0.5">
          {FOOTER_NAV.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                    active
                      ? 'bg-white/15 font-semibold text-white'
                      : 'text-champ-100/85 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <span className="w-5 text-center text-base" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-champ-100/85 transition hover:bg-white/8 hover:text-white"
            >
              <span className="w-5 text-center text-base" aria-hidden>
                🚪
              </span>
              Déconnexion
            </button>
          </li>
        </ul>

        <div className="mt-2 border-t border-white/10 px-3 pt-3">
          <p className="truncate text-sm font-medium text-white">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-[11px] text-champ-300">{user.email}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar bureau */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-64">{sidebar}</div>
      </aside>

      {/* Tiroir mobile */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-ardoise-900/50"
          />
          <div className="absolute inset-y-0 left-0 w-72 animate-fade-in shadow-xl">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ardoise-200 bg-white/95 px-4 backdrop-blur no-print">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
            className="rounded-lg p-2 text-ardoise-700 hover:bg-ardoise-100 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M3 5h14M3 10h14M3 15h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <span className="truncate font-semibold text-ardoise-800 lg:hidden">
            🌾 Parcelys
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/notifications"
              className="relative rounded-lg p-2 text-ardoise-600 hover:bg-ardoise-100"
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
            >
              <span aria-hidden>🔔</span>
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brique-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Link>

            <Link
              href="/parcelles/nouvelle"
              className="hidden rounded-lg bg-champ-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-champ-700 sm:inline-flex"
            >
              + Nouvelle parcelle
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-6">{children}</main>

        {/* Barre de navigation mobile */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-ardoise-200 bg-white lg:hidden no-print">
          {MAIN_NAV.filter((item) => item.mobile).map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition',
                  active ? 'text-champ-700' : 'text-ardoise-500',
                )}
              >
                <span className="text-lg" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
