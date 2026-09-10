import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { phytoApplicationSchema } from '@/lib/validation/farming';
import { computeTotalQuantity } from '@/lib/services/fertilization';
import { decimalWeather, resolveInterventionWeather } from '@/lib/weather';
import { buildPhytoWarnings } from '@/lib/services/phyto-control';
import { logAudit } from '@/lib/audit';
import { enregistrerMouvement } from '@/lib/services/stock';
import { badRequest, notFound } from '@/lib/api/errors';

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

  const parcelAreaHa = Number(parcel.areaHa);
  const treatedAreaHa = input.treatedAreaHa ?? parcelAreaHa;

  if (treatedAreaHa <= 0) {
    throw badRequest('La surface traitée doit être supérieure à 0.');
  }
  if (treatedAreaHa > parcelAreaHa * 1.05) {
    throw badRequest(
      `La surface traitée (${treatedAreaHa.toFixed(4)} ha) dépasse la superficie de la parcelle (${parcelAreaHa.toFixed(4)} ha).`,
    );
  }

  let productName = input.productName;
  let amm = input.amm ?? null;
  let activeSubstances = input.activeSubstances ?? null;
  let productId: string | null = null;

  if (input.productId) {
    const product = await prisma.phytosanitaryProduct.findUnique({
      where: { id: input.productId },
      include: { substances: { include: { substance: { select: { name: true } } } } },
    });
    if (!product) {
      throw badRequest(
        'Produit introuvable dans le référentiel E-Phy. Relancez une synchronisation ou saisissez le produit manuellement.',
      );
    }
    productId = product.id;
    productName = product.name;
    amm = product.amm;
    activeSubstances =
      product.substances.map((s) => s.substance.name).join(', ') || null;
  }

  if (input.cropYearId) {
    const cropYear = await prisma.cropYear.findFirst({
      where: { id: input.cropYearId, parcelId: id },
      select: { id: true },
    });
    if (!cropYear) throw badRequest('Culture inconnue pour cette parcelle.');
  }

  const { totalQuantity, totalUnit } = computeTotalQuantity(
    input.dose,
    input.doseUnit,
    treatedAreaHa,
  );

  // Conditions météo : celles relevées au champ priment, sinon relevé ici si
  // la parcelle est localisée. Voir `resolveInterventionWeather`.
  const location = await prisma.parcel.findUnique({
    where: { id },
    select: { centroidLat: true, centroidLng: true },
  });
  const weather = await resolveInterventionWeather(
    input,
    location ? { latitude: location.centroidLat, longitude: location.centroidLng } : null,
  );

  const created = await prisma.phytosanitaryApplication.create({
    data: {
      parcelId: id,
      cropYearId: input.cropYearId ?? null,
      appliedOn: input.appliedOn,
      productId,
      productName,
      amm,
      activeSubstances,
      cropLabel: input.cropLabel ?? null,
      targetLabel: input.targetLabel ?? null,
      dose: new Prisma.Decimal(input.dose),
      doseUnit: input.doseUnit,
      sprayVolumeLHa:
        input.sprayVolumeLHa !== undefined ? new Prisma.Decimal(input.sprayVolumeLHa) : null,
      treatedAreaHa: new Prisma.Decimal(treatedAreaHa.toFixed(4)),
      quantityUsed: new Prisma.Decimal(totalQuantity),
      quantityUnit: totalUnit,
      ...decimalWeather(weather),
      operator: input.operator ?? null,
      notes: input.notes ?? null,
      createdById: ctx.user.id,
    },
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
