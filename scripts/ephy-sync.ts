/**
 * Synchronisation du référentiel E-Phy.
 *
 *   npm run ephy:sync                  # télécharge EPHY_DATA_URL puis importe
 *   npm run ephy:sync -- --dir ./data  # importe une archive déjà décompressée
 *   npm run ephy:sync -- --zip a.zip   # importe une archive ZIP locale
 *   npm run ephy:sync -- --purge       # vide le catalogue avant de réimporter
 *                                      # (le registre phytosanitaire est conservé)
 *
 * Le jeu de données officiel est publié par l'ANSES sur data.gouv.fr
 * (« Données ouvertes du catalogue E-Phy des produits phytopharmaceutiques »).
 * Aucune URL n'est codée en dur : `EPHY_DATA_URL` doit pointer vers l'archive
 * de l'édition retenue. Sans cette variable, la commande s'arrête sans rien
 * importer — Parcelys n'invente jamais de donnée réglementaire.
 */
// En premier : c'est lui qui charge `.env` pour un script hors de Next.
import './load-env';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Open } from 'unzipper';
import { importEphyData, type ImportSource } from '@/lib/ephy/import';
import { resolveDataFile } from '@/lib/ephy/schema';
import { getEnv } from '@/lib/env';
import { prisma } from '@/lib/prisma';

type Args = { dir?: string; zip?: string; url?: string; purge?: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--dir' && value) { args.dir = value; i += 1; }
    else if (flag === '--zip' && value) { args.zip = value; i += 1; }
    else if (flag === '--url' && value) { args.url = value; i += 1; }
    else if (flag === '--purge') { args.purge = true; }
  }
  return args;
}

/**
 * Vide le catalogue avant réimport.
 *
 * L'import procède par mise à jour ou insertion : les produits d'une
 * synchronisation antérieure restent en base même s'ils ne figurent plus dans
 * le fichier. Après un import parti du mauvais fichier, cela laisse des fiches
 * sans état d'autorisation qu'aucun réimport ne corrige.
 *
 * Le registre phytosanitaire n'est **pas** concerné : il conserve le nom du
 * produit et son AMM au moment du traitement, et sa liaison au catalogue est en
 * « mettre à nul », jamais en cascade. Un registre réglementaire ne dépend pas
 * d'un référentiel qu'on resynchronise.
 */
async function purgeCatalogue(): Promise<void> {
  console.info('→ Purge du catalogue (le registre phytosanitaire est conservé)…');
  const usages = await prisma.phytoUsage.deleteMany();
  const links = await prisma.productSubstance.deleteMany();
  const products = await prisma.phytosanitaryProduct.deleteMany();
  const substances = await prisma.activeSubstance.deleteMany();
  console.info(
    `  supprimés : ${products.count} produit(s), ${usages.count} usage(s), ` +
      `${substances.count} substance(s), ${links.count} liaison(s)`,
  );
}

async function downloadArchive(url: string, targetDir: string): Promise<string> {
  await mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, 'ephy-source.zip');

  console.info(`↓ Téléchargement de l'archive officielle : ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Parcelys/ephy-sync' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Téléchargement impossible (HTTP ${response.status}) : ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  console.info(`  archive enregistrée (${(buffer.length / 1024 / 1024).toFixed(1)} Mo)`);
  return target;
}

/** Extrait les CSV utiles d'une archive ZIP, sans l'écrire sur le disque. */
async function readFromZip(zipPath: string): Promise<ImportSource> {
  const archive = await Open.file(zipPath);
  const entries = archive.files.filter(
    (f) => f.type === 'File' && /\.csv$/i.test(f.path),
  );

  if (entries.length === 0) {
    throw new Error("L'archive ne contient aucun fichier CSV.");
  }

  const names = entries.map((e) => path.basename(e.path));
  console.info(`  fichiers CSV détectés : ${names.join(', ')}`);

  const byName = new Map(entries.map((e) => [path.basename(e.path), e]));
  const chosen = chooseFiles(names);

  const read = async (name: string | null) => {
    if (!name) return undefined;
    const entry = byName.get(name);
    if (!entry) throw new Error(`Fichier « ${name} » absent de l'archive.`);
    return entry.buffer();
  };

  const products = await read(chosen.products);
  if (!products) throw new Error("Fichier « produits » illisible dans l'archive.");

  return {
    products,
    usages: await read(chosen.usages),
    substances: await read(chosen.substances),
  };
}

/**
 * Désigne, parmi les CSV de l'archive, celui qui tient chaque rôle — et le dit.
 *
 * L'archive contient une dizaine de fichiers aux noms voisins ; se tromper de
 * fichier produit un catalogue d'apparence normale mais amputé de l'état
 * d'autorisation ou des doses. On affiche donc le choix retenu : c'est la seule
 * façon de s'en apercevoir sans relire la base.
 */
function chooseFiles(names: string[]): {
  products: string;
  usages: string | null;
  substances: string | null;
} {
  const products = resolveDataFile(names, 'products');
  if (!products) {
    throw new Error(
      "Fichier « produits » introuvable dans l'archive (attendu : produits_utf8.csv). " +
        'Vérifiez que EPHY_DATA_URL pointe bien vers le catalogue E-Phy.',
    );
  }

  const usages = resolveDataFile(names, 'usages');
  const substances = resolveDataFile(names, 'substances');

  console.info(`  → produits   : ${products}`);
  console.info(`  → usages     : ${usages ?? '(absent — doses et DAR non importés)'}`);
  console.info(`  → substances : ${substances ?? '(absent)'}`);

  return { products, usages, substances };
}

/** Lit les CSV d'un dossier déjà décompressé. */
async function readFromDir(dir: string): Promise<ImportSource> {
  const files = (await readdir(dir)).filter((f) => /\.csv$/i.test(f));
  if (files.length === 0) {
    throw new Error(`Aucun fichier CSV dans ${dir}`);
  }

  const chosen = chooseFiles(files);

  return {
    products: await readFile(path.join(dir, chosen.products)),
    usages: chosen.usages ? await readFile(path.join(dir, chosen.usages)) : undefined,
    substances: chosen.substances
      ? await readFile(path.join(dir, chosen.substances))
      : undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = getEnv();

  let source: ImportSource;
  let sourceUrl: string | undefined;
  let sourceLabel: string;

  if (args.dir) {
    console.info(`→ Import depuis le dossier ${args.dir}`);
    source = await readFromDir(args.dir);
    sourceLabel = `dossier local (${args.dir})`;
  } else if (args.zip) {
    console.info(`→ Import depuis l'archive ${args.zip}`);
    source = await readFromZip(args.zip);
    sourceLabel = `archive locale (${path.basename(args.zip)})`;
  } else {
    const url = args.url ?? env.EPHY_DATA_URL;
    if (!url) {
      console.error(
        [
          '',
          '✗ EPHY_DATA_URL n’est pas configuré.',
          '',
          '  Parcelys ne génère aucune donnée réglementaire : le référentiel',
          '  phytosanitaire doit provenir du catalogue officiel E-Phy publié par',
          '  l’ANSES sur data.gouv.fr.',
          '',
          '  1. Récupérez l’URL de l’archive ZIP de la dernière édition du jeu de',
          '     données « E-Phy : catalogue des produits phytopharmaceutiques ».',
          '  2. Renseignez-la dans .env :  EPHY_DATA_URL="https://…/ephy.zip"',
          '  3. Relancez :  npm run ephy:sync',
          '',
          '  Vous pouvez aussi importer une archive déjà téléchargée :',
          '     npm run ephy:sync -- --zip ./ephy.zip',
          '',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }

    const cacheDir = path.resolve(env.EPHY_DATA_DIR);
    const zipPath =
      existsSync(path.join(cacheDir, 'ephy-source.zip')) && process.env.EPHY_USE_CACHE === 'true'
        ? path.join(cacheDir, 'ephy-source.zip')
        : await downloadArchive(url, cacheDir);

    source = await readFromZip(zipPath);
    sourceUrl = url;
    sourceLabel = 'E-Phy (ANSES) — data.gouv.fr';
  }

  if (args.purge) await purgeCatalogue();

  console.info('→ Import en base…');
  const report = await importEphyData(source, {
    sourceUrl,
    sourceLabel,
    version: new Date().toISOString().slice(0, 10),
  });

  console.info('');
  console.info('✓ Synchronisation E-Phy terminée');
  console.info(`  produits        : ${report.productCount}`);
  console.info(`  substances      : ${report.substanceCount}`);
  console.info(`  usages          : ${report.usageCount}`);
  for (const warning of report.warnings) console.warn(`  ⚠ ${warning}`);
}

main()
  .catch((error) => {
    console.error('✗ Synchronisation E-Phy échouée :', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
