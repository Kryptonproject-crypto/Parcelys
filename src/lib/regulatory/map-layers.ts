import 'server-only';
import type { ZoneKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Couches réglementaires pour la carte **existante**.
 *
 * ## Sur la carte des parcelles, pas à côté
 *
 * Une seconde carte « réglementaire » aurait obligé à comparer deux écrans pour
 * répondre à une question simple — « cette parcelle-là est-elle dedans ? » — et
 * les deux cartes auraient fini par diverger en cadrage, en fond et en style.
 * Les couches s'ajoutent donc à la carte que l'exploitant connaît déjà.
 *
 * ## Pourquoi on ne charge pas le zonage entier
 *
 * Un zonage régional compte des milliers de polygones, souvent plusieurs
 * dizaines de mégaoctets. Les envoyer au navigateur rendrait la carte
 * inutilisable sur un téléphone au bord d'un champ — c'est-à-dire là où elle
 * sert.
 *
 * On ne renvoie donc que les zones **qui recoupent l'emprise des parcelles**,
 * élargie d'une marge. C'est exactement ce qui répond à la question posée, et
 * cela tient en quelques dizaines de kilo-octets.
 *
 * ## Ce que chaque couche porte avec elle
 *
 * Sa source et sa version. Une couche affichée sans provenance laisserait croire
 * à une vérité intemporelle, alors qu'un zonage est daté et révisé — et que
 * c'est la version en vigueur à la date de l'intervention qui compte.
 */

export type CoucheReglementaire = {
  /** Code du référentiel : `zones-vulnerables`, `captages`… */
  code: string;
  kind: ZoneKind;
  label: string;
  /** Couleur de tracé, stable d'une session à l'autre. */
  color: string;
  /** Provenance, affichée avec la couche — jamais séparée d'elle. */
  source: { label: string; version: string; territory: string | null };
  /** GeoJSON prêt à poser sur la carte. */
  features: Array<{
    type: 'Feature';
    properties: { label: string; code: string | null };
    geometry: unknown;
  }>;
  /** Zones effectivement renvoyées, et total connu du référentiel. */
  rendues: number;
  total: number;
};

/**
 * Couleurs par nature de zonage.
 *
 * Fixées ici plutôt que tirées au hasard : une zone vulnérable qui changerait de
 * couleur d'une visite à l'autre obligerait à relire la légende à chaque fois.
 */
const COULEURS: Record<string, string> = {
  ZONE_VULNERABLE: '#2563eb',
  ZONE_ACTION_RENFORCEE: '#7c3aed',
  CAPTAGE: '#dc2626',
  AIRE_ALIMENTATION_CAPTAGE: '#ea580c',
  COURS_EAU: '#0891b2',
  ZONE_ENVIRONNEMENTALE: '#16a34a',
  AUTRE: '#64748b',
};

type LigneZone = {
  ref_code: string;
  ref_source: string;
  ref_version: string;
  ref_territory: string | null;
  kind: string;
  label: string;
  code: string | null;
  geojson: string;
};

/**
 * Les couches à poser sur la carte d'une exploitation.
 *
 * `margeDegres` élargit l'emprise : une zone dont la limite passe juste à côté
 * d'une parcelle explique pourquoi celle-ci est classée « partiellement », et la
 * couper au ras du bord la rendrait incompréhensible.
 */
export async function couchesPourExploitation(params: {
  farmId: string;
  margeDegres?: number;
  /** Plafond par couche. Au-delà, la carte devient illisible autant que lourde. */
  maxParCouche?: number;
}): Promise<CoucheReglementaire[]> {
  const marge = params.margeDegres ?? 0.02;
  const plafond = params.maxParCouche ?? 400;

  const lignes = await prisma.$queryRaw<LigneZone[]>`
    WITH emprise AS (
      -- ST_Extent rend une box2d, dont le cast en geometry porte le SRID 0.
      -- La croiser telle quelle avec des zones en 4326 échoue net :
      -- « Operation on mixed SRID geometries ». Le SRID est donc reposé
      -- explicitement — sans quoi aucune couche ne s'afficherait jamais.
      SELECT ST_SetSRID(
               ST_Expand(ST_Extent(pg.geom)::geometry, ${marge}::float8),
               4326::int
             ) AS boite
      FROM parcel_geometries pg
      JOIN parcels p ON p.id = pg.parcel_id
      WHERE p.farm_id = ${params.farmId}
        AND p.deleted_at IS NULL
        AND pg.is_current = true
    )
    SELECT
      r.code          AS ref_code,
      r.source_label  AS ref_source,
      r.version       AS ref_version,
      r.territory     AS ref_territory,
      z.kind::text    AS kind,
      z.label         AS label,
      z.code          AS code,
      -- Simplification légère : à l'échelle d'une parcelle, quelques mètres de
      -- généralisation ne se voient pas, et divisent le poids par cinq ou dix.
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(z.geom, 0.00005)) AS geojson
    FROM regulatory_zones z
    JOIN regulatory_referentials r ON r.id = z.referential_id
    CROSS JOIN emprise e
    WHERE r.status = 'ACTIF'
      AND z.geom IS NOT NULL
      AND e.boite IS NOT NULL
      AND z.geom && e.boite
      AND ST_Intersects(z.geom, e.boite)
    LIMIT ${plafond * 8}
  `;

  // Totaux par référentiel, pour dire si la carte montre tout ou une partie.
  const totaux = new Map<string, number>();
  for (const groupe of await prisma.regulatoryZone.groupBy({
    by: ['referentialId'],
    _count: { _all: true },
    where: { referential: { status: 'ACTIF' } },
  })) {
    const referentiel = await prisma.regulatoryReferential.findUnique({
      where: { id: groupe.referentialId },
      select: { code: true },
    });
    if (referentiel) {
      totaux.set(referentiel.code, (totaux.get(referentiel.code) ?? 0) + groupe._count._all);
    }
  }

  const parCode = new Map<string, CoucheReglementaire>();

  for (const ligne of lignes) {
    let couche = parCode.get(ligne.ref_code);
    if (!couche) {
      couche = {
        code: ligne.ref_code,
        kind: ligne.kind as ZoneKind,
        label: libelleDe(ligne.kind, ligne.ref_code),
        color: COULEURS[ligne.kind] ?? COULEURS.AUTRE ?? '#64748b',
        source: {
          label: ligne.ref_source,
          version: ligne.ref_version,
          territory: ligne.ref_territory,
        },
        features: [],
        rendues: 0,
        total: totaux.get(ligne.ref_code) ?? 0,
      };
      parCode.set(ligne.ref_code, couche);
    }

    if (couche.features.length >= plafond) continue;

    couche.features.push({
      type: 'Feature',
      properties: { label: ligne.label, code: ligne.code },
      geometry: JSON.parse(ligne.geojson) as unknown,
    });
    couche.rendues += 1;
  }

  return [...parCode.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function libelleDe(kind: string, code: string): string {
  switch (kind) {
    case 'ZONE_VULNERABLE':
      return 'Zones vulnérables aux nitrates';
    case 'ZONE_ACTION_RENFORCEE':
      return 'Zones d’actions renforcées';
    case 'CAPTAGE':
      return 'Captages';
    case 'AIRE_ALIMENTATION_CAPTAGE':
      return 'Aires d’alimentation de captage';
    case 'COURS_EAU':
      return 'Cours d’eau';
    case 'ZONE_ENVIRONNEMENTALE':
      return 'Zones environnementales';
    default:
      return code;
  }
}
