'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiRequestError } from '@/lib/client/api';
import { LIMITES_TEXTE, PIECE_JOINTE } from '@/lib/shared/support';
import { Alert, Button, Card, CardHeader, Field, Textarea } from '@/components/ui';
import { IconSend } from '@/components/ui/icons';

/** Répondre à sa propre demande, avec une pièce jointe facultative. */
export function RequesterReply({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErreur(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const fichier = data.get('piece');
    if (fichier instanceof File && fichier.size === 0) data.delete('piece');
    if (fichier instanceof File && fichier.size > PIECE_JOINTE.maxOctets) {
      setErreur('Fichier trop volumineux : 5 Mo au maximum.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/support/tickets/${ticketId}/messages`, { method: 'POST', body: data });
      form.reset();
      router.refresh();
    } catch (error) {
      setErreur(error instanceof ApiRequestError ? error.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Répondre" />
      <form onSubmit={envoyer} className="space-y-3">
        <Field label="Message" htmlFor="reponse-body" required>
          <Textarea id="reponse-body" name="body" rows={5} required maxLength={LIMITES_TEXTE.message} />
        </Field>
        <Field label="Pièce jointe" htmlFor="reponse-piece" hint="Facultatif — PDF, PNG, JPEG, WebP ou texte, 5 Mo au plus.">
          <input id="reponse-piece" name="piece" type="file" accept={PIECE_JOINTE.accept} className="block w-full text-sm text-ink-2" />
        </Field>
        {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" icon={IconSend} loading={busy}>
            Envoyer
          </Button>
        </div>
      </form>
    </Card>
  );
}
