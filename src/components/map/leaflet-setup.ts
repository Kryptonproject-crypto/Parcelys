'use client';

import L from 'leaflet';

/**
 * Configuration Leaflet partagée.
 *
 * Les icônes par défaut de Leaflet sont référencées en URL relative au CSS, ce
 * qui casse avec le bundler : on les remplace par des marqueurs SVG en ligne,
 * sans requête réseau supplémentaire.
 */
let configured = false;

const MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
  <path d="M12.5 0C5.6 0 0 5.6 0 12.5 0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#2f6b34"/>
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

export const PARCEL_STYLE = {
  color: '#2f6b34',
  weight: 2,
  opacity: 0.9,
  fillColor: '#4b8b3d',
  fillOpacity: 0.25,
} as const;

export const PARCEL_STYLE_SELECTED = {
  color: '#b4841a',
  weight: 3,
  opacity: 1,
  fillColor: '#e8b93f',
  fillOpacity: 0.4,
} as const;

export const DRAFT_STYLE = {
  color: '#b4841a',
  weight: 2.5,
  dashArray: '6 4',
  fillColor: '#e8b93f',
  fillOpacity: 0.25,
} as const;

/** Fonds de carte disponibles. Le fond satellite aide à repérer les limites. */
export type BaseLayerKey = 'plan' | 'satellite';

export function buildBaseLayers(
  tileUrl: string,
  attribution: string,
): Record<BaseLayerKey, L.TileLayer> {
  return {
    plan: L.tileLayer(tileUrl, { attribution, maxZoom: 19 }),
    satellite: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Imagerie &copy; Esri, Maxar, Earthstar Geographics — fond fourni par ArcGIS Online',
        maxZoom: 19,
      },
    ),
  };
}

/** Centre par défaut : centre géographique approximatif de la France. */
export const FRANCE_CENTER: [number, number] = [46.6, 2.4];
export const FRANCE_ZOOM = 6;
