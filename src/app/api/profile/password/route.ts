import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { changePasswordSchema } from '@/lib/validation/auth';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { securityAlertEmail } from '@/lib/email/templates';

/**
 * PUT /api/profile/password — change le mot de passe.
 * Les autres sessions sont révoquées ; la session courante est conservée.
 */
export const PUT = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  await enforceRateLimit(`change-password:${auth.user.id}`, {
    limit: 5,
    windowSeconds: 900,
  });

  const input = await parseBody(request, changePasswordSchema);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { id: true, email: true, firstName: true, passwordHash: true },
  });

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, 'Mot de passe actuel incorrect.', 'INVALID_PASSWORD');
  }

  if (input.currentPassword === input.newPassword) {
    throw new ApiError(
      400,
      'Le nouveau mot de passe doit être différent de l’actuel.',
      'SAME_PASSWORD',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  const revoked = await revokeAllSessions(user.id, auth.sessionId);

  await logAudit({
    action: 'auth.password_changed',
    userId: user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { revokedSessions: revoked },
  });

  await sendEmail(
    securityAlertEmail({
      to: user.email,
      firstName: user.firstName,
      event: 'Mot de passe modifié',
      detail:
        `Votre mot de passe Parcelys a été modifié. ${revoked} autre(s) session(s) ont été fermées. ` +
        'Si vous n’êtes pas à l’origine de cette action, contactez immédiatement votre administrateur.',
    }),
  );

  return ok({
    message: `Mot de passe modifié. ${revoked} autre(s) appareil(s) déconnecté(s).`,
  });
});
