import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { revokeAllSessions } from '@/lib/auth/session';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { ApiError } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { securityAlertEmail } from '@/lib/email/templates';

/**
 * POST /api/auth/reset-password
 * Consomme le jeton, applique le nouveau mot de passe et révoque toutes les
 * sessions existantes (un mot de passe compromis ne doit laisser aucune session
 * ouverte).
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  await enforceRateLimit(`reset:ip:${ip}`, RateLimits.passwordReset);

  const input = await parseBody(request, resetPasswordSchema);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: {
      user: { select: { id: true, email: true, firstName: true, deletedAt: true } },
    },
  });

  if (
    !record ||
    record.consumedAt ||
    record.expiresAt.getTime() < Date.now() ||
    record.user.deletedAt
  ) {
    throw new ApiError(
      400,
      'Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.',
      'INVALID_TOKEN',
    );
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.user.id },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        // La possession du lien vaut preuve de contrôle de la boîte e-mail.
        emailVerifiedAt: new Date(),
      },
    }),
  ]);

  await revokeAllSessions(record.user.id);

  await logAudit({
    action: 'auth.password_reset',
    userId: record.user.id,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
  });

  await sendEmail(
    securityAlertEmail({
      to: record.user.email,
      firstName: record.user.firstName,
      event: 'Mot de passe modifié',
      detail:
        'Votre mot de passe Parcelys vient d’être modifié et toutes vos sessions ont été fermées. ' +
        'Si vous n’êtes pas à l’origine de cette action, réinitialisez immédiatement votre mot de passe.',
    }),
  );

  return ok({
    message:
      'Mot de passe modifié. Toutes vos sessions ont été fermées, vous pouvez vous reconnecter.',
    redirectTo: '/connexion',
  });
});
