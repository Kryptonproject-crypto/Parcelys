import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { badRequest, notFound } from '@/lib/api/errors';
import { departementDepuisInsee, territoiresDeLaParcelle } from '@/lib/regulatory/geography';
import { lireRegles, type Trace } from '@/lib/regulatory/regles';
import { classementDuProduit } from '@/lib/regulatory/classement-produit';
import { quantiteOrganiqueParHa } from '@/lib/services/fertilization';
import {
  calculerDoseGren,
  decrireSaisie,
  reglesGren,
  saisieGrenSchema,
  type ApportOrganiqueGren,
  type CalculGren,
  type ContexteGren,
  type DescriptionSaisie,
  type ReglesGren,
  type SaisieGren,
} from '@/lib/regulatory/gren-calcul';

/**
 * Le plan prévisionnel de fumure calculé selon le GREN, côté serveur.
 *
 * Ce module rassemble ce que le calcul pur (`gren-calcul.ts`) ne peut pas
 * savoir seul : les règles **en vigueur à la date du bilan sur le territoire
 * de la parcelle**, le département de la parcelle, les rendements passés de
 * l'exploitation, les apports organiques réalisés ou prévus — puis enregistre
 * le plan avec le calcul **tel qu'il a été fait** et la trace de chaque règle.
 *
 * ## La date du calcul
 *
 * Le bilan s'ouvre en sortie d'hiver : c'est la date d'ouverture saisie sur le
 * plan, à défaut le 1er février de l'année de récolte. C'est à cette date que
 * se lit la version du référentiel : une campagne 2025 n'a pas la fiche 19 du
 * 15 juillet 2025, et Parcelys ne la lui prête pas.
 */

export type CalculPlan = {
  calcul: CalculGren;
  /** La trace de chaque règle employée, par code. */
  traces: Record<string, Trace>;
  referentiel: { code: string; version: string; source: string } | null;
  /** Date à laquelle les règles ont été lues (AAAA-MM-JJ). */
  lueLe: string;
  raison: string | null;
  /** Apports organiques réalisés pris dans Xpro, pour repérer ceux venus après. */
  apportsRealises: string[];
};

type Contexte = {
  regles: ReglesGren<Trace>;
  contexte: ContexteGren;
  referentiel: { code: string; version: string; source: string } | null;
  raison: string | null;
  at: Date;
  cropYear: {
    id: string;
    campaignYear: number;
    parcelId: string;
    farmId: string;
    cropName: string;
  };
};

const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function dateDuBilan(campaignYear: number, openedOn: Date | null): Date {
  return openedOn ?? new Date(Date.UTC(campaignYear, 1, 1));
}

/** Les rendements de la culture sur l'exploitation, campagne par campagne. */
async function rendementsPasses(params: {
  farmId: string;
  cropId: string;
  avant: number;
  annees: number;
}): Promise<ContexteGren['rendements']> {
  const lignes = await prisma.cropYear.findMany({
    where: {
      cropId: params.cropId,
      campaignYear: { gte: params.avant - params.annees, lt: params.avant },
      yieldValue: { not: null },
      parcel: { farmId: params.farmId, deletedAt: null },
    },
    select: { campaignYear: true, yieldValue: true, yieldUnit: true, parcel: { select: { areaHa: true } } },
  });
  const VERS_Q: Record<string, number> = { 'q/ha': 1, 't/ha': 10, 'kg/ha': 0.01 };
  const parCampagne = new Map<number, typeof lignes>();
  for (const l of lignes) parCampagne.set(l.campaignYear, [...(parCampagne.get(l.campaignYear) ?? []), l]);
  const resultat: ContexteGren['rendements'] = [];
  for (const [campagne, ls] of parCampagne) {
    // Moyenne pondérée par la surface, en quintaux quand toutes les unités
    // s'y convertissent (conversion de masse, purement dimensionnelle).
    const convertibles = ls.every((l) => l.yieldUnit && VERS_Q[l.yieldUnit] !== undefined);
    const surface = ls.reduce((s, l) => s + (nombre(l.parcel.areaHa) ?? 0), 0);
    if (surface <= 0) continue;
    if (convertibles) {
      const v = ls.reduce((s, l) => s + Number(l.yieldValue) * VERS_Q[l.yieldUnit!]! * (nombre(l.parcel.areaHa) ?? 0), 0) / surface;
      resultat.push({ campagne, valeur: v, unite: 'q/ha' });
    } else {
      const unites = new Set(ls.map((l) => l.yieldUnit));
      const v = ls.reduce((s, l) => s + Number(l.yieldValue) * (nombre(l.parcel.areaHa) ?? 0), 0) / surface;
      resultat.push({ campagne, valeur: v, unite: unites.size === 1 ? (ls[0]!.yieldUnit ?? null) : null });
    }
  }
  return resultat.sort((a, b) => a.campagne - b.campagne);
}

async function contexteDuPlan(
  cropYearId: string,
  farmId: string,
  saisie: SaisieGren | null,
  /** Date d'ouverture à retenir à la place de celle du plan enregistré. */
  ouverture?: Date | null,
): Promise<Contexte> {
  const cropYear = await prisma.cropYear.findFirst({
    where: { id: cropYearId, parcel: { farmId, deletedAt: null } },
    select: {
      id: true,
      campaignYear: true,
      cropId: true,
      sowingDate: true,
      crop: { select: { name: true } },
      nitrogenPlan: { select: { openedOn: true } },
      parcel: { select: { id: true, inseeCode: true, areaHa: true, farmId: true } },
    },
  });
  if (!cropYear) throw notFound('Culture introuvable');

  const at = dateDuBilan(
    cropYear.campaignYear,
    ouverture !== undefined ? ouverture : (cropYear.nitrogenPlan?.openedOn ?? null),
  );
  const territoires = await territoiresDeLaParcelle(cropYear.parcel.id);
  const lecture = await lireRegles({ referentiel: 'gren', territoires, at });
  const regles = reglesGren(lecture.regles.map((r) => ({ code: r.code, valeur: r.valeur, trace: r.trace })));

  const annees = nombre(regles.get('gren-objectif-rendement')?.valeur.anneesRetenues) ?? 5;
  const rendements = await rendementsPasses({
    farmId,
    cropId: cropYear.cropId,
    avant: cropYear.campaignYear,
    annees,
  });

  const surfaceParcelle = nombre(cropYear.parcel.areaHa) ?? 0;
  const realises = await prisma.fertilizerApplication.findMany({
    where: { cropYearId: cropYear.id, inputType: 'ORGANIC' },
    select: {
      id: true,
      appliedOn: true,
      productLabel: true,
      dose: true,
      doseUnit: true,
      treatedAreaHa: true,
      organicInput: { select: { nContent: true, defaultUnit: true, regulatoryClass: true } },
    },
    orderBy: { appliedOn: 'asc' },
  });
  const apports: ApportOrganiqueGren[] = realises.map((a) => {
    const quantite = quantiteOrganiqueParHa(Number(a.dose), a.doseUnit, a.organicInput?.defaultUnit ?? null);
    const part = surfaceParcelle > 0 ? Math.min((nombre(a.treatedAreaHa) ?? 0) / surfaceParcelle, 1) : 1;
    const c = classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: a.organicInput?.regulatoryClass ?? null });
    return {
      id: a.id,
      libelle: a.productLabel,
      date: a.appliedOn.toISOString().slice(0, 10),
      // Ramené à l'hectare de parcelle : le bilan est celui de la parcelle.
      quantiteParHa: quantite === null ? null : quantite * part,
      teneurAnalyse: nombre(a.organicInput?.nContent),
      classement: { keq: c.keq, teneur: c.teneur, aplsh: c.aplsh },
      prevu: false,
    };
  });

  for (const [i, p] of (saisie?.apportsPrevus ?? []).entries()) {
    const produit = await prisma.organicInput.findFirst({
      where: { id: p.organicInputId, OR: [{ farmId: null }, { farmId }] },
      select: { name: true, nContent: true, defaultUnit: true, regulatoryClass: true },
    });
    if (!produit) throw badRequest('Produit organique prévu introuvable.');
    const c = classementDuProduit({ inputType: 'ORGANIC', regulatoryClass: produit.regulatoryClass });
    apports.push({
      id: `prevu-${i}`,
      libelle: produit.name,
      date: p.date,
      quantiteParHa: quantiteOrganiqueParHa(p.dose, p.unite, produit.defaultUnit),
      teneurAnalyse: nombre(produit.nContent),
      classement: { keq: c.keq, teneur: c.teneur, aplsh: c.aplsh },
      prevu: true,
    });
  }

  // Culture d'hiver : semée avant l'année de récolte. Sans date de semis, on
  // ne le sait pas.
  const cultureDHiver = cropYear.sowingDate
    ? cropYear.sowingDate.getUTCFullYear() < cropYear.campaignYear
    : null;

  return {
    regles,
    contexte: {
      campagne: cropYear.campaignYear,
      departement: departementDepuisInsee(cropYear.parcel.inseeCode),
      rendements,
      apportsOrganiques: apports,
      cultureDHiver,
    },
    referentiel: lecture.referentiel,
    raison: lecture.raison,
    at,
    cropYear: {
      id: cropYear.id,
      campaignYear: cropYear.campaignYear,
      parcelId: cropYear.parcel.id,
      farmId,
      cropName: cropYear.crop.name,
    },
  };
}

function tracesDe(regles: ReglesGren<Trace>, codes: string[]): Record<string, Trace> {
  const traces: Record<string, Trace> = {};
  for (const code of codes) {
    const r = regles.get(code);
    if (r) traces[code] = r.trace;
  }
  return traces;
}

/** Ce que l'écran doit demander pour cette culture, avec les options des fiches. */
export async function descriptionDuPlan(params: {
  cropYearId: string;
  farmId: string;
  saisie: Partial<SaisieGren> & { culture?: string };
}): Promise<{ description: DescriptionSaisie; referentiel: Contexte['referentiel']; raison: string | null; lueLe: string; departement: string | null; cultureDHiver: boolean | null; rendements: ContexteGren['rendements'] }> {
  const c = await contexteDuPlan(params.cropYearId, params.farmId, null);
  return {
    description: decrireSaisie(c.regles, c.contexte, params.saisie),
    referentiel: c.referentiel,
    raison: c.raison,
    lueLe: c.at.toISOString().slice(0, 10),
    departement: c.contexte.departement,
    cultureDHiver: c.contexte.cultureDHiver,
    rendements: c.contexte.rendements,
  };
}

/** Le calcul, sans rien enregistrer. */
export async function calculerPlan(params: {
  cropYearId: string;
  farmId: string;
  saisie: unknown;
  ouverture?: Date | null;
}): Promise<CalculPlan> {
  const saisie = saisieGrenSchema.parse(params.saisie);
  const c = await contexteDuPlan(params.cropYearId, params.farmId, saisie, params.ouverture);
  const calcul = calculerDoseGren(c.regles, c.contexte, saisie);
  if (c.regles.size === 0 && c.raison) {
    calcul.bloquants = [{ terme: 'référentiel', raison: c.raison }];
  }
  return {
    calcul,
    traces: tracesDe(c.regles, calcul.regles),
    referentiel: c.referentiel,
    lueLe: c.at.toISOString().slice(0, 10),
    raison: c.raison,
    apportsRealises: c.contexte.apportsOrganiques.filter((a) => !a.prevu).map((a) => a.id),
  };
}

/**
 * Enregistre le plan : la saisie, et le calcul tel qu'il a été fait, avec ses
 * traces. Un plan verrouillé (campagne close) ne se recalcule plus.
 */
export async function enregistrerPlanGren(params: {
  cropYearId: string;
  farmId: string;
  saisie: unknown;
  /** Date d'ouverture du bilan (AAAA-MM-JJ), quand elle est connue. */
  ouverture?: string | null;
}): Promise<{ planId: string; resultat: CalculPlan }> {
  const saisie = saisieGrenSchema.parse(params.saisie);
  const existant = await prisma.nitrogenPlan.findUnique({
    where: { cropYearId: params.cropYearId },
    select: { id: true, lockedAt: true },
  });
  if (existant?.lockedAt) {
    throw badRequest('Ce plan est verrouillé : la campagne est close.');
  }
  // La date d'ouverture décide de la version des règles : elle s'enregistre
  // avant le calcul.
  const ouverture = params.ouverture ? new Date(`${params.ouverture}T00:00:00Z`) : null;
  if (existant && params.ouverture !== undefined) {
    await prisma.nitrogenPlan.update({ where: { id: existant.id }, data: { openedOn: ouverture } });
  }
  const resultat = await calculerPlan({
    cropYearId: params.cropYearId,
    farmId: params.farmId,
    saisie,
    ...(params.ouverture !== undefined ? { ouverture } : {}),
  });
  const cropYear = await prisma.cropYear.findUniqueOrThrow({
    where: { id: params.cropYearId },
    select: { campaignYear: true },
  });
  const { calcul } = resultat;
  const y = calcul.termes.find((t) => t.terme === 'y');
  const pf = calcul.termes.find((t) => t.terme === 'Pf');
  const computation = {
    moteur: 'gren',
    calculeLe: new Date().toISOString(),
    lueLe: resultat.lueLe,
    referentiel: resultat.referentiel,
    calcul,
    traces: resultat.traces,
    apportsRealises: resultat.apportsRealises,
  };
  const donnees = {
    campaignYear: cropYear.campaignYear,
    soilType: saisie.typeSol ?? null,
    yieldTarget: y?.valeur ?? null,
    yieldTargetUnit: y && y.valeur !== null ? (y.unite ?? null) : null,
    irrigated: !saisie.sansObjet.includes('Nirr') && saisie.irrigation !== undefined,
    irrigationNitrateMgL: saisie.irrigation?.nitratesMgL ?? null,
    irrigationVolumeM3Ha: saisie.irrigation ? saisie.irrigation.volumeMm * 10 : null,
    needKgHa: pf?.valeur ?? null,
    plannedEfficientKgHa: calcul.doseKgHa,
    plannedTotalKgHa: calcul.doseKgHa,
    referentialCode: resultat.referentiel?.code ?? null,
    referentialVersion: resultat.referentiel?.version ?? null,
    grenInputs: saisie as unknown as Prisma.InputJsonValue,
    computation: computation as unknown as Prisma.InputJsonValue,
  };
  const plan = existant
    ? await prisma.nitrogenPlan.update({ where: { id: existant.id }, data: donnees })
    : await prisma.nitrogenPlan.create({
        data: { cropYearId: params.cropYearId, openedOn: ouverture, ...donnees },
      });
  return { planId: plan.id, resultat };
}

/** Le calcul GREN enregistré sur un plan, s'il y en a un. */
export type CalculEnregistre = {
  moteur: 'gren';
  calculeLe: string;
  lueLe: string;
  referentiel: { code: string; version: string; source: string } | null;
  calcul: CalculGren;
  traces: Record<string, Trace>;
  apportsRealises?: string[];
};

export function calculEnregistre(computation: unknown): CalculEnregistre | null {
  if (!computation || typeof computation !== 'object') return null;
  const c = computation as Partial<CalculEnregistre>;
  if (c.moteur !== 'gren' || !c.calcul) return null;
  return c as CalculEnregistre;
}
