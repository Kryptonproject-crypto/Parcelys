import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import { buildComplianceReport } from '../src/lib/regulatory/compliance';
import { saveParcelGeometry } from '../src/lib/geo/repository';
import { importZoneCollection } from '../src/lib/regulatory/import-zones';

/**
 * Synthèse de conformité.
 *
 * Ces tests gardent la promesse la plus importante du logiciel : **Parcelys
 * n'affirme jamais la conformité légale d'une exploitation**, et ne fait jamais
 * passer une vérification impossible pour une vérification réussie.
 *
 * C'est la garantie la plus facile à perdre — il suffit d'une reformulation
 * bien intentionnée dans un écran — et la plus coûteuse à perdre, puisque
 * c'est celle qui protège l'exploitant en cas de contrôle.
 */
describe('Synthèse de conformité', () => {
  let farmId = '';
  let parcelId = '';

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'conformite@parcelys.test',
      farmName: 'Exploitation contrôlée',
    });
    farmId = user.farmId;

    const parcelle = await prisma.parcel.create({
      data: { farmId, name: 'Le Grand Champ', areaHa: 10 },
      select: { id: true },
    });
    parcelId = parcelle.id;
    await saveParcelGeometry(prisma, parcelId, {
      type: 'Polygon',
      coordinates: [
        [
          [1.88, 48.08],
          [1.89, 48.08],
          [1.89, 48.086],
          [1.88, 48.086],
          [1.88, 48.08],
        ],
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('n’affirme jamais la conformité légale', async () => {
    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });

    // La formule interdite, sous toutes ses formes.
    expect(rapport.summary.toLowerCase()).not.toContain('vous êtes conforme');
    expect(rapport.summary.toLowerCase()).not.toContain('exploitation conforme');
    expect(rapport.summary.toLowerCase()).not.toContain('légalement conforme');
  });

  /**
   * Le cas qui distingue un logiciel honnête d'un logiciel rassurant : rien
   * n'est importé, donc rien n'a pu être vérifié. Dire « aucune anomalie »
   * serait techniquement exact et pratiquement mensonger.
   */
  it('dit qu’aucune vérification n’a été possible plutôt que « aucune anomalie »', async () => {
    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });

    expect(rapport.counts.INDETERMINE).toBeGreaterThan(0);
    expect(rapport.counts.ANOMALIE).toBe(0);
    expect(rapport.summary).toContain('Aucune vérification réglementaire');
    expect(rapport.summary).toContain('ne signifie donc rien');
  });

  it('nomme les référentiels manquants et ce qu’ils empêchent de faire', async () => {
    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });

    expect(rapport.missingReferentials.length).toBeGreaterThan(0);
    // Chaque manque dit sa conséquence : sans cela, l'administrateur ne sait
    // pas lequel importer en premier.
    expect(
      rapport.missingReferentials.every((r) => r.degradedWithout.length > 20),
    ).toBe(true);

    const ift = rapport.missingReferentials.find((r) => r.code === 'ift-doses-reference');
    expect(ift?.degradedWithout).toContain('n’est pas un IFT');
  });

  it('classe un référentiel absent en indéterminé, jamais en OK', async () => {
    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });

    const zonage = rapport.findings.filter((f) => f.code === 'zonage.referentiel-absent');
    expect(zonage.length).toBeGreaterThan(0);
    expect(zonage.every((f) => f.level === 'INDETERMINE')).toBe(true);
    // Et chaque indétermination dit comment la lever.
    expect(zonage.every((f) => (f.action ?? '').length > 0)).toBe(true);
  });

  it('signale une parcelle en zone vulnérable avec sa surface et sa source', async () => {
    await importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [1.87, 48.07],
                [1.885, 48.07],
                [1.885, 48.1],
                [1.87, 48.1],
                [1.87, 48.07],
              ],
            ],
          },
          properties: { nom: 'ZV Beauce' },
        },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '24',
        version: '2024-07',
        sourceLabel: 'DREAL Centre-Val de Loire',
      },
    );

    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    const zv = rapport.findings.find((f) => f.code === 'nitrates.zone-vulnerable');

    expect(zv).toBeDefined();
    expect(zv?.level).toBe('VERIFICATION');
    // Partiellement, avec la surface : pas « la parcelle est en zone vulnérable ».
    expect(zv?.detail).toContain('partiellement');
    expect(zv?.detail).toContain('ha sur');
    // La provenance accompagne la règle.
    expect(zv?.sourceLabel).toBe('DREAL Centre-Val de Loire');
    expect(zv?.referentialVersion).toBe('2024-07');
  });

  it('relève un dépassement du prévisionnel non justifié', async () => {
    const culture = await prisma.crop.create({
      data: { code: 'BLE', name: 'Blé tendre', category: 'Céréales' },
    });
    const campagne = await prisma.cropYear.create({
      data: { parcelId, cropId: culture.id, campaignYear: 2026 },
      select: { id: true },
    });
    const plan = await prisma.nitrogenPlan.create({
      data: { cropYearId: campagne.id, campaignYear: 2026 },
      select: { id: true },
    });
    await prisma.nitrogenPlanEntry.create({
      data: { planId: plan.id, label: 'Urée', inputType: 'MINERAL', efficientKgHa: 150 },
    });
    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        cropYearId: campagne.id,
        appliedOn: new Date('2026-03-15'),
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate',
        dose: 200,
        doseUnit: 'kg/ha',
        treatedAreaHa: 10,
        totalQuantity: 2000,
        totalUnit: 'kg',
        nSupplied: 1650,
      },
    });

    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    const depassement = rapport.findings.find(
      (f) => f.code === 'ppf.depassement-non-justifie',
    );

    expect(depassement).toBeDefined();
    expect(depassement?.level).toBe('ANOMALIE');
    expect(depassement?.detail).toContain('165');
    expect(depassement?.action).toContain('justification');
    // Une anomalie réelle change la phrase de synthèse.
    expect(rapport.summary).toContain('anomalie');
    expect(rapport.summary).toContain('référentiels actuellement disponibles');
  });

  it('signale l’absence de plan prévisionnel comme indéterminée, pas comme anomalie', async () => {
    const culture = await prisma.crop.create({
      data: { code: 'ORG', name: 'Orge', category: 'Céréales' },
    });
    await prisma.cropYear.create({
      data: { parcelId, cropId: culture.id, campaignYear: 2026 },
    });

    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    const sansPlan = rapport.findings.find((f) => f.code === 'ppf.absent');

    expect(sansPlan).toBeDefined();
    // Un plan manquant empêche la vérification ; il n'établit pas une faute.
    expect(sansPlan?.level).toBe('INDETERMINE');
  });

  it('relève les traitements sans AMM, qui rendent le registre incomplet', async () => {
    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId,
        appliedOn: new Date('2026-04-15'),
        productName: 'Produit saisi librement',
        dose: 2,
        doseUnit: 'L/ha',
        treatedAreaHa: 10,
        quantityUsed: 20,
        quantityUnit: 'L',
      },
    });

    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    const sansAmm = rapport.findings.find((f) => f.code === 'phyto.amm-manquante');

    expect(sansAmm).toBeDefined();
    expect(sansAmm?.level).toBe('VERIFICATION');
    expect(sansAmm?.detail).toContain('registre est incomplet');
  });
});
