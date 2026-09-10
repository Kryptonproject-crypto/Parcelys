import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { TestClient, startServer, stopServer } from './helpers/server';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import { hashToken } from '../src/lib/auth/tokens';

/**
 * Changement de l'adresse e-mail du compte.
 *
 * Ce que ces tests protègent : **l'adresse e-mail est l'identifiant de
 * connexion**, et c'est là qu'arrivent les liens de réinitialisation de mot de
 * passe. La modifier sans vérification donnerait à quiconque passe devant un
 * écran resté ouvert le moyen de s'approprier le compte définitivement — il
 * suffirait ensuite de demander un mot de passe oublié.
 *
 * Trois garanties sont vérifiées ici, dans cet ordre d'importance :
 *
 *   1. l'adresse ne bouge pas tant que le code n'est pas saisi ;
 *   2. le code prouve le contrôle de la **nouvelle** adresse — c'est là qu'il
 *      part, pas à l'ancienne ;
 *   3. une session ouverte ne suffit pas : le mot de passe est redemandé.
 */

/**
 * Retrouve le code en clair par force brute sur son empreinte.
 *
 * Les codes ne sont stockés que hachés — c'est justement ce qu'on veut — et le
 * courriel n'est pas capturé par les tests. Six chiffres se parcourent en une
 * fraction de seconde, ce qui évite d'ajouter au code de production une porte
 * de sortie qui n'existerait que pour les tests.
 */
async function codeEnClair(userId: string): Promise<string> {
  const record = await prisma.emailVerificationCode.findFirstOrThrow({
    where: { userId, purpose: 'EMAIL_CHANGE', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidat = String(n).padStart(6, '0');
    if (hashToken(candidat) === record.codeHash) return candidat;
  }
  throw new Error('Code introuvable — le format a changé ?');
}

async function connecte(email: string, password: string): Promise<TestClient> {
  const client = new TestClient();
  const reponse = await client.login(email, password);
  expect(reponse.status).toBe(200);
  return client;
}

describe('Changement d’adresse e-mail', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('Demande', () => {
    it('exige le mot de passe : une session ouverte ne prouve rien', async () => {
      const user = await createUserWithFarm({
        email: 'kevin@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);

      const refus = await client.post<{ error: { code: string } }>('/api/profile/email', {
        newEmail: 'nouvelle@ferme.test',
        currentPassword: 'PasLeBon1',
      });
      expect(refus.status).toBe(400);
      expect(refus.body.error.code).toBe('INVALID_PASSWORD');

      // Et surtout : aucun code n'a été émis pour un mot de passe faux.
      expect(
        await prisma.emailVerificationCode.count({
          where: { userId: user.id, purpose: 'EMAIL_CHANGE' },
        }),
      ).toBe(0);
    });

    it('n’écrit pas la nouvelle adresse sur le compte avant confirmation', async () => {
      const user = await createUserWithFarm({
        email: 'kevin2@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);

      const demande = await client.post<{ newEmail: string }>('/api/profile/email', {
        newEmail: 'nouvelle2@ferme.test',
        currentPassword: user.password,
      });
      expect(demande.status).toBe(200);
      expect(demande.body.newEmail).toBe('nouvelle2@ferme.test');

      // Le compte est toujours joignable à l'ancienne adresse. C'est ce qui
      // permet à son propriétaire de reprendre la main si la demande ne venait
      // pas de lui.
      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { email: true, emailNormalized: true },
      });
      expect(enBase.email).toBe('kevin2@ferme.test');
      expect(enBase.emailNormalized).toBe('kevin2@ferme.test');
    });

    it('stocke la nouvelle adresse dans le code, et le code haché', async () => {
      const user = await createUserWithFarm({
        email: 'kevin3@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle3@ferme.test',
        currentPassword: user.password,
      });

      const record = await prisma.emailVerificationCode.findFirstOrThrow({
        where: { userId: user.id, purpose: 'EMAIL_CHANGE' },
      });
      expect(record.email).toBe('nouvelle3@ferme.test');
      expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(record.attempts).toBe(0);
    });

    it('refuse une adresse déjà prise par un autre compte', async () => {
      const user = await createUserWithFarm({
        email: 'kevin4@ferme.test',
        farmName: 'GAEC Essai',
      });
      await createUserWithFarm({ email: 'occupee@ferme.test', farmName: 'Autre GAEC' });
      const client = await connecte(user.email, user.password);

      const refus = await client.post<{ error: { code: string } }>('/api/profile/email', {
        newEmail: 'occupee@ferme.test',
        currentPassword: user.password,
      });
      expect(refus.status).toBe(409);
      expect(refus.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('refuse l’adresse déjà rattachée au compte', async () => {
      const user = await createUserWithFarm({
        email: 'kevin5@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);

      const refus = await client.post<{ error: { code: string } }>('/api/profile/email', {
        newEmail: 'KEVIN5@ferme.test',
        currentPassword: user.password,
      });
      expect(refus.status).toBe(400);
      expect(refus.body.error.code).toBe('SAME_EMAIL');
    });

    it('impose un délai avant de pouvoir redemander un code', async () => {
      // Sans ce délai, le bouton « renvoyer » devient un moyen d'inonder une
      // boîte qui n'est pas la sienne.
      const user = await createUserWithFarm({
        email: 'kevin6@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);

      const premier = await client.post('/api/profile/email', {
        newEmail: 'nouvelle6@ferme.test',
        currentPassword: user.password,
      });
      expect(premier.status).toBe(200);

      const second = await client.post<{ error: { code: string } }>('/api/profile/email', {
        newEmail: 'nouvelle6@ferme.test',
        currentPassword: user.password,
      });
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('RESEND_TOO_SOON');
    });

    it('renvoie un code une fois le délai écoulé, et invalide le précédent', async () => {
      const user = await createUserWithFarm({
        email: 'kevin7@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle7@ferme.test',
        currentPassword: user.password,
      });

      const ancien = await prisma.emailVerificationCode.findFirstOrThrow({
        where: { userId: user.id, purpose: 'EMAIL_CHANGE' },
      });
      const ancienCode = await codeEnClair(user.id);

      // On recule la date d'émission plutôt que d'attendre une minute.
      await prisma.emailVerificationCode.update({
        where: { id: ancien.id },
        data: { createdAt: new Date(Date.now() - 120_000) },
      });

      const renvoi = await client.post('/api/profile/email', {
        newEmail: 'nouvelle7@ferme.test',
        currentPassword: user.password,
      });
      expect(renvoi.status).toBe(200);

      // L'ancien code ne doit plus marcher : sinon un code périmé permettrait
      // de confirmer une adresse que l'utilisateur a corrigée depuis.
      const avecAncien = await client.put<{ error: { code: string } }>('/api/profile/email', {
        code: ancienCode,
      });
      expect(avecAncien.status).toBe(400);

      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { email: true },
      });
      expect(enBase.email).toBe('kevin7@ferme.test');
    });
  });

  describe('Confirmation', () => {
    it('change l’adresse avec le bon code, et la marque vérifiée', async () => {
      const user = await createUserWithFarm({
        email: 'kevin8@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle8@ferme.test',
        currentPassword: user.password,
      });

      const code = await codeEnClair(user.id);
      const confirme = await client.put<{ email: string }>('/api/profile/email', {
        code,
      });
      expect(confirme.status).toBe(200);
      expect(confirme.body.email).toBe('nouvelle8@ferme.test');

      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { email: true, emailNormalized: true, emailVerifiedAt: true },
      });
      expect(enBase.email).toBe('nouvelle8@ferme.test');
      expect(enBase.emailNormalized).toBe('nouvelle8@ferme.test');
      // Le code vient de prouver l'adresse : redemander une vérification
      // laisserait le compte en attente sans raison.
      expect(enBase.emailVerifiedAt).not.toBeNull();
    });

    it('permet ensuite de se connecter avec la nouvelle adresse, plus l’ancienne', async () => {
      const user = await createUserWithFarm({
        email: 'kevin9@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle9@ferme.test',
        currentPassword: user.password,
      });
      await client.put('/api/profile/email', { code: await codeEnClair(user.id) });

      const avecNouvelle = await new TestClient().login('nouvelle9@ferme.test', user.password);
      expect(avecNouvelle.status).toBe(200);

      const avecAncienne = await new TestClient().login('kevin9@ferme.test', user.password);
      expect(avecAncienne.status).not.toBe(200);
    });

    it('compte les tentatives et finit par refuser le code', async () => {
      const user = await createUserWithFarm({
        email: 'kevin10@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle10@ferme.test',
        currentPassword: user.password,
      });

      const vrai = await codeEnClair(user.id);
      const faux = vrai === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        const essai = await client.put<{ error: { code: string } }>('/api/profile/email', {
          code: faux,
        });
        expect(essai.status).toBe(400);
      }

      // Au sixième, le code est bloqué — même le bon ne passe plus.
      const bloque = await client.put<{ error: { code: string } }>('/api/profile/email', {
        code: vrai,
      });
      expect(bloque.status).toBe(429);
      expect(bloque.body.error.code).toBe('TOO_MANY_ATTEMPTS');

      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { email: true },
      });
      expect(enBase.email).toBe('kevin10@ferme.test');
    });

    it('refuse un code expiré et le dit', async () => {
      const user = await createUserWithFarm({
        email: 'kevin11@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle11@ferme.test',
        currentPassword: user.password,
      });

      const code = await codeEnClair(user.id);
      await prisma.emailVerificationCode.updateMany({
        where: { userId: user.id, purpose: 'EMAIL_CHANGE', consumedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const expire = await client.put<{ error: { code: string } }>('/api/profile/email', {
        code,
      });
      expect(expire.status).toBe(400);
      expect(expire.body.error.code).toBe('CODE_EXPIRED');
    });

    it('refuse un code déjà consommé : on ne change pas deux fois avec le même', async () => {
      const user = await createUserWithFarm({
        email: 'kevin12@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle12@ferme.test',
        currentPassword: user.password,
      });

      const code = await codeEnClair(user.id);
      expect((await client.put('/api/profile/email', { code })).status).toBe(200);
      expect((await client.put('/api/profile/email', { code })).status).toBe(400);
    });

    it('refuse une confirmation sans demande en cours', async () => {
      const user = await createUserWithFarm({
        email: 'kevin13@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);

      const sansDemande = await client.put<{ error: { code: string } }>('/api/profile/email', {
        code: '123456',
      });
      expect(sansDemande.status).toBe(400);
    });
  });

  describe('Demande en cours', () => {
    it('se retrouve après un retour sur la page, et s’annule', async () => {
      const user = await createUserWithFarm({
        email: 'kevin14@ferme.test',
        farmName: 'GAEC Essai',
      });
      const client = await connecte(user.email, user.password);
      await client.post('/api/profile/email', {
        newEmail: 'nouvelle14@ferme.test',
        currentPassword: user.password,
      });

      const etat = await client.get<{ pending: { newEmail: string } | null }>(
        '/api/profile/email',
      );
      expect(etat.body.pending?.newEmail).toBe('nouvelle14@ferme.test');

      const annule = await client.delete<{ cancelled: boolean }>('/api/profile/email');
      expect(annule.body.cancelled).toBe(true);

      const apres = await client.get<{ pending: unknown }>('/api/profile/email');
      expect(apres.body.pending).toBeNull();
    });
  });

  describe('Cloisonnement', () => {
    it('un code émis pour un compte ne vaut rien sur un autre', async () => {
      const kevin = await createUserWithFarm({
        email: 'kevin15@ferme.test',
        farmName: 'GAEC Essai',
      });
      const autre = await createUserWithFarm({
        email: 'autre15@ferme.test',
        farmName: 'Autre GAEC',
      });

      const clientKevin = await connecte(kevin.email, kevin.password);
      await clientKevin.post('/api/profile/email', {
        newEmail: 'nouvelle15@ferme.test',
        currentPassword: kevin.password,
      });
      const code = await codeEnClair(kevin.id);

      const clientAutre = await connecte(autre.email, autre.password);
      const vol = await clientAutre.put<{ error: { code: string } }>('/api/profile/email', {
        code,
      });
      expect(vol.status).toBe(400);

      // Ni l'un ni l'autre n'a changé d'adresse.
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: autre.id } })).email,
      ).toBe('autre15@ferme.test');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: kevin.id } })).email,
      ).toBe('kevin15@ferme.test');
    });

    it('refuse la demande à qui n’est pas connecté', async () => {
      const anonyme = new TestClient();
      const refus = await anonyme.post('/api/profile/email', {
        newEmail: 'quiconque@ferme.test',
        currentPassword: 'MotDePasse1',
      });
      expect(refus.status).toBe(401);
    });
  });
});
