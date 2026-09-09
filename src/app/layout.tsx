import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

/**
 * Inter, servie depuis le dépôt.
 *
 * `next/font/google` aurait fait l'affaire — il auto-héberge lui aussi le
 * résultat —, mais il télécharge la police *pendant la compilation*. Sur le
 * Raspberry Pi de production, relié par Starlink, une averse au mauvais moment
 * suffisait à faire échouer « npm run build » sur « Failed to fetch Inter from
 * Google Fonts », message qui ne dit ni que c'est le réseau, ni qu'il suffit
 * de recommencer. Le fichier est donc versionné : la compilation ne dépend
 * plus d'un tiers, et elle est reproductible.
 *
 * Un seul sous-ensemble, « latin » : il couvre tout le français — lettres
 * accentuées, ç, œ et Œ (U+0152-0153), € (U+20AC) et la ponctuation
 * typographique. Les glyphes absents retombent sur la police système, caractère
 * par caractère, sans casser la page.
 */
const inter = localFont({
  src: '../fonts/inter-latin.woff2',
  weight: '100 900', // fichier variable : toutes les graisses en une seule requête
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
