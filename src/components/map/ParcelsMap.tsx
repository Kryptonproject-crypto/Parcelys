'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  buildBaseLayers,
  configureLeaflet,
  FRANCE_CENTER,
  FRANCE_ZOOM,
  PARCEL_STYLE,
  PARCEL_STYLE_SELECTED,
  type BaseLayerKey,
} from '@/components/map/leaflet-setup';
import type { MultiPolygonGeometry } from '@/lib/geo/types';

export type MapParcel = {
  id: string;
  name: string;
  internalNumber: string | null;
  commune: string | null;
  areaHa: number;
  crop: string | null;
  geometry: MultiPolygonGeometry;
};

type Props = {
  parcels: MapParcel[];
  tileUrl: string;
  attribution: string;
  selectedId?: string | null;
  /** Sans callback, un clic ouvre la fiche de la parcelle. */
  onSelect?: (parcelId: string) => void;
  /**
   * Carte purement illustrative : le clic ne déclenche aucune navigation.
   * Prop booléenne plutôt qu'un callback vide, car une fonction ne peut pas
   * être transmise depuis un composant serveur.
   */
  readOnly?: boolean;
  heightClass?: string;
  showLayerSwitch?: boolean;
};

/** Carte de consultation : affiche les parcelles et permet d'en sélectionner une. */
export function ParcelsMap({
  parcels,
  tileUrl,
  attribution,
  selectedId,
  onSelect,
  readOnly = false,
  heightClass = 'h-[420px]',
  showLayerSwitch = true,
}: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const baseLayersRef = useRef<Record<BaseLayerKey, L.TileLayer> | null>(null);
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('plan');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    configureLeaflet();
    const map = L.map(containerRef.current, {
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      scrollWheelZoom: true,
    });
    mapRef.current = map;

    const layers = buildBaseLayers(tileUrl, attribution);
    baseLayersRef.current = layers;
    layers.plan.addTo(map);

    // La ref est copiée : au démontage, `layersRef.current` pourrait déjà
    // pointer ailleurs.
    const layerRegistry = layersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRegistry.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = baseLayersRef.current;
    if (!map || !layers) return;

    for (const key of Object.keys(layers) as BaseLayerKey[]) {
      if (key === baseLayer) {
        if (!map.hasLayer(layers[key])) layers[key].addTo(map);
      } else if (map.hasLayer(layers[key])) {
        map.removeLayer(layers[key]);
      }
    }
  }, [baseLayer]);

  // Rendu des parcelles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of layersRef.current.values()) layer.remove();
    layersRef.current.clear();

    const group = L.featureGroup();

    for (const parcel of parcels) {
      const layer = L.geoJSON(parcel.geometry, {
        style: parcel.id === selectedId ? PARCEL_STYLE_SELECTED : PARCEL_STYLE,
      });

      const label = [
        parcel.internalNumber ? `<strong>${escapeHtml(parcel.internalNumber)}</strong> · ` : '',
        `<strong>${escapeHtml(parcel.name)}</strong>`,
        `<br/>${parcel.areaHa.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ha`,
        parcel.crop ? `<br/>${escapeHtml(parcel.crop)}` : '',
        parcel.commune ? `<br/><span style="opacity:.75">${escapeHtml(parcel.commune)}</span>` : '',
      ].join('');

      layer.bindTooltip(label, { className: 'parcel-tooltip', sticky: true });

      if (!readOnly) {
        layer.on('click', () => {
          if (onSelect) onSelect(parcel.id);
          else router.push(`/parcelles/${parcel.id}`);
        });
      }

      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.45 }));
      layer.on('mouseout', () =>
        layer.setStyle(parcel.id === selectedId ? PARCEL_STYLE_SELECTED : PARCEL_STYLE),
      );

      layer.addTo(map);
      group.addLayer(layer);
      layersRef.current.set(parcel.id, layer);
    }

    if (parcels.length > 0) {
      const bounds = group.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }, [parcels, selectedId, onSelect, readOnly, router]);

  // Recentre sur la parcelle sélectionnée.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const layer = layersRef.current.get(selectedId);
    if (!layer) return;
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
  }, [selectedId]);

  return (
    // `min-w-0` : Leaflet remplit son conteneur de tuiles absolues bien plus
    // larges que l'écran. Sans cette contrainte, la largeur minimale de la
    // carte remonte à l'élément de grille ou de flex qui la contient — dont le
    // `min-width: auto` par défaut refuse alors de rétrécir — et toute la page
    // déborde horizontalement sur un téléphone.
    <div className="relative min-w-0">
      {showLayerSwitch ? (
        <div className="absolute right-3 top-3 z-[500] flex rounded-md border border-line bg-surface p-0.5 shadow-sm">
          {(['plan', 'satellite'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBaseLayer(key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                baseLayer === key
                  ? 'bg-champ-600 text-white'
                  : 'text-ink-2 hover:bg-surface-3'
              }`}
            >
              {key === 'plan' ? 'Plan' : 'Satellite'}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={`${heightClass} w-full overflow-hidden rounded-xl border border-line`}
      />
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
