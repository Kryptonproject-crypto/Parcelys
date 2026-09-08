import 'server-only';
import { cookies, headers } from 'next/headers';
import type { FarmRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { generateToken, hashToken } from '@/lib/auth/tokens';

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  locale: string;
  unitSystem: string;
  isDemo: boolean;
  /** Administrateur de l'instance — voir `src/lib/auth/invitations.ts`. */
  isPlatformAdmin: boolean;
};

export type SessionMembership = {
  farmId: string;
  farmName: string;
  role: FarmRole;
};

export type AuthContext = {
  sessionId: string;
  user: SessionUser;
  memberships: SessionMembership[];
  /** Exploitation courante (celle du sélecteur d'exploitation). */
  activeFarmId: string | null;
  activeRole: FarmRole | null;
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function createSession(params: {
  userId: string;
  activeFarmId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  /**
   * `false` pour un client natif : il conserve lui-même le jeton et l'envoie
   * en `Authorization: Bearer`. Poser un cookie n'aurait aucun effet utile
   * (autre origine) et exposerait inutilement la session.
   */
  setCookie?: boolean;
}): Promise<{ token: string; expiresAt: Date }> {
  const env = getEnv();
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);

  await prisma.session.create({
    data: {
      userId: params.userId,
      activeFarmId: params.activeFarmId ?? null,
      tokenHash: hashToken(token),
      userAgent: params.userAgent?.slice(0, 300) ?? null,
      ipAddress: params.ipAddress ?? null,
      expiresAt,
    },
  });

  if (params.setCookie !== false) {
    const jar = await cookies();
    jar.set(
      env.SESSION_COOKIE_NAME,
      token,
      cookieOptions(env.SESSION_TTL_HOURS * 3600),
    );
  }

  return { token, expiresAt };
}

/**
 * Jeton de session de la requête courante.
 *
 * Deux porteurs pour un même mécanisme : le cookie `HttpOnly` du navigateur, et
 * l'en-tête `Authorization: Bearer` de l'application mobile — dont la WebView
 * est sur une autre origine et ne recevrait donc jamais le cookie. Dans les
 * deux cas, le jeton est le même secret opaque, et la base n'en conserve que
 * l'empreinte.
 *
 * Le cookie est prioritaire : c'est le cas de figure du navigateur, où un
 * en-tête `Authorization` forgé ne doit pas pouvoir détourner la session.
 */
async function resolveSessionToken(): Promise<{
  token: string;
  bearer: boolean;
} | null> {
  const env = getEnv();
  const jar = await cookies();
  const cookieToken = jar.get(env.SESSION_COOKIE_NAME)?.value;
  if (cookieToken) return { token: cookieToken, bearer: false };

  const authorization = (await headers()).get('authorization');
  if (!authorization) return null;

  const [scheme, value] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

  return { token: value.trim(), bearer: true };
}

/**
 * Charge la session (cookie ou jeton Bearer) et l'utilisateur avec ses
 * exploitations. Renvoie `null` si la session est absente, expirée, révoquée,
 * inactive trop longtemps, si le compte est supprimé ou suspendu.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const env = getEnv();
  const resolved = await resolveSessionToken();
  if (!resolved) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(resolved.token) },
    include: {
      user: {
        include: {
          memberships: {
            include: { farm: { select: { id: true, name: true, deletedAt: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.deletedAt) return null;
  // Suspension par un administrateur : la session en cours cesse aussitôt
  // d'être valide, sans attendre son expiration.
  if (session.user.suspendedAt) return null;

  const idleLimitMs = env.SESSION_IDLE_TIMEOUT_HOURS * 3600 * 1000;
  if (Date.now() - session.lastUsedAt.getTime() > idleLimitMs) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  // Rafraîchissement paresseux de `lastUsedAt` (au plus une écriture / 5 min).
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  }

  const memberships: SessionMembership[] = session.user.memberships
    .filter((m) => !m.farm.deletedAt)
    .map((m) => ({ farmId: m.farmId, farmName: m.farm.name, role: m.role }));

  let activeFarmId = session.activeFarmId;
  if (!activeFarmId || !memberships.some((m) => m.farmId === activeFarmId)) {
    activeFarmId = memberships[0]?.farmId ?? null;
  }
  const activeRole =
    memberships.find((m) => m.farmId === activeFarmId)?.role ?? null;

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      emailVerified: session.user.emailVerifiedAt !== null,
      locale: session.user.locale,
      unitSystem: session.user.unitSystem,
      isDemo: session.user.isDemo,
      isPlatformAdmin: session.user.isPlatformAdmin,
    },
    memberships,
    activeFarmId,
    activeRole,
  };
}

export async function setActiveFarm(
  sessionId: string,
  farmId: string,
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { activeFarmId: farmId },
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const env = getEnv();
  const resolved = await resolveSessionToken();

  if (resolved) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(resolved.token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Le client natif n'a pas de cookie à effacer ; la suppression est sans
  // effet dans ce cas, et évite un embranchement.
  (await cookies()).delete(env.SESSION_COOKIE_NAME);
}

/** Déconnexion de tous les appareils. */
export async function revokeAllSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        {
          revokedAt: {
            lt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          },
        },
      ],
    },
  });
  return count;
}
