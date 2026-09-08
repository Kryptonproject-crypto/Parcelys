import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * L'application est empaquetée dans l'APK : ses fichiers sont servis par la
 * WebView depuis le système de fichiers, jamais depuis un serveur. D'où
 * `base: './'` — un chemin absolu ne résoudrait rien une fois embarqué.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // Cible réaliste pour les WebView Android encore en service (Android 8+).
    target: 'es2020',
    sourcemap: false,
  },
  server: { host: '127.0.0.1', port: 5174 },
});
