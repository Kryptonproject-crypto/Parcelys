import 'server-only';
import { prisma } from '@/lib/prisma';
import { resolveReferential } from '@/lib/regulatory/referentials';
import {
  NATURES_HYDROGRAPHIQUES,
  distanceAuPlusProche,
  getOrComputeParcelContext,
  referentielPortant,
  statutZonage,
  territoiresDeLaParcelle,
} from '@/lib/regulatory/geography';
import { plafondAzoteOrganique } from '@/lib/regulatory/organic-nitrogen';
import {
  controleBandeEnherbee,
  controlerApportPar,
  type ApportAControler,
} from '@/lib/regulatory/programme-actions';
import { traceEnClair, type Trace } from '@/lib/regulatory/regles';
import type { ClassementProduit } from '@/lib/regulatory/classement-produit';
import type { ZoneKind } from '@prisma/client';

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
  verdict: 'ok' | 'alerte' | 'verification' | 'indetermine' | 'sans-objet';
  detail: string;
  /** D'où vient la règle opposée, quand il y en a une. */
  source: string | null;
  /**
   * La règle opposée, entière : code, référentiel et version, texte, citation,
   * territoire et période de validité. Présente pour les règles transcrites.
   */
  trace?: Trace | null;
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
  /**
   * Ce que les règles du programme d'actions régional ont besoin de savoir du
   * produit : sa nature, son classement, l'azote apporté à l'hectare.
   */
  produit?: {
    nature: 'MINERAL' | 'ORGANIC';
    classement: ClassementProduit;
    azoteKgHa: number | null;
  };
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
  const zoneVulnerable = statutZonage(contexte, 'ZONE_VULNERABLE', params.date);
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

  // --- 2. Le programme d'actions régional ---------------------------------
  //
  // Période, fractionnement, couverts, digestats, zone d'actions renforcée :
  // les règles transcrites de l'arrêté régional, lues à la date de
  // l'épandage, chacune avec sa trace. Sans le produit, rien n'est opposable
  // — le type de fertilisant décide de presque tout.
  if (params.produit) {
    const apport: ApportAControler = {
      parcelId: params.parcelId,
      date: params.date,
      nature: params.produit.nature,
      libelle: params.effluent,
      azoteTotalKgHa: params.produit.azoteKgHa,
      classement: params.produit.classement,
    };
    const { controles } = await controlerApportPar(apport);
    for (const c of controles) {
      points.push({
        sujet: c.sujet,
        verdict: c.verdict,
        detail: c.detail,
        source: c.trace ? traceEnClair(c.trace) : null,
        trace: c.trace,
      });
    }
  } else {
    points.push(
      await controlerPeriode({
        date: params.date,
        effluent: params.effluent,
        enZoneVulnerable,
        territoires: await territoiresDeLaParcelle(params.parcelId),
      }),
    );
  }

  // --- 3. Les distances ---------------------------------------------------
  for (const distance of await controlerDistances({
    parcelId: params.parcelId,
    date: params.date,
    territoires: await territoiresDeLaParcelle(params.parcelId),
  })) {
    points.push(distance);
  }

  const bande = await controleBandeEnherbee(params.parcelId, params.date);
  if (bande) {
    points.push({
      sujet: bande.sujet,
      verdict: bande.verdict,
      detail: bande.detail,
      source: bande.trace ? traceEnClair(bande.trace) : null,
      trace: bande.trace,
    });
  }

  // --- 4. Le plafond d'azote organique ------------------------------------
  //
  // Il porte sur l'azote des effluents d'élevage : un engrais minéral n'y
  // entre pas, et dire « teneur de l'effluent inconnue » à son sujet serait
  // faux.
  if (params.produit?.nature === 'MINERAL') {
    points.push({
      sujet: 'Plafond d’azote organique',
      verdict: 'sans-objet',
      detail: 'Engrais minéral : le plafond d’azote organique ne le concerne pas.',
      source: null,
    });
  } else {
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
  }

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
    : points.some((p) => p.verdict === 'indetermine' || p.verdict === 'verification')
      ? 'A_VERIFIER'
      : 'CONFORME';

  const alertes = points.filter((p) => p.verdict === 'alerte').length;
  const indetermines = points.filter(
    (p) => p.verdict === 'indetermine' || p.verdict === 'verification',
  ).length;
  // Une règle « sans objet » n'est ni vérifiée ni manquée : elle ne compte pas.
  const verifiables = points.filter((p) => p.verdict !== 'sans-objet').length;

  const synthese =
    niveau === 'NON_CONFORME'
      ? `${alertes} règle(s) ne sont pas respectées d’après les référentiels importés.`
      : niveau === 'A_VERIFIER'
        ? `Aucune anomalie détectée sur les ${verifiables - indetermines} point(s) ` +
          `vérifiables, mais ${indetermines} n’ont pas pu être contrôlés faute de ` +
          'référentiel ou de donnée, ou demandent une vérification. Ce n’est pas un feu vert.'
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
      // Une période conditionnée (type de fertilisant, culture) ne s'oppose
      // pas sans savoir ce qui est épandu, et sur quoi : c'est le contrôle du
      // programme d'actions qui la juge, produit en main.
      if (regle.conditionnee) {
        return {
          sujet,
          verdict: 'indetermine',
          detail:
            `Le ${params.date.toLocaleDateString('fr-FR')} tombe dans une période (du ${periode.du} ` +
            `au ${periode.au}) qui ne vise que certains fertilisants et certaines cultures : ` +
            'précisez le produit épandu pour qu’elle soit jugée.',
          source: regle.source,
        };
      }
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

  /*
   * Deux familles, et elles ne se jugent pas pareil.
   *
   * Les habitations, quand un zonage les porte, sont qualifiées par lui : une
   * distance trop courte est un constat.
   *
   * L'hydrographie vient de BD TOPAGE, qui **localise** les écoulements — tous,
   * nommés ou non, permanents ou intermittents — mais ne dit pas lesquels sont
   * des cours d'eau au sens de l'arrêté : c'est la cartographie départementale
   * qui en décide. Un élément plus proche que la distance exigée est donc « à
   * vérifier », avec son nom, sa nature et sa persistance — jamais « non
   * conforme » sur la seule foi de sa présence.
   */
  const cas = [
    {
      code: CODE_DISTANCE_EAU,
      natures: NATURES_HYDROGRAPHIQUES,
      sujet: 'Distance aux cours d’eau',
      qualifieParLeZonage: false,
    },
    {
      code: CODE_DISTANCE_HABITATION,
      natures: ['ZONE_ENVIRONNEMENTALE'] as ZoneKind[],
      sujet: 'Distance aux habitations',
      qualifieParLeZonage: true,
    },
  ];

  const contour = await prisma.parcelGeometry.findFirst({
    where: { parcelId: params.parcelId, isCurrent: true },
    select: { id: true },
  });

  for (const { code, natures, sujet, qualifieParLeZonage } of cas) {
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

    const source = regles[0]!.source;
    const referentiel = await referentielPortant(natures);

    if (!contour || !referentiel) {
      points.push({
        sujet,
        verdict: 'indetermine',
        detail:
          `La distance exigée est connue (${exigee} m, ${source}), mais ` +
          (contour
            ? 'aucun référentiel ne localise ce dont il faut s’éloigner. '
            : 'la parcelle n’a pas de contour. ') +
          'Il n’y a donc rien à mesurer.',
        source,
      });
      continue;
    }

    const proche = await distanceAuPlusProche(params.parcelId, natures, exigee);
    const reference = `${referentiel.sourceLabel} v${referentiel.version}`;

    if (!proche) {
      points.push({
        sujet,
        verdict: 'ok',
        detail:
          `Aucun élément à moins de ${exigee} m du contour de la parcelle ` +
          `(${reference}). La mesure part du contour, pas du point d’épandage.`,
        source,
      });
      continue;
    }

    const quoi = [
      proche.label,
      typeof proche.attributes?.NatureTH === 'string' ? proche.attributes.NatureTH : null,
      typeof proche.attributes?.Persistanc === 'string'
        ? `écoulement ${proche.attributes.Persistanc}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    points.push({
      sujet,
      verdict: qualifieParLeZonage ? 'alerte' : 'indetermine',
      detail: qualifieParLeZonage
        ? `${quoi} se trouve à ${proche.distanceM.toFixed(0)} m du contour de la ` +
          `parcelle, pour ${exigee} m exigés (${reference}).`
        : `${quoi} se trouve à ${proche.distanceM.toFixed(0)} m du contour de la ` +
          `parcelle, pour ${exigee} m exigés (${reference}). BD TOPAGE localise ` +
          'les écoulements mais ne dit pas lesquels sont des cours d’eau au sens ' +
          'de l’arrêté : à vérifier sur la cartographie départementale des cours ' +
          'd’eau. La mesure part du contour, pas du point d’épandage.',
      source,
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

type RegleLue = { value: unknown; exception: string | null; source: string; conditionnee: boolean };

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
    conditionnee:
      r.condition !== null &&
      typeof r.condition === 'object' &&
      Object.keys(r.condition as Record<string, unknown>).some((k) => k !== 'zone'),
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

