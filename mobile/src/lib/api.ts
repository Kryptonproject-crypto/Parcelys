import type {
  AccountType,
  CatalogUsage,
  Session,
  Snapshot,
  SyncResult,
} from './types';

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
  /** `delai` : le serveur a été joint mais n'a pas répondu à temps. */
  readonly motif: 'reseau' | 'delai';

  constructor(cause: 'reseau' | 'delai' = 'reseau') {
    super(cause === 'delai' ? 'Le serveur n’a pas répondu à temps.' : 'Serveur injoignable.');
    this.name = 'OfflineError';
    this.motif = cause;
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
    /** Délai propre à une requête longue, au-delà des 15 s ordinaires. */
    timeoutMs?: number;
    /**
     * Formulaire `multipart/form-data` (pièce jointe). Le navigateur pose
     * lui-même l'en-tête et sa frontière : on ne doit surtout pas l'écrire.
     */
    formData?: FormData;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = options.formData ? {} : { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (erreur) {
    // Aucune réponse : coupure réseau, DNS, serveur éteint, délai dépassé.
    throw new OfflineError(
      erreur instanceof DOMException && erreur.name === 'TimeoutError' ? 'delai' : 'reseau',
    );
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

/** Une couche réglementaire de la carte, sans ses géométries. */
export type CoucheCarte = {
  code: string;
  kind: string;
  label: string;
  color: string;
  source: { label: string; version: string; territory: string | null };
  rendues: number;
  total: number;
};

export type EntiteCarte = { type: 'Feature'; properties: unknown; geometry: unknown };

/**
 * Les couches réglementaires de l'exploitation — cours d'eau, zones
 * vulnérables, captages… — sans leurs géométries, et l'empreinte qui dit si
 * celles déjà enregistrées sur l'appareil sont encore à jour.
 */
export async function fetchCouchesCarte(
  session: Session,
  farmId: string,
): Promise<{ empreinte: string; couches: CoucheCarte[] }> {
  return request(session.serverUrl, `/api/regulatory/map-layers?farmId=${encodeURIComponent(farmId)}`, {
    token: session.token,
    // La première fois après une mise à jour, un Raspberry Pi met plusieurs
    // dizaines de secondes à préparer les couches ; ensuite, elles sont
    // gardées et la réponse est immédiate.
    timeoutMs: DELAI_COUCHES_MS,
  });
}

const DELAI_COUCHES_MS = 120_000;

/** Les géométries d'une couche. */
export async function fetchGeometriesCouche(
  session: Session,
  farmId: string,
  code: string,
): Promise<{ code: string; features: EntiteCarte[] }> {
  return request(
    session.serverUrl,
    `/api/regulatory/map-layers?farmId=${encodeURIComponent(farmId)}&couche=${encodeURIComponent(code)}`,
    { token: session.token, timeoutMs: DELAI_COUCHES_MS },
  );
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
  /**
   * Retiré : fin d'utilisation la plus tardive de ses usages (ISO) — il
   * s'emploie encore jusque-là. Absent d'un serveur antérieur à la 0.10.4.
   */
  finUtilisation?: string | null;
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
// `CatalogUsage` vit maintenant dans `types.ts` : il voyage dans l'instantané,
// pas seulement dans les réponses d'API. Réexporté ici pour ne rien casser.
export type { CatalogUsage } from './types';

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

// ---------------------------------------------------------------------------
// Compte et sécurité
//
// Ces routes sont exactement celles du web : mêmes règles, mêmes délais, mêmes
// messages. Une seconde implémentation « pour le mobile » finirait par diverger,
// et c'est toujours la moins stricte qui l'emporterait — sur le point le plus
// sensible du compte, l'identifiant de connexion.
// ---------------------------------------------------------------------------

export type EmailChangeState = {
  email: string;
  pending: { newEmail: string; expiresAt: string } | null;
};

/** La demande de changement d'adresse en cours, s'il y en a une. */
export async function fetchEmailChange(session: Session): Promise<EmailChangeState> {
  return request<EmailChangeState>(session.serverUrl, '/api/profile/email', {
    token: session.token,
  });
}

export type EmailChangeRequested = {
  newEmail: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  message: string;
};

/** Demande le changement : un code part vers la nouvelle adresse. */
export async function requestEmailChange(
  session: Session,
  newEmail: string,
  currentPassword: string,
): Promise<EmailChangeRequested> {
  return request<EmailChangeRequested>(session.serverUrl, '/api/profile/email', {
    method: 'POST',
    token: session.token,
    body: { newEmail, currentPassword },
  });
}

/** Confirme le changement avec le code reçu. */
export async function confirmEmailChange(
  session: Session,
  code: string,
): Promise<{ email: string; message: string }> {
  return request<{ email: string; message: string }>(session.serverUrl, '/api/profile/email', {
    method: 'PUT',
    token: session.token,
    body: { code },
  });
}

/** Abandonne la demande en cours. */
export async function cancelEmailChange(
  session: Session,
): Promise<{ cancelled: boolean; message: string }> {
  return request<{ cancelled: boolean; message: string }>(
    session.serverUrl,
    '/api/profile/email',
    { method: 'DELETE', token: session.token },
  );
}

/** Change le mot de passe. Les autres appareils sont déconnectés. */
export async function changePassword(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  return request<{ message: string }>(session.serverUrl, '/api/profile/password', {
    method: 'PUT',
    token: session.token,
    body: { currentPassword, newPassword, newPasswordConfirmation: newPassword },
  });
}

// ---------------------------------------------------------------------------
// Centre d'aide et support
// ---------------------------------------------------------------------------

export type { FaqCategorieVue } from '@commun/faq';

/** Le centre d'aide publié par le serveur (public : pas besoin de session). */
export async function fetchFaq(serverUrl: string): Promise<import('@commun/faq').FaqCategorieVue[]> {
  const r = await request<{ categories: import('@commun/faq').FaqCategorieVue[] }>(serverUrl, '/api/aide/faq');
  return r.categories;
}

export type SupportContext = {
  name: string;
  email: string;
  accountType: AccountType;
  technicianNumber: string | null;
  activeFarmId: string | null;
  farms: Array<{ id: string; name: string; customerNumber: string | null }>;
};

/** Nom, adresse et numéros clients du compte, pour préremplir le formulaire. */
export async function fetchSupportContext(session: Session): Promise<SupportContext> {
  return request<SupportContext>(session.serverUrl, '/api/support/contexte', { token: session.token });
}

/** Dépose une demande. Le serveur reprend nom, adresse et numéro de la session. */
export async function createSupportTicket(
  session: Session,
  form: FormData,
): Promise<{ message: string; number: string | null; id: string | null }> {
  return request(session.serverUrl, '/api/support/tickets', {
    method: 'POST',
    token: session.token,
    formData: form,
    timeoutMs: 60_000,
  });
}

export type SupportTicketSummary = {
  id: string;
  number: string;
  subject: string;
  status: import('@commun/support').StatutDemande;
  declaredNumber: string | null;
  createdAt: string;
  lastActivityAt: string;
};

export async function fetchMyTickets(session: Session): Promise<SupportTicketSummary[]> {
  const r = await request<{ tickets: SupportTicketSummary[] }>(session.serverUrl, '/api/support/tickets', {
    token: session.token,
  });
  return r.tickets;
}

export type SupportTicketDetail = SupportTicketSummary & {
  description: string;
  area: string | null;
  initialAttachments: Array<{ id: string; fileName: string; sizeBytes: number }>;
  messages: Array<{
    id: string;
    authorKind: 'REQUESTER' | 'STAFF';
    authorName: string;
    body: string;
    createdAt: string;
    attachments: Array<{ id: string; fileName: string; sizeBytes: number }>;
  }>;
};

export async function fetchMyTicket(session: Session, id: string): Promise<SupportTicketDetail> {
  const r = await request<{ ticket: SupportTicketDetail }>(
    session.serverUrl,
    `/api/support/tickets/${encodeURIComponent(id)}`,
    { token: session.token },
  );
  return r.ticket;
}

export async function replyToTicket(session: Session, id: string, form: FormData): Promise<void> {
  await request(session.serverUrl, `/api/support/tickets/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    token: session.token,
    formData: form,
    timeoutMs: 60_000,
  });
}
