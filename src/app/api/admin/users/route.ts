import type { NextRequest } from 'next/server';
import { ok, parseQuery, route } from '@/lib/api/handler';
import { adminUserQuerySchema } from '@/lib/validation/admin';
import { listAdminUsers } from '@/lib/admin/overview';
import { requireAdmin } from '@/lib/admin/scope';

/**
 * GET /api/admin/users — comptes visibles par l'administrateur connecté.
 *
 * Bornés au périmètre : l'administrateur secondaire ne reçoit que les membres
 * des exploitations de ses portefeuilles et les techniciens qui y sont
 * rattachés. Filtres : `statut`, `q` (nom, adresse, ou numéro `EXP-…` /
 * `TEC-…`), `page`.
 */
export const GET = route(async (request: NextRequest) => {
  const { scope } = await requireAdmin('users:read');
  const query = parseQuery(request, adminUserQuerySchema);

  const page = await listAdminUsers({
    scope,
    filter: query.statut,
    search: query.q ?? '',
    page: query.page,
  });

  return ok({
    users: page.rows,
    count: page.rows.length,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  });
});
