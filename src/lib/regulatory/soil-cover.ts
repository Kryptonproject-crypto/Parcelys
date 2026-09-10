import 'server-only';
import type { CoverDestructionMethod, SoilCoverKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getOrComputeParcelContext,
  statutZonage,
  territoiresDeLaParcelle,
} from '@/lib/regulatory/geography';
import { resolveReferential } from '@/lib/regulatory/referentials';

/**
 * Couverture des sols en interculture.
 *
 * ## Ce que Parcelys sait, et ce qu'il ne sait pas
 *
 * En zone vulnérable, le programme d'actions nitrates impose une couverture des
 * sols pendant l'interculture. Mais **les périodes, les espèces admises et les
 * modes de destruction autorisés relèvent du programme d'actions régional** :
 * ils diffèrent d'une région à l'autre et changent d'un programme au suivant.
 *
 * Coder « couverture obligatoire du 1er septembre au 15 novembre » serait
 * inventer une règle. Elle serait fausse pour la plupart des régions, et — bien
 * pire — elle serait fausse **silencieusement** : un exploitant verrait un
 * « conforme » qui ne vaut rien.
 *
 * Ce module enregistre donc ce qui a été fait, et confronte au référentiel
 * régional **quand il est importé**. Sans lui, il répond « non vérifiable » et
 * dit ce qui manque. C'est moins satisfaisant qu'un verdict, et c'est le seul
 * comportement défendable.
 *
 * ## Ce qu'il vérifie sans aucun référentiel
 *
 * Une chose, et elle est utile : la **cohérence interne** des dates saisies.
 * Une destruction avant le semis, une levée avant le semis — ce sont des
 * erreurs de saisie, pas des questions réglementaires, et les signaler ne
 * suppose aucune règle régionale.
 */

export type CouvertureParcelle = {
  parcelId: string;
  parcelName: string;
  couverts: Array<{
    id: string;
    kind: SoilCoverKind;
    species: string | null;
    sownOn: Date | null;
    emergedOn: Date | null;
    destroyedOn: Date | null;
    destructionMethod: CoverDestructionMethod | null;
    areaHa: number | null;
    /** Jours entre le semis et la destruction, quand les deux sont connus. */
    dureeJours: number | null;
    incoherences: string[];
  }>;
  /**
   * La parcelle est-elle en zone vulnérable ?
   *
   * Trois états, et pas deux : `indetermine` couvre l'absence de contour comme
   * l'absence de référentiel. Le confondre avec `dehors` ferait disparaître de
   * l'écran une contrainte qui s'applique peut-être.
   */
  zoneVulnerable: 'dedans' | 'dehors' | 'indetermine';
  /** Le programme régional est-il disponible pour trancher ? */
  referentiel: {
    disponible: boolean;
    code: string;
    version: string | null;
    sourceLabel: string | null;
    /** Ce que Parcelys ne peut pas vérifier faute de ce référentiel. */
    manque: string | null;
  };
};

/**
 * Incohérences de dates : les seules choses vérifiables sans référentiel.
 *
 * Ce ne sont pas des anomalies réglementaires. Ce sont des erreurs de saisie —
 * et les confondre serait aussi trompeur que l'inverse.
 */
export function incoherencesDates(couvert: {
  sownOn: Date | null;
  emergedOn: Date | null;
  destroyedOn: Date | null;
}): string[] {
  const problemes: string[] = [];

  if (couvert.sownOn && couvert.emergedOn && couvert.emergedOn < couvert.sownOn) {
    problemes.push('La levée est antérieure au semis.');
  }
  if (couvert.sownOn && couvert.destroyedOn && couvert.destroyedOn < couvert.sownOn) {
    problemes.push('La destruction est antérieure au semis.');
  }
  if (
    couvert.emergedOn &&
    couvert.destroyedOn &&
    couvert.destroyedOn < couvert.emergedOn
  ) {
    problemes.push('La destruction est antérieure à la levée.');
  }

  return problemes;
}

function joursEntre(debut: Date | null, fin: Date | null): number | null {
  if (!debut || !fin) return null;
  return Math.round((fin.getTime() - debut.getTime()) / 86_400_000);
}

/**
 * État de la couverture d'une exploitation pour une campagne.
 *
 * La campagne culturale court d'août à juillet, comme partout ailleurs dans
 * Parcelys : une interculture d'automne appartient à la campagne qui commence.
 */
export async function couvertureExploitation(params: {
  farmId: string;
  campaignYear: number;
}): Promise<CouvertureParcelle[]> {
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));

  const parcelles = await prisma.parcel.findMany({
    where: { farmId: params.farmId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const resultats: CouvertureParcelle[] = [];

  for (const parcelle of parcelles) {
    const couverts = await prisma.soilCover.findMany({
      where: {
        parcelId: parcelle.id,
        // Un couvert est rattaché à la campagne par sa date de semis quand elle
        // est connue ; à défaut par sa destruction. Sans aucune date, il reste
        // affiché — c'est une saisie incomplète, pas un couvert inexistant.
        OR: [
          { sownOn: { gte: debut, lte: fin } },
          { destroyedOn: { gte: debut, lte: fin } },
          { AND: [{ sownOn: null }, { destroyedOn: null }] },
        ],
      },
      orderBy: [{ sownOn: 'asc' }, { createdAt: 'asc' }],
    });

    const contexte = await getOrComputeParcelContext(parcelle.id);
    const zoneVulnerable = statutZonage(contexte, 'ZONE_VULNERABLE');

    const territoires = await territoiresDeLaParcelle(parcelle.id);
    const referentiel = await resolveReferential({
      code: 'programme-actions-nitrates',
      territories: territoires,
      at: fin,
    });

    resultats.push({
      parcelId: parcelle.id,
      parcelName: parcelle.name,
      couverts: couverts.map((c) => ({
        id: c.id,
        kind: c.kind,
        species: c.species,
        sownOn: c.sownOn,
        emergedOn: c.emergedOn,
        destroyedOn: c.destroyedOn,
        destructionMethod: c.destructionMethod,
        areaHa: c.areaHa === null ? null : Number(c.areaHa),
        dureeJours: joursEntre(c.sownOn, c.destroyedOn),
        incoherences: incoherencesDates(c),
      })),
      zoneVulnerable,
      referentiel: {
        disponible: referentiel !== null,
        code: 'programme-actions-nitrates',
        version: referentiel?.version ?? null,
        sourceLabel: referentiel?.sourceLabel ?? null,
        manque: referentiel
          ? null
          : 'Sans le programme d’actions régional, ni la période de couverture ' +
            'obligatoire, ni les espèces admises, ni les modes de destruction ' +
            'autorisés ne peuvent être vérifiés.',
      },
    });
  }

  return resultats;
}

/**
 * Constats de couverture, au format du rapport de conformité.
 *
 * Trois niveaux seulement, et jamais « conforme » :
 *
 *   · `ANOMALIE`     — incohérence de dates : une erreur de saisie certaine ;
 *   · `VERIFICATION` — parcelle en zone vulnérable sans aucun couvert saisi ;
 *   · `INDETERMINE`  — le référentiel manque, donc rien n'est vérifiable.
 *
 * Le deuxième mérite un mot : l'absence de couvert **saisi** n'est pas l'absence
 * de couvert. Le constat porte donc sur la saisie, pas sur la parcelle.
 */
export async function constatsCouverture(params: {
  farmId: string;
  campaignYear: number;
}): Promise<
  Array<{
    level: 'ANOMALIE' | 'VERIFICATION' | 'INDETERMINE';
    code: string;
    title: string;
    detail: string;
    action?: string;
    parcelId: string;
    parcelName: string;
    referentialCode?: string;
    referentialVersion?: string;
    sourceLabel?: string;
  }>
> {
  const etat = await couvertureExploitation(params);
  const constats: Awaited<ReturnType<typeof constatsCouverture>> = [];

  for (const parcelle of etat) {
    for (const couvert of parcelle.couverts) {
      for (const probleme of couvert.incoherences) {
        constats.push({
          level: 'ANOMALIE',
          code: 'couverture.dates-incoherentes',
          title: 'Dates de couvert incohérentes',
          detail: `${parcelle.parcelName} : ${probleme}`,
          action: 'Corrigez les dates du couvert.',
          parcelId: parcelle.parcelId,
          parcelName: parcelle.parcelName,
        });
      }
    }

    if (parcelle.zoneVulnerable === 'dedans' && parcelle.couverts.length === 0) {
      constats.push({
        level: 'VERIFICATION',
        code: 'couverture.aucune-saisie',
        title: 'Aucun couvert enregistré en zone vulnérable',
        detail:
          `${parcelle.parcelName} est en zone vulnérable et aucun couvert n’est ` +
          'enregistré pour cette campagne. Parcelys constate une absence de saisie, ' +
          'pas une absence de couvert.',
        action: 'Enregistrez le couvert implanté, ou la raison de son absence.',
        parcelId: parcelle.parcelId,
        parcelName: parcelle.parcelName,
      });
    }

    // On le dit dès que la couverture peut s'appliquer — donc aussi quand le
    // zonage lui-même est indéterminé. Se taire dans ce cas laisserait croire
    // que la question ne se pose pas.
    if (!parcelle.referentiel.disponible && parcelle.zoneVulnerable !== 'dehors') {
      constats.push({
        level: 'INDETERMINE',
        code: 'couverture.referentiel-absent',
        title: 'Règles de couverture non vérifiables',
        detail: `${parcelle.parcelName} : ${parcelle.referentiel.manque}`,
        action:
          'Importez le programme d’actions régional : npm run referentiels -- etat',
        parcelId: parcelle.parcelId,
        parcelName: parcelle.parcelName,
        referentialCode: parcelle.referentiel.code,
      });
    }
  }

  return constats;
}
