'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost, apiPut } from '@/lib/client/api';
import type {
  RecommendationKind,
  RecommendationView,
} from '@/lib/services/advisory.shared';
import { KIND_LABELS } from '@/lib/services/advisory.shared';
import {
  EphyProductSearch,
  type EphyProduct,
} from '@/components/forms/EphyProductSearch';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { IconPhyto, IconRegistry, IconSecurity } from '@/components/ui/icons';

type ParcelOption = { id: string; name: string; areaHa: number };

/**
 * Rédaction d'une préconisation.
 *
 * Deux garde-fous qui ne sont pas cosmétiques :
 *
 *  - **La justification est obligatoire.** Sans elle, une préconisation n'est
 *    qu'une consigne : l'exploitant ne peut pas l'apprécier, et elle ne vaut
 *    rien dans un dossier de contrôle.
 *  - **Rien n'est pré-rempli à partir du catalogue.** La recherche E-Phy sert à
 *    retrouver l'AMM exacte d'un produit ; la dose reste celle que l'expert
 *    décide, sous sa responsabilité. Parcelys n'en propose aucune.
 */
export function RecommendationForm({
  farmId,
  parcels,
  doseUnits,
  existing,
  ephyConfigured,
}: {
  farmId: string;
  parcels: ParcelOption[];
  doseUnits: readonly string[];
  existing?: RecommendationView;
  ephyConfigured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [kind, setKind] = useState<RecommendationKind>(existing?.kind ?? 'PHYTO');
  const [productName, setProductName] = useState(existing?.productName ?? '');
  const [amm, setAmm] = useState(existing?.amm ?? '');
  const [ephyProduct, setEphyProduct] = useState<EphyProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const isPhyto = kind === 'PHYTO';
  const needsProduct = isPhyto || kind === 'FERTILIZATION';

  async function submit(event: FormEvent<HTMLFormElement>, send: boolean): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const doseRaw = String(form.get('dose') ?? '').trim();

    const payload = {
      parcelId: String(form.get('parcelId') ?? ''),
      kind,
      priority: String(form.get('priority') ?? 'NORMAL'),
      title: String(form.get('title') ?? ''),
      rationale: String(form.get('rationale') ?? ''),
      productName: needsProduct ? productName : '',
      amm: isPhyto ? amm : '',
      ...(doseRaw ? { dose: Number(doseRaw) } : {}),
      ...(needsProduct ? { doseUnit: String(form.get('doseUnit') ?? '') } : {}),
      targetLabel: String(form.get('targetLabel') ?? ''),
      windowStart: String(form.get('windowStart') ?? ''),
      windowEnd: String(form.get('windowEnd') ?? ''),
      send,
    };

    try {
      if (existing) {
        await apiPut(`/api/recommendations/${existing.id}`, payload);
        toast.success(send ? 'Préconisation transmise.' : 'Brouillon enregistré.');
        router.push(`/portefeuille/preconisations/${existing.id}`);
      } else {
        const created = await apiPost<{ id: string }>(
          `/api/recommendations?farmId=${encodeURIComponent(farmId)}`,
          payload,
        );
        toast.success(
          send
            ? "Préconisation transmise à l'exploitation."
            : 'Brouillon enregistré.',
        );
        router.push(`/portefeuille/preconisations/${created.id}`);
      }
      router.refresh();
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
    <form onSubmit={(event) => void submit(event, true)} className="space-y-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader
          icon={IconRegistry}
          title="Ce que vous préconisez"
          description="L'exploitation recevra cette fiche et pourra l'accepter ou l'écarter."
        />

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nature" htmlFor="kind" required>
              <Select
                id="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as RecommendationKind)}
              >
                {(Object.keys(KIND_LABELS) as RecommendationKind[]).map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Priorité" htmlFor="priority" required>
              <Select
                id="priority"
                name="priority"
                defaultValue={existing?.priority ?? 'NORMAL'}
              >
                <option value="LOW">Basse</option>
                <option value="NORMAL">Normale</option>
                <option value="HIGH">Urgente — alerte l&apos;exploitant par e-mail</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Parcelle concernée"
            htmlFor="parcelId"
            hint="Laissez vide pour une préconisation portant sur toute l'exploitation."
            error={fieldErrors.parcelId}
          >
            <Select id="parcelId" name="parcelId" defaultValue={existing?.parcelId ?? ''}>
              <option value="">— Toute l&apos;exploitation —</option>
              {parcels.map((parcel) => (
                <option key={parcel.id} value={parcel.id}>
                  {parcel.name} ({parcel.areaHa.toFixed(2)} ha)
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Intitulé" htmlFor="title" required error={fieldErrors.title}>
            <Input
              id="title"
              name="title"
              defaultValue={existing?.title ?? ''}
              placeholder="Protection fongicide T1 sur blé"
              required
            />
          </Field>

          <Field
            label="Justification agronomique"
            htmlFor="rationale"
            required
            hint="Ce qui motive le conseil : stade, pression observée, conditions. C'est ce que l'exploitant relira, et ce qui documente la décision."
            error={fieldErrors.rationale}
          >
            <Textarea
              id="rationale"
              name="rationale"
              rows={4}
              defaultValue={existing?.rationale ?? ''}
              placeholder="Stade 2 nœuds atteint, septoriose présente sur F3 avec 15 % de fréquence…"
              required
            />
          </Field>
        </div>
      </Card>

      {needsProduct ? (
        <Card>
          <CardHeader
            icon={IconPhyto}
            title={isPhyto ? 'Produit et dose' : 'Fertilisant et dose'}
            description={
              isPhyto
                ? "Recherchez le produit pour retrouver son AMM exacte. La dose reste la vôtre : Parcelys n'en propose aucune."
                : 'Produit et dose conseillés.'
            }
          />

          <div className="space-y-4">
            {isPhyto ? (
              ephyConfigured ? (
                <EphyProductSearch
                  selected={ephyProduct}
                  onSelect={(product) => {
                    setEphyProduct(product);
                    if (product) {
                      setProductName(product.name);
                      setAmm(product.amm);
                    }
                  }}
                />
              ) : (
                <Alert tone="warning" icon={IconSecurity}>
                  Le catalogue officiel E-Phy n&apos;est pas importé sur cette
                  instance : la recherche de produit est indisponible. Le produit
                  que vous saisirez sera transmis à l&apos;exploitation avec la
                  mention « non vérifié au catalogue ».
                </Alert>
              )
            ) : null}

            <Field
              label={isPhyto ? 'Produit' : 'Fertilisant'}
              htmlFor="productName"
              required={isPhyto}
              error={fieldErrors.productName}
            >
              <Input
                id="productName"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder={isPhyto ? 'Nom commercial' : 'Ammonitrate 33,5 %'}
              />
            </Field>

            {isPhyto ? (
              <Field
                label="Numéro d'AMM"
                htmlFor="amm"
                hint="Rempli automatiquement si vous choisissez un produit du catalogue. Sans AMM, la préconisation sera marquée « non vérifiée »."
                error={fieldErrors.amm}
              >
                <Input
                  id="amm"
                  value={amm}
                  onChange={(event) => setAmm(event.target.value)}
                  inputMode="numeric"
                  placeholder="2100000"
                />
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Dose conseillée"
                htmlFor="dose"
                required={isPhyto}
                error={fieldErrors.dose}
              >
                <Input
                  id="dose"
                  name="dose"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={existing?.dose ?? ''}
                />
              </Field>
              <Field label="Unité" htmlFor="doseUnit" required={isPhyto}>
                <Select
                  id="doseUnit"
                  name="doseUnit"
                  defaultValue={existing?.doseUnit ?? (isPhyto ? 'L/ha' : 'kg/ha')}
                >
                  {doseUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {isPhyto ? (
              <Field
                label="Cible"
                htmlFor="targetLabel"
                hint="Ravageur, maladie ou adventice visé."
              >
                <Input
                  id="targetLabel"
                  name="targetLabel"
                  defaultValue={existing?.targetLabel ?? ''}
                  placeholder="Septoriose"
                />
              </Field>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Fenêtre d'intervention"
          description="Facultative, mais utile : elle indique à l'exploitant quand agir."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="À partir du" htmlFor="windowStart">
            <Input
              id="windowStart"
              name="windowStart"
              type="date"
              defaultValue={existing?.windowStart?.slice(0, 10) ?? ''}
            />
          </Field>
          <Field label="Jusqu'au" htmlFor="windowEnd" error={fieldErrors.windowEnd}>
            <Input
              id="windowEnd"
              name="windowEnd"
              type="date"
              defaultValue={existing?.windowEnd?.slice(0, 10) ?? ''}
            />
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          loading={submitting}
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) {
              void submit(
                { preventDefault: () => undefined, currentTarget: form } as unknown as FormEvent<HTMLFormElement>,
                false,
              );
            }
          }}
        >
          Enregistrer en brouillon
        </Button>
        <Button type="submit" loading={submitting}>
          {existing && existing.status !== 'DRAFT'
            ? 'Mettre à jour'
            : "Transmettre à l'exploitation"}
        </Button>
      </div>
    </form>
  );
}
