import 'server-only';
import { createHash } from 'node:crypto';
import type { CampaignDocumentKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { getReferentialStates } from '@/lib/regulatory/referentials';
import { cahierEpandage } from '@/lib/regulatory/organic-nitrogen';

/**
 * Dossier de contrôle.
 *
 * ## Ce qu'un contrôle demande vraiment
 *
 * Pas « montrez-moi votre logiciel », mais des **pièces** : le registre
 * phytosanitaire de telle campagne, le cahier d'épandage, le certificat
 * individuel, le dernier contrôle du pulvérisateur, le plan prévisionnel de
 * fumure. Chacune est présente ou absente, et l'absence se constate en cinq
 * secondes.
 *
 * Ce module rassemble ce qui existe et **dit ce qui manque**. C'est la seconde
 * partie qui compte : un dossier qui n'afficherait que les pièces présentes se
 * lirait comme complet.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne dit pas que le dossier est « conforme », ni même « complet au regard de
 * la réglementation ». La liste des pièces exigibles dépend du contrôle, de
 * l'exploitation et de ses productions ; Parcelys en connaît une partie, pas la
 * totalité. Il dit donc : « voici ce que je sais assembler, voici ce qui
 * manque parmi ce que je sais chercher ».
 *
 * Le titre du dossier le porte, et ce n'est pas une formule de prudence : un
 * exploitant qui croirait son dossier complet parce que Parcelys l'affiche
 * ainsi arriverait au contrôle sans une pièce que Parcelys ignore.
 */

export type PieceDossier = {
  code: string;
  label: string;
  /** À quoi elle sert, en une phrase. */
  usage: string;
  statut: 'presente' | 'absente' | 'incomplete' | 'perimee';
  /** Ce qu'on a trouvé, ou ce qui manque. */
  detail: string;
  /** Nombre d'éléments (lignes de registre, documents…). */
  compte: number;
  /** Où aller pour la produire ou la compléter. */
  action: string | null;
  /** Documents rattachés, quand la pièce est un justificatif déposé. */
  documents: Array<{
    id: string;
    fileName: string;
    validUntil: Date | null;
    reference: string | null;
  }>;
};

export type DossierControle = {
  farmId: string;
  farmName: string;
  campaignYear: number;
  genereLe: Date;
  pieces: PieceDossier[];
  /** Compte par statut, pour un coup d'œil. */
  compte: Record<PieceDossier['statut'], number>;
  /** Référentiels employés, avec leurs versions — la traçabilité du dossier. */
  referentiels: Array<{ code: string; name: string; version: string | null; status: string }>;
  /** La phrase qui accompagne le dossier. Jamais « complet », jamais « conforme ». */
  avertissement: string;
};

/**
 * Justificatifs que Parcelys sait chercher, et ce qu'ils prouvent.
 *
 * Liste volontairement **ouverte** : elle grandit, elle ne prétend pas être la
 * liste des pièces exigibles. Aucune durée de validité n'y figure — elles
 * relèvent de la réglementation et changent.
 */
const JUSTIFICATIFS = [
  {
    category: 'CERTIPHYTO',
    label: 'Certificat individuel (Certiphyto)',
    usage: 'Atteste l’aptitude à utiliser des produits phytopharmaceutiques.',
    exigeSiPhyto: true,
  },
  {
    category: 'CONTROLE_PULVERISATEUR',
    label: 'Contrôle du pulvérisateur',
    usage: 'Rapport du contrôle périodique obligatoire du matériel de pulvérisation.',
    exigeSiPhyto: true,
  },
  {
    category: 'ATTESTATION_CONSEIL',
    label: 'Attestation de conseil stratégique',
    usage: 'Conseil stratégique phytosanitaire, distinct de la vente.',
    exigeSiPhyto: true,
  },
  {
    category: 'ANALYSE_SOL',
    label: 'Analyse de sol',
    usage: 'Fournit le reliquat azoté qui fonde le plan prévisionnel de fumure.',
    exigeSiPhyto: false,
  },
  {
    category: 'PLAN_EPANDAGE',
    label: 'Plan d’épandage',
    usage: 'Délimite les surfaces aptes à recevoir des effluents.',
    exigeSiPhyto: false,
  },
] as const;

function empreinte(valeur: unknown): string {
  return createHash('sha256').update(JSON.stringify(valeur)).digest('hex');
}

export async function assemblerDossier(params: {
  farmId: string;
  campaignYear: number;
  aujourdHui?: Date;
}): Promise<DossierControle> {
  const maintenant = params.aujourdHui ?? new Date();
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));

  const ferme = await prisma.farm.findUniqueOrThrow({
    where: { id: params.farmId },
    select: { name: true },
  });

  const pieces: PieceDossier[] = [];

  // --- Parcellaire ---------------------------------------------------------
  const parcelles = await prisma.parcel.count({
    where: { farmId: params.farmId, deletedAt: null },
  });
  const sansContour = await prisma.parcel.count({
    where: {
      farmId: params.farmId,
      deletedAt: null,
      geometries: { none: { isCurrent: true } },
    },
  });
  pieces.push({
    code: 'parcellaire',
    label: 'Registre parcellaire',
    usage: 'Identifie les parcelles, leurs surfaces et leurs références.',
    statut: parcelles === 0 ? 'absente' : sansContour > 0 ? 'incomplete' : 'presente',
    detail:
      parcelles === 0
        ? 'Aucune parcelle enregistrée.'
        : sansContour > 0
          ? `${parcelles} parcelle(s), dont ${sansContour} sans contour tracé : ` +
            'les surfaces de ces parcelles ne sont pas calculées par PostGIS.'
          : `${parcelles} parcelle(s), toutes avec un contour.`,
    compte: parcelles,
    action: sansContour > 0 ? 'Tracez les contours manquants depuis la carte.' : null,
    documents: [],
  });

  // --- Registre phytosanitaire --------------------------------------------
  const traitements = await prisma.phytosanitaryApplication.findMany({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      appliedOn: { gte: debut, lte: fin },
    },
    select: { id: true, amm: true, operator: true, targetLabel: true },
  });
  const phytoIncomplets = traitements.filter(
    (t) => !t.amm || !t.operator || !t.targetLabel,
  ).length;

  pieces.push({
    code: 'registre-phyto',
    label: 'Registre phytosanitaire',
    usage: 'Trace chaque traitement : produit, AMM, dose, cible, opérateur, date.',
    statut:
      traitements.length === 0
        ? 'absente'
        : phytoIncomplets > 0
          ? 'incomplete'
          : 'presente',
    detail:
      traitements.length === 0
        ? 'Aucun traitement enregistré sur cette campagne.'
        : phytoIncomplets > 0
          ? `${traitements.length} traitement(s), dont ${phytoIncomplets} incomplet(s) ` +
            '(AMM, cible ou opérateur manquant).'
          : `${traitements.length} traitement(s), tous complets.`,
    compte: traitements.length,
    action:
      phytoIncomplets > 0 ? 'Complétez les traitements signalés dans le registre.' : null,
    documents: [],
  });

  // --- Cahier d'épandage ---------------------------------------------------
  const cahier = await cahierEpandage({
    farmId: params.farmId,
    campaignYear: params.campaignYear,
  });
  pieces.push({
    code: 'cahier-epandage',
    label: 'Cahier d’épandage',
    usage: 'Trace les apports organiques : effluent, dose, parcelle, azote.',
    statut:
      cahier.lignes.length === 0
        ? 'absente'
        : cahier.lignesIncompletes > 0
          ? 'incomplete'
          : 'presente',
    detail:
      cahier.lignes.length === 0
        ? 'Aucun apport organique enregistré sur cette campagne.'
        : `${cahier.lignes.length} épandage(s), ${cahier.totalAzoteKg.toLocaleString('fr-FR')} kg d’azote` +
          (cahier.lignesIncompletes > 0
            ? `, dont ${cahier.lignesIncompletes} ligne(s) incomplète(s).`
            : '.'),
    compte: cahier.lignes.length,
    action:
      cahier.lignesIncompletes > 0
        ? 'Complétez les apports signalés : teneur en azote, opérateur, effluent.'
        : null,
    documents: [],
  });

  // --- Plans prévisionnels de fumure --------------------------------------
  const campagnes = await prisma.cropYear.count({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      campaignYear: params.campaignYear,
    },
  });
  const plans = await prisma.nitrogenPlan.count({
    where: {
      campaignYear: params.campaignYear,
      cropYear: { parcel: { farmId: params.farmId, deletedAt: null } },
    },
  });
  pieces.push({
    code: 'ppf',
    label: 'Plans prévisionnels de fumure',
    usage: 'Justifie la dose d’azote prévue, culture par culture.',
    statut: plans === 0 ? 'absente' : plans < campagnes ? 'incomplete' : 'presente',
    detail:
      campagnes === 0
        ? 'Aucune culture renseignée pour cette campagne.'
        : `${plans} plan(s) pour ${campagnes} culture(s) enregistrée(s).`,
    compte: plans,
    action: plans < campagnes ? 'Établissez les plans manquants.' : null,
    documents: [],
  });

  // --- Justificatifs déposés ----------------------------------------------
  const utilisePhyto = traitements.length > 0;

  for (const justificatif of JUSTIFICATIFS) {
    const documents = await prisma.document.findMany({
      where: { farmId: params.farmId, category: justificatif.category },
      select: { id: true, fileName: true, validUntil: true, reference: true },
      orderBy: [{ validUntil: 'desc' }, { createdAt: 'desc' }],
    });

    // Périmé seulement si **toutes** les pièces le sont : une pièce renouvelée
    // remplace la précédente, et signaler l'ancienne comme périmée serait faux.
    const valides = documents.filter(
      (d) => d.validUntil === null || d.validUntil >= maintenant,
    );
    const perimes = documents.length > 0 && valides.length === 0;

    const requis = justificatif.exigeSiPhyto ? utilisePhyto : true;

    pieces.push({
      code: justificatif.category.toLowerCase(),
      label: justificatif.label,
      usage: justificatif.usage,
      statut:
        documents.length === 0 ? 'absente' : perimes ? 'perimee' : 'presente',
      detail:
        documents.length === 0
          ? requis
            ? 'Aucune pièce déposée.'
            : 'Aucune pièce déposée — sans objet si l’exploitation n’est pas concernée.'
          : perimes
            ? `${documents.length} pièce(s) déposée(s), toutes au-delà de leur date de validité.`
            : `${valides.length} pièce(s) en cours de validité.`,
      compte: documents.length,
      action:
        documents.length === 0 || perimes
          ? 'Déposez la pièce dans Documents, avec sa date de fin de validité.'
          : null,
      documents: documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        validUntil: d.validUntil,
        reference: d.reference,
      })),
    });
  }

  // --- Justificatifs d'écart au prévisionnel -------------------------------
  const ecarts = await prisma.nitrogenPlanDeviation.count({
    where: {
      plan: {
        campaignYear: params.campaignYear,
        cropYear: { parcel: { farmId: params.farmId, deletedAt: null } },
      },
    },
  });
  const rapport = await buildComplianceReport({
    farmId: params.farmId,
    campaignYear: params.campaignYear,
  });
  const depassements = rapport.findings.filter(
    (f) => f.code === 'ppf.depassement-non-justifie',
  ).length;

  pieces.push({
    code: 'justificatifs-ecart',
    label: 'Justificatifs d’écart au prévisionnel',
    usage: 'Explique un apport supérieur au plan : cause, outil de pilotage.',
    statut: depassements > 0 ? 'absente' : ecarts > 0 ? 'presente' : 'presente',
    detail:
      depassements > 0
        ? `${depassements} dépassement(s) sans justification enregistrée.`
        : ecarts > 0
          ? `${ecarts} justification(s) enregistrée(s), aucun dépassement non justifié.`
          : 'Aucun dépassement du prévisionnel à justifier.',
    compte: ecarts,
    action:
      depassements > 0
        ? 'Enregistrez une justification pour chaque dépassement signalé.'
        : null,
    documents: [],
  });

  const compte: Record<PieceDossier['statut'], number> = {
    presente: 0,
    absente: 0,
    incomplete: 0,
    perimee: 0,
  };
  for (const piece of pieces) compte[piece.statut] += 1;

  const etats = await getReferentialStates();

  return {
    farmId: params.farmId,
    farmName: ferme.name,
    campaignYear: params.campaignYear,
    genereLe: maintenant,
    pieces,
    compte,
    referentiels: etats.map((e) => ({
      code: e.code,
      name: e.name,
      version: e.version ?? null,
      status: e.status,
    })),
    // Jamais « complet », jamais « conforme ». La liste des pièces exigibles
    // dépend du contrôle et de l'exploitation ; Parcelys en connaît une partie.
    avertissement:
      'Ce dossier rassemble les pièces que Parcelys sait produire ou retrouver. ' +
      'Il ne prétend pas être la liste des pièces exigibles lors d’un contrôle : ' +
      'celle-ci dépend du contrôle, de l’exploitation et de ses productions. ' +
      'L’absence d’une pièce non listée ici ne signifie pas qu’elle n’est pas demandée.',
  };
}

// ---------------------------------------------------------------------------
// Verrouillage
// ---------------------------------------------------------------------------

export type VerrouillageResultat =
  | { ok: true; id: string; version: number; checksum: string; inchange: boolean }
  | { ok: false; raison: string };

/**
 * Fige un document pour une campagne.
 *
 * Le verrouillage **n'empêche pas de saisir** : l'exploitation continue de
 * travailler. Il crée une copie datée qui ne bougera plus, pour pouvoir
 * répondre à « que contenait le registre que vous avez présenté en mars ? ».
 *
 * Rien n'est jamais écrasé. Si le contenu est identique au dernier verrou, on
 * le dit et on ne crée pas de doublon — une pile de versions identiques rendrait
 * l'historique illisible.
 *
 * Ce qui manquait au moment du verrouillage est conservé **avec** le document.
 * Un registre incomplet reste incomplet ; effacer ses lacunes le maquillerait.
 */
export async function verrouillerDocument(params: {
  farmId: string;
  campaignYear: number;
  kind: CampaignDocumentKind;
  contenu: unknown;
  rowCount: number;
  gaps?: string | null;
  lockedById?: string | null;
  notes?: string | null;
}): Promise<VerrouillageResultat> {
  const checksum = empreinte(params.contenu);

  const dernier = await prisma.campaignDocument.findFirst({
    where: {
      farmId: params.farmId,
      campaignYear: params.campaignYear,
      kind: params.kind,
    },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, checksum: true },
  });

  if (dernier && dernier.checksum === checksum) {
    return {
      ok: true,
      id: dernier.id,
      version: dernier.version,
      checksum,
      inchange: true,
    };
  }

  const document = await prisma.campaignDocument.create({
    data: {
      farmId: params.farmId,
      campaignYear: params.campaignYear,
      kind: params.kind,
      version: (dernier?.version ?? 0) + 1,
      content: params.contenu as never,
      checksum,
      rowCount: params.rowCount,
      gaps: params.gaps ?? null,
      lockedById: params.lockedById ?? null,
      notes: params.notes ?? null,
    },
    select: { id: true, version: true },
  });

  return {
    ok: true,
    id: document.id,
    version: document.version,
    checksum,
    inchange: false,
  };
}

/** Les versions verrouillées d'une campagne, la plus récente en tête. */
export async function documentsVerrouilles(params: {
  farmId: string;
  campaignYear?: number;
}) {
  return prisma.campaignDocument.findMany({
    where: {
      farmId: params.farmId,
      ...(params.campaignYear ? { campaignYear: params.campaignYear } : {}),
    },
    select: {
      id: true,
      campaignYear: true,
      kind: true,
      version: true,
      checksum: true,
      rowCount: true,
      gaps: true,
      lockedAt: true,
      notes: true,
      lockedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ campaignYear: 'desc' }, { kind: 'asc' }, { version: 'desc' }],
  });
}
