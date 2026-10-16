'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost, apiPut } from '@/lib/client/api';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import {
  computeNutrients,
  computeTotalQuantity,
} from '@/lib/services/fertilization';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { FlaskConical as IconFlask, Wheat as IconHarvest } from 'lucide-react';
import type { CropYearRow, FertilizationRow, Referentials } from '@/app/(app)/parcelles/[id]/types';
import type { ControleRegle } from '@/lib/regulatory/programme-actions';
import { RegleTrace } from '@/components/regulatory/RegleTrace';
import { nomCourtDeCulture } from '@/lib/shared/cultures';

/**
 * Saisie d'un apport — ou sa correction, quand `existing` est donné.
 *
 * Les valeurs calculées (quantité totale, N/P/K) sont affichées en direct pour
 * contrôle, mais c'est le serveur qui recalcule et enregistre : le client ne
 * peut pas imposer un bilan incohérent.
 *
 * En correction, les teneurs N/P/K ne sont pré-remplies que si elles avaient
 * été **saisies** (d'après une analyse) : une teneur calculée depuis le
 * référentiel doit suivre la nouvelle dose, pas rester figée.
 */
export function FertilizationForm({
  parcelId,
  parcelAreaHa,
  fertilizers,
  organicInputs,
  cropYears,
  existing = null,
  onDone,
}: {
  parcelId: string;
  parcelAreaHa: number;
  fertilizers: Referentials['fertilizers'];
  organicInputs: Referentials['organicInputs'];
  cropYears: CropYearRow[];
  /** L'apport à corriger ; absent pour une nouvelle saisie. */
  existing?: FertilizationRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [inputType, setInputType] = useState<'MINERAL' | 'ORGANIC'>(existing?.inputType ?? 'MINERAL');
  const [productId, setProductId] = useState(existing?.fertilizerId ?? existing?.organicInputId ?? '');
  const [customLabel, setCustomLabel] = useState(
    existing && !existing.fertilizerId && !existing.organicInputId ? existing.productLabel : '',
  );
  const [dose, setDose] = useState(existing ? String(Number(existing.dose)) : '');
  const [doseUnit, setDoseUnit] = useState(existing?.doseUnit ?? 'kg/ha');
  const [treatedArea, setTreatedArea] = useState(
    existing ? Number(existing.treatedAreaHa).toFixed(4) : parcelAreaHa.toFixed(4),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [controles, setControles] = useState<ControleRegle[] | null>(null);

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
              unit: selectedOrganic.defaultUnit ?? null,
            }
          : null,
    });

    return { totalQuantity, totalUnit, ...nutrients };
  }, [dose, doseUnit, treatedArea, inputType, selectedMineral, selectedOrganic]);

  /**
   * Teneurs saisies de l'apport corrigé : celles qui diffèrent de ce que le
   * référentiel donne pour la dose enregistrée. Calculé une fois, à
   * l'ouverture.
   */
  const [saisies] = useState(() => {
    if (!existing) return { n: '', p: '', k: '' };
    const doseInitiale = Number(existing.dose);
    const mineral = fertilizers.find((f) => f.id === existing.fertilizerId);
    const organic = organicInputs.find((o) => o.id === existing.organicInputId);
    const calcul = computeNutrients({
      dose: doseInitiale,
      doseUnit: existing.doseUnit,
      mineral: mineral
        ? {
            nPercent: mineral.nPercent ? Number(mineral.nPercent) : null,
            pPercent: mineral.pPercent ? Number(mineral.pPercent) : null,
            kPercent: mineral.kPercent ? Number(mineral.kPercent) : null,
          }
        : null,
      organic: organic
        ? {
            nContent: organic.nContent ? Number(organic.nContent) : null,
            pContent: organic.pContent ? Number(organic.pContent) : null,
            kContent: organic.kContent ? Number(organic.kContent) : null,
            unit: organic.defaultUnit ?? null,
          }
        : null,
    });
    const saisie = (enregistre: string | null, calcule: number | null) =>
      enregistre !== null && (calcule === null || Math.abs(Number(enregistre) - calcule) > 0.005)
        ? String(Number(enregistre))
        : '';
    return {
      n: saisie(existing.nSupplied, calcul.nSupplied),
      p: saisie(existing.pSupplied, calcul.pSupplied),
      k: saisie(existing.kSupplied, calcul.kSupplied),
    };
  });
  const aDesSaisies = Boolean(saisies.n || saisies.p || saisies.k || existing?.supplier || existing?.batchNumber || existing?.operator);

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
      // Saisie manuelle possible lorsque la teneur du produit est inconnue. En
      // correction, un champ vidé demande le recalcul (`null`).
      nSupplied: String(form.get('nSupplied') ?? '') || (existing ? null : undefined),
      pSupplied: String(form.get('pSupplied') ?? '') || (existing ? null : undefined),
      kSupplied: String(form.get('kSupplied') ?? '') || (existing ? null : undefined),
    };

    try {
      const resultat = existing
        ? await apiPut<{ controles?: ControleRegle[] }>(`/api/fertilization/${existing.id}`, payload)
        : await apiPost<{ controles?: ControleRegle[] }>(`/api/parcels/${parcelId}/fertilization`, payload);
      router.refresh();
      // Ce que le programme d'actions dit de cet apport : on le montre avant
      // de fermer, avec la règle — un constat qui s'efface tout seul n'est
      // pas lu.
      const aLire = (resultat.controles ?? []).filter((c) => c.verdict !== 'ok');
      if (aLire.length > 0) {
        setControles(aLire);
        setSubmitting(false);
        return;
      }
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

  // L'apport est enregistré : on montre ce que le programme d'actions en dit.
  if (controles) {
    const TONS = { alerte: 'danger', verification: 'warning', indetermine: 'info' } as const;
    const TITRES = { alerte: 'Règle non respectée', verification: 'À vérifier', indetermine: 'Non vérifiable' } as const;
    return (
      <div className="space-y-3">
        <Alert tone="success">{existing ? 'Apport corrigé.' : 'Apport enregistré.'}</Alert>
        <p className="text-[13.5px] text-ink-2">Ce que le programme d’actions nitrates en dit :</p>
        {controles.map((c, i) => (
          <Alert
            key={`${c.sujet}-${i}`}
            tone={TONS[c.verdict as keyof typeof TONS] ?? 'info'}
            title={`${TITRES[c.verdict as keyof typeof TITRES] ?? c.verdict} — ${c.sujet}`}
          >
            {c.detail}
            {c.trace ? <RegleTrace trace={c.trace} /> : null}
          </Alert>
        ))}
        <div className="flex justify-end">
          <Button type="button" onClick={onDone}>
            Fermer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* Type d'apport */}
      <div className="flex rounded-lg border border-line p-0.5">
        {(
          [
            ['MINERAL', 'Minéral', IconFlask],
            ['ORGANIC', 'Organique', IconHarvest],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setInputType(value);
              setProductId('');
              setDoseUnit(value === 'MINERAL' ? 'kg/ha' : 't/ha');
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors ${
              inputType === value
                ? 'bg-champ-600 text-white dark:bg-champ-500 dark:text-champ-950'
                : 'text-ink-2 hover:bg-surface-3'
            }`}
          >
            <Icon size={15} aria-hidden />
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
            defaultValue={(existing?.appliedOn ?? new Date().toISOString()).slice(0, 10)}
            required
          />
        </Field>

        <Field label="Culture concernée" htmlFor="cropYearId">
          <Select id="cropYearId" name="cropYearId" defaultValue={existing?.cropYearId ?? ''}>
            <option value="">— Non rattaché —</option>
            {cropYears.map((cy) => (
              <option key={cy.id} value={cy.id}>
                {nomCourtDeCulture(cy.cropName)} — campagne {cy.campaignYear}
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
        <div className="rounded-lg border border-champ-200 dark:border-champ-800 bg-accent-soft p-3.5">
          <p className="text-xs font-medium uppercase tracking-wide text-champ-700 dark:text-champ-400">
            Calcul automatique
          </p>
          <p className="mt-1.5 text-sm text-ink">
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
            <p className="mt-1 text-sm text-ink-2">
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
      <details className="rounded-lg border border-line p-3" open={aDesSaisies}>
        <summary className="cursor-pointer text-sm font-medium text-ink-2">
          Éléments fertilisants et traçabilité (facultatif)
        </summary>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="N apporté (kg/ha)" htmlFor="nSupplied">
            <Input id="nSupplied" name="nSupplied" type="number" step="0.01" min="0" defaultValue={saisies.n} />
          </Field>
          <Field label="P₂O₅ apporté (kg/ha)" htmlFor="pSupplied">
            <Input id="pSupplied" name="pSupplied" type="number" step="0.01" min="0" defaultValue={saisies.p} />
          </Field>
          <Field label="K₂O apporté (kg/ha)" htmlFor="kSupplied">
            <Input id="kSupplied" name="kSupplied" type="number" step="0.01" min="0" defaultValue={saisies.k} />
          </Field>

          <Field label="Fournisseur" htmlFor="supplier">
            <Input id="supplier" name="supplier" defaultValue={existing?.supplier ?? ''} />
          </Field>
          <Field label="Numéro de lot" htmlFor="batchNumber">
            <Input id="batchNumber" name="batchNumber" defaultValue={existing?.batchNumber ?? ''} />
          </Field>
          <Field label="Opérateur" htmlFor="operator">
            <Input id="operator" name="operator" defaultValue={existing?.operator ?? ''} />
          </Field>
        </div>
      </details>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} defaultValue={existing?.notes ?? ''} />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" loading={submitting}>
          {submitting ? 'Enregistrement…' : existing ? 'Enregistrer les corrections' : "Enregistrer l'apport"}
        </Button>
      </div>
    </form>
  );
}
