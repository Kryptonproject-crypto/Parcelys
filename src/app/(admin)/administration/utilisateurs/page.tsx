import type { Metadata } from 'next';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import { listAdminUsers } from '@/lib/admin/overview';
import { USER_FILTER_LABELS, type AdminUserFilter } from '@/lib/admin/shared';
import { UsersTable } from '@/app/(admin)/administration/utilisateurs/UsersTable';
import { PageHeader } from '@/components/ui';
import { IconUsers } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Utilisateurs — Administration' };
export const dynamic = 'force-dynamic';

const FILTERS = Object.keys(USER_FILTER_LABELS) as AdminUserFilter[];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; q?: string }>;
}) {
  const auth = await requirePageAdmin();
  const params = await searchParams;

  const filter = FILTERS.includes(params.statut as AdminUserFilter)
    ? (params.statut as AdminUserFilter)
    : 'tous';
  const search = params.q?.trim() ?? '';

  const users = await listAdminUsers({ filter, search });

  return (
    <>
      <PageHeader
        icon={IconUsers}
        title="Utilisateurs"
        description={`${users.length} compte(s) affiché(s). Les comptes sont créés uniquement sur invitation.`}
      />

      <UsersTable
        users={users}
        filter={filter}
        search={search}
        currentUserId={auth.user.id}
      />
    </>
  );
}
