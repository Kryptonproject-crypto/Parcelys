import 'server-only';
import { prisma } from '@/lib/prisma';
import type { Prisma, ZoneKind } from '@prisma/client';

/**
 * Le contexte réglementaire d'une parcelle, déduit de sa géométrie.
 *
 * ## Pourquoi une intersection, et pas une commune
 *
 * La tentation est grande de raisonner par commune : « la parcelle est à
 * Artenay, Artenay est en zone vulnérable, donc la parcelle est en zone
 * vulnérable ». C'est faux, et d'une façon qui coûte cher dans les deux sens.
 *
 * Une commune peut n'être classée qu'en partie. Une parcelle de 8 ha peut être
 * à cheval : 4,8 ha dedans, 3,6 ha dehors. Le raisonnement par commune impose
 * alors des contraintes sur des hectares qui n'en relèvent pas, ou — pire —
 * n'en impose aucune sur ceux qui en relèvent.
 *
 * On croise donc les géométries pour de vrai, et on rend la surface concernée.
 *
 * ## Pourquoi les surfaces sont en `geography`
 *
 * `ST_Area(geom)` sur du 4326 rend des degrés carrés, ce qui ne veut rien dire.
 * `ST_Area(geom::geography)` rend des mètres carrés sur l'ellipsoïde. C'est la
 * même règle que pour la superficie des parcelles, et c'est PostGIS qui fait
 * autorité, pas un calcul approché côté application.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne complète rien. Si aucun zonage n'est importé, il renvoie « non
 * déterminé » avec la raison, et l'appelant en fait un constat indéterminé.
 * Un zonage inventé serait pire qu'un zonage absent : absent, on sait qu'on ne
 * sait pas.
 */

/** Un zonage recoupant la parcelle, avec ce que le recoupement recouvre. */
export type ZoneIntersection = {
  kind: ZoneKind;
  code: string | null;
  label: string;
  /** Surface de la parcelle réellement située dans la zone, en hectares. */
  areaHa: number;
  /** Part de la parcelle concernée, de 0 à 1. */
  ratio: number;
  /** `totale` au-delà de 99,5 % de la parcelle, `partielle` sinon. */
  coverage: 'totale' | 'partielle';
  referential: {
    code: string;
    version: string;
    sourceLabel: string;
    territory: string | null;
  };
};

/** Ce qui n'a pas pu être déterminé, et pourquoi. */
export type Unresolved = {
  what: string;
  reason: string;
  /** Ce qu'il faut faire pour lever l'indétermination. */
  remedy: string;
};

export type ParcelContext = {
  parcelId: string;
  zones: ZoneIntersection[];
  unresolved: Unresolved[];
  referentialVersions: Array<{ code: string; version: string; sourceLabel: string }>;
};

/**
 * Au-delà de ce taux de recouvrement, on considère la parcelle entièrement
 * dans la zone.
 *
 * Ce n'est pas une tolérance réglementaire, c'est une tolérance géométrique :
 * un contour de parcelle tracé à la main et un contour de zonage numérisé ne
 * coïncident jamais au mètre près. Sans ce seuil, une parcelle manifestement
 * incluse ressortirait « partielle à 99,8 % », ce qui n'aide personne.
 */
const SEUIL_COUVERTURE_TOTALE = 0.995;

type LigneIntersection = {
  kind: ZoneKind;
  code: string | null;
  label: string;
  area_m2: number;
  parcel_area_m2: number;
  ref_code: string;
  ref_version: string;
  ref_source: string;
  ref_territory: string | null;
};

/**
 * Croise la géométrie courante d'une parcelle avec les zonages importés.
 *
 * `ST_Intersects` d'abord (l'index GiST travaille là-dessus), `ST_Intersection`
 * ensuite pour ne calculer la surface que sur les candidats retenus : croiser
 * d'emblée coûterait un calcul de découpe sur chaque polygone du zonage.
 */
export async function computeZoneIntersections(
  parcelId: string,
): Promise<ZoneIntersection[]> {
  const lignes = await prisma.$queryRaw<LigneIntersection[]>`
    WITH parcelle AS (
      SELECT pg.geom AS geom,
             ST_Area(pg.geom::geography) AS aire_m2
      FROM parcel_geometries pg
      WHERE pg.parcel_id = ${parcelId} AND pg.is_current = true
      LIMIT 1
    )
    SELECT
      z.kind::text                                            AS kind,
      z.code                                                  AS code,
      z.label                                                 AS label,
      ST_Area(ST_Intersection(z.geom, p.geom)::geography)     AS area_m2,
      p.aire_m2                                               AS parcel_area_m2,
      r.code                                                  AS ref_code,
      r.version                                               AS ref_version,
      r.source_label                                          AS ref_source,
      r.territory                                             AS ref_territory
    FROM regulatory_zones z
    JOIN regulatory_referentials r ON r.id = z.referential_id
    CROSS JOIN parcelle p
    WHERE r.status = 'ACTIF'
      AND z.geom IS NOT NULL
      AND ST_Intersects(z.geom, p.geom)
    ORDER BY area_m2 DESC
  `;

  return lignes
    .map((ligne) => {
      const areaHa = Number(ligne.area_m2) / 10_000;
      const parcelleHa = Number(ligne.parcel_area_m2) / 10_000;
      const ratio = parcelleHa > 0 ? areaHa / parcelleHa : 0;
      return {
        kind: ligne.kind as ZoneKind,
        code: ligne.code,
        label: ligne.label,
        areaHa: Number(areaHa.toFixed(4)),
        ratio: Number(ratio.toFixed(4)),
        coverage:
          ratio >= SEUIL_COUVERTURE_TOTALE
            ? ('totale' as const)
            : ('partielle' as const),
        referential: {
          code: ligne.ref_code,
          version: ligne.ref_version,
          sourceLabel: ligne.ref_source,
          territory: ligne.ref_territory,
        },
      };
    })
    // Une intersection réduite à une ligne de contact n'est pas un
    // recoupement : deux polygones voisins se touchent sans se recouvrir.
    .filter((zone) => zone.areaHa > 0.0001);
}

/**
 * Zonages que Parcelys sait déterminer, et le référentiel dont chacun dépend.
 *
 * Sert à dire précisément ce qui manque : « zone vulnérable : indéterminée,
 * référentiel zones-vulnerables non importé » vaut mieux que l'absence de
 * mention, qui se lit comme « pas en zone vulnérable ».
 */
const ZONAGES_ATTENDUS: Array<{
  kind: ZoneKind;
  label: string;
  referentialCode: string;
}> = [
  { kind: 'ZONE_VULNERABLE', label: 'Zone vulnérable aux nitrates', referentialCode: 'zones-vulnerables' },
  { kind: 'ZONE_ACTION_RENFORCEE', label: 'Zone d’actions renforcées', referentialCode: 'zones-action-renforcee' },
  { kind: 'CAPTAGE', label: 'Captage', referentialCode: 'captages' },
  { kind: 'COURS_EAU', label: 'Cours d’eau', referentialCode: 'cours-eau' },
];

/**
 * Calcule et enregistre le contexte réglementaire d'une parcelle.
 *
 * Appelé à la création et à la modification de géométrie, et rejouable en lot
 * après l'import d'un zonage — un nouveau référentiel change le contexte de
 * toutes les parcelles, et laisser les anciens contextes en place les rendrait
 * faux sans le dire.
 */
export async function computeParcelContext(parcelId: string): Promise<ParcelContext> {
  const parcelle = await prisma.parcel.findUnique({
    where: { id: parcelId },
    select: { id: true, commune: true, inseeCode: true },
  });

  if (!parcelle) {
    throw new Error(`Parcelle ${parcelId} introuvable.`);
  }

  const geometrie = await prisma.parcelGeometry.findFirst({
    where: { parcelId, isCurrent: true },
    select: { id: true },
  });

  const unresolved: Unresolved[] = [];

  if (!geometrie) {
    unresolved.push({
      what: 'Contexte réglementaire',
      reason: 'La parcelle n’a pas de contour tracé.',
      remedy: 'Tracez ou importez le contour de la parcelle.',
    });
    return enregistrer(parcelle, [], unresolved);
  }

  const zones = await computeZoneIntersections(parcelId);

  // Quels zonages n'ont pas pu être déterminés, et pourquoi.
  const referentielsActifs = await prisma.regulatoryReferential.findMany({
    where: { status: 'ACTIF', domain: 'ZONAGE' },
    select: { code: true },
  });
  const disponibles = new Set(referentielsActifs.map((r) => r.code));

  for (const attendu of ZONAGES_ATTENDUS) {
    if (disponibles.has(attendu.referentialCode)) continue;
    unresolved.push({
      what: attendu.label,
      reason: `Le référentiel « ${attendu.referentialCode} » n’a pas été importé.`,
      remedy: `Importez-le depuis l’administration : Référentiels → ${attendu.referentialCode}.`,
    });
  }

  return enregistrer(parcelle, zones, unresolved);
}

async function enregistrer(
  parcelle: { id: string; commune: string | null; inseeCode: string | null },
  zones: ZoneIntersection[],
  unresolved: Unresolved[],
): Promise<ParcelContext> {
  const versions = [
    ...new Map(
      zones.map((z) => [
        `${z.referential.code}@${z.referential.version}`,
        {
          code: z.referential.code,
          version: z.referential.version,
          sourceLabel: z.referential.sourceLabel,
        },
      ]),
    ).values(),
  ];

  const donnees = {
    // La commune vient du géocodage inverse fait au tracé : on la reprend, on
    // ne la redemande pas. Département et région restent nuls tant qu'aucun
    // référentiel de découpage administratif n'est importé — les déduire des
    // deux premiers chiffres du code INSEE marche presque partout, et
    // « presque » n'est pas une base pour une contrainte réglementaire.
    commune: parcelle.commune,
    inseeCode: parcelle.inseeCode,
    zones: zones as unknown as Prisma.InputJsonValue,
    referentialVersions: versions as unknown as Prisma.InputJsonValue,
    unresolved: unresolved as unknown as Prisma.InputJsonValue,
    computedAt: new Date(),
  };

  await prisma.parcelRegulatoryContext.upsert({
    where: { parcelId: parcelle.id },
    create: { parcelId: parcelle.id, ...donnees },
    update: donnees,
  });

  return {
    parcelId: parcelle.id,
    zones,
    unresolved,
    referentialVersions: versions,
  };
}

/** Contexte enregistré d'une parcelle, tel qu'il sera affiché. */
export async function getParcelContext(
  parcelId: string,
): Promise<ParcelContext & { computedAt: string; commune: string | null } | null> {
  const ligne = await prisma.parcelRegulatoryContext.findUnique({
    where: { parcelId },
  });
  if (!ligne) return null;

  return {
    parcelId,
    commune: ligne.commune,
    computedAt: ligne.computedAt.toISOString(),
    zones: (ligne.zones as unknown as ZoneIntersection[]) ?? [],
    unresolved: (ligne.unresolved as unknown as Unresolved[]) ?? [],
    referentialVersions:
      (ligne.referentialVersions as unknown as ParcelContext['referentialVersions']) ?? [],
  };
}

/**
 * Contexte de la parcelle, calculé s'il n'existe pas encore.
 *
 * La synthèse de conformité passe par ici. Se contenter de lire le contexte
 * enregistré donnerait, sur une exploitation où personne n'a encore ouvert
 * chaque fiche de parcelle, un rapport disant « contexte non calculé » partout
 * — ce qui n'apprend rien et oblige à visiter les parcelles une à une pour
 * obtenir un rapport utilisable.
 *
 * Le calcul n'est fait qu'une fois : ensuite le contexte enregistré sert, et
 * seul un import de zonage le périme (cf. `recomputeFarmContexts`).
 */
export async function getOrComputeParcelContext(
  parcelId: string,
): Promise<(ParcelContext & { computedAt: string; commune: string | null }) | null> {
  const existant = await getParcelContext(parcelId);
  if (existant) return existant;

  try {
    await computeParcelContext(parcelId);
  } catch {
    // Une parcelle sans géométrie exploitable ne doit pas faire échouer le
    // rapport entier : elle ressortira comme non déterminée.
    return null;
  }
  return getParcelContext(parcelId);
}

/**
 * Recalcule le contexte de toutes les parcelles d'une exploitation.
 *
 * À lancer après l'import d'un zonage. Séquentiel et non parallèle : chaque
 * calcul est une découpe PostGIS, et vingt en parallèle sur un Raspberry Pi
 * mettent la base à genoux au moment où l'agriculteur s'en sert.
 */
export async function recomputeFarmContexts(farmId: string): Promise<number> {
  const parcelles = await prisma.parcel.findMany({
    where: { farmId, deletedAt: null },
    select: { id: true },
  });

  let faites = 0;
  for (const parcelle of parcelles) {
    await computeParcelContext(parcelle.id);
    faites += 1;
  }
  return faites;
}

/** La parcelle est-elle concernée par un zonage donné ? */
export function zoneOf(
  context: ParcelContext | null,
  kind: ZoneKind,
): ZoneIntersection | null {
  return context?.zones.find((zone) => zone.kind === kind) ?? null;
}
