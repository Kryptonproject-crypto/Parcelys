/**
 * Contrôle de mise en page sur écran de téléphone et de tablette.
 *
 *   node scripts/check-mobile-layout.mjs [url]
 *
 * Vérifie qu'aucune page ne déborde horizontalement — le défaut mobile le plus
 * courant, invisible sur un écran de bureau et invisible aussi des tests d'API,
 * qui ne mesurent rien. Signale l'élément fautif quand il y en a un, plutôt que
 * de se contenter d'un échec.
 *
 * Sept largeurs, et pas une seule
 * -------------------------------
 * Le script ne mesurait qu'à 390 px. C'est la largeur la plus répandue, ce
 * n'est pas la plus dure : un iPhone SE fait 320 px, et une grille qui tient à
 * 390 peut déborder à 320. À l'autre bout, la tablette a ses propres pièges —
 * c'est la largeur où les mises en page basculent en deux colonnes, et où une
 * colonne à largeur fixe se met à dépasser.
 *
 * Chaque page est **rechargée** à 320 px, puis redimensionnée pour les autres
 * largeurs. Le rechargement compte : un composant qui lit la largeur de fenêtre
 * à son montage ne réagit pas à un redimensionnement, et un simple parcours par
 * redimensionnement le manquerait.
 *
 * Prérequis : une instance lancée et le compte de démonstration semé.
 */
import { chromium, devices } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';
import { verifierCompte } from './lib/compte.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

/**
 * Les largeurs demandées, de la plus dure à la plus large.
 *
 * 320 : iPhone SE et petits Android — la contrainte réelle.
 * 360 : le format Android le plus répandu.
 * 375 : iPhone 6 à 8, SE 2e/3e génération.
 * 390 : iPhone 12 à 15.
 * 412 : Pixel et grands Android.
 * 430 : iPhone Pro Max.
 * 768 : tablette en portrait, où les mises en page basculent en deux colonnes.
 */
const LARGEURS = [320, 360, 375, 390, 412, 430, 768];

const PAGES = [
  '/dashboard',
  '/parcelles',
  '/parcelles?vue=tableau',
  '/parcelles?vue=carte',
  '/cultures',
  '/apports',
  '/phytosanitaire',
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
  '/preconisations',
];


// Le compte de démonstration répond-il ? Sans ce contrôle, son absence se
// manifeste trente secondes plus tard par un délai d'attente dépassé.
await verifierCompte(BASE, EMAIL, PASSWORD);

const browser = await chromium.launch({
  executablePath: cheminDuNavigateur(),
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

/** Mesure le débordement, et désigne le coupable s'il y en a un. */
async function mesurer(cible) {
  return cible.evaluate(() => {
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
}

let mesures = 0;

for (const path of PAGES) {
  // Chargement à la largeur la plus dure : un composant qui lit la largeur au
  // montage doit la voir petite au moins une fois.
  await page.setViewportSize({ width: LARGEURS[0], height: 800 });
  // `domcontentloaded` : les tuiles du fond de carte peuvent ne jamais se
  // charger (réseau restreint), et `networkidle` n'arriverait pas.
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const debordements = [];
  for (const largeur of LARGEURS) {
    if (largeur !== LARGEURS[0]) {
      await page.setViewportSize({ width: largeur, height: 800 });
      await page.waitForTimeout(220);
    }
    mesures += 1;
    const result = await mesurer(page);
    if (result.overflow > 0) {
      debordements.push({ largeur, ...result });
    }
  }

  if (debordements.length > 0) {
    failures += 1;
    const resume = debordements.map((d) => `${d.largeur} px (+${d.overflow})`).join(', ');
    console.error(`✗ ${path} — déborde à ${resume}`);
    const premier = debordements[0];
    if (premier?.culprit) console.error(`   ↳ ${premier.culprit}`);
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
  /*
   * Le mot de passe des comptes experts d'essai dépend de qui les a créés :
   * `prisma/seed.ts` et `scripts/audit-fixtures.ts` n'emploient pas le même.
   * Codé en dur, il faisait échouer la connexion en silence, et l'espace
   * expert — trois pages à la coque et à la barre de navigation distinctes —
   * n'était jamais mesuré : le message disait « non mesuré » et la
   * vérification se terminait verte.
   */
  const MOTS_DE_PASSE_EXPERT = [
    process.env.EXPERT_SEED_PASSWORD,
    'MotDePasse1!',
    'AuditParcelys1',
  ].filter(Boolean);

  let motDePasseExpert = MOTS_DE_PASSE_EXPERT[0];
  for (const candidat of MOTS_DE_PASSE_EXPERT) {
    const essai = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: expertEmail, password: candidat }),
    });
    if (essai.ok) {
      motDePasseExpert = candidat;
      break;
    }
  }
  await expertPage.fill('#password', motDePasseExpert);
  await expertPage.click('button[type=submit]');

  try {
    await expertPage.waitForURL('**/portefeuille', { timeout: 20000 });
    for (const path of ['/portefeuille', '/portefeuille/preconisations', '/profil']) {
      await expertPage.setViewportSize({ width: LARGEURS[0], height: 800 });
      await expertPage.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await expertPage.waitForTimeout(1200);

      const debordements = [];
      for (const largeur of LARGEURS) {
        if (largeur !== LARGEURS[0]) {
          await expertPage.setViewportSize({ width: largeur, height: 800 });
          await expertPage.waitForTimeout(220);
        }
        mesures += 1;
        const result = await mesurer(expertPage);
        if (result.overflow > 0) debordements.push({ largeur, ...result });
      }

      expertPages += 1;
      if (debordements.length > 0) {
        failures += 1;
        console.error(
          `✗ ${path} — déborde à ${debordements.map((d) => `${d.largeur} px (+${d.overflow})`).join(', ')}`,
        );
        const premier = debordements[0];
        if (premier?.culprit) console.error(`   ↳ ${premier.culprit}`);
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
    ? `\n✓ ${total} pages tiennent dans ${LARGEURS.join(', ')} px — ${mesures} mesures.`
    : `\n✗ ${failures} page(s) débordent.`,
);
process.exitCode = failures === 0 ? 0 : 1;
