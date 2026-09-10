import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * L'application est empaquetée dans l'APK : ses fichiers sont servis par la
 * WebView depuis le système de fichiers, jamais depuis un serveur. D'où
 * `base: './'` — un chemin absolu ne résoudrait rien une fois embarqué.
 *
 * `__APP_VERSION__` fige la version au moment de la compilation : c'est elle
 * que l'application compare à la dernière version publiée pour savoir si une
 * mise à jour l'attend.
 */
/**
 * Le contrôle de dose réglementaire vit dans `src/lib/ephy/`, côté serveur, et
 * l'application mobile le compile ici plutôt que de le réécrire.
 *
 * Deux implémentations d'une même règle réglementaire finiraient par diverger,
 * et c'est celle du téléphone — utilisée au champ, au moment où l'on remplit le
 * pulvérisateur — qui serait la mauvaise. Les fichiers concernés n'importent
 * rien du serveur : ni Prisma, ni `server-only`, ni l'alias `@` du site.
 */
const PARTAGE = fileURLToPath(new URL('../src/lib/ephy', import.meta.url));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@partage': PARTAGE } },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // Cible réaliste pour les WebView Android encore en service (Android 8+).
    target: 'es2020',
    sourcemap: false,
  },
  // `fs.allow` : en développement, Vite refuse de servir un fichier hors du
  // dossier du projet. Le module partagé en est un.
  server: { host: '127.0.0.1', port: 5174, fs: { allow: ['..'] } },
});
