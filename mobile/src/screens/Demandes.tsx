import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import {
  ApiError,
  fetchMyTicket,
  fetchMyTickets,
  OfflineError,
  replyToTicket,
  type SupportTicketDetail,
  type SupportTicketSummary,
} from '../lib/api';
import { LIBELLES_STATUT, LIMITES_TEXTE, PIECE_JOINTE, libelleRubrique } from '@commun/support';
import { Badge, Banner, Button, Card, EmptyState, Field, Header, Spinner, Textarea, formatDateFr } from '../components/ui';

const TON: Record<string, 'neutral' | 'green' | 'amber' | 'red'> = {
  NEW: 'amber',
  IN_PROGRESS: 'amber',
  WAITING_CUSTOMER: 'neutral',
  RESOLVED: 'green',
  CLOSED: 'neutral',
};

/** Mes demandes de support : liste. */
export function DemandesScreen({ context }: { context: AppContext }) {
  const { back, navigate, online, session } = context;
  const [demandes, setDemandes] = useState<SupportTicketSummary[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    void fetchMyTickets(session)
      .then(setDemandes)
      .catch((e: unknown) => setErreur(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [online, session]);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Mes demandes" onBack={back} />
      <div className="flex-1 space-y-3 px-4 py-4">
        {!online ? <Banner tone="info">Hors ligne : vos demandes s&apos;affichent avec du réseau.</Banner> : null}
        {erreur ? <Banner tone="danger">{erreur}</Banner> : null}
        {online && demandes === null && !erreur ? (
          <div className="flex justify-center py-8 text-ink-3">
            <Spinner />
          </div>
        ) : null}
        {demandes && demandes.length === 0 ? (
          <EmptyState
            title="Aucune demande"
            description="Une question ? Consultez l'aide, puis écrivez au support."
            action={<Button onClick={() => navigate({ name: 'contact' })}>Contacter le support</Button>}
          />
        ) : null}
        {demandes?.map((d) => (
          <Card key={d.id} onClick={() => navigate({ name: 'demande', ticketId: d.id })}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{d.subject}</span>
                <span className="block text-[13px] text-ink-3">
                  <span className="font-mono">{d.number}</span> · {formatDateFr(d.lastActivityAt)}
                </span>
              </span>
              <Badge tone={TON[d.status] ?? 'neutral'}>{LIBELLES_STATUT[d.status]}</Badge>
            </div>
          </Card>
        ))}
        <Button full variant="secondary" onClick={() => navigate({ name: 'contact' })}>
          Nouvelle demande
        </Button>
      </div>
    </div>
  );
}

/** Une demande : l'échange, et la réponse. Les pièces jointes se téléchargent depuis le site. */
export function DemandeScreen({ context, ticketId }: { context: AppContext; ticketId: string }) {
  const { back, online, session } = context;
  const [demande, setDemande] = useState<SupportTicketDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const charger = useCallback(() => {
    if (!online) return;
    void fetchMyTicket(session, ticketId)
      .then(setDemande)
      .catch((e: unknown) => setErreur(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [online, session, ticketId]);

  useEffect(charger, [charger]);

  async function repondre(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fichier = data.get('piece');
    if (fichier instanceof File && fichier.size === 0) data.delete('piece');
    if (fichier instanceof File && fichier.size > PIECE_JOINTE.maxOctets) {
      setErreur('Fichier trop volumineux : 5 Mo au maximum.');
      return;
    }
    setBusy(true);
    setErreur(null);
    try {
      await replyToTicket(session, ticketId, data);
      form.reset();
      charger();
    } catch (e) {
      setErreur(e instanceof OfflineError ? 'Pas de réseau : message non envoyé.' : e instanceof ApiError ? e.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  const fil = demande
    ? [
        {
          id: 'initial',
          authorKind: 'REQUESTER' as const,
          authorName: 'Vous',
          body: demande.description,
          createdAt: demande.createdAt,
          attachments: demande.initialAttachments,
        },
        ...demande.messages.map((m) => ({ ...m, authorName: m.authorKind === 'REQUESTER' ? 'Vous' : m.authorName })),
      ]
    : [];

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title={demande?.subject ?? 'Demande'} subtitle={demande ? `${demande.number} · ${libelleRubrique(demande.area)}` : undefined} onBack={back} />
      <div className="flex-1 space-y-3 px-4 py-4">
        {!online ? <Banner tone="info">Hors ligne : la demande s&apos;affiche avec du réseau.</Banner> : null}
        {erreur ? <Banner tone="danger">{erreur}</Banner> : null}
        {demande ? (
          <>
            <Badge tone={TON[demande.status] ?? 'neutral'}>{LIBELLES_STATUT[demande.status]}</Badge>
            <ol className="space-y-2.5">
              {fil.map((m) => (
                <li
                  key={m.id}
                  className={
                    m.authorKind === 'STAFF'
                      ? 'rounded-2xl border border-ciel-500/30 bg-ciel-500/10 p-3.5'
                      : 'rounded-2xl border border-line bg-surface p-3.5'
                  }
                >
                  <p className="text-[13px] font-medium text-ink">
                    {m.authorName} · <span className="font-normal text-ink-3">{formatDateFr(m.createdAt)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-ink-2">{m.body}</p>
                  {m.attachments.length > 0 ? (
                    <p className="mt-2 text-[12.5px] text-ink-3">
                      Pièce(s) jointe(s) : {m.attachments.map((a) => a.fileName).join(', ')} — à ouvrir depuis le site.
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
            {demande.status === 'CLOSED' ? (
              <Banner tone="info">Demande fermée. Pour une nouvelle question, ouvrez une nouvelle demande.</Banner>
            ) : (
              <form onSubmit={repondre} className="space-y-3">
                <Field label="Répondre" required>
                  <Textarea name="body" rows={4} required maxLength={LIMITES_TEXTE.message} />
                </Field>
                <Field label="Pièce jointe" hint="Facultatif — 5 Mo au plus.">
                  <input name="piece" type="file" accept={PIECE_JOINTE.accept} className="block w-full text-sm text-ink-2" />
                </Field>
                <Button type="submit" full loading={busy} disabled={!online}>
                  Envoyer
                </Button>
              </form>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
