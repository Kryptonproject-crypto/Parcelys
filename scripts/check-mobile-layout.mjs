/**
 * Contrôle de mise en page sur écran de téléphone.
 *
 *   node scripts/check-mobile-layout.mjs [url]
 *
 * Vérifie qu'aucune page ne déborde horizontalement à 390 px — le défaut
 * mobile le plus courant, invisible sur un écran de bureau et invisible aussi
 * des tests d'API, qui ne mesurent rien. Signale l'élément fautif quand il y en
 * a un, plutôt que de se contenter d'un échec.
 *
 * Prérequis : une instance lancée et le compte de démonstration semé.
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

const PAGES = [
  '/dashboard',
  '/parcelles',
  '/parcelles?vue=tableau',
  '/parcelles?vue=carte',
  '/cultures',
  '/apports',
  '/phytosanitaire',
  '/meteo',
  '/registres',
  '/historique',
  '/documents',
  '/exports',
  '/notifications',
  '/profil',
  '/parametres',
  '/administration',
  '/administration/utilisateurs',
  '/administration/invitations',
  '/administration/exploitations',
  '/administration/journal',
  '/administration/maintenance',
  '/preconisations',
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();

await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

let failures = 0;

for (const path of PAGES) {
  // `domcontentloaded` : les tuiles du fond de carte peuvent ne jamais se
  // charger (réseau restreint), et `networkidle` n'arriverait pas.
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    if (overflow <= 1) return { overflow: 0, culprit: null };

    // Bissection plutôt qu'heuristique de profondeur : on masque chaque
    // élément et on regarde si le débordement disparaît. Un élément qui
    // dépasse à l'intérieur d'un conteneur défilant ne fait pas déborder la
    // page — le repérer par sa position seule désignerait des innocents.
    let culprit = null;
    let deepest = -1;
    for (const el of document.querySelectorAll('body *')) {
      const previous = el.style.display;
      el.style.display = 'none';
      const without = de.scrollWidth;
      el.style.display = previous;
      if (without >= de.scrollWidth) continue;

      let depth = 0;
      for (let node = el; node; node = node.parentElement) depth += 1;
      if (depth > deepest) {
        deepest = depth;
        const text = (el.textContent ?? '').trim().slice(0, 30);
        culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)}${
          text ? ` — « ${text} »` : ''
        }`;
      }
    }
    return { overflow, culprit };
  });

  if (result.overflow > 0) {
    failures += 1;
    console.error(`✗ ${path} — déborde de ${result.overflow} px`);
    if (result.culprit) console.error(`   ↳ ${result.culprit}`);
  } else {
    console.log(`✓ ${path}`);
  }
}

// L'espace expert a sa propre coque et sa propre barre de navigation : il doit
// être mesuré séparément, sinon un débordement y passerait inaperçu.
const expertEmail = await page.evaluate(async () => {
  const response = await fetch('/api/admin/users?statut=experts');
  if (!response.ok) return null;
  const data = await response.json();
  return data.users?.[0]?.email ?? null;
});

let expertPages = 0;
if (expertEmail) {
  const expertContext = await browser.newContext({ ...devices['iPhone 13'] });
  const expertPage = await expertContext.newPage();
  await expertPage.goto(`${BASE}/connexion-expert`, { waitUntil: 'domcontentloaded' });
  await expertPage.fill('#email', expertEmail);
  await expertPage.fill('#password', 'MotDePasse1!');
  await expertPage.click('button[type=submit]');

  try {
    await expertPage.waitForURL('**/portefeuille', { timeout: 20000 });
    for (const path of ['/portefeuille', '/portefeuille/preconisations', '/profil']) {
      await expertPage.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await expertPage.waitForTimeout(1200);
      const overflow = await expertPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expertPages += 1;
      if (overflow > 1) {
        failures += 1;
        console.error(`✗ ${path} — déborde de ${overflow} px`);
      } else {
        console.log(`✓ ${path}`);
      }
    }
  } catch {
    console.log('· espace expert non mesuré (mot de passe de test différent)');
  }
} else {
  console.log('· aucun compte expert en base — espace expert non mesuré');
}

await browser.close();

const total = PAGES.length + expertPages;
console.log(
  failures === 0
    ? `\n✓ ${total} pages tiennent dans 390 px.`
    : `\n✗ ${failures} page(s) débordent.`,
);
process.exitCode = failures === 0 ? 0 : 1;
