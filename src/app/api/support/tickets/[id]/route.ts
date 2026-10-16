import { ok, route } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/rbac';
import { chargerMaDemande } from '@/lib/support/tickets';

type Ctx = { params: Promise<Record<string, string>> };

/** GET /api/support/tickets/:id — une demande du compte connecté (404 sinon). */
export const GET = route(async (_request, context: Ctx) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  return ok({ ticket: await chargerMaDemande(auth.user.id, id ?? '') });
});
