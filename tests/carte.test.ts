import { describe, expect, it } from 'vitest';
import {
  ajusterAuCadre,
  anneauxDeGeometrie,
  barreDEchelle,
  cadreDUnPoint,
  cadreDesGeometries,
  centreDuCadre,
  centroideSurfacique,
  creerProjection,
  METRES_PAR_DEGRE_LAT,
  unionCadres,
  zoomer,
  deplacer,
  etiquetteAjustee,
} from '@/lib/shared/carte';

/*
 * ───────────────────────────────────────────────────────────────────────────
 * La carte du parcellaire, côté calcul
 * ───────────────────────────────────────────────────────────────────────────
 *
 * L'écran de l'application ne se teste pas depuis la racine du dépôt ; ses
 * maths, si. Et ce sont elles qui décident si l'exploitant reconnaît ses
 * pièces : une projection fausse dessine des parcelles justes en apparence et
 * méconnaissables sur le terrain.
 *
 * On vérifie donc les propriétés, pas des valeurs recopiées du code : le cadre
 * contient tout, le nord est en haut, un carré reste un carré, l'aller-retour
 * écran → terrain retombe sur ses pieds.
 */

/** Un carré de `coteM` mètres de côté, centré sur un point. */
function carreAutour(
  centre: { lat: number; lng: number },
  coteM: number,
): { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } {
  const demiLat = coteM / 2 / METRES_PAR_DEGRE_LAT;
  const demiLng = demiLat / Math.cos((centre.lat * Math.PI) / 180);
  const o = centre.lng - demiLng;
  const e = centre.lng + demiLng;
  const s = centre.lat - demiLat;
  const n = centre.lat + demiLat;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [o, s],
        [e, s],
        [e, n],
        [o, n],
        [o, s],
      ],
    ],
  };
}

const SAUVATTE = { lat: 48.12, lng: 1.93 };

describe('Carte du parcellaire', () => {
  // -------------------------------------------------------------------------
  describe('Lecture des géométries', () => {
    it('sépare le contour de ses trous', () => {
      const anneaux = anneauxDeGeometrie({
        type: 'Polygon',
        coordinates: [
          [
            [1, 48],
            [2, 48],
            [2, 49],
            [1, 48],
          ],
          [
            [1.4, 48.2],
            [1.6, 48.2],
            [1.5, 48.4],
            [1.4, 48.2],
          ],
        ],
      });

      expect(anneaux).toHaveLength(1);
      expect(anneaux[0]?.contour).toHaveLength(4);
      // Un bosquet au milieu d'une parcelle n'est pas de la parcelle. Fondre
      // le trou dans le contour gonflerait la surface affichée.
      expect(anneaux[0]?.trous).toHaveLength(1);
    });

    it('lit un MultiPolygon comme plusieurs polygones', () => {
      const anneaux = anneauxDeGeometrie({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [1, 48],
              [2, 48],
              [2, 49],
              [1, 48],
            ],
          ],
          [
            [
              [3, 48],
              [4, 48],
              [4, 49],
              [3, 48],
            ],
          ],
        ],
      });
      expect(anneaux).toHaveLength(2);
    });

    it('écarte ce qui n’est pas une géométrie exploitable', () => {
      // Une parcelle sans contour relevé, ou un enregistrement abîmé, ne doit
      // pas faire tomber la carte entière : elle s'affiche sans, et la liste
      // de l'écran dit qu'elle n'a pas de contour.
      expect(anneauxDeGeometrie(null)).toEqual([]);
      expect(anneauxDeGeometrie(undefined)).toEqual([]);
      expect(anneauxDeGeometrie({ type: 'Polygon', coordinates: 'oups' })).toEqual([]);
      expect(
        anneauxDeGeometrie({ type: 'Polygon', coordinates: [[['a', 'b']]] }),
      ).toEqual([]);
      expect(
        anneauxDeGeometrie({ type: 'Polygon', coordinates: [[[1, Number.NaN]]] }),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('Emprise', () => {
    it('englobe toutes les parcelles, trous compris', () => {
      const cadre = cadreDesGeometries([
        carreAutour(SAUVATTE, 200),
        carreAutour({ lat: 48.14, lng: 1.95 }, 200),
        null,
      ]);

      expect(cadre).not.toBeNull();
      expect(cadre!.sud).toBeLessThan(SAUVATTE.lat);
      expect(cadre!.nord).toBeGreaterThan(48.14);
      expect(cadre!.ouest).toBeLessThan(SAUVATTE.lng);
      expect(cadre!.est).toBeGreaterThan(1.95);
    });

    it('rend null quand aucun contour n’est exploitable', () => {
      // Distinct d'un cadre plat : une carte sans aucun contour ne se cadre
      // pas, elle s'annonce. Confondre les deux afficherait un fond vide sans
      // expliquer pourquoi.
      expect(cadreDesGeometries([null, undefined])).toBeNull();
      expect(cadreDesGeometries([])).toBeNull();
    });

    it('réunit deux cadres et supporte les absents', () => {
      const a = { sud: 48, ouest: 1, nord: 48.1, est: 1.1 };
      const b = cadreDUnPoint({ lat: 47.9, lng: 1.2 });

      expect(unionCadres(a, b)).toEqual({
        sud: 47.9,
        ouest: 1,
        nord: 48.1,
        est: 1.2,
      });
      expect(unionCadres(null, b)).toEqual(b);
      expect(unionCadres(a, null)).toEqual(a);
      expect(unionCadres(null, null)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('Projection', () => {
    const vue = { largeur: 320, hauteur: 440 };

    it('place le centre de la vue au centre géographique', () => {
      const projection = creerProjection({ centre: SAUVATTE, spanLat: 0.01, vue });
      const { x, y } = projection.versVue(SAUVATTE);
      expect(x).toBeCloseTo(160, 6);
      expect(y).toBeCloseTo(220, 6);
    });

    it('met le nord en haut', () => {
      const projection = creerProjection({ centre: SAUVATTE, spanLat: 0.01, vue });
      const nord = projection.versVue({ lat: SAUVATTE.lat + 0.001, lng: SAUVATTE.lng });
      const sud = projection.versVue({ lat: SAUVATTE.lat - 0.001, lng: SAUVATTE.lng });

      // L'axe des ordonnées descend à l'écran : inverser la latitude est
      // nécessaire, et c'est exactement l'erreur qu'on ne verrait pas sur une
      // parcelle presque carrée.
      expect(nord.y).toBeLessThan(sud.y);

      const est = projection.versVue({ lat: SAUVATTE.lat, lng: SAUVATTE.lng + 0.001 });
      expect(est.x).toBeGreaterThan(160);
    });

    it('rend un carré du terrain comme un carré à l’écran', () => {
      const projection = creerProjection({ centre: SAUVATTE, spanLat: 0.004, vue });
      const anneaux = anneauxDeGeometrie(carreAutour(SAUVATTE, 100));
      const sommets = (anneaux[0]?.contour ?? []).map(([lng, lat]) =>
        projection.versVue({ lat, lng }),
      );

      const largeurEcran = Math.max(...sommets.map((p) => p.x)) -
        Math.min(...sommets.map((p) => p.x));
      const hauteurEcran = Math.max(...sommets.map((p) => p.y)) -
        Math.min(...sommets.map((p) => p.y));

      // Sans la correction par le cosinus de la latitude, ce rapport vaudrait
      // environ 0,67 à nos latitudes : une parcelle carrée paraîtrait deux
      // fois plus large que longue, et on ne reconnaîtrait pas ses pièces.
      expect(hauteurEcran / largeurEcran).toBeCloseTo(1, 3);
    });

    it('retombe sur ses pieds en sens inverse', () => {
      const projection = creerProjection({ centre: SAUVATTE, spanLat: 0.01, vue });
      // C'est ce chemin-là qui dit quelle parcelle le doigt a touchée : une
      // erreur ici ouvre la voisine.
      for (const point of [
        SAUVATTE,
        { lat: 48.125, lng: 1.9345 },
        { lat: 48.1111, lng: 1.9222 },
      ]) {
        const { x, y } = projection.versVue(point);
        const retour = projection.versGeo(x, y);
        expect(retour.lat).toBeCloseTo(point.lat, 9);
        expect(retour.lng).toBeCloseTo(point.lng, 9);
      }
    });

    it('annonce une échelle métrique juste', () => {
      const projection = creerProjection({ centre: SAUVATTE, spanLat: 0.01, vue });
      // 0,01° de latitude sur 440 unités de haut.
      const attendu = (0.01 * METRES_PAR_DEGRE_LAT) / 440;
      expect(projection.metresParUnite).toBeCloseTo(attendu, 9);

      // Et de fait : 100 m de côté doivent occuper 100 / metresParUnite unités.
      const cote = projection.versVue({
        lat: SAUVATTE.lat + 100 / METRES_PAR_DEGRE_LAT,
        lng: SAUVATTE.lng,
      });
      expect(220 - cote.y).toBeCloseTo(100 / projection.metresParUnite, 6);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cadrage', () => {
    const dansLaVue = (
      cadre: { sud: number; ouest: number; nord: number; est: number },
      vue: { largeur: number; hauteur: number },
    ): boolean => {
      const { centre, spanLat } = ajusterAuCadre(cadre, vue);
      const projection = creerProjection({ centre, spanLat, vue });
      const coins = [
        { lat: cadre.sud, lng: cadre.ouest },
        { lat: cadre.sud, lng: cadre.est },
        { lat: cadre.nord, lng: cadre.ouest },
        { lat: cadre.nord, lng: cadre.est },
      ].map((point) => projection.versVue(point));

      return coins.every(
        ({ x, y }) => x >= 0 && x <= vue.largeur && y >= 0 && y <= vue.hauteur,
      );
    };

    it('fait tenir l’emprise entière dans la vue', () => {
      const cadre = cadreDesGeometries([
        carreAutour(SAUVATTE, 300),
        carreAutour({ lat: 48.16, lng: 1.99 }, 300),
      ]);
      expect(dansLaVue(cadre!, { largeur: 320, hauteur: 440 })).toBe(true);
    });

    it('fait tenir un parcellaire très étiré, dans les deux sens', () => {
      // Le cas qui casse un cadrage naïf : une emprise large et plate dans un
      // écran de téléphone, haut et étroit. Ne cadrer que sur la latitude
      // coucherait les parcelles de part et d'autre, hors de l'écran.
      const large = { sud: 48.1, nord: 48.102, ouest: 1.9, est: 2.1 };
      const haute = { sud: 48.0, nord: 48.3, ouest: 1.9, est: 1.902 };

      expect(dansLaVue(large, { largeur: 320, hauteur: 440 })).toBe(true);
      expect(dansLaVue(haute, { largeur: 320, hauteur: 440 })).toBe(true);
      expect(dansLaVue(large, { largeur: 440, hauteur: 320 })).toBe(true);
    });

    it('ne zoome pas à l’infini sur une parcelle réduite à un point', () => {
      const vue = { largeur: 320, hauteur: 440 };
      const { spanLat } = ajusterAuCadre(cadreDUnPoint(SAUVATTE), vue);
      const projection = creerProjection({ centre: SAUVATTE, spanLat, vue });

      expect(Number.isFinite(spanLat)).toBe(true);
      // Une étendue qui a un sens au champ, et non un zoom où un mètre
      // remplirait l'écran.
      expect(spanLat * METRES_PAR_DEGRE_LAT).toBeGreaterThanOrEqual(100);
      expect(projection.metresParUnite).toBeGreaterThan(0);
    });

    it('centre sur le milieu de l’emprise', () => {
      const cadre = { sud: 48, ouest: 1, nord: 48.2, est: 1.4 };
      expect(centreDuCadre(cadre)).toEqual({ lat: 48.1, lng: 1.2 });
      expect(ajusterAuCadre(cadre, { largeur: 320, hauteur: 440 }).centre).toEqual({
        lat: 48.1,
        lng: 1.2,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('Gestes', () => {
    const vue = { largeur: 320, hauteur: 440 };
    const depart = creerProjection({ centre: SAUVATTE, spanLat: 0.01, vue });

    it('garde sous le doigt le point qu’on pince', () => {
      // Le geste qu'on fait vraiment : on pince sur une parcelle du bord pour
      // la regarder de plus près. Si le centre ne suivait pas, elle sortirait
      // de l'écran — on zoomerait sur autre chose.
      for (const ancre of [
        { x: 160, y: 220 },
        { x: 20, y: 30 },
        { x: 300, y: 420 },
      ]) {
        const avant = depart.versGeo(ancre.x, ancre.y);
        const { centre, spanLat } = zoomer(depart, ancre, 2.5);
        const apres = creerProjection({ centre, spanLat, vue }).versVue(avant);

        expect(apres.x).toBeCloseTo(ancre.x, 6);
        expect(apres.y).toBeCloseTo(ancre.y, 6);
      }
    });

    it('ne laisse pas l’ancre glisser au fil des pincements', () => {
      // Vingt pincements d'affilée, comme on en fait en cherchant une pièce.
      // L'approximation facile — garder le cosinus de l'ancien centre —
      // laisse filer l'ancre de quelques pixels à chaque fois.
      const ancre = { x: 40, y: 400 };
      const visee = depart.versGeo(ancre.x, ancre.y);
      let projection = depart;
      for (let i = 0; i < 20; i += 1) {
        const { centre, spanLat } = zoomer(projection, ancre, 1.2);
        projection = creerProjection({ centre, spanLat, vue });
      }

      const fin = projection.versVue(visee);
      expect(fin.x).toBeCloseTo(ancre.x, 4);
      expect(fin.y).toBeCloseTo(ancre.y, 4);
    });

    it('respecte les bornes de zoom', () => {
      expect(zoomer(depart, { x: 160, y: 220 }, 1_000, { spanMinLat: 0.002 }).spanLat)
        .toBeCloseTo(0.002, 12);
      expect(zoomer(depart, { x: 160, y: 220 }, 0.001, { spanMaxLat: 0.05 }).spanLat)
        .toBeCloseTo(0.05, 12);
    });

    it('fait suivre la carte au doigt, sans changer l’échelle', () => {
      const vise = depart.versGeo(100, 150);
      const { centre, spanLat } = deplacer(depart, 60, -25);
      const apres = creerProjection({ centre, spanLat, vue });

      // Le doigt va de (100,150) à (160,125) : le point visé l'y suit.
      const ou = apres.versVue(vise);
      expect(ou.x).toBeCloseTo(160, 6);
      expect(ou.y).toBeCloseTo(125, 6);
      expect(spanLat).toBe(depart.spanLat);
      expect(apres.metresParUnite).toBeCloseTo(depart.metresParUnite, 12);
    });

    it('revient à son point de départ, au centimètre près, quand on fait le geste inverse', () => {
      // Pas exactement réversible, et c'est voulu : la vue se réancre sur son
      // nouveau centre, où un degré de longitude ne mesure plus la même
      // distance. L'écart est donc réel, mais il doit rester sans portée au
      // champ — on l'exprime en mètres, seule unité où la question a un sens.
      let projection = depart;
      for (const [dx, dy] of [
        [80, 40],
        [-80, -40],
      ] as const) {
        const { centre, spanLat } = deplacer(projection, dx, dy);
        projection = creerProjection({ centre, spanLat, vue });
      }

      const ecartLat =
        Math.abs(projection.centre.lat - SAUVATTE.lat) * METRES_PAR_DEGRE_LAT;
      const ecartLng =
        Math.abs(projection.centre.lng - SAUVATTE.lng) *
        METRES_PAR_DEGRE_LAT *
        Math.cos((SAUVATTE.lat * Math.PI) / 180);

      expect(ecartLat).toBeLessThan(0.01);
      expect(ecartLng).toBeLessThan(0.01);
      expect(projection.spanLat).toBe(depart.spanLat);
    });
  });

  // -------------------------------------------------------------------------
  describe('Nom affiché sur la parcelle', () => {
    it('garde le nom entier quand il tient', () => {
      expect(etiquetteAjustee('Les Sables', 200, 6)).toBe('Les Sables');
    });

    it('rogne le nom qui déborderait sur la parcelle voisine', () => {
      // Le défaut vu à l'écran : « La Pièce du Moulin » écrit en travers d'une
      // parcelle deux fois plus étroite que lui, mordant sur sa voisine — on
      // ne savait plus laquelle des deux il nommait.
      const rogne = etiquetteAjustee('La Pièce du Moulin', 60, 6);
      expect(rogne).not.toBeNull();
      expect(rogne!.length * 6).toBeLessThanOrEqual(60);
      expect(rogne!.endsWith('…')).toBe(true);
      expect('La Pièce du Moulin'.startsWith(rogne!.slice(0, -1))).toBe(true);
    });

    it('renonce quand il ne resterait rien de reconnaissable', () => {
      // « La… » ne distingue pas « La Croix Rouge » de « La Côte du Chêne » :
      // mieux vaut aucune étiquette qu'une étiquette trompeuse.
      expect(etiquetteAjustee('La Croix Rouge', 18, 6)).toBeNull();
      expect(etiquetteAjustee('Les Sables', 0, 6)).toBeNull();
      expect(etiquetteAjustee('Les Sables', 100, 0)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('Barre d’échelle', () => {
    it('choisit le plus grand palier qui tient', () => {
      // 1 unité = 1 m, 300 unités disponibles : 250 m tient, 500 non.
      expect(barreDEchelle(1, 300)?.metres).toBe(250);
      expect(barreDEchelle(1, 300)?.unites).toBeCloseTo(250, 9);
      expect(barreDEchelle(1, 120)?.metres).toBe(100);
    });

    it('ne dépasse jamais la largeur permise', () => {
      for (const metresParUnite of [0.05, 0.3, 1, 7, 40]) {
        for (const largeur of [60, 120, 300]) {
          const barre = barreDEchelle(metresParUnite, largeur);
          // Une barre plus longue que la place disponible sortirait de l'écran
          // et ne se lirait plus — autant ne pas en afficher.
          expect(barre?.unites ?? 0).toBeLessThanOrEqual(largeur + 1e-9);
        }
      }
    });

    it('renonce plutôt que de déborder quand aucune distance ronde ne tient', () => {
      // 1 unité = 5 cm sur 60 unités : 3 m de terrain en tout. Le plus petit
      // palier, 1 m, tient encore.
      expect(barreDEchelle(0.05, 60)?.metres).toBe(2);
      // 1 unité = 5 cm sur 15 unités : 75 cm. Plus rien ne tient, et une barre
      // qui déborde se lirait comme une distance qu'elle ne représente pas.
      expect(barreDEchelle(0.05, 15)).toBeNull();
      expect(barreDEchelle(0, 300)).toBeNull();
      expect(barreDEchelle(1, 0)).toBeNull();
    });

    it('écrit les kilomètres en kilomètres', () => {
      expect(barreDEchelle(1, 1_200)?.libelle).toBe('1 km');
      expect(barreDEchelle(1, 3_000)?.libelle).toBe('2,5 km');
      expect(barreDEchelle(1, 300)?.libelle).toBe('250 m');
    });
  });

  // -------------------------------------------------------------------------
  describe('Étiquette d’une parcelle', () => {
    it('se pose au centre d’un carré', () => {
      const anneaux = anneauxDeGeometrie(carreAutour(SAUVATTE, 200));
      const centre = centroideSurfacique(anneaux);
      expect(centre?.lat).toBeCloseTo(SAUVATTE.lat, 9);
      expect(centre?.lng).toBeCloseTo(SAUVATTE.lng, 9);
    });

    it('ne se laisse pas tirer par un côté relevé avec beaucoup de points', () => {
      // Un relevé au GPS ne sème pas ses points régulièrement : on ralentit
      // le long d'une haie, et ce côté-là reçoit dix fois plus de points.
      const sud = 48.1;
      const nord = 48.102;
      const ouest = 1.9;
      const est = 1.903;
      const contour: Array<[number, number]> = [];
      for (let i = 0; i <= 40; i += 1) {
        contour.push([ouest + ((est - ouest) * i) / 40, sud]);
      }
      contour.push([est, nord], [ouest, nord], [ouest, sud]);

      const centre = centroideSurfacique([{ contour, trous: [] }]);
      expect(centre?.lat).toBeCloseTo((sud + nord) / 2, 6);

      // Et la preuve que ce test attrape bien la régression : la moyenne des
      // sommets, elle, est tirée vers le côté sur-échantillonné.
      const moyenne =
        contour.reduce((somme, [, lat]) => somme + lat, 0) / contour.length;
      expect(Math.abs(moyenne - (sud + nord) / 2)).toBeGreaterThan(0.0008);
    });

    it('retombe sur la moyenne des sommets pour un contour dégénéré', () => {
      const centre = centroideSurfacique([
        {
          contour: [
            [1.9, 48.1],
            [1.902, 48.1],
            [1.9, 48.1],
          ],
          trous: [],
        },
      ]);
      // Aire nulle : aucun centroïde surfacique n'existe, et refuser de
      // répondre priverait la parcelle de son étiquette.
      expect(centre?.lat).toBeCloseTo(48.1, 9);
      expect(centre?.lng).toBeCloseTo(1.9006666, 5);
    });

    it('rend null quand il n’y a rien à étiqueter', () => {
      expect(centroideSurfacique([])).toBeNull();
    });
  });
});
