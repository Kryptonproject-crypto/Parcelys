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

/**
 * Une couche réglementaire posée sur la carte.
 *
 * `source` n'est pas décorative : une couche affichée sans provenance
 * laisserait croire à une vérité intemporelle, alors qu'un zonage est daté et
 * révisé. Elle est donc affichée avec la couche, jamais séparément.
 */
export type MapRegulatoryLayer = {
  code: string;
  label: string;
  color: string;
  source: { label: string; version: string; territory: string | null };
  features: Array<{ type: 'Feature'; properties: unknown; geometry: unknown }>;
  rendues: number;
  total: number;
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
  /**
   * Préfixe des liens de parcelle. L'espace expert ouvre les fiches sous
   * `/portefeuille/<exploitation>/parcelles`, l'exploitant sous `/parcelles`.
   */
  linkBase?: string;
  heightClass?: string;
  showLayerSwitch?: boolean;
  /**
   * Couches réglementaires disponibles. Toutes **éteintes au départ** : la
   * carte sert d'abord à voir ses parcelles, et six zonages superposés d'emblée
   * les rendraient illisibles.
   */
  regulatoryLayers?: MapRegulatoryLayer[];
};

/** Carte de consultation : affiche les parcelles et permet d'en sélectionner une. */
export function ParcelsMap({
  parcels,
  tileUrl,
  attribution,
  selectedId,
  onSelect,
  readOnly = false,
  linkBase = '/parcelles',
  heightClass = 'h-[420px]',
  showLayerSwitch = true,
  regulatoryLayers = [],
}: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const baseLayersRef = useRef<Record<BaseLayerKey, L.TileLayer> | null>(null);
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('plan');
  const zonesRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const [couchesActives, setCouchesActives] = useState<string[]>([]);

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
          else router.push(`${linkBase}/${parcel.id}`);
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
  }, [parcels, selectedId, onSelect, readOnly, linkBase, router]);

  // Couches réglementaires.
  //
  // Posées **sous** les parcelles : un zonage qui recouvrirait les contours
  // masquerait précisément ce qu'on cherche à situer. `bringToBack` s'en
  // charge, et le remplissage reste très transparent.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const registre = zonesRef.current;

    for (const [code, couche] of registre) {
      if (!couchesActives.includes(code)) {
        couche.remove();
        registre.delete(code);
      }
    }

    for (const code of couchesActives) {
      if (registre.has(code)) continue;
      const definition = regulatoryLayers.find((c) => c.code === code);
      if (!definition) continue;

      const couche = L.geoJSON(
        {
          type: 'FeatureCollection',
          features: definition.features,
        } as unknown as GeoJSON.FeatureCollection,
        {
          style: {
            color: definition.color,
            weight: 1.5,
            opacity: 0.85,
            fillColor: definition.color,
            fillOpacity: 0.12,
          },
          interactive: false,
        },
      );

      couche.addTo(map);
      couche.bringToBack();
      registre.set(code, couche);
    }
  }, [couchesActives, regulatoryLayers]);

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
    // `isolate` : le sélecteur de fond ci-dessous vit HORS du conteneur
    // Leaflet, donc hors de son contexte d'empilement. Son `z-[500]` entrait
    // en concurrence avec celui de la page, et il flottait au-dessus du menu
    // ouvert. Le contexte est donc posé ici, sur l'enveloppe, pour couvrir la
    // carte ET ses commandes.
    <div className="relative isolate min-w-0">
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

      {/*
        Sous la carte et non par-dessus : sur un téléphone, un panneau flottant
        recouvrirait justement les parcelles qu'on veut situer.
      */}
      {regulatoryLayers.length > 0 ? (
        <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-ink-2">Couches réglementaires</p>
          <ul className="mt-1.5 space-y-1.5">
            {regulatoryLayers.map((couche) => {
              const active = couchesActives.includes(couche.code);
              return (
                <li key={couche.code}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() =>
                        setCouchesActives((liste) =>
                          liste.includes(couche.code)
                            ? liste.filter((c) => c !== couche.code)
                            : [...liste, couche.code],
                        )
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-champ-600"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: couche.color }}
                        />
                        <span className="text-[13px] text-ink">{couche.label}</span>
                      </span>
                      {/* La provenance accompagne la couche, jamais ailleurs. */}
                      <span className="block text-[11.5px] leading-snug text-ink-3">
                        {couche.source.label} — version {couche.source.version}
                        {couche.source.territory ? ` · ${couche.source.territory}` : ''}
                        {couche.rendues < couche.total
                          ? ` · ${couche.rendues} zone(s) affichées sur ${couche.total} (emprise de vos parcelles)`
                          : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
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
