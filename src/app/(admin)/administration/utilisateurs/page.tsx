import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { listAdminUsers } from '@/lib/admin/overview';
import { USER_FILTER_LABELS, type AdminUserFilter } from '@/lib/admin/shared';
import { adminCan } from '@/lib/admin/roles';
import { UsersTable } from '@/app/(admin)/administration/utilisateurs/UsersTable';
import { AdminPagination } from '@/app/(admin)/administration/Pagination';
import { LinkButton, PageHeader } from '@/components/ui';
import { IconExport, IconUsers } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Comptes — Administration' };
export const dynamic = 'force-dynamic';

const FILTERS = Object.keys(USER_FILTER_LABELS) as AdminUserFilter[];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; q?: string; page?: string }>;
}) {
  const auth = await requirePageAdminScope('users:read');
  const params = await searchParams;

  const filter = FILTERS.includes(params.statut as AdminUserFilter)
    ? (params.statut as AdminUserFilter)
    : 'tous';
  const search = params.q?.trim().slice(0, 120) ?? '';
  const page = Number(params.page) || 1;

  const result = await listAdminUsers({ scope: auth.scope, filter, search, page });

  return (
    <>
      <PageHeader
        icon={IconUsers}
        title="Comptes"
        description={
          auth.scope.all
            ? `${result.total} compte(s). Les comptes sont créés uniquement sur invitation.`
            : `${result.total} compte(s) rattaché(s) à vos portefeuilles.`
        }
        actions={
          <LinkButton href="/api/admin/exports?type=comptes" variant="outline" icon={IconExport} prefetch={false}>
            Exporter (CSV)
          </LinkButton>
        }
      />

      <UsersTable
        users={result.rows}
        filter={filter}
        search={search}
        currentUserId={auth.user.id}
        canDelete={adminCan(auth.scope.role, 'users:delete')}
        canManageAdmins={adminCan(auth.scope.role, 'admins:manage')}
      />
      <AdminPagination
        basePath="/administration/utilisateurs"
        params={{ statut: filter === 'tous' ? undefined : filter, q: search || undefined }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
