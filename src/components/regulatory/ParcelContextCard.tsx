import { Badge } from '@/components/ui';
import type { ParcelContext } from '@/lib/regulatory/geography';
import { porteeDuClassement } from '@/lib/regulatory/portee';

const LIBELLES: Record<string, string> = {
  ZONE_VULNERABLE: 'Zone vulnérable aux nitrates',
  ZONE_ACTION_RENFORCEE: 'Zone d’actions renforcées',
  CAPTAGE: 'Captage',
  AIRE_ALIMENTATION_CAPTAGE: 'Aire d’alimentation de captage',
  PERIMETRE_PROTECTION_CAPTAGE: 'Périmètre de protection de captage',
  ZONE_PROTECTION_AAC: 'Zone de protection d’aire d’alimentation',
  COURS_EAU: 'Cours d’eau',
  ZONE_ENVIRONNEMENTALE: 'Zone environnementale',
  BASSIN_HYDROGRAPHIQUE: 'Bassin hydrographique',
  REGION_ADMINISTRATIVE: 'Région',
  AUTRE: 'Autre zonage',
};

const LIBELLES_PROXIMITE: Record<string, string> = {
  TRONCON_HYDROGRAPHIQUE: 'Écoulement',
  SURFACE_HYDROGRAPHIQUE: 'Surface en eau',
  PLAN_EAU: 'Plan d’eau',
  COURS_EAU: 'Cours d’eau',
  POINT_PRELEVEMENT: 'Point de prélèvement',
  OUVRAGE_PRELEVEMENT: 'Ouvrage de prélèvement',
  CAPTAGE: 'Captage',
};

/** Zonages qui ne réglementent rien par eux-mêmes : ils situent la parcelle. */
const SITUANTS = new Set(['REGION_ADMINISTRATIVE', 'BASSIN_HYDROGRAPHIQUE']);

/**
 * Contexte réglementaire d'une parcelle, tel qu'il s'affiche dans l'onglet
 * Général — un bloc ajouté à la fiche existante, pas un écran de plus.
 *
 * Quatre choses y sont dites, dans cet ordre d'importance :
 *
 *  1. les zonages qui concernent la parcelle, **avec la surface concernée et
 *     la portée du classement** — une commune classée « quelques sections »,
 *     ou retirée du zonage, ne classe pas la parcelle ;
 *  2. ce qui n'a pas pu être déterminé, et pourquoi ;
 *  3. ce qui est **proche** sans recouper : écoulements, points de
 *     prélèvement, avec leur distance — une distance, jamais une ZNT ;
 *  4. d'où viennent ces informations, dans quelle version.
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
  const reglementaires = context.zones.filter((z) => !SITUANTS.has(z.kind));
  const situants = context.zones.filter((z) => SITUANTS.has(z.kind));
  const proximites = context.proximites ?? [];

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">Contexte réglementaire</h3>
        <span className="text-xs text-ink-3">calculé le {dateCalcul}</span>
      </div>

      {situants.length > 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">
          {situants
            .map((z) => `${LIBELLES[z.kind] ?? z.kind} : ${z.label}${z.coverage === 'partielle' ? ' (en partie)' : ''}`)
            .join(' · ')}
        </p>
      ) : null}

      {reglementaires.length > 0 ? (
        <ul className="mt-3 space-y-2.5">
          {reglementaires.map((zone, index) => {
            const portee = porteeDuClassement(zone.attributes);
            const engage = portee === 'totale' || portee === 'non-precisee';
            return (
              <li
                key={`${zone.kind}-${zone.code ?? zone.label}-${index}`}
                className={
                  engage
                    ? 'rounded-md border border-ble-500/35 bg-ble-50 p-3 dark:bg-ble-700/15'
                    : 'rounded-md border border-line bg-surface p-3'
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-ink">
                    {LIBELLES[zone.kind] ?? zone.label}
                  </span>
                  {engage ? (
                    <Badge tone={zone.coverage === 'totale' ? 'amber' : 'neutral'}>
                      {zone.coverage === 'totale' ? 'Totalité' : 'Partiellement'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">
                      {portee === 'hors-zone'
                        ? 'Retirée du zonage'
                        : portee === 'non-en-vigueur'
                          ? 'Pas encore en vigueur'
                          : 'Appartenance indéterminée'}
                    </Badge>
                  )}
                </div>

                {/* La surface concernée, pas seulement le fait d'être concerné :
                    c'est elle qui décide de ce qui s'applique à quels hectares. */}
                {engage ? (
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
                ) : (
                  <p className="mt-1 text-[13.5px] text-ink-2">
                    La parcelle recoupe {zone.label}, mais le classement publié ne permet
                    pas de dire qu’elle est dans la zone (voir les points non vérifiables).
                  </p>
                )}
                {zone.kind === 'ZONE_ACTION_RENFORCEE' && zone.attributes?.reconstitue === true ? (
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    Périmètre reconstitué à partir de l’aire d’alimentation du captage ; la
                    cartographie de la DREAL fait foi.
                  </p>
                ) : null}

                <p className="mt-1 text-xs text-ink-3">
                  {zone.label} · {zone.referential.sourceLabel} — version{' '}
                  {zone.referential.version}
                  {typeof zone.attributes?.arrete === 'string' ? ` · ${zone.attributes.arrete}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Ce qu'on ne sait pas, dit aussi clairement que ce qu'on sait. */}
      {context.unresolved.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3">
          <p className="text-[13px] font-medium text-ink-2">
            Points non vérifiables en l’état
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {context.unresolved.map((point, index) => (
              <li key={`${point.what}-${index}`} className="text-[13px] leading-relaxed text-ink-3">
                <span className="font-medium text-ink-2">{point.what}</span> —{' '}
                {point.reason} {point.remedy}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {proximites.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3">
          <p className="text-[13px] font-medium text-ink-2">À proximité (500 m)</p>
          <ul className="mt-1.5 space-y-1">
            {proximites.slice(0, 6).map((p, index) => (
              <li key={`${p.kind}-${p.code ?? p.label}-${index}`} className="text-[13px] text-ink-3">
                <span className="text-ink-2">{LIBELLES_PROXIMITE[p.kind] ?? p.kind}</span> — {p.label}
                {typeof p.attributes?.NatureTH === 'string' ? ` (${p.attributes.NatureTH})` : ''} :{' '}
                {p.dedans ? 'touche la parcelle' : `${p.distanceM.toLocaleString('fr-FR')} m`}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
            Distances au contour de la parcelle. Elles situent ; elles ne créent ni zone
            non traitée ni bande enherbée : la règle applicable le fait.
          </p>
        </div>
      ) : null}

      {reglementaires.length === 0 && context.unresolved.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-ink-2">
          Aucun zonage réglementaire ne recoupe cette parcelle, d’après les
          référentiels importés.
        </p>
      ) : null}
    </div>
  );
}
