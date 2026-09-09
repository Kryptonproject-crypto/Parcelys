import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import { getAdminStats } from '@/lib/admin/overview';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { getEphySourceInfo } from '@/lib/ephy/search';
import {
  Alert,
  Card,
  CardHeader,
  LinkButton,
  PageHeader,
  StatCard,
  formatCompactFr,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import {
  IconAdmin,
  IconArea,
  IconAudit,
  IconFarm,
  IconInvitation,
  IconMaintenance,
  IconParcels,
  IconPhyto,
  IconSecurity,
  IconUsers,
} from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const auth = await requirePageAdmin();

  const [stats, maintenance, ephy, recentAudit] = await Promise.all([
    getAdminStats(),
    getMaintenanceMode(),
    getEphySourceInfo(),
    prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'invitation.created',
            'invitation.revoked',
            'invitation.used',
            'invitation.rejected',
            'admin.user_suspended',
            'admin.user_restored',
            'admin.user_deleted',
            'admin.platform_role_changed',
            'admin.maintenance_changed',
            'auth.register',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { email: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        icon={IconAdmin}
        title="Administration"
        description={`Instance Parcelys — connecté en tant que ${auth.user.email}`}
        actions={
          <>
            <LinkButton
              href="/administration/invitations"
              icon={IconInvitation}
              variant="primary"
            >
              Inviter quelqu&apos;un
            </LinkButton>
            <LinkButton
              href="/administration/utilisateurs"
              icon={IconUsers}
              variant="outline"
            >
              Utilisateurs
            </LinkButton>
          </>
        }
      />

      {maintenance.enabled ? (
        <div className="mb-5">
          <Alert tone="warning" title="Mode maintenance actif" icon={IconMaintenance}>
            Seuls les administrateurs accèdent actuellement à l&apos;application.{' '}
            <a href="/administration/maintenance" className="font-medium underline">
              Lever la maintenance
            </a>
          </Alert>
        </div>
      ) : null}

      <section aria-label="Chiffres clés" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Comptes actifs"
          value={formatCompactFr(stats.users.active, 0)}
          hint={`${stats.users.total} au total · ${stats.users.newLast30Days} sur 30 jours`}
          icon={IconUsers}
          href="/administration/utilisateurs"
          accent
        />
        <StatCard
          label="Exploitations"
          value={formatCompactFr(stats.farms.total, 0)}
          hint={
            stats.farms.demo > 0
              ? `dont ${stats.farms.demo} de démonstration`
              : 'aucune exploitation de démonstration'
          }
          icon={IconFarm}
          href="/administration/exploitations"
        />
        <StatCard
          label="Parcelles"
          value={formatCompactFr(stats.parcels.total, 0)}
          unit={`· ${formatNumberFr(stats.parcels.areaHa, 1)} ha`}
          hint="Surfaces calculées par PostGIS"
          icon={IconParcels}
        />
        <StatCard
          label="Sessions ouvertes"
          value={formatCompactFr(stats.sessions.active, 0)}
          hint="Sessions non révoquées et non expirées"
          icon={IconSecurity}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Accès */}
        <Card>
          <CardHeader
            icon={IconInvitation}
            title="Accès à l'instance"
            description="Les inscriptions publiques sont fermées : un code est nécessaire."
          />

          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: 'Codes actifs', value: stats.invitations.active },
              { label: 'Codes utilisés', value: stats.invitations.used },
              { label: 'Codes expirés', value: stats.invitations.expired },
              { label: 'Codes révoqués', value: stats.invitations.revoked },
            ].map((row) => (
              <div key={row.label} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  {row.label}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 space-y-2 text-sm text-ink-2">
            <p>
              <strong className="text-ink">{stats.users.admins}</strong> administrateur(s)
              de l&apos;instance ·{' '}
              <strong className="text-ink">{stats.users.suspended}</strong> compte(s)
              suspendu(s) ·{' '}
              <strong className="text-ink">{stats.users.unverified}</strong> adresse(s)
              non vérifiée(s)
            </p>
          </div>
        </Card>

        {/* Contenu et référentiel */}
        <Card>
          <CardHeader
            icon={IconArea}
            title="Volume de données"
            description="Enregistrements saisis sur l'ensemble des exploitations."
          />

          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: 'Apports', value: stats.records.fertilizations },
              { label: 'Traitements', value: stats.records.phyto },
              { label: 'Travaux', value: stats.records.operations },
              { label: 'Documents', value: stats.records.documents },
            ].map((row) => (
              <div key={row.label} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  {row.label}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatCompactFr(row.value, 0)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4">
            <Alert tone={ephy.configured ? 'info' : 'warning'} icon={IconPhyto}>
              Référentiel E-Phy :{' '}
              {ephy.configured ? (
                <>
                  {ephy.productsInBase.toLocaleString('fr-FR')} produits,{' '}
                  {ephy.lastSyncAt
                    ? `dernière synchronisation le ${formatDateFr(ephy.lastSyncAt)}`
                    : 'jamais synchronisé'}
                  .
                </>
              ) : (
                <>
                  aucune donnée officielle importée. Parcelys n&apos;invente aucune
                  information réglementaire : renseignez <code>EPHY_DATA_URL</code> puis
                  lancez <code>npm run ephy:sync</code>.
                </>
              )}
            </Alert>
          </div>
        </Card>
      </div>

      {/* Journal récent */}
      <div className="mt-5">
        <Card>
          <CardHeader
            icon={IconAudit}
            title="Dernières opérations sensibles"
            description="Extrait du journal d'audit."
            action={
              <LinkButton href="/administration/journal" variant="ghost" size="sm">
                Tout le journal
              </LinkButton>
            }
          />

          {recentAudit.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune opération enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recentAudit.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  {/* Conteneur flex, et non `span` en ligne : `truncate` repose
                      sur `overflow: hidden`, qu'une boîte en ligne ignore. Une
                      adresse longue élargissait donc la ligne, et la page
                      entière se mettait à défiler horizontalement. */}
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink-2">
                      {entry.action}
                    </code>
                    {entry.user ? (
                      <span className="min-w-0 truncate text-ink-3">
                        {entry.user.email}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-3">
                    {formatDateFr(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
