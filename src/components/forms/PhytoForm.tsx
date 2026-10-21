'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiFetch, apiPost, apiPut } from '@/lib/client/api';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import { computeTotalQuantity } from '@/lib/services/fertilization';
import {
  EphyProductSearch,
  type EphyProduct,
} from '@/components/forms/EphyProductSearch';
import { PhytoUsagePanel } from '@/components/forms/PhytoUsagePanel';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { CropYearRow, PhytoRow } from '@/app/(app)/parcelles/[id]/types';
import { nomCourtDeCulture } from '@/lib/shared/cultures';
import { uniteAffichee } from '@/lib/shared/unites';
import { etatDuProduit } from '@/lib/shared/produits';
import { dernierOperateur, retenirOperateur } from '@/lib/shared/operateur';

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
  conduiteBio = null,
  existing = null,
  onDone,
}: {
  parcelId: string;
  parcelAreaHa: number;
  cropYears: CropYearRow[];
  /** La parcelle a un centroïde : le relevé météo automatique est possible. */
  hasLocation: boolean;
  /** Sol drainé de la parcelle. `null` = non renseigné, et non « non drainé ». */
  parcelDrained: boolean | null;
  /**
   * Conduite bio de l'exploitation. Toute en bio ou aucune surface en bio : la
   * mention se déduit du profil et n'est pas redemandée. En partie, ou non
   * renseignée : elle se donne ici.
   */
  conduiteBio?: 'AUCUNE' | 'TOTALE' | 'PARTIELLE' | null;
  /**
   * Le traitement à corriger ; absent pour une nouvelle saisie. En correction,
   * la météo n'est pas relevée à nouveau : c'est celle du jour du traitement
   * qui compte, et elle est reprise telle qu'enregistrée.
   */
  existing?: PhytoRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<EphyProduct | null>(existing?.produit ?? null);
  const [manualName, setManualName] = useState(existing && !existing.produit ? existing.productName : '');
  const [dose, setDose] = useState(existing ? String(Number(existing.dose)) : '');
  const [doseUnit, setDoseUnit] = useState(existing?.doseUnit ?? 'L/ha');
  const [treatedArea, setTreatedArea] = useState(
    existing ? Number(existing.treatedAreaHa).toFixed(4) : parcelAreaHa.toFixed(4),
  );
  const [cropYearId, setCropYearId] = useState(existing?.cropYearId ?? '');
  const [cropLabel, setCropLabel] = useState(existing?.cropLabel ?? '');
  // La date décide quels usages valent : un produit retiré s'emploie jusqu'à
  // sa fin d'utilisation, pas au-delà.
  const [appliedOn, setAppliedOn] = useState(() =>
    (existing?.appliedOn ?? new Date().toISOString()).slice(0, 10),
  );
  const [captureWeather, setCaptureWeather] = useState(existing ? false : hasLocation);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [enStock, setEnStock] = useState<ProduitEnStock[]>([]);
  const lotInitial = existing?.stockLotId ?? '';
  const [stockLotId, setStockLotId] = useState(lotInitial);
  const [catalogue, setCatalogue] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  // Cible et opérateur : les deux mentions que « À faire » réclame le plus
  // souvent. La cible est proposée d'après les usages autorisés du produit,
  // l'opérateur d'après la dernière saisie faite sur cet appareil.
  const [cible, setCible] = useState(existing?.targetLabel ?? '');
  const [cibles, setCibles] = useState<string[]>([]);
  const [operateur, setOperateur] = useState(existing?.operator ?? '');
  useEffect(() => {
    if (!existing) setOperateur((actuel) => actuel || dernierOperateur());
  }, [existing]);

  // Mentions du registre en vigueur au 1er janvier 2026.
  const [heureDebut, setHeureDebut] = useState(existing?.startTime ?? '');
  const [heureFin, setHeureFin] = useState(existing?.endTime ?? '');
  const [stade, setStade] = useState(existing?.bbchStage ?? '');
  const [realisePar, setRealisePar] = useState<string>(existing?.appliedBy ?? '');
  const [prestataire, setPrestataire] = useState(existing?.contractorName ?? '');
  const [siretPrestataire, setSiretPrestataire] = useState(existing?.contractorSiret ?? '');
  const demanderBio = conduiteBio === 'PARTIELLE' || conduiteBio === null;
  const [bio, setBio] = useState(
    existing?.organicProduction === true ? 'oui' : existing?.organicProduction === false ? 'non' : '',
  );
  const tiers = realisePar === 'PRESTATAIRE' || realisePar === 'ENTRAIDE';

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

  /**
   * Lots proposés. En correction, le lot déjà rattaché reste proposé même
   * épuisé ou d'un produit qui n'est plus en stock : sinon la liste afficherait
   * « aucun lot » pour un traitement qui en a un.
   */
  const lotsProposes = [
    ...(lotInitial && !(stockDuProduit?.lots ?? []).some((l) => l.id === lotInitial)
      ? [{ id: lotInitial, libelle: 'Lot actuellement rattaché' }]
      : []),
    ...(stockDuProduit?.lots ?? []).map((l) => ({
      id: l.id,
      libelle:
        `${l.lotNumber ? `Lot ${l.lotNumber}` : 'Lot sans numéro'} · reste ${quantite(l.reste)} ${uniteAffichee(l.unit)}` +
        (l.purchasedOn ? ` · acheté le ${new Date(l.purchasedOn).toLocaleDateString('fr-FR')}` : '') +
        (l.expiresOn ? ` · DLU ${new Date(l.expiresOn).toLocaleDateString('fr-FR')}` : ''),
    })),
  ];

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
      targetLabel: cible,
      dose: Number(dose),
      doseUnit,
      sprayVolumeLHa: String(form.get('sprayVolumeLHa') ?? '') || undefined,
      treatedAreaHa: Number(treatedArea),
      operator: operateur,
      startTime: heureDebut,
      endTime: heureFin,
      bbchStage: stade,
      appliedBy: realisePar || null,
      contractorName: tiers ? prestataire : '',
      contractorSiret: tiers ? siretPrestataire : '',
      // Demandée seulement quand le profil ne la donne pas : sinon le serveur
      // la déduit, et une correction garde celle de l'enregistrement.
      ...(demanderBio ? { organicProduction: bio === '' ? null : bio === 'oui' } : {}),
      notes: String(form.get('notes') ?? ''),
      cropYearId: cropYearId || undefined,
      captureWeather,
      weatherTempC: String(form.get('weatherTempC') ?? '') || undefined,
      weatherWindKmh: String(form.get('weatherWindKmh') ?? '') || undefined,
      weatherHumidity: String(form.get('weatherHumidity') ?? '') || undefined,
      weatherSummary: String(form.get('weatherSummary') ?? '') || undefined,
      // Le lot employé : le serveur en sort la quantité utilisée. En
      // correction, il n'est envoyé que s'il change — sans quoi le serveur
      // ajuste la sortie existante à la nouvelle quantité.
      ...(existing
        ? stockLotId !== lotInitial
          ? { stockLotId: stockLotId || null }
          : {}
        : stockLotId && stockDuProduit
          ? { stockLotId }
          : {}),
    };

    try {
      const result = existing
        ? await apiPut<{ warnings?: string[] }>(`/api/phytosanitary/applications/${existing.id}`, payload)
        : await apiPost<{ warnings?: string[] }>(`/api/parcels/${parcelId}/phytosanitary`, payload);
      retenirOperateur(operateur);
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
        <Alert tone="success">{existing ? 'Traitement corrigé.' : 'Traitement enregistré.'}</Alert>
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

      {lotsProposes.length > 0 ? (
        <Field
          label="Lot employé"
          htmlFor="stockLotId"
          hint={
            existing
              ? 'La sortie de stock suit la correction. « Aucun lot » l’annule : la quantité revient au stock.'
              : 'La quantité utilisée sera sortie de ce lot. Sans lot, le traitement est enregistré mais le stock ne bouge pas.'
          }
        >
          <Select id="stockLotId" value={stockLotId} onChange={(e) => setStockLotId(e.target.value)}>
            <option value="">— Aucun lot (stock non mouvementé) —</option>
            {lotsProposes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.libelle}
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
            <Input id="amm" name="amm" inputMode="numeric" defaultValue={existing && !existing.produit ? (existing.amm ?? '') : ''} />
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
          <Input
            id="targetLabel"
            name="targetLabel"
            value={cible}
            onChange={(e) => setCible(e.target.value)}
            list="cibles-catalogue"
            autoComplete="off"
          />
          <datalist id="cibles-catalogue">
            {cibles.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {cibles.length > 0 ? (
            <p className="mt-1 text-xs text-ink-3">
              {cibles.length} cible{cibles.length > 1 ? 's' : ''} autorisée{cibles.length > 1 ? 's' : ''} au
              catalogue pour ce produit — proposée{cibles.length > 1 ? 's' : ''} à la saisie.
            </p>
          ) : null}
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
          <Input
            id="sprayVolumeLHa"
            name="sprayVolumeLHa"
            type="number"
            step="1"
            min="0"
            defaultValue={existing?.sprayVolumeLHa ? String(Number(existing.sprayVolumeLHa)) : ''}
          />
        </Field>

        <Field label="Opérateur" htmlFor="operator" hint="Retenu pour les prochains traitements saisis sur cet appareil.">
          <Input
            id="operator"
            name="operator"
            placeholder="Nom de l'applicateur"
            value={operateur}
            onChange={(e) => setOperateur(e.target.value)}
          />
        </Field>
      </div>

      {/* Mentions ajoutées au registre au 1er janvier 2026 (arrêté du
          24 décembre 2025). Facultatives ici : heures et stade ne sont exigés
          que lorsque l'autorisation du produit les encadre. */}
      <fieldset className="space-y-4 rounded-lg border border-line p-3.5">
        <legend className="px-1 text-sm font-medium text-ink">Mentions du registre</legend>
        <p className="text-xs text-ink-3">
          Heures et stade : à renseigner quand l’étiquette ou l’autorisation du produit les
          encadre (traitement en floraison, stade limite…). Laissés vides, ils restent vides.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Heure de début" htmlFor="startTime" error={fieldErrors.startTime}>
            <Input id="startTime" type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
          </Field>
          <Field label="Heure de fin" htmlFor="endTime" error={fieldErrors.endTime}>
            <Input id="endTime" type="time" value={heureFin} onChange={(e) => setHeureFin(e.target.value)} />
          </Field>
          <Field label="Stade de la culture (BBCH)" htmlFor="bbchStage" error={fieldErrors.bbchStage}>
            <Input
              id="bbchStage"
              value={stade}
              onChange={(e) => setStade(e.target.value)}
              placeholder="Ex. 32"
              maxLength={20}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Application réalisée par" htmlFor="appliedBy">
            <Select id="appliedBy" value={realisePar} onChange={(e) => setRealisePar(e.target.value)}>
              <option value="">Non renseigné</option>
              <option value="EXPLOITATION">L’exploitation</option>
              <option value="PRESTATAIRE">Un prestataire</option>
              <option value="ENTRAIDE">Une exploitation en entraide</option>
            </Select>
          </Field>
          {tiers ? (
            <>
              <Field label="Nom de l’intervenant" htmlFor="contractorName" error={fieldErrors.contractorName}>
                <Input
                  id="contractorName"
                  value={prestataire}
                  onChange={(e) => setPrestataire(e.target.value)}
                  maxLength={160}
                />
              </Field>
              <Field label="SIRET de l’intervenant" htmlFor="contractorSiret" error={fieldErrors.contractorSiret}>
                <Input
                  id="contractorSiret"
                  value={siretPrestataire}
                  onChange={(e) => setSiretPrestataire(e.target.value)}
                  inputMode="numeric"
                  placeholder="14 chiffres"
                />
              </Field>
            </>
          ) : null}
        </div>
        {demanderBio ? (
          <Field
            label="Production en agriculture biologique"
            htmlFor="organicProduction"
            hint={
              conduiteBio === null
                ? 'Renseignez la conduite bio de l’exploitation dans les paramètres : elle sera reprise d’office.'
                : 'Votre exploitation est en partie en bio : précisez-le pour ce traitement.'
            }
          >
            <Select id="organicProduction" value={bio} onChange={(e) => setBio(e.target.value)}>
              <option value="">Non renseigné</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </Select>
          </Field>
        ) : null}
      </fieldset>

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
        onCibles={setCibles}
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
        {existing ? (
          <p className="text-sm">
            <span className="font-medium text-ink">Conditions météo du jour du traitement</span>
            <span className="block text-xs text-ink-3">
              Reprises telles qu’enregistrées. Corrigez-les si elles étaient fausses ; les laisser
              vides garde celles du registre.
            </span>
          </p>
        ) : (
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
        )}

        {!captureWeather ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Température (°C)" htmlFor="weatherTempC">
              <Input id="weatherTempC" name="weatherTempC" type="number" step="0.1" defaultValue={existing?.weatherTempC ? String(Number(existing.weatherTempC)) : ''} />
            </Field>
            <Field label="Vent (km/h)" htmlFor="weatherWindKmh">
              <Input id="weatherWindKmh" name="weatherWindKmh" type="number" step="0.1" min="0" defaultValue={existing?.weatherWindKmh ? String(Number(existing.weatherWindKmh)) : ''} />
            </Field>
            <Field label="Humidité (%)" htmlFor="weatherHumidity">
              <Input
                id="weatherHumidity"
                name="weatherHumidity"
                type="number"
                step="1"
                min="0"
                max="100"
                defaultValue={existing?.weatherHumidity ? String(Number(existing.weatherHumidity)) : ''}
              />
            </Field>
            <Field label="Conditions" htmlFor="weatherSummary">
              <Input id="weatherSummary" name="weatherSummary" placeholder="Ciel dégagé" defaultValue={existing?.weatherSummary ?? ''} />
            </Field>
          </div>
        ) : null}
      </div>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} defaultValue={existing?.notes ?? ''} />
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={submitting || (!product && !manualName)}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : existing ? 'Enregistrer les corrections' : 'Enregistrer le traitement'}
        </Button>
      </div>
    </form>
  );
}
