import 'server-only';
import { prisma } from '@/lib/prisma';
import { checkDose, type UsageForDose } from '@/lib/ephy/dose';
import { drainedSoilSeverity } from '@/lib/ephy/conditions';
import { isAuthorizedStatus } from '@/lib/ephy/search';

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
        conditions: { where: { concernsDrainedSoil: true } },
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

  // --- Sol drainé ---------------------------------------------------------
  // Seul `true` déclenche l'avertissement : `null` signifie « non renseigné »,
  // et traiter l'inconnu comme « non drainé » reviendrait à taire une
  // interdiction faute d'avoir posé la question.
  if (parcel?.drainedSoil === true && product.conditions.length > 0) {
    const interdiction = product.conditions.find(
      (c) => drainedSoilSeverity(c.label) === 'interdit',
    );
    const retenue = interdiction ?? product.conditions[0];
    if (retenue) {
      warnings.push(
        `Parcelle déclarée en sol drainé. Condition d’emploi de ${product.name} ` +
          `(${retenue.category}) : « ${retenue.label} »`,
      );
    }
  }

  return warnings;
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
