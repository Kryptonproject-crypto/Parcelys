import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { ApiError, badRequest } from '@/lib/api/errors';
import { isAllowedMobileOrigin } from '@/lib/api/cors';
import {
  idempotencyContext,
  rememberResponse,
  replayedResponse,
} from '@/lib/api/idempotency';
import { getEnv } from '@/lib/env';
import { consumeRateLimit } from '@/lib/auth/rate-limit';

export type ApiHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse> | NextResponse;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Requête d'une application native, dépourvue de tout identifiant ambiant.
 *
 * La CSRF consiste à faire émettre par le navigateur d'une victime une requête
 * qu'il assortit automatiquement de ses identifiants. Le seul identifiant
 * ambiant de Parcelys est le cookie de session : une requête qui n'en porte pas
 * n'a rien à détourner, et l'attaque est structurellement impossible.
 *
 * L'application mobile est exactement dans ce cas — sa WebView est sur une
 * autre origine, elle n'a jamais reçu le cookie et présente son jeton dans
 * l'en-tête `Authorization` (sauf à la connexion, où elle n'en a pas encore).
 * L'origine doit tout de même figurer dans la liste CORS : une origine
 * quelconque reste refusée.
 */
function isCredentialFreeNativeRequest(request: NextRequest): boolean {
  if (request.cookies.has(getEnv().SESSION_COOKIE_NAME)) return false;
  return isAllowedMobileOrigin(request.headers.get('origin'));
}

/**
 * Défense CSRF : les cookies sont `SameSite=Lax`, ce qui bloque déjà les
 * requêtes POST inter-sites. On ajoute une vérification d'origine pour couvrir
 * les navigateurs anciens et les requêtes `fetch` forgées.
 */
function assertSameOrigin(request: NextRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  const origin = request.headers.get('origin');
  if (!origin) return; // requêtes non-navigateur (curl, tâches planifiées)

  // L'application native s'exécute sur l'origine de sa WebView
  // (`http://localhost`, `capacitor://localhost`) et n'a pas de cookie :
  // la vérification d'origine ne s'applique pas, la liste CORS fait foi.
  if (isCredentialFreeNativeRequest(request)) return;

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

/**
 * Adresse du visiteur, telle que le proxy de confiance la rapporte.
 *
 * Le détail compte, parce que cette valeur alimente la limitation de débit et
 * le journal d'audit : s'en remettre à une donnée que le visiteur contrôle
 * permettrait de contourner l'une et de fausser l'autre.
 *
 * `X-Forwarded-For` est une liste, et chaque intermédiaire **ajoute** l'adresse
 * de celui qui lui a parlé. Un visiteur qui envoie déjà l'en-tête voit donc sa
 * valeur conservée en tête, suivie de sa vraie adresse. C'est la **dernière**
 * entrée qui est digne de foi : elle a été écrite par notre propre proxy.
 *
 * Derrière Cloudflare, `CF-Connecting-IP` est plus sûr encore : Cloudflare
 * l'écrase à chaque requête, un visiteur ne peut donc pas le forger. D'où
 * `CLIENT_IP_HEADER=cf-connecting-ip` pour une instance derrière un tunnel.
 */
export function clientIp(request: NextRequest): string {
  const header = getEnv().CLIENT_IP_HEADER;
  const value = request.headers.get(header);

  if (value) {
    // Les en-têtes à valeur unique (`cf-connecting-ip`, `x-real-ip`) n'ont
    // qu'un élément ; découper reste sans effet sur eux.
    const hops = value.split(',');
    const trusted = hops[hops.length - 1]?.trim();
    if (trusted) return trusted;
  }

  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

/**
 * Enrobe un handler : CSRF, idempotence, mapping d'erreurs, réponse JSON
 * homogène.
 */
export function route(handler: ApiHandler): ApiHandler {
  return async (request, context) => {
    try {
      assertSameOrigin(request);

      // Rejeu d'une saisie faite hors ligne : si la réponse a déjà été
      // produite, on la renvoie sans repasser par la base.
      const idempotency = idempotencyContext(request);
      if (idempotency) {
        const replayed = await replayedResponse(idempotency);
        if (replayed) return replayed;

        return await rememberResponse(idempotency, await handler(request, context));
      }

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
