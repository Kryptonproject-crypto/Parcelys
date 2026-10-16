import type { NextRequest } from 'next/server';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { ticketMessageSchema } from '@/lib/validation/support';
import { repondreAdmin } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * POST /api/admin/support/:id/messages — réponse au demandeur, ou note
 * interne (`internal: true`) que le demandeur ne verra jamais.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const { scope } = await requireAdmin('support:manage');
  const { id } = await context.params;
  const input = await parseBody(request, ticketMessageSchema);
  const internal = input.internal === true || input.internal === 'true' || input.internal === 'on';
  await repondreAdmin({
    scope,
    ticketId: id ?? '',
    body: input.body,
    internal,
    ipAddress: clientIp(request),
  });
  return ok({ message: internal ? 'Note interne ajoutée.' : 'Réponse envoyée au demandeur.' }, 201);
});
