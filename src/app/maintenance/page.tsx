import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { getAuthContext } from '@/lib/auth/session';
import { IconMaintenance } from '@/components/ui/icons';
import { LinkButton, formatDateLongFr } from '@/components/ui';

export const metadata: Metadata = { title: 'Maintenance en cours' };
export const dynamic = 'force-dynamic';

/**
 * Page affichée aux comptes non administrateurs pendant une maintenance.
 * Lorsqu'aucune maintenance n'est en cours, elle renvoie vers l'application :
 * elle ne doit pas rester atteignable comme une impasse.
 */
export default async function MaintenancePage() {
  const [mode, auth] = await Promise.all([getMaintenanceMode(), getAuthContext()]);

  if (!mode.enabled || auth?.user.isPlatformAdmin) {
    redirect(auth ? '/dashboard' : '/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ble-500/15 text-ble-600 dark:text-ble-300">
          <IconMaintenance size={26} aria-hidden />
        </span>

        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">
          Maintenance en cours
        </h1>

        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{mode.message}</p>

        {mode.updatedAt ? (
          <p className="mt-4 text-sm text-ink-3">
            Début de l&apos;intervention : {formatDateLongFr(mode.updatedAt)}.
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <LinkButton href="/maintenance" variant="secondary">
            Réessayer
          </LinkButton>
          <Link
            href="/connexion"
            className="text-sm text-champ-700 hover:underline dark:text-champ-400"
          >
            Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
