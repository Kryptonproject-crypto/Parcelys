import 'server-only';
import { prisma } from '@/lib/prisma';
import { dansUnCalcul, memoise } from '@/lib/memoire-calcul';
import { convertDose, parseCatalogDose } from '@/lib/ephy/dose';
import { normalizeSearchTerm } from '@/lib/ephy/schema';

/**
 * Indicateur de fréquence de traitement.
 *
 * ## Ce que l'IFT est, et ce qu'il n'est pas
 *
 * L'IFT d'un traitement est le rapport entre la dose appliquée et une **dose de
 * référence publiée**, pondéré par la part de la parcelle traitée :
 *
 *     IFT = (dose appliquée / dose de référence) × (surface traitée / surface)
 *
 * Ce n'est donc pas un compteur de passages. Un demi-dose sur la moitié d'une
 * parcelle vaut 0,25 ; deux passages à pleine dose valent 2. Compter les
 * traitements donnerait 1 dans le premier cas et 2 dans le second — juste par
 * accident dans le second, faux dans le premier.
 *
 * ## Sans référentiel, pas d'IFT
 *
 * Les doses de référence sont publiées par le ministère. Tant que ce
 * référentiel n'est pas importé, **aucun IFT n'est calculé**, et l'interface
 * l'écrit. La tentation serait d'afficher le nombre de traitements en
 * attendant : ce serait donner un chiffre faux sous un nom juste, et
 * l'agriculteur le comparerait à des références nationales sans savoir qu'il
 * compare autre chose.
 *
 * ## Ce qui reste indéterminé même avec le référentiel
 *
 * Un produit peut être traité sans qu'une dose de référence existe pour ce
 * couple culture/produit, ou dans une unité non convertible. Ces traitements
 * sont **comptés à part**, jamais assimilés à un IFT nul : zéro se lirait comme
 * « sans impact », alors que la vérité est « non calculable ».
 */

export type IftTreatment = {
  applicationId: string;
  appliedOn: string;
  parcelId: string;
  parcelName: string;
  productName: string;
  amm: string | null;
  cropLabel: string | null;
  category: string;
  /** Dose appliquée, telle que saisie. */
  doseValue: number;
  doseUnit: string;
  /** Dose de référence retenue, dans son unité d'origine. */
  referenceValue: number | null;
  referenceUnit: string | null;
  treatedAreaHa: number;
  parcelAreaHa: number;
  /** IFT de ce traitement, ou `null` si non calculable. */
  ift: number | null;
  /** Pourquoi il n'est pas calculable. */
  reason?: string;
};

export type IftSummary = {
  /** Le référentiel est-il disponible ? Sinon rien n'est calculé. */
  configured: boolean;
  source: { code: string; version: string; sourceLabel: string } | null;
  campaignYear: number;
  /** IFT total, somme des IFT calculables. */
  total: number | null;
  /** Par catégorie officielle. */
  byCategory: Record<string, number>;
  /** Traitements pris en compte. */
  computed: number;
  /** Traitements qu'on n'a pas su rapporter à une dose de référence. */
  uncomputed: number;
  treatments: IftTreatment[];
  /** Ce qui empêche un calcul complet, en clair. */
  caveats: string[];
};

/**
 * Catégorie officielle d'un traitement, déduite de la fonction du produit.
 *
 * `productType` porte la fonction publiée par E-Phy (« Herbicide »,
 * « Fongicide », « Insecticide »…). On la range dans les catégories employées
 * pour l'IFT ; tout le reste va dans « autres » plutôt que d'être écarté, parce
 * qu'un traitement non classé reste un traitement.
 */
export function categoryOf(productType: string | null): string {
  const t = normalizeSearchTerm(productType ?? '');
  if (!t) return 'autres';
  if (t.includes('herbicide')) return 'herbicides';
  if (t.includes('fongicide')) return 'fongicides';
  if (t.includes('insecticide') || t.includes('acaricide')) return 'insecticides';
  return 'autres';
}

/**
 * IFT d'un traitement.
 *
 * Renvoie `null` avec une raison plutôt qu'un zéro dès qu'un terme manque :
 * pas de dose de référence, unités non convertibles, surface nulle.
 */
export function computeTreatmentIft(params: {
  doseValue: number;
  doseUnit: string;
  referenceValue: number | null;
  referenceUnit: string | null;
  treatedAreaHa: number;
  parcelAreaHa: number;
}): { ift: number | null; reason?: string } {
  if (params.referenceValue === null || !params.referenceUnit) {
    return {
      ift: null,
      reason: 'Aucune dose de référence publiée pour ce produit sur cette culture.',
    };
  }
  if (params.referenceValue <= 0) {
    return { ift: null, reason: 'La dose de référence publiée n’est pas exploitable.' };
  }

  // La dose de référence est ramenée à l'unité de la saisie. Même règle que
  // pour le contrôle de dose : jamais de conversion entre masse et volume.
  const referenceConvertie = convertDose(
    params.referenceValue,
    params.referenceUnit,
    params.doseUnit,
  );
  if (referenceConvertie === null) {
    return {
      ift: null,
      reason:
        `Dose de référence en ${params.referenceUnit}, saisie en ${params.doseUnit} : ` +
        'ces unités ne se convertissent pas sans la densité du produit.',
    };
  }

  if (params.parcelAreaHa <= 0) {
    return { ift: null, reason: 'Superficie de parcelle inconnue.' };
  }

  const partTraitee = Math.min(params.treatedAreaHa / params.parcelAreaHa, 1);
  const ift = (params.doseValue / referenceConvertie) * partTraitee;

  return { ift: Number(ift.toFixed(3)) };
}

/**
 * Cherche la dose de référence applicable à un traitement.
 *
 * Le fichier officiel publie, pour un produit et une culture :
 *
 *  · une dose de référence **à la culture** (cible vide) pour les traitements
 *    des cultures — unique pour un couple produit × culture ;
 *  · des doses **à la cible** (maladie, ravageur, adventice) ;
 *  · des doses de **traitement de semences**, rangées dans leur propre
 *    catégorie, et jusqu'à vingt fois plus élevées.
 *
 * On prend la dose à la cible quand la cible saisie est exactement celle du
 * fichier, sinon la dose à la culture. Jamais une dose de traitement de
 * semences pour un traitement des cultures, et jamais la dose d'une **autre
 * culture** : prendre « la première ligne du produit » donnait à un traitement
 * du blé la dose de référence d'une betterave, et un IFT faux d'un facteur
 * vingt quand la ligne retenue était celle des semences.
 */
const SEGMENT_SEMENCES = 'Traitement de semences';

async function findReference(params: {
  referentialId: string;
  amm: string | null;
  cropLabel: string | null;
  targetLabel: string | null;
}): Promise<{ reference: Awaited<ReturnType<typeof prisma.iftReference.findFirst>>; reason?: string }> {
  const cropNormalized = params.cropLabel ? normalizeSearchTerm(params.cropLabel) : null;
  if (!cropNormalized) {
    return { reference: null, reason: 'Culture du traitement inconnue : la dose de référence dépend de la culture.' };
  }

  if (params.amm) {
    // Le même produit sur la même culture revient d'un traitement à l'autre :
    // lu une fois par calcul (cf. `memoise`).
    const amm = params.amm;
    const lignes = await memoise(`ift:${params.referentialId}|${amm}|${cropNormalized}`, () =>
      prisma.iftReference.findMany({
        where: { referentialId: params.referentialId, amm, cropNormalized },
      }),
    );
    const cultures = lignes.filter((l) => l.category !== SEGMENT_SEMENCES);
    const cible = params.targetLabel ? normalizeSearchTerm(params.targetLabel) : null;
    const aLaCible = cible
      ? cultures.find((l) => l.targetLabel && normalizeSearchTerm(l.targetLabel) === cible)
      : undefined;
    if (aLaCible) return { reference: aLaCible };
    const aLaCulture = cultures.find((l) => !l.targetLabel);
    if (aLaCulture) return { reference: aLaCulture };
    if (lignes.length > 0) {
      return {
        reference: null,
        reason:
          cultures.length === 0
            ? 'Seule une dose de référence de traitement de semences est publiée pour ce produit sur cette culture.'
            : 'Aucune dose de référence à la culture n’est publiée pour ce produit, et la cible saisie ne correspond à aucune cible du référentiel.',
      };
    }
    return {
      reference: null,
      reason: `Aucune dose de référence publiée pour ce produit sur la culture « ${params.cropLabel} » (le nom de culture doit être celui du référentiel IFT).`,
    };
  }

  // Sans numéro d'AMM : une dose « à la culture » sans produit, si le
  // référentiel en publie une (le fichier national n'en contient pas).
  const parCulture = await memoise(`ift-culture:${params.referentialId}|${cropNormalized}`, () =>
    prisma.iftReference.findFirst({
      where: { referentialId: params.referentialId, cropNormalized, amm: null, targetLabel: null },
    }),
  );
  return parCulture
    ? { reference: parCulture }
    : { reference: null, reason: 'Numéro d’AMM absent : la dose de référence ne peut pas être retrouvée.' };
}

/**
 * IFT d'une exploitation sur une campagne.
 *
 * Les traitements viennent du registre existant : aucune ressaisie, et l'IFT
 * suit automatiquement toute correction apportée à une intervention.
 */
export function computeFarmIft(params: {
  farmId: string;
  campaignYear: number;
  parcelId?: string;
}): Promise<IftSummary> {
  return dansUnCalcul(() => calculerIftExploitation(params));
}

async function calculerIftExploitation(params: {
  farmId: string;
  campaignYear: number;
  parcelId?: string;
}): Promise<IftSummary> {
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * LA CAMPAGNE DEMANDÉE, ET AUCUNE AUTRE
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Les doses de référence changent d'une campagne à l'autre. Cette requête
   * prenait le référentiel le plus récent **sans regarder la campagne**, si
   * bien que l'IFT 2025 se serait calculé avec les doses 2026 dès qu'elles
   * auraient été importées. Le nombre produit aurait eu toutes les apparences
   * d'un nombre juste — et l'IFT se déclare.
   *
   * Le référentiel est donc versionné par la campagne, et on exige la
   * correspondance exacte. À défaut, rien n'est calculé et l'on dit quelles
   * campagnes sont disponibles : un IFT absent se voit, un IFT faux ne se voit
   * pas.
   */
  const referentiel = await prisma.regulatoryReferential.findFirst({
    where: {
      code: 'ift-doses-reference',
      status: 'ACTIF',
      version: String(params.campaignYear),
    },
  });

  const campagnesDisponibles = referentiel
    ? []
    : (
        await prisma.regulatoryReferential.findMany({
          where: { code: 'ift-doses-reference', status: 'ACTIF' },
          select: { version: true },
          orderBy: { version: 'desc' },
        })
      ).map((r) => r.version);

  const debut = new Date(Date.UTC(params.campaignYear - 1, 8, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 7, 31, 23, 59, 59));

  const traitements = await prisma.phytosanitaryApplication.findMany({
    where: {
      parcel: {
        farmId: params.farmId,
        deletedAt: null,
        ...(params.parcelId ? { id: params.parcelId } : {}),
      },
      appliedOn: { gte: debut, lte: fin },
    },
    include: {
      parcel: { select: { id: true, name: true, areaHa: true } },
      product: { select: { productType: true } },
      cropYear: { include: { crop: { select: { name: true } } } },
    },
    // Des traitements du même jour : dans l'ordre de saisie. Sans départage,
    // la base les rend dans un ordre quelconque, qui change d'un affichage à
    // l'autre sans que rien n'ait changé.
    orderBy: [{ appliedOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  const caveats: string[] = [];

  if (!referentiel) {
    caveats.push(
      campagnesDisponibles.length > 0
        ? `Aucune dose de référence IFT n’est importée pour la campagne ` +
          `${params.campaignYear}. Disponibles : ${campagnesDisponibles.join(', ')}. ` +
          'Les doses d’une autre campagne ne sont pas employées : elles ' +
          'donneraient un IFT faux.'
        : 'Le référentiel des doses de référence IFT n’a pas été importé : aucun IFT ' +
          'ne peut être calculé. Parcelys ne compte pas les passages à la place — ' +
          'un nombre de traitements n’est pas un IFT.',
    );
    return {
      configured: false,
      source: null,
      campaignYear: params.campaignYear,
      total: null,
      byCategory: {},
      computed: 0,
      uncomputed: traitements.length,
      treatments: [],
      caveats,
    };
  }

  const lignes: IftTreatment[] = [];

  for (const traitement of traitements) {
    const culture =
      traitement.cropLabel ?? traitement.cropYear?.crop.name ?? null;
    const { reference, reason: raisonReference } = await findReference({
      referentialId: referentiel.id,
      amm: traitement.amm,
      cropLabel: culture,
      targetLabel: traitement.targetLabel,
    });

    const doseValue = Number(traitement.dose);
    const treatedAreaHa = Number(traitement.treatedAreaHa);
    const parcelAreaHa = Number(traitement.parcel.areaHa);
    const referenceValue = reference ? parseCatalogDose(reference.doseValue) : null;

    const { ift, reason } = computeTreatmentIft({
      doseValue,
      doseUnit: traitement.doseUnit,
      referenceValue,
      referenceUnit: reference?.doseUnit ?? null,
      treatedAreaHa,
      parcelAreaHa,
    });

    lignes.push({
      applicationId: traitement.id,
      appliedOn: traitement.appliedOn.toISOString(),
      parcelId: traitement.parcel.id,
      parcelName: traitement.parcel.name,
      productName: traitement.productName,
      amm: traitement.amm,
      cropLabel: culture,
      category: reference?.category ?? categoryOf(traitement.product?.productType ?? null),
      doseValue,
      doseUnit: traitement.doseUnit,
      referenceValue,
      referenceUnit: reference?.doseUnit ?? null,
      treatedAreaHa,
      parcelAreaHa,
      ift,
      // La raison de la recherche prime : « aucune dose publiée » est moins
      // précis que « seule une dose de semences est publiée ».
      ...(ift === null && (raisonReference ?? reason) ? { reason: raisonReference ?? reason } : {}),
    });
  }

  const calcules = lignes.filter((l) => l.ift !== null);
  const byCategory: Record<string, number> = {};
  for (const ligne of calcules) {
    byCategory[ligne.category] = Number(
      ((byCategory[ligne.category] ?? 0) + (ligne.ift ?? 0)).toFixed(3),
    );
  }

  const nonCalcules = lignes.length - calcules.length;
  if (nonCalcules > 0) {
    caveats.push(
      `${nonCalcules} traitement${nonCalcules > 1 ? 's' : ''} sans dose de référence ` +
        'exploitable : ils ne sont pas comptés dans l’IFT, et ne valent pas zéro.',
    );
  }

  return {
    configured: true,
    source: {
      code: referentiel.code,
      version: referentiel.version,
      sourceLabel: referentiel.sourceLabel,
    },
    campaignYear: params.campaignYear,
    total: Number(calcules.reduce((s, l) => s + (l.ift ?? 0), 0).toFixed(3)),
    byCategory,
    computed: calcules.length,
    uncomputed: nonCalcules,
    treatments: lignes,
    caveats,
  };
}
