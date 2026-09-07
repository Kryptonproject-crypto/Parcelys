import type { NextRequest } from 'next/server';
import { destroyCurrentSession, revokeAllSessions } from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';

/** POST /api/auth/logout-all — déconnexion de tous les appareils. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const revoked = await revokeAllSessions(auth.user.id);
  await destroyCurrentSession();

  await logAudit({
    action: 'auth.logout_all',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { revoked },
  });

  return ok({ message: `${revoked} session(s) révoquée(s)`, revoked });
});
