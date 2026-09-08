import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/errors';
import {
  requireAuth,
  requireFarmAccess,
  requireParcelAccess,
  requirePlatformAdmin,
  type FarmContext,
  type Permission,
} from '@/lib/auth/rbac';
import type { AuthContext } from '@/lib/auth/session';

/**
 * Variantes des contrôles d'accès destinées aux pages.
 *
 * Les fonctions de `rbac.ts` lèvent une `ApiError` : c'est le comportement
 * attendu d'une route API, mais dans une page rendue côté serveur cela produit
 * une exception journalisée à chaque visite anonyme — du bruit qui finirait par
 * masquer les vraies erreurs. Ici, une absence de session ou une adresse non
 * vérifiée se traduit par une redirection ; les autres erreurs (403, 404)
 * continuent de remonter.
 */
function handleAuthFailure(error: unknown, email?: string): never {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED') redirect('/connexion');
    if (error.code === 'EMAIL_NOT_VERIFIED') {
      redirect(
        email
          ? `/verification-email?email=${encodeURIComponent(email)}`
          : '/verification-email',
      );
    }
    if (error.code === 'MAINTENANCE') redirect('/maintenance');
  }
  throw error;
}

export async function requirePageAuth(): Promise<AuthContext> {
  try {
    return await requireAuth();
  } catch (error) {
    handleAuthFailure(error);
  }
}

/**
 * Section d'administration. Un utilisateur authentifié mais non administrateur
 * est renvoyé vers son tableau de bord plutôt que sur une page d'erreur :
 * l'existence de la section n'a rien de secret, et une 403 en pleine navigation
 * est déroutante.
 */
export async function requirePageAdmin(): Promise<AuthContext> {
  try {
    return await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'FORBIDDEN') {
      redirect('/dashboard');
    }
    handleAuthFailure(error);
  }
}

export async function requirePageFarmAccess(
  permission: Permission,
  explicitFarmId?: string | null,
): Promise<FarmContext> {
  try {
    return await requireFarmAccess(permission, explicitFarmId);
  } catch (error) {
    handleAuthFailure(error);
  }
}

export async function requirePageParcelAccess(
  parcelId: string,
  permission: Permission,
): Promise<Awaited<ReturnType<typeof requireParcelAccess>>> {
  try {
    return await requireParcelAccess(parcelId, permission);
  } catch (error) {
    handleAuthFailure(error);
  }
}
