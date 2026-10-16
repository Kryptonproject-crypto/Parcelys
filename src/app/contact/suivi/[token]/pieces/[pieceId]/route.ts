import type { NextRequest } from 'next/server';
import { clientIp, enforceRateLimit, route } from '@/lib/api/handler';
import { lirePiece, reponsePiece, ticketIdParLien } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * GET — pièce jointe d'une demande anonyme, par son lien de suivi. Le jeton
 * ne donne accès qu'aux pièces de **sa** demande, hors notes internes.
 */
export const GET = route(async (request: NextRequest, context: Ctx) => {
  const ip = clientIp(request);
  await enforceRateLimit(`support:suivi:${ip}`, { limit: 60, windowSeconds: 3600 });
  const { token, pieceId } = await context.params;
  const ticketId = await ticketIdParLien(decodeURIComponent(token ?? ''));
  const piece = await lirePiece({ kind: 'token', ticketId }, ticketId, pieceId ?? '', ip);
  const response = reponsePiece(piece);
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
});
