import type { NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { maintenanceSchema } from '@/lib/validation/admin';
import { getMaintenanceMode, setMaintenanceMode } from '@/lib/admin/settings';
import { logAudit } from '@/lib/audit';

/** GET /api/admin/maintenance — état courant du mode maintenance. */
export const GET = route(async () => {
  await requirePlatformAdmin();
  const mode = await getMaintenanceMode();
  return ok({
    enabled: mode.enabled,
    message: mode.message,
    updatedAt: mode.updatedAt?.toISOString() ?? null,
  });
});

/**
 * POST /api/admin/maintenance — active ou lève le mode maintenance.
 * Les administrateurs gardent l'accès complet, sans quoi personne ne pourrait
 * intervenir ni ressortir de ce mode.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin();
  const input = await parseBody(request, maintenanceSchema);

  const mode = await setMaintenanceMode(
    { enabled: input.enabled, message: input.message || null },
    auth.user.id,
  );

  await logAudit({
    action: 'admin.maintenance_changed',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { enabled: mode.enabled },
  });

  return ok({
    message: mode.enabled
      ? 'Mode maintenance activé : seuls les administrateurs accèdent à l’application.'
      : 'Mode maintenance levé.',
    enabled: mode.enabled,
    maintenanceMessage: mode.message,
  });
});
