import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase, createUserWithFarm } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { hashToken } from '../src/lib/auth/tokens';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

describe('Authentification', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  // -------------------------------------------------------------------------
  describe('Inscription', () => {
    const validPayload = {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@ferme.test',
      password: 'MotDePasse1',
      passwordConfirmation: 'MotDePasse1',
      farmName: 'GAEC des Prés',
      acceptTerms: true,
      acceptPrivacy: true,
    };

    it('crée le compte, l’exploitation et le référentiel de cultures', async () => {
      const client = new TestClient();
      const response = await client.post<{ email: string }>(
        '/api/auth/register',
        validPayload,
      );

      expect(response.status).toBe(201);
      expect(response.body.email).toBe(validPayload.email);

      const user = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: validPayload.email },
        include: { memberships: { include: { farm: true } } },
      });

      // L'adresse n'est pas vérifiée : aucune session n'est ouverte.
      expect(user.emailVerifiedAt).toBeNull();
      expect(client.hasSession()).toBe(false);

      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]?.role).toBe('OWNER');
      expect(user.memberships[0]?.farm.name).toBe('GAEC des Prés');

      const crops = await prisma.crop.count({
        where: { farmId: user.memberships[0]?.farmId },
      });
      expect(crops).toBeGreaterThan(20);
    });

    it('ne stocke jamais le mot de passe en clair', async () => {
      await new TestClient().post('/api/auth/register', validPayload);

      const user = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: validPayload.email },
      });

      expect(user.passwordHash).not.toContain(validPayload.password);
      expect(user.passwordHash.length).toBeGreaterThan(50);
      expect(await verifyPassword(validPayload.password, user.passwordHash)).toBe(true);
    });

    it('émet un code de vérification haché, jamais en clair', async () => {
      await new TestClient().post('/api/auth/register', validPayload);

      const code = await prisma.emailVerificationCode.findFirstOrThrow({
        where: { email: validPayload.email },
      });

      expect(code.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(code.attempts).toBe(0);
      expect(code.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuse une adresse e-mail déjà utilisée', async () => {
      const client = new TestClient();
      await client.post('/api/auth/register', validPayload);

      const second = await client.post<{ error: { code: string } }>(
        '/api/auth/register',
        validPayload,
      );
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });

    it('refuse un mot de passe trop faible et signale le champ', async () => {
      const response = await new TestClient().post<{
        error: { code: string; details: Array<{ field: string }> };
      }>('/api/auth/register', {
        ...validPayload,
        password: 'motdepasse',
        passwordConfirmation: 'motdepasse',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.some((d) => d.field === 'password')).toBe(true);
    });

    it('refuse une confirmation de mot de passe différente', async () => {
      const response = await new TestClient().post<{
        error: { details: Array<{ field: string }> };
      }>('/api/auth/register', {
        ...validPayload,
        passwordConfirmation: 'MotDePasse2',
      });

      expect(response.status).toBe(400);
      expect(
        response.body.error.details.some((d) => d.field === 'passwordConfirmation'),
      ).toBe(true);
    });

    it('exige l’acceptation des CGU et de la politique de confidentialité', async () => {
      const response = await new TestClient().post('/api/auth/register', {
        ...validPayload,
        acceptTerms: false,
      });
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Connexion', () => {
    it('ouvre une session avec un cookie HttpOnly', async () => {
      const user = await createUserWithFarm({
        email: 'connexion@ferme.test',
        farmName: 'Ferme Connexion',
      });

      const client = new TestClient();
      const response = await client.login(user.email, user.password);

      expect(response.status).toBe(200);
      expect(client.hasSession()).toBe(true);

      const cookies = response.headers.getSetCookie();
      const sessionCookie = cookies.find((c) => c.startsWith('parcelys_session='));
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=lax');

      // Le jeton n'est stocké qu'en empreinte côté serveur.
      const raw = sessionCookie?.split(';')[0]?.split('=')[1] ?? '';
      const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).toBe(hashToken(decodeURIComponent(raw)));
      expect(session.tokenHash).not.toBe(raw);
    });

    it('refuse un mauvais mot de passe sans révéler l’existence du compte', async () => {
      const user = await createUserWithFarm({
        email: 'mauvais@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      const wrongPassword = await client.login(user.email, 'MauvaisMotDePasse1');
      const unknownAccount = await client.login('inconnu@ferme.test', 'MotDePasse1');

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      // Message identique dans les deux cas : pas d'énumération de comptes.
      expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(unknownAccount.body));
      expect(client.hasSession()).toBe(false);
    });

    it('incrémente le compteur d’échecs puis verrouille le compte', async () => {
      const user = await createUserWithFarm({
        email: 'bruteforce@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      for (let i = 0; i < 7; i += 1) {
        await client.login(user.email, 'Incorrect123');
      }

      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(before.failedLoginCount).toBe(7);

      const locking = await client.login(user.email, 'Incorrect123');
      expect(locking.status).toBe(423);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.lockedUntil).not.toBeNull();

      // Même avec le bon mot de passe, le compte reste verrouillé.
      const correct = await client.login(user.email, user.password);
      expect(correct.status).toBe(423);
    });

    it('remet le compteur d’échecs à zéro après une connexion réussie', async () => {
      const user = await createUserWithFarm({
        email: 'reset-compteur@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      await client.login(user.email, 'Incorrect123');
      await client.login(user.email, 'Incorrect123');
      await client.login(user.email, user.password);

      const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(record.failedLoginCount).toBe(0);
      expect(record.lastLoginAt).not.toBeNull();
    });

    it('refuse la connexion tant que l’adresse e-mail n’est pas vérifiée', async () => {
      const client = new TestClient();
      await client.post('/api/auth/register', {
        firstName: 'Non',
        lastName: 'Vérifié',
        email: 'non-verifie@ferme.test',
        password: 'MotDePasse1',
        passwordConfirmation: 'MotDePasse1',
        farmName: 'Ferme',
        acceptTerms: true,
        acceptPrivacy: true,
      });

      const response = await client.login('non-verifie@ferme.test', 'MotDePasse1');
      expect(response.status).toBe(403);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'EMAIL_NOT_VERIFIED',
      );
      expect(client.hasSession()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Vérification de l’adresse e-mail', () => {
    async function prepareUser() {
      const user = await prisma.user.create({
        data: {
          email: 'verif@ferme.test',
          emailNormalized: 'verif@ferme.test',
          passwordHash: await hashPassword('MotDePasse1'),
          firstName: 'Alice',
          lastName: 'Martin',
          acceptedTermsAt: new Date(),
          acceptedPrivacyAt: new Date(),
        },
      });
      const farm = await prisma.farm.create({
        data: {
          name: 'Ferme Vérif',
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      return { user, farm };
    }

    /** Insère un code connu du test (le code réel n'est jamais lisible en base). */
    async function issueKnownCode(userId: string, code: string, expiresInMs = 900_000) {
      return prisma.emailVerificationCode.create({
        data: {
          userId,
          email: 'verif@ferme.test',
          codeHash: hashToken(code),
          purpose: 'EMAIL_VERIFICATION',
          expiresAt: new Date(Date.now() + expiresInMs),
        },
      });
    }

    it('valide l’adresse et ouvre la session avec le bon code', async () => {
      const { user } = await prepareUser();
      await issueKnownCode(user.id, '123456');

      const client = new TestClient();
      const response = await client.post('/api/auth/verify-email', {
        email: 'verif@ferme.test',
        code: '123456',
      });

      expect(response.status).toBe(200);
      expect(client.hasSession()).toBe(true);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updated.emailVerifiedAt).not.toBeNull();
    });

    it('refuse un code incorrect et compte la tentative', async () => {
      const { user } = await prepareUser();
      const record = await issueKnownCode(user.id, '123456');

      const response = await new TestClient().post('/api/auth/verify-email', {
        email: 'verif@ferme.test',
        code: '000000',
      });

      expect(response.status).toBe(400);

      const updated = await prisma.emailVerificationCode.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(updated.attempts).toBe(1);
      expect(updated.consumedAt).toBeNull();

      const stillUnverified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stillUnverified.emailVerifiedAt).toBeNull();
    });

    it('refuse un code expiré', async () => {
      const { user } = await prepareUser();
      await issueKnownCode(user.id, '123456', -1000);

      const response = await new TestClient().post<{ error: { code: string } }>(
        '/api/auth/verify-email',
        { email: 'verif@ferme.test', code: '123456' },
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CODE_EXPIRED');
    });

    it('bloque le code après le nombre maximal de tentatives', async () => {
      const { user } = await prepareUser();
      const record = await issueKnownCode(user.id, '123456');

      const client = new TestClient();
      for (let i = 0; i < 5; i += 1) {
        await client.post('/api/auth/verify-email', {
          email: 'verif@ferme.test',
          code: '111111',
        });
      }

      const updated = await prisma.emailVerificationCode.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(updated.attempts).toBe(5);

      // Même le bon code est désormais refusé : il faut en demander un nouveau.
      const withGoodCode = await client.post<{ error: { code: string } }>(
        '/api/auth/verify-email',
        { email: 'verif@ferme.test', code: '123456' },
      );
      expect(withGoodCode.status).toBe(429);
      expect(withGoodCode.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('invalide le code précédent lors d’un renvoi', async () => {
      const { user } = await prepareUser();
      const first = await issueKnownCode(user.id, '123456');

      const response = await new TestClient().post('/api/auth/resend-code', {
        email: 'verif@ferme.test',
      });
      expect(response.status).toBe(200);

      const oldCode = await prisma.emailVerificationCode.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(oldCode.consumedAt).not.toBeNull();

      const active = await prisma.emailVerificationCode.count({
        where: { userId: user.id, consumedAt: null },
      });
      expect(active).toBe(1);
    });

    it('répond de façon identique pour une adresse inconnue', async () => {
      const response = await new TestClient().post('/api/auth/resend-code', {
        email: 'jamais-inscrit@ferme.test',
      });
      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('Réinitialisation du mot de passe', () => {
    it('émet un jeton haché et ne révèle pas l’existence du compte', async () => {
      const user = await createUserWithFarm({
        email: 'reset@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      const known = await client.post('/api/auth/forgot-password', { email: user.email });
      const unknown = await client.post('/api/auth/forgot-password', {
        email: 'inexistant@ferme.test',
      });

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(JSON.stringify(known.body)).toBe(JSON.stringify(unknown.body));

      const token = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('applique le nouveau mot de passe et révoque toutes les sessions', async () => {
      const user = await createUserWithFarm({
        email: 'reset2@ferme.test',
        farmName: 'Ferme',
      });

      const sessionClient = new TestClient();
      await sessionClient.login(user.email, user.password);
      expect((await sessionClient.get('/api/parcels')).status).toBe(200);

      const rawToken = 'jeton-de-test-suffisamment-long-1234567890';
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });

      const response = await new TestClient().post('/api/auth/reset-password', {
        token: rawToken,
        password: 'NouveauSecret1',
        passwordConfirmation: 'NouveauSecret1',
      });
      expect(response.status).toBe(200);

      // L'ancienne session ne fonctionne plus.
      expect((await sessionClient.get('/api/parcels')).status).toBe(401);

      const fresh = new TestClient();
      expect((await fresh.login(user.email, 'NouveauSecret1')).status).toBe(200);
      expect((await new TestClient().login(user.email, user.password)).status).toBe(401);
    });

    it('refuse un jeton expiré ou déjà consommé', async () => {
      const user = await createUserWithFarm({
        email: 'reset3@ferme.test',
        farmName: 'Ferme',
      });

      const expiredToken = 'jeton-expire-suffisamment-long-1234567890';
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(expiredToken),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const expired = await new TestClient().post<{ error: { code: string } }>(
        '/api/auth/reset-password',
        {
          token: expiredToken,
          password: 'NouveauSecret1',
          passwordConfirmation: 'NouveauSecret1',
        },
      );
      expect(expired.status).toBe(400);
      expect(expired.body.error.code).toBe('INVALID_TOKEN');

      const usedToken = 'jeton-consomme-suffisamment-long-1234567890';
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(usedToken),
          expiresAt: new Date(Date.now() + 600_000),
          consumedAt: new Date(),
        },
      });

      const used = await new TestClient().post('/api/auth/reset-password', {
        token: usedToken,
        password: 'NouveauSecret1',
        passwordConfirmation: 'NouveauSecret1',
      });
      expect(used.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Sessions', () => {
    it('la déconnexion révoque la session courante', async () => {
      const user = await createUserWithFarm({
        email: 'logout@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      await client.login(user.email, user.password);
      expect((await client.get('/api/parcels')).status).toBe(200);

      await client.post('/api/auth/logout');
      expect((await client.get('/api/parcels')).status).toBe(401);
    });

    it('la déconnexion de tous les appareils ferme toutes les sessions', async () => {
      const user = await createUserWithFarm({
        email: 'logout-all@ferme.test',
        farmName: 'Ferme',
      });

      const phone = new TestClient();
      const desktop = new TestClient();
      await phone.login(user.email, user.password);
      await desktop.login(user.email, user.password);

      expect((await phone.get('/api/parcels')).status).toBe(200);
      expect((await desktop.get('/api/parcels')).status).toBe(200);

      await desktop.post('/api/auth/logout-all');

      expect((await phone.get('/api/parcels')).status).toBe(401);
      expect((await desktop.get('/api/parcels')).status).toBe(401);

      const active = await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(active).toBe(0);
    });

    it('une session révoquée en base est immédiatement rejetée', async () => {
      const user = await createUserWithFarm({
        email: 'revoke@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      await client.login(user.email, user.password);

      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });

      expect((await client.get('/api/parcels')).status).toBe(401);
    });

    it('une session expirée est rejetée', async () => {
      const user = await createUserWithFarm({
        email: 'expire@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      await client.login(user.email, user.password);

      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await client.get('/api/parcels')).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('Protection CSRF', () => {
    it('rejette une requête mutante provenant d’une autre origine', async () => {
      const user = await createUserWithFarm({
        email: 'csrf@ferme.test',
        farmName: 'Ferme',
      });

      const client = new TestClient();
      await client.login(user.email, user.password);

      const response = await client.request(
        'POST',
        '/api/parcels',
        { name: 'Parcelle forgée' },
        { Origin: 'https://site-malveillant.test' },
      );

      expect(response.status).toBe(403);
      expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_BLOCKED');
      expect(await prisma.parcel.count()).toBe(0);
    });
  });
});
