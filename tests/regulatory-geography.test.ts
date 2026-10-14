import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { importZoneCollection } from '../src/lib/regulatory/import-zones';
import {
  computeParcelContext,
  computeZoneIntersections,
  getParcelContext,
  statutZonage,
  zoneOf,
} from '../src/lib/regulatory/geography';
import { saveParcelGeometry } from '../src/lib/geo/repository';

/**
 * Contexte réglementaire d'une parcelle.
 *
 * Ce que ces tests protègent avant tout : **une parcelle à cheval sur une zone
 * n'est pas entièrement dedans**. Raisonner par commune — « Artenay est en zone
 * vulnérable, donc toutes les parcelles d'Artenay le sont » — imposerait des
 * contraintes sur des hectares qui n'en relèvent pas, et en dispenserait
 * d'autres qui en relèvent.
 *
 * Les géométries sont fabriquées ici, avec des coordonnées choisies pour que le
 * recouvrement soit vérifiable à la main.
 */

/** Rectangle GeoJSON [ouest, sud] → [est, nord]. */
function rectangle(
  ouest: number,
  sud: number,
  est: number,
  nord: number,
): { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [ouest, sud],
        [est, sud],
        [est, nord],
        [ouest, nord],
        [ouest, sud],
      ],
    ],
  };
}

describe('Contexte réglementaire de la parcelle', () => {
  let farmId = '';

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'geo@parcelys.test',
      farmName: 'Exploitation géographique',
    });
    farmId = user.farmId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function creerParcelle(
    nom: string,
    ouest: number,
    sud: number,
    est: number,
    nord: number,
  ): Promise<string> {
    const parcelle = await prisma.parcel.create({
      data: { farmId, name: nom, areaHa: 0 },
      select: { id: true },
    });
    await saveParcelGeometry(prisma, parcelle.id, rectangle(ouest, sud, est, nord));
    return parcelle.id;
  }

  async function importerZone(
    geometrie: ReturnType<typeof rectangle>,
    version = '2024-07',
  ) {
    return importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: geometrie,
          properties: { nom: 'Zone vulnérable d’essai', code: 'ZV-TEST' },
        },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '24',
        version,
        sourceLabel: 'Échantillon de test',
      },
    );
  }

  // -------------------------------------------------------------------------

  it('n’invente aucun zonage tant qu’aucun référentiel n’est importé', async () => {
    const parcelleId = await creerParcelle('Sans zonage', 1.88, 48.08, 1.89, 48.086);

    const contexte = await computeParcelContext(parcelleId);

    expect(contexte.zones).toHaveLength(0);
    // L'absence de zone n'est pas « pas en zone vulnérable » : c'est
    // « on ne sait pas », et le contexte le dit.
    const indetermine = contexte.unresolved.find((u) =>
      u.what.includes('Zone vulnérable'),
    );
    expect(indetermine).toBeDefined();
    expect(indetermine?.reason).toContain('zones-vulnerables');
    expect(indetermine?.remedy).toContain('Référentiels');
  });

  it('reconnaît une parcelle entièrement comprise dans la zone', async () => {
    // Zone large, parcelle bien à l'intérieur.
    await importerZone(rectangle(1.87, 48.07, 1.91, 48.1));
    const parcelleId = await creerParcelle('Dedans', 1.88, 48.08, 1.89, 48.086);

    const contexte = await computeParcelContext(parcelleId);
    const zone = zoneOf(contexte, 'ZONE_VULNERABLE');

    expect(zone).not.toBeNull();
    expect(zone?.coverage).toBe('totale');
    expect(zone?.ratio).toBeGreaterThan(0.995);
    expect(zone?.label).toBe('Zone vulnérable d’essai');
    expect(zone?.code).toBe('ZV-TEST');
    // La provenance voyage avec le résultat : sans elle, impossible de dire
    // d'où vient un classement des années plus tard.
    expect(zone?.referential.version).toBe('2024-07');
  });

  /**
   * Le cas qui justifie tout le module. Une parcelle coupée en deux par la
   * limite de zone : la moitié seulement est concernée, et c'est cette moitié
   * qui doit être rendue — pas la parcelle entière, pas rien.
   */
  it('rend la surface réellement concernée quand la parcelle est à cheval', async () => {
    // Zone s'arrêtant à 1,885° ; parcelle de 1,88 à 1,89 → moitié dedans.
    await importerZone(rectangle(1.87, 48.07, 1.885, 48.1));
    const parcelleId = await creerParcelle('À cheval', 1.88, 48.08, 1.89, 48.086);

    const contexte = await computeParcelContext(parcelleId);
    const zone = zoneOf(contexte, 'ZONE_VULNERABLE');

    expect(zone).not.toBeNull();
    expect(zone?.coverage).toBe('partielle');
    // La moitié, à la tolérance du modèle ellipsoïdal près.
    expect(zone?.ratio).toBeGreaterThan(0.45);
    expect(zone?.ratio).toBeLessThan(0.55);

    const parcelle = await prisma.parcel.findUniqueOrThrow({
      where: { id: parcelleId },
      select: { areaHa: true },
    });
    expect(zone?.areaHa).toBeLessThan(Number(parcelle.areaHa));
    expect(zone?.areaHa).toBeGreaterThan(0);
  });

  it('ne retient pas une parcelle simplement voisine de la zone', async () => {
    // Zone à l'ouest, parcelle à l'est : les deux se touchent sans se recouvrir.
    await importerZone(rectangle(1.86, 48.07, 1.88, 48.1));
    const parcelleId = await creerParcelle('Voisine', 1.88, 48.08, 1.89, 48.086);

    const contexte = await computeParcelContext(parcelleId);
    expect(zoneOf(contexte, 'ZONE_VULNERABLE')).toBeNull();
  });

  it('ne retient pas une parcelle hors de la zone', async () => {
    await importerZone(rectangle(1.7, 48.0, 1.75, 48.05));
    const parcelleId = await creerParcelle('Ailleurs', 1.88, 48.08, 1.89, 48.086);

    const contexte = await computeParcelContext(parcelleId);
    expect(contexte.zones).toHaveLength(0);
  });

  it('reste indéterminé, sans erreur, pour une parcelle sans contour', async () => {
    const parcelle = await prisma.parcel.create({
      data: { farmId, name: 'Sans contour', areaHa: 0 },
      select: { id: true },
    });

    const contexte = await computeParcelContext(parcelle.id);
    expect(contexte.zones).toHaveLength(0);
    expect(contexte.unresolved[0]?.reason).toContain('contour');
  });

  /**
   * Une nouvelle version de zonage ne doit pas effacer l'ancienne : la campagne
   * qui s'est appuyée dessus doit rester relisible.
   */
  it('conserve la version précédente au lieu de l’écraser', async () => {
    await importerZone(rectangle(1.87, 48.07, 1.91, 48.1), '2024-07');
    await importerZone(rectangle(1.87, 48.07, 1.885, 48.1), '2026-01');

    const versions = await prisma.regulatoryReferential.findMany({
      where: { code: 'zones-vulnerables' },
      orderBy: { version: 'asc' },
      select: { version: true, status: true },
    });

    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.version === '2024-07')?.status).toBe('REMPLACE');
    expect(versions.find((v) => v.version === '2026-01')?.status).toBe('ACTIF');

    // Seule la version active sert au calcul : sinon une parcelle se
    // retrouverait classée deux fois par deux éditions du même zonage.
    const parcelleId = await creerParcelle('Témoin', 1.88, 48.08, 1.89, 48.086);
    const intersections = await computeZoneIntersections(parcelleId);
    expect(intersections).toHaveLength(1);
    expect(intersections[0]?.referential.version).toBe('2026-01');
  });

  it('journalise l’import, y compris ce qu’il n’a pas su faire', async () => {
    const rapport = await importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: rectangle(1.87, 48.07, 1.91, 48.1),
          properties: { nom: 'Valide' },
        },
        // Un point : conservé nulle part, parce qu'il ne permet aucun calcul
        // de surface — mais compté et signalé.
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1.88, 48.08] },
          properties: { nom: 'Point' },
        },
        { type: 'Feature', geometry: null, properties: { nom: 'Sans géométrie' } },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '24',
        version: '2024-07',
        sourceLabel: 'Échantillon de test',
      },
    );

    expect(rapport.imported).toBe(1);
    expect(rapport.skipped).toBe(2);
    expect(rapport.warnings.some((a) => a.includes('surfacique'))).toBe(true);

    const journal = await prisma.regulatoryImport.findFirstOrThrow({
      orderBy: { startedAt: 'desc' },
    });
    expect(journal.status).toBe('SUCCESS');
    expect(journal.recordCount).toBe(1);
    // Un import réussi mais diminué garde la trace de ce qui manque.
    expect(journal.warnings).toContain('surfacique');
  });

  it('enregistre le contexte pour l’affichage, avec sa date de calcul', async () => {
    await importerZone(rectangle(1.87, 48.07, 1.91, 48.1));
    const parcelleId = await creerParcelle('Enregistrée', 1.88, 48.08, 1.89, 48.086);
    await computeParcelContext(parcelleId);

    const relu = await getParcelContext(parcelleId);
    expect(relu).not.toBeNull();
    expect(relu?.zones).toHaveLength(1);
    expect(relu?.computedAt).toBeTruthy();
    expect(relu?.referentialVersions[0]?.code).toBe('zones-vulnerables');
  });
});

/*
 * ───────────────────────────────────────────────────────────────────────────
 * UN ZONAGE PUBLIÉ À LA COMMUNE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Les zones vulnérables d'Auvergne-Rhône-Alpes ne sont pas publiées sous forme
 * de zones : la DREAL publie la **liste des communes classées par arrêté
 * préfectoral**, et la géométrie fournie est le contour communal, au 1:50 000.
 *
 * Pour 907 des 1 125 communes, l'arrêté vise « toutes sections » — le contour
 * communal est alors la zone. Pour 218 autres, il ne vise que « quelques
 * sections » cadastrales, et le fichier ne dit pas lesquelles.
 *
 * Ce que ces tests protègent : qu'on ne conclue pas « dedans » parce que la
 * parcelle est dans une commune partiellement classée — ni « dehors », ce qui
 * dispenserait de règles qui s'appliquent peut-être. La seule réponse juste est
 * « indéterminé », assortie de ce qu'il faut consulter.
 *
 * Les codes et noms de communes sont fictifs ; le vocabulaire du classement est
 * celui du fichier officiel, mot pour mot.
 */
describe('Zonage publié à la commune', () => {
  let farmId = '';

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'commune@parcelys.test',
      farmName: 'Exploitation communale',
    });
    farmId = user.farmId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function carre(ouest: number, sud: number, cote: number) {
    return {
      type: 'Polygon' as const,
      coordinates: [
        [
          [ouest, sud],
          [ouest + cote, sud],
          [ouest + cote, sud + cote],
          [ouest, sud + cote],
          [ouest, sud],
        ] as Array<[number, number]>,
      ],
    };
  }

  async function importerCommunes() {
    return importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: carre(3.0, 45.8, 0.1),
          properties: {
            insee_com: '99001',
            nom_com: 'Communeentière',
            bassin: 'lb',
            classement: 'toutes sections',
          },
        },
        {
          type: 'Feature',
          geometry: carre(3.2, 45.8, 0.1),
          properties: {
            insee_com: '99002',
            nom_com: 'Communepartielle',
            bassin: 'rm',
            classement: 'quelques sections',
          },
        },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '84',
        version: '2021-maj-2025-05-12',
        sourceLabel: 'DREAL Auvergne-Rhône-Alpes',
        codeField: 'insee_com',
        labelField: 'nom_com',
      },
    );
  }

  async function parcelleDans(nom: string, ouest: number, sud: number): Promise<string> {
    const parcelle = await prisma.parcel.create({
      data: { farmId, name: nom, areaHa: 0 },
      select: { id: true },
    });
    await saveParcelGeometry(prisma, parcelle.id, carre(ouest, sud, 0.004));
    return parcelle.id;
  }

  it('classe la parcelle quand l’arrêté vise toutes les sections', async () => {
    await importerCommunes();
    const parcelleId = await parcelleDans('Dans la commune entière', 3.04, 45.84);

    const contexte = await computeParcelContext(parcelleId);

    expect(statutZonage(contexte, 'ZONE_VULNERABLE')).toBe('dedans');
    expect(zoneOf(contexte, 'ZONE_VULNERABLE')?.label).toBe('Communeentière');
    // Rien d'indéterminé : le contour communal est la zone.
    expect(
      contexte.unresolved.some((u) => u.what.includes('Zone vulnérable')),
    ).toBe(false);
  });

  it('reste indéterminé quand l’arrêté ne vise que quelques sections', async () => {
    await importerCommunes();
    const parcelleId = await parcelleDans('Dans la commune partielle', 3.24, 45.84);

    const contexte = await computeParcelContext(parcelleId);

    // La parcelle recoupe bel et bien le polygone : il est conservé, avec sa
    // surface — ce n'est pas la géométrie qu'on met en doute, c'est ce que le
    // classement dit d'elle.
    expect(zoneOf(contexte, 'ZONE_VULNERABLE')).not.toBeNull();

    // Mais on ne conclut pas.
    expect(statutZonage(contexte, 'ZONE_VULNERABLE')).toBe('indetermine');

    const dit = contexte.unresolved.find((u) => u.what.includes('Zone vulnérable'));
    expect(dit).toBeDefined();
    expect(dit?.reason).toContain('quelques sections');
    expect(dit?.reason).toContain('Communepartielle');
    // Et on dit quoi consulter pour trancher.
    expect(dit?.remedy).toContain('arrêté');
    expect(dit?.remedy).toContain('sections cadastrales');
  });

  it('conserve le bassin, qui désigne l’arrêté applicable', async () => {
    // L'Auvergne-Rhône-Alpes relève de plusieurs bassins, et chacun a son
    // arrêté de délimitation. Perdre le bassin, c'est perdre la référence du
    // texte opposable.
    await importerCommunes();
    const parcelleId = await parcelleDans('Bassin Loire-Bretagne', 3.04, 45.84);

    const contexte = await computeParcelContext(parcelleId);
    expect(zoneOf(contexte, 'ZONE_VULNERABLE')?.attributes?.bassin).toBe('lb');
  });

  /*
   * Le classement a une histoire. Les décisions du tribunal administratif du
   * 6 juin 2024 ont retiré sept communes de l'Allier de la zone vulnérable et
   * en ont réduit deux à « quelques sections ». Une parcelle de Bost était en
   * zone vulnérable en 2023, et ne l'est plus en 2025 : les deux réponses sont
   * justes, chacune à sa date.
   */
  async function importerHistorique() {
    return importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: carre(3.0, 45.8, 0.1),
          properties: {
            insee_com: '99010',
            nom_com: 'Communeretirée',
            bassin: 'lb',
            classement: 'toutes sections',
            modif2024: 'suppression',
            classements: [
              { depuis: '2021-08-30', valeur: 'toutes sections', source: 'Arrêté du 30 août 2021' },
              { depuis: '2024-06-06', valeur: 'suppression', source: 'TA du 6 juin 2024' },
            ],
          },
        },
        {
          type: 'Feature',
          geometry: carre(3.2, 45.8, 0.1),
          properties: {
            insee_com: '99011',
            nom_com: 'Communeréduite',
            bassin: 'lb',
            classement: 'toutes sections',
            modif2024: 'quelques sections',
            classements: [
              { depuis: '2021-08-30', valeur: 'toutes sections', source: 'Arrêté du 30 août 2021' },
              { depuis: '2024-06-06', valeur: 'quelques sections', source: 'TA du 6 juin 2024' },
            ],
          },
        },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '84',
        version: '2021-maj-2025-05-12',
        sourceLabel: 'DREAL Auvergne-Rhône-Alpes',
        codeField: 'insee_com',
        labelField: 'nom_com',
      },
    );
  }

  it('juge le classement à la date demandée : une commune retirée en 2024', async () => {
    await importerHistorique();
    const parcelleId = await parcelleDans('À Communeretirée', 3.04, 45.84);
    const contexte = await computeParcelContext(parcelleId);

    // 2023 : la commune était classée, toutes sections.
    expect(statutZonage(contexte, 'ZONE_VULNERABLE', new Date('2023-05-01'))).toBe('dedans');
    // 2025 : retirée par les décisions du 6 juin 2024.
    expect(statutZonage(contexte, 'ZONE_VULNERABLE', new Date('2025-03-01'))).toBe('dehors');
    // 2019 : ce zonage n'était pas encore en vigueur, et le précédent n'est pas
    // importé. On ne présume pas.
    expect(statutZonage(contexte, 'ZONE_VULNERABLE', new Date('2019-03-01'))).toBe(
      'indetermine',
    );
  });

  it('juge le classement à la date demandée : une commune réduite en 2024', async () => {
    await importerHistorique();
    const parcelleId = await parcelleDans('À Communeréduite', 3.24, 45.84);
    const contexte = await computeParcelContext(parcelleId);

    expect(statutZonage(contexte, 'ZONE_VULNERABLE', new Date('2023-05-01'))).toBe('dedans');
    expect(statutZonage(contexte, 'ZONE_VULNERABLE', new Date('2025-03-01'))).toBe(
      'indetermine',
    );
    // Et le contexte du jour le dit : « quelques sections », à vérifier.
    expect(
      contexte.unresolved.some((u) => u.reason.includes('quelques sections')),
    ).toBe(true);
  });

  it('ne met pas en doute un zonage dont la géométrie est la zone', async () => {
    // Un zonage publié en vraies zones ne porte pas de « classement » : le
    // recoupement tranche, et l'indétermination communale ne doit pas
    // contaminer les autres référentiels.
    await importZoneCollection(
      [
        {
          type: 'Feature',
          geometry: carre(3.0, 45.8, 0.1),
          properties: { nom: 'Zone tracée', code: 'ZT-1' },
        },
      ],
      {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables aux nitrates',
        kind: 'ZONE_VULNERABLE',
        territory: '84',
        version: '2026-tracee',
        sourceLabel: 'Échantillon de test',
      },
    );
    const parcelleId = await parcelleDans('Dans la zone tracée', 3.04, 45.84);

    const contexte = await computeParcelContext(parcelleId);
    expect(statutZonage(contexte, 'ZONE_VULNERABLE')).toBe('dedans');
  });
});
