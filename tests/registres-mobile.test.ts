import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExpert,
  createUserWithFarm,
  grantAdvisoryAccess,
  prisma,
  resetDatabase,
  testPolygon,
} from './helpers/db';
import { getBaseUrl, startServer, stopServer } from './helpers/server';
import type { FicheParcelle, RegistresMobile } from '../src/lib/shared/registres';

/**
 * Registres des parcelles pour l'application (`GET /api/mobile/registres`).
 *
 * Ce que ces tests protègent :
 *
 *   · la fiche de l'application montre **ce que montre le site** : cultures,
 *     couverts, apports et bilan, traitements, travaux, historique ;
 *   · l'empreinte : identique tant que rien ne change, différente après un
 *     ajout, une modification ou une suppression — sinon le téléphone
 *     garderait des registres faux en les croyant à jour ;
 *   · le cloisonnement : rien d'une autre exploitation, l'expert en mission
 *     en lecture, l'expert sans mission nulle part.
 *
 * Passe par la vraie chaîne HTTP, avec un client natif (jeton, origine
 * Capacitor), comme l'application.
 */

const ORIGINE = 'capacitor://localhost';

class Natif {
  token = '';

  async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGINE,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      body: (type.includes('application/json') ? await response.json() : await response.text()) as T,
    };
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  async connecter(email: string, password: string): Promise<this> {
    const r = await this.request<{ token: string }>('POST', '/api/auth/login', {
      email,
      password,
      client: 'native',
      deviceName: 'Téléphone de test',
    });
    this.token = r.body.token;
    return this;
  }
}

type Complets = Extract<RegistresMobile, { unchanged: false }>;

describe('Registres des parcelles dans l’application', () => {
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

  async function exploitationRemplie() {
    const user = await createUserWithFarm({ email: 'registres@ferme.test', farmName: 'Ferme des Registres' });
    const app = await new Natif().connecter(user.email, user.password);

    const parcelle = await app.post<{ id: string }>('/api/parcels', {
      name: 'La Grande Pièce',
      geometry: testPolygon(1.9, 48.08, 0.01, 0.006),
    });
    expect(parcelle.status).toBe(201);
    const parcelId = parcelle.body.id;

    const ble = await prisma.crop.create({ data: { code: 'TEST-BLE', name: 'Blé tendre d’hiver', category: 'Céréales' } });
    expect(
      (
        await app.post(`/api/parcels/${parcelId}/crops`, {
          cropId: ble.id,
          campaignYear: 2027,
          variety: 'Chevignon',
          sowingDate: '2026-10-14',
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await app.post(`/api/parcels/${parcelId}/fertilization`, {
          appliedOn: '2027-02-25',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate 33,5 %',
          dose: 150,
          doseUnit: 'kg/ha',
          nSupplied: 50,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.post(`/api/parcels/${parcelId}/fertilization`, {
          appliedOn: '2026-09-20',
          inputType: 'ORGANIC',
          productLabel: 'Fumier de bovins',
          dose: 25,
          doseUnit: 't/ha',
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await app.post(`/api/parcels/${parcelId}/phytosanitary`, {
          appliedOn: '2027-04-02',
          productName: 'Fongicide d’essai',
          amm: '2230520',
          targetLabel: 'Septoriose',
          dose: 1,
          doseUnit: 'L/ha',
          weatherSummary: 'Couvert',
          weatherTempC: 11,
          weatherWindKmh: 9,
          captureWeather: false,
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await app.post(`/api/parcels/${parcelId}/operations`, {
          performedOn: '2026-09-28',
          type: 'LABOUR',
          equipment: 'Charrue 5 corps',
          durationHours: 6.5,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.post(`/api/parcels/${parcelId}/operations`, {
          performedOn: '2027-05-20',
          type: 'IRRIGATION',
          irrigationMm: 25,
        })
      ).status,
    ).toBe(201);

    return { user, app, parcelId };
  }

  it('enregistre un couvert depuis le site, par l’adresse de la route (régression : erreur 500)', async () => {
    const { app, parcelId } = await exploitationRemplie();
    const r = await app.post<{ id: string }>('/api/soil-covers', {
      parcelId,
      kind: 'CIPAN',
      species: 'Moutarde blanche',
      sownOn: '2026-08-05',
      destroyedOn: '2026-09-15',
      destructionMethod: 'MECANIQUE',
    });
    expect(r.status).toBe(201);
    expect(await prisma.soilCover.count({ where: { parcelId } })).toBe(1);
  });

  it('rend, parcelle par parcelle, ce que montre la fiche du site', async () => {
    const { app, user, parcelId } = await exploitationRemplie();
    await app.post('/api/soil-covers', { parcelId, kind: 'CIPAN', sownOn: '2026-08-05' });

    const r = await app.get<Complets>(`/api/mobile/registres?farmId=${user.farmId}`);
    expect(r.status).toBe(200);
    expect(r.body.unchanged).toBe(false);
    const fiche = r.body.parcels[parcelId] as FicheParcelle;

    expect(fiche.cultures).toHaveLength(1);
    expect(fiche.cultures[0]).toMatchObject({ cropName: 'Blé tendre d’hiver', variety: 'Chevignon', campaignYear: 2027 });
    expect(fiche.couverts[0]).toMatchObject({ kindLabel: 'CIPAN' });

    // Les plus récents d'abord, comme sur le site.
    expect(fiche.apports.map((a) => a.productLabel)).toEqual(['Ammonitrate 33,5 %', 'Fumier de bovins']);
    expect(fiche.apports[0]).toMatchObject({ organique: false, dose: 150, doseUnit: 'kg/ha', n: 50 });
    // Teneur inconnue : `null`, et non zéro — et le bilan le signale.
    expect(fiche.apports[1]?.n).toBeNull();
    expect(fiche.bilan?.incompleteCount).toBe(1);
    // Rapporté à la parcelle : ce que l'hectare a reçu (comme le bilan PDF).
    expect(fiche.bilan?.perHectareN).toBeCloseTo(50, 1);

    expect(fiche.traitements[0]).toMatchObject({
      productName: 'Fongicide d’essai',
      amm: '2230520',
      targetLabel: 'Septoriose',
      conditions: 'Couvert, 11 °C, vent 9 km/h',
    });

    expect(fiche.travaux.map((o) => o.typeLabel)).toEqual(['Irrigation', 'Labour']);
    expect(fiche.travaux[0]?.observations).toBe('25 mm · analyse d’eau absente');
    expect(fiche.travaux[1]).toMatchObject({ equipment: 'Charrue 5 corps', durationHours: 6.5 });

    // L'historique : les mêmes événements, rédigés comme sur le site.
    const titres = fiche.historique.map((e) => e.title);
    expect(titres).toContain('Traitement phytosanitaire : Fongicide d’essai');
    expect(titres).toContain('Apport minéral : Ammonitrate 33,5 %');
    expect(titres).toContain('Travail : Labour');
    expect(titres).toContain('Culture : Blé tendre d’hiver');
    const dates = fiche.historique.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('répond « inchangé » tant que rien ne bouge, et change après un ajout, une modification, une suppression', async () => {
    const { app, user, parcelId } = await exploitationRemplie();
    const base = `/api/mobile/registres?farmId=${user.farmId}`;

    const premier = await app.get<Complets>(base);
    const v1 = premier.body.version;

    const meme = await app.get<RegistresMobile>(`${base}&version=${v1}`);
    expect(meme.body).toEqual({ format: premier.body.format, version: v1, unchanged: true });

    // Ajout
    await app.post(`/api/parcels/${parcelId}/operations`, { performedOn: '2027-06-01', type: 'BROYAGE' });
    const apresAjout = await app.get<Complets>(`${base}&version=${v1}`);
    expect(apresAjout.body.unchanged).toBe(false);
    expect(apresAjout.body.parcels[parcelId]?.travaux).toHaveLength(3);
    const v2 = apresAjout.body.version;
    expect(v2).not.toBe(v1);

    // Modification (sans ajout ni suppression)
    const traitement = await prisma.phytosanitaryApplication.findFirstOrThrow({ where: { parcelId } });
    await prisma.phytosanitaryApplication.update({
      where: { id: traitement.id },
      data: { targetLabel: 'Rouille jaune' },
    });
    const apresModif = await app.get<Complets>(`${base}&version=${v2}`);
    expect(apresModif.body.unchanged).toBe(false);
    expect(apresModif.body.parcels[parcelId]?.traitements[0]?.targetLabel).toBe('Rouille jaune');
    const v3 = apresModif.body.version;

    // Suppression
    const travail = await prisma.agriculturalOperation.findFirstOrThrow({ where: { parcelId, type: 'BROYAGE' } });
    await prisma.agriculturalOperation.delete({ where: { id: travail.id } });
    const apresSuppr = await app.get<Complets>(`${base}&version=${v3}`);
    expect(apresSuppr.body.unchanged).toBe(false);
    expect(apresSuppr.body.parcels[parcelId]?.travaux).toHaveLength(2);
  });

  it('ne livre rien d’une autre exploitation', async () => {
    const { user } = await exploitationRemplie();
    const voisin = await createUserWithFarm({ email: 'voisin@ferme.test', farmName: 'Ferme Voisine' });
    const appVoisin = await new Natif().connecter(voisin.email, voisin.password);

    const r = await appVoisin.get(`/api/mobile/registres?farmId=${user.farmId}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('Fongicide');

    // Sans `farmId`, le voisin reçoit les siens — vides —, pas ceux d'un autre.
    const siens = await appVoisin.get<Complets>('/api/mobile/registres');
    expect(siens.status).toBe(200);
    expect(siens.body.farmId).toBe(voisin.farmId);
    expect(Object.keys(siens.body.parcels)).toHaveLength(0);
  });

  it('ouvre les registres à l’expert en mission, et à lui seul', async () => {
    const { user, parcelId } = await exploitationRemplie();
    const expert = await createExpert({ email: 'expert@conseil.test' });
    const appExpert = await new Natif().connecter(expert.email, expert.password);

    expect((await appExpert.get(`/api/mobile/registres?farmId=${user.farmId}`)).status).toBe(404);

    await grantAdvisoryAccess({ farmId: user.farmId, expertId: expert.id });
    const r = await appExpert.get<Complets>(`/api/mobile/registres?farmId=${user.farmId}`);
    expect(r.status).toBe(200);
    expect(r.body.parcels[parcelId]?.traitements).toHaveLength(1);
  });

  it('refuse sans session', async () => {
    const r = await new Natif().get('/api/mobile/registres');
    expect(r.status).toBe(401);
  });
});
