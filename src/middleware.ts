import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/api/cors';

/**
 * CORS des routes d'API pour l'application mobile.
 *
 * Placé en middleware plutôt que répété dans chaque route : la requête de
 * pré-vol `OPTIONS` doit recevoir une réponse avant même d'atteindre le
 * gestionnaire, et il n'y a qu'un seul endroit à relire pour vérifier la
 * politique.
 *
 * Le contrôle d'accès applicatif n'est pas fait ici : le middleware s'exécute
 * sur le moteur Edge, sans accès à la base. Les sessions, les rôles et les
 * permissions restent vérifiés dans chaque route.
 */
export function middleware(request: NextRequest): NextResponse {
  const headers = corsHeaders(request.headers.get('origin'));

  // Pré-vol : le navigateur de la WebView demande l'autorisation avant
  // d'envoyer la vraie requête.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: headers ? 204 : 403, headers: headers ?? {} });
  }

  const response = NextResponse.next();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
