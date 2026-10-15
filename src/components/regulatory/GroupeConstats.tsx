import { Badge } from '@/components/ui';
import { RegleTrace } from '@/components/regulatory/RegleTrace';
import type { GroupeDeConstats } from '@/lib/regulatory/regrouper-constats';

export const TONS_CONSTAT: Record<
  string,
  { badge: 'green' | 'neutral' | 'amber' | 'red'; libelle: string }
> = {
  OK: { badge: 'green', libelle: 'Vérifié' },
  INDETERMINE: { badge: 'neutral', libelle: 'Non vérifiable' },
  VERIFICATION: { badge: 'amber', libelle: 'À vérifier' },
  ANOMALIE: { badge: 'red', libelle: 'Anomalie' },
};

/**
 * Un constat, ou plusieurs constats identiques réunis.
 *
 * Seul, il s'affiche entier. À plusieurs, le titre, l'action et la règle
 * s'affichent une fois, avec le nombre de parcelles ; le détail de chacune
 * reste à un clic, dans l'ordre où le moteur l'a produit.
 */
export function GroupeConstats({
  groupe,
  detailDeplie = true,
}: {
  groupe: GroupeDeConstats;
  /** `false` sur le tableau de bord : le résumé suffit, la page Conformité détaille. */
  detailDeplie?: boolean;
}) {
  const ton = TONS_CONSTAT[groupe.level];
  const seul = groupe.constats.length === 1 ? groupe.constats[0]! : null;
  const parcelles = new Set(groupe.constats.map((c) => c.parcelId).filter(Boolean)).size;

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ton?.badge ?? 'neutral'}>{ton?.libelle}</Badge>
        <span className="text-[14.5px] font-medium text-ink">{groupe.title}</span>
        {seul ? null : (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-medium tabular-nums text-ink-2">
            {parcelles > 0
              ? `${parcelles} parcelle${parcelles > 1 ? 's' : ''}`
              : `${groupe.constats.length} cas`}
          </span>
        )}
      </div>

      {seul ? <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{seul.detail}</p> : null}

      {groupe.action ? <p className="mt-1.5 text-[13px] text-ink-3">→ {groupe.action}</p> : null}

      {!seul && detailDeplie ? (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-champ-700 hover:underline dark:text-champ-400">
            Voir le détail, parcelle par parcelle
          </summary>
          <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {groupe.constats.map((c, index) => (
              <li key={`${c.parcelId ?? 'x'}-${index}`} className="text-[13px] leading-relaxed text-ink-2">
                {c.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {groupe.trace ? (
        <RegleTrace trace={groupe.trace} />
      ) : groupe.sourceLabel ? (
        <p className="mt-1.5 border-t border-line pt-1.5 text-[11.5px] text-ink-3">
          Règle issue de {groupe.sourceLabel}
          {groupe.referentialVersion ? `, version ${groupe.referentialVersion}` : ''}
        </p>
      ) : null}
    </li>
  );
}
