import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { listAdministrators } from '@/lib/admin/administrateurs';
import { listPortfolioOptions } from '@/lib/admin/overview';
import { AdminsPanel } from '@/app/(admin)/administration/administrateurs/AdminsPanel';
import { PageHeader } from '@/components/ui';
import { IconAdmins } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Administrateurs — Administration' };
export const dynamic = 'force-dynamic';

/** Administrateurs généraux et secondaires — administrateur général seul. */
export default async function AdminAdministratorsPage() {
  const auth = await requirePageAdminScope('admins:manage');
  const [admins, portfolios] = await Promise.all([
    listAdministrators(),
    listPortfolioOptions(auth.scope),
  ]);

  return (
    <>
      <PageHeader
        icon={IconAdmins}
        title="Administrateurs"
        description="Les administrateurs généraux voient tout Parcelys ; les secondaires, les clients de leurs portefeuilles et rien d'autre."
      />
      <AdminsPanel {...admins} portfolios={portfolios} currentUserId={auth.user.id} />
    </>
  );
}
