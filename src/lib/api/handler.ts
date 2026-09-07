import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { ApiError, badRequest } from '@/lib/api/errors';
import { getEnv } from '@/lib/env';
import { consumeRateLimit } from '@/lib/auth/rate-limit';

export type ApiHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse> | NextResponse;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Défense CSRF : les cookies sont `SameSite=Lax`, ce qui bloque déjà les
 * requêtes POST inter-sites. On ajoute une vérification d'origine pour couvrir
 * les navigateurs anciens et les requêtes `fetch` forgées.
 */
function assertSameOrigin(request: NextRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  const origin = request.headers.get('origin');
  if (!origin) return; // requêtes non-navigateur (curl, tâches planifiées)

  const allowed = new Set<string>([new URL(getEnv().APP_URL).origin]);
  const host = request.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  if (!allowed.has(origin)) {
    throw new ApiError(403, 'Origine non autorisée', 'CSRF_BLOCKED');
  }
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** Enrobe un handler : CSRF, mapping d'erreurs, réponse JSON homogène. */
export function route(handler: ApiHandler): ApiHandler {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.code === 'RATE_LIMITED') {
      const details = error.details as { retryAfterSeconds?: number } | undefined;
      if (details?.retryAfterSeconds) {
        headers['Retry-After'] = String(details.retryAfterSeconds);
      }
    }
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status, headers },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Données invalides',
          details: error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'Cette valeur existe déjà' } },
        { status: 409 },
      );
    }
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } },
        { status: 404 },
      );
    }
  }

  console.error('[api] erreur non gérée', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } },
    { status: 500 },
  );
}

/**
 * Valide le corps JSON. Générique sur le schéma (et non sur son type de sortie)
 * afin de supporter les schémas à transformation — `date: string → Date`,
 * `parcelIds: "a,b" → string[]` — dont l'entrée diffère de la sortie.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<TypeOf<S>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw badRequest('Corps de requête JSON invalide');
  }
  return schema.parse(payload) as TypeOf<S>;
}

export function parseQuery<S extends ZodTypeAny>(
  request: NextRequest,
  schema: S,
): TypeOf<S> {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return schema.parse(params) as TypeOf<S>;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Applique une limite de débit ou lève une 429. */
export async function enforceRateLimit(
  key: string,
  preset: { limit: number; windowSeconds: number },
  message = 'Trop de requêtes, veuillez réessayer plus tard',
): Promise<void> {
  const result = await consumeRateLimit(key, preset.limit, preset.windowSeconds);
  if (!result.allowed) {
    throw new ApiError(429, message, 'RATE_LIMITED', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}
