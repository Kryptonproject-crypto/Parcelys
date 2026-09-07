'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import {
  computeNutrients,
  computeTotalQuantity,
} from '@/lib/services/fertilization';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { CropYearRow, Referentials } from '@/app/(app)/parcelles/[id]/types';

/**
 * Saisie d'un apport.
 *
 * Les valeurs calculées (quantité totale, N/P/K) sont affichées en direct pour
 * contrôle, mais c'est le serveur qui recalcule et enregistre : le client ne
 * peut pas imposer un bilan incohérent.
 */
export function FertilizationForm({
  parcelId,
  parcelAreaHa,
  fertilizers,
  organicInputs,
  cropYears,
  onDone,
}: {
  parcelId: string;
  parcelAreaHa: number;
  fertilizers: Referentials['fertilizers'];
  organicInputs: Referentials['organicInputs'];
  cropYears: CropYearRow[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [inputType, setInputType] = useState<'MINERAL' | 'ORGANIC'>('MINERAL');
  const [productId, setProductId] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('kg/ha');
  const [treatedArea, setTreatedArea] = useState(parcelAreaHa.toFixed(4));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedMineral = fertilizers.find((f) => f.id === productId) ?? null;
  const selectedOrganic = organicInputs.find((o) => o.id === productId) ?? null;

  // Aperçu du calcul — même formule que côté serveur.
  const preview = useMemo(() => {
    const doseValue = Number(dose);
    const area = Number(treatedArea);
    if (!Number.isFinite(doseValue) || doseValue <= 0 || !Number.isFinite(area)) {
      return null;
    }

    const { totalQuantity, totalUnit } = computeTotalQuantity(doseValue, doseUnit, area);
    const nutrients = computeNutrients({
      dose: doseValue,
      doseUnit,
      mineral:
        inputType === 'MINERAL' && selectedMineral
          ? {
              nPercent: selectedMineral.nPercent ? Number(selectedMineral.nPercent) : null,
              pPercent: selectedMineral.pPercent ? Number(selectedMineral.pPercent) : null,
              kPercent: selectedMineral.kPercent ? Number(selectedMineral.kPercent) : null,
            }
          : null,
      organic:
        inputType === 'ORGANIC' && selectedOrganic
          ? {
              nContent: selectedOrganic.nContent ? Number(selectedOrganic.nContent) : null,
              pContent: selectedOrganic.pContent ? Number(selectedOrganic.pContent) : null,
              kContent: selectedOrganic.kContent ? Number(selectedOrganic.kContent) : null,
            }
          : null,
    });

    return { totalQuantity, totalUnit, ...nutrients };
  }, [dose, doseUnit, treatedArea, inputType, selectedMineral, selectedOrganic]);

  function handleProductChange(value: string): void {
    setProductId(value);
    const mineral = fertilizers.find((f) => f.id === value);
    const organic = organicInputs.find((o) => o.id === value);
    const unit = mineral?.defaultUnit ?? organic?.defaultUnit;
    if (unit) setDoseUnit(unit);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      appliedOn: String(form.get('appliedOn') ?? ''),
      inputType,
      fertilizerId: inputType === 'MINERAL' && productId ? productId : undefined,
      organicInputId: inputType === 'ORGANIC' && productId ? productId : undefined,
      productLabel:
        (inputType === 'MINERAL' ? selectedMineral?.name : selectedOrganic?.name) ??
        customLabel,
      dose: Number(dose),
      doseUnit,
      treatedAreaHa: Number(treatedArea),
      supplier: String(form.get('supplier') ?? ''),
      batchNumber: String(form.get('batchNumber') ?? ''),
      operator: String(form.get('operator') ?? ''),
      notes: String(form.get('notes') ?? ''),
      cropYearId: String(form.get('cropYearId') ?? '') || undefined,
      // Saisie manuelle possible lorsque la teneur du produit est inconnue.
      nSupplied: String(form.get('nSupplied') ?? '') || undefined,
      pSupplied: String(form.get('pSupplied') ?? '') || undefined,
      kSupplied: String(form.get('kSupplied') ?? '') || undefined,
    };

    try {
      await apiPost(`/api/parcels/${parcelId}/fertilization`, payload);
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

  const products = inputType === 'MINERAL' ? fertilizers : organicInputs;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* Type d'apport */}
      <div className="flex rounded-lg border border-ardoise-200 p-0.5">
        {(
          [
            ['MINERAL', 'Minéral', '⚗️'],
            ['ORGANIC', 'Organique', '🌾'],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setInputType(value);
              setProductId('');
              setDoseUnit(value === 'MINERAL' ? 'kg/ha' : 't/ha');
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition ${
              inputType === value
                ? 'bg-champ-600 text-white'
                : 'text-ardoise-600 hover:bg-ardoise-100'
            }`}
          >
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date de l'apport" htmlFor="appliedOn" required error={fieldErrors.appliedOn}>
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
          label="Produit"
          htmlFor="productId"
          className="sm:col-span-2"
          hint="Sélectionnez un produit du référentiel pour un calcul automatique des éléments fertilisants."
        >
          <Select
            id="productId"
            value={productId}
            onChange={(e) => handleProductChange(e.target.value)}
          >
            <option value="">— Produit non répertorié (saisie libre) —</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>

        {!productId ? (
          <Field
            label="Nom du produit"
            htmlFor="customLabel"
            required
            className="sm:col-span-2"
            error={fieldErrors.productLabel}
          >
            <Input
              id="customLabel"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Ex. Fumier de l'exploitation, analyse du 12/03"
              required
            />
          </Field>
        ) : null}

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
      </div>

      {/* Calcul en direct */}
      {preview ? (
        <div className="rounded-lg border border-champ-200 bg-champ-50 p-3.5">
          <p className="text-xs font-medium uppercase tracking-wide text-champ-700">
            Calcul automatique
          </p>
          <p className="mt-1.5 text-sm text-ardoise-800">
            <span className="font-semibold tabular-nums">
              {preview.totalQuantity.toLocaleString('fr-FR', {
                maximumFractionDigits: 2,
              })}{' '}
              {preview.totalUnit}
            </span>{' '}
            au total ({dose} {doseUnit} × {treatedArea} ha)
          </p>

          {preview.nSupplied !== null ||
          preview.pSupplied !== null ||
          preview.kSupplied !== null ? (
            <p className="mt-1 text-sm text-ardoise-700">
              Éléments apportés :{' '}
              {[
                preview.nSupplied !== null ? `N ${preview.nSupplied} kg/ha` : null,
                preview.pSupplied !== null ? `P₂O₅ ${preview.pSupplied} kg/ha` : null,
                preview.kSupplied !== null ? `K₂O ${preview.kSupplied} kg/ha` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ble-600">
              Teneurs du produit inconnues — renseignez-les ci-dessous si vous disposez
              d&apos;une analyse.
            </p>
          )}
        </div>
      ) : null}

      {/* Saisie manuelle des éléments */}
      <details className="rounded-lg border border-ardoise-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-ardoise-700">
          Éléments fertilisants et traçabilité (facultatif)
        </summary>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="N apporté (kg/ha)" htmlFor="nSupplied">
            <Input id="nSupplied" name="nSupplied" type="number" step="0.01" min="0" />
          </Field>
          <Field label="P₂O₅ apporté (kg/ha)" htmlFor="pSupplied">
            <Input id="pSupplied" name="pSupplied" type="number" step="0.01" min="0" />
          </Field>
          <Field label="K₂O apporté (kg/ha)" htmlFor="kSupplied">
            <Input id="kSupplied" name="kSupplied" type="number" step="0.01" min="0" />
          </Field>

          <Field label="Fournisseur" htmlFor="supplier">
            <Input id="supplier" name="supplier" />
          </Field>
          <Field label="Numéro de lot" htmlFor="batchNumber">
            <Input id="batchNumber" name="batchNumber" />
          </Field>
          <Field label="Opérateur" htmlFor="operator">
            <Input id="operator" name="operator" />
          </Field>
        </div>
      </details>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : "Enregistrer l'apport"}
        </Button>
      </div>
    </form>
  );
}
