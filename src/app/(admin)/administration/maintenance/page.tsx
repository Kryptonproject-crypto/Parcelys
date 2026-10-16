import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { getUpdateStatus } from '@/lib/updates/releases';
import { MaintenancePanel } from '@/app/(admin)/administration/maintenance/MaintenancePanel';
import { UpdatesPanel } from '@/app/(admin)/administration/maintenance/UpdatesPanel';
import { Card, CardHeader, LinkButton, PageHeader } from '@/components/ui';
import { IconMaintenance, IconServer } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Maintenance — Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminMaintenancePage() {
  await requirePageAdminScope('maintenance:manage');

  const now = new Date();
  const [mode, updates, counts] = await Promise.all([
    getMaintenanceMode(),
    getUpdateStatus(),
    Promise.all([
      prisma.session.count({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } }),
      prisma.rateLimitCounter.count({ where: { expiresAt: { lt: now } } }),
      prisma.invitationCode.count({
        where: {
          usedAt: null,
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
        },
      }),
      prisma.auditLog.count({
        where: { createdAt: { lt: new Date(now.getTime() - 365 * 24 * 3600 * 1000) } },
      }),
    ]),
  ]);

  const [staleSessions, staleRateLimits, staleInvitations, oldAuditLogs] = counts;

  return (
    <>
      <PageHeader
        icon={IconMaintenance}
        title="Maintenance"
        description="État du service, mode maintenance et purges de données périmées."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <UpdatesPanel initial={updates} />

        <MaintenancePanel
          initialEnabled={mode.enabled}
          initialMessage={mode.message}
          updatedAt={mode.updatedAt?.toISOString() ?? null}
          purgeable={{
            sessions: staleSessions,
            rateLimits: staleRateLimits,
            invitations: staleInvitations,
            auditLogs: oldAuditLogs,
          }}
        />

        <Card>
          <CardHeader
            icon={IconServer}
            title="État du serveur"
            description="Base, disque, mémoire, migrations et compteurs."
            action={
              <LinkButton href="/administration/serveur" variant="ghost" size="sm">
                Ouvrir
              </LinkButton>
            }
          />
          <p className="text-sm text-ink-2">
            L&apos;état du serveur a sa propre page. Aucune commande système n&apos;est
            exposée dans l&apos;interface.
          </p>
        </Card>
      </div>
    </>
  );
}
