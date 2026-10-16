import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { getAdminStats } from '@/lib/admin/overview';
import { getMaintenanceMode } from '@/lib/admin/settings';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { listerDemandesAdmin } from '@/lib/support/tickets';
import { LIBELLES_STATUT, TONS_STATUT } from '@/lib/shared/support';
import {
  Alert,
  Badge,
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
  IconAdvisor,
  IconArea,
  IconAudit,
  IconExport,
  IconFarm,
  IconInvitation,
  IconMaintenance,
  IconPhyto,
  IconPortfolio,
  IconSupport,
  IconUsers,
} from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

/**
 * Tableau de bord d'administration.
 *
 * Le même écran pour les deux niveaux, mais pas les mêmes chiffres : chaque
 * compteur passe par le périmètre (`getAdminStats(scope)`). L'administrateur
 * secondaire voit son portefeuille ; il ne voit ni le journal, ni la
 * maintenance, ni le référentiel E-Phy, qui sont l'affaire du général.
 */
export default async function AdminOverviewPage() {
  const auth = await requirePageAdminScope('dashboard:read');
  const { scope } = auth;
  const general = scope.all;

  const [stats, maintenance, ephy, recentAudit, tickets] = await Promise.all([
    getAdminStats(scope),
    general ? getMaintenanceMode() : Promise.resolve(null),
    general ? getEphySourceInfo() : Promise.resolve(null),
    general
      ? prisma.auditLog.findMany({
          where: {
            action: {
              in: [
                'invitation.created',
                'invitation.revoked',
                'admin.user_suspended',
                'admin.user_restored',
                'admin.user_deleted',
                'admin.platform_role_changed',
                'admin.maintenance_changed',
                'admin.secondary_invited',
                'admin.secondary_revoked',
                'admin.secondary_scope_added',
                'admin.secondary_scope_removed',
                'portfolio.client_assigned',
                'auth.register',
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { user: { select: { email: true } } },
        })
      : Promise.resolve([]),
    listerDemandesAdmin({ scope, statut: 'ouvertes', pageSize: 5 }),
  ]);

  return (
    <>
      <PageHeader
        icon={IconAdmin}
        title={general ? 'Administration générale' : 'Administration de portefeuille'}
        description={
          general
            ? "Tout Parcelys : comptes, exploitations, techniciens, demandes et réglages."
            : `Vos clients : ${scope.portfolios.map((p) => p.name).join(', ') || 'aucun portefeuille confié'}.`
        }
        actions={
          <>
            <LinkButton href="/administration/invitations" icon={IconInvitation} variant="primary">
              Inviter quelqu&apos;un
            </LinkButton>
            <LinkButton href="/administration/support" icon={IconSupport} variant="outline">
              Support
            </LinkButton>
          </>
        }
      />

      {maintenance?.enabled ? (
        <div className="mb-5">
          <Alert tone="warning" title="Mode maintenance actif" icon={IconMaintenance}>
            Seuls les administrateurs généraux accèdent actuellement à l&apos;application.{' '}
            <a href="/administration/maintenance" className="font-medium underline">
              Lever la maintenance
            </a>
          </Alert>
        </div>
      ) : null}

      {!general && scope.portfolioIds.length === 0 ? (
        <div className="mb-5">
          <Alert tone="warning" title="Aucun portefeuille ne vous est confié">
            Vous ne voyez donc aucun client. L&apos;administrateur général peut vous en
            attribuer un.
          </Alert>
        </div>
      ) : null}

      <section aria-label="Chiffres clés" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Exploitations"
          value={formatCompactFr(stats.farms.total, 0)}
          hint={
            general && stats.farms.unassigned > 0
              ? `dont ${stats.farms.unassigned} sans portefeuille`
              : stats.farms.demo > 0
                ? `dont ${stats.farms.demo} de démonstration`
                : `${formatNumberFr(stats.parcels.areaHa, 1)} ha · ${stats.parcels.total} parcelle(s)`
          }
          icon={IconFarm}
          href="/administration/exploitations"
          accent
        />
        <StatCard
          label="Techniciens"
          value={formatCompactFr(stats.technicians.total, 0)}
          hint={
            general && stats.technicians.unassigned > 0
              ? `dont ${stats.technicians.unassigned} sans portefeuille`
              : 'Experts agronomiques'
          }
          icon={IconAdvisor}
          href="/administration/experts"
        />
        <StatCard
          label="Comptes"
          value={formatCompactFr(stats.users.active, 0)}
          hint={`${stats.users.total} au total · ${stats.users.newLast30Days} sur 30 jours`}
          icon={IconUsers}
          href="/administration/utilisateurs"
        />
        <StatCard
          label="Demandes ouvertes"
          value={formatCompactFr(stats.support.open, 0)}
          hint={`${stats.support.new} nouvelle(s) · ${stats.support.waiting} en attente du client`}
          icon={IconSupport}
          href="/administration/support"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={IconSupport}
            title="Demandes à traiter"
            description={general ? 'Toutes les demandes ouvertes.' : 'Les demandes ouvertes de vos portefeuilles.'}
            action={
              <LinkButton href="/administration/support" variant="ghost" size="sm">
                Toutes
              </LinkButton>
            }
          />
          {tickets.rows.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune demande ouverte.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {tickets.rows.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/administration/support/${t.id}`} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium text-ink">
                      {t.number} · {t.subject}
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      {t.requesterName}
                      {t.declaredNumber ? ` · ${t.declaredNumber}` : ''}
                    </span>
                  </Link>
                  <span className="shrink-0">
                    <Badge tone={TONS_STATUT[t.status]}>{LIBELLES_STATUT[t.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={IconInvitation}
            title="Accès à Parcelys"
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
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-2">
            <strong className="text-ink">{stats.users.suspended}</strong> compte(s) suspendu(s) ·{' '}
            <strong className="text-ink">{stats.users.unverified}</strong> adresse(s) non vérifiée(s)
            {general ? (
              <>
                {' '}
                · <strong className="text-ink">{stats.users.admins}</strong> administrateur(s)
              </>
            ) : null}
          </p>
        </Card>

        <Card>
          <CardHeader
            icon={IconArea}
            title="Volume de données"
            description={
              general
                ? "Enregistrements saisis sur l'ensemble des exploitations."
                : 'Enregistrements saisis dans les exploitations de vos portefeuilles.'
            }
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
          {ephy ? (
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
          ) : null}
        </Card>

        <Card>
          <CardHeader
            icon={IconPortfolio}
            title={general ? 'Portefeuilles' : 'Mes portefeuilles'}
            description={
              general
                ? `${stats.portfolios} portefeuille(s) de gestion.`
                : 'Les clients que vous gérez.'
            }
            action={
              general ? (
                <LinkButton href="/administration/portefeuilles" variant="ghost" size="sm">
                  Gérer
                </LinkButton>
              ) : null
            }
          />
          {general ? (
            <p className="text-sm text-ink-2">
              Un client sans portefeuille relève de vous seul.{' '}
              {stats.farms.unassigned + stats.technicians.unassigned > 0 ? (
                <Link className="font-medium underline" href="/administration/exploitations?statut=sans-portefeuille">
                  {stats.farms.unassigned} exploitation(s) et {stats.technicians.unassigned} technicien(s) à attribuer
                </Link>
              ) : (
                'Tous les clients ont un portefeuille.'
              )}
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {scope.portfolios.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-ink">
                  <IconPortfolio size={15} aria-hidden className="text-ink-3" />
                  {p.name}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/api/admin/exports?type=exploitations" variant="outline" size="sm" icon={IconExport} prefetch={false}>
              Exploitations (CSV)
            </LinkButton>
            <LinkButton href="/api/admin/exports?type=demandes" variant="outline" size="sm" icon={IconExport} prefetch={false}>
              Demandes (CSV)
            </LinkButton>
          </div>
        </Card>
      </div>

      {general ? (
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
                        sur `overflow: hidden`, qu'une boîte en ligne ignore. */}
                    <span className="flex min-w-0 items-center gap-2">
                      <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink-2">
                        {entry.action}
                      </code>
                      {entry.user ? (
                        <span className="min-w-0 truncate text-ink-3">{entry.user.email}</span>
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
      ) : null}
    </>
  );
}
