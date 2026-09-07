'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import {
  EphyProductSearch,
  type EphyProduct,
} from '@/components/forms/EphyProductSearch';
import { Badge, Spinner, TableWrapper, Td, Th } from '@/components/ui';

type ProductDetail = {
  source: { label: string; lastSyncAt: string | null };
  product: {
    id: string;
    amm: string;
    name: string;
    secondNames: string | null;
    holder: string | null;
    status: string | null;
    productType: string | null;
    commercialType: string | null;
    formulation: string | null;
    authorizedMentions: string | null;
    usageRestrictions: string | null;
    withdrawnAt: string | null;
    substances: Array<{
      name: string;
      casNumber: string | null;
      concentration: string | null;
      unit: string | null;
    }>;
    usages: Array<{
      id: string;
      cropLabel: string | null;
      targetLabel: string | null;
      doseValue: string | null;
      doseUnit: string | null;
      status: string | null;
      conditions: string | null;
      preHarvestDelay: string | null;
      zntAquaticM: string | null;
      maxApplications: string | null;
    }>;
  };
};

/**
 * Consultation d'une fiche produit E-Phy.
 * Tous les champs sont restitués tels qu'importés ; un champ absent du jeu de
 * données officiel est affiché comme non renseigné, jamais complété.
 */
export function EphyExplorer() {
  const [selected, setSelected] = useState<EphyProduct | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSelect(product: EphyProduct | null): void {
    setSelected(product);
    setDetail(null);
    if (!product) return;

    setLoading(true);
    void apiFetch<ProductDetail>(`/api/phytosanitary/products/${product.id}`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }

  return (
    <div className="space-y-4">
      <EphyProductSearch selected={selected} onSelect={handleSelect} />

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-ardoise-500">
          <Spinner /> Chargement de la fiche produit…
        </p>
      ) : null}

      {detail ? (
        <div className="space-y-4 rounded-lg border border-ardoise-200 p-4">
          <div>
            <h3 className="text-lg font-semibold text-ardoise-900">
              {detail.product.name}
            </h3>
            <p className="text-sm text-ardoise-500">
              AMM {detail.product.amm}
              {detail.product.holder ? ` · ${detail.product.holder}` : ''}
            </p>
            {detail.product.secondNames ? (
              <p className="mt-0.5 text-sm text-ardoise-500">
                Autres noms commerciaux : {detail.product.secondNames}
              </p>
            ) : null}
          </div>

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              ['Statut', detail.product.status],
              ['Type de produit', detail.product.productType],
              ['Type commercial', detail.product.commercialType],
              ['Formulation', detail.product.formulation],
              ['Mentions autorisées', detail.product.authorizedMentions],
              [
                'Date de retrait',
                detail.product.withdrawnAt
                  ? new Date(detail.product.withdrawnAt).toLocaleDateString('fr-FR')
                  : null,
              ],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ardoise-500">
                  {label}
                </dt>
                <dd className="mt-0.5 text-sm text-ardoise-900">
                  {value ?? <span className="text-ardoise-400">Non renseigné</span>}
                </dd>
              </div>
            ))}
          </dl>

          {detail.product.usageRestrictions ? (
            <div className="rounded-lg border border-ble-500/30 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                Restrictions d&apos;usage
              </p>
              <p className="mt-1 text-sm text-amber-900">
                {detail.product.usageRestrictions}
              </p>
            </div>
          ) : null}

          <div>
            <h4 className="mb-2 text-sm font-semibold text-ardoise-800">
              Substances actives
            </h4>
            {detail.product.substances.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {detail.product.substances.map((substance) => (
                  <li key={substance.name}>
                    <Badge tone="blue">
                      {substance.name}
                      {substance.concentration
                        ? ` — ${substance.concentration}${substance.unit ?? ''}`
                        : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ardoise-500">
                Aucune substance active renseignée dans le jeu de données importé.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-ardoise-800">
              Usages autorisés ({detail.product.usages.length})
            </h4>
            {detail.product.usages.length > 0 ? (
              <div className="max-h-96 overflow-auto">
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>Culture</Th>
                      <Th>Cible</Th>
                      <Th>Dose</Th>
                      <Th>Statut</Th>
                      <Th>DAR</Th>
                      <Th>ZNT aquatique</Th>
                      <Th>Applications max.</Th>
                      <Th>Conditions d&apos;emploi</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.product.usages.map((usage) => (
                      <tr key={usage.id}>
                        <Td>{usage.cropLabel ?? '—'}</Td>
                        <Td>{usage.targetLabel ?? '—'}</Td>
                        <Td>
                          {usage.doseValue
                            ? `${usage.doseValue} ${usage.doseUnit ?? ''}`.trim()
                            : '—'}
                        </Td>
                        <Td>{usage.status ?? '—'}</Td>
                        <Td>{usage.preHarvestDelay ?? '—'}</Td>
                        <Td>{usage.zntAquaticM ?? '—'}</Td>
                        <Td>{usage.maxApplications ?? '—'}</Td>
                        <Td className="max-w-[280px] text-xs">
                          {usage.conditions ?? '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              </div>
            ) : (
              <p className="text-sm text-ardoise-500">
                Aucun usage importé pour ce produit. Le fichier des usages n&apos;était
                peut-être pas présent lors de la dernière synchronisation.
              </p>
            )}
          </div>

          <p className="border-t border-ardoise-100 pt-3 text-xs text-ardoise-500">
            {detail.source.label}
            {detail.source.lastSyncAt
              ? ` — dernière synchronisation : ${new Date(detail.source.lastSyncAt).toLocaleDateString('fr-FR')}`
              : ''}
            . Ces informations ne se substituent pas à l&apos;étiquette du produit ni à la
            décision d&apos;autorisation en vigueur.
          </p>
        </div>
      ) : null}
    </div>
  );
}
