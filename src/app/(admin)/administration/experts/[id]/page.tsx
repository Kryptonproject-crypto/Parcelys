import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { engagementScope, technicianScope, ticketScope } from '@/lib/admin/scope';
import { adminCan } from '@/lib/admin/roles';
import { listPortfolioOptions } from '@/lib/admin/overview';
import { LIBELLES_STATUT, TONS_STATUT } from '@/lib/shared/support';
import { Badge, Card, CardHeader, PageHeader, formatDateFr } from '@/components/ui';
import {
  IconAdvisor,
  IconArrowLeft,
  IconEngagement,
  IconPortfolio,
  IconSupport,
} from '@/components/ui/icons';
import { AssignPortfolio } from '@/app/(admin)/administration/AssignPortfolio';

export const metadata: Metadata = { title: 'Technicien — Administration' };
export const dynamic = 'force-dynamic';

/** Fiche d'un technicien (compte expert agronomique). Hors périmètre : introuvable. */
export default async function AdminTechnicianPage({ params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requirePageAdminScope('technicians:read');
  const { id } = await params;

  const tech = await prisma.user.findFirst({
    where: { id, deletedAt: null, ...technicianScope(scope) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      organization: true,
      advisorCertificate: true,
      technicianNumber: true,
      portfolioId: true,
      portfolio: { select: { name: true } },
      suspendedAt: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      engagements: {
        where: engagementScope(scope),
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          farm: { select: { id: true, name: true, customerNumber: true } },
        },
      },
    },
  });
  if (!tech) notFound();

  const [tickets, portfolios] = await Promise.all([
    prisma.supportTicket.findMany({
      where: { technicianId: tech.id, ...ticketScope(scope) },
      orderBy: { lastActivityAt: 'desc' },
      take: 10,
      select: { id: true, number: true, subject: true, status: true },
    }),
    adminCan(scope.role, 'clients:assign') ? listPortfolioOptions(scope) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        icon={IconAdvisor}
        title={`${tech.firstName} ${tech.lastName}`}
        breadcrumb={
          <Link href="/administration/experts" className="inline-flex items-center gap-1 hover:underline">
            <IconArrowLeft size={14} aria-hidden /> Techniciens
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ink-2">{tech.technicianNumber ?? 'sans numéro'}</span>
            {tech.suspendedAt ? <Badge tone="red">Suspendu</Badge> : <Badge tone="green">Actif</Badge>}
            {!tech.emailVerifiedAt ? <Badge tone="amber">Adresse non vérifiée</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={IconAdvisor} title="Identité" />
          <dl className="divide-y divide-line text-sm">
            {[
              ['Numéro technicien', tech.technicianNumber ?? '—'],
              ['Adresse', tech.email],
              ['Téléphone', tech.phone ?? 'non renseigné'],
              ['Structure', tech.organization ?? 'non renseignée'],
              ['Certiphyto conseil', tech.advisorCertificate ?? 'non renseigné (déclaratif, non vérifié)'],
              ['Inscrit le', formatDateFr(tech.createdAt)],
              ['Dernière connexion', tech.lastLoginAt ? formatDateFr(tech.lastLoginAt) : 'jamais'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2">
                <dt className="text-ink-3">{label}</dt>
                <dd className="break-all text-right text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader
            icon={IconPortfolio}
            title="Portefeuille de gestion"
            description={
              tech.portfolio
                ? `Géré par les administrateurs de « ${tech.portfolio.name} ».`
                : "Aucun portefeuille : seule l'administration générale suit ce technicien."
            }
          />
          {scope.all ? (
            <AssignPortfolio
              kind="technician"
              ids={[tech.id]}
              label={`${tech.firstName} ${tech.lastName}`}
              current={tech.portfolioId}
              portfolios={portfolios}
            />
          ) : (
            <p className="text-sm text-ink-3">
              Seul l&apos;administrateur général attribue ou transfère un technicien.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={IconEngagement}
            title="Exploitations suivies"
            description={scope.all ? undefined : 'Celles de vos portefeuilles seulement.'}
          />
          {tech.engagements.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune mission.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {tech.engagements.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`/administration/exploitations/${e.farm.id}`} className="min-w-0 hover:underline">
                    <span className="font-medium text-ink">{e.farm.name}</span>{' '}
                    <span className="font-mono text-[12px] text-ink-3">{e.farm.customerNumber}</span>
                  </Link>
                  <Badge tone={e.status === 'ACTIVE' ? 'green' : 'neutral'}>
                    {e.status === 'ACTIVE'
                      ? `Depuis le ${formatDateFr(e.startedAt)}`
                      : `Terminée le ${formatDateFr(e.endedAt)}`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12.5px] text-ink-3">
            Ouvrir ou retirer une mission : page{' '}
            <Link href="/administration/experts" className="underline">
              Techniciens
            </Link>
            .
          </p>
        </Card>

        <Card>
          <CardHeader icon={IconSupport} title="Demandes de support" />
          {tickets.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune demande.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {tickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/administration/support/${t.id}`} className="min-w-0 truncate hover:underline">
                    {t.number} · {t.subject}
                  </Link>
                  <span className="shrink-0">
                    <Badge tone={TONS_STATUT[t.status]}>{LIBELLES_STATUT[t.status]}</Badge>
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
