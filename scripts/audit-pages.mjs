/**
 * Audit : chaque page, ouverte pour de vrai, dans les trois rôles.
 *
 *   node scripts/audit-pages.mjs [url]
 *
 * Ce que ce script cherche, et qu'un test d'API ne voit pas :
 *
 *   · une page qui répond 200 mais affiche une erreur React ;
 *   · une image cassée — chemin d'icône erroné, fichier oublié au déploiement ;
 *   · une erreur dans la console du navigateur ;
 *   · une redirection inattendue (la page « existe » mais renvoie ailleurs) ;
 *   · un débordement horizontal sur téléphone ;
 *   · un marqueur de rédaction resté dans le texte ([raison sociale], TODO…).
 *
 * Il ne juge pas le fond : il constate qu'aucune page n'est cassée.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const SHOTS = path.resolve('.preview/audit');
await mkdir(SHOTS, { recursive: true });

const COMPTES = {
  exploitant: {
    identifiants: { email: 'demo@parcelys.local', password: 'Demo1234!' },
    porte: '/connexion',
    pages: [
      '/dashboard',
      '/parcelles',
      '/cultures',
      '/apports',
      '/phytosanitaire',
      '/meteo',
      '/preconisations',
      '/pac',
      '/registres',
      '/historique',
      '/notifications',
      '/profil',
      '/parametres',
    ],
  },
  expert: {
    identifiants: { email: 'expert@conseil.test', password: 'MotDePasse2026' },
    porte: '/connexion-expert',
    pages: ['/portefeuille', '/portefeuille/preconisations', '/profil'],
  },
  administration: {
    identifiants: { email: 'kevin@parcelys.fr', password: 'MotDePasse2026' },
    porte: '/connexion',
    pages: [
      '/administration',
      '/administration/utilisateurs',
      '/administration/invitations',
      '/administration/exploitations',
      '/administration/experts',
      '/administration/journal',
      '/administration/maintenance',
      '/profil',
    ],
  },
};

const PUBLIQUES = [
  '/',
  '/contact',
  '/confidentialite',
  '/cgu',
  '/connexion',
  '/connexion-expert',
  '/inscription',
  '/mot-de-passe-oublie',
];

/** Marqueurs de rédaction qui ne doivent jamais atteindre un visiteur. */
const MARQUEURS = [
  /\[raison sociale\]/i,
  /\[adresse\]/i,
  /\[SIRET\]/i,
  /\[nom\]/i,
  /\[montant\]/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /Lorem ipsum/i,
  /undefined/,
  /\[object Object\]/,
  /NaN\b/,
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});

const anomalies = [];
let controlees = 0;

/** Ouvre une page et relève tout ce qui cloche. */
async function auditer(page, chemin, role) {
  const erreursConsole = [];
  const imagesCassees = [];
  const echecsExternes = [];

  /**
   * Une requête vers un tiers qui échoue n'est pas un défaut de Parcelys : les
   * tuiles de carte viennent d'un service externe, et il arrive qu'il soit
   * injoignable — au champ comme derrière un pare-feu d'intégration. C'est
   * d'ailleurs pour cela que la carte doit rester utilisable sans elles.
   * On note ces échecs à part, sans les compter comme anomalies.
   */
  const surEchecRequete = (requete) => {
    const url = requete.url();
    if (!url.startsWith(BASE)) echecsExternes.push(new URL(url).host);
  };
  page.on('requestfailed', surEchecRequete);

  const surConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const texte = msg.text();
    // Le pendant console de l'échec réseau ci-dessus.
    if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_/.test(texte)) {
      return;
    }
    erreursConsole.push(texte.slice(0, 200));
  };
  const surReponse = (r) => {
    if (r.status() >= 400 && /\.(png|jpe?g|svg|webp|ico|woff2?)$/i.test(r.url())) {
      imagesCassees.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  };
  page.on('console', surConsole);
  page.on('response', surReponse);

  // `domcontentloaded`, pas `networkidle` : les pages qui portent une carte
  // chargent des tuiles depuis un service externe. Si ce service est lent ou
  // injoignable — ce qui arrive au champ comme dans un conteneur d'intégration
  // — le réseau ne se calme jamais et l'audit expire sur une page pourtant
  // saine. On attend le document, puis on laisse le rendu se poser.
  const reponse = await page.goto(`${BASE}${chemin}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(900);

  const arrivee = new URL(page.url()).pathname;
  const statut = reponse?.status() ?? 0;
  const corps = await page.locator('body').innerText().catch(() => '');

  const signale = (quoi) => anomalies.push(`[${role}] ${chemin} — ${quoi}`);

  if (statut >= 400) signale(`statut HTTP ${statut}`);
  if (arrivee !== chemin && !chemin.endsWith('/')) {
    signale(`redirigé vers ${arrivee}`);
  }
  if (/Application error|Unhandled Runtime Error|Internal Server Error/i.test(corps)) {
    signale('erreur applicative affichée');
  }
  for (const marqueur of MARQUEURS) {
    const trouve = corps.match(marqueur);
    if (trouve) signale(`marqueur de rédaction : « ${trouve[0]} »`);
  }
  if (erreursConsole.length > 0) {
    signale(`console : ${erreursConsole.slice(0, 2).join(' | ')}`);
  }
  if (imagesCassees.length > 0) {
    signale(`ressources absentes : ${imagesCassees.slice(0, 3).join(', ')}`);
  }

  // Débordement horizontal : la plaie du téléphone.
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  if (deborde) {
    const largeur = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      fenetre: window.innerWidth,
    }));
    signale(`débordement horizontal (${largeur.page} > ${largeur.fenetre})`);
  }

  if (echecsExternes.length > 0) {
    const hotes = [...new Set(echecsExternes)].join(', ');
    console.log(`      (tiers injoignable ici : ${hotes})`);
  }

  page.off('requestfailed', surEchecRequete);
  page.off('console', surConsole);
  page.off('response', surReponse);
  controlees += 1;
  return corps;
}

async function connexion(page, { email, password }, porte) {
  await page.goto(`${BASE}${porte}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/adresse e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('connexion'), {
    timeout: 20_000,
  });
}

try {
  // --- Pages publiques, sur téléphone ------------------------------------
  console.log('\nPages publiques (Pixel 7)');
  const tel = await browser.newContext({ ...devices['Pixel 7'] });
  const pTel = await tel.newPage();
  for (const chemin of PUBLIQUES) {
    await auditer(pTel, chemin, 'public/mobile');
    console.log(`  · ${chemin}`);
  }
  await pTel.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pTel.screenshot({ path: path.join(SHOTS, 'accueil-mobile.png'), fullPage: true });
  await tel.close();

  // --- Pages publiques, sur écran ----------------------------------------
  console.log('\nPages publiques (bureau)');
  const bureau = await browser.newContext({ ...devices['Desktop Chrome'] });
  const pBureau = await bureau.newPage();
  for (const chemin of PUBLIQUES) {
    await auditer(pBureau, chemin, 'public');
  }
  await pBureau.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pBureau.screenshot({ path: path.join(SHOTS, 'accueil.png'), fullPage: true });
  await pBureau.goto(`${BASE}/contact`, { waitUntil: 'domcontentloaded' });
  await pBureau.screenshot({ path: path.join(SHOTS, 'contact.png'), fullPage: true });
  await bureau.close();

  // --- Chaque rôle, ses pages --------------------------------------------
  for (const [role, config] of Object.entries(COMPTES)) {
    console.log(`\n${role}`);
    const ctx = await browser.newContext({ ...devices['Desktop Chrome'] });
    const page = await ctx.newPage();
    await connexion(page, config.identifiants, config.porte);
    for (const chemin of config.pages) {
      try {
        await auditer(page, chemin, role);
        console.log(`  · ${chemin}`);
      } catch (erreur) {
        anomalies.push(`[${role}] ${chemin} — ${String(erreur).split('\n')[0]}`);
        console.log(`  · ${chemin}  ✗`);
      }
    }
    await ctx.close();
  }

  // --- Le même parcours sur téléphone, pour l'exploitant ------------------
  console.log('\nexploitant (Pixel 7)');
  const ctxTel = await browser.newContext({ ...devices['Pixel 7'] });
  const pageTel = await ctxTel.newPage();
  await connexion(pageTel, COMPTES.exploitant.identifiants, '/connexion');
  for (const chemin of COMPTES.exploitant.pages) {
    await auditer(pageTel, chemin, 'exploitant/mobile');
  }
  await ctxTel.close();

  // --- Verdict ------------------------------------------------------------
  console.log(`\n${controlees} pages contrôlées.`);
  if (anomalies.length === 0) {
    console.log('✅ Aucune anomalie.');
  } else {
    console.log(`\n❌ ${anomalies.length} anomalie(s) :\n`);
    for (const a of anomalies) console.log(`  ${a}`);
    process.exitCode = 1;
  }
  console.log(`\nCopies d’écran : ${SHOTS}`);
} finally {
  await browser.close();
}
