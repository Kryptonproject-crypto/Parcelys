import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loginSchema } from '@/lib/validation/auth';
import { fakeVerify, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits, resetRateLimit } from '@/lib/auth/rate-limit';
import { ApiError } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { issueVerificationCode } from '@/lib/auth/verification';

/** Verrouillage progressif du compte au-delà de ce nombre d'échecs. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/**
 * POST /api/auth/login
 *
 * Deux protections complémentaires contre le bruteforce :
 *  - limitation de débit par adresse IP et par identifiant ;
 *  - verrouillage temporaire du compte après plusieurs échecs.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await parseBody(request, loginSchema);
  const emailNormalized = input.email.trim().toLowerCase();

  await enforceRateLimit(
    `login:ip:${ip}`,
    RateLimits.login,
    'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
  );
  await enforceRateLimit(
    `login:user:${emailNormalized}`,
    RateLimits.login,
    'Trop de tentatives de connexion sur ce compte. Réessayez dans quelques minutes.',
  );

  const invalidCredentials = new ApiError(
    401,
    'Adresse e-mail ou mot de passe incorrect.',
    'INVALID_CREDENTIALS',
  );

  const user = await prisma.user.findUnique({
    where: { emailNormalized },
    include: {
      memberships: { orderBy: { createdAt: 'asc' }, take: 1, select: { farmId: true } },
    },
  });

  if (!user || user.deletedAt) {
    // Coût de hachage équivalent : le temps de réponse ne révèle rien.
    await fakeVerify(input.password);
    throw invalidCredentials;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ApiError(
      423,
      `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${minutes} minute(s).`,
      'ACCOUNT_LOCKED',
    );
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const shouldLock = failed >= MAX_FAILED_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failed,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null,
      },
    });

    await logAudit({
      action: shouldLock ? 'auth.account_locked' : 'auth.login_failed',
      userId: user.id,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
      metadata: { attempt: failed },
    });

    if (shouldLock) {
      throw new ApiError(
        423,
        `Compte verrouillé ${LOCK_MINUTES} minutes après plusieurs échecs de connexion.`,
        'ACCOUNT_LOCKED',
      );
    }
    throw invalidCredentials;
  }

  // Compte suspendu par un administrateur. Le contrôle vient après la
  // vérification du mot de passe : sans lui, le formulaire dirait à un inconnu
  // qu'une adresse correspond bien à un compte.
  if (user.suspendedAt) {
    throw new ApiError(
      403,
      user.suspendedReason
        ? `Votre compte a été suspendu par un administrateur : ${user.suspendedReason}`
        : 'Votre compte a été suspendu par un administrateur.',
      'ACCOUNT_SUSPENDED',
    );
  }

  // L'adresse doit être vérifiée avant l'ouverture de session.
  if (!user.emailVerifiedAt) {
    await issueVerificationCode({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
    });
    throw new ApiError(
      403,
      'Votre adresse e-mail n’est pas encore vérifiée. Un nouveau code vient de vous être envoyé.',
      'EMAIL_NOT_VERIFIED',
      { email: user.email },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const native = input.client === 'native';

  const session = await createSession({
    userId: user.id,
    activeFarmId: user.memberships[0]?.farmId ?? null,
    userAgent: input.deviceName ?? request.headers.get('user-agent'),
    ipAddress: ip,
    setCookie: !native,
  });

  await resetRateLimit(`login:user:${emailNormalized}`);

  await logAudit({
    action: 'auth.login',
    userId: user.id,
    farmId: user.memberships[0]?.farmId ?? null,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
    metadata: { client: input.client },
  });

  // Deux métiers, deux espaces de travail : l'exploitant ouvre son tableau de
  // bord, l'expert son portefeuille.
  const home = user.accountType === 'AGRONOMIST' ? '/portefeuille' : '/dashboard';

  return ok({
    message: 'Connexion réussie',
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      accountType: user.accountType,
    },
    // Le jeton n'est renvoyé qu'au client natif, qui n'a pas de cookie. Le
    // navigateur, lui, garde une session `HttpOnly` inaccessible au JavaScript.
    ...(native
      ? { token: session.token, expiresAt: session.expiresAt.toISOString() }
      : {}),
    farms: user.memberships.map((m) => m.farmId),
    redirectTo: home,
  });
});
