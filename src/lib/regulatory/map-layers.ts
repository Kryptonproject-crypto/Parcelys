import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type ZoneKind } from '@prisma/client';
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
  PERIMETRE_PROTECTION_CAPTAGE: '#b91c1c',
  ZONE_PROTECTION_AAC: '#c2410c',
  COURS_EAU: '#0891b2',
  TRONCON_HYDROGRAPHIQUE: '#0e7490',
  SURFACE_HYDROGRAPHIQUE: '#0284c7',
  PLAN_EAU: '#0369a1',
  POINT_PRELEVEMENT: '#be123c',
  OUVRAGE_PRELEVEMENT: '#9f1239',
  BASSIN_HYDROGRAPHIQUE: '#475569',
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
  /** Entités de cette nature dans l'emprise de l'exploitation. */
  dans_emprise: number;
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
  return (await couchesAvecEmpreinte(params)).couches;
}

/**
 * Les couches, et l'empreinte de ce dont elles dépendent.
 *
 * ## Pourquoi une mémoire
 *
 * Le calcul parcourt des dizaines de milliers de tronçons et simplifie des
 * centaines de géométries : plus d'une demi-seconde, plusieurs sur un
 * Raspberry Pi — à chaque ouverture d'une fiche de parcelle, pour un résultat
 * qui ne change que si les parcelles ou les référentiels changent.
 *
 * Le résultat est donc gardé, sous une clé qui résume exactement ce dont il
 * dépend : l'emprise des parcelles (qui bouge dès qu'un contour change) et
 * l'état des référentiels (chaque import, remplacement ou suppression modifie
 * leur nombre ou leur date de mise à jour). Une clé inchangée garantit un
 * résultat inchangé ; la moindre modification en donne une autre, et le
 * calcul est refait.
 */
export async function couchesAvecEmpreinte(params: {
  farmId: string;
  margeDegres?: number;
  maxParCouche?: number;
}): Promise<{ couches: CoucheReglementaire[]; empreinte: string }> {
  const marge = params.margeDegres ?? 0.02;
  const plafond = params.maxParCouche ?? 400;
  // Le réseau hydrographique compte des milliers d'éléments autour d'une
  // exploitation, et c'est lui qu'on regarde avant de traiter ou d'épandre
  // (zones non traitées, distances d'épandage) : un plafond plus haut, pour
  // que tout ce qui borde les parcelles y soit.
  const plafondHydro = Math.max(plafond, PLAFOND_HYDROGRAPHIE);

  const [etat] = await prisma.$queryRaw<
    Array<{ boite: string | null; n: number; maj: Date | null }>
  >`
    SELECT
      (SELECT ST_AsText(ST_Extent(pg.geom)::geometry)
         FROM parcel_geometries pg
         JOIN parcels p ON p.id = pg.parcel_id
        WHERE p.farm_id = ${params.farmId}
          AND p.deleted_at IS NULL
          AND pg.is_current = true)                         AS boite,
      (SELECT COUNT(*)::int FROM regulatory_referentials)   AS n,
      (SELECT MAX(updated_at) FROM regulatory_referentials) AS maj
  `;
  const empreinte = createHash('sha256')
    .update(
      [
        params.farmId,
        etat?.boite ?? '-',
        etat?.n ?? 0,
        etat?.maj ? etat.maj.toISOString() : '-',
        marge,
        plafond,
        plafondHydro,
        VERSION_DES_COUCHES,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);

  const gardees = MEMOIRE.get(empreinte);
  if (gardees) {
    // Remise en tête : la mémoire oublie d'abord ce qui n'a pas servi.
    MEMOIRE.delete(empreinte);
    MEMOIRE.set(empreinte, gardees);
    return { couches: gardees, empreinte };
  }

  const couches = await calculerCouches(params.farmId, marge, plafond, plafondHydro);
  MEMOIRE.set(empreinte, couches);
  while (MEMOIRE.size > TAILLE_MEMOIRE) {
    const plusAncienne = MEMOIRE.keys().next().value;
    if (plusAncienne === undefined) break;
    MEMOIRE.delete(plusAncienne);
  }
  return { couches, empreinte };
}

/**
 * Quelques exploitations au plus : sur un Raspberry Pi, une ferme, parfois
 * celles d'un conseiller. Chacune pèse de quelques centaines de kilo-octets à
 * deux mégaoctets.
 */
const TAILLE_MEMOIRE = 6;
const MEMOIRE = new Map<string, CoucheReglementaire[]>();

/** À incrémenter quand le calcul des couches change de résultat. */
const VERSION_DES_COUCHES = 3; // 2 : les plus proches d'abord ; 3 : eau coupée à l'emprise.

const PLAFOND_HYDROGRAPHIE = 1000;
const NATURES_HYDROGRAPHIQUES_CARTE = [
  'COURS_EAU',
  'TRONCON_HYDROGRAPHIQUE',
  'SURFACE_HYDROGRAPHIQUE',
  'PLAN_EAU',
];

/**
 * Au-delà de cette distance (en degrés, environ 400 m sous nos latitudes), un
 * élément n'est plus « au bord d'une parcelle » : il passe après ceux qui le
 * sont, dans l'ordre de leur identifiant.
 */
const VOISINAGE_DEGRES = 0.005;

async function calculerCouches(
  farmId: string,
  marge: number,
  plafond: number,
  plafondHydro: number,
): Promise<CoucheReglementaire[]> {
  const params = { farmId };

  /*
   * Plafond **par référentiel et par nature**, et géométrie simplifiée
   * seulement pour ce qui sera rendu.
   *
   * Le plafond s'appliquait à l'ensemble des couches : avec les 402 215
   * tronçons de BD TOPAGE, les premières lignes renvoyées étaient toutes des
   * tronçons, et les zones vulnérables disparaissaient de la carte sans que
   * rien ne le signale. Et la simplification était calculée sur tous les
   * candidats avant d'en jeter la plupart.
   *
   * Les bassins hydrographiques ne sont pas servis : un bassin couvre un quart
   * de la France, son contour pèse des mégaoctets, et il n'apprend rien sur une
   * carte d'exploitation — le bassin de chaque parcelle figure dans sa fiche.
   */
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
    ),
    -- Ce qui borde les parcelles, et à quelle distance de la plus proche.
    --
    -- Le plafond par couche gardait les premiers éléments **par identifiant**,
    -- c'est-à-dire au hasard : sur 15 000 tronçons dans l'emprise, le ruisseau
    -- qui longe la parcelle pouvait ne pas être dessiné. Les plus proches
    -- passent désormais d'abord, et le plafond n'écarte que les plus lointains.
    proches AS (
      SELECT z.id, MIN(ST_Distance(z.geom, pg.geom)) AS distance
      FROM parcel_geometries pg
      JOIN parcels p ON p.id = pg.parcel_id
      JOIN regulatory_zones z ON ST_DWithin(z.geom, pg.geom, ${VOISINAGE_DEGRES}::float8)
      JOIN regulatory_referentials r ON r.id = z.referential_id AND r.status = 'ACTIF'
      WHERE p.farm_id = ${params.farmId}
        AND p.deleted_at IS NULL
        AND pg.is_current = true
        AND z.kind::text NOT IN ('BASSIN_HYDROGRAPHIQUE', 'REGION_ADMINISTRATIVE')
      GROUP BY z.id
    ),
    candidats AS (
      SELECT
        z.id,
        r.code       AS ref_code,
        z.kind::text AS kind,
        ROW_NUMBER() OVER (
          PARTITION BY r.code, z.kind
          ORDER BY pr.distance ASC NULLS LAST, z.id
        )            AS rang,
        COUNT(*)     OVER (PARTITION BY r.code, z.kind)               AS dans_emprise
      FROM regulatory_zones z
      JOIN regulatory_referentials r ON r.id = z.referential_id
      CROSS JOIN emprise e
      LEFT JOIN proches pr ON pr.id = z.id
      WHERE r.status = 'ACTIF'
        AND z.geom IS NOT NULL
        AND e.boite IS NOT NULL
        -- Bassins et région couvrent tout l'écran : ils se lisent dans le
        -- contexte de la parcelle, pas en couche.
        AND z.kind::text NOT IN ('BASSIN_HYDROGRAPHIQUE', 'REGION_ADMINISTRATIVE')
        AND z.geom && e.boite
        AND ST_Intersects(z.geom, e.boite)
    )
    SELECT
      c.ref_code,
      r.source_label  AS ref_source,
      r.version       AS ref_version,
      r.territory     AS ref_territory,
      c.kind,
      z.label,
      z.code,
      c.dans_emprise::int AS dans_emprise,
      -- Simplification légère : à l'échelle d'une parcelle, quelques mètres de
      -- généralisation ne se voient pas, et divisent le poids par cinq ou dix.
      -- Six décimales : 11 cm, bien en deçà de la simplification ; au-delà, le
      -- poids sans rien de visible.
      --
      -- Le réseau hydrographique est coupé à l'emprise : un « cours d'eau » de
      -- BD TOPAGE est la rivière entière — la Loire, 20 000 sommets — dont
      -- seuls quelques kilomètres passent sur la carte de l'exploitation.
      -- Les zonages, eux, restent entiers : une commune classée se lit en
      -- entier, coupée elle laisserait croire à une limite qui n'existe pas.
      ST_AsGeoJSON(
        ST_SimplifyPreserveTopology(
          CASE
            WHEN c.kind IN (${Prisma.join(NATURES_HYDROGRAPHIQUES_CARTE)})
              THEN ST_ClipByBox2D(z.geom, e.boite::box2d)
            ELSE z.geom
          END,
          0.00005
        ),
        6
      ) AS geojson
    FROM candidats c
    JOIN regulatory_zones z ON z.id = c.id
    JOIN regulatory_referentials r ON r.id = z.referential_id
    CROSS JOIN emprise e
    WHERE c.rang <= CASE
                      WHEN c.kind IN (${Prisma.join(NATURES_HYDROGRAPHIQUES_CARTE)}) THEN ${plafondHydro}::int
                      ELSE ${plafond}::int
                    END
    ORDER BY c.ref_code, c.kind, c.rang
  `;

  const parCouche = new Map<string, CoucheReglementaire>();

  for (const ligne of lignes) {
    // Une couche par référentiel **et** par nature : BD TOPAGE porte à la fois
    // des tronçons, des surfaces en eau et des plans d'eau, qu'on veut pouvoir
    // allumer séparément et qui n'ont pas la même couleur.
    const cle = `${ligne.ref_code}:${ligne.kind}`;
    let couche = parCouche.get(cle);
    if (!couche) {
      couche = {
        code: cle,
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
        total: Number(ligne.dans_emprise),
      };
      parCouche.set(cle, couche);
    }

    couche.features.push({
      type: 'Feature',
      properties: { label: ligne.label, code: ligne.code },
      geometry: JSON.parse(ligne.geojson) as unknown,
    });
    couche.rendues += 1;
  }

  return [...parCouche.values()].sort((a, b) => a.label.localeCompare(b.label));
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
      return 'Cours d’eau (BD TOPAGE)';
    case 'TRONCON_HYDROGRAPHIQUE':
      return 'Réseau hydrographique (BD TOPAGE)';
    case 'SURFACE_HYDROGRAPHIQUE':
      return 'Surfaces en eau (BD TOPAGE)';
    case 'PLAN_EAU':
      return 'Plans d’eau (BD TOPAGE)';
    case 'POINT_PRELEVEMENT':
      return 'Points de prélèvement d’eau';
    case 'OUVRAGE_PRELEVEMENT':
      return 'Ouvrages de prélèvement d’eau';
    case 'PERIMETRE_PROTECTION_CAPTAGE':
      return 'Périmètres de protection de captage';
    case 'ZONE_PROTECTION_AAC':
      return 'Zones de protection d’aire d’alimentation';
    case 'ZONE_ENVIRONNEMENTALE':
      return 'Zones environnementales';
    default:
      return code;
  }
}
