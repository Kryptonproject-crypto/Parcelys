import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExpert,
  createInvitationCode,
  createUserWithFarm,
  grantAdvisoryAccess,
  prisma,
  resetDatabase,
  testPolygon,
} from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

/**
 * Conseil agronomique.
 *
 * Le point sensible n'est pas la fonctionnalité mais son périmètre : un expert
 * accède aux données d'exploitations qui ne sont pas les siennes. Ces tests
 * vérifient donc, de bout en bout, qu'il ne voit que celles qui l'ont
 * missionné, qu'il n'écrit rien dans leurs registres, et que l'exploitation
 * peut lui retirer l'accès à tout moment.
 */
describe('Conseil agronomique', () => {
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

  /** Un exploitant, un expert missionné, et une exploitation tierce. */
  async function setup() {
    const farmer = await createUserWithFarm({
      email: 'exploitant@ferme.test',
      farmName: 'GAEC du Conseil',
    });
    const stranger = await createUserWithFarm({
      email: 'voisin@ferme.test',
      farmName: 'Ferme Voisine',
    });
    const expert = await createExpert({
      email: 'expert@agro.test',
      organization: 'Chambre du Loiret',
    });

    await grantAdvisoryAccess({
      farmId: farmer.farmId,
      expertId: expert.id,
      grantedById: farmer.id,
    });

    const farmerClient = new TestClient();
    await farmerClient.login(farmer.email, farmer.password);

    const expertClient = new TestClient();
    await expertClient.login(expert.email, expert.password);

    const strangerClient = new TestClient();
    await strangerClient.login(stranger.email, stranger.password);

    // Une parcelle réelle, avec géométrie, dans chaque exploitation.
    const parcel = await farmerClient.post<{ id: string }>('/api/parcels', {
      name: 'Le Grand Champ',
      geometry: testPolygon(1.88, 48.08),
    });
    const strangerParcel = await strangerClient.post<{ id: string }>('/api/parcels', {
      name: 'Parcelle du voisin',
      geometry: testPolygon(2.1, 48.3),
    });

    return {
      farmer,
      stranger,
      expert,
      farmerClient,
      expertClient,
      strangerClient,
      parcelId: parcel.body.id,
      strangerParcelId: strangerParcel.body.id,
    };
  }

  // -------------------------------------------------------------------------
  describe('Périmètre de l’expert', () => {
    it('ne voit que les exploitations qui l’ont missionné', async () => {
      const { expertClient, farmer } = await setup();

      const session = await expertClient.get<{
        memberships: Array<{ farmId: string; role: string }>;
      }>('/api/auth/session');

      expect(session.body.memberships).toHaveLength(1);
      expect(session.body.memberships[0]?.farmId).toBe(farmer.farmId);
      expect(session.body.memberships[0]?.role).toBe('ADVISOR');
    });

    it('lit le parcellaire et le registre de l’exploitation suivie', async () => {
      const { expertClient, parcelId, farmer } = await setup();

      const parcels = await expertClient.get<{ items: unknown[] }>('/api/parcels');
      expect(parcels.status).toBe(200);
      expect(parcels.body.items).toHaveLength(1);

      // Le portefeuille désigne l'exploitation explicitement : c'est ainsi que
      // l'application mobile passe d'un domaine à l'autre, sans « basculer ».
      const scoped = await expertClient.get<{ items: unknown[] }>(
        `/api/parcels?farmId=${farmer.farmId}`,
      );
      expect(scoped.status).toBe(200);
      expect(scoped.body.items).toHaveLength(1);

      const detail = await expertClient.get(`/api/parcels/${parcelId}`);
      expect(detail.status).toBe(200);

      const phyto = await expertClient.get(`/api/parcels/${parcelId}/phytosanitary`);
      expect(phyto.status).toBe(200);
    });

    it('n’atteint pas une exploitation qui ne l’a pas missionné', async () => {
      const { expertClient, strangerParcelId, stranger } = await setup();

      // 404 et non 403 : l'existence de la ressource n'est pas divulguée.
      expect((await expertClient.get(`/api/parcels/${strangerParcelId}`)).status).toBe(404);
      expect(
        (await expertClient.get(`/api/parcels?farmId=${stranger.farmId}`)).status,
      ).toBe(404);
    });

    it('n’écrit rien dans les registres de l’exploitation', async () => {
      const { expertClient, parcelId } = await setup();

      const attempts = [
        await expertClient.post('/api/parcels', {
          name: 'Parcelle interdite',
          geometry: testPolygon(1.9, 48.1),
        }),
        await expertClient.post(`/api/parcels/${parcelId}/phytosanitary`, {
          appliedOn: '2026-04-01',
          productName: 'Produit',
          dose: 1,
          doseUnit: 'L/ha',
          captureWeather: false,
        }),
        await expertClient.post(`/api/parcels/${parcelId}/fertilization`, {
          appliedOn: '2026-04-01',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate',
          dose: 100,
          doseUnit: 'kg/ha',
        }),
        await expertClient.post(`/api/parcels/${parcelId}/operations`, {
          performedOn: '2026-04-01',
          type: 'LABOUR',
        }),
        await expertClient.delete(`/api/parcels/${parcelId}`),
      ];

      for (const response of attempts) {
        expect(response.status).toBe(403);
      }

      expect(await prisma.phytosanitaryApplication.count()).toBe(0);
      expect(await prisma.parcel.count({ where: { deletedAt: null } })).toBe(2);
    });

    it('ne touche ni aux experts ni aux paramètres de l’exploitation', async () => {
      const { expertClient } = await setup();

      // Lire la liste des conseillers, en délivrer l'accès, modifier
      // l'exploitation : trois prérogatives de l'exploitant, trois refus.
      expect((await expertClient.get('/api/farms/advisors')).status).toBe(403);
      expect(
        (await expertClient.post('/api/farms/advisors', { validityDays: 7 })).status,
      ).toBe(403);
      expect((await expertClient.put('/api/farms', { name: 'Renommée' })).status).toBe(
        403,
      );
    });

    it('n’est pas comptabilisé comme membre de l’exploitation', async () => {
      const { farmer, expert } = await setup();

      const members = await prisma.farmMember.findMany({
        where: { farmId: farmer.farmId },
      });
      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe(farmer.id);
      expect(members.some((m) => m.userId === expert.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Ouverture et retrait de l’accès', () => {
    it('active un code d’accès délivré par l’exploitation', async () => {
      const farmer = await createUserWithFarm({
        email: 'proprio@ferme.test',
        farmName: 'Ferme Accueillante',
      });
      const expert = await createExpert({ email: 'nouvel.expert@agro.test' });

      const farmerClient = new TestClient();
      await farmerClient.login(farmer.email, farmer.password);
      const created = await farmerClient.post<{ code: string }>('/api/farms/advisors', {
        validityDays: 7,
      });
      expect(created.status).toBe(201);
      expect(created.body.code).toMatch(/^PRCL(-[A-Z0-9]{4}){3}$/);

      const expertClient = new TestClient();
      await expertClient.login(expert.email, expert.password);

      // Avant activation : rien dans le portefeuille.
      const before = await expertClient.get<{ memberships: unknown[] }>(
        '/api/auth/session',
      );
      expect(before.body.memberships).toHaveLength(0);

      const join = await expertClient.post<{ farmName: string }>('/api/portfolio/join', {
        code: created.body.code,
      });
      expect(join.status).toBe(200);
      expect(join.body.farmName).toBe('Ferme Accueillante');

      const after = await expertClient.get<{
        memberships: Array<{ role: string }>;
      }>('/api/auth/session');
      expect(after.body.memberships).toHaveLength(1);
      expect(after.body.memberships[0]?.role).toBe('ADVISOR');
    });

    it('accepte un code par exploitation suivie', async () => {
      // Un expert suit plusieurs domaines : il active un code d'accès pour
      // chacun, en plus du code d'inscription qui a créé son compte. Rien ne
      // doit limiter un compte à un seul code au cours de sa vie.
      const first = await createUserWithFarm({
        email: 'ferme.a@ferme.test',
        farmName: 'Ferme A',
      });
      const second = await createUserWithFarm({
        email: 'ferme.b@ferme.test',
        farmName: 'Ferme B',
      });
      const expert = await createExpert({ email: 'multi@agro.test' });

      const expertClient = new TestClient();
      await expertClient.login(expert.email, expert.password);

      for (const [index, farm] of [first, second].entries()) {
        const { code } = await createInvitationCode({
          code: `PRCL-MULT-IFER-000${index}`,
          createdById: farm.id,
          farmId: farm.farmId,
          role: 'ADVISOR',
          purpose: 'ADVISORY_ACCESS',
        });
        expect((await expertClient.post('/api/portfolio/join', { code })).status).toBe(
          200,
        );
      }

      const session = await expertClient.get<{
        memberships: Array<{ farmId: string }>;
      }>('/api/auth/session');
      expect(session.body.memberships).toHaveLength(2);
      expect(await prisma.advisoryEngagement.count()).toBe(2);
    });

    it('n’accepte un code d’accès qu’une seule fois', async () => {
      const farmer = await createUserWithFarm({
        email: 'proprio2@ferme.test',
        farmName: 'Ferme Unique',
      });
      const first = await createExpert({ email: 'expert.a@agro.test' });
      const second = await createExpert({ email: 'expert.b@agro.test' });

      const { code } = await createInvitationCode({
        code: 'PRCL-ADVI-SORY-0001',
        createdById: farmer.id,
        farmId: farmer.farmId,
        role: 'ADVISOR',
        purpose: 'ADVISORY_ACCESS',
      });

      const clientA = new TestClient();
      await clientA.login(first.email, first.password);
      expect((await clientA.post('/api/portfolio/join', { code })).status).toBe(200);

      const clientB = new TestClient();
      await clientB.login(second.email, second.password);
      expect((await clientB.post('/api/portfolio/join', { code })).status).toBe(403);

      expect(await prisma.advisoryEngagement.count()).toBe(1);
    });

    it('refuse un code d’inscription présenté comme code d’accès', async () => {
      const farmer = await createUserWithFarm({
        email: 'proprio3@ferme.test',
        farmName: 'Ferme Trois',
      });
      const expert = await createExpert({ email: 'expert.c@agro.test' });

      // Code destiné à créer un compte, pas à ouvrir une mission.
      const { code } = await createInvitationCode({
        code: 'PRCL-ACCO-UNT0-0001',
        createdById: farmer.id,
        farmId: farmer.farmId,
        role: 'EMPLOYEE',
        purpose: 'ACCOUNT',
      });

      const client = new TestClient();
      await client.login(expert.email, expert.password);
      const response = await client.post<{ error: { code: string } }>(
        '/api/portfolio/join',
        { code },
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('INVITATION_INVALID');
      expect(await prisma.advisoryEngagement.count()).toBe(0);
    });

    it('coupe l’accès dès que l’exploitation met fin à la mission', async () => {
      const { farmerClient, expertClient, parcelId, farmer, expert } = await setup();

      expect((await expertClient.get(`/api/parcels/${parcelId}`)).status).toBe(200);

      const engagement = await prisma.advisoryEngagement.findFirstOrThrow({
        where: { farmId: farmer.farmId, expertId: expert.id },
      });
      const revoke = await farmerClient.delete('/api/farms/advisors', {
        engagementId: engagement.id,
      });
      expect(revoke.status).toBe(200);

      // Accès coupé immédiatement, sans attendre l'expiration de la session.
      expect((await expertClient.get(`/api/parcels/${parcelId}`)).status).toBe(404);

      const session = await expertClient.get<{ memberships: unknown[] }>(
        '/api/auth/session',
      );
      expect(session.body.memberships).toHaveLength(0);
    });

    it('refuse qu’un exploitant s’ajoute lui-même à un portefeuille', async () => {
      const { farmerClient } = await setup();
      const response = await farmerClient.post('/api/portfolio/join', {
        code: 'PRCL-AAAA-BBBB-CCCC',
      });
      expect(response.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('Préconisations', () => {
    async function withRecommendation(send = true) {
      const context = await setup();
      const created = await context.expertClient.post<{ id: string; status: string }>(
        `/api/recommendations?farmId=${context.farmer.farmId}`,
        {
          parcelId: context.parcelId,
          kind: 'PHYTO',
          priority: 'HIGH',
          title: 'Protection fongicide T1',
          rationale:
            'Stade 2 nœuds atteint, septoriose présente sur F3 avec 15 % de fréquence.',
          productName: 'Produit conseillé',
          amm: '2090123',
          dose: 1.2,
          doseUnit: 'L/ha',
          targetLabel: 'Septoriose',
          send,
        },
      );
      return { ...context, recommendation: created };
    }

    it('rédige et transmet une préconisation', async () => {
      const { recommendation, farmer, parcelId } = await withRecommendation();

      expect(recommendation.status).toBe(201);
      expect(recommendation.body.status).toBe('PROPOSED');

      const stored = await prisma.recommendation.findUniqueOrThrow({
        where: { id: recommendation.body.id },
      });
      expect(stored.farmId).toBe(farmer.farmId);
      expect(stored.parcelId).toBe(parcelId);
      expect(Number(stored.dose)).toBe(1.2);
    });

    it('marque le produit « non vérifié » sans correspondance au catalogue', async () => {
      const { recommendation, expertClient } = await withRecommendation();

      const detail = await expertClient.get<{ productSource: string }>(
        `/api/recommendations/${recommendation.body.id}`,
      );
      // Aucun catalogue E-Phy importé dans la base de test : la préconisation
      // ne peut pas prétendre être vérifiée.
      expect(detail.body.productSource).toBe('saisie');
    });

    it('rapproche l’AMM du catalogue officiel quand il est importé', async () => {
      const context = await setup();
      await prisma.phytosanitaryProduct.create({
        data: {
          amm: '2110000',
          name: 'Produit officiel',
          normalizedName: 'produit officiel',
          status: 'Autorisé',
        },
      });

      const created = await context.expertClient.post<{ id: string }>(
        `/api/recommendations?farmId=${context.farmer.farmId}`,
        {
          kind: 'PHYTO',
          title: 'Traitement conseillé',
          rationale: 'Pression observée sur la parcelle voisine, seuil atteint.',
          productName: 'Produit officiel',
          amm: '2110000',
          dose: 1,
          doseUnit: 'L/ha',
          send: true,
        },
      );

      const detail = await context.expertClient.get<{
        productSource: string;
        ephyProduct: { amm: string } | null;
      }>(`/api/recommendations/${created.body.id}`);

      expect(detail.body.productSource).toBe('catalogue');
      expect(detail.body.ephyProduct?.amm).toBe('2110000');
    });

    it('exige produit et dose pour une préconisation phytosanitaire', async () => {
      const { expertClient, farmer } = await setup();

      const response = await expertClient.post<{
        error: { details: Array<{ field: string }> };
      }>(`/api/recommendations?farmId=${farmer.farmId}`, {
        kind: 'PHYTO',
        title: 'Traitement sans produit',
        rationale: 'Une justification suffisamment longue pour passer la validation.',
        send: true,
      });

      expect(response.status).toBe(400);
      const fields = response.body.error.details.map((d) => d.field);
      expect(fields).toContain('productName');
      expect(fields).toContain('dose');
    });

    it('exige une justification', async () => {
      const { expertClient, farmer } = await setup();

      const response = await expertClient.post<{
        error: { details: Array<{ field: string }> };
      }>(`/api/recommendations?farmId=${farmer.farmId}`, {
        kind: 'OBSERVATION',
        title: 'Sans justification',
        rationale: 'court',
        send: true,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.details.some((d) => d.field === 'rationale')).toBe(true);
    });

    it('garde un brouillon invisible de l’exploitation', async () => {
      const { recommendation, farmerClient, expertClient } = await withRecommendation(false);

      expect(recommendation.body.status).toBe('DRAFT');

      // L'expert le voit…
      expect(
        (await expertClient.get(`/api/recommendations/${recommendation.body.id}`)).status,
      ).toBe(200);

      // …l'exploitation, non : il n'a jamais été transmis.
      expect(
        (await farmerClient.get(`/api/recommendations/${recommendation.body.id}`)).status,
      ).toBe(404);

      const list = await farmerClient.get<{ recommendations: unknown[] }>(
        '/api/recommendations',
      );
      expect(list.body.recommendations).toHaveLength(0);
    });

    it('notifie l’exploitation à la transmission', async () => {
      const { farmer } = await withRecommendation();

      const notification = await prisma.notification.findFirst({
        where: { userId: farmer.id, type: 'RECOMMENDATION' },
      });
      expect(notification).not.toBeNull();
      expect(notification?.title).toContain('Protection fongicide T1');
    });

    it('laisse l’exploitation accepter, et refuse à l’expert de répondre', async () => {
      const { recommendation, farmerClient, expertClient } = await withRecommendation();
      const id = recommendation.body.id;

      // L'expert ne décide pas à la place de l'exploitant.
      expect(
        (await expertClient.post(`/api/recommendations/${id}/response`, {
          decision: 'ACCEPTED',
        })).status,
      ).toBe(403);

      const accepted = await farmerClient.post<{ status: string }>(
        `/api/recommendations/${id}/response`,
        { decision: 'ACCEPTED', note: 'Traitement programmé jeudi.' },
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.status).toBe('ACCEPTED');

      const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id } });
      expect(stored.responseNote).toBe('Traitement programmé jeudi.');
      expect(stored.respondedById).not.toBeNull();
    });

    it('conserve le motif d’un refus', async () => {
      const { recommendation, farmerClient } = await withRecommendation();

      const declined = await farmerClient.post<{ status: string }>(
        `/api/recommendations/${recommendation.body.id}/response`,
        { decision: 'DECLINED', note: 'Parcelle déjà traitée la semaine dernière.' },
      );
      expect(declined.body.status).toBe('DECLINED');

      const stored = await prisma.recommendation.findUniqueOrThrow({
        where: { id: recommendation.body.id },
      });
      expect(stored.responseNote).toContain('déjà traitée');
    });

    it('rattache l’intervention réellement enregistrée', async () => {
      const { recommendation, farmerClient, parcelId } = await withRecommendation();
      const id = recommendation.body.id;

      await farmerClient.post(`/api/recommendations/${id}/response`, {
        decision: 'ACCEPTED',
      });

      // L'exploitant enregistre lui-même l'intervention : accepter n'écrit
      // jamais dans un registre réglementaire.
      const treatment = await farmerClient.post<{ item: { id: string } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        {
          appliedOn: '2026-04-05',
          productName: 'Produit conseillé',
          amm: '2090123',
          dose: 1.2,
          doseUnit: 'L/ha',
          captureWeather: false,
        },
      );
      expect(treatment.status).toBe(201);

      const applied = await farmerClient.put<{ status: string }>(
        `/api/recommendations/${id}/response`,
        { phytoId: treatment.body.item.id },
      );
      expect(applied.status).toBe(200);
      expect(applied.body.status).toBe('APPLIED');

      const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id } });
      expect(stored.appliedPhytoId).toBe(treatment.body.item.id);
    });

    it('refuse de rattacher une intervention d’une autre exploitation', async () => {
      const { recommendation, farmerClient, strangerClient, strangerParcelId } =
        await withRecommendation();
      const id = recommendation.body.id;

      await farmerClient.post(`/api/recommendations/${id}/response`, {
        decision: 'ACCEPTED',
      });

      const foreign = await strangerClient.post<{ item: { id: string } }>(
        `/api/parcels/${strangerParcelId}/phytosanitary`,
        {
          appliedOn: '2026-04-05',
          productName: 'Produit du voisin',
          dose: 1,
          doseUnit: 'L/ha',
          captureWeather: false,
        },
      );
      expect(foreign.status).toBe(201);

      const response = await farmerClient.put(`/api/recommendations/${id}/response`, {
        phytoId: foreign.body.item.id,
      });
      expect(response.status).toBe(400);
    });

    it('refuse une transition impossible', async () => {
      const { recommendation, farmerClient } = await withRecommendation();
      const id = recommendation.body.id;

      await farmerClient.post(`/api/recommendations/${id}/response`, {
        decision: 'ACCEPTED',
      });

      // Une préconisation acceptée ne redevient pas « en attente ».
      const response = await farmerClient.put(`/api/recommendations/${id}/response`, {});
      expect(response.status).toBe(400);
    });

    it('empêche l’expert de modifier une préconisation déjà tranchée', async () => {
      const { recommendation, farmerClient, expertClient } = await withRecommendation();
      const id = recommendation.body.id;

      await farmerClient.post(`/api/recommendations/${id}/response`, {
        decision: 'ACCEPTED',
      });

      const response = await expertClient.put(`/api/recommendations/${id}`, {
        kind: 'PHYTO',
        title: 'Titre réécrit après coup',
        rationale: 'Une justification suffisamment longue pour passer la validation.',
        productName: 'Autre produit',
        dose: 3,
        doseUnit: 'L/ha',
        send: true,
      });
      expect(response.status).toBe(409);

      const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id } });
      expect(stored.title).toBe('Protection fongicide T1');
    });

    it('retire une préconisation transmise sans l’effacer', async () => {
      const { recommendation, expertClient } = await withRecommendation();

      const response = await expertClient.delete(
        `/api/recommendations/${recommendation.body.id}`,
      );
      expect(response.status).toBe(200);

      const stored = await prisma.recommendation.findUniqueOrThrow({
        where: { id: recommendation.body.id },
      });
      expect(stored.status).toBe('WITHDRAWN');
    });

    it('supprime un brouillon jamais transmis', async () => {
      const { recommendation, expertClient } = await withRecommendation(false);

      expect(
        (await expertClient.delete(`/api/recommendations/${recommendation.body.id}`))
          .status,
      ).toBe(200);
      expect(await prisma.recommendation.count()).toBe(0);
    });

    it('n’expose pas les préconisations d’une autre exploitation', async () => {
      const { recommendation, strangerClient } = await withRecommendation();

      expect(
        (await strangerClient.get(`/api/recommendations/${recommendation.body.id}`))
          .status,
      ).toBe(404);

      const list = await strangerClient.get<{ recommendations: unknown[] }>(
        '/api/recommendations',
      );
      expect(list.body.recommendations).toHaveLength(0);
    });

    it('refuse à un expert de préconiser sur une exploitation non suivie', async () => {
      const { expertClient, stranger } = await setup();

      const response = await expertClient.post(
        `/api/recommendations?farmId=${stranger.farmId}`,
        {
          kind: 'OBSERVATION',
          title: 'Intrusion',
          rationale: 'Une justification suffisamment longue pour passer la validation.',
          send: true,
        },
      );
      expect(response.status).toBe(404);
      expect(await prisma.recommendation.count()).toBe(0);
    });

    it('refuse à un exploitant de rédiger une préconisation', async () => {
      const { farmerClient, farmer } = await setup();

      const response = await farmerClient.post(
        `/api/recommendations?farmId=${farmer.farmId}`,
        {
          kind: 'OBSERVATION',
          title: 'Auto-préconisation',
          rationale: 'Une justification suffisamment longue pour passer la validation.',
          send: true,
        },
      );
      expect(response.status).toBe(403);
    });

    it('refuse une parcelle d’une autre exploitation dans une préconisation', async () => {
      const { expertClient, farmer, strangerParcelId } = await setup();

      const response = await expertClient.post(
        `/api/recommendations?farmId=${farmer.farmId}`,
        {
          parcelId: strangerParcelId,
          kind: 'OBSERVATION',
          title: 'Parcelle étrangère',
          rationale: 'Une justification suffisamment longue pour passer la validation.',
          send: true,
        },
      );
      expect(response.status).toBe(400);
    });
  });
});
