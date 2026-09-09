/**
 * Charge le fichier `.env` du dépôt dans `process.env`.
 *
 * À importer **en premier** par chaque script en ligne de commande :
 *
 *     import './load-env';
 *     import { getEnv } from '@/lib/env';
 *
 * Pourquoi ce module existe
 * -------------------------
 * Next lit `.env` tout seul, mais un script lancé par `tsx` ne passe pas par
 * Next : rien ne le charge. Les scripts fonctionnaient malgré tout — par
 * accident. Prisma lit `.env` de son côté pour résoudre `env("DATABASE_URL")`,
 * si bien que tout script important `@/lib/prisma` héritait des variables sans
 * l'avoir demandé.
 *
 * `email-test.ts` n'importe pas Prisma. Il était donc le seul à échouer, sur
 * une instance pourtant correctement configurée, et avec un message qui
 * désignait la base de données alors que le problème était ailleurs — et qu'un
 * envoi d'e-mail n'a de toute façon rien à faire d'une base.
 *
 * Dépendre d'un effet de bord de Prisma pour lire sa propre configuration
 * n'était pas tenable : le jour où un script cesse d'importer Prisma, il casse
 * sans raison apparente.
 *
 * Une variable déjà présente dans l'environnement l'emporte toujours : c'est ce
 * qui permet de passer outre le temps d'une commande —
 * `EMAIL_PROVIDER=console npm run email:test -- …` — sans toucher au fichier.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Retire les guillemets qui entourent une valeur, et rien d'autre. */
function nettoyer(valeur: string): string {
  const brut = valeur.trim();
  if (brut.length >= 2) {
    const premier = brut[0];
    const dernier = brut[brut.length - 1];
    if ((premier === '"' || premier === "'") && dernier === premier) {
      const contenu = brut.slice(1, -1);
      // Les séquences d'échappement n'ont de sens qu'entre guillemets doubles,
      // comme dans un interpréteur de commandes.
      return premier === '"' ? contenu.replace(/\\n/g, '\n') : contenu;
    }
  }
  // Hors guillemets, un « # » commence un commentaire de fin de ligne.
  return brut.split(' #')[0]?.trimEnd() ?? '';
}

export function loadEnvFile(fichier?: string): { charge: number; source: string | null } {
  const source = fichier ?? path.resolve(process.cwd(), '.env');
  if (!existsSync(source)) return { charge: 0, source: null };

  let charge = 0;
  for (const ligne of readFileSync(source, 'utf8').split('\n')) {
    const texte = ligne.trim();
    if (texte.length === 0 || texte.startsWith('#')) continue;

    // « export FOO=bar » est accepté : on colle souvent depuis un shell.
    const sansExport = texte.startsWith('export ') ? texte.slice(7) : texte;
    const separateur = sansExport.indexOf('=');
    if (separateur <= 0) continue;

    const cle = sansExport.slice(0, separateur).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cle)) continue;
    // L'environnement réel prime : il traduit une intention explicite.
    if (process.env[cle] !== undefined) continue;

    process.env[cle] = nettoyer(sansExport.slice(separateur + 1));
    charge += 1;
  }

  return { charge, source };
}

loadEnvFile();
