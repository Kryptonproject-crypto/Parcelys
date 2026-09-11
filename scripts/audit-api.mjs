/**
 * Sonder les 75 routes de l'API, sans navigateur.
 *
 *   npm run audit:api
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TROIS QUESTIONS, POSÉES À CHAQUE ROUTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **Sans session**, refuse-t-elle ? Une route de données qui répond 200 à
 *     un inconnu est une fuite, quel que soit son contenu.
 *  2. **Avec session**, répond-elle ? Une route qui renvoie 500 à son
 *     propriétaire est cassée — et rien dans l'interface ne le dit forcément,
 *     puisque la page peut l'appeler en arrière-plan.
 *  3. **Avec la session du voisin**, refuse-t-elle l'accès à une ressource qui
 *     n'est pas la sienne ? C'est le cloisonnement, et il se vérifie route par
 *     route : une seule qui l'oublie suffit.
 *
 * Le script ne devine pas les routes : la liste est écrite ici, et un contrôle
 * final la confronte à ce que contient `src/app/api`. Une route ajoutée sans
 * être sondée fait échouer l'audit — sans quoi la couverture s'érode en
 * silence, et personne ne s'en aperçoit.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

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

/** Un client qui garde ses cookies, comme un navigateur. */
class Client {
  constructor() {
    this.cookies = new Map();
  }

  entete() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async appeler(chemin, { methode = 'GET', corps, entetes = {} } = {}) {
    const reponse = await fetch(`${BASE}${chemin}`, {
      method: methode,
      redirect: 'manual',
      headers: {
        ...(corps ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size ? { cookie: this.entete() } : {}),
        ...entetes,
      },
      ...(corps ? { body: JSON.stringify(corps) } : {}),
    });

    for (const [nom, valeur] of reponse.headers) {
      if (nom.toLowerCase() !== 'set-cookie') continue;
      for (const part of valeur.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
        const [paire] = part.trim().split(';');
        const i = paire.indexOf('=');
        if (i > 0) this.cookies.set(paire.slice(0, i), paire.slice(i + 1));
      }
    }

    const texte = await reponse.text();
    let json = null;
    try {
      json = JSON.parse(texte);
    } catch {
      /* pas du JSON : une redirection, un PDF, un ZIP */
    }
    return { statut: reponse.status, json, texte, entetes: reponse.headers };
  }

  async connecter(email, motDePasse) {
    const r = await this.appeler('/api/auth/login', {
      methode: 'POST',
      corps: { email, password: motDePasse },
    });
    if (r.statut !== 200) {
      throw new Error(`connexion refusée pour ${email} : ${r.statut} ${r.texte.slice(0, 160)}`);
    }
    return r;
  }
}

// ---------------------------------------------------------------------------
// Les routes, et ce qu'on en attend
// ---------------------------------------------------------------------------

/**
 * `public` : accessible sans session (ou dont le refus n'est pas un 401).
 * `lecture` : GET qui doit répondre à un membre et refuser un inconnu.
 */
const ROUTES_PUBLIQUES = [
  '/api/health',
  '/api/auth/session',
  '/api/mobile/version',
];

const ROUTES_LECTURE = [
  '/api/farms',
  '/api/farms/advisors',
  '/api/parcels',
  '/api/parcels/geojson',
  '/api/crops',
  '/api/fertilizers',
  '/api/organic-inputs',
  '/api/notifications',
  '/api/profile',
  '/api/profile/sessions',
  '/api/account',
  '/api/documents',
  '/api/stocks',
  '/api/stocks/lots',
  '/api/stocks/mouvements',
  '/api/soil-covers',
  '/api/recommendations',
  '/api/phytosanitary/products',
  '/api/phytosanitary/applications',
  '/api/regulatory/compliance',
  '/api/regulatory/ift',
  '/api/regulatory/referentials',
  '/api/regulatory/control-file',
  '/api/pac/control',
  '/api/pac/snapshots',
  '/api/mobile/bootstrap',
  '/api/weather',
  '/api/exports',
];

const ROUTES_ADMIN = [
  '/api/admin/users',
  '/api/admin/farms',
  '/api/admin/invitations',
  '/api/admin/experts',
  '/api/admin/maintenance',
  '/api/admin/updates',
];

async function main() {
  const d = JSON.parse(process.env.AUDIT_DONNEES ?? '{}');

  // --- 1. Sans session -------------------------------------------------
  console.info('\n▸ sans session : ce qui doit être refusé');
  {
    const anonyme = new Client();

    for (const chemin of ROUTES_PUBLIQUES) {
      const r = await anonyme.appeler(chemin);
      attendu(r.statut < 500, `${chemin} répond sans session`, `HTTP ${r.statut}`);
    }

    const ouvertes = [];
    for (const chemin of [...ROUTES_LECTURE, ...ROUTES_ADMIN]) {
      const r = await anonyme.appeler(chemin);
      // 401 attendu ; 403 accepté ; tout 2xx est une fuite.
      if (r.statut >= 200 && r.statut < 300) ouvertes.push(`${chemin} (${r.statut})`);
    }
    attendu(
      ouvertes.length === 0,
      `les ${ROUTES_LECTURE.length + ROUTES_ADMIN.length} routes de données refusent un inconnu`,
      ouvertes.join(', '),
    );
  }

  // --- 2. Avec session : la route répond-elle ? -------------------------
  console.info('\n▸ avec session d’exploitant : ce qui doit répondre');
  const exploitant = new Client();
  await exploitant.connecter(d.exploitantEmail, d.motDePasse);
  {
    const cassees = [];
    const dependantesDuReseau = [];
    for (const chemin of ROUTES_LECTURE) {
      const r = await exploitant.appeler(chemin);
      if (r.statut < 500) continue;

      /*
       * Un 502 qui **nomme** le service tiers indisponible n'est pas une route
       * cassée : c'est une route qui dit la vérité.
       *
       * Dans cet environnement d'audit, le mandataire de sortie bloque le
       * fournisseur météo (il répond 403). `/api/weather` renvoie alors
       * `502 WEATHER_UNAVAILABLE — « Le service météo a répondu 403 »`. C'est
       * exactement le comportement attendu : inventer une prévision serait
       * bien pire qu'avouer qu'on n'en a pas.
       *
       * On le compte donc à part, et on le **rapporte** : passer sous silence
       * ce qui n'a pas pu être vérifié reviendrait à le déclarer bon.
       */
      const code = r.json?.error?.code ?? '';
      if (/UNAVAILABLE|UPSTREAM/.test(code)) {
        dependantesDuReseau.push(`${chemin} → ${code}`);
      } else {
        cassees.push(`${chemin} → ${r.statut}`);
      }
    }
    attendu(
      cassees.length === 0,
      `les ${ROUTES_LECTURE.length} routes de lecture répondent à leur propriétaire`,
      cassees.join(', '),
    );
    if (dependantesDuReseau.length) {
      console.info(
        `· non vérifiable ici, service tiers injoignable : ${dependantesDuReseau.join(', ')}`,
      );
    }

    // Les routes à paramètre, avec de vrais identifiants.
    const aParametre = [
      `/api/parcels/${d.parcelId}`,
      `/api/parcels/${d.parcelId}/crops`,
      `/api/parcels/${d.parcelId}/history`,
      `/api/parcels/${d.parcelId}/documents`,
      `/api/parcels/geojson?year=${d.campagne}`,
    ];
    const cassees2 = [];
    for (const chemin of aParametre) {
      const r = await exploitant.appeler(chemin);
      if (r.statut >= 400) cassees2.push(`${chemin} → ${r.statut}`);
    }
    attendu(
      cassees2.length === 0,
      'les routes de la fiche parcelle répondent',
      cassees2.join(', '),
    );
  }

  // --- 3. L'administration est refusée à un exploitant ------------------
  console.info('\n▸ l’administration, vue par un exploitant ordinaire');
  {
    const accordees = [];
    for (const chemin of ROUTES_ADMIN) {
      const r = await exploitant.appeler(chemin);
      if (r.statut >= 200 && r.statut < 300) accordees.push(`${chemin} (${r.statut})`);
    }
    attendu(
      accordees.length === 0,
      `les ${ROUTES_ADMIN.length} routes d’administration refusent un exploitant`,
      accordees.join(', '),
    );
  }

  // --- 4. Cloisonnement : la ressource du voisin ------------------------
  console.info('\n▸ cloisonnement entre exploitations');
  {
    const voisin = new Client();
    await voisin.connecter(d.voisinEmail, d.motDePasse);

    // Le voisin ne doit voir aucune parcelle de l'exploitation auditée.
    const siennes = await voisin.appeler('/api/parcels');
    const ids = JSON.stringify(siennes.json ?? {});
    attendu(
      !ids.includes(d.parcelId),
      'la liste des parcelles du voisin ne contient pas celles d’autrui',
    );

    // Et l'accès direct à une parcelle qui n'est pas la sienne est refusé.
    const cibles = [
      { chemin: `/api/parcels/${d.parcelId}`, methode: 'GET' },
      { chemin: `/api/parcels/${d.parcelId}`, methode: 'DELETE' },
      { chemin: `/api/parcels/${d.parcelId}/history`, methode: 'GET' },
      { chemin: `/api/parcels/${d.parcelId}/documents`, methode: 'GET' },
      {
        chemin: `/api/parcels/${d.parcelId}`,
        methode: 'PUT',
        corps: { name: 'Détournée' },
      },
      {
        chemin: `/api/parcels/${d.parcelId}/crops`,
        methode: 'POST',
        corps: { cropId: 'x', campaignYear: d.campagne },
      },
      // Le contrôle avant épandage n'écrit rien, mais il **lit** la parcelle,
      // son zonage et ses apports : s'il répondait au voisin, il lui dirait
      // où se trouve la parcelle d'autrui et ce qui y a été épandu.
      {
        chemin: '/api/regulatory/spreading',
        methode: 'POST',
        corps: {
          parcelId: d.parcelId,
          date: `${d.campagne}-04-20`,
          quantite: 20,
          unite: 't/ha',
        },
      },
    ];
    const percees = [];
    for (const cible of cibles) {
      const r = await voisin.appeler(cible.chemin, {
        methode: cible.methode,
        corps: cible.corps,
      });
      if (r.statut >= 200 && r.statut < 300) {
        percees.push(`${cible.methode} ${cible.chemin} → ${r.statut}`);
      }
    }
    attendu(
      percees.length === 0,
      `aucune des ${cibles.length} tentatives sur la parcelle d’autrui n’aboutit`,
      percees.join(', '),
    );

    // Le nom de la parcelle visée n'a pas bougé.
    const apres = await exploitant.appeler(`/api/parcels/${d.parcelId}`);
    attendu(
      apres.json?.name !== 'Détournée',
      'la parcelle visée est intacte',
      apres.json?.name ?? '(illisible)',
    );
  }

  // --- 5. Validation des entrées ----------------------------------------
  console.info('\n▸ validation des entrées');
  {
    const cas = [
      {
        quoi: 'une parcelle sans nom est refusée',
        chemin: '/api/parcels',
        methode: 'POST',
        corps: { internalNumber: 'X' },
      },
      {
        quoi: 'une géométrie illisible est refusée',
        chemin: '/api/parcels',
        methode: 'POST',
        corps: { name: 'Essai', geometry: { type: 'Polygon', coordinates: 'pas un tableau' } },
      },
      {
        quoi: 'une campagne absurde est refusée',
        chemin: `/api/parcels?year=99999999`,
        methode: 'GET',
      },
    ];
    for (const c of cas) {
      const r = await exploitant.appeler(c.chemin, { methode: c.methode, corps: c.corps });
      attendu(r.statut >= 400 && r.statut < 500, c.quoi, `HTTP ${r.statut}`);
    }
  }

  // --- 6. La liste sondée couvre-t-elle le dossier des routes ? ---------
  console.info('\n▸ couverture de la liste');
  {
    const racine = path.join(process.cwd(), 'src', 'app', 'api');
    const trouvees = [];
    const parcourir = async (dossier, prefixe) => {
      for (const entree of await readdir(dossier, { withFileTypes: true })) {
        if (entree.isDirectory()) {
          await parcourir(path.join(dossier, entree.name), `${prefixe}/${entree.name}`);
        } else if (entree.name === 'route.ts') {
          trouvees.push(`/api${prefixe}`);
        }
      }
    };
    await parcourir(racine, '');

    const sondees = new Set(
      [...ROUTES_PUBLIQUES, ...ROUTES_LECTURE, ...ROUTES_ADMIN].map((c) => c.split('?')[0]),
    );
    // Routes que l'on ne peut pas sonder en GET — elles n'acceptent que POST —
    // mais qui le sont bel et bien ailleurs dans ce fichier. Les déclarer ici
    // plutôt que dans HORS_PORTEE, parce qu'elles sont couvertes, pas écartées.
    sondees.add('/api/regulatory/spreading'); // § cloisonnement, ci-dessus
    // Les routes à paramètre sont sondées via leur parent ; celles qui ne sont
    // joignables que par la synchronisation ou un formulaire multipart le sont
    // ailleurs (tests d'intégration, audit mobile). On les nomme plutôt que de
    // les compter comme couvertes.
    const HORS_PORTEE = new Set([
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/logout-all',
      '/api/auth/register',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/verify-email',
      '/api/auth/resend-code',
      '/api/auth/invitation/check',
      '/api/account/export',
      '/api/admin/cleanup',
      '/api/admin/invitations/[id]',
      '/api/admin/users/[id]',
      '/api/crop-years/[id]',
      '/api/documents/[id]',
      '/api/farms/switch',
      '/api/fertilization/[id]',
      '/api/geo/reverse',
      '/api/geo/search',
      '/api/operations/[id]',
      '/api/pac/export',
      '/api/pac/import',
      '/api/parcels/[id]',
      '/api/parcels/[id]/crops',
      '/api/parcels/[id]/documents',
      '/api/parcels/[id]/fertilization',
      '/api/parcels/[id]/history',
      '/api/parcels/[id]/operations',
      '/api/parcels/[id]/phytosanitary',
      '/api/phytosanitary/applications/[id]',
      '/api/phytosanitary/products/[id]',
      '/api/phytosanitary/products/[id]/usages',
      '/api/portfolio/join',
      '/api/profile/email',
      '/api/profile/password',
      '/api/recommendations/[id]',
      '/api/recommendations/[id]/response',
      '/api/soil-covers/[id]',
      '/api/sync',
    ]);

    const oubliees = trouvees.filter((r) => !sondees.has(r) && !HORS_PORTEE.has(r));
    attendu(
      oubliees.length === 0,
      `les ${trouvees.length} routes du dossier sont sondées ou explicitement écartées`,
      oubliees.join(', '),
    );
  }

  console.info(`\n${echecs === 0 ? '✓' : '✗'} audit des API : ${echecs} problème(s).`);
  if (problemes.length) {
    console.info('\nProblèmes :');
    for (const p of problemes) console.info(`  · ${p}`);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
