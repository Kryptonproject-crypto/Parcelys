import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

/**
 * Inter, auto-hébergée par Next : aucune requête vers un tiers, donc rien à
 * ouvrir dans la CSP et pas de décalage de mise en page au chargement.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

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
  icons: { icon: [{ url: '/icone.svg', type: 'image/svg+xml' }] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f4' },
    { media: '(prefers-color-scheme: dark)', color: '#10140f' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Applique le thème avant le premier rendu.
 *
 * Sans ce script synchrone, la page s'afficherait brièvement en clair avant de
 * basculer en sombre — le fameux « flash blanc ». Il lit la préférence
 * enregistrée, sinon celle du système.
 */
const THEME_SCRIPT = `(function(){try{
var stored=localStorage.getItem('parcelys-theme');
var theme=stored==='light'||stored==='dark'?stored:
 (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.documentElement.setAttribute('data-theme',theme);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full bg-canvas font-sans text-ink antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
