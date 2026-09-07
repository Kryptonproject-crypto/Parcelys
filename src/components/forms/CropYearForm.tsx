'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { YIELD_UNITS, currentCampaignYear } from '@/lib/constants/agronomy';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { CropYearRow, Referentials } from '@/app/(app)/parcelles/[id]/types';

export function CropYearForm({
  parcelId,
  crops,
  campaignYear,
  existing,
  onDone,
}: {
  parcelId: string;
  crops: Referentials['crops'];
  campaignYear: number;
  existing?: CropYearRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creatingCustom, setCreatingCustom] = useState(false);

  async function createCustomCrop(name: string): Promise<void> {
    try {
      await apiPost('/api/crops', { name });
      router.refresh();
      setCreatingCustom(false);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Création de culture impossible.',
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      cropId: String(form.get('cropId') ?? ''),
      campaignYear: Number(form.get('campaignYear')),
      variety: String(form.get('variety') ?? ''),
      sowingDate: String(form.get('sowingDate') ?? ''),
      expectedHarvestDate: String(form.get('expectedHarvestDate') ?? ''),
      actualHarvestDate: String(form.get('actualHarvestDate') ?? ''),
      yieldValue: String(form.get('yieldValue') ?? ''),
      yieldUnit: String(form.get('yieldUnit') ?? '') || undefined,
      notes: String(form.get('notes') ?? ''),
    };

    try {
      await apiPost(`/api/parcels/${parcelId}/crops`, payload);
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

  if (creatingCustom) {
    return (
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          label="Nom de la culture personnalisée"
          htmlFor="customCropName"
          hint="Elle sera ajoutée au référentiel de votre exploitation."
        >
          <Input id="customCropName" autoFocus />
        </Field>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => {
              const input = document.getElementById('customCropName') as HTMLInputElement | null;
              if (input?.value.trim()) void createCustomCrop(input.value.trim());
            }}
          >
            Créer la culture
          </Button>
          <Button type="button" variant="ghost" onClick={() => setCreatingCustom(false)}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  const years = Array.from({ length: 10 }, (_, i) => currentCampaignYear() + 1 - i);

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Culture" htmlFor="cropId" required error={fieldErrors.cropId}>
          <Select id="cropId" name="cropId" defaultValue={existing?.cropId ?? ''} required>
            <option value="">— Choisir —</option>
            {crops.map((crop) => (
              <option key={crop.id} value={crop.id}>
                {crop.name}
                {crop.category ? ` (${crop.category})` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Campagne" htmlFor="campaignYear" required>
          <Select
            id="campaignYear"
            name="campaignYear"
            defaultValue={String(existing?.campaignYear ?? campaignYear)}
            required
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Variété" htmlFor="variety" className="sm:col-span-2">
          <Input id="variety" name="variety" defaultValue={existing?.variety ?? ''} />
        </Field>

        <Field label="Date de semis" htmlFor="sowingDate">
          <Input
            id="sowingDate"
            name="sowingDate"
            type="date"
            defaultValue={existing?.sowingDate?.slice(0, 10) ?? ''}
          />
        </Field>

        <Field label="Récolte prévue" htmlFor="expectedHarvestDate">
          <Input
            id="expectedHarvestDate"
            name="expectedHarvestDate"
            type="date"
            defaultValue={existing?.expectedHarvestDate?.slice(0, 10) ?? ''}
          />
        </Field>

        <Field label="Récolte réelle" htmlFor="actualHarvestDate">
          <Input
            id="actualHarvestDate"
            name="actualHarvestDate"
            type="date"
            defaultValue={existing?.actualHarvestDate?.slice(0, 10) ?? ''}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Rendement" htmlFor="yieldValue" error={fieldErrors.yieldValue}>
            <Input
              id="yieldValue"
              name="yieldValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={existing?.yieldValue ?? ''}
            />
          </Field>
          <Field label="Unité" htmlFor="yieldUnit">
            <Select
              id="yieldUnit"
              name="yieldUnit"
              defaultValue={existing?.yieldUnit ?? 'q/ha'}
            >
              {YIELD_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Observations" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={existing?.notes ?? ''} />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={() => setCreatingCustom(true)}
          className="text-sm text-champ-700 hover:underline"
        >
          + Créer une culture personnalisée
        </button>

        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : 'Enregistrer la culture'}
        </Button>
      </div>
    </form>
  );
}
