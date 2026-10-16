import type { NextRequest } from 'next/server';
import { clientIp, route } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/rbac';
import { lirePiece, reponsePiece } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/** GET — pièce jointe d'une demande du compte connecté, et d'elle seule. */
export const GET = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAuth();
  const { id, pieceId } = await context.params;
  const piece = await lirePiece(
    { kind: 'requester', userId: auth.user.id },
    id ?? '',
    pieceId ?? '',
    clientIp(request),
  );
  return reponsePiece(piece);
});
