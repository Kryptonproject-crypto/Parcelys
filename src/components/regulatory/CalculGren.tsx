import { Badge } from '@/components/ui';
import { RegleTrace } from '@/components/regulatory/RegleTrace';
import type { CalculGren } from '@/lib/regulatory/gren-calcul';
import type { Trace } from '@/lib/regulatory/regles';

/**
 * Le calcul de la dose prévisionnelle, tel qu'il a été fait.
 *
 * Tout y est pour le relire en contrôle : la formule de la fiche, chaque terme
 * avec sa valeur et d'où elle vient, ce qui manque quand la dose n'est pas
 * calculée, la règle des petites doses quand elle s'applique — et, repliées,
 * les règles employées avec leur texte.
 *
 * Sans hook : s'affiche aussi bien dans la page serveur que dans le
 * formulaire.
 */
export function CalculGrenView({
  calcul,
  traces,
  referentiel,
  lueLe,
}: {
  calcul: CalculGren;
  traces: Record<string, Trace>;
  referentiel: { code: string; version: string; source: string } | null;
  lueLe: string;
}) {
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const regles = calcul.regles.map((c) => traces[c]).filter((t): t is Trace => Boolean(t));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {calcul.doseKgHa !== null ? (
          <p className="text-2xl font-semibold tabular-nums text-ink">
            {fmt(calcul.doseKgHa)} <span className="text-sm font-normal text-ink-3">kg N/ha</span>
          </p>
        ) : (
          <Badge tone="amber">Dose non calculable</Badge>
        )}
        <p className="text-[13px] text-ink-3">
          {calcul.methode === 'plafond'
            ? 'Dose maximale d’engrais minéral (méthode du plafond)'
            : calcul.methode === 'bilan'
              ? 'Dose prévisionnelle d’engrais minéral (méthode du bilan)'
              : ''}
          {calcul.culture ? ` — ${calcul.culture.libelle}${calcul.culture.fiche ? `, fiche ${calcul.culture.fiche}` : ''}` : ''}
          {calcul.sousRegion ? ` — ex-région ${calcul.sousRegion === 'auvergne' ? 'Auvergne' : 'Rhône-Alpes'}` : ''}
        </p>
      </div>

      {calcul.regleDose ? <p className="text-[13px] text-ink-2">{calcul.regleDose}</p> : null}
      {calcul.doseCalculeeKgHa !== null && calcul.doseCalculeeKgHa !== calcul.doseKgHa ? (
        <p className="text-[12.5px] text-ink-3">Résultat de la formule : {fmt(calcul.doseCalculeeKgHa)} kg N/ha.</p>
      ) : null}

      {calcul.bloquants.length > 0 ? (
        <div className="rounded-md border border-ble-500/35 bg-ble-50 p-3 dark:bg-ble-700/15">
          <p className="text-[13px] font-medium text-ink">Ce qui empêche le calcul</p>
          <ul className="mt-1 space-y-1">
            {calcul.bloquants.map((b, i) => (
              <li key={`${b.terme}-${i}`} className="text-[13px] leading-relaxed text-ink-2">
                <span className="font-medium">{b.terme}</span> — {b.raison}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {calcul.expression ? (
        <p className="rounded bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px] text-ink-2">{calcul.expression}</p>
      ) : null}

      {calcul.termes.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {calcul.termes.map((t, i) => (
            <li key={`${t.terme}-${i}`} className="px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13.5px] text-ink">{t.libelle}</span>
                <span className="tabular-nums text-[13.5px] font-medium text-ink">
                  {t.valeur === null ? '—' : `${fmt(t.valeur)} ${t.unite ?? (t.terme === 'CAU' ? '' : 'kg N/ha')}`}
                </span>
              </div>
              <p className="text-[12.5px] leading-snug text-ink-3">{t.valeur === null ? t.manque : t.origine}</p>
              {t.detail && t.detail.length > 0 ? (
                <ul className="mt-0.5 list-disc pl-5 text-[12px] text-ink-3">
                  {t.detail.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {calcul.avertissements.length > 0 ? (
        <ul className="space-y-0.5 text-[12.5px] text-ink-3">
          {calcul.avertissements.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-[12px] text-ink-3">
        {referentiel
          ? `Référentiel ${referentiel.code}, version ${referentiel.version} — règles lues au ${new Date(`${lueLe}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}. Source : ${referentiel.source}.`
          : 'Aucun référentiel GREN en vigueur pour cette parcelle à cette date.'}
      </p>

      {regles.length > 0 ? (
        <details>
          <summary className="cursor-pointer select-none text-[13px] text-ink-2">
            Règles employées ({regles.length})
          </summary>
          <div className="mt-1 space-y-1">
            {regles.map((t) => (
              <RegleTrace key={t.regle.code} trace={t} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
