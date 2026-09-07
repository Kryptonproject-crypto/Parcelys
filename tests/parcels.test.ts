import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

describe('Parcelles', () => {
  let owner: Awaited<ReturnType<typeof createUserWithFarm>>;
  let client: TestClient;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUserWithFarm({
      email: 'proprietaire@ferme.test',
      farmName: 'Ferme des Tests',
    });
    client = new TestClient();
    await client.login(owner.email, owner.password);
  });

  // -------------------------------------------------------------------------
  describe('Création', () => {
    it('calcule la superficie à partir de la géométrie via PostGIS', async () => {
      // Rectangle d'environ 0,01° × 0,006° vers 48° N.
      const response = await client.post<{ id: string; areaHa: number }>('/api/parcels', {
        name: 'Le Grand Champ',
        internalNumber: 'P-001',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
      });

      expect(response.status).toBe(201);

      // Longitude : 0,01° ≈ 744 m à 48° N ; latitude : 0,006° ≈ 667 m.
      // Soit environ 49,6 ha ; on tolère la marge du modèle ellipsoïdal.
      expect(response.body.areaHa).toBeGreaterThan(45);
      expect(response.body.areaHa).toBeLessThan(55);

      const parcel = await prisma.parcel.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(Number(parcel.areaHa)).toBeCloseTo(response.body.areaHa, 3);
      expect(parcel.centroidLat).toBeCloseTo(48.083, 2);
      expect(parcel.centroidLng).toBeCloseTo(1.885, 2);
    });

    it('enregistre la géométrie en PostGIS et la relit en GeoJSON', async () => {
      const created = await client.post<{ id: string }>('/api/parcels', {
        name: 'Parcelle géométrique',
        geometry: testPolygon(),
      });

      const rows = await prisma.$queryRaw<
        Array<{ srid: number; type: string; valid: boolean }>
      >`
        SELECT ST_SRID(geom) AS srid, GeometryType(geom) AS type, ST_IsValid(geom) AS valid
        FROM parcel_geometries
        WHERE parcel_id = ${created.body.id} AND is_current = true
      `;

      expect(rows[0]?.srid).toBe(4326);
      expect(rows[0]?.type).toBe('MULTIPOLYGON');
      expect(rows[0]?.valid).toBe(true);

      const detail = await client.get<{ geometry: { type: string } }>(
        `/api/parcels/${created.body.id}`,
      );
      expect(detail.body.geometry.type).toBe('MultiPolygon');
    });

    it('ignore une superficie envoyée par le client', async () => {
      const response = await client.post<{ areaHa: number }>('/api/parcels', {
        name: 'Superficie trafiquée',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
        // Champ non prévu par le schéma : il doit être écarté.
        areaHa: 99999,
      });

      expect(response.status).toBe(201);
      expect(response.body.areaHa).toBeLessThan(100);
    });

    it('refuse un polygone auto-sécant', async () => {
      const response = await client.post<{ error: { message: string } }>('/api/parcels', {
        name: 'Polygone croisé',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1.88, 48.08],
              [1.89, 48.09],
              [1.89, 48.08],
              [1.88, 48.09],
              [1.88, 48.08],
            ],
          ],
        },
      });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('invalide');
    });

    it('refuse une géométrie comportant trop peu de points', async () => {
      const response = await client.post('/api/parcels', {
        name: 'Deux points',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1.88, 48.08],
              [1.89, 48.09],
            ],
          ],
        },
      });

      expect(response.status).toBe(400);
    });

    it('refuse un numéro interne déjà utilisé', async () => {
      await client.post('/api/parcels', {
        name: 'Première',
        internalNumber: 'P-100',
        geometry: testPolygon(1.88, 48.08),
      });

      const duplicate = await client.post<{ error: { code: string } }>('/api/parcels', {
        name: 'Seconde',
        internalNumber: 'P-100',
        geometry: testPolygon(1.9, 48.1),
      });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('signale un recouvrement avec une parcelle existante sans bloquer', async () => {
      await client.post('/api/parcels', {
        name: 'Parcelle initiale',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
      });

      const overlapping = await client.post<{ warnings: string[] }>('/api/parcels', {
        name: 'Parcelle chevauchante',
        geometry: testPolygon(1.885, 48.082, 0.01, 0.006),
      });

      expect(overlapping.status).toBe(201);
      expect(overlapping.body.warnings.length).toBeGreaterThan(0);
      expect(overlapping.body.warnings[0]).toContain('Parcelle initiale');
    });
  });

  // -------------------------------------------------------------------------
  describe('Modification', () => {
    it('recalcule la superficie lorsque la géométrie change', async () => {
      const created = await client.post<{ id: string; areaHa: number }>('/api/parcels', {
        name: 'À redessiner',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
      });
      const initialArea = created.body.areaHa;

      const updated = await client.put<{ areaHa: number }>(
        `/api/parcels/${created.body.id}`,
        { geometry: testPolygon(1.88, 48.08, 0.02, 0.006) },
      );

      expect(updated.status).toBe(200);
      // Largeur doublée : superficie approximativement doublée.
      expect(updated.body.areaHa).toBeGreaterThan(initialArea * 1.8);
      expect(updated.body.areaHa).toBeLessThan(initialArea * 2.2);
    });

    it('conserve l’historique des géométries', async () => {
      const created = await client.post<{ id: string }>('/api/parcels', {
        name: 'Historique géométrique',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
      });

      await client.put(`/api/parcels/${created.body.id}`, {
        geometry: testPolygon(1.88, 48.08, 0.02, 0.006),
      });

      const versions = await prisma.parcelGeometry.findMany({
        where: { parcelId: created.body.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(versions).toHaveLength(2);
      expect(versions.filter((v) => v.isCurrent)).toHaveLength(1);
      expect(versions[1]?.isCurrent).toBe(true);
    });

    it('met à jour les attributs sans toucher à la géométrie', async () => {
      const created = await client.post<{ id: string; areaHa: number }>('/api/parcels', {
        name: 'Attributs',
        geometry: testPolygon(),
      });

      await client.put(`/api/parcels/${created.body.id}`, {
        name: 'Nouveau nom',
        commune: 'Artenay',
        lieuDit: 'Les Sables',
      });

      const parcel = await prisma.parcel.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(parcel.name).toBe('Nouveau nom');
      expect(parcel.commune).toBe('Artenay');
      expect(Number(parcel.areaHa)).toBeCloseTo(created.body.areaHa, 3);

      const versions = await prisma.parcelGeometry.count({
        where: { parcelId: created.body.id },
      });
      expect(versions).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Suppression', () => {
    it('archive la parcelle et conserve ses interventions', async () => {
      const created = await client.post<{ id: string }>('/api/parcels', {
        name: 'À supprimer',
        geometry: testPolygon(),
      });

      await client.post(`/api/parcels/${created.body.id}/fertilization`, {
        appliedOn: '2026-03-01',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 150,
        doseUnit: 'kg/ha',
      });

      const response = await client.delete(`/api/parcels/${created.body.id}`);
      expect(response.status).toBe(200);

      const parcel = await prisma.parcel.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(parcel.deletedAt).not.toBeNull();
      expect(parcel.status).toBe('ARCHIVED');

      // Les interventions restent en base pour la traçabilité.
      const applications = await prisma.fertilizerApplication.count({
        where: { parcelId: created.body.id },
      });
      expect(applications).toBe(1);

      // Elle disparaît de la liste et de la carte.
      const list = await client.get<{ items: unknown[] }>('/api/parcels');
      expect(list.body.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Permissions par rôle', () => {
    async function addMember(
      farmId: string,
      email: string,
      role: 'ADMIN' | 'EMPLOYEE' | 'VIEWER',
    ): Promise<TestClient> {
      const member = await createUserWithFarm({
        email,
        farmName: `Exploitation de ${email}`,
      });
      await prisma.farmMember.create({ data: { farmId, userId: member.id, role } });
      await prisma.session.deleteMany({ where: { userId: member.id } });

      const memberClient = new TestClient();
      await memberClient.login(member.email, member.password);
      await memberClient.post('/api/farms/switch', { farmId });
      return memberClient;
    }

    it('le rôle « lecture seule » consulte mais n’écrit pas', async () => {
      const parcel = await client.post<{ id: string }>('/api/parcels', {
        name: 'Parcelle partagée',
        geometry: testPolygon(),
      });

      const viewer = await addMember(owner.farmId, 'lecteur@ferme.test', 'VIEWER');

      expect((await viewer.get('/api/parcels')).status).toBe(200);
      expect((await viewer.get(`/api/parcels/${parcel.body.id}`)).status).toBe(200);

      const create = await viewer.post<{ error: { code: string } }>('/api/parcels', {
        name: 'Interdite',
        geometry: testPolygon(1.9, 48.1),
      });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('FORBIDDEN');

      const fertilization = await viewer.post(
        `/api/parcels/${parcel.body.id}/fertilization`,
        {
          appliedOn: '2026-03-01',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate',
          dose: 150,
          doseUnit: 'kg/ha',
        },
      );
      expect(fertilization.status).toBe(403);

      expect((await viewer.delete(`/api/parcels/${parcel.body.id}`)).status).toBe(403);
    });

    it('le rôle « salarié » saisit les interventions mais ne supprime pas de parcelle', async () => {
      const parcel = await client.post<{ id: string }>('/api/parcels', {
        name: 'Parcelle salarié',
        geometry: testPolygon(),
      });

      const employee = await addMember(owner.farmId, 'salarie@ferme.test', 'EMPLOYEE');

      const fertilization = await employee.post(
        `/api/parcels/${parcel.body.id}/fertilization`,
        {
          appliedOn: '2026-03-01',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate',
          dose: 150,
          doseUnit: 'kg/ha',
        },
      );
      expect(fertilization.status).toBe(201);

      expect((await employee.delete(`/api/parcels/${parcel.body.id}`)).status).toBe(403);

      // Il ne peut pas non plus modifier l'exploitation.
      const farmUpdate = await employee.put('/api/farms', { name: 'Renommée' });
      expect(farmUpdate.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('Recherche et filtres', () => {
    it('filtre par nom, commune et culture', async () => {
      const first = await client.post<{ id: string }>('/api/parcels', {
        name: 'Le Grand Champ',
        commune: 'Artenay',
        geometry: testPolygon(1.88, 48.08),
      });
      await client.post('/api/parcels', {
        name: 'Les Sables',
        commune: 'Chevilly',
        geometry: testPolygon(1.9, 48.1),
      });

      const crop = await prisma.crop.create({
        data: { farmId: owner.farmId, code: 'BLE', name: 'Blé tendre' },
      });
      await client.post(`/api/parcels/${first.body.id}/crops`, {
        cropId: crop.id,
        campaignYear: 2026,
      });

      const byName = await client.get<{ items: Array<{ name: string }> }>(
        '/api/parcels?search=Grand',
      );
      expect(byName.body.items).toHaveLength(1);
      expect(byName.body.items[0]?.name).toBe('Le Grand Champ');

      const byCommune = await client.get<{ items: unknown[] }>(
        '/api/parcels?commune=Chevilly',
      );
      expect(byCommune.body.items).toHaveLength(1);

      const byCrop = await client.get<{ items: Array<{ name: string }> }>(
        `/api/parcels?cropId=${crop.id}&year=2026`,
      );
      expect(byCrop.body.items).toHaveLength(1);
      expect(byCrop.body.items[0]?.name).toBe('Le Grand Champ');
    });
  });
});
