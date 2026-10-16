import { DOSE_TO_TOTAL_UNIT } from '@/lib/constants/agronomy';

export type NutrientContent = {
  /** Pourcentage (engrais minéral) : 33,5 pour de l'ammonitrate 33,5 %. */
  nPercent?: number | null;
  pPercent?: number | null;
  kPercent?: number | null;
};

export type OrganicContent = {
  /** Teneur en kg d'élément par tonne (ou par m³) de produit brut. */
  nContent?: number | null;
  pContent?: number | null;
  kContent?: number | null;
  /**
   * Unité à laquelle se rapportent les teneurs : `t/ha` pour des kg par
   * tonne, `m3/ha` pour des kg par m³. Absente : celle de la dose.
   */
  unit?: string | null;
};

/**
 * Kilogrammes de produit par hectare pour une dose d'engrais minéral, ou
 * `null` quand l'unité est un volume : sans la densité du produit, des
 * litres ne se convertissent pas en kilogrammes.
 */
export function kgDeProduitParHa(dose: number, doseUnit: string): number | null {
  switch (doseUnit) {
    case 'kg/ha':
      return dose;
    case 'g/ha':
      return dose / 1000;
    case 't/ha':
      return dose * 1000;
    default:
      return null;
  }
}

/**
 * Quantité de produit organique dans l'unité de ses teneurs (tonnes ou m³
 * par hectare), ou `null` quand la dose est une masse et la teneur rapportée
 * à un volume (ou l'inverse) : la densité du produit n'est pas connue.
 */
export function quantiteOrganiqueParHa(
  dose: number,
  doseUnit: string,
  uniteTeneur: string | null | undefined,
): number | null {
  const masse: Record<string, number> = { 't/ha': 1, 'kg/ha': 0.001 };
  const volume: Record<string, number> = { 'm3/ha': 1, 'L/ha': 0.001 };
  const reference = uniteTeneur ?? doseUnit;
  if (reference === 't/ha' && masse[doseUnit] !== undefined) return dose * masse[doseUnit];
  if (reference === 'm3/ha' && volume[doseUnit] !== undefined) return dose * volume[doseUnit];
  return null;
}

export type FertilizationComputation = {
  totalQuantity: number;
  totalUnit: string;
  nSupplied: number | null;
  pSupplied: number | null;
  kSupplied: number | null;
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Quantité totale d'un apport : `dose × surface traitée`.
 * L'unité totale se déduit de l'unité de dose (kg/ha → kg, m3/ha → m3…).
 */
export function computeTotalQuantity(
  dose: number,
  doseUnit: string,
  treatedAreaHa: number,
): { totalQuantity: number; totalUnit: string } {
  return {
    totalQuantity: round(dose * treatedAreaHa, 3),
    totalUnit: DOSE_TO_TOTAL_UNIT[doseUnit] ?? doseUnit.replace('/ha', ''),
  };
}

/**
 * Éléments fertilisants apportés, en kg/ha.
 *
 *  - engrais minéral : `dose (kg/ha) × teneur (%) / 100` ;
 *  - produit organique : `dose (t ou m³/ha) × teneur (kg/t ou kg/m³)`.
 *
 * Une dose dont l'unité ne se rapporte pas à celle de la teneur (des litres
 * d'engrais, des m³ d'un produit analysé à la tonne) donne `null` : la
 * conversion demanderait une densité que Parcelys n'a pas.
 *
 * Renvoie `null` pour un élément dont la teneur n'est pas connue : Parcelys
 * n'estime jamais une valeur agronomique manquante.
 */
export function computeNutrients(params: {
  dose: number;
  doseUnit: string;
  mineral?: NutrientContent | null;
  organic?: OrganicContent | null;
}): { nSupplied: number | null; pSupplied: number | null; kSupplied: number | null } {
  const { dose, doseUnit, mineral, organic } = params;

  if (mineral) {
    // Une dose en litres ne se convertit pas sans la densité du produit :
    // compter des L/ha comme des kg/ha fausserait le bilan sans le dire.
    const factor = kgDeProduitParHa(dose, doseUnit);
    if (factor === null) return { nSupplied: null, pSupplied: null, kSupplied: null };
    return {
      nSupplied: mineral.nPercent != null ? round((factor * Number(mineral.nPercent)) / 100, 2) : null,
      pSupplied: mineral.pPercent != null ? round((factor * Number(mineral.pPercent)) / 100, 2) : null,
      kSupplied: mineral.kPercent != null ? round((factor * Number(mineral.kPercent)) / 100, 2) : null,
    };
  }

  if (organic) {
    const quantite = quantiteOrganiqueParHa(dose, doseUnit, organic.unit);
    if (quantite === null) return { nSupplied: null, pSupplied: null, kSupplied: null };
    return {
      nSupplied: organic.nContent != null ? round(quantite * Number(organic.nContent), 2) : null,
      pSupplied: organic.pContent != null ? round(quantite * Number(organic.pContent), 2) : null,
      kSupplied: organic.kContent != null ? round(quantite * Number(organic.kContent), 2) : null,
    };
  }

  return { nSupplied: null, pSupplied: null, kSupplied: null };
}

export type NutrientBalance = {
  /** Totaux en kg d'élément sur l'ensemble de la surface. */
  totalN: number;
  totalP: number;
  totalK: number;
  /**
   * kg/ha : le total rapporté à `referenceAreaHa`.
   *
   * Avec la surface de la parcelle (ou des parcelles concernées) pour
   * référence, c'est **ce que l'hectare a reçu en cumul** — la grandeur que
   * lit un exploitant sous « cumul de tous les apports », et celle du bilan de
   * fertilisation exporté en PDF.
   */
  perHectareN: number;
  perHectareP: number;
  perHectareK: number;
  /** Surface traitée cumulée : chaque passage compte sa surface. */
  areaHa: number;
  /** Surface à laquelle les kg/ha sont rapportés. */
  referenceAreaHa: number;
  /** Nombre d'apports dont la teneur en azote n'est pas renseignée. */
  incompleteCount: number;
};

/**
 * Bilan des éléments fertilisants sur une liste d'apports.
 * Les apports sans teneur connue sont comptabilisés à part plutôt que
 * d'être estimés.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA SURFACE DE RÉFÉRENCE (0.11.1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les kg/ha étaient le total divisé par la **somme des surfaces de chaque
 * passage** : la moyenne d'un passage, pas le cumul. Deux apports de 50 kg
 * N/ha sur une parcelle s'affichaient « 50 kg/ha » sous le titre « cumul de
 * tous les apports », quand l'hectare en avait reçu 100 — et quand le bilan
 * PDF de la même parcelle, lui, disait bien 100. Sous-estimer l'azote reçu
 * est le mauvais sens : c'est celui qui laisse dépasser un plafond sans le
 * voir.
 *
 * `surfaceHa` donne la surface à laquelle rapporter le total : celle de la
 * parcelle pour la fiche, celle des parcelles concernées pour l'exploitation.
 * Sans elle, l'ancien calcul (moyenne par passage) reste celui de la
 * fonction.
 */
export function computeNutrientBalance(
  applications: Array<{
    treatedAreaHa: number | string;
    nSupplied?: number | string | null;
    pSupplied?: number | string | null;
    kSupplied?: number | string | null;
  }>,
  surfaceHa?: number | string | null,
): NutrientBalance {
  let totalN = 0;
  let totalP = 0;
  let totalK = 0;
  let areaHa = 0;
  let incompleteCount = 0;

  for (const app of applications) {
    const area = Number(app.treatedAreaHa) || 0;
    areaHa += area;

    const n = app.nSupplied != null ? Number(app.nSupplied) : null;
    const p = app.pSupplied != null ? Number(app.pSupplied) : null;
    const k = app.kSupplied != null ? Number(app.kSupplied) : null;

    if (n === null) incompleteCount += 1;
    totalN += (n ?? 0) * area;
    totalP += (p ?? 0) * area;
    totalK += (k ?? 0) * area;
  }

  const surface = surfaceHa != null ? Number(surfaceHa) : NaN;
  const reference = Number.isFinite(surface) && surface > 0 ? surface : areaHa;

  return {
    totalN: round(totalN, 1),
    totalP: round(totalP, 1),
    totalK: round(totalK, 1),
    perHectareN: reference > 0 ? round(totalN / reference, 1) : 0,
    perHectareP: reference > 0 ? round(totalP / reference, 1) : 0,
    perHectareK: reference > 0 ? round(totalK / reference, 1) : 0,
    areaHa: round(areaHa, 4),
    referenceAreaHa: round(reference, 4),
    incompleteCount,
  };
}
