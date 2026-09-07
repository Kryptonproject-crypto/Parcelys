import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { forgotPasswordSchema } from '@/lib/validation/auth';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';
import { passwordResetEmail } from '@/lib/email/templates';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { logAudit } from '@/lib/audit';

const RESET_TTL_MINUTES = 30;

/**
 * POST /api/auth/forgot-password
 * Émet un jeton de réinitialisation. La réponse ne varie jamais : impossible de
 * savoir si une adresse est enregistrée.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await parseBody(request, forgotPasswordSchema);
  const emailNormalized = input.email.trim().toLowerCase();

  await enforceRateLimit(
    `forgot:ip:${ip}`,
    RateLimits.passwordReset,
    'Trop de demandes. Réessayez plus tard.',
  );
  await enforceRateLimit(`forgot:user:${emailNormalized}`, RateLimits.passwordReset);

  const user = await prisma.user.findUnique({
    where: { emailNormalized },
    select: { id: true, email: true, firstName: true, deletedAt: true },
  });

  if (user && !user.deletedAt) {
    const token = generateToken(32);

    await prisma.$transaction([
      // Un seul jeton actif à la fois.
      prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
        },
      }),
    ]);

    await sendEmail(
      passwordResetEmail({
        to: user.email,
        firstName: user.firstName,
        token,
        expiresInMinutes: RESET_TTL_MINUTES,
      }),
    );

    await logAudit({
      action: 'auth.password_reset_requested',
      userId: user.id,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
    });
  }

  return ok({
    message:
      'Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.',
  });
});
