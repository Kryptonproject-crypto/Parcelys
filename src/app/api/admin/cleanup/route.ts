import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { cleanupSchema } from '@/lib/validation/admin';
import { purgeExpiredSessions } from '@/lib/auth/session';
import { purgeExpiredRateLimits } from '@/lib/auth/rate-limit';
import { purgeOldAuditLogs } from '@/lib/audit';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/admin/cleanup — opérations de maintenance.
 *
 * Toutes sont sûres et rejouables : elles ne suppriment que des données
 * périmées (sessions expirées, compteurs de limitation, invitations caduques)
 * et le journal d'audit au-delà de sa durée de conservation.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin();
  const input = await parseBody(request, cleanupSchema);
  const results: Record<string, number> = {};

  if (input.targets.includes('sessions')) {
    results.sessions = await purgeExpiredSessions();
  }

  if (input.targets.includes('rate-limits')) {
    results.rateLimits = await purgeExpiredRateLimits();
  }

  if (input.targets.includes('invitations')) {
    // Seuls les codes expirés ou révoqués et jamais utilisés : l'historique des
    // codes consommés reste consultable.
    const { count } = await prisma.invitationCode.deleteMany({
      where: {
        usedAt: null,
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
      },
    });
    results.invitations = count;
  }

  if (input.targets.includes('audit')) {
    results.auditLogs = await purgeOldAuditLogs(input.auditRetentionDays);
  }

  await logAudit({
    action: 'admin.cleanup_run',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { targets: input.targets, results },
  });

  const summary = Object.entries(results)
    .map(([key, value]) => `${value} ${key}`)
    .join(', ');

  return ok({
    message: summary.length > 0 ? `Purge effectuée : ${summary}.` : 'Rien à purger.',
    results,
  });
});
