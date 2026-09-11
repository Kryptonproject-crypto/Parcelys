import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase, createUserWithFarm, testPolygon } from './helpers/db';
import { LAMBERT_93_PRJ, writeShapefile, type WriteField } from '../src/lib/pac/shapefile';
import { readDossier } from '../src/lib/pac/dossier';
import { analyzeDossier } from '../src/lib/pac/analyze';
import { applyImport, restoreSnapshot } from '../src/lib/pac/apply';

/**
 * Deux exploitations sur la même base : ce qui appartient à l'une, et ce que
 * l'autre ne doit ni voir ni pouvoir écrire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `tests/security-isolation.test.ts` couvre les parcelles, les registres et les
 * documents. Les modèles PAC sont arrivés après, et n'y figuraient pas — c'est
 * précisément là qu'une faille s'était logée.
 *
 * Elle a été constatée sur la base, pas déduite : un import lancé depuis
 * l'exploitation A, avec l'identifiant d'une parcelle de l'exploitation B dans
 * les décisions, réécrivait cette parcelle — type, code INSEE, `pacId`,
 * superficie (12,3456 ha devenus 2,6702), plus une géométrie et une culture
 * créées chez le voisin. `decisions[].parcelId` vient du navigateur, et
 * `tx.parcel.update({ where: { id } })` ne regarde pas à qui la parcelle
 * appartient.
 *
 * Le premier essai ci-dessous rejoue exactement cette attaque. Les suivants
 * couvrent le reste du domaine PAC — sauvegardes, campagnes — pour que la
 * prochaine faille du même genre ne passe pas par une porte voisine.
 */

const CHAMPS: WriteField[] = [
  { name: 'NUM_PARCEL', type: 'C', length: 20 },
  { name: 'NUM_ILOT', type: 'C', length: 10 },
  { name: 'CODE_CULTU', type: 'C', length: 6 },
  { name: 'SURF_PARC', type: 'N', length: 12, decimals: 4 },
];

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
  annee: number,
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
    { name: `PARCELLES_${annee}.shp`, buffer: shp.shp },
    { name: `PARCELLES_${annee}.shx`, buffer: shp.shx },
    { name: `PARCELLES_${annee}.dbf`, buffer: shp.dbf },
    { name: `PARCELLES_${annee}.prj`, buffer: Buffer.from(shp.prj) },
  ];
}

const PARCELLES_A = [
  { num: '1', ilot: '10', culture: 'AAA', x: 600_000, y: 6_800_000, cote: 300 },
  { num: '2', ilot: '10', culture: 'BBB', x: 600_400, y: 6_800_000, cote: 300 },
];

describe('Cloisonnement du domaine PAC', () => {
  let a: Awaited<ReturnType<typeof createUserWithFarm>>;
  let b: Awaited<ReturnType<typeof createUserWithFarm>>;

  beforeEach(async () => {
    await resetDatabase();
    a = await createUserWithFarm({ email: 'a@ferme.test', farmName: 'Exploitation A' });
    b = await createUserWithFarm({ email: 'b@ferme.test', farmName: 'Exploitation B' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function analyser(farmId: string, annee: number, parcelles: typeof PARCELLES_A) {
    const dossier = await readDossier(dossierPac(annee, parcelles), annee);
    return {
      dossier,
      analyse: await analyzeDossier({
        farmId,
        year: annee,
        layers: dossier.layers,
        ignoredFiles: dossier.ignored,
        problems: dossier.problems,
      }),
    };
  }

  async function importer(
    farmId: string,
    userId: string,
    annee: number,
    parcelles: typeof PARCELLES_A,
    decisions: Parameters<typeof applyImport>[0]['decisions'] = [],
  ) {
    const { dossier, analyse } = await analyser(farmId, annee, parcelles);
    return applyImport({
      farmId,
      year: annee,
      userId,
      features: analyse.features,
      decisions,
      sourceFiles: dossier.layers.map((l) => l.name),
      detectedSrid: analyse.layers[0]?.srid ?? null,
      sridLabel: analyse.layers[0]?.sridLabel ?? '',
      ilotLayers: analyse.layers.filter((l) => l.isIlotLayer).map((l) => l.name),
    });
  }

  // -------------------------------------------------------------------------
  describe('Une exploitation ne peut pas écrire dans le parcellaire d’une autre', () => {
    it('refuse un import qui vise la parcelle d’une autre exploitation', async () => {
      // La parcelle du voisin, avec des valeurs reconnaissables.
      const victime = await prisma.parcel.create({
        data: {
          farmId: b.farmId,
          name: 'La parcelle du voisin',
          commune: 'Commune du voisin',
          inseeCode: '99999',
          internalNumber: 'VOISIN-1',
          areaHa: 12.3456,
        },
        select: { id: true },
      });

      const { analyse } = await analyser(a.farmId, 2026, PARCELLES_A);
      const cible = analyse.features.find((f) => f.kind === 'PARCELLE');
      expect(cible).toBeDefined();

      await expect(
        importer(a.farmId, a.id, 2026, PARCELLES_A, [
          {
            layer: cible!.layer,
            index: cible!.index,
            decision: 'update',
            parcelId: victime.id,
          },
        ]),
      ).rejects.toMatchObject({ status: 404 });

      // Et rien n'a bougé chez le voisin.
      const apres = await prisma.parcel.findUniqueOrThrow({
        where: { id: victime.id },
        select: {
          farmId: true,
          inseeCode: true,
          parcelType: true,
          pacId: true,
          areaHa: true,
        },
      });
      expect({
        farmId: apres.farmId,
        inseeCode: apres.inseeCode,
        parcelType: apres.parcelType,
        pacId: apres.pacId,
        areaHa: Number(apres.areaHa),
      }).toEqual({
        farmId: b.farmId,
        inseeCode: '99999',
        parcelType: null,
        pacId: null,
        areaHa: 12.3456,
      });
      expect(await prisma.parcelGeometry.count({ where: { parcelId: victime.id } })).toBe(0);
      expect(await prisma.cropYear.count({ where: { parcelId: victime.id } })).toBe(0);
    });

    it('refuse de rétablir la sauvegarde d’une autre exploitation', async () => {
      await importer(b.farmId, b.id, 2026, PARCELLES_A);
      const sauvegarde = await prisma.pacSnapshot.findFirstOrThrow({
        where: { campaign: { farmId: b.farmId } },
        select: { id: true },
      });

      await expect(
        restoreSnapshot({ farmId: a.farmId, snapshotId: sauvegarde.id, userId: a.id }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('Chaque exploitation a ses propres campagnes', () => {
    it('n’a pas d’îlot, d’entité ni de sauvegarde de sa voisine', async () => {
      await importer(a.farmId, a.id, 2026, PARCELLES_A);

      for (const modele of ['pacCampaign', 'pacIlot', 'pacFeature', 'pacSnapshot'] as const) {
        const chezB =
          modele === 'pacCampaign'
            ? await prisma.pacCampaign.count({ where: { farmId: b.farmId } })
            : modele === 'pacIlot'
              ? await prisma.pacIlot.count({ where: { campaign: { farmId: b.farmId } } })
              : modele === 'pacFeature'
                ? await prisma.pacFeature.count({ where: { campaign: { farmId: b.farmId } } })
                : await prisma.pacSnapshot.count({ where: { campaign: { farmId: b.farmId } } });
        expect({ modele, chezB }).toEqual({ modele, chezB: 0 });
      }

      // Et l'exploitation A, elle, a bien reçu son dossier.
      expect(await prisma.pacCampaign.count({ where: { farmId: a.farmId } })).toBe(1);
      expect(
        await prisma.pacFeature.count({ where: { campaign: { farmId: a.farmId } } }),
      ).toBe(PARCELLES_A.length);
    });

    it('deux exploitations peuvent porter la même campagne sans se mélanger', async () => {
      await importer(a.farmId, a.id, 2026, PARCELLES_A);
      await importer(b.farmId, b.id, 2026, PARCELLES_A);

      const campagnes = await prisma.pacCampaign.findMany({
        where: { year: 2026 },
        select: { id: true, farmId: true },
      });
      expect(campagnes).toHaveLength(2);
      expect(new Set(campagnes.map((c) => c.farmId))).toEqual(new Set([a.farmId, b.farmId]));

      // Les mêmes numéros d'îlot des deux côtés, et deux îlots distincts :
      // la clé d'unicité porte sur la campagne, pas sur le numéro seul.
      const ilots = await prisma.pacIlot.findMany({
        where: { numero: '10' },
        select: { id: true, campaignId: true },
      });
      expect(ilots).toHaveLength(2);
      expect(new Set(ilots.map((i) => i.campaignId)).size).toBe(2);

      // Aucune parcelle d'une exploitation n'est rattachée à la campagne de l'autre.
      const croisees = await prisma.pacFeature.count({
        where: {
          campaign: { farmId: a.farmId },
          parcel: { farmId: b.farmId },
        },
      });
      expect(croisees).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Chaque campagne est indépendante des autres', () => {
    it('importer une campagne ne touche pas aux entités des précédentes', async () => {
      await importer(a.farmId, a.id, 2025, PARCELLES_A);
      const avant = await prisma.pacFeature.findMany({
        where: { campaign: { farmId: a.farmId, year: 2025 } },
        select: { id: true, numero: true, cropCode: true },
        orderBy: { numero: 'asc' },
      });
      expect(avant).toHaveLength(2);

      // Campagne suivante, avec des cultures différentes : une rotation.
      await importer(
        a.farmId,
        a.id,
        2026,
        PARCELLES_A.map((p) => ({ ...p, culture: `${p.culture}2` })),
      );

      const apres = await prisma.pacFeature.findMany({
        where: { campaign: { farmId: a.farmId, year: 2025 } },
        select: { id: true, numero: true, cropCode: true },
        orderBy: { numero: 'asc' },
      });
      expect(apres).toEqual(avant);

      // Les deux campagnes coexistent, chacune avec ses entités.
      const parAnnee = await prisma.pacCampaign.findMany({
        where: { farmId: a.farmId },
        select: { year: true, _count: { select: { features: true, ilots: true } } },
        orderBy: { year: 'asc' },
      });
      expect(parAnnee.map((c) => [c.year, c._count.features, c._count.ilots])).toEqual([
        [2025, 2, 1],
        [2026, 2, 1],
      ]);
    });

    it('les cultures déclarées se rangent chacune dans sa campagne', async () => {
      await importer(a.farmId, a.id, 2025, PARCELLES_A);
      await importer(
        a.farmId,
        a.id,
        2026,
        PARCELLES_A.map((p) => ({ ...p, culture: `${p.culture}2` })),
      );

      const cultures = await prisma.cropYear.findMany({
        where: { parcel: { farmId: a.farmId } },
        select: { campaignYear: true, crop: { select: { code: true } } },
        orderBy: [{ campaignYear: 'asc' }, { crop: { code: 'asc' } }],
      });

      expect(
        cultures.map((c) => `${c.campaignYear}:${c.crop.code}`),
      ).toEqual(['2025:AAA', '2025:BBB', '2026:AAA2', '2026:BBB2']);
    });

    it('ne crée pas de parcelle en double d’une campagne à l’autre', async () => {
      const premier = await importer(a.farmId, a.id, 2025, PARCELLES_A);
      expect(premier.created).toBe(2);

      const second = await importer(a.farmId, a.id, 2026, PARCELLES_A);
      expect({ created: second.created, updated: second.updated }).toEqual({
        created: 0,
        updated: 2,
      });

      expect(
        await prisma.parcel.count({ where: { farmId: a.farmId, deletedAt: null } }),
      ).toBe(2);
    });

    it('reconnaît une parcelle redessinée grâce à son numéro, pas à son contour', async () => {
      /*
       * Le cas pour lequel le rapprochement par identité existe.
       *
       * Un contour TéléPAC bouge d'une campagne à l'autre : une limite
       * corrigée, une parcelle redécoupée. Le rapprochement par recouvrement
       * exige 30 % de Jaccard ; au-delà, il ne reconnaît plus rien et l'import
       * crée une seconde parcelle. C'est ce qui avait produit huit doublons
       * sur le parcellaire réel de l'exploitation.
       *
       * Ici le contour est déplacé de 200 m sur un carré de 300 : le
       * recouvrement tombe à 20 %, sous le seuil. Seule l'identité déclarée —
       * îlot 10, parcelle 1 — permet encore de savoir qu'il s'agit de la même.
       *
       * Une version antérieure de cet essai gardait le même contour d'une
       * campagne à l'autre : il passait par le recouvrement et restait vert
       * même en débranchant le rapprochement par identité. Il ne vérifiait
       * donc pas ce qu'il annonçait.
       */
      await importer(a.farmId, a.id, 2025, PARCELLES_A);

      const deplacees = PARCELLES_A.map((p) => ({ ...p, x: p.x + 200 }));
      const { analyse } = await analyser(a.farmId, 2026, deplacees);

      const rapproche = analyse.features.filter((f) => f.match !== null);
      expect(rapproche).toHaveLength(2);
      for (const feature of rapproche) {
        expect({
          numero: feature.numero,
          motif: feature.match?.reason ?? '',
        }).toEqual({
          numero: feature.numero,
          motif: 'Déjà importée sous ce numéro d’îlot et de parcelle.',
        });
      }

      const resultat = await importer(a.farmId, a.id, 2026, deplacees);
      expect({ created: resultat.created, updated: resultat.updated }).toEqual({
        created: 0,
        updated: 2,
      });
      expect(
        await prisma.parcel.count({ where: { farmId: a.farmId, deletedAt: null } }),
      ).toBe(2);
    });

    it('réimporter la même campagne ne double ni les parcelles ni les entités', async () => {
      await importer(a.farmId, a.id, 2026, PARCELLES_A);
      const apresPremier = {
        parcelles: await prisma.parcel.count({ where: { farmId: a.farmId, deletedAt: null } }),
        entites: await prisma.pacFeature.count({ where: { campaign: { farmId: a.farmId } } }),
        ilots: await prisma.pacIlot.count({ where: { campaign: { farmId: a.farmId } } }),
      };

      await importer(a.farmId, a.id, 2026, PARCELLES_A);
      const apresSecond = {
        parcelles: await prisma.parcel.count({ where: { farmId: a.farmId, deletedAt: null } }),
        entites: await prisma.pacFeature.count({ where: { campaign: { farmId: a.farmId } } }),
        ilots: await prisma.pacIlot.count({ where: { campaign: { farmId: a.farmId } } }),
      };

      expect(apresSecond).toEqual(apresPremier);
    });
  });

  // -------------------------------------------------------------------------
  describe('Les hectares viennent de la géométrie, et concordent avec la déclaration', () => {
    it('la superficie de la parcelle est celle que PostGIS mesure', async () => {
      await importer(a.farmId, a.id, 2026, PARCELLES_A);

      const lignes = await prisma.$queryRaw<
        Array<{ nom: string; parcelle: number; geometrie: number }>
      >`
        SELECT p.name AS nom,
               p.area_ha::float8 AS parcelle,
               (ST_Area(pg.geom::geography) / 10000.0)::float8 AS geometrie
        FROM parcels p
        JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
        WHERE p.farm_id = ${a.farmId} AND p.deleted_at IS NULL
      `;

      expect(lignes).toHaveLength(2);
      for (const ligne of lignes) {
        // La colonne `area_ha` est dénormalisée : elle doit rester la copie
        // exacte de ce que mesure la géométrie courante, à l'arrondi près
        // (quatre décimales, soit un mètre carré).
        expect({
          nom: ligne.nom,
          ecart: Math.abs(ligne.parcelle - ligne.geometrie) < 0.0001,
        }).toEqual({ nom: ligne.nom, ecart: true });
      }
    });

    it('la superficie mesurée retrouve celle que le dossier déclare', async () => {
      await importer(a.farmId, a.id, 2026, PARCELLES_A);

      // Chaque carré fait 300 m de côté, soit 9 ha exactement en projection
      // Lambert-93. La mesure passe par l'ellipsoïde (`geography`), ce qui
      // introduit un écart réel de quelques pour mille — pas une erreur, une
      // différence de référentiel. Un demi-pour-cent laisse voir une vraie
      // dérive sans se déclencher sur celle-là.
      const parcelles = await prisma.parcel.findMany({
        where: { farmId: a.farmId, deletedAt: null },
        select: { name: true, areaHa: true },
      });

      for (const parcelle of parcelles) {
        const ecart = Math.abs(Number(parcelle.areaHa) - 9) / 9;
        expect({ nom: parcelle.name, dansLaTolerance: ecart < 0.005 }).toEqual({
          nom: parcelle.name,
          dansLaTolerance: true,
        });
      }
    });

    it('une parcelle saisie à la main n’est pas emportée par un import PAC', async () => {
      // Kevin a des parcelles hors PAC ; un import ne doit ni les supprimer,
      // ni recalculer leur surface.
      const horsPac = await prisma.parcel.create({
        data: { farmId: a.farmId, name: 'Le Jardin', areaHa: 0.42 },
        select: { id: true },
      });

      const resultat = await importer(a.farmId, a.id, 2026, PARCELLES_A);

      const apres = await prisma.parcel.findUniqueOrThrow({
        where: { id: horsPac.id },
        select: { name: true, areaHa: true, deletedAt: true, parcelType: true },
      });
      expect({
        name: apres.name,
        areaHa: Number(apres.areaHa),
        supprimee: apres.deletedAt !== null,
        parcelType: apres.parcelType,
      }).toEqual({ name: 'Le Jardin', areaHa: 0.42, supprimee: false, parcelType: null });

      // Elle est signalée comme absente du dossier, pas effacée.
      expect(resultat.orphans.map((o) => o.name)).toContain('Le Jardin');
    });
  });
});
