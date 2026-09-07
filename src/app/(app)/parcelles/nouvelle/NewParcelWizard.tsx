'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ApiRequestError, apiPost, apiPut } from '@/lib/client/api';
import type { MultiPolygonGeometry } from '@/lib/geo/types';
import type { DrawResult } from '@/components/map/ParcelDrawMap';
import { PARCEL_STATUS_LABELS, PARCEL_TYPES } from '@/lib/constants/agronomy';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';

// Leaflet manipule `window` : le composant carte est chargé côté client seulement.
const ParcelDrawMap = dynamic(
  () => import('@/components/map/ParcelDrawMap').then((m) => m.ParcelDrawMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-xl border border-line bg-surface-2">
        <span className="text-sm text-ink-3">Chargement de la carte…</span>
      </div>
    ),
  },
);

type Props = {
  tileUrl: string;
  attribution: string;
  otherParcels: Array<{ id: string; name: string; geometry: MultiPolygonGeometry }>;
  /** Parcelle existante en mode édition. */
  parcel?: {
    id: string;
    name: string;
    internalNumber: string | null;
    commune: string | null;
    inseeCode: string | null;
    lieuDit: string | null;
    cadastralRef: string | null;
    pacId: string | null;
    parcelType: string | null;
    status: string;
    notes: string | null;
    geometry: MultiPolygonGeometry | null;
  };
};

type CreateResponse = {
  id: string;
  name: string;
  areaHa: number;
  warnings?: string[];
};

export function NewParcelWizard({ tileUrl, attribution, otherParcels, parcel }: Props) {
  const router = useRouter();
  const isEdit = Boolean(parcel);

  const [draw, setDraw] = useState<DrawResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Commune pré-remplie par le géocodage inverse au moment du tracé.
  const [commune, setCommune] = useState(parcel?.commune ?? '');
  const [inseeCode, setInseeCode] = useState(parcel?.inseeCode ?? '');

  const geometry = draw?.geometry ?? parcel?.geometry ?? null;
  const areaHa = draw?.areaHa ?? null;

  const canSubmit = useMemo(
    () => Boolean(geometry) && !submitting,
    [geometry, submitting],
  );

  function handleDrawChange(result: DrawResult | null): void {
    setDraw(result);
    if (result?.commune && !commune) {
      setCommune(result.commune);
      if (result.inseeCode) setInseeCode(result.inseeCode);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!geometry) {
      setError('Dessinez d’abord le contour de la parcelle sur la carte.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setWarnings([]);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      internalNumber: String(form.get('internalNumber') ?? ''),
      commune: String(form.get('commune') ?? ''),
      inseeCode,
      lieuDit: String(form.get('lieuDit') ?? ''),
      cadastralRef: String(form.get('cadastralRef') ?? ''),
      pacId: String(form.get('pacId') ?? ''),
      parcelType: String(form.get('parcelType') ?? ''),
      status: String(form.get('status') ?? 'ACTIVE'),
      notes: String(form.get('notes') ?? ''),
      // En édition, on n'envoie la géométrie que si elle a été retracée.
      ...(isEdit && !draw ? {} : { geometry }),
    };

    try {
      const result = isEdit
        ? await apiPut<CreateResponse>(`/api/parcels/${parcel?.id}`, payload)
        : await apiPost<CreateResponse>('/api/parcels', payload);

      if (result.warnings?.length) {
        setWarnings(result.warnings);
        // On laisse l'utilisateur lire l'avertissement avant de naviguer.
        setTimeout(() => router.push(`/parcelles/${result.id ?? parcel?.id}`), 2500);
      } else {
        router.push(`/parcelles/${result.id ?? parcel?.id}`);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Impossible de contacter le serveur. Réessayez.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {warnings.map((warning) => (
        <Alert key={warning} tone="warning" title="Attention">
          {warning}
        </Alert>
      ))}

      <Card>
        <CardHeader
          title={isEdit ? '1. Ajuster le contour' : '1. Dessiner la parcelle'}
          description={
            isEdit
              ? 'Modifiez les sommets si nécessaire. Sans modification, la géométrie actuelle est conservée.'
              : 'Recherchez votre commune, zoomez sur la zone, puis cliquez pour poser les sommets.'
          }
        />
        <ParcelDrawMap
          tileUrl={tileUrl}
          attribution={attribution}
          initialGeometry={parcel?.geometry ?? null}
          otherParcels={otherParcels}
          onChange={handleDrawChange}
        />
      </Card>

      <Card>
        <CardHeader
          title="2. Informations de la parcelle"
          description="La superficie est recalculée par le serveur à partir du contour."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nom de la parcelle"
            htmlFor="name"
            required
            error={fieldErrors.name}
            className="sm:col-span-2"
          >
            <Input
              id="name"
              name="name"
              defaultValue={parcel?.name}
              placeholder="Le Grand Champ"
              required
            />
          </Field>

          <Field label="Numéro interne" htmlFor="internalNumber" error={fieldErrors.internalNumber}>
            <Input
              id="internalNumber"
              name="internalNumber"
              defaultValue={parcel?.internalNumber ?? ''}
              placeholder="P-023"
            />
          </Field>

          <Field label="Type de parcelle" htmlFor="parcelType">
            <Select id="parcelType" name="parcelType" defaultValue={parcel?.parcelType ?? ''}>
              <option value="">— Non précisé —</option>
              {PARCEL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Commune"
            htmlFor="commune"
            hint="Renseignée automatiquement d'après le contour tracé."
          >
            <Input
              id="commune"
              name="commune"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
            />
          </Field>

          <Field label="Lieu-dit" htmlFor="lieuDit">
            <Input id="lieuDit" name="lieuDit" defaultValue={parcel?.lieuDit ?? ''} />
          </Field>

          <Field
            label="Référence cadastrale"
            htmlFor="cadastralRef"
            hint="Facultatif — section et numéro de parcelle cadastrale."
          >
            <Input
              id="cadastralRef"
              name="cadastralRef"
              defaultValue={parcel?.cadastralRef ?? ''}
              placeholder="ZK 0042"
            />
          </Field>

          <Field
            label="Identifiant PAC / RPG"
            htmlFor="pacId"
            hint="Facultatif — à reporter depuis votre déclaration."
          >
            <Input id="pacId" name="pacId" defaultValue={parcel?.pacId ?? ''} />
          </Field>

          <Field label="Statut" htmlFor="status">
            <Select id="status" name="status" defaultValue={parcel?.status ?? 'ACTIVE'}>
              {Object.entries(PARCEL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Observations" htmlFor="notes" className="sm:col-span-2">
            <Textarea
              id="notes"
              name="notes"
              defaultValue={parcel?.notes ?? ''}
              placeholder="Nature du sol, contraintes d'accès, zones humides…"
            />
          </Field>
        </div>

        {/* Récapitulatif */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg bg-surface-2 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Superficie {areaHa !== null ? '(estimation)' : ''}
            </p>
            <p className="text-xl font-semibold tabular-nums text-champ-700 dark:text-champ-400">
              {areaHa !== null
                ? `${areaHa.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha`
                : geometry
                  ? 'Contour existant conservé'
                  : 'À dessiner'}
            </p>
          </div>

          {draw ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Centre (GPS)
              </p>
              <p className="text-sm tabular-nums text-ink-2">
                {draw.centroid.lat.toFixed(5)}, {draw.centroid.lng.toFixed(5)}
              </p>
            </div>
          ) : null}

          <div className="ml-auto flex gap-2">
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {submitting ? <Spinner /> : null}
              {submitting
                ? 'Enregistrement…'
                : isEdit
                  ? 'Enregistrer les modifications'
                  : 'Valider la parcelle'}
            </Button>
          </div>
        </div>

        {!geometry ? (
          <p className="mt-2 text-sm text-ble-600">
            Fermez le polygone sur la carte pour activer l&apos;enregistrement.
          </p>
        ) : null}
      </Card>
    </form>
  );
}
