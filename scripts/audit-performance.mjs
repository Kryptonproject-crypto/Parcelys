/**
 * Combien de temps Parcelys met-il à répondre ?
 *
 *   npm run audit:perf
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI MESURER PLUTÔT QUE DÉCLARER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * « L'application est rapide » n'est pas un constat, c'est une impression — et
 * l'impression se forme sur un ordinateur de bureau, avec une base presque
 * vide. Kevin fait tourner Parcelys sur un Raspberry Pi, derrière un tunnel,
 * avec ses vraies parcelles. Les deux situations n'ont rien à voir.
 *
 * Ce script relève donc des chiffres : plusieurs appels par route, et les
 * médianes et pires cas qui en sortent. Il ne juge pas à la place du lecteur —
 * il affiche, et il signale ce qui dépasse les seuils ci-dessous.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CES CHIFFRES VALENT, ET CE QU'ILS NE VALENT PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ils sont relevés **ici** : machine de développement, base de développement,
 * serveur et base sur la même machine, réseau local. Le Pi de Kevin est plus
 * lent, sa base plus fournie, et son tunnel ajoute un aller-retour.
 *
 * Ils servent donc à repérer ce qui est lent **relativement** — une route qui
 * prend dix fois le temps des autres a un problème que le matériel n'explique
 * pas — et à conserver une trace comparable d'une version à l'autre. Ils ne
 * disent pas ce que Kevin ressentira devant son écran. Pour cela, il faut
 * relancer ce script sur le Pi, ce que la dernière ligne rappelle.
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

/** Nombre d'appels par cible. Le premier est écarté (mise en cache, JIT). */
const TIRS = 6;

/*
 * Seuils.
 *
 * Ils ne viennent d'aucune norme : ce sont des repères d'usage. Au-delà d'une
 * seconde, l'utilisateur sent l'attente ; au-delà de trois, il se demande si
 * quelque chose est cassé. On signale donc, sans faire échouer : un chiffre
 * élevé sur cette machine peut être normal pour un export qui fabrique un PDF.
 */
const SEUIL_ATTENTION_MS = 1000;
const SEUIL_ALERTE_MS = 3000;

let lent = 0;
let invalides = 0;
const releves = [];

class Client {
  constructor() {
    this.cookies = new Map();
  }

  async appeler(chemin, { methode = 'GET', corps } = {}) {
    const debut = performance.now();
    const reponse = await fetch(`${BASE}${chemin}`, {
      method: methode,
      redirect: 'manual',
      headers: {
        ...(corps ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
          : {}),
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

    // Lire le corps en entier : s'arrêter aux en-têtes mesurerait le temps
    // jusqu'au premier octet, pas le temps jusqu'à la page utilisable.
    const texte = await reponse.text();
    return { ms: performance.now() - debut, statut: reponse.status, taille: texte.length };
  }
}

const mediane = (xs) => {
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

async function mesurer(client, quoi, chemin, options) {
  const temps = [];
  let statut = 0;
  let taille = 0;

  for (let i = 0; i <= TIRS; i += 1) {
    const r = await client.appeler(chemin, options);
    statut = r.statut;
    taille = r.taille;
    if (i > 0) temps.push(r.ms); // le premier tir est un échauffement
  }

  const med = mediane(temps);
  const pire = Math.max(...temps);

  /*
   * Mesurer une route qui n'existe pas donne un chiffre magnifique.
   *
   * `/api/dashboard` a été sondée ici par erreur — cette route n'existe pas,
   * le tableau de bord interroge la base directement depuis la page. Elle
   * répondait 404 en 5 ms, et la ligne s'affichait avec une coche verte :
   * la plus rapide du lot, et la seule à ne rien mesurer.
   *
   * Un code de retour qui n'est pas un succès invalide donc la mesure, au lieu
   * de la décorer.
   */
  const succes = statut >= 200 && statut < 300;
  if (!succes) {
    invalides += 1;
    releves.push({ quoi, chemin, statut, med, pire, taille, invalide: true });
    console.info(
      `✗ ${quoi.padEnd(42)} HTTP ${statut} — mesure sans objet (${chemin})`,
    );
    return;
  }

  const niveau = pire >= SEUIL_ALERTE_MS ? '✗' : pire >= SEUIL_ATTENTION_MS ? '·' : '✓';
  if (niveau !== '✓') lent += 1;

  releves.push({ quoi, chemin, statut, med, pire, taille });
  console.info(
    `${niveau} ${quoi.padEnd(42)} ${String(Math.round(med)).padStart(5)} ms ` +
      `(pire ${String(Math.round(pire)).padStart(5)} ms, ${statut}, ${Math.round(taille / 1024)} ko)`,
  );
}

async function main() {
  const d = JSON.parse(process.env.AUDIT_DONNEES ?? '{}');
  const client = new Client();
  const campagne = d.campagne;

  await client.appeler('/api/auth/login', {
    methode: 'POST',
    corps: { email: d.exploitantEmail, password: d.motDePasse },
  });

  /*
   * Sur quoi ces chiffres portent.
   *
   * Un temps de réponse ne veut rien dire sans le volume qui l'a produit :
   * « 12 ms pour la liste des parcelles » se lit autrement selon qu'il y en a
   * trois ou trois cents. Le relevé l'annonce donc, pour que la comparaison
   * d'une version à l'autre — ou d'ici au Pi — reste honnête.
   */
  const liste = await fetch(`${BASE}/api/parcels?year=${campagne}`, {
    headers: { cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  }).then((r) => (r.ok ? r.json().catch(() => ({})) : {}));

  console.info(
    `\n▸ volume mesuré : ${liste.total ?? '?'} parcelle(s), ` +
      `${liste.totalAreaHa ?? '?'} ha, campagne ${campagne}`,
  );
  console.info(
    '  Une exploitation plus fournie répondra plus lentement : ces chiffres sont\n' +
      '  un point de comparaison, pas une garantie de tenue à l’échelle.',
  );

  console.info(`\n▸ routes de données (${TIRS} appels chacune, hors échauffement)\n`);

  // Les routes qui portent le plus : géométries, agrégats sur la campagne,
  // fabrication de documents.
  await mesurer(client, 'liste des parcelles', `/api/parcels?year=${campagne}`);
  await mesurer(client, 'liste des parcelles + contours', `/api/parcels?year=${campagne}&geometry=1`);
  await mesurer(client, 'fiche parcelle', `/api/parcels/${d.parcelId}`);
  await mesurer(client, 'chronologie de la parcelle', `/api/parcels/${d.parcelId}/history`);
  await mesurer(client, 'notifications', '/api/notifications');
  await mesurer(client, 'stocks', '/api/stocks');
  await mesurer(client, 'synthèse de conformité', `/api/regulatory/compliance?year=${campagne}`);
  await mesurer(client, 'IFT', `/api/regulatory/ift?year=${campagne}`);
  await mesurer(client, 'catalogue E-Phy (recherche)', '/api/phytosanitary/products?q=ble');
  await mesurer(client, 'instantané mobile', '/api/mobile/bootstrap');

  console.info('\n▸ exports\n');
  await mesurer(client, 'export parcelles (CSV)', `/api/exports?dataset=parcelles&year=${campagne}&format=csv`);
  await mesurer(client, 'export phyto (CSV)', `/api/exports?dataset=phytosanitaire&year=${campagne}&format=csv`);
  await mesurer(client, 'registre phyto (PDF)', `/api/exports?dataset=phytosanitaire&year=${campagne}&format=pdf`);

  console.info('\n▸ pages (HTML rendu par le serveur)\n');
  for (const [quoi, chemin] of [
    ['page publique (contact)', '/contact'],
    ['tableau de bord', '/dashboard'],
    ['liste des parcelles', '/parcelles'],
    ['fiche parcelle', `/parcelles/${d.parcelId}`],
    ['conformité', '/conformite'],
  ]) {
    await mesurer(client, quoi, chemin);
  }

  const total = releves.length;
  const mesurees = total - invalides;
  console.info(
    `\n${invalides === 0 && lent === 0 ? '✓' : '✗'} ${mesurees}/${total} cibles réellement mesurées, ` +
      `${lent} au-dessus de ${SEUIL_ATTENTION_MS} ms au pire des cas.`,
  );
  if (invalides > 0) {
    console.info(`\n${invalides} cible(s) n’ont rien mesuré :`);
    for (const r of releves.filter((x) => x.invalide)) {
      console.info(`  · ${r.quoi} — ${r.chemin} répond ${r.statut}`);
    }
    process.exitCode = 1;
  }

  if (lent > 0) {
    console.info('\nÀ regarder :');
    for (const r of releves.filter((x) => x.pire >= SEUIL_ATTENTION_MS)) {
      console.info(`  · ${r.quoi} — médiane ${Math.round(r.med)} ms, pire ${Math.round(r.pire)} ms`);
    }
  }

  console.info(
    '\nCes chiffres viennent de cette machine, avec cette base. Pour savoir ce que\n' +
      'Kevin ressent devant son écran, relancer ce script sur le Raspberry Pi :\n' +
      '  BASE_URL=http://127.0.0.1:3000 npm run audit:perf\n',
  );
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
