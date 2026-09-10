import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { badRequest, notFound } from '@/lib/api/errors';
import { ok, parseBody, route } from '@/lib/api/handler';
import { enregistrerMouvement, tracabiliteLot } from '@/lib/services/stock';

/**
 * GET /api/stocks/lots?id= — la traçabilité d'un lot.
 *
 * C'est la réponse directe à la question d'un contrôle : ce lot, où est-il
 * parti ? On remonte vers les parcelles et les dates.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read');
  const id = request.nextUrl.searchParams.get('id');
  if (!id) throw badRequest('Identifiant de lot manquant.');

  const trace = await tracabiliteLot(ctx.farmId, id);
  if (!trace) throw notFound('Lot introuvable pour cette exploitation.');

  return ok(trace);
});

const CreationLot = z.object({
  itemId: z.string().min(1),
  lotNumber: z.string().trim().max(100).nullable().optional(),
  supplier: z.string().trim().max(200).nullable().optional(),
  purchasedOn: z.coerce.date().nullable().optional(),
  expiresOn: z.coerce.date().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  documentId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /**
   * Quantité reçue. Facultative : on peut enregistrer un lot déjà entamé dont
   * on ne connaît plus la quantité d'origine. Dans ce cas, aucune entrée n'est
   * créée — plutôt qu'un chiffre inventé qui fausserait le solde.
   */
  quantite: z.number().positive().nullable().optional(),
  unite: z.string().trim().min(1).max(20).nullable().optional(),
});

/** POST /api/stocks/lots — enregistrer un lot, et son entrée en stock. */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, CreationLot);

  const article = await prisma.stockItem.findFirst({
    where: { id: body.itemId, farmId: ctx.farmId },
    select: { id: true, unit: true },
  });
  if (!article) throw notFound('Article de stock introuvable.');

  if (body.quantite != null && !body.unite) {
    throw badRequest('Précisez l’unité de la quantité reçue.');
  }

  const lot = await prisma.stockLot.create({
    data: {
      itemId: article.id,
      lotNumber: body.lotNumber ?? null,
      supplier: body.supplier ?? null,
      purchasedOn: body.purchasedOn ?? null,
      expiresOn: body.expiresOn ?? null,
      unitPrice: body.unitPrice ?? null,
      documentId: body.documentId ?? null,
      notes: body.notes ?? null,
    },
    select: { id: true, lotNumber: true },
  });

  let entree: { id: string; quantiteSignee: number } | null = null;
  if (body.quantite != null && body.unite) {
    const resultat = await enregistrerMouvement(ctx.farmId, {
      itemId: article.id,
      lotId: lot.id,
      kind: 'ENTREE',
      occurredOn: body.purchasedOn ?? new Date(),
      quantity: body.quantite,
      unit: body.unite,
      reason: 'Réception du lot',
      createdById: ctx.user.id,
    });

    if (!resultat.ok) {
      // Le lot vient d'être créé : le laisser sans son entrée produirait un lot
      // à zéro sans explication. On le retire et on rend le motif.
      await prisma.stockLot.delete({ where: { id: lot.id } });
      throw badRequest(resultat.raison);
    }
    entree = { id: resultat.id, quantiteSignee: resultat.quantiteSignee };
  }

  return ok({ lot, entree }, 201);
});
