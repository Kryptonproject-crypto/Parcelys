import { Badge } from '@/components/ui';
import type { ParcelContext } from '@/lib/regulatory/geography';

const LIBELLES: Record<string, string> = {
  ZONE_VULNERABLE: 'Zone vulnérable aux nitrates',
  ZONE_ACTION_RENFORCEE: 'Zone d’actions renforcées',
  CAPTAGE: 'Captage',
  AIRE_ALIMENTATION_CAPTAGE: 'Aire d’alimentation de captage',
  COURS_EAU: 'Cours d’eau',
  ZONE_ENVIRONNEMENTALE: 'Zone environnementale',
  AUTRE: 'Autre zonage',
};

/**
 * Contexte réglementaire d'une parcelle, tel qu'il s'affiche dans l'onglet
 * Général — un bloc ajouté à la fiche existante, pas un écran de plus.
 *
 * Trois choses y sont dites, dans cet ordre d'importance :
 *
 *  1. les zonages qui concernent la parcelle, **avec la surface concernée** —
 *     une parcelle à cheval n'est pas une parcelle classée ;
 *  2. ce qui n'a pas pu être déterminé, et pourquoi ;
 *  3. d'où viennent ces informations, dans quelle version.
 *
 * Le point 2 est le plus important. Sans lui, l'absence de zonage se lirait
 * comme « parcelle non concernée », alors qu'elle signifie le plus souvent
 * « référentiel non importé ».
 */
export function ParcelContextCard({
  context,
  areaHa,
}: {
  context:
    | (ParcelContext & { computedAt: string; commune: string | null })
    | null;
  areaHa: number;
}) {
  if (!context) {
    return (
      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <h3 className="text-[15px] font-semibold text-ink">Contexte réglementaire</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">
          Pas encore déterminé pour cette parcelle.
        </p>
      </div>
    );
  }

  const dateCalcul = new Date(context.computedAt).toLocaleDateString('fr-FR');

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">Contexte réglementaire</h3>
        <span className="text-xs text-ink-3">calculé le {dateCalcul}</span>
      </div>

      {context.zones.length > 0 ? (
        <ul className="mt-3 space-y-2.5">
          {context.zones.map((zone) => (
            <li
              key={`${zone.kind}-${zone.code ?? zone.label}`}
              className="rounded-md border border-ble-500/35 bg-ble-50 p-3 dark:bg-ble-700/15"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-ink">
                  {LIBELLES[zone.kind] ?? zone.label}
                </span>
                <Badge tone={zone.coverage === 'totale' ? 'amber' : 'neutral'}>
                  {zone.coverage === 'totale' ? 'Totalité' : 'Partiellement'}
                </Badge>
              </div>

              {/* La surface concernée, pas seulement le fait d'être concerné :
                  c'est elle qui décide de ce qui s'applique à quels hectares. */}
              <p className="mt-1 text-[13.5px] text-ink-2">
                {zone.coverage === 'totale' ? (
                  <>
                    La parcelle entière ({zone.areaHa.toLocaleString('fr-FR')} ha) est
                    concernée.
                  </>
                ) : (
                  <>
                    <strong>{zone.areaHa.toLocaleString('fr-FR')} ha</strong> concernés
                    sur {areaHa.toLocaleString('fr-FR')} ha —{' '}
                    {(zone.ratio * 100).toLocaleString('fr-FR', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    % de la parcelle. Le reste n’est pas concerné.
                  </>
                )}
              </p>

              <p className="mt-1 text-xs text-ink-3">
                {zone.label} · {zone.referential.sourceLabel} — version{' '}
                {zone.referential.version}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Ce qu'on ne sait pas, dit aussi clairement que ce qu'on sait. */}
      {context.unresolved.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3">
          <p className="text-[13px] font-medium text-ink-2">
            Points non vérifiables en l’état
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {context.unresolved.map((point) => (
              <li key={point.what} className="text-[13px] leading-relaxed text-ink-3">
                <span className="font-medium text-ink-2">{point.what}</span> —{' '}
                {point.reason} {point.remedy}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {context.zones.length === 0 && context.unresolved.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-ink-2">
          Aucun zonage réglementaire ne recoupe cette parcelle, d’après les
          référentiels importés.
        </p>
      ) : null}
    </div>
  );
}
