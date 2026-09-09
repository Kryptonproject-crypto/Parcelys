'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { AccountType, FarmRole } from '@prisma/client';
import {
  ADMIN_MOBILE_NAV,
  ADMIN_NAV,
  ADMIN_SECTIONS,
  FOOTER_NAV,
  MAIN_NAV,
  NAV_GROUPS,
  isNavActive,
} from '@/components/layout/navigation';
import { apiPost } from '@/lib/client/api';
import { hasFarmSpace } from '@/lib/auth/accounts';
import { useTheme } from '@/components/ui/Toast';
import { cn } from '@/components/ui';
import {
  IconChevronDown,
  IconClose,
  IconFarm,
  IconLogout,
  IconMenu,
  IconMoon,
  IconNotification,
  IconSun,
} from '@/components/ui/icons';

export type ShellUser = {
  firstName: string;
  lastName: string;
  email: string;
  /** Affiche l'entrée « Administration » — l'accès reste vérifié côté serveur. */
  isPlatformAdmin: boolean;
  /**
   * Décide si la navigation d'exploitation a lieu d'être. Un compte
   * d'administration n'a ni parcelles ni registres : lui présenter « Parcelles »
   * ou « Phytosanitaire » ne mènerait qu'à des écrans vides.
   */
  accountType: AccountType;
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
  ADVISOR: 'Expert agronomique',
};

function initials(user: ShellUser): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

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
  const { theme, toggle } = useTheme();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [farmMenuOpen, setFarmMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const farmMenuRef = useRef<HTMLDivElement>(null);

  const activeFarm = farms.find((f) => f.farmId === activeFarmId) ?? farms[0] ?? null;

  // Le tiroir mobile se referme à chaque navigation.
  useEffect(() => {
    setMobileOpen(false);
    setFarmMenuOpen(false);
  }, [pathname]);

  // Fermeture du sélecteur d'exploitation au clic extérieur et à Échap.
  useEffect(() => {
    if (!farmMenuOpen) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!farmMenuRef.current?.contains(event.target as Node)) setFarmMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFarmMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [farmMenuOpen]);

  async function switchFarm(farmId: string): Promise<void> {
    if (farmId === activeFarmId) {
      setFarmMenuOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await apiPost('/api/farms/switch', { farmId });
      setFarmMenuOpen(false);
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

  /**
   * Ce que la barre latérale propose, selon la nature du compte.
   *
   * Un exploitant y trouve son exploitation ; un compte d'administration n'en a
   * pas, et y trouve donc les écrans de gestion — sans quoi la barre resterait
   * vide, ce qui ne lui dirait rien de ce qu'il est venu faire.
   */
  const navSections = hasFarmSpace(user.accountType)
    ? NAV_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        items: MAIN_NAV.filter((item) => item.group === group.key),
      }))
    : user.isPlatformAdmin
      ? [{ key: 'administration', label: 'Administration', items: ADMIN_SECTIONS }]
      : [];

  /**
   * La barre du bas, sur téléphone.
   *
   * Elle doit mener là où le compte a quelque chose à faire. « Parcelles »,
   * « Apports », « Phyto » n'ont aucun sens pour un compte d'administration,
   * qui n'a pas d'exploitation : les proposer, c'est offrir quatre raccourcis
   * vers des écrans vides. Elle suit donc la même règle que la barre latérale.
   *
   * Quatre entrées au maximum : c'est la largeur de la grille, et au-delà les
   * intitulés deviennent illisibles sur un écran de téléphone.
   */
  const mobileNav = hasFarmSpace(user.accountType)
    ? MAIN_NAV.filter((item) => item.mobile)
    : user.isPlatformAdmin
      ? ADMIN_MOBILE_NAV
      : [];

  const sidebar = (
    <div className="flex h-full flex-col bg-champ-900 text-champ-100 dark:bg-ardoise-950 dark:border-r dark:border-line">
      {/* Marque */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <Link
          href="/dashboard"
          className="-my-2 flex items-center gap-2.5 py-2 text-[17px] font-semibold tracking-tight text-white"
        >
          <Image
            src="/icone.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg bg-champ-500/20 p-1"
            priority
          />
          Parcelys
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
          className="rounded-lg p-1.5 text-champ-200 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
        >
          <IconClose size={18} aria-hidden />
        </button>
      </div>

      {/* Sélecteur d'exploitation */}
      {activeFarm ? (
        <div className="px-3 pb-3" ref={farmMenuRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => farms.length > 1 && setFarmMenuOpen((v) => !v)}
              disabled={farms.length <= 1 || switching}
              aria-expanded={farmMenuOpen}
              aria-haspopup={farms.length > 1 ? 'listbox' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left transition-colors',
                farms.length > 1 && 'hover:border-white/20 hover:bg-white/10',
                'disabled:cursor-default',
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-champ-500/25 text-champ-100">
                <IconFarm size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">
                  {activeFarm.farmName}
                </span>
                <span className="block text-[12.5px] sm:text-[11px] text-champ-300">
                  {ROLE_LABELS[activeFarm.role]}
                </span>
              </span>
              {farms.length > 1 ? (
                <IconChevronDown
                  size={15}
                  aria-hidden
                  className={cn(
                    'shrink-0 text-champ-300 transition-transform',
                    farmMenuOpen && 'rotate-180',
                  )}
                />
              ) : null}
            </button>

            {farmMenuOpen ? (
              <ul
                role="listbox"
                className="absolute inset-x-0 top-full z-50 mt-1.5 animate-rise overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-float"
              >
                {farms.map((farm) => (
                  <li key={farm.farmId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={farm.farmId === activeFarmId}
                      onClick={() => void switchFarm(farm.farmId)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2',
                        farm.farmId === activeFarmId
                          ? 'font-medium text-champ-700 dark:text-champ-400'
                          : 'text-ink-2',
                      )}
                    >
                      <span className="truncate">{farm.farmName}</span>
                      <span className="shrink-0 text-[12.5px] sm:text-[11px] text-ink-3">
                        {ROLE_LABELS[farm.role]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Navigation principale */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Navigation principale">
        {/*
          Un compte d'administration n'a pas de navigation d'exploitation. Lui
          laisser une barre vide ne lui dirait rien de ce qu'il peut faire : on
          y déplie donc les sections de gestion, qui sont tout son travail.
        */}
        {navSections.map((group) => {
          const items = group.items;
          if (items.length === 0) return null;

          return (
            <div key={group.key} className="mb-4 last:mb-0">
              <p className="mb-1.5 px-3 text-[12px] sm:text-[10.5px] font-semibold uppercase tracking-[0.1em] text-champ-400/80 dark:text-ink-3">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isNavActive(pathname, item.href);
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
                            : 'text-champ-100/80 hover:bg-white/8 hover:text-white',
                        )}
                      >
                        {active ? (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ble-400"
                          />
                        ) : null}
                        <Icon
                          size={17}
                          aria-hidden
                          className={cn(
                            'shrink-0 transition-colors',
                            active ? 'text-ble-400' : 'text-champ-300 group-hover:text-white',
                          )}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Compte */}
      <div className="border-t border-white/10 p-3">
        {/*
          Le raccourci vers l'administration sert à l'exploitant qui administre
          aussi son instance. Pour un compte d'administration, les sections sont
          déjà dépliées au-dessus : le répéter ici ferait doublon.
        */}
        {user.isPlatformAdmin && hasFarmSpace(user.accountType) ? (
          <Link
            href={ADMIN_NAV.href}
            aria-current={isNavActive(pathname, ADMIN_NAV.href) ? 'page' : undefined}
            className={cn(
              'mb-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-[13.5px] transition-colors',
              isNavActive(pathname, ADMIN_NAV.href)
                ? 'border-ble-400/60 bg-ble-400/15 font-medium text-white'
                : 'border-white/10 bg-white/5 text-champ-100/80 hover:border-white/20 hover:bg-white/10 hover:text-white',
            )}
          >
            <ADMIN_NAV.icon size={17} aria-hidden className="shrink-0 text-ble-400" />
            {ADMIN_NAV.label}
          </Link>
        ) : null}

        {/*
          « Paramètres » règle l'exploitation : nom, SIRET, experts qu'elle
          missionne. Un compte qui n'en a pas n'y trouverait rien. Le profil,
          lui, appartient au compte et reste ouvert à tous.
        */}
        <ul className="mb-2 space-y-0.5">
          {FOOTER_NAV.filter(
            (item) => item.href === '/profil' || hasFarmSpace(user.accountType),
          ).map((item) => {
            const active = isNavActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                    active
                      ? 'bg-white/12 font-medium text-white'
                      : 'text-champ-100/80 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <Icon size={17} aria-hidden className="shrink-0 text-champ-300" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ble-400 text-[12px] font-semibold text-champ-900">
            {initials(user)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">
              {user.firstName} {user.lastName}
            </span>
            <span className="block truncate text-[12.5px] sm:text-[11px] text-champ-300">{user.email}</span>
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="shrink-0 rounded-md p-1.5 text-champ-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconLogout size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar bureau */}
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
        {/* Barre supérieure */}
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
            href="/dashboard"
            className="-my-2 flex min-h-11 items-center gap-2 py-2 font-semibold text-ink lg:hidden"
          >
            <Image src="/icone.svg" alt="" width={20} height={20} className="h-5 w-5" /> Parcelys
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
              title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
              className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {theme === 'dark' ? (
                <IconSun size={18} aria-hidden />
              ) : (
                <IconMoon size={18} aria-hidden />
              )}
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

        {/*
          La réserve du bas ne se justifie que sous la barre : sans elle, un
          compte qui n'en a pas garderait un blanc de 6 rem en pied de page.
        */}
        <main
          className={cn(
            'flex-1 px-4 py-6 sm:px-6 lg:pb-8',
            mobileNav.length > 0 ? 'pb-24' : 'pb-8',
          )}
        >
          {children}
        </main>

        {/* Navigation mobile */}
        {mobileNav.length > 0 ? (
        <nav
          aria-label="Navigation rapide"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden no-print"
        >
          {mobileNav.map((item) => {
            const active = isNavActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // `min-w-0` : sans lui, un intitulé plus large que sa colonne
                // déborde de la grille — la barre dépasse alors la largeur de
                // l'écran et toute la page se met à défiler horizontalement.
                className={cn(
                  'flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[12px] sm:text-[10.5px] font-medium transition-colors',
                  active ? 'text-champ-600 dark:text-champ-400' : 'text-ink-3',
                )}
              >
                <Icon size={19} aria-hidden />
                <span className="max-w-full truncate">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}
        </nav>
        ) : null}
      </div>
    </div>
  );
}
