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
              // Les limites que le moteur ignorait : importées, stockées,
              // transportées jusqu'au contrôle, et jamais opposées à la saisie.
              maxApplications: '2',
              minIntervalDays: '14',
              preHarvestDelay: '35',
              zntArthropodM: '5.0',
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
            // Trois familles publiées par l'ANSES dans le même fichier, et que
            // la requête du contrôle écartait dès la base : elle ne demandait
            // que les conditions marquées « sol drainé ».
            {
              category: 'Délai de rentrée',
              label: 'Délai de rentrée : 48 heures.',
            },
            {
              category: 'Mentions abeilles',
              label:
                'Emploi autorisé durant la floraison et au cours des périodes de production d’exsudats, en dehors de la présence d’abeilles.',
            },
            {
              category: 'Riverains',
              label:
                'Distance de sécurité de 5 m vis-à-vis des zones d’habitation et des lieux fréquentés.',
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

  // -------------------------------------------------------------------------
  // Les limites d'usage : applications, intervalle, délai avant récolte, ZNT
  //
  // Quatre informations réglementaires que l'import E-Phy enregistrait et que
  // le contrôle transportait sans jamais les opposer à la saisie. Le produit
  // d'essai autorise 2 applications, 14 jours d'intervalle et un délai avant
  // récolte de 35 jours.
  // -------------------------------------------------------------------------

  /** La culture d'essai, créée une fois puis retrouvée. */
  async function cultureDEssai() {
    // `upsert` ne sait pas viser une clé dont une part est `NULL` : la
    // contrainte (farmId, code) porte ici un `farmId` nul — une culture du
    // référentiel commun. On cherche puis on crée.
    const existante = await prisma.crop.findFirst({
      where: { code: 'BLE_ESSAI' },
      select: { id: true },
    });
    if (existante) return existante;
    return prisma.crop.create({
      data: { code: 'BLE_ESSAI', name: 'Blé', category: 'Céréales' },
      select: { id: true },
    });
  }

  /** Rattache un traitement à une culture, pour que la campagne soit connue. */
  async function creerCulture(
    parcelId: string,
    options: { recolteReelle?: string; recoltePrevue?: string } = {},
  ): Promise<string> {
    // `resetDatabase` vide aussi le référentiel des cultures : on crée la
    // sienne plutôt que de compter sur le seed, qui n'a pas lieu ici.
    const crop = await cultureDEssai();
    const cropYear = await prisma.cropYear.create({
      data: {
        parcelId,
        cropId: crop.id,
        campaignYear: 2026,
        ...(options.recolteReelle
          ? { actualHarvestDate: new Date(options.recolteReelle) }
          : {}),
        ...(options.recoltePrevue
          ? { expectedHarvestDate: new Date(options.recoltePrevue) }
          : {}),
      },
      select: { id: true },
    });
    return cropYear.id;
  }

  it('avertit au passage de trop, en disant lequel et combien sont autorisés', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId);

    // Deux passages autorisés, espacés de plus de 14 jours : aucun reproche.
    const premier = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-03-01',
    });
    expect(premier.warnings.some((w) => w.includes('Nombre maximal'))).toBe(false);

    const second = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-01',
    });
    expect(second.warnings.some((w) => w.includes('Nombre maximal'))).toBe(false);

    // Le troisième dépasse.
    const troisieme = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-05-01',
    });
    const alerte = troisieme.warnings.find((w) => w.includes('Nombre maximal'));
    expect(alerte).toBeDefined();
    // La phrase doit porter la valeur constatée, la valeur autorisée et la base
    // du décompte : un avertissement qu'on ne peut pas vérifier soi-même ne
    // sert qu'à inquiéter.
    expect(alerte).toContain('3ᵉ');
    expect(alerte).toContain('2');
    expect(alerte).toContain('2026');
    // Et il est tout de même enregistré : le registre dit ce qui a eu lieu.
    expect(troisieme.status).toBe(201);
  });

  it('avertit d’un intervalle trop court, et dit à partir de quand traiter', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId);

    await enregistrer(parcelNonRenseigneeId, { cropYearId, appliedOn: '2026-04-01' });
    const trop = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-08', // 7 jours, le catalogue en impose 14
    });

    const alerte = trop.warnings.find((w) => w.includes('Intervalle'));
    expect(alerte).toBeDefined();
    expect(alerte).toContain('7 jours');
    expect(alerte).toContain('14 jours');
    expect(alerte).toContain('15/04/2026'); // 1er avril + 14 jours
  });

  it('ne reproche rien quand l’intervalle est respecté', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId);
    await enregistrer(parcelNonRenseigneeId, { cropYearId, appliedOn: '2026-04-01' });
    const apres = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-16', // 15 jours
    });
    expect(apres.warnings.some((w) => w.includes('Intervalle'))).toBe(false);
  });

  it('avertit quand la récolte prévue tombe avant la fin du délai', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId, {
      recoltePrevue: '2026-05-01T00:00:00Z',
    });
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-15', // 16 jours avant récolte, le catalogue en exige 35
    });

    const alerte = warnings.find((w) => w.includes('Délai avant récolte'));
    expect(alerte).toBeDefined();
    expect(alerte).toContain('35 jours');
    expect(alerte).toContain('est prévue');
    expect(alerte).toContain('20/05/2026'); // 15 avril + 35 jours
  });

  it('distingue la récolte déjà faite de la récolte prévue', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId, {
      recolteReelle: '2026-05-01T00:00:00Z',
    });
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-15',
    });
    expect(warnings.find((w) => w.includes('Délai avant récolte'))).toContain('a eu lieu');
  });

  it('ne dit rien du délai avant récolte quand aucune récolte n’est connue', async () => {
    const cropYearId = await creerCulture(parcelNonRenseigneeId);
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      appliedOn: '2026-04-15',
    });
    expect(warnings.some((w) => w.includes('Délai avant récolte'))).toBe(false);
  });

  it('rappelle les ZNT du catalogue, sans prétendre les mesurer', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, { cropLabel: 'Blé' });
    const znt = warnings.find((w) => w.includes('Zones non traitées'));
    expect(znt).toBeDefined();
    expect(znt).toContain('20.0 m');
    expect(znt).toContain('5.0 m');
    expect(znt).toContain('ne mesure pas');
  });

  it('remonte le délai de rentrée, les pollinisateurs et les riverains', async () => {
    const { warnings } = await enregistrer(parcelNonRenseigneeId, { cropLabel: 'Blé' });

    const rentree = warnings.find((w) => w.startsWith('Délai de rentrée'));
    const abeilles = warnings.find((w) => w.startsWith('Pollinisateurs'));
    const riverains = warnings.find((w) => w.startsWith('Riverains'));

    expect(rentree).toContain('48 heures');
    expect(abeilles).toContain('abeilles');
    expect(riverains).toContain('5 m');
  });

  it('n’oppose aucune limite quand le catalogue ne les chiffre pas', async () => {
    // Un produit dont l'usage ne porte ni nombre d'applications, ni intervalle,
    // ni délai : le silence du catalogue n'est ni une autorisation ni une
    // infraction, et Parcelys n'a rien à en dire.
    const muet = await prisma.phytosanitaryProduct.create({
      data: {
        amm: '9990003',
        name: 'PRODUIT SANS LIMITE PUBLIÉE',
        normalizedName: 'produit sans limite publiee',
        status: 'AUTORISE',
        usages: {
          create: [
            {
              usageLabel: 'Blé*Trt Part.Aer.*Adventices',
              cropLabel: 'Blé',
              cropNormalized: 'ble',
              doseValue: '2.0',
              doseUnit: 'L/ha',
              status: 'Autorisé',
            },
          ],
        },
      },
      select: { id: true },
    });

    const cropYearId = await creerCulture(parcelNonRenseigneeId, {
      recoltePrevue: '2026-04-20T00:00:00Z',
    });
    await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      productId: muet.id,
      productName: 'PRODUIT SANS LIMITE PUBLIÉE',
      appliedOn: '2026-04-01',
    });
    const { warnings } = await enregistrer(parcelNonRenseigneeId, {
      cropYearId,
      productId: muet.id,
      productName: 'PRODUIT SANS LIMITE PUBLIÉE',
      appliedOn: '2026-04-02',
    });

    for (const interdit of ['Nombre maximal', 'Intervalle', 'Délai avant récolte']) {
      expect({ interdit, present: warnings.some((w) => w.includes(interdit)) }).toEqual({
        interdit,
        present: false,
      });
    }
  });

  it('compte les passages par campagne, pas depuis toujours', async () => {
    const crop = await cultureDEssai();
    const campagne2025 = await prisma.cropYear.create({
      data: { parcelId: parcelNonRenseigneeId, cropId: crop.id, campaignYear: 2025 },
      select: { id: true },
    });
    const campagne2026 = await creerCulture(parcelNonRenseigneeId);

    // Deux passages en 2025 : la limite y est atteinte.
    await enregistrer(parcelNonRenseigneeId, {
      cropYearId: campagne2025.id,
      appliedOn: '2025-03-01',
    });
    await enregistrer(parcelNonRenseigneeId, {
      cropYearId: campagne2025.id,
      appliedOn: '2025-04-01',
    });

    // Le premier passage de 2026 repart de zéro.
    const nouvelle = await enregistrer(parcelNonRenseigneeId, {
      cropYearId: campagne2026,
      appliedOn: '2026-03-01',
    });
    expect(nouvelle.warnings.some((w) => w.includes('Nombre maximal'))).toBe(false);
  });
});
