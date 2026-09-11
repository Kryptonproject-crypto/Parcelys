/**
 * Revue de toutes les pages, dans un vrai navigateur.
 *
 *   node scripts/check-pages.mjs [url]
 *
 * Pour chaque page des trois espaces : code HTTP, erreurs de console, requêtes
 * réseau en échec, et liens internes morts. Une page qui « s'affiche » en
 * cachant une exception React n'est pas une page qui marche — d'où la lecture
 * de la console plutôt qu'un simple contrôle de statut.
 *
 * Prérequis : instance lancée, base semée, et un compte expert avec au moins
 * un domaine suivi (créé par `scripts/check-advisory-flow.mjs`).
 */
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';
import { verifierCompte } from './lib/compte.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const ADMIN_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

/**
 * Bruit connu, à ne pas confondre avec un défaut.
 *
 * Deux sources, toutes deux normales :
 *
 *  - Next précharge les liens visibles (`?_rsc=…`). Quitter la page avant la
 *    fin annule ces requêtes : `ERR_ABORTED` est le comportement attendu d'un
 *    préchargement, pas une panne.
 *  - Les tuiles de fond de carte sortent vers OpenStreetMap. Sans accès
 *    extérieur, elles échouent — la carte se monte quand même et les contours
 *    de parcelles s'affichent, ce que ce script vérifie par ailleurs.
 */
const IGNORED = [
  /_rsc=/,
  /net::ERR_ABORTED/,
  /Failed to fetch RSC payload/i,
  /tile\.openstreetmap\.org/,
  /server\.arcgisonline\.com/,
  /basemaps\.cartocdn\.com/,
  /net::ERR_TUNNEL_CONNECTION_FAILED/,
  /favicon/i,
];

const ignorable = (text) => IGNORED.some((pattern) => pattern.test(text));

const FARMER_PAGES = [
  '/dashboard',
  '/parcelles',
  '/parcelles?vue=tableau',
  '/parcelles?vue=carte',
  '/parcelles/nouvelle',
  '/cultures',
  '/apports',
  '/phytosanitaire',
  '/preconisations',
  '/meteo',
  '/pac',
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
  '/administration/experts',
  '/administration/journal',
  '/administration/maintenance',
];

const PUBLIC_PAGES = [
  '/',
  '/connexion',
  '/connexion-expert',
  '/inscription',
  '/cgu',
  '/confidentialite',
];


// Le compte de démonstration répond-il ? Sans ce contrôle, son absence se
// manifeste trente secondes plus tard par un délai d'attente dépassé.
await verifierCompte(BASE, EMAIL, PASSWORD);

const browser = await chromium.launch({
  executablePath: cheminDuNavigateur(),
});

const problems = [];
let checked = 0;

/** Visite une page et rend compte de tout ce qui a mal tourné. */
async function visit(page, path, { expectStatus = 200 } = {}) {
  const consoleErrors = [];
  const failedRequests = [];

  const onConsole = (message) => {
    if (message.type() === 'error' && !ignorable(message.text())) {
      consoleErrors.push(message.text());
    }
  };
  const onFailed = (request) => {
    // L'URL seule ne suffit pas : c'est le motif de l'échec qui distingue une
    // annulation de préchargement d'une vraie panne.
    const detail = `${request.url()} (${request.failure()?.errorText ?? '?'})`;
    if (!ignorable(detail)) failedRequests.push(detail);
  };
  const onResponse = (response) => {
    if (response.status() >= 500 && !ignorable(response.url())) {
      failedRequests.push(`${response.url()} → HTTP ${response.status()}`);
    }
  };

  page.on('console', onConsole);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);

  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(1400);

  page.off('console', onConsole);
  page.off('requestfailed', onFailed);
  page.off('response', onResponse);

  checked += 1;
  const status = response?.status() ?? 0;
  const issues = [];

  if (status !== expectStatus) issues.push(`HTTP ${status}`);
  if (consoleErrors.length > 0) issues.push(`console : ${consoleErrors[0].slice(0, 160)}`);
  if (failedRequests.length > 0) issues.push(`réseau : ${failedRequests[0].slice(0, 160)}`);

  // Une page d'erreur Next rendue en 200 reste une page cassée.
  const body = (await page.textContent('body')) ?? '';
  if (/Application error|Internal Server Error|Unhandled Runtime Error/i.test(body)) {
    issues.push('page d’erreur rendue');
  }

  if (issues.length > 0) {
    problems.push(`${path} — ${issues.join(' · ')}`);
    console.log(`  ✗ ${path} — ${issues.join(' · ')}`);
  } else {
    console.log(`  ✓ ${path}`);
  }

  return page.url();
}

// ---------------------------------------------------------------------------
console.log('\n1. Pages publiques');
const visitor = await browser.newContext();
const visitorPage = await visitor.newPage();
for (const path of PUBLIC_PAGES) await visit(visitorPage, path);

// Une page protégée renvoie l'anonyme vers la connexion, sans erreur.
await visitorPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await visitorPage.waitForTimeout(800);
const redirected = visitorPage.url().includes('/connexion');
console.log(`  ${redirected ? '✓' : '✗'} /dashboard renvoie un visiteur vers la connexion`);
if (!redirected) problems.push('/dashboard accessible sans session');
checked += 1;

// ---------------------------------------------------------------------------
console.log("\n2. Espace exploitation et administration");
const farmer = await browser.newContext();
const farmerPage = await farmer.newPage();

await farmerPage.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
await farmerPage.fill('#email', ADMIN_EMAIL);
await farmerPage.fill('#password', ADMIN_PASSWORD);
await farmerPage.click('button[type=submit]');
await farmerPage.waitForURL('**/dashboard', { timeout: 30_000 });

for (const path of FARMER_PAGES) await visit(farmerPage, path);

// Fiche parcelle et ses onglets : la page la plus dense de l'application.
const parcelHref = await farmerPage.evaluate(async () => {
  const response = await fetch('/api/parcels');
  const data = await response.json();
  return data.items?.[0]?.id ?? null;
});
if (parcelHref) {
  for (const tab of [
    '',
    '?onglet=cultures',
    '?onglet=apports',
    '?onglet=phytosanitaire',
    '?onglet=travaux',
    '?onglet=documents',
    '?onglet=historique',
  ]) {
    await visit(farmerPage, `/parcelles/${parcelHref}${tab}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n3. Liens internes morts');
await farmerPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await farmerPage.waitForTimeout(1000);

const internalLinks = await farmerPage.evaluate(() =>
  [...new Set(
    [...document.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => href && !href.startsWith('//') && !href.includes('#')),
  )],
);

for (const href of internalLinks) {
  const status = await farmerPage.evaluate(async (url) => {
    const response = await fetch(url, { method: 'GET', redirect: 'manual' });
    return response.status;
  }, href);
  const ok = status < 400;
  checked += 1;
  if (!ok) {
    problems.push(`lien mort : ${href} → HTTP ${status}`);
    console.log(`  ✗ ${href} → HTTP ${status}`);
  }
}
console.log(`  ✓ ${internalLinks.length} lien(s) du tableau de bord vérifié(s)`);

// ---------------------------------------------------------------------------
console.log("\n4. Espace expert");
const expertAccount = await farmerPage.evaluate(async () => {
  const response = await fetch('/api/admin/users?statut=tous');
  const data = await response.json();
  return (data.users ?? []).find((u) => u.accountType === 'AGRONOMIST')?.email ?? null;
});

if (!expertAccount) {
  console.log('  · aucun compte expert en base — lancez scripts/check-advisory-flow.mjs');
} else {
  const expert = await browser.newContext();
  const expertPage = await expert.newPage();
  await expertPage.goto(`${BASE}/connexion-expert`, { waitUntil: 'domcontentloaded' });
  await expertPage.fill('#email', expertAccount);
  await expertPage.fill('#password', 'MotDePasse1!');
  await expertPage.click('button[type=submit]');

  try {
    await expertPage.waitForURL('**/portefeuille', { timeout: 20_000 });
    for (const path of ['/portefeuille', '/portefeuille/preconisations', '/profil']) {
      await visit(expertPage, path);
    }

    // Un expert ne doit pas atteindre l'espace exploitation.
    await expertPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expertPage.waitForTimeout(800);
    const blocked = !expertPage.url().includes('/dashboard');
    checked += 1;
    console.log(`  ${blocked ? '✓' : '✗'} /dashboard hors de portée d'un expert`);
    if (!blocked) problems.push("un expert atteint l'espace exploitation");
  } catch {
    console.log(`  · connexion expert impossible (mot de passe de test différent) — ignoré`);
  }
}

await browser.close();

console.log(
  `\n${problems.length === 0 ? '✓' : '✗'} ${checked} contrôle(s), ${problems.length} problème(s).`,
);
if (problems.length > 0) {
  console.log('\nProblèmes :');
  for (const problem of problems) console.log(`  · ${problem}`);
  process.exit(1);
}
console.log('');
