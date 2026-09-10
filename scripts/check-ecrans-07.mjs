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
 * Demande le serveur démarré et les comptes d'audit :
 *
 *     npm run build && npm start &
 *     npm run audit:comptes
 *     CHROMIUM_PATH=/usr/bin/chromium node scripts/check-ecrans-07.mjs
 */
import { chromium, devices } from 'playwright';
const BASE = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

const pages = ['/stocks', '/conformite', '/conformite/dossier', '/cultures', '/parcelles', '/exports', '/registres', '/apports'];
const erreurs = [];

for (const chemin of pages) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const locales = [];
  page.on('console', (m) => { if (m.type() === 'error') locales.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => locales.push(`pageerror: ${e.message.slice(0, 160)}`));

  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'demo@parcelys.local');
  await page.fill('#password', 'Demo1234!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  locales.length = 0; // on ne mesure que la page visée

  const r = await page.goto(`${BASE}${chemin}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const mesure = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    vue: window.innerWidth,
  }));
  const deborde = mesure.scroll > mesure.vue + 1;
  const ok = r.status() === 200 && !deborde && locales.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${chemin.padEnd(22)} ${r.status()} · ${mesure.scroll}/${mesure.vue}px${locales.length ? ` · ${locales.length} erreur(s)` : ''}`);
  for (const e of locales) console.log(`    ${e}`);
  if (!ok) erreurs.push(chemin);
  await ctx.close();
}
await browser.close();
console.log(erreurs.length ? `\n✗ ${erreurs.join(', ')}` : '\n✓ tout est propre');
