import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import { importZoneCollection } from '../src/lib/regulatory/import-zones';
import { importerTranscription } from '../src/lib/regulatory/import-regles';
import { analyserTranscription } from '../src/lib/regulatory/transcription';
import { computeParcelContext } from '../src/lib/regulatory/geography';
import { saveParcelGeometry } from '../src/lib/geo/repository';
import { calculEnregistre, calculerPlan, enregistrerPlanGren } from '../src/lib/regulatory/gren';
import { buildNitrogenBalance, comparePlanToActual } from '../src/lib/regulatory/nitrogen';
import { buildComplianceReport } from '../src/lib/regulatory/compliance';
import { assemblerDossier } from '../src/lib/regulatory/control-file';

/**
 * Le plan prévisionnel de fumure, de la base à la conformité : règles GREN
 * réellement importées, parcelle fictive de l'Allier, rendements et apports
 * enregistrés en base, plan enregistré puis relu par le bilan et la
 * comparaison prévu / réalisé.
 */

const DOSSIER = path.join(process.cwd(), 'data', 'referentiels-aura', 'transcriptions');

function rectangle(ouest: number, sud: number, est: number, nord: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [[[ouest, sud], [est, sud], [est, nord], [ouest, nord], [ouest, sud]] as Array<[number, number]>],
  };
}

const SAISIE_BLE = {
  culture: 'cereales-paille',
  typeSol: 'argilo-calcaire-moyen-a-profond',
  espece: 'ble-tendre',
  besoin: { mode: 'variete-non-referencee' },
  objectif: { mode: 'historique' },
  choix: {
    Pi: { stade: '2-talles' },
    Ri: { precedent: 'colza-cereales-betterave' },
    Mh: { systeme: 'enfouis-1-sur-2-sans-mo' },
    Mr: { precedent: 'betterave-colza-luzerne-2ans-pois-soja-haricot-pdt' },
  },
  sansObjet: ['Mhp', 'Nirr'],
  groupeCultureKeq: 'culture-hiver-cereales',
};

describe('Plan prévisionnel de fumure GREN — enregistré, relu, comparé', () => {
  let farmId = '';
  let parcelId = '';
  let cropId = '';

  beforeEach(async () => {
    await resetDatabase();
    farmId = (await createUserWithFarm({ email: 'ppf@parcelys.test', farmName: 'GAEC d’essai' })).farmId;
    await importZoneCollection(
      [{ type: 'Feature', geometry: rectangle(3.0, 46.0, 4.0, 47.0), properties: { code: '84', nom: 'Région d’essai' } }],
      { code: 'limites-administratives', name: 'Région', kind: 'REGION_ADMINISTRATIVE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    await importZoneCollection(
      [{ type: 'Feature', geometry: rectangle(3.0, 46.0, 3.5, 47.0), properties: { code: '03999', nom: 'Commune d’essai', classement: 'toutes sections', bassin_nom: 'Loire-Bretagne' } }],
      { code: 'zones-vulnerables', name: 'Zones vulnérables', kind: 'ZONE_VULNERABLE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    const t = analyserTranscription(JSON.parse(readFileSync(path.join(DOSSIER, 'gren-aura.json'), 'utf8')));
    await importerTranscription(t, []);

    // Parcelle fictive de l'Allier (code INSEE fictif du département 03).
    const p = await prisma.parcel.create({ data: { farmId, name: 'La Pièce d’essai', areaHa: 10, inseeCode: '03999' } });
    parcelId = p.id;
    await saveParcelGeometry(prisma, p.id, rectangle(3.1, 46.5, 3.11, 46.51));
    await computeParcelContext(p.id);
    cropId = (await prisma.crop.create({ data: { farmId, code: 'BLE_ESSAI', name: 'Blé tendre d’hiver' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function culture(campagne: number, rendement?: number) {
    return prisma.cropYear.create({
      data: {
        parcelId,
        cropId,
        campaignYear: campagne,
        sowingDate: new Date(Date.UTC(campagne - 1, 9, 15)),
        ...(rendement !== undefined ? { yieldValue: rendement, yieldUnit: 'q/ha' } : {}),
      },
    });
  }

  it('calcule la dose depuis les règles importées, avec l’historique de rendement de l’exploitation', async () => {
    // Cinq campagnes passées : 6, 9, 8, 8,5 et 7,5 t/ha — en t/ha pour
    // vérifier la conversion en quintaux.
    for (const [i, r] of [6, 9, 8, 8.5, 7.5].entries()) {
      await prisma.cropYear.create({
        data: { parcelId, cropId, campaignYear: 2021 + i, yieldValue: r, yieldUnit: 't/ha' },
      });
    }
    const cy = await culture(2026);

    const { planId, resultat } = await enregistrerPlanGren({ cropYearId: cy.id, farmId, saisie: SAISIE_BLE });

    expect(resultat.calcul.bloquants).toEqual([]);
    expect(resultat.referentiel?.code).toBe('gren');
    expect(resultat.lueLe).toBe('2026-02-01');
    // Objectif 80 q (sans 60 ni 90), Pf 240 : 240 + 40 − (20 + 70 + 30 + 0 + 20 + 0 + 0 + 0) = 140.
    expect(resultat.calcul.termes.find((t) => t.terme === 'y')?.valeur).toBe(80);
    expect(resultat.calcul.doseKgHa).toBe(140);
    // Chaque règle employée porte sa trace, avec son texte.
    expect(resultat.traces['gren-ft2-ri-allier']?.texte).toMatch(/fiche|Fiche|FT|p\./);
    expect(resultat.traces['gren-ft2-ri-allier']?.territoire).toBe('84');

    const plan = await prisma.nitrogenPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(Number(plan.plannedEfficientKgHa)).toBe(140);
    expect(plan.referentialCode).toBe('gren');
    expect(calculEnregistre(plan.computation)?.calcul.doseKgHa).toBe(140);

    const bilan = await buildNitrogenBalance(planId);
    expect(bilan.computable).toBe(true);
    expect(bilan.requiredKgHa).toBe(140);
    expect(bilan.gren?.referentiel?.code).toBe('gren');
  });

  it('pondère les rendements d’une même campagne par la surface, toutes unités de masse confondues', async () => {
    const autre = await prisma.parcel.create({ data: { farmId, name: 'Autre pièce', areaHa: 5, inseeCode: '03999' } });
    await saveParcelGeometry(prisma, autre.id, rectangle(3.2, 46.5, 3.21, 46.51));
    // Même campagne, deux parcelles, deux unités : 8 t/ha et 80 q/ha font 80 q/ha.
    for (const [i, r] of [60, 90, 80, 85, 75].entries()) {
      await prisma.cropYear.create({ data: { parcelId, cropId, campaignYear: 2021 + i, yieldValue: r / 10, yieldUnit: 't/ha' } });
      await prisma.cropYear.create({ data: { parcelId: autre.id, cropId, campaignYear: 2021 + i, yieldValue: r, yieldUnit: 'q/ha' } });
    }
    const cy = await culture(2026);
    const r = await calculerPlan({ cropYearId: cy.id, farmId, saisie: SAISIE_BLE });
    expect(r.calcul.termes.find((t) => t.terme === 'y')?.valeur).toBe(80);
  });

  it('compare la dose aux engrais minéraux, et demande de recalculer après un apport organique', async () => {
    const cy = await culture(2026);
    await enregistrerPlanGren({
      cropYearId: cy.id,
      farmId,
      saisie: { ...SAISIE_BLE, objectif: { mode: 'declare', valeur: 80, justification: 'moyenne de l’exploitation' } },
    });
    const plan = await prisma.nitrogenPlan.findUniqueOrThrow({ where: { cropYearId: cy.id } });

    const fumier = await prisma.organicInput.create({
      data: { farmId, name: 'Fumier d’essai', nContent: 5, defaultUnit: 't/ha', isCustom: true, regulatoryClass: { keq: 'fumier-herbivores-lapins' } },
    });
    // La surface vient du contour enregistré, pas de la saisie.
    const surface = Number((await prisma.parcel.findUniqueOrThrow({ where: { id: parcelId } })).areaHa);
    // 160 kg N/ha d'ammonitrate sur toute la parcelle, et un fumier après coup.
    await prisma.fertilizerApplication.createMany({
      data: [
        { parcelId, cropYearId: cy.id, appliedOn: new Date('2026-03-01T00:00:00Z'), inputType: 'MINERAL', productLabel: 'Ammonitrate', dose: 478, doseUnit: 'kg/ha', treatedAreaHa: surface, totalQuantity: 478 * surface, totalUnit: 'kg', nSupplied: 160 },
        { parcelId, cropYearId: cy.id, appliedOn: new Date('2026-03-10T00:00:00Z'), inputType: 'ORGANIC', organicInputId: fumier.id, productLabel: 'Fumier d’essai', dose: 20, doseUnit: 't/ha', treatedAreaHa: surface, totalQuantity: 20 * surface, totalUnit: 't', nSupplied: 100 },
      ],
    });

    const comparaison = await comparePlanToActual(plan.id);
    expect(comparaison?.perimetre).toBe('engrais-mineraux');
    // Seul le minéral se compare à la dose GREN : 160 contre 140.
    expect(comparaison?.actualKgHa).toBe(160);
    expect(comparaison?.plannedKgHa).toBe(140);
    expect(comparaison?.exceeds).toBe(true);
    expect(comparaison?.remarques.join(' ')).toMatch(/recalculez-le/);

    // Recalculé : le fumier entre dans Xpro (20 t × 5 kg × Kéq 0,2 = 20).
    const { resultat } = await enregistrerPlanGren({
      cropYearId: cy.id,
      farmId,
      saisie: { ...SAISIE_BLE, objectif: { mode: 'declare', valeur: 80, justification: 'moyenne de l’exploitation' } },
    });
    expect(resultat.calcul.termes.find((t) => t.terme === 'Xpro')?.valeur).toBe(20);
    expect(resultat.calcul.doseKgHa).toBe(120);
    expect((await comparePlanToActual(plan.id))?.remarques).toEqual([]);

    // Le dépassement non justifié est une anomalie de la synthèse.
    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    expect(rapport.findings.some((f) => f.code === 'ppf.depassement-non-justifie')).toBe(true);
  });

  it('une campagne 2025 n’a pas la fiche 19 de juillet 2025 : apport organique → dose non calculée', async () => {
    const cy = await culture(2025);
    const fumier = await prisma.organicInput.create({
      data: { farmId, name: 'Fumier d’essai', nContent: 5, defaultUnit: 't/ha', isCustom: true, regulatoryClass: { keq: 'fumier-herbivores-lapins' } },
    });
    const surface = Number((await prisma.parcel.findUniqueOrThrow({ where: { id: parcelId } })).areaHa);
    await prisma.fertilizerApplication.create({
      data: { parcelId, cropYearId: cy.id, appliedOn: new Date('2025-03-10T00:00:00Z'), inputType: 'ORGANIC', organicInputId: fumier.id, productLabel: 'Fumier d’essai', dose: 20, doseUnit: 't/ha', treatedAreaHa: surface, totalQuantity: 20 * surface, totalUnit: 't', nSupplied: 100 },
    });
    const r = await calculerPlan({
      cropYearId: cy.id,
      farmId,
      saisie: { ...SAISIE_BLE, objectif: { mode: 'declare', valeur: 80, justification: 'moyenne' } },
    });
    expect(r.lueLe).toBe('2025-02-01');
    expect(r.calcul.doseKgHa).toBeNull();
    expect(r.calcul.bloquants.find((b) => b.terme.includes('Xpro'))?.raison).toMatch(/15\/07\/2025/);
  });

  it('avant le 1er septembre 2024, aucune version du GREN fournie ne s’applique', async () => {
    const cy = await culture(2024);
    const r = await calculerPlan({ cropYearId: cy.id, farmId, saisie: SAISIE_BLE });
    expect(r.referentiel).toBeNull();
    expect(r.calcul.doseKgHa).toBeNull();
    expect(r.calcul.bloquants[0]?.raison).toMatch(/n’entre en vigueur que le 01\/09\/2024/);
  });

  it('n’exige le plan qu’en zone vulnérable', async () => {
    await culture(2026);
    const horsZv = await prisma.parcel.create({ data: { farmId, name: 'Hors zone', areaHa: 5, inseeCode: '03998' } });
    await saveParcelGeometry(prisma, horsZv.id, rectangle(3.8, 46.5, 3.81, 46.51));
    await computeParcelContext(horsZv.id);
    await prisma.cropYear.create({ data: { parcelId: horsZv.id, cropId, campaignYear: 2026 } });

    const rapport = await buildComplianceReport({ farmId, campaignYear: 2026 });
    const absents = rapport.findings.filter((f) => f.code === 'ppf.absent');
    expect(absents.map((f) => f.parcelId)).toEqual([parcelId]);
    expect(absents[0]?.level).toBe('VERIFICATION');

    // Le dossier de contrôle compte de la même façon : une culture exigée,
    // une hors zone.
    const avant = (await assemblerDossier({ farmId, campaignYear: 2026 })).pieces.find((p) => p.code === 'ppf');
    expect(avant?.statut).toBe('absente');
    expect(avant?.detail).toMatch(/0 plan\(s\) pour 1 culture\(s\).*1 culture\(s\) hors zone vulnérable/);

    const cy = await prisma.cropYear.findFirstOrThrow({ where: { parcelId, campaignYear: 2026 } });
    await enregistrerPlanGren({
      cropYearId: cy.id,
      farmId,
      saisie: { ...SAISIE_BLE, objectif: { mode: 'declare', valeur: 80, justification: 'moyenne' } },
    });
    const apres = (await assemblerDossier({ farmId, campaignYear: 2026 })).pieces.find((p) => p.code === 'ppf');
    expect(apres?.statut).toBe('presente');
    expect(apres?.detail).toMatch(/dont 1 avec une dose calculée/);
  });
});
