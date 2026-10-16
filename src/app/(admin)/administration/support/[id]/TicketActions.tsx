'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiPatch, apiPost, ApiRequestError } from '@/lib/client/api';
import { LIBELLES_STATUT, LIMITES_TEXTE, STATUTS_DEMANDE, type StatutDemande } from '@/lib/shared/support';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Select, Textarea } from '@/components/ui';
import { IconSend, IconTransfer } from '@/components/ui/icons';

/**
 * Répondre, changer le statut, attribuer, transférer. Chaque geste passe par
 * l'API, qui revérifie le périmètre ; le transfert n'apparaît qu'à
 * l'administrateur général.
 */
export function TicketActions({
  ticketId,
  status,
  assigneeId,
  assignable,
  portfolioId,
  portfolios,
  canTransfer,
}: {
  ticketId: string;
  status: StatutDemande;
  assigneeId: string | null;
  assignable: Array<{ id: string; name: string }>;
  portfolioId: string | null;
  portfolios: Array<{ id: string; name: string }>;
  canTransfer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function agir(nom: string, appel: () => Promise<{ message: string }>): Promise<boolean> {
    setBusy(nom);
    setErreur(null);
    try {
      const result = await appel();
      toast.success(result.message);
      router.refresh();
      return true;
    } catch (error) {
      setErreur(error instanceof ApiRequestError ? error.message : 'Action impossible.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function repondre(event: FormEvent): Promise<void> {
    event.preventDefault();
    const fait = await agir('message', () =>
      apiPost(`/api/admin/support/${ticketId}/messages`, { body, internal }),
    );
    if (fait) {
      setBody('');
      setInternal(false);
    }
  }

  return (
    <Card>
      <CardHeader icon={IconSend} title="Répondre" />
      <form onSubmit={repondre} className="space-y-3">
        <Field
          label={internal ? 'Note interne (jamais montrée au demandeur)' : 'Réponse au demandeur'}
          hint={
            internal
              ? 'Visible des seuls administrateurs qui voient cette demande.'
              : 'Le demandeur est prévenu ; l’e-mail ne contient pas le texte, seulement le lien pour le lire.'
          }
        >
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            maxLength={LIMITES_TEXTE.message}
            required
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <Checkbox checked={internal} onChange={(event) => setInternal(event.target.checked)} />
          Note interne
        </label>
        {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" icon={IconSend} loading={busy === 'message'} disabled={!body.trim()}>
            {internal ? 'Ajouter la note' : 'Envoyer la réponse'}
          </Button>
        </div>
      </form>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <Field label="Statut">
          <Select
            value={status}
            disabled={busy !== null}
            onChange={(event) =>
              void agir('status', () =>
                apiPatch(`/api/admin/support/${ticketId}`, { action: 'status', status: event.target.value }),
              )
            }
          >
            {STATUTS_DEMANDE.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable">
          <Select
            value={assigneeId ?? ''}
            disabled={busy !== null}
            onChange={(event) =>
              void agir('assign', () =>
                apiPatch(`/api/admin/support/${ticketId}`, {
                  action: 'assign',
                  assigneeId: event.target.value || null,
                }),
              )
            }
          >
            <option value="">Non attribuée</option>
            {assignable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {canTransfer ? (
          <Field
            label="Portefeuille"
            htmlFor={`transfert-${ticketId}`}
            hint="Transférer la demande à d'autres administrateurs."
          >
            <div className="flex gap-2">
              <Select
                defaultValue={portfolioId ?? ''}
                id={`transfert-${ticketId}`}
                aria-label="Portefeuille de destination"
              >
                <option value="">Aucun (général)</option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                icon={IconTransfer}
                loading={busy === 'transfer'}
                onClick={() => {
                  const select = document.getElementById(`transfert-${ticketId}`) as HTMLSelectElement | null;
                  void agir('transfer', () =>
                    apiPatch(`/api/admin/support/${ticketId}`, {
                      action: 'transfer',
                      portfolioId: select?.value || null,
                    }),
                  );
                }}
              >
                Transférer
              </Button>
            </div>
          </Field>
        ) : null}
      </div>
    </Card>
  );
}
