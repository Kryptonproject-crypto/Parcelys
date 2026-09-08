import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { hashToken } from '@/lib/auth/tokens';

/**
 * Idempotence des écritures.
 *
 * L'application mobile enregistre les saisies faites au champ, puis les rejoue
 * une fois le réseau revenu. Le cas gênant n'est pas la panne franche mais la
 * réponse perdue : l'écriture a eu lieu, le téléphone ne l'a pas su, et il
 * réessaie. Sans mémoire, chaque réessai créerait un doublon dans un registre
 * réglementaire.
 *
 * Le client joint donc un en-tête `Idempotency-Key` (un UUID par saisie). La
 * première exécution mémorise le corps de la réponse ; les rejeux le renvoient
 * tel quel, sans retoucher la base.
 *
 * La clé seule ne suffit pas à identifier une requête : elle est associée à
 * l'empreinte du jeton de session. Deux appareils ne peuvent donc pas se lire
 * mutuellement, même en présentant la même clé.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'Idempotency-Replayed';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_KEY_LENGTH = 200;

/**
 * Empreinte du porteur de la requête : le jeton de session, haché comme il
 * l'est déjà en base. Aucune requête supplémentaire n'est nécessaire.
 */
function ownerHash(request: NextRequest): string | null {
  const env = getEnv();
  const cookie = request.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  if (cookie) return hashToken(cookie);

  const authorization = request.headers.get('authorization');
  const [scheme, value] = authorization?.split(' ') ?? [];
  if (scheme?.toLowerCase() === 'bearer' && value) return hashToken(value.trim());

  return null;
}

export type IdempotencyContext = {
  key: string;
  ownerHash: string;
  method: string;
  path: string;
};

/** Clé exploitable, ou `null` si la requête n'est pas concernée. */
export function idempotencyContext(request: NextRequest): IdempotencyContext | null {
  if (!MUTATING.has(request.method)) return null;

  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;

  const owner = ownerHash(request);
  if (!owner) return null;

  return {
    key,
    ownerHash: owner,
    method: request.method,
    path: request.nextUrl.pathname,
  };
}

/** Réponse déjà produite pour cette clé, le cas échéant. */
export async function replayedResponse(
  context: IdempotencyContext,
): Promise<NextResponse | null> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: { key_ownerHash: { key: context.key, ownerHash: context.ownerHash } },
  });
  if (!record) return null;

  // Même clé sur une autre route : le client s'est trompé, et renvoyer la
  // réponse d'une autre opération serait pire que de refuser.
  if (record.method !== context.method || record.path !== context.path) {
    return NextResponse.json(
      {
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message:
            'Cette clé d’idempotence a déjà servi pour une autre opération.',
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json(record.responseBody, {
    status: record.status,
    headers: { [REPLAY_HEADER]: 'true' },
  });
}

/**
 * Mémorise la réponse d'une écriture réussie.
 *
 * Les échecs ne sont pas mémorisés : une saisie refusée pour cause de réseau
 * instable ou d'erreur passagère doit pouvoir être retentée. Seules les
 * réponses 2xx, qui ont modifié la base, méritent d'être figées.
 */
export async function rememberResponse(
  context: IdempotencyContext,
  response: NextResponse,
): Promise<NextResponse> {
  if (response.status < 200 || response.status >= 300) return response;

  // Le corps d'une `Response` ne se lit qu'une fois : on le clone pour pouvoir
  // à la fois le mémoriser et le renvoyer au client.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response; // réponse binaire (export, document) : hors du champ
  }

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: context.key,
        ownerHash: context.ownerHash,
        method: context.method,
        path: context.path,
        status: response.status,
        responseBody: body as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Deux rejeux simultanés : le second perd la course sur l'index unique.
    // L'écriture métier a bien eu lieu, la réponse est correcte, on continue.
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      console.error('[idempotency] mémorisation impossible', error);
    }
  }

  return response;
}

/** Purge : passé ce délai, un rejeu n'a plus de sens. */
export async function purgeIdempotencyRecords(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
