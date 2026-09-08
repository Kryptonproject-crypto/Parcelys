import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuration Capacitor.
 *
 * `webDir` pointe sur la sortie de Vite : les fichiers sont embarqués dans
 * l'APK et servis par la WebView depuis `http://localhost`. Cette origine doit
 * figurer dans `MOBILE_APP_ORIGINS` côté serveur, sinon le CORS bloquera tous
 * les appels d'API.
 *
 * `cleartext` reste désactivé : une instance auto-hébergée doit être servie en
 * HTTPS. Pour un essai en réseau local sur une adresse IP en HTTP, activez-le
 * temporairement — et seulement le temps de l'essai.
 */
const config: CapacitorConfig = {
  appId: 'fr.parcelys.champ',
  appName: 'Parcelys au champ',
  webDir: 'dist',
  android: {
    // La WebView sert l'application sur http://localhost, l'origine attendue
    // par défaut dans MOBILE_APP_ORIGINS.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'http',
    cleartext: false,
  },
  plugins: {
    Geolocation: {
      // Le relevé de contour exige la position fine ; la position réseau,
      // précise à quelques centaines de mètres, ne sert à rien ici.
      permissions: ['location'],
    },
  },
};

export default config;
