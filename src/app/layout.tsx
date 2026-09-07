import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Parcelys — gestion parcellaire agricole',
    template: '%s · Parcelys',
  },
  description:
    'Parcelys : cartographie des parcelles, suivi des cultures, registre des apports ' +
    'et registre phytosanitaire, météo locale et exports réglementaires.',
  applicationName: 'Parcelys',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icone.svg', type: 'image/svg+xml' }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#2f6b34',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-full bg-ardoise-50 font-sans antialiased">{children}</body>
    </html>
  );
}
