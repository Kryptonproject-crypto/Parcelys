import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { normalizeSearchTerm } from '../src/lib/ephy/schema';

/**
 * Un achat de produits, puis un traitement pris dans le stock.
 *
 * Le parcours que l'exploitant fait réellement : il reçoit ses bidons,
 * enregistre l'achat (produit, quantité, lot), puis, au moment de pulvériser,
 * choisit le produit dans son stock — et le lot se vide d'autant.
 */
describe('Achats et stock phytosanitaire', () => {
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
    const user = await createUserWithFarm({ email: 'achats@stock.test', farmName: 'Exploitation d’essai' });
    farmId = user.farmId;
    client = new TestClient();
    await client.login(user.email, user.password);
    const parcelle = await client.post<{ id: string }>('/api/parcels', {
      name: 'La Pièce',
      status: 'ACTIVE',
      geometry: testPolygon(1.9, 48.1, 0.01, 0.006),
    });
    parcelId = parcelle.body.id;
  });

  async function produit(nom: string, amm: string) {
    return prisma.phytosanitaryProduct.create({
      data: { amm, name: nom, normalizedName: normalizeSearchTerm(nom), status: 'Autorisé' },
      select: { id: true },
    });
  }

  const achat = (corps: Record<string, unknown>) =>
    client.post<{ itemId: string; lotId: string; cree: boolean; message?: string; error?: { message: string } }>(
      '/api/stocks/achats',
      { category: 'PHYTOSANITAIRE', unit: 'L', purchasedOn: '2026-10-14', ...corps },
    );

  it('enregistre l’achat : article, lot et entrée en stock, en une fois', async () => {
    const p = await produit('HERBICIDE D’ESSAI', '9900001');
    const r = await achat({ phytoProductId: p.id, quantity: 20, lotNumber: 'L-2026-01', supplier: 'Coopérative', expiresOn: '2028-10-01', unitPrice: 12.5 });
    expect(r.status).toBe(201);
    expect(r.body.cree).toBe(true);

    const article = await prisma.stockItem.findUniqueOrThrow({ where: { id: r.body.itemId } });
    // L'unité est gardée sous sa forme canonique (« l »), comme partout dans le stock.
    expect(article).toMatchObject({ farmId, name: 'HERBICIDE D’ESSAI', unit: 'l', phytoProductId: p.id });
    const lot = await prisma.stockLot.findUniqueOrThrow({ where: { id: r.body.lotId } });
    expect(lot).toMatchObject({ lotNumber: 'L-2026-01', supplier: 'Coopérative' });
    const mouvement = await prisma.stockMovement.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(mouvement.kind).toBe('ENTREE');
    expect(Number(mouvement.quantity)).toBe(20);

    // Un second achat du même produit va au même article, dans un autre lot.
    const r2 = await achat({ phytoProductId: p.id, quantity: 10, lotNumber: 'L-2026-02' });
    expect(r2.body.cree).toBe(false);
    expect(r2.body.itemId).toBe(r.body.itemId);
  });

  it('refuse un phytosanitaire hors catalogue, une unité inconvertible, et ne laisse rien à moitié', async () => {
    const p = await produit('FONGICIDE D’ESSAI', '9900002');
    expect((await achat({ name: 'Produit sans AMM', quantity: 5 })).status).toBe(400);

    await achat({ phytoProductId: p.id, quantity: 5 });
    // Des kilos d'un produit suivi en litres : sans densité, refusé.
    const r = await achat({ phytoProductId: p.id, quantity: 5, unit: 'kg', lotNumber: 'K-1' });
    expect(r.status).toBe(400);
    expect(await prisma.stockLot.count({ where: { lotNumber: 'K-1' } })).toBe(0);
    expect(await prisma.stockItem.count({ where: { farmId } })).toBe(1);
  });

  it('propose les produits en stock à la saisie, et le traitement vide le lot', async () => {
    const p = await produit('INSECTICIDE D’ESSAI', '9900003');
    const r = await achat({ phytoProductId: p.id, quantity: 20, lotNumber: 'I-1' });

    const enStock = await client.get<{ produits: Array<{ produit: { id: string; amm: string }; reste: number; lots: Array<{ id: string; reste: number }> }> }>('/api/stocks/phyto');
    expect(enStock.body.produits).toHaveLength(1);
    expect(enStock.body.produits[0]?.produit.amm).toBe('9900003');
    expect(enStock.body.produits[0]?.reste).toBe(20);

    // Une dose qui tient dans le lot : 0,2 L/ha sur une cinquantaine d'hectares.
    const surface = Number((await prisma.parcel.findUniqueOrThrow({ where: { id: parcelId } })).areaHa);
    const dose = 0.2;
    expect(dose * surface).toBeLessThan(20);
    const t = await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
      appliedOn: '2026-10-15',
      productId: p.id,
      productName: 'INSECTICIDE D’ESSAI',
      amm: '9900003',
      dose,
      doseUnit: 'L/ha',
      treatedAreaHa: surface,
      stockLotId: r.body.lotId,
    });
    expect(t.status).toBe(201);

    const apres = await client.get<{ produits: Array<{ reste: number }> }>('/api/stocks/phyto');
    const utilise = Number((dose * surface).toFixed(3));
    expect(apres.body.produits[0]?.reste).toBeCloseTo(20 - utilise, 3);

    // Un lot vidé n'est plus proposé.
    await prisma.stockMovement.create({
      data: { itemId: r.body.itemId, lotId: r.body.lotId, kind: 'SORTIE', occurredOn: new Date(), quantity: -(20 - utilise), unit: 'l' },
    });
    expect((await client.get<{ produits: unknown[] }>('/api/stocks/phyto')).body.produits).toHaveLength(0);
  });

  it('ne montre le stock que de son exploitation', async () => {
    const p = await produit('PRODUIT D’ESSAI', '9900004');
    await achat({ phytoProductId: p.id, quantity: 3 });
    // Par la parcelle : le stock de l'exploitation de la parcelle.
    const parParcelle = await client.get<{ produits: unknown[] }>(`/api/stocks/phyto?parcelId=${parcelId}`);
    expect(parParcelle.body.produits).toHaveLength(1);

    const autre = await createUserWithFarm({ email: 'voisin@stock.test', farmName: 'Voisin' });
    const voisin = new TestClient();
    await voisin.login(autre.email, autre.password);
    expect((await voisin.get<{ produits: unknown[] }>('/api/stocks/phyto')).body.produits).toHaveLength(0);
    // Ni en désignant la parcelle d'un autre.
    expect((await voisin.get(`/api/stocks/phyto?parcelId=${parcelId}`)).status).toBe(404);
  });
});
