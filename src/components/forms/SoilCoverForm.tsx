'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

/**
 * Saisie d'un couvert d'interculture.
 *
 * ## Pourquoi si peu de champs obligatoires
 *
 * Seule la nature du couvert l'est. Ni le semis, ni la levée, ni la destruction
 * ne sont exigés — un couvert semé dont on n'a pas noté la levée reste un
 * couvert semé, et refuser l'enregistrement pousserait à inventer une date.
 * C'est précisément la date qu'un contrôle examinerait.
 *
 * ## Ce que le formulaire ne fait pas
 *
 * Il ne dit pas si le couvert est semé « à temps ». Les périodes de couverture
 * obligatoire relèvent du programme d'actions régional, et elles diffèrent d'une
 * région à l'autre. Afficher une échéance ici reviendrait à en inventer une.
 */

const NATURES: Array<{ value: string; label: string; aide: string }> = [
  {
    value: 'CIPAN',
    label: 'CIPAN',
    aide: 'Culture intermédiaire piège à nitrates, non récoltée.',
  },
  {
    value: 'DEROBEE',
    label: 'Culture dérobée',
    aide: 'Implantée puis récoltée entre deux cultures principales.',
  },
  { value: 'REPOUSSES', label: 'Repousses', aide: 'Repousses de colza ou de céréales.' },
  { value: 'RESIDUS', label: 'Résidus de récolte', aide: 'Mulch laissé en place.' },
  { value: 'COUVERT_PERMANENT', label: 'Couvert permanent', aide: 'Enherbement, prairie.' },
  { value: 'AUTRE', label: 'Autre', aide: '' },
];

const DESTRUCTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Non détruit / non renseigné' },
  { value: 'MECANIQUE', label: 'Mécanique' },
  { value: 'GEL', label: 'Gel' },
  { value: 'PATURAGE', label: 'Pâturage' },
  { value: 'ROULAGE', label: 'Roulage' },
  { value: 'BROYAGE', label: 'Broyage' },
  { value: 'CHIMIQUE', label: 'Chimique' },
  { value: 'RECOLTE', label: 'Récolte' },
  { value: 'AUTRE', label: 'Autre' },
];

export function SoilCoverForm({
  parcelId,
  cropYears,
  onDone,
}: {
  parcelId: string;
  cropYears: Array<{ id: string; label: string }>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [nature, setNature] = useState('CIPAN');

  const aide = NATURES.find((n) => n.value === nature)?.aide ?? '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const texte = (cle: string): string | undefined =>
      String(form.get(cle) ?? '').trim() || undefined;

    try {
      await apiPost('/api/soil-covers', {
        parcelId,
        cropYearId: texte('cropYearId') ?? null,
        kind: nature,
        species: texte('species') ?? null,
        sownOn: texte('sownOn') ?? null,
        emergedOn: texte('emergedOn') ?? null,
        destroyedOn: texte('destroyedOn') ?? null,
        destructionMethod: texte('destructionMethod') ?? null,
        areaHa: texte('areaHa') ? Number(texte('areaHa')) : null,
        notes: texte('notes') ?? null,
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
        <Field label="Nature du couvert" htmlFor="kind" required hint={aide}>
          <Select
            id="kind"
            name="kind"
            value={nature}
            onChange={(e) => setNature(e.target.value)}
            required
          >
            {NATURES.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Espèces"
          htmlFor="species"
          hint="Le mélange compte : certains programmes régionaux encadrent la part de légumineuses."
        >
          <Input id="species" name="species" placeholder="Moutarde blanche, phacélie" />
        </Field>

        <Field label="Semis" htmlFor="sownOn" error={fieldErrors.sownOn}>
          <Input id="sownOn" name="sownOn" type="date" />
        </Field>

        <Field label="Levée" htmlFor="emergedOn" error={fieldErrors.emergedOn}>
          <Input id="emergedOn" name="emergedOn" type="date" />
        </Field>

        <Field label="Destruction" htmlFor="destroyedOn" error={fieldErrors.destroyedOn}>
          <Input id="destroyedOn" name="destroyedOn" type="date" />
        </Field>

        <Field label="Mode de destruction" htmlFor="destructionMethod">
          <Select id="destructionMethod" name="destructionMethod" defaultValue="">
            {DESTRUCTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Surface couverte (ha)"
          htmlFor="areaHa"
          hint="Seulement si elle diffère de la parcelle entière."
        >
          <Input id="areaHa" name="areaHa" type="number" step="0.0001" min="0" />
        </Field>

        {cropYears.length > 0 ? (
          <Field label="Campagne concernée" htmlFor="cropYearId">
            <Select id="cropYearId" name="cropYearId" defaultValue="">
              <option value="">Non rattaché</option>
              {cropYears.map((cy) => (
                <option key={cy.id} value={cy.id}>
                  {cy.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <Field label="Observations" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <p className="text-[12.5px] leading-relaxed text-ink-3">
        Seule la nature est obligatoire. Une date que vous ne connaissez pas vaut
        mieux vide que devinée : c’est elle qu’un contrôle examinerait.
      </p>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Enregistrement…' : 'Enregistrer le couvert'}
        </Button>
      </div>
    </form>
  );
}
