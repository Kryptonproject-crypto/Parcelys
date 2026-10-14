import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import {
  cloreImport,
  ouvrirImport,
  verserTable,
} from '../src/lib/regulatory/import-staging';
import {
  computeParcelContext,
  distanceAuPlusProche,
  NATURES_HYDROGRAPHIQUES,
  NATURES_PRELEVEMENT,
  plusProches,
  referentielPortant,
} from '../src/lib/regulatory/geography';
import { saveParcelGeometry } from '../src/lib/geo/repository';

/*
 * ───────────────────────────────────────────────────────────────────────────
 * Versement des référentiels massifs, et mesure des distances
 * ───────────────────────────────────────────────────────────────────────────
 *
 * BD TOPAGE compte 402 215 tronçons en Auvergne-Rhône-Alpes : ils arrivent
 * dans PostGIS par `ogr2ogr`, dans une table intermédiaire, puis une requête
 * les verse dans `regulatory_zones`. Ces tests créent la table intermédiaire
 * eux-mêmes, en SQL : ils n'ont pas besoin de GDAL, et c'est le versement — là
 * où vivent les règles — qu'ils éprouvent.
 *
 * Ce qu'ils protègent : des lignes en 3D ramenées au plan, des points qui
 * restent des points, des entités vides comptées et non perdues en silence,
 * des zones conservées entières plutôt que découpées à la frontière, et des
 * distances mesurées contre les seules versions en vigueur.
 */

/** Un degré de latitude, en mètres — assez juste pour des écarts de quelques dizaines de mètres. */
const M_PAR_DEGRE_LAT = 111_195;

async function tableIntermediaire(nom: string, lignes: string[]) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${nom}"`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE "${nom}" (ogc_fid serial primary key, geom geometry, "CdOH" text, "TopoOH" text, "NatureTH" text, "Persistanc" text, "TronconFic" integer)`,
  );
  for (const ligne of lignes) {
    await prisma.$executeRawUnsafe(`INSERT INTO "${nom}" (geom, "CdOH", "TopoOH", "NatureTH", "Persistanc", "TronconFic") VALUES ${ligne}`);
  }
}

describe('Versement depuis une table intermédiaire', () => {
  let farmId = '';

  beforeEach(async () => {
    await resetDatabase();
    farmId = (await createUserWithFarm({ email: 'versement@parcelys.test', farmName: 'Versement' }))
      .farmId;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "stg_test_hydro"');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "stg_test_region"');
    await prisma.$disconnect();
  });

  async function parcelle(nom: string, ouest: number, sud: number, cote = 0.002) {
    const p = await prisma.parcel.create({
      data: { farmId, name: nom, areaHa: 0 },
      select: { id: true },
    });
    await saveParcelGeometry(prisma, p.id, {
      type: 'Polygon',
      coordinates: [
        [
          [ouest, sud],
          [ouest + cote, sud],
          [ouest + cote, sud + cote],
          [ouest, sud + cote],
          [ouest, sud],
        ],
      ],
    });
    return p.id;
  }

  async function verserHydro(version = '2026') {
    const session = await ouvrirImport({
      code: 'cours-eau',
      name: 'Hydrographie — BD TOPAGE',
      territory: '84',
      version,
      sourceLabel: 'IGN / OFB — BD TOPAGE',
    });
    const resultat = await verserTable(session, {
      table: 'stg_test_hydro',
      kind: 'TRONCON_HYDROGRAPHIQUE',
      champCode: 'CdOH',
      champLibelle: 'TopoOH',
      libelleParDefaut: 'Tronçon hydrographique sans nom',
      attributs: ['CdOH', 'TopoOH', 'NatureTH', 'Persistanc', 'TronconFic'],
    });
    await cloreImport(session);
    return { session, resultat };
  }

  it('ramène les lignes en 2D, garde les points, et compte les entités vides', async () => {
    await tableIntermediaire('stg_test_hydro', [
      // Ligne 3D, comme les tronçons de BD TOPAGE.
      `(ST_SetSRID('LINESTRING Z (4.0 45.0 210, 4.01 45.0 205)'::geometry, 4326), 'T1', 'Le Ruisseau', 'Ecoulement naturel', 'permanent', 0)`,
      // Un point : il doit rester un point.
      `(ST_SetSRID('POINT (4.02 45.0)'::geometry, 4326), 'P1', NULL, NULL, NULL, 0)`,
      // Vide, puis absente : ni l'une ni l'autre ne doit entrer.
      `(ST_SetSRID('LINESTRING EMPTY'::geometry, 4326), 'V1', NULL, NULL, NULL, 0)`,
      `(NULL, 'N1', NULL, NULL, NULL, 0)`,
    ]);

    const { session, resultat } = await verserHydro();

    expect(resultat.versees).toBe(2);
    expect(resultat.ecartees).toBe(2);
    expect(session.avertissements.join(' ')).toContain('2 entité(s) sans géométrie');

    const geometries = await prisma.$queryRaw<
      Array<{ code: string; type: string; dims: number; label: string; attributes: unknown }>
    >`
      SELECT code, GeometryType(geom) AS type, ST_NDims(geom) AS dims, label, attributes
      FROM regulatory_zones ORDER BY code
    `;
    const ligne = geometries.find((g) => g.code === 'T1');
    const point = geometries.find((g) => g.code === 'P1');

    expect(ligne?.type).toBe('MULTILINESTRING');
    expect(ligne?.dims).toBe(2);
    expect(ligne?.label).toBe('Le Ruisseau');
    expect(ligne?.attributes).toMatchObject({ NatureTH: 'Ecoulement naturel', Persistanc: 'permanent' });
    expect(point?.type).toBe('POINT');
    // Sans nom à la source : le libellé par défaut, jamais un nom inventé.
    expect(point?.label).toBe('Tronçon hydrographique sans nom');
  });

  it('ne double rien quand la même version est réimportée', async () => {
    await tableIntermediaire('stg_test_hydro', [
      `(ST_SetSRID('LINESTRING (4.0 45.0, 4.01 45.0)'::geometry, 4326), 'T1', 'Le Ruisseau', 'Ecoulement naturel', 'permanent', 0)`,
    ]);
    await verserHydro();
    await verserHydro();
    expect(await prisma.regulatoryZone.count()).toBe(1);
  });

  it('garde entières les zones qui franchissent la limite régionale', async () => {
    // Le contour régional ne recouvre que la moitié ouest de la zone. On ne
    // découpe pas une aire de captage à la frontière d'une administration.
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "stg_test_region"');
    await prisma.$executeRawUnsafe('CREATE TABLE "stg_test_region" (ogc_fid serial, geom geometry)');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "stg_test_region" (geom) VALUES (ST_SetSRID('POLYGON ((3.9 44.9, 4.005 44.9, 4.005 45.1, 3.9 45.1, 3.9 44.9))'::geometry, 4326))`,
    );
    await tableIntermediaire('stg_test_hydro', [
      `(ST_SetSRID('POLYGON ((4.0 44.95, 4.01 44.95, 4.01 45.05, 4.0 45.05, 4.0 44.95))'::geometry, 4326), 'A1', 'À cheval', NULL, NULL, 0)`,
      `(ST_SetSRID('POLYGON ((5.0 44.95, 5.01 44.95, 5.01 45.05, 5.0 45.05, 5.0 44.95))'::geometry, 4326), 'A2', 'Hors région', NULL, NULL, 0)`,
    ]);

    const session = await ouvrirImport({
      code: 'aires-alimentation-captage',
      name: 'AAC',
      territory: '84',
      version: '2026-09-15',
      sourceLabel: 'Essai',
    });
    const resultat = await verserTable(session, {
      table: 'stg_test_hydro',
      kind: 'AIRE_ALIMENTATION_CAPTAGE',
      champCode: 'CdOH',
      champLibelle: 'TopoOH',
      libelleParDefaut: 'AAC',
      filtreTable: 'stg_test_region',
    });
    await cloreImport(session);

    expect(resultat.versees).toBe(1);
    const [zone] = await prisma.$queryRaw<Array<{ code: string; aire_deg2: number }>>`
      SELECT code, ST_Area(geom) AS aire_deg2 FROM regulatory_zones
    `;
    expect(zone?.code).toBe('A1');
    // Surface d'origine — 0,01 × 0,1 degré — et non la moitié découpée.
    expect(Number(zone?.aire_deg2)).toBeCloseTo(0.001, 6);
  });

  it('refuse un nom de table qui ne serait pas un identifiant', async () => {
    const session = await ouvrirImport({
      code: 'cours-eau',
      name: 'Hydrographie',
      territory: '84',
      version: '2026',
      sourceLabel: 'Essai',
    });
    await expect(
      verserTable(session, {
        table: 'stg; DROP TABLE parcels; --',
        kind: 'TRONCON_HYDROGRAPHIQUE',
        libelleParDefaut: 'x',
      }),
    ).rejects.toThrow('Identifiant SQL refusé');
  });

  // -------------------------------------------------------------------------
  describe('Distances', () => {
    it('mesure la distance au plus proche écoulement, en mètres', async () => {
      // Ruisseau orienté est-ouest, 0,0003° au nord de la parcelle : ≈ 33 m.
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('LINESTRING (4.0 45.0023, 4.01 45.0023)'::geometry, 4326), 'T1', 'Le Ruisseau', 'Ecoulement naturel', 'permanent', 0)`,
      ]);
      await verserHydro();
      const id = await parcelle('Près du ruisseau', 4.004, 45.0);

      const proche = await distanceAuPlusProche(id, NATURES_HYDROGRAPHIQUES);
      expect(proche?.label).toBe('Le Ruisseau');
      expect(proche?.distanceM).toBeGreaterThan(0.0003 * M_PAR_DEGRE_LAT - 2);
      expect(proche?.distanceM).toBeLessThan(0.0003 * M_PAR_DEGRE_LAT + 2);
      expect(proche?.dedans).toBe(false);
    });

    it('écarte les tronçons fictifs, que la source marque comme tels', async () => {
      // Le fictif passe dans la parcelle ; le vrai ruisseau est à ≈ 33 m.
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('LINESTRING (4.004 45.001, 4.007 45.001)'::geometry, 4326), 'F1', 'Écoulement fictif', 'Plan d''eau - retenue', 'permanent', 1)`,
        `(ST_SetSRID('LINESTRING (4.0 45.0023, 4.01 45.0023)'::geometry, 4326), 'T1', 'Le Ruisseau', 'Ecoulement naturel', 'permanent', 0)`,
      ]);
      await verserHydro();
      const id = await parcelle('Traversée par un fictif', 4.004, 45.0);

      const proche = await distanceAuPlusProche(id, NATURES_HYDROGRAPHIQUES);
      expect(proche?.code).toBe('T1');
    });

    it('ne mesure rien contre une version remplacée', async () => {
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('LINESTRING (4.0 45.0023, 4.01 45.0023)'::geometry, 4326), 'T1', 'Ancien tracé', 'Ecoulement naturel', 'permanent', 0)`,
      ]);
      await verserHydro('2025');
      // Nouvelle version, sans ce tronçon : le ruisseau a été recalibré ailleurs.
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('LINESTRING (4.0 45.02, 4.01 45.02)'::geometry, 4326), 'T2', 'Nouveau tracé', 'Ecoulement naturel', 'permanent', 0)`,
      ]);
      await verserHydro('2026');
      const id = await parcelle('Au bord de l’ancien tracé', 4.004, 45.0);

      const proche = await distanceAuPlusProche(id, NATURES_HYDROGRAPHIQUES);
      // L'ancien tracé, à 33 m, est dans une version remplacée : on ne le voit
      // plus. Le nouveau est à plus de 2 km, hors du rayon de recherche.
      expect(proche).toBeNull();
      expect((await referentielPortant(NATURES_HYDROGRAPHIQUES))?.version).toBe('2026');
    });

    it('range les proximités à part des recoupements, dans le contexte', async () => {
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('LINESTRING (4.0 45.0023, 4.01 45.0023)'::geometry, 4326), 'T1', 'Le Ruisseau', 'Ecoulement naturel', 'intermittent', 0)`,
      ]);
      await verserHydro();
      const id = await parcelle('Contexte', 4.004, 45.0);

      const contexte = await computeParcelContext(id);
      // Un ruisseau à 33 m n'est pas un zonage : il n'a rien à faire dans
      // `zones`, où il se lirait comme une appartenance.
      expect(contexte.zones).toHaveLength(0);
      expect(contexte.proximites.map((p) => p.code)).toContain('T1');
      expect(contexte.proximites[0]?.attributes?.Persistanc).toBe('intermittent');

      // Une mare qui mord sur la parcelle : c'est une surface, elle recoupe
      // vraiment — et pourtant ce n'est pas un zonage réglementaire. Elle doit
      // figurer parmi les proximités (à 0 m, dedans), pas parmi les zones, où
      // elle se lirait comme une appartenance à un zonage.
      await tableIntermediaire('stg_test_hydro', [
        `(ST_SetSRID('POLYGON ((4.0055 45.0005, 4.0075 45.0005, 4.0075 45.0015, 4.0055 45.0015, 4.0055 45.0005))'::geometry, 4326), 'M1', 'La Mare', 'Plan d''eau - mare', 'permanent', 0)`,
      ]);
      const sessionMare = await ouvrirImport({
        code: 'cours-eau',
        name: 'Hydrographie — BD TOPAGE',
        territory: '84',
        version: '2026',
        sourceLabel: 'IGN / OFB — BD TOPAGE',
      });
      await verserTable(sessionMare, {
        table: 'stg_test_hydro',
        kind: 'SURFACE_HYDROGRAPHIQUE',
        champCode: 'CdOH',
        champLibelle: 'TopoOH',
        libelleParDefaut: 'Surface en eau',
      });
      await cloreImport(sessionMare);

      const avecMare = await computeParcelContext(id);
      expect(avecMare.zones).toHaveLength(0);
      const mare = avecMare.proximites.find((p) => p.code === 'M1');
      expect(mare?.dedans).toBe(true);
      expect(mare?.distanceM).toBe(0);

      // Aucun prélèvement importé : dit, et non tu.
      expect(await plusProches(id, NATURES_PRELEVEMENT)).toEqual([]);
      expect(
        contexte.unresolved.some((u) => u.what === 'Points et ouvrages de prélèvement'),
      ).toBe(true);
    });
  });
});
