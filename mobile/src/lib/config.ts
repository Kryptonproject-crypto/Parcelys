/**
 * Adresse de l'instance à laquelle cette application se connecte.
 *
 * Elle est fixée **à la compilation**, et non demandée à l'utilisateur. Un
 * agriculteur qui installe « Parcelys au champ » depuis parcelys.fr n'a pas à
 * connaître l'adresse d'un serveur : c'est une question d'administrateur, pas
 * de terrain, et une adresse mal saisie ne se distingue pas d'une panne réseau.
 *
 * Parcelys reste auto-hébergeable : qui installe sa propre instance recompile
 * l'APK avec son adresse, sans toucher au code —
 *
 *     VITE_PARCELYS_SERVER=https://parcelys.mon-domaine.fr npm run build
 *
 * HTTPS est obligatoire : la configuration Capacitor refuse le trafic en clair
 * (`cleartext: false`), et Android le bloquerait de toute façon.
 */

const DEFAUT = 'https://parcelys.fr';

/** Complète le schéma et retire la barre finale, qui doublerait les barres. */
function normaliser(brut: string): string {
  const propre = brut.trim();
  if (propre.length === 0) return DEFAUT;
  const avecSchema = /^https?:\/\//i.test(propre) ? propre : `https://${propre}`;
  return avecSchema.replace(/\/+$/, '');
}

export const SERVER_URL = normaliser(
  (import.meta.env.VITE_PARCELYS_SERVER as string | undefined) ?? DEFAUT,
);

/** Ce qu'on montre à l'utilisateur : « parcelys.fr », sans le schéma. */
export const SERVER_LABEL = SERVER_URL.replace(/^https?:\/\//i, '');
