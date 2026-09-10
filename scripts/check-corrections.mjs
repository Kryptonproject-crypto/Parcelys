/**
 * Les corrections signalées par Kevin, vérifiées dans un vrai navigateur.
 *
 *   node scripts/check-corrections.mjs [url]
 *
 * Trois défauts constatés sur son téléphone, trois contrôles :
 *
 *   1. la carte passait AU-DESSUS du menu ouvert. Leaflet empile ses calques
 *      jusqu'à z-index 1000 ; sans contexte d'empilement propre, ces valeurs
 *      concurrençaient celles de la page. On ouvre donc le menu par-dessus une
 *      page qui porte une carte, et on vérifie qui est devant — au pixel ;
 *   2. le bouton « Profil » de l'expert ne menait nulle part : la page vivait
 *      dans un groupe de routes qui renvoie les comptes sans exploitation ;
 *   3. l'expert ne voyait pas le nom des parcelles de l'exploitation suivie.
 *
 * Le compte d'administration est contrôlé au passage : il souffrait du même
 * défaut sur « Profil », sans que personne l'ait encore remarqué.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const SHOTS = path.resolve('.preview/corrections');

/**
 * Comptes d'audit.
 *
 * Ceux que `npm run audit:comptes` provisionne, et rien d'autre. L'adresse
 * `kevin@parcelys.fr` figurait ici alors qu'aucun script ne la crée : le
 * contrôle échouait sur un délai d'attente à la connexion, ce qui ne désignait
 * pas la cause. Deux scripts du dépôt ne doivent pas se contredire sur les
 * comptes qu'ils supposent.
 *
 *     npm run audit:comptes   # à lancer avant ce contrôle
 */
const COMPTES = {
  exploitant: {
    email: process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local',
    password: process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!',
  },
  expert: { email: 'expert@conseil.test', password: 'MotDePasse2026' },
  admin: { email: 'administration@parcelys.test', password: 'MotDePasse2026' },
};

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function connexion(page, { email, password }, porte = '/connexion') {
  await page.goto(`${BASE}${porte}`, { waitUntil: 'networkidle' });
  await page.getByLabel(/adresse e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('connexion'), { timeout: 20_000 });
}

try {
  // --- 1. La carte ne passe plus devant le menu -------------------------
  console.log('\n1. La carte reste derrière le menu');
  const tel = await browser.newContext({ ...devices['Pixel 7'] });
  const p1 = await tel.newPage();
  await connexion(p1, COMPTES.exploitant);

  await p1.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  const carte = p1.locator('.leaflet-container').first();
  await carte.waitFor({ timeout: 20_000 });

  // La carte doit être à l'écran, sinon il n'y a rien à sonder et le contrôle
  // passerait à vide. On l'amène donc au centre AVANT d'ouvrir le menu.
  await carte.scrollIntoViewIfNeeded();
  await p1.waitForTimeout(1200); // les tuiles

  await p1.getByRole('button', { name: /menu|ouvrir le menu/i }).first().click();
  await p1.waitForTimeout(600);

  // Le test qui compte : au centre du tiroir, qui répond au clic ?
  const verdict = await p1.evaluate(() => {
    const carte = document.querySelector('.leaflet-container');
    if (!carte) return { erreur: 'aucune carte sur la page' };
    const boite = carte.getBoundingClientRect();

    // Le point sondé doit être visible, sinon `elementFromPoint` renvoie null
    // et le contrôle passerait à vide — en croyant avoir prouvé quelque chose.
    const x = Math.round(Math.min(Math.max(boite.left + boite.width / 2, 1), window.innerWidth - 2));
    const y = Math.round(Math.min(Math.max(boite.top + boite.height / 2, 1), window.innerHeight - 2));
    if (y >= window.innerHeight - 2 || boite.bottom < 0) {
      return { erreur: 'la carte est hors de la fenêtre : rien à sonder' };
    }

    const dessus = document.elementFromPoint(x, y);
    if (!dessus) return { erreur: `aucun élément en (${x}, ${y})` };
    return {
      surLaCarte: Boolean(dessus.closest('.leaflet-container')),
      dansLeMenu: Boolean(dessus.closest('nav, aside, [role="dialog"], .fixed')),
      balise: dessus.tagName,
      classe: dessus.className?.toString().slice(0, 60) ?? '',
    };
  });

  await p1.screenshot({ path: path.join(SHOTS, '01-menu-sur-carte.png') });
  expect(!verdict.erreur, `Contrôle impossible : ${verdict.erreur}`);
  expect(
    !verdict.surLaCarte,
    `La carte est encore au premier plan par-dessus le menu (${verdict.balise}).`,
  );
  expect(
    verdict.dansLeMenu,
    `Ni la carte ni le menu au point sondé : ${verdict.balise} « ${verdict.classe} ». ` +
      'Le contrôle ne prouverait rien.',
  );
  console.log(`  ✓ au centre de la carte, c'est le menu qui répond (${verdict.balise})`);

  // Les commandes de la carte comptent autant que la carte : le sélecteur
  // « Plan / Satellite » vit hors du conteneur Leaflet et flottait, lui, bien
  // au-dessus du tiroir.
  const commandes = await p1.evaluate(() => {
    const zone = document.querySelector('.leaflet-container')?.parentElement;
    if (!zone) return [];
    const boutons = [...zone.querySelectorAll('button, .leaflet-control a')];
    return boutons
      .map((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
        const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 2));
        const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 2));
        const dessus = document.elementFromPoint(x, y);
        return dessus && (dessus === b || b.contains(dessus))
          ? (b.textContent?.trim() || b.getAttribute('aria-label') || b.tagName)
          : null;
      })
      .filter(Boolean);
  });

  expect(
    commandes.length === 0,
    `Des commandes de la carte restent cliquables par-dessus le menu : ${commandes.join(', ')}`,
  );
  console.log('  ✓ aucune commande de carte ne perce le menu');

  // --- 2. Le profil, pour chaque nature de compte -----------------------
  console.log('\n2. Le bouton « Profil » mène au profil');
  for (const [nom, identifiants] of Object.entries(COMPTES)) {
    const ctx = await browser.newContext({ ...devices['Desktop Chrome'] });
    const page = await ctx.newPage();
    await connexion(
      page,
      identifiants,
      nom === 'expert' ? '/connexion-expert' : '/connexion',
    );

    await page.goto(`${BASE}/profil`, { waitUntil: 'networkidle' });
    const chemin = new URL(page.url()).pathname;
    expect(
      chemin === '/profil',
      `Compte ${nom} : /profil renvoie vers ${chemin} — le bouton ne mène nulle part.`,
    );
    const titre = await page.locator('h1').first().innerText();
    expect(/profil/i.test(titre), `Compte ${nom} : titre inattendu « ${titre} ».`);
    console.log(`  ✓ ${nom} : /profil s'ouvre (« ${titre.trim()} »)`);
    await page.screenshot({ path: path.join(SHOTS, `02-profil-${nom}.png`) });
    await ctx.close();
  }

  // --- 3. L'expert voit les parcelles nommées ---------------------------
  console.log('\n3. L’expert voit les parcelles, nommées, par exploitation');
  const ctxExpert = await browser.newContext({ ...devices['Desktop Chrome'] });
  const pe = await ctxExpert.newPage();
  await connexion(pe, COMPTES.expert, '/connexion-expert');

  await pe.goto(`${BASE}/portefeuille`, { waitUntil: 'networkidle' });
  const portefeuille = await pe.locator('main').innerText();
  expect(
    /exploitation\(s\) suivie\(s\)|Portefeuille/i.test(portefeuille),
    `Portefeuille inattendu :\n${portefeuille.slice(0, 400)}`,
  );
  await pe.screenshot({ path: path.join(SHOTS, '03-portefeuille.png'), fullPage: true });

  await pe.getByRole('link', { name: /^Ouvrir$/ }).first().click();
  await pe.waitForLoadState('networkidle');
  await pe.locator('.leaflet-container').first().waitFor({ timeout: 20_000 });

  const parcelles = await pe.evaluate(() => {
    const liens = [...document.querySelectorAll('a[href*="/parcelles/"]')];
    return liens.map((a) => a.textContent?.trim().split('\n')[0] ?? '').filter(Boolean);
  });
  expect(
    parcelles.length > 0,
    "Aucune parcelle nommée sous la carte : l'expert doit pouvoir les lire, pas les deviner.",
  );
  console.log(`  ✓ ${parcelles.length} parcelle(s) nommée(s) : ${parcelles.slice(0, 4).join(', ')}`);
  await pe.screenshot({ path: path.join(SHOTS, '04-exploitation-suivie.png'), fullPage: true });

  console.log('\n✅ Les trois corrections tiennent au navigateur.');
  console.log(`   Copies d’écran : ${SHOTS}`);
} finally {
  await browser.close();
}
