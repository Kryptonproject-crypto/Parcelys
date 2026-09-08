import { getEnv } from '@/lib/env';

/**
 * CORS pour les clients natifs.
 *
 * Le navigateur web appelle l'API depuis la même origine : il n'a besoin
 * d'aucun en-tête CORS. L'application mobile, elle, sert ses fichiers depuis la
 * WebView (`http://localhost` sur Android, `capacitor://localhost` sur iOS) et
 * appelle l'API sur une autre origine.
 *
 * L'autorisation est donnée à une liste fermée d'origines (`MOBILE_APP_ORIGINS`)
 * et sans `Access-Control-Allow-Credentials` : le client natif s'authentifie par
 * jeton `Authorization: Bearer`, jamais par cookie. Aucun site web tiers ne peut
 * donc emprunter la session d'un utilisateur connecté.
 */

/** En-têtes que le client natif est autorisé à envoyer. */
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Parcelys-Client';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export function isAllowedMobileOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return getEnv().MOBILE_APP_ORIGINS.includes(origin);
}

/** En-têtes CORS à poser sur une réponse d'API, ou `null` si non concernée. */
export function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!isAllowedMobileOrigin(origin) || !origin) return null;

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
    // Une même URL peut répondre différemment selon l'origine : sans `Vary`,
    // un cache intermédiaire servirait la mauvaise réponse.
    Vary: 'Origin',
  };
}
