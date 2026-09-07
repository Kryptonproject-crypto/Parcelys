'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiFetch } from '@/lib/client/api';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from '@/lib/constants/agronomy';
import { Alert, Button, Field, Input, Select, Spinner } from '@/components/ui';

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp,.csv,.txt,.xlsx';

export function DocumentUpload({
  parcelId,
  onDone,
}: {
  parcelId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const file = form.get('file');

    if (!(file instanceof File) || file.size === 0) {
      setError('Sélectionnez un fichier.');
      setSubmitting(false);
      return;
    }

    try {
      await apiFetch(`/api/parcels/${parcelId}/documents`, {
        method: 'POST',
        body: form,
      });
      router.refresh();
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Téléversement impossible.',
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field
        label="Fichier"
        htmlFor="file"
        required
        hint="PDF, image (JPG, PNG, WebP), CSV, texte ou Excel — 15 Mo maximum."
      >
        <input
          id="file"
          name="file"
          type="file"
          accept={ACCEPTED}
          required
          className="w-full rounded-lg border border-ardoise-300 bg-white p-2 text-sm
                     file:mr-3 file:rounded-md file:border-0 file:bg-champ-600 file:px-3 file:py-1.5
                     file:text-sm file:font-medium file:text-white hover:file:bg-champ-700"
        />
      </Field>

      <Field label="Catégorie" htmlFor="category" required>
        <Select id="category" name="category" defaultValue="AUTRE">
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {DOCUMENT_CATEGORY_LABELS[category] ?? category}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Description" htmlFor="description">
        <Input
          id="description"
          name="description"
          placeholder="Analyse de sol du 12 mars, facture engrais…"
        />
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Téléversement…' : 'Ajouter le document'}
        </Button>
      </div>
    </form>
  );
}
