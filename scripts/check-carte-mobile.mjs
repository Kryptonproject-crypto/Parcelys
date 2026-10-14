#!/usr/bin/env node
/**
 * Vérification de bout en bout de la carte et du renommage, dans l'application.
 *
 * Ce que les tests de `tests/` ne peuvent pas atteindre : l'écran lui-même.
 * `tests/carte.test.ts` éprouve la projection, `tests/mobile-sync.test.ts`
 * éprouve le serveur — mais aucun des deux ne dit si l'exploitant voit ses
 * parcelles et peut les renommer depuis son téléphone. C'est pourtant la seule
 * question posée.
 *
 * On pilote donc l'application compilée dans un vrai navigateur, contre un vrai
 * serveur et une vraie base, et on regarde ce qui s'affiche.
 *
 * Prérequis, à lancer avant :
 *
 *   # base migrée et peuplée
 *   npx prisma migrate deploy && npx tsx prisma/seed.ts
 *
 *   # serveur, avec l'origine de l'aperçu mobile autorisée
 *   APP_URL=http://127.0.0.1:3000 \
 *   MOBILE_APP_ORIGINS="http://127.0.0.1:4173" \
 *     ./node_modules/.bin/next start --port 3000 --hostname 127.0.0.1
 *
 *   # application mobile, compilée vers ce serveur
 *   cd mobile && VITE_PARCELYS_SERVER=http://127.0.0.1:3000 npm run build \
 *     && npx vite preview --port 4173 --host 127.0.0.1
 *
 * Usage : node scripts/check-carte-mobile.mjs [--garder-captures]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';

const APP = process.env.MOBILE_URL ?? 'http://127.0.0.1:4173';
const EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const MOT_DE_PASSE = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';
const CAPTURES = process.env.CAPTURES_DIR ?? '/tmp/parcelys-captures';

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
  const navigateur = await chromium.launch({
    executablePath: cheminDuNavigateur(),
  });
  const fermer = () => navigateur.close();

  // Un écran de téléphone, et une position GPS fixée : sans elle, le navigateur
  // n'en a aucune et l'on ne vérifierait pas l'affichage de la position.
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation'],
    // Dans « Les Sables », une parcelle de l'exploitation de démonstration —
    // vérifié par `ST_PointOnSurface`. Une position prise au hasard tomberait
    // à cent kilomètres, et l'on ne vérifierait ni le repère ni l'appartenance.
    geolocation: { latitude: 48.0962, longitude: 1.8854, accuracy: 12 },
    locale: 'fr-FR',
  });
  const page = await contexte.newPage();

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
    titre('La carte');
    await page.getByRole('button', { name: /voir la carte/i }).click();

    const svg = page.locator('svg[role="img"]');
    await svg.waitFor({ timeout: 15_000 });

    // Le nombre de parcelles dessinées, comparé à celui que le serveur a
    // envoyé : une carte vide ou partielle est le défaut qu'on cherche.
    const attendues = await page.evaluate(async () => {
      const bases = await indexedDB.databases();
      const nom = bases.map((b) => b.name).find((n) => n);
      if (!nom) return null;
      return await new Promise((resolve) => {
        const requete = indexedDB.open(nom);
        requete.onsuccess = () => {
          const base = requete.result;
          if (!base.objectStoreNames.contains('snapshot')) return resolve(null);
          const lecture = base.transaction('snapshot').objectStore('snapshot').getAll();
          lecture.onsuccess = () => {
            const instantane = lecture.result?.[0];
            const parcelles = instantane?.value?.parcels ?? instantane?.parcels ?? [];
            resolve(
              parcelles.filter((p) => p.geometry && p.geometry.coordinates).length,
            );
          };
          lecture.onerror = () => resolve(null);
        };
        requete.onerror = () => resolve(null);
      });
    });

    const dessinees = await svg.locator('path[fill-rule="evenodd"]').count();
    verifier(
      'chaque parcelle ayant un contour est dessinée',
      attendues === null ? dessinees > 0 : dessinees === attendues,
      attendues === null
        ? `${dessinees} contour(s) dessiné(s) (cache illisible, on exige au moins un)`
        : `${dessinees} dessinée(s) pour ${attendues} en cache`,
    );

    const aireDessinee = await svg.locator('path[fill-rule="evenodd"]').first().evaluate(
      (element) => {
        const boite = element.getBBox();
        return { largeur: boite.width, hauteur: boite.height };
      },
    );
    verifier(
      'les contours ont une étendue à l’écran',
      aireDessinee.largeur > 4 && aireDessinee.hauteur > 4,
      `${Math.round(aireDessinee.largeur)}×${Math.round(aireDessinee.hauteur)} px`,
    );

    // Tout doit tenir dans la vue au premier cadrage : c'est la promesse de
    // « voir ses parcelles », et un cadrage faux les mettrait hors écran.
    const debordements = await svg.evaluate((element) => {
      const vue = element.getBoundingClientRect();
      let dehors = 0;
      for (const chemin of element.querySelectorAll('path[fill-rule="evenodd"]')) {
        const boite = chemin.getBoundingClientRect();
        if (
          boite.left < vue.left - 1 ||
          boite.right > vue.right + 1 ||
          boite.top < vue.top - 1 ||
          boite.bottom > vue.bottom + 1
        ) {
          dehors += 1;
        }
      }
      return dehors;
    });
    verifier('aucune parcelle hors de la vue au premier cadrage', debordements === 0,
      `${debordements} débordement(s)`);

    // Une étiquette plus large que sa parcelle déborde sur la voisine : on ne
    // sait plus laquelle elle nomme. Vu à l'écran avec « La Pièce du Moulin ».
    const debordementsEtiquettes = await svg.evaluate((element) => {
      const contours = [...element.querySelectorAll('path[fill-rule="evenodd"]')].map(
        (chemin) => chemin.getBoundingClientRect(),
      );
      let fautifs = 0;
      for (const texte of element.querySelectorAll('text')) {
        const boite = texte.getBoundingClientRect();
        // La parcelle qui porte l'étiquette : celle dont le centre en est le
        // plus proche.
        const centreTexte = { x: boite.left + boite.width / 2, y: boite.top + boite.height / 2 };
        let proche = null;
        for (const contour of contours) {
          const distance = Math.hypot(
            contour.left + contour.width / 2 - centreTexte.x,
            contour.top + contour.height / 2 - centreTexte.y,
          );
          if (!proche || distance < proche.distance) proche = { contour, distance };
        }
        if (proche && boite.width > proche.contour.width + 1) fautifs += 1;
      }
      return fautifs;
    });
    verifier(
      'aucun nom de parcelle ne déborde de son contour',
      debordementsEtiquettes === 0,
      `${debordementsEtiquettes} étiquette(s) trop large(s)`,
    );

    const echelle = await page.locator('text=/^\\d+([,.]\\d+)? (m|km)$/').first().textContent()
      .catch(() => null);
    verifier('une barre d’échelle est affichée', Boolean(echelle), echelle ?? 'absente');

    verifier(
      'la provenance et la date de synchronisation sont affichées',
      await page.getByText(/Contours issus de votre parcellaire Parcelys/i).isVisible(),
    );

    // Dessiné ne suffit pas : un repère posé hors du cadre existe dans le DOM
    // sans être visible. On vérifie qu'il tombe dans la vue.
    const repere = await svg.evaluate((element) => {
      const marqueur = element.querySelector('circle[r="6"]');
      if (!marqueur) return null;
      const vue = element.getBoundingClientRect();
      const boite = marqueur.getBoundingClientRect();
      return {
        dedans:
          boite.left >= vue.left &&
          boite.right <= vue.right &&
          boite.top >= vue.top &&
          boite.bottom <= vue.bottom,
      };
    });
    verifier(
      'la position de l’opérateur est dessinée, dans la vue',
      repere?.dedans === true,
      repere ? '' : 'aucun repère',
    );

    verifier(
      'la carte annonce la parcelle où l’on se trouve',
      await page.getByText(/Vous êtes dans «/).isVisible(),
    );

    console.log(`     capture : ${await capture('carte')}`);

    // -----------------------------------------------------------------------
    titre('Zoom et déplacement');
    const avantZoom = await svg.locator('path[fill-rule="evenodd"]').first().evaluate(
      (element) => element.getBBox().width,
    );
    await page.getByRole('button', { name: /^Zoomer$/ }).click();
    await page.waitForTimeout(250);
    const apresZoom = await svg.locator('path[fill-rule="evenodd"]').first().evaluate(
      (element) => element.getBBox().width,
    );
    verifier(
      'le bouton de zoom agrandit réellement le dessin',
      apresZoom > avantZoom * 1.2,
      `${avantZoom.toFixed(0)} px → ${apresZoom.toFixed(0)} px`,
    );

    await page.getByRole('button', { name: /^Tout voir$/ }).click();
    await page.waitForTimeout(250);
    const apresToutVoir = await svg.locator('path[fill-rule="evenodd"]').first().evaluate(
      (element) => element.getBBox().width,
    );
    verifier(
      '« tout voir » revient à l’ensemble du parcellaire',
      Math.abs(apresToutVoir - avantZoom) / avantZoom < 0.35,
      `${apresToutVoir.toFixed(0)} px pour ${avantZoom.toFixed(0)} px au départ`,
    );

    // -----------------------------------------------------------------------
    titre('Désigner une parcelle du doigt');
    // On touche le centre du contour le plus grand : c'est le geste réel, et
    // c'est la projection inverse qui est éprouvée ici.
    const cible = await svg.evaluate((element) => {
      let meilleur = null;
      for (const chemin of element.querySelectorAll('path[fill-rule="evenodd"]')) {
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

    await page.mouse.click(cible.x, cible.y);
    await page.waitForTimeout(350);

    const fiche = page.getByText(/Ouvrir la fiche pour renommer/i);
    verifier('un appui désigne une parcelle', await fiche.isVisible());
    console.log(`     capture : ${await capture('carte-parcelle-designee')}`);

    const nomDesigne = await page
      .locator('p.font-semibold.text-ink')
      .first()
      .textContent();

    // -----------------------------------------------------------------------
    titre('Renommer depuis la carte');
    await fiche.click();
    await page.getByRole('button', { name: /^Renommer$/ }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Renommer$/ }).click();

    const NOUVEAU = `La Côte du Chêne ${Date.now() % 100000}`;
    await page.getByLabel(/nom de la parcelle/i).fill(NOUVEAU);
    // Le cas qui ne marchait pas : les deux autres champs laissés vides, donc
    // envoyés à `null`. Le serveur refusait le lot entier.
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
    // C'est toute la question : l'écriture locale est optimiste, et c'est elle
    // qui masquait le refus du serveur.
    await page.goto(`${APP}#queue`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.goBack().catch(() => {});

    const envoi = await page.evaluate(async () => {
      const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

      /** Nombre d'opérations encore en file, ou `null` si on n'a pas pu lire. */
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
    // vérification, pas une réussite. La première version de ce script rendait
    // « file vidée » quoi qu'il arrive, et passait au vert alors que rien
    // n'était parti.
    verifier(
      'la file d’attente se vide',
      envoi.restant === 0,
      envoi.restant === null
        ? 'file illisible — vérification non concluante'
        : `${envoi.restant} opération(s) encore en attente`,
    );

    // On interroge le serveur directement : c'est lui qui fait foi.
    const vuDuServeur = await page.evaluate(async ({ serveur }) => {
      // `@capacitor/preferences` retombe sur `localStorage` dans un navigateur,
      // en préfixant ses clés par `CapacitorStorage.`. On cherche donc la clé
      // telle qu'elle existe, au lieu de supposer son nom.
      const cle = Object.keys(localStorage).find((nom) =>
        nom.endsWith('parcelys.session'),
      );
      const jeton = cle ? JSON.parse(localStorage.getItem(cle) ?? 'null') : null;
      const token = jeton?.token ?? null;
      if (!token) {
        return { erreur: `jeton introuvable (clés : ${Object.keys(localStorage).join(', ')})` };
      }
      const reponse = await fetch(`${serveur}/api/mobile/bootstrap`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!reponse.ok) return { erreur: `HTTP ${reponse.status}` };
      const corps = await reponse.json();
      return { noms: (corps.parcels ?? []).map((p) => p.name) };
    }, { serveur: 'http://127.0.0.1:3000' });

    verifier(
      'le serveur connaît le nouveau nom',
      Boolean(vuDuServeur.noms?.includes(NOUVEAU)),
      vuDuServeur.erreur ?? `renommée « ${nomDesigne?.trim()} » → « ${NOUVEAU} »`,
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
    await fermer();
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
