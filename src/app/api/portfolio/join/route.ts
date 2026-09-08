import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgronomist } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { advisoryRedeemSchema } from '@/lib/validation/advisory';
import { consumeInvitation, findUsableInvitation } from '@/lib/auth/invitations';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';
import { ApiError, conflict } from '@/lib/api/errors';

/**
 * POST /api/portfolio/join — l'expert ajoute une exploitation à son portefeuille.
 *
 * Le code lui a été remis par l'exploitation elle-même. Contrairement à un code
 * d'inscription, celui-ci ne crée aucun compte : il ouvre une mission de
 * conseil sur une exploitation existante, au profit d'un expert déjà connecté.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAgronomist();
  const ip = clientIp(request);

  await enforceRateLimit(
    `advisory-join:${auth.user.id}`,
    RateLimits.invitationAttempt,
    "Trop d'essais de code d'accès. Réessayez dans un quart d'heure.",
  );

  const input = await parseBody(request, advisoryRedeemSchema);
  const invitation = await findUsableInvitation(input.code, auth.user.email);

  // Un code d'inscription n'ouvre pas une mission, et réciproquement : sans ce
  // contrôle, un code destiné à créer un compte donnerait un accès conseil.
  if (invitation.purpose !== 'ADVISORY_ACCESS' || !invitation.farmId) {
    throw new ApiError(
      403,
      "Ce code n'est pas un code d'accès conseil.",
      'INVITATION_INVALID',
    );
  }

  const farmId = invitation.farmId;

  const existing = await prisma.advisoryEngagement.findUnique({
    where: { farmId_expertId: { farmId, expertId: auth.user.id } },
  });
  if (existing?.status === 'ACTIVE') {
    throw conflict('Vous suivez déjà cette exploitation.');
  }

  await prisma.$transaction(async (tx) => {
    await consumeInvitation(tx, invitation.id, auth.user.id);

    // Une mission reprise réactive la ligne existante : l'historique de la
    // relation reste unique, et l'index d'unicité tient.
    if (existing) {
      await tx.advisoryEngagement.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          endedAt: null,
          startedAt: new Date(),
          grantedById: invitation.createdById,
          note: invitation.note,
        },
      });
      return;
    }

    await tx.advisoryEngagement.create({
      data: {
        farmId,
        expertId: auth.user.id,
        grantedById: invitation.createdById,
        note: invitation.note,
      },
    });
  });

  await logAudit({
    action: 'advisor.access_redeemed',
    userId: auth.user.id,
    farmId,
    entity: 'AdvisoryEngagement',
    ipAddress: ip,
    metadata: { invitationId: invitation.id },
  });

  // L'exploitation doit savoir qui vient d'entrer dans ses données.
  await createNotification({
    userId: invitation.createdById,
    farmId,
    type: 'RECOMMENDATION',
    title: 'Un expert a rejoint votre exploitation',
    body:
      `${auth.user.firstName} ${auth.user.lastName}` +
      `${auth.user.organization ? ` (${auth.user.organization})` : ''} ` +
      'a activé son accès conseil.',
    link: '/parametres',
    alsoEmail: true,
  });

  return ok({
    message: `« ${invitation.farm?.name} » a été ajoutée à votre portefeuille.`,
    farmId,
    farmName: invitation.farm?.name ?? null,
  });
});
