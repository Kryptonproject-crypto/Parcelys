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
  role: string;
  parcels: CachedParcel[];
  referential: Referential;
};

/** Type d'opération que la file d'attente sait rejouer. */
export type OperationKind =
  | 'parcel.create'
  | 'fertilization.create'
  | 'phyto.create'
  | 'operation.create';

export const OPERATION_LABELS: Record<OperationKind, string> = {
  'parcel.create': 'Nouvelle parcelle',
  'fertilization.create': 'Apport',
  'phyto.create': 'Traitement',
  'operation.create': 'Travail',
};

export type QueuedOperation = {
  /** Identifiant local, sert aussi de clé d'idempotence côté serveur. */
  clientId: string;
  kind: OperationKind;
  /** Parcelle visée ; pour une parcelle créée hors ligne, son `clientId`. */
  parcelId?: string;
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
};

export type Session = {
  serverUrl: string;
  token: string;
  expiresAt: string;
  email: string;
  firstName: string;
  lastName: string;
};
