import 'server-only';
import { prisma } from '@/lib/prisma';
import { resolveReferential } from '@/lib/regulatory/referentials';
import {
  getOrComputeParcelContext,
  statutZonage,
  territoiresDeLaParcelle,
} from '@/lib/regulatory/geography';
import { plafondAzoteOrganique } from '@/lib/regulatory/organic-nitrogen';

/**
 * Contrôle avant épandage : parcelle + date + effluent + quantité.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il répond à une question qu'on se pose le matin, tracteur attelé : « est-ce
 * que je peux épandre là, aujourd'hui, cette quantité ? »
 *
 * Il rend un verdict — conforme, à vérifier, non conforme — et, surtout, la
 * **liste de ce qu'il a pu contrôler et de ce qu'il n'a pas pu**. Les deux
 * comptent autant : un « conforme » qui tairait trois contrôles impossibles
 * serait un mensonge poli.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Aucune période d'interdiction n'est écrite ici.** Les calendriers
 * d'épandage varient selon le programme d'actions régional, le type d'effluent
 * et la culture en place ; ils changent à chaque révision. Les écrire en dur
 * reviendrait à opposer à Kevin un calendrier dont Parcelys serait la seule
 * source — et qui serait faux ailleurs, ou plus tard.
 *
 * Ils se **chargent** : une règle `periode-interdiction-epandage` dans un
 * programme d'actions importé, avec son territoire, ses dates et sa référence
 * d'arrêté. Tant qu'elle n'est pas là, le contrôle le dit et reste indéterminé.
 *
 * **Aucune distance n'est inventée non plus.** Les distances aux cours d'eau et
 * aux habitations relèvent du même mécanisme. Parcelys sait mesurer la distance
 * d'une parcelle à un zonage importé — c'est PostGIS qui le fait — mais il ne
 * sait pas quelle distance est exigée tant qu'une règle ne le dit pas.
 *
 * C'est la règle de la section 34 appliquée à la lettre : une information non
 * vérifiable n'est pas inventée, elle est signalée comme manquante.
 */

/** Codes cherchés dans le programme d'actions. Absents ⇒ contrôle impossible. */
const CODE_PERIODE = 'periode-interdiction-epandage';
const CODE_DISTANCE_EAU = 'distance-epandage-cours-eau';
const CODE_DISTANCE_HABITATION = 'distance-epandage-habitation';

export type NiveauEpandage = 'CONFORME' | 'A_VERIFIER' | 'NON_CONFORME';

export type PointDeControle = {
  /** Ce qui a été regardé. */
  sujet: string;
  /**
   * `ok` — contrôlé et satisfait ; `alerte` — contrôlé et non satisfait ;
   * `indetermine` — pas contrôlable, et l'on dit pourquoi.
   */
  verdict: 'ok' | 'alerte' | 'indetermine';
  detail: string;
  /** D'où vient la règle opposée, quand il y en a une. */
  source: string | null;
};

export type ControleEpandage = {
  niveau: NiveauEpandage;
  parcelle: { id: string; nom: string; surfaceHa: number };
  effluent: string;
  quantite: { valeur: number; unite: string };
  date: string;
  points: PointDeControle[];
  /** Phrase de synthèse, dans le vocabulaire de la section 53. */
  synthese: string;
};

/**
 * Contrôle une intention d'épandage.
 *
 * Ne lit que des données de l'exploitation et des référentiels importés ; ne
 * modifie rien. Peut donc être appelé aussi souvent qu'on veut, avant la
 * saisie comme après.
 */
export async function controlerEpandage(params: {
  farmId: string;
  parcelId: string;
  date: Date;
  effluent: string;
  /** Quantité brute et son unité, telles que saisies (t/ha, m3/ha…). */
  quantite: number;
  unite: string;
  /** Azote total apporté par cet épandage, en kg, quand il est calculable. */
  azoteKg: number | null;
  campaignYear: number;
}): Promise<ControleEpandage> {
  const points: PointDeControle[] = [];

  const parcelle = await prisma.parcel.findFirst({
    where: { id: params.parcelId, farmId: params.farmId, deletedAt: null },
    select: { id: true, name: true, areaHa: true },
  });
  if (!parcelle) {
    throw new Error('Parcelle introuvable dans cette exploitation.');
  }

  // --- 1. Le zonage de la parcelle ----------------------------------------
  //
  // C'est lui qui décide quelles règles s'appliquent : une exploitation hors
  // zone vulnérable ne se voit pas opposer le programme d'actions nitrates.
  const contexte = await getOrComputeParcelContext(params.parcelId).catch(() => null);
  // `statutZonage` distingue les trois états qui comptent : dedans, dehors, et
  // « on ne sait pas ». Un booléen les aurait ramenés à deux, et c'est
  // précisément le troisième qui interdit de conclure.
  const zoneVulnerable = statutZonage(contexte, 'ZONE_VULNERABLE');
  const enZoneVulnerable =
    zoneVulnerable === 'indetermine' ? null : zoneVulnerable === 'dedans';

  points.push({
    sujet: 'Zone vulnérable aux nitrates',
    verdict: enZoneVulnerable === null ? 'indetermine' : 'ok',
    detail:
      enZoneVulnerable === null
        ? 'Le zonage de cette parcelle n’a pas pu être déterminé : le référentiel ' +
          '« zones-vulnerables » n’est pas importé, ou la parcelle n’a pas de contour.'
        : enZoneVulnerable
          ? 'Parcelle située en zone vulnérable : le programme d’actions nitrates s’applique.'
          : 'Parcelle hors zone vulnérable : le programme d’actions nitrates ne s’y applique pas.',
    source: contexte?.referentialVersions[0]?.sourceLabel ?? null,
  });

  // --- 2. La période ------------------------------------------------------
  points.push(
    await controlerPeriode({
      date: params.date,
      effluent: params.effluent,
      enZoneVulnerable,
      territoires: await territoiresDeLaParcelle(params.parcelId),
    }),
  );

  // --- 3. Les distances ---------------------------------------------------
  for (const distance of await controlerDistances({
    parcelId: params.parcelId,
    date: params.date,
    territoires: await territoiresDeLaParcelle(params.parcelId),
  })) {
    points.push(distance);
  }

  // --- 4. Le plafond d'azote organique ------------------------------------
  points.push(
    await controlerPlafond({
      farmId: params.farmId,
      parcelId: params.parcelId,
      surfaceParcelleHa: Number(parcelle.areaHa),
      campaignYear: params.campaignYear,
      azoteKg: params.azoteKg,
      date: params.date,
      territoires: await territoiresDeLaParcelle(params.parcelId),
    }),
  );

  // --- 5. La culture en place ---------------------------------------------
  const culture = await prisma.cropYear.findFirst({
    where: { parcelId: params.parcelId, campaignYear: params.campaignYear },
    select: { crop: { select: { name: true } } },
  });
  points.push({
    sujet: 'Culture en place',
    verdict: culture ? 'ok' : 'indetermine',
    detail: culture
      ? `Culture déclarée pour la campagne ${params.campaignYear} : ${culture.crop.name}. ` +
        'Les calendriers d’épandage dépendent de la culture ; vérifiez que la règle ' +
        'opposée ci-dessus correspond bien à celle-ci.'
      : `Aucune culture déclarée sur cette parcelle pour la campagne ${params.campaignYear}. ` +
        'Les périodes d’épandage en dépendent : renseignez-la pour un contrôle complet.',
    source: null,
  });

  // --- Synthèse -----------------------------------------------------------
  //
  // Le niveau retenu est le plus sévère rencontré. Un seul point indéterminé
  // suffit à faire passer de « conforme » à « à vérifier » : dire conforme en
  // ayant renoncé à un contrôle serait exactement ce que la section 53 interdit.
  const niveau: NiveauEpandage = points.some((p) => p.verdict === 'alerte')
    ? 'NON_CONFORME'
    : points.some((p) => p.verdict === 'indetermine')
      ? 'A_VERIFIER'
      : 'CONFORME';

  const alertes = points.filter((p) => p.verdict === 'alerte').length;
  const indetermines = points.filter((p) => p.verdict === 'indetermine').length;

  const synthese =
    niveau === 'NON_CONFORME'
      ? `${alertes} règle(s) ne sont pas respectées d’après les référentiels importés.`
      : niveau === 'A_VERIFIER'
        ? `Aucune anomalie détectée sur les ${points.length - indetermines} point(s) ` +
          `vérifiables, mais ${indetermines} n’ont pas pu être contrôlés faute de ` +
          'référentiel ou de donnée. Ce n’est pas un feu vert.'
        : 'Aucune anomalie détectée selon les données et référentiels actuellement ' +
          'disponibles.';

  return {
    niveau,
    parcelle: {
      id: parcelle.id,
      nom: parcelle.name,
      surfaceHa: Number(parcelle.areaHa),
    },
    effluent: params.effluent,
    quantite: { valeur: params.quantite, unite: params.unite },
    date: params.date.toISOString().slice(0, 10),
    points,
    synthese,
  };
}

// ---------------------------------------------------------------------------

/**
 * La date tombe-t-elle dans une période d'interdiction ?
 *
 * La règle attendue porte, dans son `value`, une ou plusieurs périodes sous la
 * forme `{ periodes: [{ du: 'MM-JJ', au: 'MM-JJ' }] }`. Les jours sans année :
 * une interdiction d'épandage se répète chaque année, et l'importer avec une
 * année la rendrait fausse dès la suivante.
 *
 * Une période qui enjambe le 1ᵉʳ janvier (du 15-11 au 15-01) est reconnue comme
 * telle : c'est le cas le plus courant, et le traiter comme un intervalle
 * ordinaire ne déclencherait jamais.
 */
async function controlerPeriode(params: {
  date: Date;
  effluent: string;
  enZoneVulnerable: boolean | null;
  territoires: string[];
}): Promise<PointDeControle> {
  const sujet = 'Période d’épandage';

  if (params.enZoneVulnerable === false) {
    return {
      sujet,
      verdict: 'ok',
      detail:
        'Parcelle hors zone vulnérable : les périodes d’interdiction du programme ' +
        'd’actions nitrates ne s’y appliquent pas. D’autres restrictions locales ' +
        'peuvent exister.',
      source: null,
    };
  }

  const regles = await reglesEnVigueur(CODE_PERIODE, params.date, params.territoires);
  if (regles.length === 0) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        'Aucune période d’interdiction n’est chargée. Parcelys n’en invente pas : ' +
        'les calendriers dépendent du programme d’actions régional, du type ' +
        'd’effluent et de la culture. Importez le programme d’actions applicable ' +
        'depuis Administration → Référentiels.',
      source: null,
    };
  }

  const jour = `${String(params.date.getMonth() + 1).padStart(2, '0')}-${String(
    params.date.getDate(),
  ).padStart(2, '0')}`;

  for (const regle of regles) {
    for (const periode of periodesDeLaRegle(regle.value)) {
      if (!dansLaPeriode(jour, periode.du, periode.au)) continue;
      return {
        sujet,
        verdict: 'alerte',
        detail:
          `Le ${params.date.toLocaleDateString('fr-FR')} tombe dans une période ` +
          `d’interdiction d’épandage (du ${periode.du} au ${periode.au}). ` +
          (regle.exception ? `Exception publiée : ${regle.exception}` : ''),
        source: regle.source,
      };
    }
  }

  return {
    sujet,
    verdict: 'ok',
    detail:
      `Le ${params.date.toLocaleDateString('fr-FR')} ne tombe dans aucune des ` +
      `${regles.length} période(s) d’interdiction chargée(s).`,
    source: regles[0]?.source ?? null,
  };
}

/**
 * Les distances aux cours d'eau et aux habitations.
 *
 * Deux conditions doivent être réunies pour conclure : une **règle** qui dise
 * quelle distance est exigée, et un **zonage** qui dise où se trouve ce dont il
 * faut s'éloigner. L'absence de l'un ou de l'autre rend le contrôle
 * indéterminé — et le dit.
 *
 * La distance est mesurée par PostGIS entre le contour de la parcelle et le
 * zonage, sur l'ellipsoïde. C'est une distance **au contour**, pas au point
 * d'épandage : la valeur rendue est donc la plus favorable. La phrase le dit.
 */
async function controlerDistances(params: {
  parcelId: string;
  date: Date;
  territoires: string[];
}): Promise<PointDeControle[]> {
  const points: PointDeControle[] = [];

  const cas = [
    { code: CODE_DISTANCE_EAU, zone: 'COURS_EAU', sujet: 'Distance aux cours d’eau' },
    {
      code: CODE_DISTANCE_HABITATION,
      zone: 'ZONE_ENVIRONNEMENTALE',
      sujet: 'Distance aux habitations',
    },
  ] as const;

  for (const { code, zone, sujet } of cas) {
    const regles = await reglesEnVigueur(code, params.date, params.territoires);
    const exigee = regles.length > 0 ? nombreDeLaRegle(regles[0]!.value) : null;

    if (exigee === null) {
      points.push({
        sujet,
        verdict: 'indetermine',
        detail:
          'Aucune distance n’est chargée pour ce contrôle. Parcelys n’en invente ' +
          'pas : elle dépend du programme d’actions et du type d’effluent. ' +
          'Importez le programme d’actions applicable.',
        source: null,
      });
      continue;
    }

    const mesuree = await distanceAuZonage(params.parcelId, zone);
    if (mesuree === null) {
      points.push({
        sujet,
        verdict: 'indetermine',
        detail:
          `La distance exigée est connue (${exigee} m, ${regles[0]!.source}), mais ` +
          `aucun zonage « ${zone} » n’est importé — ou la parcelle n’a pas de ` +
          'contour. Il n’y a donc rien à mesurer.',
        source: regles[0]!.source,
      });
      continue;
    }

    points.push({
      sujet,
      verdict: mesuree >= exigee ? 'ok' : 'alerte',
      detail:
        `Distance mesurée entre le contour de la parcelle et le zonage le plus ` +
        `proche : ${mesuree.toFixed(0)} m, pour ${exigee} m exigés. ` +
        'La mesure part du contour de la parcelle, pas du point d’épandage : ' +
        'la distance réelle depuis l’endroit épandu peut être plus courte.',
      source: regles[0]!.source,
    });
  }

  return points;
}

/**
 * Le plafond d'azote organique serait-il dépassé par cet apport ?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE CONTRÔLE NE SE CONTENTE PAS DE `plafondAzoteOrganique`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ce module-là fait un bilan **rétrospectif** : il regarde ce qui a déjà été
 * épandu, et ne connaît donc que les parcelles ayant déjà reçu quelque chose.
 * C'est ce qu'il faut pour un tableau de bord de campagne.
 *
 * Ici la question est **prospective** : « si j'épands là, est-ce que je
 * dépasse ? » La parcelle visée n'a peut-être encore rien reçu — c'est même le
 * cas le plus fréquent. Le premier essai écrit l'a montré : le contrôle
 * ressortait indéterminé sur une exploitation où aucun apport n'était encore
 * enregistré, c'est-à-dire précisément quand on en a besoin.
 *
 * On reprend donc de `plafondAzoteOrganique` ce qu'il sait le mieux — combien a
 * déjà été épandu, sur quelle surface —, et on y ajoute la parcelle visée si
 * elle n'y figure pas encore. Le plafond, lui, est cherché sur les territoires
 * de **cette** parcelle.
 */
async function controlerPlafond(params: {
  farmId: string;
  parcelId: string;
  surfaceParcelleHa: number;
  campaignYear: number;
  azoteKg: number | null;
  date: Date;
  territoires: string[];
}): Promise<PointDeControle> {
  const sujet = 'Plafond d’azote organique';

  const regles = await reglesEnVigueur('plafond-azote-organique', params.date, params.territoires);
  const plafond = regles.length > 0 ? nombreDeLaRegle(regles[0]!.value) : null;

  if (plafond === null) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        'Aucun plafond n’est chargé pour le territoire de cette parcelle. Parcelys ' +
        'ne suppose pas les 170 kg N/ha : ce plafond ne s’applique qu’en zone ' +
        'vulnérable, connaît des dérogations, et un chiffre écrit en dur n’aurait ' +
        'aucune source à opposer en contrôle. Importez le programme d’actions ' +
        'applicable depuis Administration → Référentiels.',
      source: null,
    };
  }

  const unite = 'kg N/ha';

  if (params.azoteKg === null) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        `Le plafond est connu (${plafond} ${unite}), mais la teneur en azote de cet ` +
        'effluent n’est pas renseignée : l’apport ne peut pas être chiffré. ' +
        'Renseignez-la depuis une analyse du produit.',
      source: regles[0]!.source,
    };
  }

  // Ce qui a déjà été épandu sur la campagne, et sur quelle surface.
  const etat = await plafondAzoteOrganique({
    farmId: params.farmId,
    campaignYear: params.campaignYear,
  });

  // La parcelle visée compte-t-elle déjà dans cette surface ? Si elle n'a
  // encore rien reçu, sa surface s'ajoute — sans quoi le rapport à l'hectare
  // serait calculé sur une base trop petite, et le dépassement exagéré.
  const dejaServie = await prisma.fertilizerApplication.count({
    where: {
      parcelId: params.parcelId,
      inputType: 'ORGANIC',
      appliedOn: {
        gte: new Date(Date.UTC(params.campaignYear - 1, 7, 1)),
        lte: new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59)),
      },
    },
  });

  const surface =
    etat.surfaceHa + (dejaServie > 0 ? 0 : params.surfaceParcelleHa);

  if (surface <= 0) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        'Aucune surface connue : le rapport à l’hectare n’est pas calculable. ' +
        'La parcelle a-t-elle un contour ?',
      source: regles[0]!.source,
    };
  }

  const apres = (etat.azoteOrganiqueKg + params.azoteKg) / surface;
  const depasse = apres > plafond;

  return {
    sujet,
    verdict: depasse ? 'alerte' : 'ok',
    detail:
      `Avec cet apport, l’azote organique de la campagne ${params.campaignYear} ` +
      `atteindrait ${apres.toFixed(1)} ${unite} sur ${surface.toFixed(2)} ha, ` +
      `pour un plafond de ${plafond} ${unite}. ` +
      (depasse
        ? 'Réduisez la quantité, ou répartissez l’apport sur une surface plus grande.'
        : `Il resterait ${(plafond - apres).toFixed(1)} ${unite} disponibles sur la campagne.`),
    source: regles[0]!.source,
  };
}

// ---------------------------------------------------------------------------
// Lecture des règles
// ---------------------------------------------------------------------------

type RegleLue = { value: unknown; exception: string | null; source: string };

/** Les règles d'un code, en vigueur à la date donnée, la plus récente d'abord. */
async function reglesEnVigueur(
  code: string,
  at: Date,
  territoires: string[],
): Promise<RegleLue[]> {
  // Du territoire le plus précis au plus général : un programme d'actions
  // départemental prime sur le régional, qui prime sur le national. C'est
  // `resolveReferential` qui tient cette hiérarchie.
  const referentiel = await resolveReferential({
    code: 'programme-actions-nitrates',
    territories: territoires,
    at,
  }).catch(() => null);
  if (!referentiel) return [];

  const regles = await prisma.regulatoryRule.findMany({
    where: {
      referentialId: referentiel.id,
      code,
      appliesFrom: { lte: at },
      OR: [{ appliesTo: null }, { appliesTo: { gte: at } }],
    },
    orderBy: { appliesFrom: 'desc' },
  });

  return regles.map((r) => ({
    value: r.value,
    exception: r.exception,
    source: [r.sourceRef, `${referentiel.code} v${referentiel.version}`]
      .filter(Boolean)
      .join(' · '),
  }));
}

type Periode = { du: string; au: string };

/** Les périodes portées par une règle, ou aucune si la forme n'est pas reconnue. */
function periodesDeLaRegle(value: unknown): Periode[] {
  if (typeof value !== 'object' || value === null) return [];
  const brut = (value as { periodes?: unknown }).periodes;
  if (!Array.isArray(brut)) return [];

  const periodes: Periode[] = [];
  for (const entree of brut) {
    if (typeof entree !== 'object' || entree === null) continue;
    const du = (entree as { du?: unknown }).du;
    const au = (entree as { au?: unknown }).au;
    // `MM-JJ` strictement : une forme approchée serait interprétée de travers,
    // et une interdiction mal lue vaut mieux refusée que devinée.
    if (typeof du === 'string' && typeof au === 'string' && /^\d{2}-\d{2}$/.test(du) && /^\d{2}-\d{2}$/.test(au)) {
      periodes.push({ du, au });
    }
  }
  return periodes;
}

/**
 * Un nombre porté par une règle, quelle que soit la clé employée.
 *
 * `kgHa` figure dans cette liste parce que `organic-nitrogen.ts` lit déjà le
 * plafond d'azote sous cette clé-là. Deux modules qui liraient la même règle
 * différemment donneraient deux plafonds pour un seul arrêté — et celui qui se
 * tromperait serait invisible, puisqu'il rendrait simplement « indéterminé ».
 */
function nombreDeLaRegle(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || value === null) return null;
  for (const cle of ['metres', 'm', 'valeur', 'distance', 'kgHa']) {
    const brut = (value as Record<string, unknown>)[cle];
    if (typeof brut === 'number' && Number.isFinite(brut)) return brut;
  }
  return null;
}

/**
 * Le jour `MM-JJ` tombe-t-il entre `du` et `au` ?
 *
 * Les bornes sont incluses, et une période qui enjambe le 1ᵉʳ janvier
 * (du 15-11 au 15-01) est reconnue : c'est la forme la plus courante des
 * interdictions d'épandage, et la traiter comme un intervalle ordinaire ne
 * déclencherait jamais.
 */
export function dansLaPeriode(jour: string, du: string, au: string): boolean {
  if (du <= au) return jour >= du && jour <= au;
  return jour >= du || jour <= au;
}

/**
 * Distance en mètres entre le contour d'une parcelle et le zonage le plus
 * proche d'une nature donnée. `null` s'il n'y a pas de quoi mesurer.
 */
async function distanceAuZonage(
  parcelId: string,
  kind: string,
): Promise<number | null> {
  const lignes = await prisma.$queryRaw<Array<{ distance: number | null }>>`
    SELECT MIN(ST_Distance(pg.geom::geography, z.geom::geography)) AS distance
    FROM parcel_geometries pg
    JOIN regulatory_zones z ON z.kind::text = ${kind}
    WHERE pg.parcel_id = ${parcelId} AND pg.is_current = true
  `;
  const distance = lignes[0]?.distance;
  return distance === null || distance === undefined ? null : Number(distance);
}
