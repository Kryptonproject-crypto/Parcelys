/**
 * Formes échangées avec l'API Parcelys.
 *
 * Volontairement redéclarées ici plutôt qu'importées du serveur : l'application
 * est empaquetée séparément, et un couplage au code serveur la rendrait
 * indéployable sans lui. Les champs suivent la réponse de
 * `GET /api/mobile/bootstrap`.
 */

export type Position = { lat: number; lng: number; accuracy?: number };

export type PolygonGeometry = {
  type: 'Polygon';
  /** Anneau extérieur fermé, en [lng, lat] comme le veut GeoJSON. */
  coordinates: Array<Array<[number, number]>>;
};

export type MultiPolygonGeometry = {
  type: 'MultiPolygon';
  coordinates: Array<Array<Array<[number, number]>>>;
};

export type CachedParcel = {
  id: string;
  name: string;
  internalNumber: string | null;
  commune: string | null;
  areaHa: number;
  status: string;
  cropName: string | null;
  /**
   * Sol artificiellement drainé. `null` = non renseigné, et non « non drainé » :
   * plusieurs produits interdisent l'application sur sol drainé, et supposer
   * l'absence de drainage tairait l'avertissement là où il manque.
   */
  drainedSoil: boolean | null;
  geometry: MultiPolygonGeometry | null;
};

export type Referential = {
  crops: Array<{ id: string; code: string; name: string; category: string | null }>;
  fertilizers: Array<{
    id: string;
    name: string;
    n: number | null;
    p: number | null;
    k: number | null;
  }>;
  organicInputs: Array<{
    id: string;
    name: string;
    n: number | null;
    p: number | null;
    k: number | null;
  }>;
  recentPhytoProducts: Array<{
    productName: string;
    amm: string | null;
    activeSubstances: string | null;
    lastDose: number;
    doseUnit: string;
  }>;
  doseUnits: string[];
  parcelTypes: string[];
  operationTypes: Array<{ value: string; label: string }>;
  /**
   * Couverts et modes de destruction, reçus du serveur.
   *
   * Facultatifs pour rester compatible avec un instantané pris par une version
   * antérieure : un appareil qui n'a pas encore resynchronisé doit continuer à
   * fonctionner, pas afficher une liste vide.
   */
  soilCoverKinds?: Array<{ value: string; label: string }>;
  coverDestructionMethods?: Array<{ value: string; label: string }>;
  /**
   * Lots phytosanitaires encore en stock.
   *
   * C'est au champ, le bidon en main, qu'on connaît le numéro de lot — pas au
   * bureau une semaine plus tard. C'est exactement ce qu'un contrôle demande :
   * quel lot sur quelle parcelle.
   */
  phytoLots?: Array<{
    id: string;
    itemId: string;
    itemName: string;
    lotNumber: string | null;
    amm: string | null;
    unit: string;
    reste: number;
    expiresOn: string | null;
  }>;
};

export type AccountType = 'FARMER' | 'AGRONOMIST';

/** Une exploitation accessible : la sienne, ou une du portefeuille de l'expert. */
export type PortfolioFarm = {
  id: string;
  name: string;
  role: string;
  /** `true` quand l'accès vient d'une mission de conseil (lecture seule). */
  advisory: boolean;
};

export type RecommendationStatus =
  | 'DRAFT'
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'APPLIED'
  | 'WITHDRAWN';

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  DRAFT: 'Brouillon',
  PROPOSED: 'En attente',
  ACCEPTED: 'Acceptée',
  DECLINED: 'Écartée',
  APPLIED: 'Réalisée',
  WITHDRAWN: 'Retirée',
};

export type RecommendationKind = 'PHYTO' | 'FERTILIZATION' | 'OPERATION' | 'OBSERVATION';

export const RECOMMENDATION_KIND_LABELS: Record<RecommendationKind, string> = {
  PHYTO: 'Traitement phytosanitaire',
  FERTILIZATION: 'Fertilisation',
  OPERATION: 'Travail',
  OBSERVATION: 'Observation',
};

export type RecommendationPriority = 'LOW' | 'NORMAL' | 'HIGH';

/**
 * Préconisation embarquée dans l'instantané.
 *
 * Sous-ensemble de ce que renvoie l'API : ce qui se lit et se décide au champ.
 * `productSource` dit d'où vient le produit cité — vérifié au catalogue E-Phy,
 * ou saisi par l'expert. L'application ne complète jamais cette information.
 */
export type CachedRecommendation = {
  id: string;
  farmId: string;
  parcelId: string | null;
  parcelName: string | null;
  kind: RecommendationKind;
  status: RecommendationStatus;
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  productName: string | null;
  amm: string | null;
  productSource: 'catalogue' | 'saisie' | null;
  dose: number | null;
  doseUnit: string | null;
  targetLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  author: { name: string; organization: string | null };
  createdAt: string;
  responseNote: string | null;
};

export type Snapshot = {
  syncedAt: string;
  campaignYear: number;
  farm: {
    id: string;
    name: string;
    city: string | null;
    department: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  accountType: AccountType;
  farms: PortfolioFarm[];
  role: string;
  /** `true` quand l'exploitation affichée est suivie, non détenue. */
  advisory: boolean;
  parcels: CachedParcel[];
  recommendations: CachedRecommendation[];
  referential: Referential;
};

/** Type d'opération que la file d'attente sait rejouer. */
export type OperationKind =
  | 'parcel.create'
  | 'fertilization.create'
  | 'phyto.create'
  | 'operation.create'
  | 'recommendation.create'
  | 'recommendation.respond'
  | 'soilCover.create';

export const OPERATION_LABELS: Record<OperationKind, string> = {
  'parcel.create': 'Nouvelle parcelle',
  'fertilization.create': 'Apport',
  'phyto.create': 'Traitement',
  'operation.create': 'Travail',
  'soilCover.create': 'Couvert d’interculture',
  'recommendation.create': 'Préconisation',
  'recommendation.respond': 'Réponse à une préconisation',
};

export type QueuedOperation = {
  /** Identifiant local, sert aussi de clé d'idempotence côté serveur. */
  clientId: string;
  kind: OperationKind;
  /** Parcelle visée ; pour une parcelle créée hors ligne, son `clientId`. */
  parcelId?: string;
  /** Exploitation visée, quand elle ne se déduit pas de la parcelle. */
  farmId?: string;
  /** Ressource visée quand ce n'est pas une parcelle (une préconisation). */
  targetId?: string;
  /** Résumé lisible, affiché dans la file d'attente. */
  label: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  /** Renseigné après un refus du serveur, pour que l'erreur soit visible. */
  lastError?: string;
  attempts: number;
};

export type SyncResult = {
  clientId: string;
  kind: string;
  status: 'applied' | 'replayed' | 'rejected';
  entityId?: string;
  httpStatus: number;
  message?: string;
  fieldErrors?: Array<{ field: string; message: string }>;
  /**
   * Avertissements réglementaires d'une saisie acceptée : surdosage, produit
   * retiré, sol drainé. Une saisie hors réseau n'a pas pu être contrôlée à la
   * frappe ; c'est ici qu'elle l'est.
   */
  warnings?: string[];
};

export type Session = {
  serverUrl: string;
  token: string;
  expiresAt: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Décide de l'écran d'accueil : parcellaire pour l'un, portefeuille pour l'autre. */
  accountType: AccountType;
};
