import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { getProductUsages } from '@/lib/ephy/search';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * GET /api/phytosanitary/products/:idOrAmm/usages
 *
 * Ce qu'il faut pour saisir un traitement en connaissance de cause : usages en
 * vigueur avec dose retenue, délai avant récolte, nombre maximal d'applications
 * et ZNT, cultures couvertes, et conditions d'emploi visant les sols drainés.
 *
 * Un seul appel, parce que l'application mobile s'en sert au champ, parfois sur
 * un réseau qui ne vaut rien : trois allers-retours au lieu d'un, c'est trois
 * occasions d'échouer au moment où l'exploitant en a besoin.
 *
 * Aucune valeur n'est calculée ni complétée. Le rapprochement dose saisie /
 * dose retenue se fait côté client, à partir de ces valeurs et d'elles seules.
 */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  await requireVerifiedAuth();

  const id = (await context.params).id;
  if (!id) throw notFound('Produit introuvable');

  const detail = await getProductUsages(id);
  if (!detail) {
    throw notFound(
      'Produit absent du référentiel. Vérifiez la dernière synchronisation E-Phy.',
    );
  }

  return ok(detail);
});
