'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiFetch, apiPut } from '@/lib/client/api';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Spinner,
} from '@/components/ui';

type Farm = {
  name: string;
  siret: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  department: string | null;
  latitude: number | null;
  longitude: number | null;
};

type GeocodeHit = {
  label: string;
  city: string | null;
  postcode: string | null;
  latitude: number;
  longitude: number;
  context: string | null;
};

export function FarmForm({ farm, canEdit }: { farm: Farm; canEdit: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: farm.latitude,
    lng: farm.longitude,
  });
  const [hits, setHits] = useState<GeocodeHit[]>([]);

  /** Retrouve les coordonnées du siège à partir de l'adresse saisie. */
  async function locate(): Promise<void> {
    const address = [
      (document.getElementById('addressLine') as HTMLInputElement | null)?.value,
      (document.getElementById('postalCode') as HTMLInputElement | null)?.value,
      (document.getElementById('city') as HTMLInputElement | null)?.value,
    ]
      .filter(Boolean)
      .join(' ');

    if (address.trim().length < 3) {
      setError("Renseignez au moins la commune pour rechercher l'adresse.");
      return;
    }

    setLocating(true);
    setError(null);
    try {
      const result = await apiFetch<{ results: GeocodeHit[] }>(
        `/api/geo/search?q=${encodeURIComponent(address)}`,
      );
      setHits(result.results.slice(0, 5));
      if (result.results.length === 0) {
        setError('Aucune adresse trouvée.');
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Recherche d’adresse impossible.',
      );
    } finally {
      setLocating(false);
    }
  }

  function applyHit(hit: GeocodeHit): void {
    setCoords({ lat: hit.latitude, lng: hit.longitude });
    setHits([]);
    const postal = document.getElementById('postalCode') as HTMLInputElement | null;
    const city = document.getElementById('city') as HTMLInputElement | null;
    const department = document.getElementById('department') as HTMLInputElement | null;
    if (postal && hit.postcode) postal.value = hit.postcode;
    if (city && hit.city) city.value = hit.city;
    if (department && hit.context) {
      // « 45, Loiret, Centre-Val de Loire » → « Loiret »
      const parts = hit.context.split(',').map((p) => p.trim());
      if (parts[1]) department.value = parts[1];
    }
    setMessage(`Position retenue : ${hit.label}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    try {
      const result = await apiPut<{ message: string }>('/api/farms', {
        name: String(form.get('name') ?? ''),
        siret: String(form.get('siret') ?? ''),
        addressLine: String(form.get('addressLine') ?? ''),
        postalCode: String(form.get('postalCode') ?? ''),
        city: String(form.get('city') ?? ''),
        department: String(form.get('department') ?? ''),
        ...(coords.lat !== null && coords.lng !== null
          ? { latitude: coords.lat, longitude: coords.lng }
          : {}),
      });
      setMessage(result.message);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Impossible de contacter le serveur.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Exploitation"
        description="Ces informations figurent en en-tête de vos registres imprimés. La position sert de point de référence pour la météo."
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nom de l'exploitation"
            htmlFor="name"
            required
            error={fieldErrors.name}
            className="sm:col-span-2"
          >
            <Input id="name" name="name" defaultValue={farm.name} disabled={!canEdit} required />
          </Field>

          <Field label="SIRET / SIREN" htmlFor="siret" error={fieldErrors.siret}>
            <Input
              id="siret"
              name="siret"
              inputMode="numeric"
              defaultValue={farm.siret ?? ''}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Département" htmlFor="department">
            <Input
              id="department"
              name="department"
              defaultValue={farm.department ?? ''}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Adresse" htmlFor="addressLine" className="sm:col-span-2">
            <Input
              id="addressLine"
              name="addressLine"
              defaultValue={farm.addressLine ?? ''}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Code postal" htmlFor="postalCode">
            <Input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              defaultValue={farm.postalCode ?? ''}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Commune" htmlFor="city">
            <Input id="city" name="city" defaultValue={farm.city ?? ''} disabled={!canEdit} />
          </Field>
        </div>

        {canEdit ? (
          <div className="rounded-lg bg-surface-2 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  Position du siège d&apos;exploitation
                </p>
                <p className="text-xs text-ink-3">
                  {coords.lat !== null && coords.lng !== null
                    ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                    : 'Non renseignée — la météo utilisera le centre d’une parcelle.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void locate()}
                disabled={locating}
              >
                {locating ? <Spinner /> : null}
                Localiser depuis l&apos;adresse
              </Button>
            </div>

            {hits.length > 0 ? (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
                {hits.map((hit, index) => (
                  <li key={`${hit.label}-${index}`}>
                    <button
                      type="button"
                      onClick={() => applyHit(hit)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft/60"
                    >
                      {hit.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner /> : null}
              Enregistrer
            </Button>
          </div>
        ) : (
          <Alert tone="info">
            Votre rôle ne permet pas de modifier les informations de l&apos;exploitation.
          </Alert>
        )}
      </form>
    </Card>
  );
}
