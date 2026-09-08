/**
 * Libellés et types du conseil agronomique, utilisables des deux côtés.
 *
 * `advisory.ts` importe `server-only` : les composants clients — la liste des
 * préconisations, le formulaire de rédaction — ont pourtant besoin des mêmes
 * libellés. Tout ce qui touche à la base et aux notifications reste côté
 * serveur.
 */

export type RecommendationKind =
  | 'PHYTO'
  | 'FERTILIZATION'
  | 'OPERATION'
  | 'OBSERVATION';

export type RecommendationStatus =
  | 'DRAFT'
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'APPLIED'
  | 'WITHDRAWN';

export type RecommendationPriority = 'LOW' | 'NORMAL' | 'HIGH';

export const STATUS_LABELS: Record<RecommendationStatus, string> = {
  DRAFT: 'Brouillon',
  PROPOSED: 'En attente',
  ACCEPTED: 'Acceptée',
  DECLINED: 'Écartée',
  APPLIED: 'Réalisée',
  WITHDRAWN: 'Retirée',
};

export const KIND_LABELS: Record<RecommendationKind, string> = {
  PHYTO: 'Traitement phytosanitaire',
  FERTILIZATION: 'Apport de fertilisant',
  OPERATION: 'Travail',
  OBSERVATION: 'Observation',
};

export const PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Urgente',
};

/**
 * Vue d'une préconisation telle que l'API la renvoie.
 *
 * `productSource` mérite un mot : `catalogue` signifie que l'AMM saisie par
 * l'expert correspond à un produit du catalogue officiel E-Phy importé sur
 * l'instance ; `saisie` que rien ne l'a confirmée. L'interface l'affiche
 * toujours — un exploitant doit savoir ce qui est vérifié et ce qui ne l'est
 * pas avant de reporter un traitement dans son registre.
 */
export type RecommendationView = {
  id: string;
  farmId: string;
  farmName: string;
  parcelId: string | null;
  parcelName: string | null;
  parcelAreaHa: number | null;
  kind: RecommendationKind;
  status: RecommendationStatus;
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  productName: string | null;
  amm: string | null;
  dose: number | null;
  doseUnit: string | null;
  targetLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  productSource: 'catalogue' | 'saisie' | null;
  ephyProduct: {
    id: string;
    name: string;
    amm: string;
    /** État d'autorisation tel qu'il figure au catalogue officiel. */
    status: string | null;
  } | null;
  author: { id: string; name: string; organization: string | null };
  respondedBy: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  appliedPhytoId: string | null;
  appliedFertilizationId: string | null;
  appliedOperationId: string | null;
  createdAt: string;
  updatedAt: string;
};
