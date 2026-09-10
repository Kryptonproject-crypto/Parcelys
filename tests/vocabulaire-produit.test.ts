import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le vocabulaire que voit l'utilisateur.
 *
 * Ce que ce test protège : **Parcelys se présente comme un service, jamais
 * comme une infrastructure**. L'exploitant a un compte, une exploitation, des
 * parcelles. Il n'a pas d'« instance », de « déploiement » ni de « serveur
 * auto-hébergé » — ces mots-là décrivent la manière dont le logiciel tourne,
 * ce qui ne le regarde pas, et le mettent en position de devoir comprendre une
 * architecture pour utiliser un outil de terrain.
 *
 * Vingt-cinq textes employaient « instance » : « Instance privée » sur la page
 * d'accueil, « Premier compte de l'instance » à l'inscription, « Administrateur
 * de l'instance » sur les badges, « Cette instance est à jour » dans la
 * maintenance. Aucun comportement n'a changé en les réécrivant — c'est le mot
 * qui est parti, pas la fonction.
 *
 * Le test ne regarde que ce qui peut atteindre l'écran : les commentaires du
 * code gardent le droit de nommer les choses techniquement, et c'est même
 * souhaitable — un commentaire qui explique le déploiement doit dire
 * « instance ».
 */

const RACINES = ['src/app', 'src/components', 'mobile/src'];

/**
 * Mots interdits dans un texte destiné à l'utilisateur.
 *
 * `instanceof` est un opérateur du langage, pas un mot : la limite `(?!of)`
 * évite de le confondre avec le nom commun.
 */
const INTERDITS: Array<{ motif: RegExp; pourquoi: string }> = [
  {
    motif: /\binstances?\b(?!of)/i,
    pourquoi:
      "« instance » décrit la façon dont le logiciel tourne. L'exploitant a un compte et " +
      "une exploitation ; parlez de « Parcelys », « votre serveur » ou « l'administration ».",
  },
  {
    motif: /auto-h[ée]berg/i,
    pourquoi:
      "l'auto-hébergement est une modalité de déploiement, pas une notion que l'utilisateur " +
      'doit manipuler pour saisir un traitement.',
  },
  {
    motif: /multi-instances?\b/i,
    pourquoi: 'le multi-instance ne doit jamais apparaître à l’écran.',
  },
];

/**
 * Retire du fichier tout ce qui n'atteint jamais l'écran.
 *
 * Trois formes de commentaires coexistent dans un composant React : le bloc
 * `/* … *\/`, la ligne `//`, et le commentaire JSX `{/* … *\/}`. Les trois
 * doivent pouvoir employer le vocabulaire technique — c'est leur rôle.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function fichiersTsx(racine: string): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
      } else if (chemin.endsWith('.tsx')) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(racine);
  return trouves;
}

describe('Vocabulaire vu par l’utilisateur', () => {
  const fichiers = RACINES.flatMap(fichiersTsx);

  it('trouve bien des composants à examiner', () => {
    // Une garde qui ne lit rien passe au vert sans rien protéger.
    expect(fichiers.length).toBeGreaterThan(50);
  });

  for (const { motif, pourquoi } of INTERDITS) {
    it(`ne dit jamais ${motif.source} à l’écran`, () => {
      const fautifs: string[] = [];

      for (const fichier of fichiers) {
        const utile = sansCommentaires(readFileSync(fichier, 'utf8'));
        for (const [index, ligne] of utile.split('\n').entries()) {
          if (motif.test(ligne)) {
            fautifs.push(`${fichier}:${index + 1}  ${ligne.trim().slice(0, 90)}`);
          }
        }
      }

      expect(fautifs, `${pourquoi}\n\n${fautifs.join('\n')}`).toEqual([]);
    });
  }
});
