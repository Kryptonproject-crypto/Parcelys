/**
 * Complète la sortie « standalone » de Next.
 *
 *   node scripts/assemble-standalone.mjs
 *
 * `output: 'standalone'` produit un serveur autonome et le strict minimum de
 * dépendances — mais Next **n'y copie ni les fichiers statiques ni le dossier
 * public**. Lancé tel quel, `node .next/standalone/server.js` sert le HTML et
 * répond 404 sur toutes les feuilles de style : la page s'affiche nue, sans
 * que rien ne signale l'erreur.
 *
 * L'image Docker fait déjà cette copie dans son étape finale. Ce script rend le
 * même service au déploiement sans conteneur — celui d'un VPS ou d'un
 * Raspberry Pi —, appelé automatiquement après chaque `npm run build`.
 */
import { access, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, '.next', 'standalone');

const exists = async (target) =>
  access(target).then(
    () => true,
    () => false,
  );

if (!(await exists(STANDALONE))) {
  console.error(
    "✗ .next/standalone est absent. Vérifiez que next.config.ts conserve " +
      "output: 'standalone', puis relancez la compilation.",
  );
  process.exit(1);
}

// Les fichiers statiques : styles, JavaScript des pages, polices.
await cp(
  path.join(ROOT, '.next', 'static'),
  path.join(STANDALONE, '.next', 'static'),
  { recursive: true },
);

// Le dossier public, s'il existe : favicon, images, robots.txt.
if (await exists(path.join(ROOT, 'public'))) {
  await cp(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'), {
    recursive: true,
  });
}

// Un rappel dans le bundle lui-même : sans lui, le prochain à ouvrir ce
// dossier se demandera pourquoi il contient des fichiers que Next n'y met pas.
await writeFile(
  path.join(STANDALONE, 'ASSEMBLAGE.txt'),
  [
    'Ce dossier a été complété par scripts/assemble-standalone.mjs.',
    '',
    "Next n'y copie pas .next/static ni public/ : sans eux, le serveur répond",
    '404 sur toutes les feuilles de style et la page s’affiche sans mise en forme.',
    '',
    'Démarrage :  node .next/standalone/server.js',
    '',
  ].join('\n'),
  'utf8',
);

console.log('✓ Sortie standalone complétée (.next/static et public copiés).');
