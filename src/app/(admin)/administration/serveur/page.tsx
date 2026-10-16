import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { databaseHealth, serverState } from '@/lib/admin/serveur';
import { getEnv } from '@/lib/env';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { getUpdateStatus } from '@/lib/updates/releases';
import { Alert, Badge, Card, CardHeader, PageHeader, formatDateLongFr } from '@/components/ui';
import { IconActivity, IconNumber, IconServer } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'État du serveur — Administration' };
export const dynamic = 'force-dynamic';

const fr = (n: number, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

/**
 * État du serveur — administrateur général seul.
 *
 * Une page de lecture : aucune commande système n'y est exposée. Redémarrer
 * ou mettre à jour se fait sur la machine (`scripts/update-pi.sh`), avec une
 * sauvegarde préalable — pas depuis un bouton dans un navigateur.
 */
export default async function AdminServerPage() {
  await requirePageAdminScope('server:read');
  const env = getEnv();
  const [health, state, ephy, updates] = await Promise.all([
    databaseHealth(),
    serverState(),
    getEphySourceInfo(),
    getUpdateStatus(),
  ]);

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Version de Parcelys', value: updates.current },
    {
      label: 'Base de données',
      value: health.error ? <Badge tone="red">{health.error}</Badge> : health.postgres,
    },
    {
      label: 'Extension PostGIS',
      value: health.postgis ? <Badge tone="green">{health.postgis}</Badge> : <Badge tone="red">absente</Badge>,
    },
    { label: 'Taille de la base', value: health.sizeMb === null ? '—' : `${fr(health.sizeMb)} Mo` },
    {
      label: 'Migrations',
      value: state.migrations ? (
        <>
          {state.migrations.applied} appliquée(s)
          {state.migrations.failed > 0 ? (
            <Badge tone="red" className="ml-2">
              {state.migrations.failed} en échec
            </Badge>
          ) : null}
          <span className="block text-[12px] text-ink-3">{state.migrations.last}</span>
        </>
      ) : (
        'illisibles'
      ),
    },
    {
      label: 'Référentiel E-Phy',
      value: ephy.configured ? (
        <>
          {ephy.productsInBase.toLocaleString('fr-FR')} produits ·{' '}
          {ephy.lastSyncAt ? formatDateLongFr(ephy.lastSyncAt) : 'jamais synchronisé'}
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
      label: 'Limitation de débit',
      value: env.RATE_LIMIT_ENABLED ? <Badge tone="green">activée</Badge> : <Badge tone="red">désactivée</Badge>,
    },
    { label: 'Durée de session', value: `${env.SESSION_TTL_HOURS} h (inactivité : ${env.SESSION_IDLE_TIMEOUT_HOURS} h)` },
    { label: 'URL publique', value: env.APP_URL },
  ];

  const machine: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Node.js', value: state.node },
    { label: 'Système', value: state.platform },
    { label: 'Processus en service depuis', value: `${fr(state.uptimeHours)} h` },
    { label: 'Mémoire du processus', value: `${fr(state.processRssMb, 0)} Mo` },
    {
      label: 'Mémoire de la machine',
      value: `${fr(state.memory.freeMb, 0)} Mo libres sur ${fr(state.memory.totalMb, 0)} Mo`,
    },
    { label: 'Charge (1, 5, 15 min)', value: `${state.load.map((l) => fr(l, 2)).join(' · ')} — ${state.cpus} cœur(s)` },
    {
      label: 'Espace disque',
      value: state.disk ? (
        <>
          {fr(state.disk.freeGb)} Go libres sur {fr(state.disk.totalGb)} Go
          {state.disk.freeGb < 2 ? (
            <Badge tone="red" className="ml-2">
              faible
            </Badge>
          ) : null}
        </>
      ) : (
        'non mesurable'
      ),
    },
  ];

  const liste = (items: typeof rows) => (
    <dl className="divide-y divide-line text-sm">
      {items.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="shrink-0 text-ink-3">{row.label}</dt>
          <dd className="min-w-0 break-words text-right text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <PageHeader
        icon={IconServer}
        title="État du serveur"
        description="Valeurs relevées à l'instant, sans mise en cache. Lecture seule."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={IconServer} title="Service" />
          {liste(rows)}
        </Card>
        <Card>
          <CardHeader icon={IconActivity} title="Machine" />
          {liste(machine)}
        </Card>
        <Card>
          <CardHeader
            icon={IconNumber}
            title="Compteurs de numéros"
            description="Dernier numéro attribué par série. Ils ne redescendent jamais."
          />
          {liste(
            state.counters.map((c) => ({
              label: c.prefix === 'EXP' ? 'Exploitations (EXP)' : c.prefix === 'TEC' ? 'Techniciens (TEC)' : 'Demandes (DEM)',
              value: c.lastValue.toLocaleString('fr-FR'),
            })),
          )}
        </Card>
        <Card>
          <CardHeader title="Redémarrer, mettre à jour" />
          <Alert tone="info">
            Aucune commande système n&apos;est exposée dans l&apos;interface. La mise à jour et le
            redémarrage se font sur le serveur, par{' '}
            <code>sudo bash scripts/update-pi.sh</code>, qui sauvegarde la base avant
            d&apos;appliquer les migrations. Les clés et mots de passe restent dans
            l&apos;environnement du serveur et ne sont jamais affichés.
          </Alert>
        </Card>
      </div>
    </>
  );
}
