import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { searchProducts } from '@/lib/ephy/search';

/**
 * GET /api/phytosanitary/products?q=&includeWithdrawn=
 *
 * Recherche dans le référentiel E-Phy importé. La réponse porte toujours la
 * provenance et la date de dernière synchronisation ; si aucun import n'a été
 * réalisé, `source.configured` vaut false et la liste est vide — aucune donnée
 * réglementaire n'est produite par l'application.
 *
 * Les produits retirés du marché sont écartés sauf `includeWithdrawn=true` ;
 * `withdrawnHidden` dit toujours combien l'ont été, pour que l'absence d'un
 * produit ne passe jamais pour une lacune du catalogue.
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
    includeWithdrawn: params.get('includeWithdrawn') === 'true',
    limit: Number(params.get('limit')) || 20,
  });

  return ok(result);
});
