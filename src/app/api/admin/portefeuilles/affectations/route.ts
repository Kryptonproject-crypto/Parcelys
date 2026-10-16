import type { NextRequest } from 'next/server';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { assignClients } from '@/lib/admin/portefeuilles';
import { assignmentSchema } from '@/lib/validation/admin';

/**
 * POST /api/admin/portefeuilles/affectations — attribue ou transfère des
 * clients (exploitations ou techniciens) vers un portefeuille.
 *
 * Administrateur général seul : un administrateur secondaire ne peut ni
 * s'attribuer un client, ni céder les siens. Chaque client déplacé laisse une
 * trace au journal, et ses demandes de support le suivent.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('clients:assign');
  const input = await parseBody(request, assignmentSchema);

  const result = await assignClients({
    actorId: auth.user.id,
    kind: input.kind,
    ids: input.ids,
    portfolioId: input.portfolioId,
    ipAddress: clientIp(request),
  });

  const quoi = input.kind === 'farm' ? 'exploitation(s)' : 'technicien(s)';
  return ok({
    ...result,
    message:
      result.moved === 0
        ? `Aucun changement : ${quoi} déjà dans ce portefeuille.`
        : `${result.moved} ${quoi} ${input.portfolioId ? 'attribué(s)' : 'retiré(s) de leur portefeuille'}` +
          (result.ticketsMoved ? `, ${result.ticketsMoved} demande(s) de support transférée(s).` : '.'),
  });
});
