import type {
  ApportFiche,
  CouvertFiche,
  CultureFiche,
  TraitementFiche,
  TravailFiche,
} from '@commun/registres';
import type { OperationKind, QueuedOperation } from './types';

/**
 * Corriger un enregistrement depuis le téléphone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX MOITIÉS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le formulaire de l'application est plus court que celui du site : ni
 * fournisseur, ni numéro de lot d'engrais, ni culture rattachée. Une
 * correction se compose donc de deux moitiés :
 *
 *   · `initial` — ce que le formulaire montre, pré-rempli ;
 *   · `base` — tout le reste de l'enregistrement, renvoyé **tel quel** au
 *     serveur, qui remplace l'enregistrement entier : sans elle, corriger une
 *     dose au champ effacerait le fournisseur saisi au bureau.
 *
 * Trois choses ne sont jamais renvoyées, et le serveur les garde :
 *
 *   · la météo — c'est celle du jour de l'intervention, pas celle du jour de
 *     la correction ;
 *   · les teneurs N, P, K saisies d'après une analyse ;
 *   · le lot de stock, sauf si on en change.
 *
 * Une saisie encore dans la file d'attente se corrige de la même façon : son
 * contenu est réécrit avant de partir.
 */

export type EntryKind = 'phyto' | 'apport' | 'travaux' | 'couvert' | 'culture';

/** Valeurs du formulaire, toutes en texte comme les champs qui les portent. */
export type Initial = {
  date: string;
  notes: string;
  // Communs aux traitements, apports et travaux
  operator?: string;
  /** Surface traitée (ha) ; vide : celle de la parcelle. */
  treatedArea?: string;
  // Phytosanitaire
  productName?: string;
  amm?: string;
  substances?: string;
  cropLabel?: string;
  phytoDose?: string;
  phytoUnit?: string;
  stockLotId?: string;
  targetLabel?: string;
  sprayVolume?: string;
  startTime?: string;
  endTime?: string;
  bbchStage?: string;
  /** `''`, `EXPLOITATION`, `PRESTATAIRE` ou `ENTRAIDE`. */
  appliedBy?: string;
  contractorName?: string;
  contractorSiret?: string;
  /** `''` (non renseigné), `oui` ou `non`. */
  organicProduction?: string;
  // Apport
  inputType?: 'MINERAL' | 'ORGANIC';
  productId?: string;
  productLabel?: string;
  dose?: string;
  doseUnit?: string;
  /** Azote apporté (kg N/ha), saisi pour un produit hors référentiel. */
  nitrogen?: string;
  // Travaux
  operationType?: string;
  equipment?: string;
  irrigationMm?: string;
  waterSource?: string;
  waterNitrate?: string;
  // Couvert
  coverKind?: string;
  species?: string;
  emergedOn?: string;
  destroyedOn?: string;
  destruction?: string;
  // Culture
  cropId?: string;
  campaignYear?: string;
  variety?: string;
  expectedHarvestDate?: string;
  actualHarvestDate?: string;
  yieldValue?: string;
  yieldUnit?: string;
};

export type Correction = {
  /** Enregistrement du serveur corrigé ; absent pour une saisie en file. */
  recordId?: string;
  /** Saisie de la file d'attente corrigée avant son départ. */
  queuedClientId?: string;
  initial: Initial;
  base: Record<string, unknown>;
};

export const KINDS_CREATION: Record<EntryKind, OperationKind> = {
  phyto: 'phyto.create',
  apport: 'fertilization.create',
  travaux: 'operation.create',
  couvert: 'soilCover.create',
  culture: 'cropYear.create',
};

export const KINDS_CORRECTION: Record<EntryKind, OperationKind> = {
  phyto: 'phyto.update',
  apport: 'fertilization.update',
  travaux: 'operation.update',
  couvert: 'soilCover.update',
  culture: 'cropYear.update',
};

export const KINDS_SUPPRESSION: Record<EntryKind, OperationKind> = {
  phyto: 'phyto.delete',
  apport: 'fertilization.delete',
  travaux: 'operation.delete',
  couvert: 'soilCover.delete',
  culture: 'cropYear.delete',
};

/** La nature de formulaire d'une saisie en file, d'après son type. */
export function natureDeLaSaisie(kind: OperationKind): EntryKind | null {
  for (const [nature, k] of Object.entries(KINDS_CREATION) as Array<[EntryKind, OperationKind]>) {
    if (k === kind) return nature;
  }
  return null;
}

const jour = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');
const texte = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);
const ouiNon = (v: unknown): string => (v === true ? 'oui' : v === false ? 'non' : '');

// ---------------------------------------------------------------------------
// Depuis un enregistrement du serveur
// ---------------------------------------------------------------------------

export function correctionApport(a: ApportFiche): Correction {
  return {
    recordId: a.id,
    initial: {
      date: jour(a.appliedOn),
      notes: texte(a.notes),
      inputType: a.inputType,
      productId: a.fertilizerId ?? a.organicInputId ?? '',
      productLabel: a.productLabel,
      dose: texte(a.dose),
      doseUnit: a.doseUnit,
      operator: texte(a.operator),
      treatedArea: texte(a.treatedAreaHa),
      // L'azote ne se saisit que pour un produit hors référentiel : pour un
      // produit du référentiel, il se recalcule.
      nitrogen: a.fertilizerId || a.organicInputId ? '' : texte(a.n),
    },
    base: {
      ...(a.cropYearId ? { cropYearId: a.cropYearId } : {}),
      supplier: a.supplier,
      batchNumber: a.batchNumber,
    },
  };
}

export function correctionTraitement(t: TraitementFiche): Correction {
  return {
    recordId: t.id,
    initial: {
      date: jour(t.appliedOn),
      notes: texte(t.notes),
      productName: t.productName,
      amm: texte(t.amm),
      substances: texte(t.activeSubstances),
      cropLabel: texte(t.cropLabel),
      phytoDose: texte(t.dose),
      phytoUnit: t.doseUnit,
      stockLotId: texte(t.stockLotId),
      targetLabel: texte(t.targetLabel),
      operator: texte(t.operator),
      treatedArea: texte(t.treatedAreaHa),
      sprayVolume: texte(t.sprayVolumeLHa),
      // Une fiche prise avant la 0.12.0 n'a pas ces mentions : `undefined`
      // devient un champ vide, que le serveur ne touche pas tant qu'on ne le
      // remplit pas (voir `Entry`).
      startTime: texte(t.startTime),
      endTime: texte(t.endTime),
      bbchStage: texte(t.bbchStage),
      appliedBy: texte(t.appliedBy),
      contractorName: texte(t.contractorName),
      contractorSiret: texte(t.contractorSiret),
      organicProduction: ouiNon(t.organicProduction),
    },
    base: {
      ...(t.cropYearId ? { cropYearId: t.cropYearId } : {}),
      captureWeather: false,
    },
  };
}

export function correctionTravail(o: TravailFiche): Correction {
  return {
    recordId: o.id,
    initial: {
      date: jour(o.performedOn),
      notes: texte(o.notes),
      operationType: o.type,
      equipment: texte(o.equipment),
      irrigationMm: texte(o.irrigationMm),
      waterSource: texte(o.waterSource),
      waterNitrate: texte(o.waterNitrateMgL),
      operator: texte(o.operator),
    },
    base: {
      ...(o.durationHours !== null ? { durationHours: o.durationHours } : {}),
      ...(o.irrigationVolumeM3Ha !== null ? { irrigationVolumeM3Ha: o.irrigationVolumeM3Ha } : {}),
      ...(o.waterAnalysisOn ? { waterAnalysisOn: jour(o.waterAnalysisOn) } : {}),
    },
  };
}

export function correctionCouvert(c: CouvertFiche): Correction {
  return {
    recordId: c.id,
    initial: {
      date: jour(c.sownOn),
      notes: texte(c.notes),
      coverKind: c.kind,
      species: texte(c.species),
      emergedOn: jour(c.emergedOn),
      destroyedOn: jour(c.destroyedOn),
      destruction: texte(c.destructionMethod),
    },
    base: {
      cropYearId: c.cropYearId,
      areaHa: c.areaHa,
    },
  };
}

export function correctionCulture(c: CultureFiche): Correction {
  return {
    recordId: c.id,
    initial: {
      date: jour(c.sowingDate),
      notes: texte(c.notes),
      cropId: c.cropId,
      campaignYear: String(c.campaignYear),
      variety: texte(c.variety),
      expectedHarvestDate: jour(c.expectedHarvestDate),
      actualHarvestDate: jour(c.actualHarvestDate),
      yieldValue: texte(c.yieldValue),
      yieldUnit: c.yieldUnit ?? 'q/ha',
    },
    base: {},
  };
}

// ---------------------------------------------------------------------------
// Depuis une saisie encore en file
// ---------------------------------------------------------------------------

/**
 * Le contenu d'une saisie en file, remis dans le formulaire. Tout ce que le
 * formulaire ne montre pas — la météo relevée à la saisie, d'abord — reste
 * dans `base` et repart avec elle.
 */
export function correctionDeLaFile(operation: QueuedOperation): { nature: EntryKind; correction: Correction } | null {
  const nature = natureDeLaSaisie(operation.kind);
  if (!nature) return null;
  const p = operation.payload;
  const s = (cle: string) => (typeof p[cle] === 'string' || typeof p[cle] === 'number' ? String(p[cle]) : '');
  const initial: Initial = {
    date: jour(s('appliedOn') || s('performedOn') || s('sownOn') || s('sowingDate')),
    notes: s('notes'),
    productName: s('productName'),
    amm: s('amm'),
    substances: s('activeSubstances'),
    cropLabel: s('cropLabel'),
    phytoDose: nature === 'phyto' ? s('dose') : undefined,
    phytoUnit: nature === 'phyto' ? s('doseUnit') : undefined,
    stockLotId: s('stockLotId'),
    targetLabel: s('targetLabel'),
    operator: s('operator'),
    treatedArea: s('treatedAreaHa'),
    sprayVolume: s('sprayVolumeLHa'),
    startTime: s('startTime'),
    endTime: s('endTime'),
    bbchStage: s('bbchStage'),
    appliedBy: s('appliedBy'),
    contractorName: s('contractorName'),
    contractorSiret: s('contractorSiret'),
    organicProduction: ouiNon(p.organicProduction),
    nitrogen: nature === 'apport' ? s('nSupplied') : undefined,
    inputType: p.inputType === 'ORGANIC' ? 'ORGANIC' : 'MINERAL',
    productId: s('fertilizerId') || s('organicInputId'),
    productLabel: s('productLabel'),
    dose: nature === 'apport' ? s('dose') : undefined,
    doseUnit: nature === 'apport' ? s('doseUnit') : undefined,
    operationType: s('type'),
    equipment: s('equipment'),
    irrigationMm: s('irrigationMm'),
    waterSource: s('waterSource'),
    waterNitrate: s('waterNitrateMgL'),
    coverKind: s('kind'),
    species: s('species'),
    emergedOn: jour(s('emergedOn')),
    destroyedOn: jour(s('destroyedOn')),
    destruction: s('destructionMethod'),
    cropId: s('cropId'),
    campaignYear: s('campaignYear'),
    variety: s('variety'),
    expectedHarvestDate: jour(s('expectedHarvestDate')),
    actualHarvestDate: jour(s('actualHarvestDate')),
    yieldValue: s('yieldValue'),
    yieldUnit: s('yieldUnit'),
  };
  return { nature, correction: { queuedClientId: operation.clientId, initial, base: { ...p } } };
}
