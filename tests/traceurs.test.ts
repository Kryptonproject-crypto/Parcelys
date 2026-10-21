import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRACEURS_APPLICATION, TRACEURS_SITE } from '@/lib/shared/traceurs';

/**
 * La page « Cookies et traceurs » dit-elle tout ?
 *
 * Elle est construite depuis `src/lib/shared/traceurs.ts`. Ce test relit le
 * code du site et de l'application, relève chaque clé de stockage local et
 * chaque cookie posé, et exige qu'ils figurent dans la liste. Un stockage
 * ajouté sans être déclaré fait échouer la suite : une page de cookies
 * incomplète n'informe pas, elle rassure à tort.
 */

function fichiers(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin));
    else if (/\.(ts|tsx)$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

const racine = path.resolve(__dirname, '..');
const sources = [...fichiers(path.join(racine, 'src')), ...fichiers(path.join(racine, 'mobile', 'src'))];
const declares = [...TRACEURS_SITE, ...TRACEURS_APPLICATION].map((t) => t.nom).join(' | ');

describe('Cookies et traceurs déclarés', () => {
  it('chaque clé de stockage local employée par le code est déclarée', () => {
    const cles = new Set<string>();
    for (const fichier of sources) {
      const texte = readFileSync(fichier, 'utf8');
      // Appels directs : localStorage.getItem('…') / setItem('…', …).
      for (const m of texte.matchAll(/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) {
        cles.add(m[1]!);
      }
      // Clés nommées dans une constante de module (`const CLE = 'parcelys.…'`).
      if (/localStorage|sessionStorage/.test(texte)) {
        for (const m of texte.matchAll(/const\s+[A-Z_]*CLE[A-Z_]*\s*=\s*['"]([^'"]+)['"]/g)) cles.add(m[1]!);
        for (const m of texte.matchAll(/const\s+[A-Z_]*_KEY\s*=\s*['"]([^'"]+)['"]/g)) cles.add(m[1]!);
      }
      // Stockage natif de l'application (Capacitor Preferences, IndexedDB).
      if (/Preferences|openDB/.test(texte)) {
        for (const m of texte.matchAll(/const\s+[A-Z_]*(?:KEY|CLE)[A-Z_]*\s*=\s*['"]([^'"]+)['"]/g)) cles.add(m[1]!);
      }
    }
    expect(cles.size).toBeGreaterThan(0);
    const oubliees = [...cles].filter((cle) => !declares.includes(cle));
    expect(oubliees, `clés non déclarées dans src/lib/shared/traceurs.ts`).toEqual([]);
  });

  it('le seul cookie posé par le serveur est celui de session', () => {
    const poses = new Set<string>();
    for (const fichier of sources.filter((f) => f.includes(`${path.sep}src${path.sep}`))) {
      const texte = readFileSync(fichier, 'utf8');
      // `cookies().set(…)`, `jar.set(…)` après `const jar = await cookies()`,
      // `response.cookies.set(…)`.
      for (const m of texte.matchAll(/(?:cookies\(\)\)?|\bjar|response\.cookies)\.set\(\s*([^,]+),/g)) {
        poses.add(m[1]!.trim());
      }
    }
    expect(poses.size, 'aucun dépôt de cookie trouvé : le motif de recherche ne suit plus le code').toBeGreaterThan(0);
    for (const nom of poses) {
      expect(nom, 'cookie posé ailleurs que pour la session').toMatch(/SESSION_COOKIE_NAME/);
    }
    expect(declares).toContain('parcelys_session');
  });

  it('aucun traceur non exempté n’est déclaré sans recueil de consentement', () => {
    // Le bandeau est un bandeau d'information : s'il fallait un consentement,
    // il faudrait d'abord le construire. Ce test le rappellera.
    expect([...TRACEURS_SITE, ...TRACEURS_APPLICATION].filter((t) => !t.exempte)).toEqual([]);
  });
});
