#!/usr/bin/env node
/**
 * Vérification de bout en bout de la carte et du renommage, dans l'application.
 *
 * Ce que les tests de `tests/` ne peuvent pas atteindre : l'écran lui-même.
 * `tests/carte.test.ts` vérifie que le site et l'application puisent leurs
 * couleurs au même endroit, `tests/mobile-sync.test.ts` vérifie le serveur —
 * mais aucun des deux ne dit si l'exploitant voit ses parcelles sur une carte
 * et peut les renommer depuis son téléphone. C'est pourtant la seule question.
 *
 * On pilote donc l'application compilée dans un vrai navigateur, contre un vrai
 * serveur et une vraie base, et on regarde ce qui s'affiche.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES TUILES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les serveurs de tuiles ne sont pas joignables depuis l'environnement de
 * vérification. Plutôt que de déclarer le fond « non vérifiable », on répond
 * **à la place** des serveurs de tuiles avec une image valide : la couche de
 * fond est alors éprouvée pour de bon — Leaflet demande les bonnes adresses,
 * reçoit des images, les pose et les marque chargées. Seule la joignabilité du
 * fournisseur reste hors de portée, et c'est de la configuration, pas du code.
 *
 * Prérequis, à lancer avant :
 *
 *   npx prisma migrate deploy && npx tsx prisma/seed.ts
 *
 *   APP_URL=http://127.0.0.1:3000 MOBILE_APP_ORIGINS="http://127.0.0.1:4173" \
 *     ./node_modules/.bin/next start --port 3000 --hostname 127.0.0.1
 *
 *   cd mobile && VITE_PARCELYS_SERVER=http://127.0.0.1:3000 npm run build \
 *     && npx vite preview --port 4173 --host 127.0.0.1
 *
 * Usage : node scripts/check-carte-mobile.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';

const APP = process.env.MOBILE_URL ?? 'http://127.0.0.1:4173';
const SERVEUR = process.env.PARCELYS_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const MOT_DE_PASSE = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';
const CAPTURES = process.env.CAPTURES_DIR ?? '/tmp/parcelys-captures';

/** PNG 256×256 uni, pour répondre à la place des serveurs de tuiles. */
const TUILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAAA3NCSVQICAjb4U/gAAAAW0lEQVR4' +
    'nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC3ASPAAAFZ0+QTAAAAAElFTkSuQmCC',
  'base64',
);

const resultats = [];
let echecs = 0;

function verifier(intitule, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) echecs += 1;
  resultats.push({ ok, intitule, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${intitule}${detail ? ` — ${detail}` : ''}`);
}

function titre(texte) {
  console.log(`\n${texte}`);
}

const main = async () => {
  mkdirSync(CAPTURES, { recursive: true });
  const navigateur = await chromium.launch({ executablePath: cheminDuNavigateur() });

  // Un écran de téléphone, et une position dans « Les Sables », parcelle de
  // l'exploitation de démonstration (vérifié par `ST_PointOnSurface`). Une
  // position au hasard tomberait à cent kilomètres et l'on ne vérifierait ni le
  // repère ni l'appartenance.
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation'],
    geolocation: { latitude: 48.0962, longitude: 1.8854, accuracy: 12 },
    locale: 'fr-FR',
  });
  const page = await contexte.newPage();

  // On répond à la place des serveurs de tuiles. Les adresses demandées sont
  // relevées au passage : c'est ainsi qu'on vérifie que le fond « plan » est
  // bien celui que le serveur configure, et non une adresse figée dans l'APK.
  const tuilesDemandees = [];
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, async (route) => {
    tuilesDemandees.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: TUILE_PNG });
  });

  const erreursConsole = [];
  page.on('console', (message) => {
    if (message.type() === 'error') erreursConsole.push(message.text());
  });
  page.on('pageerror', (erreur) => erreursConsole.push(String(erreur)));

  const capture = async (nom) => {
    const fichier = path.join(CAPTURES, `${nom}.png`);
    await page.screenshot({ path: fichier });
    return fichier;
  };

  try {
    // -----------------------------------------------------------------------
    titre('Connexion');
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByLabel(/adresse e-?mail/i).fill(EMAIL);
    await page.getByLabel(/mot de passe/i).fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: /se connecter/i }).click();

    await page.getByRole('button', { name: /voir la carte/i }).waitFor({ timeout: 30_000 });
    verifier('l’application s’ouvre sur le parcellaire', true);

    // -----------------------------------------------------------------------
    titre('Une vraie carte, comme sur le site');
    await page.getByRole('button', { name: /voir la carte/i }).click();

    const carte = page.locator('.leaflet-container');
    await carte.waitFor({ timeout: 15_000 });
    verifier('la carte Leaflet est en place', await carte.isVisible());

    // Les tuiles sont demandées, reçues et posées. `leaflet-tile-loaded` n'est
    // posé par Leaflet qu'une fois l'image réellement chargée : une couche qui
    // demanderait sans afficher ne passerait pas ici.
    await page
      .locator('img.leaflet-tile-loaded')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    const tuilesPosees = await page.locator('img.leaflet-tile-loaded').count();
    verifier('le fond de plan est chargé et affiché', tuilesPosees > 0,
      `${tuilesPosees} tuile(s) posée(s), ${tuilesDemandees.length} demandée(s)`);

    verifier(
      'le fond satellite est celui d’Esri, comme sur le site',
      tuilesDemandees.some((url) => url.includes('arcgisonline.com')),
    );

    // La licence des fournisseurs l'impose : un fond affiché sans attribution
    // est un fond qu'on n'a pas le droit d'afficher. Elle est posée sous la
    // carte et non dedans — sur 390 points de large, celle d'Esri passait
    // par-dessus la barre d'échelle.
    verifier(
      'l’attribution du fond satellite est affichée',
      await page.getByText(/Esri/).first().isVisible(),
    );

    verifier(
      'une échelle métrique est affichée',
      await page.locator('.leaflet-control-scale-line').first().isVisible(),
      (await page.locator('.leaflet-control-scale-line').first().textContent()) ?? '',
    );

    // -----------------------------------------------------------------------
    titre('Les parcelles');
    const contours = page.locator('.leaflet-overlay-pane path.leaflet-interactive');
    await contours.first().waitFor({ timeout: 10_000 });

    const attendues = await page.evaluate(
      async () =>
        await new Promise((resolve) => {
          const requete = indexedDB.open('parcelys');
          requete.onsuccess = () => {
            const base = requete.result;
            if (!base.objectStoreNames.contains('cache')) return resolve(null);
            const lecture = base.transaction('cache').objectStore('cache').get('snapshot');
            lecture.onsuccess = () => {
              const parcelles = lecture.result?.parcels ?? [];
              resolve(parcelles.filter((p) => p.geometry).length);
            };
            lecture.onerror = () => resolve(null);
          };
          requete.onerror = () => resolve(null);
        }),
    );

    const dessinees = await contours.count();
    verifier(
      'chaque parcelle ayant un contour est dessinée',
      attendues !== null && dessinees === attendues,
      attendues === null
        ? 'cache illisible — vérification non concluante'
        : `${dessinees} dessinée(s) pour ${attendues} en cache`,
    );

    const couleurContour = await contours.first().getAttribute('stroke');
    verifier(
      'les parcelles portent le vert du site',
      couleurContour?.toLowerCase() === '#2f6b34',
      couleurContour ?? 'sans couleur',
    );

    const debordements = await page.evaluate(() => {
      const conteneur = document.querySelector('.leaflet-container');
      if (!conteneur) return -1;
      const vue = conteneur.getBoundingClientRect();
      let dehors = 0;
      for (const chemin of document.querySelectorAll(
        '.leaflet-overlay-pane path.leaflet-interactive',
      )) {
        const boite = chemin.getBoundingClientRect();
        if (
          boite.right < vue.left ||
          boite.left > vue.right ||
          boite.bottom < vue.top ||
          boite.top > vue.bottom
        ) {
          dehors += 1;
        }
      }
      return dehors;
    });
    verifier('toutes les parcelles sont dans la vue au cadrage', debordements === 0,
      `${debordements} hors écran`);

    console.log(`     capture : ${await capture('carte')}`);

    // -----------------------------------------------------------------------
    titre('Changer de fond');
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(900);
    verifier(
      'le fond « Plan » est celui que le serveur configure',
      tuilesDemandees.some((url) => url.includes('tile.openstreetmap.org')),
      'adresse issue de MAP_TILE_URL, pas de l’APK',
    );
    // L'attribution suit le fond : rester sur « Imagerie Esri » après être
    // passé au plan créditerait le mauvais fournisseur.
    verifier(
      'l’attribution suit le fond affiché',
      (await page.getByText(/OpenStreetMap/).first().isVisible()) &&
        !(await page.getByText(/Esri/).first().isVisible().catch(() => false)),
    );
    console.log(`     capture : ${await capture('carte-plan')}`);
    await page.getByRole('button', { name: /^Satellite$/ }).click();
    await page.waitForTimeout(400);

    // -----------------------------------------------------------------------
    titre('Position de l’opérateur');
    const repere = await page.evaluate(() => {
      const conteneur = document.querySelector('.leaflet-container');
      if (!conteneur) return null;
      const vue = conteneur.getBoundingClientRect();
      // Le repère et son cercle de précision sont des cercles SVG non
      // interactifs, posés par-dessus les contours.
      const cercles = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter(
        (noeud) => !noeud.classList.contains('leaflet-interactive'),
      );
      if (cercles.length === 0) return null;
      const boite = cercles[cercles.length - 1].getBoundingClientRect();
      return {
        nombre: cercles.length,
        dedans:
          boite.left >= vue.left - 1 &&
          boite.right <= vue.right + 1 &&
          boite.top >= vue.top - 1 &&
          boite.bottom <= vue.bottom + 1,
      };
    });
    verifier(
      'la position et sa précision sont dessinées, dans la vue',
      repere?.dedans === true && repere.nombre >= 2,
      repere ? `${repere.nombre} cercle(s)` : 'aucun repère',
    );

    verifier(
      'la carte annonce la parcelle où l’on se trouve',
      await page.getByText(/Vous êtes dans «/).isVisible(),
    );

    // -----------------------------------------------------------------------
    titre('Zoom et cadrage');
    const avant = await contours.first().boundingBox();
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(600);
    const apres = await contours.first().boundingBox();
    verifier(
      'le bouton de zoom agrandit réellement le dessin',
      apres && avant && apres.width > avant.width * 1.3,
      `${Math.round(avant?.width ?? 0)} px → ${Math.round(apres?.width ?? 0)} px`,
    );

    await page.getByRole('button', { name: /^Tout voir$/ }).click();
    await page.waitForTimeout(700);
    const revenu = await contours.first().boundingBox();
    verifier(
      '« tout voir » revient à l’ensemble du parcellaire',
      revenu && avant && Math.abs(revenu.width - avant.width) / avant.width < 0.3,
      `${Math.round(revenu?.width ?? 0)} px pour ${Math.round(avant?.width ?? 0)} px au départ`,
    );

    // -----------------------------------------------------------------------
    titre('Désigner une parcelle du doigt');
    // On touche le centre du plus grand contour : le geste réel.
    const cible = await page.evaluate(() => {
      let meilleur = null;
      for (const chemin of document.querySelectorAll(
        '.leaflet-overlay-pane path.leaflet-interactive',
      )) {
        const boite = chemin.getBoundingClientRect();
        const aire = boite.width * boite.height;
        if (!meilleur || aire > meilleur.aire) {
          meilleur = {
            aire,
            x: boite.left + boite.width / 2,
            y: boite.top + boite.height / 2,
          };
        }
      }
      return meilleur;
    });
    // Ce qui se trouve réellement sous le doigt. Sans cette ligne, un appui qui
    // ne désigne rien laisse chercher entre dix causes possibles ; avec elle,
    // on lit tout de suite ce qui a intercepté — un repère de position, une
    // commande posée sur la carte, une infobulle restée ouverte.
    const sousLeDoigt = await page.evaluate(([x, y]) => {
      const element = document.elementFromPoint(x, y);
      if (!element) return 'rien';
      // La couleur distingue une parcelle (#2f6b34) du repère de position
      // (#ffffff) et de son cercle de précision (#2b7fd4) : sans elle, les
      // trois se ressemblent dans le DOM et le diagnostic ne dit rien.
      const trait = element.getAttribute?.('stroke');
      return `${element.tagName.toLowerCase()}${trait ? ` trait ${trait}` : ''}`;
    }, [cible.x, cible.y]);

    await page.mouse.click(cible.x, cible.y);
    await page.waitForTimeout(400);

    const fiche = page.getByText(/Ouvrir la fiche pour renommer/i);
    verifier('un appui désigne une parcelle', await fiche.isVisible(), sousLeDoigt);

    const choisies = await page.evaluate(
      () =>
        [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')]
          .map((noeud) => noeud.getAttribute('stroke')?.toLowerCase())
          .filter((couleur) => couleur === '#b4841a').length,
    );
    // Sans ce changement de style, on ne saurait pas laquelle on a touchée.
    verifier('la parcelle désignée change d’aspect', choisies === 1,
      `${choisies} parcelle(s) en surbrillance`);
    console.log(`     capture : ${await capture('carte-parcelle-designee')}`);

    // -----------------------------------------------------------------------
    titre('Renommer depuis la carte');
    await fiche.click();
    await page.getByRole('button', { name: /^Renommer$/ }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Renommer$/ }).click();

    const NOUVEAU = `La Côte du Chêne ${Date.now() % 100000}`;
    await page.getByLabel(/nom de la parcelle/i).fill(NOUVEAU);
    // Le cas qui ne marchait pas : les deux autres champs laissés vides, donc
    // envoyés à `null`. Le serveur rejetait le lot entier.
    await page.getByLabel(/numéro interne/i).fill('');
    await page.getByLabel(/lieu-dit/i).fill('');
    await page.getByRole('button', { name: /^Enregistrer$/ }).click();

    await page.waitForTimeout(600);
    verifier(
      'le nouveau nom s’affiche tout de suite au champ',
      (await page.locator('h1').first().textContent())?.includes(NOUVEAU),
      `titre : ${await page.locator('h1').first().textContent()}`,
    );
    console.log(`     capture : ${await capture('parcelle-renommee')}`);

    // -----------------------------------------------------------------------
    titre('Le renommage arrive-t-il au serveur ?');
    const envoi = await page.evaluate(async () => {
      const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

      /** Opérations encore en file, ou `null` si on n'a pas pu lire. */
      const resteEnFile = () =>
        new Promise((resolve) => {
          const requete = indexedDB.open('parcelys');
          requete.onsuccess = () => {
            const base = requete.result;
            if (!base.objectStoreNames.contains('outbox')) return resolve(null);
            const lecture = base.transaction('outbox').objectStore('outbox').getAll();
            lecture.onsuccess = () => resolve(lecture.result?.length ?? 0);
            lecture.onerror = () => resolve(null);
          };
          requete.onerror = () => resolve(null);
        });

      let dernier = await resteEnFile();
      for (let essai = 0; essai < 24 && dernier !== 0; essai += 1) {
        await attendre(500);
        dernier = await resteEnFile();
      }
      return { restant: dernier };
    });

    // `null` veut dire qu'on n'a pas su lire la file : c'est un échec de la
    // vérification, pas une réussite.
    verifier(
      'la file d’attente se vide',
      envoi.restant === 0,
      envoi.restant === null
        ? 'file illisible — vérification non concluante'
        : `${envoi.restant} opération(s) encore en attente`,
    );

    // Le serveur fait foi : c'est lui qu'on interroge, pas l'écran.
    const vuDuServeur = await page.evaluate(async ({ serveur }) => {
      const cle = Object.keys(localStorage).find((nom) =>
        nom.endsWith('parcelys.session'),
      );
      const jeton = cle ? JSON.parse(localStorage.getItem(cle) ?? 'null') : null;
      if (!jeton?.token) return { erreur: 'jeton introuvable' };
      const reponse = await fetch(`${serveur}/api/mobile/bootstrap`, {
        headers: { Authorization: `Bearer ${jeton.token}` },
      });
      if (!reponse.ok) return { erreur: `HTTP ${reponse.status}` };
      const corps = await reponse.json();
      return {
        noms: (corps.parcels ?? []).map((p) => p.name),
        carte: corps.carte ?? null,
      };
    }, { serveur: SERVEUR });

    verifier(
      'le serveur connaît le nouveau nom',
      Boolean(vuDuServeur.noms?.includes(NOUVEAU)),
      vuDuServeur.erreur ?? `« ${NOUVEAU} »`,
    );
    verifier(
      'le serveur transmet bien son fond de plan à l’application',
      Boolean(vuDuServeur.carte?.tileUrl?.includes('{z}')),
      vuDuServeur.carte?.tileUrl ?? 'absent',
    );

    // -----------------------------------------------------------------------
    titre('Hygiène');
    const bruit = erreursConsole.filter(
      (texte) =>
        !/favicon/i.test(texte) &&
        !/ERR_INTERNET_DISCONNECTED/i.test(texte) &&
        !/Failed to load resource/i.test(texte),
    );
    verifier('aucune erreur de console', bruit.length === 0, bruit.slice(0, 3).join(' | '));
  } finally {
    writeFileSync(
      path.join(CAPTURES, 'resultats.json'),
      JSON.stringify(resultats, null, 2),
    );
    await navigateur.close();
  }

  console.log(
    `\n${echecs === 0 ? '✓' : '✗'} ${resultats.length - echecs}/${resultats.length} vérifications passées`,
  );
  process.exit(echecs === 0 ? 0 : 1);
};

main().catch((erreur) => {
  console.error('\n✗ la vérification n’a pas pu se dérouler :', erreur);
  process.exit(2);
});
