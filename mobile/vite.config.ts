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

/**
 * Second terrain commun : la logique partagée qui n'est pas réglementaire.
 *
 * Même raison que `@partage`, et une de plus. Un module qui vit dans `mobile/`
 * ne peut pas être testé depuis la racine : un test qui l'importe rattrape tout
 * le graphe mobile dans la compilation du serveur, où les dépendances de
 * l'application ne sont pas installées — et `npm run build` échoue sur un dépôt
 * fraîchement cloné. Ce qui doit être testé au même endroit que le reste vit
 * donc ici.
 */
const COMMUN = fileURLToPath(new URL('../src/lib/shared', import.meta.url));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@partage': PARTAGE, '@commun': COMMUN } },
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
