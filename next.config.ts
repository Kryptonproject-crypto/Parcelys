import type { NextConfig } from 'next';

/**
 * En-têtes de sécurité appliqués à toutes les réponses.
 * La CSP autorise les tuiles OpenStreetMap (carte) et rien d'autre en `img-src`.
 */
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
      // `unsafe-inline` reste nécessaire pour les styles injectés par Next/Leaflet.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com",
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
