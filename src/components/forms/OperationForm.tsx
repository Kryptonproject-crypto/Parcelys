'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { OPERATION_LABELS } from '@/lib/constants/agronomy';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

export function OperationForm({
  parcelId,
  onDone,
}: {
  parcelId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    try {
      await apiPost(`/api/parcels/${parcelId}/operations`, {
        performedOn: String(form.get('performedOn') ?? ''),
        type: String(form.get('type') ?? 'AUTRE'),
        equipment: String(form.get('equipment') ?? ''),
        operator: String(form.get('operator') ?? ''),
        durationHours: String(form.get('durationHours') ?? '') || undefined,
        notes: String(form.get('notes') ?? ''),
      });
      router.refresh();
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Impossible de contacter le serveur.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="performedOn" required error={fieldErrors.performedOn}>
          <Input
            id="performedOn"
            name="performedOn"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </Field>

        <Field label="Type de travail" htmlFor="type" required>
          <Select id="type" name="type" defaultValue="LABOUR" required>
            {Object.entries(OPERATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Matériel" htmlFor="equipment">
          <Input id="equipment" name="equipment" placeholder="Charrue 4 corps, tracteur 130 ch" />
        </Field>

        <Field label="Opérateur" htmlFor="operator">
          <Input id="operator" name="operator" />
        </Field>

        <Field label="Durée (heures)" htmlFor="durationHours">
          <Input id="durationHours" name="durationHours" type="number" step="0.25" min="0" />
        </Field>
      </div>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : 'Enregistrer le travail'}
        </Button>
      </div>
    </form>
  );
}
