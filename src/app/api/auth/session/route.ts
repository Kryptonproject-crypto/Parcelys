import { getAuthContext } from '@/lib/auth/session';
import { ok, route } from '@/lib/api/handler';

/** GET /api/auth/session — état de la session courante. */
export const GET = route(async () => {
  const auth = await getAuthContext();
  if (!auth) return ok({ authenticated: false });

  return ok({
    authenticated: true,
    user: auth.user,
    memberships: auth.memberships,
    activeFarmId: auth.activeFarmId,
    activeRole: auth.activeRole,
  });
});
