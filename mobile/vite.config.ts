import { readFileSync } from 'node:fs';
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
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // Cible réaliste pour les WebView Android encore en service (Android 8+).
    target: 'es2020',
    sourcemap: false,
  },
  server: { host: '127.0.0.1', port: 5174 },
});
