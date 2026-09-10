import type { AccountType, Session, Snapshot, SyncResult } from './types';

/**
 * Client HTTP de l'API Parcelys.
 *
 * L'application n'est pas servie par le serveur : elle vit dans l'APK et
 * appelle une instance dont l'utilisateur donne l'adresse. L'authentification
 * se fait par jeton `Authorization: Bearer`, jamais par cookie — la WebView est
 * sur une autre origine et n'en recevrait aucun.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = {};

    if (Array.isArray(details)) {
      for (const detail of details) {
        if (detail && typeof detail === 'object' && 'field' in detail) {
          const { field, message: text } = detail as { field: string; message: string };
          this.fieldErrors[field] ??= text;
        }
      }
    }
  }
}

/** Panne réseau, serveur injoignable : la saisie part en file d'attente. */
export class OfflineError extends Error {
  constructor() {
    super('Serveur injoignable.');
    this.name = 'OfflineError';
  }
}

/** Au-delà, on considère le serveur injoignable plutôt que d'attendre. */
const TIMEOUT_MS = 15_000;

async function request<T>(
  serverUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Aucune réponse : coupure réseau, DNS, serveur éteint, délai dépassé.
    throw new OfflineError();
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'ERROR',
      error?.message ?? `Erreur ${response.status}`,
      error?.details,
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------

export type LoginResponse = {
  token: string;
  expiresAt: string;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    accountType: AccountType;
  };
};

export async function login(
  serverUrl: string,
  email: string,
  password: string,
  deviceName: string,
): Promise<Session> {
  const response = await request<LoginResponse>(serverUrl, '/api/auth/login', {
    method: 'POST',
    body: { email, password, client: 'native', deviceName },
  });

  return {
    serverUrl,
    token: response.token,
    expiresAt: response.expiresAt,
    email: response.user.email,
    firstName: response.user.firstName,
    lastName: response.user.lastName,
    // C'est le serveur qui tranche : le choix fait sur l'écran de connexion
    // n'est qu'une orientation, jamais une autorisation.
    accountType: response.user.accountType ?? 'FARMER',
  };
}

export async function logout(session: Session): Promise<void> {
  await request(session.serverUrl, '/api/auth/logout', {
    method: 'POST',
    body: {},
    token: session.token,
  }).catch(() => undefined); // la session locale est effacée dans tous les cas
}

/**
 * Instantané complet : tout ce qui doit rester consultable hors ligne.
 *
 * `farmId` désigne l'exploitation à embarquer. L'exploitant n'en a qu'une et
 * l'omet ; l'expert agronomique choisit celle de son portefeuille qu'il visite.
 */
export async function fetchSnapshot(
  session: Session,
  farmId?: string | null,
): Promise<Snapshot> {
  const query = farmId ? `?farmId=${encodeURIComponent(farmId)}` : '';
  return request<Snapshot>(session.serverUrl, `/api/mobile/bootstrap${query}`, {
    token: session.token,
  });
}

export type PushResponse = {
  syncedAt: string;
  applied: number;
  rejected: number;
  results: SyncResult[];
};

/** Envoie un lot de saisies hors ligne. */
export async function pushOperations(
  session: Session,
  operations: Array<{
    clientId: string;
    kind: string;
    parcelId?: string;
    farmId?: string;
    targetId?: string;
    capturedAt: string;
    payload: Record<string, unknown>;
  }>,
): Promise<PushResponse> {
  return request<PushResponse>(session.serverUrl, '/api/sync', {
    method: 'POST',
    body: { operations },
    token: session.token,
  });
}

export type VersionInfo = {
  server: string;
  latest: {
    version: string;
    name: string;
    publishedAt: string;
    url: string;
    apkUrl: string | null;
  } | null;
  checkedAt: string | null;
};

/**
 * Dernière version publiée, telle que l'instance la connaît.
 *
 * C'est le serveur qui interroge GitHub, pas le téléphone : l'application ne
 * contacte jamais d'autre hôte que l'instance de son exploitation.
 */
export async function fetchVersion(session: Session): Promise<VersionInfo | null> {
  try {
    return await request<VersionInfo>(session.serverUrl, '/api/mobile/version', {
      token: session.token,
    });
  } catch {
    // Une instance plus ancienne n'expose pas cette route, et l'absence de
    // réseau n'est pas une erreur : dans les deux cas, on n'affiche rien.
    return null;
  }
}

/** Vérifie que l'adresse pointe bien vers une instance Parcelys joignable. */
export async function ping(serverUrl: string): Promise<boolean> {
  try {
    await request(serverUrl, '/api/auth/session');
    return true;
  } catch (error) {
    // Une 401 est une bonne nouvelle : le serveur répond, il manque juste la
    // session. Seule une absence de réponse signale une mauvaise adresse.
    return error instanceof ApiError;
  }
}

// ---------------------------------------------------------------------------
// Catalogue E-Phy
// ---------------------------------------------------------------------------

/** Calqué sur `ProductSearchHit` du serveur : mêmes noms, mêmes types. */
export type CatalogProduct = {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  /** État d'autorisation tel qu'E-Phy le publie. Nul si le champ manque. */
  status: string | null;
  /** `status` désigne-t-il une autorisation en vigueur ? Calculé par le serveur. */
  authorized: boolean;
  /** Date de retrait publiée par l'ANSES, au format ISO. */
  withdrawnAt: string | null;
  formulation: string | null;
  productType: string | null;
  substances: string[];
};

export type CatalogSearch = {
  results: CatalogProduct[];
  total: number;
  /** Produits retirés écartés de la liste faute d'être demandés. */
  withdrawnHidden: number;
  source: {
    label: string;
    lastSyncAt: string | null;
    productsInBase: number;
    authorizedInBase: number;
    /** Faux tant qu'aucune synchronisation E-Phy n'a eu lieu. */
    configured: boolean;
  };
};

/** Calqué sur `UsageForDose` du serveur. */
export type CatalogUsage = {
  id: string;
  cropLabel: string | null;
  targetLabel: string | null;
  usageLabel: string | null;
  doseValue: string | null;
  doseUnit: string | null;
  status: string | null;
  preHarvestDelay: string | null;
  maxApplications: string | null;
  minIntervalDays: string | null;
  zntAquaticM: string | null;
  zntArthropodM: string | null;
  zntPlantM: string | null;
  conditions: string | null;
};

export type CatalogProductUsages = {
  product: {
    id: string;
    amm: string;
    name: string;
    status: string | null;
    authorized: boolean;
    withdrawnAt: string | null;
  };
  usages: CatalogUsage[];
  crops: string[];
  drainedSoilRestrictions: Array<{
    category: string;
    label: string;
    severity: 'interdit' | 'a-verifier';
  }>;
  source: CatalogSearch['source'];
};

/**
 * Recherche dans le catalogue officiel, servie par l'instance.
 *
 * Elle exige du réseau, et c'est assumé : le catalogue pèse plusieurs dizaines
 * de milliers de fiches, hors de question de l'embarquer dans le téléphone. Sans
 * réseau, la saisie libre reste possible — le produit sera simplement marqué
 * « non vérifié au catalogue », ce qui est la vérité.
 */
export async function searchCatalog(
  session: Session,
  query: string,
  includeWithdrawn = false,
): Promise<CatalogSearch> {
  const params = new URLSearchParams({ q: query, limit: '15' });
  if (includeWithdrawn) params.set('includeWithdrawn', 'true');
  return request<CatalogSearch>(
    session.serverUrl,
    `/api/phytosanitary/products?${params.toString()}`,
    { token: session.token },
  );
}

/**
 * Usages autorisés d'un produit : doses retenues, DAR, ZNT, sols drainés.
 *
 * Un seul appel, fait au moment où le produit est choisi. Le contrôle de dose
 * se fait ensuite dans le téléphone, sans réseau : au champ, la liaison peut
 * tomber entre le choix du produit et la saisie de la dose, et c'est justement
 * là que l'avertissement doit tenir.
 */
export async function fetchProductUsages(
  session: Session,
  productId: string,
): Promise<CatalogProductUsages> {
  return request<CatalogProductUsages>(
    session.serverUrl,
    `/api/phytosanitary/products/${encodeURIComponent(productId)}/usages`,
    { token: session.token },
  );
}

// ---------------------------------------------------------------------------
// Météo
// ---------------------------------------------------------------------------

export type InterventionWeather = {
  weatherTempC: number | null;
  weatherWindKmh: number | null;
  weatherHumidity: number | null;
  weatherRainMm: number | null;
  weatherSummary: string | null;
  weatherSource: string | null;
};

type WeatherResponse = {
  current: {
    temperatureC: number | null;
    windKmh: number | null;
    humidity: number | null;
    precipitationMm: number | null;
    summary: string | null;
  };
  provider: string;
};

/**
 * Conditions du moment sur la parcelle, à joindre à la saisie.
 *
 * Relevées **maintenant**, et non à la synchronisation : une file d'attente
 * peut partir des heures plus tard, et la météo d'alors ne serait pas celle de
 * l'intervention. Sans réseau, on ne relève rien — et surtout on n'invente
 * rien : la saisie part sans météo, ce que le registre indiquera.
 */
export async function captureWeather(
  session: Session,
  parcelId: string,
): Promise<InterventionWeather | null> {
  try {
    const data = await request<WeatherResponse>(
      session.serverUrl,
      `/api/weather?parcelId=${encodeURIComponent(parcelId)}`,
      { token: session.token },
    );
    return {
      weatherTempC: data.current.temperatureC,
      weatherWindKmh: data.current.windKmh,
      weatherHumidity: data.current.humidity,
      weatherRainMm: data.current.precipitationMm,
      weatherSummary: data.current.summary,
      weatherSource: data.provider,
    };
  } catch {
    // Hors réseau, parcelle non localisée, fournisseur muet : trois raisons de
    // n'avoir pas de météo, aucune de bloquer la saisie.
    return null;
  }
}
