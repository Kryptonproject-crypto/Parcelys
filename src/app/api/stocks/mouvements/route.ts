import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { StockMovementKind } from '@prisma/client';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { badRequest } from '@/lib/api/errors';
import { ok, parseBody, route } from '@/lib/api/handler';
import { enregistrerMouvement, rattacherUtilisation } from '@/lib/services/stock';

/**
 * POST /api/stocks/mouvements — enregistrer une entrée, une sortie, un
 * ajustement d'inventaire, un retour ou une élimination.
 *
 * Deux formes acceptées :
 *
 *   · un mouvement saisi à la main (achat, inventaire, destruction) ;
 *   · le rattachement d'une utilisation déjà enregistrée, dont la quantité est
 *     alors reprise du registre plutôt que ressaisie — deux chiffres pour le
 *     même geste finiraient par diverger.
 */

const Mouvement = z.discriminatedUnion('forme', [
  z.object({
    forme: z.literal('saisie'),
    itemId: z.string().min(1),
    lotId: z.string().min(1).nullable().optional(),
    kind: z.nativeEnum(StockMovementKind),
    occurredOn: z.coerce.date(),
    quantity: z.number().refine((n) => Number.isFinite(n) && n !== 0, {
      message: 'La quantité doit être un nombre différent de zéro.',
    }),
    unit: z.string().trim().min(1).max(20),
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    forme: z.literal('rattachement'),
    kind: z.enum(['phyto', 'fertilisation']),
    applicationId: z.string().min(1),
    itemId: z.string().min(1),
    lotId: z.string().min(1).nullable(),
  }),
]);

export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, Mouvement);

  const resultat =
    body.forme === 'saisie'
      ? await enregistrerMouvement(ctx.farmId, {
          itemId: body.itemId,
          lotId: body.lotId ?? null,
          kind: body.kind,
          occurredOn: body.occurredOn,
          quantity: body.quantity,
          unit: body.unit,
          reason: body.reason ?? null,
          createdById: ctx.user.id,
        })
      : await rattacherUtilisation(ctx.farmId, {
          kind: body.kind,
          applicationId: body.applicationId,
          itemId: body.itemId,
          lotId: body.lotId,
          createdById: ctx.user.id,
        });

  // Le refus porte un motif écrit pour être lu par l'exploitant, pas un code.
  if (!resultat.ok) throw badRequest(resultat.raison);

  return ok(resultat, 201);
});
