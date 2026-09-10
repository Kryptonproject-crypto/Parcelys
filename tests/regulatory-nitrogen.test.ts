import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import {
  buildNitrogenBalance,
  comparePlanToActual,
  irrigationNitrogenKgHa,
} from '../src/lib/regulatory/nitrogen';
import {
  computeTreatmentIft,
  categoryOf,
  computeFarmIft,
} from '../src/lib/regulatory/ift';
import { importIftReferences } from '../src/lib/regulatory/import-zones';

/**
 * Bilan azoté et IFT.
 *
 * Ce que ces tests protègent : **l'absence de donnée ne devient jamais un
 * zéro**. Un bilan sans reliquat n'est pas un bilan avec un reliquat nul ; un
 * traitement sans dose de référence n'a pas un IFT nul. Dans les deux cas la
 * valeur juste est « on ne sait pas », et c'est celle que le code doit rendre.
 */
describe('Bilan azoté et IFT', () => {
  let farmId = '';
  let parcelId = '';
  let cropYearId = '';

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'azote@parcelys.test',
      farmName: 'Exploitation azotée',
    });
    farmId = user.farmId;

    const parcelle = await prisma.parcel.create({
      data: { farmId, name: 'Le Grand Champ', areaHa: 10 },
      select: { id: true },
    });
    parcelId = parcelle.id;

    const culture = await prisma.crop.create({
      data: { code: 'BLE', name: 'Blé tendre', category: 'Céréales' },
    });
    const campagne = await prisma.cropYear.create({
      data: { parcelId, cropId: culture.id, campaignYear: 2026 },
      select: { id: true },
    });
    cropYearId = campagne.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function creerPlan(donnees: Record<string, unknown> = {}) {
    return prisma.nitrogenPlan.create({
      data: { cropYearId, campaignYear: 2026, ...donnees },
      select: { id: true },
    });
  }

  // -------------------------------------------------------------------------
  // Bilan azoté
  // -------------------------------------------------------------------------

  it('refuse de calculer un bilan dont un terme manque, et dit lequel', async () => {
    const plan = await creerPlan();
    const bilan = await buildNitrogenBalance(plan.id);

    expect(bilan.computable).toBe(false);
    expect(bilan.requiredKgHa).toBeNull();
    // Chaque manque est nommé, avec ce qu'il faut faire.
    expect(bilan.blockers.length).toBeGreaterThan(0);
    expect(bilan.blockers.every((b) => b.remedy.length > 0)).toBe(true);
    expect(bilan.need.valueKgHa).toBeNull();
    expect(bilan.need.missingReason).toContain('référentiel');
  });

  it('calcule le bilan et rend son raisonnement quand tout est renseigné', async () => {
    const plan = await creerPlan({
      needKgHa: 210,
      residualKgHa: 45,
      previousCropKgHa: 20,
      soilSupplyKgHa: 35,
      otherSuppliesKgHa: 0,
      previousCrop: 'Colza',
    });

    const bilan = await buildNitrogenBalance(plan.id);

    expect(bilan.computable).toBe(true);
    expect(bilan.need.valueKgHa).toBe(210);
    expect(bilan.totalSuppliesKgHa).toBe(100);
    expect(bilan.requiredKgHa).toBe(110);
    expect(bilan.blockers).toHaveLength(0);

    // Le raisonnement est lisible ligne à ligne : c'est ce que l'écran
    // « voir le détail du calcul » affiche.
    const reliquat = bilan.supplies.find((l) => l.key === 'residual');
    expect(reliquat?.valueKgHa).toBe(45);
    expect(reliquat?.origin).toContain('Saisi');

    const precedent = bilan.supplies.find((l) => l.key === 'previous');
    expect(precedent?.label).toContain('Colza');
  });

  it('préfère le reliquat mesuré à la valeur saisie', async () => {
    const analyse = await prisma.soilAnalysis.create({
      data: {
        parcelId,
        campaignYear: 2026,
        sampledOn: new Date('2026-02-10'),
        residualNitrogenKgHa: 52,
        laboratory: 'Laboratoire d’essai',
      },
      select: { id: true },
    });

    const plan = await creerPlan({
      needKgHa: 210,
      residualKgHa: 45,
      soilAnalysisId: analyse.id,
      previousCropKgHa: 20,
      soilSupplyKgHa: 35,
    });

    const bilan = await buildNitrogenBalance(plan.id);
    const reliquat = bilan.supplies.find((l) => l.key === 'residual');

    // La mesure l'emporte sur l'estimation, et le bilan dit d'où elle vient.
    expect(reliquat?.valueKgHa).toBe(52);
    expect(reliquat?.origin).toContain('Analyse de sol');
    expect(bilan.totalSuppliesKgHa).toBe(107);
  });

  /**
   * La seule conversion que le module s'autorise, parce qu'elle est
   * dimensionnelle. La teneur publiée est celle du **nitrate**, pas de l'azote :
   * confondre les deux surestimerait la fourniture d'un facteur 4,4.
   */
  it('convertit la teneur en nitrate de l’eau, sans la confondre avec l’azote', () => {
    // 50 mg/L de NO3 sur 1000 m³/ha → 50 kg de nitrate → 11,29 kg N.
    expect(irrigationNitrogenKgHa(50, 1000)).toBeCloseTo(11.29, 1);
    expect(irrigationNitrogenKgHa(0, 1000)).toBe(0);
    // Une donnée manquante ne vaut pas zéro.
    expect(irrigationNitrogenKgHa(null, 1000)).toBeNull();
    expect(irrigationNitrogenKgHa(50, null)).toBeNull();
  });

  it('bloque le bilan quand l’irrigation est déclarée sans ses mesures', async () => {
    const plan = await creerPlan({
      needKgHa: 210,
      residualKgHa: 45,
      previousCropKgHa: 20,
      soilSupplyKgHa: 35,
      irrigated: true,
    });

    const bilan = await buildNitrogenBalance(plan.id);
    expect(bilan.computable).toBe(false);
    const irrigation = bilan.supplies.find((l) => l.key === 'irrigation');
    expect(irrigation?.valueKgHa).toBeNull();
    expect(irrigation?.missingReason).toContain('teneur');
  });

  // -------------------------------------------------------------------------
  // Prévisionnel contre réalisé
  // -------------------------------------------------------------------------

  it('compare le réalisé au prévisionnel sans ressaisie', async () => {
    const plan = await creerPlan({ needKgHa: 210 });
    await prisma.nitrogenPlanEntry.createMany({
      data: [
        { planId: plan.id, label: 'Urée', inputType: 'MINERAL', efficientKgHa: 60 },
        { planId: plan.id, label: 'Ammonitrate', inputType: 'MINERAL', efficientKgHa: 90 },
      ],
    });

    // Le réalisé vient des apports déjà enregistrés : aucune seconde saisie.
    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        cropYearId,
        appliedOn: new Date('2026-03-01'),
        inputType: 'MINERAL',
        productLabel: 'Ammonitrate 33,5',
        dose: 200,
        doseUnit: 'kg/ha',
        treatedAreaHa: 10,
        totalQuantity: 2000,
        totalUnit: 'kg',
        // `nSupplied` est une **dose à l'hectare**, pas un total : c'est ce que
        // `computeNutrients` produit (dose × teneur), et `tests/agronomy.test.ts`
        // l'atteste sur ce même produit. Ce test écrivait ici un total (1650),
        // et `comparePlanToActual` le redivisait par la surface — le réalisé
        // ressortait à 165 par une double erreur qui s'annulait sur 10 ha, et
        // qui se serait vue sur toute autre surface.
        nSupplied: 165,
      },
    });

    const comparaison = await comparePlanToActual(plan.id);
    expect(comparaison).not.toBeNull();
    expect(comparaison?.plannedKgHa).toBe(150);
    expect(comparaison?.actualKgHa).toBe(165);
    // La dose telle qu'appliquée, distincte de sa contribution à l'hectare de
    // parcelle : ici les deux coïncident, la parcelle entière ayant été traitée.
    expect(comparaison?.applications[0]?.doseKgHa).toBe(165);
    expect(comparaison?.deviationKgHa).toBe(15);
    expect(comparaison?.exceeds).toBe(true);
    expect(comparaison?.justified).toBe(false);
  });

  it('ramène la dose à l’hectare de parcelle quand une partie seulement est traitée', async () => {
    // Le test qui aurait attrapé le défaut d'origine.
    //
    // Sur une parcelle entièrement traitée, prendre `nSupplied` pour un total
    // et le rediviser par la surface donnait le bon résultat par accident : les
    // deux erreurs s'annulaient. Dès que la surface traitée diffère de la
    // parcelle, elles ne s'annulent plus.
    //
    // Ici : 150 kg N/ha appliqués sur 4 ha d'une parcelle de 10 ha. La parcelle
    // a donc reçu 600 kg, soit 60 kg N/ha de parcelle.
    const plan = await creerPlan();
    await prisma.nitrogenPlanEntry.create({
      data: { planId: plan.id, label: 'Urée', inputType: 'MINERAL', efficientKgHa: 100 },
    });
    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        cropYearId,
        appliedOn: new Date('2026-03-01'),
        inputType: 'MINERAL',
        productLabel: 'Urée',
        dose: 326,
        doseUnit: 'kg/ha',
        treatedAreaHa: 4,
        totalQuantity: 1304,
        totalUnit: 'kg',
        nSupplied: 150,
      },
    });

    const comparaison = await comparePlanToActual(plan.id);
    expect(comparaison?.applications[0]?.doseKgHa).toBe(150);
    expect(comparaison?.actualKgHa).toBe(60);
    // 60 < 100 : pas de dépassement. L'ancien calcul rendait 37,5 — faux, et
    // dans le même sens que l'erreur d'origine : toujours trop bas, donc
    // toujours rassurant.
    expect(comparaison?.exceeds).toBe(false);
  });

  it('tient compte de la justification enregistrée', async () => {
    const plan = await creerPlan();
    await prisma.nitrogenPlanEntry.create({
      data: { planId: plan.id, label: 'Urée', inputType: 'MINERAL', efficientKgHa: 100 },
    });
    await prisma.fertilizerApplication.create({
      data: {
        parcelId,
        cropYearId,
        appliedOn: new Date('2026-03-01'),
        inputType: 'MINERAL',
        productLabel: 'Urée',
        dose: 250,
        doseUnit: 'kg/ha',
        treatedAreaHa: 10,
        totalQuantity: 2500,
        totalUnit: 'kg',
        nSupplied: 120,
      },
    });
    await prisma.nitrogenPlanDeviation.create({
      data: {
        planId: plan.id,
        deviationKgHa: 20,
        cause: 'Accident cultural : reprise après gel',
        tool: 'Pesée de biomasse',
      },
    });

    const comparaison = await comparePlanToActual(plan.id);
    expect(comparaison?.exceeds).toBe(true);
    expect(comparaison?.justified).toBe(true);
  });

  // -------------------------------------------------------------------------
  // IFT
  // -------------------------------------------------------------------------

  it('calcule l’IFT comme un rapport de doses, pas comme un compteur', () => {
    // Pleine dose sur toute la parcelle → 1.
    expect(
      computeTreatmentIft({
        doseValue: 2,
        doseUnit: 'L/ha',
        referenceValue: 2,
        referenceUnit: 'L/ha',
        treatedAreaHa: 10,
        parcelAreaHa: 10,
      }).ift,
    ).toBe(1);

    // Demi-dose sur la moitié de la parcelle → 0,25. Un compteur dirait 1.
    expect(
      computeTreatmentIft({
        doseValue: 1,
        doseUnit: 'L/ha',
        referenceValue: 2,
        referenceUnit: 'L/ha',
        treatedAreaHa: 5,
        parcelAreaHa: 10,
      }).ift,
    ).toBe(0.25);

    // Les préfixes se convertissent : 2000 mL/ha valent 2 L/ha.
    expect(
      computeTreatmentIft({
        doseValue: 2000,
        doseUnit: 'mL/ha',
        referenceValue: 2,
        referenceUnit: 'L/ha',
        treatedAreaHa: 10,
        parcelAreaHa: 10,
      }).ift,
    ).toBe(1);
  });

  it('ne rend pas zéro quand l’IFT n’est pas calculable', () => {
    const sansReference = computeTreatmentIft({
      doseValue: 2,
      doseUnit: 'L/ha',
      referenceValue: null,
      referenceUnit: null,
      treatedAreaHa: 10,
      parcelAreaHa: 10,
    });
    expect(sansReference.ift).toBeNull();
    expect(sansReference.reason).toContain('Aucune dose de référence');

    // Masse contre volume : la densité du produit n'est pas publiée.
    const unitesIncomparables = computeTreatmentIft({
      doseValue: 2,
      doseUnit: 'L/ha',
      referenceValue: 2,
      referenceUnit: 'kg/ha',
      treatedAreaHa: 10,
      parcelAreaHa: 10,
    });
    expect(unitesIncomparables.ift).toBeNull();
    expect(unitesIncomparables.reason).toContain('densité');
  });

  it('range les traitements dans les catégories officielles', () => {
    expect(categoryOf('Herbicide')).toBe('herbicides');
    expect(categoryOf('Fongicide')).toBe('fongicides');
    expect(categoryOf('Insecticide')).toBe('insecticides');
    expect(categoryOf('Acaricide')).toBe('insecticides');
    // Un traitement non classé reste un traitement.
    expect(categoryOf('Régulateur de croissance')).toBe('autres');
    expect(categoryOf(null)).toBe('autres');
  });

  it('ne calcule aucun IFT tant que le référentiel n’est pas importé', async () => {
    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId,
        cropYearId,
        appliedOn: new Date('2026-04-15'),
        productName: 'PRODUIT D’ESSAI',
        amm: '9990001',
        cropLabel: 'Blé tendre',
        dose: 2,
        doseUnit: 'L/ha',
        treatedAreaHa: 10,
        quantityUsed: 20,
        quantityUnit: 'L',
      },
    });

    const resume = await computeFarmIft({ farmId, campaignYear: 2026 });

    expect(resume.configured).toBe(false);
    // Surtout pas 0 ni 1 : l'IFT n'existe pas ici, il n'est pas nul.
    expect(resume.total).toBeNull();
    expect(resume.uncomputed).toBe(1);
    expect(resume.caveats[0]).toContain('n’est pas un IFT');
  });

  it('calcule l’IFT de l’exploitation une fois le référentiel importé', async () => {
    await importIftReferences(
      [
        {
          cropLabel: 'Blé tendre',
          amm: '9990001',
          category: 'herbicides',
          doseValue: '2.0',
          doseUnit: 'L/ha',
        },
      ],
      { version: '2026', sourceLabel: 'Échantillon de test' },
    );

    await prisma.phytosanitaryApplication.createMany({
      data: [
        {
          parcelId,
          cropYearId,
          appliedOn: new Date('2026-04-15'),
          productName: 'PRODUIT D’ESSAI',
          amm: '9990001',
          cropLabel: 'Blé tendre',
          dose: 2,
          doseUnit: 'L/ha',
          treatedAreaHa: 10,
          quantityUsed: 20,
          quantityUnit: 'L',
        },
        {
          parcelId,
          cropYearId,
          appliedOn: new Date('2026-05-02'),
          productName: 'PRODUIT D’ESSAI',
          amm: '9990001',
          cropLabel: 'Blé tendre',
          dose: 1,
          doseUnit: 'L/ha',
          treatedAreaHa: 5,
          quantityUsed: 5,
          quantityUnit: 'L',
        },
      ],
    });

    const resume = await computeFarmIft({ farmId, campaignYear: 2026 });

    expect(resume.configured).toBe(true);
    // 1 (pleine dose, toute la parcelle) + 0,25 (demi-dose, demi-parcelle).
    expect(resume.total).toBe(1.25);
    expect(resume.byCategory.herbicides).toBe(1.25);
    expect(resume.computed).toBe(2);
    expect(resume.uncomputed).toBe(0);
    expect(resume.source?.version).toBe('2026');
  });

  it('compte à part les traitements sans référence, sans les valoriser à zéro', async () => {
    await importIftReferences(
      [
        {
          cropLabel: 'Blé tendre',
          amm: '9990001',
          category: 'herbicides',
          doseValue: '2.0',
          doseUnit: 'L/ha',
        },
      ],
      { version: '2026', sourceLabel: 'Échantillon de test' },
    );

    await prisma.phytosanitaryApplication.createMany({
      data: [
        {
          parcelId,
          cropYearId,
          appliedOn: new Date('2026-04-15'),
          productName: 'CONNU',
          amm: '9990001',
          cropLabel: 'Blé tendre',
          dose: 2,
          doseUnit: 'L/ha',
          treatedAreaHa: 10,
          quantityUsed: 20,
          quantityUnit: 'L',
        },
        {
          parcelId,
          cropYearId,
          appliedOn: new Date('2026-04-20'),
          productName: 'INCONNU AU RÉFÉRENTIEL',
          amm: '9999999',
          cropLabel: 'Blé tendre',
          dose: 3,
          doseUnit: 'L/ha',
          treatedAreaHa: 10,
          quantityUsed: 30,
          quantityUnit: 'L',
        },
      ],
    });

    const resume = await computeFarmIft({ farmId, campaignYear: 2026 });

    expect(resume.total).toBe(1);
    expect(resume.computed).toBe(1);
    expect(resume.uncomputed).toBe(1);
    expect(resume.caveats.some((c) => c.includes('ne valent pas zéro'))).toBe(true);

    const nonCalcule = resume.treatments.find((t) => t.amm === '9999999');
    expect(nonCalcule?.ift).toBeNull();
    expect(nonCalcule?.reason).toContain('Aucune dose de référence');
  });
});
