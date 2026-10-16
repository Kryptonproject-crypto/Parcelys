import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';

/**
 * Corriger un enregistrement (0.11.2) : apport, traitement, travail, couvert,
 * culture.
 *
 * Ce que ces tests protègent :
 *
 *   · une correction recalcule comme une création (quantité totale, éléments
 *     fertilisants) et passe les mêmes contrôles (surface, dates) ;
 *   · elle n'efface pas ce que le formulaire ne montre pas : une teneur saisie
 *     d'après une analyse, la météo du jour de l'intervention ;
 *   · la sortie de stock d'un traitement suit sa correction ;
 *   · chaque correction est journalisée avec l'avant et l'après ;
 *   · on ne corrige que ce qu'on a le droit d'écrire, et chez soi ;
 *   · l'application corrige et supprime par la file d'attente.
 */
describe('Corriger un enregistrement', () => {
  let owner: Awaited<ReturnType<typeof createUserWithFarm>>;
  let client: TestClient;
  let parcelId: string;
  let surface: number;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUserWithFarm({ email: 'corrige@ferme.test', farmName: 'Ferme des Corrections' });
    client = new TestClient();
    await client.login(owner.email, owner.password);
    const parcelle = await client.post<{ id: string; areaHa: string }>('/api/parcels', {
      name: 'Le Pré Haut',
      geometry: testPolygon(1.9, 48.08, 0.01, 0.006),
    });
    expect(parcelle.status).toBe(201);
    parcelId = parcelle.body.id;
    surface = Number(
      (await prisma.parcel.findUniqueOrThrow({ where: { id: parcelId }, select: { areaHa: true } })).areaHa,
    );
  });

  async function engrais(nPercent: number) {
    return prisma.fertilizer.create({
      data: { farmId: owner.farmId, name: `Engrais ${nPercent} %`, nPercent, defaultUnit: 'kg/ha' },
    });
  }

  async function apport(body: Record<string, unknown>) {
    const r = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/fertilization`, {
      appliedOn: '2027-02-25',
      inputType: 'MINERAL',
      doseUnit: 'kg/ha',
      ...body,
    });
    expect(r.status).toBe(201);
    return r.body.item.id;
  }

  // -------------------------------------------------------------------------
  describe('Apports', () => {
    it('recalcule la quantité totale et l’azote quand la dose change', async () => {
      const ammo = await engrais(33.5);
      const id = await apport({ fertilizerId: ammo.id, productLabel: 'x', dose: 150 });

      const r = await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-03-01',
        inputType: 'MINERAL',
        fertilizerId: ammo.id,
        productLabel: 'x',
        dose: 200,
        doseUnit: 'kg/ha',
      });
      expect(r.status).toBe(200);

      const ligne = await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } });
      expect(Number(ligne.dose)).toBe(200);
      expect(Number(ligne.nSupplied)).toBeCloseTo(67, 1);
      expect(Number(ligne.totalQuantity)).toBeCloseTo(200 * surface, 0);
      expect(ligne.appliedOn.toISOString().slice(0, 10)).toBe('2027-03-01');
      expect(ligne.productLabel).toBe('Engrais 33.5 %');
    });

    it('garde une teneur saisie d’après une analyse si la correction n’en dit rien', async () => {
      const id = await apport({ inputType: 'ORGANIC', productLabel: 'Fumier analysé', dose: 25, doseUnit: 't/ha', nSupplied: 120 });

      // Ce que l'application envoie : pas de champ N.
      const r = await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-26',
        inputType: 'ORGANIC',
        productLabel: 'Fumier analysé',
        dose: 30,
        doseUnit: 't/ha',
      });
      expect(r.status).toBe(200);
      expect(Number((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).nSupplied)).toBe(120);

      // `null` : retour au calcul — ici, aucune teneur connue.
      await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-26',
        inputType: 'ORGANIC',
        productLabel: 'Fumier analysé',
        dose: 30,
        doseUnit: 't/ha',
        nSupplied: null,
      });
      expect((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).nSupplied).toBeNull();
    });

    it('ne garde pas la teneur saisie quand on change de produit', async () => {
      const ammo = await engrais(27);
      const id = await apport({ productLabel: 'Engrais inconnu', dose: 100, nSupplied: 40 });
      await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        fertilizerId: ammo.id,
        productLabel: 'x',
        dose: 100,
        doseUnit: 'kg/ha',
      });
      expect(Number((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).nSupplied)).toBe(27);
    });

    it('garde la météo du jour de l’intervention', async () => {
      const id = await apport({
        productLabel: 'Ammonitrate',
        dose: 100,
        weatherSummary: 'Couvert',
        weatherWindKmh: 8,
        captureWeather: false,
      });
      await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 110,
        doseUnit: 'kg/ha',
      });
      const ligne = await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } });
      expect(ligne.weatherSummary).toBe('Couvert');
      expect(Number(ligne.weatherWindKmh)).toBe(8);
    });

    it('refuse une surface traitée supérieure à la parcelle, comme à la création', async () => {
      const id = await apport({ productLabel: 'Ammonitrate', dose: 100 });
      const r = await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 100,
        doseUnit: 'kg/ha',
        treatedAreaHa: surface * 2,
      });
      expect(r.status).toBe(400);
    });

    it('inscrit au journal ce qui a changé, avant et après', async () => {
      const id = await apport({ productLabel: 'Ammonitrate', dose: 100 });
      await client.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 120,
        doseUnit: 'kg/ha',
      });
      const trace = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'fertilization.updated', entityId: id },
      });
      const modifs = (trace.metadata as { modifications: Record<string, { avant: unknown; apres: unknown }> })
        .modifications;
      expect(modifs.dose).toEqual({ avant: 100, apres: 120 });
      expect(modifs.productLabel).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('Traitements et stock', () => {
    async function lotEnStock(quantite: number) {
      const item = await prisma.stockItem.create({
        data: { farmId: owner.farmId, category: 'PHYTOSANITAIRE', name: 'Fongicide en stock', unit: 'L' },
      });
      const lot = await prisma.stockLot.create({ data: { itemId: item.id, lotNumber: 'L-001' } });
      await prisma.stockMovement.create({
        data: { itemId: item.id, lotId: lot.id, kind: 'ENTREE', occurredOn: new Date('2027-01-10'), quantity: quantite, unit: 'L' },
      });
      return { item, lot };
    }

    const traitement = (extra: Record<string, unknown> = {}) => ({
      appliedOn: '2027-04-02',
      productName: 'Fongicide en stock',
      dose: 1,
      doseUnit: 'L/ha',
      captureWeather: false,
      ...extra,
    });

    async function sorties(applicationId: string) {
      return prisma.stockMovement.findMany({ where: { phytoApplicationId: applicationId, kind: 'SORTIE' } });
    }

    it('ajuste la sortie de stock à la dose corrigée', async () => {
      const { lot } = await lotEnStock(500);
      const cree = await client.post<{ item: { id: string } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        traitement({ stockLotId: lot.id }),
      );
      const id = cree.body.item.id;
      expect(Number((await sorties(id))[0]?.quantity)).toBeCloseTo(-surface, 2);

      // Sans `stockLotId` : le lot n'est pas en cause, la sortie suit la dose.
      const r = await client.put<{ warnings: string[] }>(`/api/phytosanitary/applications/${id}`, traitement({ dose: 0.5 }));
      expect(r.status).toBe(200);
      const apres = await sorties(id);
      expect(apres).toHaveLength(1);
      expect(Number(apres[0]?.quantity)).toBeCloseTo(-0.5 * surface, 2);

      const ligne = await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id } });
      expect(Number(ligne.quantityUsed)).toBeCloseTo(0.5 * surface, 2);
    });

    it('annule la sortie de stock quand on retire le lot', async () => {
      const { lot } = await lotEnStock(500);
      const cree = await client.post<{ item: { id: string } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        traitement({ stockLotId: lot.id }),
      );
      const id = cree.body.item.id;
      const r = await client.put<{ warnings: string[] }>(
        `/api/phytosanitary/applications/${id}`,
        traitement({ stockLotId: null }),
      );
      expect(r.status).toBe(200);
      expect(await sorties(id)).toHaveLength(0);
      expect(r.body.warnings.join(' ')).toMatch(/sortie de stock .* annulée/);
    });

    it('rattache un lot ajouté à la correction', async () => {
      const { lot } = await lotEnStock(500);
      const cree = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/phytosanitary`, traitement());
      const id = cree.body.item.id;
      expect(await sorties(id)).toHaveLength(0);
      await client.put(`/api/phytosanitary/applications/${id}`, traitement({ stockLotId: lot.id }));
      const apres = await sorties(id);
      expect(apres).toHaveLength(1);
      expect(apres[0]?.lotId).toBe(lot.id);
    });

    it('rattache au catalogue un produit désigné par sa seule AMM (saisie de l’application)', async () => {
      const produit = await prisma.phytosanitaryProduct.create({
        data: { amm: '2230520', name: 'PRODUIT DU CATALOGUE', normalizedName: 'produit du catalogue', status: 'Autorisé' },
      });
      // Ce que l'application envoie : nom et AMM, jamais l'identifiant.
      const cree = await client.post<{ item: { id: string; productId: string | null; productName: string } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        traitement({ productName: 'Nom tapé au champ', amm: '2230520' }),
      );
      expect(cree.status).toBe(201);
      expect(cree.body.item.productId).toBe(produit.id);
      expect(cree.body.item.productName).toBe('PRODUIT DU CATALOGUE');

      // Une AMM inconnue du catalogue reste une saisie libre, telle quelle.
      const libre = await client.post<{ item: { productId: string | null; amm: string | null } }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        traitement({ productName: 'Produit hors catalogue', amm: '9999999' }),
      );
      expect(libre.body.item.productId).toBeNull();
      expect(libre.body.item.amm).toBe('9999999');
    });

    it('signale toujours l’AMM manquante après correction', async () => {
      const cree = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/phytosanitary`, traitement());
      const r = await client.put<{ warnings: string[] }>(
        `/api/phytosanitary/applications/${cree.body.item.id}`,
        traitement({ targetLabel: 'Septoriose' }),
      );
      expect(r.body.warnings.join(' ')).toMatch(/Aucun numéro d’AMM/);
      expect(
        (await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: cree.body.item.id } })).targetLabel,
      ).toBe('Septoriose');
    });
  });

  // -------------------------------------------------------------------------
  describe('Travaux, couverts, cultures', () => {
    it('corrige un travail', async () => {
      const cree = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/operations`, {
        performedOn: '2026-09-28',
        type: 'LABOUR',
        equipment: 'Charrue',
      });
      const id = cree.body.item.id;
      const r = await client.put(`/api/operations/${id}`, {
        performedOn: '2026-09-29',
        type: 'DECHAUMAGE',
        equipment: 'Déchaumeur à disques',
        durationHours: 3,
      });
      expect(r.status).toBe(200);
      const ligne = await prisma.agriculturalOperation.findUniqueOrThrow({ where: { id } });
      expect(ligne).toMatchObject({ type: 'DECHAUMAGE', equipment: 'Déchaumeur à disques' });
      expect(Number(ligne.durationHours)).toBe(3);
    });

    it('corrige un couvert, et refuse des dates incohérentes', async () => {
      const cree = await client.post<{ id: string }>('/api/soil-covers', { parcelId, kind: 'CIPAN', sownOn: '2026-08-05' });
      const id = cree.body.id;
      expect((await client.put(`/api/soil-covers/${id}`, { kind: 'CIPAN', sownOn: '2026-08-05', destroyedOn: '2026-07-01' })).status).toBe(400);
      const r = await client.put(`/api/soil-covers/${id}`, {
        kind: 'DEROBEE',
        species: 'Sorgho',
        sownOn: '2026-07-20',
        destroyedOn: '2026-10-01',
        destructionMethod: 'BROYAGE',
      });
      expect(r.status).toBe(200);
      expect(await prisma.soilCover.findUniqueOrThrow({ where: { id } })).toMatchObject({
        kind: 'DEROBEE',
        species: 'Sorgho',
        destructionMethod: 'BROYAGE',
      });
    });

    it('corrige la culture d’une campagne, sans créer de doublon', async () => {
      const ble = await prisma.crop.create({ data: { code: 'T-BLE', name: 'Blé tendre', farmId: owner.farmId } });
      const orge = await prisma.crop.create({ data: { code: 'T-ORGE', name: 'Orge d’hiver', farmId: owner.farmId } });
      const c1 = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/crops`, { cropId: ble.id, campaignYear: 2027 });
      await client.post(`/api/parcels/${parcelId}/crops`, { cropId: orge.id, campaignYear: 2026 });

      const r = await client.put(`/api/crop-years/${c1.body.item.id}`, { cropId: orge.id, campaignYear: 2027, variety: 'Étincel' });
      expect(r.status).toBe(200);
      expect(await prisma.cropYear.findUniqueOrThrow({ where: { id: c1.body.item.id } })).toMatchObject({ cropId: orge.id, variety: 'Étincel' });

      const doublon = await client.put(`/api/crop-years/${c1.body.item.id}`, { cropId: orge.id, campaignYear: 2026 });
      expect(doublon.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('Droits et cloisonnement', () => {
    it('répond 404 pour l’enregistrement d’une autre exploitation', async () => {
      const id = await apport({ productLabel: 'Ammonitrate', dose: 100 });
      const voisin = await createUserWithFarm({ email: 'voisin@ferme.test', farmName: 'Voisine' });
      const autre = new TestClient();
      await autre.login(voisin.email, voisin.password);
      const r = await autre.put(`/api/fertilization/${id}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        productLabel: 'Pirate',
        dose: 1,
        doseUnit: 'kg/ha',
      });
      expect(r.status).toBe(404);
      expect((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).productLabel).toBe('Ammonitrate');
    });

    it('refuse la correction à un membre en lecture seule', async () => {
      const id = await apport({ productLabel: 'Ammonitrate', dose: 100 });
      const lecteur = await createUserWithFarm({ email: 'lecteur@ferme.test', farmName: 'Sa ferme' });
      await prisma.farmMember.create({ data: { farmId: owner.farmId, userId: lecteur.id, role: 'VIEWER' } });
      const c = new TestClient();
      await c.login(lecteur.email, lecteur.password);
      const r = await c.put(`/api/fertilization/${id}?farmId=${owner.farmId}`, {
        appliedOn: '2027-02-25',
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 999,
        doseUnit: 'kg/ha',
      });
      expect(r.status).toBe(403);
      expect(Number((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).dose)).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  describe('Depuis l’application, par la file d’attente', () => {
    it('corrige et supprime, et tient pour fait ce qui est déjà supprimé', async () => {
      const id = await apport({ productLabel: 'Ammonitrate', dose: 100 });
      const travail = await client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/operations`, {
        performedOn: '2026-09-28',
        type: 'LABOUR',
      });

      const r = await client.post<{ results: Array<{ status: string; httpStatus: number; message?: string }> }>(
        '/api/sync',
        {
          operations: [
            {
              clientId: 'corr-0001-apport',
              kind: 'fertilization.update',
              targetId: id,
              payload: {
                appliedOn: '2027-02-25',
                inputType: 'MINERAL',
                productLabel: 'Ammonitrate',
                dose: 130,
                doseUnit: 'kg/ha',
              },
            },
            { clientId: 'corr-0002-travail', kind: 'operation.delete', targetId: travail.body.item.id, payload: {} },
            { clientId: 'corr-0003-encore', kind: 'operation.delete', targetId: travail.body.item.id, payload: {} },
          ],
        },
      );
      expect(r.status).toBe(200);
      expect(r.body.results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied']);
      expect(r.body.results[2]?.message).toBe('Déjà supprimé.');
      expect(Number((await prisma.fertilizerApplication.findUniqueOrThrow({ where: { id } })).dose)).toBe(130);
      expect(await prisma.agriculturalOperation.count({ where: { id: travail.body.item.id } })).toBe(0);
    });

    it('refuse une opération de correction sans enregistrement désigné', async () => {
      const r = await client.post<{ results: Array<{ status: string; message?: string }> }>('/api/sync', {
        operations: [{ clientId: 'corr-0004-vide', kind: 'phyto.delete', payload: {} }],
      });
      expect(r.body.results[0]).toMatchObject({ status: 'rejected', message: 'Enregistrement non précisé pour cette opération.' });
    });
  });
});
