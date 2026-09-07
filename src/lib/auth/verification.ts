import 'server-only';
import { prisma } from '@/lib/prisma';
import { generateNumericCode, hashToken, safeEqual } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';
import { verificationEmail } from '@/lib/email/templates';
import { ApiError } from '@/lib/api/errors';

export const CODE_TTL_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Émet un nouveau code de vérification et l'envoie par e-mail.
 * Les codes précédents encore valides sont invalidés : un seul code actif.
 */
export async function issueVerificationCode(user: {
  id: string;
  email: string;
  firstName: string;
}): Promise<void> {
  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    prisma.emailVerificationCode.updateMany({
      where: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    }),
    prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        email: user.email,
        codeHash: hashToken(code),
        purpose: 'EMAIL_VERIFICATION',
        expiresAt,
      },
    }),
  ]);

  await sendEmail(
    verificationEmail({
      to: user.email,
      firstName: user.firstName,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
    }),
  );
}

export type VerificationOutcome =
  | { status: 'verified' }
  | { status: 'already_verified' };

/**
 * Vérifie un code. Le nombre de tentatives est plafonné par code émis, en plus
 * de la limitation de débit appliquée à la route.
 */
export async function consumeVerificationCode(
  email: string,
  code: string,
): Promise<VerificationOutcome> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { emailNormalized: normalizedEmail },
    select: { id: true, emailVerifiedAt: true, deletedAt: true },
  });

  // Réponse identique quel que soit le cas : pas d'énumération de comptes.
  const genericError = new ApiError(
    400,
    'Code invalide ou expiré. Demandez un nouveau code si nécessaire.',
    'INVALID_CODE',
  );

  if (!user || user.deletedAt) throw genericError;
  if (user.emailVerifiedAt) return { status: 'already_verified' };

  const record = await prisma.emailVerificationCode.findFirst({
    where: { userId: user.id, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) throw genericError;

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new ApiError(
      400,
      'Ce code a expiré. Demandez un nouveau code.',
      'CODE_EXPIRED',
    );
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    throw new ApiError(
      429,
      'Trop de tentatives sur ce code. Demandez un nouveau code.',
      'TOO_MANY_ATTEMPTS',
    );
  }

  if (!safeEqual(record.codeHash, hashToken(code))) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    const left = MAX_CODE_ATTEMPTS - record.attempts - 1;
    throw new ApiError(
      400,
      left > 0
        ? `Code incorrect. Il vous reste ${left} tentative${left > 1 ? 's' : ''}.`
        : 'Code incorrect. Demandez un nouveau code.',
      'INVALID_CODE',
    );
  }

  await prisma.$transaction([
    prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);

  return { status: 'verified' };
}

export async function purgeExpiredCodes(): Promise<number> {
  const { count } = await prisma.emailVerificationCode.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  return count;
}
