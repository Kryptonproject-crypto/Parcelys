import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { getEnv } from '@/lib/env';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { MaintenancePanel } from '@/app/(admin)/administration/maintenance/MaintenancePanel';
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  formatDateLongFr,
} from '@/components/ui';
import { IconMaintenance, IconServer } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Maintenance — Administration' };
export const dynamic = 'force-dynamic';

/** Interrogations directes de PostgreSQL : version, PostGIS, taille de la base. */
async function databaseHealth(): Promise<{
  postgres: string;
  postgis: string | null;
  sizeMb: number | null;
  error: string | null;
}> {
  try {
    const [versionRow] = await prisma.$queryRaw<Array<{ version: string }>>`
      SELECT version() AS version
    `;
    const [postgisRow] = await prisma.$queryRaw<Array<{ v: string }>>`
      SELECT postgis_lib_version() AS v
    `;
    const [sizeRow] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT pg_database_size(current_database()) AS bytes
    `;

    return {
      // « PostgreSQL 16.4 on x86_64… » → on garde les deux premiers mots.
      postgres:
        versionRow?.version.split(' ').slice(0, 2).join(' ') ?? 'PostgreSQL',
      postgis: postgisRow?.v ?? null,
      sizeMb: sizeRow ? Number(sizeRow.bytes) / (1024 * 1024) : null,
      error: null,
    };
  } catch (error) {
    return {
      postgres: 'indisponible',
      postgis: null,
      sizeMb: null,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    };
  }
}

export default async function AdminMaintenancePage() {
  await requirePageAdmin();
  const env = getEnv();

  const now = new Date();
  const [mode, health, ephy, counts] = await Promise.all([
    getMaintenanceMode(),
    databaseHealth(),
    getEphySourceInfo(),
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
        description="État de l'instance, mode maintenance et purges de données périmées."
      />

      <div className="grid gap-5 lg:grid-cols-2">
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

        {/* État système */}
        <Card>
          <CardHeader
            icon={IconServer}
            title="État du système"
            description="Valeurs relevées à l'instant, sans mise en cache."
          />

          <dl className="divide-y divide-line text-sm">
            {[
              {
                label: 'Base de données',
                value: health.error ? (
                  <Badge tone="red">{health.error}</Badge>
                ) : (
                  health.postgres
                ),
              },
              {
                label: 'Extension PostGIS',
                value: health.postgis ? (
                  <Badge tone="green">{health.postgis}</Badge>
                ) : (
                  <Badge tone="red">absente</Badge>
                ),
              },
              {
                label: 'Taille de la base',
                value:
                  health.sizeMb === null
                    ? '—'
                    : `${health.sizeMb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`,
              },
              {
                label: 'Référentiel E-Phy',
                value: ephy.configured ? (
                  <>
                    {ephy.productsInBase.toLocaleString('fr-FR')} produits ·{' '}
                    {ephy.lastSyncAt
                      ? formatDateLongFr(ephy.lastSyncAt)
                      : 'jamais synchronisé'}
                  </>
                ) : (
                  <Badge tone="amber">non configuré</Badge>
                ),
              },
              {
                label: 'Fournisseur e-mail',
                value:
                  env.EMAIL_PROVIDER === 'console' ? (
                    <Badge tone="amber">console (développement)</Badge>
                  ) : (
                    <Badge tone="green">{env.EMAIL_PROVIDER}</Badge>
                  ),
              },
              {
                label: 'Fournisseur météo',
                value: env.WEATHER_PROVIDER,
              },
              {
                label: 'Limitation de débit',
                value: env.RATE_LIMIT_ENABLED ? (
                  <Badge tone="green">activée</Badge>
                ) : (
                  <Badge tone="red">désactivée</Badge>
                ),
              },
              {
                label: 'Durée de session',
                value: `${env.SESSION_TTL_HOURS} h (inactivité : ${env.SESSION_IDLE_TIMEOUT_HOURS} h)`,
              },
              { label: 'URL publique', value: env.APP_URL },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-ink-3">{row.label}</dt>
                <dd className="truncate text-right text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
            Les clés d&apos;API et identifiants ne sont jamais affichés ici : ils restent dans
            l&apos;environnement du serveur.
          </p>
        </Card>
      </div>
    </>
  );
}
