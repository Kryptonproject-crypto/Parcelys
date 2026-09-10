import 'server-only';
import { prisma } from '@/lib/prisma';
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
 * Du plus précis au plus général : produit + culture, puis culture seule. Un
 * rapprochement par culture seule est légitime — les référentiels publient
 * souvent une dose de référence par culture et par cible — mais on ne descend
 * jamais jusqu'à « n'importe quelle culture », qui reviendrait à choisir une
 * référence au hasard.
 */
async function findReference(params: {
  referentialId: string;
  amm: string | null;
  cropLabel: string | null;
}) {
  const cropNormalized = params.cropLabel ? normalizeSearchTerm(params.cropLabel) : null;

  if (params.amm && cropNormalized) {
    const exact = await prisma.iftReference.findFirst({
      where: {
        referentialId: params.referentialId,
        amm: params.amm,
        cropNormalized,
      },
    });
    if (exact) return exact;
  }

  if (params.amm) {
    const parProduit = await prisma.iftReference.findFirst({
      where: { referentialId: params.referentialId, amm: params.amm },
    });
    if (parProduit) return parProduit;
  }

  if (cropNormalized) {
    return prisma.iftReference.findFirst({
      where: { referentialId: params.referentialId, cropNormalized, amm: null },
    });
  }

  return null;
}

/**
 * IFT d'une exploitation sur une campagne.
 *
 * Les traitements viennent du registre existant : aucune ressaisie, et l'IFT
 * suit automatiquement toute correction apportée à une intervention.
 */
export async function computeFarmIft(params: {
  farmId: string;
  campaignYear: number;
  parcelId?: string;
}): Promise<IftSummary> {
  const referentiel = await prisma.regulatoryReferential.findFirst({
    where: { code: 'ift-doses-reference', status: 'ACTIF' },
    orderBy: { appliesFrom: 'desc' },
  });

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
    orderBy: { appliedOn: 'asc' },
  });

  const caveats: string[] = [];

  if (!referentiel) {
    caveats.push(
      'Le référentiel des doses de référence IFT n’a pas été importé : aucun IFT ' +
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
    const reference = await findReference({
      referentialId: referentiel.id,
      amm: traitement.amm,
      cropLabel: culture,
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
      ...(reason ? { reason } : {}),
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
