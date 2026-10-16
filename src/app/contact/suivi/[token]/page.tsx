import type { Metadata } from 'next';
import Link from 'next/link';
import { ApiError } from '@/lib/api/errors';
import { chargerDemandeParLien } from '@/lib/support/tickets';
import { LIBELLES_STATUT, TONS_STATUT, libelleRubrique } from '@/lib/shared/support';
import { PublicShell } from '@/components/marketing/PublicShell';
import { Conversation } from '@/components/support/Conversation';
import { Alert, Badge } from '@/components/ui';
import { SuiviActions } from '@/app/contact/suivi/[token]/SuiviActions';

export const metadata: Metadata = {
  title: 'Suivi de votre demande',
  // Le lien contient un jeton : il ne doit ni partir en en-tête Referer vers
  // un autre site, ni être indexé.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Suivi d'une demande envoyée sans connexion, par le lien reçu à l'adresse
 * saisie. Le jeton ne donne accès qu'à cette demande, sans les notes
 * internes. Ouvrir le lien ne confirme rien : il faut cliquer — les
 * antivirus de messagerie ouvrent les liens tout seuls.
 */
export default async function SuiviPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let demande: Awaited<ReturnType<typeof chargerDemandeParLien>> | null = null;
  try {
    demande = await chargerDemandeParLien(token);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  if (!demande) {
    return (
      <PublicShell title="Lien de suivi invalide">
        <Alert tone="warning">
          Ce lien n&apos;est plus valable : il a expiré, ou un e-mail plus récent l&apos;a remplacé.
          Utilisez le dernier lien reçu, ou{' '}
          <Link href="/contact" className="font-medium underline">
            écrivez-nous à nouveau
          </Link>{' '}
          en rappelant votre numéro de demande.
        </Alert>
      </PublicShell>
    );
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
    <PublicShell title={demande.subject} description={`Demande ${demande.number} · ${libelleRubrique(demande.area)}`}>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="shrink-0">
          <Badge tone={TONS_STATUT[demande.status]}>{LIBELLES_STATUT[demande.status]}</Badge>
        </span>
        {demande.declaredNumber ? (
          <span className="font-mono text-[13px] text-ink-3">Numéro déclaré : {demande.declaredNumber}</span>
        ) : null}
      </div>
      <SuiviActions token={token} identity={demande.identity} closed={demande.status === 'CLOSED'}>
        <Conversation
          elements={elements}
          pieceHref={(pieceId) => `/contact/suivi/${encodeURIComponent(token)}/pieces/${pieceId}`}
        />
      </SuiviActions>
    </PublicShell>
  );
}
