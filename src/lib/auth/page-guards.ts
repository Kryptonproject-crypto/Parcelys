import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/errors';
import {
  requireAgronomist,
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
 * vérifiée se traduit par une redirection, et une ressource introuvable par la
 * page 404 ; le reste continue de remonter.
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

    /*
     * Ressource introuvable : la page 404, pas une exception.
     *
     * `NOT_FOUND` remontait telle quelle depuis un composant serveur. Next.js
     * n'y voit alors qu'une exception non rattrapée : il rend
     * « Application error: a server-side exception has occurred », **avec un
     * code HTTP 200**, et journalise l'erreur comme si le serveur était en
     * panne.
     *
     * Constaté en visitant `/parcelles/<identifiant inexistant>`. Le cas n'a
     * rien d'exotique : un signet vers une parcelle supprimée, un lien
     * partagé, un identifiant tapé de travers. L'exploitant voit un écran
     * d'erreur inquiétant là où « page introuvable » suffisait.
     *
     * `requireParcelAccess` rend d'ailleurs 404 aussi bien pour une parcelle
     * qui n'existe pas que pour celle d'une autre exploitation — c'est
     * délibéré, et il faut que la page le reste : répondre 403 dans un cas et
     * 404 dans l'autre dirait à un curieux lesquels de ses identifiants
     * tombent juste.
     */
    if (error.code === 'NOT_FOUND') notFound();
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

/**
 * Espace expert. Un compte d'exploitation est renvoyé vers son tableau de
 * bord : la section existe, elle n'est simplement pas la sienne.
 */
export async function requirePageAgronomist(): Promise<AuthContext> {
  try {
    return await requireAgronomist();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_AGRONOMIST') {
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
