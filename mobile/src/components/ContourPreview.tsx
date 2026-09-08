import { useMemo } from 'react';
import type { Position } from '../lib/types';

/**
 * Aperçu du contour relevé.
 *
 * Un SVG dessiné à la main, et non une carte : le fond de plan exigerait des
 * tuiles téléchargées, donc du réseau — exactement ce dont on ne dispose pas au
 * milieu d'un champ. Cet aperçu ne prétend pas situer la parcelle, seulement
 * montrer la forme relevée, ce qui suffit à repérer un point aberrant ou un
 * côté oublié.
 */
export function ContourPreview({
  points,
  live,
}: {
  points: Position[];
  live?: Position | null;
}) {
  const drawing = useMemo(() => {
    if (points.length === 0) return null;

    const all = live ? [...points, live] : points;
    const lats = all.map((point) => point.lat);
    const lngs = all.map((point) => point.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Un degré de longitude est plus court qu'un degré de latitude, et le
    // rapport dépend de la latitude : sans cette correction, une parcelle
    // carrée s'afficherait comme un rectangle très aplati.
    const midLat = (minLat + maxLat) / 2;
    const lngScale = Math.cos((midLat * Math.PI) / 180);

    const width = Math.max((maxLng - minLng) * lngScale, 1e-9);
    const height = Math.max(maxLat - minLat, 1e-9);
    const span = Math.max(width, height);
    const padding = span * 0.12;

    const project = (point: Position): [number, number] => [
      ((point.lng - minLng) * lngScale - (span - width) / 2 + padding) /
        (span + padding * 2),
      // L'axe des ordonnées SVG descend : la latitude est inversée.
      1 -
        (point.lat - minLat - (span - height) / 2 + padding) / (span + padding * 2),
    ];

    const scaled = points.map((point) => {
      const [x, y] = project(point);
      return { x: x * 100, y: y * 100 };
    });

    const path = scaled
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');

    const livePoint = live ? project(live) : null;

    return {
      path: points.length >= 3 ? `${path} Z` : path,
      vertices: scaled,
      live: livePoint ? { x: livePoint[0] * 100, y: livePoint[1] * 100 } : null,
    };
  }, [points, live]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-surface-2">
      {!drawing ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13.5px] text-ink-3">
          Le contour s&apos;affichera ici au fil du relevé.
        </p>
      ) : (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`Contour relevé, ${points.length} points`}
        >
          <path
            d={drawing.path}
            fill={points.length >= 3 ? 'var(--color-champ-500)' : 'none'}
            fillOpacity="0.18"
            stroke="var(--color-champ-500)"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {drawing.vertices.map((vertex, index) => (
            <circle
              key={`${vertex.x}-${vertex.y}-${index}`}
              cx={vertex.x}
              cy={vertex.y}
              r="1.4"
              fill="var(--color-surface)"
              stroke="var(--color-champ-600)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {drawing.live ? (
            <circle
              cx={drawing.live.x}
              cy={drawing.live.y}
              r="2"
              fill="var(--color-ble-500)"
              stroke="var(--color-surface)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      )}
    </div>
  );
}
