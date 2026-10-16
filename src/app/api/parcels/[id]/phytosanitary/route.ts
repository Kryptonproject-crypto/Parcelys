import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { phytoApplicationSchema } from '@/lib/validation/farming';
import { preparerTraitement } from '@/lib/services/saisies';
import { buildPhytoWarnings } from '@/lib/services/phyto-control';
import { logAudit } from '@/lib/audit';
import { enregistrerMouvement } from '@/lib/services/stock';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/phytosanitary — traitements de la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'record:read');

  const items = await prisma.phytosanitaryApplication.findMany({
    where: { parcelId: id },
    include: {
      product: { select: { id: true, amm: true, name: true, status: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  return ok({ items });
});

/**
 * POST /api/parcels/:id/phytosanitary — enregistre un traitement.
 *
 * Les caractéristiques réglementaires (AMM, substances actives) sont reprises
 * du référentiel E-Phy lorsque le produit y est référencé ; elles ne sont
 * jamais devinées. En saisie libre, le champ AMM reste vide et l'intervention
 * apparaît comme « à compléter » dans le tableau de bord.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx, parcel } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, phytoApplicationSchema);

  // Produit, quantité, surface, météo : le même calcul qu'à la modification
  // (`src/lib/services/saisies.ts`).
  const prepare = await preparerTraitement({ parcel, input, modification: false });
  const { productId, productName, amm, totalQuantity, totalUnit } = prepare;

  const created = await prisma.phytosanitaryApplication.create({
    data: { ...prepare.data, parcelId: id, createdById: ctx.user.id },
  });

  // Sortie de stock, quand un lot a été désigné.
  //
  // Créée ici, dans la foulée du traitement, plutôt que laissée à un second
  // appel : au champ il n'y a qu'un geste, et une file d'attente ne sait pas
  // enchaîner deux opérations dont la seconde dépend de l'identifiant produit
  // par la première.
  //
  // Un refus n'annule pas le traitement. Le registre phytosanitaire prime : un
  // traitement réellement effectué doit y figurer, même si le stock ne peut pas
  // être mouvementé. L'écart apparaîtra dans « utilisations non rattachées ».
  let avertissementStock: string | null = null;
  if (input.stockLotId) {
    const lot = await prisma.stockLot.findFirst({
      where: { id: input.stockLotId, item: { farmId: ctx.farmId } },
      select: { id: true, itemId: true },
    });

    if (!lot) {
      avertissementStock =
        'Le lot indiqué est introuvable : le traitement est enregistré, mais le stock n’a pas été mouvementé.';
    } else {
      const mouvement = await enregistrerMouvement(ctx.farmId, {
        itemId: lot.itemId,
        lotId: lot.id,
        kind: 'SORTIE',
        occurredOn: input.appliedOn,
        quantity: Number(totalQuantity),
        unit: totalUnit,
        phytoApplicationId: created.id,
        reason: 'Traitement enregistré',
        createdById: ctx.user.id,
      });
      if (!mouvement.ok) avertissementStock = `Stock non mouvementé : ${mouvement.raison}`;
    }
  }

  await logAudit({
    action: 'phyto.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'phytosanitaryApplication',
    entityId: created.id,
    ipAddress: clientIp(request),
    metadata: { productName, amm, dose: input.dose },
  });

  // Contrôles réglementaires : dose retenue au catalogue, produit retiré, sol
  // drainé. Ils avertissent après l'enregistrement plutôt que de le refuser —
  // voir `buildPhytoWarnings`. Ils portent aussi sur les saisies rejouées
  // depuis l'application mobile, qui passent par ce même gestionnaire.
  const controles = await buildPhytoWarnings({
    parcelId: id,
    productId,
    cropLabel: input.cropLabel ?? null,
    cropYearId: input.cropYearId ?? null,
    dose: input.dose,
    doseUnit: input.doseUnit,
    appliedOn: input.appliedOn,
    // La ligne vient d'être écrite : sans cette exclusion, elle se compterait
    // elle-même dans le nombre de passages de la campagne.
    applicationId: created.id,
  });

  return ok(
    {
      item: created,
      message: 'Traitement enregistré',
      warnings: [
        ...(amm
          ? []
          : [
              'Aucun numéro d’AMM associé : cette intervention apparaîtra comme incomplète dans votre registre.',
            ]),
        ...controles,
        // Le refus du stock est un avertissement, pas une erreur : le
        // traitement est bel et bien enregistré.
        ...(avertissementStock ? [avertissementStock] : []),
      ],
    },
    201,
  );
});
