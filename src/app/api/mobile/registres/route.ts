import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { registresMobile } from '@/lib/services/registres-mobile';

/**
 * GET /api/mobile/registres[?farmId=…][&version=…] — registres des parcelles,
 * pour les consulter depuis l'application, réseau ou pas.
 *
 * Cultures et couverts, apports et bilan, traitements, travaux, historique :
 * ce que montre la fiche parcelle du site, pour toutes les parcelles de
 * l'exploitation. Appelé à chaque synchronisation ; `version` est l'empreinte
 * déjà en cache sur le téléphone — si rien n'a changé, la réponse se réduit à
 * `{ unchanged: true }`.
 *
 * Mêmes droits que la lecture des registres sur le site : membres de
 * l'exploitation et expert en mission. Une exploitation hors d'atteinte
 * répond 404, comme l'instantané.
 */
export const GET = route(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const ctx = await requireFarmAccess('record:read', params.get('farmId'));
  return ok(await registresMobile(ctx.farmId, params.get('version')));
});
