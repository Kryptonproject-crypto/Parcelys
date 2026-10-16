import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExpert,
  createPortfolio,
  createSecondaryAdmin,
  createUserWithFarm,
  grantAdvisoryAccess,
  prisma,
  resetDatabase,
} from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

/**
 * Administration multi-niveaux, de bout en bout : serveur compilé, base
 * réelle, vraie chaîne HTTP.
 *
 * Deux portefeuilles, Nord et Sud, chacun avec une exploitation, un
 * technicien et son administrateur secondaire ; un administrateur général
 * au-dessus. Les tests vérifient ce que voit chacun, ce qu'il peut faire, et
 * surtout ce qu'il **ne peut pas** faire — y compris en tapant une adresse ou
 * en changeant un identifiant dans une requête.
 */

type Monde = Awaited<ReturnType<typeof monde>>;

async function connecte(email: string, password: string): Promise<TestClient> {
  const client = new TestClient();
  const r = await client.login(email, password);
  expect(r.status, `connexion de ${email}`).toBe(200);
  return client;
}

async function monde() {
  const general = await createUserWithFarm({
    email: 'general@parcelys.test',
    farmName: 'Ferme du Général',
    platformAdmin: true,
  });
  const nord = await createPortfolio('Nord');
  const sud = await createPortfolio('Sud');

  const fermierNord = await createUserWithFarm({ email: 'alpha@ferme.test', farmName: 'GAEC Alpha' });
  const fermierSud = await createUserWithFarm({ email: 'bravo@ferme.test', farmName: 'EARL Bravo' });
  await prisma.farm.update({ where: { id: fermierNord.farmId }, data: { portfolioId: nord } });
  await prisma.farm.update({ where: { id: fermierSud.farmId }, data: { portfolioId: sud } });

  const techNord = await createExpert({ email: 'tech-nord@cabinet.test' });
  const techSud = await createExpert({ email: 'tech-sud@cabinet.test' });
  await prisma.user.update({ where: { id: techNord.id }, data: { portfolioId: nord } });
  await prisma.user.update({ where: { id: techSud.id }, data: { portfolioId: sud } });

  const adminNord = await createSecondaryAdmin({ email: 'admin-nord@parcelys.test', portfolioIds: [nord] });
  const adminSud = await createSecondaryAdmin({ email: 'admin-sud@parcelys.test', portfolioIds: [sud] });

  const [farmNord, farmSud, tNord, tSud] = await Promise.all([
    prisma.farm.findUniqueOrThrow({ where: { id: fermierNord.farmId } }),
    prisma.farm.findUniqueOrThrow({ where: { id: fermierSud.farmId } }),
    prisma.user.findUniqueOrThrow({ where: { id: techNord.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: techSud.id } }),
  ]);

  return {
    nord,
    sud,
    general,
    fermierNord,
    fermierSud,
    techNord,
    techSud,
    adminNord,
    adminSud,
    farmNord,
    farmSud,
    numeroNord: farmNord.customerNumber ?? '',
    numeroSud: farmSud.customerNumber ?? '',
    tecNord: tNord.technicianNumber ?? '',
    tecSud: tSud.technicianNumber ?? '',
    c: {
      general: await connecte(general.email, general.password),
      adminNord: await connecte(adminNord.email, adminNord.password),
      adminSud: await connecte(adminSud.email, adminSud.password),
      fermierNord: await connecte(fermierNord.email, fermierNord.password),
      fermierSud: await connecte(fermierSud.email, fermierSud.password),
    },
  };
}

/** Rien de ce qui appartient au Sud ne doit apparaître dans `texte`. */
function sansTraceDuSud(m: Monde, texte: string): void {
  for (const trace of [
    'EARL Bravo',
    'bravo@ferme.test',
    'tech-sud@cabinet.test',
    m.numeroSud,
    m.tecSud,
    m.farmSud.id,
    m.techSud.id,
    m.fermierSud.id,
    'admin-sud@parcelys.test',
  ]) {
    expect(texte, `fuite : « ${trace} »`).not.toContain(trace);
  }
}

describe('Administration multi-niveaux', () => {
  let m: Monde;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    m = await monde();
  });

  // -------------------------------------------------------------------------
  describe('Administrateur général', () => {
    it('voit toute l’instance : les deux portefeuilles, leurs clients et leurs techniciens', async () => {
      const farms = await m.c.general.get<{ farms: Array<{ name: string; portfolioName: string | null }>; total: number }>(
        '/api/admin/farms',
      );
      expect(farms.status).toBe(200);
      const noms = farms.body.farms.map((f) => f.name);
      expect(noms).toEqual(expect.arrayContaining(['GAEC Alpha', 'EARL Bravo', 'Ferme du Général']));

      const experts = await m.c.general.get<{ experts: Array<{ email: string }> }>('/api/admin/experts');
      expect(experts.body.experts.map((e) => e.email)).toEqual(
        expect.arrayContaining(['tech-nord@cabinet.test', 'tech-sud@cabinet.test']),
      );

      const users = await m.c.general.get<{ total: number }>('/api/admin/users');
      expect(users.body.total).toBe(7);
    });

    it('accède à la maintenance, au serveur, au journal et aux portefeuilles', async () => {
      expect((await m.c.general.get('/api/admin/maintenance')).status).toBe(200);
      expect((await m.c.general.get('/api/admin/portefeuilles')).status).toBe(200);
      expect((await m.c.general.get('/api/admin/administrateurs')).status).toBe(200);
      for (const page of [
        '/administration/maintenance',
        '/administration/serveur',
        '/administration/journal',
        '/administration/portefeuilles',
        '/administration/administrateurs',
        '/administration/aide',
      ]) {
        const r = await m.c.general.page(page);
        expect(r.status, page).toBe(200);
        expect(r.html, page).not.toContain('server-side exception');
      }
    });

    it('rend toutes les pages d’administration, fiches comprises', async () => {
      const ticket = await m.c.fermierSud.post<{ id: string }>('/api/support/tickets', {
        subject: 'Page de test',
        description: 'Une demande pour afficher sa fiche.',
      });
      for (const [page, attendu] of [
        ['/administration', 'Administration générale'],
        ['/administration/support', 'Demandes de support'],
        [`/administration/support/${ticket.body.id}`, 'Page de test'],
        ['/administration/exploitations', 'GAEC Alpha'],
        [`/administration/exploitations/${m.farmSud.id}`, m.numeroSud],
        ['/administration/experts', 'tech-sud@cabinet.test'],
        [`/administration/experts/${m.techSud.id}`, m.tecSud],
        ['/administration/utilisateurs', 'bravo@ferme.test'],
        ['/administration/invitations', 'Invitations'],
        ['/administration/administrateurs', 'admin-nord@parcelys.test'],
        ['/administration/portefeuilles', 'Nord'],
        [`/administration/portefeuilles/${m.sud}`, 'EARL Bravo'],
        ['/administration/aide', 'Création et accès au compte'],
        ['/administration/serveur', 'Compteurs de numéros'],
      ] as const) {
        const r = await m.c.general.page(page);
        expect(r.status, page).toBe(200);
        expect(r.html, page).not.toContain('server-side exception');
        expect(r.html, page).toContain(attendu);
      }
    });

    it('retrouve n’importe quel client par son numéro', async () => {
      const r = await m.c.general.get<{ url: string }>(`/api/admin/recherche?q=${m.numeroSud}`);
      expect(r.status).toBe(200);
      expect(r.body.url).toBe(`/administration/exploitations/${m.farmSud.id}`);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cloisonnement de deux portefeuilles', () => {
    it('ne liste à chaque secondaire que les clients de son portefeuille', async () => {
      const [farms, experts, users, invitations, stats] = await Promise.all([
        m.c.adminNord.get('/api/admin/farms'),
        m.c.adminNord.get('/api/admin/experts'),
        m.c.adminNord.get('/api/admin/users'),
        m.c.adminNord.get('/api/admin/invitations'),
        m.c.adminNord.page('/administration'),
      ]);
      for (const r of [farms, experts, users, invitations]) expect(r.status).toBe(200);

      const tout = JSON.stringify([farms.body, experts.body, users.body, invitations.body]) + stats.html;
      sansTraceDuSud(m, tout);
      expect(tout).toContain('GAEC Alpha');
      expect(tout).toContain('tech-nord@cabinet.test');
      // Et pas le compte du général ni sa ferme, hors de tout portefeuille.
      expect(JSON.stringify(farms.body)).not.toContain('Ferme du Général');
      expect(JSON.stringify(users.body)).not.toContain('general@parcelys.test');
    });

    it('rend au secondaire ses pages, avec son rôle et son périmètre affichés', async () => {
      for (const [page, attendu] of [
        ['/administration', 'Administration de portefeuille'],
        ['/administration/support', 'celles de vos portefeuilles'],
        ['/administration/exploitations', 'GAEC Alpha'],
        [`/administration/exploitations/${m.farmNord.id}`, m.numeroNord],
        ['/administration/experts', 'tech-nord@cabinet.test'],
        ['/administration/utilisateurs', 'alpha@ferme.test'],
        ['/administration/invitations', 'vos portefeuilles'],
      ] as const) {
        const r = await m.c.adminNord.page(page);
        expect(r.status, page).toBe(200);
        expect(r.html, page).toContain(attendu);
        expect(r.html, page).toContain('Administrateur secondaire');
        expect(r.html, page).toContain('Nord');
        sansTraceDuSud(m, r.html);
      }
    });

    it('borne les compteurs du tableau de bord au portefeuille', async () => {
      // Une parcelle et un traitement chez le Sud : ils ne doivent pas être comptés au Nord.
      await prisma.parcel.create({ data: { farmId: m.farmSud.id, name: 'Sud 1', areaHa: 12 } });
      const page = await m.c.adminNord.page('/administration');
      expect(page.status).toBe(200);
      expect(page.html).toContain('Administration de portefeuille');
      expect(page.html).not.toContain('12,0 ha');
    });

    it('ne laisse pas un secondaire voir les administrateurs, ni lui-même dans les comptes', async () => {
      const users = await m.c.adminNord.get<{ users: Array<{ email: string }> }>('/api/admin/users?statut=admins');
      expect(users.status).toBe(200);
      expect(users.body.users).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Accès direct par URL et identifiants modifiés', () => {
    it('rend introuvables, par l’adresse, les fiches d’un autre portefeuille', async () => {
      for (const page of [
        `/administration/exploitations/${m.farmSud.id}`,
        `/administration/experts/${m.techSud.id}`,
      ]) {
        const r = await m.c.adminNord.page(page);
        expect(r.status, page).toBe(404);
        // L'identifiant tapé dans l'adresse est repris par la page 404 : ce
        // n'est pas une fuite. Tout le reste doit être absent.
        sansTraceDuSud(m, r.html.replaceAll(m.farmSud.id, '').replaceAll(m.techSud.id, ''));
      }
      // Les siennes s'ouvrent.
      expect((await m.c.adminNord.page(`/administration/exploitations/${m.farmNord.id}`)).status).toBe(200);
      expect((await m.c.adminNord.page(`/administration/experts/${m.techNord.id}`)).status).toBe(200);
    });

    it('refuse d’agir sur un compte du Sud en changeant l’identifiant dans la requête', async () => {
      const r = await m.c.adminNord.patch(`/api/admin/users/${m.fermierSud.id}`, { action: 'suspend' });
      expect(r.status).toBe(404);
      const sud = await prisma.user.findUniqueOrThrow({ where: { id: m.fermierSud.id } });
      expect(sud.suspendedAt).toBeNull();
    });

    it('refuse d’agir sur un administrateur, y compris un autre secondaire ou soi-même', async () => {
      for (const id of [m.adminSud.id, m.adminNord.id, m.general.id]) {
        const r = await m.c.adminNord.patch(`/api/admin/users/${id}`, { action: 'suspend' });
        expect(r.status, id).toBe(404);
      }
    });

    it('refuse un compte partagé avec une exploitation hors périmètre', async () => {
      // Le fermier du Nord est aussi membre de la ferme du Sud.
      await prisma.farmMember.create({
        data: { farmId: m.farmSud.id, userId: m.fermierNord.id, role: 'VIEWER' },
      });
      const r = await m.c.adminNord.patch(`/api/admin/users/${m.fermierNord.id}`, { action: 'revoke-sessions' });
      expect(r.status).toBe(403);
      // Et la liste ne trahit pas l'exploitation du Sud.
      const users = await m.c.adminNord.get('/api/admin/users');
      sansTraceDuSud(m, JSON.stringify(users.body));
    });

    it('ne trouve pas, par la recherche, le numéro d’un client du Sud', async () => {
      for (const numero of [m.numeroSud, m.tecSud]) {
        const r = await m.c.adminNord.get<{ error: { message: string } }>(`/api/admin/recherche?q=${numero}`);
        expect(r.status).toBe(404);
        // Même réponse que pour un numéro qui n'existe pas.
        const inexistant = await m.c.adminNord.get<{ error: { message: string } }>('/api/admin/recherche?q=EXP-987654');
        expect(r.body.error.message).toBe(inexistant.body.error.message);
      }
      const page = await m.c.adminNord.page(`/administration/recherche?q=${m.numeroSud}`);
      expect(page.status).toBe(200);
      expect(page.html).toContain('Aucun résultat');
    });

    it('n’exporte que son périmètre', async () => {
      for (const type of ['exploitations', 'techniciens', 'comptes', 'demandes']) {
        const r = await m.c.adminNord.download(`/api/admin/exports?type=${type}`);
        expect(r.status, type).toBe(200);
        expect(r.contentType).toContain('text/csv');
        sansTraceDuSud(m, r.bytes.toString('utf8'));
      }
      const nord = await m.c.adminNord.download('/api/admin/exports?type=exploitations');
      expect(nord.bytes.toString('utf8')).toContain(m.numeroNord);
      // Le général, lui, exporte tout.
      const tout = await m.c.general.download('/api/admin/exports?type=exploitations');
      expect(tout.bytes.toString('utf8')).toContain(m.numeroSud);
    });

    it('ne laisse pas ouvrir une mission entre portefeuilles', async () => {
      const croisee = await m.c.adminNord.post('/api/admin/experts', {
        expertId: m.techNord.id,
        farmId: m.farmSud.id,
      });
      expect(croisee.status).toBe(404);
      const autreTech = await m.c.adminNord.post('/api/admin/experts', {
        expertId: m.techSud.id,
        farmId: m.farmNord.id,
      });
      expect(autreTech.status).toBe(404);
      expect(await prisma.advisoryEngagement.count()).toBe(0);
    });

    it('ne laisse pas révoquer un code d’invitation du Sud', async () => {
      const code = await m.c.adminSud.post<{ invitation: { id: string } }>('/api/admin/invitations', {
        role: 'OWNER',
      });
      expect(code.status).toBe(201);
      const r = await m.c.adminNord.delete(`/api/admin/invitations/${code.body.invitation.id}`);
      expect(r.status).toBe(404);
    });

    it('n’ouvre à aucun administrateur les parcelles d’une exploitation', async () => {
      const parcel = await prisma.parcel.create({ data: { farmId: m.farmNord.id, name: 'Privée', areaHa: 1 } });
      expect((await m.c.adminNord.get(`/api/parcels/${parcel.id}`)).status).toBe(404);
      expect((await m.c.general.get(`/api/parcels/${parcel.id}`)).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Fonctions réservées à l’administrateur général', () => {
    it('refuse au secondaire la maintenance, le serveur, les administrateurs et les portefeuilles', async () => {
      const appels = [
        m.c.adminNord.get('/api/admin/maintenance'),
        m.c.adminNord.post('/api/admin/maintenance', { enabled: true }),
        m.c.adminNord.post('/api/admin/cleanup', { targets: ['sessions'] }),
        m.c.adminNord.get('/api/admin/updates'),
        m.c.adminNord.get('/api/admin/administrateurs'),
        m.c.adminNord.post('/api/admin/administrateurs', { newPortfolioName: 'Pirate' }),
        m.c.adminNord.get('/api/admin/portefeuilles'),
        m.c.adminNord.post('/api/admin/portefeuilles', { name: 'Pirate' }),
        m.c.adminNord.post('/api/admin/portefeuilles/affectations', {
          kind: 'farm',
          ids: [m.farmSud.id],
          portfolioId: m.nord,
        }),
        m.c.adminNord.get('/api/admin/faq'),
        m.c.adminNord.get('/api/regulatory/referentials'),
        m.c.adminNord.post('/api/admin/farms', { action: 'delete', farmId: m.farmNord.id }),
        m.c.adminNord.delete(`/api/admin/users/${m.fermierNord.id}`),
      ];
      for (const r of await Promise.all(appels)) expect(r.status).toBe(403);

      const maintenance = await prisma.appSetting.findUnique({ where: { key: 'maintenance.enabled' } });
      expect(maintenance?.value ?? 'false').not.toBe('true');
      expect(await prisma.managementPortfolio.count({ where: { name: 'Pirate' } })).toBe(0);
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: m.farmSud.id } });
      expect(farm.portfolioId).toBe(m.sud);
    });

    it('renvoie le secondaire vers son tableau de bord s’il tape l’adresse d’une page réservée', async () => {
      for (const page of [
        '/administration/maintenance',
        '/administration/serveur',
        '/administration/journal',
        '/administration/referentiels',
        '/administration/administrateurs',
        '/administration/portefeuilles',
        '/administration/aide',
      ]) {
        const r = await m.c.adminNord.page(page);
        expect([303, 307, 308], page).toContain(r.status);
        expect(r.location, page).toMatch(/\/administration$/);
      }
    });

    it('empêche le secondaire de s’attribuer des privilèges ou de créer un administrateur', async () => {
      const general = await m.c.adminNord.patch(`/api/admin/users/${m.adminNord.id}`, {
        action: 'set-platform-admin',
        value: true,
      });
      expect(general.status).toBe(403);

      const codeAdmin = await m.c.adminNord.post('/api/admin/invitations', {
        accountType: 'ADMIN',
        role: 'OWNER',
      });
      expect(codeAdmin.status).toBe(403);

      const codeGeneral = await m.c.adminNord.post('/api/admin/invitations', {
        role: 'OWNER',
        grantsPlatformAdmin: true,
      });
      expect(codeGeneral.status).toBe(403);

      const moi = await prisma.user.findUniqueOrThrow({ where: { id: m.adminNord.id } });
      expect(moi.isPlatformAdmin).toBe(false);
      expect(await prisma.invitationCode.count({ where: { grantsPlatformAdmin: true } })).toBe(0);
    });

    it('journalise la tentative refusée', async () => {
      await m.c.adminNord.get('/api/admin/maintenance');
      const trace = await prisma.auditLog.findFirst({
        where: { action: 'access.denied', userId: m.adminNord.id },
      });
      expect(trace?.metadata).toMatchObject({ permission: 'maintenance:manage', role: 'SECONDARY' });
    });

    it('bloque le secondaire pendant la maintenance, pas le général', async () => {
      await m.c.general.post('/api/admin/maintenance', { enabled: true, message: 'Mise à jour' });
      expect((await m.c.adminNord.get('/api/admin/farms')).status).toBe(503);
      expect((await m.c.general.get('/api/admin/farms')).status).toBe(200);
      await m.c.general.post('/api/admin/maintenance', { enabled: false });
    });
  });

  // -------------------------------------------------------------------------
  describe('Administrateurs secondaires', () => {
    it('se crée par invitation, avec un nouveau portefeuille, et ne voit que lui', async () => {
      const code = await m.c.general.post<{ code: string; invitation: { portfolioId: string } }>(
        '/api/admin/administrateurs',
        { newPortfolioName: 'Bocage', email: 'camille@parcelys.test' },
      );
      expect(code.status).toBe(201);

      const inscription = await new TestClient().post('/api/auth/register', {
        firstName: 'Camille',
        lastName: 'Gestion',
        email: 'camille@parcelys.test',
        password: 'MotDePasse1',
        passwordConfirmation: 'MotDePasse1',
        acceptTerms: true,
        acceptPrivacy: true,
        invitationCode: code.body.code,
      });
      expect(inscription.status).toBe(201);

      const camille = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: 'camille@parcelys.test' },
        include: { managedPortfolios: { include: { portfolio: true } } },
      });
      expect(camille.accountType).toBe('ADMIN');
      expect(camille.isSecondaryAdmin).toBe(true);
      expect(camille.isPlatformAdmin).toBe(false);
      expect(camille.managedPortfolios.map((p) => p.portfolio.name)).toEqual(['Bocage']);
      expect(await prisma.farmMember.count({ where: { userId: camille.id } })).toBe(0);

      await prisma.user.update({ where: { id: camille.id }, data: { emailVerifiedAt: new Date() } });
      const client = await connecte('camille@parcelys.test', 'MotDePasse1');
      const farms = await client.get<{ farms: unknown[] }>('/api/admin/farms');
      expect(farms.status).toBe(200);
      expect(farms.body.farms).toHaveLength(0);

      const trace = await prisma.auditLog.count({ where: { action: 'admin.secondary_invited' } });
      expect(trace).toBe(1);
    });

    it('s’élargit d’un portefeuille, se réduit, se désactive, se réactive et se révoque', async () => {
      const add = await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, {
        action: 'add-portfolio',
        portfolioId: m.sud,
      });
      expect(add.status).toBe(200);
      const vu = await m.c.adminNord.get('/api/admin/farms');
      expect(JSON.stringify(vu.body)).toContain('EARL Bravo');

      await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, {
        action: 'remove-portfolio',
        portfolioId: m.sud,
      });
      sansTraceDuSud(m, JSON.stringify((await m.c.adminNord.get('/api/admin/farms')).body));

      await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, { action: 'deactivate' });
      expect((await m.c.adminNord.get('/api/admin/farms')).status).toBe(401);
      expect((await new TestClient().login(m.adminNord.email, m.adminNord.password)).status).not.toBe(200);

      await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, { action: 'reactivate' });
      const revenu = await connecte(m.adminNord.email, m.adminNord.password);
      expect((await revenu.get('/api/admin/farms')).status).toBe(200);

      await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, { action: 'revoke' });
      const apres = await prisma.user.findUniqueOrThrow({
        where: { id: m.adminNord.id },
        include: { managedPortfolios: true },
      });
      expect(apres.isSecondaryAdmin).toBe(false);
      expect(apres.managedPortfolios).toHaveLength(0);
      const encore = await connecte(m.adminNord.email, m.adminNord.password);
      expect((await encore.get('/api/admin/farms')).status).toBe(403);

      const actions = await prisma.auditLog.findMany({
        where: { entityId: m.adminNord.id, action: { startsWith: 'admin.secondary_' } },
        select: { action: true },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'admin.secondary_scope_added',
          'admin.secondary_scope_removed',
          'admin.secondary_deactivated',
          'admin.secondary_reactivated',
          'admin.secondary_revoked',
        ]),
      );
    });

    it('gère plusieurs portefeuilles indépendants pour un même administrateur', async () => {
      const troisieme = await createPortfolio('Est');
      const ferme = await prisma.farm.create({ data: { name: 'SCEA Charlie', portfolioId: troisieme } });
      await m.c.general.patch(`/api/admin/administrateurs/${m.adminNord.id}`, {
        action: 'add-portfolio',
        portfolioId: troisieme,
      });
      const farms = await m.c.adminNord.get<{ farms: Array<{ name: string }> }>('/api/admin/farms');
      expect(farms.body.farms.map((f) => f.name).sort()).toEqual(['GAEC Alpha', 'SCEA Charlie']);
      expect(ferme.customerNumber).toMatch(/^EXP-/);
    });
  });

  // -------------------------------------------------------------------------
  describe('Affectation et transfert des clients', () => {
    it('transfère une exploitation, ses codes en attente et ses demandes, et le journalise', async () => {
      const ticket = await m.c.fermierNord.post<{ number: string }>('/api/support/tickets', {
        subject: 'Question de stock',
        description: 'Le stock ne se décompte pas comme prévu.',
      });
      expect(ticket.status).toBe(201);

      const r = await m.c.general.post<{ moved: number; ticketsMoved: number }>(
        '/api/admin/portefeuilles/affectations',
        { kind: 'farm', ids: [m.farmNord.id], portfolioId: m.sud },
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ moved: 1, ticketsMoved: 1 });

      // Le Nord a perdu la ferme et sa demande ; le Sud les a.
      expect((await m.c.adminNord.page(`/administration/exploitations/${m.farmNord.id}`)).status).toBe(404);
      const sud = await m.c.adminSud.get<{ tickets: Array<{ number: string }> }>('/api/admin/support?statut=toutes');
      expect(sud.body.tickets.map((t) => t.number)).toContain(ticket.body.number);
      const nord = await m.c.adminNord.get<{ tickets: unknown[] }>('/api/admin/support?statut=toutes');
      expect(nord.body.tickets).toHaveLength(0);

      const trace = await prisma.auditLog.findFirstOrThrow({ where: { action: 'portfolio.client_assigned' } });
      expect(trace.metadata).toMatchObject({
        kind: 'farm',
        customerNumber: m.numeroNord,
        fromPortfolio: 'Nord',
        toPortfolio: 'Sud',
      });
    });

    it('transfère un technicien et retire un client de tout portefeuille', async () => {
      await m.c.general.post('/api/admin/portefeuilles/affectations', {
        kind: 'technician',
        ids: [m.techNord.id],
        portfolioId: m.sud,
      });
      const sud = await m.c.adminSud.get('/api/admin/experts');
      expect(JSON.stringify(sud.body)).toContain('tech-nord@cabinet.test');

      await m.c.general.post('/api/admin/portefeuilles/affectations', {
        kind: 'farm',
        ids: [m.farmSud.id],
        portfolioId: null,
      });
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: m.farmSud.id } });
      expect(farm.portfolioId).toBeNull();
      expect(farm.customerNumber).toBe(m.numeroSud);
    });

    it('refuse de supprimer un portefeuille qui contient encore des clients', async () => {
      const r = await m.c.general.delete(`/api/admin/portefeuilles/${m.nord}`);
      expect(r.status).toBe(409);
      expect(await prisma.managementPortfolio.count({ where: { id: m.nord } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Techniciens et invitations du secondaire', () => {
    it('invite un technicien dans son portefeuille, puis lui confie une exploitation du sien', async () => {
      const code = await m.c.adminNord.post<{ code: string; invitation: { portfolioId: string } }>(
        '/api/admin/invitations',
        { accountType: 'AGRONOMIST', role: 'OWNER' },
      );
      expect(code.status).toBe(201);
      expect(code.body.invitation.portfolioId).toBe(m.nord);

      const inscription = await new TestClient().post('/api/auth/register', {
        firstName: 'Dominique',
        lastName: 'Conseil',
        email: 'dominique@cabinet.test',
        password: 'MotDePasse1',
        passwordConfirmation: 'MotDePasse1',
        acceptTerms: true,
        acceptPrivacy: true,
        organization: 'Cabinet Nord',
        invitationCode: code.body.code,
      });
      expect(inscription.status).toBe(201);
      const tech = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: 'dominique@cabinet.test' } });
      expect(tech.technicianNumber).toMatch(/^TEC-\d{6}$/);
      expect(tech.portfolioId).toBe(m.nord);

      const mission = await m.c.adminNord.post('/api/admin/experts', { expertId: tech.id, farmId: m.farmNord.id });
      expect(mission.status).toBe(201);
      const engagement = await prisma.advisoryEngagement.findFirstOrThrow({ where: { expertId: tech.id } });
      const fin = await m.c.adminNord.delete('/api/admin/experts', { engagementId: engagement.id });
      expect(fin.status).toBe(200);
    });

    it('fait arriver dans son portefeuille l’exploitation créée avec son code', async () => {
      const code = await m.c.adminNord.post<{ code: string }>('/api/admin/invitations', { role: 'OWNER' });
      const inscription = await new TestClient().post('/api/auth/register', {
        firstName: 'Eva',
        lastName: 'Nouvelle',
        email: 'eva@ferme.test',
        password: 'MotDePasse1',
        passwordConfirmation: 'MotDePasse1',
        acceptTerms: true,
        acceptPrivacy: true,
        farmName: 'Ferme Delta',
        invitationCode: code.body.code,
      });
      expect(inscription.status).toBe(201);
      const delta = await prisma.farm.findFirstOrThrow({ where: { name: 'Ferme Delta' } });
      expect(delta.portfolioId).toBe(m.nord);
      expect(delta.customerNumber).toMatch(/^EXP-\d{6}$/);
    });

    it('ne laisse pas le secondaire viser le portefeuille d’un autre', async () => {
      const r = await m.c.adminNord.post('/api/admin/invitations', { role: 'OWNER', portfolioId: m.sud });
      expect(r.status).toBe(404);
      const rejoindre = await m.c.adminNord.post('/api/admin/invitations', {
        role: 'EMPLOYEE',
        farmId: m.farmSud.id,
      });
      expect(rejoindre.status).toBe(404);
    });

    it('voit les missions de ses techniciens sur ses exploitations seulement', async () => {
      await grantAdvisoryAccess({ farmId: m.farmSud.id, expertId: m.techNord.id });
      const r = await m.c.adminNord.get('/api/admin/experts');
      sansTraceDuSud(m, JSON.stringify(r.body));
    });
  });

  // -------------------------------------------------------------------------
  describe('Comptes existants et régression', () => {
    it('garde aux administrateurs existants leur accès complet', async () => {
      // `createUserWithFarm({ platformAdmin: true })` crée un compte comme avant
      // la 0.11.0 : `is_platform_admin` seul. Il est administrateur général.
      const r = await m.c.general.get<{ users: Array<{ email: string; adminRole: string | null }> }>(
        '/api/admin/users?statut=admins',
      );
      expect(r.body.users.map((u) => [u.email, u.adminRole])).toEqual(
        expect.arrayContaining([
          ['general@parcelys.test', 'GENERAL'],
          ['admin-nord@parcelys.test', 'SECONDARY'],
        ]),
      );
    });

    it('affiche le numéro client dans le profil de l’exploitant', async () => {
      const r = await m.c.fermierNord.page('/profil');
      expect(r.status).toBe(200);
      expect(r.html).toContain(m.numeroNord);
    });

    it('n’ouvre pas l’administration à un exploitant', async () => {
      expect((await m.c.fermierNord.get('/api/admin/farms')).status).toBe(403);
      const page = await m.c.fermierNord.page('/administration');
      expect([303, 307, 308]).toContain(page.status);
    });
  });
});
