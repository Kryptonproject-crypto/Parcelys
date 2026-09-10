import 'server-only';
import { prisma } from '@/lib/prisma';
import { normalizeSearchTerm } from '@/lib/ephy/schema';
import { getLastSuccessfulSync } from '@/lib/ephy/import';
import { drainedSoilSeverity } from '@/lib/ephy/conditions';
import type { UsageForDose } from '@/lib/ephy/dose';

export type ProductSearchHit = {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  /** `true` si `status` désigne une autorisation en vigueur. */
  authorized: boolean;
  /** Date de retrait publiée par l'ANSES, au format ISO. */
  withdrawnAt: string | null;
  formulation: string | null;
  productType: string | null;
  substances: string[];
};

export type ProductSearchResponse = {
  results: ProductSearchHit[];
  total: number;
  /** Nombre de produits retirés écartés de la liste faute d'être demandés. */
  withdrawnHidden: number;
  /** Métadonnées de provenance, affichées systématiquement dans l'interface. */
  source: {
    label: string;
    lastSyncAt: string | null;
    productsInBase: number;
    authorizedInBase: number;
    configured: boolean;
  };
};

const SOURCE_LABEL =
  'Données issues de sources officielles (E-Phy — ANSES, jeu de données ouvert)';

/**
 * Un produit est-il autorisé ?
 *
 * L'ANSES écrit `AUTORISE`, `RETIRE`, et parfois des variantes accentuées selon
 * l'édition. On teste la racine, sans supposer la casse ni les accents.
 */
export function isAuthorizedStatus(status: string | null | undefined): boolean {
  return /autoris/i.test(status ?? '');
}

export async function getEphySourceInfo(): Promise<ProductSearchResponse['source']> {
  const [lastSync, productsInBase, authorizedInBase] = await Promise.all([
    getLastSuccessfulSync(),
    prisma.phytosanitaryProduct.count(),
    prisma.phytosanitaryProduct.count({
      where: { status: { contains: 'autoris', mode: 'insensitive' } },
    }),
  ]);

  return {
    label: SOURCE_LABEL,
    lastSyncAt: lastSync?.finishedAt?.toISOString() ?? null,
    productsInBase,
    authorizedInBase,
    configured: productsInBase > 0,
  };
}

/**
 * Recherche un produit par nom commercial, second nom ou numéro d'AMM.
 *
 * **Les produits retirés sont écartés par défaut.** Le catalogue officiel est
 * un historique : à l'édition du 8 septembre 2026, il compte 15 139 produits
 * dont 12 449 retirés du marché. Les lister comme les autres — ce que faisait
 * la version précédente — noyait les quelques produits utilisables sous une
 * majorité de produits qu'on n'a plus le droit d'appliquer, et donnait
 * l'impression d'un catalogue faux alors qu'il est simplement complet.
 *
 * On ne les supprime pas pour autant : un traitement enregistré en 2019 porte
 * légitimement sur un produit retiré depuis, et le registre doit rester
 * vérifiable. `includeWithdrawn` les fait réapparaître, et la réponse dit
 * toujours combien ont été écartés.
 */
export async function searchProducts(params: {
  query: string;
  /** Inclure les produits retirés du marché. Faux par défaut. */
  includeWithdrawn?: boolean;
  limit?: number;
}): Promise<ProductSearchResponse> {
  const source = await getEphySourceInfo();
  const query = params.query.trim();
  const limit = Math.min(params.limit ?? 20, 50);
  const vide = { results: [], total: 0, withdrawnHidden: 0, source };

  if (query.length < 2 || !source.configured) return vide;

  const normalized = normalizeSearchTerm(query);
  const isAmm = /^\d{6,10}$/.test(query.replace(/\s/g, ''));

  const matchQuery = isAmm
    ? { amm: { contains: query.replace(/\s/g, '') } }
    : {
        OR: [
          { normalizedName: { contains: normalized } },
          { name: { contains: query, mode: 'insensitive' as const } },
          { secondNames: { contains: query, mode: 'insensitive' as const } },
          { amm: { contains: query } },
        ],
      };

  const autorise = { status: { contains: 'autoris', mode: 'insensitive' as const } };
  const enAutorise = { AND: [matchQuery, autorise] };
  const enRetire = { AND: [matchQuery, { NOT: autorise }] };

  const inclure = {
    substances: { include: { substance: { select: { name: true } } } },
  } as const;

  const [nbAutorises, nbRetires, autorises] = await Promise.all([
    prisma.phytosanitaryProduct.count({ where: enAutorise }),
    prisma.phytosanitaryProduct.count({ where: enRetire }),
    prisma.phytosanitaryProduct.findMany({
      where: enAutorise,
      take: limit,
      orderBy: [{ name: 'asc' }],
      include: inclure,
    }),
  ]);

  // Les autorisés d'abord, en deux requêtes plutôt qu'un tri sur `status` :
  // classer « AUTORISE » avant « RETIRE » par ordre alphabétique marcherait
  // aujourd'hui et cesserait de marcher le jour où l'ANSES ajoute un état.
  const manquants = limit - autorises.length;
  const retires =
    params.includeWithdrawn && manquants > 0
      ? await prisma.phytosanitaryProduct.findMany({
          where: enRetire,
          take: manquants,
          orderBy: [{ name: 'asc' }],
          include: inclure,
        })
      : [];

  return {
    source,
    total: params.includeWithdrawn ? nbAutorises + nbRetires : nbAutorises,
    withdrawnHidden: params.includeWithdrawn ? 0 : nbRetires,
    results: [...autorises, ...retires].map(toHit),
  };
}

function toHit(p: {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  withdrawnAt: Date | null;
  formulation: string | null;
  productType: string | null;
  substances: Array<{ substance: { name: string } }>;
}): ProductSearchHit {
  return {
    id: p.id,
    amm: p.amm,
    name: p.name,
    holder: p.holder,
    status: p.status,
    authorized: isAuthorizedStatus(p.status),
    withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
    formulation: p.formulation,
    productType: p.productType,
    substances: p.substances.map((s) => s.substance.name),
  };
}

/** Fiche produit complète : toutes les valeurs proviennent de l'import officiel. */
export async function getProductDetail(idOrAmm: string) {
  const product = await prisma.phytosanitaryProduct.findFirst({
    where: { OR: [{ id: idOrAmm }, { amm: idOrAmm }] },
    include: {
      substances: {
        include: { substance: true },
        orderBy: { substance: { name: 'asc' } },
      },
      usages: { orderBy: [{ cropLabel: 'asc' }, { targetLabel: 'asc' }], take: 500 },
      conditions: { orderBy: [{ category: 'asc' }] },
    },
  });

  if (!product) return null;

  const source = await getEphySourceInfo();
  return { product, source };
}

/** Cultures autorisées distinctes pour un produit (issues des usages E-Phy). */
export async function getAuthorizedCrops(productId: string): Promise<string[]> {
  const rows = await prisma.phytoUsage.findMany({
    where: {
      productId,
      cropLabel: { not: null },
      status: { contains: 'autoris', mode: 'insensitive' },
    },
    select: { cropLabel: true },
    distinct: ['cropLabel'],
    orderBy: { cropLabel: 'asc' },
  });
  return rows.map((r) => r.cropLabel).filter((c): c is string => c !== null);
}

export type DrainedSoilRestriction = {
  category: string;
  label: string;
  severity: 'interdit' | 'a-verifier';
};

export type ProductUsagesResponse = {
  product: {
    id: string;
    amm: string;
    name: string;
    status: string | null;
    authorized: boolean;
    withdrawnAt: string | null;
  };
  /** Usages en vigueur, tels que publiés. */
  usages: UsageForDose[];
  /** Cultures distinctes couvertes par ces usages. */
  crops: string[];
  /** Conditions d'emploi visant les sols drainés, reprises mot pour mot. */
  drainedSoilRestrictions: DrainedSoilRestriction[];
  source: ProductSearchResponse['source'];
};

/**
 * Ce qu'il faut savoir d'un produit pour saisir un traitement : usages en
 * vigueur avec leurs doses et ZNT, cultures couvertes, restrictions de sol
 * drainé. Rien n'est calculé ici hormis le repérage des restrictions ; les
 * valeurs sont celles du catalogue.
 */
export async function getProductUsages(
  idOrAmm: string,
): Promise<ProductUsagesResponse | null> {
  const product = await prisma.phytosanitaryProduct.findFirst({
    where: { OR: [{ id: idOrAmm }, { amm: idOrAmm }] },
    include: {
      usages: {
        where: { status: { contains: 'autoris', mode: 'insensitive' } },
        orderBy: [{ cropLabel: 'asc' }, { targetLabel: 'asc' }],
        take: 800,
      },
      conditions: { where: { concernsDrainedSoil: true }, orderBy: { category: 'asc' } },
    },
  });

  if (!product) return null;

  const source = await getEphySourceInfo();
  const crops = [
    ...new Set(
      product.usages
        .map((u) => u.cropLabel)
        .filter((c): c is string => c !== null && c.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    source,
    crops,
    product: {
      id: product.id,
      amm: product.amm,
      name: product.name,
      status: product.status,
      authorized: isAuthorizedStatus(product.status),
      withdrawnAt: product.withdrawnAt?.toISOString() ?? null,
    },
    usages: product.usages.map((u) => ({
      id: u.id,
      cropLabel: u.cropLabel,
      targetLabel: u.targetLabel,
      usageLabel: u.usageLabel,
      doseValue: u.doseValue,
      doseUnit: u.doseUnit,
      status: u.status,
      preHarvestDelay: u.preHarvestDelay,
      maxApplications: u.maxApplications,
      minIntervalDays: u.minIntervalDays,
      zntAquaticM: u.zntAquaticM,
      zntArthropodM: u.zntArthropodM,
      zntPlantM: u.zntPlantM,
      conditions: u.conditions,
    })),
    drainedSoilRestrictions: product.conditions.map((c) => ({
      category: c.category,
      label: c.label,
      severity: drainedSoilSeverity(c.label),
    })),
  };
}
