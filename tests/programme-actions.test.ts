import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import { importZoneCollection } from '../src/lib/regulatory/import-zones';
import { importerTranscription } from '../src/lib/regulatory/import-regles';
import { analyserTranscription } from '../src/lib/regulatory/transcription';
import { computeParcelContext, statutZonage } from '../src/lib/regulatory/geography';
import {
  controlerApportPar,
  controlerCouvertPar,
  constatsProgrammeActions,
  situationParcelle,
  type ApportAControler,
} from '../src/lib/regulatory/programme-actions';
import { classementDuProduit } from '../src/lib/regulatory/classement-produit';
import { saveParcelGeometry } from '../src/lib/geo/repository';

/**
 * Le 7e programme d'actions régional, appliqué.
 *
 * Les règles importées sont **les vraies** : la transcription de l'arrêté
 * n° 24-135 modifié, et celle du référentiel GREN, telles qu'elles sont dans
 * `data/referentiels-aura/transcriptions/`. Les parcelles, cultures et apports
 * sont fictifs ; les zonages aussi (un rectangle « région », un rectangle
 * « zone vulnérable »).
 *
 * Chaque test dit ce qu'une règle impose, et vérifie que le constat porte sa
 * trace : le texte, l'article, la date d'entrée en vigueur.
 */

const DOSSIER = path.join(process.cwd(), 'data', 'referentiels-aura', 'transcriptions');

function rectangle(ouest: number, sud: number, est: number, nord: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [[[ouest, sud], [est, sud], [est, nord], [ouest, nord], [ouest, sud]] as Array<[number, number]>],
  };
}

describe('Programme d’actions régional AURA — règles appliquées', () => {
  let farmId = '';

  beforeEach(async () => {
    await resetDatabase();
    farmId = (await createUserWithFarm({ email: 'par@parcelys.test', farmName: 'GAEC d’essai' })).farmId;

    // Région fictive, couvrant toutes les parcelles d'essai.
    await importZoneCollection(
      [{ type: 'Feature', geometry: rectangle(3.0, 46.0, 4.0, 47.0), properties: { code: '84', nom: 'Région d’essai' } }],
      { code: 'limites-administratives', name: 'Région', kind: 'REGION_ADMINISTRATIVE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    // Zone vulnérable fictive : la moitié ouest.
    await importZoneCollection(
      [{ type: 'Feature', geometry: rectangle(3.0, 46.0, 3.5, 47.0), properties: { code: '03999', nom: 'Commune d’essai', classement: 'toutes sections', bassin_nom: 'Loire-Bretagne' } }],
      { code: 'zones-vulnerables', name: 'Zones vulnérables', kind: 'ZONE_VULNERABLE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    for (const fichier of ['par7-aura.json', 'gren-aura.json']) {
      const t = analyserTranscription(JSON.parse(readFileSync(path.join(DOSSIER, fichier), 'utf8')));
      await importerTranscription(t, []);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function parcelle(nom: string, ouest = 3.1): Promise<string> {
    const p = await prisma.parcel.create({ data: { farmId, name: nom, areaHa: 0 }, select: { id: true } });
    await saveParcelGeometry(prisma, p.id, rectangle(ouest, 46.5, ouest + 0.01, 46.51));
    await computeParcelContext(p.id);
    return p.id;
  }

  async function culture(parcelId: string, nom: string, campagne: number, semis: string, recolte: string | null) {
    const crop = await prisma.crop.create({ data: { farmId, code: nom.toUpperCase().replace(/\W+/g, '_'), name: nom } });
    return prisma.cropYear.create({
      data: {
        parcelId,
        cropId: crop.id,
        campaignYear: campagne,
        sowingDate: new Date(`${semis}T00:00:00Z`),
        ...(recolte ? { actualHarvestDate: new Date(`${recolte}T00:00:00Z`) } : {}),
      },
    });
  }

  const ammonitrate = (parcelId: string, date: string, kgN: number): ApportAControler => ({
    parcelId,
    date: new Date(`${date}T00:00:00Z`),
    nature: 'MINERAL',
    libelle: 'Ammonitrate 33,5 %',
    azoteTotalKgHa: kgN,
    classement: classementDuProduit({ inputType: 'MINERAL', nPercent: 33.5 }),
  });

  // -------------------------------------------------------------------------
  // Période d'interdiction : allongement régional du 15 au 28 février
  // -------------------------------------------------------------------------

  it('interdit le type III du 15 au 28 février avant une culture de printemps récoltée dans l’année', async () => {
    const id = await parcelle('Les Varennes');
    await culture(id, 'Maïs grain', 2025, '2025-04-20', '2025-10-10');

    const { controles } = await controlerApportPar(ammonitrate(id, '2025-02-20', 60));
    const periode = controles.find((c) => c.sujet === 'Période d’épandage')!;

    expect(periode.verdict).toBe('alerte');
    expect(periode.detail).toContain('02-15');
    // La trace : le texte, l'article, la date d'entrée en vigueur, la citation.
    expect(periode.trace?.texte).toContain('Arrêté n° 24-135 du 19 juillet 2024');
    expect(periode.trace?.texte).toContain('tableau 1');
    expect(periode.trace?.validite.du).toBe('2024-09-01');
    expect(periode.trace?.territoire).toBe('84');
    expect(periode.trace?.citation).toContain('Du 15 au 28 février');
    expect(periode.detail).toContain('cas particuliers');
  });

  it('ne l’oppose pas à une culture d’hiver, et ne dit pas « conforme » pour autant', async () => {
    const id = await parcelle('Le Grand Champ');
    await culture(id, 'Blé tendre d’hiver', 2025, '2024-10-15', '2025-07-10');

    const { controles } = await controlerApportPar(ammonitrate(id, '2025-02-20', 60));
    const periode = controles.find((c) => c.sujet === 'Période d’épandage')!;

    // Les périodes nationales ne sont pas fournies : on ne conclut pas.
    expect(periode.verdict).toBe('indetermine');
    expect(periode.detail).toContain('nationales');
  });

  it('n’applique pas le PAR7 à un épandage antérieur à son entrée en vigueur', async () => {
    const id = await parcelle('Avant 2024');
    await culture(id, 'Maïs grain', 2024, '2024-04-20', '2024-10-10');

    const { controles } = await controlerApportPar(ammonitrate(id, '2024-02-20', 60));
    const periode = controles.find((c) => c.sujet === 'Période d’épandage')!;

    expect(periode.verdict).toBe('indetermine');
    expect(periode.detail).toMatch(/n’entre en vigueur que le 01\/09\/2024/);
  });

  it('ne s’applique pas hors zone vulnérable', async () => {
    const id = await parcelle('Hors zone', 3.7);
    await culture(id, 'Maïs grain', 2025, '2025-04-20', '2025-10-10');

    const { controles } = await controlerApportPar(ammonitrate(id, '2025-02-20', 60));
    expect(controles.find((c) => c.sujet === 'Période d’épandage')?.verdict).toBe('sans-objet');
  });

  it('lit la période en base, pas dans le code', async () => {
    // Falsification : si la règle importée change, le verdict change.
    const id = await parcelle('Contre-épreuve');
    await culture(id, 'Maïs grain', 2025, '2025-04-20', '2025-10-10');
    const regle = await prisma.regulatoryRule.findFirstOrThrow({ where: { code: 'periode-interdiction-epandage' } });
    await prisma.regulatoryRule.update({
      where: { id: regle.id },
      data: { value: { ...(regle.value as object), periodes: [{ du: '03-01', au: '03-10' }] } },
    });

    const { controles } = await controlerApportPar(ammonitrate(id, '2025-02-20', 60));
    expect(controles.find((c) => c.sujet === 'Période d’épandage')?.verdict).toBe('indetermine');
  });

  // -------------------------------------------------------------------------
  // Fractionnement des fertilisants de type III
  // -------------------------------------------------------------------------

  it('applique le fractionnement : 100 u par apport, 120 pour un engrais à libération progressive', async () => {
    const id = await parcelle('Fractionnement');
    await culture(id, 'Blé tendre d’hiver', 2025, '2024-10-15', '2025-07-10');

    const verdict = async (kg: number) =>
      (await controlerApportPar(ammonitrate(id, '2025-03-20', kg))).controles.find(
        (c) => c.sujet === 'Fractionnement (type III)',
      );

    expect((await verdict(90))?.verdict).toBe('ok');
    expect((await verdict(115))?.verdict).toBe('verification');
    const trop = await verdict(140);
    expect(trop?.verdict).toBe('alerte');
    expect(trop?.trace?.texte).toContain('art. 2, II');
  });

  it('ne limite pas la dose par apport d’un maïs semé après le 15 mai', async () => {
    const id = await parcelle('Maïs tardif');
    await culture(id, 'Maïs grain', 2025, '2025-05-20', '2025-10-30');
    const { controles } = await controlerApportPar(ammonitrate(id, '2025-06-10', 150));
    expect(controles.find((c) => c.sujet === 'Fractionnement (type III)')?.verdict).toBe('ok');
  });

  it('ne range pas en type III un produit organique non classé', () => {
    const c = classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: null });
    expect(c.typePan).toBeNull();
    // Mais la phase liquide d'un digestat est de type II : le PAR7 le dit.
    expect(classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: { aplsh: 'digestats-fraction-liquide' } }).typePan).toBe('II');
  });

  // -------------------------------------------------------------------------
  // Couverts d'interculture
  // -------------------------------------------------------------------------

  async function cipan(parcelId: string, semis: string, destruction: string | null, especes = 'moutarde blanche') {
    return prisma.soilCover.create({
      data: {
        parcelId,
        kind: 'CIPAN',
        species: especes,
        sownOn: new Date(`${semis}T00:00:00Z`),
        destroyedOn: destruction ? new Date(`${destruction}T00:00:00Z`) : null,
        destructionMethod: destruction ? 'BROYAGE' : null,
      },
    });
  }

  const fumier = (parcelId: string, date: string, tonnes: number): ApportAControler => ({
    parcelId,
    date: new Date(`${date}T00:00:00Z`),
    nature: 'ORGANIC',
    libelle: 'Fumier bovin',
    azoteTotalKgHa: tonnes * 5.5,
    classement: classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: { typePan: 'I', aplsh: 'fumier-bovins' } }),
  });

  it('plafonne l’azote potentiellement libéré sur un CINE, avec les coefficients de la fiche GREN 19', async () => {
    const id = await parcelle('CINE');
    await cipan(id, '2025-08-20', null);

    // 20 t × 5,5 kg N = 110 kg N ; apport d'automne : 15 % → 16,5 kg.
    const leger = await controlerApportPar(fumier(id, '2025-09-10', 20));
    const plafond = leger.controles.find((c) => c.sujet.endsWith('plafond'))!;
    expect(plafond.verdict).toBe('ok');
    expect(plafond.detail).toContain('16.5');
    expect(plafond.detail).toContain('15 %');

    // 100 t → 550 kg N × 15 % = 82,5 kg, au-delà de 70.
    const lourd = await controlerApportPar(fumier(id, '2025-09-10', 100));
    const depasse = lourd.controles.find((c) => c.sujet.endsWith('plafond'))!;
    expect(depasse.verdict).toBe('alerte');
    expect(depasse.trace?.texte).toContain('art. 2, I, 2° a');
  });

  it('ne calcule pas l’azote libéré avant la fiche 19 qui le définit', async () => {
    const id = await parcelle('CINE 2024');
    await cipan(id, '2024-08-20', null);
    const r = await controlerApportPar(fumier(id, '2024-09-10', 20));
    // La fiche 19 fournie date du 15/07/2025 : en septembre 2024, pas de
    // coefficient — et pas de chiffre inventé.
    expect(r.controles.find((c) => c.sujet.endsWith('plafond'))?.verdict).toBe('indetermine');
  });

  it('interdit tout apport sur des légumineuses pures en CINE', async () => {
    const id = await parcelle('Légumineuses');
    await cipan(id, '2025-08-20', null, 'trèfle incarnat, vesce');
    const r = await controlerApportPar(fumier(id, '2025-09-10', 10));
    expect(r.controles.find((c) => c.sujet.endsWith('légumineuses pures'))?.verdict).toBe('alerte');
  });

  it('contrôle la destruction des couverts : 1er novembre, huit semaines', async () => {
    const id = await parcelle('Destructions');
    const tot = await cipan(id, '2025-08-20', '2025-10-05');
    const argile = await cipan(id, '2025-08-01', '2025-10-20');
    const bon = await cipan(id, '2025-08-01', '2025-11-05');

    const verdict = async (c: { sownOn: Date | null; destroyedOn: Date | null } & Record<string, unknown>) => {
      const situation = await situationParcelle(id, c.sownOn!);
      return controlerCouvertPar(c as never, situation).find((r) => r.sujet === 'Destruction du couvert');
    };
    const r1 = await verdict(tot);
    expect(r1?.verdict).toBe('alerte');
    expect(r1?.detail).toContain('46 jours');
    expect((await verdict(argile))?.verdict).toBe('verification');
    expect((await verdict(bon))?.verdict).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // Zone d'actions renforcée et bassin
  // -------------------------------------------------------------------------

  it('interdit l’épandage sur CINE en ZAR, « à vérifier » quand le périmètre est reconstitué', async () => {
    await importZoneCollection(
      [{
        type: 'Feature',
        geometry: rectangle(3.05, 46.45, 3.2, 46.55),
        properties: {
          code: 'zar-essai',
          nom: 'ZAR — Captage d’essai',
          captage: 'Captage d’essai',
          reconstitue: true,
          classements: [{ depuis: '2024-09-01', valeur: 'périmètre reconstitué : aire d’alimentation du captage', source: 'essai' }],
        },
      }],
      { code: 'zones-action-renforcee', name: 'ZAR', kind: 'ZONE_ACTION_RENFORCEE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    const id = await parcelle('En ZAR');
    await cipan(id, '2025-08-20', null);
    const r = await controlerApportPar(fumier(id, '2025-09-10', 10));
    const zar = r.controles.find((c) => c.sujet === 'ZAR — épandage sur CINE')!;
    expect(zar.verdict).toBe('verification');
    expect(zar.detail).toContain('Captage d’essai');
    expect(zar.trace?.texte).toContain('art. 3, II, 2/');

    // Avant le 1er septembre 2024, la ZAR n'existait pas au titre du PAR7.
    const contexte = await computeParcelContext(id);
    expect(statutZonage(contexte, 'ZONE_ACTION_RENFORCEE', new Date('2024-06-01'))).toBe('indetermine');
    expect(statutZonage(contexte, 'ZONE_ACTION_RENFORCEE', new Date('2025-06-01'))).toBe('dedans');
  });

  it('ne déduit pas « hors zone vulnérable » d’un bassin que le zonage ne couvre pas', async () => {
    await importZoneCollection(
      [{ type: 'Feature', geometry: rectangle(3.6, 46.0, 4.0, 47.0), properties: { code: '05', nom: 'Adour-Garonne' } }],
      { code: 'cours-eau', name: 'BD TOPAGE', kind: 'BASSIN_HYDROGRAPHIQUE', territory: '84', version: 'essai', sourceLabel: 'Essai' },
    );
    const id = await parcelle('Bassin non couvert', 3.7);
    const contexte = await computeParcelContext(id);
    expect(statutZonage(contexte, 'ZONE_VULNERABLE')).toBe('indetermine');
    expect(contexte.unresolved.map((u) => u.reason).join(' ')).toContain('Adour-Garonne');
  });

  it('remonte les constats de campagne avec leur trace', async () => {
    const id = await parcelle('Campagne');
    await culture(id, 'Maïs grain', 2025, '2025-04-20', '2025-10-10');
    const engrais = await prisma.fertilizer.create({ data: { farmId, name: 'Ammonitrate 33,5 %', nPercent: 33.5 } });
    await prisma.fertilizerApplication.create({
      data: {
        parcelId: id,
        appliedOn: new Date('2025-02-20T00:00:00Z'),
        inputType: 'MINERAL',
        fertilizerId: engrais.id,
        productLabel: 'Ammonitrate 33,5 %',
        dose: 180,
        doseUnit: 'kg/ha',
        treatedAreaHa: 1,
        totalQuantity: 180,
        totalUnit: 'kg',
        nSupplied: 60.3,
      },
    });
    const constats = await constatsProgrammeActions({ farmId, campaignYear: 2025 });
    const periode = constats.find((c) => c.title === 'Période d’épandage' && c.level === 'ANOMALIE');
    expect(periode).toBeDefined();
    expect(periode?.trace?.referentiel.code).toBe('programme-actions-nitrates');
    expect(periode?.detail).toContain('Campagne');
  });
});
