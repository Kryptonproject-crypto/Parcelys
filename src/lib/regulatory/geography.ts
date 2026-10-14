import 'server-only';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { ZoneKind } from '@prisma/client';
import { porteeDuClassement } from '@/lib/regulatory/portee';

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
  /**
   * Attributs publiés avec la zone, conservés tels quels.
   *
   * Ils portent ce que le recoupement géométrique ne dit pas : le bassin dont
   * relève l'arrêté, et surtout la **portée** du classement. Les zones
   * vulnérables d'Auvergne-Rhône-Alpes sont publiées *à la commune* : pour
   * 218 des 1 125 communes classées, l'arrêté ne vise que « quelques
   * sections » cadastrales, que le fichier ne nomme pas.
   */
  attributes: Record<string, unknown> | null;
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

/**
 * Un élément situé **près** de la parcelle : cours d'eau, plan d'eau, point de
 * prélèvement.
 *
 * Distinct d'une `ZoneIntersection` : une distance n'est pas une appartenance.
 * Être à 12 m d'un ruisseau ne met la parcelle dans aucun zonage — mais c'est
 * précisément ce qu'un contrôle de distance a besoin de savoir.
 */
export type Proximite = {
  kind: ZoneKind;
  code: string | null;
  label: string;
  /** Distance géodésique au contour de la parcelle, en mètres. 0 s'il le touche. */
  distanceM: number;
  /** L'élément touche ou traverse la parcelle. */
  dedans: boolean;
  attributes: Record<string, unknown> | null;
  referential: {
    code: string;
    version: string;
    sourceLabel: string;
    territory: string | null;
  };
};

export type ParcelContext = {
  parcelId: string;
  zones: ZoneIntersection[];
  /** Éléments proches, par famille, du plus proche au plus lointain. */
  proximites: Proximite[];
  unresolved: Unresolved[];
  referentialVersions: Array<{ code: string; version: string; sourceLabel: string }>;
};

/**
 * Natures qui délimitent une **surface** réglementaire : on les recoupe avec la
 * parcelle, et l'on rend la surface concernée.
 */
export const NATURES_SURFACIQUES: ZoneKind[] = [
  'ZONE_VULNERABLE',
  'ZONE_ACTION_RENFORCEE',
  'AIRE_ALIMENTATION_CAPTAGE',
  'PERIMETRE_PROTECTION_CAPTAGE',
  'ZONE_PROTECTION_AAC',
  'ZONE_ENVIRONNEMENTALE',
  'BASSIN_HYDROGRAPHIQUE',
  // La région ne réglemente rien par elle-même : elle dit quel programme
  // régional s'applique. Elle figure au contexte pour qu'on le voie.
  'REGION_ADMINISTRATIVE',
  'AUTRE',
];

/** Éléments hydrographiques : on mesure leur distance, on ne les recoupe pas. */
export const NATURES_HYDROGRAPHIQUES: ZoneKind[] = [
  'TRONCON_HYDROGRAPHIQUE',
  'SURFACE_HYDROGRAPHIQUE',
  'PLAN_EAU',
  'COURS_EAU',
];

/** Prélèvements d'eau : on les situe par rapport à la parcelle. */
export const NATURES_PRELEVEMENT: ZoneKind[] = [
  'POINT_PRELEVEMENT',
  'OUVRAGE_PRELEVEMENT',
  'CAPTAGE',
];

/**
 * Rayon de recherche des éléments proches, en mètres.
 *
 * **Ce n'est pas une distance réglementaire** : c'est l'horizon au-delà duquel
 * on ne cherche plus. Il est choisi au-dessus des plus grandes distances que
 * les référentiels importés peuvent exiger — 100 m pour les ZNT aquatiques les
 * plus larges du catalogue E-Phy, 100 m pour les épandages du programme
 * d'actions les plus éloignés des points d'eau. Un contrôle qui a besoin d'une
 * distance la mesure exactement, sans passer par cette liste.
 */
export const RAYON_RECHERCHE_M = 500;

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
  attributes: Record<string, unknown> | null;
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
      r.territory                                             AS ref_territory,
      z.attributes                                            AS attributes
    FROM regulatory_zones z
    JOIN regulatory_referentials r ON r.id = z.referential_id
    CROSS JOIN parcelle p
    WHERE r.status = 'ACTIF'
      AND z.geom IS NOT NULL
      AND z.kind::text IN (${Prisma.join(NATURES_SURFACIQUES)})
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
        attributes: ligne.attributes ?? null,
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

type LigneProximite = {
  kind: ZoneKind;
  code: string | null;
  label: string;
  attributes: Record<string, unknown> | null;
  distance_m: number;
  dedans: boolean;
  ref_code: string;
  ref_version: string;
  ref_source: string;
  ref_territory: string | null;
};

/**
 * Les éléments les plus proches de la parcelle, parmi certaines natures.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE REQUÊTE EST ÉCRITE AINSI
 * ───────────────────────────────────────────────────────────────────────────
 *
 * BD TOPAGE compte 402 215 tronçons en Auvergne-Rhône-Alpes. Mesurer la
 * distance géodésique de la parcelle à chacun — ce que faisait la première
 * version du contrôle de distance — coûte des dizaines de secondes sur un
 * Raspberry Pi, à chaque traitement saisi.
 *
 * `ST_DWithin` sur la géométrie interroge l'index GiST et ne retient que les
 * candidats d'un voisinage ; la distance exacte, sur l'ellipsoïde, n'est
 * calculée que sur eux. La tolérance en degrés est prise sur la longitude, où
 * un degré est le plus court : le voisinage est donc toujours un peu plus
 * large que le rayon, jamais plus étroit.
 *
 * Seuls les référentiels **actifs** comptent : une version remplacée garde ses
 * géométries pour l'historique, mais on ne mesure plus rien contre elles.
 *
 * Les tronçons **fictifs** sont écartés — c'est la source qui les marque ainsi
 * (`TronconFic`) : ils matérialisent l'écoulement à travers un plan d'eau, et
 * la rive de ce plan d'eau, plus proche, est déjà dans les surfaces en eau.
 */
export async function plusProches(
  parcelId: string,
  natures: ZoneKind[],
  options: { rayonM?: number; limite?: number } = {},
): Promise<Proximite[]> {
  const rayon = options.rayonM ?? RAYON_RECHERCHE_M;
  const limite = options.limite ?? 10;

  const lignes = await prisma.$queryRaw<LigneProximite[]>`
    WITH p AS (
      SELECT pg.geom, ST_Y(ST_Centroid(pg.geom)) AS lat
      FROM parcel_geometries pg
      WHERE pg.parcel_id = ${parcelId} AND pg.is_current = true
      LIMIT 1
    )
    SELECT
      z.kind::text                                       AS kind,
      z.code                                             AS code,
      z.label                                            AS label,
      z.attributes                                       AS attributes,
      ST_Distance(z.geom::geography, p.geom::geography)  AS distance_m,
      ST_Intersects(z.geom, p.geom)                      AS dedans,
      r.code                                             AS ref_code,
      r.version                                          AS ref_version,
      r.source_label                                     AS ref_source,
      r.territory                                        AS ref_territory
    FROM p
    JOIN regulatory_zones z
      ON ST_DWithin(
           z.geom,
           p.geom,
           ${rayon}::float8 / (111320.0 * GREATEST(cos(radians(p.lat)), 0.1))
         )
    JOIN regulatory_referentials r
      ON r.id = z.referential_id AND r.status = 'ACTIF'
    WHERE z.kind::text IN (${Prisma.join(natures)})
      AND COALESCE(z.attributes->>'TronconFic', '0') <> '1'
      AND ST_Distance(z.geom::geography, p.geom::geography) <= ${rayon}::float8
    ORDER BY distance_m ASC
    LIMIT ${limite}
  `;

  return lignes.map((ligne) => ({
    kind: ligne.kind,
    code: ligne.code,
    label: ligne.label,
    distanceM: Number(Number(ligne.distance_m).toFixed(1)),
    dedans: Boolean(ligne.dedans),
    attributes: ligne.attributes ?? null,
    referential: {
      code: ligne.ref_code,
      version: ligne.ref_version,
      sourceLabel: ligne.ref_source,
      territory: ligne.ref_territory,
    },
  }));
}

/**
 * Distance au plus proche élément de certaines natures — `null` si aucun dans
 * le rayon de recherche, ou si aucun référentiel ne les porte.
 */
export async function distanceAuPlusProche(
  parcelId: string,
  natures: ZoneKind[],
  rayonM = RAYON_RECHERCHE_M,
): Promise<Proximite | null> {
  const [plusProche] = await plusProches(parcelId, natures, { rayonM, limite: 1 });
  return plusProche ?? null;
}

/**
 * Le référentiel actif qui porte des géométries de ces natures, s'il y en a un.
 *
 * Sert à distinguer deux silences qui ne disent pas la même chose : « rien à
 * moins de 35 m » (on a cherché) et « rien d'importé » (on ne pouvait pas
 * chercher).
 */
export async function referentielPortant(
  natures: ZoneKind[],
): Promise<{ code: string; version: string; sourceLabel: string } | null> {
  const lignes = await prisma.$queryRaw<
    Array<{ code: string; version: string; source_label: string }>
  >`
    SELECT r.code, r.version, r.source_label
    FROM regulatory_referentials r
    WHERE r.status = 'ACTIF'
      AND EXISTS (
        SELECT 1 FROM regulatory_zones z
        WHERE z.referential_id = r.id
          AND z.geom IS NOT NULL
          AND z.kind::text IN (${Prisma.join(natures)})
      )
    ORDER BY r.imported_at DESC NULLS LAST
    LIMIT 1
  `;
  const ligne = lignes[0];
  return ligne
    ? { code: ligne.code, version: ligne.version, sourceLabel: ligne.source_label }
    : null;
}

export { porteeDuClassement, type PorteeDuClassement } from '@/lib/regulatory/portee';

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
  {
    kind: 'AIRE_ALIMENTATION_CAPTAGE',
    label: 'Aire d’alimentation de captage',
    referentialCode: 'aires-alimentation-captage',
  },
  {
    kind: 'PERIMETRE_PROTECTION_CAPTAGE',
    label: 'Périmètre de protection de captage',
    referentialCode: 'perimetres-protection-captage',
  },
  { kind: 'BASSIN_HYDROGRAPHIQUE', label: 'Bassin hydrographique', referentialCode: 'cours-eau' },
  { kind: 'REGION_ADMINISTRATIVE', label: 'Région', referentialCode: 'limites-administratives' },
  // Familles de proximité : elles ne se recoupent pas, elles se mesurent.
  { kind: 'COURS_EAU', label: 'Cours d’eau et plans d’eau', referentialCode: 'cours-eau' },
  { kind: 'CAPTAGE', label: 'Points et ouvrages de prélèvement', referentialCode: 'captages' },
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
    return enregistrer(parcelle, [], unresolved, []);
  }

  const zones = await computeZoneIntersections(parcelId);
  const proximites = [
    ...(await plusProches(parcelId, NATURES_HYDROGRAPHIQUES, { limite: 10 })),
    ...(await plusProches(parcelId, NATURES_PRELEVEMENT, { limite: 10 })),
  ];

  // Quels zonages n'ont pas pu être déterminés, et pourquoi.
  //
  // Un référentiel **actif sans aucune géométrie** compte comme absent : c'est
  // le cas des zones d'actions renforcées, publiées en liste de captages sans
  // périmètre. Sans cette précaution, l'absence de recoupement se lirait
  // « hors ZAR » alors qu'elle veut dire « on ne sait pas où passe la ZAR ».
  const referentielsActifs = await prisma.$queryRaw<
    Array<{ code: string; avec_geometrie: bigint; notes: string | null }>
  >`
    SELECT r.code, COUNT(z.geom)::bigint AS avec_geometrie, r.notes
    FROM regulatory_referentials r
    LEFT JOIN regulatory_zones z ON z.referential_id = r.id
    WHERE r.status = 'ACTIF' AND r.domain = 'ZONAGE'
    GROUP BY r.code, r.notes
  `;
  const disponibles = new Set(
    referentielsActifs.filter((r) => Number(r.avec_geometrie) > 0).map((r) => r.code),
  );
  const sansGeometrie = new Map(
    referentielsActifs
      .filter((r) => Number(r.avec_geometrie) === 0)
      .map((r) => [r.code, r.notes]),
  );

  // Zonage publié à la commune, et classement partiel : la parcelle est dans
  // une commune classée, mais pas forcément dans la zone. On le consigne.
  for (const zone of zones) {
    if (porteeDuClassement(zone.attributes) !== 'partielle') continue;
    const attendu = ZONAGES_ATTENDUS.find((z) => z.kind === zone.kind);
    const raisonPropre = zone.attributes?.raisonIncertitude;
    if (typeof raisonPropre === 'string' && raisonPropre.length > 0) {
      unresolved.push({
        what: attendu?.label ?? zone.label,
        reason: raisonPropre,
        remedy:
          'Consultez la cartographie officielle de ce zonage pour savoir si la ' +
          'parcelle en fait partie.',
      });
      continue;
    }
    unresolved.push({
      what: attendu?.label ?? zone.label,
      reason:
        `La commune de ${zone.label} est classée « quelques sections » : le ` +
        'zonage publié est établi à la commune et ne dit pas quelles sections ' +
        'cadastrales sont concernées.',
      remedy:
        'Reportez-vous à l’arrêté préfectoral de délimitation et aux sections ' +
        'cadastrales qu’il vise pour savoir si cette parcelle en fait partie.',
    });
  }

  for (const manque of await bassinsNonCouverts(zones)) unresolved.push(manque);

  const signales = new Set<string>();
  for (const attendu of ZONAGES_ATTENDUS) {
    if (disponibles.has(attendu.referentialCode)) continue;
    // Deux natures d'un même référentiel absent ne font qu'un signalement.
    if (signales.has(`${attendu.referentialCode}/${attendu.label}`)) continue;
    signales.add(`${attendu.referentialCode}/${attendu.label}`);

    if (sansGeometrie.has(attendu.referentialCode)) {
      unresolved.push({
        what: attendu.label,
        reason:
          `Le référentiel « ${attendu.referentialCode} » est importé, mais sans ` +
          'aucun périmètre géographique : l’appartenance de la parcelle ne peut ' +
          'pas être déterminée.',
        remedy:
          'Importez les périmètres officiels quand ils sont publiés, ou ' +
          'reportez-vous à l’arrêté de délimitation.',
      });
      continue;
    }
    unresolved.push({
      what: attendu.label,
      reason: `Le référentiel « ${attendu.referentialCode} » n’a pas été importé.`,
      remedy: `Importez-le depuis l’administration : Référentiels → ${attendu.referentialCode}.`,
    });
  }

  return enregistrer(parcelle, zones, unresolved, proximites);
}

/**
 * Bassins de la parcelle que le zonage des zones vulnérables ne couvre pas.
 *
 * Chaque bassin a son arrêté de délimitation. Le jeu de la DREAL
 * d'Auvergne-Rhône-Alpes fourni ne contient que les communes des bassins
 * Rhône-Méditerranée et Loire-Bretagne ; le bassin Adour-Garonne, qui touche
 * le Cantal et le Puy-de-Dôme, n'y figure pas. Une parcelle de ce bassin ne
 * recoupe donc aucune commune classée — et l'on serait tenté de conclure
 * « hors zone vulnérable ». Ce serait déduire d'un fichier ce qu'il ne dit pas.
 *
 * Le bassin de la parcelle vient de BD TOPAGE (couche des bassins) ; les
 * bassins couverts, des communes elles-mêmes (`bassin_nom`). Sans l'un ou
 * l'autre, rien n'est signalé ici : l'absence du référentiel est déjà dite
 * par ailleurs.
 */
async function bassinsNonCouverts(zones: ZoneIntersection[]): Promise<Unresolved[]> {
  const bassins = zones.filter((z) => z.kind === 'BASSIN_HYDROGRAPHIQUE');
  if (bassins.length === 0) return [];

  const couverts = await prisma.$queryRaw<Array<{ bassin: string }>>`
    SELECT DISTINCT z.attributes->>'bassin_nom' AS bassin
    FROM regulatory_zones z
    JOIN regulatory_referentials r ON r.id = z.referential_id
    WHERE r.status = 'ACTIF' AND r.code = 'zones-vulnerables'
      AND z.kind = 'ZONE_VULNERABLE'
      AND z.attributes ? 'bassin_nom'
  `;
  if (couverts.length === 0) return [];

  const normaliser = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
  const noms = new Set(couverts.map((c) => normaliser(c.bassin)));

  return bassins
    .filter((b) => !noms.has(normaliser(b.label)))
    .map((b) => ({
      what: 'Zone vulnérable aux nitrates',
      reason:
        `La parcelle est ${b.coverage === 'totale' ? '' : 'en partie '}dans le bassin ` +
        `${b.label} (BD TOPAGE), que le zonage des zones vulnérables importé ne couvre ` +
        `pas : il ne contient que les communes des bassins ` +
        `${couverts.map((c) => c.bassin).join(' et ')}.`,
      remedy:
        `Reportez-vous à l’arrêté de délimitation des zones vulnérables du bassin ${b.label}.`,
    }));
}

async function enregistrer(
  parcelle: { id: string; commune: string | null; inseeCode: string | null },
  zones: ZoneIntersection[],
  unresolved: Unresolved[],
  proximites: Proximite[],
): Promise<ParcelContext> {
  const versions = [
    ...new Map(
      [...zones, ...proximites].map((z) => [
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
    proximites: proximites as unknown as Prisma.InputJsonValue,
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
    proximites,
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
    proximites: (ligne.proximites as unknown as Proximite[]) ?? [],
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

/**
 * Département déduit d'un code INSEE de commune.
 *
 * Le code INSEE compte cinq caractères, et le département n'en occupe pas
 * toujours deux :
 *
 *   · outre-mer — `97123` → `971`, trois chiffres ;
 *   · Corse     — `2A004` → `2A`, une lettre.
 *
 * Prendre systématiquement les deux premiers caractères donnerait `97` pour
 * toute l'outre-mer, et ferait chercher un programme d'actions dans un
 * département qui n'existe pas.
 */
export function departementDepuisInsee(insee: string | null): string | null {
  const code = (insee ?? '').trim().toUpperCase();
  if (!/^(\d{5}|2[AB]\d{3})$/.test(code)) return null;
  if (code.startsWith('97') || code.startsWith('98')) return code.slice(0, 3);
  return code.slice(0, 2);
}

/**
 * Territoires d'une parcelle, du plus précis au plus général.
 *
 * Sert à choisir la bonne version d'un référentiel territorialisé : un
 * programme d'actions départemental prime sur le régional, qui prime sur le
 * national.
 *
 * On ne prend que ce qui est **su** : le code INSEE de la parcelle, puis le
 * département de l'exploitation. Rien n'est déduit d'une coordonnée ou d'un nom
 * de commune — un rapprochement approximatif appliquerait le programme d'une
 * région voisine sans que rien ne le signale.
 */
export async function territoiresDeLaParcelle(parcelId: string): Promise<string[]> {
  const parcelle = await prisma.parcel.findUnique({
    where: { id: parcelId },
    select: { inseeCode: true, farm: { select: { department: true } } },
  });
  if (!parcelle) return [];

  const territoires: string[] = [];

  const depuisInsee = departementDepuisInsee(parcelle.inseeCode);
  if (depuisInsee) territoires.push(depuisInsee);

  const depuisExploitation = (parcelle.farm.department ?? '').trim().toUpperCase();
  if (depuisExploitation && !territoires.includes(depuisExploitation)) {
    territoires.push(depuisExploitation);
  }

  // La région, par le contour officiel quand il est importé : c'est elle qui
  // désigne le programme d'actions régional et le référentiel GREN. Une
  // parcelle sans contour n'a pas de région connue — et l'on ne la déduit pas
  // du département.
  for (const region of await regionsDeLaParcelle(parcelId)) {
    if (!territoires.includes(region)) territoires.push(region);
  }

  // « FR » ferme la liste : un référentiel national s'applique à défaut de
  // territorial. `resolveReferential` essaie ensuite `null`, qui couvre les
  // référentiels non territorialisés.
  territoires.push('FR');
  return territoires;
}

/** Codes des régions dont le contour officiel recoupe la parcelle. */
export async function regionsDeLaParcelle(parcelId: string): Promise<string[]> {
  const lignes = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT DISTINCT z.code
    FROM parcel_geometries pg
    JOIN regulatory_zones z
      ON z.kind = 'REGION_ADMINISTRATIVE' AND ST_Intersects(z.geom, pg.geom)
    JOIN regulatory_referentials r ON r.id = z.referential_id AND r.status = 'ACTIF'
    WHERE pg.parcel_id = ${parcelId} AND pg.is_current = true AND z.code IS NOT NULL
    ORDER BY z.code
  `;
  return lignes.map((l) => l.code);
}

/**
 * Trois états, jamais deux.
 *
 * `context.zones.some(z => z.kind === 'ZONE_VULNERABLE')` rend `false` aussi
 * bien pour une parcelle hors zone vulnérable que pour une parcelle dont on
 * n'a **aucune donnée de zonage** — référentiel non importé, contour non
 * tracé. Les deux se lisent alors « pas concernée », et l'un des deux est un
 * mensonge silencieux : c'est précisément ce que Parcelys s'interdit.
 *
 * `indetermine` force l'appelant à traiter le cas, et l'écran à le dire.
 */
export function statutZonage(
  context: ParcelContext | null,
  kind: ZoneKind,
  /** Date à laquelle on juge : celle de l'intervention, ou la fin de campagne. */
  date: Date = new Date(),
): 'dedans' | 'dehors' | 'indetermine' {
  if (!context) return 'indetermine';

  const portees = context.zones
    .filter((zone) => zone.kind === kind)
    .map((zone) => porteeDuClassement(zone.attributes, date));

  // Un classement « toutes sections », ou un zonage dont la géométrie est la
  // zone elle-même : le recoupement tranche.
  if (portees.some((p) => p === 'totale' || p === 'non-precisee')) return 'dedans';
  // Recoupée seulement par des communes classées « quelques sections », ou par
  // un zonage pas encore en vigueur à cette date : on ne sait pas, et le dire
  // est la seule réponse juste.
  if (portees.some((p) => p === 'partielle' || p === 'non-en-vigueur')) {
    return 'indetermine';
  }
  // Ne restent que des communes retirées du zonage à cette date : elles ne
  // classent rien, et l'on poursuit comme sans recoupement.

  // Un zonage attendu et non déterminé figure dans `unresolved` : le contour
  // manque, ou le référentiel n'est pas importé. Dans les deux cas on ne sait
  // pas — on ne conclut pas.
  const attendu = ZONAGES_ATTENDUS.find((z) => z.kind === kind);
  const nonResolu = context.unresolved.some(
    (u) => u.what === attendu?.label || u.what === 'Contexte réglementaire',
  );
  return nonResolu ? 'indetermine' : 'dehors';
}
