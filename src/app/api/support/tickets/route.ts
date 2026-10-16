import type { NextRequest } from 'next/server';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { getAuthContext } from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/rbac';
import {
  anonymousRequesterSchema,
  ticketCreateSchema,
} from '@/lib/validation/support';
import {
  creerDemande,
  exploitationsDuCompte,
  lireFormulaire,
  listerMesDemandes,
  validerPieceJointe,
  type Demandeur,
} from '@/lib/support/tickets';

/**
 * POST /api/support/tickets — dépose une demande de support.
 *
 * Ouvert aux visiteurs non connectés, comme la page Contact : quelqu'un qui
 * n'arrive plus à se connecter doit pouvoir écrire. Mais la session, quand
 * elle existe, prime sur tout ce que le formulaire envoie : le nom, l'adresse
 * et le numéro client viennent alors du compte, et l'exploitation choisie doit
 * être l'une des siennes.
 *
 * `multipart/form-data` (avec une pièce jointe facultative, champ `piece`) ou
 * JSON.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  const auth = await getAuthContext();
  // Une adresse non vérifiée ne prouve rien : ce compte écrit comme un
  // visiteur, avec une identité à vérifier.
  const compte = auth && auth.user.emailVerified ? auth : null;

  await enforceRateLimit(
    compte ? `support:compte:${compte.user.id}` : `support:anonyme:${ip}`,
    compte ? { limit: 20, windowSeconds: 3600 } : { limit: 5, windowSeconds: 3600 },
    'Trop de demandes envoyées. Réessayez dans une heure, ou écrivez à l’adresse indiquée sur la page Contact.',
  );

  const { champs, fichier } = await lireFormulaire(request);
  const input = ticketCreateSchema.parse(champs);

  // Champ piège rempli : un robot. On répond comme si de rien n'était, sans
  // rien enregistrer ni prévenir personne.
  if (input.website) {
    return ok({ message: 'Demande enregistrée.', number: null }, 201);
  }

  const piece = fichier ? await validerPieceJointe(fichier) : null;

  let demandeur: Demandeur;
  if (compte) {
    const fermes = exploitationsDuCompte(compte);
    const voulue = input.farmId || null;
    // L'exploitation demandée doit être l'une des siennes ; à défaut,
    // l'exploitation active. Un identifiant étranger est simplement ignoré.
    const farmId =
      (voulue && fermes.some((f) => f.farmId === voulue) ? voulue : null) ??
      (fermes.some((f) => f.farmId === compte.activeFarmId) ? compte.activeFarmId : null) ??
      fermes[0]?.farmId ??
      null;
    demandeur = {
      kind: 'account',
      userId: compte.user.id,
      name: `${compte.user.firstName} ${compte.user.lastName}`,
      email: compte.user.email,
      farmId: compte.user.accountType === 'AGRONOMIST' ? null : farmId,
      technicianId: compte.user.accountType === 'AGRONOMIST' ? compte.user.id : null,
    };
  } else {
    const identite = anonymousRequesterSchema.parse({ name: input.name, email: input.email });
    demandeur = {
      kind: 'anonymous',
      name: identite.name,
      email: identite.email,
      declaredNumber: input.customerNumber || null,
    };
  }

  const ticket = await creerDemande({
    demandeur,
    subject: input.subject,
    description: input.description,
    area: input.area || null,
    piece,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
  });

  return ok(
    {
      message: compte
        ? `Demande ${ticket.number} enregistrée. Vous la retrouvez dans « Mes demandes ».`
        : `Demande ${ticket.number} enregistrée. Un e-mail vient de vous être envoyé avec un lien pour la suivre.`,
      number: ticket.number,
      // L'identifiant n'est rendu qu'au compte connecté, qui peut l'ouvrir.
      id: compte ? ticket.id : null,
    },
    201,
  );
});

/** GET /api/support/tickets — les demandes du compte connecté. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ tickets: await listerMesDemandes(auth.user.id) });
});
