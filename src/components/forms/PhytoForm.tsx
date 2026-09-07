'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import { computeTotalQuantity } from '@/lib/services/fertilization';
import {
  EphyProductSearch,
  type EphyProduct,
} from '@/components/forms/EphyProductSearch';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { CropYearRow } from '@/app/(app)/parcelles/[id]/types';

export function PhytoForm({
  parcelId,
  parcelAreaHa,
  cropYears,
  hasLocation,
  onDone,
}: {
  parcelId: string;
  parcelAreaHa: number;
  cropYears: CropYearRow[];
  /** La parcelle a un centroïde : le relevé météo automatique est possible. */
  hasLocation: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<EphyProduct | null>(null);
  const [manualName, setManualName] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('L/ha');
  const [treatedArea, setTreatedArea] = useState(parcelAreaHa.toFixed(4));
  const [captureWeather, setCaptureWeather] = useState(hasLocation);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const preview = useMemo(() => {
    const doseValue = Number(dose);
    const area = Number(treatedArea);
    if (!Number.isFinite(doseValue) || doseValue <= 0 || !Number.isFinite(area)) {
      return null;
    }
    return computeTotalQuantity(doseValue, doseUnit, area);
  }, [dose, doseUnit, treatedArea]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setWarnings([]);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      appliedOn: String(form.get('appliedOn') ?? ''),
      productId: product?.id,
      productName: product?.name ?? manualName,
      amm: product?.amm ?? String(form.get('amm') ?? ''),
      activeSubstances: product?.substances.join(', ') ?? '',
      cropLabel: String(form.get('cropLabel') ?? ''),
      targetLabel: String(form.get('targetLabel') ?? ''),
      dose: Number(dose),
      doseUnit,
      sprayVolumeLHa: String(form.get('sprayVolumeLHa') ?? '') || undefined,
      treatedAreaHa: Number(treatedArea),
      operator: String(form.get('operator') ?? ''),
      notes: String(form.get('notes') ?? ''),
      cropYearId: String(form.get('cropYearId') ?? '') || undefined,
      captureWeather,
      weatherTempC: String(form.get('weatherTempC') ?? '') || undefined,
      weatherWindKmh: String(form.get('weatherWindKmh') ?? '') || undefined,
      weatherHumidity: String(form.get('weatherHumidity') ?? '') || undefined,
      weatherSummary: String(form.get('weatherSummary') ?? '') || undefined,
    };

    try {
      const result = await apiPost<{ warnings?: string[] }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        payload,
      );
      router.refresh();
      if (result.warnings?.length) {
        setWarnings(result.warnings);
        setTimeout(onDone, 2000);
      } else {
        onDone();
      }
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
      {warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      <Field
        label="Produit phytopharmaceutique"
        hint="Recherchez le produit dans le catalogue officiel E-Phy pour renseigner automatiquement l'AMM et les substances actives."
      >
        <EphyProductSearch selected={product} onSelect={setProduct} />
      </Field>

      {!product ? (
        <div className="grid gap-4 rounded-lg border border-ble-500/30 bg-ble-50/60 dark:bg-ble-700/15 p-3 sm:grid-cols-2">
          <Field
            label="Nom du produit (saisie libre)"
            htmlFor="manualName"
            required
            error={fieldErrors.productName}
          >
            <Input
              id="manualName"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Numéro d'AMM"
            htmlFor="amm"
            hint="Reportez-le depuis l'étiquette du produit."
          >
            <Input id="amm" name="amm" inputMode="numeric" />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date du traitement" htmlFor="appliedOn" required error={fieldErrors.appliedOn}>
          <Input
            id="appliedOn"
            name="appliedOn"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </Field>

        <Field label="Culture concernée" htmlFor="cropYearId">
          <Select id="cropYearId" name="cropYearId" defaultValue="">
            <option value="">— Non rattaché —</option>
            {cropYears.map((cy) => (
              <option key={cy.id} value={cy.id}>
                {cy.cropName} — campagne {cy.campaignYear}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Cible / organisme visé"
          htmlFor="targetLabel"
          className="sm:col-span-2"
          hint="Ex. adventices, septoriose, pucerons."
        >
          <Input id="targetLabel" name="targetLabel" />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Dose" htmlFor="dose" required error={fieldErrors.dose}>
            <Input
              id="dose"
              type="number"
              step="0.001"
              min="0.001"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              required
            />
          </Field>
          <Field label="Unité" htmlFor="doseUnit" required>
            <Select
              id="doseUnit"
              value={doseUnit}
              onChange={(e) => setDoseUnit(e.target.value)}
            >
              {DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Surface traitée (ha)"
          htmlFor="treatedAreaHa"
          hint={`Superficie de la parcelle : ${parcelAreaHa.toFixed(4)} ha`}
          error={fieldErrors.treatedAreaHa}
        >
          <Input
            id="treatedAreaHa"
            type="number"
            step="0.0001"
            min="0.0001"
            max={parcelAreaHa}
            value={treatedArea}
            onChange={(e) => setTreatedArea(e.target.value)}
          />
        </Field>

        <Field label="Volume de bouillie (L/ha)" htmlFor="sprayVolumeLHa">
          <Input id="sprayVolumeLHa" name="sprayVolumeLHa" type="number" step="1" min="0" />
        </Field>

        <Field label="Opérateur" htmlFor="operator">
          <Input id="operator" name="operator" placeholder="Nom de l'applicateur" />
        </Field>
      </div>

      {preview ? (
        <div className="rounded-lg border border-champ-200 dark:border-champ-800 bg-accent-soft p-3.5 text-sm">
          <span className="text-ink-2">Quantité utilisée : </span>
          <span className="font-semibold tabular-nums text-ink">
            {preview.totalQuantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}{' '}
            {preview.totalUnit}
          </span>
          <span className="text-ink-3">
            {' '}
            ({dose} {doseUnit} × {treatedArea} ha)
          </span>
        </div>
      ) : null}

      {/* Conditions météo */}
      <div className="rounded-lg border border-line p-3">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={captureWeather}
            onChange={(e) => setCaptureWeather(e.target.checked)}
            disabled={!hasLocation}
            className="mt-0.5 h-4 w-4 rounded border-line-strong text-champ-600 focus:ring-champ-500"
          />
          <span>
            <span className="font-medium text-ink">
              Relever automatiquement les conditions météo
            </span>
            <span className="block text-xs text-ink-3">
              {hasLocation
                ? 'Température, vent, humidité et précipitations sont relevés sur la parcelle au moment de l’enregistrement.'
                : 'Indisponible : la parcelle n’a pas de géométrie, donc pas de coordonnées.'}
            </span>
          </span>
        </label>

        {!captureWeather ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Température (°C)" htmlFor="weatherTempC">
              <Input id="weatherTempC" name="weatherTempC" type="number" step="0.1" />
            </Field>
            <Field label="Vent (km/h)" htmlFor="weatherWindKmh">
              <Input id="weatherWindKmh" name="weatherWindKmh" type="number" step="0.1" min="0" />
            </Field>
            <Field label="Humidité (%)" htmlFor="weatherHumidity">
              <Input
                id="weatherHumidity"
                name="weatherHumidity"
                type="number"
                step="1"
                min="0"
                max="100"
              />
            </Field>
            <Field label="Conditions" htmlFor="weatherSummary">
              <Input id="weatherSummary" name="weatherSummary" placeholder="Ciel dégagé" />
            </Field>
          </div>
        ) : null}
      </div>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={submitting || (!product && !manualName)}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : 'Enregistrer le traitement'}
        </Button>
      </div>
    </form>
  );
}
