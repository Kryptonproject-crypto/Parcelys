import { z } from 'zod';

/**
 * Opérations qu'une application hors ligne peut mettre en file d'attente.
 *
 * La liste est fermée, et c'est délibéré : `/api/sync` rejoue de vraies routes
 * de l'API, et une liste ouverte en ferait un tunnel vers n'importe quel point
 * d'entrée. Seules les saisies du terrain y figurent — créer, jamais supprimer.
 */
export const SYNC_OPERATION_KINDS = [
  'parcel.create',
  'fertilization.create',
  'phyto.create',
  'operation.create',
  /** Préconisation rédigée par l'expert au champ, transmise au retour du réseau. */
  'recommendation.create',
  /** Réponse de l'exploitation à une préconisation reçue. */
  'recommendation.respond',
] as const;

export type SyncOperationKind = (typeof SYNC_OPERATION_KINDS)[number];

export const syncOperationSchema = z.object({
  /** Identifiant produit par l'appareil : sert de clé d'idempotence. */
  clientId: z.string().trim().min(8, 'Identifiant client requis').max(120),
  kind: z.enum(SYNC_OPERATION_KINDS),
  /** Parcelle concernée — requise pour tout ce qui n'est pas sa création. */
  parcelId: z.string().trim().max(40).optional(),
  /**
   * Exploitation visée, quand elle ne se déduit pas de la parcelle : l'expert
   * travaille sur plusieurs portefeuilles depuis une même session.
   */
  farmId: z.string().trim().max(40).optional(),
  /** Ressource visée quand ce n'est pas une parcelle (une préconisation). */
  targetId: z.string().trim().max(40).optional(),
  /** Horodatage de la saisie sur le terrain, à titre indicatif. */
  capturedAt: z.string().datetime().optional(),
  payload: z.record(z.unknown()),
});

export const syncPushSchema = z.object({
  /** Lot borné : une file plus longue est envoyée en plusieurs fois. */
  operations: z.array(syncOperationSchema).min(1).max(50),
});

export const syncPullSchema = z.object({
  since: z.string().datetime().optional(),
});

export type SyncOperationInput = z.infer<typeof syncOperationSchema>;
