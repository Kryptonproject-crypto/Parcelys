/**
 * Administration : compte d'administration, suppression, dispatch d'experts.
 *
 *   node scripts/check-admin-v3.mjs [url]
 *
 * Les tests d'API vérifient les règles ; ceci vérifie que l'enchaînement des
 * écrans tient debout, dans un vrai navigateur, pour les trois gestes ajoutés
 * en v3 :
 *
 *   1. un compte d'administration n'a ni exploitation ni portefeuille — il ne
 *      doit donc voir ni « Parcelles » ni « Portefeuille » dans sa navigation ;
 *   2. une exploitation se supprime et se rétablit depuis l'administration ;
 *   3. le compte unique propriétaire d'une exploitation ne mène plus à une
 *      impasse : l'écran propose de supprimer aussi ses exploitations ;
 *   4. un expert se crée depuis l'administration et se voit confier plusieurs
 *      exploitations d'un seul geste.
 *
 * Prérequis : une instance lancée et le compte de démonstration semé.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { cheminDuNavigateur } from './lib/navigateur.mjs';
import { verifierCompte } from './lib/compte.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const ADMIN_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';
const SHOTS = path.resolve('.preview/admin-v3');

const stamp = Date.now();
const GESTION = {
  email: `gestion.${stamp}@parcelys.test`,
  password: 'MotDePasse1!',
  firstName: 'Gaëlle',
  lastName: 'Gestion',
};
const EXPERT = {
  email: `expert.${stamp}@conseil.test`,
  password: 'MotDePasse1!',
  firstName: 'Éric',
  lastName: 'Expert',
};

await mkdir(SHOTS, { recursive: true });


// Le compte de démonstration répond-il ? Sans ce contrôle, son absence se
// manifeste trente secondes plus tard par un délai d'attente dépassé.
await verifierCompte(BASE, EMAIL, PASSWORD);

const browser = await chromium.launch({
  executablePath: cheminDuNavigateur(),
});

let step = 0;
async function shot(page, label) {
  step += 1;
  const file = path.join(SHOTS, `${String(step).padStart(2, '0')}-${label}.png`);
  // Une capture « pleine page » recompose les éléments fixes (barre latérale,
  // fenêtre modale) et les rend illisibles : dès qu'un dialogue est ouvert, on
  // photographie la fenêtre telle qu'on la voit.
  const dialogueOuvert = (await page.getByRole('dialog').count()) > 0;
  if (dialogueOuvert) await page.waitForTimeout(400); // fin de l'animation
  await page.screenshot({ path: file, fullPage: !dialogueOuvert });
  console.log(`  ✓ ${label}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Connexion par le formulaire, comme un utilisateur. */
async function login(page, email, password) {
  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
  await page.getByLabel(/adresse e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/connexion'), {
    timeout: 15_000,
  });
}

/**
 * Crée un compte depuis l'administration, puis l'inscrit.
 * Renvoie le code délivré, pour le journal du script.
 */
async function inviterPuisInscrire(adminPage, { accountType, identite, farmName }) {
  await adminPage.goto(`${BASE}/administration/invitations`, { waitUntil: 'networkidle' });
  const code = await adminPage.evaluate(
    async ({ base, accountType, email }) => {
      const response = await fetch(`${base}/api/admin/invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountType, email }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.code;
    },
    { base: BASE, accountType, email: identite.email },
  );

  const context = await browser.newContext({ ...devices['Desktop Chrome'] });
  const page = await context.newPage();
  await page.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
  // Inscription en deux temps : le code est vérifié d'abord, ce qui détermine
  // les champs présentés ensuite.
  await page.getByLabel(/code d.invitation/i).fill(code);
  await page.getByRole('button', { name: /vérifier le code/i }).click();
  await page.getByLabel(/prénom/i).waitFor({ timeout: 15_000 });

  // Un compte sans exploitation ne doit pas s'en voir réclamer le nom : ce
  // serait exiger une donnée dont personne ne ferait rien.
  const champFerme = page.locator('#farmName');
  const demandeUneFerme = (await champFerme.count()) > 0;
  expect(
    demandeUneFerme === Boolean(farmName),
    farmName
      ? "Le formulaire ne demande pas le nom de l'exploitation alors qu'il en faut une."
      : `Le formulaire réclame un nom d'exploitation à un compte « ${accountType} », ` +
          "qui n'en aura pas.",
  );
  if (farmName) await champFerme.first().fill(farmName);

  await page.locator('#firstName').fill(identite.firstName);
  await page.locator('#lastName').fill(identite.lastName);
  // Quand le code est nominatif, l'adresse est pré-remplie et verrouillée :
  // c'est voulu, on ne la retape pas.
  const champEmail = page.locator('#email');
  if (await champEmail.isEditable()) {
    await champEmail.fill(identite.email);
  } else {
    expect(
      (await champEmail.inputValue()) === identite.email,
      "L'adresse verrouillée ne correspond pas à celle du code d'invitation.",
    );
  }
  await page.locator('#password').fill(identite.password);
  await page.locator('#passwordConfirmation').fill(identite.password);
  for (const checkbox of await page.getByRole('checkbox').all()) {
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  await page.getByRole('button', { name: /créer (mon|le) compte|s.inscrire/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/inscription'), {
    timeout: 20_000,
  });

  // L'inscription mène à la vérification de l'adresse. Plutôt que d'aller
  // chercher le code dans les journaux, on emprunte le geste que
  // l'administrateur a précisément à sa disposition pour ce cas : marquer
  // l'adresse comme vérifiée.
  await adminPage.evaluate(
    async ({ base, email }) => {
      const liste = await fetch(`${base}/api/admin/users?q=${encodeURIComponent(email)}`, {
        credentials: 'include',
      }).then((r) => r.json());
      const compte = liste.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!compte) throw new Error(`Compte ${email} introuvable dans l'administration`);
      const response = await fetch(`${base}/api/admin/users/${compte.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'verify-email' }),
      });
      if (!response.ok) throw new Error(JSON.stringify(await response.json()));
    },
    { base: BASE, email: identite.email },
  );

  await login(page, identite.email, identite.password);
  return { code, page, context };
}

try {
  // --- 1. L'administrateur de démonstration -------------------------------
  console.log("\n1. Connexion de l'administrateur d'instance");
  const admin = await browser.newContext({ ...devices['Desktop Chrome'] });
  const adminPage = await admin.newPage();
  await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  await adminPage.goto(`${BASE}/administration`, { waitUntil: 'networkidle' });
  await shot(adminPage, 'administration');

  // --- 2. Un compte d'administration pur ----------------------------------
  console.log("\n2. Compte d'administration : ni exploitation, ni portefeuille");
  const gestion = await inviterPuisInscrire(adminPage, {
    accountType: 'ADMIN',
    identite: GESTION,
  });
  // Il atterrit sur l'administration, pas sur un tableau de bord vide.
  const atterrissage = new URL(gestion.page.url()).pathname;
  expect(
    atterrissage.startsWith('/administration') || atterrissage.startsWith('/verification'),
    `Un compte d'administration atterrit sur ${atterrissage}`,
  );

  await gestion.page.goto(`${BASE}/administration`, { waitUntil: 'networkidle' });
  const navigation = await gestion.page.locator('nav').first().innerText();
  expect(
    !/parcelles/i.test(navigation),
    `La navigation d'un compte d'administration propose « Parcelles » :\n${navigation}`,
  );
  expect(
    !/portefeuille/i.test(navigation),
    `La navigation d'un compte d'administration propose « Portefeuille » :\n${navigation}`,
  );
  // …mais elle ne doit pas être vide pour autant : ce compte doit voir ce
  // qu'il est venu faire.
  for (const attendu of [/utilisateurs/i, /invitations/i, /exploitations/i, /experts/i]) {
    expect(
      attendu.test(navigation),
      `La barre latérale d'administration ne propose pas ${attendu} :\n${navigation}`,
    );
  }
  await shot(gestion.page, 'compte-administration');

  // --- 3. Supprimer puis rétablir une exploitation ------------------------
  console.log('\n3. Exploitations : suppression et rétablissement');
  await adminPage.goto(`${BASE}/administration/exploitations`, { waitUntil: 'networkidle' });
  await shot(adminPage, 'exploitations');

  // Une exploitation encore active : les exécutions précédentes du script ont
  // pu en laisser de supprimées en tête de liste, et elles n'offrent que
  // « Rétablir ».
  const ligne = adminPage
    .locator('tbody tr')
    .filter({ has: adminPage.getByRole('button', { name: /^supprimer$/i }) })
    .first();
  const nomFerme = (await ligne.locator('td').first().innerText()).split('\n')[0].trim();
  console.log(`  · exploitation visée : ${nomFerme}`);

  await ligne.getByRole('button', { name: /^supprimer$/i }).click();
  // La confirmation n'est pas une boîte native : c'est un dialogue de
  // l'application, qui dit ce que la suppression emporte avant de la faire.
  const confirmation = adminPage.getByRole('dialog');
  await confirmation.waitFor({ timeout: 10_000 });
  const texteConfirmation = await confirmation.innerText();
  expect(
    /réversible|rétabl/i.test(texteConfirmation),
    `La confirmation ne dit pas que le geste se défait :\n${texteConfirmation}`,
  );
  await shot(adminPage, 'confirmation-suppression');
  await confirmation.getByRole('button', { name: /supprimer l.exploitation/i }).click();

  const ligneSupprimee = adminPage.locator('tbody tr').filter({ hasText: nomFerme }).first();
  // C'est le badge « Supprimée » qui fait foi, pas le mot « Supprimer » du
  // bouton — qui figure dans chaque ligne du tableau.
  await ligneSupprimee.getByText(/^Supprimée$/).waitFor({ timeout: 15_000 });
  await shot(adminPage, 'exploitation-supprimee');

  await ligneSupprimee.getByRole('button', { name: /rétablir/i }).click();
  await ligneSupprimee.getByText(/^Supprimée$/).waitFor({
    state: 'detached',
    timeout: 15_000,
  });
  await shot(adminPage, 'exploitation-retablie');

  // --- 4. Supprimer un compte unique propriétaire -------------------------
  console.log("\n4. Suppression d'un compte unique propriétaire : plus d'impasse");
  await adminPage.goto(`${BASE}/administration/utilisateurs`, { waitUntil: 'networkidle' });

  // On fabrique le cas : un exploitant seul propriétaire de son exploitation.
  const solitaire = {
    ...GESTION,
    email: `solitaire.${stamp}@ferme.test`,
    firstName: 'Sylvie',
    lastName: 'Solitaire',
  };
  await inviterPuisInscrire(adminPage, {
    accountType: 'FARMER',
    identite: solitaire,
    farmName: `Ferme Solitaire ${stamp}`,
  });

  // `inviterPuisInscrire` a promené la page d'administration : on revient.
  await adminPage.goto(
    `${BASE}/administration/utilisateurs?q=${encodeURIComponent(solitaire.email)}`,
    { waitUntil: 'networkidle' },
  );
  const ligneCompte = adminPage
    .locator('tbody tr')
    .filter({ hasText: solitaire.email })
    .first();
  await ligneCompte.waitFor({ timeout: 15_000 });

  // Premier geste : supprimer le compte. Le serveur refuse, parce que ce
  // compte est l'unique propriétaire de son exploitation.
  await ligneCompte.getByRole('button', { name: /supprimer/i }).click();
  const dialogue = adminPage.getByRole('dialog');
  await dialogue.waitFor({ timeout: 10_000 });
  await dialogue.getByRole('button', { name: /supprimer le compte/i }).click();

  // C'est ici que se jouait l'impasse : la confirmation doit se transformer en
  // une seconde question, qui nomme les exploitations et propose de les
  // supprimer aussi — et non se refermer sans rien dire.
  await dialogue
    .getByText(/unique propriétaire/i)
    .waitFor({ timeout: 15_000 });
  const suite = await dialogue.innerText();
  expect(
    new RegExp(`Ferme Solitaire ${stamp}`).test(suite),
    `La seconde question ne nomme pas l'exploitation concernée :\n${suite}`,
  );
  await shot(adminPage, 'suppression-compte-proprietaire');
  console.log(`  · « ${suite.replace(/\s+/g, ' ').slice(0, 200)} »`);

  await dialogue
    .getByRole('button', { name: /supprimer le compte et ses exploitations/i })
    .click();
  await dialogue.waitFor({ state: 'hidden', timeout: 15_000 });

  // Le compte a réellement disparu de la liste des comptes actifs.
  await adminPage.goto(`${BASE}/administration/utilisateurs`, { waitUntil: 'networkidle' });
  const restant = await adminPage.locator('tbody').innerText();
  expect(
    !restant.includes(solitaire.email),
    `Le compte ${solitaire.email} figure encore parmi les comptes actifs.`,
  );
  await shot(adminPage, 'compte-supprime');

  // --- 5. Un expert, plusieurs exploitations ------------------------------
  console.log('\n5. Expert : création puis dispatch sur plusieurs exploitations');

  // Il faut au moins deux exploitations pour que « plusieurs » veuille dire
  // quelque chose : la démonstration en fournit une, on en crée une seconde.
  const voisin = {
    ...GESTION,
    email: `voisin.${stamp}@ferme.test`,
    firstName: 'Victor',
    lastName: 'Voisin',
  };
  await inviterPuisInscrire(adminPage, {
    accountType: 'FARMER',
    identite: voisin,
    farmName: `Ferme Voisine ${stamp}`,
  });

  await inviterPuisInscrire(adminPage, {
    accountType: 'AGRONOMIST',
    identite: EXPERT,
  });

  await adminPage.goto(`${BASE}/administration/experts`, { waitUntil: 'networkidle' });
  await shot(adminPage, 'experts');

  const contenu = await adminPage.locator('main').innerText();
  expect(
    new RegExp(EXPERT.lastName, 'i').test(contenu),
    `L'expert créé n'apparaît pas dans l'onglet Experts :\n${contenu.slice(0, 600)}`,
  );

  // Les exploitations ne se proposent qu'une fois l'expert choisi : c'est ce
  // qui permet d'exclure celles qu'il suit déjà.
  const formulaire = adminPage.locator('form').filter({ hasText: /exploitations suivies/i });
  // On désigne l'expert par son adresse : les exécutions précédentes en ont
  // laissé d'autres portant le même nom — ce qui est précisément pourquoi
  // l'adresse figure dans chaque option.
  const choixExpert = formulaire.locator('select');
  const options = await choixExpert.locator('option').all();
  let valeurExpert = null;
  for (const option of options) {
    const texte = await option.textContent();
    if (texte?.includes(EXPERT.email)) valeurExpert = await option.getAttribute('value');
  }
  expect(
    valeurExpert,
    `Aucune option ne désigne ${EXPERT.email} :\n` +
      (await choixExpert.locator('option').allTextContents()).join('\n'),
  );
  await choixExpert.selectOption(valeurExpert);

  const cases = formulaire.locator('input[type="checkbox"]');
  await cases.first().waitFor({ timeout: 10_000 });
  const nbCases = await cases.count();
  expect(
    nbCases >= 2,
    `Le formulaire de rattachement n'offre que ${nbCases} exploitation(s) à cocher ; ` +
      'le dispatch multiple ne peut pas être vérifié.',
  );

  // Deux d'un seul geste — c'est tout l'objet de la v3.
  await cases.nth(0).check();
  await cases.nth(1).check();
  await shot(adminPage, 'experts-multi-exploitations');

  const bouton = formulaire.getByRole('button', { name: /confier/i });
  expect(
    /2 exploitations/i.test(await bouton.innerText()),
    `Le bouton ne reflète pas les deux exploitations cochées : « ${await bouton.innerText()} »`,
  );
  await bouton.click();

  // L'expert suit maintenant les deux — c'est son propre décompte de missions
  // qui le dit, et non le nombre de fois que son nom apparaît à l'écran.
  await adminPage.waitForLoadState('networkidle');
  await adminPage.waitForTimeout(1500);

  const suivies = await adminPage.evaluate(
    async ({ base, email }) => {
      const data = await fetch(`${base}/api/admin/experts`, {
        credentials: 'include',
      }).then((r) => r.json());
      const expert = data.experts.find((e) => e.email.toLowerCase() === email.toLowerCase());
      if (!expert) throw new Error(`Expert ${email} absent de l'administration`);
      return expert.engagements
        .filter((e) => e.status === 'ACTIVE')
        .map((e) => e.farmName ?? e.farmId);
    },
    { base: BASE, email: EXPERT.email },
  );

  expect(
    suivies.length === 2,
    `L'expert suit ${suivies.length} exploitation(s) après un rattachement double : ` +
      `${JSON.stringify(suivies)}`,
  );
  console.log(`  · exploitations suivies : ${suivies.join(', ')}`);
  await shot(adminPage, 'experts-apres-dispatch');

  console.log('\n✅ Les gestes d’administration v3 tiennent debout au navigateur.');
  console.log(`   Copies d’écran : ${SHOTS}`);
} finally {
  await browser.close();
}
