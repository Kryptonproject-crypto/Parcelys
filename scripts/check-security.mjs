/**
 * Sondage de sécurité sur une instance en fonctionnement.
 *
 *   node scripts/check-security.mjs [url]
 *
 * Les tests d'isolation vérifient les règles depuis l'intérieur ; ce script les
 * attaque depuis l'extérieur, avec de vraies requêtes HTTP. Il tente ce qu'un
 * visiteur mal intentionné tenterait : atteindre une route sans session,
 * changer un identifiant dans une URL, forger une requête depuis un autre
 * site, écrire dans un registre auquel on n'a qu'un accès en lecture.
 *
 * Sortie non nulle au premier écart : il est fait pour tourner en intégration
 * continue autant que sous les yeux d'un relecteur.
 *
 * Prérequis : instance lancée et base semée (`npm run db:seed`).
 */
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const ADMIN_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Client HTTP conservant ses cookies, comme un navigateur. */
class Client {
  constructor() {
    this.cookies = new Map();
  }

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method, path, { body, headers = {}, origin } = {}) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookies.size > 0 ? { Cookie: this.cookieHeader } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }

    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();

    return { status: response.status, body: payload, headers: response.headers };
  }

  get = (path, options) => this.request('GET', path, options);
  post = (path, body, options) => this.request('POST', path, { body, ...options });
  put = (path, body, options) => this.request('PUT', path, { body, ...options });
  del = (path, body, options) => this.request('DELETE', path, { body, ...options });

  async login(email, password) {
    const response = await this.post(
      '/api/auth/login',
      { email, password },
      { origin: BASE },
    );
    if (response.status === 429) {
      throw new Error(
        'Limitation de débit atteinte sur la connexion. C’est le comportement ' +
          'attendu après plusieurs exécutions rapprochées : attendez la fin de ' +
          'la fenêtre, ou relancez avec RATE_LIMIT_ENABLED=false sur le serveur.',
      );
    }
    if (response.status !== 200) {
      throw new Error(`Connexion impossible (${response.status}) : ${JSON.stringify(response.body)}`);
    }
    return response;
  }
}

// ---------------------------------------------------------------------------
console.log('\n1. Aucun accès sans session');

const anonymous = new Client();
const PROTECTED = [
  ['GET', '/api/parcels'],
  ['GET', '/api/farms'],
  ['GET', '/api/crops'],
  ['GET', '/api/phytosanitary/applications'],
  ['GET', '/api/exports?dataset=parcelles&format=csv'],
  ['GET', '/api/recommendations'],
  ['GET', '/api/mobile/bootstrap'],
  ['GET', '/api/mobile/version'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/updates'],
  ['GET', '/api/farms/advisors'],
  ['POST', '/api/parcels'],
  ['POST', '/api/sync'],
  ['POST', '/api/portfolio/join'],
];

for (const [method, path] of PROTECTED) {
  const response = await anonymous.request(method, path, {
    ...(method === 'POST' ? { body: {}, origin: BASE } : {}),
  });
  check(
    `${method} ${path} refusé`,
    response.status === 401 || response.status === 403 || response.status === 404,
    `HTTP ${response.status}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n2. Cookie de session');

const admin = new Client();
const loginResponse = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
const setCookie = (loginResponse.headers.getSetCookie?.() ?? []).join(' ; ');

check('cookie HttpOnly', /HttpOnly/i.test(setCookie), setCookie.slice(0, 120));
check('cookie SameSite=Lax', /SameSite=Lax/i.test(setCookie));
check(
  'jeton absent de la réponse web',
  !('token' in (loginResponse.body ?? {})),
  'un client web ne doit recevoir aucun jeton exploitable en JavaScript',
);
check(
  'empreinte de mot de passe jamais renvoyée',
  !JSON.stringify(loginResponse.body ?? {}).includes('passwordHash'),
);

// ---------------------------------------------------------------------------
console.log('\n3. CSRF depuis un site tiers');

for (const [method, path, body] of [
  ['POST', '/api/parcels', { name: 'Forgée' }],
  ['PUT', '/api/farms', { name: 'Renommée par un tiers' }],
  ['POST', '/api/farms/advisors', { validityDays: 7 }],
]) {
  const response = await admin.request(method, path, {
    body,
    origin: 'https://site-malveillant.example',
  });
  check(
    `${method} ${path} bloqué depuis une origine étrangère`,
    response.status === 403 && response.body?.error?.code === 'CSRF_BLOCKED',
    `HTTP ${response.status}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n4. Cloisonnement entre exploitations');

// Un second compte, avec sa propre exploitation, créé via un code d'invitation.
const invitation = await admin.post(
  '/api/admin/invitations',
  { validityDays: 1 },
  { origin: BASE },
);
if (invitation.status !== 201) {
  throw new Error(`Code d'invitation non délivré : ${JSON.stringify(invitation.body)}`);
}

const stranger = new Client();
const strangerEmail = `voisin.${Date.now()}@ferme.test`;
const registered = await stranger.post(
  '/api/auth/register',
  {
    invitationCode: invitation.body.code,
    firstName: 'Jean',
    lastName: 'Voisin',
    email: strangerEmail,
    password: 'MotDePasse1!',
    passwordConfirmation: 'MotDePasse1!',
    farmName: 'Ferme Voisine',
    acceptTerms: true,
    acceptPrivacy: true,
  },
  { origin: BASE },
);
if (registered.status !== 201) {
  throw new Error(`Inscription impossible : ${JSON.stringify(registered.body)}`);
}

// Vérification d'adresse par la voie d'administration, pour poursuivre.
const users = await admin.get(`/api/admin/users?q=${encodeURIComponent(strangerEmail)}`);
const strangerUser = (users.body.users ?? []).find((u) => u.email === strangerEmail);
await admin.request('PATCH', `/api/admin/users/${strangerUser.id}`, {
  body: { action: 'verify-email' },
  origin: BASE,
});
await stranger.login(strangerEmail, 'MotDePasse1!');

const adminParcels = await admin.get('/api/parcels');
const victimParcel = adminParcels.body.items?.[0];
const adminSession = await admin.get('/api/auth/session');
const victimFarmId = adminSession.body.memberships[0].farmId;

for (const [method, path, body] of [
  ['GET', `/api/parcels/${victimParcel.id}`],
  ['PUT', `/api/parcels/${victimParcel.id}`, { name: 'Détournée' }],
  ['DELETE', `/api/parcels/${victimParcel.id}`],
  ['GET', `/api/parcels/${victimParcel.id}/phytosanitary`],
  ['POST', `/api/parcels/${victimParcel.id}/phytosanitary`, {
    appliedOn: '2026-04-01',
    productName: 'Injecté',
    dose: 1,
    doseUnit: 'L/ha',
    captureWeather: false,
  }],
  ['GET', `/api/parcels?farmId=${victimFarmId}`],
  ['GET', `/api/exports?dataset=parcelles&format=csv&farmId=${victimFarmId}`],
  ['GET', `/api/mobile/bootstrap?farmId=${victimFarmId}`],
]) {
  const response = await stranger.request(method, path, {
    ...(body ? { body } : {}),
    origin: BASE,
  });
  check(
    `${method} ${path.split('?')[0]} cloisonné`,
    response.status === 404 || response.status === 403,
    `HTTP ${response.status}`,
  );
}

// Les listes du voisin ne contiennent rien de l'exploitation de démonstration.
const strangerList = await stranger.get('/api/parcels');
check(
  'la liste du voisin est vide',
  (strangerList.body.items ?? []).length === 0,
  `${strangerList.body.items?.length ?? '?'} parcelle(s)`,
);

const strangerExport = await stranger.get('/api/exports?dataset=parcelles&format=csv');
check(
  "l'export du voisin ne contient aucune parcelle de démonstration",
  !String(strangerExport.body).includes('Le Grand Champ'),
);

// ---------------------------------------------------------------------------
console.log("\n5. Administration réservée aux administrateurs d'instance");

for (const [method, path, body] of [
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/invitations'],
  ['GET', '/api/admin/updates'],
  ['POST', '/api/admin/invitations', { validityDays: 7 }],
  ['POST', '/api/admin/maintenance', { enabled: true }],
  ['POST', '/api/admin/cleanup', { target: 'sessions' }],
]) {
  const response = await stranger.request(method, path, {
    ...(body ? { body } : {}),
    origin: BASE,
  });
  check(`${method} ${path} refusé à un compte ordinaire`, response.status === 403, `HTTP ${response.status}`);
}

// Un compte ordinaire ne peut pas se promouvoir lui-même.
const selfPromote = await stranger.request('PATCH', `/api/admin/users/${strangerUser.id}`, {
  body: { action: 'set-platform-admin', value: true },
  origin: BASE,
});
check('auto-promotion impossible', selfPromote.status === 403, `HTTP ${selfPromote.status}`);

// ---------------------------------------------------------------------------
console.log('\n6. Les erreurs ne divulguent rien');

const broken = await admin.get('/api/parcels/' + randomUUID());
const serialized = JSON.stringify(broken.body ?? {});
check('aucune trace de pile', !/at .*\(.*:\d+:\d+\)/.test(serialized));
check('aucun chemin de fichier', !serialized.includes('/home/') && !serialized.includes('\\Users\\'));
check('aucune requête SQL', !/SELECT |INSERT |prisma\./i.test(serialized));

const badBody = await admin.post('/api/parcels', { name: '' }, { origin: BASE });
check(
  'une saisie invalide donne une erreur de validation, pas une 500',
  badBody.status === 400,
  `HTTP ${badBody.status}`,
);

// ---------------------------------------------------------------------------
console.log('\n7. En-têtes de sécurité');

const page = await fetch(`${BASE}/connexion`);
const expectedHeaders = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
for (const [header, value] of Object.entries(expectedHeaders)) {
  check(`${header}: ${value}`, page.headers.get(header) === value, page.headers.get(header) ?? 'absent');
}
check('Content-Security-Policy présente', Boolean(page.headers.get('content-security-policy')));
check(
  "CSP sans 'unsafe-eval' en production",
  !(page.headers.get('content-security-policy') ?? '').includes('unsafe-eval') ||
    process.env.NODE_ENV !== 'production',
);
check('Strict-Transport-Security présente', Boolean(page.headers.get('strict-transport-security')));
check("l'en-tête X-Powered-By est masqué", !page.headers.has('x-powered-by'));

// ---------------------------------------------------------------------------
console.log('\n8. Codes d’invitation');

const code = invitation.body.code;
const replay = await new Client().post(
  '/api/auth/register',
  {
    invitationCode: code,
    firstName: 'Second',
    lastName: 'Usage',
    email: `rejeu.${Date.now()}@ferme.test`,
    password: 'MotDePasse1!',
    passwordConfirmation: 'MotDePasse1!',
    farmName: 'Ferme Rejeu',
    acceptTerms: true,
    acceptPrivacy: true,
  },
  { origin: BASE },
);
check('un code déjà utilisé est refusé', replay.status === 403, `HTTP ${replay.status}`);

const forged = await new Client().post(
  '/api/auth/register',
  {
    invitationCode: 'PRCL-0000-0000-0000',
    firstName: 'Code',
    lastName: 'Inventé',
    email: `forge.${Date.now()}@ferme.test`,
    password: 'MotDePasse1!',
    passwordConfirmation: 'MotDePasse1!',
    farmName: 'Ferme Forgée',
    acceptTerms: true,
    acceptPrivacy: true,
  },
  { origin: BASE },
);
check('un code inventé est refusé', forged.status === 403, `HTTP ${forged.status}`);

const noCode = await new Client().post(
  '/api/auth/register',
  {
    firstName: 'Sans',
    lastName: 'Code',
    email: `libre.${Date.now()}@ferme.test`,
    password: 'MotDePasse1!',
    passwordConfirmation: 'MotDePasse1!',
    farmName: 'Ferme Libre',
    acceptTerms: true,
    acceptPrivacy: true,
  },
  { origin: BASE },
);
check(
  "l'inscription publique reste fermée",
  noCode.status === 403,
  `HTTP ${noCode.status}`,
);

// ---------------------------------------------------------------------------
console.log('\n9. Énumération de comptes et bruteforce');

// Un compte inexistant et un mauvais mot de passe doivent donner exactement la
// même réponse : toute différence permettrait de savoir quelles adresses sont
// inscrites.
const unknownAccount = await new Client().post(
  '/api/auth/login',
  { email: `inexistant.${Date.now()}@nulle-part.test`, password: 'MauvaisMotDePasse1!' },
  { origin: BASE },
);
const wrongPassword = await new Client().post(
  '/api/auth/login',
  { email: ADMIN_EMAIL, password: 'MauvaisMotDePasse1!' },
  { origin: BASE },
);

check(
  'compte inconnu et mot de passe erroné : même statut',
  unknownAccount.status === wrongPassword.status,
  `${unknownAccount.status} vs ${wrongPassword.status}`,
);
check(
  'compte inconnu et mot de passe erroné : même message',
  JSON.stringify(unknownAccount.body) === JSON.stringify(wrongPassword.body),
);

// Deux protections indépendantes : la limitation par adresse IP, qui freine
// l'assaillant, et le verrouillage du compte, qui protège la cible même si les
// essais viennent de partout. Depuis une seule adresse, c'est la première qui
// se déclenche — le verrouillage est vérifié séparément par la suite de tests,
// qui tourne avec la limitation désactivée.
const probe = new Client();
let stoppedAt = 0;
let stoppedWith = 0;
for (let attempt = 1; attempt <= 15 && stoppedAt === 0; attempt += 1) {
  const response = await probe.post(
    '/api/auth/login',
    { email: ADMIN_EMAIL, password: 'MauvaisMotDePasse1!' },
    { origin: BASE },
  );
  if (response.status === 429 || response.status === 423) {
    stoppedAt = attempt;
    stoppedWith = response.status;
  }
}

check(
  'une série d’essais infructueux est coupée',
  stoppedAt > 0,
  stoppedAt > 0
    ? `au ${stoppedAt}ᵉ essai (HTTP ${stoppedWith} — ${stoppedWith === 429 ? 'adresse IP freinée' : 'compte verrouillé'})`
    : '15 essais passés sans blocage',
);

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? '✓' : '✗'} ${passed} contrôle(s) passé(s), ${failures.length} écart(s).`);
if (failures.length > 0) {
  console.log('\nÉcarts :');
  for (const failure of failures) console.log(`  · ${failure}`);
  process.exit(1);
}
console.log('');
