/**
 * Monte la version d'un cran, partout à la fois.
 *
 *   node scripts/bump-version.mjs            # 0.3.0 -> 0.3.1
 *   node scripts/bump-version.mjs mineure    # 0.3.1 -> 0.4.0
 *   node scripts/bump-version.mjs majeure    # 0.4.0 -> 1.0.0
 *   node scripts/bump-version.mjs 1.2.3      # version imposée
 *
 * La version vit à quatre endroits, et une seule oubliée se voit tout de suite :
 * le Pi affiche une version, l'APK une autre, et l'écran « Mises à jour » compare
 * les deux. Ce script les tient ensemble.
 *
 *   package.json                       version servie par le site
 *   package-lock.json                  sinon « npm ci » se plaint d'un décalage
 *   mobile/package.json                version de l'application de terrain
 *   mobile/android/app/build.gradle    repli quand le workflow n'impose rien
 *
 * Il affiche l'ancienne et la nouvelle version, et refuse d'écrire si l'une des
 * quatre ne portait pas déjà la version attendue : mieux vaut s'arrêter que
 * laisser deux versions différentes coexister.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

const FICHIERS = {
  paquet: path.join(RACINE, 'package.json'),
  verrou: path.join(RACINE, 'package-lock.json'),
  mobile: path.join(RACINE, 'mobile', 'package.json'),
  gradle: path.join(RACINE, 'mobile', 'android', 'app', 'build.gradle'),
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function lireJson(fichier) {
  return JSON.parse(readFileSync(fichier, 'utf8'));
}

function ecrireJson(fichier, donnees) {
  writeFileSync(fichier, `${JSON.stringify(donnees, null, 2)}\n`);
}

const actuelle = lireJson(FICHIERS.paquet).version;
const parts = SEMVER.exec(actuelle);
if (!parts) {
  console.error(`✗ Version illisible dans package.json : « ${actuelle} »`);
  process.exit(1);
}
const [majeur, mineur, correctif] = parts.slice(1).map(Number);

const demande = process.argv[2] ?? 'correctif';
let suivante;
switch (demande) {
  case 'majeure':
    suivante = `${majeur + 1}.0.0`;
    break;
  case 'mineure':
    suivante = `${majeur}.${mineur + 1}.0`;
    break;
  case 'correctif':
    suivante = `${majeur}.${mineur}.${correctif + 1}`;
    break;
  default:
    if (!SEMVER.test(demande)) {
      console.error(
        `✗ « ${demande} » n'est ni majeure, ni mineure, ni correctif, ni une version.`,
      );
      process.exit(1);
    }
    suivante = demande;
}

// --- Contrôle avant écriture ------------------------------------------------
// Les quatre doivent partir du même point. Sinon une mise à jour précédente
// s'est arrêtée en chemin, et monter d'un cran creuserait l'écart.
const gradleAvant = readFileSync(FICHIERS.gradle, 'utf8');
const gradleVersion = /parcelysVersionName\s*=\s*project\.findProperty\([^)]*\)\s*\?:\s*'([^']+)'/
  .exec(gradleAvant)?.[1];

const desaccords = [];
if (lireJson(FICHIERS.mobile).version !== actuelle) {
  desaccords.push(`mobile/package.json : ${lireJson(FICHIERS.mobile).version}`);
}
if (lireJson(FICHIERS.verrou).version !== actuelle) {
  desaccords.push(`package-lock.json : ${lireJson(FICHIERS.verrou).version}`);
}
if (gradleVersion !== actuelle) {
  desaccords.push(`build.gradle : ${gradleVersion ?? 'introuvable'}`);
}

if (desaccords.length > 0) {
  console.error(
    `✗ Les versions ne concordent pas (package.json : ${actuelle}) :\n` +
      desaccords.map((d) => `    ${d}`).join('\n') +
      `\n\n  Alignez-les d'abord, ou imposez la version :\n` +
      `    node scripts/bump-version.mjs ${suivante}\n`,
  );
  process.exit(1);
}

// --- Écriture ---------------------------------------------------------------
const paquet = lireJson(FICHIERS.paquet);
paquet.version = suivante;
ecrireJson(FICHIERS.paquet, paquet);

const mobile = lireJson(FICHIERS.mobile);
mobile.version = suivante;
ecrireJson(FICHIERS.mobile, mobile);

const verrou = lireJson(FICHIERS.verrou);
verrou.version = suivante;
if (verrou.packages?.['']) verrou.packages[''].version = suivante;
ecrireJson(FICHIERS.verrou, verrou);

writeFileSync(
  FICHIERS.gradle,
  gradleAvant.replace(
    /(parcelysVersionName\s*=\s*project\.findProperty\([^)]*\)\s*\?:\s*')[^']+(')/,
    `$1${suivante}$2`,
  ),
);

// versionCode Android : major*10000 + minor*100 + patch, le même calcul que le
// workflow. Android refuse une mise à jour dont le code n'a pas augmenté.
const [a, b, c] = suivante.split('.').map(Number);
console.info(`\n✓ ${actuelle} → ${suivante}  (versionCode ${a * 10000 + b * 100 + c})\n`);
console.info('  package.json, package-lock.json, mobile/package.json, build.gradle');
console.info(`\n  Sur le Pi :  cd /opt/parcelys && sudo bash scripts/update-pi.sh\n`);
