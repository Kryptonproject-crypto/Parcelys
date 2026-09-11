/**
 * Contrôle des fenêtres de saisie, en hauteur.
 *
 *   node scripts/check-modales.mjs [url]
 *
 * Ce que ce script protège : **un formulaire doit être atteignable en entier**,
 * titre compris, sur l'écran qu'on a sous la main.
 *
 * Pourquoi il existe
 * ------------------
 * Le contrôle de mise en page mesurait les débordements **horizontaux**, à sept
 * largeurs de téléphone, et n'ouvrait jamais une fenêtre de saisie. Il ne
 * pouvait donc pas voir ceci : le dialogue était centré par `items-center`, et
 * un dialogue plus haut que la fenêtre déborde alors des deux côtés à parts
 * égales — le haut passant **hors de portée du défilement**, qui ne remonte pas
 * au-dessus de son origine.
 *
 * Mesuré sur le formulaire de traitement phytosanitaire, écran d'ordinateur
 * portable de 768 px : dialogue de 1 003 px, haut à −117 px, et il y restait
 * après avoir remonté le défilement à fond. Le titre et les premiers champs
 * étaient perdus. Le défaut ne se voyait pas sur téléphone, où le centrage ne
 * s'appliquait pas.
 *
 * D'où ce script : il ouvre les fenêtres de saisie, à plusieurs hauteurs
 * d'écran, et vérifie qu'aucune n'a de partie inatteignable.
 *
 * Prérequis : une instance lancée et le compte de démonstration semé.
 */
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';
import { verifierCompte } from './lib/compte.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

/**
 * Hauteurs d'écran éprouvées, de la plus dure à la plus confortable.
 *
 * 600 : un portable 13 pouces dont le navigateur porte barre d'onglets, barre
 *       d'adresse et barre de favoris — la hauteur utile fond vite.
 * 720 : portable courant.
 * 768 : la hauteur où le défaut a été constaté.
 * 900 : grand écran, pour vérifier que le centrage n'a pas été perdu au
 *       passage — un dialogue collé en haut d'un écran vide serait laid.
 */
const HAUTEURS = [600, 720, 768, 900];

/**
 * Ce qui ouvre une fenêtre de saisie, page par page.
 *
 * Les libellés sont ceux de l'interface, relevés à l'écran. Une première
 * version employait des motifs génériques (« Ajouter », « Créer ») qui
 * n'ouvraient qu'un seul formulaire sur douze : un contrôle qui n'exerce qu'un
 * cas ne garde rien.
 */
const PARCOURS = [
  // La suppression de compte : la fenêtre la plus lourde de conséquence, et
  // celle dont on doit pouvoir lire l'avertissement en entier.
  { page: '/profil', bouton: /Supprimer mon compte/i },
];

/** Les onglets de la fiche parcelle, où vivent les formulaires les plus longs. */
const ONGLETS_PARCELLE = [
  { onglet: /^Culture/i, bouton: /Renseigner une culture/i },
  { onglet: /^Culture/i, bouton: /^\+ Couvert/i },
  { onglet: /^Apports/i, bouton: /Ajouter un apport/i },
  { onglet: /^Phytosanitaire/i, bouton: /Ajouter un traitement/i },
  { onglet: /^Travaux/i, bouton: /Ajouter un travail/i },
  { onglet: /^Documents/i, bouton: /^\+ Ajouter un document/i },
];

let echecs = 0;
let mesures = 0;

/**
 * Le dialogue ouvert est-il atteignable en entier ?
 *
 * On ne se contente pas de comparer les hauteurs : ce qui compte est de
 * remonter le défilement à fond et de regarder où se trouve alors le haut du
 * dialogue. Négatif, c'est perdu.
 */
async function mesurer(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const conteneur = dialog.parentElement;
    if (conteneur) conteneur.scrollTop = 0;
    const r = dialog.getBoundingClientRect();
    return {
      hautPerdu: Math.max(0, Math.round(-r.top)),
      hauteur: Math.round(r.height),
      fenetre: window.innerHeight,
      // Le titre est-il réellement visible ? C'est lui qui dit ce qu'on
      // remplit et sur quelle parcelle.
      titreVisible: (() => {
        const h = dialog.querySelector('h2');
        if (!h) return false;
        const hr = h.getBoundingClientRect();
        return hr.top >= 0 && hr.bottom <= window.innerHeight;
      })(),
    };
  });
}

async function essayer(page, libelle, ouvrir) {
  for (const hauteur of HAUTEURS) {
    await page.setViewportSize({ width: 1366, height: hauteur });
    await page.waitForTimeout(250);

    const ouverte = await ouvrir();
    if (!ouverte) return false;

    await page.waitForTimeout(500);
    const m = await mesurer(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    if (!m) return false;
    mesures += 1;

    if (m.hautPerdu > 0 || !m.titreVisible) {
      echecs += 1;
      console.error(
        `✗ ${libelle} à ${hauteur} px — ` +
          (m.hautPerdu > 0
            ? `${m.hautPerdu} px du haut hors d'atteinte`
            : 'titre hors écran') +
          ` (dialogue ${m.hauteur} px)`,
      );
    } else {
      console.log(`✓ ${libelle} à ${hauteur} px — dialogue ${m.hauteur} px`);
    }
  }
  return true;
}


// Le compte de démonstration répond-il ? Sans ce contrôle, son absence se
// manifeste trente secondes plus tard par un délai d'attente dépassé.
await verifierCompte(BASE, EMAIL, PASSWORD);

const browser = await chromium.launch({
  executablePath: cheminDuNavigateur(),
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

// ---- Fiche parcelle : les formulaires les plus longs ----------------------
await page.goto(`${BASE}/parcelles`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const parcelles = await page.locator('a[href^="/parcelles/"]').evaluateAll((liens) =>
  liens
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && /^\/parcelles\/[a-z0-9]{20,}$/.test(h)),
);

if (parcelles.length === 0) {
  console.log('· aucune parcelle en base — fiche parcelle non mesurée');
} else {
  for (const { onglet, bouton } of ONGLETS_PARCELLE) {
    const trouve = await essayer(page, `parcelle · ${bouton.source}`, async () => {
      await page.goto(`${BASE}${parcelles[0]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const tab = page.getByRole('button', { name: onglet }).last();
      if ((await tab.count()) === 0) return false;
      await tab.click();
      await page.waitForTimeout(600);
      const ajout = page.getByRole('button', { name: bouton }).first();
      if ((await ajout.count()) === 0) return false;
      await ajout.click();
      return true;
    });
    if (!trouve) console.log(`· ${bouton.source} : pas de formulaire à ouvrir`);
  }
}

// ---- Les autres écrans ----------------------------------------------------
for (const { page: chemin, bouton, ignorer } of PARCOURS) {
  if (ignorer) continue;
  const trouve = await essayer(page, chemin, async () => {
    await page.goto(`${BASE}${chemin}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const cible = page.getByRole('button', { name: bouton }).first();
    if ((await cible.count()) === 0) return false;
    await cible.click();
    return true;
  });
  if (!trouve) console.log(`· ${chemin} : pas de formulaire à ouvrir`);
}

await browser.close();

console.log(
  echecs === 0
    ? `\n✓ ${mesures} ouverture(s) de formulaire, toutes atteignables en entier.`
    : `\n✗ ${echecs} formulaire(s) partiellement hors d'atteinte.`,
);
process.exitCode = echecs === 0 ? 0 : 1;
