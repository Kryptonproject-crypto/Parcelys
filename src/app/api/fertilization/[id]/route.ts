import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { copieDeRegistre, logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';
import { fertilizationUpdateSchema } from '@/lib/validation/farming';
import { differences, preparerApport } from '@/lib/services/saisies';
import { classementDuProduit } from '@/lib/regulatory/classement-produit';
import { controlerApportPar } from '@/lib/regulatory/programme-actions';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * DELETE /api/fertilization/:id
 * L'accès est vérifié via la parcelle porteuse : un identifiant appartenant à
 * une autre exploitation renvoie 404.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Apport introuvable');

  const record = await prisma.fertilizerApplication.findUnique({ where: { id } });
  if (!record) throw notFound('Apport introuvable');

  const { ctx } = await requireParcelAccess(record.parcelId, 'record:delete');
  await prisma.fertilizerApplication.delete({ where: { id } });

  await logAudit({
    action: 'fertilization.deleted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'fertilizerApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { productLabel: record.productLabel, supprime: copieDeRegistre(record) },
  });

  return ok({ message: 'Apport supprimé' });
});

const CHAMPS_JOURNAL = [
  'appliedOn',
  'inputType',
  'productLabel',
  'dose',
  'doseUnit',
  'treatedAreaHa',
  'totalQuantity',
  'nSupplied',
  'pSupplied',
  'kSupplied',
  'cropYearId',
  'supplier',
  'batchNumber',
  'operator',
  'notes',
];

/**
 * PUT /api/fertilization/:id — corriger un apport.
 *
 * Mêmes contrôles et mêmes calculs qu'à la création (`preparerApport`) : la
 * quantité totale et les éléments sont recalculés, la surface revérifiée, le
 * programme d'actions réopposé à l'apport corrigé. Ce qui change est inscrit
 * au journal, avec l'avant et l'après.
 *
 * L'accès se vérifie par la parcelle porteuse : un identifiant d'une autre
 * exploitation répond 404, comme s'il n'existait pas.
 */
export const PUT = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Apport introuvable');

  const existant = await prisma.fertilizerApplication.findUnique({ where: { id } });
  if (!existant) throw notFound('Apport introuvable');

  const { ctx, parcel } = await requireParcelAccess(existant.parcelId, 'record:write');
  const input = await parseBody(request, fertilizationUpdateSchema);

  const prepare = await preparerApport({ farmId: ctx.farmId, parcel, input, existant });
  const item = await prisma.fertilizerApplication.update({ where: { id }, data: prepare.data });

  await logAudit({
    action: 'fertilization.updated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'fertilizerApplication',
    entityId: id,
    ipAddress: clientIp(request),
    metadata: { modifications: differences(existant, prepare.data, CHAMPS_JOURNAL) },
  });

  const { controles } = await controlerApportPar({
    id,
    parcelId: existant.parcelId,
    date: input.appliedOn,
    nature: input.inputType,
    libelle: prepare.productLabel,
    azoteTotalKgHa: prepare.nSupplied,
    classement: classementDuProduit({
      inputType: input.inputType,
      nPercent: prepare.mineral?.nPercent ?? null,
      regulatoryClass: prepare.regulatoryClass,
    }),
    cropYearId: input.cropYearId ?? null,
  }).catch(() => ({
    controles: [
      {
        sujet: 'Programme d’actions nitrates',
        verdict: 'indetermine' as const,
        detail: 'Le contrôle n’a pas pu être effectué : l’apport est corrigé, vérifiez-le depuis la synthèse de conformité.',
        trace: null,
      },
    ],
  }));

  return ok({
    item,
    id,
    computed: {
      totalQuantity: prepare.totalQuantity,
      totalUnit: prepare.totalUnit,
      nSupplied: prepare.nSupplied,
      pSupplied: prepare.pSupplied,
      kSupplied: prepare.kSupplied,
    },
    controles: controles.filter((c) => c.verdict !== 'sans-objet'),
    message: 'Apport corrigé',
  });
});
