import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase } from './helpers/db';
import { consumeRateLimit, resetRateLimit, purgeExpiredRateLimits } from '../src/lib/auth/rate-limit';

/**
 * Limitation de débit.
 *
 * Testée au niveau du service : les tests d'API tournent avec la limitation
 * désactivée pour ne pas dépendre de la cadence d'exécution.
 */
describe('Limitation de débit', () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.RATE_LIMIT_ENABLED = 'true';
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('autorise les requêtes jusqu’à la limite puis les refuse', async () => {
    const key = 'test:limite';

    for (let i = 1; i <= 5; i += 1) {
      const result = await consumeRateLimit(key, 5, 60);
      expect(result.allowed, `requête ${i}`).toBe(true);
      expect(result.remaining).toBe(5 - i);
    }

    const blocked = await consumeRateLimit(key, 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('isole les compteurs par clé', async () => {
    await consumeRateLimit('utilisateur:a', 1, 60);
    const blockedA = await consumeRateLimit('utilisateur:a', 1, 60);
    const allowedB = await consumeRateLimit('utilisateur:b', 1, 60);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('réinitialise le compteur à l’expiration de la fenêtre', async () => {
    const key = 'test:fenetre';

    // Fenêtre d'une seconde, épuisée immédiatement.
    await consumeRateLimit(key, 1, 1);
    expect((await consumeRateLimit(key, 1, 1)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterWindow = await consumeRateLimit(key, 1, 1);
    expect(afterWindow.allowed).toBe(true);
  });

  it('persiste le compteur en base (résiste au redémarrage)', async () => {
    await consumeRateLimit('test:persistance', 10, 60);
    await consumeRateLimit('test:persistance', 10, 60);

    const row = await prisma.rateLimitCounter.findUniqueOrThrow({
      where: { key: 'test:persistance' },
    });
    expect(row.count).toBe(2);
  });

  it('remet un compteur à zéro sur demande (connexion réussie)', async () => {
    await consumeRateLimit('test:reset', 2, 60);
    await consumeRateLimit('test:reset', 2, 60);
    expect((await consumeRateLimit('test:reset', 2, 60)).allowed).toBe(false);

    await resetRateLimit('test:reset');
    expect((await consumeRateLimit('test:reset', 2, 60)).allowed).toBe(true);
  });

  it('purge les compteurs expirés', async () => {
    await prisma.rateLimitCounter.create({
      data: { key: 'expire', count: 5, expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.rateLimitCounter.create({
      data: { key: 'actif', count: 1, expiresAt: new Date(Date.now() + 60_000) },
    });

    const purged = await purgeExpiredRateLimits();
    expect(purged).toBe(1);
    expect(await prisma.rateLimitCounter.count()).toBe(1);
  });
});
