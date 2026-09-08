import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Limitation de débit à fenêtre fixe, persistée en base afin de rester correcte
 * derrière plusieurs instances (et de survivre à un redémarrage).
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!getEnv().RATE_LIMIT_ENABLED) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);

  // Une seule requête atomique : on incrémente si la fenêtre court toujours,
  // sinon on la réinitialise.
  const rows = await prisma.$queryRaw<
    Array<{ count: number; expires_at: Date }>
  >`
    INSERT INTO rate_limit_counters (key, count, expires_at)
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limit_counters.expires_at < ${now} THEN 1
        ELSE rate_limit_counters.count + 1
      END,
      expires_at = CASE
        WHEN rate_limit_counters.expires_at < ${now} THEN ${expiresAt}
        ELSE rate_limit_counters.expires_at
      END
    RETURNING count, expires_at
  `;

  const row = rows[0];
  if (!row) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

  const count = Number(row.count);
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(row.expires_at).getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

export async function resetRateLimit(key: string): Promise<void> {
  await prisma.rateLimitCounter.deleteMany({ where: { key } });
}

/** Purge des compteurs expirés — appelée par la tâche de maintenance. */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

/** Presets utilisés par les routes sensibles. */
export const RateLimits = {
  login: { limit: 10, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  /** Essais de code d'invitation : empêche de balayer l'espace des codes. */
  invitationAttempt: { limit: 10, windowSeconds: 15 * 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  verificationAttempt: { limit: 10, windowSeconds: 15 * 60 },
  verificationResend: { limit: 3, windowSeconds: 15 * 60 },
  mutation: { limit: 240, windowSeconds: 60 },
  externalApi: { limit: 60, windowSeconds: 60 },
} as const;
