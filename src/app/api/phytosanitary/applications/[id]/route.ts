import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { copieDeRegistre, logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';
import { phytoApplicationUpdateSchema } from '@/lib/validation/farming';
import { differences, preparerTraitement } from '@/lib/services/saisies';
import { buildPhytoWarnings } from '@/lib/services/phyto-control';
import { ajusterSortieTraitement } from '@/lib/services/stock';

type Ctx = { params: Promise<Record<string, string>> };

/** DELETE /api/phytosanitary/applications/:id — retire un traitement du registre. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Traitement introuvable');

  const record = await prisma.phytosanitaryApplication.findUnique({ where: { id } });
  if (!record) throw notFound('Traitement introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.phytosanitaryApplication.delete({ where: { id } });

  await logAudit({
    action: 'phyto.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'phytosanitaryApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { productName: record.productName, supprime: copieDeRegistre(record) },
  });

  return ok({ message: 'Traitement supprimé du registre' });
});

const CHAMPS_JOURNAL = [
  'appliedOn',
  'productName',
  'amm',
  'activeSubstances',
  'cropLabel',
  'targetLabel',
  'dose',
  'doseUnit',
  'sprayVolumeLHa',
  'treatedAreaHa',
  'quantityUsed',
  'cropYearId',
  'operator',
  'notes',
  'startTime',
  'endTime',
  'bbchStage',
  'organicProduction',
  'appliedBy',
  'contractorName',
  'contractorSiret',
];

/**
 * PUT /api/phytosanitary/applications/:id — corriger un traitement.
 *
 * Mêmes contrôles qu'à la création : produit repris du catalogue E-Phy quand
 * il y est référencé, quantité recalculée, surface revérifiée, dose et
 * conditions d'emploi réopposées (`buildPhytoWarnings`). La sortie de stock
 * rattachée suit la correction (`ajusterSortieTraitement`). Ce qui change est
 * inscrit au journal, avec l'avant et l'après.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Traitement introuvable');

  const existant = await prisma.phytosanitaryApplication.findUnique({ where: { id } });
  if (!existant) throw notFound('Traitement introuvable');

  const { ctx, parcel } = await requireParcelAccess(existant.parcelId, 'record:write');
  const { stockLotId, ...input } = await parseBody(request, phytoApplicationUpdateSchema);

  const prepare = await preparerTraitement({ parcel, input, modification: true });
  const item = await prisma.phytosanitaryApplication.update({ where: { id }, data: prepare.data });

  const avertissementStock = await ajusterSortieTraitement(ctx.farmId, {
    applicationId: id,
    lotDemande: stockLotId,
    quantite: Number(prepare.totalQuantity),
    unite: prepare.totalUnit,
    date: input.appliedOn,
    userId: ctx.user.id,
  });

  await logAudit({
    action: 'phyto.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'phytosanitaryApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { modifications: differences(existant, prepare.data, CHAMPS_JOURNAL) },
  });

  const controles = await buildPhytoWarnings({
    parcelId: existant.parcelId,
    productId: prepare.productId,
    cropLabel: input.cropLabel ?? null,
    cropYearId: input.cropYearId ?? null,
    dose: input.dose,
    doseUnit: input.doseUnit,
    appliedOn: input.appliedOn,
    // Il ne doit pas se compter lui-même dans le nombre de passages.
    applicationId: id,
  });

  return ok({
    item,
    id,
    message: 'Traitement corrigé',
    warnings: [
      ...(prepare.amm
        ? []
        : ['Aucun numéro d’AMM associé : cette intervention apparaîtra comme incomplète dans votre registre.']),
      ...controles,
      ...(avertissementStock ? [avertissementStock] : []),
    ],
  });
});
