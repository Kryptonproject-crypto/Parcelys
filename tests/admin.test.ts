import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExpert,
  createInvitationCode,
  createUserWithFarm,
  grantAdvisoryAccess,
  prisma,
  resetDatabase,
} from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

/**
 * Administration de l'instance et inscription fermée.
 *
 * Deux propriétés comptent ici et sont vérifiées de bout en bout, serveur
 * démarré et base réelle :
 *  - personne ne crée de compte sans code délivré par un administrateur ;
 *  - la section d'administration est inaccessible aux comptes ordinaires,
 *    y compris en appelant l'API directement.
 */
describe('Administration', () => {
  const REGISTRATION = {
    firstName: 'Nouvel',
    lastName: 'Arrivant',
    email: 'nouvel.arrivant@ferme.test',
    password: 'MotDePasse1',
    passwordConfirmation: 'MotDePasse1',
    acceptTerms: true,
    acceptPrivacy: true,
  };

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

  /** Un administrateur d'instance connecté, et une exploitation ordinaire. */
  async function setup() {
    const admin = await createUserWithFarm({
      email: 'admin@parcelys.test',
      farmName: 'Exploitation Pilote',
      platformAdmin: true,
    });
    const member = await createUserWithFarm({
      email: 'agriculteur@ferme.test',
      farmName: 'GAEC Ordinaire',
    });

    const adminClient = new TestClient();
    await adminClient.login(admin.email, admin.password);

    const memberClient = new TestClient();
    await memberClient.login(member.email, member.password);

    return { admin, member, adminClient, memberClient };
  }

  // -------------------------------------------------------------------------
  describe('Contrôle d’accès', () => {
    it('refuse toutes les routes d’administration à un compte ordinaire', async () => {
      const { memberClient, member } = await setup();

      const calls = [
        await memberClient.get('/api/admin/users'),
        await memberClient.get('/api/admin/invitations'),
        await memberClient.get('/api/admin/maintenance'),
        await memberClient.post('/api/admin/invitations', { role: 'OWNER' }),
        await memberClient.post('/api/admin/maintenance', { enabled: true }),
        await memberClient.post('/api/admin/cleanup', { targets: ['sessions'] }),
        await memberClient.patch(`/api/admin/users/${member.id}`, { action: 'unlock' }),
      ];

      for (const response of calls) {
        expect(response.status).toBe(403);
      }
    });

    it('refuse l’administration à un visiteur non authentifié', async () => {
      await setup();
      const anonymous = new TestClient();
      expect((await anonymous.get('/api/admin/users')).status).toBe(401);
    });

    it('autorise l’administrateur d’instance', async () => {
      const { adminClient } = await setup();

      const users = await adminClient.get<{ users: unknown[]; count: number }>(
        '/api/admin/users',
      );
      expect(users.status).toBe(200);
      expect(users.body.count).toBe(2);
    });

    it('n’ouvre aucun accès aux parcelles des autres exploitations', async () => {
      const { adminClient, member } = await setup();

      // L'administrateur d'instance reste étranger aux données agronomiques.
      const parcel = await prisma.parcel.create({
        data: {
          farmId: member.farmId,
          name: 'Parcelle privée',
          areaHa: 1,
        },
      });

      const response = await adminClient.get(`/api/parcels/${parcel.id}`);
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('Codes d’invitation', () => {
    it('ne renvoie le code en clair qu’à la création et ne stocke que son empreinte', async () => {
      const { adminClient } = await setup();

      const response = await adminClient.post<{
        code: string;
        invitation: { id: string };
      }>('/api/admin/invitations', { role: 'OWNER', validityDays: 7 });

      expect(response.status).toBe(201);
      expect(response.body.code).toMatch(/^PRCL(-[A-Z0-9]{4}){3}$/);

      const stored = await prisma.invitationCode.findUniqueOrThrow({
        where: { id: response.body.invitation.id },
      });
      expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.codeHash).not.toContain(response.body.code);

      // La liste ne réexpose jamais le code.
      const list = await adminClient.get<{ invitations: Array<Record<string, unknown>> }>(
        '/api/admin/invitations',
      );
      expect(JSON.stringify(list.body)).not.toContain(response.body.code);
    });

    it('crée un compte rattaché à l’exploitation prévue avec le rôle prévu', async () => {
      const { admin, adminClient } = await setup();

      const created = await adminClient.post<{ code: string }>('/api/admin/invitations', {
        farmId: admin.farmId,
        role: 'EMPLOYEE',
        validityDays: 7,
      });

      const registration = await new TestClient().post<{ email: string }>(
        '/api/auth/register',
        { ...REGISTRATION, invitationCode: created.body.code },
      );
      expect(registration.status).toBe(201);

      const user = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: REGISTRATION.email },
        include: { memberships: true },
      });
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]?.farmId).toBe(admin.farmId);
      expect(user.memberships[0]?.role).toBe('EMPLOYEE');
      // Aucune exploitation supplémentaire n'a été créée.
      expect(await prisma.farm.count()).toBe(2);
    });

    it('crée une exploitation propre lorsque le code n’en désigne aucune', async () => {
      const { adminClient } = await setup();
      const created = await adminClient.post<{ code: string }>('/api/admin/invitations', {
        role: 'OWNER',
      });

      const registration = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        farmName: 'Nouvelle Exploitation',
        invitationCode: created.body.code,
      });
      expect(registration.status).toBe(201);

      const user = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: REGISTRATION.email },
        include: { memberships: { include: { farm: true } } },
      });
      expect(user.memberships[0]?.role).toBe('OWNER');
      expect(user.memberships[0]?.farm.name).toBe('Nouvelle Exploitation');
    });

    it('exige le nom de l’exploitation quand le code n’en désigne aucune', async () => {
      const { adminClient } = await setup();
      const created = await adminClient.post<{ code: string }>('/api/admin/invitations', {
        role: 'OWNER',
      });

      const response = await new TestClient().post<{
        error: { code: string; details: Array<{ field: string }> };
      }>('/api/auth/register', { ...REGISTRATION, invitationCode: created.body.code });

      expect(response.status).toBe(400);
      expect(response.body.error.details.some((d) => d.field === 'farmName')).toBe(true);
    });

    it('n’accepte un code qu’une seule fois', async () => {
      const { admin } = await setup();
      const { code } = await createInvitationCode({
        code: 'PRCL-AAAA-BBBB-CCCC',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
      });

      const first = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        invitationCode: code,
      });
      expect(first.status).toBe(201);

      const second = await new TestClient().post<{ error: { code: string } }>(
        '/api/auth/register',
        { ...REGISTRATION, email: 'second@ferme.test', invitationCode: code },
      );
      expect(second.status).toBe(403);
      expect(second.body.error.code).toBe('INVITATION_INVALID');
    });

    it('refuse un code expiré, révoqué ou inconnu de la même façon', async () => {
      const { admin, adminClient } = await setup();

      await createInvitationCode({
        code: 'PRCL-EXPI-RED0-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
        expiresInMs: -1000,
      });
      await createInvitationCode({
        code: 'PRCL-REVO-QUE0-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
        revoked: true,
      });

      for (const code of [
        'PRCL-EXPI-RED0-0001',
        'PRCL-REVO-QUE0-0001',
        'PRCL-ZZZZ-ZZZZ-ZZZZ',
      ]) {
        const response = await new TestClient().post<{ error: { code: string } }>(
          '/api/auth/register',
          { ...REGISTRATION, invitationCode: code },
        );
        expect(response.status, code).toBe(403);
        expect(response.body.error.code, code).toBe('INVITATION_INVALID');
      }

      // Aucun compte n'a été créé au passage.
      const list = await adminClient.get<{ count: number }>('/api/admin/users');
      expect(list.body.count).toBe(2);
    });

    it('respecte la restriction d’adresse e-mail', async () => {
      const { admin } = await setup();
      await createInvitationCode({
        code: 'PRCL-MAIL-ONLY-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
        email: 'attendu@ferme.test',
      });

      const wrong = await new TestClient().post<{ error: { code: string } }>(
        '/api/auth/register',
        { ...REGISTRATION, invitationCode: 'PRCL-MAIL-ONLY-0001' },
      );
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

      const right = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        email: 'attendu@ferme.test',
        invitationCode: 'PRCL-MAIL-ONLY-0001',
      });
      expect(right.status).toBe(201);
    });

    it('accepte le code quelle que soit sa mise en forme', async () => {
      const { admin } = await setup();
      await createInvitationCode({
        code: 'PRCL-CASE-TEST-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
      });

      const response = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        invitationCode: '  prcl case test 0001 ',
      });
      expect(response.status).toBe(201);
    });

    it('révoque un code non utilisé', async () => {
      const { admin, adminClient } = await setup();
      const invitation = await createInvitationCode({
        code: 'PRCL-TOBE-REVO-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'VIEWER',
      });

      const revoke = await adminClient.delete(`/api/admin/invitations/${invitation.id}`);
      expect(revoke.status).toBe(200);

      const response = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        invitationCode: invitation.code,
      });
      expect(response.status).toBe(403);
    });

    it('confirme un code valide sans le consommer', async () => {
      const { admin } = await setup();
      await createInvitationCode({
        code: 'PRCL-CHEC-KING-0001',
        createdById: admin.id,
        farmId: admin.farmId,
        role: 'ADMIN',
      });

      const response = await new TestClient().post<{
        scope: string;
        role: string;
        farmName: string;
      }>('/api/auth/invitation/check', { code: 'PRCL-CHEC-KING-0001' });

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('EXISTING_FARM');
      expect(response.body.role).toBe('ADMIN');
      expect(response.body.farmName).toBe('Exploitation Pilote');

      const stored = await prisma.invitationCode.findFirstOrThrow({});
      expect(stored.usedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('Gestion des comptes', () => {
    it('accepte tous les filtres proposés par l’interface', async () => {
      const { adminClient } = await setup();

      // La liste des onglets de filtrage et le schéma de la requête vivent dans
      // deux fichiers : rien n'empêche d'en modifier un seul, et l'onglet
      // ajouté renverrait alors une erreur de validation.
      const { USER_FILTER_LABELS } = await import('../src/lib/admin/shared');

      for (const filter of Object.keys(USER_FILTER_LABELS)) {
        const response = await adminClient.get(`/api/admin/users?statut=${filter}`);
        expect(
          response.status,
          `le filtre « ${filter} » est refusé par l'API`,
        ).toBe(200);
      }
    });

    it('distingue les comptes experts des comptes d’exploitation', async () => {
      const { adminClient } = await setup();
      const expert = await createExpert({
        email: 'agronome@conseil.test',
        organization: 'Chambre du Loiret',
      });
      const farm = await prisma.farm.findFirstOrThrow({ where: { deletedAt: null } });
      await grantAdvisoryAccess({ farmId: farm.id, expertId: expert.id });

      const response = await adminClient.get<{
        users: Array<{
          email: string;
          accountType: string;
          organization: string | null;
          advisedFarms: Array<{ farmName: string }>;
          memberships: unknown[];
        }>;
      }>('/api/admin/users?statut=experts');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);

      const row = response.body.users[0];
      expect(row?.accountType).toBe('AGRONOMIST');
      expect(row?.organization).toBe('Chambre du Loiret');
      // Un expert n'appartient à aucune exploitation : ce sont ses missions de
      // conseil qui décrivent son périmètre.
      expect(row?.memberships).toHaveLength(0);
      expect(row?.advisedFarms).toHaveLength(1);
      expect(row?.advisedFarms[0]?.farmName).toBe(farm.name);
    });

    it('suspend un compte, ferme ses sessions et bloque sa reconnexion', async () => {
      const { adminClient, member, memberClient } = await setup();

      expect((await memberClient.get('/api/parcels')).status).toBe(200);

      const suspend = await adminClient.patch(`/api/admin/users/${member.id}`, {
        action: 'suspend',
        reason: 'Départ de l’exploitation',
      });
      expect(suspend.status).toBe(200);

      // Session en cours immédiatement invalide.
      expect((await memberClient.get('/api/parcels')).status).toBe(401);

      const relogin = await new TestClient().login(member.email, member.password);
      expect(relogin.status).toBe(403);
      expect((relogin.body as { error: { code: string } }).error.code).toBe(
        'ACCOUNT_SUSPENDED',
      );
    });

    it('réactive un compte suspendu', async () => {
      const { adminClient, member } = await setup();

      await adminClient.patch(`/api/admin/users/${member.id}`, { action: 'suspend' });
      await adminClient.patch(`/api/admin/users/${member.id}`, { action: 'restore' });

      const relogin = await new TestClient().login(member.email, member.password);
      expect(relogin.status).toBe(200);
    });

    it('empêche un administrateur de se suspendre ou de se déclasser lui-même', async () => {
      const { adminClient, admin } = await setup();

      const suspend = await adminClient.patch(`/api/admin/users/${admin.id}`, {
        action: 'suspend',
      });
      expect(suspend.status).toBe(409);

      const demote = await adminClient.patch(`/api/admin/users/${admin.id}`, {
        action: 'set-platform-admin',
        value: false,
      });
      expect(demote.status).toBe(409);

      const still = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(still.isPlatformAdmin).toBe(true);
      expect(still.suspendedAt).toBeNull();
    });

    it('refuse de retirer le dernier administrateur de l’instance', async () => {
      const { adminClient, admin, member } = await setup();

      // Un second administrateur, puis retrait du premier : autorisé.
      await adminClient.patch(`/api/admin/users/${member.id}`, {
        action: 'set-platform-admin',
        value: true,
      });
      const demoteOther = await adminClient.patch(`/api/admin/users/${member.id}`, {
        action: 'set-platform-admin',
        value: false,
      });
      expect(demoteOther.status).toBe(200);

      // Reste un seul administrateur : la suppression est refusée.
      const secondAdmin = await createUserWithFarm({
        email: 'admin2@parcelys.test',
        farmName: 'Ferme Admin 2',
        platformAdmin: true,
      });
      const otherClient = new TestClient();
      await otherClient.login(secondAdmin.email, secondAdmin.password);

      await otherClient.patch(`/api/admin/users/${admin.id}`, {
        action: 'set-platform-admin',
        value: false,
      });
      const removeLast = await otherClient.delete(`/api/admin/users/${secondAdmin.id}`);
      expect(removeLast.status).toBe(409);
    });

    it('déverrouille un compte et valide une adresse e-mail', async () => {
      const { adminClient } = await setup();

      const locked = await prisma.user.create({
        data: {
          email: 'bloque@ferme.test',
          emailNormalized: 'bloque@ferme.test',
          passwordHash: 'x'.repeat(60),
          firstName: 'Compte',
          lastName: 'Bloqué',
          failedLoginCount: 8,
          lockedUntil: new Date(Date.now() + 900_000),
        },
      });

      expect(
        (await adminClient.patch(`/api/admin/users/${locked.id}`, { action: 'unlock' }))
          .status,
      ).toBe(200);
      expect(
        (
          await adminClient.patch(`/api/admin/users/${locked.id}`, {
            action: 'verify-email',
          })
        ).status,
      ).toBe(200);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: locked.id } });
      expect(updated.lockedUntil).toBeNull();
      expect(updated.failedLoginCount).toBe(0);
      expect(updated.emailVerifiedAt).not.toBeNull();
    });

    it('refuse de supprimer l’unique propriétaire d’une exploitation', async () => {
      const { adminClient, member } = await setup();

      const response = await adminClient.delete<{ error: { code: string } }>(
        `/api/admin/users/${member.id}`,
      );
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('journalise les opérations d’administration', async () => {
      const { adminClient, member } = await setup();
      await adminClient.patch(`/api/admin/users/${member.id}`, { action: 'suspend' });

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user_suspended' },
      });
      expect(entry.entityId).toBe(member.id);
    });

    it('rend l’adresse e-mail : on peut recréer un compte avec la même', async () => {
      const { adminClient, admin, member } = await setup();
      const adresse = member.email;

      const suppression = await adminClient.delete(
        `/api/admin/users/${member.id}?avecExploitations=1`,
      );
      expect(suppression.status).toBe(200);

      // La ligne survit — les interventions phytosanitaires pointent vers leur
      // auteur, et cette traçabilité ne se supprime pas.
      const supprime = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(supprime.deletedAt).not.toBeNull();
      // …mais elle ne retient plus l'adresse.
      expect(supprime.emailNormalized).not.toBe(adresse.toLowerCase());
      expect(supprime.emailNormalized).toMatch(/@parcelys\.invalid$/);
      expect(supprime.phone).toBeNull();

      // L'adresse d'origine reste au journal : c'est la trace qui compte.
      const trace = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user_deleted', entityId: member.id },
      });
      expect(JSON.stringify(trace.metadata)).toContain(adresse);

      // Et le geste qui échouait auparavant : réinscrire la même adresse.
      const invitation = await adminClient.post<{ code: string }>(
        '/api/admin/invitations',
        { email: adresse },
      );
      expect(invitation.status).toBe(201);

      const reinscription = await new TestClient().post('/api/auth/register', {
        ...REGISTRATION,
        email: adresse,
        farmName: 'Nouvelle Exploitation',
        invitationCode: invitation.body.code,
      });
      expect(reinscription.status).toBe(201);

      const recree = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: adresse.toLowerCase() },
      });
      expect(recree.id).not.toBe(member.id);
      expect(recree.deletedAt).toBeNull();
      expect(admin.id).not.toBe(recree.id);
    });

    it('révoque les codes d’invitation encore ouverts sur l’adresse supprimée', async () => {
      const { adminClient, member } = await setup();

      const pendant = await adminClient.post<{ invitation: { id: string } }>(
        '/api/admin/invitations',
        { email: member.email },
      );
      expect(pendant.status).toBe(201);

      await adminClient.delete(`/api/admin/users/${member.id}?avecExploitations=1`);

      const code = await prisma.invitationCode.findUniqueOrThrow({
        where: { id: pendant.body.invitation.id },
      });
      expect(code.revokedAt).not.toBeNull();
    });

    it('supprime le compte et ses exploitations lorsque c’est demandé', async () => {
      const { adminClient, member } = await setup();

      // Sans le second geste, on refuse — mais on dit désormais lesquelles,
      // pour que l'interface puisse proposer la suite sans relire le message.
      const refus = await adminClient.delete<{
        error: { details?: { orphanedFarms?: Array<{ id: string; name: string }> } };
      }>(`/api/admin/users/${member.id}`);
      expect(refus.status).toBe(409);
      expect(refus.body.error.details?.orphanedFarms).toEqual([
        { id: member.farmId, name: 'GAEC Ordinaire' },
      ]);

      const accepte = await adminClient.delete(
        `/api/admin/users/${member.id}?avecExploitations=1`,
      );
      expect(accepte.status).toBe(200);

      const compte = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(compte.deletedAt).not.toBeNull();
      const ferme = await prisma.farm.findUniqueOrThrow({ where: { id: member.farmId } });
      expect(ferme.deletedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('Comptes d’administration', () => {
    /**
     * Un compte d'administration n'est ni une exploitation ni un expert : il
     * gère l'instance. Lui faire créer une exploitation à l'inscription lui
     * donnerait des parcelles fictives à suivre et fausserait les décomptes.
     */
    it('crée un compte sans exploitation, et qui administre l’instance', async () => {
      const { admin } = await setup();
      await createInvitationCode({
        code: 'PRCLADMIN001',
        createdById: admin.id,
        accountType: 'ADMIN',
      });

      const client = new TestClient();
      const response = await client.post('/api/auth/register', {
        ...REGISTRATION,
        email: 'gestion@parcelys.test',
        invitationCode: 'PRCLADMIN001',
        // Aucun nom d'exploitation : ce compte n'en a pas, et ne doit pas en
        // exiger un.
      });
      expect(response.status).toBe(201);

      const cree = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: 'gestion@parcelys.test' },
        include: { memberships: true },
      });
      expect(cree.accountType).toBe('ADMIN');
      expect(cree.memberships).toHaveLength(0);
      // Le type implique le droit : sans lui, ce compte ne pourrait rien faire.
      expect(cree.isPlatformAdmin).toBe(true);
    });

    it('refuse de rattacher un compte d’administration à une exploitation', async () => {
      const { adminClient, member } = await setup();

      const response = await adminClient.post('/api/admin/invitations', {
        accountType: 'ADMIN',
        farmId: member.farmId,
      });
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Exploitations', () => {
    it('supprime une exploitation sans effacer ses registres, et la rétablit', async () => {
      const { adminClient, member } = await setup();

      const supprime = await adminClient.post('/api/admin/farms', {
        action: 'delete',
        farmId: member.farmId,
      });
      expect(supprime.status).toBe(200);

      // Suppression **logique** : l'exploitation porte des registres
      // phytosanitaires que l'exploitant doit conserver.
      const apres = await prisma.farm.findUniqueOrThrow({ where: { id: member.farmId } });
      expect(apres.deletedAt).not.toBeNull();

      // Et l'exploitant n'y accède plus.
      const memberClient = new TestClient();
      await memberClient.login(member.email, member.password);
      expect((await memberClient.get(`/api/parcels?farmId=${member.farmId}`)).status).toBe(404);

      const retabli = await adminClient.post('/api/admin/farms', {
        action: 'restore',
        farmId: member.farmId,
      });
      expect(retabli.status).toBe(200);
      const rendue = await prisma.farm.findUniqueOrThrow({ where: { id: member.farmId } });
      expect(rendue.deletedAt).toBeNull();
    });

    it('ferme les missions de conseil en cours quand l’exploitation disparaît', async () => {
      const { adminClient, member } = await setup();
      const expert = await createExpert({ email: 'expert.ferme@conseil.test' });
      await grantAdvisoryAccess({ farmId: member.farmId, expertId: expert.id });

      await adminClient.post('/api/admin/farms', { action: 'delete', farmId: member.farmId });

      const engagement = await prisma.advisoryEngagement.findUniqueOrThrow({
        where: { farmId_expertId: { farmId: member.farmId, expertId: expert.id } },
      });
      expect(engagement.status).toBe('ENDED');
      expect(engagement.endedAt).not.toBeNull();
    });

    it('liste les exploitations supprimées avec le poids de leurs registres', async () => {
      const { adminClient, member } = await setup();
      await adminClient.post('/api/admin/farms', { action: 'delete', farmId: member.farmId });

      const response = await adminClient.get<{
        farms: Array<{ id: string; deleted: boolean; phytoRecordCount: number }>;
      }>('/api/admin/farms');
      expect(response.status).toBe(200);
      const ferme = response.body.farms.find((f) => f.id === member.farmId);
      expect(ferme?.deleted).toBe(true);
      expect(ferme?.phytoRecordCount).toBe(0);
    });

    it('reste fermé à un compte ordinaire', async () => {
      const { memberClient, member } = await setup();
      expect((await memberClient.get('/api/admin/farms')).status).toBe(403);
      expect(
        (await memberClient.post('/api/admin/farms', {
          action: 'delete',
          farmId: member.farmId,
        })).status,
      ).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  describe('Experts agronomiques', () => {
    /** Un administrateur, une exploitation ordinaire, et un compte expert. */
    async function setupExpert() {
      const base = await setup();
      const expert = await createExpert({
        email: 'expert.rattachement@conseil.test',
        organization: 'Cabinet Agro',
      });
      return { ...base, expert };
    }

    it('confie une exploitation à un expert, et l’exploitation en est avertie', async () => {
      const { adminClient, member, expert } = await setupExpert();

      const response = await adminClient.post('/api/admin/experts', {
        expertId: expert.id,
        farmId: member.farmId,
      });
      expect(response.status).toBe(201);

      const engagement = await prisma.advisoryEngagement.findUniqueOrThrow({
        where: { farmId_expertId: { farmId: member.farmId, expertId: expert.id } },
      });
      expect(engagement.status).toBe('ACTIVE');

      // Un accès aux données d'une exploitation ne s'ouvre pas en silence.
      const notification = await prisma.notification.findFirst({
        where: { userId: member.id, farmId: member.farmId },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification?.title).toContain('expert');

      // Le journal distingue un accès décidé par l'administration d'un accès
      // consenti par l'exploitation : ce n'est pas le même fait.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'advisor.access_granted_by_admin' },
      });
      expect(audit).not.toBeNull();
    });

    it('donne réellement accès aux parcelles de l’exploitation confiée', async () => {
      const { adminClient, member, expert } = await setupExpert();

      const expertClient = new TestClient();
      await expertClient.login(expert.email, expert.password);

      // Avant rattachement : l'exploitation n'existe pas pour cet expert.
      const avant = await expertClient.get(`/api/parcels?farmId=${member.farmId}`);
      expect(avant.status).toBe(404);

      await adminClient.post('/api/admin/experts', {
        expertId: expert.id,
        farmId: member.farmId,
      });

      const apres = await expertClient.get(`/api/parcels?farmId=${member.farmId}`);
      expect(apres.status).toBe(200);
    });

    it('confie plusieurs exploitations au même expert', async () => {
      const { adminClient, member, expert } = await setupExpert();
      const seconde = await createUserWithFarm({
        email: 'second.exploitant@ferme.test',
        farmName: 'EARL des Coteaux',
      });

      for (const farmId of [member.farmId, seconde.farmId]) {
        expect(
          (await adminClient.post('/api/admin/experts', { expertId: expert.id, farmId }))
            .status,
        ).toBe(201);
      }

      const expertClient = new TestClient();
      await expertClient.login(expert.email, expert.password);

      // Le portefeuille de l'expert porte bien les deux, et rien d'autre.
      const session = await expertClient.get<{
        memberships: Array<{ farmId: string; role: string }>;
      }>('/api/auth/session');
      expect(session.body.memberships.map((m) => m.farmId).sort()).toEqual(
        [member.farmId, seconde.farmId].sort(),
      );
      expect(session.body.memberships.every((m) => m.role === 'ADVISOR')).toBe(true);

      // Et il accède réellement aux parcelles des deux.
      for (const farmId of [member.farmId, seconde.farmId]) {
        expect((await expertClient.get(`/api/parcels?farmId=${farmId}`)).status).toBe(200);
      }
    });

    it('crée un compte expert depuis l’administration', async () => {
      const { adminClient } = await setup();

      const invitation = await adminClient.post<{ code: string }>('/api/admin/invitations', {
        accountType: 'AGRONOMIST',
        email: 'nouvel.expert@conseil.test',
      });
      expect(invitation.status).toBe(201);

      const client = new TestClient();
      const response = await client.post('/api/auth/register', {
        ...REGISTRATION,
        email: 'nouvel.expert@conseil.test',
        invitationCode: invitation.body.code,
      });
      expect(response.status).toBe(201);

      const cree = await prisma.user.findUniqueOrThrow({
        where: { emailNormalized: 'nouvel.expert@conseil.test' },
        include: { memberships: true },
      });
      expect(cree.accountType).toBe('AGRONOMIST');
      // Un expert n'a pas d'exploitation à lui : son portefeuille se remplit
      // des missions qu'on lui confie.
      expect(cree.memberships).toHaveLength(0);
      expect(cree.isPlatformAdmin).toBe(false);
    });

    it('refuse de confier une exploitation supprimée', async () => {
      const { adminClient, member, expert } = await setupExpert();
      await adminClient.post('/api/admin/farms', { action: 'delete', farmId: member.farmId });

      const response = await adminClient.post('/api/admin/experts', {
        expertId: expert.id,
        farmId: member.farmId,
      });
      expect(response.status).toBe(404);
    });

    it('refuse un second rattachement à la même exploitation', async () => {
      const { adminClient, member, expert } = await setupExpert();
      const payload = { expertId: expert.id, farmId: member.farmId };

      expect((await adminClient.post('/api/admin/experts', payload)).status).toBe(201);
      expect((await adminClient.post('/api/admin/experts', payload)).status).toBe(409);
    });

    it('refuse de confier une exploitation à un compte qui n’est pas expert', async () => {
      const { adminClient, member } = await setupExpert();

      const response = await adminClient.post('/api/admin/experts', {
        expertId: member.id,
        farmId: member.farmId,
      });
      // 404 et non 403 : l'existence d'un compte tiers ne se déduit pas du code.
      expect(response.status).toBe(404);
    });

    it('retire l’accès, et l’expert le perd immédiatement', async () => {
      const { adminClient, member, expert } = await setupExpert();

      const created = await adminClient.post('/api/admin/experts', {
        expertId: expert.id,
        farmId: member.farmId,
      });
      const engagementId = (created.body as { id: string }).id;

      const expertClient = new TestClient();
      await expertClient.login(expert.email, expert.password);
      expect((await expertClient.get(`/api/parcels?farmId=${member.farmId}`)).status).toBe(200);

      const revoked = await adminClient.delete('/api/admin/experts', { engagementId });
      expect(revoked.status).toBe(200);

      expect((await expertClient.get(`/api/parcels?farmId=${member.farmId}`)).status).toBe(404);
    });

    it('reste fermé à un compte ordinaire', async () => {
      const { memberClient, member, expert } = await setupExpert();

      expect((await memberClient.get('/api/admin/experts')).status).toBe(403);
      expect(
        (await memberClient.post('/api/admin/experts', {
          expertId: expert.id,
          farmId: member.farmId,
        })).status,
      ).toBe(403);
    });
  });

  describe('Maintenance', () => {
    it('bloque les comptes ordinaires et laisse passer les administrateurs', async () => {
      const { adminClient, memberClient } = await setup();

      const enable = await adminClient.post('/api/admin/maintenance', {
        enabled: true,
        message: 'Migration de la base en cours.',
      });
      expect(enable.status).toBe(200);

      const blocked = await memberClient.get<{ error: { code: string } }>('/api/parcels');
      expect(blocked.status).toBe(503);
      expect(blocked.body.error.code).toBe('MAINTENANCE');

      // L'administrateur conserve l'accès, sans quoi il ne pourrait pas lever
      // le mode maintenance.
      expect((await adminClient.get('/api/parcels')).status).toBe(200);

      await adminClient.post('/api/admin/maintenance', { enabled: false });
      expect((await memberClient.get('/api/parcels')).status).toBe(200);
    });

    it('purge les données périmées sans toucher aux sessions actives', async () => {
      const { adminClient, memberClient } = await setup();

      await prisma.session.updateMany({
        where: { user: { emailNormalized: 'agriculteur@ferme.test' } },
        data: { revokedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
      });

      const response = await adminClient.post<{ results: Record<string, number> }>(
        '/api/admin/cleanup',
        { targets: ['sessions', 'rate-limits'] },
      );
      expect(response.status).toBe(200);
      expect(response.body.results.sessions).toBeGreaterThanOrEqual(1);

      // La session de l'administrateur, elle, est toujours valide.
      expect((await adminClient.get('/api/parcels')).status).toBe(200);
      expect((await memberClient.get('/api/parcels')).status).toBe(401);
    });
  });
});
