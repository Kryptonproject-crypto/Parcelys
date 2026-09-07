import type { NextRequest } from 'next/server';
import { destroyCurrentSession, getAuthContext } from '@/lib/auth/session';
import { clientIp, ok, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';

/** POST /api/auth/logout — révoque la session courante et efface le cookie. */
export const POST = route(async (request: NextRequest) => {
  const auth = await getAuthContext();
  await destroyCurrentSession();

  if (auth) {
    await logAudit({
      action: 'auth.logout',
      userId: auth.user.id,
      farmId: auth.activeFarmId,
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
  }

  return ok({ message: 'Déconnexion effectuée' });
});
