import 'server-only';
import { prisma } from '@/lib/prisma';
import { resolveReferential } from '@/lib/regulatory/referentials';

/**
 * Plan prévisionnel de fumure et bilan azoté.
 *
 * ## Ce que ce module calcule, et ce qu'il refuse de calculer
 *
 * Le bilan azoté part du besoin de la culture et en retranche les fournitures :
 *
 *     besoin  −  (reliquat + sol + précédent + irrigation + autres)  =  apport
 *
 * Chacun de ces termes vient d'ailleurs. Le besoin et la fourniture du sol
 * relèvent du référentiel régional de calcul ; le reliquat vient d'une analyse
 * de sol ; l'irrigation d'un volume et d'une teneur mesurés. **Aucun n'est
 * inventé ici.** Un terme manquant reste manquant, le bilan le nomme, et
 * l'interface écrit « impossible de calculer : reliquat non renseigné » plutôt
 * que d'afficher un chiffre rassurant.
 *
 * C'est volontairement plus austère qu'un logiciel qui sort toujours une dose.
 * Une dose prévisionnelle fausse se retrouve dans le PPF, dans le bilan, dans
 * le cahier d'enregistrement, et finit opposée à l'agriculteur.
 *
 * ## Ce que le module rend
 *
 * Un objet `NitrogenBalance` qui porte **son propre raisonnement** : chaque
 * ligne dit son libellé, sa valeur, d'où elle vient et pourquoi elle manque le
 * cas échéant. C'est ce que l'écran « voir le détail du calcul » affiche, et
 * c'est ce qui est figé dans `NitrogenPlan.computation` — de sorte qu'une
 * campagne rouverte des années plus tard montre le calcul tel qu'il a été fait,
 * même si le référentiel a changé depuis.
 */

/** Une ligne du bilan : une valeur, ou l'explication de son absence. */
export type BalanceLine = {
  key: string;
  label: string;
  /** `null` quand la valeur n'est pas disponible. */
  valueKgHa: number | null;
  /** D'où vient la valeur : saisie, analyse, référentiel… */
  origin: string;
  /** Pourquoi elle manque. Renseigné seulement si `valueKgHa` est nul. */
  missingReason?: string;
  /** Ce qu'il faut faire pour l'obtenir. */
  remedy?: string;
};

export type NitrogenBalance = {
  /** Besoin total de la culture, en kg N/ha. */
  need: BalanceLine;
  /** Fournitures, détaillées. */
  supplies: BalanceLine[];
  /** Somme des fournitures disponibles. */
  totalSuppliesKgHa: number | null;
  /** Besoin d'apport = besoin − fournitures. Nul si un terme manque. */
  requiredKgHa: number | null;
  /** Apports prévus au plan. */
  plannedKgHa: number;
  /** Écart entre prévu et besoin. Positif = plan supérieur au besoin. */
  planGapKgHa: number | null;
  /** Le bilan est-il exploitable ? */
  computable: boolean;
  /** Ce qui empêche le calcul, listé. */
  blockers: Array<{ label: string; reason: string; remedy: string }>;
  /** Provenance du référentiel employé, quand il y en a un. */
  source: {
    referentialCode: string;
    referentialVersion: string;
    sourceLabel: string;
  } | null;
};

type PlanRow = {
  id: string;
  campaignYear: number;
  yieldTarget: unknown;
  yieldTargetUnit: string | null;
  needKgHa: unknown;
  soilSupplyKgHa: unknown;
  previousCropKgHa: unknown;
  residualKgHa: unknown;
  otherSuppliesKgHa: unknown;
  irrigated: boolean;
  irrigationNitrateMgL: unknown;
  irrigationVolumeM3Ha: unknown;
  soilAnalysisId: string | null;
  previousCrop: string | null;
  referentialCode: string | null;
  referentialVersion: string | null;
  entries: Array<{ efficientKgHa: unknown; totalKgHa: unknown }>;
  soilAnalysis: { residualNitrogenKgHa: unknown; sampledOn: Date } | null;
};

const nombre = (valeur: unknown): number | null => {
  if (valeur === null || valeur === undefined) return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
};

/**
 * Azote apporté par l'eau d'irrigation.
 *
 * Seule conversion que ce module s'autorise, parce qu'elle est purement
 * dimensionnelle et ne suppose aucune donnée agronomique :
 *
 *   mg/L de nitrate × m³/ha  →  kg de nitrate/ha  →  kg d'azote/ha
 *
 * 1 mg/L × 1 m³ = 1 g. La masse d'azote dans le nitrate vaut 14/62 de la masse
 * de nitrate (N = 14, NO₃ = 62). D'où le facteur ci-dessous.
 *
 * La teneur est bien celle du **nitrate** et non de l'azote : c'est ainsi que
 * les analyses d'eau la rendent. Confondre les deux surestimerait la fourniture
 * d'un facteur 4,4 et conduirait à sous-fertiliser.
 */
const N_DANS_NO3 = 14 / 62;

export function irrigationNitrogenKgHa(
  nitrateMgL: number | null,
  volumeM3Ha: number | null,
): number | null {
  if (nitrateMgL === null || volumeM3Ha === null) return null;
  if (nitrateMgL < 0 || volumeM3Ha < 0) return null;
  const grammesNitrate = nitrateMgL * volumeM3Ha;
  return Number(((grammesNitrate / 1000) * N_DANS_NO3).toFixed(2));
}

/**
 * Construit le bilan azoté d'un plan.
 *
 * Ne consulte le référentiel régional que pour l'estampiller : le calcul de la
 * dose prévisionnelle par la méthode du bilan relève de règles régionales que
 * Parcelys ne connaît pas tant qu'un référentiel GREN n'est pas importé. Tant
 * qu'il ne l'est pas, les valeurs saisies à la main font foi et le bilan dit
 * d'où elles viennent.
 */
export async function buildNitrogenBalance(planId: string): Promise<NitrogenBalance> {
  const plan = (await prisma.nitrogenPlan.findUnique({
    where: { id: planId },
    include: {
      entries: { select: { efficientKgHa: true, totalKgHa: true } },
      soilAnalysis: { select: { residualNitrogenKgHa: true, sampledOn: true } },
    },
  })) as PlanRow | null;

  if (!plan) throw new Error(`Plan ${planId} introuvable.`);

  const blockers: NitrogenBalance['blockers'] = [];

  // --- Besoin de la culture ------------------------------------------------
  const besoin = nombre(plan.needKgHa);
  const need: BalanceLine = besoin !== null
    ? {
        key: 'need',
        label: 'Besoin de la culture',
        valueKgHa: besoin,
        origin: plan.referentialCode
          ? `Référentiel ${plan.referentialCode} ${plan.referentialVersion ?? ''}`.trim()
          : 'Saisi manuellement',
      }
    : {
        key: 'need',
        label: 'Besoin de la culture',
        valueKgHa: null,
        origin: '—',
        missingReason:
          'Aucun référentiel régional de calcul importé, et aucune valeur saisie.',
        remedy:
          'Renseignez le besoin, ou importez le référentiel GREN de votre région.',
      };

  if (besoin === null) {
    blockers.push({
      label: 'Besoin de la culture',
      reason: need.missingReason ?? '',
      remedy: need.remedy ?? '',
    });
  }

  // --- Fournitures ---------------------------------------------------------
  const supplies: BalanceLine[] = [];

  const reliquat = nombre(plan.soilAnalysis?.residualNitrogenKgHa) ?? nombre(plan.residualKgHa);
  supplies.push(
    reliquat !== null
      ? {
          key: 'residual',
          label: 'Reliquat azoté sortie hiver',
          valueKgHa: reliquat,
          origin: plan.soilAnalysis
            ? `Analyse de sol du ${plan.soilAnalysis.sampledOn.toLocaleDateString('fr-FR')}`
            : 'Saisi manuellement',
        }
      : {
          key: 'residual',
          label: 'Reliquat azoté sortie hiver',
          valueKgHa: null,
          origin: '—',
          missingReason: 'Aucune analyse de sol rattachée à ce plan.',
          remedy: 'Enregistrez une analyse de sol, ou saisissez le reliquat.',
        },
  );

  const sol = nombre(plan.soilSupplyKgHa);
  supplies.push(
    sol !== null
      ? {
          key: 'soil',
          label: 'Fourniture du sol',
          valueKgHa: sol,
          origin: plan.referentialCode
            ? `Référentiel ${plan.referentialCode}`
            : 'Saisi manuellement',
        }
      : {
          key: 'soil',
          label: 'Fourniture du sol',
          valueKgHa: null,
          origin: '—',
          missingReason: 'Dépend du type de sol et du référentiel régional.',
          remedy: 'Renseignez la valeur, ou importez le référentiel GREN.',
        },
  );

  const precedent = nombre(plan.previousCropKgHa);
  supplies.push(
    precedent !== null
      ? {
          key: 'previous',
          label: `Effet du précédent${plan.previousCrop ? ` (${plan.previousCrop})` : ''}`,
          valueKgHa: precedent,
          origin: plan.referentialCode
            ? `Référentiel ${plan.referentialCode}`
            : 'Saisi manuellement',
        }
      : {
          key: 'previous',
          label: 'Effet du précédent',
          valueKgHa: null,
          origin: '—',
          missingReason: plan.previousCrop
            ? 'Le précédent est connu, mais sa contribution n’est pas chiffrée.'
            : 'Aucun précédent renseigné pour cette parcelle.',
          remedy: 'Renseignez la valeur, ou importez le référentiel GREN.',
        },
  );

  const parIrrigation = plan.irrigated
    ? irrigationNitrogenKgHa(
        nombre(plan.irrigationNitrateMgL),
        nombre(plan.irrigationVolumeM3Ha),
      )
    : 0;
  supplies.push(
    parIrrigation !== null
      ? {
          key: 'irrigation',
          label: 'Azote apporté par l’irrigation',
          valueKgHa: parIrrigation,
          origin: plan.irrigated
            ? 'Calculé depuis le volume et la teneur en nitrate de l’eau'
            : 'Parcelle non irriguée',
        }
      : {
          key: 'irrigation',
          label: 'Azote apporté par l’irrigation',
          valueKgHa: null,
          origin: '—',
          missingReason:
            'La parcelle est déclarée irriguée, mais le volume ou la teneur en nitrate manque.',
          remedy: 'Renseignez le volume (m³/ha) et la teneur en nitrate (mg/L).',
        },
  );

  const autres = nombre(plan.otherSuppliesKgHa) ?? 0;
  supplies.push({
    key: 'other',
    label: 'Autres fournitures',
    valueKgHa: autres,
    origin: nombre(plan.otherSuppliesKgHa) === null ? 'Aucune déclarée' : 'Saisi manuellement',
  });

  for (const ligne of supplies) {
    if (ligne.valueKgHa === null) {
      blockers.push({
        label: ligne.label,
        reason: ligne.missingReason ?? '',
        remedy: ligne.remedy ?? '',
      });
    }
  }

  const toutesDisponibles = supplies.every((l) => l.valueKgHa !== null);
  const totalSuppliesKgHa = toutesDisponibles
    ? Number(supplies.reduce((somme, l) => somme + (l.valueKgHa ?? 0), 0).toFixed(2))
    : null;

  const requiredKgHa =
    besoin !== null && totalSuppliesKgHa !== null
      ? Number(Math.max(besoin - totalSuppliesKgHa, 0).toFixed(2))
      : null;

  // --- Apports prévus ------------------------------------------------------
  const plannedKgHa = Number(
    plan.entries
      .reduce((somme, e) => somme + (nombre(e.efficientKgHa) ?? nombre(e.totalKgHa) ?? 0), 0)
      .toFixed(2),
  );

  const planGapKgHa =
    requiredKgHa !== null ? Number((plannedKgHa - requiredKgHa).toFixed(2)) : null;

  // --- Provenance ----------------------------------------------------------
  let source: NitrogenBalance['source'] = null;
  if (plan.referentialCode) {
    const referentiel = await resolveReferential({
      code: plan.referentialCode,
      territories: [],
      at: new Date(plan.campaignYear, 6, 1),
    });
    if (referentiel) {
      source = {
        referentialCode: referentiel.code,
        referentialVersion: referentiel.version,
        sourceLabel: referentiel.sourceLabel,
      };
    }
  }

  return {
    need,
    supplies,
    totalSuppliesKgHa,
    requiredKgHa,
    plannedKgHa,
    planGapKgHa,
    computable: requiredKgHa !== null,
    blockers,
    source,
  };
}

/**
 * Prévisionnel contre réalisé.
 *
 * Le réalisé n'est pas ressaisi : il est la somme de l'azote des apports déjà
 * enregistrés sur la campagne, ramenée à l'hectare de la parcelle. Une seule
 * saisie, deux lectures — c'est le principe de tout le logiciel.
 */
export type PlanVsActual = {
  plannedKgHa: number;
  actualKgHa: number;
  deviationKgHa: number;
  /** Le réalisé dépasse-t-il le prévisionnel ? */
  exceeds: boolean;
  /** Une justification a-t-elle déjà été enregistrée ? */
  justified: boolean;
  /** Détail des apports pris en compte. */
  applications: Array<{
    id: string;
    appliedOn: string;
    label: string;
    nKgHa: number | null;
  }>;
  /**
   * Irrigation réellement effectuée sur la campagne.
   *
   * Volontairement **hors** de `actualKgHa`, et ce n'est pas un détail : l'eau
   * d'irrigation n'est pas un apport d'engrais, c'est une **fourniture** du
   * bilan. La confondre avec un apport ferait apparaître un dépassement de
   * fertilisation là où il n'y en a pas.
   *
   * Ce qu'elle sert à voir : un écart entre l'irrigation prévue au plan et
   * celle réalisée signifie que la dose prévisionnelle reposait sur une
   * fourniture qui n'a pas été celle-là.
   */
  irrigation: {
    /** Nombre d'événements d'irrigation enregistrés sur la campagne. */
    events: number;
    volumeM3Ha: number | null;
    nKgHa: number | null;
    /** Ce qui empêche de chiffrer l'azote apporté, quand c'est le cas. */
    missing: string | null;
    /** Ce que le plan avait prévu, pour comparer. */
    plannedNKgHa: number | null;
  };
};

/**
 * Azote réellement apporté par l'irrigation sur une campagne.
 *
 * S'appuie sur les opérations de type `IRRIGATION` enregistrées sur la
 * parcelle — pas sur une saisie parallèle. C'est le même geste, au même
 * endroit : un second modèle aurait fatalement divergé du premier.
 *
 * Rend `null` plutôt que zéro dès qu'une donnée manque, en disant laquelle.
 * Zéro se lirait « l'eau n'apporte pas d'azote », ce qui est faux et pousse à
 * sur-fertiliser.
 */
export async function irrigationRealisee(params: {
  parcelId: string;
  campaignYear: number;
}): Promise<{
  events: number;
  volumeM3Ha: number | null;
  nKgHa: number | null;
  missing: string | null;
}> {
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));

  const evenements = await prisma.agriculturalOperation.findMany({
    where: {
      parcelId: params.parcelId,
      type: 'IRRIGATION',
      performedOn: { gte: debut, lte: fin },
    },
    select: {
      irrigationVolumeM3Ha: true,
      irrigationMm: true,
      waterNitrateMgL: true,
    },
  });

  if (evenements.length === 0) {
    return { events: 0, volumeM3Ha: null, nKgHa: null, missing: null };
  }

  let volume = 0;
  let azote = 0;
  let sansVolume = 0;
  let sansTeneur = 0;

  for (const e of evenements) {
    // 1 mm sur 1 ha = 10 m³. Conversion purement dimensionnelle, comme celle
    // du nitrate : elle ne suppose aucune donnée agronomique.
    const m3Ha =
      nombre(e.irrigationVolumeM3Ha) ??
      (nombre(e.irrigationMm) !== null ? (nombre(e.irrigationMm) as number) * 10 : null);

    if (m3Ha === null) {
      sansVolume += 1;
      continue;
    }
    volume += m3Ha;

    const teneur = nombre(e.waterNitrateMgL);
    if (teneur === null) {
      sansTeneur += 1;
      continue;
    }
    azote += irrigationNitrogenKgHa(teneur, m3Ha) ?? 0;
  }

  const manques: string[] = [];
  if (sansVolume > 0) {
    manques.push(`${sansVolume} irrigation(s) sans volume ni hauteur d’eau`);
  }
  if (sansTeneur > 0) {
    manques.push(
      `${sansTeneur} irrigation(s) sans analyse de l’eau (teneur en nitrate)`,
    );
  }

  return {
    events: evenements.length,
    volumeM3Ha: volume > 0 ? Number(volume.toFixed(2)) : null,
    // Un total partiel serait pris pour un total. On ne chiffre que si tout
    // est renseigné.
    nKgHa: manques.length === 0 ? Number(azote.toFixed(2)) : null,
    missing:
      manques.length === 0
        ? null
        : `${manques.join(' · ')} : l’azote apporté par l’eau n’est pas chiffrable.`,
  };
}

export async function comparePlanToActual(planId: string): Promise<PlanVsActual | null> {
  const plan = await prisma.nitrogenPlan.findUnique({
    where: { id: planId },
    include: {
      entries: { select: { efficientKgHa: true, totalKgHa: true } },
      deviations: { select: { id: true } },
      cropYear: { select: { id: true, parcelId: true, campaignYear: true } },
    },
  });
  if (!plan) return null;

  const apports = await prisma.fertilizerApplication.findMany({
    where: { cropYearId: plan.cropYear.id },
    select: {
      id: true,
      appliedOn: true,
      productLabel: true,
      nSupplied: true,
      treatedAreaHa: true,
    },
    orderBy: { appliedOn: 'asc' },
  });

  const applications = apports.map((apport) => {
    const surface = nombre(apport.treatedAreaHa) ?? 0;
    const azoteTotal = nombre(apport.nSupplied);
    return {
      id: apport.id,
      appliedOn: apport.appliedOn.toISOString(),
      label: apport.productLabel,
      // `nSupplied` porte l'azote total de l'apport, pas la dose à l'hectare.
      nKgHa:
        azoteTotal !== null && surface > 0
          ? Number((azoteTotal / surface).toFixed(2))
          : null,
    };
  });

  const actualKgHa = Number(
    applications.reduce((somme, a) => somme + (a.nKgHa ?? 0), 0).toFixed(2),
  );
  const plannedKgHa = Number(
    plan.entries
      .reduce((somme, e) => somme + (nombre(e.efficientKgHa) ?? nombre(e.totalKgHa) ?? 0), 0)
      .toFixed(2),
  );

  const deviationKgHa = Number((actualKgHa - plannedKgHa).toFixed(2));

  const irrigation = await irrigationRealisee({
    parcelId: plan.cropYear.parcelId,
    campaignYear: plan.cropYear.campaignYear,
  });

  return {
    plannedKgHa,
    actualKgHa,
    deviationKgHa,
    exceeds: deviationKgHa > 0,
    justified: plan.deviations.length > 0,
    applications,
    irrigation: {
      ...irrigation,
      plannedNKgHa: plan.irrigated
        ? irrigationNitrogenKgHa(
            nombre(plan.irrigationNitrateMgL),
            nombre(plan.irrigationVolumeM3Ha),
          )
        : null,
    },
  };
}
