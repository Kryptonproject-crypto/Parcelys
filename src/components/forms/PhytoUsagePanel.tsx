'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { checkDose, usagesForCrop, type UsageForDose } from '@/lib/ephy/dose';
import { Alert, Badge, Select, Spinner } from '@/components/ui';

export type ProductUsages = {
  product: {
    id: string;
    amm: string;
    name: string;
    status: string | null;
    authorized: boolean;
    withdrawnAt: string | null;
  };
  usages: UsageForDose[];
  crops: string[];
  drainedSoilRestrictions: Array<{
    category: string;
    label: string;
    severity: 'interdit' | 'a-verifier';
  }>;
  source: { label: string; lastSyncAt: string | null };
};

/**
 * Ce que le catalogue officiel dit du traitement en cours de saisie.
 *
 * Trois choses, dans cet ordre : la dose retenue pour la culture et l'écart de
 * la dose saisie ; les zones non traitées à respecter ; les conditions d'emploi
 * qui visent les sols drainés, quand la parcelle en est un.
 *
 * Rien n'est calculé au-delà de la comparaison de doses (cf. `checkDose`) et
 * rien n'est reformulé : les libellés de conditions sont ceux de l'ANSES. Le
 * panneau ne masque jamais son ignorance — quand la dose n'est pas comparable
 * ou l'usage inconnu au catalogue, il le dit plutôt que de se taire.
 */
export function PhytoUsagePanel({
  productId,
  crop,
  onCropChange,
  dose,
  doseUnit,
  parcelDrained,
}: {
  productId: string | null;
  /** Culture retenue pour la comparaison (libellé E-Phy ou saisie). */
  crop: string;
  onCropChange: (crop: string) => void;
  dose: string;
  doseUnit: string;
  /** `null` = non renseigné sur la parcelle, et non « non drainé ». */
  parcelDrained: boolean | null;
}) {
  const [data, setData] = useState<ProductUsages | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setData(null);
      setErreur(null);
      return;
    }

    let abandonne = false;
    setLoading(true);
    setErreur(null);

    void apiFetch<ProductUsages>(`/api/phytosanitary/products/${productId}/usages`)
      .then((reponse) => {
        if (abandonne) return;
        setData(reponse);
      })
      .catch(() => {
        if (abandonne) return;
        setData(null);
        setErreur(
          'Usages du catalogue indisponibles : la dose ne peut pas être comparée.',
        );
      })
      .finally(() => {
        if (!abandonne) setLoading(false);
      });

    return () => {
      abandonne = true;
    };
  }, [productId]);

  const doseNombre = Number(dose);
  const controle = useMemo(() => {
    if (!data || !Number.isFinite(doseNombre) || doseNombre <= 0) return null;
    return checkDose({
      usages: data.usages,
      crop: crop || null,
      dose: doseNombre,
      doseUnit,
    });
  }, [data, crop, doseNombre, doseUnit]);

  /** Usages en vigueur pour la culture retenue, pour le tableau des ZNT. */
  const usagesCulture = useMemo(() => {
    if (!data || !crop) return [];
    return usagesForCrop(data.usages, crop).slice(0, 6);
  }, [data, crop]);

  if (!productId) return null;

  if (loading) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-3">
        <Spinner /> Lecture des usages autorisés…
      </p>
    );
  }

  if (erreur) {
    return <Alert tone="warning">{erreur}</Alert>;
  }

  if (!data) return null;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold text-ink">
          Usages autorisés au catalogue
        </h3>
        <span className="text-xs text-ink-3">
          {data.usages.length} usage{data.usages.length > 1 ? 's' : ''} en vigueur
        </span>
      </div>

      {data.crops.length > 0 ? (
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Culture traitée, telle que nommée au catalogue
          </span>
          <Select value={crop} onChange={(e) => onCropChange(e.target.value)}>
            <option value="">— Choisir la culture —</option>
            {data.crops.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-ink-3">
            C’est ce libellé qui détermine la dose de référence et les ZNT.
          </span>
        </label>
      ) : (
        <p className="text-[13px] text-ink-3">
          Ce produit n’a aucun usage en vigueur au catalogue : aucune dose de
          référence ne peut être opposée à votre saisie.
        </p>
      )}

      {/* --- Verdict de dose ------------------------------------------------ */}
      {controle ? <DoseVerdict verdict={controle.verdict} message={controle.message} /> : null}

      {/* --- ZNT et délais de l'usage retenu -------------------------------- */}
      {usagesCulture.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-3 font-medium">Cible</th>
                <th className="py-1.5 pr-3 font-medium">Dose retenue</th>
                <th className="py-1.5 pr-3 font-medium">DAR</th>
                <th className="py-1.5 pr-3 font-medium">Applications</th>
                <th className="py-1.5 font-medium">ZNT (aquat. / arthr. / plantes)</th>
              </tr>
            </thead>
            <tbody>
              {usagesCulture.map((usage) => (
                <tr key={usage.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 text-ink-2">{usage.targetLabel ?? '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink">
                    {usage.doseValue && usage.doseUnit
                      ? `${usage.doseValue} ${usage.doseUnit}`
                      : 'non publiée'}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink-2">
                    {usage.preHarvestDelay ? `${usage.preHarvestDelay} j` : '—'}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink-2">
                    {usage.maxApplications ?? '—'}
                    {usage.minIntervalDays ? ` · ${usage.minIntervalDays} j d’écart` : ''}
                  </td>
                  <td className="py-1.5 tabular-nums text-ink-2">
                    {formatZnt(usage)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* --- Sol drainé ------------------------------------------------------ */}
      <DrainedSoilNotice
        parcelDrained={parcelDrained}
        restrictions={data.drainedSoilRestrictions}
        productName={data.product.name}
      />

      <p className="border-t border-line pt-2 text-xs text-ink-3">
        {data.source.label}
        {data.source.lastSyncAt
          ? ` — dernière synchronisation : ${new Date(
              data.source.lastSyncAt,
            ).toLocaleDateString('fr-FR')}`
          : ''}
        . Ces valeurs ne remplacent pas l’étiquette du produit, qui fait foi.
      </p>
    </div>
  );
}

/**
 * Les ZNT, écrites telles quelles.
 *
 * Une ZNT absente du catalogue n'est pas une ZNT nulle : c'est une donnée
 * absente. On affiche un tiret, jamais « 0 m ».
 */
function formatZnt(usage: UsageForDose): string {
  const valeurs = [usage.zntAquaticM, usage.zntArthropodM, usage.zntPlantM].map((v) =>
    v ? `${v} m` : '—',
  );
  return valeurs.join(' / ');
}

function DoseVerdict({ verdict, message }: { verdict: string; message: string }) {
  if (verdict === 'depassement') {
    return (
      <Alert tone="danger" title="Dose supérieure à la dose retenue">
        {message} Réduisez la dose, ou justifiez l’écart dans les observations —
        l’enregistrement reste possible, mais il sera annoté dans votre registre.
      </Alert>
    );
  }
  if (verdict === 'conforme') {
    return <Alert tone="success">{message}</Alert>;
  }
  if (verdict === 'usage-inconnu') {
    return <Alert tone="warning">{message}</Alert>;
  }
  if (verdict === 'unites-incomparables' || verdict === 'dose-non-exploitable') {
    return <Alert tone="info">{message}</Alert>;
  }
  return null;
}

/**
 * Sol drainé : trois états, trois messages.
 *
 * `null` — la parcelle ne dit pas si elle est drainée. C'est le cas le plus
 * fréquent au départ, et le plus dangereux à traiter en silence : plusieurs
 * produits interdisent formellement l'application sur sol artificiellement
 * drainé. On invite à renseigner l'information, on ne la suppose pas.
 */
function DrainedSoilNotice({
  parcelDrained,
  restrictions,
  productName,
}: {
  parcelDrained: boolean | null;
  restrictions: ProductUsages['drainedSoilRestrictions'];
  productName: string;
}) {
  if (restrictions.length === 0) return null;

  const interdiction = restrictions.some((r) => r.severity === 'interdit');

  if (parcelDrained === true) {
    return (
      <Alert
        tone={interdiction ? 'danger' : 'warning'}
        title={
          interdiction
            ? 'Parcelle en sol drainé : application interdite'
            : 'Parcelle en sol drainé : condition d’emploi à respecter'
        }
      >
        <ul className="mt-1 space-y-1.5">
          {restrictions.map((r) => (
            <li key={r.label}>
              <span className="font-medium">{r.category} — </span>
              {r.label}
            </li>
          ))}
        </ul>
      </Alert>
    );
  }

  if (parcelDrained === null) {
    return (
      <Alert tone="warning" title="Sol drainé : information manquante">
        {productName} porte {restrictions.length} condition
        {restrictions.length > 1 ? 's' : ''} d’emploi visant les sols
        artificiellement drainés. La parcelle ne précise pas si elle l’est.
        Renseignez-le dans la fiche parcelle pour que l’avertissement soit
        pertinent.
      </Alert>
    );
  }

  return (
    <p className="text-xs text-ink-3">
      <Badge tone="neutral">Sol non drainé</Badge>{' '}
      {restrictions.length} condition{restrictions.length > 1 ? 's' : ''} d’emploi
      de ce produit ne concerne{restrictions.length > 1 ? 'nt' : ''} que les sols
      drainés.
    </p>
  );
}
