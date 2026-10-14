import { z } from 'zod';

/**
 * Ce qu'un fertilisant est, au sens des textes qui le visent.
 *
 * Le programme d'actions raisonne en **types** (0, I, II, III, définis par le
 * programme national) ; le référentiel GREN en **dénominations** de sa fiche
 * 19 — une liste pour les teneurs de référence, une pour les coefficients
 * Kéq, une pour l'azote potentiellement libéré. Le nom qu'un exploitant donne
 * à son produit (« fumier de la stabulation ») ne dit rien de tout cela.
 *
 * Deux cas seulement se déduisent :
 *
 *  · un **engrais minéral azoté** est un fertilisant de type III — les fiches
 *    GREN parlent d'« engrais minéral de synthèse », et c'est le seul classement
 *    que Parcelys tire de la nature du produit ;
 *  · la **phase liquide d'un digestat** est de type II — le PAR7 le dit
 *    lui-même (art. 2, I, 2° c : « ce type d'effluent (type II) »).
 *
 * Tout le reste se **déclare** sur la fiche du produit. Non déclaré, il reste
 * `null`, et la règle qui en dépend reste indéterminée.
 */

export const TYPES_PAN = ['0', 'I', 'II', 'III'] as const;
export type TypePan = (typeof TYPES_PAN)[number];

export const classementDeclareSchema = z
  .object({
    typePan: z.enum(TYPES_PAN).nullable().optional(),
    /** Dénomination de la fiche 19 — azote potentiellement libéré (APLSH). */
    aplsh: z.string().regex(/^[a-z0-9-]+$/).max(80).nullable().optional(),
    /** Dénomination de la fiche 19 — coefficient Kéq. */
    keq: z.string().regex(/^[a-z0-9-]+$/).max(80).nullable().optional(),
    /** Dénomination de la fiche 19 — teneur de référence. */
    teneur: z.string().regex(/^[a-z0-9-]+$/).max(80).nullable().optional(),
  })
  .strict();

export type ClassementDeclare = z.infer<typeof classementDeclareSchema>;

export type ClassementProduit = {
  typePan: TypePan | null;
  aplsh: string | null;
  keq: string | null;
  teneur: string | null;
  /** D'où vient le type, en clair. */
  origineType: string | null;
};

export function classementDuProduit(produit: {
  inputType: 'MINERAL' | 'ORGANIC';
  /** Teneur en azote d'un engrais minéral, en %. */
  nPercent?: number | null;
  regulatoryClass?: unknown;
}): ClassementProduit {
  const declare = classementDeclareSchema.safeParse(produit.regulatoryClass ?? {});
  const d: ClassementDeclare = declare.success ? declare.data : {};

  if (produit.inputType === 'MINERAL') {
    if (produit.nPercent === null || produit.nPercent === undefined) {
      return { typePan: null, aplsh: null, keq: null, teneur: null, origineType: 'engrais minéral dont la teneur en azote n’est pas renseignée' };
    }
    if (produit.nPercent <= 0) {
      return { typePan: null, aplsh: null, keq: null, teneur: null, origineType: 'engrais minéral sans azote : non concerné' };
    }
    return { typePan: 'III', aplsh: null, keq: null, teneur: null, origineType: 'engrais azoté minéral (« engrais minéral de synthèse » des fiches GREN)' };
  }

  if (d.typePan) {
    return { typePan: d.typePan, aplsh: d.aplsh ?? null, keq: d.keq ?? null, teneur: d.teneur ?? null, origineType: 'déclaré sur la fiche du produit' };
  }
  if (d.aplsh === 'digestats-fraction-liquide') {
    return {
      typePan: 'II',
      aplsh: d.aplsh,
      keq: d.keq ?? null,
      teneur: d.teneur ?? null,
      origineType: 'phase liquide de digestat : type II selon le PAR7 (art. 2, I, 2° c)',
    };
  }
  return { typePan: null, aplsh: d.aplsh ?? null, keq: d.keq ?? null, teneur: d.teneur ?? null, origineType: null };
}
