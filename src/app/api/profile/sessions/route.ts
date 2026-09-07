import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

/** GET /api/profile/sessions — sessions actives de l'utilisateur. */
export const GET = route(async () => {
  const auth = await requireAuth();

  const sessions = await prisma.session.findMany({
    where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return ok({
    items: sessions.map((s) => ({ ...s, current: s.id === auth.sessionId })),
  });
});

const revokeSchema = z.object({ sessionId: z.string().min(1) });

/** DELETE /api/profile/sessions — révoque une session précise. */
export const DELETE = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const input = await parseBody(request, revokeSchema);

  const { count } = await prisma.session.updateMany({
    where: { id: input.sessionId, userId: auth.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) throw notFound('Session introuvable');

  await logAudit({
    action: 'auth.logout',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    metadata: { revokedSessionId: input.sessionId },
  });

  return ok({ message: 'Session révoquée' });
});
