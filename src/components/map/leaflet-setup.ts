'use client';

import L from 'leaflet';
import {
  FOND_PLAN_DEFAUT,
  FOND_SATELLITE,
  STYLE_PARCELLE,
  STYLE_PARCELLE_BROUILLON,
  STYLE_PARCELLE_CHOISIE,
} from '@/lib/shared/carte';

/**
 * Configuration Leaflet partagée.
 *
 * Les icônes par défaut de Leaflet sont référencées en URL relative au CSS, ce
 * qui casse avec le bundler : on les remplace par des marqueurs SVG en ligne,
 * sans requête réseau supplémentaire.
 */
let configured = false;

// Le vert du marqueur est celui du tracé des parcelles, pris à la source : une
// goutte d'une autre teinte que les contours qu'elle désigne se remarque.
const MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
  <path d="M12.5 0C5.6 0 0 5.6 0 12.5 0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${STYLE_PARCELLE.color}"/>
  <circle cx="12.5" cy="12.5" r="5" fill="#fff"/>
</svg>`;

export function configureLeaflet(): void {
  if (configured) return;
  configured = true;

  const icon = L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(MARKER_SVG)}`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -36],
  });

  L.Marker.prototype.options.icon = icon;
}

/*
 * Les couleurs et les fonds viennent du terrain commun : l'application de
 * terrain dessine les mêmes parcelles avec la même bibliothèque, et deux jeux
 * de constantes identiques finissent toujours par diverger.
 */
export const PARCEL_STYLE = STYLE_PARCELLE;
export const PARCEL_STYLE_SELECTED = STYLE_PARCELLE_CHOISIE;
export const DRAFT_STYLE = STYLE_PARCELLE_BROUILLON;

/** Fonds de carte disponibles. Le fond satellite aide à repérer les limites. */
export type BaseLayerKey = 'plan' | 'satellite';

export function buildBaseLayers(
  tileUrl: string,
  attribution: string,
): Record<BaseLayerKey, L.TileLayer> {
  return {
    plan: L.tileLayer(tileUrl, { attribution, maxZoom: FOND_PLAN_DEFAUT.maxZoom }),
    satellite: L.tileLayer(FOND_SATELLITE.url, {
      attribution: FOND_SATELLITE.attribution,
      maxZoom: FOND_SATELLITE.maxZoom,
    }),
  };
}

/** Centre par défaut : centre géographique approximatif de la France. */
export const FRANCE_CENTER: [number, number] = [46.6, 2.4];
export const FRANCE_ZOOM = 6;
