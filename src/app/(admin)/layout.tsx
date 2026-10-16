import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { countUnread } from '@/lib/notifications';
import { AppShell } from '@/components/layout/AppShell';
import { AdminTabs } from '@/app/(admin)/administration/AdminTabs';
import { AdminScopeBar } from '@/app/(admin)/administration/AdminScopeBar';

/**
 * Section d'administration de l'instance — deux niveaux.
 *
 * Groupe de routes distinct de `(app)` — et non une sous-section — pour une
 * raison précise : `(app)` possède un `loading.tsx`, donc une frontière
 * Suspense. La coque serait envoyée au navigateur avant qu'une redirection
 * imbriquée ne soit décidée, et Next devrait se rabattre sur un
 * `<meta http-equiv="refresh">` après coup. Ici, rien n'est encore émis quand
 * le contrôle a lieu : un compte non administrateur reçoit une vraie
 * redirection HTTP.
 *
 * Le layout admet l'administrateur général **et** le secondaire. Chaque page
 * vérifie ensuite sa propre permission (`requirePageAdminScope`) — une page
 * qui l'oublierait appellerait `requirePageAdmin`, réservé au général : le
 * défaut est le plus sûr. Et chaque route `/api/admin/*` revérifie : masquer
 * un onglet ne protège rien.
 */
export default async function AdminAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requirePageAdminScope('dashboard:read');
  const unreadCount = await countUnread(auth.user.id);

  return (
    <AppShell
      user={{
        firstName: auth.user.firstName,
        lastName: auth.user.lastName,
        email: auth.user.email,
        isPlatformAdmin: auth.user.isPlatformAdmin,
        adminRole: auth.scope.role,
        accountType: auth.user.accountType,
      }}
      farms={auth.memberships}
      activeFarmId={auth.activeFarmId}
      unreadCount={unreadCount}
    >
      <div className="mx-auto max-w-6xl">
        <AdminScopeBar
          role={auth.scope.role}
          email={auth.user.email}
          portfolios={auth.scope.portfolios.map((p) => p.name)}
        />
        <AdminTabs role={auth.scope.role} sidebarHasSections={auth.user.accountType !== 'FARMER'} />
        {children}
      </div>
    </AppShell>
  );
}
