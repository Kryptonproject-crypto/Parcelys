import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api/errors';
import { requirePageAuth } from '@/lib/auth/page-guards';
import { chargerMaDemande, type RequesterTicketView } from '@/lib/support/tickets';
import { LIBELLES_STATUT, TONS_STATUT, libelleRubrique } from '@/lib/shared/support';
import { Alert, Badge, PageHeader } from '@/components/ui';
import { IconArrowLeft, IconSupport } from '@/components/ui/icons';
import { Conversation } from '@/components/support/Conversation';
import { RequesterReply } from '@/app/(compte)/mes-demandes/[id]/RequesterReply';

export const metadata: Metadata = { title: 'Ma demande' };
export const dynamic = 'force-dynamic';

/** Une demande du compte connecté. Celle d'un autre compte : introuvable. */
export default async function MaDemandePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth();
  const { id } = await params;
  let demande: RequesterTicketView;
  try {
    demande = await chargerMaDemande(auth.user.id, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const elements = [
    {
      id: 'initial',
      authorKind: 'REQUESTER' as const,
      authorName: 'Vous',
      body: demande.description,
      internal: false,
      createdAt: demande.createdAt,
      attachments: demande.initialAttachments,
    },
    ...demande.messages.map((m) => ({ ...m, authorName: m.authorKind === 'REQUESTER' ? 'Vous' : m.authorName })),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={IconSupport}
        title={demande.subject}
        breadcrumb={
          <Link href="/mes-demandes" className="inline-flex items-center gap-1 hover:underline">
            <IconArrowLeft size={14} aria-hidden /> Mes demandes
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{demande.number}</span>
            <span className="shrink-0">
              <Badge tone={TONS_STATUT[demande.status]}>{LIBELLES_STATUT[demande.status]}</Badge>
            </span>
            <span>{libelleRubrique(demande.area)}</span>
            {demande.declaredNumber ? <span className="font-mono">{demande.declaredNumber}</span> : null}
          </span>
        }
      />
      <div className="space-y-5">
        {demande.status === 'WAITING_CUSTOMER' ? (
          <Alert tone="info">Le support attend votre réponse.</Alert>
        ) : null}
        <Conversation
          elements={elements}
          pieceHref={(pieceId) => `/api/support/tickets/${demande.id}/pieces/${pieceId}`}
        />
        {demande.status === 'CLOSED' ? (
          <Alert tone="info">
            Cette demande est fermée. Pour une nouvelle question,{' '}
            <Link href="/contact" className="font-medium underline">
              ouvrez une demande
            </Link>
            .
          </Alert>
        ) : (
          <RequesterReply ticketId={demande.id} />
        )}
      </div>
    </div>
  );
}
