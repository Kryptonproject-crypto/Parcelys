'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  buildBaseLayers,
  configureLeaflet,
  DRAFT_STYLE,
  FRANCE_CENTER,
  FRANCE_ZOOM,
  PARCEL_STYLE,
  type BaseLayerKey,
} from '@/components/map/leaflet-setup';
import { geodesicAreaM2 } from '@/lib/geo/area';
import type { MultiPolygonGeometry, Position } from '@/lib/geo/types';
import { Button, Spinner } from '@/components/ui';
import { IconCheck, IconEdit, IconUndo } from '@/components/ui/icons';

type GeocodeHit = {
  label: string;
  city: string | null;
  postcode: string | null;
  citycode: string | null;
  latitude: number;
  longitude: number;
};

export type DrawResult = {
  geometry: MultiPolygonGeometry;
  areaHa: number;
  centroid: { lat: number; lng: number };
  commune: string | null;
  inseeCode: string | null;
};

type Props = {
  tileUrl: string;
  attribution: string;
  /** Géométrie initiale — mode édition d'une parcelle existante. */
  initialGeometry?: MultiPolygonGeometry | null;
  /** Autres parcelles affichées en fond pour se repérer. */
  otherParcels?: Array<{ id: string; name: string; geometry: MultiPolygonGeometry }>;
  onChange: (result: DrawResult | null) => void;
  heightClass?: string;
};

/**
 * Carte de dessin parcellaire.
 *
 * Implémentée directement sur Leaflet : chaque clic ajoute un sommet, les
 * sommets sont déplaçables, et la superficie est recalculée en direct. La
 * valeur affichée reste indicative — c'est PostGIS qui calcule la superficie
 * définitive à l'enregistrement.
 */
export function ParcelDrawMap({
  tileUrl,
  attribution,
  initialGeometry,
  otherParcels = [],
  onChange,
  heightClass = 'h-[520px]',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const draftLayerRef = useRef<L.Polygon | null>(null);
  const draftLineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const baseLayersRef = useRef<Record<BaseLayerKey, L.TileLayer> | null>(null);

  const [points, setPoints] = useState<Position[]>([]);
  const [closed, setClosed] = useState(false);
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('plan');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [locality, setLocality] = useState<{ commune: string | null; inseeCode: string | null }>({
    commune: null,
    inseeCode: null,
  });

  const areaHa = useMemo(() => {
    if (points.length < 3) return 0;
    const ring = [...points, points[0] as Position];
    return geodesicAreaM2({ type: 'MultiPolygon', coordinates: [[ring]] }) / 10_000;
  }, [points]);

  // --- initialisation de la carte -----------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    configureLeaflet();
    const map = L.map(containerRef.current, {
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      zoomControl: true,
      doubleClickZoom: false,
    });
    mapRef.current = map;

    const layers = buildBaseLayers(tileUrl, attribution);
    baseLayersRef.current = layers;
    layers.plan.addTo(map);

    // Parcelles existantes en fond, non interactives.
    for (const parcel of otherParcels) {
      L.geoJSON(parcel.geometry, {
        style: { ...PARCEL_STYLE, fillOpacity: 0.12, weight: 1.5 },
        interactive: false,
      })
        .bindTooltip(parcel.name, { className: 'parcel-tooltip', sticky: true })
        .addTo(map);
    }

    if (initialGeometry) {
      const ring = initialGeometry.coordinates[0]?.[0];
      if (ring && ring.length >= 4) {
        // On retire le point de fermeture : il est réajouté à la validation.
        setPoints(ring.slice(0, -1) as Position[]);
        setClosed(true);
      }
      const layer = L.geoJSON(initialGeometry);
      map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    } else if (otherParcels.length > 0) {
      const layer = L.geoJSON({
        type: 'FeatureCollection',
        features: otherParcels.map((p) => ({
          type: 'Feature' as const,
          geometry: p.geometry,
          properties: {},
        })),
      } as never);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Initialisation unique : les props de configuration ne changent pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- bascule de fond de carte -------------------------------------------
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

  // --- ajout de sommet au clic --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (event: L.LeafletMouseEvent): void => {
      if (closed) return;
      const point: Position = [
        Number(event.latlng.lng.toFixed(7)),
        Number(event.latlng.lat.toFixed(7)),
      ];
      setPoints((prev) => [...prev, point]);
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [closed]);

  // --- rendu du brouillon (polygone + sommets déplaçables) -----------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    draftLayerRef.current?.remove();
    draftLayerRef.current = null;
    draftLineRef.current?.remove();
    draftLineRef.current = null;

    const latlngs = points.map(([lng, lat]) => L.latLng(lat, lng));

    if (latlngs.length >= 3) {
      draftLayerRef.current = L.polygon(latlngs, DRAFT_STYLE).addTo(map);
    } else if (latlngs.length === 2) {
      draftLineRef.current = L.polyline(latlngs, DRAFT_STYLE).addTo(map);
    }

    latlngs.forEach((latlng, index) => {
      const marker = L.marker(latlng, {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({
          className: '',
          html:
            '<div style="width:12px;height:12px;border-radius:50%;background:#fff;' +
            'border:2.5px solid #b4841a;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      }).addTo(map);

      marker.on('drag', (event) => {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        const updated = points.map((p, i) =>
          i === index ? ([Number(lng.toFixed(7)), Number(lat.toFixed(7))] as Position) : p,
        );
        const ll = updated.map(([x, y]) => L.latLng(y, x));
        if (draftLayerRef.current) draftLayerRef.current.setLatLngs(ll);
        if (draftLineRef.current) draftLineRef.current.setLatLngs(ll);
      });

      marker.on('dragend', (event) => {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        setPoints((prev) =>
          prev.map((p, i) =>
            i === index ? ([Number(lng.toFixed(7)), Number(lat.toFixed(7))] as Position) : p,
          ),
        );
      });

      // Clic droit sur un sommet : le supprimer.
      marker.on('contextmenu', () => {
        setPoints((prev) => prev.filter((_, i) => i !== index));
      });

      markersRef.current.push(marker);
    });
  }, [points]);

  // --- remontée du résultat -----------------------------------------------
  const emit = useCallback(
    async (currentPoints: Position[], isClosed: boolean) => {
      if (!isClosed || currentPoints.length < 3) {
        onChange(null);
        return;
      }

      const first = currentPoints[0] as Position;
      const ring: Position[] = [...currentPoints, first];
      const geometry: MultiPolygonGeometry = {
        type: 'MultiPolygon',
        coordinates: [[ring]],
      };

      const centroid = ring.slice(0, -1).reduce(
        (acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }),
        { lat: 0, lng: 0 },
      );
      const count = ring.length - 1;
      const center = { lat: centroid.lat / count, lng: centroid.lng / count };

      // Géocodage inverse pour pré-remplir la commune.
      let commune = locality.commune;
      let inseeCode = locality.inseeCode;
      if (!commune) {
        try {
          const response = await fetch(
            `/api/geo/reverse?lat=${center.lat.toFixed(6)}&lng=${center.lng.toFixed(6)}`,
          );
          if (response.ok) {
            const data = (await response.json()) as {
              city: string | null;
              citycode: string | null;
            };
            commune = data.city;
            inseeCode = data.citycode;
            setLocality({ commune, inseeCode });
          }
        } catch {
          // La commune reste à saisir manuellement.
        }
      }

      onChange({
        geometry,
        areaHa: geodesicAreaM2(geometry) / 10_000,
        centroid: center,
        commune,
        inseeCode,
      });
    },
    [onChange, locality],
  );

  useEffect(() => {
    void emit(points, closed);
  }, [points, closed, emit]);

  // --- actions -------------------------------------------------------------
  const undo = (): void => {
    setClosed(false);
    setPoints((prev) => prev.slice(0, -1));
  };

  const reset = (): void => {
    setClosed(false);
    setPoints([]);
    setLocality({ commune: null, inseeCode: null });
  };

  const runSearch = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (search.trim().length < 3) return;

    setSearching(true);
    try {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(search)}`);
      if (response.ok) {
        const data = (await response.json()) as { results: GeocodeHit[] };
        setHits(data.results);
      }
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const goTo = (hit: GeocodeHit): void => {
    mapRef.current?.setView([hit.latitude, hit.longitude], 16);
    setHits([]);
    setSearch(hit.label);
    if (hit.city) setLocality({ commune: hit.city, inseeCode: hit.citycode });
  };

  return (
    <div className="space-y-3">
      {/* Recherche d'adresse */}
      <div className="relative">
        <form onSubmit={runSearch} className="flex gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une commune, un lieu-dit, une adresse…"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm
                       placeholder:text-ink-3/70 focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
          />
          <Button type="submit" variant="outline" disabled={searching}>
            {searching ? <Spinner /> : 'Rechercher'}
          </Button>
        </form>

        {hits.length > 0 ? (
          <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
            {hits.map((hit, index) => (
              <li key={`${hit.label}-${index}`}>
                <button
                  type="button"
                  onClick={() => goTo(hit)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft/60"
                >
                  <span className="font-medium text-ink">{hit.label}</span>
                  {hit.postcode ? (
                    <span className="ml-2 text-xs text-ink-3">{hit.postcode}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
        <div className="flex rounded-md border border-line p-0.5">
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

        <span className="h-5 w-px bg-ardoise-200" />

        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={IconUndo}
          onClick={undo}
          disabled={points.length === 0}
        >
          Annuler le point
        </Button>
        <Button
          type="button"
          size="sm"
          variant={closed ? 'secondary' : 'primary'}
          icon={closed ? IconEdit : IconCheck}
          onClick={() => setClosed((v) => !v)}
          disabled={points.length < 3}
        >
          {closed ? 'Reprendre le tracé' : 'Fermer le polygone'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={points.length === 0}
        >
          Tout effacer
        </Button>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-ink-3">{points.length} sommet(s)</span>
          <span
            className={`rounded-md px-2.5 py-1 font-semibold tabular-nums ${
              closed ? 'bg-accent-soft text-champ-800 dark:text-champ-300' : 'bg-surface-3 text-ink-2'
            }`}
          >
            {areaHa.toLocaleString('fr-FR', {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            })}{' '}
            ha
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`${heightClass} w-full overflow-hidden rounded-xl border border-line`}
      />

      <p className="text-xs text-ink-3">
        Cliquez sur la carte pour poser les sommets, déplacez-les pour ajuster le
        contour, clic droit sur un sommet pour le supprimer. La superficie affichée
        est indicative : la valeur enregistrée est recalculée par le serveur (PostGIS)
        sur l&apos;ellipsoïde WGS84.
      </p>
    </div>
  );
}
