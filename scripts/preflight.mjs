/**
 * Contrôle avant démarrage.
 *
 *   npm run preflight
 *
 * Une instance mal configurée démarre sans se plaindre : Next annonce
 * « Ready », la page de connexion s'affiche, et la panne n'apparaît qu'au
 * premier compte qui tente de se connecter. Pour un service auto-hébergé que
 * l'on redémarre à distance, c'est le pire des comportements.
 *
 * Ce script vérifie ce qui doit l'être avant d'ouvrir le service :
 * configuration, base joignable, PostGIS présent, migrations appliquées,
 * dossiers inscriptibles, compilation présente. Il sort en erreur au premier
 * manquement, avec la marche à suivre.
 *
 * À placer en `ExecStartPre` de l'unité systemd : le service refuse alors de
 * démarrer plutôt que de servir une application creuse.
 */
import { access, constants, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * Racine du projet, déduite de l'emplacement de ce script.
 *
 * Pas `process.cwd()` : systemd appelle ce contrôle en `ExecStartPre`, et un
 * répertoire courant inattendu ferait conclure à tort que la compilation ou
 * les migrations manquent — exactement le faux négatif qu'on veut éviter.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const notes = [];

function fail(what, remedy) {
  problems.push({ what, remedy });
  console.log(`  ✗ ${what}`);
}
function ok(what, detail = '') {
  console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ''}`);
}
function warn(what) {
  notes.push(what);
  console.log(`  ! ${what}`);
}

// --- 1. Configuration -------------------------------------------------------
console.log('\nConfiguration');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  fail(
    'DATABASE_URL absente',
    'Renseignez-la dans le fichier .env chargé par le service (EnvironmentFile).',
  );
} else {
  ok('DATABASE_URL renseignée');
}

const APP_URL = process.env.APP_URL;
if (!APP_URL) {
  warn("APP_URL absente : les liens des e-mails pointeront vers localhost");
} else {
  try {
    const url = new URL(APP_URL);
    ok('APP_URL valide', url.origin);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      warn(
        `APP_URL est en ${url.protocol} : en production les cookies de session ` +
          'ne seront pas marqués Secure',
      );
    }
  } catch {
    fail(`APP_URL invalide (${APP_URL})`, 'Attendu : https://parcelys.fr');
  }
}

if (process.env.NODE_ENV !== 'production') {
  warn(
    `NODE_ENV vaut « ${process.env.NODE_ENV ?? 'non défini'} » : ` +
      'posez NODE_ENV=production pour un service en ligne',
  );
} else {
  ok('NODE_ENV=production');
}

if ((process.env.EMAIL_PROVIDER ?? 'console') === 'console') {
  warn(
    "EMAIL_PROVIDER=console : les codes de vérification s'écrivent dans les " +
      "journaux au lieu d'être envoyés. Acceptable pour un premier essai, " +
      'à changer avant d’ouvrir le service à d’autres comptes.',
  );
} else {
  ok(`Envoi d'e-mails : ${process.env.EMAIL_PROVIDER}`);
}

if (!process.env.EPHY_DATA_URL) {
  warn(
    "EPHY_DATA_URL absente : le catalogue officiel des produits " +
      "phytopharmaceutiques n'est pas importé. La recherche de produits restera " +
      'vide et les registres le signaleront explicitement.',
  );
} else {
  ok('Catalogue E-Phy configuré');
}

// --- 2. Compilation ---------------------------------------------------------
console.log('\nCompilation');

const standaloneServer = path.join(ROOT, '.next', 'standalone', 'server.js');
const standaloneStatic = path.join(ROOT, '.next', 'standalone', '.next', 'static');

try {
  await access(standaloneServer, constants.R_OK);
  ok('serveur autonome présent');
  try {
    await access(standaloneStatic, constants.R_OK);
    ok('fichiers statiques copiés dans le bundle');
  } catch {
    fail(
      'les fichiers statiques manquent dans .next/standalone',
      'Relancez « npm run build » : sans eux le site s’affiche sans mise en forme.',
    );
  }
} catch {
  fail('compilation absente', 'Lancez « npm run build ».');
}

// --- 3. Dossiers de données -------------------------------------------------
console.log('\nDossiers de données');

for (const [label, dir] of [
  ['documents', process.env.UPLOAD_DIR ?? './storage/documents'],
  ['catalogue E-Phy', process.env.EPHY_DATA_DIR ?? './data/ephy'],
]) {
  const target = path.resolve(dir);
  try {
    await mkdir(target, { recursive: true });
    await access(target, constants.W_OK);
    ok(`${label} inscriptible`, target);
  } catch {
    fail(
      `${label} : ${target} n'est pas inscriptible`,
      "Vérifiez le propriétaire du dossier et, si vous utilisez systemd, la directive ReadWritePaths.",
    );
  }
}

// --- 4. Base de données -----------------------------------------------------
if (DATABASE_URL) {
  console.log('\nBase de données');
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

  try {
    const [version] = await prisma.$queryRaw`SELECT version() AS version`;
    ok('base joignable', String(version.version).split(' ').slice(0, 2).join(' '));

    try {
      const [postgis] = await prisma.$queryRaw`SELECT postgis_lib_version() AS v`;
      ok('extension PostGIS active', postgis.v);
    } catch {
      fail(
        'extension PostGIS absente',
        "Connectez-vous à la base et lancez : CREATE EXTENSION postgis; " +
          "Sans elle, aucune superficie n'est calculable.",
      );
    }

    // Migrations : on compare les dossiers du dépôt aux migrations appliquées.
    try {
      const applied = await prisma.$queryRaw`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
      `;
      const appliedNames = new Set(applied.map((row) => row.migration_name));
      const onDisk = (
        await readdir(path.join(ROOT, 'prisma', 'migrations'), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const pending = onDisk.filter((name) => !appliedNames.has(name));
      if (pending.length === 0) {
        ok('migrations à jour', `${appliedNames.size} appliquée(s)`);
      } else {
        fail(
          `${pending.length} migration(s) non appliquée(s) : ${pending.join(', ')}`,
          'Lancez « npm run db:deploy » après avoir sauvegardé la base.',
        );
      }
    } catch {
      fail(
        'aucune migration appliquée sur cette base',
        'Lancez « npm run db:deploy » pour créer le schéma.',
      );
    }

    // Une base sans compte n'est pas une erreur : c'est une instance neuve.
    try {
      const [{ count }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM users`;
      if (count === 0) {
        warn(
          "aucun compte en base : le premier inscrit deviendra administrateur " +
            "de l'instance, sans code d'invitation",
        );
      } else {
        ok('comptes existants', `${count}`);
      }
    } catch {
      // Le schéma manque ; déjà signalé plus haut.
    }
  } catch (error) {
    fail(
      'base injoignable',
      `Vérifiez DATABASE_URL et que PostgreSQL écoute. Détail : ${
        error instanceof Error ? error.message.split('\n')[0] : 'inconnu'
      }`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// --- Verdict ----------------------------------------------------------------
console.log('');
if (problems.length === 0) {
  console.log(
    notes.length === 0
      ? '✓ Instance prête.\n'
      : `✓ Instance prête, avec ${notes.length} point(s) d'attention ci-dessus.\n`,
  );
  process.exit(0);
}

console.log(`✗ ${problems.length} problème(s) empêchent un démarrage sain :\n`);
for (const { what, remedy } of problems) {
  console.log(`  · ${what}`);
  console.log(`    → ${remedy}\n`);
}
process.exit(1);
