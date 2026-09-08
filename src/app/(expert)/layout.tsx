import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { countUnread } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { ExpertShell } from '@/components/layout/ExpertShell';

/**
 * Espace de l'expert agronomique.
 *
 * Groupe de routes séparé de `(app)` pour la même raison que
 * l'administration : rien n'est encore émis quand le contrôle a lieu, donc un
 * compte d'exploitation reçoit une vraie redirection HTTP plutôt qu'un
 * rafraîchissement différé.
 *
 * Le contrôle est fait ici pour toute la section ET dans chaque route d'API.
 * Un expert ne voit que les exploitations qui l'ont missionné, et n'écrit rien
 * dans leurs registres : c'est la matrice des permissions qui l'assure, pas ce
 * layout.
 */
export default async function ExpertLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect('/connexion-expert');

  if (!auth.user.emailVerified) {
    redirect(`/verification-email?email=${encodeURIComponent(auth.user.email)}`);
  }
  if (auth.user.accountType !== 'AGRONOMIST') redirect('/dashboard');

  if (!auth.user.isPlatformAdmin) {
    const maintenance = await getMaintenanceMode();
    if (maintenance.enabled) redirect('/maintenance');
  }

  const [unreadCount, pendingCount] = await Promise.all([
    countUnread(auth.user.id),
    prisma.recommendation.count({
      where: { authorId: auth.user.id, status: 'PROPOSED' },
    }),
  ]);

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
