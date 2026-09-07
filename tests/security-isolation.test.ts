import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

/**
 * Isolation des données entre exploitations.
 *
 * C'est l'exigence de sécurité centrale : un utilisateur de l'exploitation A ne
 * doit jamais atteindre les données de l'exploitation B, même en devinant un
 * identifiant et en le plaçant directement dans l'URL.
 */
describe('Isolation entre exploitations', () => {
  let alice: Awaited<ReturnType<typeof createUserWithFarm>>;
  let bob: Awaited<ReturnType<typeof createUserWithFarm>>;
  let aliceClient: TestClient;
  let bobClient: TestClient;
  let aliceParcelId: string;
  let aliceFertilizationId: string;
  let alicePhytoId: string;
  let aliceOperationId: string;
  let aliceCropYearId: string;

  beforeAll(async () => {
    await startServer();
    await resetDatabase();

    alice = await createUserWithFarm({
      email: 'alice@exploitation-a.test',
      farmName: 'Exploitation A',
    });
    bob = await createUserWithFarm({
      email: 'bob@exploitation-b.test',
      farmName: 'Exploitation B',
    });

    aliceClient = new TestClient();
    bobClient = new TestClient();

    await aliceClient.login(alice.email, alice.password);
    await bobClient.login(bob.email, bob.password);

    // Alice crée une parcelle et y saisit toutes les natures d'intervention.
    const created = await aliceClient.post<{ id: string }>('/api/parcels', {
      name: 'Parcelle confidentielle A',
      internalNumber: 'A-001',
      geometry: testPolygon(),
    });
    expect(created.status).toBe(201);
    aliceParcelId = created.body.id;

    const crop = await prisma.crop.create({
      data: { farmId: alice.farmId, code: 'TEST_CROP', name: 'Culture test' },
    });

    const cropYear = await aliceClient.post<{ item: { id: string } }>(
      `/api/parcels/${aliceParcelId}/crops`,
      { cropId: crop.id, campaignYear: 2026 },
    );
    expect(cropYear.status).toBe(201);
    aliceCropYearId = cropYear.body.item.id;

    const fertilization = await aliceClient.post<{ item: { id: string } }>(
      `/api/parcels/${aliceParcelId}/fertilization`,
      {
        appliedOn: '2026-03-01',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 150,
        doseUnit: 'kg/ha',
      },
    );
    expect(fertilization.status).toBe(201);
    aliceFertilizationId = fertilization.body.item.id;

    const phyto = await aliceClient.post<{ item: { id: string } }>(
      `/api/parcels/${aliceParcelId}/phytosanitary`,
      {
        appliedOn: '2026-03-10',
        productName: 'Produit test',
        dose: 1.2,
        doseUnit: 'L/ha',
        captureWeather: false,
      },
    );
    expect(phyto.status).toBe(201);
    alicePhytoId = phyto.body.item.id;

    const operation = await aliceClient.post<{ item: { id: string } }>(
      `/api/parcels/${aliceParcelId}/operations`,
      { performedOn: '2026-02-20', type: 'LABOUR' },
    );
    expect(operation.status).toBe(201);
    aliceOperationId = operation.body.item.id;
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  it('Bob ne peut pas lire la parcelle d’Alice via son identifiant', async () => {
    const response = await bobClient.get(`/api/parcels/${aliceParcelId}`);
    expect(response.status).toBe(404);
  });

  it('Bob ne peut pas modifier la parcelle d’Alice', async () => {
    const response = await bobClient.put(`/api/parcels/${aliceParcelId}`, {
      name: 'Parcelle détournée',
    });
    expect(response.status).toBe(404);

    const parcel = await prisma.parcel.findUniqueOrThrow({ where: { id: aliceParcelId } });
    expect(parcel.name).toBe('Parcelle confidentielle A');
  });

  it('Bob ne peut pas supprimer la parcelle d’Alice', async () => {
    const response = await bobClient.delete(`/api/parcels/${aliceParcelId}`);
    expect(response.status).toBe(404);

    const parcel = await prisma.parcel.findUniqueOrThrow({ where: { id: aliceParcelId } });
    expect(parcel.deletedAt).toBeNull();
  });

  it('Bob ne peut pas lire les interventions de la parcelle d’Alice', async () => {
    for (const path of ['crops', 'fertilization', 'phytosanitary', 'operations', 'history']) {
      const response = await bobClient.get(`/api/parcels/${aliceParcelId}/${path}`);
      expect(response.status, `GET /${path}`).toBe(404);
    }
  });

  it('Bob ne peut pas écrire dans la parcelle d’Alice', async () => {
    const fertilization = await bobClient.post(
      `/api/parcels/${aliceParcelId}/fertilization`,
      {
        appliedOn: '2026-04-01',
        inputType: 'MINERAL',
        productLabel: 'Injection',
        dose: 1,
        doseUnit: 'kg/ha',
      },
    );
    expect(fertilization.status).toBe(404);

    const count = await prisma.fertilizerApplication.count({
      where: { parcelId: aliceParcelId },
    });
    expect(count).toBe(1);
  });

  it('Bob ne peut pas supprimer les enregistrements d’Alice par leur identifiant', async () => {
    const cases: Array<[string, string]> = [
      ['/api/fertilization', aliceFertilizationId],
      ['/api/phytosanitary/applications', alicePhytoId],
      ['/api/operations', aliceOperationId],
      ['/api/crop-years', aliceCropYearId],
    ];

    for (const [base, id] of cases) {
      const response = await bobClient.delete(`${base}/${id}`);
      expect(response.status, `DELETE ${base}/${id}`).toBe(404);
    }

    expect(await prisma.fertilizerApplication.count()).toBe(1);
    expect(await prisma.phytosanitaryApplication.count()).toBe(1);
    expect(await prisma.agriculturalOperation.count()).toBe(1);
    expect(await prisma.cropYear.count()).toBe(1);
  });

  it('les listes de Bob ne contiennent aucune donnée d’Alice', async () => {
    const parcels = await bobClient.get<{ items: unknown[]; total: number }>('/api/parcels');
    expect(parcels.status).toBe(200);
    expect(parcels.body.items).toHaveLength(0);

    const geojson = await bobClient.get<{ features: unknown[] }>('/api/parcels/geojson');
    expect(geojson.body.features).toHaveLength(0);

    const registry = await bobClient.get<{ items: unknown[] }>(
      '/api/phytosanitary/applications',
    );
    expect(registry.body.items).toHaveLength(0);
  });

  it('Bob ne peut pas basculer sur l’exploitation d’Alice', async () => {
    const response = await bobClient.post('/api/farms/switch', { farmId: alice.farmId });
    expect(response.status).toBe(404);
  });

  it('les exports de Bob ne contiennent pas les parcelles d’Alice', async () => {
    const response = await bobClient.get<string>(
      '/api/exports?dataset=parcelles&format=csv',
    );
    expect(response.status).toBe(200);
    expect(String(response.body)).not.toContain('Parcelle confidentielle A');
    expect(String(response.body)).not.toContain('A-001');
  });

  it('Bob ne peut pas télécharger un document d’Alice', async () => {
    const document = await prisma.document.create({
      data: {
        farmId: alice.farmId,
        parcelId: aliceParcelId,
        fileName: 'analyse-confidentielle.pdf',
        storageKey: `${alice.farmId}/fake-key.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        category: 'ANALYSE_SOL',
      },
    });

    const response = await bobClient.get(`/api/documents/${document.id}`);
    expect(response.status).toBe(404);
  });

  it('un visiteur non authentifié n’accède à rien', async () => {
    const anonymous = new TestClient();

    const parcels = await anonymous.get('/api/parcels');
    expect(parcels.status).toBe(401);

    const parcel = await anonymous.get(`/api/parcels/${aliceParcelId}`);
    expect(parcel.status).toBe(401);

    const exportResponse = await anonymous.get('/api/exports?dataset=parcelles&format=csv');
    expect(exportResponse.status).toBe(401);
  });

  it('Alice accède bien à ses propres données', async () => {
    const parcel = await aliceClient.get<{ id: string; name: string; areaHa: number }>(
      `/api/parcels/${aliceParcelId}`,
    );
    expect(parcel.status).toBe(200);
    expect(parcel.body.name).toBe('Parcelle confidentielle A');
    expect(parcel.body.areaHa).toBeGreaterThan(0);
  });
});
