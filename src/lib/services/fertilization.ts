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
};

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
    const factor = doseUnit === 'g/ha' ? dose / 1000 : dose;
    return {
      nSupplied: mineral.nPercent != null ? round((factor * Number(mineral.nPercent)) / 100, 2) : null,
      pSupplied: mineral.pPercent != null ? round((factor * Number(mineral.pPercent)) / 100, 2) : null,
      kSupplied: mineral.kPercent != null ? round((factor * Number(mineral.kPercent)) / 100, 2) : null,
    };
  }

  if (organic) {
    return {
      nSupplied: organic.nContent != null ? round(dose * Number(organic.nContent), 2) : null,
      pSupplied: organic.pContent != null ? round(dose * Number(organic.pContent), 2) : null,
      kSupplied: organic.kContent != null ? round(dose * Number(organic.kContent), 2) : null,
    };
  }

  return { nSupplied: null, pSupplied: null, kSupplied: null };
}

export type NutrientBalance = {
  /** Totaux en kg d'élément sur l'ensemble de la surface. */
  totalN: number;
  totalP: number;
  totalK: number;
  /** Moyennes pondérées en kg/ha. */
  perHectareN: number;
  perHectareP: number;
  perHectareK: number;
  areaHa: number;
  /** Nombre d'apports dont la teneur en azote n'est pas renseignée. */
  incompleteCount: number;
};

/**
 * Bilan des éléments fertilisants sur une liste d'apports.
 * Les apports sans teneur connue sont comptabilisés à part plutôt que
 * d'être estimés.
 */
export function computeNutrientBalance(
  applications: Array<{
    treatedAreaHa: number | string;
    nSupplied?: number | string | null;
    pSupplied?: number | string | null;
    kSupplied?: number | string | null;
  }>,
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

  return {
    totalN: round(totalN, 1),
    totalP: round(totalP, 1),
    totalK: round(totalK, 1),
    perHectareN: areaHa > 0 ? round(totalN / areaHa, 1) : 0,
    perHectareP: areaHa > 0 ? round(totalP / areaHa, 1) : 0,
    perHectareK: areaHa > 0 ? round(totalK / areaHa, 1) : 0,
    areaHa: round(areaHa, 4),
    incompleteCount,
  };
}
