import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * La compilation du serveur ne doit jamais dépendre de `mobile/`.
 *
 * Ce que ce test protège : **`npm run build` doit réussir sur un dépôt
 * fraîchement cloné**, c'est-à-dire sur le Raspberry Pi qui fait tourner
 * Parcelys, où seul `npm ci` de la racine a été lancé.
 *
 * Le piège est retors, et il a été payé une fois. Le `tsconfig.json` de la
 * racine exclut `mobile/`, mais l'exclusion ne vaut que pour la collecte des
 * fichiers : un fichier inclus qui **importe** un module mobile le rattrape
 * dans le graphe de types malgré tout. Et le graphe mobile mène à `idb`,
 * dépendance déclarée dans `mobile/package.json`, absente à la racine.
 *
 * Résultat : la compilation passe chez qui développe les deux côte à côte —
 * `mobile/node_modules` est là — et échoue chez qui déploie :
 *
 *     ./mobile/src/lib/db.ts:1:43
 *     Type error: Cannot find module 'idb'
 *
 * Trois tests importés de `mobile/` ont suffi. Le service est resté sur la
 * version précédente, et rien dans la vérification ne l'avait vu.
 *
 * La logique partagée a donc un terrain commun, que l'application compile par
 * ses alias : `src/lib/ephy/` pour ce qui touche au catalogue réglementaire,
 * `src/lib/shared/` pour le reste. Ces fichiers n'importent rien du serveur ni
 * de l'application — c'est la condition pour y vivre.
 */

/** Ce qui entre dans la compilation du serveur. */
const SURVEILLE = ['src', 'tests', 'scripts', 'prisma'];

/** Un import qui traverse la frontière, sous ses deux formes possibles. */
const FRANCHISSEMENT = /from\s+['"][^'"]*\bmobile\/src\//;

function fichiers(racine: string): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (entree === 'node_modules') continue;
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
      } else if (/\.(ts|tsx|mts|mjs)$/.test(chemin)) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(racine);
  return trouves;
}

describe('Cloisonnement du serveur et de l’application', () => {
  const tous = SURVEILLE.flatMap(fichiers);

  it('trouve bien des fichiers à examiner', () => {
    // Une garde qui ne lit rien passe au vert sans rien protéger.
    expect(tous.length).toBeGreaterThan(100);
  });

  it('aucun fichier du serveur n’importe de `mobile/src/`', () => {
    const fautifs: string[] = [];

    for (const fichier of tous) {
      for (const [index, ligne] of readFileSync(fichier, 'utf8').split('\n').entries()) {
        // Le commentaire a le droit de citer le chemin ; l'import, non.
        const nu = ligne.trim();
        if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) continue;
        if (FRANCHISSEMENT.test(ligne)) {
          fautifs.push(`${fichier}:${index + 1}  ${nu.slice(0, 100)}`);
        }
      }
    }

    expect(
      fautifs,
      'Ces fichiers entrent dans la compilation du serveur et importent du code ' +
        "de l'application : le graphe mobile sera tiré avec eux, et `npm run build` " +
        "échouera là où `mobile/node_modules` n'existe pas — c'est-à-dire en " +
        'production.\n\n' +
        'Déplacez la logique partagée dans `src/lib/ephy/` (catalogue réglementaire) ' +
        'ou `src/lib/shared/` (le reste), que l’application compile par ses alias.\n\n' +
        fautifs.join('\n'),
    ).toEqual([]);
  });

  it('le terrain commun n’importe rien du serveur', () => {
    // L'inverse compte autant : un module partagé qui tirerait Prisma ou
    // `server-only` ferait échouer la compilation de l'APK, où rien de tout
    // cela n'existe.
    const fautifs: string[] = [];
    const interdits = /from\s+['"](server-only|@prisma\/client|@\/lib\/prisma)['"]/;

    for (const fichier of fichiers('src/lib/shared')) {
      for (const [index, ligne] of readFileSync(fichier, 'utf8').split('\n').entries()) {
        if (interdits.test(ligne)) fautifs.push(`${fichier}:${index + 1}`);
      }
    }

    expect(fautifs).toEqual([]);
  });
});
