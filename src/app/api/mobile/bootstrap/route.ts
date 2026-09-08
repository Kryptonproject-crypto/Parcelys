import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { buildMobileSnapshot } from '@/lib/services/mobile';

/**
 * GET /api/mobile/bootstrap — instantané complet pour le cache hors ligne.
 *
 * Appelé à la connexion de l'application de terrain, puis à chaque
 * synchronisation manuelle. Tout ce qui alimente un formulaire — parcelles,
 * cultures, engrais, produits déjà utilisés, unités — arrive en un seul appel,
 * de façon à ce que l'application reste utilisable une fois hors réseau.
 */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('parcel:read');
  return ok(await buildMobileSnapshot(ctx));
});
