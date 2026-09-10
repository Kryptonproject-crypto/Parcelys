import type { NextRequest } from 'next/server';
import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { getProductDetail } from '@/lib/ephy/search';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * GET /api/phytosanitary/products/:idOrAmm — fiche produit officielle.
 * Toutes les valeurs proviennent de l'import E-Phy, sans reformulation.
 */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  await requireVerifiedAuth();

  const id = (await context.params).id;
  if (!id) throw notFound('Produit introuvable');

  const detail = await getProductDetail(id);
  if (!detail) {
    throw notFound(
      'Produit absent du référentiel. Vérifiez la dernière synchronisation E-Phy.',
    );
  }

  const { product, source } = detail;

  return ok({
    source,
    product: {
      id: product.id,
      amm: product.amm,
      name: product.name,
      secondNames: product.secondNames,
      holder: product.holder,
      status: product.status,
      productType: product.productType,
      commercialType: product.commercialType,
      formulation: product.formulation,
      authorizedMentions: product.authorizedMentions,
      usageRestrictions: product.usageRestrictions,
      withdrawnAt: product.withdrawnAt,
      syncedAt: product.syncedAt,
      substances: product.substances.map((s) => ({
        name: s.substance.name,
        casNumber: s.substance.casNumber,
        concentration: s.concentration,
        unit: s.unit,
      })),
      usages: product.usages.map((u) => ({
        id: u.id,
        ephyUsageId: u.ephyUsageId,
        usageLabel: u.usageLabel,
        cropLabel: u.cropLabel,
        targetLabel: u.targetLabel,
        doseValue: u.doseValue,
        doseUnit: u.doseUnit,
        status: u.status,
        conditions: u.conditions,
        preHarvestDelay: u.preHarvestDelay,
        preHarvestBbch: u.preHarvestBbch,
        bbchMin: u.bbchMin,
        bbchMax: u.bbchMax,
        zntAquaticM: u.zntAquaticM,
        zntArthropodM: u.zntArthropodM,
        zntPlantM: u.zntPlantM,
        maxApplications: u.maxApplications,
        minIntervalDays: u.minIntervalDays,
        endDistribution: u.endDistribution,
        endUsage: u.endUsage,
        decisionDate: u.decisionDate,
      })),
      conditions: product.conditions.map((c) => ({
        category: c.category,
        label: c.label,
        concernsDrainedSoil: c.concernsDrainedSoil,
      })),
    },
  });
});
