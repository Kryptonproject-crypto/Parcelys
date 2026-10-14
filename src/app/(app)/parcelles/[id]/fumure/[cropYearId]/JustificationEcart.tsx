'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';

/**
 * Justifier un dépassement de la dose prévisionnelle.
 *
 * Les motifs proposés sont ceux du texte (arrêté GREN, art. 8), lus dans le
 * référentiel importé ; l'accident cultural demande sa nature et sa date.
 */
export function JustificationEcart({
  cropYearId,
  motifs,
}: {
  cropYearId: string;
  motifs: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const form = new FormData(event.currentTarget);
    try {
      const r = await apiPost<{ message: string }>(`/api/crop-years/${cropYearId}/fumure`, {
        action: 'justifier',
        cause: String(form.get('cause') ?? ''),
        survenuLe: String(form.get('survenuLe') ?? '') || null,
        outil: String(form.get('outil') ?? ''),
        commentaire: String(form.get('commentaire') ?? ''),
      });
      toast.success(r.message);
      router.refresh();
    } catch (err) {
      setErreur(err instanceof ApiRequestError ? err.message : 'Enregistrement impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={(e) => void envoyer(e)} className="space-y-3">
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      <Field label="Motif" htmlFor="cause" required>
        <Select id="cause" name="cause" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {motifs.map((m) => (
            <option key={m} value={m}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date de l’événement" htmlFor="survenuLe" hint="Pour un accident cultural.">
          <Input id="survenuLe" name="survenuLe" type="date" />
        </Field>
        <Field label="Outil de pilotage employé" htmlFor="outil">
          <Input id="outil" name="outil" maxLength={160} />
        </Field>
      </div>
      <Field label="Description" htmlFor="commentaire" hint="Nature des événements, mesures, références du justificatif.">
        <Textarea id="commentaire" name="commentaire" rows={3} maxLength={2000} />
      </Field>
      <Button type="submit" loading={envoi}>
        Enregistrer la justification
      </Button>
    </form>
  );
}
