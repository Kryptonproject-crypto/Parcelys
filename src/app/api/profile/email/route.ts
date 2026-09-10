import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import {
  confirmEmailChangeSchema,
  requestEmailChangeSchema,
} from '@/lib/validation/auth';
import { verifyPassword } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { securityAlertEmail } from '@/lib/email/templates';
import {
  annulerChangementEmail,
  changementEnAttente,
  confirmerChangementEmail,
  demanderChangementEmail,
} from '@/lib/auth/email-change';

/**
 * Changement de l'adresse e-mail du compte.
 *
 *   GET    — la demande en cours, s'il y en a une
 *   POST   — demande le changement : mot de passe exigé, code envoyé
 *   PUT    — confirme avec le code reçu à la nouvelle adresse
 *   DELETE — abandonne la demande
 *
 * L'adresse ne change qu'au PUT. Tant que le code n'a pas été saisi, le compte
 * reste joignable à l'ancienne adresse — ce qui compte si la demande ne venait
 * pas de son propriétaire.
 */

/** GET — l'interface doit savoir qu'un code est en attente après un retour. */
export const GET = route(async () => {
  const auth = await requireAuth();
  const attente = await changementEnAttente(auth.user.id);
  return ok({
    email: auth.user.email,
    pending: attente
      ? { newEmail: attente.nouvelleAdresse, expiresAt: attente.expireLe.toISOString() }
      : null,
  });
});

/** POST — demande le changement. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAuth();

  // Deux limites, deux menaces distinctes. Celle-ci protège le compte contre
  // l'essai de mots de passe ; le délai de renvoi, côté service, protège la
  // boîte du destinataire contre l'inondation.
  await enforceRateLimit(`change-email:${auth.user.id}`, { limit: 5, windowSeconds: 900 });

  const input = await parseBody(request, requestEmailChangeSchema);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { id: true, passwordHash: true },
  });

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, 'Mot de passe actuel incorrect.', 'INVALID_PASSWORD');
  }

  const demande = await demanderChangementEmail({
    userId: auth.user.id,
    nouvelleAdresse: input.newEmail,
  });

  await logAudit({
    action: 'auth.email_change_requested',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    // L'adresse visée est journalisée : c'est ce qui permet de reconstituer une
    // tentative de détournement. L'ancienne l'est déjà par le compte lui-même.
    metadata: { newEmail: demande.nouvelleAdresse },
  });

  return ok({
    newEmail: demande.nouvelleAdresse,
    expiresInSeconds: demande.expireDans,
    resendInSeconds: demande.renvoiPossibleDans,
    message:
      `Un code a été envoyé à ${demande.nouvelleAdresse}. ` +
      'Votre adresse actuelle ne changera qu’une fois ce code saisi.',
  });
});

/** PUT — confirme le changement. */
export const PUT = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  await enforceRateLimit(`confirm-email:${auth.user.id}`, { limit: 10, windowSeconds: 900 });

  const input = await parseBody(request, confirmEmailChangeSchema);
  const { ancienneAdresse, nouvelleAdresse } = await confirmerChangementEmail({
    userId: auth.user.id,
    code: input.code,
  });

  // Les autres sessions tombent, comme au changement de mot de passe : si la
  // demande venait d'un tiers, il ne doit pas rester connecté sur le compte
  // qu'il vient de s'approprier.
  const revoked = await revokeAllSessions(auth.user.id, auth.sessionId);

  await logAudit({
    action: 'auth.email_changed',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { from: ancienneAdresse, to: nouvelleAdresse, revokedSessions: revoked },
  });

  // L'ancienne adresse est prévenue une dernière fois. C'est le seul message
  // qu'elle recevra désormais : le compte ne lui est plus rattaché.
  await sendEmail(
    securityAlertEmail({
      to: ancienneAdresse,
      firstName: auth.user.firstName,
      event: 'Adresse du compte modifiée',
      detail:
        `L’adresse de votre compte Parcelys est désormais « ${nouvelleAdresse} ». ` +
        'Cette adresse-ci ne recevra plus de message de Parcelys. Si vous n’êtes pas à ' +
        'l’origine de ce changement, contactez immédiatement votre administrateur : ' +
        'vous ne pourrez plus vous connecter avec cette adresse.',
    }),
  );

  return ok({
    email: nouvelleAdresse,
    message: `Adresse modifiée. ${revoked} autre(s) appareil(s) déconnecté(s).`,
  });
});

/** DELETE — abandonne la demande en cours. */
export const DELETE = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const annulee = await annulerChangementEmail(auth.user.id);

  if (annulee) {
    await logAudit({
      action: 'auth.email_change_cancelled',
      userId: auth.user.id,
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
  }

  return ok({
    cancelled: annulee,
    message: annulee ? 'Demande annulée.' : 'Aucune demande en cours.',
  });
});
