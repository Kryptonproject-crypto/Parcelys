import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireParcelAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { lotsPhytoDisponibles } from '@/lib/services/stock';
import { toHit } from '@/lib/ephy/search';

/**
 * GET /api/stocks/phyto[?parcelId=|?farmId=] — les produits phytosanitaires
 * en stock, avec leurs lots et ce qu'il en reste, pour les proposer en premier
 * à la saisie d'un traitement.
 *
 * `parcelId` : le stock de l'exploitation **de la parcelle**, qui n'est pas
 * forcément l'exploitation active d'un compte qui en a plusieurs. Proposer le
 * stock de l'autre ferait choisir un lot que l'enregistrement refuserait.
 */
export const GET = route(async (request: NextRequest) => {
  const parcelId = request.nextUrl.searchParams.get('parcelId');
  const ctx = parcelId
    ? (await requireParcelAccess(parcelId, 'record:read')).ctx
    : await requireFarmAccess('record:read', request.nextUrl.searchParams.get('farmId'));
  const lots = await lotsPhytoDisponibles(ctx.farmId);
  const ids = [...new Set(lots.map((l) => l.phytoProductId).filter((id): id is string => Boolean(id)))];
  const produits = await prisma.phytosanitaryProduct.findMany({
    where: { id: { in: ids } },
    include: {
      substances: { include: { substance: { select: { name: true } } } },
      // Jusqu'où un produit retiré s'emploie encore : dit à côté du bidon.
      usages: {
        where: { endUsage: { not: null } },
        select: { endUsage: true },
        orderBy: { endUsage: 'desc' },
        take: 1,
      },
    },
  });
  const parId = new Map(produits.map((p) => [p.id, toHit(p)]));
  return ok({
    produits: ids
      .map((id) => {
        const produit = parId.get(id);
        if (!produit) return null;
        const ses = lots.filter((l) => l.phytoProductId === id);
        return {
          produit,
          unite: ses[0]?.unit ?? null,
          reste: ses.reduce((s, l) => s + l.reste, 0),
          lots: ses.map((l) => ({
            id: l.id,
            lotNumber: l.lotNumber,
            reste: l.reste,
            unit: l.unit,
            purchasedOn: l.purchasedOn,
            expiresOn: l.expiresOn,
          })),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.produit.name.localeCompare(b.produit.name)),
  });
});
