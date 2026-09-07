import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation/auth';
import { hashPassword } from '@/lib/auth/password';
import { issueVerificationCode } from '@/lib/auth/verification';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { logAudit } from '@/lib/audit';
import { DEFAULT_CROPS } from '@/lib/constants/agronomy';
import { conflict } from '@/lib/api/errors';

/**
 * POST /api/auth/register
 * Crée l'utilisateur, son exploitation (rôle propriétaire) et envoie le code de
 * vérification. L'utilisateur n'est pas connecté tant que l'adresse n'est pas
 * vérifiée.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  await enforceRateLimit(
    `register:${ip}`,
    RateLimits.register,
    "Trop de créations de compte depuis cette adresse. Réessayez dans une heure.",
  );

  const input = await parseBody(request, registerSchema);
  const emailNormalized = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { emailNormalized },
    select: { id: true },
  });
  if (existing) {
    throw conflict('Un compte existe déjà avec cette adresse e-mail.');
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        acceptedTermsAt: now,
        acceptedPrivacyAt: now,
      },
    });

    const farm = await tx.farm.create({
      data: {
        name: input.farmName,
        siret: input.siret && input.siret.length > 0 ? input.siret : null,
      },
    });

    await tx.farmMember.create({
      data: { farmId: farm.id, userId: created.id, role: 'OWNER' },
    });

    // Référentiel de cultures propre à l'exploitation, modifiable ensuite.
    await tx.crop.createMany({
      data: DEFAULT_CROPS.map((crop) => ({
        farmId: farm.id,
        code: crop.code,
        name: crop.name,
        category: crop.category,
      })),
      skipDuplicates: true,
    });

    return created;
  });

  await issueVerificationCode({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
  });

  await logAudit({
    action: 'auth.register',
    userId: user.id,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
    metadata: { farmName: input.farmName },
  });

  return ok(
    {
      message:
        'Compte créé. Un code de vérification à 6 chiffres vient de vous être envoyé par e-mail.',
      email: user.email,
      nextStep: 'verification-email',
    },
    201,
  );
});
