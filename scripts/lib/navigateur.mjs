/**
 * Retrouver le navigateur des vérifications.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Une dizaine de scripts lancent Chromium par Playwright. Tous écrivaient la
 * même ligne :
 *
 *     executablePath: process.env.CHROMIUM_PATH ?? undefined
 *
 * et donc, quand `CHROMIUM_PATH` n'était pas exportée, s'en remettaient au
 * navigateur que Playwright installe pour lui-même. Ce navigateur porte un
 * numéro de révision lié à la version de Playwright : une mise à jour de la
 * bibliothèque en réclame un autre, et **toutes** les vérifications s'arrêtent
 * sur le même message :
 *
 *     browserType.launch: Executable doesn't exist at
 *     …/chromium_headless_shell-1243/…
 *     Looks like Playwright was just installed or updated.
 *
 * C'est arrivé pendant l'audit 0.9.5 : la machine avait la révision 1194,
 * Playwright en réclamait une 1243. Rien n'était cassé dans Parcelys, mais neuf
 * vérifications sur dix ne s'exécutaient plus — et une vérification qui ne
 * s'exécute pas ressemble beaucoup à une vérification qui passe.
 *
 * Le navigateur présent convient : on le cherche donc, au lieu d'exiger la
 * révision exacte que Playwright espérait.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDRE DE RECHERCHE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. `CHROMIUM_PATH`, si elle est posée — le choix explicite prime toujours ;
 *   2. le navigateur de Playwright, s'il est bien là où Playwright l'attend —
 *      on ne le contourne que s'il manque ;
 *   3. n'importe quel Chromium installé sous `PLAYWRIGHT_BROWSERS_PATH` ;
 *   4. un Chromium du système (`/usr/bin/chromium`…).
 *
 * Sans rien trouver, on rend `undefined` : Playwright affiche alors son propre
 * message, qui dit quoi installer. Mieux vaut son message que le nôtre.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Emplacements d'un exécutable Chromium à l'intérieur d'un dossier de révision. */
const DANS_LA_REVISION = [
  'chrome-linux/chrome',
  'chrome-linux/headless_shell',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
];

const DU_SYSTEME = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium',
];

/**
 * Chemin de l'exécutable à passer à `chromium.launch({ executablePath })`.
 *
 * Rend `undefined` quand il faut laisser Playwright se débrouiller — ce qui est
 * le bon comportement quand son propre navigateur est en place.
 */
export function cheminDuNavigateur() {
  const impose = process.env.CHROMIUM_PATH;
  if (impose) return impose;

  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!racine || !existsSync(racine)) return premierDuSysteme();

  let revisions;
  try {
    revisions = readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^chromium/.test(e.name))
      .map((e) => e.name)
      // La révision la plus récente d'abord : `chromium-1194` avant
      // `chromium-1100`. Un tri de chaînes mettrait « 1100 » après « 998 ».
      .sort((a, b) => numero(b) - numero(a));
  } catch {
    return premierDuSysteme();
  }

  // Chromium complet avant `headless_shell` : certaines vérifications prennent
  // des captures d'écran, que la coquille sans interface ne rend pas pareil.
  const complets = revisions.filter((r) => !r.includes('headless_shell'));
  for (const revision of [...complets, ...revisions]) {
    for (const relatif of DANS_LA_REVISION) {
      const candidat = path.join(racine, revision, relatif);
      if (existsSync(candidat)) return candidat;
    }
  }

  return premierDuSysteme();
}

function numero(nom) {
  const m = /(\d+)$/.exec(nom);
  return m ? Number(m[1]) : 0;
}

function premierDuSysteme() {
  for (const candidat of DU_SYSTEME) {
    if (existsSync(candidat)) return candidat;
  }
  return undefined;
}
