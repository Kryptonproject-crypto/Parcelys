import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { importZoneCollection } from '../src/lib/regulatory/import-zones';
import {
  computeParcelContext,
  computeZoneIntersections,
  getParcelContext,
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
