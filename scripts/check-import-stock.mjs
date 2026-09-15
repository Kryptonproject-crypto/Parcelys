/**
 * L'import des produits en stock, vu du navigateur.
 *
 *   npm run check:import-stock
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE CONTRÔLE, EN PLUS DES TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `tests/stock-import.test.ts` éprouve l'API : ce qui est proposé, ce qui est
 * créé, ce qui est refusé. Il ne dit pas si **l'écran** marche — si le bouton
 * ouvre le panneau, si la liste se remplit, si cocher puis valider fait
 * apparaître l'article dans la page derrière.
 *
 * C'est pourtant le seul trajet que Kevin empruntera. Un panneau qui ne
 * s'ouvre pas rend l'API parfaite inutile.
 */
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';
import { verifierCompte } from './lib/compte.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

let echecs = 0;
function attendu(condition, quoi, detail = '') {
  if (!condition) {
    echecs += 1;
    process.exitCode = 1;
  }
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
}

await verifierCompte(BASE, EMAIL, PASSWORD);

const navigateur = await chromium.launch({ executablePath: cheminDuNavigateur() });
const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  await page.goto(`${BASE}/stocks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const bouton = page.getByRole('button', { name: /Importer les produits déjà employés/i });
  attendu(await bouton.isVisible(), 'le bouton d’import est proposé sur l’écran des stocks');

  await bouton.click();
  // La liste se charge par une requête : on attend qu'elle ait répondu.
  await page.waitForTimeout(1500);

  const panneau = page.locator('section', {
    hasText: 'Importer les produits déjà employés',
  });
  attendu(await panneau.first().isVisible(), 'le panneau s’ouvre');

  const texte = (await panneau.first().textContent()) ?? '';

  attendu(
    /crée son suivi, pas son stock/i.test(texte),
    'l’écran dit qu’importer ne remplit pas le stock',
  );

  // Le jeu de démonstration enregistre des traitements et des apports rattachés
  // au référentiel : il doit donc y avoir de quoi importer. Une liste vide ici
  // signifierait que la lecture ne trouve rien — le défaut le plus probable.
  const lignes = panneau.first().locator('li');
  const combien = await lignes.count();
  attendu(combien > 0, 'des produits employés sont proposés', `${combien} produit(s)`);

  if (combien > 0) {
    attendu(
      /utilisation/i.test(texte),
      'chaque produit dit combien de fois il a servi',
    );

    // Importer le premier, et vérifier qu'il se retrouve dans la page.
    const premiereCase = lignes.first().locator('input[type=checkbox]');
    if (!(await premiereCase.isChecked())) await premiereCase.check();

    const valider = panneau.first().getByRole('button', { name: /Suivre .* en stock/i });
    attendu(await valider.isEnabled(), 'le bouton de validation est actif une fois coché');

    await valider.click();
    await page.waitForTimeout(2500);

    const apres = (await panneau.first().textContent()) ?? '';
    attendu(
      /suivi[s]? en stock\./i.test(apres),
      'le bilan de l’import s’affiche',
    );

    // Et l'article existe vraiment dans la page, pas seulement dans le bilan.
    await page.goto(`${BASE}/stocks`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const pageEntiere = (await page.textContent('body')) ?? '';
    attendu(
      !/Aucun article suivi/i.test(pageEntiere),
      'l’article importé apparaît dans la liste des stocks',
    );
    attendu(
      /mouvement\(s\)/i.test(pageEntiere),
      'l’article importé porte son compteur de mouvements (à zéro)',
    );
  }

  console.info(`\n${echecs === 0 ? '✓' : '✗'} import en stock : ${echecs} écart(s).`);
} finally {
  await navigateur.close();
}
