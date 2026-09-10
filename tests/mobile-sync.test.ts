import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createExpert,
  createUserWithFarm,
  grantAdvisoryAccess,
  prisma,
  resetDatabase,
  testPolygon,
} from './helpers/db';
import { getBaseUrl, startServer, stopServer, TestClient } from './helpers/server';

/**
 * Application de terrain : authentification par jeton, CORS natif et
 * synchronisation hors ligne.
 *
 * Ces tests passent par la vraie chaîne HTTP en se faisant passer pour la
 * WebView d'une application Capacitor : origine `capacitor://localhost`, aucun
 * cookie, jeton `Authorization: Bearer`. C'est le seul moyen de vérifier que la
 * défense CSRF et le CORS se comportent comme prévu pour ce client.
 */
describe('Application mobile et synchronisation', () => {
  const NATIVE_ORIGIN = 'capacitor://localhost';

  /** Client natif : pas de cookie, jeton dans l'en-tête, origine WebView. */
  class NativeClient {
    token = '';

    async request<T>(
      method: string,
      path: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ): Promise<{ status: number; body: T; headers: Headers }> {
      const response = await fetch(`${getBaseUrl()}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: NATIVE_ORIGIN,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      const contentType = response.headers.get('content-type') ?? '';
      const parsed = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      return { status: response.status, body: parsed as T, headers: response.headers };
    }

    get<T>(path: string) {
      return this.request<T>('GET', path);
    }
    post<T>(path: string, body?: unknown, extra?: Record<string, string>) {
      return this.request<T>('POST', path, body ?? {}, extra);
    }

    async login(email: string, password: string): Promise<void> {
      const response = await this.request<{ token: string }>(
        'POST',
        '/api/auth/login',
        { email, password, client: 'native', deviceName: 'Téléphone de test' },
      );
      this.token = response.body.token;
    }
  }

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

  async function setup() {
    const user = await createUserWithFarm({
      email: 'terrain@ferme.test',
      farmName: 'Ferme du Terrain',
    });
    const native = new NativeClient();
    await native.login(user.email, user.password);
    return { user, native };
  }

  // -------------------------------------------------------------------------
  describe('Authentification par jeton', () => {
    it('renvoie un jeton au client natif et aucun cookie', async () => {
      const user = await createUserWithFarm({
        email: 'jeton@ferme.test',
        farmName: 'Ferme Jeton',
      });

      const response = await fetch(`${getBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: NATIVE_ORIGIN },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          client: 'native',
        }),
      });

      const body = (await response.json()) as { token: string; expiresAt: string };
      expect(response.status).toBe(200);
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      // Aucun cookie posé : la WebView est sur une autre origine, il serait
      // inutile et exposerait la session.
      expect(response.headers.getSetCookie()).toHaveLength(0);

      // Le jeton n'est stocké qu'en empreinte.
      const session = await prisma.session.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(session.tokenHash).not.toBe(body.token);
      expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('ne renvoie jamais de jeton au client web', async () => {
      const user = await createUserWithFarm({
        email: 'web@ferme.test',
        farmName: 'Ferme Web',
      });

      const client = new TestClient();
      const response = await client.login(user.email, user.password);

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('token');
      expect(client.hasSession()).toBe(true);
    });

    it('accepte le jeton sur les routes métier', async () => {
      const { native } = await setup();
      const response = await native.get<{ items: unknown[] }>('/api/parcels');
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
    });

    it('refuse un jeton inconnu ou révoqué', async () => {
      const { native, user } = await setup();

      const forged = new NativeClient();
      forged.token = 'jeton-inexistant-mais-de-bonne-longueur-1234567890';
      expect((await forged.get('/api/parcels')).status).toBe(401);

      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });
      expect((await native.get('/api/parcels')).status).toBe(401);
    });

    it('révoque le jeton à la déconnexion', async () => {
      const { native } = await setup();
      expect((await native.post('/api/auth/logout')).status).toBe(200);
      expect((await native.get('/api/parcels')).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('CORS et CSRF', () => {
    it('répond au pré-vol pour une origine native autorisée', async () => {
      const response = await fetch(`${getBaseUrl()}/api/parcels`, {
        method: 'OPTIONS',
        headers: {
          Origin: NATIVE_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(NATIVE_ORIGIN);
      expect(response.headers.get('access-control-allow-headers')).toContain(
        'Authorization',
      );
      // Sans `allow-credentials`, aucun cookie ne peut être emprunté.
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
      expect(response.headers.get('vary')).toContain('Origin');
    });

    it('refuse le pré-vol d’une origine inconnue', async () => {
      const response = await fetch(`${getBaseUrl()}/api/parcels`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://site-malveillant.test',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('bloque encore une écriture inter-sites portant un cookie', async () => {
      const user = await createUserWithFarm({
        email: 'csrf-mobile@ferme.test',
        farmName: 'Ferme CSRF',
      });
      const client = new TestClient();
      await client.login(user.email, user.password);

      // Une origine native ne dispense de la vérification que si la requête
      // n'apporte aucun cookie : ici le cookie est là, la CSRF s'applique.
      const response = await client.request(
        'POST',
        '/api/parcels',
        { name: 'Parcelle forgée', geometry: testPolygon() },
        { Origin: NATIVE_ORIGIN },
      );

      expect(response.status).toBe(403);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'CSRF_BLOCKED',
      );
    });

    it('refuse une écriture native depuis une origine non autorisée', async () => {
      const { native } = await setup();

      const response = await fetch(`${getBaseUrl()}/api/parcels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://site-malveillant.test',
          Authorization: `Bearer ${native.token}`,
        },
        body: JSON.stringify({ name: 'Parcelle', geometry: testPolygon() }),
      });

      expect(response.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('Idempotence', () => {
    it('ne crée qu’une parcelle si la même requête est rejouée', async () => {
      const { native } = await setup();
      const key = randomUUID();
      const body = {
        name: 'Parcelle du GPS',
        commune: 'Artenay',
        geometry: testPolygon(1.9, 48.1),
      };

      const first = await native.post<{ id: string }>('/api/parcels', body, {
        'Idempotency-Key': key,
      });
      const second = await native.post<{ id: string }>('/api/parcels', body, {
        'Idempotency-Key': key,
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.headers.get('idempotency-replayed')).toBe('true');
      expect(await prisma.parcel.count()).toBe(1);
    });

    it('refuse la même clé réutilisée pour une autre opération', async () => {
      const { native } = await setup();
      const key = randomUUID();

      await native.post('/api/parcels', {
        name: 'Première',
        geometry: testPolygon(1.9, 48.1),
      }, { 'Idempotency-Key': key });

      const parcel = await prisma.parcel.findFirstOrThrow();
      const other = await native.post<{ error: { code: string } }>(
        `/api/parcels/${parcel.id}/operations`,
        { performedOn: '2026-03-01', type: 'LABOUR' },
        { 'Idempotency-Key': key },
      );

      expect(other.status).toBe(409);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('ne mémorise pas les échecs : une saisie corrigée peut repartir', async () => {
      const { native } = await setup();
      const key = randomUUID();

      const rejected = await native.post('/api/parcels', { name: '' }, {
        'Idempotency-Key': key,
      });
      expect(rejected.status).toBe(400);

      const accepted = await native.post<{ id: string }>(
        '/api/parcels',
        { name: 'Corrigée', geometry: testPolygon(1.9, 48.1) },
        { 'Idempotency-Key': key },
      );
      expect(accepted.status).toBe(201);
      expect(await prisma.parcel.count()).toBe(1);
    });

    it('isole les clés entre deux appareils', async () => {
      const { user, native } = await setup();

      const second = new NativeClient();
      await second.login(user.email, user.password);

      const key = 'meme-cle-sur-deux-appareils';
      const a = await native.post<{ id: string }>(
        '/api/parcels',
        { name: 'Depuis le téléphone', geometry: testPolygon(1.9, 48.1) },
        { 'Idempotency-Key': key },
      );
      const b = await second.post<{ id: string }>(
        '/api/parcels',
        { name: 'Depuis la tablette', geometry: testPolygon(2.0, 48.2) },
        { 'Idempotency-Key': key },
      );

      expect(a.body.id).not.toBe(b.body.id);
      expect(await prisma.parcel.count()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Instantané hors ligne', () => {
    it('renvoie tout ce qu’il faut pour travailler sans réseau', async () => {
      const { native, user } = await setup();
      await prisma.crop.create({
        data: { farmId: user.farmId, code: 'BLE', name: 'Blé tendre' },
      });
      const parcel = await native.post<{ id: string }>('/api/parcels', {
        name: 'Grande pièce',
        geometry: testPolygon(1.88, 48.08),
      });
      await native.post(`/api/parcels/${parcel.body.id}/phytosanitary`, {
        appliedOn: '2026-04-02',
        productName: 'Produit déjà employé',
        amm: '2100000',
        dose: 1.2,
        doseUnit: 'L/ha',
        captureWeather: false,
      });

      const snapshot = await native.get<{
        farm: { name: string };
        parcels: Array<{ id: string; geometry: unknown; areaHa: number }>;
        referential: {
          crops: unknown[];
          doseUnits: string[];
          recentPhytoProducts: Array<{ productName: string; amm: string | null }>;
          operationTypes: unknown[];
        };
      }>('/api/mobile/bootstrap');

      expect(snapshot.status).toBe(200);
      expect(snapshot.body.farm.name).toBe('Ferme du Terrain');
      expect(snapshot.body.parcels).toHaveLength(1);
      // La géométrie est embarquée : la carte doit s'afficher sans réseau.
      expect(snapshot.body.parcels[0]?.geometry).toBeTruthy();
      expect(snapshot.body.parcels[0]?.areaHa).toBeGreaterThan(0);
      expect(snapshot.body.referential.crops.length).toBeGreaterThan(0);
      expect(snapshot.body.referential.doseUnits).toContain('L/ha');
      expect(snapshot.body.referential.operationTypes.length).toBeGreaterThan(0);

      // Les produits proposés hors ligne sont ceux réellement utilisés, avec
      // leur AMM : aucune donnée réglementaire n'est inventée.
      expect(snapshot.body.referential.recentPhytoProducts).toEqual([
        expect.objectContaining({ productName: 'Produit déjà employé', amm: '2100000' }),
      ]);
    });

    it('n’expose pas l’exploitation d’un autre compte', async () => {
      await setup();
      const stranger = await createUserWithFarm({
        email: 'voisin@ferme.test',
        farmName: 'Ferme Voisine',
      });
      const other = new NativeClient();
      await other.login(stranger.email, stranger.password);

      const snapshot = await other.get<{ farm: { name: string } }>(
        '/api/mobile/bootstrap',
      );
      expect(snapshot.body.farm.name).toBe('Ferme Voisine');
    });
  });

  // -------------------------------------------------------------------------
  describe('Expert agronomique au champ', () => {
    /** Un expert missionné sur deux exploitations, chacune avec sa parcelle. */
    async function advisorySetup() {
      const first = await createUserWithFarm({
        email: 'premier@ferme.test',
        farmName: 'GAEC Premier',
      });
      const second = await createUserWithFarm({
        email: 'second@ferme.test',
        farmName: 'EARL Second',
      });
      const stranger = await createUserWithFarm({
        email: 'inconnue@ferme.test',
        farmName: 'Ferme Inconnue',
      });
      const expert = await createExpert({
        email: 'agronome@conseil.test',
        organization: 'Chambre du Loiret',
      });

      await grantAdvisoryAccess({ farmId: first.farmId, expertId: expert.id });
      await grantAdvisoryAccess({ farmId: second.farmId, expertId: expert.id });

      const farmer = new NativeClient();
      await farmer.login(first.email, first.password);
      const parcel = await farmer.post<{ id: string }>('/api/parcels', {
        name: 'Le Grand Champ',
        geometry: testPolygon(1.88, 48.08),
      });

      const advisor = new NativeClient();
      await advisor.login(expert.email, expert.password);

      return {
        first,
        second,
        stranger,
        expert,
        farmer,
        advisor,
        parcelId: parcel.body.id,
      };
    }

    it('renvoie le portefeuille et signale l’accès en conseil', async () => {
      const { advisor, first } = await advisorySetup();

      const snapshot = await advisor.get<{
        accountType: string;
        advisory: boolean;
        farm: { id: string };
        farms: Array<{ id: string; name: string; advisory: boolean }>;
      }>('/api/mobile/bootstrap');

      expect(snapshot.status).toBe(200);
      expect(snapshot.body.accountType).toBe('AGRONOMIST');
      expect(snapshot.body.advisory).toBe(true);
      expect(snapshot.body.farms).toHaveLength(2);
      expect(snapshot.body.farms.every((farm) => farm.advisory)).toBe(true);
      expect(snapshot.body.farm.id).toBe(first.farmId);
    });

    it('change de domaine sans se reconnecter', async () => {
      const { advisor, second } = await advisorySetup();

      const snapshot = await advisor.get<{ farm: { id: string; name: string } }>(
        `/api/mobile/bootstrap?farmId=${second.farmId}`,
      );
      expect(snapshot.status).toBe(200);
      expect(snapshot.body.farm.name).toBe('EARL Second');
    });

    it('refuse un domaine hors du portefeuille', async () => {
      const { advisor, stranger } = await advisorySetup();

      const snapshot = await advisor.get(
        `/api/mobile/bootstrap?farmId=${stranger.farmId}`,
      );
      // 404 et non 403 : l'existence de l'exploitation n'est pas divulguée.
      expect(snapshot.status).toBe(404);
    });

    it('transmet une préconisation rédigée hors ligne', async () => {
      const { advisor, farmer, first, parcelId } = await advisorySetup();

      const response = await advisor.post<{
        applied: number;
        results: Array<{ status: string; entityId?: string }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'recommendation.create',
            farmId: first.farmId,
            parcelId,
            capturedAt: new Date().toISOString(),
            payload: {
              parcelId,
              kind: 'PHYTO',
              priority: 'HIGH',
              title: 'Protection fongicide T1',
              rationale:
                'Stade 2 nœuds atteint, septoriose présente sur F3 avec 15 % de fréquence.',
              productName: 'Produit conseillé',
              amm: '2090123',
              dose: 1.2,
              doseUnit: 'L/ha',
              send: true,
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      expect(response.body.applied).toBe(1);

      // Transmise : l'exploitation la voit, avec la provenance du produit.
      const received = await farmer.get<{
        recommendations: Array<{ title: string; status: string; productSource: string }>;
      }>('/api/recommendations');
      expect(received.body.recommendations).toHaveLength(1);
      expect(received.body.recommendations[0]?.status).toBe('PROPOSED');
      expect(received.body.recommendations[0]?.productSource).toBe('saisie');
    });

    it('refuse une préconisation visant une exploitation non suivie', async () => {
      const { advisor, stranger } = await advisorySetup();

      const response = await advisor.post<{
        rejected: number;
        results: Array<{ httpStatus: number }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'recommendation.create',
            farmId: stranger.farmId,
            capturedAt: new Date().toISOString(),
            payload: {
              kind: 'OBSERVATION',
              priority: 'NORMAL',
              title: 'Tentative',
              rationale: 'Préconisation sur une exploitation qui ne m’a pas missionné.',
              send: true,
            },
          },
        ],
      });

      expect(response.body.rejected).toBe(1);
      expect(response.body.results[0]?.httpStatus).toBe(404);
      expect(await prisma.recommendation.count()).toBe(0);
    });

    it('rejoue la réponse de l’exploitation faite hors ligne', async () => {
      const { advisor, farmer, first, parcelId } = await advisorySetup();

      await advisor.post('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'recommendation.create',
            farmId: first.farmId,
            capturedAt: new Date().toISOString(),
            payload: {
              parcelId,
              kind: 'OBSERVATION',
              priority: 'NORMAL',
              title: 'Surveiller les limaces',
              rationale: 'Pression observée en bordure de la parcelle voisine.',
              send: true,
            },
          },
        ],
      });

      const received = await farmer.get<{
        recommendations: Array<{ id: string }>;
      }>('/api/recommendations');
      const id = received.body.recommendations[0]?.id ?? '';

      const response = await farmer.post<{ applied: number }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'recommendation.respond',
            targetId: id,
            capturedAt: new Date().toISOString(),
            payload: { decision: 'ACCEPTED', note: 'Passage prévu jeudi.' },
          },
        ],
      });

      expect(response.body.applied).toBe(1);
      const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe('ACCEPTED');
      expect(stored.responseNote).toBe('Passage prévu jeudi.');
    });

    it('n’écrit rien dans les registres depuis la file d’attente', async () => {
      const { advisor, parcelId } = await advisorySetup();

      const response = await advisor.post<{
        rejected: number;
        results: Array<{ httpStatus: number }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'phyto.create',
            parcelId,
            capturedAt: new Date().toISOString(),
            payload: {
              appliedOn: '2026-04-05',
              productName: 'Produit',
              dose: 1,
              doseUnit: 'L/ha',
              captureWeather: false,
            },
          },
        ],
      });

      expect(response.body.rejected).toBe(1);
      expect(response.body.results[0]?.httpStatus).toBe(403);
      expect(await prisma.phytosanitaryApplication.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Rejeu de la file d’attente', () => {
    it('applique un lot complet saisi hors ligne', async () => {
      const { native, user } = await setup();
      const parcelClientId = randomUUID();

      const push = await native.post<{
        applied: number;
        rejected: number;
        results: Array<{ clientId: string; status: string; entityId?: string }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: parcelClientId,
            kind: 'parcel.create',
            capturedAt: '2026-04-01T08:00:00.000Z',
            payload: {
              name: 'Parcelle marchée au GPS',
              commune: 'Artenay',
              geometry: testPolygon(1.91, 48.11),
            },
          },
        ],
      });

      expect(push.status).toBe(200);
      expect(push.body.applied).toBe(1);
      expect(push.body.rejected).toBe(0);

      const parcelId = push.body.results[0]?.entityId;
      expect(parcelId).toBeTruthy();

      // Second lot : les interventions saisies sur cette parcelle.
      const second = await native.post<{ applied: number; rejected: number }>(
        '/api/sync',
        {
          operations: [
            {
              clientId: randomUUID(),
              kind: 'phyto.create',
              parcelId,
              payload: {
                appliedOn: '2026-04-02',
                productName: 'Produit saisi au champ',
                dose: 1.5,
                doseUnit: 'L/ha',
                captureWeather: false,
                // Conditions relevées par l'appareil AU MOMENT de la saisie.
                // Elles doivent traverser la file d'attente intactes : la météo
                // de la synchronisation, des heures plus tard, ne serait pas
                // celle de l'intervention.
                weatherTempC: 14.2,
                weatherWindKmh: 11,
                weatherHumidity: 68,
                weatherRainMm: 0,
                weatherSummary: 'Ciel voilé',
                weatherSource: 'open-meteo',
              },
            },
            {
              clientId: randomUUID(),
              kind: 'fertilization.create',
              parcelId,
              payload: {
                appliedOn: '2026-04-03',
                inputType: 'MINERAL',
                productLabel: 'Ammonitrate 33,5 %',
                dose: 180,
                doseUnit: 'kg/ha',
                weatherTempC: 9.5,
                weatherWindKmh: 22,
                weatherSummary: 'Vent soutenu',
                weatherSource: 'open-meteo',
              },
            },
            {
              clientId: randomUUID(),
              kind: 'operation.create',
              parcelId,
              payload: {
                performedOn: '2026-04-04',
                type: 'SEMIS',
                weatherTempC: 7.1,
                weatherSummary: 'Averses',
                weatherSource: 'open-meteo',
              },
            },
          ],
        },
      );

      expect(second.body.applied).toBe(3);
      expect(second.body.rejected).toBe(0);

      // La météo relevée au champ est arrivée jusqu'au registre, pour les trois
      // natures de saisie — c'est le point qui pourrait échouer en silence.
      const traitement = await prisma.phytosanitaryApplication.findFirstOrThrow({
        where: { parcelId },
      });
      expect(Number(traitement.weatherTempC)).toBe(14.2);
      expect(Number(traitement.weatherWindKmh)).toBe(11);
      expect(traitement.weatherSummary).toBe('Ciel voilé');
      expect(traitement.weatherSource).toBe('open-meteo');

      const apport = await prisma.fertilizerApplication.findFirstOrThrow({
        where: { parcelId },
      });
      expect(Number(apport.weatherTempC)).toBe(9.5);
      expect(apport.weatherSummary).toBe('Vent soutenu');

      const travail = await prisma.agriculturalOperation.findFirstOrThrow({
        where: { parcelId },
      });
      expect(Number(travail.weatherTempC)).toBe(7.1);
      expect(travail.weatherSummary).toBe('Averses');

      // Les règles métier des routes appelées ont bien joué : la superficie
      // vient de PostGIS et la quantité totale du calcul serveur.
      const parcel = await prisma.parcel.findUniqueOrThrow({
        where: { id: parcelId },
        include: { fertilizations: true, phytoTreatments: true, operations: true },
      });
      expect(Number(parcel.areaHa)).toBeGreaterThan(0);
      expect(parcel.farmId).toBe(user.farmId);
      expect(parcel.fertilizations).toHaveLength(1);
      expect(Number(parcel.fertilizations[0]?.totalQuantity ?? 0)).toBeGreaterThan(0);
      expect(parcel.phytoTreatments).toHaveLength(1);
      expect(parcel.operations).toHaveLength(1);
    });

    it('n’interrompt pas le lot sur une saisie refusée', async () => {
      const { native } = await setup();

      const push = await native.post<{
        applied: number;
        rejected: number;
        results: Array<{
          status: string;
          message?: string;
          fieldErrors?: Array<{ field: string }>;
        }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'parcel.create',
            payload: { name: 'Bonne parcelle', geometry: testPolygon(1.92, 48.12) },
          },
          {
            // Nom vide : refusée par la validation de la route.
            clientId: randomUUID(),
            kind: 'parcel.create',
            payload: { name: '', geometry: testPolygon(1.93, 48.13) },
          },
          {
            clientId: randomUUID(),
            kind: 'parcel.create',
            payload: { name: 'Autre bonne parcelle', geometry: testPolygon(1.94, 48.14) },
          },
        ],
      });

      expect(push.body.applied).toBe(2);
      expect(push.body.rejected).toBe(1);
      expect(push.body.results[1]?.status).toBe('rejected');
      expect(push.body.results[1]?.fieldErrors?.[0]?.field).toBe('name');
      expect(await prisma.parcel.count()).toBe(2);
    });

    it('ne duplique rien si le lot entier est renvoyé', async () => {
      const { native } = await setup();
      const operations = [
        {
          clientId: randomUUID(),
          kind: 'parcel.create',
          payload: { name: 'Parcelle unique', geometry: testPolygon(1.95, 48.15) },
        },
      ];

      const first = await native.post<{ results: Array<{ status: string }> }>(
        '/api/sync',
        { operations },
      );
      const retry = await native.post<{
        applied: number;
        results: Array<{ status: string; entityId?: string }>;
      }>('/api/sync', { operations });

      expect(first.body.results[0]?.status).toBe('applied');
      expect(retry.body.results[0]?.status).toBe('replayed');
      expect(retry.body.applied).toBe(1);
      expect(await prisma.parcel.count()).toBe(1);
    });

    it('refuse une opération sur une parcelle d’une autre exploitation', async () => {
      const { native } = await setup();
      const stranger = await createUserWithFarm({
        email: 'etranger@ferme.test',
        farmName: 'Ferme Étrangère',
      });
      const strangerParcel = await prisma.parcel.create({
        data: { farmId: stranger.farmId, name: 'Parcelle privée', areaHa: 3 },
      });

      const push = await native.post<{
        rejected: number;
        results: Array<{ httpStatus: number }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'operation.create',
            parcelId: strangerParcel.id,
            payload: { performedOn: '2026-04-01', type: 'LABOUR' },
          },
        ],
      });

      expect(push.body.rejected).toBe(1);
      // 404 et non 403 : l'existence de la parcelle n'est pas divulguée.
      expect(push.body.results[0]?.httpStatus).toBe(404);
      expect(await prisma.agriculturalOperation.count()).toBe(0);
    });

    it('refuse un type d’opération hors de la liste autorisée', async () => {
      const { native } = await setup();

      const push = await native.post<{ error: { code: string } }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'parcel.delete',
            payload: {},
          },
        ],
      });

      expect(push.status).toBe(400);
      expect(push.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('respecte le rôle : un compte en lecture seule ne peut rien pousser', async () => {
      const owner = await createUserWithFarm({
        email: 'proprietaire@ferme.test',
        farmName: 'Ferme Partagée',
      });
      const viewer = await prisma.user.create({
        data: {
          email: 'lecteur@ferme.test',
          emailNormalized: 'lecteur@ferme.test',
          passwordHash: (
            await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })
          ).passwordHash,
          firstName: 'Lecteur',
          lastName: 'Seul',
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.farmMember.create({
        data: { farmId: owner.farmId, userId: viewer.id, role: 'VIEWER' },
      });

      const client = new NativeClient();
      await client.login('lecteur@ferme.test', owner.password);

      const push = await client.post<{
        rejected: number;
        results: Array<{ httpStatus: number }>;
      }>('/api/sync', {
        operations: [
          {
            clientId: randomUUID(),
            kind: 'parcel.create',
            payload: { name: 'Interdite', geometry: testPolygon(1.96, 48.16) },
          },
        ],
      });

      expect(push.body.rejected).toBe(1);
      expect(push.body.results[0]?.httpStatus).toBe(403);
      expect(await prisma.parcel.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Relève des changements', () => {
    it('renvoie les parcelles modifiées depuis une date', async () => {
      const { native } = await setup();

      await native.post('/api/parcels', {
        name: 'Ancienne',
        geometry: testPolygon(1.97, 48.17),
      });

      const boundary = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await native.post('/api/parcels', {
        name: 'Nouvelle',
        geometry: testPolygon(1.98, 48.18),
      });

      const changes = await native.get<{
        parcels: Array<{ name: string }>;
        deletedParcelIds: string[];
        syncedAt: string;
      }>(`/api/sync?since=${encodeURIComponent(boundary)}`);

      expect(changes.status).toBe(200);
      expect(changes.body.parcels.map((p) => p.name)).toEqual(['Nouvelle']);
      expect(changes.body.deletedParcelIds).toEqual([]);
      expect(new Date(changes.body.syncedAt).getTime()).toBeGreaterThan(0);
    });

    it('signale les parcelles supprimées', async () => {
      const { native } = await setup();
      const created = await native.post<{ id: string }>('/api/parcels', {
        name: 'À supprimer',
        geometry: testPolygon(1.99, 48.19),
      });

      const boundary = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await prisma.parcel.update({
        where: { id: created.body.id },
        data: { deletedAt: new Date() },
      });

      const changes = await native.get<{ deletedParcelIds: string[] }>(
        `/api/sync?since=${encodeURIComponent(boundary)}`,
      );
      expect(changes.body.deletedParcelIds).toEqual([created.body.id]);
    });

    it('refuse une date invalide plutôt que de tout renvoyer', async () => {
      const { native } = await setup();
      const response = await native.get('/api/sync?since=avant-hier');
      expect(response.status).toBe(400);
    });
  });
});
