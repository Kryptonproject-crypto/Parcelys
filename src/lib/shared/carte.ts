/**
 * Projection d'un parcellaire sur une vue, partagée entre le site et l'application.
 *
 * Elle vit dans le terrain commun pour la raison expliquée dans
 * `geometrie.ts` : les maths d'une carte sont exactement ce qu'il faut pouvoir
 * tester, et un module de `mobile/` ne peut pas l'être sans rattraper tout le
 * graphe de l'application dans la compilation du serveur.
 *
 * Ce fichier n'importe rien.
 *
 * ---
 *
 * Pourquoi une projection locale et non Web Mercator : un parcellaire tient
 * dans quelques kilomètres. Sur cette étendue, corriger la longitude par le
 * cosinus de la latitude du centre donne des formes justes à mieux que le
 * millième — alors que Mercator n'apporte rien tant qu'on ne superpose pas des
 * tuiles, qui sont les seules à l'exiger. Le jour où un fond de plan arrive,
 * c'est ici qu'il faudra changer de projection, et nulle part ailleurs.
 */

export type Point = { lat: number; lng: number };

/** Rayon moyen de la Terre (IUGG), en mètres — comme dans `mobile/src/lib/geo.ts`. */
const RAYON_TERRE_M = 6_371_008.8;

/** Longueur d'un degré de latitude, en mètres. Constante, contrairement à la longitude. */
export const METRES_PAR_DEGRE_LAT = (RAYON_TERRE_M * Math.PI) / 180;

const enRadians = (degres: number): number => (degres * Math.PI) / 180;

/** Emprise géographique d'un ensemble de contours. */
export type Cadre = {
  sud: number;
  ouest: number;
  nord: number;
  est: number;
};

/** Un polygone prêt à dessiner : son contour, et ses trous éventuels. */
export type AnneauxPolygone = {
  contour: Array<[number, number]>;
  trous: Array<Array<[number, number]>>;
};

/**
 * Découpe une géométrie GeoJSON en polygones dessinables.
 *
 * Les trous sont rendus séparément parce qu'une parcelle trouée — un bosquet,
 * une mare, un poteau — n'est pas la même surface qu'une parcelle pleine, et
 * qu'un contour dessiné sans ses trous ferait croire le contraire.
 */
export function anneauxDeGeometrie(
  geometry: { type: string; coordinates: unknown } | null | undefined,
): AnneauxPolygone[] {
  if (!geometry) return [];

  const polygones = (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  ) as unknown;
  if (!Array.isArray(polygones)) return [];

  const estAnneau = (valeur: unknown): valeur is Array<[number, number]> =>
    Array.isArray(valeur) &&
    valeur.length > 0 &&
    valeur.every(
      (sommet) =>
        Array.isArray(sommet) &&
        typeof sommet[0] === 'number' &&
        typeof sommet[1] === 'number' &&
        Number.isFinite(sommet[0]) &&
        Number.isFinite(sommet[1]),
    );

  const resultat: AnneauxPolygone[] = [];
  for (const anneaux of polygones) {
    if (!Array.isArray(anneaux)) continue;
    const contour = anneaux[0];
    if (!estAnneau(contour)) continue;
    resultat.push({
      contour,
      trous: anneaux.slice(1).filter(estAnneau),
    });
  }
  return resultat;
}

/**
 * Emprise d'un ensemble de géométries.
 *
 * `null` quand aucune n'est exploitable : il faut pouvoir le distinguer d'un
 * cadre dégénéré, car une carte sans contour ne se cadre pas — elle s'annonce.
 */
export function cadreDesGeometries(
  geometries: Array<{ type: string; coordinates: unknown } | null | undefined>,
): Cadre | null {
  let sud = Number.POSITIVE_INFINITY;
  let ouest = Number.POSITIVE_INFINITY;
  let nord = Number.NEGATIVE_INFINITY;
  let est = Number.NEGATIVE_INFINITY;
  let vu = false;

  for (const geometry of geometries) {
    for (const { contour, trous } of anneauxDeGeometrie(geometry)) {
      // Les trous sont à l'intérieur du contour par construction, mais une
      // géométrie importée n'est pas toujours bien formée : les inclure coûte
      // peu et évite une parcelle coupée à l'affichage.
      for (const anneau of [contour, ...trous]) {
        for (const [lng, lat] of anneau) {
          vu = true;
          if (lat < sud) sud = lat;
          if (lat > nord) nord = lat;
          if (lng < ouest) ouest = lng;
          if (lng > est) est = lng;
        }
      }
    }
  }

  return vu ? { sud, ouest, nord, est } : null;
}

/** Réunit deux cadres. Sert à faire tenir la position de l'opérateur dans la vue. */
export function unionCadres(a: Cadre | null, b: Cadre | null): Cadre | null {
  if (!a) return b;
  if (!b) return a;
  return {
    sud: Math.min(a.sud, b.sud),
    ouest: Math.min(a.ouest, b.ouest),
    nord: Math.max(a.nord, b.nord),
    est: Math.max(a.est, b.est),
  };
}

/** Cadre réduit à un point. */
export function cadreDUnPoint(point: Point): Cadre {
  return { sud: point.lat, ouest: point.lng, nord: point.lat, est: point.lng };
}

export function centreDuCadre(cadre: Cadre): Point {
  return {
    lat: (cadre.sud + cadre.nord) / 2,
    lng: (cadre.ouest + cadre.est) / 2,
  };
}

export type Vue = { largeur: number; hauteur: number };

/**
 * Cadrage d'un parcellaire dans une vue.
 *
 * Rend le centre et l'étendue verticale à afficher. Le zoom et le déplacement
 * se ramènent alors à deux nombres — et non à une pile de transformations dont
 * on ne sait plus, au bout de trois gestes, ce qu'elle montre.
 */
export function ajusterAuCadre(
  cadre: Cadre,
  vue: Vue,
  options: { marge?: number; spanMinimalM?: number } = {},
): { centre: Point; spanLat: number } {
  const marge = options.marge ?? 0.08;
  // Une parcelle unique très étirée, ou un cadre réduit à un point, donnerait
  // un zoom infini : on borne par une étendue qui a un sens au champ.
  const spanMinimalM = options.spanMinimalM ?? 120;

  const centre = centreDuCadre(cadre);
  const cos = Math.max(Math.cos(enRadians(centre.lat)), 1e-6);
  const hauteurVue = Math.max(vue.hauteur, 1);
  const largeurVue = Math.max(vue.largeur, 1);

  const spanVertical = cadre.nord - cadre.sud;
  // Étendue verticale nécessaire pour que l'emprise horizontale tienne aussi :
  // c'est la condition de non-déformation, et elle dépend du format de la vue.
  const spanHorizontal = ((cadre.est - cadre.ouest) * cos * hauteurVue) / largeurVue;

  const spanLat = Math.max(
    Math.max(spanVertical, spanHorizontal) * (1 + 2 * marge),
    spanMinimalM / METRES_PAR_DEGRE_LAT,
  );

  return { centre, spanLat };
}

export type Projection = {
  /** Du géographique vers la vue. */
  versVue: (point: Point) => { x: number; y: number };
  /** De la vue vers le géographique : ce que le doigt a touché. */
  versGeo: (x: number, y: number) => Point;
  /** Mètres représentés par une unité de vue. Sert à l'échelle et aux distances. */
  metresParUnite: number;
  centre: Point;
  spanLat: number;
  vue: Vue;
};

/**
 * Projection d'une vue cadrée.
 *
 * Les deux axes partagent la même échelle métrique : un carré sur le terrain
 * reste un carré à l'écran. Sans cette contrainte, une parcelle paraîtrait
 * plus large que longue selon la latitude, et on ne reconnaîtrait pas ses
 * propres pièces.
 */
export function creerProjection(options: {
  centre: Point;
  spanLat: number;
  vue: Vue;
}): Projection {
  const { centre } = options;
  const hauteur = Math.max(options.vue.hauteur, 1);
  const largeur = Math.max(options.vue.largeur, 1);
  const spanLat = Math.max(options.spanLat, 1e-9);

  const uniteParDegreLat = hauteur / spanLat;
  const cos = Math.max(Math.cos(enRadians(centre.lat)), 1e-6);
  const uniteParDegreLng = uniteParDegreLat * cos;

  return {
    versVue: (point) => ({
      x: largeur / 2 + (point.lng - centre.lng) * uniteParDegreLng,
      // L'axe des ordonnées descend à l'écran : le nord est vers le haut, donc
      // la latitude s'inverse.
      y: hauteur / 2 - (point.lat - centre.lat) * uniteParDegreLat,
    }),
    versGeo: (x, y) => ({
      lat: centre.lat + (hauteur / 2 - y) / uniteParDegreLat,
      lng: centre.lng + (x - largeur / 2) / uniteParDegreLng,
    }),
    metresParUnite: (spanLat * METRES_PAR_DEGRE_LAT) / hauteur,
    centre,
    spanLat,
    vue: { largeur, hauteur },
  };
}

/**
 * Nom de parcelle rogné à la place disponible.
 *
 * Une étiquette plus large que sa parcelle déborde sur la voisine, et l'on ne
 * sait plus laquelle elle nomme — c'est pire que pas de nom. Le nom entier
 * reste lisible d'un appui sur la parcelle.
 *
 * `largeurCaractere` est la largeur moyenne d'un caractère à la taille
 * employée ; approximative par nature, puisque la vraie dépend de la police et
 * des lettres. On s'en tient donc à une estimation prudente plutôt qu'à une
 * mesure que seul le navigateur pourrait faire.
 */
export function etiquetteAjustee(
  nom: string,
  largeurDisponible: number,
  largeurCaractere: number,
): string | null {
  if (largeurCaractere <= 0) return null;
  const tiennent = Math.floor(largeurDisponible / largeurCaractere);
  if (tiennent >= nom.length) return nom;
  // En dessous de quatre caractères, un nom rogné ne désigne plus rien :
  // « La… » ne distingue pas « La Croix Rouge » de « La Côte du Chêne ».
  if (tiennent < 4) return null;
  return `${nom.slice(0, tiennent - 1).trimEnd()}…`;
}

/**
 * Zoom autour d'un point de l'écran.
 *
 * L'ancre reste sous le doigt : c'est ce qui distingue un zoom d'un saut. Si le
 * centre ne bougeait pas, pincer sur une parcelle du bord la ferait fuir hors
 * de l'écran, et on perdrait ce qu'on cherchait à regarder.
 */
export function zoomer(
  projection: Projection,
  ancre: { x: number; y: number },
  facteur: number,
  bornes: { spanMinLat?: number; spanMaxLat?: number } = {},
): { centre: Point; spanLat: number } {
  const geoAncre = projection.versGeo(ancre.x, ancre.y);

  const spanLat = Math.min(
    Math.max(projection.spanLat / Math.max(facteur, 1e-6), bornes.spanMinLat ?? 1e-9),
    bornes.spanMaxLat ?? Number.POSITIVE_INFINITY,
  );

  const { largeur, hauteur } = projection.vue;
  const uniteParDegreLat = hauteur / spanLat;

  // La latitude d'abord : elle ne dépend d'aucune correction. On en tire le
  // cosinus exact du nouveau centre, puis la longitude — plutôt que de
  // réutiliser celui de l'ancien centre, qui laisserait l'ancre glisser un peu
  // à chaque pincement, et beaucoup au bout de vingt.
  const lat = geoAncre.lat + (ancre.y - hauteur / 2) / uniteParDegreLat;
  const uniteParDegreLng =
    uniteParDegreLat * Math.max(Math.cos(enRadians(lat)), 1e-6);
  const lng = geoAncre.lng - (ancre.x - largeur / 2) / uniteParDegreLng;

  return { centre: { lat, lng }, spanLat };
}

/**
 * Déplacement de la vue, exprimé en unités d'écran.
 *
 * `dx`/`dy` sont le mouvement du doigt : la carte suit, donc le centre va en
 * sens inverse.
 */
export function deplacer(
  projection: Projection,
  dx: number,
  dy: number,
): { centre: Point; spanLat: number } {
  const { hauteur } = projection.vue;
  const uniteParDegreLat = hauteur / projection.spanLat;
  const uniteParDegreLng =
    uniteParDegreLat * Math.max(Math.cos(enRadians(projection.centre.lat)), 1e-6);

  return {
    spanLat: projection.spanLat,
    centre: {
      lat: projection.centre.lat + dy / uniteParDegreLat,
      lng: projection.centre.lng - dx / uniteParDegreLng,
    },
  };
}

/** Paliers d'échelle : des distances qui se lisent, pas des arrondis de calcul. */
const PALIERS_M = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000, 2_000, 2_500, 5_000, 10_000,
];

/**
 * Barre d'échelle : une distance ronde et sa longueur à l'écran.
 *
 * Une carte sans échelle ne permet pas de juger une distance, et au champ c'est
 * précisément la question — « la bande enherbée fait-elle 5 m ou 20 ? ».
 *
 * Rend `null` quand aucune distance ronde ne tient dans la place donnée. Une
 * barre plus longue que la place disponible sortirait de l'écran : elle se
 * lirait comme une distance qu'elle ne représente pas, ce qui est pire que pas
 * de barre. Le cadrage borne l'étendue minimale, donc ce cas ne se produit pas
 * dans l'application ; la fonction reste juste prise à part.
 */
export function barreDEchelle(
  metresParUnite: number,
  largeurMaxUnites: number,
): { metres: number; unites: number; libelle: string } | null {
  if (!(metresParUnite > 0) || !(largeurMaxUnites > 0)) return null;

  const metresMax = metresParUnite * largeurMaxUnites;
  const metres = [...PALIERS_M].reverse().find((palier) => palier <= metresMax);
  if (metres === undefined) return null;

  return {
    metres,
    unites: metres / metresParUnite,
    libelle:
      metres >= 1_000
        ? `${(metres / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`
        : `${metres} m`,
  };
}

/**
 * Centre d'un ensemble d'anneaux, pondéré par les surfaces.
 *
 * Sert à poser l'étiquette d'une parcelle. Pas la moyenne des sommets : un côté
 * relevé avec beaucoup de points tirerait l'étiquette vers lui, parfois hors de
 * la parcelle. Le centroïde d'aire, lui, reste dedans pour une forme convexe,
 * et au pire près du bord pour une forme en L — ce qui se voit et se comprend.
 */
export function centroideSurfacique(anneaux: AnneauxPolygone[]): Point | null {
  let aireTotale = 0;
  let sommeLng = 0;
  let sommeLat = 0;

  // Origine locale : les coordonnées d'une parcelle française tournent autour
  // de 48 et de 2, et leurs produits croisés s'annulent à la quatrième
  // décimale. Calculer en écarts à un sommet ramène le bruit de calcul de
  // quelques millimètres à quelques microns — pour deux soustractions.
  const premier = anneaux[0]?.contour[0];
  const [origineLng, origineLat] = premier ?? [0, 0];

  for (const { contour } of anneaux) {
    let aire = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < contour.length; i += 1) {
      const sommetA = contour[i];
      const sommetB = contour[(i + 1) % contour.length];
      if (!sommetA || !sommetB) continue;
      const a: [number, number] = [sommetA[0] - origineLng, sommetA[1] - origineLat];
      const b: [number, number] = [sommetB[0] - origineLng, sommetB[1] - origineLat];
      const croix = a[0] * b[1] - b[0] * a[1];
      aire += croix;
      cx += (a[0] + b[0]) * croix;
      cy += (a[1] + b[1]) * croix;
    }
    if (aire === 0) continue;
    aireTotale += Math.abs(aire);
    // Le signe de `aire` dit le sens de parcours ; la pondération doit porter
    // sur la surface, donc sur sa valeur absolue.
    const signe = Math.sign(aire);
    sommeLng += (cx / 3) * signe;
    sommeLat += (cy / 3) * signe;
  }

  if (aireTotale === 0) {
    // Dégénéré — un contour aplati, deux points confondus : la moyenne des
    // sommets vaut mieux que rien, et le dire ici évite de le redécouvrir.
    const sommets = anneaux.flatMap(({ contour }) => contour);
    if (sommets.length === 0) return null;
    const somme = sommets.reduce(
      (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
      { lng: 0, lat: 0 },
    );
    return { lng: somme.lng / sommets.length, lat: somme.lat / sommets.length };
  }

  return {
    lng: origineLng + sommeLng / aireTotale,
    lat: origineLat + sommeLat / aireTotale,
  };
}
