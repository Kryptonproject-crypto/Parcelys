import type { NextConfig } from 'next';

/**
 * Origines autorisées pour les tuiles de fond de carte.
 *
 * L'origine réelle est déduite de `MAP_TILE_URL` : changer de fournisseur ne
 * demande donc pas de retoucher la CSP. Les valeurs par défaut couvrent
 * OpenStreetMap et le fond satellite Esri.
 *
 * Attention au piège : `*.tile.openstreetmap.org` ne couvre PAS
 * `tile.openstreetmap.org` — l'hôte nu doit être listé séparément.
 */
function mapTileOrigins(): string[] {
  const origins = new Set([
    'https://tile.openstreetmap.org',
    'https://*.tile.openstreetmap.org',
    'https://*.basemaps.cartocdn.com',
    'https://server.arcgisonline.com',
  ]);

  const configured = process.env.MAP_TILE_URL;
  if (configured) {
    try {
      // Les gabarits `{z}/{x}/{y}` ne gênent pas l'analyse de l'origine.
      origins.add(new URL(configured).origin);
    } catch {
      // URL invalide : la validation de `getEnv()` le signalera au démarrage.
    }
  }

  return [...origins];
}

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // `unsafe-inline` reste nécessaire pour les styles injectés par Next et Leaflet.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      `img-src 'self' data: blob: ${mapTileOrigins().join(' ')}`,
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sortie autonome : image Docker minimale, sans les dépendances de build.
  output: 'standalone',
  serverExternalPackages: ['pdfkit', 'exceljs', 'bcryptjs', '@node-rs/argon2'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
