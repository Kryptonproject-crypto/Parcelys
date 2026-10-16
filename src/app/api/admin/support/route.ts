import type { NextRequest } from 'next/server';
import { ok, parseQuery, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { adminTicketQuerySchema } from '@/lib/validation/support';
import { listerDemandesAdmin } from '@/lib/support/tickets';

/**
 * GET /api/admin/support — demandes de support visibles.
 *
 * Le général voit toutes les demandes ; le secondaire, celles de ses
 * portefeuilles. `statut` (ouvertes par défaut, toutes, ou un statut),
 * `q` (sujet, nom, adresse, numéro `DEM-…` ou numéro client), `moi=1`
 * (attribuées à soi), `page`.
 */
export const GET = route(async (request: NextRequest) => {
  const { scope } = await requireAdmin('support:read');
  const query = parseQuery(request, adminTicketQuerySchema);
  const page = await listerDemandesAdmin({
    scope,
    statut: query.statut,
    search: query.q,
    mine: query.moi === '1',
    page: query.page,
  });
  return ok({ tickets: page.rows, total: page.total, page: page.page, pageSize: page.pageSize });
});
