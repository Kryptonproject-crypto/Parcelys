import 'server-only';
import type { CoverDestructionMethod, SoilCoverKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getOrComputeParcelContext,
  plusProches,
  NATURES_HYDROGRAPHIQUES,
  statutZonage,
  territoiresDeLaParcelle,
} from '@/lib/regulatory/geography';
import { lireRegles, regleDe, type LectureRegles, type Trace } from '@/lib/regulatory/regles';
import {
  compositionCouvert,
  cultureReglementaire,
  type CultureReglementaire,
} from '@/lib/regulatory/culture-reglementaire';
import { classementDuProduit, type ClassementProduit } from '@/lib/regulatory/classement-produit';

/**
 * Le 7e programme d'actions régional, appliqué aux apports et aux couverts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D'OÙ VIENNENT LES RÈGLES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * De la base : la transcription de l'arrêté n° 24-135 modifié, importée avec
 * son territoire et sa date d'entrée en vigueur (`data/referentiels-aura/
 * transcriptions/par7-aura.json`). Aucune date, aucun plafond, aucune durée
 * n'est écrit dans ce fichier : il lit la règle, regarde si sa condition est
 * remplie par ce que l'exploitant a saisi, et rend un verdict **avec la trace
 * de la règle**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUATRE VERDICTS, ET CE QUI LES SÉPARE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  · `ok`           — la règle s'applique, et les données la respectent ;
 *  · `alerte`       — la règle s'applique, et les données ne la respectent
 *                     pas. Les exceptions écrites dans le texte sont citées :
 *                     c'est à l'exploitant de justifier celle dont il relève ;
 *  · `verification` — la règle s'applique peut-être (zone d'actions renforcée
 *                     reconstituée, stade de la culture inconnu…) : un regard
 *                     humain tranche ;
 *  · `indetermine`  — une donnée manque, et l'on dit laquelle. Jamais « ok ».
 *
 * `sans-objet` : la règle ne vise pas cette situation (hors zone vulnérable,
 * produit non concerné). Ce n'est pas un « ok » : c'est une règle qui ne
 * s'applique pas, et on le dit.
 */

export type VerdictRegle = 'ok' | 'alerte' | 'verification' | 'indetermine' | 'sans-objet';

export type ControleRegle = {
  sujet: string;
  verdict: VerdictRegle;
  detail: string;
  /** La règle opposée — `null` quand aucune ne l'est, et c'est alors le constat. */
  trace: Trace | null;
};

const REFERENTIEL_PAR = 'programme-actions-nitrates';
const REFERENTIEL_GREN = 'gren';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `MM-JJ` d'une date, en temps universel (les dates saisies sont des jours). */
export function jourDe(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Le jour `MM-JJ` tombe-t-il entre `du` et `au`, bornes comprises ? */
export function entreJours(jour: string, du: string, au: string): boolean {
  if (du <= au) return jour >= du && jour <= au;
  return jour >= du || jour <= au;
}

function dateFr(date: Date): string {
  return date.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
}

function jours(debut: Date, fin: Date): number {
  return Math.round((fin.getTime() - debut.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// La situation d'une parcelle à une date
// ---------------------------------------------------------------------------

type CultureEnregistree = {
  id: string;
  campaignYear: number;
  nom: string;
  semis: Date | null;
  recolte: Date | null;
  recolteSource: 'réalisée' | 'prévue' | null;
  reglementaire: CultureReglementaire;
};

type CouvertEnregistre = {
  id: string;
  kind: SoilCoverKind;
  species: string | null;
  sownOn: Date | null;
  destroyedOn: Date | null;
  destructionMethod: CoverDestructionMethod | null;
  areaHa: number | null;
};

export type Situation = {
  parcelId: string;
  parcelName: string;
  date: Date;
  zv: 'dedans' | 'dehors' | 'indetermine';
  zar: {
    statut: 'dedans' | 'dehors' | 'indetermine';
    /** Le périmètre est-il reconstitué (AAC) plutôt que publié ? */
    reconstitue: boolean;
    captages: string[];
  };
  territoires: string[];
  par: LectureRegles;
  gren: LectureRegles;
  cultures: CultureEnregistree[];
  couverts: CouvertEnregistre[];
};

/**
 * Lectures de règles déjà faites pendant un même calcul. Un rapport de
 * campagne lit les mêmes règles pour des centaines d'apports : sur un
 * Raspberry Pi, les relire à chaque fois se compte en secondes.
 */
export type CacheRegles = Map<string, Promise<LectureRegles>>;

function lireReglesEnCache(
  cache: CacheRegles | undefined,
  referentiel: string,
  territoires: string[],
  date: Date,
): Promise<LectureRegles> {
  const cle = `${referentiel}|${territoires.join(',')}|${date.toISOString().slice(0, 10)}`;
  const deja = cache?.get(cle);
  if (deja) return deja;
  const lecture = lireRegles({ referentiel, territoires, at: date });
  cache?.set(cle, lecture);
  return lecture;
}

export async function situationParcelle(
  parcelId: string,
  date: Date,
  cache?: CacheRegles,
): Promise<Situation> {
  const parcelle = await prisma.parcel.findUniqueOrThrow({
    where: { id: parcelId },
    select: { id: true, name: true },
  });
  const contexte = await getOrComputeParcelContext(parcelId).catch(() => null);
  const territoires = await territoiresDeLaParcelle(parcelId);

  const zarZones = (contexte?.zones ?? []).filter((z) => z.kind === 'ZONE_ACTION_RENFORCEE');
  const [par, gren, cultures, couverts] = await Promise.all([
    lireReglesEnCache(cache, REFERENTIEL_PAR, territoires, date),
    lireReglesEnCache(cache, REFERENTIEL_GREN, territoires, date),
    prisma.cropYear.findMany({
      where: { parcelId },
      select: {
        id: true,
        campaignYear: true,
        sowingDate: true,
        expectedHarvestDate: true,
        actualHarvestDate: true,
        crop: { select: { name: true, category: true } },
      },
      orderBy: { campaignYear: 'asc' },
    }),
    prisma.soilCover.findMany({
      where: { parcelId },
      select: {
        id: true,
        kind: true,
        species: true,
        sownOn: true,
        destroyedOn: true,
        destructionMethod: true,
        areaHa: true,
      },
      orderBy: { sownOn: 'asc' },
    }),
  ]);

  return {
    parcelId,
    parcelName: parcelle.name,
    date,
    zv: statutZonage(contexte, 'ZONE_VULNERABLE', date),
    zar: {
      statut: statutZonage(contexte, 'ZONE_ACTION_RENFORCEE', date),
      reconstitue: zarZones.some((z) => z.attributes?.reconstitue === true),
      captages: [...new Set(zarZones.map((z) => String(z.attributes?.captage ?? z.label)))],
    },
    territoires,
    par,
    gren,
    cultures: cultures.map((c) => ({
      id: c.id,
      campaignYear: c.campaignYear,
      nom: c.crop.name,
      semis: c.sowingDate,
      recolte: c.actualHarvestDate ?? c.expectedHarvestDate,
      recolteSource: c.actualHarvestDate ? 'réalisée' : c.expectedHarvestDate ? 'prévue' : null,
      reglementaire: cultureReglementaire({
        nom: c.crop.name,
        categorie: c.crop.category,
        semis: c.sowingDate,
      }),
    })),
    couverts: couverts.map((c) => ({ ...c, areaHa: c.areaHa === null ? null : Number(c.areaHa) })),
  };
}

/** Le couvert en place à cette date, s'il y en a un d'enregistré. */
function couvertEnPlace(situation: Situation): CouvertEnregistre | null {
  return (
    situation.couverts.find(
      (c) =>
        c.sownOn !== null &&
        c.sownOn <= situation.date &&
        (c.destroyedOn === null || c.destroyedOn >= situation.date),
    ) ?? null
  );
}

/**
 * CINE ou CIE, selon la définition de l'annexe 2.A du PAR7 : un couvert
 * « récolté, fauché ou pâturé » est exporté ; sinon il ne l'est pas.
 */
export function typeDeCouvert(c: Pick<CouvertEnregistre, 'kind' | 'destructionMethod'>): 'CINE' | 'CIE' | null {
  if (c.kind === 'DEROBEE') return 'CIE';
  if (c.destructionMethod === 'RECOLTE' || c.destructionMethod === 'PATURAGE') return 'CIE';
  if (c.kind === 'CIPAN' || c.kind === 'REPOUSSES') return 'CINE';
  return null;
}

/** La culture en place à cette date (semée, pas encore récoltée), si connue. */
function cultureEnPlace(situation: Situation): CultureEnregistree | null {
  return (
    situation.cultures.find(
      (c) => c.semis !== null && c.semis <= situation.date && (c.recolte === null || c.recolte >= situation.date),
    ) ?? null
  );
}

/** La prochaine culture semée après cette date, si elle est connue. */
function prochaineCulture(situation: Situation): CultureEnregistree | null {
  return situation.cultures.find((c) => c.semis !== null && c.semis > situation.date) ?? null;
}

// ---------------------------------------------------------------------------
// Ce que le contrôle sait d'un apport
// ---------------------------------------------------------------------------

export type ApportAControler = {
  /** Pour l'exclure des cumuls quand il est déjà enregistré. */
  id?: string | null;
  parcelId: string;
  date: Date;
  nature: 'MINERAL' | 'ORGANIC';
  libelle: string;
  /** Azote total apporté, kg N/ha de surface traitée. `null` : teneur inconnue. */
  azoteTotalKgHa: number | null;
  classement: ClassementProduit;
  cropYearId?: string | null;
};

const SAISONS_APLSH: Record<number, 'ete' | 'automne' | undefined> = {
  7: 'ete',
  8: 'ete',
  9: 'automne',
  10: 'automne',
  11: 'automne',
};

/**
 * Azote potentiellement libéré jusqu'en sortie d'hiver, en kg N/ha.
 *
 * Coefficient de la fiche GREN 19 pour le produit déclaré et la saison de
 * l'apport ; à défaut de coefficient, le PAR7 (art. 2, I, 4°) prescrit l'azote
 * efficace — c'est-à-dire, pour un engrais minéral, son azote. Sans l'un ni
 * l'autre : `null`, et la raison.
 *
 * La saison « été » est celle que la fiche définit (juillet-août). « Automne »
 * n'y est pas daté : Parcelys n'y range que septembre, octobre et novembre, et
 * ne calcule rien pour les autres mois.
 */
export function azotePotentiellementLibere(
  apport: ApportAControler,
  gren: LectureRegles,
  par: LectureRegles,
): { kgHa: number | null; detail: string; trace: Trace | null } {
  if (apport.azoteTotalKgHa === null) {
    return { kgHa: null, detail: `${apport.libelle} : teneur en azote inconnue`, trace: null };
  }
  if (apport.nature === 'MINERAL') {
    const regle = regleDe(par, 'azote-potentiellement-libere');
    return {
      kgHa: apport.azoteTotalKgHa,
      detail: `${apport.libelle} : ${apport.azoteTotalKgHa.toFixed(0)} kg N minéral (azote efficace, faute de coefficient pour un engrais minéral)`,
      trace: regle?.trace ?? null,
    };
  }
  const regle = regleDe(gren, 'gren-aplsh');
  const saison = SAISONS_APLSH[apport.date.getUTCMonth() + 1];
  const produits = (regle?.valeur.produits as Array<{ code: string; libelle: string; ete: number; automne: number }> | undefined) ?? [];
  const produit = produits.find((p) => p.code === apport.classement.aplsh);
  if (!regle) {
    return { kgHa: null, detail: `${apport.libelle} : coefficients d’azote potentiellement libéré non disponibles à cette date (${gren.raison ?? 'fiche GREN 19'})`, trace: null };
  }
  if (!apport.classement.aplsh || !produit) {
    return { kgHa: null, detail: `${apport.libelle} : dénomination « azote potentiellement libéré » de la fiche 19 non déclarée sur le produit`, trace: regle.trace };
  }
  if (!saison) {
    return { kgHa: null, detail: `${apport.libelle} : la fiche 19 ne donne de coefficient que pour les apports d’été (juillet-août) et d’automne`, trace: regle.trace };
  }
  const pct = produit[saison];
  const kgHa = (apport.azoteTotalKgHa * pct) / 100;
  return {
    kgHa,
    detail: `${apport.libelle} : ${apport.azoteTotalKgHa.toFixed(0)} kg N total × ${pct} % (${produit.libelle}, apport ${saison === 'ete' ? 'd’été' : 'd’automne'}) = ${kgHa.toFixed(1)} kg N`,
    trace: regle.trace,
  };
}

// ---------------------------------------------------------------------------
// Les contrôles d'un apport
// ---------------------------------------------------------------------------

function horsZv(situation: Situation, sujet: string): ControleRegle | null {
  if (situation.zv === 'dehors') {
    return {
      sujet,
      verdict: 'sans-objet',
      detail: 'Parcelle hors zone vulnérable : le programme d’actions régional ne s’y applique pas.',
      trace: null,
    };
  }
  if (situation.par.regles.length === 0) {
    return { sujet, verdict: 'indetermine', detail: situation.par.raison ?? 'Programme d’actions non disponible.', trace: null };
  }
  return null;
}

/** Qualifie un verdict d'alerte quand l'applicabilité elle-même est incertaine. */
function selonZonage(
  situation: Situation,
  verdict: VerdictRegle,
  zone: 'zv' | 'zar',
): { verdict: VerdictRegle; mention: string } {
  if (verdict !== 'alerte') return { verdict, mention: '' };
  if (zone === 'zv' && situation.zv === 'indetermine') {
    return { verdict: 'verification', mention: ' L’appartenance de la parcelle à la zone vulnérable n’est pas établie : la règle s’applique si elle y est.' };
  }
  if (zone === 'zar') {
    if (situation.zar.statut === 'indetermine') {
      return { verdict: 'verification', mention: ' L’appartenance à la zone d’actions renforcée n’est pas établie (périmètre non fourni) : la règle s’applique si la parcelle y est.' };
    }
    if (situation.zar.reconstitue) {
      return { verdict: 'verification', mention: ' Le périmètre de la ZAR est reconstitué à partir de l’aire d’alimentation du captage ; la cartographie de la DREAL fait foi.' };
    }
  }
  return { verdict, mention: '' };
}

/** Allongement régional de la période d'interdiction (type III, 15-28 février). */
export function controlePeriode(apport: ApportAControler, situation: Situation): ControleRegle {
  const sujet = 'Période d’épandage';
  const prealable = horsZv(situation, sujet);
  if (prealable) return prealable;

  const regle = regleDe(situation.par, 'periode-interdiction-epandage');
  const nationales =
    'Les périodes d’interdiction nationales (annexe I de l’arrêté du 30 janvier 2023) ne sont pas fournies : elles ne sont pas contrôlées.';
  if (!regle) {
    return { sujet, verdict: 'indetermine', detail: `Aucune période régionale chargée. ${nationales}`, trace: null };
  }

  const types = (regle.condition?.typesFertilisant as string[] | undefined) ?? [];
  const periodes = (regle.valeur.periodes as Array<{ du: string; au: string }> | undefined) ?? [];
  const jour = jourDe(apport.date);
  const dansPeriode = periodes.find((p) => entreJours(jour, p.du, p.au));

  if (!dansPeriode) {
    return {
      sujet,
      verdict: 'indetermine',
      detail: `Le ${dateFr(apport.date)} est hors de l’allongement régional (${periodes.map((p) => `${p.du} → ${p.au}`).join(', ')}). ${nationales}`,
      trace: regle.trace,
    };
  }
  if (apport.classement.typePan === null) {
    return {
      sujet,
      verdict: 'indetermine',
      detail: `Le ${dateFr(apport.date)} tombe dans l’allongement régional, qui vise les fertilisants de type ${types.join(', ')} : le type de « ${apport.libelle} » n’est pas déclaré.`,
      trace: regle.trace,
    };
  }
  if (!types.includes(apport.classement.typePan)) {
    return {
      sujet,
      verdict: 'indetermine',
      detail: `L’allongement régional ne vise que le type ${types.join(', ')} ; « ${apport.libelle} » est de type ${apport.classement.typePan}. ${nationales}`,
      trace: regle.trace,
    };
  }

  // La culture visée : « implantée dans l'année en cours en hiver ou au
  // printemps et récoltée avant la fin de l'année ».
  const annee = apport.date.getUTCFullYear();
  const finAnnee = new Date(Date.UTC(annee, 11, 31, 23, 59, 59));
  const candidates = situation.cultures.filter(
    (c) => (c.semis && c.semis.getUTCFullYear() === annee) || (!c.semis && (c.campaignYear === annee || c.campaignYear === annee + 1)),
  );
  const visee = candidates.find(
    (c) => c.semis && c.semis.getUTCMonth() <= 5 && c.recolte !== null && c.recolte <= finAnnee,
  );
  if (visee) {
    const { verdict, mention } = selonZonage(situation, 'alerte', 'zv');
    return {
      sujet,
      verdict,
      detail:
        `Épandage de type III le ${dateFr(apport.date)}, avant « ${visee.nom} » semée le ${dateFr(visee.semis!)} ` +
        `et récoltée le ${dateFr(visee.recolte!)} (${visee.recolteSource}) : interdit du ${dansPeriode.du} au ${dansPeriode.au}.` +
        (regle.exception ? ` Exception publiée : ${regle.exception}` : '') +
        mention,
      trace: regle.trace,
    };
  }
  const recolteInconnue = candidates.find((c) => c.semis && c.semis.getUTCMonth() <= 5 && c.recolte === null);
  if (recolteInconnue) {
    return {
      sujet,
      verdict: 'verification',
      detail:
        `Épandage de type III le ${dateFr(apport.date)}, avant « ${recolteInconnue.nom} » semée le ${dateFr(recolteInconnue.semis!)} : ` +
        'si elle est récoltée avant la fin de l’année, l’apport tombe dans la période d’interdiction. La date de récolte n’est pas renseignée.',
      trace: regle.trace,
    };
  }
  const enPlace = cultureEnPlace(situation);
  if (candidates.length === 0 && enPlace?.semis) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        `« ${enPlace.nom} », semée le ${dateFr(enPlace.semis)}, n’est pas implantée dans l’année de l’apport : ` +
        `l’allongement régional du ${dansPeriode.du} au ${dansPeriode.au} ne la vise pas. ${nationales}`,
      trace: regle.trace,
    };
  }
  const sansSemis = candidates.find((c) => !c.semis);
  if (sansSemis || candidates.length === 0) {
    return {
      sujet,
      verdict: 'indetermine',
      detail:
        `Le ${dateFr(apport.date)} tombe dans l’allongement régional, qui ne vise que les cultures implantées dans l’année en hiver ou au printemps et récoltées avant la fin de l’année : ` +
        (sansSemis ? `la date de semis de « ${sansSemis.nom} » n’est pas renseignée.` : 'aucune culture n’est enregistrée pour cette année.'),
      trace: regle.trace,
    };
  }
  return {
    sujet,
    verdict: 'indetermine',
    detail: `Les cultures enregistrées ne sont pas visées par l’allongement régional du ${dansPeriode.du} au ${dansPeriode.au}. ${nationales}`,
    trace: regle.trace,
  };
}

/** Fractionnement des fertilisants de type III. */
export async function controleFractionnement(apport: ApportAControler, situation: Situation): Promise<ControleRegle> {
  const sujet = 'Fractionnement (type III)';
  if (apport.classement.typePan !== 'III') {
    return { sujet, verdict: 'sans-objet', detail: 'La règle ne vise que les fertilisants de type III.', trace: null };
  }
  const prealable = horsZv(situation, sujet);
  if (prealable) return prealable;
  const regle = regleDe(situation.par, 'fractionnement-type-iii');
  if (!regle) return { sujet, verdict: 'indetermine', detail: 'Règle de fractionnement non chargée.', trace: null };
  if (apport.azoteTotalKgHa === null) {
    return { sujet, verdict: 'indetermine', detail: `Teneur en azote de « ${apport.libelle} » inconnue : la dose apportée n’est pas chiffrable.`, trace: regle.trace };
  }
  const dose = apport.azoteTotalKgHa;
  const max = Number(regle.valeur.maxParApport);
  const adaptations = (regle.valeur.adaptations as Array<Record<string, unknown>> | undefined) ?? [];
  const lente = adaptations.find((a) => a.cas === 'engrais-liberation-progressive');
  const maxLente = lente ? Number(lente.maxParApport) : null;
  const maisAvant = adaptations.find((a) => a.cas === 'mais-seme-avant-15-mai');

  const culture = situation.cultures.find((c) => c.id === apport.cropYearId) ?? cultureEnPlace(situation) ?? prochaineCulture(situation);
  const famille = culture?.reglementaire.famille ?? null;

  if (famille === 'mais' && maisAvant) {
    const limite = String(maisAvant.semisAvant);
    const premierMax = Number(maisAvant.premierApportMax);
    if (!culture?.semis) {
      return { sujet, verdict: dose > premierMax ? 'indetermine' : 'ok', detail: `Maïs : la limite du premier apport (${premierMax} u jusqu’au stade deux feuilles) dépend d’un semis avant le ${limite.split('-').reverse().join('/')} ; la date de semis n’est pas renseignée.`, trace: regle.trace };
    }
    const semisAvant = jourDe(culture.semis) < limite;
    if (!semisAvant) {
      return { sujet, verdict: 'ok', detail: `Maïs semé le ${dateFr(culture.semis)} : la dose par apport n’est pas limitée.`, trace: regle.trace };
    }
    const precedents = await prisma.fertilizerApplication.count({
      where: {
        parcelId: apport.parcelId,
        inputType: 'MINERAL',
        appliedOn: { gte: culture.semis, lt: apport.date },
        ...(apport.id ? { id: { not: apport.id } } : {}),
      },
    });
    if (precedents > 0) {
      return { sujet, verdict: 'ok', detail: 'Maïs : seul le premier apport est limité, et celui-ci n’est pas le premier.', trace: regle.trace };
    }
    return {
      sujet,
      verdict: dose > premierMax ? 'verification' : 'ok',
      detail:
        dose > premierMax
          ? `Maïs semé le ${dateFr(culture.semis)} (avant le 15 mai) : premier apport de ${dose.toFixed(0)} u, pour ${premierMax} u au plus jusqu’au stade deux feuilles. Le stade à la date de l’apport n’est pas enregistré.`
          : `Premier apport de ${dose.toFixed(0)} u sur maïs semé avant le 15 mai, sous la limite de ${premierMax} u.`,
      trace: regle.trace,
    };
  }

  if (dose <= max) {
    return { sujet, verdict: 'ok', detail: `${dose.toFixed(0)} u d’azote par apport, pour ${max} u au plus.`, trace: regle.trace };
  }
  if (famille === null) {
    return {
      sujet,
      verdict: 'verification',
      detail: `${dose.toFixed(0)} u en un apport (plus de ${max} u). La limite ne vaut pas pour le maïs semé après le 15 mai ; la culture n’est pas reconnue (${culture?.reglementaire.preuve ?? 'aucune culture enregistrée'}).`,
      trace: regle.trace,
    };
  }
  if (maxLente !== null && dose <= maxLente) {
    const { verdict, mention } = selonZonage(situation, 'verification', 'zv');
    return {
      sujet,
      verdict,
      detail: `${dose.toFixed(0)} u en un apport : au-delà de ${max} u, seul un engrais à libération progressive ou contrôlée est admis (jusqu’à ${maxLente} u). Vérifiez la nature de « ${apport.libelle} ».${mention}`,
      trace: regle.trace,
    };
  }
  const { verdict, mention } = selonZonage(situation, 'alerte', 'zv');
  return {
    sujet,
    verdict,
    detail: `${dose.toFixed(0)} u d’azote en un seul apport, pour ${max} u au plus par apport (${maxLente ?? max} u pour un engrais à libération progressive).${mention}`,
    trace: regle.trace,
  };
}

/** Apport sur couvert d'interculture : interdictions et plafonds. */
export async function controleCouvert(apport: ApportAControler, situation: Situation): Promise<ControleRegle[]> {
  const couvert = couvertEnPlace(situation);
  if (!couvert) return [];
  const sujetBase = 'Apport sur couvert d’interculture';
  const prealable = horsZv(situation, sujetBase);
  if (prealable) return [prealable];

  const type = typeDeCouvert(couvert);
  const composition = compositionCouvert(couvert.species);
  const resultats: ControleRegle[] = [];
  const intitule = `${type ?? 'couvert'} semé le ${dateFr(couvert.sownOn!)}${couvert.species ? ` (${couvert.species})` : ''}`;

  if (!type) {
    return [{ sujet: sujetBase, verdict: 'indetermine', detail: `Couvert « ${couvert.kind} » en place : exporté (CIE) ou non (CINE) ? Le type de couvert ne le dit pas.`, trace: null }];
  }

  // ZAR : aucun épandage sur CINE.
  if (type === 'CINE' && situation.zar.statut !== 'dehors') {
    const regle = regleDe(situation.par, 'zar-cine-epandage-interdit');
    if (regle) {
      const { verdict, mention } = selonZonage(situation, 'alerte', 'zar');
      resultats.push({
        sujet: 'ZAR — épandage sur CINE',
        verdict,
        detail: `Épandage le ${dateFr(apport.date)} sur un ${intitule} : les épandages sur CINE sont interdits en zone d’actions renforcée (${situation.zar.captages.join(', ')}).${mention}`,
        trace: regle.trace,
      });
    }
  }

  const code = type === 'CINE' ? 'apports-cine' : 'apports-cie';
  const regle = regleDe(situation.par, code);
  if (!regle) return [...resultats, { sujet: sujetBase, verdict: 'indetermine', detail: `Règle « ${code} » non chargée.`, trace: null }];

  // Légumineuses pures : interdit.
  if (composition.legumineusesPures === true) {
    const { verdict, mention } = selonZonage(situation, 'alerte', 'zv');
    resultats.push({ sujet: `${sujetBase} — légumineuses pures`, verdict, detail: `Apport sur un ${intitule} : interdit sur les légumineuses pures utilisées en ${type}.${mention}`, trace: regle.trace });
    return resultats;
  }
  if (composition.legumineusesPures === null) {
    resultats.push({ sujet: `${sujetBase} — légumineuses pures`, verdict: 'verification', detail: `Les espèces du ${type} ne sont pas saisies : l’apport est interdit si ce sont des légumineuses pures.`, trace: regle.trace });
  }

  // Plafond d'azote potentiellement libéré, cumulé sur le couvert.
  const apportsCouvert = await prisma.fertilizerApplication.findMany({
    where: {
      parcelId: apport.parcelId,
      appliedOn: { gte: couvert.sownOn!, ...(couvert.destroyedOn ? { lte: couvert.destroyedOn } : {}) },
      ...(apport.id ? { id: { not: apport.id } } : {}),
    },
    select: {
      id: true,
      appliedOn: true,
      inputType: true,
      productLabel: true,
      nSupplied: true,
      fertilizer: { select: { nPercent: true } },
      organicInput: { select: { regulatoryClass: true } },
    },
  });
  const tous: ApportAControler[] = [
    ...apportsCouvert.map((a) => ({
      id: a.id,
      parcelId: apport.parcelId,
      date: a.appliedOn,
      nature: a.inputType === 'MINERAL' ? ('MINERAL' as const) : ('ORGANIC' as const),
      libelle: a.productLabel,
      azoteTotalKgHa: a.nSupplied === null ? null : Number(a.nSupplied),
      classement: classementDuProduit({
        inputType: a.inputType,
        nPercent: a.fertilizer?.nPercent === undefined || a.fertilizer?.nPercent === null ? null : Number(a.fertilizer.nPercent),
        regulatoryClass: a.organicInput?.regulatoryClass ?? null,
      }),
    })),
    apport,
  ];

  const plafonds = (regle.valeur.plafonds as Array<{ cas: string; kgHa: number; cumulTypes?: string[] }> | undefined) ?? [];
  let candidats: Array<{ cas: string; kgHa: number; cumulTypes: string[] }> = [];
  if (type === 'CINE') {
    const general = plafonds.find((p) => p.cas === 'general');
    const captation = plafonds.find((p) => p.cas === 'bonne-captation');
    const repousses = couvert.kind === 'REPOUSSES';
    const repoussesGraminees = repousses && composition.gramineesPures !== false && composition.especes.length > 0 ? composition.gramineesPures : null;
    if (!repousses && captation) candidats = [{ ...captation, cumulTypes: captation.cumulTypes ?? [] }];
    else if (repoussesGraminees === true && general) candidats = [{ ...general, cumulTypes: general.cumulTypes ?? [] }];
    else if (general && captation) candidats = [{ ...general, cumulTypes: general.cumulTypes ?? [] }, { ...captation, cumulTypes: captation.cumulTypes ?? [] }];
  } else {
    candidats = plafonds.map((p) => ({ ...p, cumulTypes: p.cumulTypes ?? [] }));
  }
  if (candidats.length === 0) return [...resultats, { sujet: sujetBase, verdict: 'indetermine', detail: 'Plafonds non lus dans la règle.', trace: regle.trace }];

  const calculs = tous.map((a) => ({ a, n: azotePotentiellementLibere(a, situation.gren, situation.par) }));
  const plafondMin = Math.min(...candidats.map((c) => c.kgHa));
  const plafondMax = Math.max(...candidats.map((c) => c.kgHa));
  const typesMin = candidats.reduce<string[]>((acc, c) => acc.filter((t) => c.cumulTypes.includes(t)), candidats[0]!.cumulTypes);
  const typesMax = [...new Set(candidats.flatMap((c) => c.cumulTypes))];

  const somme = (types: string[]) => {
    let total = 0;
    const inconnus: string[] = [];
    for (const { a, n } of calculs) {
      if (a.classement.typePan === null) {
        inconnus.push(`${a.libelle} : type de fertilisant non déclaré`);
        continue;
      }
      if (!types.includes(a.classement.typePan)) continue;
      if (n.kgHa === null) inconnus.push(n.detail);
      else total += n.kgHa;
    }
    return { total, inconnus };
  };
  const bas = somme(typesMin);
  const haut = somme(typesMax);
  const lignes = calculs.map((c) => c.n.detail).join(' ; ');
  const traceRegle = regle.trace;

  if (bas.total > plafondMax) {
    const { verdict, mention } = selonZonage(situation, 'alerte', 'zv');
    resultats.push({
      sujet: `${sujetBase} — plafond`,
      verdict,
      detail: `Sur le ${intitule} : au moins ${bas.total.toFixed(1)} kg N potentiellement libéré jusqu’en sortie d’hiver, pour ${plafondMax} kg/ha au plus (${lignes}).${mention}`,
      trace: traceRegle,
    });
  } else if (haut.inconnus.length === 0 && haut.total <= plafondMin) {
    resultats.push({ sujet: `${sujetBase} — plafond`, verdict: 'ok', detail: `Sur le ${intitule} : ${haut.total.toFixed(1)} kg N potentiellement libéré, pour ${plafondMin} kg/ha au plus (${lignes}).`, trace: traceRegle });
  } else if (haut.inconnus.length > 0) {
    resultats.push({ sujet: `${sujetBase} — plafond`, verdict: 'indetermine', detail: `Cumul sur le ${intitule} non chiffrable : ${haut.inconnus.join(' ; ')}.`, trace: traceRegle });
  } else {
    resultats.push({
      sujet: `${sujetBase} — plafond`,
      verdict: 'verification',
      detail: `Sur le ${intitule} : ${bas.total.toFixed(1)} à ${haut.total.toFixed(1)} kg N potentiellement libéré, entre les plafonds de ${plafondMin} et ${plafondMax} kg/ha ; le cas applicable (${type === 'CINE' ? 'couvert issu de repousses de graminées ou non' : 'interculture courte ou longue, récolte l’année d’implantation ou la suivante'}) ne se lit pas dans les données.`,
      trace: traceRegle,
    });
  }
  return resultats;
}

/** Digestats phase liquide sur sol nu, en zone vulnérable et en ZAR ; et en septembre. */
export function controleDigestat(apport: ApportAControler, situation: Situation): ControleRegle[] {
  const liquide = apport.classement.aplsh === 'digestats-fraction-liquide';
  if (!liquide) {
    if (apport.nature === 'ORGANIC' && !apport.classement.aplsh && /digestat/i.test(apport.libelle)) {
      return [{ sujet: 'Digestat', verdict: 'indetermine', detail: `« ${apport.libelle} » : brut, phase liquide ou phase solide ? La dénomination de la fiche 19 n’est pas déclarée sur le produit, et les règles du PAR7 sur la phase liquide en dépendent.`, trace: null }];
    }
    return [];
  }
  const prealable = horsZv(situation, 'Digestat phase liquide');
  if (prealable) return [prealable];

  const resultats: ControleRegle[] = [];
  const enPlace = cultureEnPlace(situation);
  const couvert = couvertEnPlace(situation);
  const solNu = !enPlace && !couvert;
  const jour = jourDe(apport.date);

  const regle = regleDe(situation.par, 'digestat-liquide-sol-nu');
  if (regle && jour >= '01-01' && jour <= String(regle.valeur.interditJusquAu)) {
    if (!solNu) {
      resultats.push({ sujet: 'Digestat phase liquide sur sol nu', verdict: 'ok', detail: `Apport sur ${enPlace ? `« ${enPlace.nom} » en place` : 'couvert en place'} : la restriction ne vise que le sol nu.`, trace: regle.trace });
    } else {
      const fevrier = apport.date.getUTCMonth() === 1;
      const { verdict, mention } = selonZonage(situation, fevrier ? 'alerte' : 'verification', 'zv');
      resultats.push({
        sujet: 'Digestat phase liquide sur sol nu',
        verdict,
        detail:
          `Apport le ${dateFr(apport.date)} sans culture ni couvert enregistré en place : en sortie d’hiver, la phase liquide des digestats est interdite sur sol nu jusqu’au 28 février.` +
          (fevrier ? '' : ' En janvier, la règle régionale porte sur la « sortie d’hiver » : les périodes nationales (non fournies) tranchent.') +
          mention,
        trace: regle.trace,
      });
    }
  }

  const regleZar = regleDe(situation.par, 'zar-digestat-liquide-sol-nu');
  if (regleZar && situation.zar.statut !== 'dehors' && solNu && apport.date.getUTCMonth() <= 5) {
    const apartir = String(regleZar.valeur.autoriseAPartirDu);
    const maxJours = Number(regleZar.valeur.joursMaxAvantSemis);
    const prochaine = prochaineCulture(situation);
    let verdict: VerdictRegle;
    let detail: string;
    if (jour < apartir) {
      verdict = 'alerte';
      detail = `Apport le ${dateFr(apport.date)} sur sol nu : en ZAR, la phase liquide des digestats n’est autorisée qu’à partir du 28 février.`;
    } else if (!prochaine?.semis) {
      verdict = 'verification';
      detail = `En ZAR, l’apport sur sol nu doit précéder le semis de ${maxJours} jours au plus : la date de semis suivante n’est pas enregistrée.`;
    } else {
      const ecart = jours(apport.date, prochaine.semis);
      verdict = ecart > maxJours ? 'alerte' : 'ok';
      detail = `Apport ${ecart} jour(s) avant le semis de « ${prochaine.nom} » (${dateFr(prochaine.semis)}), pour ${maxJours} au plus en ZAR.`;
    }
    const q = selonZonage(situation, verdict, 'zar');
    resultats.push({ sujet: 'ZAR — digestat phase liquide sur sol nu', verdict: q.verdict, detail: detail + q.mention, trace: regleZar.trace });
  }

  const regleSept = regleDe(situation.par, 'digestat-liquide-septembre');
  if (regleSept && apport.date.getUTCMonth() === 8) {
    const suivante = prochaineCulture(situation) ?? cultureEnPlace(situation);
    const kg = azotePotentiellementLibere(apport, situation.gren, situation.par);
    const plafond = Number(regleSept.valeur.kgHa);
    if (!suivante) {
      resultats.push({ sujet: 'Digestat phase liquide en septembre', verdict: 'indetermine', detail: 'La culture qui suit n’est pas enregistrée : la limite de septembre vise les cultures principales récoltées l’année suivante, hors colza.', trace: regleSept.trace });
    } else if (suivante.reglementaire.famille === 'colza') {
      resultats.push({ sujet: 'Digestat phase liquide en septembre', verdict: 'sans-objet', detail: 'Culture suivante : colza, exclu de la limite de septembre.', trace: regleSept.trace });
    } else if (suivante.reglementaire.famille === null) {
      resultats.push({ sujet: 'Digestat phase liquide en septembre', verdict: 'indetermine', detail: `Culture suivante non reconnue (le colza est exclu de la limite) : ${suivante.reglementaire.preuve}.`, trace: regleSept.trace });
    } else if (kg.kgHa === null) {
      resultats.push({ sujet: 'Digestat phase liquide en septembre', verdict: 'indetermine', detail: kg.detail, trace: regleSept.trace });
    } else {
      const q = selonZonage(situation, kg.kgHa > plafond ? 'alerte' : 'ok', 'zv');
      resultats.push({ sujet: 'Digestat phase liquide en septembre', verdict: q.verdict, detail: `${kg.detail}, pour ${plafond} kg N/ha au plus en septembre avant « ${suivante.nom} ».${q.mention}`, trace: regleSept.trace });
    }
  }
  return resultats;
}

/** ZAR : plafonnement du premier apport sur céréales à paille d'hiver et colza d'hiver. */
export async function controlePremierApportZar(apport: ApportAControler, situation: Situation): Promise<ControleRegle | null> {
  if (situation.zar.statut === 'dehors' || situation.zv === 'dehors') return null;
  const regle = regleDe(situation.par, 'zar-plafond-premier-apport');
  if (!regle) return null;
  const culture = situation.cultures.find((c) => c.id === apport.cropYearId) ?? cultureEnPlace(situation);
  if (!culture) return null;
  const r = culture.reglementaire;
  const cle = r.famille === 'cereale-paille' && r.saison === 'hiver' ? 'cereales-paille-hiver' : r.famille === 'colza' && r.saison === 'hiver' ? 'colza-hiver' : null;
  if (!cle) return null;
  const ligne = (regle.valeur.cultures as Array<{ culture: string; libelle: string; kgHa: number; jusquAuStade: string }>).find((c) => c.culture === cle);
  if (!ligne || !culture.semis) return null;

  const precedents = await prisma.fertilizerApplication.count({
    where: { parcelId: apport.parcelId, appliedOn: { gte: culture.semis, lt: apport.date }, ...(apport.id ? { id: { not: apport.id } } : {}) },
  });
  if (precedents > 0) return null;

  let efficace: number | null = null;
  let comment = '';
  if (apport.nature === 'MINERAL') {
    efficace = apport.azoteTotalKgHa;
    comment = 'azote minéral';
  } else {
    comment = 'azote efficace d’un produit organique : Kéq de la fiche GREN 19 requis';
  }
  if (efficace === null) {
    return { sujet: 'ZAR — premier apport', verdict: 'indetermine', detail: `Premier apport sur « ${culture.nom} » : ${comment}. Le plafond est de ${ligne.kgHa} u d’azote efficace jusqu’au stade ${ligne.jusquAuStade}.`, trace: regle.trace };
  }
  if (efficace <= ligne.kgHa) {
    return { sujet: 'ZAR — premier apport', verdict: 'ok', detail: `Premier apport de ${efficace.toFixed(0)} u sur « ${culture.nom} », pour ${ligne.kgHa} u au plus.`, trace: regle.trace };
  }
  const q = selonZonage(situation, 'verification', 'zar');
  return {
    sujet: 'ZAR — premier apport',
    verdict: q.verdict,
    detail: `Premier apport de ${efficace.toFixed(0)} u sur « ${culture.nom} » : ${ligne.kgHa} u au plus jusqu’au stade ${ligne.jusquAuStade}. Le stade de la culture à la date de l’apport n’est pas enregistré. Un engrais NP-NPK localisé au semis jusqu’à 10 kg N n’est pas un premier apport.${q.mention}`,
    trace: regle.trace,
  };
}

/** Tous les contrôles du programme d'actions sur un apport. */
export async function controlerApportPar(
  apport: ApportAControler,
  cache?: CacheRegles,
): Promise<{ situation: Situation; controles: ControleRegle[] }> {
  const situation = await situationParcelle(apport.parcelId, apport.date, cache);
  const controles: ControleRegle[] = [
    controlePeriode(apport, situation),
    await controleFractionnement(apport, situation),
    ...(await controleCouvert(apport, situation)),
    ...controleDigestat(apport, situation),
  ];
  const premier = await controlePremierApportZar(apport, situation);
  if (premier) controles.push(premier);
  return { situation, controles };
}

// ---------------------------------------------------------------------------
// Couverts d'interculture
// ---------------------------------------------------------------------------

/** Les règles de couverture du PAR7 sur un couvert enregistré. */
export function controlerCouvertPar(couvert: CouvertEnregistre, situation: Situation): ControleRegle[] {
  const resultats: ControleRegle[] = [];
  if (!couvert.sownOn) {
    return [{ sujet: 'Couvert d’interculture', verdict: 'indetermine', detail: 'Date de semis non renseignée : ni la date limite d’implantation ni la durée minimale ne sont vérifiables.', trace: null }];
  }
  const prealable = horsZv(situation, 'Couvert d’interculture');
  if (prealable) return [prealable];
  const type = typeDeCouvert(couvert);
  const annee = couvert.sownOn.getUTCFullYear();

  // Implantation au plus tard le 15 octobre.
  const implantation = regleDe(situation.par, 'couverture-implantation-date-limite');
  if (implantation && (type === 'CINE' || type === 'CIE') && couvert.kind !== 'REPOUSSES') {
    const limite = String(implantation.valeur.auPlusTard);
    if (jourDe(couvert.sownOn) <= limite && couvert.sownOn.getUTCMonth() >= 6) {
      resultats.push({ sujet: 'Implantation du couvert', verdict: 'ok', detail: `Semé le ${dateFr(couvert.sownOn)}, avant le ${limite.split('-').reverse().join('/')}.`, trace: implantation.trace });
    } else if (couvert.sownOn.getUTCMonth() >= 6) {
      // Une récolte du précédent après le 1er octobre dispense de couverture,
      // sauf derrière maïs grain et sorgho grain.
      const dispense = regleDe(situation.par, 'couverture-dispense-recolte-tardive');
      const precedent = situation.cultures.filter((c) => c.recolte && c.recolte <= couvert.sownOn!).at(-1);
      const tardive =
        dispense && precedent?.recolte && jourDe(precedent.recolte) > String(dispense.valeur.recoltePrecedentApres) && precedent.recolte.getUTCFullYear() === annee;
      const exclu = precedent && (precedent.reglementaire.famille === 'mais' || precedent.reglementaire.famille === 'sorgho') && /grain/i.test(precedent.nom);
      if (tardive && !exclu) {
        resultats.push({ sujet: 'Implantation du couvert', verdict: 'ok', detail: `Précédent « ${precedent!.nom} » récolté le ${dateFr(precedent!.recolte!)}, après le 1er octobre : la couverture n’était pas obligatoire.`, trace: dispense!.trace });
      } else {
        // « À vérifier », pas « non respecté » : les dispenses (sol argileux
        // justifié par analyse, culture suivante porte-graines, pérenne ou
        // alliacée) dépendent de données que Parcelys n'a pas. Conclure à
        // l'infraction serait trancher à leur place.
        const q = selonZonage(situation, 'verification', 'zv');
        resultats.push({
          sujet: 'Implantation du couvert',
          verdict: q.verdict,
          detail:
            `Couvert semé le ${dateFr(couvert.sownOn)}, après le ${limite.split('-').reverse().join('/')}. ` +
            'La date limite s’applique sauf dispense : récolte du précédent après le 1er octobre (hors maïs et sorgho grain), sol argileux justifié par analyse, culture suivante porte-graines, pérenne ou alliacée. Vérifiez si l’une d’elles s’applique.' +
            q.mention,
          trace: implantation.trace,
        });
      }
    }
  }

  // Destruction : pas avant le 1er novembre, huit semaines au moins.
  const destruction = regleDe(situation.par, 'couverture-destruction');
  const recolteOuPaturage = couvert.destructionMethod === 'RECOLTE' || couvert.destructionMethod === 'PATURAGE';
  if (destruction && couvert.destroyedOn && !recolteOuPaturage && couvert.sownOn.getUTCMonth() >= 6) {
    const pasAvant = String(destruction.valeur.pasAvant);
    const semaines = Number(destruction.valeur.implantationMinimaleSemaines);
    const duree = jours(couvert.sownOn, couvert.destroyedOn);
    const jourDestr = jourDe(couvert.destroyedOn);
    const memeAnnee = couvert.destroyedOn.getUTCFullYear() === annee;
    const exceptions = (destruction.valeur.exceptions as Array<Record<string, unknown>> | undefined) ?? [];
    const argile = exceptions.find((e) => e.cas === 'argile-superieure-31');
    if (duree < semaines * 7) {
      const q = selonZonage(situation, 'alerte', 'zv');
      resultats.push({ sujet: 'Destruction du couvert', verdict: q.verdict, detail: `Couvert détruit le ${dateFr(couvert.destroyedOn)} après ${duree} jours, pour ${semaines} semaines au moins (${semaines * 7} jours). Sauf adventices vivaces ou espèces à destruction obligatoire déclarées à la DDT.${q.mention}`, trace: destruction.trace });
    } else if (memeAnnee && jourDestr < pasAvant) {
      const apresArgile = argile && jourDestr >= String(argile.pasAvant);
      const q = selonZonage(situation, apresArgile ? 'verification' : 'alerte', 'zv');
      resultats.push({
        sujet: 'Destruction du couvert',
        verdict: q.verdict,
        detail:
          `Couvert détruit le ${dateFr(couvert.destroyedOn)}, avant le ${pasAvant.split('-').reverse().join('/')}. ` +
          (apresArgile
            ? `Admis à partir du ${String(argile!.pasAvant).split('-').reverse().join('/')} sur sol à plus de ${argile!.tauxArgileSuperieurA} % d’argile, justifié par une analyse.`
            : 'Sauf adventices vivaces ou espèces à destruction obligatoire (déclaration à la DDT une semaine avant) ou destruction mécanique des parties aériennes d’un CINE monté à graine.') +
          q.mention,
        trace: destruction.trace,
      });
    } else {
      resultats.push({ sujet: 'Destruction du couvert', verdict: 'ok', detail: `Détruit le ${dateFr(couvert.destroyedOn)} après ${duree} jours.`, trace: destruction.trace });
    }
  }

  // Destruction chimique : dérogatoire.
  const chimique = regleDe(situation.par, 'couverture-destruction-chimique');
  if (chimique && couvert.destructionMethod === 'CHIMIQUE') {
    resultats.push({ sujet: 'Destruction chimique du couvert', verdict: 'verification', detail: 'Destruction chimique : admise seulement sur les parties infestées d’adventices vivaces ou d’espèces à destruction obligatoire, après déclaration à la DDT une semaine avant (annexe 2.A) et avec l’attestation d’un conseiller certiphyto.', trace: chimique.trace });
  }

  // Légumineuses pures en CINE : destruction après le 1er mars.
  const leg = regleDe(situation.par, 'couverture-legumineuses-pures-cine');
  if (leg && type === 'CINE' && compositionCouvert(couvert.species).legumineusesPures === true && couvert.destroyedOn) {
    const apres = String(leg.valeur.destructionApres);
    const ok = couvert.destroyedOn.getUTCFullYear() > annee && jourDe(couvert.destroyedOn) >= apres;
    const q = selonZonage(situation, ok ? 'ok' : 'alerte', 'zv');
    resultats.push({ sujet: 'Légumineuses pures en CINE', verdict: q.verdict, detail: ok ? `Détruites le ${dateFr(couvert.destroyedOn)}, après le 1er mars.` : `Légumineuses pures détruites le ${dateFr(couvert.destroyedOn)} : pas avant le 1er mars suivant.${q.mention}`, trace: leg.trace });
  }

  // ZAR : douze semaines au moins, et pas de repousses de céréales.
  if (situation.zar.statut !== 'dehors') {
    const duree = regleDe(situation.par, 'zar-couverts-duree-minimale');
    if (duree && couvert.destroyedOn) {
      const semaines = Number(duree.valeur.semainesMinimum);
      const d = jours(couvert.sownOn, couvert.destroyedOn);
      const q = selonZonage(situation, d < semaines * 7 ? 'alerte' : 'ok', 'zar');
      resultats.push({ sujet: 'ZAR — durée du couvert', verdict: q.verdict, detail: `${d} jours de couvert, pour ${semaines} semaines (${semaines * 7} jours) au moins en zone d’actions renforcée.${q.mention}`, trace: duree.trace });
    }
    const repousses = regleDe(situation.par, 'zar-repousses');
    if (repousses && couvert.kind === 'REPOUSSES') {
      const comp = compositionCouvert(couvert.species);
      const cereales = comp.gramineesPures === true;
      const q = selonZonage(situation, cereales ? 'alerte' : 'verification', 'zar');
      resultats.push({
        sujet: 'ZAR — repousses',
        verdict: q.verdict,
        detail: cereales
          ? `Repousses de céréales (${couvert.species}) : elles ne peuvent pas assurer la couverture en ZAR, sauf dérogation pour situation exceptionnelle.${q.mention}`
          : `Repousses${couvert.species ? ` (${couvert.species})` : ''} : en ZAR, les repousses de céréales sont exclues et celles de colza doivent compter 15 plants/m² au moins.${q.mention}`,
        trace: repousses.trace,
      });
    }
  }
  return resultats;
}

// ---------------------------------------------------------------------------
// Bande enherbée
// ---------------------------------------------------------------------------

/**
 * La bande enherbée ou boisée de 5 m le long des cours d'eau « BCAE ».
 *
 * BD TOPAGE situe les écoulements ; la couche BCAE, qui dit lesquels sont
 * visés, n'est pas fournie. Un écoulement à moins de 5 m du contour donne donc
 * un constat « à vérifier », jamais « non conforme » — et l'absence
 * d'écoulement proche ne dit rien de ceux que BD TOPAGE ignorerait.
 */
export async function controleBandeEnherbee(
  parcelId: string,
  date: Date,
  connue?: Situation,
): Promise<ControleRegle | null> {
  const situation = connue ?? (await situationParcelle(parcelId, date));
  if (situation.zv === 'dehors') return null;
  const regle = regleDe(situation.par, 'bande-enherbee-cours-eau');
  if (!regle) return null;
  const largeur = Number(regle.valeur.largeurMinimaleMetres);
  const proches = await plusProches(parcelId, NATURES_HYDROGRAPHIQUES, { rayonM: largeur, limite: 3 });
  if (proches.length === 0) return null;
  const quoi = proches
    .map((p) => `${p.label}${typeof p.attributes?.NatureTH === 'string' ? ` (${p.attributes.NatureTH})` : ''} à ${p.distanceM.toFixed(0)} m`)
    .join(', ');
  const q = selonZonage(situation, 'verification', 'zv');
  return {
    sujet: 'Bande enherbée le long des cours d’eau',
    verdict: q.verdict,
    detail:
      `${quoi} du contour de la parcelle (BD TOPAGE). Si cet écoulement figure à la couche « BCAE » de l’année (Géoportail), ` +
      `une bande enherbée ou boisée permanente d’au moins ${largeur} m est obligatoire. La couche BCAE n’est pas fournie : à vérifier.${q.mention}`,
    trace: regle.trace,
  };
}

// ---------------------------------------------------------------------------
// Constats de campagne
// ---------------------------------------------------------------------------

export type ConstatPar = {
  domain: 'NITRATES' | 'COUVERTURE' | 'ZONAGE';
  level: 'ANOMALIE' | 'VERIFICATION' | 'INDETERMINE' | 'OK';
  code: string;
  title: string;
  detail: string;
  action?: string;
  parcelId?: string;
  parcelName?: string;
  entity?: string;
  entityId?: string;
  trace: Trace | null;
};

const NIVEAUX: Record<VerdictRegle, ConstatPar['level'] | null> = {
  alerte: 'ANOMALIE',
  verification: 'VERIFICATION',
  indetermine: 'INDETERMINE',
  ok: null,
  'sans-objet': null,
};

/**
 * Les règles du programme d'actions régional appliquées à une campagne :
 * chaque apport enregistré, chaque couvert, chaque parcelle.
 *
 * Les constats « indéterminés » sont regroupés par sujet : vingt apports dont
 * la période ne se vérifie pas faute des périodes nationales disent la même
 * chose vingt fois. Le regroupement garde le nombre et des exemples.
 */
export async function constatsProgrammeActions(params: {
  farmId: string;
  campaignYear: number;
}): Promise<ConstatPar[]> {
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));
  const constats: ConstatPar[] = [];
  const cache: CacheRegles = new Map();
  const indetermines = new Map<string, { exemples: string[]; nombre: number; trace: Trace | null; domain: ConstatPar['domain'] }>();

  const garder = (c: ControleRegle, base: Omit<ConstatPar, 'level' | 'code' | 'title' | 'detail' | 'trace' | 'domain'>, domain: ConstatPar['domain'], code: string) => {
    const level = NIVEAUX[c.verdict];
    if (!level) return;
    if (level === 'INDETERMINE') {
      const cle = `${domain}|${c.sujet}`;
      const g = indetermines.get(cle) ?? { exemples: [], nombre: 0, trace: c.trace, domain };
      g.nombre += 1;
      if (g.exemples.length < 3) g.exemples.push(`${base.parcelName ?? ''} : ${c.detail}`);
      indetermines.set(cle, g);
      return;
    }
    constats.push({ ...base, domain, level, code, title: c.sujet, detail: `${base.parcelName ? `« ${base.parcelName} » — ` : ''}${c.detail}`, trace: c.trace });
  };

  const apports = await prisma.fertilizerApplication.findMany({
    where: { parcel: { farmId: params.farmId, deletedAt: null }, appliedOn: { gte: debut, lte: fin } },
    select: {
      id: true,
      parcelId: true,
      appliedOn: true,
      inputType: true,
      productLabel: true,
      nSupplied: true,
      cropYearId: true,
      parcel: { select: { name: true } },
      fertilizer: { select: { nPercent: true } },
      organicInput: { select: { regulatoryClass: true } },
    },
    orderBy: { appliedOn: 'asc' },
  });

  for (const a of apports) {
    const { controles } = await controlerApportPar({
      id: a.id,
      parcelId: a.parcelId,
      date: a.appliedOn,
      nature: a.inputType === 'MINERAL' ? 'MINERAL' : 'ORGANIC',
      libelle: a.productLabel,
      azoteTotalKgHa: a.nSupplied === null ? null : Number(a.nSupplied),
      cropYearId: a.cropYearId,
      classement: classementDuProduit({
        inputType: a.inputType === 'MINERAL' ? 'MINERAL' : 'ORGANIC',
        nPercent: a.fertilizer?.nPercent === null || a.fertilizer?.nPercent === undefined ? null : Number(a.fertilizer.nPercent),
        regulatoryClass: a.organicInput?.regulatoryClass ?? null,
      }),
    }, cache);
    for (const c of controles) {
      garder(
        { ...c, detail: `apport « ${a.productLabel} » du ${dateFr(a.appliedOn)} : ${c.detail}` },
        { parcelId: a.parcelId, parcelName: a.parcel.name, entity: 'fertilizerApplication', entityId: a.id, action: c.verdict === 'alerte' ? 'Vérifiez l’apport, ou documentez l’exception dont il relève.' : undefined },
        'NITRATES',
        `par.${c.sujet}`,
      );
    }
  }

  const couverts = await prisma.soilCover.findMany({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      OR: [{ sownOn: { gte: debut, lte: fin } }, { destroyedOn: { gte: debut, lte: fin } }],
    },
    select: { id: true, parcelId: true, kind: true, species: true, sownOn: true, destroyedOn: true, destructionMethod: true, areaHa: true, parcel: { select: { name: true } } },
  });
  for (const c of couverts) {
    const situation = await situationParcelle(c.parcelId, c.sownOn ?? c.destroyedOn ?? fin, cache);
    for (const r of controlerCouvertPar({ ...c, areaHa: c.areaHa === null ? null : Number(c.areaHa) }, situation)) {
      garder(r, { parcelId: c.parcelId, parcelName: c.parcel.name, entity: 'soilCover', entityId: c.id }, 'COUVERTURE', `par.${r.sujet}`);
    }
  }

  // Par parcelle : zone d'actions renforcée et bande enherbée, à la fin de la
  // campagne (ou aujourd'hui, si elle n'est pas finie).
  const reference = fin < new Date() ? fin : new Date();
  const parcelles = await prisma.parcel.findMany({
    where: { farmId: params.farmId, deletedAt: null },
    select: { id: true, name: true },
  });
  for (const p of parcelles) {
    const situation = await situationParcelle(p.id, reference, cache);
    if (situation.zv !== 'dehors' && situation.zar.statut !== 'dehors' && situation.par.regles.length > 0) {
      const mesures = situation.par.regles.filter((r) => r.condition?.zone === 'ZONE_ACTION_RENFORCEE');
      const premiere = mesures[0] ?? null;
      constats.push({
        domain: 'ZONAGE',
        level: situation.zar.statut === 'dedans' ? 'VERIFICATION' : 'INDETERMINE',
        code: 'zar.appartenance',
        title: situation.zar.statut === 'dedans' ? 'Parcelle en zone d’actions renforcée' : 'Zone d’actions renforcée : appartenance indéterminée',
        detail:
          `« ${p.name} » — ${situation.zar.captages.join(', ')}. ` +
          (situation.zar.statut === 'dedans'
            ? (situation.zar.reconstitue ? 'Périmètre reconstitué à partir de l’aire d’alimentation du captage (la cartographie de la DREAL fait foi). ' : '')
            : 'Le périmètre de cette ZAR n’est pas fourni ; la commune est citée par l’arrêté. ') +
          `Mesures renforcées : ${mesures.map((m) => m.libelle.replace(/^ZAR : /, '')).join(' ; ')}.`,
        action: 'Respectez les mesures renforcées, dont le retournement de prairie (quatre conditions cumulatives).',
        parcelId: p.id,
        parcelName: p.name,
        trace: premiere?.trace ?? null,
      });
    }
    const bande = await controleBandeEnherbee(p.id, reference, situation);
    if (bande) garder(bande, { parcelId: p.id, parcelName: p.name, entity: 'parcel', entityId: p.id }, 'NITRATES', 'par.bande-enherbee');
  }

  for (const [cle, g] of indetermines) {
    const sujet = cle.split('|')[1] ?? cle;
    constats.push({
      domain: g.domain,
      level: 'INDETERMINE',
      code: `par.indetermine.${sujet}`,
      title: `${sujet} : non vérifiable (${g.nombre} cas)`,
      detail: g.exemples.join(' — ') + (g.nombre > g.exemples.length ? ` — et ${g.nombre - g.exemples.length} autre(s).` : ''),
      trace: g.trace,
    });
  }
  return constats;
}
