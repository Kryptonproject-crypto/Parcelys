import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { getBaseUrl, startServer, stopServer, TestClient } from './helpers/server';

/**
 * Contrôles réglementaires à l'enregistrement d'un traitement.
 *
 * Ces tests passent par la vraie chaîne HTTP, **et par `/api/sync`** : la file
 * d'attente de l'application mobile rejoue les saisies faites au champ, et un
 * contrôle qui n'existerait que dans le formulaire du navigateur laisserait
 * passer tout ce qui a été saisi hors ligne — c'est-à-dire l'essentiel.
 *
 * Les contrôles avertissent, ils ne bloquent pas : un traitement réellement
 * effectué doit pouvoir être enregistré, quitte à être annoté. Un registre
 * incomplet est plus faux qu'un registre annoté.
 */
describe('Contrôles phytosanitaires (dose, retrait, sol drainé)', () => {
  // Construit dans `beforeEach` : `TestClient` fige l'adresse du serveur de
  // test à sa création, et le serveur n'existe pas encore à l'évaluation du
  // module.
  let client: TestClient;
  let farmId = '';
  let parcelDraineeId = '';
  let parcelNonRenseigneeId = '';
  let produitId = '';
  let produitRetireId = '';

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
      email: 'exploitant@controle.test',
      farmName: 'Exploitation de contrôle',
    });
    farmId = user.farmId;
    client = new TestClient();
    await client.login(user.email, user.password);

    parcelDraineeId = await creerParcelle('Parcelle drainée', true);
    parcelNonRenseigneeId = await creerParcelle('Parcelle non renseignée', null);

    // --- Catalogue : un produit autorisé, un produit retiré ----------------
    const produit = await prisma.phytosanitaryProduct.create({
      data: {
        amm: '9990001',
        name: 'PRODUIT DE CONTRÔLE',
        normalizedName: 'produit de controle',
        status: 'AUTORISE',
        usages: {
          create: [
            {
              usageLabel: 'Blé*Trt Part.Aer.*Adventices',
              cropLabel: 'Blé',
              cropNormalized: 'ble',
              targetLabel: 'Adventices',
              doseValue: '2.0',
              doseUnit: 'L/ha',
              status: 'Autorisé',
              zntAquaticM: '20.0',
            },
            {
              // Usage retiré : il ne doit jamais servir de référence de dose.
              usageLabel: 'Orge*Trt Part.Aer.*Adventices',
              cropLabel: 'Orge',
              cropNormalized: 'orge',
              targetLabel: 'Adventices',
              doseValue: '9.0',
              doseUnit: 'L/ha',
              status: 'Retrait',
            },
          ],
        },
        conditions: {
          create: [
            {
              category: 'Environnement faune',
              label:
                'Condition: - SPe 2 : Pour protéger les organismes aquatiques, ne pas appliquer sur sol artificiellement drainé.',
              concernsDrainedSoil: true,
            },
          ],
        },
      },
    });
    produitId = produit.id;

    const retire = await prisma.phytosanitaryProduct.create({
      data: {
        amm: '9990002',
        name: 'PRODUIT RETIRÉ',
        normalizedName: 'produit retire',
        status: 'RETIRE',
        withdrawnAt: new Date('2024-03-15T00:00:00Z'),
      },
    });
    produitRetireId = retire.id;
  });

  async function creerParcelle(name: string, drainedSoil: boolean | null) {
    const response = await client.post<{ id: string }>('/api/parcels', {
      name,
      status: 'ACTIVE',
      drainedSoil,
      geometry: testPolygon(),
    });
    expect(response.status).toBe(201);
    return response.body.id;
  }

  /** Enregistre un traitement et rend les avertissements produits. */
  async function enregistrer(
    parcelId: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; warnings: string[] }> {
    const response = await client.post<{ warnings?: string[] }>(
      `/api/parcels/${parcelId}/phytosanitary`,
      {
        appliedOn: '2026-04-15',
        productId: produitId,
        productName: 'PRODUIT DE CONTRÔLE',
        dose: 2,
        doseUnit: 'L/ha',
        treatedAreaHa: 1,
        ...payload,
      },
    );
    return { status: response.status, warnings: response.body.warnings ?? [] };
  }

  // -------------------------------------------------------------------------
  // Surdosage
  // -------------------------------------------------------------------------

  it('avertit d’un surdosage sans refuser l’enregistrement', async () => {
    const { status, warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropLabel: 'Blé',
      dose: 5,
    });

    expect(status).toBe(201);
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(true);
    expect(warnings.some((w) => w.includes('2 L/ha'))).toBe(true);
    // Le traitement est bel et bien enregistré : le registre dit ce qui a eu lieu.
    expect(await prisma.phytosanitaryApplication.count()).toBe(1);
  });

  it('n’avertit pas quand la dose respecte celle du catalogue', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropLabel: 'Blé',
      dose: 2,
    });
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(false);
  });

  it('n’utilise pas un usage retiré comme dose de référence', async () => {
    // L'usage « Orge » est en retrait avec une dose de 9 L/ha. S'il servait de
    // référence, 5 L/ha passerait pour conforme.
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropLabel: 'Orge',
      dose: 5,
    });
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(false);
    expect(warnings.some((w) => w.includes('n’est pas un usage autorisé'))).toBe(true);
  });

  it('refuse de comparer une masse à un volume', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropLabel: 'Blé',
      dose: 5,
      doseUnit: 'kg/ha',
    });
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(false);
    expect(warnings.some((w) => w.includes('densité'))).toBe(true);
  });

  it('ne se prononce pas sans culture renseignée', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, { dose: 5 });
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(false);
    expect(warnings.some((w) => w.includes('usage autorisé'))).toBe(false);
  });

  /**
   * La culture peut venir de l'assolement plutôt que d'une saisie : le contrôle
   * doit la retrouver là aussi, sans quoi il ne s'appliquerait qu'aux saisies
   * les plus complètes.
   */
  it('retrouve la culture depuis la campagne rattachée', async () => {
    const crop = await prisma.crop.create({
      data: { code: 'BLE', name: 'Blé', category: 'Céréales' },
    });
    const cropYear = await prisma.cropYear.create({
      data: { parcelId: parcelNonRenseigneeId, cropId: crop.id, campaignYear: 2026 },
    });

    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropYearId: cropYear.id,
      dose: 5,
    });
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Produit retiré
  // -------------------------------------------------------------------------

  it('avertit d’un traitement postérieur au retrait du produit', async () => {
    const response = await client.post<{ warnings?: string[] }>(
      `/api/parcels/${parcelNonRenseigneeId}/phytosanitary`,
      {
        appliedOn: '2026-04-15',
        productId: produitRetireId,
        productName: 'PRODUIT RETIRÉ',
        dose: 1,
        doseUnit: 'L/ha',
        treatedAreaHa: 1,
      },
    );

    expect(response.status).toBe(201);
    expect(
      (response.body.warnings ?? []).some((w) => w.includes('retiré du catalogue')),
    ).toBe(true);
  });

  it('n’avertit pas d’un traitement antérieur au retrait', async () => {
    const response = await client.post<{ warnings?: string[] }>(
      `/api/parcels/${parcelNonRenseigneeId}/phytosanitary`,
      {
        appliedOn: '2023-05-10',
        productId: produitRetireId,
        productName: 'PRODUIT RETIRÉ',
        dose: 1,
        doseUnit: 'L/ha',
        treatedAreaHa: 1,
      },
    );

    expect(
      (response.body.warnings ?? []).some((w) => w.includes('retiré du catalogue')),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sol drainé
  // -------------------------------------------------------------------------

  it('rappelle la condition d’emploi sur une parcelle drainée', async () => {
    const { warnings } = await enregistrer(parcelDraineeId, {
      cropLabel: 'Blé',
      dose: 2,
    });

    expect(warnings.some((w) => w.includes('sol drainé'))).toBe(true);
    // La condition est citée telle que l'ANSES la publie.
    expect(warnings.some((w) => w.includes('SPe 2'))).toBe(true);
  });

  it('ne dit rien du drainage sur une parcelle déclarée non drainée', async () => {
    const parcelId = await creerParcelle('Parcelle non drainée', false);
    const { warnings } = await enregistrer(parcelId, { cropLabel: 'Blé', dose: 2 });
    expect(warnings.some((w) => w.includes('sol drainé'))).toBe(false);
  });

  /**
   * `null` veut dire « non renseigné », pas « non drainé ». Le serveur ne
   * fabrique pas d'avertissement à partir d'une information qu'il n'a pas —
   * c'est l'interface qui invite à la renseigner, à la saisie.
   */
  it('n’invente pas de drainage quand la parcelle ne le précise pas', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropLabel: 'Blé',
      dose: 2,
    });
    expect(warnings.some((w) => w.includes('sol drainé'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // La file d'attente de l'application mobile
  // -------------------------------------------------------------------------

  it('applique les mêmes contrôles aux saisies rejouées depuis le téléphone', async () => {
    const response = await client.post<{
      applied: number;
      results: Array<{ status: string; warnings?: string[] }>;
    }>('/api/sync', {
      operations: [
        {
          clientId: randomUUID(),
          kind: 'phyto.create',
          farmId,
          parcelId: parcelDraineeId,
          capturedAt: new Date().toISOString(),
          payload: {
            appliedOn: '2026-04-15',
            productId: produitId,
            productName: 'PRODUIT DE CONTRÔLE',
            cropLabel: 'Blé',
            dose: 6,
            doseUnit: 'L/ha',
            treatedAreaHa: 1,
          },
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(1);

    const warnings = response.body.results[0]?.warnings ?? [];
    expect(warnings.some((w) => w.includes('Surdosage'))).toBe(true);
    expect(warnings.some((w) => w.includes('sol drainé'))).toBe(true);
  });
});
