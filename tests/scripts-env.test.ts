import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou sur la configuration des scripts en ligne de commande.
 *
 * Un script lancé par `tsx` ne passe pas par Next : rien ne lit `.env` pour
 * lui. Les scripts ont pourtant longtemps marché — par accident. Prisma lit
 * `.env` de son côté pour résoudre `env("DATABASE_URL")`, si bien que tout
 * script important `@/lib/prisma` héritait des variables sans les demander.
 *
 * `email-test.ts` n'importe pas Prisma. Il était donc le seul à échouer, sur
 * une instance correctement configurée, avec un message qui accusait la base
 * de données alors qu'un envoi d'e-mail n'a rien à en faire. Kevin l'a
 * rencontré sur son Raspberry Pi.
 *
 * Ce test exige que chaque script charge `.env` explicitement. Il coûte
 * quelques millisecondes et évite qu'un script cesse de fonctionner le jour où
 * il n'a plus besoin de Prisma — c'est-à-dire sans rapport apparent avec la
 * panne.
 */

const DOSSIER = path.join(process.cwd(), 'scripts');

/** Les scripts TypeScript, hors le chargeur lui-même. */
function scripts(): string[] {
  return readdirSync(DOSSIER)
    .filter((nom) => nom.endsWith('.ts') && nom !== 'load-env.ts')
    .sort();
}

describe('Scripts en ligne de commande', () => {
  it('chargent tous « .env » avant toute autre chose', () => {
    const fautifs: string[] = [];

    for (const nom of scripts()) {
      const source = readFileSync(path.join(DOSSIER, nom), 'utf8');
      const imports = [...source.matchAll(/^import\s[^\n]*?['"]([^'"]+)['"];?$/gm)];
      const premier = imports[0]?.[1];

      if (!imports.some((m) => m[1] === './load-env')) {
        fautifs.push(`${nom} : ne charge pas « .env »`);
      } else if (premier !== './load-env') {
        // L'ordre compte : les modules importés avant lui s'évaluent avant, et
        // liraient un `process.env` encore incomplet.
        fautifs.push(`${nom} : « ./load-env » n'est pas le premier import (« ${premier} »)`);
      }
    }

    expect(
      fautifs,
      fautifs.length === 0
        ? ''
        : 'Ces scripts ne liront pas « .env » :\n' +
          fautifs.map((f) => `  · ${f}`).join('\n') +
          "\n\nAjoutez « import './load-env'; » en tout premier import. Sans lui, " +
          'le script ne fonctionne que là où les variables sont déjà dans ' +
          "l'environnement — jamais sur une installation ordinaire.",
    ).toEqual([]);
  });

  it('déclarent chacun leur commande npm', () => {
    const paquet = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const commandes = Object.values(paquet.scripts).join(' ');

    const orphelins = scripts().filter((nom) => !commandes.includes(`scripts/${nom}`));
    expect(
      orphelins,
      orphelins.length === 0
        ? ''
        : `Ces scripts ne sont lançables par aucune commande npm : ${orphelins.join(', ')}.`,
    ).toEqual([]);
  });
});
