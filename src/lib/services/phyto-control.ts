import 'server-only';
import { prisma } from '@/lib/prisma';
import { checkDose, type UsageForDose } from '@/lib/ephy/dose';
import { drainedSoilSeverity } from '@/lib/ephy/conditions';
import {
  rappelZnt,
  rappelsConditions,
  verifierDelaiAvantRecolte,
  verifierIntervalle,
  verifierNombreApplications,
} from '@/lib/ephy/limites';
import { isAuthorizedStatus } from '@/lib/ephy/search';
import { campagneCourante } from '@/lib/shared/campagne';

/**
 * Contrôles réglementaires au moment d'enregistrer un traitement.
 *
 * Ils vivent côté serveur, et pas seulement dans le formulaire, pour une raison
 * simple : l'application mobile enregistre hors ligne et rejoue sa file par
 * `/api/sync`, qui appelle le même gestionnaire. Un contrôle qui n'existerait
 * que dans le navigateur laisserait passer tout ce qui a été saisi au champ —
 * c'est-à-dire l'essentiel.
 *
 * Ces contrôles **avertissent, ils ne bloquent pas**. Le catalogue E-Phy ne
 * connaît ni les dérogations, ni les mélanges, ni les doses réduites décidées à
 * la parcelle ; et l'étiquette du produit fait foi. Refuser l'enregistrement
 * d'un traitement réellement effectué produirait un registre faux, ce qui est
 * pire qu'un registre annoté.
 */

export type PhytoControlInput = {
  parcelId: string;
  productId: string | null;
  cropLabel: string | null;
  cropYearId: string | null;
  dose: number;
  doseUnit: string;
  appliedOn: Date;
  /**
   * Identifiant du traitement en cours d'enregistrement, quand il existe déjà.
   *
   * La route enregistre la ligne **puis** demande les avertissements : sans
   * cette exclusion, le traitement se compte lui-même, et le deuxième passage
   * d'un produit qui en autorise deux déclenchait déjà l'alerte du troisième.
   * Constaté en écrivant l'essai correspondant.
   *
   * Le rendre facultatif plutôt que d'imposer l'ordre inverse : la file de
   * synchronisation rejoue les saisies par la même route, et déplacer le
   * contrôle avant l'écriture ferait porter à deux appelants une contrainte
   * d'ordre que rien ne rappellerait.
   */
  applicationId?: string | null;
};

/**
 * Construit les avertissements attachés à un enregistrement.
 *
 * Renvoie des phrases prêtes à lire, dans l'ordre où elles importent :
 * l'autorisation du produit d'abord, la dose ensuite, le sol drainé enfin.
 */
export async function buildPhytoWarnings(
  input: PhytoControlInput,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!input.productId) return warnings;

  const [product, parcel] = await Promise.all([
    prisma.phytosanitaryProduct.findUnique({
      where: { id: input.productId },
      include: {
        usages: {
          where: { status: { contains: 'autoris', mode: 'insensitive' } },
          take: 800,
        },
        // Toutes les conditions, et non plus les seules « sol drainé ».
        //
        // Le délai de rentrée, la mention abeilles et les distances aux
        // riverains sont importés depuis le même fichier de l'ANSES et
        // n'étaient jamais remontés à la saisie : la requête les écartait dès
        // la base. Ils pèsent pourtant au moment d'appliquer.
        conditions: true,
      },
    }),
    prisma.parcel.findUnique({
      where: { id: input.parcelId },
      select: { drainedSoil: true },
    }),
  ]);

  if (!product) return warnings;

  // --- Le produit est-il encore autorisé à la date du traitement ? ---------
  if (!isAuthorizedStatus(product.status)) {
    const retrait = product.withdrawnAt;
    if (retrait && input.appliedOn > retrait) {
      warnings.push(
        `${product.name} a été retiré du catalogue E-Phy le ` +
          `${retrait.toLocaleDateString('fr-FR')}, soit avant la date de ce ` +
          'traitement. Vérifiez la date saisie ou le produit employé.',
      );
    } else if (!retrait) {
      warnings.push(
        `${product.name} ne figure pas parmi les produits autorisés du ` +
          'catalogue E-Phy. Vérifiez l’étiquette et le numéro d’AMM.',
      );
    }
  }

  // --- La dose dépasse-t-elle la dose retenue pour cette culture ? ---------
  const crop = input.cropLabel ?? (await cropOfYear(input.cropYearId));
  const controle = checkDose({
    usages: product.usages.map(toUsageForDose),
    crop,
    dose: input.dose,
    doseUnit: input.doseUnit,
  });

  if (controle.verdict === 'depassement' || controle.verdict === 'unites-incomparables') {
    warnings.push(controle.message);
  }
  // « usage-inconnu » n'est un avertissement que si la culture est connue :
  // sans culture renseignée, le silence du catalogue ne dit rien.
  if (controle.verdict === 'usage-inconnu' && crop && crop.trim().length >= 2) {
    warnings.push(controle.message);
  }

  /*
   * --- Les limites de l'usage retenu --------------------------------------
   *
   * Le catalogue publie, pour chaque usage, le nombre maximal d'applications,
   * l'intervalle minimal entre deux, le délai avant récolte et les trois ZNT.
   * Tout cela était importé, stocké, transporté jusqu'ici — et jamais opposé à
   * la saisie. Un troisième passage là où deux sont autorisés ne provoquait
   * aucun avertissement.
   *
   * Ces contrôles n'ont de sens que rapportés à **l'usage effectivement
   * retenu** pour la culture : deux usages d'un même produit peuvent autoriser
   * des nombres de passages différents. `checkDose` rend cet usage ; sans lui,
   * il n'y a rien à opposer.
   */
  const usage = controle.usage;
  if (usage) {
    const campagne = await campagneDuTraitement(input.cropYearId, input.appliedOn);
    const historique = await historiqueDuProduit({
      parcelId: input.parcelId,
      productId: input.productId,
      appliedOn: input.appliedOn,
      campagne,
      exclure: input.applicationId ?? null,
    });

    const limites = [
      verifierNombreApplications({
        produit: product.name,
        maxApplications: usage.maxApplications,
        anterieuresDansLaCampagne: historique.dansLaCampagne,
        campagne,
      }),
      verifierIntervalle({
        produit: product.name,
        minIntervalDays: usage.minIntervalDays,
        appliqueLe: input.appliedOn,
        precedente: historique.precedente,
      }),
      verifierDelaiAvantRecolte({
        produit: product.name,
        preHarvestDelay: usage.preHarvestDelay,
        appliqueLe: input.appliedOn,
        recolte: await recolteDeLaCampagne(input.cropYearId),
      }),
      rappelZnt({
        produit: product.name,
        zntAquaticM: usage.zntAquaticM,
        zntArthropodM: usage.zntArthropodM,
        zntPlantM: usage.zntPlantM,
      }),
    ];

    for (const limite of limites) if (limite) warnings.push(limite);
  }

  // --- Sol drainé ---------------------------------------------------------
  // Seul `true` déclenche l'avertissement : `null` signifie « non renseigné »,
  // et traiter l'inconnu comme « non drainé » reviendrait à taire une
  // interdiction faute d'avoir posé la question.
  if (parcel?.drainedSoil === true) {
    const drainage = product.conditions.filter((c) => c.concernsDrainedSoil);
    const interdiction = drainage.find((c) => drainedSoilSeverity(c.label) === 'interdit');
    const retenue = interdiction ?? drainage[0];
    if (retenue) {
      warnings.push(
        `Parcelle déclarée en sol drainé. Condition d’emploi de ${product.name} ` +
          `(${retenue.category}) : « ${retenue.label} »`,
      );
    }
  }

  // --- Délai de rentrée, pollinisateurs, riverains -------------------------
  //
  // Publiées par l'ANSES dans le même fichier que les conditions de drainage,
  // et jusqu'ici jamais affichées. Le texte est celui de l'ANSES, mot pour mot.
  for (const rappel of rappelsConditions(product.conditions, product.name)) {
    warnings.push(rappel);
  }

  return warnings;
}

/**
 * La campagne à laquelle rattacher ce traitement.
 *
 * Celle de la culture quand le traitement en cite une — c'est elle qui fait
 * foi. Sinon, la campagne culturale de la date d'application : un traitement
 * saisi sans culture appartient tout de même à une campagne, et le nombre de
 * passages se compte par campagne.
 */
async function campagneDuTraitement(
  cropYearId: string | null,
  appliedOn: Date,
): Promise<number> {
  if (cropYearId) {
    const cropYear = await prisma.cropYear.findUnique({
      where: { id: cropYearId },
      select: { campaignYear: true },
    });
    if (cropYear) return cropYear.campaignYear;
  }
  return campagneCourante(appliedOn);
}

/**
 * Ce que cette parcelle a déjà reçu de ce produit.
 *
 * Deux chiffres, et deux questions distinctes :
 *
 *   · `dansLaCampagne` — combien de passages **déjà enregistrés** sur la
 *     campagne, pour le nombre maximal d'applications ;
 *   · `precedente` — la date du dernier passage **antérieur**, pour
 *     l'intervalle minimal.
 *
 * Un traitement postérieur n'entre dans aucun des deux calculs d'intervalle :
 * c'est celui-là qu'il faudrait vérifier, pas celui qu'on saisit. Il compte en
 * revanche dans le nombre de passages de la campagne, puisqu'il a bien eu lieu.
 */
async function historiqueDuProduit(params: {
  parcelId: string;
  productId: string;
  appliedOn: Date;
  campagne: number;
  /** Le traitement en cours d'enregistrement, à ne pas compter comme antérieur. */
  exclure: string | null;
}): Promise<{ dansLaCampagne: number; precedente: Date | null }> {
  const saufLuiMeme = params.exclure ? { id: { not: params.exclure } } : {};

  const [dansLaCampagne, precedent] = await Promise.all([
    prisma.phytosanitaryApplication.count({
      where: {
        parcelId: params.parcelId,
        productId: params.productId,
        cropYear: { campaignYear: params.campagne },
        ...saufLuiMeme,
      },
    }),
    prisma.phytosanitaryApplication.findFirst({
      where: {
        parcelId: params.parcelId,
        productId: params.productId,
        appliedOn: { lt: params.appliedOn },
        ...saufLuiMeme,
      },
      orderBy: { appliedOn: 'desc' },
      select: { appliedOn: true },
    }),
  ]);

  return { dansLaCampagne, precedente: precedent?.appliedOn ?? null };
}

/**
 * La date de récolte de la campagne, réelle si elle est connue, prévue sinon.
 *
 * Sans date, rien n'est rendu — et le délai avant récolte ne dit rien. Supposer
 * une date de récolte pour pouvoir avertir fabriquerait l'infraction.
 */
async function recolteDeLaCampagne(
  cropYearId: string | null,
): Promise<{ date: Date; reelle: boolean } | null> {
  if (!cropYearId) return null;
  const cropYear = await prisma.cropYear.findUnique({
    where: { id: cropYearId },
    select: { actualHarvestDate: true, expectedHarvestDate: true },
  });
  if (cropYear?.actualHarvestDate) {
    return { date: cropYear.actualHarvestDate, reelle: true };
  }
  if (cropYear?.expectedHarvestDate) {
    return { date: cropYear.expectedHarvestDate, reelle: false };
  }
  return null;
}

async function cropOfYear(cropYearId: string | null): Promise<string | null> {
  if (!cropYearId) return null;
  const cropYear = await prisma.cropYear.findUnique({
    where: { id: cropYearId },
    select: { crop: { select: { name: true } } },
  });
  return cropYear?.crop.name ?? null;
}

type UsageRow = {
  id: string;
  cropLabel: string | null;
  targetLabel: string | null;
  usageLabel: string | null;
  doseValue: string | null;
  doseUnit: string | null;
  status: string | null;
  preHarvestDelay: string | null;
  maxApplications: string | null;
  minIntervalDays: string | null;
  zntAquaticM: string | null;
  zntArthropodM: string | null;
  zntPlantM: string | null;
  conditions: string | null;
};

function toUsageForDose(usage: UsageRow): UsageForDose {
  return {
    id: usage.id,
    cropLabel: usage.cropLabel,
    targetLabel: usage.targetLabel,
    usageLabel: usage.usageLabel,
    doseValue: usage.doseValue,
    doseUnit: usage.doseUnit,
    status: usage.status,
    preHarvestDelay: usage.preHarvestDelay,
    maxApplications: usage.maxApplications,
    minIntervalDays: usage.minIntervalDays,
    zntAquaticM: usage.zntAquaticM,
    zntArthropodM: usage.zntArthropodM,
    zntPlantM: usage.zntPlantM,
    conditions: usage.conditions,
  };
}
