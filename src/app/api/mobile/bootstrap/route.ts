import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { buildMobileSnapshot } from '@/lib/services/mobile';

/**
 * GET /api/mobile/bootstrap[?farmId=…] — instantané pour le cache hors ligne.
 *
 * Appelé à la connexion de l'application de terrain, puis à chaque
 * synchronisation manuelle. Tout ce qui alimente un formulaire — parcelles,
 * cultures, engrais, produits déjà utilisés, unités, préconisations en cours —
 * arrive en un seul appel, de façon à ce que l'application reste utilisable
 * une fois hors réseau.
 *
 * `farmId` désigne l'exploitation à embarquer : l'expert agronomique en suit
 * plusieurs et change de domaine sans se reconnecter. Un identifiant hors de
 * son portefeuille renvoie 404.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess(
    'parcel:read',
    request.nextUrl.searchParams.get('farmId'),
  );
  return ok(await buildMobileSnapshot(ctx));
});
