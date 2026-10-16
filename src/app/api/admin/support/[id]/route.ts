import type { NextRequest } from 'next/server';
import type { SupportTicketStatus } from '@prisma/client';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { staffTicketActionSchema } from '@/lib/validation/support';
import { attribuer, changerStatut, chargerDemandeAdmin, transferer } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/** GET /api/admin/support/:id — une demande du périmètre (404 sinon). */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const { scope } = await requireAdmin('support:read');
  const { id } = await context.params;
  return ok({ ticket: await chargerDemandeAdmin(scope, id ?? '') });
});

/**
 * PATCH /api/admin/support/:id — changer le statut, attribuer, transférer.
 *
 * Statut et attribution : général et secondaire, dans leur périmètre ; on
 * n'attribue qu'à quelqu'un qui gère le portefeuille de la demande.
 * Transfert vers un autre portefeuille : le général seul.
 */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  let auth = await requireAdmin('support:manage');
  const { id } = await context.params;
  const input = await parseBody(request, staffTicketActionSchema);
  const ip = clientIp(request);

  switch (input.action) {
    case 'status':
      await changerStatut({ scope: auth.scope, ticketId: id ?? '', status: input.status as SupportTicketStatus, ipAddress: ip });
      return ok({ message: 'Statut mis à jour.' });
    case 'assign':
      await attribuer({ scope: auth.scope, ticketId: id ?? '', assigneeId: input.assigneeId, ipAddress: ip });
      return ok({ message: input.assigneeId ? 'Demande attribuée.' : 'Attribution retirée.' });
    case 'transfer':
      auth = await requireAdmin('support:transfer');
      await transferer({ scope: auth.scope, ticketId: id ?? '', portfolioId: input.portfolioId, ipAddress: ip });
      return ok({ message: 'Demande transférée.' });
  }
});
