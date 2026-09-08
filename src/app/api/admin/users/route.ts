import type { NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { ok, parseQuery, route } from '@/lib/api/handler';
import { adminUserQuerySchema } from '@/lib/validation/admin';
import { listAdminUsers } from '@/lib/admin/overview';

/**
 * GET /api/admin/users — comptes de l'instance.
 * Filtres : `statut` (tous, actifs, suspendus, non-verifies, admins) et `q`
 * (nom ou adresse).
 */
export const GET = route(async (request: NextRequest) => {
  await requirePlatformAdmin();
  const query = parseQuery(request, adminUserQuerySchema);

  const users = await listAdminUsers({
    filter: query.statut,
    search: query.q ?? '',
  });

  return ok({ users, count: users.length });
});
