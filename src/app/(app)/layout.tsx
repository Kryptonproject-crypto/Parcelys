import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { countUnread } from '@/lib/notifications';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Coque des pages authentifiées.
 *
 * Le contrôle d'accès est fait ici ET dans chaque route API : une page rendue
 * côté serveur ne peut pas être contournée, et un appel direct à l'API non plus.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect('/connexion');

  if (!auth.user.emailVerified) {
    redirect(`/verification-email?email=${encodeURIComponent(auth.user.email)}`);
  }

  // Un expert agronomique n'a pas d'exploitation : cet espace ne lui montrerait
  // qu'un sélecteur vide et des écrans de saisie qu'il n'a pas le droit
  // d'utiliser. Son espace est le portefeuille.
  if (auth.user.accountType === 'AGRONOMIST') redirect('/portefeuille');

  // Mode maintenance : seuls les administrateurs de l'instance passent, pour
  // pouvoir intervenir et lever le mode.
  if (!auth.user.isPlatformAdmin) {
    const maintenance = await getMaintenanceMode();
    if (maintenance.enabled) redirect('/maintenance');
  }

  const unreadCount = await countUnread(auth.user.id);

  return (
    <AppShell
      user={{
        firstName: auth.user.firstName,
        lastName: auth.user.lastName,
        email: auth.user.email,
        isPlatformAdmin: auth.user.isPlatformAdmin,
      }}
      farms={auth.memberships}
      activeFarmId={auth.activeFarmId}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
