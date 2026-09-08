import { requireVerifiedAuth } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { currentVersion, getUpdateStatus } from '@/lib/updates/releases';

/**
 * GET /api/mobile/version — version de l'instance et APK publié.
 *
 * L'application de terrain s'en sert pour signaler qu'une nouvelle version est
 * disponible, avec le lien de téléchargement. Elle n'installe rien : sur
 * Android, un APK hors magasin s'installe toujours par une action explicite de
 * l'utilisateur.
 *
 * Réservé aux comptes authentifiés : cela évite d'exposer la version exacte de
 * l'instance à un visiteur anonyme, qui n'en a aucun usage légitime.
 */
export const GET = route(async () => {
  await requireVerifiedAuth();
  const status = await getUpdateStatus();

  return ok({
    /** Version du serveur : l'application affiche un avertissement si elle est en retard. */
    server: await currentVersion(),
    /** Dernière version publiée sur le dépôt surveillé, `null` si non configuré. */
    latest: status.latest
      ? {
          version: status.latest.version,
          name: status.latest.name,
          publishedAt: status.latest.publishedAt,
          url: status.latest.url,
          apkUrl: status.latest.apkUrl,
        }
      : null,
    checkedAt: status.checkedAt,
  });
});
