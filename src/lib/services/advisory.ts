import 'server-only';
import type {
  Prisma,
  RecommendationKind,
  RecommendationStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, badRequest, conflict, notFound } from '@/lib/api/errors';
import { STATUS_LABELS } from '@/lib/services/advisory.shared';
import { createNotification, notifyFarmMembers } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';

/**
 * Conseil agronomique : portefeuille de l'expert et cycle de vie des
 * préconisations.
 *
 * Une préconisation n'est pas une saisie de registre. C'est l'avis d'un tiers,
 * que l'exploitant reste libre de suivre ou d'écarter, et dont la trace doit
 * survivre à la décision : qui a conseillé quoi, sur quelle justification, et
 * ce qui en a été fait. Rien n'est supprimé, tout change d'état.
 */

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/**
 * Transitions autorisées. Une machine à états explicite, plutôt que des
 * conditions dispersées dans les routes : c'est ce qui garantit qu'une
 * préconisation déjà appliquée ne redevient pas un brouillon.
 */
const TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  DRAFT: ['PROPOSED', 'WITHDRAWN'],
  PROPOSED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: ['APPLIED', 'DECLINED'],
  DECLINED: ['PROPOSED'],
  APPLIED: [],
  WITHDRAWN: ['PROPOSED'],
};

export function canTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
): void {
  if (!canTransition(from, to)) {
    throw conflict(
      `Une préconisation « ${STATUS_LABELS[from]} » ne peut pas passer à « ${STATUS_LABELS[to]} ».`,
    );
  }
}

export {
  KIND_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from '@/lib/services/advisory.shared';
export type { RecommendationView } from '@/lib/services/advisory.shared';

// ---------------------------------------------------------------------------
// Portefeuille
// ---------------------------------------------------------------------------

export type PortfolioFarm = {
  farmId: string;
  farmName: string;
  city: string | null;
  department: string | null;
  startedAt: string;
  parcels: number;
  areaHa: number;
  /** Préconisations de cet expert encore en attente de décision. */
  pending: number;
  /** Dernier traitement enregistré, pour situer l'activité de l'exploitation. */
  lastPhytoAt: string | null;
};

export async function listPortfolio(expertId: string): Promise<PortfolioFarm[]> {
  const engagements = await prisma.advisoryEngagement.findMany({
    where: { status: 'ACTIVE', expert: { id: expertId }, farm: { deletedAt: null } },
    include: {
      farm: {
        select: {
          id: true,
          name: true,
          city: true,
          department: true,
          parcels: { where: { deletedAt: null }, select: { areaHa: true } },
        },
      },
    },
    orderBy: { farm: { name: 'asc' } },
  });

  if (engagements.length === 0) return [];

  const farmIds = engagements.map((e) => e.farmId);

  const [pendingCounts, lastTreatments] = await Promise.all([
    prisma.recommendation.groupBy({
      by: ['farmId'],
      where: { farmId: { in: farmIds }, authorId: expertId, status: 'PROPOSED' },
      _count: { _all: true },
    }),
    prisma.phytosanitaryApplication.findMany({
      where: { parcel: { farmId: { in: farmIds } } },
      select: { appliedOn: true, parcel: { select: { farmId: true } } },
      orderBy: { appliedOn: 'desc' },
      take: 200,
    }),
  ]);

  const pendingByFarm = new Map(
    pendingCounts.map((row) => [row.farmId, row._count._all]),
  );
  const lastByFarm = new Map<string, Date>();
  for (const treatment of lastTreatments) {
    const farmId = treatment.parcel.farmId;
    if (!lastByFarm.has(farmId)) lastByFarm.set(farmId, treatment.appliedOn);
  }

  return engagements.map((engagement) => ({
    farmId: engagement.farmId,
    farmName: engagement.farm.name,
    city: engagement.farm.city,
    department: engagement.farm.department,
    startedAt: engagement.startedAt.toISOString(),
    parcels: engagement.farm.parcels.length,
    areaHa: engagement.farm.parcels.reduce((sum, p) => sum + Number(p.areaHa), 0),
    pending: pendingByFarm.get(engagement.farmId) ?? 0,
    lastPhytoAt: lastByFarm.get(engagement.farmId)?.toISOString() ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Lecture des préconisations
// ---------------------------------------------------------------------------

const RECOMMENDATION_INCLUDE = {
  parcel: { select: { id: true, name: true, areaHa: true } },
  author: {
    select: { id: true, firstName: true, lastName: true, organization: true },
  },
  respondedBy: { select: { firstName: true, lastName: true } },
  farm: { select: { id: true, name: true } },
  ephyProduct: { select: { id: true, name: true, amm: true, status: true } },
} satisfies Prisma.RecommendationInclude;

type RecommendationRow = Prisma.RecommendationGetPayload<{
  include: typeof RECOMMENDATION_INCLUDE;
}>;

export function serializeRecommendation(row: RecommendationRow) {
  return {
    id: row.id,
    farmId: row.farmId,
    farmName: row.farm.name,
    parcelId: row.parcelId,
    parcelName: row.parcel?.name ?? null,
    parcelAreaHa: row.parcel ? Number(row.parcel.areaHa) : null,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    title: row.title,
    rationale: row.rationale,
    productName: row.productName,
    amm: row.amm,
    dose: row.dose === null ? null : Number(row.dose),
    doseUnit: row.doseUnit,
    targetLabel: row.targetLabel,
    windowStart: row.windowStart?.toISOString() ?? null,
    windowEnd: row.windowEnd?.toISOString() ?? null,
    /**
     * Provenance du produit cité, affichée telle quelle dans l'interface.
     * `catalogue` : l'AMM correspond à un produit du catalogue officiel
     * importé. `saisie` : rien ne l'a confirmée — l'exploitant doit le savoir.
     */
    productSource: row.ephyProduct
      ? ('catalogue' as const)
      : row.productName
        ? ('saisie' as const)
        : null,
    ephyProduct: row.ephyProduct
      ? {
          id: row.ephyProduct.id,
          name: row.ephyProduct.name,
          amm: row.ephyProduct.amm,
          status: row.ephyProduct.status,
        }
      : null,
    author: {
      id: row.author.id,
      name: `${row.author.firstName} ${row.author.lastName}`,
      organization: row.author.organization,
    },
    respondedBy: row.respondedBy
      ? `${row.respondedBy.firstName} ${row.respondedBy.lastName}`
      : null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseNote: row.responseNote,
    appliedPhytoId: row.appliedPhytoId,
    appliedFertilizationId: row.appliedFertilizationId,
    appliedOperationId: row.appliedOperationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type RecommendationFilter = {
  farmId?: string;
  parcelId?: string;
  /** Restreint aux préconisations rédigées par cet expert. */
  authorId?: string;
  status?: RecommendationStatus[];
  /**
   * Masque les brouillons d'autrui. Toujours vrai côté exploitant : un
   * brouillon n'a pas encore été transmis, il ne doit pas fuiter.
   */
  visibleToFarmOnly?: boolean;
  take?: number;
};

export async function listRecommendations(filter: RecommendationFilter) {
  const where: Prisma.RecommendationWhereInput = {
    ...(filter.farmId ? { farmId: filter.farmId } : {}),
    ...(filter.parcelId ? { parcelId: filter.parcelId } : {}),
    ...(filter.authorId ? { authorId: filter.authorId } : {}),
    ...(filter.status?.length ? { status: { in: filter.status } } : {}),
    ...(filter.visibleToFarmOnly ? { status: { not: 'DRAFT' } } : {}),
  };

  const rows = await prisma.recommendation.findMany({
    where,
    include: RECOMMENDATION_INCLUDE,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: filter.take ?? 200,
  });

  return rows.map(serializeRecommendation);
}

/**
 * Charge une préconisation en garantissant qu'elle relève bien d'une
 * exploitation accessible au compte. Un identifiant étranger renvoie 404.
 */
export async function loadRecommendation(
  id: string,
  farmIds: string[],
): Promise<RecommendationRow> {
  const row = await prisma.recommendation.findFirst({
    where: { id, farmId: { in: farmIds } },
    include: RECOMMENDATION_INCLUDE,
  });
  if (!row) throw notFound('Préconisation introuvable');
  return row;
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/**
 * Rattache le produit cité au catalogue officiel, si l'AMM y correspond.
 *
 * Aucune donnée n'est complétée à partir du catalogue : la correspondance sert
 * uniquement à dire à l'exploitant si le produit a pu être vérifié. Parcelys
 * n'invente ni dose, ni usage, ni autorisation.
 */
export async function resolveEphyProduct(
  amm: string | null | undefined,
): Promise<string | null> {
  const normalized = amm?.trim();
  if (!normalized) return null;

  const product = await prisma.phytosanitaryProduct.findFirst({
    where: { amm: normalized },
    select: { id: true },
  });
  return product?.id ?? null;
}

/** Une parcelle, si elle est bien de l'exploitation visée. */
export async function assertParcelInFarm(
  parcelId: string | null | undefined,
  farmId: string,
): Promise<string | null> {
  if (!parcelId) return null;
  const parcel = await prisma.parcel.findFirst({
    where: { id: parcelId, farmId, deletedAt: null },
    select: { id: true },
  });
  if (!parcel) throw badRequest('Parcelle inconnue pour cette exploitation.');
  return parcel.id;
}

/**
 * Une préconisation phytosanitaire nomme forcément un produit et une dose : le
 * conseil « traitez » sans dire quoi ni combien n'est pas exploitable, et
 * finirait recopié de travers dans un registre.
 */
export function assertPhytoComplete(input: {
  kind: RecommendationKind;
  productName?: string | null;
  dose?: number | null;
  doseUnit?: string | null;
}): void {
  if (input.kind !== 'PHYTO') return;
  const details: Array<{ field: string; message: string }> = [];
  if (!input.productName?.trim()) {
    details.push({ field: 'productName', message: 'Produit requis' });
  }
  if (input.dose === null || input.dose === undefined) {
    details.push({ field: 'dose', message: 'Dose requise' });
  }
  if (!input.doseUnit) {
    details.push({ field: 'doseUnit', message: 'Unité requise' });
  }
  if (details.length > 0) {
    throw new ApiError(400, 'Données invalides', 'VALIDATION_ERROR', details);
  }
}

/** Prévient l'exploitation qu'une préconisation lui est transmise. */
export async function notifyProposed(row: RecommendationRow): Promise<void> {
  const author = `${row.author.firstName} ${row.author.lastName}`;
  await notifyFarmMembers({
    farmId: row.farmId,
    type: 'RECOMMENDATION',
    title: `Préconisation : ${row.title}`,
    body:
      `${author}${row.author.organization ? ` (${row.author.organization})` : ''} ` +
      `vous transmet une préconisation${row.parcel ? ` sur ${row.parcel.name}` : ''}.`,
    link: `/preconisations?id=${row.id}`,
    alsoEmail: row.priority === 'HIGH',
  });
}

/** Prévient l'expert de la décision de l'exploitation. */
export async function notifyResponded(
  row: RecommendationRow,
  status: RecommendationStatus,
): Promise<void> {
  await createNotification({
    userId: row.authorId,
    farmId: row.farmId,
    type: 'RECOMMENDATION',
    title: `Préconisation ${STATUS_LABELS[status].toLowerCase()} : ${row.title}`,
    body: `${row.farm.name} a répondu à votre préconisation.`,
    link: `/portefeuille/${row.farmId}/preconisations`,
  });
}

export async function auditRecommendation(params: {
  action: 'recommendation.created' | 'recommendation.updated'
    | 'recommendation.proposed' | 'recommendation.responded'
    | 'recommendation.applied' | 'recommendation.withdrawn';
  userId: string;
  row: { id: string; farmId: string; title: string };
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  await logAudit({
    action: params.action,
    userId: params.userId,
    farmId: params.row.farmId,
    entity: 'Recommendation',
    entityId: params.row.id,
    ipAddress: params.ipAddress,
    metadata: { title: params.row.title, ...params.metadata },
  });
}
