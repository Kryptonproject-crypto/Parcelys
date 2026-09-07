import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/rbac';
import { setActiveFarm } from '@/lib/auth/session';
import { ok, parseBody, route } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';

const schema = z.object({ farmId: z.string().min(1) });

/**
 * POST /api/farms/switch — change l'exploitation active de la session.
 * L'appartenance est revérifiée : on ne peut basculer que vers une exploitation
 * dont on est membre.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const input = await parseBody(request, schema);

  const membership = auth.memberships.find((m) => m.farmId === input.farmId);
  if (!membership) throw notFound('Exploitation introuvable');

  await setActiveFarm(auth.sessionId, membership.farmId);

  return ok({
    message: `Exploitation active : ${membership.farmName}`,
    farmId: membership.farmId,
    role: membership.role,
  });
});
