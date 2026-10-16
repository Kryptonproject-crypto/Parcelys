import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { fertilizationSchema } from '@/lib/validation/farming';
import { computeNutrientBalance } from '@/lib/services/fertilization';
import { preparerApport } from '@/lib/services/saisies';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';
import { classementDuProduit } from '@/lib/regulatory/classement-produit';
import { controlerApportPar } from '@/lib/regulatory/programme-actions';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/fertilization — apports + bilan NPK de la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { parcel } = await requireParcelAccess(id, 'record:read');

  const items = await prisma.fertilizerApplication.findMany({
    where: { parcelId: id },
    include: {
      fertilizer: { select: { name: true } },
      organicInput: { select: { name: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
  });

  const balance = computeNutrientBalance(
    items.map((i) => ({
      treatedAreaHa: i.treatedAreaHa.toString(),
      nSupplied: i.nSupplied?.toString() ?? null,
      pSupplied: i.pSupplied?.toString() ?? null,
      kSupplied: i.kSupplied?.toString() ?? null,
    })),
    parcel.areaHa,
  );

  return ok({ items, balance });
});

/**
 * POST /api/parcels/:id/fertilization — enregistre un apport.
 *
 * La quantité totale (`dose × surface`) et les éléments fertilisants sont
 * calculés côté serveur à partir du référentiel : le client ne peut pas les
 * imposer.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx, parcel } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, fertilizationSchema);

  // Quantité totale, éléments fertilisants, surface, météo : le même calcul
  // qu'à la modification (`src/lib/services/saisies.ts`).
  const prepare = await preparerApport({ farmId: ctx.farmId, parcel, input });
  const { productLabel, mineral, regulatoryClass, totalQuantity, totalUnit, nSupplied, pSupplied, kSupplied } =
    prepare;

  const created = await prisma.fertilizerApplication.create({
    data: { ...prepare.data, parcelId: id, createdById: ctx.user.id },
  });

  await logAudit({
    action: 'fertilization.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'fertilizerApplication',
    entityId: created.id,
    ipAddress: clientIp(request),
    metadata: { productLabel, dose: input.dose, doseUnit: input.doseUnit },
  });

  // Le programme d'actions, opposé à l'apport tel qu'il vient d'être
  // enregistré : période, fractionnement, couverts, digestat, ZAR — chaque
  // constat avec sa règle. L'apport est enregistré quoi qu'il en soit : un
  // registre faux serait pire qu'un registre annoté.
  const { controles } = await controlerApportPar({
    id: created.id,
    parcelId: id,
    date: input.appliedOn,
    nature: input.inputType,
    libelle: productLabel,
    azoteTotalKgHa: nSupplied,
    classement: classementDuProduit({
      inputType: input.inputType,
      nPercent: mineral?.nPercent ?? null,
      regulatoryClass,
    }),
    cropYearId: input.cropYearId ?? null,
  }).catch(() => ({
    // Un contrôle qui n'a pas pu se faire se dit — il ne se tait pas.
    controles: [
      {
        sujet: 'Programme d’actions nitrates',
        verdict: 'indetermine' as const,
        detail: 'Le contrôle n’a pas pu être effectué : l’apport est enregistré, vérifiez-le depuis la synthèse de conformité.',
        trace: null,
      },
    ],
  }));

  return ok(
    {
      item: created,
      computed: { totalQuantity, totalUnit, nSupplied, pSupplied, kSupplied },
      controles: controles.filter((c) => c.verdict !== 'sans-objet'),
      message: 'Apport enregistré',
    },
    201,
  );
});
