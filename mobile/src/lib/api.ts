import type { Session, Snapshot, SyncResult } from './types';

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
  user: { firstName: string; lastName: string; email: string };
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
  };
}

export async function logout(session: Session): Promise<void> {
  await request(session.serverUrl, '/api/auth/logout', {
    method: 'POST',
    body: {},
    token: session.token,
  }).catch(() => undefined); // la session locale est effacée dans tous les cas
}

/** Instantané complet : tout ce qui doit rester consultable hors ligne. */
export async function fetchSnapshot(session: Session): Promise<Snapshot> {
  return request<Snapshot>(session.serverUrl, '/api/mobile/bootstrap', {
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
