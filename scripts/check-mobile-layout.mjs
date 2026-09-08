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
    const viewport = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewport;
    if (overflow <= 1) return { overflow: 0, culprit: null };

    // L'élément fautif est le moins profond qui dépasse : les autres ne font
    // qu'en hériter.
    let culprit = null;
    let bestDepth = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= viewport + 1) continue;
      let depth = 0;
      for (let node = el; node; node = node.parentElement) depth += 1;
      if (depth < bestDepth) {
        bestDepth = depth;
        culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`;
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

await browser.close();

console.log(
  failures === 0
    ? `\n✓ ${PAGES.length} pages tiennent dans 390 px.`
    : `\n✗ ${failures} page(s) débordent.`,
);
process.exitCode = failures === 0 ? 0 : 1;
