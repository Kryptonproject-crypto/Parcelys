import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
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

  const unreadCount = await countUnread(auth.user.id);

  return (
    <AppShell
      user={{
        firstName: auth.user.firstName,
        lastName: auth.user.lastName,
        email: auth.user.email,
      }}
      farms={auth.memberships}
      activeFarmId={auth.activeFarmId}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
