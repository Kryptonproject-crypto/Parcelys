'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiFetch, apiPost } from '@/lib/client/api';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import { computeTotalQuantity } from '@/lib/services/fertilization';
import {
  EphyProductSearch,
  type EphyProduct,
} from '@/components/forms/EphyProductSearch';
import { PhytoUsagePanel } from '@/components/forms/PhytoUsagePanel';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { CropYearRow } from '@/app/(app)/parcelles/[id]/types';
import { nomCourtDeCulture } from '@/lib/shared/cultures';
import { uniteAffichee } from '@/lib/shared/unites';
import { etatDuProduit } from '@/lib/shared/produits';

/** Un produit en stock, avec ses lots et ce qu'il en reste. */
type ProduitEnStock = {
  produit: EphyProduct;
  unite: string | null;
  reste: number;
  lots: Array<{ id: string; lotNumber: string | null; reste: number; unit: string; purchasedOn: string | null; expiresOn: string | null }>;
};

const quantite = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function PhytoForm({
  parcelId,
  parcelAreaHa,
  cropYears,
  hasLocation,
  parcelDrained,
  onDone,
}: {
  parcelId: string;
  parcelAreaHa: number;
  cropYears: CropYearRow[];
  /** La parcelle a un centroïde : le relevé météo automatique est possible. */
  hasLocation: boolean;
  /** Sol drainé de la parcelle. `null` = non renseigné, et non « non drainé ». */
  parcelDrained: boolean | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<EphyProduct | null>(null);
  const [manualName, setManualName] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('L/ha');
  const [treatedArea, setTreatedArea] = useState(parcelAreaHa.toFixed(4));
  const [cropYearId, setCropYearId] = useState('');
  const [cropLabel, setCropLabel] = useState('');
  // La date décide quels usages valent : un produit retiré s'emploie jusqu'à
  // sa fin d'utilisation, pas au-delà.
  const [appliedOn, setAppliedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [captureWeather, setCaptureWeather] = useState(hasLocation);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [enStock, setEnStock] = useState<ProduitEnStock[]>([]);
  const [stockLotId, setStockLotId] = useState('');
  const [catalogue, setCatalogue] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  // Le stock d'abord : ce que l'on pulvérise est, le plus souvent, ce que
  // l'on a acheté. La recherche au catalogue reste à un clic.
  useEffect(() => {
    // Le stock de l'exploitation de la parcelle, pas celui de l'exploitation
    // active : un compte peut en avoir plusieurs.
    void apiFetch<{ produits: ProduitEnStock[] }>(
      `/api/stocks/phyto?parcelId=${encodeURIComponent(parcelId)}`,
    )
      .then((d) => setEnStock(d.produits))
      .catch(() => setEnStock([]));
  }, [parcelId]);

  const stockDuProduit = product ? enStock.find((s) => s.produit.id === product.id) ?? null : null;

  function choisirEnStock(s: ProduitEnStock) {
    setProduct(s.produit);
    // Un seul lot entamable : c'est lui. Plusieurs : l'exploitant choisit,
    // le bidon en main.
    setStockLotId(s.lots.length === 1 ? (s.lots[0]?.id ?? '') : '');
  }

  function choisirProduit(p: EphyProduct | null) {
    setProduct(p);
    const s = p ? enStock.find((e) => e.produit.id === p.id) : undefined;
    setStockLotId(s && s.lots.length === 1 ? (s.lots[0]?.id ?? '') : '');
  }

  const preview = useMemo(() => {
    const doseValue = Number(dose);
    const area = Number(treatedArea);
    if (!Number.isFinite(doseValue) || doseValue <= 0 || !Number.isFinite(area)) {
      return null;
    }
    return computeTotalQuantity(doseValue, doseUnit, area);
  }, [dose, doseUnit, treatedArea]);

  const cropNameOf = (id: string): string =>
    cropYears.find((cy) => cy.id === id)?.cropName ?? '';

  /**
   * Culture retenue pour interroger le catalogue : le libellé E-Phy choisi dans
   * le panneau s'il l'a été, sinon le nom de la culture de la parcelle. Les deux
   * ne coïncident pas toujours — E-Phy dit « Blé », l'assolement « Blé tendre
   * d'hiver » — et c'est bien pour cela qu'on laisse choisir.
   */
  const cropPourCatalogue = cropLabel || cropNameOf(cropYearId);

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
      // Le libellé de culture voyage avec l'enregistrement : c'est lui qui
      // rattache le traitement à un usage du catalogue, et un registre sans
      // culture ne se contrôle pas. Il était perdu jusqu'ici — le formulaire
      // lisait un champ qui n'existait pas.
      cropLabel: cropLabel || cropNameOf(cropYearId) || '',
      targetLabel: String(form.get('targetLabel') ?? ''),
      dose: Number(dose),
      doseUnit,
      sprayVolumeLHa: String(form.get('sprayVolumeLHa') ?? '') || undefined,
      treatedAreaHa: Number(treatedArea),
      operator: String(form.get('operator') ?? ''),
      notes: String(form.get('notes') ?? ''),
      cropYearId: cropYearId || undefined,
      captureWeather,
      weatherTempC: String(form.get('weatherTempC') ?? '') || undefined,
      weatherWindKmh: String(form.get('weatherWindKmh') ?? '') || undefined,
      weatherHumidity: String(form.get('weatherHumidity') ?? '') || undefined,
      weatherSummary: String(form.get('weatherSummary') ?? '') || undefined,
      // Le lot employé : le serveur en sort la quantité utilisée.
      ...(stockLotId && stockDuProduit ? { stockLotId } : {}),
    };

    try {
      const result = await apiPost<{ warnings?: string[] }>(
        `/api/parcels/${parcelId}/phytosanitary`,
        payload,
      );
      router.refresh();
      if (result.warnings?.length) {
        // Les avertissements restent à l'écran jusqu'à ce qu'on les ferme :
        // ZNT, délai avant récolte, stock — ils se lisent, ils ne défilent pas.
        setWarnings(result.warnings);
        setEnregistre(true);
        setSubmitting(false);
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

  if (enregistre) {
    return (
      <div className="space-y-3">
        <Alert tone="success">Traitement enregistré.</Alert>
        {warnings.map((warning) => (
          <Alert key={warning} tone="warning">
            {warning}
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
      {warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      {!product && enStock.length > 0 && !catalogue ? (
        <Field label="Produit — dans votre stock" hint="Les produits achetés et encore en stock. Le lot choisi sera déduit de la quantité utilisée.">
          <ul className="space-y-1.5">
            {enStock.map((s) => (
              <li key={s.produit.id}>
                <button
                  type="button"
                  onClick={() => choisirEnStock(s)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <span className="block text-[14px] font-medium text-ink">{s.produit.name}</span>
                  <span className="block text-[12.5px] text-ink-3">
                    AMM {s.produit.amm} · reste {quantite(s.reste)} {s.unite ?? ''} · {s.lots.length} lot{s.lots.length > 1 ? 's' : ''}
                    {s.produit.authorized ? '' : ` · ${etatDuProduit(s.produit).libelle.toLowerCase()}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setCatalogue(true)}
            className="mt-2 text-sm font-medium text-champ-700 hover:underline dark:text-champ-400"
          >
            Autre produit — chercher dans le catalogue E-Phy
          </button>
        </Field>
      ) : (
        <Field
          label="Produit phytopharmaceutique"
          hint="Recherchez le produit dans le catalogue officiel E-Phy pour renseigner automatiquement l'AMM et les substances actives."
        >
          <EphyProductSearch selected={product} onSelect={choisirProduit} />
          {!product && enStock.length > 0 ? (
            <button
              type="button"
              onClick={() => setCatalogue(false)}
              className="mt-2 text-sm font-medium text-champ-700 hover:underline dark:text-champ-400"
            >
              Revenir aux produits en stock
            </button>
          ) : null}
        </Field>
      )}

      {stockDuProduit ? (
        <Field
          label="Lot employé"
          htmlFor="stockLotId"
          hint="La quantité utilisée sera sortie de ce lot. Sans lot, le traitement est enregistré mais le stock ne bouge pas."
        >
          <Select id="stockLotId" value={stockLotId} onChange={(e) => setStockLotId(e.target.value)}>
            <option value="">— Aucun lot (stock non mouvementé) —</option>
            {stockDuProduit.lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lotNumber ? `Lot ${l.lotNumber}` : 'Lot sans numéro'} · reste {quantite(l.reste)} {uniteAffichee(l.unit)}
                {l.purchasedOn ? ` · acheté le ${new Date(l.purchasedOn).toLocaleDateString('fr-FR')}` : ''}
                {l.expiresOn ? ` · DLU ${new Date(l.expiresOn).toLocaleDateString('fr-FR')}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

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
            value={appliedOn}
            onChange={(e) => setAppliedOn(e.target.value)}
            required
          />
        </Field>

        <Field label="Culture concernée" htmlFor="cropYearId">
          <Select
            id="cropYearId"
            value={cropYearId}
            onChange={(e) => setCropYearId(e.target.value)}
          >
            <option value="">— Non rattaché —</option>
            {cropYears.map((cy) => (
              <option key={cy.id} value={cy.id}>
                {nomCourtDeCulture(cy.cropName)} — campagne {cy.campaignYear}
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

      {/* Ce que le catalogue officiel dit de ce produit sur cette culture :
          dose retenue, ZNT, sol drainé. Placé après la dose pour que l'écart
          se voie à la frappe, avant l'enregistrement. */}
      <PhytoUsagePanel
        productId={product?.id ?? null}
        crop={cropPourCatalogue}
        onCropChange={setCropLabel}
        dose={dose}
        doseUnit={doseUnit}
        parcelDrained={parcelDrained}
        appliedOn={appliedOn}
      />

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
