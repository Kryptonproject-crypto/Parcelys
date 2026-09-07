export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, 'BAD_REQUEST', details);

export const notFound = (message = 'Ressource introuvable') =>
  new ApiError(404, message, 'NOT_FOUND');

export const conflict = (message: string) =>
  new ApiError(409, message, 'CONFLICT');

export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new ApiError(429, message, 'RATE_LIMITED', { retryAfterSeconds });
