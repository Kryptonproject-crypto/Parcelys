import { COULEUR_FAMILLE, familleVisuelle, nomCourtDeCulture, nomDitLeNumero } from './cultures';

/**
 * Apparence de la carte des parcelles, partagée entre le site et l'application.
 *
 * Le site dessine ses parcelles avec Leaflet depuis la 0.4 ; l'application de
 * terrain fait désormais la même chose, avec la même bibliothèque et les mêmes
 * fonds. Les couleurs, épaisseurs et fonds de plan vivent donc **ici**, et non
 * recopiés de part et d'autre : deux jeux de constantes identiques finissent
 * toujours par diverger, et l'exploitant verrait alors ses parcelles d'une
 * couleur au bureau et d'une autre au champ, sans comprendre pourquoi.
 *
 * Ce fichier n'importe que le terrain commun — il est lu par `mobile/`, dont
 * les dépendances ne sont pas installées à la racine. Il ne contient donc
 * aucune référence à Leaflet : seulement les valeurs que Leaflet consomme.
 */

/** Tracé d'une parcelle au repos. */
export const STYLE_PARCELLE = {
  color: '#2f6b34',
  weight: 2,
  opacity: 0.9,
  fillColor: '#4b8b3d',
  fillOpacity: 0.25,
} as const;

/**
 * Tracé d'une parcelle selon sa culture : la couleur de sa famille (prairies,
 * céréales, maïs…), la même que dans les listes. Sans culture, le vert
 * habituel. La parcelle désignée garde son ocre : elle doit ressortir.
 */
export function styleParcelle(cropName: string | null | undefined) {
  if (!cropName) return STYLE_PARCELLE;
  const couleur = COULEUR_FAMILLE[familleVisuelle(cropName)];
  return { ...STYLE_PARCELLE, color: couleur, fillColor: couleur, fillOpacity: 0.32 };
}

/** Tracé de la parcelle désignée : elle doit se distinguer d'un coup d'œil. */
export const STYLE_PARCELLE_CHOISIE = {
  color: '#b4841a',
  weight: 3,
  opacity: 1,
  fillColor: '#e8b93f',
  fillOpacity: 0.4,
} as const;

/** Tracé d'un contour en cours de relevé, pas encore enregistré. */
export const STYLE_PARCELLE_BROUILLON = {
  color: '#b4841a',
  weight: 2.5,
  dashArray: '6 4',
  fillColor: '#e8b93f',
  fillOpacity: 0.25,
} as const;

/** Repère de la position de l'appareil. */
export const STYLE_POSITION = {
  color: '#ffffff',
  weight: 2.5,
  fillColor: '#2b7fd4',
  fillOpacity: 1,
  radius: 7,
} as const;

/** Cercle de précision annoncée par le GPS, autour de la position. */
export const STYLE_PRECISION = {
  color: '#2b7fd4',
  weight: 1,
  opacity: 0.5,
  fillColor: '#2b7fd4',
  fillOpacity: 0.12,
} as const;

export type FondDeCarte = {
  url: string;
  attribution: string;
  maxZoom: number;
};

/**
 * Fond satellite.
 *
 * Fixé dans le code et non configurable : c'est lui qui permet de reconnaître
 * une limite de parcelle, une haie, un chemin — et le changer sans le dire
 * changerait ce que l'exploitant croit voir. L'attribution accompagne le fond,
 * comme l'exige la licence du fournisseur.
 */
export const FOND_SATELLITE: FondDeCarte = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Imagerie &copy; Esri, Maxar, Earthstar Geographics — fond fourni par ArcGIS Online',
  maxZoom: 19,
};

/**
 * Fond « plan » de repli.
 *
 * Le serveur sert sa propre valeur (`MAP_TILE_URL`), que l'application reçoit
 * dans son instantané. Ce repli ne sert qu'à un appareil qui n'a pas encore
 * resynchronisé depuis la 0.9.8 : il doit continuer à afficher une carte, pas
 * un carré vide.
 */
export const FOND_PLAN_DEFAUT: FondDeCarte = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
};

/** Zoom maximal au cadrage automatique : au-delà, on ne voit plus le voisinage. */
export const ZOOM_MAX_CADRAGE = 16;

/** Zoom maximal quand on cadre sur une seule parcelle désignée. */
export const ZOOM_MAX_PARCELLE = 17;

/**
 * Libellé d'une parcelle, tel qu'il s'affiche au survol sur le site et à
 * l'appui dans l'application.
 *
 * Rendu ici en texte et non en HTML : l'un et l'autre l'habillent à leur façon,
 * mais ils doivent nommer la parcelle de la même manière — on désigne une
 * parcelle par son numéro interne et son nom, et la superficie vient de
 * PostGIS.
 */
export function lignesDEtiquette(parcelle: {
  name: string;
  internalNumber: string | null;
  commune: string | null;
  areaHa: number;
  cropName: string | null;
}): string[] {
  // « 4-3 · Îlot 4 — parcelle 3 » disait deux fois la même chose.
  const titre =
    parcelle.internalNumber && !nomDitLeNumero(parcelle.name, parcelle.internalNumber)
      ? `${parcelle.internalNumber} · ${parcelle.name}`
      : parcelle.name;
  const culture = nomCourtDeCulture(parcelle.cropName);

  return [
    titre,
    `${parcelle.areaHa.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ha`,
    ...(culture ? [culture] : []),
    ...(parcelle.commune ? [parcelle.commune] : []),
  ];
}
