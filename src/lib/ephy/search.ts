import 'server-only';
import { prisma } from '@/lib/prisma';
import { normalizeSearchTerm } from '@/lib/ephy/schema';
import { getLastSuccessfulSync } from '@/lib/ephy/import';

export type ProductSearchHit = {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  formulation: string | null;
  productType: string | null;
  substances: string[];
};

export type ProductSearchResponse = {
  results: ProductSearchHit[];
  total: number;
  /** Métadonnées de provenance, affichées systématiquement dans l'interface. */
  source: {
    label: string;
    lastSyncAt: string | null;
    productsInBase: number;
    configured: boolean;
  };
};

const SOURCE_LABEL =
  'Données issues de sources officielles (E-Phy — ANSES, jeu de données ouvert)';

export async function getEphySourceInfo(): Promise<ProductSearchResponse['source']> {
  const [lastSync, productsInBase] = await Promise.all([
    getLastSuccessfulSync(),
    prisma.phytosanitaryProduct.count(),
  ]);

  return {
    label: SOURCE_LABEL,
    lastSyncAt: lastSync?.finishedAt?.toISOString() ?? null,
    productsInBase,
    configured: productsInBase > 0,
  };
}

/**
 * Recherche un produit par nom commercial, second nom ou numéro d'AMM.
 *
 * Si aucune synchronisation E-Phy n'a été réalisée, la base est vide : la
 * réponse le signale explicitement plutôt que de proposer des résultats
 * approximatifs.
 */
export async function searchProducts(params: {
  query: string;
  onlyAuthorized?: boolean;
  limit?: number;
}): Promise<ProductSearchResponse> {
  const source = await getEphySourceInfo();
  const query = params.query.trim();
  const limit = Math.min(params.limit ?? 20, 50);

  if (query.length < 2 || !source.configured) {
    return { results: [], total: 0, source };
  }

  const normalized = normalizeSearchTerm(query);
  const isAmm = /^\d{6,10}$/.test(query.replace(/\s/g, ''));

  const where = {
    AND: [
      isAmm
        ? { amm: { contains: query.replace(/\s/g, '') } }
        : {
            OR: [
              { normalizedName: { contains: normalized } },
              { name: { contains: query, mode: 'insensitive' as const } },
              { secondNames: { contains: query, mode: 'insensitive' as const } },
              { amm: { contains: query } },
            ],
          },
      ...(params.onlyAuthorized
        ? [{ status: { contains: 'Autoris', mode: 'insensitive' as const } }]
        : []),
    ],
  };

  const [total, products] = await Promise.all([
    prisma.phytosanitaryProduct.count({ where }),
    prisma.phytosanitaryProduct.findMany({
      where,
      take: limit,
      orderBy: [{ name: 'asc' }],
      include: {
        substances: { include: { substance: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    total,
    source,
    results: products.map((p) => ({
      id: p.id,
      amm: p.amm,
      name: p.name,
      holder: p.holder,
      status: p.status,
      formulation: p.formulation,
      productType: p.productType,
      substances: p.substances.map((s) => s.substance.name),
    })),
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
    },
  });

  if (!product) return null;

  const source = await getEphySourceInfo();
  return { product, source };
}

/** Cultures autorisées distinctes pour un produit (issues des usages E-Phy). */
export async function getAuthorizedCrops(productId: string): Promise<string[]> {
  const rows = await prisma.phytoUsage.findMany({
    where: { productId, cropLabel: { not: null } },
    select: { cropLabel: true },
    distinct: ['cropLabel'],
    orderBy: { cropLabel: 'asc' },
  });
  return rows.map((r) => r.cropLabel).filter((c): c is string => c !== null);
}
