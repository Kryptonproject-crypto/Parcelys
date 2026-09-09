import { requirePageAdmin } from '@/lib/auth/page-guards';
import { countUnread } from '@/lib/notifications';
import { AppShell } from '@/components/layout/AppShell';
import { AdminTabs } from '@/app/(admin)/administration/AdminTabs';

/**
 * Section d'administration de l'instance.
 *
 * Groupe de routes distinct de `(app)` — et non une sous-section — pour une
 * raison précise : `(app)` possède un `loading.tsx`, donc une frontière
 * Suspense. La coque serait envoyée au navigateur avant qu'une redirection
 * imbriquée ne soit décidée, et Next devrait se rabattre sur un
 * `<meta http-equiv="refresh">` après coup. Ici, rien n'est encore émis quand
 * le contrôle a lieu : un compte non administrateur reçoit une vraie
 * redirection HTTP.
 *
 * Le contrôle est fait ici pour toute la section, ET dans chaque route
 * `/api/admin/*` : masquer l'onglet ne protège rien, seule la vérification
 * serveur compte.
 */
export default async function AdminAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requirePageAdmin();
  const unreadCount = await countUnread(auth.user.id);

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
      <div className="mx-auto max-w-6xl">
        <AdminTabs />
        {children}
      </div>
    </AppShell>
  );
}
