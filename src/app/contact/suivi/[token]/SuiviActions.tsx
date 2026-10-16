'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiPost, ApiRequestError } from '@/lib/client/api';
import { LIMITES_TEXTE, PIECE_JOINTE } from '@/lib/shared/support';
import { Alert, Button, Field, Textarea } from '@/components/ui';
import { IconMailCheck, IconSend } from '@/components/ui/icons';

/** Confirmer son adresse, et répondre — depuis le lien de suivi. */
export function SuiviActions({
  token,
  identity,
  closed,
  children,
}: {
  token: string;
  identity: 'ACCOUNT' | 'EMAIL_CONFIRMED' | 'UNVERIFIED';
  closed: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function confirmer(): Promise<void> {
    setBusy('confirmer');
    try {
      const r = await apiPost<{ message: string }>('/api/support/suivi', { token, action: 'confirmer' });
      setMessage({ tone: 'success', text: r.message });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof ApiRequestError ? error.message : 'Échec.' });
    } finally {
      setBusy(null);
    }
  }

  async function repondre(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set('token', token);
    data.set('action', 'repondre');
    const fichier = data.get('piece');
    if (fichier instanceof File && fichier.size === 0) data.delete('piece');
    if (fichier instanceof File && fichier.size > PIECE_JOINTE.maxOctets) {
      setMessage({ tone: 'danger', text: 'Fichier trop volumineux : 5 Mo au maximum.' });
      return;
    }
    setBusy('repondre');
    try {
      const r = await apiFetch<{ message: string }>('/api/support/suivi', { method: 'POST', body: data });
      setMessage({ tone: 'success', text: r.message });
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof ApiRequestError ? error.message : 'Échec.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {identity === 'UNVERIFIED' ? (
        <Alert tone="info" title="Confirmez que cette adresse est la vôtre">
          <p>
            Cela nous permet de vous répondre en sachant que vous recevez bien nos messages. Pour
            toute question sur les données d&apos;un compte, le plus sûr reste de vous connecter et
            d&apos;écrire depuis la page Contact.
          </p>
          <Button className="mt-3" icon={IconMailCheck} loading={busy === 'confirmer'} onClick={() => void confirmer()}>
            Je confirme mon adresse
          </Button>
        </Alert>
      ) : null}
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {children}
      {closed ? (
        <Alert tone="info">Cette demande est fermée. Pour une nouvelle question, utilisez la page Contact.</Alert>
      ) : (
        <form onSubmit={repondre} className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
          <Field label="Votre réponse" htmlFor="suivi-body" required>
            <Textarea id="suivi-body" name="body" rows={5} required maxLength={LIMITES_TEXTE.message} />
          </Field>
          <Field label="Pièce jointe" htmlFor="suivi-piece" hint="Facultatif — PDF, PNG, JPEG, WebP ou texte, 5 Mo au plus.">
            <input id="suivi-piece" name="piece" type="file" accept={PIECE_JOINTE.accept} className="block w-full text-sm text-ink-2" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" icon={IconSend} loading={busy === 'repondre'}>
              Envoyer
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
