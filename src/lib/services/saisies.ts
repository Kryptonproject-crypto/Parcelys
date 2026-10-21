import 'server-only';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { badRequest } from '@/lib/api/errors';
import { computeNutrients, computeTotalQuantity } from '@/lib/services/fertilization';
import { decimalWeather, resolveInterventionWeather, type InterventionWeather } from '@/lib/weather';
import type {
  fertilizationUpdateSchema,
  operationSchema,
  phytoApplicationSchema,
} from '@/lib/validation/farming';

/**
 * Ce que deviennent les champs d'une saisie — apport, traitement, travail —,
 * à la création **comme à la modification**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN SEUL ENDROIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Jusqu'à la 0.11.2, une saisie ne se modifiait pas : on la supprimait et on
 * la refaisait. Écrire la modification à côté de la création aurait donné deux
 * calculs de la quantité totale, des éléments fertilisants et de la surface,
 * qui auraient fini par diverger — et un registre dont les lignes ne se
 * calculent pas toutes de la même façon ne se défend pas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'UNE MODIFICATION NE DOIT PAS EFFACER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les formulaires ne montrent pas tous les champs : l'application n'a ni les
 * teneurs saisies d'après une analyse, ni le fournisseur, ni le volume de
 * bouillie. Trois règles évitent qu'une correction faite au champ efface ce
 * qui avait été saisi au bureau :
 *
 *   · **météo** : une modification qui n'en porte aucune garde celle qui était
 *     enregistrée — c'est la météo du jour de l'intervention, pas celle du
 *     jour de la correction ;
 *   · **éléments fertilisants** : voir `fertilizationUpdateSchema` — absents,
 *     une teneur saisie est conservée, une teneur calculée est recalculée ;
 *   · le reste suit le formulaire, qui reprend la valeur enregistrée de tout ce
 *     qu'il ne montre pas.
 */

type Meteo = ReturnType<typeof decimalWeather>;

/** Conditions de l'intervention : relevées, ou conservées à la modification. */
async function meteoDeLaSaisie(
  input: Parameters<typeof resolveInterventionWeather>[0],
  parcelId: string,
  modification: boolean,
): Promise<Partial<Meteo>> {
  const lieu = await prisma.parcel.findUnique({
    where: { id: parcelId },
    select: { centroidLat: true, centroidLng: true },
  });
  const meteo: InterventionWeather = await resolveInterventionWeather(
    input,
    lieu ? { latitude: lieu.centroidLat, longitude: lieu.centroidLng } : null,
  );
  const vide =
    meteo.weatherTempC === null &&
    meteo.weatherWindKmh === null &&
    meteo.weatherHumidity === null &&
    meteo.weatherRainMm === null &&
    meteo.weatherSummary === null;
  if (modification && vide) return {};
  return decimalWeather(meteo);
}

function surfaceTraitee(demandee: number | undefined, parcelleHa: number): number {
  const surface = demandee ?? parcelleHa;
  if (surface <= 0) {
    throw badRequest(
      'La surface traitée doit être supérieure à 0. Dessinez d’abord la géométrie de la parcelle.',
    );
  }
  if (surface > parcelleHa * 1.05) {
    throw badRequest(
      `La surface traitée (${surface.toFixed(4)} ha) dépasse la superficie de la parcelle (${parcelleHa.toFixed(4)} ha).`,
    );
  }
  return surface;
}

async function verifierCulture(cropYearId: string | undefined, parcelId: string): Promise<void> {
  if (!cropYearId) return;
  const campagne = await prisma.cropYear.findFirst({
    where: { id: cropYearId, parcelId },
    select: { id: true },
  });
  if (!campagne) throw badRequest('Culture inconnue pour cette parcelle.');
}

const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

// ---------------------------------------------------------------------------
// Apports
// ---------------------------------------------------------------------------

type ReferenceProduit = {
  mineral: { nPercent: number | null; pPercent: number | null; kPercent: number | null } | null;
  organic: {
    nContent: number | null;
    pContent: number | null;
    kContent: number | null;
    unit: string | null;
  } | null;
  regulatoryClass: unknown;
  libelle: string | null;
};

async function produitFertilisant(
  farmId: string,
  inputType: 'MINERAL' | 'ORGANIC',
  fertilizerId: string | null | undefined,
  organicInputId: string | null | undefined,
): Promise<ReferenceProduit> {
  if (inputType === 'MINERAL' && fertilizerId) {
    const f = await prisma.fertilizer.findFirst({
      where: { id: fertilizerId, OR: [{ farmId: null }, { farmId }] },
    });
    if (!f) throw badRequest('Engrais inconnu pour cette exploitation.');
    return {
      mineral: {
        nPercent: f.nPercent ? Number(f.nPercent) : null,
        pPercent: f.pPercent ? Number(f.pPercent) : null,
        kPercent: f.kPercent ? Number(f.kPercent) : null,
      },
      organic: null,
      regulatoryClass: null,
      libelle: f.name,
    };
  }
  if (inputType === 'ORGANIC' && organicInputId) {
    const o = await prisma.organicInput.findFirst({
      where: { id: organicInputId, OR: [{ farmId: null }, { farmId }] },
    });
    if (!o) throw badRequest('Produit organique inconnu pour cette exploitation.');
    return {
      mineral: null,
      organic: {
        nContent: o.nContent ? Number(o.nContent) : null,
        pContent: o.pContent ? Number(o.pContent) : null,
        kContent: o.kContent ? Number(o.kContent) : null,
        unit: o.defaultUnit,
      },
      regulatoryClass: o.regulatoryClass,
      libelle: o.name,
    };
  }
  return { mineral: null, organic: null, regulatoryClass: null, libelle: null };
}

type ApportEnregistre = {
  inputType: 'MINERAL' | 'ORGANIC';
  productLabel: string;
  fertilizerId: string | null;
  organicInputId: string | null;
  dose: Prisma.Decimal;
  doseUnit: string;
  nSupplied: Prisma.Decimal | null;
  pSupplied: Prisma.Decimal | null;
  kSupplied: Prisma.Decimal | null;
};

/**
 * Les éléments enregistrés étaient-ils saisis, ou calculés ? On recalcule ce
 * que le référentiel donne pour l'apport tel qu'il était : s'il diffère de la
 * valeur enregistrée, c'est qu'elle avait été saisie.
 *
 * Un référentiel modifié depuis fait passer une valeur calculée pour saisie :
 * elle est alors conservée. C'est le sens prudent — garder la valeur du
 * registre plutôt que la réécrire en silence.
 */
async function elementsSaisis(
  farmId: string,
  existant: ApportEnregistre,
): Promise<{ n: boolean; p: boolean; k: boolean }> {
  let ref: ReferenceProduit;
  try {
    ref = await produitFertilisant(farmId, existant.inputType, existant.fertilizerId, existant.organicInputId);
  } catch {
    // Produit retiré du référentiel depuis : rien à recalculer, tout est conservé.
    return { n: true, p: true, k: true };
  }
  const calcul = computeNutrients({
    dose: Number(existant.dose),
    doseUnit: existant.doseUnit,
    mineral: ref.mineral,
    organic: ref.organic,
  });
  const different = (enregistre: Prisma.Decimal | null, calcule: number | null) =>
    enregistre !== null && (calcule === null || Math.abs(Number(enregistre) - calcule) > 0.005);
  return {
    n: different(existant.nSupplied, calcul.nSupplied),
    p: different(existant.pSupplied, calcul.pSupplied),
    k: different(existant.kSupplied, calcul.kSupplied),
  };
}

export type SaisieApport = z.infer<typeof fertilizationUpdateSchema>;

export async function preparerApport(params: {
  farmId: string;
  parcel: { id: string; areaHa: string };
  input: SaisieApport;
  existant?: ApportEnregistre | null;
}) {
  const { farmId, parcel, input, existant } = params;
  const treatedAreaHa = surfaceTraitee(input.treatedAreaHa, Number(parcel.areaHa));
  const ref = await produitFertilisant(farmId, input.inputType, input.fertilizerId, input.organicInputId);
  const productLabel = ref.libelle ?? input.productLabel;

  const { totalQuantity, totalUnit } = computeTotalQuantity(input.dose, input.doseUnit, treatedAreaHa);
  const calcule = computeNutrients({
    dose: input.dose,
    doseUnit: input.doseUnit,
    mineral: ref.mineral,
    organic: ref.organic,
  });

  // Une teneur saisie ne suit l'apport que s'il s'agit du même produit : en
  // changer, c'est changer de teneur.
  const memeProduit =
    existant != null &&
    existant.inputType === input.inputType &&
    (existant.fertilizerId ?? null) === (input.fertilizerId ?? null) &&
    (existant.organicInputId ?? null) === (input.organicInputId ?? null) &&
    (existant.fertilizerId || existant.organicInputId || existant.productLabel === productLabel);
  const saisis =
    existant && memeProduit ? await elementsSaisis(farmId, existant) : { n: false, p: false, k: false };
  const element = (
    demande: number | null | undefined,
    calculee: number | null,
    etaitSaisi: boolean,
    enregistre: Prisma.Decimal | null | undefined,
  ): number | null => {
    if (typeof demande === 'number') return demande;
    if (demande === undefined && etaitSaisi && enregistre != null) return Number(enregistre);
    return calculee;
  };
  const nSupplied = element(input.nSupplied, calcule.nSupplied, saisis.n, existant?.nSupplied);
  const pSupplied = element(input.pSupplied, calcule.pSupplied, saisis.p, existant?.pSupplied);
  const kSupplied = element(input.kSupplied, calcule.kSupplied, saisis.k, existant?.kSupplied);

  await verifierCulture(input.cropYearId, parcel.id);
  const meteo = await meteoDeLaSaisie(input, parcel.id, Boolean(existant));

  return {
    data: {
      ...meteo,
      cropYearId: input.cropYearId ?? null,
      appliedOn: input.appliedOn,
      inputType: input.inputType,
      fertilizerId: input.inputType === 'MINERAL' ? (input.fertilizerId ?? null) : null,
      organicInputId: input.inputType === 'ORGANIC' ? (input.organicInputId ?? null) : null,
      productLabel,
      dose: new Prisma.Decimal(input.dose),
      doseUnit: input.doseUnit,
      treatedAreaHa: new Prisma.Decimal(treatedAreaHa.toFixed(4)),
      totalQuantity: new Prisma.Decimal(totalQuantity),
      totalUnit: input.totalUnit ?? totalUnit,
      nSupplied: dec(nSupplied),
      pSupplied: dec(pSupplied),
      kSupplied: dec(kSupplied),
      supplier: input.supplier ?? null,
      batchNumber: input.batchNumber ?? null,
      operator: input.operator ?? null,
      notes: input.notes ?? null,
    },
    productLabel,
    mineral: ref.mineral,
    regulatoryClass: ref.regulatoryClass,
    totalQuantity,
    totalUnit,
    nSupplied,
    pSupplied,
    kSupplied,
  };
}

// ---------------------------------------------------------------------------
// Traitements phytosanitaires
// ---------------------------------------------------------------------------

export type SaisieTraitement = z.infer<typeof phytoApplicationSchema>;

export async function preparerTraitement(params: {
  parcel: { id: string; areaHa: string };
  input: Omit<SaisieTraitement, 'stockLotId'>;
  modification: boolean;
}) {
  const { parcel, input, modification } = params;
  const treatedAreaHa = surfaceTraitee(input.treatedAreaHa, Number(parcel.areaHa));

  let productName = input.productName;
  let amm = input.amm ?? null;
  let activeSubstances = input.activeSubstances ?? null;
  let productId: string | null = null;

  /*
   * Un produit désigné par son seul numéro d'AMM est rattaché au catalogue.
   *
   * L'application de terrain n'envoyait que le nom et l'AMM, jamais
   * l'identifiant : ses traitements restaient des « saisies libres », et les
   * contrôles du serveur — dose retenue, produit retiré, sol drainé — ne
   * s'appliquaient à aucun d'eux, alors même que le produit avait été choisi
   * au catalogue. L'AMM est l'identifiant officiel : quand un seul produit du
   * catalogue la porte, c'est lui.
   */
  const ammSaisie = input.amm?.trim();
  const identifiant =
    input.productId ||
    (ammSaisie
      ? await prisma.phytosanitaryProduct
          .findMany({ where: { amm: ammSaisie }, select: { id: true }, take: 2 })
          .then((trouves) => (trouves.length === 1 ? trouves[0]!.id : null))
      : null);

  if (identifiant) {
    const product = await prisma.phytosanitaryProduct.findUnique({
      where: { id: identifiant },
      include: { substances: { include: { substance: { select: { name: true } } } } },
    });
    if (!product) {
      throw badRequest(
        'Produit introuvable dans le référentiel E-Phy. Relancez une synchronisation ou saisissez le produit manuellement.',
      );
    }
    productId = product.id;
    productName = product.name;
    amm = product.amm;
    activeSubstances = product.substances.map((s) => s.substance.name).join(', ') || null;
  }

  await verifierCulture(input.cropYearId, parcel.id);
  const { totalQuantity, totalUnit } = computeTotalQuantity(input.dose, input.doseUnit, treatedAreaHa);
  const meteo = await meteoDeLaSaisie(input, parcel.id, modification);
  const mentions = await mentionsDuRegistre(parcel.id, input, modification);

  return {
    data: {
      ...mentions,
      cropYearId: input.cropYearId ?? null,
      appliedOn: input.appliedOn,
      productId,
      productName,
      amm,
      activeSubstances,
      cropLabel: input.cropLabel ?? null,
      targetLabel: input.targetLabel ?? null,
      dose: new Prisma.Decimal(input.dose),
      doseUnit: input.doseUnit,
      sprayVolumeLHa: dec(input.sprayVolumeLHa),
      treatedAreaHa: new Prisma.Decimal(treatedAreaHa.toFixed(4)),
      quantityUsed: new Prisma.Decimal(totalQuantity),
      quantityUnit: totalUnit,
      ...meteo,
      operator: input.operator ?? null,
      notes: input.notes ?? null,
    },
    productId,
    productName,
    amm,
    totalQuantity,
    totalUnit,
  };
}

type MentionsRegistre = {
  startTime?: string | null;
  endTime?: string | null;
  bbchStage?: string | null;
  organicProduction?: boolean | null;
  appliedBy?: 'EXPLOITATION' | 'PRESTATAIRE' | 'ENTRAIDE' | null;
  contractorName?: string | null;
  contractorSiret?: string | null;
};

/**
 * Les mentions ajoutées au registre au 1er janvier 2026 (arrêté du 24 décembre
 * 2025) : heures, stade, conduite biologique, prestataire.
 *
 * Une mention **absente** de la requête n'est pas touchée à la modification :
 * une application de terrain pas encore mise à jour, qui ne les connaît pas,
 * ne doit pas effacer ce qui avait été saisi au bureau.
 *
 * La conduite biologique se lit dans le profil de l'exploitation : toute en
 * bio, oui ; aucune surface en bio, non ; en partie ou non renseignée, c'est
 * la saisie qui le dit, et sans elle la mention reste vide. Elle est figée à
 * la création — une conversion ultérieure ne réécrit pas le passé.
 *
 * Le nom et le SIRET d'un prestataire n'ont de sens que si un prestataire (ou
 * une entraide) a appliqué : pour un traitement fait par l'exploitation, ils
 * sont effacés plutôt que laissés traîner.
 */
async function mentionsDuRegistre(
  parcelId: string,
  input: MentionsRegistre,
  modification: boolean,
): Promise<MentionsRegistre> {
  const mentions: MentionsRegistre = {};
  if (input.startTime !== undefined) mentions.startTime = input.startTime;
  if (input.endTime !== undefined) mentions.endTime = input.endTime;
  if (input.bbchStage !== undefined) mentions.bbchStage = input.bbchStage;

  if (input.appliedBy !== undefined) {
    const tiers = input.appliedBy === 'PRESTATAIRE' || input.appliedBy === 'ENTRAIDE';
    mentions.appliedBy = input.appliedBy;
    mentions.contractorName = tiers ? (input.contractorName ?? null) : null;
    mentions.contractorSiret = tiers ? (input.contractorSiret ?? null) : null;
  } else {
    if (input.contractorName !== undefined) mentions.contractorName = input.contractorName;
    if (input.contractorSiret !== undefined) mentions.contractorSiret = input.contractorSiret;
  }

  if (modification) {
    if (input.organicProduction !== undefined) mentions.organicProduction = input.organicProduction;
  } else {
    const ferme = await prisma.parcel.findUnique({
      where: { id: parcelId },
      select: { farm: { select: { organicFarming: true } } },
    });
    const conduite = ferme?.farm.organicFarming ?? null;
    mentions.organicProduction =
      conduite === 'TOTALE' ? true : conduite === 'AUCUNE' ? false : (input.organicProduction ?? null);
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// Travaux
// ---------------------------------------------------------------------------

export type SaisieTravail = z.infer<typeof operationSchema>;

export async function preparerTravail(params: {
  parcel: { id: string };
  input: SaisieTravail;
  modification: boolean;
}) {
  const { parcel, input, modification } = params;
  const meteo = await meteoDeLaSaisie(input, parcel.id, modification);
  return {
    ...meteo,
    performedOn: input.performedOn,
    type: input.type,
    equipment: input.equipment ?? null,
    operator: input.operator ?? null,
    durationHours: dec(input.durationHours),
    // L'irrigation est un travail sur la parcelle, pas un objet à part : elle
    // s'enregistre ici, avec la même date, le même opérateur et la même météo.
    irrigationVolumeM3Ha: dec(input.irrigationVolumeM3Ha),
    irrigationMm: dec(input.irrigationMm),
    waterSource: input.waterSource ?? null,
    waterNitrateMgL: dec(input.waterNitrateMgL),
    waterAnalysisOn: input.waterAnalysisOn ?? null,
    notes: input.notes ?? null,
  };
}

/**
 * Ce qui a changé, pour le journal : les champs dont la valeur diffère, avec
 * l'avant et l'après. Un registre réglementaire qu'on corrige doit garder la
 * trace de ce qui y était écrit.
 */
export function differences(
  avant: Record<string, unknown>,
  apres: Record<string, unknown>,
  champs: string[],
): Record<string, { avant: unknown; apres: unknown }> {
  const lisible = (v: unknown): unknown =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v instanceof Prisma.Decimal ? Number(v) : v ?? null;
  const ecarts: Record<string, { avant: unknown; apres: unknown }> = {};
  for (const champ of champs) {
    if (!(champ in apres)) continue;
    const a = lisible(avant[champ]);
    const b = lisible(apres[champ]);
    if (JSON.stringify(a) !== JSON.stringify(b)) ecarts[champ] = { avant: a, apres: b };
  }
  return ecarts;
}
