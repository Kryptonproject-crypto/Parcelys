import 'server-only';
import { prisma } from '@/lib/prisma';
import {
  parseCsv,
  parseFrenchDate,
  pick,
  resolveColumns,
  splitSubstances,
  type CsvRow,
} from '@/lib/ephy/parser';
import {
  CONDITION_COLUMNS,
  PRODUCT_COLUMNS,
  REQUIRED_PRODUCT_FIELDS,
  SUBSTANCE_COLUMNS,
  USAGE_COLUMNS,
  looksLikeUsageLabel,
  normalizeSearchTerm,
  splitUsageLabel,
} from '@/lib/ephy/schema';
import { conditionConcernsDrainedSoil } from '@/lib/ephy/conditions';

export type ImportSource = {
  /** Contenu du CSV « produits » de l'archive officielle. */
  products: Buffer;
  /** Contenu du CSV « usages » (optionnel selon l'édition du jeu de données). */
  usages?: Buffer;
  /** Contenu du CSV « substances actives » (optionnel). */
  substances?: Buffer;
  /** Contenu du CSV « conditions d'emploi » (optionnel). */
  conditions?: Buffer;
};

export type ImportReport = {
  productCount: number;
  substanceCount: number;
  usageCount: number;
  conditionCount: number;
  warnings: string[];
};

const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Importe une édition du jeu de données E-Phy.
 *
 * Principes :
 *  - aucune valeur n'est inventée : une colonne absente laisse le champ vide ;
 *  - l'import est idempotent (upsert sur le numéro d'AMM) ;
 *  - les usages d'un produit sont remplacés intégralement pour éviter les
 *    doublons entre deux éditions.
 */
export async function importEphyData(
  source: ImportSource,
  meta: { sourceUrl?: string; version?: string; sourceLabel: string },
): Promise<ImportReport> {
  const warnings: string[] = [];

  const run = await prisma.ephySyncRun.create({
    data: {
      status: 'RUNNING',
      source: meta.sourceLabel,
      sourceUrl: meta.sourceUrl ?? null,
      version: meta.version ?? null,
    },
  });

  try {
    const substanceCount = source.substances
      ? await importSubstances(source.substances, warnings)
      : 0;

    const { productCount, ammToId } = await importProducts(source.products, warnings);

    const usageCount = source.usages
      ? await importUsages(source.usages, ammToId, warnings)
      : 0;

    if (!source.usages) {
      warnings.push(
        "Aucun fichier d'usages fourni : les cultures, cibles et doses autorisées ne sont pas renseignées.",
      );
    }

    const conditionCount = source.conditions
      ? await importConditions(source.conditions, ammToId, warnings)
      : 0;

    if (!source.conditions) {
      warnings.push(
        "Aucun fichier de conditions d'emploi fourni : les restrictions (sol drainé, " +
          'dispositif végétalisé, protection de l’opérateur) ne sont pas renseignées.',
      );
    }

    await prisma.ephySyncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        productCount,
        substanceCount,
        usageCount,
        errorMessage: warnings.length ? warnings.join(' | ').slice(0, 2000) : null,
      },
    });

    return { productCount, substanceCount, usageCount, conditionCount, warnings };
  } catch (error) {
    await prisma.ephySyncRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message.slice(0, 2000) : 'Erreur inconnue',
      },
    });
    throw error;
  }
}

async function importSubstances(buffer: Buffer, warnings: string[]): Promise<number> {
  const rows = parseCsv(buffer);
  if (rows.length === 0) return 0;

  const { resolved, missing } = resolveColumns(
    Object.keys(rows[0] ?? {}),
    SUBSTANCE_COLUMNS,
  );
  if (!resolved.name) {
    warnings.push(
      'Fichier substances ignoré : colonne du nom de substance introuvable.',
    );
    return 0;
  }
  if (missing.includes('casNumber')) {
    warnings.push('Numéro CAS absent du fichier substances.');
  }

  const seen = new Map<string, { name: string; casNumber: string | null }>();
  for (const row of rows) {
    const name = pick(row, resolved, 'name');
    if (!name) continue;
    const normalized = normalizeSearchTerm(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.set(normalized, { name, casNumber: pick(row, resolved, 'casNumber') ?? null });
  }

  for (const batch of chunk([...seen.entries()], BATCH_SIZE)) {
    await prisma.$transaction(
      batch.map(([normalizedName, data]) =>
        prisma.activeSubstance.upsert({
          where: { normalizedName },
          create: { name: data.name, normalizedName, casNumber: data.casNumber },
          update: { name: data.name, casNumber: data.casNumber },
        }),
      ),
    );
  }

  return seen.size;
}

async function importProducts(
  buffer: Buffer,
  warnings: string[],
): Promise<{ productCount: number; ammToId: Map<string, string> }> {
  const rows = parseCsv(buffer);
  if (rows.length === 0) {
    throw new Error('Le fichier produits est vide.');
  }

  const headers = Object.keys(rows[0] ?? {});
  const { resolved, missing } = resolveColumns(headers, PRODUCT_COLUMNS);

  if (!resolved.amm || !resolved.name) {
    throw new Error(
      "Colonnes obligatoires introuvables dans le fichier produits (numéro AMM et nom). " +
        `Colonnes détectées : ${headers.slice(0, 12).join(', ')}…`,
    );
  }

  // Un catalogue sans état d'autorisation ferait passer un produit retiré du
  // marché pour un produit vérifié : on préfère ne rien importer.
  const missingRequired = REQUIRED_PRODUCT_FIELDS.filter((field) => !resolved[field]);
  if (missingRequired.length) {
    throw new Error(
      `Le fichier produits ne contient pas l'état d'autorisation ` +
        `(champ${missingRequired.length > 1 ? 's' : ''} : ${missingRequired.join(', ')}). ` +
        "Importer ce fichier ferait apparaître des produits retirés du marché comme " +
        "vérifiés au catalogue : l'import est interrompu. " +
        `Colonnes détectées : ${headers.slice(0, 12).join(', ')}…`,
    );
  }

  if (missing.length) {
    warnings.push(
      `Champs produits non renseignés (colonnes absentes du fichier) : ${missing.join(', ')}.`,
    );
  }

  const ammToId = new Map<string, string>();
  const syncedAt = new Date();
  let count = 0;

  for (const batch of chunk(rows, BATCH_SIZE)) {
    const results = await prisma.$transaction(
      batch
        .map((row) => buildProductUpsert(row, resolved, syncedAt))
        .filter((op): op is NonNullable<typeof op> => op !== null),
    );
    for (const product of results) {
      ammToId.set(product.amm, product.id);
      count += 1;
    }
  }

  // Liaison produits ↔ substances actives à partir de la colonne du fichier produits.
  await linkProductSubstances(rows, resolved, ammToId);

  return { productCount: count, ammToId };
}

function buildProductUpsert(
  row: CsvRow,
  resolved: Record<string, string | null>,
  syncedAt: Date,
) {
  const amm = pick(row, resolved, 'amm');
  const name = pick(row, resolved, 'name');
  if (!amm || !name) return null;

  const data = {
    name,
    normalizedName: normalizeSearchTerm(name),
    secondNames: pick(row, resolved, 'secondNames') ?? null,
    holder: pick(row, resolved, 'holder') ?? null,
    productType: pick(row, resolved, 'productType') ?? null,
    commercialType: pick(row, resolved, 'commercialType') ?? null,
    formulation: pick(row, resolved, 'formulation') ?? null,
    status: pick(row, resolved, 'status') ?? null,
    authorizedMentions: pick(row, resolved, 'authorizedMentions') ?? null,
    usageRestrictions: pick(row, resolved, 'usageRestrictions') ?? null,
    withdrawnAt: parseFrenchDate(pick(row, resolved, 'withdrawnAt')),
    syncedAt,
  };

  return prisma.phytosanitaryProduct.upsert({
    where: { amm },
    create: { amm, ...data },
    update: data,
    select: { id: true, amm: true },
  });
}

async function linkProductSubstances(
  rows: CsvRow[],
  resolved: Record<string, string | null>,
  ammToId: Map<string, string>,
): Promise<void> {
  if (!resolved.substances) return;

  // Recense les substances mentionnées dans le fichier produits.
  const substanceByNormalized = new Map<string, string>();
  const links: Array<{ amm: string; substance: string }> = [];

  for (const row of rows) {
    const amm = pick(row, resolved, 'amm');
    if (!amm || !ammToId.has(amm)) continue;
    for (const substance of splitSubstances(pick(row, resolved, 'substances'))) {
      const normalized = normalizeSearchTerm(substance);
      if (!normalized) continue;
      if (!substanceByNormalized.has(normalized)) {
        substanceByNormalized.set(normalized, substance);
      }
      links.push({ amm, substance: normalized });
    }
  }

  if (substanceByNormalized.size === 0) return;

  for (const batch of chunk([...substanceByNormalized.entries()], BATCH_SIZE)) {
    await prisma.$transaction(
      batch.map(([normalizedName, name]) =>
        prisma.activeSubstance.upsert({
          where: { normalizedName },
          create: { name, normalizedName },
          update: {},
        }),
      ),
    );
  }

  const substanceIds = new Map(
    (
      await prisma.activeSubstance.findMany({
        where: { normalizedName: { in: [...substanceByNormalized.keys()] } },
        select: { id: true, normalizedName: true },
      })
    ).map((s) => [s.normalizedName, s.id]),
  );

  // Déduplique les couples (produit, substance).
  const unique = new Map<string, { productId: string; substanceId: string }>();
  for (const link of links) {
    const productId = ammToId.get(link.amm);
    const substanceId = substanceIds.get(link.substance);
    if (!productId || !substanceId) continue;
    unique.set(`${productId}:${substanceId}`, { productId, substanceId });
  }

  for (const batch of chunk([...unique.values()], BATCH_SIZE)) {
    await prisma.productSubstance.createMany({ data: batch, skipDuplicates: true });
  }
}

async function importUsages(
  buffer: Buffer,
  ammToId: Map<string, string>,
  warnings: string[],
): Promise<number> {
  const rows = parseCsv(buffer);
  if (rows.length === 0) return 0;

  const { resolved, missing } = resolveColumns(Object.keys(rows[0] ?? {}), USAGE_COLUMNS);
  if (!resolved.amm) {
    warnings.push("Fichier usages ignoré : colonne du numéro d'AMM introuvable.");
    return 0;
  }
  if (missing.length) {
    warnings.push(`Champs usages non renseignés : ${missing.join(', ')}.`);
  }

  // Où est le libellé, et où est le code ? Les intitulés ne le disent pas
  // fidèlement : on regarde le contenu. Voir `looksLikeUsageLabel`.
  const candidats = [...new Set([resolved.usageLabel, resolved.usageId])].filter(
    (c): c is string => c !== null,
  );
  const echantillon = rows.slice(0, 200);
  const labelColumn =
    candidats.find((colonne) =>
      looksLikeUsageLabel(echantillon.map((row) => row[colonne])),
    ) ?? null;
  const idColumn = candidats.find((colonne) => colonne !== labelColumn) ?? null;

  if (!labelColumn) {
    warnings.push(
      'Aucune colonne du fichier d’usages ne contient de libellé au format ' +
        '« culture*traitement*cible » : cultures et cibles ne seront pas ' +
        'renseignées, et aucune dose ne pourra être rapprochée d’une culture.',
    );
  }

  const lire = (row: CsvRow, colonne: string | null): string | undefined => {
    if (!colonne) return undefined;
    const valeur = row[colonne]?.trim();
    return valeur ? valeur : undefined;
  };

  const byProduct = new Map<string, Array<Record<string, unknown>>>();

  for (const row of rows) {
    const amm = pick(row, resolved, 'amm');
    if (!amm) continue;
    const productId = ammToId.get(amm);
    if (!productId) continue;

    const rawUsageId = lire(row, idColumn);
    const usageLabel = lire(row, labelColumn);
    const { crop, target } = splitUsageLabel(usageLabel);

    const entry = {
      productId,
      ephyUsageId: rawUsageId ?? null,
      usageLabel: usageLabel ?? null,
      cropLabel: crop,
      cropNormalized: crop ? normalizeSearchTerm(crop) : null,
      targetLabel: target,
      doseValue: pick(row, resolved, 'dose') ?? null,
      doseUnit: pick(row, resolved, 'doseUnit') ?? null,
      status: pick(row, resolved, 'status') ?? null,
      conditions: pick(row, resolved, 'conditions') ?? null,
      preHarvestDelay: pick(row, resolved, 'preHarvestDelay') ?? null,
      preHarvestBbch: pick(row, resolved, 'preHarvestBbch') ?? null,
      bbchMin: pick(row, resolved, 'bbchMin') ?? null,
      bbchMax: pick(row, resolved, 'bbchMax') ?? null,
      zntAquaticM: pick(row, resolved, 'zntAquatic') ?? null,
      zntArthropodM: pick(row, resolved, 'zntArthropod') ?? null,
      zntPlantM: pick(row, resolved, 'zntPlant') ?? null,
      maxApplications: pick(row, resolved, 'maxApplications') ?? null,
      minIntervalDays: pick(row, resolved, 'minIntervalDays') ?? null,
      endDistribution: parseFrenchDate(pick(row, resolved, 'endDistribution')),
      endUsage: parseFrenchDate(pick(row, resolved, 'endUsage')),
      decisionDate: parseFrenchDate(pick(row, resolved, 'decisionDate')),
    };

    const bucket = byProduct.get(productId);
    if (bucket) bucket.push(entry);
    else byProduct.set(productId, [entry]);
  }

  let total = 0;
  const productIds = [...byProduct.keys()];

  for (const idBatch of chunk(productIds, 200)) {
    // Remplacement intégral des usages de ces produits (import idempotent).
    await prisma.phytoUsage.deleteMany({ where: { productId: { in: idBatch } } });

    const payload = idBatch.flatMap((id) => byProduct.get(id) ?? []);
    for (const dataBatch of chunk(payload, BATCH_SIZE)) {
      await prisma.phytoUsage.createMany({
        data: dataBatch as never,
        skipDuplicates: true,
      });
      total += dataBatch.length;
    }
  }

  return total;
}

/**
 * Importe les conditions d'emploi (`produits_condition_emploi_utf8.csv`).
 *
 * Un produit en porte typiquement cinq à dix, catégorisées. Elles sont
 * remplacées intégralement à chaque import, comme les usages : une condition
 * levée par l'ANSES ne doit pas survivre en base.
 */
async function importConditions(
  buffer: Buffer,
  ammToId: Map<string, string>,
  warnings: string[],
): Promise<number> {
  const rows = parseCsv(buffer);
  if (rows.length === 0) return 0;

  const { resolved, missing } = resolveColumns(
    Object.keys(rows[0] ?? {}),
    CONDITION_COLUMNS,
  );
  if (!resolved.amm || !resolved.label) {
    warnings.push(
      "Fichier des conditions d'emploi ignoré : numéro d'AMM ou libellé introuvable.",
    );
    return 0;
  }
  if (missing.includes('category')) {
    warnings.push("Catégorie absente du fichier des conditions d'emploi.");
  }

  const byProduct = new Map<string, Array<Record<string, unknown>>>();

  for (const row of rows) {
    const amm = pick(row, resolved, 'amm');
    if (!amm) continue;
    const productId = ammToId.get(amm);
    if (!productId) continue;

    const label = pick(row, resolved, 'label');
    if (!label) continue;

    const entry = {
      productId,
      category: pick(row, resolved, 'category') ?? 'Non catégorisée',
      label,
      concernsDrainedSoil: conditionConcernsDrainedSoil(label),
    };

    const bucket = byProduct.get(productId);
    if (bucket) bucket.push(entry);
    else byProduct.set(productId, [entry]);
  }

  let total = 0;
  for (const idBatch of chunk([...byProduct.keys()], 200)) {
    await prisma.phytoCondition.deleteMany({ where: { productId: { in: idBatch } } });

    const payload = idBatch.flatMap((id) => byProduct.get(id) ?? []);
    for (const dataBatch of chunk(payload, BATCH_SIZE)) {
      await prisma.phytoCondition.createMany({
        data: dataBatch as never,
        skipDuplicates: true,
      });
      total += dataBatch.length;
    }
  }

  return total;
}

/** Dernière synchronisation réussie, affichée dans l'interface. */
export async function getLastSuccessfulSync() {
  return prisma.ephySyncRun.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { finishedAt: 'desc' },
  });
}
