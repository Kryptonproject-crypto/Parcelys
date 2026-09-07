import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resendCodeSchema } from '@/lib/validation/auth';
import { issueVerificationCode } from '@/lib/auth/verification';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';

/**
 * POST /api/auth/resend-code
 * Renvoie un code de vérification. La réponse est identique que le compte
 * existe ou non, afin de ne pas divulguer les adresses enregistrées.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await parseBody(request, resendCodeSchema);
  const emailNormalized = input.email.trim().toLowerCase();

  await enforceRateLimit(
    `resend:ip:${ip}`,
    RateLimits.verificationResend,
    'Trop de demandes de code. Patientez quelques minutes.',
  );
  await enforceRateLimit(
    `resend:user:${emailNormalized}`,
    RateLimits.verificationResend,
    'Un code a déjà été envoyé récemment. Patientez quelques minutes.',
  );

  const user = await prisma.user.findUnique({
    where: { emailNormalized },
    select: {
      id: true,
      email: true,
      firstName: true,
      emailVerifiedAt: true,
      deletedAt: true,
    },
  });

  if (user && !user.deletedAt && !user.emailVerifiedAt) {
    await issueVerificationCode(user);
  }

  return ok({
    message:
      'Si un compte non vérifié correspond à cette adresse, un nouveau code vient d’être envoyé.',
  });
});
