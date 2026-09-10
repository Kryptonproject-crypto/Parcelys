/**
 * Contrôle des écrans ajoutés en 0.7.0, au navigateur et à la taille d'un
 * téléphone.
 *
 * Ce qu'il a trouvé, et qu'aucun test ne trouvait : `TableWrapper` rend déjà un
 * `<table>`, et les tableaux nouvellement écrits en imbriquaient un second.
 * C'est du HTML invalide : le navigateur le déplace, le DOM cesse de
 * correspondre au rendu du serveur, et React abandonne l'hydratation de la
 * page — silencieusement, sauf dans la console.
 *
 * Il vérifie trois choses par écran :
 *
 *   · la page répond 200 ;
 *   · rien ne déborde de la largeur du téléphone ;
 *   · aucune erreur JavaScript, hydratation comprise.
 *
 * **Une seule connexion, réutilisée.** Se reconnecter à chaque page semblait
 * plus propre pour attribuer les erreurs, mais la limitation de débit — qui
 * fait son travail — coupait la série en cours de route, et le symptôme (un
 * délai d'attente sur la navigation) n'accusait pas la bonne cause. Les
 * messages sont vidés entre deux pages, ce qui suffit à les attribuer.
 *
 * Demande le serveur démarré et les comptes d'audit :
 *
 *     npm run build && npm start &
 *     npm run audit:comptes
 *     CHROMIUM_PATH=/usr/bin/chromium node scripts/check-ecrans-07.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.PARCELYS_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const MOT_DE_PASSE = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

const PAGES = [
  '/stocks',
  '/conformite',
  '/conformite/dossier',
  '/cultures',
  '/parcelles',
  '/exports',
  '/registres',
  '/apports',
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();

const messages = [];
page.on('console', (m) => {
  if (m.type() === 'error') messages.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => messages.push(`pageerror: ${e.message.slice(0, 200)}`));

await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', EMAIL);
await page.fill('#password', MOT_DE_PASSE);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 30_000 });

const fautifs = [];

for (const chemin of PAGES) {
  messages.length = 0;
  const reponse = await page.goto(`${BASE}${chemin}`, { waitUntil: 'domcontentloaded' });
  // Le temps que l'hydratation se plaigne, si elle a de quoi.
  await page.waitForTimeout(2500);

  const mesure = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    vue: window.innerWidth,
  }));
  const deborde = mesure.scroll > mesure.vue + 1;
  const ok = reponse.status() === 200 && !deborde && messages.length === 0;

  console.log(
    `${ok ? '✓' : '✗'} ${chemin.padEnd(22)} ${reponse.status()} · ${mesure.scroll}/${mesure.vue}px` +
      (messages.length ? ` · ${messages.length} erreur(s)` : ''),
  );
  for (const m of messages) console.log(`    ${m}`);
  if (!ok) fautifs.push(chemin);
}

await browser.close();

if (fautifs.length > 0) {
  console.log(`\n✗ ${fautifs.join(', ')}`);
  process.exit(1);
}
console.log('\n✓ tout est propre');
