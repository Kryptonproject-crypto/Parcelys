import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { searchProducts } from '@/lib/ephy/search';

/**
 * GET /api/phytosanitary/products?q=&onlyAuthorized=
 *
 * Recherche dans le référentiel E-Phy importé. La réponse porte toujours la
 * provenance et la date de dernière synchronisation ; si aucun import n'a été
 * réalisé, `source.configured` vaut false et la liste est vide — aucune donnée
 * réglementaire n'est produite par l'application.
 */
export const GET = route(async (request: NextRequest) => {
  await requireVerifiedAuth();
  await enforceRateLimit(`ephy-search:${clientIp(request)}`, {
    limit: 120,
    windowSeconds: 60,
  });

  const params = request.nextUrl.searchParams;
  const result = await searchProducts({
    query: params.get('q') ?? '',
    onlyAuthorized: params.get('onlyAuthorized') === 'true',
    limit: Number(params.get('limit')) || 20,
  });

  return ok(result);
});
