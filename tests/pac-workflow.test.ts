import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase, createUserWithFarm, testPolygon } from './helpers/db';
import {
  LAMBERT_93_PRJ,
  writeShapefile,
  type WriteField,
} from '../src/lib/pac/shapefile';
import { readDossier } from '../src/lib/pac/dossier';
import { analyzeDossier } from '../src/lib/pac/analyze';
import { applyImport, restoreSnapshot } from '../src/lib/pac/apply';
import { controlDossier } from '../src/lib/pac/control';
import { prepareExport } from '../src/lib/pac/export';

/**
 * Parcours PAC complet, celui du cahier des charges :
 *
 *   fichiers TéléPAC → import → modification → contrôle → export → réimport
 *
 * Les fichiers d'entrée sont fabriqués ici, en Lambert-93, avec des coordonnées
 * réellement situées en métropole : une erreur de projection s'y voit, alors
 * qu'avec des coordonnées arbitraires elle passerait inaperçue.
 *
 * Aucune donnée réglementaire réelle n'est employée : les codes culture sont
 * fictifs, et le module n'en déduit rien — il les transporte.
 */

const CHAMPS: WriteField[] = [
  { name: 'NUM_PARCEL', type: 'C', length: 20 },
  { name: 'NUM_ILOT', type: 'C', length: 10 },
  { name: 'CODE_CULTU', type: 'C', length: 6 },
  { name: 'SURF_PARC', type: 'N', length: 12, decimals: 4 },
];

/** Un carré en Lambert-93, quelque part en Beauce. */
function carre(x0: number, y0: number, cote: number): Array<[number, number]> {
  return [
    [x0, y0],
    [x0 + cote, y0],
    [x0 + cote, y0 + cote],
    [x0, y0 + cote],
    [x0, y0],
  ];
}

function dossierPac(
  parcelles: Array<{ num: string; ilot: string; culture: string; x: number; y: number; cote: number }>,
) {
  const shp = writeShapefile(
    parcelles.map((p) => ({
      rings: [carre(p.x, p.y, p.cote)],
      attributes: {
        NUM_PARCEL: p.num,
        NUM_ILOT: p.ilot,
        CODE_CULTU: p.culture,
        SURF_PARC: (p.cote * p.cote) / 10000,
      },
    })),
    CHAMPS,
    LAMBERT_93_PRJ,
  );
  return [
    { name: 'PARCELLES_2026.shp', buffer: shp.shp },
    { name: 'PARCELLES_2026.shx', buffer: shp.shx },
    { name: 'PARCELLES_2026.dbf', buffer: shp.dbf },
    { name: 'PARCELLES_2026.prj', buffer: Buffer.from(shp.prj) },
  ];
}

describe('Parcours PAC / TéléPAC', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function importer(
    farmId: string,
    userId: string,
    parcelles: Parameters<typeof dossierPac>[0],
  ) {
    const dossier = await readDossier(dossierPac(parcelles), 2026);
    const analyse = await analyzeDossier({
      farmId,
      year: 2026,
      layers: dossier.layers,
      ignoredFiles: dossier.ignored,
      problems: dossier.problems,
    });
    const resultat = await applyImport({
      farmId,
      year: 2026,
      userId,
      features: analyse.features,
      decisions: [],
      sourceFiles: dossier.layers.map((l) => l.name),
      detectedSrid: analyse.layers[0]?.srid ?? null,
      sridLabel: analyse.layers[0]?.sridLabel ?? '',
      ilotLayers: analyse.layers.filter((l) => l.isIlotLayer).map((l) => l.name),
    });
    return { analyse, resultat };
  }

  it('importe un dossier, crée les parcelles et rattache les îlots', async () => {
    const user = await createUserWithFarm({ email: 'pac@ferme.test', farmName: 'GAEC PAC' });

    const { analyse, resultat } = await importer(user.id ? user.farmId : user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
      { num: '2', ilot: '10', culture: 'MIS', x: 651000, y: 6860000, cote: 300 },
    ]);

    // Le système de coordonnées est lu dans le .prj, pas supposé.
    expect(analyse.layers[0]?.srid).toBe(2154);
    expect(resultat.created).toBe(2);
    expect(resultat.updated).toBe(0);

    const parcelles = await prisma.parcel.findMany({
      where: { farmId: user.farmId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    expect(parcelles).toHaveLength(2);
    expect(parcelles[0]?.parcelType).toBe('PAC');

    // Un carré de 400 m fait 16 ha. La surface vient de PostGIS, pas du fichier.
    const surfaces = parcelles.map((p) => Number(p.areaHa)).sort((a, b) => b - a);
    expect(surfaces[0]).toBeCloseTo(16, 1);
    expect(surfaces[1]).toBeCloseTo(9, 1);

    // L'îlot est une entité à part entière, pas une parcelle de plus (§ 11).
    const ilots = await prisma.pacIlot.findMany({ where: { campaign: { farmId: user.farmId } } });
    expect(ilots).toHaveLength(1);
    expect(ilots[0]?.numero).toBe('10');

    const entites = await prisma.pacFeature.findMany({
      where: { campaign: { farmId: user.farmId } },
    });
    expect(entites).toHaveLength(2);
    expect(entites.every((e) => e.parcelId !== null)).toBe(true);
    expect(entites.every((e) => e.ilotId === ilots[0]?.id)).toBe(true);
  });

  it('rapproche un second import des parcelles déjà présentes au lieu de les dupliquer', async () => {
    const user = await createUserWithFarm({ email: 'pac2@ferme.test', farmName: 'GAEC PAC' });
    const parcelles = [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
    ];

    await importer(user.farmId, user.id, parcelles);
    const { analyse, resultat } = await importer(user.farmId, user.id, parcelles);

    // Le rapprochement doit reconnaître la même emprise.
    expect(analyse.features[0]?.match).not.toBeNull();
    expect(analyse.features[0]?.match?.overlap ?? 0).toBeGreaterThan(0.99);
    expect(resultat.updated).toBe(1);
    expect(resultat.created).toBe(0);

    expect(await prisma.parcel.count({ where: { farmId: user.farmId, deletedAt: null } })).toBe(1);
  });

  it('n’efface pas l’historique des campagnes précédentes', async () => {
    const user = await createUserWithFarm({ email: 'pac3@ferme.test', farmName: 'GAEC PAC' });
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
    ]);

    const parcelle = await prisma.parcel.findFirstOrThrow({ where: { farmId: user.farmId } });
    // La base d'essai est vide : on crée la culture au lieu de la supposer
    // présente, sans quoi le test dépendrait du référentiel d'amorçage.
    const ble = await prisma.crop.create({
      data: { code: 'BTH', name: 'Blé tendre d’hiver' },
    });

    // Deux campagnes antérieures, saisies avant l'import de 2026.
    for (const annee of [2024, 2025]) {
      await prisma.cropYear.create({
        data: { parcelId: parcelle.id, cropId: ble.id, campaignYear: annee },
      });
    }

    // Un nouvel import de 2026 ne doit rien emporter.
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'TRN', x: 650000, y: 6860000, cote: 400 },
    ]);

    const annees = await prisma.cropYear.findMany({
      where: { parcelId: parcelle.id },
      orderBy: { campaignYear: 'asc' },
    });
    expect(annees.map((a) => a.campaignYear)).toEqual([2024, 2025]);
  });

  it('garde la géométrie précédente au lieu de l’écraser', async () => {
    const user = await createUserWithFarm({ email: 'pac4@ferme.test', farmName: 'GAEC PAC' });
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
    ]);
    // Deuxième import, parcelle agrandie : même emprise, donc rapprochement.
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 500 },
    ]);

    const parcelle = await prisma.parcel.findFirstOrThrow({ where: { farmId: user.farmId } });
    const versions = await prisma.parcelGeometry.findMany({
      where: { parcelId: parcelle.id },
      orderBy: { createdAt: 'asc' },
    });

    // L'ancienne géométrie reste, marquée non courante : c'est l'historique.
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.filter((v) => v.isCurrent)).toHaveLength(1);
    expect(Number(versions[versions.length - 1]?.areaHa)).toBeCloseTo(25, 1);
  });

  it('trace ce qui a changé depuis l’import', async () => {
    const user = await createUserWithFarm({ email: 'pac5@ferme.test', farmName: 'GAEC PAC' });
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
    ]);
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 500 },
    ]);

    const changements = await prisma.pacChange.findMany({
      where: { campaign: { farmId: user.farmId } },
      orderBy: { createdAt: 'asc' },
    });

    expect(changements.map((c) => c.changeType)).toEqual(['import.create', 'import.update']);

    const miseAJour = changements[1];
    expect(miseAJour?.userId).toBe(user.id);
    expect(miseAJour?.previousGeojson).not.toBeNull();
    expect(miseAJour?.newGeojson).not.toBeNull();
    expect(Number(miseAJour?.previousAreaHa)).toBeCloseTo(16, 1);
    expect(Number(miseAJour?.newAreaHa)).toBeCloseTo(25, 1);
  });

  it('sauvegarde avant d’importer, et sait revenir en arrière', async () => {
    const user = await createUserWithFarm({ email: 'pac6@ferme.test', farmName: 'GAEC PAC' });

    // Une parcelle saisie à la main, antérieure à tout import PAC.
    const existante = await prisma.parcel.create({
      data: { farmId: user.farmId, name: 'Le Pré du Bas', areaHa: 3 },
    });
    await prisma.$executeRaw`
      INSERT INTO parcel_geometries (id, parcel_id, geom, area_ha, source, is_current, created_at)
      VALUES (gen_random_uuid()::text, ${existante.id},
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(testPolygon())}), 4326)),
              3, 'manual', true, now())
    `;

    const { resultat } = await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
    ]);

    // La sauvegarde est prise AVANT, donc elle ne connaît que l'ancienne parcelle.
    const snapshot = await prisma.pacSnapshot.findUniqueOrThrow({
      where: { id: resultat.snapshotId },
    });
    expect(snapshot.parcelCount).toBe(1);

    expect(await prisma.parcel.count({ where: { farmId: user.farmId, deletedAt: null } })).toBe(2);

    const restaure = await restoreSnapshot({
      farmId: user.farmId,
      snapshotId: resultat.snapshotId,
      userId: user.id,
    });
    expect(restaure.restored).toBe(1);
    expect(restaure.softDeleted).toBe(1);

    // La parcelle importée est retirée, l'ancienne est toujours là — et rien
    // n'a été détruit pour de bon.
    const restantes = await prisma.parcel.findMany({
      where: { farmId: user.farmId, deletedAt: null },
    });
    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.name).toBe('Le Pré du Bas');
    expect(await prisma.parcel.count({ where: { farmId: user.farmId } })).toBe(2);
  });

  it('contrôle le dossier et refuse de déclarer conforme ce qui ne l’est pas', async () => {
    const user = await createUserWithFarm({ email: 'pac7@ferme.test', farmName: 'GAEC PAC' });

    // Deux parcelles qui se chevauchent franchement : la surface serait
    // comptée deux fois dans la déclaration.
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
      { num: '2', ilot: '10', culture: 'MIS', x: 650200, y: 6860200, cote: 400 },
    ]);

    const rapport = await controlDossier({ farmId: user.farmId, year: 2026 });

    expect(rapport.level).toBe('error');
    expect(rapport.findings.some((f) => f.category === 'Chevauchements')).toBe(true);
    // Le rapport dit ce qu'il ne couvre pas : les contrôles réglementaires
    // restent ceux de TéléPAC.
    expect(rapport.disclaimer).toContain('TéléPAC');
  });

  it('exporte en Lambert-93 un fichier relisible, et ne prétend rien déposer', async () => {
    const user = await createUserWithFarm({ email: 'pac8@ferme.test', farmName: 'GAEC PAC' });
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
      { num: '2', ilot: '10', culture: 'MIS', x: 651000, y: 6860000, cote: 300 },
    ]);

    const exporte = await prepareExport({
      farmId: user.farmId,
      farmName: 'GAEC PAC',
      year: 2026,
    });

    expect(exporte.srid).toBe(2154);
    expect(exporte.parcelCount).toBe(2);
    // Les quatre fichiers du Shapefile, plus la déclaration d'encodage.
    expect(exporte.files.map((f) => f.name.split('.').pop()).sort()).toEqual([
      'cpg', 'dbf', 'prj', 'shp', 'shx',
    ]);
    // Le libellé ne doit jamais laisser croire à un dépôt (§ 18).
    expect(exporte.notice).toContain("n'est pas déposée");
    expect(exporte.notice).not.toMatch(/déclaration envoyée/i);

    const prj = exporte.files.find((f) => f.name.endsWith('.prj'));
    expect(prj?.content.toString()).toContain('2154');
  });

  it('boucle : ce qui sort de Parcelys peut y rentrer, sans dérive', async () => {
    const user = await createUserWithFarm({ email: 'pac9@ferme.test', farmName: 'GAEC PAC' });
    await importer(user.farmId, user.id, [
      { num: '1', ilot: '10', culture: 'BTH', x: 650000, y: 6860000, cote: 400 },
      { num: '2', ilot: '10', culture: 'MIS', x: 651000, y: 6860000, cote: 300 },
    ]);

    const avant = await prisma.parcel.findMany({
      where: { farmId: user.farmId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    const surfacesAvant = avant.map((p) => Number(p.areaHa));

    const exporte = await prepareExport({ farmId: user.farmId, farmName: 'GAEC PAC', year: 2026 });

    // On réinjecte l'export comme s'il venait de TéléPAC.
    const relu = await readDossier(
      exporte.files
        .filter((f) => !f.name.endsWith('.cpg'))
        .map((f) => ({ name: f.name, buffer: f.content })),
      2026,
    );
    const analyse = await analyzeDossier({
      farmId: user.farmId,
      year: 2026,
      layers: relu.layers,
      ignoredFiles: relu.ignored,
      problems: relu.problems,
    });

    expect(analyse.layers[0]?.srid).toBe(2154);
    expect(analyse.totals.features).toBe(2);
    expect(analyse.totals.invalid).toBe(0);
    // Chaque entité doit se reconnaître dans la parcelle dont elle vient.
    expect(analyse.totals.matched).toBe(2);

    // Et surtout : les surfaces ne doivent pas dériver d'un tour à l'autre.
    const surfacesApres = analyse.features
      .map((f) => f.areaHa ?? 0)
      .sort((a, b) => a - b);
    surfacesAvant.sort((a, b) => a - b);
    surfacesApres.forEach((surface, i) => {
      expect(surface).toBeCloseTo(surfacesAvant[i] ?? 0, 3);
    });

    // Les identifiants et les cultures voyagent avec.
    const numeros = analyse.features.map((f) => f.numero).sort();
    expect(numeros).toEqual(['1', '2']);
    const cultures = analyse.features.map((f) => f.cropCode).sort();
    expect(cultures).toEqual(['BTH', 'MIS']);
  });

  it('ne plante pas sur un dossier abîmé, et dit ce qui ne va pas', async () => {
    const user = await createUserWithFarm({ email: 'pac10@ferme.test', farmName: 'GAEC PAC' });

    // Un .shp sans son .dbf : les géométries seraient anonymes.
    const shp = writeShapefile(
      [{ rings: [carre(650000, 6860000, 400)], attributes: { NUM_PARCEL: '1', NUM_ILOT: '10', CODE_CULTU: 'BTH', SURF_PARC: 16 } }],
      CHAMPS,
      LAMBERT_93_PRJ,
    );

    await expect(
      readDossier([{ name: 'PARCELLES.shp', buffer: shp.shp }], 2026),
    ).rejects.toThrow(/\.dbf/);

    // Un fichier qui n'est ni un Shapefile ni un dossier XML.
    //
    // Le message nomme désormais les deux formats lus : un utilisateur qui
    // dépose le mauvais fichier doit apprendre ce qu'on attend, pas seulement
    // que ce n'est pas ça.
    await expect(
      readDossier([{ name: 'notice.pdf', buffer: Buffer.from('%PDF-1.4') }], 2026),
    ).rejects.toThrow(/géographique/);
    await expect(
      readDossier([{ name: 'notice.pdf', buffer: Buffer.from('%PDF-1.4') }], 2026),
    ).rejects.toThrow(/XML/);

    // Un XML qui n'est pas un dossier TéléPAC est refusé pour ce qu'il est,
    // sans être confondu avec un dépôt vide.
    await expect(
      readDossier(
        [{ name: 'export.xml', buffer: Buffer.from('<?xml version="1.0"?><producteurs/>') }],
        2026,
      ),
    ).rejects.toThrow(/TéléPAC/);

    // Et rien n'a été écrit en base au passage.
    expect(await prisma.parcel.count({ where: { farmId: user.farmId } })).toBe(0);
  });

  it('refuse de projeter quand le système de coordonnées est inconnu', async () => {
    const user = await createUserWithFarm({ email: 'pac11@ferme.test', farmName: 'GAEC PAC' });

    const shp = writeShapefile(
      [{ rings: [carre(650000, 6860000, 400)], attributes: { NUM_PARCEL: '1', NUM_ILOT: '10', CODE_CULTU: 'BTH', SURF_PARC: 16 } }],
      CHAMPS,
      'PROJCS["Systeme_Inconnu_Sans_Autorite"]',
    );

    const dossier = await readDossier(
      [
        { name: 'P.shp', buffer: shp.shp },
        { name: 'P.dbf', buffer: shp.dbf },
        { name: 'P.prj', buffer: Buffer.from(shp.prj) },
      ],
      2026,
    );

    const analyse = await analyzeDossier({
      farmId: user.farmId,
      year: 2026,
      layers: dossier.layers,
      ignoredFiles: [],
      problems: [],
    });

    // Convertir au jugé déplacerait le parcellaire : on s'arrête et on le dit.
    expect(analyse.layers[0]?.srid).toBeNull();
    expect(analyse.features[0]?.error).toContain('Système de coordonnées inconnu');
    expect(analyse.features[0]?.geojson).toBeNull();
  });
});
