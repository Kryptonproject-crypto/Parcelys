'use client';

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }> | unknown;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = payload.code;
    this.fieldErrors = {};

    if (Array.isArray(payload.details)) {
      for (const detail of payload.details) {
        if (
          detail &&
          typeof detail === 'object' &&
          'field' in detail &&
          'message' in detail
        ) {
          const { field, message } = detail as { field: string; message: string };
          if (!this.fieldErrors[field]) this.fieldErrors[field] = message;
        }
      }
    }
  }
}

/**
 * Appel JSON de l'API interne. Les erreurs applicatives sont converties en
 * `ApiRequestError`, ce qui permet aux formulaires d'afficher les messages par
 * champ renvoyés par la validation Zod côté serveur.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'same-origin',
  });

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');

  if (!response.ok) {
    if (isJson) {
      const body = (await response.json().catch(() => null)) as
        | { error?: ApiErrorPayload }
        | null;
      throw new ApiRequestError(
        response.status,
        body?.error ?? { code: 'ERROR', message: 'Une erreur est survenue' },
      );
    }
    throw new ApiRequestError(response.status, {
      code: 'ERROR',
      message: `Erreur ${response.status}`,
    });
  }

  return (isJson ? await response.json() : (null as unknown)) as T;
}

export const apiPost = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiPut = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const apiDelete = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'DELETE',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
