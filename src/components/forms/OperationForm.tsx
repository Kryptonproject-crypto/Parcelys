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
  // Les champs d'irrigation n'apparaissent que pour une irrigation. Les
  // afficher toujours alourdirait le formulaire pour un labour, et la saisie
  // rapide au champ est ce qui décide qu'un travail est noté ou pas.
  const [type, setType] = useState('LABOUR');
  const irrigation = type === 'IRRIGATION';

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
        ...(irrigation
          ? {
              irrigationMm: String(form.get('irrigationMm') ?? '') || undefined,
              irrigationVolumeM3Ha:
                String(form.get('irrigationVolumeM3Ha') ?? '') || undefined,
              waterSource: String(form.get('waterSource') ?? ''),
              waterNitrateMgL: String(form.get('waterNitrateMgL') ?? '') || undefined,
              waterAnalysisOn: String(form.get('waterAnalysisOn') ?? '') || undefined,
            }
          : {}),
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
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
          >
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

      {irrigation ? (
        <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-3">
          <p className="text-[14px] font-medium text-ink">Eau apportée</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">
            L’eau d’irrigation apporte de l’azote. Sans le volume <em>et</em> la
            teneur de l’eau, Parcelys ne le chiffre pas — il ne l’estime pas non
            plus : une fourniture supposée conduirait à sur-fertiliser.
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Hauteur d’eau (mm)" htmlFor="irrigationMm">
              <Input id="irrigationMm" name="irrigationMm" type="number" step="0.1" min="0" />
            </Field>

            <Field
              label="ou volume (m³/ha)"
              htmlFor="irrigationVolumeM3Ha"
              hint="1 mm sur 1 ha = 10 m³"
            >
              <Input
                id="irrigationVolumeM3Ha"
                name="irrigationVolumeM3Ha"
                type="number"
                step="1"
                min="0"
              />
            </Field>

            <Field label="Origine de l’eau" htmlFor="waterSource">
              <Input id="waterSource" name="waterSource" placeholder="Forage, canal, retenue…" />
            </Field>

            <Field
              label="Nitrate de l’eau (mg/L de NO₃)"
              htmlFor="waterNitrateMgL"
              hint="Teneur en nitrate, pas en azote : c’est ainsi que l’analyse la rend."
            >
              <Input
                id="waterNitrateMgL"
                name="waterNitrateMgL"
                type="number"
                step="0.1"
                min="0"
              />
            </Field>

            <Field label="Date de l’analyse d’eau" htmlFor="waterAnalysisOn">
              <Input id="waterAnalysisOn" name="waterAnalysisOn" type="date" />
            </Field>
          </div>
        </div>
      ) : null}

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
