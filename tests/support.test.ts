import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExpert,
  createPortfolio,
  createSecondaryAdmin,
  createUserWithFarm,
  prisma,
  resetDatabase,
} from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { hashToken } from '../src/lib/auth/tokens';

/**
 * Demandes de support, de bout en bout.
 *
 * Qui reçoit la demande, qui la voit, ce que le demandeur voit et ne voit pas
 * (les notes internes), ce que valent une pièce jointe et un lien de suivi —
 * et ce qu'il advient quand on change un identifiant dans la requête.
 */

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function connecte(email: string, password: string): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.login(email, password)).status).toBe(200);
  return client;
}

describe('Support', () => {
  let nord: string;
  let sud: string;
  let farmNord: { id: string; customerNumber: string | null };
  let farmSud: { id: string; customerNumber: string | null };
  type Roles = 'general' | 'fermierNord' | 'fermierSud' | 'techSud' | 'adminNord' | 'adminSud';
  let ids: Record<Roles, string>;
  let c: Record<Roles | 'anonyme', TestClient>;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    const general = await createUserWithFarm({ email: 'general@parcelys.test', farmName: 'Siège', platformAdmin: true });
    nord = await createPortfolio('Nord');
    sud = await createPortfolio('Sud');
    const fermierNord = await createUserWithFarm({ email: 'alpha@ferme.test', farmName: 'GAEC Alpha' });
    const fermierSud = await createUserWithFarm({ email: 'bravo@ferme.test', farmName: 'EARL Bravo' });
    farmNord = await prisma.farm.update({ where: { id: fermierNord.farmId }, data: { portfolioId: nord } });
    farmSud = await prisma.farm.update({ where: { id: fermierSud.farmId }, data: { portfolioId: sud } });
    const techSud = await createExpert({ email: 'tech-sud@cabinet.test' });
    await prisma.user.update({ where: { id: techSud.id }, data: { portfolioId: sud } });
    const adminNord = await createSecondaryAdmin({ email: 'admin-nord@parcelys.test', portfolioIds: [nord] });
    const adminSud = await createSecondaryAdmin({ email: 'admin-sud@parcelys.test', portfolioIds: [sud] });

    ids = {
      general: general.id,
      fermierNord: fermierNord.id,
      fermierSud: fermierSud.id,
      techSud: techSud.id,
      adminNord: adminNord.id,
      adminSud: adminSud.id,
    };
    c = {
      general: await connecte(general.email, general.password),
      fermierNord: await connecte(fermierNord.email, fermierNord.password),
      fermierSud: await connecte(fermierSud.email, fermierSud.password),
      techSud: await connecte(techSud.email, techSud.password),
      adminNord: await connecte(adminNord.email, adminNord.password),
      adminSud: await connecte(adminSud.email, adminSud.password),
      anonyme: new TestClient(),
    };
  });

  const demande = { subject: 'Synchronisation bloquée', description: 'La file d’attente ne part plus depuis hier.' };

  // -------------------------------------------------------------------------
  describe('Attribution à la création', () => {
    it('attribue la demande d’un exploitant connecté à l’administrateur de son portefeuille', async () => {
      const r = await c.fermierNord.post<{ number: string; id: string }>('/api/support/tickets', demande);
      expect(r.status).toBe(201);
      expect(r.body.number).toMatch(/^DEM-\d{6}$/);

      const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(t).toMatchObject({
        identity: 'ACCOUNT',
        farmId: farmNord.id,
        portfolioId: nord,
        assigneeId: ids.adminNord,
        declaredNumber: farmNord.customerNumber,
        requesterId: ids.fermierNord,
        status: 'NEW',
      });
      // L'administrateur responsable est prévenu, et lui seul.
      const notes = await prisma.notification.findMany({ where: { type: 'SUPPORT' } });
      expect(notes.map((n) => n.userId)).toEqual([ids.adminNord]);
    });

    it('ignore l’exploitation et le numéro d’un autre client envoyés par un compte connecté', async () => {
      const r = await c.fermierNord.post<{ id: string }>('/api/support/tickets', {
        ...demande,
        farmId: farmSud.id,
        customerNumber: farmSud.customerNumber,
        name: 'Usurpateur',
        email: 'autre@exemple.test',
      });
      const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(t.farmId).toBe(farmNord.id);
      expect(t.portfolioId).toBe(nord);
      expect(t.requesterEmail).toBe('alpha@ferme.test');
      expect(t.declaredNumber).toBe(farmNord.customerNumber);
    });

    it('attribue la demande d’un technicien à son portefeuille', async () => {
      const r = await c.techSud.post<{ id: string }>('/api/support/tickets', demande);
      const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(t).toMatchObject({ technicianId: ids.techSud, portfolioId: sud, assigneeId: ids.adminSud });
    });

    it('achemine une demande anonyme par le numéro déclaré, sans la tenir pour vérifiée', async () => {
      const r = await c.anonyme.post<{ number: string; id: string | null; message: string }>(
        '/api/support/tickets',
        { ...demande, name: 'Bruno', email: 'bruno@exemple.test', customerNumber: farmSud.customerNumber },
      );
      expect(r.status).toBe(201);
      expect(r.body.id).toBeNull();
      const t = await prisma.supportTicket.findFirstOrThrow({ where: { number: r.body.number } });
      expect(t).toMatchObject({ identity: 'UNVERIFIED', portfolioId: sud, assigneeId: ids.adminSud, requesterId: null });
      expect(t.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);

      // Un numéro inexistant reçoit exactement la même réponse : le formulaire
      // n'est pas un moyen de tester des numéros.
      const inconnu = await c.anonyme.post<{ number: string; message: string }>('/api/support/tickets', {
        ...demande,
        name: 'Bruno',
        email: 'bruno@exemple.test',
        customerNumber: 'EXP-987654',
      });
      expect(inconnu.status).toBe(r.status);
      expect(inconnu.body.message.replace(inconnu.body.number, '')).toBe(r.body.message.replace(r.body.number, ''));
      const t2 = await prisma.supportTicket.findFirstOrThrow({ where: { number: inconnu.body.number } });
      expect(t2.portfolioId).toBeNull();
    });

    it('confie aux administrateurs généraux une demande sans client identifiable', async () => {
      const r = await c.anonyme.post<{ number: string }>('/api/support/tickets', {
        ...demande,
        name: 'Inconnu',
        email: 'inconnu@exemple.test',
      });
      const t = await prisma.supportTicket.findFirstOrThrow({ where: { number: r.body.number } });
      expect(t.portfolioId).toBeNull();
      const notes = await prisma.notification.findMany({ where: { type: 'SUPPORT' } });
      expect(notes.map((n) => n.userId)).toEqual([ids.general]);
    });

    it('exige nom et adresse d’un visiteur anonyme', async () => {
      const r = await c.anonyme.post<{ error: { details: Array<{ field: string }> } }>('/api/support/tickets', demande);
      expect(r.status).toBe(400);
      expect(r.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'email']));
    });

    it('n’enregistre rien quand le champ piège est rempli', async () => {
      const r = await c.anonyme.post<{ number: string | null }>('/api/support/tickets', {
        ...demande,
        name: 'Robot',
        email: 'robot@exemple.test',
        website: 'http://spam.example',
      });
      expect(r.status).toBe(201);
      expect(r.body.number).toBeNull();
      expect(await prisma.supportTicket.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Accès limité aux demandes', () => {
    async function deuxDemandes() {
      const n = await c.fermierNord.post<{ id: string }>('/api/support/tickets', { ...demande, subject: 'Demande du Nord' });
      const s = await c.fermierSud.post<{ id: string }>('/api/support/tickets', { ...demande, subject: 'Demande du Sud' });
      return { nordId: n.body.id, sudId: s.body.id };
    }

    it('ne montre à chaque secondaire que les demandes de son portefeuille', async () => {
      const { sudId } = await deuxDemandes();
      const liste = await c.adminNord.get<{ tickets: Array<{ subject: string }> }>('/api/admin/support?statut=toutes');
      expect(liste.body.tickets.map((t) => t.subject)).toEqual(['Demande du Nord']);

      for (const r of [
        await c.adminNord.get(`/api/admin/support/${sudId}`),
        await c.adminNord.patch(`/api/admin/support/${sudId}`, { action: 'status', status: 'CLOSED' }),
        await c.adminNord.post(`/api/admin/support/${sudId}/messages`, { body: 'Intrusion' }),
        await c.adminNord.patch(`/api/admin/support/${sudId}`, { action: 'assign', assigneeId: ids.adminNord }),
      ]) {
        expect(r.status).toBe(404);
      }
      const page = await c.adminNord.page(`/administration/support/${sudId}`);
      expect(page.status).toBe(404);
      expect(page.html).not.toContain('Demande du Sud');

      const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: sudId } });
      expect(t.status).toBe('NEW');
      expect(await prisma.supportMessage.count({ where: { ticketId: sudId } })).toBe(0);
    });

    it('montre tout à l’administrateur général', async () => {
      await deuxDemandes();
      const liste = await c.general.get<{ tickets: Array<{ subject: string }> }>('/api/admin/support?statut=toutes');
      expect(liste.body.tickets.map((t) => t.subject).sort()).toEqual(['Demande du Nord', 'Demande du Sud']);
    });

    it('ne laisse un demandeur voir que ses propres demandes', async () => {
      const { nordId, sudId } = await deuxDemandes();
      const mes = await c.fermierNord.get<{ tickets: Array<{ id: string }> }>('/api/support/tickets');
      expect(mes.body.tickets.map((t) => t.id)).toEqual([nordId]);
      expect((await c.fermierNord.get(`/api/support/tickets/${sudId}`)).status).toBe(404);
      expect((await c.fermierNord.post(`/api/support/tickets/${sudId}/messages`, { body: 'x' })).status).toBe(404);
      expect((await c.fermierNord.page(`/mes-demandes/${sudId}`)).status).toBe(404);
      expect((await c.anonyme.get('/api/support/tickets')).status).toBe(401);
    });

    it('cache les notes internes au demandeur et fait vivre les statuts', async () => {
      const { nordId } = await deuxDemandes();
      await c.adminNord.post(`/api/admin/support/${nordId}/messages`, { body: 'NOTE-SECRETE vérifier la file', internal: true });
      await c.adminNord.post(`/api/admin/support/${nordId}/messages`, { body: 'Pouvez-vous relancer la synchro ?' });

      let t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: nordId } });
      expect(t.status).toBe('WAITING_CUSTOMER');

      const vu = await c.fermierNord.get<{ ticket: { messages: Array<{ body: string; authorName: string }> } }>(
        `/api/support/tickets/${nordId}`,
      );
      expect(JSON.stringify(vu.body)).not.toContain('NOTE-SECRETE');
      expect(vu.body.ticket.messages.map((m) => m.body)).toEqual(['Pouvez-vous relancer la synchro ?']);
      expect(vu.body.ticket.messages[0]?.authorName).toBe('Équipe Parcelys');
      const page = await c.fermierNord.page(`/mes-demandes/${nordId}`);
      expect(page.html).not.toContain('NOTE-SECRETE');

      // Le demandeur est prévenu de la réponse, sans son contenu.
      const notif = await prisma.notification.findFirstOrThrow({ where: { userId: ids.fermierNord, type: 'SUPPORT' } });
      expect(notif.body).not.toContain('relancer');

      await c.fermierNord.post(`/api/support/tickets/${nordId}/messages`, { body: 'C’est reparti, merci.' });
      t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: nordId } });
      expect(t.status).toBe('IN_PROGRESS');

      await c.adminNord.patch(`/api/admin/support/${nordId}`, { action: 'status', status: 'CLOSED' });
      const refus = await c.fermierNord.post(`/api/support/tickets/${nordId}/messages`, { body: 'Encore une chose' });
      expect(refus.status).toBe(409);

      const evenements = await prisma.supportTicketEvent.findMany({
        where: { ticketId: nordId },
        orderBy: { createdAt: 'asc' },
        select: { kind: true, toValue: true },
      });
      expect(evenements.map((e) => `${e.kind}:${e.toValue}`)).toEqual([
        'CREATED:NEW',
        'STATUS_CHANGED:WAITING_CUSTOMER',
        'STATUS_CHANGED:IN_PROGRESS',
        'STATUS_CHANGED:CLOSED',
      ]);
    });

    it('n’attribue qu’à un gestionnaire du portefeuille, et réserve le transfert au général', async () => {
      const { nordId } = await deuxDemandes();
      const autre = await c.adminNord.patch(`/api/admin/support/${nordId}`, { action: 'assign', assigneeId: ids.adminSud });
      expect(autre.status).toBe(400);
      const transfert = await c.adminNord.patch(`/api/admin/support/${nordId}`, { action: 'transfer', portfolioId: sud });
      expect(transfert.status).toBe(403);

      const ok = await c.general.patch(`/api/admin/support/${nordId}`, { action: 'transfer', portfolioId: sud });
      expect(ok.status).toBe(200);
      expect((await c.adminNord.get(`/api/admin/support/${nordId}`)).status).toBe(404);
      const sudVoit = await c.adminSud.get<{ ticket: { assignee: { id: string } | null; farm: unknown } }>(
        `/api/admin/support/${nordId}`,
      );
      expect(sudVoit.status).toBe(200);
      expect(sudVoit.body.ticket.assignee?.id).toBe(ids.adminSud);
      // Le client concerné reste au Nord : il n'est pas révélé au Sud.
      expect(sudVoit.body.ticket.farm).toBeNull();
      expect(JSON.stringify(sudVoit.body)).not.toContain('GAEC Alpha');
    });
  });

  // -------------------------------------------------------------------------
  describe('Pièces jointes', () => {
    function formulaire(fichier: File): FormData {
      const form = new FormData();
      form.set('subject', demande.subject);
      form.set('description', demande.description);
      form.set('piece', fichier);
      return form;
    }

    it('accepte une image, la stocke hors de la racine publique et la sert aux seules personnes autorisées', async () => {
      const r = await c.fermierNord.postForm<{ id: string }>(
        '/api/support/tickets',
        formulaire(new File([PNG], 'capture écran.png', { type: 'image/png' })),
      );
      expect(r.status).toBe(201);
      const piece = await prisma.supportAttachment.findFirstOrThrow({ where: { ticketId: r.body.id } });
      expect(piece.fileName).toBe('capture écran.png');
      expect(piece.storageKey.startsWith(`support/${r.body.id}/`)).toBe(true);
      expect(piece.storageKey).not.toContain('capture');
      expect(existsSync(path.resolve(process.env.UPLOAD_DIR ?? './storage/documents', piece.storageKey))).toBe(true);

      const parLeDemandeur = await c.fermierNord.download(`/api/support/tickets/${r.body.id}/pieces/${piece.id}`);
      expect(parLeDemandeur.status).toBe(200);
      expect(parLeDemandeur.bytes.equals(PNG)).toBe(true);

      const parLAdmin = await c.adminNord.download(`/api/admin/support/${r.body.id}/pieces/${piece.id}`);
      expect(parLAdmin.status).toBe(200);
      expect(parLAdmin.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect(parLAdmin.headers.get('x-content-type-options')).toBe('nosniff');

      expect((await c.adminSud.download(`/api/admin/support/${r.body.id}/pieces/${piece.id}`)).status).toBe(404);
      expect((await c.fermierSud.download(`/api/support/tickets/${r.body.id}/pieces/${piece.id}`)).status).toBe(404);
      expect((await c.anonyme.download(`/api/support/tickets/${r.body.id}/pieces/${piece.id}`)).status).toBe(401);

      const trace = await prisma.auditLog.count({ where: { action: 'support.attachment_downloaded' } });
      expect(trace).toBe(2);
    });

    it('refuse un fichier déguisé, un format non prévu et un fichier trop lourd', async () => {
      const deguise = await c.fermierNord.postForm(
        '/api/support/tickets',
        formulaire(new File(['MZ executable'], 'photo.png', { type: 'image/png' })),
      );
      expect(deguise.status).toBe(400);

      const exe = await c.fermierNord.postForm(
        '/api/support/tickets',
        formulaire(new File([PNG], 'outil.exe', { type: 'application/octet-stream' })),
      );
      expect(exe.status).toBe(400);

      const html = await c.fermierNord.postForm(
        '/api/support/tickets',
        formulaire(new File(['<script>alert(1)</script>'], 'page.html', { type: 'text/html' })),
      );
      expect(html.status).toBe(400);

      const lourd = await c.fermierNord.postForm(
        '/api/support/tickets',
        formulaire(new File([Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])], 'gros.png', { type: 'image/png' })),
      );
      expect(lourd.status).toBe(400);

      expect(await prisma.supportTicket.count()).toBe(0);
      expect(await prisma.supportAttachment.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Suivi anonyme par lien', () => {
    async function demandeAnonyme(): Promise<{ id: string; token: string }> {
      const r = await c.anonyme.post<{ number: string }>('/api/support/tickets', {
        ...demande,
        name: 'Bruno',
        email: 'bruno@exemple.test',
        customerNumber: farmSud.customerNumber,
      });
      const t = await prisma.supportTicket.findFirstOrThrow({ where: { number: r.body.number } });
      // Le lien en clair ne part que par e-mail : le test en pose un connu.
      const token = 'jeton-de-suivi-connu-pour-le-test-0123456789';
      await prisma.supportTicket.update({
        where: { id: t.id },
        data: { accessTokenHash: hashToken(token), accessTokenExpiresAt: new Date(Date.now() + 3600_000) },
      });
      return { id: t.id, token };
    }

    it('confirme l’adresse sur un clic explicite, et permet de répondre', async () => {
      const { id, token } = await demandeAnonyme();
      const page = await c.anonyme.page(`/contact/suivi/${token}`);
      expect(page.status).toBe(200);
      expect(page.html).toContain('Je confirme mon adresse');
      // Ouvrir le lien ne confirme rien.
      expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id } })).identity).toBe('UNVERIFIED');

      const conf = await c.anonyme.post('/api/support/suivi', { token, action: 'confirmer' });
      expect(conf.status).toBe(200);
      expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id } })).identity).toBe('EMAIL_CONFIRMED');

      await c.adminSud.post(`/api/admin/support/${id}/messages`, { body: 'NOTE-SECRETE', internal: true });
      const rep = await c.anonyme.post('/api/support/suivi', { token, action: 'repondre', body: 'Voici le détail.' });
      expect(rep.status).toBe(201);
      const apres = await c.anonyme.page(`/contact/suivi/${token}`);
      expect(apres.html).toContain('Voici le détail.');
      expect(apres.html).not.toContain('NOTE-SECRETE');
    });

    it('refuse un lien inconnu ou expiré, sans distinguer les deux', async () => {
      const { id, token } = await demandeAnonyme();
      const faux = await c.anonyme.post<{ error: { message: string } }>('/api/support/suivi', {
        token: 'jeton-qui-n-existe-pas-du-tout-0000000000',
        action: 'confirmer',
      });
      expect(faux.status).toBe(404);
      await prisma.supportTicket.update({ where: { id }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
      const expire = await c.anonyme.post<{ error: { message: string } }>('/api/support/suivi', { token, action: 'confirmer' });
      expect(expire.status).toBe(404);
      expect(expire.body.error.message).toBe(faux.body.error.message);
      const page = await c.anonyme.page(`/contact/suivi/${token}`);
      expect(page.html).toContain('Lien de suivi invalide');
      expect(page.html).not.toContain(demande.description);
    });

    it('n’ouvre avec un lien que les pièces de sa propre demande', async () => {
      const { token } = await demandeAnonyme();
      const autre = await c.fermierNord.postForm<{ id: string }>(
        '/api/support/tickets',
        (() => {
          const f = new FormData();
          f.set('subject', 'Autre');
          f.set('description', 'Une autre demande, avec pièce.');
          f.set('piece', new File([PNG], 'a.png', { type: 'image/png' }));
          return f;
        })(),
      );
      const piece = await prisma.supportAttachment.findFirstOrThrow({ where: { ticketId: autre.body.id } });
      const r = await c.anonyme.download(`/contact/suivi/${token}/pieces/${piece.id}`);
      expect(r.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Formulaire de contact', () => {
    it('préremplit le numéro client d’un compte connecté', async () => {
      const page = await c.fermierNord.page('/contact');
      expect(page.status).toBe(200);
      expect(page.html).toContain(farmNord.customerNumber ?? 'absent');
      expect(page.html).not.toContain('Votre adresse e-mail');
      const contexte = await c.fermierNord.get<{ farms: Array<{ customerNumber: string }> }>('/api/support/contexte');
      expect(contexte.body.farms.map((f) => f.customerNumber)).toEqual([farmNord.customerNumber]);
    });

    it('demande nom et adresse à un visiteur', async () => {
      const page = await c.anonyme.page('/contact');
      expect(page.status).toBe(200);
      expect(page.html).toContain('Votre adresse e-mail');
      expect(page.html).toContain('Numéro client');
    });
  });
});
