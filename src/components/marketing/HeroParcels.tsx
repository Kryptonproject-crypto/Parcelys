/**
 * Illustration du bandeau d'accueil : un parcellaire stylisé.
 *
 * SVG en ligne plutôt qu'une image : aucun octet supplémentaire à télécharger,
 * net à toutes les résolutions, et les couleurs suivent le thème via les
 * variables CSS. Purement décoratif — masqué aux lecteurs d'écran.
 */
export function HeroParcels({ className }: { className?: string }) {
  const parcels = [
    { d: 'M40 96 L188 72 L214 154 L62 180 Z', hue: 'var(--serie-6)', label: '74,5 ha' },
    { d: 'M196 68 L318 50 L340 124 L218 150 Z', hue: 'var(--serie-1)', label: '45,6 ha' },
    { d: 'M66 190 L216 164 L242 252 L88 276 Z', hue: 'var(--serie-4)', label: '67,5 ha' },
    { d: 'M224 160 L344 134 L368 214 L248 248 Z', hue: 'var(--serie-3)', label: '25,6 ha' },
    { d: 'M92 286 L246 260 L266 330 L110 356 Z', hue: 'var(--serie-2)', label: '78,4 ha' },
    { d: 'M254 258 L372 224 L392 296 L274 328 Z', hue: 'var(--serie-5)', label: '37,1 ha' },
  ];

  return (
    <svg
      viewBox="0 0 420 400"
      className={className}
      role="presentation"
      aria-hidden="true"
      fill="none"
    >
      <defs>
        {/* Adoucit les bords de l'illustration pour l'intégrer au fond. */}
        <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="70%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="hero-mask">
          <rect width="420" height="400" fill="url(#hero-fade)" />
        </mask>
      </defs>

      <g mask="url(#hero-mask)">
        {/* Chemin d'exploitation */}
        <path
          d="M20 150 C 110 130, 200 200, 300 180 S 400 250, 410 300"
          stroke="var(--color-line-strong)"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.35"
        />

        {parcels.map((parcel, index) => (
          <g key={parcel.d}>
            <path
              d={parcel.d}
              fill={parcel.hue}
              fillOpacity="0.16"
              stroke={parcel.hue}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Sommets déplaçables, clin d'œil à l'outil de dessin. */}
            {index === 0
              ? parcel.d
                  .replace(/[MLZ]/g, '')
                  .trim()
                  .split(/\s+/)
                  .reduce<Array<[number, number]>>((points, value, i, all) => {
                    if (i % 2 === 0 && all[i + 1] !== undefined) {
                      points.push([Number(value), Number(all[i + 1])]);
                    }
                    return points;
                  }, [])
                  .map(([x, y]) => (
                    <circle
                      key={`${x}-${y}`}
                      cx={x}
                      cy={y}
                      r="4.5"
                      fill="var(--color-surface)"
                      stroke="var(--color-ble-500)"
                      strokeWidth="2.5"
                    />
                  ))
              : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
