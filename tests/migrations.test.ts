import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou sur les migrations.
 *
 * Les index spatiaux (GiST) sont créés en SQL brut, hors du modèle Prisma :
 * `Unsupported("geometry(...)")` ne permet pas de les déclarer. Prisma ne les
 * connaît donc pas, les croit superflus, et **propose de les supprimer dans
 * chaque nouvelle migration qu'il génère**.
 *
 * Ce n'est arrivé ni une ni deux fois : c'est systématique. Et la conséquence
 * ne se voit pas tout de suite — la base répond, simplement chaque affichage de
 * carte et chaque recherche de chevauchement repasse en parcours séquentiel.
 *
 * Ce test relit toutes les migrations et refuse celles qui suppriment un index
 * qu'aucune ne recrée. Il coûte quelques millisecondes et évite une régression
 * silencieuse qu'on ne remarquerait qu'au ralentissement.
 */

const DOSSIER = path.join(process.cwd(), 'prisma', 'migrations');

function migrations(): Array<{ nom: string; sql: string }> {
  return readdirSync(DOSSIER, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      nom: e.name,
      sql: readFileSync(path.join(DOSSIER, e.name, 'migration.sql'), 'utf8'),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/** Retire les commentaires : une ligne commentée n'exécute rien. */
function sansCommentaires(sql: string): string {
  return sql
    .split('\n')
    .filter((ligne) => !ligne.trimStart().startsWith('--'))
    .join('\n');
}

describe('Migrations', () => {
  it('ne laisse aucun index spatial supprimé sans être recréé', () => {
    // On rejoue les migrations dans l'ordre et on suit l'état final. Se
    // contenter de vérifier qu'un index est créé « quelque part » ne prouve
    // rien : un index créé par la migration initiale puis supprimé par la
    // dixième passerait un tel contrôle sans broncher.
    const vivants = new Set<string>();
    const supprimePar = new Map<string, string>();

    for (const { nom, sql } of migrations()) {
      const code = sansCommentaires(sql);

      for (const m of code.matchAll(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w*gist\w*)"?/gi)) {
        if (m[1]) {
          vivants.add(m[1]);
          supprimePar.delete(m[1]);
        }
      }
      for (const m of code.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?(\w*gist\w*)"?/gi)) {
        if (m[1]) {
          vivants.delete(m[1]);
          supprimePar.set(m[1], nom);
        }
      }
    }

    const perdus = [...supprimePar.entries()];

    expect(
      perdus,
      perdus.length === 0
        ? ''
        : "Des index spatiaux sont supprimés et jamais recréés :\n" +
          perdus.map(([index, mig]) => `  · ${index} (supprimé par ${mig})`).join('\n') +
          "\n\nPrisma propose cette suppression dans chaque migration qu'il génère, " +
          "parce qu'il ne connaît pas les index créés en SQL brut. Retirez ces " +
          'lignes de la migration : sans index GiST, la cartographie repasse en ' +
          'parcours séquentiel.',
    ).toEqual([]);
  });

  it('crée bien un index spatial pour chaque colonne géométrique', () => {
    const toutes = migrations().map((m) => sansCommentaires(m.sql)).join('\n');

    // Les tables qui portent une colonne géométrique.
    const avecGeometrie = new Set<string>();
    for (const m of toutes.matchAll(/CREATE TABLE "(\w+)"[^;]*geometry\(/gi)) {
      if (m[1]) avecGeometrie.add(m[1]);
    }
    // `ALTER TABLE … ADD COLUMN … geometry(...)` compte aussi.
    for (const m of toutes.matchAll(/ALTER TABLE "(\w+)"[^;]*ADD COLUMN[^;]*geometry\(/gi)) {
      if (m[1]) avecGeometrie.add(m[1]);
    }

    const indexees = new Set<string>();
    for (const m of toutes.matchAll(/CREATE INDEX[^;]*ON\s+"(\w+)"\s+USING\s+GIST/gi)) {
      if (m[1]) indexees.add(m[1]);
    }

    const sansIndex = [...avecGeometrie].filter((t) => !indexees.has(t));
    expect(
      sansIndex,
      sansIndex.length === 0
        ? ''
        : `Ces tables portent une géométrie sans index GiST : ${sansIndex.join(', ')}. ` +
          'Toute recherche spatiale y sera un parcours séquentiel.',
    ).toEqual([]);
  });
});
