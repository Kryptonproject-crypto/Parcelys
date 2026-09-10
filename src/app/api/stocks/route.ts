import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { StockCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { badRequest } from '@/lib/api/errors';
import { ok, parseBody, route } from '@/lib/api/handler';
import { etatStocks, utilisationsNonRattachees } from '@/lib/services/stock';
import { uniteConnue, UNITES_COURANTES } from '@/lib/stock/units';

/**
 * GET /api/stocks — l'état des stocks de l'exploitation.
 *
 * Renvoie aussi les utilisations non rattachées : sans elles, un exploitant
 * pourrait tenir un stock et traiter pendant des mois sans que les deux se
 * parlent, en croyant son solde à jour.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read', request.nextUrl.searchParams.get('farmId'));
  const inclureArchives = request.nextUrl.searchParams.get('archives') === '1';

  const [articles, nonRattachees] = await Promise.all([
    etatStocks(ctx.farmId, { inclureArchives }),
    utilisationsNonRattachees(ctx.farmId, { limite: 50 }),
  ]);

  return ok({
    articles: articles.map((a) => ({
      ...a,
      solde: { ...a.solde, quantite: a.solde.quantite },
      lots: a.lots.map((l) => ({ ...l, reste: l.reste.quantite })),
    })),
    utilisationsNonRattachees: nonRattachees,
    unitesCourantes: UNITES_COURANTES,
    /**
     * Rappel affiché tel quel par l'interface. Un stock présenté comme une
     * vérité serait une information fabriquée : c'est le solde des mouvements
     * enregistrés, rien de plus.
     */
    avertissement:
      'Ce solde est celui des mouvements enregistrés, pas un inventaire physique. ' +
      'Un achat ou un prélèvement non saisi ne s’y trouve pas.',
  });
});

const CreationArticle = z.object({
  category: z.nativeEnum(StockCategory),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(20),
  alertThreshold: z.number().positive().nullable().optional(),
  phytoProductId: z.string().nullable().optional(),
  fertilizerId: z.string().nullable().optional(),
  organicInputId: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** POST /api/stocks — créer un article suivi en stock. */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, CreationArticle);

  if (!uniteConnue(body.unit)) {
    throw badRequest(
      `Unité « ${body.unit} » inconnue de Parcelys. ` +
        `Unités reconnues : ${UNITES_COURANTES.join(', ')}.`,
    );
  }

  // Le rattachement au référentiel se vérifie : un identifiant d'une autre
  // exploitation ferait hériter le stock d'un produit qui n'est pas le sien.
  if (body.phytoProductId) {
    const produit = await prisma.phytosanitaryProduct.findUnique({
      where: { id: body.phytoProductId },
      select: { id: true },
    });
    if (!produit) throw badRequest('Produit phytosanitaire introuvable.');
  }
  if (body.fertilizerId) {
    const engrais = await prisma.fertilizer.findFirst({
      where: { id: body.fertilizerId, OR: [{ farmId: ctx.farmId }, { farmId: null }] },
      select: { id: true },
    });
    if (!engrais) throw badRequest('Engrais introuvable pour cette exploitation.');
  }
  if (body.organicInputId) {
    const organique = await prisma.organicInput.findFirst({
      where: { id: body.organicInputId, OR: [{ farmId: ctx.farmId }, { farmId: null }] },
      select: { id: true },
    });
    if (!organique) throw badRequest('Produit organique introuvable pour cette exploitation.');
  }

  const existant = await prisma.stockItem.findFirst({
    where: { farmId: ctx.farmId, category: body.category, name: body.name },
    select: { id: true, archivedAt: true },
  });
  if (existant) {
    throw badRequest(
      existant.archivedAt
        ? `« ${body.name} » existe déjà, archivé. Réactivez-le plutôt que d’en créer un second.`
        : `« ${body.name} » existe déjà dans cette catégorie.`,
    );
  }

  const article = await prisma.stockItem.create({
    data: {
      farmId: ctx.farmId,
      category: body.category,
      name: body.name,
      unit: body.unit,
      alertThreshold: body.alertThreshold ?? null,
      phytoProductId: body.phytoProductId ?? null,
      fertilizerId: body.fertilizerId ?? null,
      organicInputId: body.organicInputId ?? null,
      notes: body.notes ?? null,
    },
    select: { id: true, name: true, unit: true, category: true },
  });

  return ok(article, 201);
});
