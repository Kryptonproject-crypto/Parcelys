/**
 * Explorer Parcelys page par page, et regarder ce qui se passe vraiment.
 *
 *   npm run audit:complet
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE SCRIPT FAIT QUE LES AUTRES NE FONT PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `check:pages` vérifie que les pages tiennent dans une largeur donnée.
 * `check:security` vérifie le cloisonnement. Aucun des deux ne dit si une page
 * **se charge sans erreur** : une page qui rend un écran vide avec une
 * exception dans la console passe ces deux contrôles.
 *
 * Ici, chaque page est ouverte dans un vrai navigateur, et l'on écoute :
 *
 *   · le **code HTTP** de la navigation — un 500 est un 500 ;
 *   · les **erreurs JavaScript** non rattrapées (`pageerror`) ;
 *   · les **messages d'erreur de la console** ;
 *   · les **requêtes échouées** partant de la page — une page qui s'affiche
 *     mais dont l'API renvoie 500 est cassée, simplement plus discrètement ;
 *   · la présence d'un **contenu** : un `<main>` vide est un symptôme.
 *
 * Les pages à paramètre (`/parcelles/[id]`) sont visitées avec un identifiant
 * réel, lu en base : les visiter avec un identifiant inventé ne testerait que
 * la page 404.
 *
 * Trois profils, parce qu'une page peut fonctionner pour l'un et casser pour
 * l'autre : exploitant, expert agronomique, administrateur.
 */
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

/** Bruit connu, sans rapport avec le fonctionnement de la page. */
const BRUIT = [
  // Les tuiles de carte et le géocodeur sont bloqués par le mandataire de
  // l'environnement d'audit. Sur le Pi de Kevin, ils répondent.
  /tile\.openstreetmap/i,
  /data\.geopf\.fr/i,
  /api-adresse\.data\.gouv\.fr/i,
  /ERR_(BLOCKED_BY_CLIENT|NAME_NOT_RESOLVED|CONNECTION_REFUSED|PROXY)/i,
  /*
   * `ERR_ABORTED` : le navigateur a **annulé** la requête, le serveur n'a
   * jamais été interrogé. Ce n'est donc pas un échec du serveur.
   *
   * Le cas rencontré : l'audit enchaîne les pages vite, et la demande de
   * favicon d'une page est annulée par la navigation vers la suivante. L'audit
   * a signalé une fois « échec réseau /favicon-32.png » sur /administration.
   * Vérification faite, le fichier est bien là et répond : cinq requêtes
   * directes, cinq fois HTTP 200 et 3 252 octets ; et l'exécution suivante de
   * l'audit, à l'identique, n'a rien signalé.
   *
   * Ce motif ne masque que l'annulation — mais il fallait d'abord s'assurer
   * que le cas inverse, un fichier réellement absent, restait visible. Il ne
   * l'était pas : un fichier manquant répond 404, et le contrôle des réponses
   * ne regardait que les 5xx. Le voici ajouté juste en dessous.
   */
  /ERR_ABORTED/i,
  // Next.js signale en développement les images sans dimension ; sans effet.
  /Download the React DevTools/i,
  /*
   * Les préchargements de Next.js (`?_rsc=…`), et l'échec de tunnel qui va
   * avec.
   *
   * Survolez un lien, Next.js va chercher la page d'avance. Dans cet
   * environnement d'audit, le navigateur passe par un mandataire HTTP qui
   * refuse d'ouvrir un tunnel vers 127.0.0.1 : ces requêtes-là échouent
   * **toutes**, sur toutes les pages, indépendamment de l'état du code.
   *
   * Sans ce filtre, l'audit signalait 45 problèmes dont 44 étaient le même
   * artefact d'environnement — et le seul vrai défaut (une parcelle
   * inexistante rendant un 200 au lieu d'un 404) se noyait dedans. Un
   * contrôle qui crie sur tout ne se lit plus.
   *
   * Ce filtre ne masque que le préchargement : une vraie requête de page ou
   * d'API vers le serveur reste contrôlée.
   */
  /[?&]_rsc=/,
  /ERR_TUNNEL_CONNECTION_FAILED/i,
];

const estDuBruit = (texte) => BRUIT.some((r) => r.test(texte));

let echecs = 0;
const problemes = [];

function attendu(condition, quoi, detail = '') {
  if (!condition) {
    echecs += 1;
    problemes.push(`${quoi}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  }
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
}

async function connecter(page, email, motDePasse, cheminConnexion = '/connexion') {
  await page.goto(`${BASE}${cheminConnexion}`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    /\/(dashboard|parcelles|portefeuille|administration)/,
    { timeout: 25_000 },
  );
}

/**
 * Ouvre une page et rend tout ce qui a mal tourné.
 *
 * Les écouteurs sont posés **avant** la navigation : une erreur émise pendant
 * le rendu initial est la plus intéressante, et c'est celle qu'on manquerait en
 * les posant après.
 */
async function inspecter(page, chemin) {
  const erreursJs = [];
  const erreursConsole = [];
  const requetesEchouees = [];

  const surErreur = (e) => {
    const t = e?.message ?? String(e);
    if (!estDuBruit(t)) erreursJs.push(t);
  };
  const surConsole = (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!estDuBruit(t)) erreursConsole.push(t);
  };
  /*
   * Fichiers statiques servis par Parcelys : images, icônes, feuilles de
   * style, polices, manifeste. Un 404 sur l'un d'eux est un vrai défaut —
   * l'icône ne s'affiche pas, la police retombe sur une autre — et rien ne le
   * signalait : le contrôle ci-dessous ne regardait que les 5xx.
   *
   * Restreint aux fichiers, et à ceux servis par Parcelys : un 404 sur une
   * page est parfois la bonne réponse (l'audit en provoque un exprès), et un
   * 404 d'une API est le refus attendu d'un contrôle de cloisonnement.
   */
  const FICHIER_STATIQUE =
    /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|otf|webmanifest|json)(\?|$)/i;

  const surReponse = (r) => {
    const url = r.url();
    if (estDuBruit(url)) return;

    if (r.status() >= 500) {
      requetesEchouees.push(`${r.status()} ${url.replace(BASE, '')}`);
      return;
    }

    /*
     * N'importe quelle erreur, et non une liste de codes.
     *
     * Premier réflexe : guetter le 404. Mais en retirant `favicon-32.png` pour
     * éprouver ce contrôle, le serveur a répondu **400**, pas 404 — Next.js
     * traite les icônes déclarées dans les métadonnées à part. Une liste de
     * codes aurait laissé passer précisément le cas qui a motivé ce contrôle.
     *
     * La règle est plus simple à dire ainsi : un fichier statique de Parcelys
     * se sert. Tout ce qui n'est pas un succès est un défaut.
     */
    if (
      r.status() >= 400 &&
      url.startsWith(BASE) &&
      !url.includes('/api/') &&
      FICHIER_STATIQUE.test(url)
    ) {
      requetesEchouees.push(`${r.status()} sur un fichier — ${url.replace(BASE, '')}`);
    }
  };
  const surRequeteRatee = (r) => {
    const cause = r.failure()?.errorText ?? 'cause inconnue';
    const t = `${r.url()} ${cause}`;
    // La cause fait partie du constat. Sans elle, le rapport disait « échec
    // réseau /favicon-32.png » sans dire pourquoi, et il fallait refaire à la
    // main l'enquête que l'audit venait de faire.
    if (!estDuBruit(t)) {
      requetesEchouees.push(`échec réseau ${r.url().replace(BASE, '')} (${cause})`);
    }
  };

  page.on('pageerror', surErreur);
  page.on('console', surConsole);
  page.on('response', surReponse);
  page.on('requestfailed', surRequeteRatee);

  let statut = 0;
  let texte = '';
  try {
    const reponse = await page.goto(`${BASE}${chemin}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    statut = reponse?.status() ?? 0;
    // Laisser les composants clients monter et leurs appels partir.
    await page.waitForTimeout(900);
    texte = (await page.textContent('body')) ?? '';
  } catch (cause) {
    erreursJs.push(`navigation : ${cause.message}`);
  } finally {
    page.off('pageerror', surErreur);
    page.off('console', surConsole);
    page.off('response', surReponse);
    page.off('requestfailed', surRequeteRatee);
  }

  return { statut, texte, erreursJs, erreursConsole, requetesEchouees };
}

/** Une page est saine si elle répond 2xx/3xx, sans erreur, avec du contenu. */
async function verifierPage(page, chemin, { attenduStatut = 200, minTexte = 40 } = {}) {
  const r = await inspecter(page, chemin);
  const soucis = [];

  if (r.statut !== attenduStatut) soucis.push(`HTTP ${r.statut}`);
  if (r.erreursJs.length) soucis.push(`JS : ${r.erreursJs[0]}`);
  if (r.erreursConsole.length) soucis.push(`console : ${r.erreursConsole[0]}`);
  if (r.requetesEchouees.length) soucis.push(`requête : ${r.requetesEchouees[0]}`);
  if (r.texte.trim().length < minTexte) soucis.push('page quasi vide');
  // Next.js affiche cet écran quand un composant serveur lève.
  if (/Application error: a server-side exception/i.test(r.texte)) {
    soucis.push('exception serveur rendue à l’écran');
  }

  attendu(soucis.length === 0, chemin, soucis.join(' ; '));
  return r;
}

export { BASE, attendu, connecter, inspecter, verifierPage, chromium };

// ---------------------------------------------------------------------------

async function main() {
  const donnees = JSON.parse(process.env.AUDIT_DONNEES ?? '{}');
  const navigateur = await chromium.launch({
    executablePath: cheminDuNavigateur(),
  });

  try {
    // --- Pages publiques, sans compte ----------------------------------
    console.info('\n▸ pages publiques (sans compte)');
    {
      const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
      for (const chemin of [
        '/',
        '/connexion',
        '/connexion-expert',
        '/inscription',
        '/mot-de-passe-oublie',
        '/cgu',
        '/confidentialite',
        '/contact',
      ]) {
        await verifierPage(page, chemin);
      }

      // Une page protégée sans session doit rediriger vers la connexion, pas
      // rendre un écran vide ni une exception.
      const r = await inspecter(page, '/dashboard');
      attendu(
        /\/connexion/.test(page.url()),
        '/dashboard sans session redirige vers la connexion',
        page.url().replace(BASE, ''),
      );
      attendu(r.erreursJs.length === 0, '/dashboard sans session : aucune erreur JS');
      await page.close();
    }

    // --- Espace exploitant ---------------------------------------------
    console.info('\n▸ espace exploitant');
    {
      const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
      await connecter(page, donnees.exploitantEmail, donnees.motDePasse);

      const chemins = [
        '/dashboard',
        '/parcelles',
        '/parcelles?vue=tableau',
        '/parcelles?vue=carte',
        '/parcelles/nouvelle',
        '/cultures',
        '/apports',
        '/phytosanitaire',
        '/registres',
        '/conformite',
        '/conformite/dossier',
        '/stocks',
        '/documents',
        '/exports',
        '/historique',
        '/meteo',
        '/notifications',
        '/pac',
        '/preconisations',
        '/parametres',
        '/profil',
      ];
      for (const chemin of chemins) await verifierPage(page, chemin);

      // Pages à paramètre, avec de vrais identifiants.
      if (donnees.parcelId) {
        await verifierPage(page, `/parcelles/${donnees.parcelId}`);
        await verifierPage(page, `/parcelles/${donnees.parcelId}/modifier`);
      }
      if (donnees.lotId) await verifierPage(page, `/stocks/lots/${donnees.lotId}`);

      /*
       * Un identifiant inexistant doit donner la page « introuvable », pas une
       * exception — et ne rien dire de la ressource demandée.
       *
       * Le contrôle porte sur ce qui est **affiché**, pas sur le code HTTP.
       * Le gabarit de chargement du groupe `(app)` fait partir la coque avant
       * que le composant serveur n'ait tranché : le code reste 200 quoi qu'il
       * arrive. Le choix est assumé et expliqué dans `(app)/loading.tsx` ;
       * exiger ici un 404 reviendrait à faire échouer l'audit sur une décision
       * prise sciemment.
       */
      const r = await inspecter(page, '/parcelles/parcelle-qui-nexiste-pas');
      attendu(
        /Cette page n’existe pas/.test(r.texte) && r.erreursJs.length === 0,
        'une parcelle inexistante rend la page « introuvable », sans exception',
        r.erreursJs[0] ?? `HTTP ${r.statut}`,
      );

      // Et le titre ne doit pas nommer la ressource : il divulguait le nom des
      // parcelles des autres exploitations.
      if (donnees.parcelVoisineId) {
        const v = await inspecter(page, `/parcelles/${donnees.parcelVoisineId}`);
        const titre = await page.title();
        attendu(
          /Cette page n’existe pas/.test(v.texte) && !/voisin/i.test(titre),
          'la parcelle d’une autre exploitation ne divulgue rien, pas même par le titre',
          titre,
        );
      }

      // L'espace d'administration est refusé à un exploitant ordinaire.
      const admin = await inspecter(page, '/administration');
      attendu(
        !/Administration de l/i.test(admin.texte) || admin.statut >= 400,
        'l’administration est refusée à un exploitant',
        `HTTP ${admin.statut}`,
      );
      await page.close();
    }

    // --- Espace administrateur -----------------------------------------
    console.info('\n▸ espace administrateur');
    {
      const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
      await connecter(page, donnees.adminEmail, donnees.motDePasse);
      for (const chemin of [
        '/administration',
        '/administration/utilisateurs',
        '/administration/invitations',
        '/administration/exploitations',
        '/administration/experts',
        '/administration/journal',
        '/administration/maintenance',
        '/administration/referentiels',
      ]) {
        await verifierPage(page, chemin);
      }
      await page.close();
    }

    // --- Espace expert --------------------------------------------------
    console.info('\n▸ espace expert agronomique');
    if (donnees.expertEmail) {
      const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
      await connecter(page, donnees.expertEmail, donnees.motDePasse, '/connexion-expert');
      await verifierPage(page, '/portefeuille');
      await verifierPage(page, '/portefeuille/preconisations');
      if (donnees.farmId) {
        await verifierPage(page, `/portefeuille/${donnees.farmId}`);
        await verifierPage(page, `/portefeuille/${donnees.farmId}/preconisations`);
        await verifierPage(page, `/portefeuille/${donnees.farmId}/preconisations/nouvelle`);
        if (donnees.parcelId) {
          await verifierPage(page, `/portefeuille/${donnees.farmId}/parcelles/${donnees.parcelId}`);
        }
      }
      await page.close();
    } else {
      console.info('· aucun compte expert fourni');
    }
  } finally {
    await navigateur.close();
  }

  console.info(`\n${echecs === 0 ? '✓' : '✗'} audit des pages : ${echecs} problème(s).`);
  if (problemes.length) {
    console.info('\nProblèmes :');
    for (const p of problemes) console.info(`  · ${p}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((cause) => {
    console.error(cause);
    process.exit(1);
  });
}
