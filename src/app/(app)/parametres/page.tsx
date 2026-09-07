import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { roleHasPermission, ROLE_LABELS } from '@/lib/auth/rbac';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { FarmForm } from '@/app/(app)/parametres/FarmForm';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  PageHeader,
  formatDateFr,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Paramètres' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requirePageFarmAccess('farm:read');

  const [farm, members, ephySource, lastSyncRun] = await Promise.all([
    prisma.farm.findUniqueOrThrow({ where: { id: ctx.farmId } }),
    prisma.farmMember.findMany({
      where: { farmId: ctx.farmId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    getEphySourceInfo(),
    prisma.ephySyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
  ]);

  const canManageMembers = roleHasPermission(ctx.role, 'member:read');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Paramètres"
        description={`Exploitation « ${farm.name} » — votre rôle : ${ROLE_LABELS[ctx.role]}`}
      />

      <div className="space-y-5">
        <FarmForm
          farm={{
            name: farm.name,
            siret: farm.siret,
            addressLine: farm.addressLine,
            postalCode: farm.postalCode,
            city: farm.city,
            department: farm.department,
            latitude: farm.latitude,
            longitude: farm.longitude,
          }}
          canEdit={roleHasPermission(ctx.role, 'farm:update')}
        />

        {/* Membres */}
        {canManageMembers ? (
          <Card>
            <CardHeader
              title="Membres de l'exploitation"
              description={`${members.length} membre(s). Les permissions sont vérifiées côté serveur pour chaque action.`}
            />
            <ul className="divide-y divide-line">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {member.user.firstName} {member.user.lastName}
                    </p>
                    <p className="truncate text-sm text-ink-3">{member.user.email}</p>
                  </div>
                  <Badge tone={member.role === 'OWNER' ? 'green' : 'neutral'}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-lg bg-surface-2 p-3.5 text-sm text-ink-2">
              <p className="font-medium text-ink">Rôles disponibles</p>
              <ul className="mt-1.5 space-y-1">
                <li>
                  <strong>Propriétaire</strong> — accès complet, y compris la suppression de
                  l&apos;exploitation.
                </li>
                <li>
                  <strong>Administrateur</strong> — gère les parcelles, les membres et les
                  paramètres.
                </li>
                <li>
                  <strong>Salarié</strong> — saisit les interventions et les documents.
                </li>
                <li>
                  <strong>Lecture seule</strong> — consultation et exports uniquement.
                </li>
              </ul>
            </div>
          </Card>
        ) : null}

        {/* Référentiel E-Phy */}
        <Card>
          <CardHeader
            title="Référentiel phytosanitaire E-Phy"
            description="Source des données réglementaires utilisées par Parcelys."
          />

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Produits en base
              </dt>
              <dd className="mt-0.5 text-sm text-ink">
                {ephySource.productsInBase.toLocaleString('fr-FR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Dernière synchronisation réussie
              </dt>
              <dd className="mt-0.5 text-sm text-ink">
                {ephySource.lastSyncAt ? formatDateFr(ephySource.lastSyncAt) : 'Jamais'}
              </dd>
            </div>
            {lastSyncRun ? (
              <>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                    Dernière tentative
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink">
                    {formatDateFr(lastSyncRun.startedAt)} —{' '}
                    <Badge tone={lastSyncRun.status === 'SUCCESS' ? 'green' : 'red'}>
                      {lastSyncRun.status}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                    Source
                  </dt>
                  <dd className="mt-0.5 truncate text-sm text-ink">
                    {lastSyncRun.source}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>

          {lastSyncRun?.errorMessage ? (
            <div className="mt-4">
              <Alert tone="warning" title="Remarques de la dernière synchronisation">
                {lastSyncRun.errorMessage}
              </Alert>
            </div>
          ) : null}

          <div className="mt-4">
            <Alert tone={ephySource.configured ? 'info' : 'warning'}>
              {ephySource.configured ? (
                <>
                  {ephySource.label}. La synchronisation s&apos;exécute côté serveur avec{' '}
                  <code className="rounded bg-surface/60 px-1">npm run ephy:sync</code> ;
                  planifiez-la (tâche cron) pour maintenir le catalogue à jour.
                </>
              ) : (
                <>
                  Aucun produit en base. Parcelys ne génère jamais de donnée réglementaire :
                  renseignez <code className="rounded bg-surface/60 px-1">EPHY_DATA_URL</code>{' '}
                  avec l&apos;URL de l&apos;archive officielle publiée par l&apos;ANSES sur
                  data.gouv.fr, puis lancez{' '}
                  <code className="rounded bg-surface/60 px-1">npm run ephy:sync</code>.
                </>
              )}
            </Alert>
          </div>
        </Card>

        {/* Confidentialité */}
        <Card>
          <CardHeader title="Confidentialité et données" />
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/profil" className="text-champ-700 dark:text-champ-400 hover:underline">
                Exporter ou supprimer mes données personnelles
              </Link>
            </li>
            <li>
              <Link href="/confidentialite" className="text-champ-700 dark:text-champ-400 hover:underline">
                Politique de confidentialité
              </Link>
            </li>
            <li>
              <Link href="/cgu" className="text-champ-700 dark:text-champ-400 hover:underline">
                Conditions générales d&apos;utilisation
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
