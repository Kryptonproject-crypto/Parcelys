/**
 * Parcours complet du conseil agronomique, dans un vrai navigateur.
 *
 *   node scripts/check-advisory-flow.mjs [url]
 *
 * Déroule le scénario réel de bout en bout : l'exploitation délivre un code
 * d'accès, l'expert se connecte par sa propre porte, active le code, ouvre son
 * portefeuille, consulte une parcelle, rédige une préconisation, et
 * l'exploitation la reçoit et l'accepte. Les tests d'API vérifient les règles ;
 * ceci vérifie que l'enchaînement des écrans tient debout — et il capture une
 * copie d'écran de chaque étape.
 *
 * Prérequis : une instance lancée, le compte de démonstration semé, et un
 * compte expert créé par ce script via un code d'invitation d'administrateur.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const ADMIN_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';
const SHOTS = path.resolve('.preview/parcours');

const stamp = Date.now();
const EXPERT = {
  email: `expert.${stamp}@agro.test`,
  password: 'MotDePasse1!',
  firstName: 'Camille',
  lastName: 'Conseil',
};

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});

/** Une étape franchie, ou le script s'arrête là où ça casse. */
let step = 0;
async function shot(page, label) {
  step += 1;
  const file = path.join(SHOTS, `${String(step).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ✓ ${label}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// --- 1. L'exploitation délivre un code d'inscription expert ---------------
console.log("\n1. Administration — code d'inscription pour un expert");
const farmer = await browser.newContext({ ...devices['Desktop Chrome'] });
const farmerPage = await farmer.newPage();

await farmerPage.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
await farmerPage.fill('#email', ADMIN_EMAIL);
await farmerPage.fill('#password', ADMIN_PASSWORD);
await farmerPage.click('button[type=submit]');
await farmerPage.waitForURL('**/dashboard', { timeout: 30_000 });
await shot(farmerPage, 'exploitation-tableau-de-bord');

// Le code d'inscription d'un compte expert se délivre depuis l'administration.
const invitation = await farmerPage.evaluate(async () => {
  const response = await fetch('/api/admin/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountType: 'AGRONOMIST', validityDays: 7 }),
  });
  return { status: response.status, body: await response.json() };
});
expect(
  invitation.status === 201 && invitation.body?.code,
  `Code d'inscription non délivré : ${JSON.stringify(invitation)}`,
);
console.log(`  · code d'inscription ${invitation.body.code}`);

// --- 2. L'exploitation ouvre un accès de conseil --------------------------
console.log('\n2. Paramètres — accès de conseil');
await farmerPage.goto(`${BASE}/parametres`, { waitUntil: 'domcontentloaded' });
await farmerPage.waitForTimeout(1500);
await shot(farmerPage, 'exploitation-parametres-experts');

const advisory = await farmerPage.evaluate(async () => {
  const response = await fetch('/api/farms/advisors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validityDays: 7 }),
  });
  return { status: response.status, body: await response.json() };
});
expect(
  advisory.status === 201 && advisory.body?.code,
  `Code d'accès non délivré : ${JSON.stringify(advisory)}`,
);
console.log(`  · code d'accès ${advisory.body.code}`);

// --- 3. L'expert crée son compte par la porte « expert » ------------------
console.log("\n3. Inscription de l'expert");
const expert = await browser.newContext({ ...devices['Desktop Chrome'] });
const expertPage = await expert.newPage();

await expertPage.goto(`${BASE}/inscription?type=expert`, {
  waitUntil: 'domcontentloaded',
});
await expertPage.waitForTimeout(1000);
await shot(expertPage, 'expert-inscription');

const created = await expertPage.evaluate(async (payload) => {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}, {
  ...EXPERT,
  passwordConfirmation: EXPERT.password,
  invitationCode: invitation.body.code,
  organization: 'Chambre du Loiret',
  acceptTerms: true,
  acceptPrivacy: true,
});
expect(
  created.status === 201,
  `Inscription refusée : ${JSON.stringify(created)}`,
);

// La vérification d'e-mail passe par un code envoyé ; en développement il est
// écrit dans les logs. On le lit directement en base via l'API d'admin.
const verified = await farmerPage.evaluate(async (email) => {
  const list = await fetch(
    `/api/admin/users?q=${encodeURIComponent(email)}`,
  ).then((r) => r.json());
  const user = (list.users ?? []).find((u) => u.email === email);
  if (!user) return { ok: false, reason: 'compte introuvable' };
  const response = await fetch(`/api/admin/users/${user.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify-email' }),
  });
  return { ok: response.ok, status: response.status };
}, EXPERT.email);
expect(verified.ok, `Vérification d'e-mail impossible : ${JSON.stringify(verified)}`);

// --- 4. Connexion par la porte expert -------------------------------------
console.log('\n4. Connexion expert');
await expertPage.goto(`${BASE}/connexion-expert`, { waitUntil: 'domcontentloaded' });
await expertPage.waitForTimeout(800);
await shot(expertPage, 'expert-connexion');

await expertPage.fill('#email', EXPERT.email);
await expertPage.fill('#password', EXPERT.password);
await expertPage.click('button[type=submit]');
try {
  await expertPage.waitForURL('**/portefeuille', { timeout: 30_000 });
} catch {
  // Diagnostic : l'écran affiche presque toujours la raison du refus.
  const message = await expertPage.textContent('body');
  throw new Error(
    `Connexion expert bloquée sur ${expertPage.url()} — ${message.slice(0, 400)}`,
  );
}
await shot(expertPage, 'expert-portefeuille-vide');

// --- 5. Activation du code d'accès ----------------------------------------
console.log("\n5. Activation de l'accès au domaine");
const joined = await expertPage.evaluate(async (code) => {
  const response = await fetch('/api/portfolio/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return { status: response.status, body: await response.json() };
}, advisory.body.code);
expect(joined.status === 200, `Accès refusé : ${JSON.stringify(joined)}`);

await expertPage.goto(`${BASE}/portefeuille`, { waitUntil: 'domcontentloaded' });
await expertPage.waitForTimeout(1500);
const portfolioText = await expertPage.textContent('body');
expect(
  portfolioText.includes('Beauce'),
  'Le portefeuille ne montre pas le domaine suivi.',
);
await shot(expertPage, 'expert-portefeuille');

// --- 6. Le domaine, sa carte et une parcelle ------------------------------
console.log('\n6. Domaine, carte et parcelle');
// Le lien du domaine, distingué des entrées de navigation qui partagent le
// même préfixe (« /portefeuille/preconisations »).
const farmLink = await expertPage.evaluate(() => {
  const links = [...document.querySelectorAll('a[href^="/portefeuille/"]')];
  const match = links.find((a) => /^\/portefeuille\/[a-z0-9]{20,}$/.test(a.getAttribute('href')));
  return match?.getAttribute('href') ?? null;
});
expect(farmLink, 'Aucun lien vers le domaine suivi.');
const farmId = farmLink.split('/')[2];

await expertPage.goto(`${BASE}${farmLink}`, { waitUntil: 'domcontentloaded' });
await expertPage.waitForTimeout(2500);
await shot(expertPage, 'expert-domaine');

// La carte doit s'être montée : le conteneur Leaflet et au moins un contour.
const mapReady = await expertPage.evaluate(() => {
  const container = document.querySelector('.leaflet-container');
  const shapes = document.querySelectorAll('.leaflet-overlay-pane path').length;
  return { mounted: Boolean(container), shapes };
});
expect(mapReady.mounted, "La carte du domaine ne s'est pas montée.");
expect(mapReady.shapes > 0, 'Aucun contour de parcelle tracé sur la carte.');
console.log(`  · carte montée, ${mapReady.shapes} contour(s) tracé(s)`);

const parcelLink = await expertPage.getAttribute(
  `a[href^="/portefeuille/${farmId}/parcelles/"]`,
  'href',
);
expect(parcelLink, 'Aucun lien vers une parcelle depuis le domaine.');
await expertPage.goto(`${BASE}${parcelLink}`, { waitUntil: 'domcontentloaded' });
await expertPage.waitForTimeout(2000);
await shot(expertPage, 'expert-parcelle');

// --- 7. Rédaction et transmission d'une préconisation ---------------------
console.log('\n7. Rédaction de la préconisation');
await expertPage.goto(`${BASE}/portefeuille/${farmId}/preconisations/nouvelle`, {
  waitUntil: 'domcontentloaded',
});
await expertPage.waitForTimeout(1500);
await shot(expertPage, 'expert-nouvelle-preconisation');

const parcelId = parcelLink.split('/').pop();
const proposed = await expertPage.evaluate(
  async ({ farm, parcel }) => {
    const response = await fetch(`/api/recommendations?farmId=${farm}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcelId: parcel,
        kind: 'PHYTO',
        priority: 'HIGH',
        title: 'Protection fongicide T1',
        rationale:
          'Stade 2 nœuds atteint, septoriose présente sur F3 avec 15 % de fréquence.',
        productName: 'Produit conseillé',
        amm: '2090123',
        dose: 1.2,
        doseUnit: 'L/ha',
        targetLabel: 'Septoriose',
        send: true,
      }),
    });
    return { status: response.status, body: await response.json() };
  },
  { farm: farmId, parcel: parcelId },
);
expect(
  proposed.status === 201 && proposed.body.status === 'PROPOSED',
  `Préconisation non transmise : ${JSON.stringify(proposed)}`,
);
expect(
  proposed.body.productSource === 'saisie',
  `Provenance du produit incorrecte : ${proposed.body.productSource}`,
);
console.log('  · produit marqué « saisie » — aucun catalogue E-Phy importé');

await expertPage.goto(`${BASE}/portefeuille/preconisations`, {
  waitUntil: 'domcontentloaded',
});
await expertPage.waitForTimeout(1500);
await shot(expertPage, 'expert-mes-preconisations');

// --- 8. L'exploitation reçoit et accepte ----------------------------------
console.log("\n8. Réception côté exploitation");
await farmerPage.goto(`${BASE}/preconisations`, { waitUntil: 'domcontentloaded' });
await farmerPage.waitForTimeout(1500);
const received = await farmerPage.textContent('body');
expect(
  received.includes('Protection fongicide T1'),
  "L'exploitation ne voit pas la préconisation transmise.",
);
await shot(farmerPage, 'exploitation-preconisations');

await farmerPage.goto(`${BASE}/preconisations/${proposed.body.id}`, {
  waitUntil: 'domcontentloaded',
});
await farmerPage.waitForTimeout(1500);
const detail = await farmerPage.textContent('body');
expect(
  detail.includes('non vérifié') || detail.includes('catalogue'),
  'La provenance du produit n’est pas affichée à l’exploitation.',
);
await shot(farmerPage, 'exploitation-preconisation-detail');

const accepted = await farmerPage.evaluate(async (id) => {
  const response = await fetch(`/api/recommendations/${id}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'ACCEPTED', note: 'Passage prévu jeudi.' }),
  });
  return { status: response.status, body: await response.json() };
}, proposed.body.id);
expect(
  accepted.status === 200 && accepted.body.status === 'ACCEPTED',
  `Acceptation refusée : ${JSON.stringify(accepted)}`,
);

// --- 9. Exports PDF -------------------------------------------------------
console.log('\n9. Exports PDF');
for (const dataset of ['phytosanitaire', 'bilan-engrais']) {
  const size = await farmerPage.evaluate(async (name) => {
    const response = await fetch(`/api/exports?dataset=${name}&format=pdf`);
    if (!response.ok) return -response.status;
    const blob = await response.blob();
    return blob.size;
  }, dataset);
  expect(size > 1000, `Export ${dataset} vide ou en échec (${size}).`);
  console.log(`  ✓ ${dataset} — ${(size / 1024).toFixed(1)} ko`);
}

// --- 10. Le retrait d'accès coupe immédiatement ---------------------------
console.log("\n10. Retrait de l'accès");
const revoked = await farmerPage.evaluate(async () => {
  const list = await fetch('/api/farms/advisors').then((r) => r.json());
  const active = list.engagements.find((e) => e.status === 'ACTIVE');
  if (!active) return { ok: false, reason: 'aucune mission active' };
  const response = await fetch('/api/farms/advisors', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engagementId: active.id }),
  });
  return { ok: response.ok };
});
expect(revoked.ok, `Retrait impossible : ${JSON.stringify(revoked)}`);

const afterRevoke = await expertPage.evaluate(async (farm) => {
  const response = await fetch(`/api/parcels?farmId=${farm}`);
  return response.status;
}, farmId);
expect(
  afterRevoke === 404,
  `L'expert accède encore au domaine après retrait (HTTP ${afterRevoke}).`,
);
console.log('  ✓ accès coupé immédiatement (404)');

await browser.close();
console.log(`\n✓ Parcours complet — copies d'écran dans ${SHOTS}\n`);
