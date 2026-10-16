import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
  COVER_DESTRUCTION_METHODS,
  OPERATION_LABELS,
  PARCEL_STATUS_LABELS,
  SOIL_COVER_KINDS,
  currentCampaignYear,
} from '@/lib/constants/agronomy';
import { calculEnregistre } from '@/lib/regulatory/gren';
import { incoherencesDates } from '@/lib/regulatory/soil-cover';
import { computeNutrientBalance } from '@/lib/services/fertilization';
import { nomCulturePac } from '@/lib/pac/codes-cultures';
import {
  evenementApport,
  evenementDocument,
  evenementPhyto,
  evenementTravail,
  evenementsCulture,
  type HistoryEvent,
} from '@/lib/services/history';
import {
  FORMAT_REGISTRES,
  type EvenementFiche,
  type FicheParcelle,
  type RegistresMobile,
} from '@/lib/shared/registres';

/**
 * Registres de toutes les parcelles d'une exploitation, pour l'application.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TOUT D'UN COUP, ET SEULEMENT QUAND ÇA A CHANGÉ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Au champ, on consulte une parcelle là où le réseau manque : la fiche doit
 * être déjà dans le téléphone. Une requête par parcelle ouverte n'y suffirait
 * pas ; l'application reçoit donc les registres de **toute** l'exploitation à
 * la synchronisation.
 *
 * Le volume reste contenu par deux choix :
 *
 *   · un nombre **fixe** de requêtes, quel que soit le nombre de parcelles
 *     (une par table, filtrée sur l'exploitation) — et non une par parcelle,
 *     ce qui ferait cent quarante allers-retours sur un Raspberry Pi ;
 *   · une **empreinte** (`version`) calculée d'abord, à partir des compteurs
 *     et des dates de mise à jour de chaque table : si l'application la
 *     possède déjà, la réponse tient en une ligne. Une suppression fait
 *     baisser un compteur, une modification avance une date, un ajout fait
 *     les deux : l'empreinte change dans chacun de ces cas.
 *
 * Les droits sont ceux de la lecture des registres (`record:read`), vérifiés
 * par la route avant tout appel : l'exploitant et ses membres, et l'expert en
 * mission, en lecture.
 */

const HISTORIQUE_PAR_PARCELLE = 300;

function nombre(v: { toString(): string } | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nombreOuZero(v: { toString(): string } | number): number {
  return nombre(v) ?? 0;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const LIBELLE_COUVERT = new Map(SOIL_COVER_KINDS.map((k) => [k.value, k.label]));
const LIBELLE_DESTRUCTION = new Map(
  COVER_DESTRUCTION_METHODS.map((k) => [k.value, k.label.toLowerCase()]),
);

/**
 * Empreinte des registres de l'exploitation.
 *
 * Le format et la campagne en font partie : un changement de format, ou le
 * passage à une nouvelle campagne, invalide aussi le cache du téléphone.
 */
export async function versionDesRegistres(farmId: string): Promise<string> {
  const parcelle = { parcel: { farmId, deletedAt: null } };
  const [parcelles, cultures, apports, traitements, travaux, couverts, documents, pac] =
    await Promise.all([
      prisma.parcel.aggregate({
        where: { farmId, deletedAt: null },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.cropYear.aggregate({ where: parcelle, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.fertilizerApplication.aggregate({
        where: parcelle,
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.phytosanitaryApplication.aggregate({
        where: parcelle,
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.agriculturalOperation.aggregate({
        where: parcelle,
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.soilCover.aggregate({ where: parcelle, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.document.aggregate({
        where: { farmId, parcelId: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.pacFeature.count({ where: { kind: 'PARCELLE', parcel: { farmId } } }),
    ]);

  const empreinte = [
    FORMAT_REGISTRES,
    currentCampaignYear(),
    parcelles._count._all,
    parcelles._max.updatedAt?.toISOString(),
    cultures._count._all,
    cultures._max.updatedAt?.toISOString(),
    apports._count._all,
    apports._max.updatedAt?.toISOString(),
    traitements._count._all,
    traitements._max.updatedAt?.toISOString(),
    travaux._count._all,
    travaux._max.updatedAt?.toISOString(),
    couverts._count._all,
    couverts._max.updatedAt?.toISOString(),
    documents._count._all,
    documents._max.createdAt?.toISOString(),
    pac,
  ].join('|');

  return createHash('sha256').update(empreinte).digest('hex').slice(0, 24);
}

function versEvenement(e: HistoryEvent): EvenementFiche {
  return { id: e.id, kind: e.kind, date: e.date, title: e.title, details: e.details };
}

/**
 * Les registres, ou « inchangé » si `versionConnue` est déjà la bonne.
 */
export async function registresMobile(
  farmId: string,
  versionConnue?: string | null,
): Promise<RegistresMobile> {
  const version = await versionDesRegistres(farmId);
  if (versionConnue && versionConnue === version) {
    return { format: FORMAT_REGISTRES, version, unchanged: true };
  }

  const surParcelle = { parcel: { farmId, deletedAt: null } };
  const [parcelles, cultures, apports, traitements, travaux, couverts, documents, declarations, sorties] =
    await Promise.all([
      prisma.parcel.findMany({
        where: { farmId, deletedAt: null },
        select: {
          id: true,
          name: true,
          areaHa: true,
          inseeCode: true,
          cadastralRef: true,
          pacId: true,
          parcelType: true,
          status: true,
          notes: true,
          createdAt: true,
          centroidLat: true,
          centroidLng: true,
        },
      }),
      prisma.cropYear.findMany({
        where: surParcelle,
        include: {
          crop: { select: { name: true } },
          nitrogenPlan: { select: { computation: true } },
        },
        orderBy: { campaignYear: 'desc' },
      }),
      prisma.fertilizerApplication.findMany({
        where: surParcelle,
        include: { cropYear: { select: { crop: { select: { name: true } } } } },
        orderBy: { appliedOn: 'desc' },
      }),
      prisma.phytosanitaryApplication.findMany({
        where: surParcelle,
        orderBy: { appliedOn: 'desc' },
      }),
      prisma.agriculturalOperation.findMany({
        where: surParcelle,
        orderBy: { performedOn: 'desc' },
      }),
      prisma.soilCover.findMany({
        where: surParcelle,
        orderBy: [{ sownOn: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.document.findMany({
        where: { farmId, parcelId: { not: null } },
        select: {
          id: true,
          parcelId: true,
          fileName: true,
          description: true,
          category: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pacFeature.findMany({
        where: { kind: 'PARCELLE', parcel: { farmId, deletedAt: null } },
        select: {
          parcelId: true,
          numero: true,
          cropCode: true,
          ilot: { select: { numero: true } },
          campaign: { select: { year: true } },
        },
        orderBy: { campaign: { year: 'desc' } },
      }),
      // Le lot de stock de chaque traitement, pour le reproposer à la
      // correction.
      prisma.stockMovement.findMany({
        where: {
          kind: 'SORTIE',
          phytoApplicationId: { not: null },
          phytoApplication: { parcel: { farmId, deletedAt: null } },
        },
        select: { phytoApplicationId: true, lotId: true },
      }),
    ]);

  // Un seul lot rattaché : c'est lui. Plusieurs : aucun à reproposer, la
  // correction ne touchera pas au stock (voir `ajusterSortieTraitement`).
  const lotsParTraitement = new Map<string, Set<string | null>>();
  for (const s of sorties) {
    if (!s.phytoApplicationId) continue;
    const lots = lotsParTraitement.get(s.phytoApplicationId) ?? new Set();
    lots.add(s.lotId);
    lotsParTraitement.set(s.phytoApplicationId, lots);
  }
  const lotDuTraitement = new Map<string, string>();
  for (const [id, lots] of lotsParTraitement) {
    const [seul] = [...lots];
    if (lots.size === 1 && seul) lotDuTraitement.set(id, seul);
  }

  const fiches: Record<string, FicheParcelle> = {};
  const historiques = new Map<string, HistoryEvent[]>();
  const nomDe = new Map<string, string>();
  const surfaces = new Map<string, number>();

  for (const p of parcelles) {
    nomDe.set(p.id, p.name);
    surfaces.set(p.id, Number(p.areaHa));
    historiques.set(p.id, []);
    fiches[p.id] = {
      parcelId: p.id,
      general: {
        inseeCode: p.inseeCode,
        cadastralRef: p.cadastralRef,
        pacId: p.pacId,
        parcelType: p.parcelType,
        statusLabel: PARCEL_STATUS_LABELS[p.status] ?? p.status,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
        centroid:
          p.centroidLat !== null && p.centroidLng !== null
            ? { lat: p.centroidLat, lng: p.centroidLng }
            : null,
        declarationsPac: [],
      },
      cultures: [],
      couverts: [],
      apports: [],
      bilan: null,
      traitements: [],
      travaux: [],
      historique: [],
      documents: 0,
    };
  }

  const ref = (parcelId: string) => ({ id: parcelId, name: nomDe.get(parcelId) ?? '' });

  for (const d of declarations) {
    if (!d.parcelId) continue;
    fiches[d.parcelId]?.general.declarationsPac.push({
      campagne: d.campaign.year,
      ilot: d.ilot?.numero ?? null,
      numero: d.numero,
      culture: nomCulturePac(d.cropCode),
    });
  }

  for (const cy of cultures) {
    const fiche = fiches[cy.parcelId];
    if (!fiche) continue;
    const plan = calculEnregistre(cy.nitrogenPlan?.computation ?? null);
    fiche.cultures.push({
      id: cy.id,
      cropId: cy.cropId,
      campaignYear: cy.campaignYear,
      notes: cy.notes,
      cropName: cy.crop.name,
      variety: cy.variety,
      sowingDate: iso(cy.sowingDate),
      expectedHarvestDate: iso(cy.expectedHarvestDate),
      actualHarvestDate: iso(cy.actualHarvestDate),
      yieldValue: nombre(cy.yieldValue),
      yieldUnit: cy.yieldUnit,
      planFumure: plan
        ? { doseKgHa: plan.calcul.doseKgHa, bloquants: plan.calcul.bloquants.length }
        : null,
    });
    const { culture, recolte } = evenementsCulture(cy, ref(cy.parcelId));
    historiques.get(cy.parcelId)?.push(culture);
    if (recolte) historiques.get(cy.parcelId)?.push(recolte);
  }

  for (const c of couverts) {
    const fiche = fiches[c.parcelId];
    if (!fiche) continue;
    fiche.couverts.push({
      id: c.id,
      kind: c.kind,
      kindLabel: LIBELLE_COUVERT.get(c.kind) ?? c.kind,
      destructionMethod: c.destructionMethod,
      cropYearId: c.cropYearId,
      areaHa: nombre(c.areaHa),
      notes: c.notes,
      species: c.species,
      sownOn: iso(c.sownOn),
      emergedOn: iso(c.emergedOn),
      destroyedOn: iso(c.destroyedOn),
      destructionLabel: c.destructionMethod
        ? (LIBELLE_DESTRUCTION.get(c.destructionMethod) ?? c.destructionMethod)
        : null,
      incoherences: incoherencesDates(c),
    });
  }

  for (const a of apports) {
    const fiche = fiches[a.parcelId];
    if (!fiche) continue;
    fiche.apports.push({
      id: a.id,
      appliedOn: a.appliedOn.toISOString(),
      organique: a.inputType === 'ORGANIC',
      inputType: a.inputType,
      fertilizerId: a.fertilizerId,
      organicInputId: a.organicInputId,
      cropYearId: a.cropYearId,
      supplier: a.supplier,
      batchNumber: a.batchNumber,
      operator: a.operator,
      productLabel: a.productLabel,
      dose: nombreOuZero(a.dose),
      doseUnit: a.doseUnit,
      treatedAreaHa: nombreOuZero(a.treatedAreaHa),
      totalQuantity: nombreOuZero(a.totalQuantity),
      totalUnit: a.totalUnit,
      n: nombre(a.nSupplied),
      p: nombre(a.pSupplied),
      k: nombre(a.kSupplied),
      cropName: a.cropYear?.crop.name ?? null,
      notes: a.notes,
    });
    historiques.get(a.parcelId)?.push(evenementApport(a, ref(a.parcelId)));
  }

  for (const t of traitements) {
    const fiche = fiches[t.parcelId];
    if (!fiche) continue;
    // Les mêmes mots que la colonne « Conditions » du site.
    const conditions = t.weatherSummary
      ? t.weatherSummary +
        (t.weatherTempC !== null ? `, ${formatFr(nombre(t.weatherTempC), 1)} °C` : '') +
        (t.weatherWindKmh !== null ? `, vent ${formatFr(nombre(t.weatherWindKmh), 1)} km/h` : '')
      : null;
    fiche.traitements.push({
      id: t.id,
      appliedOn: t.appliedOn.toISOString(),
      productId: t.productId,
      cropYearId: t.cropYearId,
      cropLabel: t.cropLabel,
      sprayVolumeLHa: nombre(t.sprayVolumeLHa),
      stockLotId: lotDuTraitement.get(t.id) ?? null,
      productName: t.productName,
      amm: t.amm,
      activeSubstances: t.activeSubstances,
      targetLabel: t.targetLabel,
      dose: nombreOuZero(t.dose),
      doseUnit: t.doseUnit,
      treatedAreaHa: nombreOuZero(t.treatedAreaHa),
      quantityUsed: nombreOuZero(t.quantityUsed),
      quantityUnit: t.quantityUnit,
      conditions,
      operator: t.operator,
      notes: t.notes,
    });
    historiques.get(t.parcelId)?.push(evenementPhyto(t, ref(t.parcelId)));
  }

  for (const o of travaux) {
    const fiche = fiches[o.parcelId];
    if (!fiche) continue;
    let observations = o.notes;
    if (o.type === 'IRRIGATION') {
      const volume = o.irrigationMm
        ? `${formatFr(nombre(o.irrigationMm), 1)} mm`
        : o.irrigationVolumeM3Ha
          ? `${formatFr(nombre(o.irrigationVolumeM3Ha), 0)} m³/ha`
          : 'volume non renseigné';
      const eau = o.waterNitrateMgL
        ? ` · ${formatFr(nombre(o.waterNitrateMgL), 1)} mg/L NO₃`
        : ' · analyse d’eau absente';
      observations = `${volume}${eau}${o.notes ? ` — ${o.notes}` : ''}`;
    }
    fiche.travaux.push({
      id: o.id,
      performedOn: o.performedOn.toISOString(),
      type: o.type,
      typeLabel: OPERATION_LABELS[o.type] ?? o.type,
      notes: o.notes,
      irrigationMm: nombre(o.irrigationMm),
      irrigationVolumeM3Ha: nombre(o.irrigationVolumeM3Ha),
      waterSource: o.waterSource,
      waterNitrateMgL: nombre(o.waterNitrateMgL),
      waterAnalysisOn: iso(o.waterAnalysisOn),
      equipment: o.equipment,
      operator: o.operator,
      durationHours: nombre(o.durationHours),
      observations,
    });
    historiques.get(o.parcelId)?.push(evenementTravail(o, ref(o.parcelId)));
  }

  for (const d of documents) {
    if (!d.parcelId) continue;
    const fiche = fiches[d.parcelId];
    if (!fiche) continue;
    fiche.documents += 1;
    historiques.get(d.parcelId)?.push(evenementDocument(d, ref(d.parcelId)));
  }

  for (const [parcelId, fiche] of Object.entries(fiches)) {
    if (fiche.apports.length > 0) {
      const b = computeNutrientBalance(
        fiche.apports.map((a) => ({
          treatedAreaHa: a.treatedAreaHa,
          nSupplied: a.n,
          pSupplied: a.p,
          kSupplied: a.k,
        })),
        surfaces.get(parcelId),
      );
      fiche.bilan = {
        totalN: b.totalN,
        totalP: b.totalP,
        totalK: b.totalK,
        perHectareN: b.perHectareN,
        perHectareP: b.perHectareP,
        perHectareK: b.perHectareK,
        incompleteCount: b.incompleteCount,
      };
    }
    fiche.historique = (historiques.get(parcelId) ?? [])
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, HISTORIQUE_PAR_PARCELLE)
      .map(versEvenement);
  }

  return {
    format: FORMAT_REGISTRES,
    version,
    unchanged: false,
    farmId,
    campaignYear: currentCampaignYear(),
    generatedAt: new Date().toISOString(),
    parcels: fiches,
  };
}

function formatFr(n: number | null, chiffres: number): string {
  return n === null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: chiffres });
}
