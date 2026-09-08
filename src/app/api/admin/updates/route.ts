import type { NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { getUpdateStatus } from '@/lib/updates/releases';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/admin/updates — version installée et dernière version publiée.
 *
 * Réservé aux administrateurs de l'instance : c'est une information
 * d'exploitation, pas une donnée agronomique. La vérification est mise en cache
 * une heure côté serveur ; `POST` la force.
 */
export const GET = route(async () => {
  await requirePlatformAdmin();
  return ok(await getUpdateStatus());
});

/** POST /api/admin/updates — force une vérification immédiate. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin();

  // L'appel sort de l'instance : on borne la cadence même pour un administrateur.
  await enforceRateLimit(`updates:${auth.user.id}`, {
    limit: 10,
    windowSeconds: 600,
  });

  const status = await getUpdateStatus(true);

  await logAudit({
    action: 'admin.updates_checked',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    metadata: {
      current: status.current,
      latest: status.latest?.version ?? null,
      updateAvailable: status.updateAvailable,
    },
  });

  return ok(status);
});
