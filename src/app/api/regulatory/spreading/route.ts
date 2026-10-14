import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { controlerEpandage } from '@/lib/regulatory/epandage';
import { campagneCourante } from '@/lib/shared/campagne';
import { classementDuProduit } from '@/lib/regulatory/classement-produit';
import { kgDeProduitParHa, quantiteOrganiqueParHa } from '@/lib/services/fertilization';

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
  /** Engrais minéral du référentiel, quand c'en est un. */
  fertilizerId: z.string().trim().max(40).optional(),
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
  let azoteKgHa: number | null = null;
  let effluent = input.effluent ?? 'Effluent non précisé';
  const surface = input.surfaceHa ?? Number(parcelle.areaHa);
  let produitControle: Parameters<typeof controlerEpandage>[0]['produit'] = {
    nature: 'ORGANIC',
    classement: classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: null }),
    azoteKgHa: null,
  };

  if (input.organicInputId && input.fertilizerId) {
    throw badRequest('Un produit organique ou un engrais minéral, pas les deux.');
  }

  if (input.organicInputId) {
    const produit = await prisma.organicInput.findFirst({
      where: {
        id: input.organicInputId,
        OR: [{ farmId: null }, { farmId: ctx.farmId }],
      },
      select: { name: true, nContent: true, regulatoryClass: true, defaultUnit: true },
    });
    if (!produit) throw notFound('Produit organique introuvable');
    effluent = produit.name;

    // dose (t/ha ou m3/ha) × teneur (kg N par t ou m3) = kg N/ha ;
    // multiplié par la surface épandue = kg d'azote au total. Une dose en m³
    // d'un produit analysé à la tonne (ou l'inverse) ne se convertit pas.
    const quantite = quantiteOrganiqueParHa(input.quantite, input.unite, produit.defaultUnit);
    if (produit.nContent !== null && quantite !== null) {
      azoteKgHa = quantite * Number(produit.nContent);
      azoteKg = azoteKgHa * surface;
    }
    produitControle = {
      nature: 'ORGANIC',
      classement: classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: produit.regulatoryClass }),
      azoteKgHa,
    };
  }

  if (input.fertilizerId) {
    const engrais = await prisma.fertilizer.findFirst({
      where: { id: input.fertilizerId, OR: [{ farmId: null }, { farmId: ctx.farmId }] },
      select: { name: true, nPercent: true },
    });
    if (!engrais) throw notFound('Engrais introuvable');
    effluent = engrais.name;
    // La teneur d'un engrais est un pourcentage **massique** : elle ne
    // s'applique qu'à une dose en masse. Une dose en litres demanderait la
    // densité de la solution, que le référentiel ne porte pas — l'azote reste
    // alors inconnu plutôt que deviné.
    const kgProduit = kgDeProduitParHa(input.quantite, input.unite);
    if (engrais.nPercent !== null && kgProduit !== null) {
      // Pas d'`azoteKg` : le plafond du programme d'actions porte sur l'azote
      // des effluents d'élevage, pas sur celui d'un engrais minéral.
      azoteKgHa = (kgProduit * Number(engrais.nPercent)) / 100;
    }
    produitControle = {
      nature: 'MINERAL',
      classement: classementDuProduit({
        inputType: 'MINERAL',
        nPercent: engrais.nPercent === null ? null : Number(engrais.nPercent),
      }),
      azoteKgHa,
    };
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
    produit: produitControle,
  });

  return ok(rapport);
});
