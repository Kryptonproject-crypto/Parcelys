import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { normalizeSearchTerm } from '../src/lib/ephy/schema';

/**
 * Importer en stock les produits déjà employés.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI EST ÉPROUVÉ ICI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le suivi de stock partait d'une page blanche alors que les produits étaient
 * déjà nommés dans les traitements et les apports. Ces cas vérifient que le
 * pont fonctionne — et surtout qu'il **ne devine rien** :
 *
 *   - l'unité proposée est celle des saisies (`quantityUnit`, `totalUnit`),
 *     jamais la dose par hectare ;
 *   - quand les saisies emploient plusieurs unités, aucune n'est retenue
 *     d'office : `unite` vaut `null` et l'exploitant tranche ;
 *   - un produit déjà suivi n'est pas reproposé, et l'importer deux fois ne
 *     crée pas de doublon ;
 *   - un article saisi à la main avant l'import est **rattaché**, pas dupliqué ;
 *   - rien ne franchit la frontière entre deux exploitations.
 */
describe('Import des produits en stock', () => {
  let client: TestClient;
  let farmId = '';
  let parcelId = '';

  beforeAll(async () => {
    await startServer();
  }, 180_000);

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'exploitant@stock-import.test',
      farmName: 'Exploitation de stock',
    });
    farmId = user.farmId;
    client = new TestClient();
    await client.login(user.email, user.password);

    const parcelle = await client.post<{ id: string }>('/api/parcels', {
      name: 'Le Clos',
      status: 'ACTIVE',
      geometry: testPolygon(1.9, 48.1, 0.01, 0.006),
    });
    parcelId = parcelle.body.id;
  });

  /** Un produit au catalogue E-Phy, et un traitement qui l'emploie. */
  async function traitementAvecProduit(params: {
    nom: string;
    amm: string;
    unite: string;
    quantite?: number;
    le?: string;
  }): Promise<string> {
    const produit = await prisma.phytosanitaryProduct.upsert({
      where: { amm: params.amm },
      update: {},
      // `normalizedName` est calculé par la même fonction que l'import E-Phy :
      // en écrire une seconde ici ferait diverger l'essai du produit réel.
      create: {
        amm: params.amm,
        name: params.nom,
        normalizedName: normalizeSearchTerm(params.nom),
        // L'autorisation se lit dans `status` : il n'existe pas de booléen.
        status: 'Autorisé',
      },
      select: { id: true },
    });

    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId,
        appliedOn: new Date(params.le ?? '2026-04-15T10:00:00Z'),
        productId: produit.id,
        productName: params.nom,
        amm: params.amm,
        dose: 1,
        doseUnit: 'L/ha',
        treatedAreaHa: 4,
        quantityUsed: params.quantite ?? 4,
        quantityUnit: params.unite,
      },
    });

    return produit.id;
  }

  /** Un engrais du référentiel, et un apport qui l'emploie. */
  async function apportAvecEngrais(params: {
    nom: string;
    uniteTotale: string;
  }): Promise<string> {
    const engrais = await prisma.fertilizer.create({
      data: { name: params.nom, nPercent: 33.5 },
      select: { id: true },
    });

    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        appliedOn: new Date('2026-03-01T10:00:00Z'),
        inputType: 'MINERAL',
        fertilizerId: engrais.id,
        productLabel: params.nom,
        dose: 120,
        // La dose est par hectare ; la quantité totale ne l'est pas.
        doseUnit: 'kg/ha',
        treatedAreaHa: 4,
        totalQuantity: 480,
        totalUnit: params.uniteTotale,
      },
    });

    return engrais.id;
  }

  // -------------------------------------------------------------------------

  it('propose un produit employé et qu’aucun article ne suit', async () => {
    await traitementAvecProduit({ nom: 'Produit d’essai', amm: '9900001', unite: 'L' });

    const r = await client.get<{ produits: Array<Record<string, unknown>> }>(
      '/api/stocks/importables',
    );

    expect(r.status).toBe(200);
    expect(r.body.produits).toHaveLength(1);
    expect(r.body.produits[0]).toMatchObject({
      source: 'phyto',
      label: 'Produit d’essai',
      amm: '9900001',
      categorie: 'PHYTOSANITAIRE',
      unite: 'L',
      nombreUtilisations: 1,
    });
  });

  it('propose l’unité des saisies, jamais la dose par hectare', async () => {
    await apportAvecEngrais({ nom: 'Ammonitrate d’essai', uniteTotale: 'kg' });

    const r = await client.get<{ produits: Array<{ unite: string | null; categorie: string }> }>(
      '/api/stocks/importables',
    );

    // `doseUnit` valait « kg/ha » : un stock tenu dans cette unité n'aurait
    // aucun sens. C'est `totalUnit` qui compte.
    expect(r.body.produits[0]?.unite).toBe('kg');
    expect(r.body.produits[0]?.unite).not.toContain('/ha');
    expect(r.body.produits[0]?.categorie).toBe('ENGRAIS');
  });

  it('range un produit organique en amendement, pas en engrais', async () => {
    const organique = await prisma.organicInput.create({
      data: { name: 'Fumier d’essai', category: 'Fumier', defaultUnit: 't/ha', nContent: 5 },
      select: { id: true },
    });
    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        appliedOn: new Date('2026-02-01T10:00:00Z'),
        inputType: 'ORGANIC',
        organicInputId: organique.id,
        productLabel: 'Fumier d’essai',
        dose: 20,
        doseUnit: 't/ha',
        treatedAreaHa: 4,
        totalQuantity: 80,
        totalUnit: 't',
      },
    });

    const r = await client.get<{ produits: Array<{ categorie: string; source: string }> }>(
      '/api/stocks/importables',
    );

    expect(r.body.produits[0]).toMatchObject({ source: 'organique', categorie: 'AMENDEMENT' });
  });

  it('ne tranche pas quand les saisies emploient plusieurs unités', async () => {
    // Le même produit, noté une fois en litres et deux fois en kilos.
    await traitementAvecProduit({ nom: 'Produit ambigu', amm: '9900002', unite: 'L' });
    await traitementAvecProduit({
      nom: 'Produit ambigu',
      amm: '9900002',
      unite: 'kg',
      le: '2026-04-16T10:00:00Z',
    });
    await traitementAvecProduit({
      nom: 'Produit ambigu',
      amm: '9900002',
      unite: 'kg',
      le: '2026-04-17T10:00:00Z',
    });

    const r = await client.get<{
      produits: Array<{
        unite: string | null;
        unitesRencontrees: Array<{ unite: string; occurrences: number }>;
        nombreUtilisations: number;
      }>;
    }>('/api/stocks/importables');

    const p = r.body.produits[0];
    expect(p?.nombreUtilisations).toBe(3);
    // Deux kilos contre un litre : la plus fréquente serait « kg ». Parcelys ne
    // la retient pas pour autant — convertir une masse en volume suppose une
    // densité qu'il ne connaît pas.
    expect(p?.unite).toBeNull();
    expect(p?.unitesRencontrees).toEqual([
      { unite: 'kg', occurrences: 2 },
      { unite: 'L', occurrences: 1 },
    ]);
  });

  it('regroupe « L » et « l » plutôt que d’y voir un désaccord', async () => {
    await traitementAvecProduit({ nom: 'Produit casse', amm: '9900003', unite: 'L' });
    await traitementAvecProduit({
      nom: 'Produit casse',
      amm: '9900003',
      unite: 'l',
      le: '2026-04-16T10:00:00Z',
    });

    const r = await client.get<{ produits: Array<{ unite: string | null }> }>(
      '/api/stocks/importables',
    );

    expect(r.body.produits[0]?.unite).not.toBeNull();
  });

  it('crée l’article, rattaché au référentiel', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit à suivre',
      amm: '9900004',
      unite: 'L',
    });

    const r = await client.post<{ crees: number; resultats: Array<{ etat: string }> }>(
      '/api/stocks/importables',
      { selections: [{ source: 'phyto', refId: produitId, unit: 'L' }] },
    );

    expect(r.status).toBe(201);
    expect(r.body.crees).toBe(1);
    expect(r.body.resultats[0]?.etat).toBe('cree');

    const article = await prisma.stockItem.findFirst({
      where: { farmId, phytoProductId: produitId },
      select: { name: true, unit: true, category: true },
    });
    expect(article).toMatchObject({
      name: 'Produit à suivre',
      unit: 'L',
      category: 'PHYTOSANITAIRE',
    });
  });

  it('ne repropose plus un produit une fois importé', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit importé',
      amm: '9900005',
      unite: 'L',
    });
    await client.post('/api/stocks/importables', {
      selections: [{ source: 'phyto', refId: produitId, unit: 'L' }],
    });

    const r = await client.get<{ produits: unknown[] }>('/api/stocks/importables');
    expect(r.body.produits).toHaveLength(0);
  });

  it('refuse le doublon quand le même produit est importé deux fois', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit deux fois',
      amm: '9900006',
      unite: 'L',
    });
    const selections = [{ source: 'phyto', refId: produitId, unit: 'L' }];

    await client.post('/api/stocks/importables', { selections });
    const second = await client.post<{ crees: number; resultats: Array<{ etat: string }> }>(
      '/api/stocks/importables',
      { selections },
    );

    expect(second.body.crees).toBe(0);
    expect(second.body.resultats[0]?.etat).toBe('deja-suivi');

    const combien = await prisma.stockItem.count({ where: { farmId, phytoProductId: produitId } });
    expect(combien).toBe(1);
  });

  it('ne traite qu’une fois un produit demandé deux fois dans le même envoi', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit répété',
      amm: '9900007',
      unite: 'L',
    });

    const r = await client.post<{ resultats: unknown[] }>('/api/stocks/importables', {
      selections: [
        { source: 'phyto', refId: produitId, unit: 'L' },
        { source: 'phyto', refId: produitId, unit: 'kg' },
      ],
    });

    expect(r.body.resultats).toHaveLength(1);
    expect(await prisma.stockItem.count({ where: { farmId } })).toBe(1);
  });

  it('rattache un article saisi à la main au lieu d’en créer un second', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit déjà saisi',
      amm: '9900008',
      unite: 'L',
    });

    // L'article existait avant l'import, sans rattachement : c'est le cas que
    // l'import doit réparer, pas dupliquer.
    const aLaMain = await prisma.stockItem.create({
      data: {
        farmId,
        category: 'PHYTOSANITAIRE',
        name: 'Produit déjà saisi',
        unit: 'L',
      },
      select: { id: true },
    });

    const r = await client.post<{ crees: number; resultats: Array<{ motif?: string }> }>(
      '/api/stocks/importables',
      { selections: [{ source: 'phyto', refId: produitId, unit: 'L' }] },
    );

    expect(r.body.crees).toBe(1);
    expect(r.body.resultats[0]?.motif).toContain('rattaché');

    expect(await prisma.stockItem.count({ where: { farmId } })).toBe(1);
    const apres = await prisma.stockItem.findUnique({
      where: { id: aLaMain.id },
      select: { phytoProductId: true },
    });
    expect(apres?.phytoProductId).toBe(produitId);
  });

  it('refuse une unité que Parcelys ne connaît pas', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit unité folle',
      amm: '9900009',
      unite: 'L',
    });

    const r = await client.post<{ error: { message: string } }>('/api/stocks/importables', {
      selections: [{ source: 'phyto', refId: produitId, unit: 'brouettes' }],
    });

    // Rien n'a pu être fait : le statut le dit, pas seulement le corps. Un 200
    // tromperait tout appelant qui ne lit que le code de retour.
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('inconnue');
    expect(await prisma.stockItem.count({ where: { farmId } })).toBe(0);
  });

  it('crée le suivi, pas le stock : le solde reste à zéro', async () => {
    const produitId = await traitementAvecProduit({
      nom: 'Produit sans entrée',
      amm: '9900010',
      unite: 'L',
    });
    await client.post('/api/stocks/importables', {
      selections: [{ source: 'phyto', refId: produitId, unit: 'L' }],
    });

    const r = await client.get<{
      articles: Array<{ name: string; solde: { quantite: number } }>;
    }>('/api/stocks');

    expect(r.body.articles).toHaveLength(1);
    expect(r.body.articles[0]?.solde.quantite).toBe(0);
  });

  it('ne laisse pas importer l’engrais personnalisé d’une autre exploitation', async () => {
    const voisin = await createUserWithFarm({
      email: 'voisin@stock-import.test',
      farmName: 'Exploitation voisine',
    });
    const sien = await prisma.fertilizer.create({
      data: { name: 'Mélange maison du voisin', farmId: voisin.farmId, nPercent: 20 },
      select: { id: true },
    });

    const r = await client.post<{ error: { message: string } }>('/api/stocks/importables', {
      selections: [{ source: 'engrais', refId: sien.id, unit: 'kg' }],
    });

    expect(r.status).toBe(400);
    // Le motif est le même que pour un identifiant qui n'existe nulle part :
    // distinguer les deux dirait au demandeur que celui-ci existe ailleurs.
    expect(r.body.error.message).toContain('introuvable');
    expect(await prisma.stockItem.count({ where: { farmId } })).toBe(0);
  });

  it('ne propose pas les produits employés par une autre exploitation', async () => {
    // Le voisin traite chez lui ; cela ne doit rien faire apparaître ici.
    const voisin = await createUserWithFarm({
      email: 'voisin2@stock-import.test',
      farmName: 'Autre exploitation',
    });
    const clientVoisin = new TestClient();
    await clientVoisin.login(voisin.email, voisin.password);
    const sienne = await clientVoisin.post<{ id: string }>('/api/parcels', {
      name: 'Chez le voisin',
      status: 'ACTIVE',
      geometry: testPolygon(2.5, 47.5, 0.01, 0.006),
    });

    const produit = await prisma.phytosanitaryProduct.create({
      data: {
        amm: '9900011',
        name: 'Produit du voisin',
        normalizedName: normalizeSearchTerm('Produit du voisin'),
        status: 'Autorisé',
      },
      select: { id: true },
    });
    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId: sienne.body.id,
        appliedOn: new Date('2026-04-15T10:00:00Z'),
        productId: produit.id,
        productName: 'Produit du voisin',
        dose: 1,
        doseUnit: 'L/ha',
        treatedAreaHa: 4,
        quantityUsed: 4,
        quantityUnit: 'L',
      },
    });

    const r = await client.get<{ produits: unknown[] }>('/api/stocks/importables');
    expect(r.body.produits).toHaveLength(0);
  });

  it('ignore les traitements saisis en texte libre, faute de quoi les rapprocher', async () => {
    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId,
        appliedOn: new Date('2026-04-15T10:00:00Z'),
        // Pas de `productId` : produit non trouvé au catalogue, saisi à la main.
        productName: 'Bidon sans étiquette',
        dose: 1,
        doseUnit: 'L/ha',
        treatedAreaHa: 4,
        quantityUsed: 4,
        quantityUnit: 'L',
      },
    });

    const r = await client.get<{ produits: unknown[] }>('/api/stocks/importables');
    expect(r.body.produits).toHaveLength(0);
  });

  it('refuse un inconnu et un lecteur seul', async () => {
    const anonyme = new TestClient();
    const sansSession = await anonyme.get('/api/stocks/importables');
    expect(sansSession.status).toBe(401);
  });
});
