import type { NextRequest } from 'next/server';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/rbac';
import { ticketMessageSchema } from '@/lib/validation/support';
import {
  chargerMaDemande,
  lireFormulaire,
  repondreDemandeur,
  validerPieceJointe,
} from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/** POST /api/support/tickets/:id/messages — le demandeur répond. */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  // 404 pour la demande d'un autre, avant toute lecture du corps.
  const ticket = await chargerMaDemande(auth.user.id, id ?? '');

  await enforceRateLimit(`support:reponse:${auth.user.id}`, { limit: 60, windowSeconds: 3600 });
  const { champs, fichier } = await lireFormulaire(request);
  const input = ticketMessageSchema.parse(champs);
  const piece = fichier ? await validerPieceJointe(fichier) : null;

  await repondreDemandeur({
    ticketId: ticket.id,
    userId: auth.user.id,
    body: input.body,
    piece,
    ipAddress: clientIp(request),
    viaLien: false,
  });
  return ok({ message: 'Message envoyé.' }, 201);
});
