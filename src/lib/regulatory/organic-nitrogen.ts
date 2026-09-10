import 'server-only';
import { prisma } from '@/lib/prisma';
import { resolveReferential } from '@/lib/regulatory/referentials';
import { statutZonage, territoiresDeLaParcelle } from '@/lib/regulatory/geography';
import { getOrComputeParcelContext } from '@/lib/regulatory/geography';

/**
 * Plafond d'azote organique, et cahier d'épandage.
 *
 * ## Pourquoi 170 n'est pas écrit dans ce fichier
 *
 * Le plafond d'azote issu d'effluents d'élevage — 170 kg N/ha de SAU et par an
 * en zone vulnérable — est le chiffre le plus connu de la directive nitrates.
 * Il serait tentant de l'écrire en constante : tout le monde le connaît, il n'a
 * pas changé depuis 1991.
 *
 * Ce serait une erreur, pour trois raisons qui tiennent toutes.
 *
 * **Il ne s'applique pas partout.** Hors zone vulnérable, ce plafond-là n'est
 * pas opposable. Une exploitation entièrement hors zone verrait une alerte qui
 * ne la concerne pas — et cesserait de lire les alertes.
 *
 * **Des dérogations existent.** Certains programmes régionaux, certains
 * systèmes d'élevage relèvent le plafond ou en ajoutent un autre. Un chiffre en
 * dur les ignore toutes.
 *
 * **Un chiffre en dur n'a pas de source.** Un exploitant contrôlé doit pouvoir
 * dire d'où vient la valeur qu'on lui oppose. « C'est écrit dans le logiciel »
 * n'est pas une réponse.
 *
 * Parcelys calcule donc toujours **ce qui a été épandu** — une donnée de
 * l'exploitation, jamais indisponible — et ne le compare à un plafond que si le
 * programme d'actions l'a fourni. Sinon il affiche la quantité et dit que le
 * plafond n'est pas configuré.
 *
 * ## Le cahier d'épandage ne se saisit pas
 *
 * Il est **produit** à partir des apports organiques déjà enregistrés. Le
 * ressaisir aurait créé un second registre, divergent du premier dès le premier
 * oubli — et c'est le second qu'un contrôle lirait.
 */

/** Code de la règle cherchée dans le programme d'actions. */
const CODE_REGLE_PLAFOND = 'plafond-azote-organique';

export type PlafondAzoteOrganique = {
  campaignYear: number;
  /** Azote organique total épandu sur la campagne, en kg. */
  azoteOrganiqueKg: number;
  /** Surface prise en compte, en hectares. */
  surfaceHa: number;
  /** Azote organique rapporté à l'hectare, ou `null` si la surface est nulle. */
  parHectare: number | null;
  /**
   * Le plafond opposable, **tel qu'importé**. `null` quand aucun programme
   * d'actions ne le fournit — et c'est alors ce `null` qui est affiché, pas un
   * 170 supposé.
   */
  plafond: {
    valeurKgHa: number;
    unite: string;
    sourceRef: string | null;
    referentialCode: string;
    referentialVersion: string;
    sourceLabel: string;
    territory: string;
  } | null;
  /**
   * Verdict, dans le vocabulaire du rapport de conformité. Jamais `OK` sans
   * plafond : sans référence, il n'y a rien à vérifier.
   */
  verdict: 'OK' | 'ANOMALIE' | 'VERIFICATION' | 'INDETERMINE';
  /** Ce qui empêche de conclure, quand c'est le cas. */
  manque: string | null;
  /** Les parcelles concernées par une zone vulnérable, s'il y en a. */
  zoneVulnerable: 'dedans' | 'dehors' | 'indetermine' | 'partiel';
  /** Apports pris en compte. */
  apports: number;
};

/**
 * Azote organique épandu sur la campagne, et sa confrontation au plafond.
 *
 * La surface retenue est celle des parcelles ayant reçu un apport organique —
 * pas la SAU déclarée, que Parcelys ne connaît pas toujours. La différence est
 * dite dans le résultat : rapporter à une surface plus grande que la réalité
 * ferait passer un dépassement pour un respect.
 */
export async function plafondAzoteOrganique(params: {
  farmId: string;
  campaignYear: number;
}): Promise<PlafondAzoteOrganique> {
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));

  const apports = await prisma.fertilizerApplication.findMany({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      inputType: 'ORGANIC',
      appliedOn: { gte: debut, lte: fin },
    },
    select: {
      id: true,
      nSupplied: true,
      treatedAreaHa: true,
      parcelId: true,
      productLabel: true,
    },
  });

  let azoteKg = 0;
  let sansAzote = 0;
  const parcellesConcernees = new Set<string>();

  for (const apport of apports) {
    parcellesConcernees.add(apport.parcelId);

    // `nSupplied` est une **dose à l'hectare**, pas un total : `computeNutrients`
    // la calcule depuis la dose et sa documentation le dit. La multiplier par
    // la surface traitée donne les kilos réellement épandus — c'est cela qu'un
    // plafond en kg N/ha de SAU met en rapport avec la surface.
    //
    // Prendre `nSupplied` pour un total aurait divisé le résultat par la
    // surface une fois de trop : sur une exploitation de 300 ha, un épandage à
    // 112 kg N/ha serait ressorti à 1,9 kg N/ha, et aucun dépassement n'aurait
    // jamais été détecté.
    const doseKgHa = apport.nSupplied === null ? null : Number(apport.nSupplied);
    if (doseKgHa === null) {
      sansAzote += 1;
      continue;
    }
    azoteKg += doseKgHa * Number(apport.treatedAreaHa);
  }

  // Surface : celle des parcelles ayant reçu un apport organique. On somme les
  // superficies des parcelles, pas les surfaces traitées : deux apports sur la
  // même parcelle compteraient sa surface deux fois, et le ratio serait divisé
  // par deux — un dépassement passerait alors pour un respect.
  const parcelles = await prisma.parcel.findMany({
    where: { id: { in: [...parcellesConcernees] } },
    select: { id: true, areaHa: true },
  });
  const surfaceHa = parcelles.reduce((somme, p) => somme + Number(p.areaHa), 0);

  // --- Le plafond, s'il a été importé -------------------------------------
  const plafond = await lirePlafond({
    parcelIds: [...parcellesConcernees],
    at: fin,
  });

  // --- Zone vulnérable ----------------------------------------------------
  const statuts = await Promise.all(
    [...parcellesConcernees].map(async (id) =>
      statutZonage(await getOrComputeParcelContext(id), 'ZONE_VULNERABLE'),
    ),
  );
  const zoneVulnerable: PlafondAzoteOrganique['zoneVulnerable'] =
    statuts.length === 0
      ? 'indetermine'
      : statuts.every((s) => s === 'dedans')
        ? 'dedans'
        : statuts.every((s) => s === 'dehors')
          ? 'dehors'
          : statuts.some((s) => s === 'dedans')
            ? 'partiel'
            : 'indetermine';

  const parHectare =
    surfaceHa > 0 ? Number((azoteKg / surfaceHa).toFixed(2)) : null;

  // --- Verdict -------------------------------------------------------------
  let verdict: PlafondAzoteOrganique['verdict'] = 'INDETERMINE';
  let manque: string | null = null;

  if (apports.length === 0) {
    verdict = 'INDETERMINE';
    manque = 'Aucun apport organique enregistré sur cette campagne.';
  } else if (sansAzote > 0) {
    // Un total partiel serait pris pour un total. On refuse de conclure.
    verdict = 'VERIFICATION';
    manque =
      `${sansAzote} apport(s) organique(s) sans teneur en azote renseignée : ` +
      'le total est incomplet et ne peut pas être opposé à un plafond.';
  } else if (!plafond) {
    verdict = 'INDETERMINE';
    manque =
      'Aucun plafond d’azote organique n’est configuré. Le programme d’actions ' +
      'régional le fournit ; sans lui, Parcelys affiche la quantité épandue mais ' +
      'ne la compare à rien. Le plafond de 170 kg N/ha n’est pas écrit dans le ' +
      'logiciel : il ne s’applique pas partout et connaît des dérogations.';
  } else if (parHectare === null) {
    verdict = 'INDETERMINE';
    manque = 'Surface des parcelles concernées inconnue : le ratio est incalculable.';
  } else if (parHectare > plafond.valeurKgHa) {
    verdict = 'ANOMALIE';
  } else {
    verdict = 'OK';
  }

  return {
    campaignYear: params.campaignYear,
    azoteOrganiqueKg: Number(azoteKg.toFixed(2)),
    surfaceHa: Number(surfaceHa.toFixed(4)),
    parHectare,
    plafond,
    verdict,
    manque,
    zoneVulnerable,
    apports: apports.length,
  };
}

/**
 * Cherche le plafond dans le programme d'actions, du territoire le plus précis
 * au plus général.
 *
 * Rend `null` sans rien supposer. C'est le comportement attendu tant qu'aucun
 * programme n'est importé, et il ne doit surtout pas être « amélioré » par une
 * valeur par défaut.
 */
async function lirePlafond(params: {
  parcelIds: string[];
  at: Date;
}): Promise<PlafondAzoteOrganique['plafond']> {
  // Les territoires des parcelles concernées, du plus précis au plus général.
  const territoires = new Set<string>();
  for (const id of params.parcelIds) {
    for (const t of await territoiresDeLaParcelle(id)) territoires.add(t);
  }
  if (territoires.size === 0) territoires.add('FR');

  const referentiel = await resolveReferential({
    code: 'programme-actions-nitrates',
    territories: [...territoires],
    at: params.at,
  });
  if (!referentiel) return null;

  const regle = await prisma.regulatoryRule.findFirst({
    where: {
      referentialId: referentiel.id,
      code: CODE_REGLE_PLAFOND,
      appliesFrom: { lte: params.at },
      OR: [{ appliesTo: null }, { appliesTo: { gte: params.at } }],
    },
    orderBy: { appliesFrom: 'desc' },
  });
  if (!regle) return null;

  // La valeur est en JSON : les règles nitrates n'ont pas toutes la même forme.
  // On lit ce qui est là, et on refuse ce qui n'est pas un nombre — plutôt que
  // de tenter une coercition qui produirait un plafond fantaisiste.
  const brut = regle.value as unknown;
  const valeur =
    typeof brut === 'number'
      ? brut
      : typeof brut === 'object' && brut !== null && 'kgHa' in brut
        ? Number((brut as { kgHa: unknown }).kgHa)
        : Number.NaN;

  if (!Number.isFinite(valeur) || valeur <= 0) return null;

  return {
    valeurKgHa: valeur,
    unite: regle.unit ?? 'kg N/ha',
    sourceRef: regle.sourceRef,
    referentialCode: referentiel.code,
    referentialVersion: referentiel.version,
    sourceLabel: referentiel.sourceLabel,
    territory: regle.territory,
  };
}

// ---------------------------------------------------------------------------
// Cahier d'épandage
// ---------------------------------------------------------------------------

export type LigneEpandage = {
  id: string;
  appliedOn: Date;
  parcelName: string;
  parcelId: string;
  /** Îlot PAC, quand la parcelle en porte un. */
  pacId: string | null;
  cropName: string | null;
  productLabel: string;
  /** Effluent du référentiel, quand l'apport y est rattaché. */
  organicInputName: string | null;
  dose: number;
  doseUnit: string;
  treatedAreaHa: number;
  totalQuantity: number;
  totalUnit: string;
  nSupplied: number | null;
  nParHectare: number | null;
  operator: string | null;
  /** Ce qui manque sur cette ligne pour qu'elle soit opposable. */
  lacunes: string[];
};

export type CahierEpandage = {
  campaignYear: number;
  lignes: LigneEpandage[];
  totalAzoteKg: number;
  /** Lignes incomplètes : le cahier reste produit, mais il le dit. */
  lignesIncompletes: number;
  genereLe: Date;
};

/**
 * Produit le cahier d'épandage d'une campagne.
 *
 * **Rien n'est ressaisi** : chaque ligne vient d'un apport organique déjà
 * enregistré. Un cahier saisi séparément aurait divergé du registre dès le
 * premier oubli, et c'est le cahier qu'un contrôle lirait.
 *
 * Les lignes incomplètes ne sont **pas** écartées. Un cahier amputé de ses
 * lignes gênantes se présenterait mieux et vaudrait moins : ce qui manque est
 * listé sur la ligne elle-même.
 */
export async function cahierEpandage(params: {
  farmId: string;
  campaignYear: number;
}): Promise<CahierEpandage> {
  const debut = new Date(Date.UTC(params.campaignYear - 1, 7, 1));
  const fin = new Date(Date.UTC(params.campaignYear, 6, 31, 23, 59, 59));

  const apports = await prisma.fertilizerApplication.findMany({
    where: {
      parcel: { farmId: params.farmId, deletedAt: null },
      inputType: 'ORGANIC',
      appliedOn: { gte: debut, lte: fin },
    },
    include: {
      parcel: { select: { id: true, name: true, pacId: true } },
      cropYear: { select: { crop: { select: { name: true } } } },
      organicInput: { select: { name: true } },
    },
    orderBy: [{ appliedOn: 'asc' }],
  });

  let totalAzote = 0;
  let incompletes = 0;

  const lignes: LigneEpandage[] = apports.map((a) => {
    const azote = a.nSupplied === null ? null : Number(a.nSupplied);
    const surface = Number(a.treatedAreaHa);
    if (azote !== null) totalAzote += azote;

    const lacunes: string[] = [];
    if (azote === null) lacunes.push('teneur en azote non renseignée');
    if (!a.operator) lacunes.push('opérateur non renseigné');
    if (!a.organicInputId) {
      lacunes.push('effluent non rattaché au référentiel');
    }
    if (lacunes.length > 0) incompletes += 1;

    return {
      id: a.id,
      appliedOn: a.appliedOn,
      parcelName: a.parcel.name,
      parcelId: a.parcel.id,
      pacId: a.parcel.pacId,
      cropName: a.cropYear?.crop.name ?? null,
      productLabel: a.productLabel,
      organicInputName: a.organicInput?.name ?? null,
      dose: Number(a.dose),
      doseUnit: a.doseUnit,
      treatedAreaHa: surface,
      totalQuantity: Number(a.totalQuantity),
      totalUnit: a.totalUnit,
      nSupplied: azote,
      nParHectare:
        azote !== null && surface > 0 ? Number((azote / surface).toFixed(2)) : null,
      operator: a.operator,
      lacunes,
    };
  });

  return {
    campaignYear: params.campaignYear,
    lignes,
    totalAzoteKg: Number(totalAzote.toFixed(2)),
    lignesIncompletes: incompletes,
    genereLe: new Date(),
  };
}
