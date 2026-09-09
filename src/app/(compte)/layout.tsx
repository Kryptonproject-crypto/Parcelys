import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { countUnread } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { AppShell } from '@/components/layout/AppShell';
import { ExpertShell } from '@/components/layout/ExpertShell';

/**
 * Écrans qui appartiennent au **compte**, et non à un espace de travail.
 *
 * Le profil en est un : identité, préférences, mot de passe, sessions
 * ouvertes. Il n'a rien à voir avec une exploitation, et tout le monde doit y
 * accéder — exploitant, expert, administrateur.
 *
 * Il vivait dans `(app)`, dont le layout renvoie tout compte sans exploitation
 * vers son propre espace. Le bouton « Profil » de l'expert et celui de
 * l'administrateur menaient donc à une redirection immédiate : on cliquait, et
 * la page revenait où elle était. D'où ce groupe, qui n'exige que d'être
 * connecté et rend la coque correspondant à la nature du compte.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect('/connexion');

  if (!auth.user.emailVerified) {
    redirect(`/verification-email?email=${encodeURIComponent(auth.user.email)}`);
  }

  if (!auth.user.isPlatformAdmin) {
    const maintenance = await getMaintenanceMode();
    if (maintenance.enabled) redirect('/maintenance');
  }

  const unreadCount = await countUnread(auth.user.id);

  // L'expert garde sa coque : il retrouve son portefeuille et ses
  // préconisations en sortant du profil, pas une navigation d'exploitation.
  if (auth.user.accountType === 'AGRONOMIST') {
    const pendingCount = await prisma.recommendation.count({
      where: { authorId: auth.user.id, status: 'PROPOSED' },
    });
    return (
      <ExpertShell
        user={{
          firstName: auth.user.firstName,
          lastName: auth.user.lastName,
          email: auth.user.email,
          organization: auth.user.organization,
          isPlatformAdmin: auth.user.isPlatformAdmin,
        }}
        portfolioCount={auth.memberships.length}
        pendingCount={pendingCount}
        unreadCount={unreadCount}
      >
        {children}
      </ExpertShell>
    );
  }

  return (
    <AppShell
      user={{
        firstName: auth.user.firstName,
        lastName: auth.user.lastName,
        email: auth.user.email,
        isPlatformAdmin: auth.user.isPlatformAdmin,
        accountType: auth.user.accountType,
      }}
      farms={auth.memberships}
      activeFarmId={auth.activeFarmId}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
