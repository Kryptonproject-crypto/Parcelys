import { describe, expect, it } from 'vitest';
import * as independant from 'shapefile';
import {
  LAMBERT_93_PRJ,
  ShapefileError,
  detectSrid,
  readShapefile,
  writeShapefile,
  type WriteField,
} from '../src/lib/pac/shapefile';

/**
 * Conformité du Shapefile.
 *
 * Écrire un fichier que seul notre propre lecteur sait relire ne prouverait
 * rien : deux erreurs symétriques se compensent. On relit donc avec le paquet
 * « shapefile », implémentation indépendante de la même spécification ESRI.
 * S'il retrouve nos géométries et nos attributs, c'est que le fichier est
 * conforme — et qu'un autre logiciel, TéléPAC compris, saura le lire.
 *
 * Les coordonnées employées ici sont en Lambert-93, dans la plage réelle de la
 * métropole (x ≈ 650 km, y ≈ 6 860 km), pour que les erreurs de projection se
 * voient au lieu de passer pour du bruit.
 */

/** Un carré de 200 m de côté, quelque part en Beauce. */
function carre(x0: number, y0: number, cote = 200): Array<[number, number]> {
  return [
    [x0, y0],
    [x0 + cote, y0],
    [x0 + cote, y0 + cote],
    [x0, y0 + cote],
    [x0, y0],
  ];
}

const CHAMPS: WriteField[] = [
  { name: 'NUM_PARCEL', type: 'C', length: 20 },
  { name: 'ILOT', type: 'C', length: 10 },
  { name: 'CODE_CULTU', type: 'C', length: 6 },
  { name: 'SURF_HA', type: 'N', length: 12, decimals: 4 },
];

describe('Shapefile PAC', () => {
  it('écrit un jeu que relit une implémentation indépendante', async () => {
    const ecrit = writeShapefile(
      [
        {
          rings: [carre(650000, 6860000)],
          attributes: { NUM_PARCEL: '17', ILOT: '3', CODE_CULTU: 'BTH', SURF_HA: 4 },
        },
        {
          rings: [carre(651000, 6861000, 300)],
          attributes: { NUM_PARCEL: '18', ILOT: '3', CODE_CULTU: 'MIS', SURF_HA: 9 },
        },
      ],
      CHAMPS,
      LAMBERT_93_PRJ,
    );

    const collection = await independant.read(ecrit.shp, ecrit.dbf);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.geometry.type).toBe('Polygon');

    // Les attributs doivent survivre au passage par le .dbf.
    expect(collection.features[0]?.properties?.NUM_PARCEL).toBe('17');
    expect(collection.features[0]?.properties?.CODE_CULTU).toBe('BTH');
    expect(collection.features[1]?.properties?.ILOT).toBe('3');
    expect(Number(collection.features[1]?.properties?.SURF_HA)).toBe(9);

    // Et les coordonnées doivent être exactement celles écrites : un Shapefile
    // stocke des doubles, il n'y a aucune raison de perdre de la précision.
    const geom = collection.features[0]?.geometry;
    const premierPoint =
      geom && geom.type === 'Polygon' ? geom.coordinates[0]?.[0] : undefined;
    expect(premierPoint?.[0]).toBe(650000);
    expect(premierPoint?.[1]).toBe(6860000);
  });

  it('se relit lui-même à l’identique (aller-retour complet)', () => {
    const attendus = [
      { rings: [carre(650000, 6860000)], attributes: { NUM_PARCEL: '17', ILOT: '3', CODE_CULTU: 'BTH', SURF_HA: 4 } },
      { rings: [carre(652000, 6862000, 500)], attributes: { NUM_PARCEL: '21', ILOT: '4', CODE_CULTU: 'TRN', SURF_HA: 25 } },
    ];
    const ecrit = writeShapefile(attendus, CHAMPS, LAMBERT_93_PRJ);

    const relu = readShapefile({
      shp: ecrit.shp,
      shx: ecrit.shx,
      dbf: ecrit.dbf,
      prj: ecrit.prj,
    });

    expect(relu.warnings).toHaveLength(0);
    expect(relu.features).toHaveLength(2);
    expect(relu.fields).toEqual(['NUM_PARCEL', 'ILOT', 'CODE_CULTU', 'SURF_HA']);
    expect(relu.features[1]?.attributes.NUM_PARCEL).toBe('21');
    expect(relu.features[1]?.attributes.SURF_HA).toBe(25);
    expect(relu.features[0]?.rings[0]).toHaveLength(5);
  });

  it('respecte l’orientation des anneaux voulue par la spécification', async () => {
    // Un carré avec un trou. L'extérieur doit ressortir en sens horaire et le
    // trou en sens antihoraire, quel que soit l'ordre fourni.
    const exterieur = carre(650000, 6860000, 1000);
    const trou = carre(650400, 6860400, 200);

    const ecrit = writeShapefile(
      [{ rings: [exterieur, trou], attributes: { NUM_PARCEL: '30', ILOT: '5', CODE_CULTU: 'BTH', SURF_HA: 96 } }],
      CHAMPS,
      LAMBERT_93_PRJ,
    );

    const collection = await independant.read(ecrit.shp, ecrit.dbf);
    const geom = collection.features[0]?.geometry;
    expect(geom?.type).toBe('Polygon');
    // Un lecteur conforme reconnaît deux anneaux : le contour et son trou.
    if (geom?.type === 'Polygon') expect(geom.coordinates).toHaveLength(2);
  });

  it('refuse un .shp dont le .dbf ne vient pas du même export', () => {
    const a = writeShapefile(
      [{ rings: [carre(650000, 6860000)], attributes: { NUM_PARCEL: '1', ILOT: '1', CODE_CULTU: 'BTH', SURF_HA: 4 } }],
      CHAMPS,
      LAMBERT_93_PRJ,
    );
    const b = writeShapefile(
      [
        { rings: [carre(650000, 6860000)], attributes: { NUM_PARCEL: '1', ILOT: '1', CODE_CULTU: 'BTH', SURF_HA: 4 } },
        { rings: [carre(651000, 6861000)], attributes: { NUM_PARCEL: '2', ILOT: '1', CODE_CULTU: 'MIS', SURF_HA: 4 } },
      ],
      CHAMPS,
      LAMBERT_93_PRJ,
    );

    expect(() => readShapefile({ shp: a.shp, dbf: b.dbf, prj: a.prj })).toThrow(ShapefileError);
  });

  it('signale un jeu incomplet plutôt que de faire comme si de rien n’était', () => {
    const ecrit = writeShapefile(
      [{ rings: [carre(650000, 6860000)], attributes: { NUM_PARCEL: '1', ILOT: '1', CODE_CULTU: 'BTH', SURF_HA: 4 } }],
      CHAMPS,
      LAMBERT_93_PRJ,
    );

    // Sans .shx ni .prj : les géométries restent lisibles, mais on prévient.
    const relu = readShapefile({ shp: ecrit.shp, dbf: ecrit.dbf });
    expect(relu.features).toHaveLength(1);
    expect(relu.warnings.some((w) => w.includes('.shx'))).toBe(true);
    expect(relu.warnings.some((w) => w.includes('.prj'))).toBe(true);
  });

  it('rejette un fichier qui n’est pas un .shp', () => {
    const faux = Buffer.alloc(200);
    faux.write('Ceci est une archive ZIP renommée', 0);
    expect(() => readShapefile({ shp: faux, dbf: Buffer.alloc(64) })).toThrow(/signature/);
  });

  it('rejette un .shp tronqué au lieu de rendre des géométries partielles', () => {
    const ecrit = writeShapefile(
      [{ rings: [carre(650000, 6860000)], attributes: { NUM_PARCEL: '1', ILOT: '1', CODE_CULTU: 'BTH', SURF_HA: 4 } }],
      CHAMPS,
      LAMBERT_93_PRJ,
    );
    const tronque = ecrit.shp.subarray(0, ecrit.shp.length - 40);
    expect(() => readShapefile({ shp: tronque, dbf: ecrit.dbf })).toThrow(/tronqué/);
  });

  describe('Système de coordonnées', () => {
    it('reconnaît le Lambert-93 que nous écrivons', () => {
      expect(detectSrid(LAMBERT_93_PRJ)).toEqual({
        srid: 2154,
        label: 'Lambert-93 (EPSG:2154)',
      });
    });

    it('reconnaît le Lambert-93 sans code EPSG explicite', () => {
      const wkt = 'PROJCS["RGF93_Lambert_93",GEOGCS["GCS_RGF_1993",DATUM["D_RGF_1993"]]]';
      expect(detectSrid(wkt).srid).toBe(2154);
    });

    it('reconnaît le WGS 84', () => {
      expect(detectSrid('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]').srid).toBe(4326);
    });

    it('n’invente rien quand le système est inconnu', () => {
      // Un système non reconnu doit rendre « null » : convertir au jugé
      // déplacerait le parcellaire de plusieurs centaines de mètres sans que
      // personne ne s'en aperçoive.
      expect(detectSrid('PROJCS["Un_Systeme_Exotique"]').srid).toBeNull();
      expect(detectSrid(undefined)).toEqual({ srid: null, label: 'aucun fichier .prj' });
    });
  });
});
