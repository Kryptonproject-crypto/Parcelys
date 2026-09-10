import 'server-only';
import { prisma } from '@/lib/prisma';
import { computeFarmIft } from '@/lib/regulatory/ift';
import { buildNitrogenBalance, comparePlanToActual } from '@/lib/regulatory/nitrogen';
import { getOrComputeParcelContext } from '@/lib/regulatory/geography';
import { getReferentialStates } from '@/lib/regulatory/referentials';
import { constatsCouverture } from '@/lib/regulatory/soil-cover';
import type { FindingLevel, RegulatoryDomain } from '@prisma/client';

/**
 * Synthèse de conformité.
 *
 * ## La phrase qu'on n'écrira jamais
 *
 * « Votre exploitation est conforme. »
 *
 * Parcelys n'en sait rien, et ne peut pas en savoir quoi que ce soit. Il
 * connaît les données qu'on lui a saisies et les référentiels qu'on a bien
 * voulu lui importer. Une exploitation peut être irréprochable dans Parcelys et
 * en infraction sur le terrain — ou l'inverse, si une donnée manque.
 *
 * D'où la formulation retenue partout :
 *
 *     « Aucune anomalie détectée selon les données et référentiels
 *       actuellement disponibles. »
 *
 * Elle est plus longue. Elle est aussi la seule qui soit vraie, et la seule qui
 * ne se retourne pas contre l'agriculteur en cas de contrôle.
 *
 * ## Quatre niveaux, dont un qui compte particulièrement
 *
 *  · `OK`            — vérifié, rien à signaler.
 *  · `INDETERMINE`   — **la vérification n'a pas pu avoir lieu.** Référentiel
 *                      absent, donnée manquante. Ce n'est pas un feu vert, et
 *                      l'interface ne le présente jamais en vert.
 *  · `VERIFICATION`  — quelque chose demande un regard humain.
 *  · `ANOMALIE`      — un écart net à une règle connue.
 *
 * Le niveau `INDETERMINE` est celui qui distingue un logiciel honnête d'un
 * logiciel rassurant. Sans lui, tout ce qui n'est pas vérifié passerait pour
 * vérifié.
 */

export type Finding = {
  domain: RegulatoryDomain;
  level: FindingLevel;
  code: string;
  title: string;
  detail: string;
  action?: string;
  ruleLabel?: string;
  referentialCode?: string;
  referentialVersion?: string;
  sourceLabel?: string;
  parcelId?: string;
  parcelName?: string;
  entity?: string;
  entityId?: string;
};

export type ComplianceReport = {
  farmId: string;
  campaignYear: number;
  generatedAt: string;
  findings: Finding[];
  counts: Record<FindingLevel, number>;
  /**
   * Phrase de synthèse. Volontairement produite ici et pas dans l'interface :
   * dupliquée dans trois écrans, elle finirait par être reformulée dans l'un
   * d'eux, et c'est la reformulation qui affirmerait la conformité.
   */
  summary: string;
  /** Référentiels manquants, qui expliquent les indéterminations. */
  missingReferentials: Array<{ code: string; name: string; degradedWithout: string }>;
};

const VIDE: Record<FindingLevel, number> = {
  OK: 0,
  INDETERMINE: 0,
  VERIFICATION: 0,
  ANOMALIE: 0,
};

/**
 * Construit la synthèse d'une campagne.
 *
 * Ne persiste rien : la synthèse est recalculée à chaque affichage à partir des
 * données du moment. Figer les anomalies en base obligerait à les invalider à
 * chaque correction, et une anomalie corrigée qui subsiste à l'écran fait
 * perdre confiance dans toutes les autres.
 */
export async function buildComplianceReport(params: {
  farmId: string;
  campaignYear: number;
}): Promise<ComplianceReport> {
  const findings: Finding[] = [];

  const parcelles = await prisma.parcel.findMany({
    where: { farmId: params.farmId, deletedAt: null },
    select: { id: true, name: true, areaHa: true },
    orderBy: { name: 'asc' },
  });

  // --- Contexte réglementaire des parcelles --------------------------------
  for (const parcelle of parcelles) {
    const contexte = await getOrComputeParcelContext(parcelle.id);

    if (!contexte) {
      findings.push({
        domain: 'ZONAGE',
        level: 'INDETERMINE',
        code: 'zonage.non-calcule',
        title: 'Contexte réglementaire non déterminé',
        detail: `Le contexte de « ${parcelle.name} » n’a jamais été calculé.`,
        action: 'Ouvrez la parcelle : le contexte est calculé à l’affichage.',
        parcelId: parcelle.id,
        parcelName: parcelle.name,
      });
      continue;
    }

    for (const zone of contexte.zones) {
      if (zone.kind !== 'ZONE_VULNERABLE') continue;
      findings.push({
        domain: 'NITRATES',
        level: 'VERIFICATION',
        code: 'nitrates.zone-vulnerable',
        title: 'Parcelle en zone vulnérable',
        detail:
          zone.coverage === 'totale'
            ? `« ${parcelle.name} » est entièrement en zone vulnérable (${zone.areaHa.toLocaleString('fr-FR')} ha).`
            : `« ${parcelle.name} » est partiellement en zone vulnérable : ` +
              `${zone.areaHa.toLocaleString('fr-FR')} ha sur ${Number(parcelle.areaHa).toLocaleString('fr-FR')} ha.`,
        action: 'Les prescriptions du programme d’actions applicable s’y appliquent.',
        referentialCode: zone.referential.code,
        referentialVersion: zone.referential.version,
        sourceLabel: zone.referential.sourceLabel,
        parcelId: parcelle.id,
        parcelName: parcelle.name,
      });
    }

    for (const manque of contexte.unresolved) {
      findings.push({
        domain: 'ZONAGE',
        level: 'INDETERMINE',
        code: 'zonage.referentiel-absent',
        title: `${manque.what} : impossible de vérifier`,
        detail: `${manque.reason} (parcelle « ${parcelle.name} »)`,
        action: manque.remedy,
        parcelId: parcelle.id,
        parcelName: parcelle.name,
      });
    }
  }

  // --- Plans prévisionnels de fumure ---------------------------------------
  const plans = await prisma.nitrogenPlan.findMany({
    where: {
      campaignYear: params.campaignYear,
      cropYear: { parcel: { farmId: params.farmId, deletedAt: null } },
    },
    include: {
      cropYear: {
        include: {
          parcel: { select: { id: true, name: true } },
          crop: { select: { name: true } },
        },
      },
    },
  });

  const parcellesAvecCulture = await prisma.cropYear.findMany({
    where: {
      campaignYear: params.campaignYear,
      parcel: { farmId: params.farmId, deletedAt: null },
    },
    include: { parcel: { select: { id: true, name: true } }, crop: { select: { name: true } } },
  });

  const avecPlan = new Set(plans.map((p) => p.cropYearId));

  for (const campagne of parcellesAvecCulture) {
    if (avecPlan.has(campagne.id)) continue;
    findings.push({
      domain: 'NITRATES',
      level: 'INDETERMINE',
      code: 'ppf.absent',
      title: 'Aucun plan prévisionnel de fumure',
      detail: `« ${campagne.parcel.name} » — ${campagne.crop.name}, campagne ${params.campaignYear}.`,
      action: 'Créez le plan depuis l’onglet Apports de la parcelle.',
      parcelId: campagne.parcel.id,
      parcelName: campagne.parcel.name,
      entity: 'cropYear',
      entityId: campagne.id,
    });
  }

  for (const plan of plans) {
    const bilan = await buildNitrogenBalance(plan.id);
    const nom = plan.cropYear.parcel.name;

    if (!bilan.computable) {
      findings.push({
        domain: 'NITRATES',
        level: 'INDETERMINE',
        code: 'ppf.bilan-incomplet',
        title: 'Bilan azoté incalculable',
        detail:
          `« ${nom} » : ${bilan.blockers.map((b) => b.label.toLowerCase()).join(', ')} ` +
          `${bilan.blockers.length > 1 ? 'manquent' : 'manque'}.`,
        action: bilan.blockers[0]?.remedy,
        parcelId: plan.cropYear.parcel.id,
        parcelName: nom,
        entity: 'nitrogenPlan',
        entityId: plan.id,
      });
    }

    const comparaison = await comparePlanToActual(plan.id);
    if (comparaison && comparaison.exceeds && !comparaison.justified) {
      findings.push({
        domain: 'NITRATES',
        level: 'ANOMALIE',
        code: 'ppf.depassement-non-justifie',
        title: 'Dépassement du prévisionnel sans justification',
        detail:
          `« ${nom} » : ${comparaison.actualKgHa.toLocaleString('fr-FR')} kg N/ha réalisés ` +
          `pour ${comparaison.plannedKgHa.toLocaleString('fr-FR')} prévus ` +
          `(+${comparaison.deviationKgHa.toLocaleString('fr-FR')} kg N/ha).`,
        action: 'Enregistrez une justification d’écart, avec sa cause et son justificatif.',
        parcelId: plan.cropYear.parcel.id,
        parcelName: nom,
        entity: 'nitrogenPlan',
        entityId: plan.id,
      });
    }
  }

  // --- IFT ------------------------------------------------------------------
  const ift = await computeFarmIft({
    farmId: params.farmId,
    campaignYear: params.campaignYear,
  });

  if (!ift.configured) {
    findings.push({
      domain: 'IFT',
      level: 'INDETERMINE',
      code: 'ift.referentiel-absent',
      title: 'IFT non calculé',
      detail: ift.caveats[0] ?? 'Référentiel des doses de référence absent.',
      action: 'Importez le référentiel depuis Administration → Référentiels.',
    });
  } else if (ift.uncomputed > 0) {
    findings.push({
      domain: 'IFT',
      level: 'VERIFICATION',
      code: 'ift.traitements-non-rapportes',
      title: 'Traitements non pris en compte dans l’IFT',
      detail: ift.caveats.join(' '),
      action: 'Vérifiez la culture et l’unité de dose de ces traitements.',
      referentialCode: ift.source?.code,
      referentialVersion: ift.source?.version,
      sourceLabel: ift.source?.sourceLabel,
    });
  }

  // --- Registre phytosanitaire ---------------------------------------------
  const sansAmm = await prisma.phytosanitaryApplication.count({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      amm: null,
      appliedOn: {
        gte: new Date(Date.UTC(params.campaignYear - 1, 8, 1)),
        lte: new Date(Date.UTC(params.campaignYear, 7, 31, 23, 59, 59)),
      },
    },
  });

  if (sansAmm > 0) {
    findings.push({
      domain: 'PHYTO',
      level: 'VERIFICATION',
      code: 'phyto.amm-manquante',
      title: 'Traitements sans numéro d’AMM',
      detail: `${sansAmm} traitement${sansAmm > 1 ? 's' : ''} enregistré${sansAmm > 1 ? 's' : ''} sans AMM : le registre est incomplet.`,
      action: 'Rattachez ces traitements au catalogue E-Phy, ou reportez l’AMM de l’étiquette.',
    });
  }

  // --- Couverture des sols en interculture ----------------------------------
  //
  // Le module de couverture rend ses propres constats : les périodes et modes
  // de destruction autorisés relèvent du programme d'actions régional, qu'il
  // faut avoir importé. Sans lui, il répond « non vérifiable » — jamais
  // « conforme ».
  for (const constat of await constatsCouverture({
    farmId: params.farmId,
    campaignYear: params.campaignYear,
  })) {
    findings.push({
      domain: 'COUVERTURE',
      level: constat.level,
      code: constat.code,
      title: constat.title,
      detail: constat.detail,
      ...(constat.action ? { action: constat.action } : {}),
      ...(constat.referentialCode ? { referentialCode: constat.referentialCode } : {}),
      parcelId: constat.parcelId,
      parcelName: constat.parcelName,
    });
  }

  // --- Référentiels absents -------------------------------------------------
  const etats = await getReferentialStates();
  const missingReferentials = etats
    .filter((etat) => etat.status === 'NON_CONFIGURE')
    .map((etat) => ({
      code: etat.code,
      name: etat.name,
      degradedWithout: etat.degradedWithout,
    }));

  const counts = { ...VIDE };
  for (const finding of findings) counts[finding.level] += 1;

  return {
    farmId: params.farmId,
    campaignYear: params.campaignYear,
    generatedAt: new Date().toISOString(),
    findings,
    counts,
    summary: summarize(counts, missingReferentials.length),
    missingReferentials,
  };
}

/**
 * La phrase de synthèse.
 *
 * Trois formulations, et aucune ne dit « conforme ». La dernière est la plus
 * importante : quand rien n'a pu être vérifié, dire « aucune anomalie » serait
 * techniquement exact et pratiquement mensonger.
 */
function summarize(
  counts: Record<FindingLevel, number>,
  referentielsManquants: number,
): string {
  const verifiable = counts.ANOMALIE + counts.VERIFICATION;

  if (counts.ANOMALIE > 0) {
    return (
      `${counts.ANOMALIE} anomalie${counts.ANOMALIE > 1 ? 's' : ''} détectée${counts.ANOMALIE > 1 ? 's' : ''} ` +
      'selon les données et référentiels actuellement disponibles.'
    );
  }

  if (verifiable === 0 && counts.INDETERMINE > 0) {
    return (
      'Aucune vérification réglementaire n’a pu être effectuée : ' +
      `${referentielsManquants} référentiel${referentielsManquants > 1 ? 's' : ''} ` +
      `n’${referentielsManquants > 1 ? 'ont' : 'a'} pas été importé${referentielsManquants > 1 ? 's' : ''}. ` +
      'L’absence d’anomalie ne signifie donc rien ici.'
    );
  }

  return (
    'Aucune anomalie détectée selon les données et référentiels actuellement ' +
    `disponibles${counts.INDETERMINE > 0 ? `, mais ${counts.INDETERMINE} point${counts.INDETERMINE > 1 ? 's' : ''} n’${counts.INDETERMINE > 1 ? 'ont' : 'a'} pas pu être vérifié${counts.INDETERMINE > 1 ? 's' : ''}` : ''}.`
  );
}
