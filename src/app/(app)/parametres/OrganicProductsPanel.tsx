'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPatch, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';
import { IconEdit, IconInputs, IconPlus } from '@/components/ui/icons';

export type ProduitOrganique = {
  id: string;
  name: string;
  category: string | null;
  nContent: number | null;
  pContent: number | null;
  kContent: number | null;
  dryMatter: number | null;
  defaultUnit: string;
  regulatoryClass: {
    typePan?: string | null;
    aplsh?: string | null;
    keq?: string | null;
    teneur?: string | null;
  } | null;
};

type Denomination = { code: string; libelle: string };

export type OptionsFiche19 = {
  referentiel: { version: string; source: string; depuis: string } | null;
  aplsh: Denomination[];
  keq: Denomination[];
  teneur: (Denomination & { teneurKgN: number | null })[];
};

const TYPES = [
  { code: '0', libelle: 'Type 0' },
  { code: 'I', libelle: 'Type I' },
  { code: 'II', libelle: 'Type II' },
  { code: 'III', libelle: 'Type III' },
];

function libelleDe(liste: Denomination[], code: string | null | undefined): string | null {
  if (!code) return null;
  return liste.find((d) => d.code === code)?.libelle ?? `« ${code} » (absente de la fiche 19 en vigueur)`;
}

function nombreOuVide(valeur: FormDataEntryValue | null): string {
  return typeof valeur === 'string' ? valeur.trim().replace(',', '.') : '';
}

function choixOuNull(valeur: FormDataEntryValue | null): string | null {
  return typeof valeur === 'string' && valeur !== '' ? valeur : null;
}

/**
 * Les produits organiques de l'exploitation, avec leurs teneurs et leur
 * classement réglementaire.
 *
 * Le classement n'est jamais déduit du nom : un exploitant qui appelle son
 * produit « fumier » peut épandre un compost. Il le déclare ici, en choisissant
 * parmi les dénominations de la fiche GREN 19 importée — et ce choix est ce
 * que les contrôles du programme d'actions et le calcul de la dose
 * prévisionnelle utilisent. Non déclaré, la règle qui en dépend reste
 * indéterminée, et le dit.
 */
export function OrganicProductsPanel({
  produits,
  options,
  canEdit,
}: {
  produits: ProduitOrganique[];
  options: OptionsFiche19;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [edition, setEdition] = useState<string | 'nouveau' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function enregistrer(event: FormEvent<HTMLFormElement>, id: string | null): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const corps = {
      name: String(form.get('name') ?? ''),
      category: String(form.get('category') ?? ''),
      nContent: nombreOuVide(form.get('nContent')),
      pContent: nombreOuVide(form.get('pContent')),
      kContent: nombreOuVide(form.get('kContent')),
      dryMatter: nombreOuVide(form.get('dryMatter')),
      defaultUnit: String(form.get('defaultUnit') ?? 't/ha'),
      regulatoryClass: {
        typePan: choixOuNull(form.get('typePan')),
        aplsh: choixOuNull(form.get('aplsh')),
        keq: choixOuNull(form.get('keq')),
        teneur: choixOuNull(form.get('teneur')),
      },
    };
    try {
      const resultat = id
        ? await apiPatch<{ message: string }>(`/api/organic-inputs/${id}`, corps)
        : await apiPost<{ message: string }>('/api/organic-inputs', corps);
      toast.success(resultat.message);
      setEdition(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Enregistrement impossible.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function formulaire(produit: ProduitOrganique | null) {
    const c = produit?.regulatoryClass ?? null;
    return (
      <form
        onSubmit={(event) => void enregistrer(event, produit?.id ?? null)}
        className="space-y-3 rounded-lg border border-line bg-surface-2 p-3.5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom" htmlFor="op-name" required error={fieldErrors.name}>
            <Input id="op-name" name="name" defaultValue={produit?.name ?? ''} required maxLength={120} />
          </Field>
          <Field label="Catégorie" htmlFor="op-category" hint="Libre : fumier, lisier, compost…">
            <Input id="op-category" name="category" defaultValue={produit?.category ?? ''} maxLength={80} />
          </Field>
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium text-ink-2">
            Teneurs du produit brut (analyse), en kg par tonne ou par m³
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="Azote N" htmlFor="op-n" error={fieldErrors.nContent}>
              <Input id="op-n" name="nContent" inputMode="decimal" defaultValue={produit?.nContent ?? ''} />
            </Field>
            <Field label="P₂O₅" htmlFor="op-p" error={fieldErrors.pContent}>
              <Input id="op-p" name="pContent" inputMode="decimal" defaultValue={produit?.pContent ?? ''} />
            </Field>
            <Field label="K₂O" htmlFor="op-k" error={fieldErrors.kContent}>
              <Input id="op-k" name="kContent" inputMode="decimal" defaultValue={produit?.kContent ?? ''} />
            </Field>
            <Field label="Matière sèche %" htmlFor="op-ms" error={fieldErrors.dryMatter}>
              <Input id="op-ms" name="dryMatter" inputMode="decimal" defaultValue={produit?.dryMatter ?? ''} />
            </Field>
            <Field label="Unité" htmlFor="op-unit">
              <Select id="op-unit" name="defaultUnit" defaultValue={produit?.defaultUnit ?? 't/ha'}>
                <option value="t/ha">t/ha</option>
                <option value="m3/ha">m³/ha</option>
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-medium text-ink-2">Classement réglementaire</legend>
          {options.referentiel ? (
            <p className="mt-0.5 text-[12px] text-ink-3">
              Dénominations de la fiche GREN 19 — {options.referentiel.version}.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-ink-3">
              Le référentiel GREN n’est pas importé : seul le type peut être déclaré.
            </p>
          )}
          <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
            <Field
              label="Type (programme d’actions)"
              htmlFor="op-type"
              hint="Défini par le programme national ; à reprendre de la fiche du produit ou de votre plan d’épandage."
            >
              <Select id="op-type" name="typePan" defaultValue={c?.typePan ?? ''}>
                <option value="">Non déclaré</option>
                {TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.libelle}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Azote potentiellement libéré (fiche 19)" htmlFor="op-aplsh">
              <Select id="op-aplsh" name="aplsh" defaultValue={c?.aplsh ?? ''} disabled={!options.referentiel}>
                <option value="">Non déclaré</option>
                {options.aplsh.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.libelle}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Coefficient Kéq (fiche 19)" htmlFor="op-keq">
              <Select id="op-keq" name="keq" defaultValue={c?.keq ?? ''} disabled={!options.referentiel}>
                <option value="">Non déclaré</option>
                {options.keq.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.libelle}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Teneur de référence (fiche 19)"
              htmlFor="op-teneur"
              hint="Utilisée à défaut d’analyse."
            >
              <Select id="op-teneur" name="teneur" defaultValue={c?.teneur ?? ''} disabled={!options.referentiel}>
                <option value="">Non déclarée</option>
                {options.teneur.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.libelle}
                    {d.teneurKgN !== null ? ` — ${d.teneurKgN.toLocaleString('fr-FR')} kg N` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={submitting}>
            Enregistrer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEdition(null)}>
            Annuler
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Card>
      <CardHeader
        icon={IconInputs}
        title="Produits organiques"
        description="Vos effluents et amendements : teneurs d’analyse et classement réglementaire, utilisés par les contrôles d’épandage et la dose prévisionnelle."
      />

      {produits.length === 0 ? (
        <p className="mb-3 text-sm text-ink-3">
          Aucun produit propre à l’exploitation. Les produits génériques (fumier bovin…) n’ont ni
          teneur ni classement : créez le vôtre, d’après votre analyse.
        </p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {produits.map((p) =>
            edition === p.id ? (
              <li key={p.id} className="py-3">
                {formulaire(p)}
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-ink">
                    {p.name}
                    {p.category ? <span className="ml-1.5 text-[13px] font-normal text-ink-3">{p.category}</span> : null}
                  </p>
                  <p className="text-[13px] text-ink-2">
                    {p.nContent !== null ? `N ${p.nContent.toLocaleString('fr-FR')}` : 'N non renseigné'}
                    {p.pContent !== null ? ` · P₂O₅ ${p.pContent.toLocaleString('fr-FR')}` : ''}
                    {p.kContent !== null ? ` · K₂O ${p.kContent.toLocaleString('fr-FR')}` : ''} kg/
                    {p.defaultUnit === 'm3/ha' ? 'm³' : 't'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <Badge tone={p.regulatoryClass?.typePan ? 'green' : 'neutral'}>
                      {p.regulatoryClass?.typePan ? `Type ${p.regulatoryClass.typePan}` : 'Type non déclaré'}
                    </Badge>
                    {libelleDe(options.aplsh, p.regulatoryClass?.aplsh) ? (
                      <Badge tone="neutral">APLSH : {libelleDe(options.aplsh, p.regulatoryClass?.aplsh)}</Badge>
                    ) : null}
                    {libelleDe(options.keq, p.regulatoryClass?.keq) ? (
                      <Badge tone="neutral">Kéq : {libelleDe(options.keq, p.regulatoryClass?.keq)}</Badge>
                    ) : null}
                    {libelleDe(options.teneur, p.regulatoryClass?.teneur) ? (
                      <Badge tone="neutral">Teneur : {libelleDe(options.teneur, p.regulatoryClass?.teneur)}</Badge>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <Button size="sm" variant="outline" icon={IconEdit} onClick={() => setEdition(p.id)}>
                    Modifier
                  </Button>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}

      {canEdit ? (
        edition === 'nouveau' ? (
          formulaire(null)
        ) : (
          <Button variant="outline" icon={IconPlus} onClick={() => setEdition('nouveau')}>
            Ajouter un produit
          </Button>
        )
      ) : null}
    </Card>
  );
}
