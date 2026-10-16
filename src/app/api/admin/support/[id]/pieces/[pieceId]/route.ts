import type { NextRequest } from 'next/server';
import { clientIp, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { lirePiece, reponsePiece } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/** GET — pièce jointe d'une demande du périmètre (404 sinon), journalisée. */
export const GET = route(async (request: NextRequest, context: Ctx) => {
  const { scope } = await requireAdmin('support:read');
  const { id, pieceId } = await context.params;
  const piece = await lirePiece({ kind: 'admin', scope }, id ?? '', pieceId ?? '', clientIp(request));
  return reponsePiece(piece);
});
