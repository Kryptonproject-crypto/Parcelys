import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEmailSchema } from '@/lib/validation/auth';
import { consumeVerificationCode } from '@/lib/auth/verification';
import { createSession } from '@/lib/auth/session';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { logAudit } from '@/lib/audit';
import { homePathFor } from '@/lib/auth/accounts';

/**
 * POST /api/auth/verify-email
 * Valide le code à 6 chiffres puis ouvre directement la session : l'utilisateur
 * arrive sur son tableau de bord sans ressaisir son mot de passe.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await parseBody(request, verifyEmailSchema);
  const emailNormalized = input.email.trim().toLowerCase();

  await enforceRateLimit(
    `verify:ip:${ip}`,
    RateLimits.verificationAttempt,
    'Trop de tentatives. Réessayez dans quelques minutes.',
  );
  await enforceRateLimit(
    `verify:user:${emailNormalized}`,
    RateLimits.verificationAttempt,
    'Trop de tentatives sur ce compte. Réessayez dans quelques minutes.',
  );

  try {
    const outcome = await consumeVerificationCode(input.email, input.code);

    const user = await prisma.user.findUnique({
      where: { emailNormalized },
      include: {
        memberships: { orderBy: { createdAt: 'asc' }, take: 1, select: { farmId: true } },
      },
    });

    if (user && !user.deletedAt) {
      await createSession({
        userId: user.id,
        activeFarmId: user.memberships[0]?.farmId ?? null,
        userAgent: request.headers.get('user-agent'),
        ipAddress: ip,
      });

      await logAudit({
        action: 'auth.email_verified',
        userId: user.id,
        ipAddress: ip,
        userAgent: request.headers.get('user-agent'),
        metadata: { alreadyVerified: outcome.status === 'already_verified' },
      });
    }

    return ok({
      message:
        outcome.status === 'already_verified'
          ? 'Adresse déjà vérifiée.'
          : 'Adresse e-mail vérifiée.',
      // Ni l'expert ni l'administrateur n'ont de tableau de bord
      // d'exploitation : le premier ouvre son portefeuille, le second ses
      // écrans de gestion.
      redirectTo: homePathFor(user?.accountType ?? 'FARMER'),
    });
  } catch (error) {
    await logAudit({
      action: 'auth.verification_failed',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
      metadata: { email: emailNormalized },
    });
    throw error;
  }
});
