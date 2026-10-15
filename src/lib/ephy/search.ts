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
  /**
   * Pour un produit retiré : la date de fin d'utilisation la plus tardive de
   * ses usages, au format ISO — le produit peut encore être appliqué jusque-là
   * (délai d'écoulement des stocks). `null` si l'ANSES n'en publie pas.
   */
  finUtilisation: string | null;
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
 * **Les produits retirés et devenus inutilisables sont écartés par défaut.**
 * Le catalogue officiel est un historique : à l'édition du 8 septembre 2026,
 * il compte 15 139 produits dont 12 449 retirés du marché. Les lister comme
 * les autres noyait les quelques produits utilisables sous une majorité de
 * produits qu'on n'a plus le droit d'appliquer.
 *
 * Trois exceptions, parce qu'elles correspondent à des produits qu'on a
 * réellement en main :
 *
 *   · un produit retiré **encore dans son délai d'écoulement** — l'ANSES
 *     publie, usage par usage, une date de fin d'utilisation ; tant qu'elle
 *     n'est pas passée, le bidon acheté avant le retrait s'emploie
 *     légalement. Il est proposé d'office, après les autorisés, avec sa date ;
 *   · une recherche par **numéro d'AMM exact** : on lit le numéro sur
 *     l'étiquette, le produit doit sortir, retiré ou non ;
 *   · `includeWithdrawn`, qui fait réapparaître tous les autres — un
 *     traitement enregistré en 2019 porte légitimement sur un produit retiré
 *     depuis.
 *
 * La réponse dit toujours combien de produits ont été écartés.
 */
export async function searchProducts(params: {
  query: string;
  /** Inclure les produits retirés du marché. Faux par défaut. */
  includeWithdrawn?: boolean;
  limit?: number;
  /** Date de référence du délai d'écoulement ; aujourd'hui par défaut. */
  at?: Date;
}): Promise<ProductSearchResponse> {
  const source = await getEphySourceInfo();
  const query = params.query.trim();
  const limit = Math.min(params.limit ?? 20, 50);
  const vide = { results: [], total: 0, withdrawnHidden: 0, source };

  if (query.length < 2 || !source.configured) return vide;

  const normalized = normalizeSearchTerm(query);
  const chiffres = query.replace(/\s/g, '');
  const isAmm = /^\d{6,10}$/.test(chiffres);

  const matchQuery = isAmm
    ? { amm: { contains: chiffres } }
    : {
        OR: [
          { normalizedName: { contains: normalized } },
          { name: { contains: query, mode: 'insensitive' as const } },
          { secondNames: { contains: query, mode: 'insensitive' as const } },
          { amm: { contains: query } },
        ],
      };

  const maintenant = params.at ?? new Date();
  const autorise = { status: { contains: 'autoris', mode: 'insensitive' as const } };
  const encoreUtilisable = { usages: { some: { endUsage: { gte: maintenant } } } };
  const enAutorise = { AND: [matchQuery, autorise] };
  const enDelai = { AND: [matchQuery, { NOT: autorise }, encoreUtilisable] };
  // Le numéro exact lu sur l'étiquette : retiré ou non, il sort.
  const ammExact = isAmm ? { amm: chiffres } : null;
  const enRetire = {
    AND: [
      matchQuery,
      { NOT: autorise },
      { NOT: encoreUtilisable },
      ...(params.includeWithdrawn || !ammExact ? [] : [ammExact]),
    ],
  };
  const montrerRetires = params.includeWithdrawn || Boolean(ammExact);

  const inclure = {
    substances: { include: { substance: { select: { name: true } } } },
    // La fin d'utilisation la plus tardive : jusqu'où le produit s'emploie.
    usages: {
      where: { endUsage: { not: null } },
      select: { endUsage: true },
      orderBy: { endUsage: 'desc' as const },
      take: 1,
    },
  } as const;

  const [nbAutorises, nbEnDelai, nbRetires, autorises] = await Promise.all([
    prisma.phytosanitaryProduct.count({ where: enAutorise }),
    prisma.phytosanitaryProduct.count({ where: enDelai }),
    prisma.phytosanitaryProduct.count({
      where: { AND: [matchQuery, { NOT: autorise }, { NOT: encoreUtilisable }] },
    }),
    prisma.phytosanitaryProduct.findMany({
      where: enAutorise,
      take: limit,
      orderBy: [{ name: 'asc' }],
      include: inclure,
    }),
  ]);

  // Les autorisés d'abord, puis les retirés encore utilisables, puis les
  // autres retirés s'ils sont demandés — en requêtes séparées plutôt qu'un tri
  // sur `status`, qui cesserait de marcher le jour où l'ANSES ajoute un état.
  const enDelaiTrouves =
    limit - autorises.length > 0
      ? await prisma.phytosanitaryProduct.findMany({
          where: enDelai,
          take: limit - autorises.length,
          orderBy: [{ name: 'asc' }],
          include: inclure,
        })
      : [];
  const reste = limit - autorises.length - enDelaiTrouves.length;
  const retires =
    montrerRetires && reste > 0
      ? await prisma.phytosanitaryProduct.findMany({
          where: enRetire,
          take: reste,
          orderBy: [{ name: 'asc' }],
          include: inclure,
        })
      : [];
  const retiresMontres = params.includeWithdrawn
    ? nbRetires
    : ammExact
      ? await prisma.phytosanitaryProduct.count({ where: enRetire })
      : 0;

  return {
    source,
    total: nbAutorises + nbEnDelai + retiresMontres,
    withdrawnHidden: nbRetires - retiresMontres,
    results: [...autorises, ...enDelaiTrouves, ...retires].map(toHit),
  };
}

export function toHit(p: {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  withdrawnAt: Date | null;
  formulation: string | null;
  productType: string | null;
  substances: Array<{ substance: { name: string } }>;
  /** Les usages portant une fin d'utilisation, la plus tardive en tête. */
  usages?: Array<{ endUsage: Date | null }>;
}): ProductSearchHit {
  const autorise = isAuthorizedStatus(p.status);
  const fin = p.usages?.map((u) => u.endUsage).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    id: p.id,
    amm: p.amm,
    name: p.name,
    holder: p.holder,
    status: p.status,
    authorized: autorise,
    withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
    finUtilisation: autorise ? null : (fin?.toISOString() ?? null),
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
  /** Date de référence du délai d'écoulement ; aujourd'hui par défaut. */
  at: Date = new Date(),
): Promise<ProductUsagesResponse | null> {
  const product = await prisma.phytosanitaryProduct.findFirst({
    where: { OR: [{ id: idOrAmm }, { amm: idOrAmm }] },
    include: {
      usages: {
        // Les usages en vigueur, et ceux d'un produit retiré encore dans leur
        // délai d'écoulement : jusqu'à leur fin d'utilisation, ils
        // s'appliquent légalement, avec leur dose et leurs ZNT. Sans eux, un
        // produit retiré mais utilisable n'avait plus ni culture ni dose.
        where: {
          OR: [
            { status: { contains: 'autoris', mode: 'insensitive' } },
            { endUsage: { gte: at } },
          ],
        },
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
      // La fin d'utilisation : c'est elle qui dit, à la date du traitement, si
      // l'usage d'un produit retiré vaut encore.
      endUsage: u.endUsage?.toISOString() ?? null,
    })),
    drainedSoilRestrictions: product.conditions.map((c) => ({
      category: c.category,
      label: c.label,
      severity: drainedSoilSeverity(c.label),
    })),
  };
}
