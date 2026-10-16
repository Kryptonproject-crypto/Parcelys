import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api/errors';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { adminCan } from '@/lib/admin/roles';
import { listPortfolioOptions } from '@/lib/admin/overview';
import { chargerDemandeAdmin, type AdminTicketView } from '@/lib/support/tickets';
import {
  LIBELLES_IDENTITE,
  LIBELLES_STATUT,
  TONS_STATUT,
  libelleRubrique,
} from '@/lib/shared/support';
import { Alert, Badge, Card, CardHeader, PageHeader, formatDateLongFr } from '@/components/ui';
import { IconArrowLeft, IconHistory, IconSecurity, IconSupport } from '@/components/ui/icons';
import { Conversation } from '@/components/support/Conversation';
import { TicketActions } from '@/app/(admin)/administration/support/[id]/TicketActions';

export const metadata: Metadata = { title: 'Demande — Administration' };
export const dynamic = 'force-dynamic';

const LIBELLES_EVENEMENT: Record<string, string> = {
  CREATED: 'Demande créée',
  STATUS_CHANGED: 'Statut',
  ASSIGNED: 'Attribution',
  PORTFOLIO_CHANGED: 'Portefeuille',
  IDENTITY_CONFIRMED: 'Adresse e-mail confirmée par le demandeur',
};

function valeurEvenement(kind: string, value: string | null, ticket: AdminTicketView): string {
  if (!value) return '—';
  if (kind === 'STATUS_CHANGED' || kind === 'CREATED') {
    return LIBELLES_STATUT[value as keyof typeof LIBELLES_STATUT] ?? value;
  }
  if (kind === 'ASSIGNED') {
    return ticket.assignableAdmins.find((a) => a.id === value)?.name ?? 'un administrateur';
  }
  return value;
}

/**
 * Une demande de support, côté administration. Hors périmètre : introuvable.
 *
 * Tant que l'identité du demandeur n'est pas établie, l'écran le rappelle en
 * tête : on ne communique aucune donnée de compte à quelqu'un dont on ne sait
 * que l'adresse qu'il a tapée.
 */
export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requirePageAdminScope('support:read');
  const { id } = await params;

  let ticket: AdminTicketView;
  try {
    ticket = await chargerDemandeAdmin(scope, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const portfolios = adminCan(scope.role, 'support:transfer') ? await listPortfolioOptions(scope) : [];
  const conversation = [
    {
      id: 'initial',
      authorKind: 'REQUESTER' as const,
      authorName: ticket.requesterName,
      body: ticket.description,
      internal: false,
      createdAt: ticket.createdAt,
      attachments: ticket.initialAttachments,
    },
    ...ticket.messages,
  ];

  return (
    <>
      <PageHeader
        icon={IconSupport}
        title={ticket.subject}
        breadcrumb={
          <Link href="/administration/support" className="inline-flex items-center gap-1 hover:underline">
            <IconArrowLeft size={14} aria-hidden /> Support
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ink-2">{ticket.number}</span>
            <span className="shrink-0">
              <Badge tone={TONS_STATUT[ticket.status]}>{LIBELLES_STATUT[ticket.status]}</Badge>
            </span>
            <span>{libelleRubrique(ticket.area)}</span>
          </span>
        }
      />

      {ticket.identity !== 'ACCOUNT' ? (
        <div className="mb-5">
          <Alert
            tone={ticket.identity === 'UNVERIFIED' ? 'warning' : 'info'}
            title={LIBELLES_IDENTITE[ticket.identity]}
            icon={IconSecurity}
          >
            {ticket.identity === 'UNVERIFIED'
              ? "Demande envoyée sans connexion, et l'adresse n'a pas encore été confirmée. Ne communiquez aucune donnée de compte ou d'exploitation : invitez la personne à se connecter, ou attendez qu'elle confirme son adresse."
              : ticket.emailMatchesClient
                ? "L'adresse a été confirmée et correspond à un compte du client concerné. Restez prudent sur les données sensibles : une adresse confirmée n'est pas une identité."
                : "L'adresse a été confirmée, mais elle ne correspond à aucun compte du client déclaré. Ne communiquez aucune donnée de ce client."}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Conversation
            elements={conversation}
            pieceHref={(pieceId) => `/api/admin/support/${ticket.id}/pieces/${pieceId}`}
          />
          <TicketActions
            ticketId={ticket.id}
            status={ticket.status}
            assigneeId={ticket.assignee?.id ?? null}
            assignable={ticket.assignableAdmins}
            portfolioId={ticket.portfolio?.id ?? null}
            portfolios={portfolios}
            canTransfer={adminCan(scope.role, 'support:transfer')}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Demandeur" />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-ink-3">Nom</dt>
                <dd className="text-ink">{ticket.requesterName}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Adresse</dt>
                <dd className="break-all text-ink">{ticket.requesterEmail}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Identité</dt>
                <dd>
                  <Badge tone={ticket.identity === 'UNVERIFIED' ? 'amber' : 'green'}>
                    {LIBELLES_IDENTITE[ticket.identity]}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Numéro client {ticket.identity === 'ACCOUNT' ? '' : 'déclaré'}</dt>
                <dd className="font-mono text-ink">{ticket.declaredNumber ?? '—'}</dd>
              </div>
              {ticket.farm ? (
                <div>
                  <dt className="text-ink-3">Exploitation</dt>
                  <dd>
                    <Link className="text-ink underline" href={`/administration/exploitations/${ticket.farm.id}`}>
                      {ticket.farm.name}
                    </Link>{' '}
                    <span className="font-mono text-[12px] text-ink-3">{ticket.farm.customerNumber}</span>
                  </dd>
                </div>
              ) : null}
              {ticket.technician ? (
                <div>
                  <dt className="text-ink-3">Technicien</dt>
                  <dd>
                    <Link className="text-ink underline" href={`/administration/experts/${ticket.technician.id}`}>
                      {ticket.technician.name}
                    </Link>{' '}
                    <span className="font-mono text-[12px] text-ink-3">{ticket.technician.technicianNumber}</span>
                  </dd>
                </div>
              ) : null}
              {ticket.clientOutOfScope ? (
                <p className="text-[12.5px] text-ink-3">Le client concerné n&apos;est pas dans votre périmètre.</p>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Prise en charge" />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-ink-3">Portefeuille</dt>
                <dd className="text-ink">{ticket.portfolio?.name ?? 'Aucun (administration générale)'}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Responsable</dt>
                <dd className="text-ink">{ticket.assignee?.name ?? 'Non attribuée'}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Créée le</dt>
                <dd className="text-ink">{formatDateLongFr(ticket.createdAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader icon={IconHistory} title="Historique" />
            <ol className="space-y-2 text-[13px]">
              {ticket.events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <span className="block text-ink">
                    {LIBELLES_EVENEMENT[e.kind] ?? e.kind}
                    {e.kind === 'STATUS_CHANGED' || e.kind === 'ASSIGNED' || e.kind === 'PORTFOLIO_CHANGED' ? (
                      <>
                        {' '}
                        : {valeurEvenement(e.kind, e.fromValue, ticket)} → {valeurEvenement(e.kind, e.toValue, ticket)}
                      </>
                    ) : null}
                  </span>
                  <span className="block text-[12px] text-ink-3">
                    {formatDateLongFr(e.createdAt)}
                    {e.actorName ? ` · ${e.actorName}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
