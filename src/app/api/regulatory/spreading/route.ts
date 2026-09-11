import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { controlerEpandage } from '@/lib/regulatory/epandage';
import { campagneCourante } from '@/lib/shared/campagne';

/**
 * POST /api/regulatory/spreading — contrôle avant épandage.
 *
 * « Est-ce que je peux épandre là, aujourd'hui, cette quantité ? » On donne la
 * parcelle, la date, l'effluent et la quantité ; la réponse dit ce qui a été
 * vérifié, ce qui ne l'a pas été, et pourquoi.
 *
 * **Elle n'écrit rien.** C'est une simulation : on la relance autant qu'on veut
 * en changeant la date ou la quantité, sans laisser de trace. L'apport
 * lui-même se saisit ailleurs, une fois épandu.
 *
 * L'azote apporté est calculé à partir de la teneur enregistrée pour le produit
 * organique choisi. Quand cette teneur n'est pas renseignée — le cas habituel
 * tant qu'aucune analyse n'a été faite —, l'azote est `null` et le contrôle du
 * plafond ressort indéterminé plutôt que faux.
 */
const schema = z.object({
  parcelId: z.string().trim().min(1).max(40),
  /** Jour de l'épandage envisagé, au format `AAAA-MM-JJ`. */
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ'),
  /** Produit organique du référentiel, quand il en vient un. */
  organicInputId: z.string().trim().max(40).optional(),
  /** Libellé libre, quand l'effluent n'est pas au référentiel. */
  effluent: z.string().trim().max(160).optional(),
  quantite: z.number().positive().max(100_000),
  unite: z.string().trim().min(1).max(16),
  /** Surface réellement épandue, en hectares. À défaut, celle de la parcelle. */
  surfaceHa: z.number().positive().max(10_000).optional(),
  campaignYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read');
  const input = await parseBody(request, schema);

  const date = new Date(`${input.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw badRequest('Date illisible.');

  const parcelle = await prisma.parcel.findFirst({
    where: { id: input.parcelId, farmId: ctx.farmId, deletedAt: null },
    select: { id: true, areaHa: true },
  });
  if (!parcelle) throw notFound('Parcelle introuvable');

  /*
   * L'azote apporté, quand il est calculable.
   *
   * Le calcul est celui de `computeSupply` (`src/lib/services/fertilization.ts`) :
   * `nContent` est une teneur **en kg d'azote par unité de dose** — par tonne ou
   * par mètre cube —, pas un pourcentage. Employer ici une autre formule
   * donnerait deux chiffres différents pour le même apport selon l'écran
   * consulté, ce qui est pire que pas de chiffre du tout.
   *
   * Sans teneur renseignée, on ne calcule rien : un fumier dont on ignore la
   * composition ne se convertit pas en kilos d'azote, et en supposer une
   * reviendrait à fabriquer le chiffre sur lequel repose tout le contrôle du
   * plafond.
   */
  let azoteKg: number | null = null;
  let effluent = input.effluent ?? 'Effluent non précisé';

  if (input.organicInputId) {
    const produit = await prisma.organicInput.findFirst({
      where: {
        id: input.organicInputId,
        OR: [{ farmId: null }, { farmId: ctx.farmId }],
      },
      select: { name: true, nContent: true },
    });
    if (!produit) throw notFound('Produit organique introuvable');
    effluent = produit.name;

    if (produit.nContent !== null) {
      const surface = input.surfaceHa ?? Number(parcelle.areaHa);
      // dose (t/ha ou m3/ha) × teneur (kg N par t ou m3) = kg N/ha ;
      // multiplié par la surface épandue = kg d'azote au total.
      azoteKg = input.quantite * Number(produit.nContent) * surface;
    }
  }

  const rapport = await controlerEpandage({
    farmId: ctx.farmId,
    parcelId: parcelle.id,
    date,
    effluent,
    quantite: input.quantite,
    unite: input.unite,
    azoteKg,
    campaignYear: input.campaignYear ?? campagneCourante(date),
  });

  return ok(rapport);
});
