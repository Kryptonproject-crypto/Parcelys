/**
 * Géométrie partagée entre le site et l'application.
 *
 * Elle vit dans le terrain commun, et non dans `mobile/`, pour la raison
 * expliquée dans `sync-status.ts` : un test de la racine qui importerait un
 * module mobile rattraperait tout le graphe mobile dans la compilation du
 * serveur, où les dépendances de l'application ne sont pas installées.
 *
 * Ce fichier n'importe rien.
 */

export type Point = { lat: number; lng: number };

export type GeometrieSurfacique = {
  type: string;
  coordinates: unknown;
} | null;

/**
 * Le point est-il dans ce polygone ?
 *
 * Algorithme du lancer de rayon : on compte les fois où une demi-droite
 * horizontale partant du point traverse le contour. Impair = dedans.
 *
 * Calculé dans le téléphone, volontairement : c'est au champ, souvent sans
 * réseau, qu'on a besoin de savoir dans quelle parcelle on se trouve. Demander
 * au serveur reviendrait à ne pas répondre là où la question se pose.
 *
 * Les trous comptent : une parcelle trouée — un bosquet, une mare — ne contient
 * pas ce qui est dans le trou. Le même test appliqué aux anneaux intérieurs
 * inverse donc la réponse.
 */
function dansAnneau(point: Point, anneau: Array<[number, number]>): boolean {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i, i += 1) {
    const a = anneau[i];
    const b = anneau[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    // `yi > lat` et `yj > lat` de part et d'autre : le segment croise la
    // latitude du point. L'égalité stricte d'un côté seulement évite de
    // compter deux fois un sommet posé exactement sur le rayon.
    if (yi > point.lat !== yj > point.lat) {
      const x = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lng < x) dedans = !dedans;
    }
  }
  return dedans;
}

/** Le point est-il dans cette géométrie MultiPolygon ? */
export function dansLaParcelle(
  point: Point,
  geometry: { type: string; coordinates: unknown } | null,
): boolean {
  if (!geometry) return false;

  // Un MultiPolygon est une liste de polygones ; chaque polygone est une liste
  // d'anneaux, le premier étant le contour et les suivants ses trous.
  const polygones = (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  ) as Array<Array<Array<[number, number]>>> | undefined;
  if (!Array.isArray(polygones)) return false;

  for (const anneaux of polygones) {
    if (!Array.isArray(anneaux) || anneaux.length === 0) continue;
    const contour = anneaux[0];
    if (!contour || !dansAnneau(point, contour)) continue;
    // Dans le contour : reste à vérifier qu'on n'est pas dans un trou.
    const dansUnTrou = anneaux
      .slice(1)
      .some((trou) => Array.isArray(trou) && dansAnneau(point, trou));
    if (!dansUnTrou) return true;
  }
  return false;
}
