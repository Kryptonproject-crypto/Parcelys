import type { NextRequest } from 'next/server';
import { ok, route } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/admin/scope';
import { rechercherNumero } from '@/lib/admin/recherche';

/**
 * GET /api/admin/recherche?q=EXP-000012 — retrouve un client ou une demande
 * par son numéro, dans le périmètre de l'administrateur. 404 si le numéro est
 * inconnu **ou** hors périmètre : la réponse ne permet pas de les distinguer.
 */
export const GET = route(async (request: NextRequest) => {
  const { scope } = await requireAdmin('dashboard:read');
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const resultat = await rechercherNumero(scope, q.slice(0, 40));
  if (!resultat.found) {
    throw notFound(
      resultat.reason === 'format'
        ? 'Tapez un numéro complet : EXP-…, TEC-… ou DEM-….'
        : 'Aucun résultat dans votre périmètre.',
    );
  }
  return ok(resultat);
});
