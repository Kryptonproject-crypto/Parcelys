import type { NextRequest } from 'next/server';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { badRequest } from '@/lib/api/errors';
import { followUpSchema } from '@/lib/validation/support';
import {
  confirmerParLien,
  lireFormulaire,
  repondreDemandeur,
  ticketIdParLien,
  validerPieceJointe,
} from '@/lib/support/tickets';

/**
 * POST /api/support/suivi — suivi d'une demande anonyme, par le lien reçu à
 * l'adresse saisie.
 *
 * `confirmer` : le visiteur atteste que l'adresse est la sienne (il a reçu le
 * lien). `repondre` : il ajoute un message, avec une pièce jointe facultative.
 * Le jeton est le seul sésame, et il ne donne accès qu'à **cette** demande.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  await enforceRateLimit(`support:suivi:${ip}`, { limit: 60, windowSeconds: 3600 });

  const { champs, fichier } = await lireFormulaire(request);
  const input = followUpSchema.parse(champs);

  if (input.action === 'confirmer') {
    await confirmerParLien(input.token, ip);
    return ok({ message: 'Adresse confirmée. Merci.' });
  }

  if (input.action === 'repondre') {
    if (!input.body) throw badRequest('Message vide');
    const ticketId = await ticketIdParLien(input.token);
    const piece = fichier ? await validerPieceJointe(fichier) : null;
    await repondreDemandeur({
      ticketId,
      userId: null,
      body: input.body,
      piece,
      ipAddress: ip,
      viaLien: true,
    });
    return ok({ message: 'Message envoyé.' }, 201);
  }

  throw badRequest('Action inconnue');
});
