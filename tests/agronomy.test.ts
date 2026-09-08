import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

describe('Suivi agronomique', () => {
  let owner: Awaited<ReturnType<typeof createUserWithFarm>>;
  let client: TestClient;
  let parcelId: string;
  let parcelAreaHa: number;
  let cropId: string;

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
      email: 'agro@ferme.test',
      farmName: 'Ferme Agronomie',
    });
    client = new TestClient();
    await client.login(owner.email, owner.password);

    const parcel = await client.post<{ id: string; areaHa: number }>('/api/parcels', {
      name: 'Parcelle agronomique',
      internalNumber: 'AG-01',
      geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
    });
    parcelId = parcel.body.id;
    parcelAreaHa = parcel.body.areaHa;

    const crop = await prisma.crop.create({
      data: { farmId: owner.farmId, code: 'BLE_TENDRE', name: 'Blé tendre' },
    });
    cropId = crop.id;
  });

  // -------------------------------------------------------------------------
  describe('Cultures', () => {
    it('enregistre une culture pour une campagne', async () => {
      const response = await client.post<{ item: { id: string; variety: string } }>(
        `/api/parcels/${parcelId}/crops`,
        {
          cropId,
          campaignYear: 2026,
          variety: 'Rubisko',
          sowingDate: '2025-10-15',
          expectedHarvestDate: '2026-07-20',
        },
      );

      expect(response.status).toBe(201);
      expect(response.body.item.variety).toBe('Rubisko');

      const stored = await prisma.cropYear.findFirstOrThrow({ where: { parcelId } });
      expect(stored.campaignYear).toBe(2026);
      expect(stored.sowingDate?.toISOString().slice(0, 10)).toBe('2025-10-15');
    });

    it('met à jour la culture existante d’une même campagne', async () => {
      await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId,
        campaignYear: 2026,
        variety: 'Rubisko',
      });

      await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId,
        campaignYear: 2026,
        variety: 'Chevignon',
        yieldValue: 82.5,
        yieldUnit: 'q/ha',
      });

      const rows = await prisma.cropYear.findMany({ where: { parcelId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.variety).toBe('Chevignon');
      expect(Number(rows[0]?.yieldValue)).toBe(82.5);
    });

    it('conserve l’historique d’une campagne à l’autre', async () => {
      const colza = await prisma.crop.create({
        data: { farmId: owner.farmId, code: 'COLZA', name: 'Colza' },
      });

      await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId: colza.id,
        campaignYear: 2025,
        actualHarvestDate: '2025-07-10',
        yieldValue: 38,
        yieldUnit: 'q/ha',
      });
      await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId,
        campaignYear: 2026,
      });

      const list = await client.get<{ items: Array<{ campaignYear: number }> }>(
        `/api/parcels/${parcelId}/crops`,
      );
      expect(list.body.items).toHaveLength(2);
      expect(list.body.items[0]?.campaignYear).toBe(2026);
      expect(list.body.items[1]?.campaignYear).toBe(2025);
    });

    it('refuse une culture qui n’appartient pas à l’exploitation', async () => {
      const other = await createUserWithFarm({
        email: 'autre@ferme.test',
        farmName: 'Autre exploitation',
      });
      const foreignCrop = await prisma.crop.create({
        data: { farmId: other.farmId, code: 'ETRANGERE', name: 'Culture étrangère' },
      });

      const response = await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId: foreignCrop.id,
        campaignYear: 2026,
      });
      expect(response.status).toBe(400);
    });

    it('refuse une récolte antérieure au semis', async () => {
      const response = await client.post<{ error: { message: string } }>(
        `/api/parcels/${parcelId}/crops`,
        {
          cropId,
          campaignYear: 2026,
          sowingDate: '2026-03-01',
          actualHarvestDate: '2026-01-15',
        },
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('récolte');
    });
  });

  // -------------------------------------------------------------------------
  describe('Apports', () => {
    it('calcule la quantité totale : dose × surface', async () => {
      const response = await client.post<{
        computed: { totalQuantity: number; totalUnit: string };
      }>(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate 33,5 %',
        dose: 180,
        doseUnit: 'kg/ha',
      });

      expect(response.status).toBe(201);
      expect(response.body.computed.totalUnit).toBe('kg');
      expect(response.body.computed.totalQuantity).toBeCloseTo(180 * parcelAreaHa, 1);
    });

    it('calcule les éléments fertilisants depuis le référentiel', async () => {
      const fertilizer = await prisma.fertilizer.create({
        data: {
          farmId: owner.farmId,
          name: 'Ammonitrate 33,5 %',
          category: 'Azote',
          nPercent: 33.5,
          defaultUnit: 'kg/ha',
        },
      });

      const response = await client.post<{
        computed: { nSupplied: number; pSupplied: number | null };
      }>(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        fertilizerId: fertilizer.id,
        productLabel: 'ignoré, remplacé par le référentiel',
        dose: 200,
        doseUnit: 'kg/ha',
      });

      // 200 kg/ha × 33,5 % = 67 kg N/ha
      expect(response.body.computed.nSupplied).toBeCloseTo(67, 2);
      // Teneur en phosphore inconnue : jamais estimée.
      expect(response.body.computed.pSupplied).toBeNull();

      const stored = await prisma.fertilizerApplication.findFirstOrThrow({
        where: { parcelId },
      });
      expect(stored.productLabel).toBe('Ammonitrate 33,5 %');
      expect(Number(stored.nSupplied)).toBeCloseTo(67, 2);
    });

    it('accepte une saisie manuelle des éléments, prioritaire sur le calcul', async () => {
      const organic = await prisma.organicInput.create({
        data: { farmId: owner.farmId, name: 'Fumier bovin', defaultUnit: 't/ha' },
      });

      const response = await client.post<{ computed: { nSupplied: number } }>(
        `/api/parcels/${parcelId}/fertilization`,
        {
          appliedOn: '2025-09-20',
          inputType: 'ORGANIC',
          organicInputId: organic.id,
          productLabel: 'Fumier bovin',
          dose: 25,
          doseUnit: 't/ha',
          // Valeur issue d'une analyse de l'exploitation.
          nSupplied: 112.5,
        },
      );

      expect(response.body.computed.nSupplied).toBe(112.5);
    });

    it('refuse une surface traitée supérieure à la parcelle', async () => {
      const response = await client.post<{ error: { message: string } }>(
        `/api/parcels/${parcelId}/fertilization`,
        {
          appliedOn: '2026-02-25',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate',
          dose: 180,
          doseUnit: 'kg/ha',
          treatedAreaHa: parcelAreaHa * 2,
        },
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('dépasse');
    });

    it('refuse une dose nulle ou négative', async () => {
      for (const dose of [0, -5]) {
        const response = await client.post(`/api/parcels/${parcelId}/fertilization`, {
          appliedOn: '2026-02-25',
          inputType: 'MINERAL',
          productLabel: 'Ammonitrate',
          dose,
          doseUnit: 'kg/ha',
        });
        expect(response.status, `dose = ${dose}`).toBe(400);
      }
    });

    it('produit un bilan NPK cohérent et signale les apports incomplets', async () => {
      const fertilizer = await prisma.fertilizer.create({
        data: {
          farmId: owner.farmId,
          name: 'NPK 15-15-15',
          nPercent: 15,
          pPercent: 15,
          kPercent: 15,
          defaultUnit: 'kg/ha',
        },
      });

      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        fertilizerId: fertilizer.id,
        productLabel: 'NPK',
        dose: 300,
        doseUnit: 'kg/ha',
      });

      // Apport sans teneur connue : compté comme incomplet.
      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2025-09-20',
        inputType: 'ORGANIC',
        productLabel: 'Fumier sans analyse',
        dose: 20,
        doseUnit: 't/ha',
      });

      const response = await client.get<{
        balance: { perHectareN: number; perHectareP: number; incompleteCount: number };
      }>(`/api/parcels/${parcelId}/fertilization`);

      // 300 kg/ha × 15 % = 45 kg/ha, appliqués sur les deux surfaces cumulées :
      // la moyenne pondérée est donc de 22,5 kg/ha.
      expect(response.body.balance.perHectareN).toBeCloseTo(22.5, 1);
      expect(response.body.balance.perHectareP).toBeCloseTo(22.5, 1);
      expect(response.body.balance.incompleteCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Traitements phytosanitaires', () => {
    it('enregistre un traitement en saisie libre et signale l’AMM manquante', async () => {
      const response = await client.post<{ warnings: string[] }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        {
          appliedOn: '2026-03-15',
          productName: 'Produit non référencé',
          dose: 1.5,
          doseUnit: 'L/ha',
          targetLabel: 'Adventices',
          captureWeather: false,
        },
      );

      expect(response.status).toBe(201);
      expect(response.body.warnings[0]).toContain('AMM');

      const stored = await prisma.phytosanitaryApplication.findFirstOrThrow({
        where: { parcelId },
      });
      // Aucune donnée réglementaire n'est inventée.
      expect(stored.amm).toBeNull();
      expect(stored.activeSubstances).toBeNull();
      expect(Number(stored.quantityUsed)).toBeCloseTo(1.5 * parcelAreaHa, 2);
    });

    it('reprend l’AMM et les substances actives du référentiel E-Phy', async () => {
      const substance = await prisma.activeSubstance.create({
        data: { name: 'Substance de test', normalizedName: 'substance de test' },
      });
      const product = await prisma.phytosanitaryProduct.create({
        data: {
          amm: '9900001',
          name: 'Produit officiel de test',
          normalizedName: 'produit officiel de test',
          status: 'Autorisé',
          substances: { create: { substanceId: substance.id } },
        },
      });

      await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
        appliedOn: '2026-03-15',
        productId: product.id,
        // Le client tente d'imposer d'autres valeurs : elles sont ignorées.
        productName: 'Nom falsifié',
        amm: '0000000',
        dose: 1.5,
        doseUnit: 'L/ha',
        captureWeather: false,
      });

      const stored = await prisma.phytosanitaryApplication.findFirstOrThrow({
        where: { parcelId },
      });
      expect(stored.productName).toBe('Produit officiel de test');
      expect(stored.amm).toBe('9900001');
      expect(stored.activeSubstances).toBe('Substance de test');
    });

    it('refuse un produit inexistant dans le référentiel', async () => {
      const response = await client.post<{ error: { message: string } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        {
          appliedOn: '2026-03-15',
          productId: 'produit-inexistant',
          productName: 'Test',
          dose: 1,
          doseUnit: 'L/ha',
          captureWeather: false,
        },
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('E-Phy');
    });

    it('conserve les conditions météo saisies manuellement', async () => {
      await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
        appliedOn: '2026-03-15',
        productName: 'Produit',
        dose: 1,
        doseUnit: 'L/ha',
        captureWeather: false,
        weatherTempC: 14.5,
        weatherWindKmh: 9,
        weatherHumidity: 68,
        weatherSummary: 'Ciel voilé',
      });

      const stored = await prisma.phytosanitaryApplication.findFirstOrThrow({
        where: { parcelId },
      });
      expect(Number(stored.weatherTempC)).toBe(14.5);
      expect(Number(stored.weatherWindKmh)).toBe(9);
      expect(stored.weatherSummary).toBe('Ciel voilé');
    });
  });

  // -------------------------------------------------------------------------
  describe('Travaux et historique', () => {
    it('enregistre un travail agricole', async () => {
      const response = await client.post(`/api/parcels/${parcelId}/operations`, {
        performedOn: '2025-09-05',
        type: 'DECHAUMAGE',
        equipment: 'Déchaumeur à disques 4 m',
        operator: 'Camille',
        durationHours: 1.5,
      });

      expect(response.status).toBe(201);

      const stored = await prisma.agriculturalOperation.findFirstOrThrow({
        where: { parcelId },
      });
      expect(stored.type).toBe('DECHAUMAGE');
      expect(Number(stored.durationHours)).toBe(1.5);
    });

    it('construit un historique chronologique complet', async () => {
      await client.post(`/api/parcels/${parcelId}/crops`, {
        cropId,
        campaignYear: 2026,
        sowingDate: '2025-10-15',
        actualHarvestDate: '2026-07-20',
        yieldValue: 78,
        yieldUnit: 'q/ha',
      });
      await client.post(`/api/parcels/${parcelId}/operations`, {
        performedOn: '2025-09-05',
        type: 'DECHAUMAGE',
      });
      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 180,
        doseUnit: 'kg/ha',
      });
      await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
        appliedOn: '2026-03-15',
        productName: 'Produit',
        dose: 1.5,
        doseUnit: 'L/ha',
        captureWeather: false,
      });

      const response = await client.get<{
        events: Array<{ kind: string; date: string; title: string }>;
      }>(`/api/parcels/${parcelId}/history`);

      expect(response.status).toBe(200);
      const kinds = response.body.events.map((e) => e.kind);
      expect(kinds).toContain('CROP');
      expect(kinds).toContain('HARVEST');
      expect(kinds).toContain('FERTILIZATION');
      expect(kinds).toContain('PHYTO');
      expect(kinds).toContain('OPERATION');

      // L'ordre est antichronologique.
      const dates = response.body.events.map((e) => e.date);
      const sorted = [...dates].sort((a, b) => b.localeCompare(a));
      expect(dates).toEqual(sorted);
    });

    it('filtre l’historique par nature d’événement', async () => {
      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 180,
        doseUnit: 'kg/ha',
      });
      await client.post(`/api/parcels/${parcelId}/operations`, {
        performedOn: '2025-09-05',
        type: 'LABOUR',
      });

      const response = await client.get<{ events: Array<{ kind: string }> }>(
        `/api/parcels/${parcelId}/history?kinds=FERTILIZATION`,
      );

      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0]?.kind).toBe('FERTILIZATION');
    });
  });

  // -------------------------------------------------------------------------
  describe('Exports', () => {
    beforeEach(async () => {
      await client.post(`/api/parcels/${parcelId}/crops`, { cropId, campaignYear: 2026 });
      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate 33,5 %',
        dose: 180,
        doseUnit: 'kg/ha',
      });
      await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
        appliedOn: '2026-03-15',
        productName: 'Produit de test',
        dose: 1.5,
        doseUnit: 'L/ha',
        targetLabel: 'Adventices',
        captureWeather: false,
      });
    });

    it('exporte le registre parcellaire en CSV lisible par Excel', async () => {
      const response = await client.get<string>('/api/exports?dataset=parcelles&format=csv');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.headers.get('content-disposition')).toContain('attachment');

      const csv = String(response.body);
      expect(csv).toContain('Parcelle agronomique');
      expect(csv).toContain('AG-01');
      // Séparateur point-virgule attendu par Excel en français.
      expect(csv.split('\r\n')[0]).toContain(';');
    });

    it('exporte le registre phytosanitaire avec ses colonnes réglementaires', async () => {
      const response = await client.get<string>(
        '/api/exports?dataset=phytosanitaire&format=csv&year=2026',
      );

      const csv = String(response.body);
      const header = csv.split('\r\n')[0] ?? '';
      for (const column of ['Date', 'Parcelle', 'Produit', 'N° AMM', 'Substances actives']) {
        expect(header).toContain(column);
      }
      expect(csv).toContain('Produit de test');
      expect(csv).toContain('Adventices');
    });

    it('exporte les apports avec le détail N, P, K', async () => {
      const response = await client.get<string>(
        '/api/exports?dataset=apports&format=csv&year=2026',
      );
      expect(String(response.body)).toContain('Ammonitrate 33,5 %');
    });

    it('génère un PDF et un fichier Excel valides', async () => {
      const pdf = await client.download(
        '/api/exports?dataset=phytosanitaire&format=pdf&year=2026',
      );
      expect(pdf.status).toBe(200);
      expect(pdf.contentType).toContain('application/pdf');
      expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.bytes.length).toBeGreaterThan(1000);

      const xlsx = await client.download('/api/exports?dataset=apports&format=xlsx&year=2026');
      expect(xlsx.status).toBe(200);
      // Un .xlsx est une archive ZIP : signature « PK\x03\x04 ».
      expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK');
    });

    it('établit le bilan de fertilisation avec ses unités et son total', async () => {
      // Apport rattaché à un engrais du référentiel : la teneur est connue,
      // 180 kg/ha d'ammonitrate à 33,5 % font 60,3 unités d'azote par hectare.
      const ammonitrate = await prisma.fertilizer.create({
        data: {
          name: 'Ammonitrate 33,5 %',
          category: 'AZOTE',
          nPercent: '33.5',
          defaultUnit: 'kg/ha',
        },
      });
      await client.post(`/api/parcels/${parcelId}/fertilization`, {
        appliedOn: '2026-03-05',
        inputType: 'MINERAL',
        fertilizerId: ammonitrate.id,
        productLabel: ammonitrate.name,
        dose: 180,
        doseUnit: 'kg/ha',
      });

      const response = await client.get<string>(
        '/api/exports?dataset=bilan-engrais&format=csv&year=2026',
      );

      expect(response.status).toBe(200);
      const lines = String(response.body).split('\r\n');
      const header = lines[0] ?? '';
      for (const column of ['Parcelle', 'Surface (ha)', 'N (kg/ha)', 'N total (kg)']) {
        expect(header).toContain(column);
      }

      const parcelLine = lines.find((line) => line.includes('Parcelle agronomique')) ?? '';
      expect(parcelLine).toContain('60,3');

      // La dernière ligne est le total de l'exploitation.
      const totals = lines.filter(Boolean).at(-1) ?? '';
      expect(totals).toContain('Total');
      expect(totals).toContain('60,3');
    });

    it('ne comble jamais une teneur inconnue dans le bilan', async () => {
      const { buildFertilizerBalanceDataset } = await import(
        '../src/lib/exports/datasets'
      );
      const farm = await prisma.farm.findFirstOrThrow({ where: { deletedAt: null } });

      // L'apport du `beforeEach` est saisi en produit libre, sans teneur.
      const dataset = await buildFertilizerBalanceDataset({
        farmId: farm.id,
        farmName: farm.name,
        year: 2026,
      });

      const row = dataset.rows[0];
      expect(row?.nHa).toBe('0,0');
      expect(row?.unknown).toBe('1');
      expect(dataset.notices?.[0]).toContain('sans teneur');
    });

    it('annonce l’absence de catalogue E-Phy plutôt qu’une fausse vérification', async () => {
      const { buildPhytoDataset } = await import('../src/lib/exports/datasets');
      const farm = await prisma.farm.findFirstOrThrow({ where: { deletedAt: null } });

      const dataset = await buildPhytoDataset({
        farmId: farm.id,
        farmName: farm.name,
        year: 2026,
      });

      // Aucun catalogue importé dans cette base : le registre doit le dire.
      expect(dataset.footnote).toContain('non importé');
      expect(dataset.footnote).not.toContain('synchronisation le');
    });

    it('cite la source et la date de synchronisation quand E-Phy est importé', async () => {
      const { buildPhytoDataset } = await import('../src/lib/exports/datasets');
      const farm = await prisma.farm.findFirstOrThrow({ where: { deletedAt: null } });

      await prisma.ephySyncRun.create({
        data: {
          status: 'SUCCESS',
          source: 'Échantillon de test',
          version: '2026-01',
          finishedAt: new Date('2026-02-10T08:00:00Z'),
        },
      });

      const dataset = await buildPhytoDataset({
        farmId: farm.id,
        farmName: farm.name,
        year: 2026,
      });

      expect(dataset.footnote).toContain('E-Phy');
      expect(dataset.footnote).toContain('Échantillon de test');
      expect(dataset.footnote).toContain('10/02/2026');
    });

    it('restreint l’export aux parcelles sélectionnées', async () => {
      await client.post('/api/parcels', {
        name: 'Parcelle exclue',
        geometry: testPolygon(1.95, 48.15),
      });

      const response = await client.get<string>(
        `/api/exports?dataset=parcelles&format=csv&parcelIds=${parcelId}`,
      );

      const csv = String(response.body);
      expect(csv).toContain('Parcelle agronomique');
      expect(csv).not.toContain('Parcelle exclue');
    });
  });
});
