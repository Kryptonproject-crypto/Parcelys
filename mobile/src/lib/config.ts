/**
 * Le serveur : parcelys.fr.
 *
 * Il n'y en a qu'un. L'adresse est inscrite **à la compilation** et n'est pas
 * demandée à l'utilisateur : un agriculteur au bord d'un champ n'a aucune
 * raison de connaître l'adresse d'un serveur, et une faute de frappe ne se
 * distingue pas d'une panne de réseau — même écran, même silence.
 *
 * `VITE_PARCELYS_SERVER` existe pour le développement seul, afin de pointer
 * une instance locale sans toucher au code :
 *
 *     VITE_PARCELYS_SERVER=http://127.0.0.1:3000 npm run dev
 *
 * Un APK distribué vise toujours parcelys.fr. HTTPS y est obligatoire : la
 * configuration Capacitor refuse le trafic en clair (`cleartext: false`), et
 * Android le bloquerait de toute façon.
 */

const SERVEUR = 'https://parcelys.fr';

/** Complète le schéma et retire la barre finale, qui doublerait les barres. */
function normaliser(brut: string): string {
  const propre = brut.trim();
  if (propre.length === 0) return SERVEUR;
  const avecSchema = /^https?:\/\//i.test(propre) ? propre : `https://${propre}`;
  return avecSchema.replace(/\/+$/, '');
}

export const SERVER_URL = normaliser(
  (import.meta.env.VITE_PARCELYS_SERVER as string | undefined) ?? SERVEUR,
);

/** Ce qu'on montre à l'utilisateur : « parcelys.fr », sans le schéma. */
export const SERVER_LABEL = SERVER_URL.replace(/^https?:\/\//i, '');
