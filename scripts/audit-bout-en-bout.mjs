/**
 * Le parcours d'un vrai agriculteur, du compte vide à la sauvegarde.
 *
 *   npm run audit:e2e
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SCRIPT, EN PLUS DE TOUS LES AUTRES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les tests unitaires éprouvent chaque pièce. L'audit des pages vérifie que
 * chacune s'affiche. L'audit des API vérifie que chacune répond. Aucun des
 * trois ne dit si **l'enchaînement** tient : créer l'exploitation, poser les
 * parcelles, déclarer les cultures, enregistrer un traitement, obtenir ses
 * avertissements, saisir un apport, produire le registre, l'exporter, et
 * retrouver tout cela depuis le téléphone.
 *
 * C'est ce trajet-là qu'un exploitant parcourt, et c'est le seul qui compte
 * vraiment. Une pièce peut être irréprochable et l'enchaînement cassé : un
 * identifiant qui ne se propage pas, une campagne qui change en route, un
 * export qui ne trouve pas ce qui vient d'être saisi.
 *
 * Chaque étape vérifie **son effet**, pas son code de retour : un 201 qui
 * n'écrit rien est un 201.
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

let echecs = 0;
const problemes = [];
const limites = [];

function attendu(condition, quoi, detail = '') {
  if (!condition) {
    echecs += 1;
    problemes.push(`${quoi}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  }
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Ce que cet environnement ne permet pas de vérifier.
 *
 * Ni un succès ni un échec : une vérification **impossible ici**. La compter
 * comme réussie serait mentir sur la couverture de l'audit ; la compter comme
 * échouée ferait rougir un parcours qui, lui, est bon.
 *
 * Chaque limitation dit ce qui n'a pas pu être vérifié, pourquoi, et la
 * commande qui le vérifierait là où c'est possible.
 */
function limite(quoi, pourquoi, commande) {
  limites.push({ quoi, pourquoi, commande });
  console.info(`◌ ${quoi} — non vérifiable ici : ${pourquoi}`);
}

class Client {
  constructor() {
    this.cookies = new Map();
    this.jeton = null;
  }

  async appeler(chemin, { methode = 'GET', corps, entetes = {} } = {}) {
    const reponse = await fetch(`${BASE}${chemin}`, {
      method: methode,
      redirect: 'manual',
      headers: {
        ...(corps ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
          : {}),
        ...(this.jeton ? { authorization: `Bearer ${this.jeton}` } : {}),
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
      /* PDF, ZIP, CSV */
    }
    return { statut: reponse.status, json, texte, taille: texte.length, entetes: reponse.headers };
  }
}

/** Un carré d'environ 6 ha, quelque part en Beauce. */
function carre(lng, lat) {
  const d = 0.0025;
  return {
    type: 'Polygon',
    coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]],
  };
}

async function main() {
  const d = JSON.parse(process.env.AUDIT_DONNEES ?? '{}');
  const client = new Client();

  // --- 1. Connexion -------------------------------------------------------
  const connexion = await client.appeler('/api/auth/login', {
    methode: 'POST',
    corps: { email: d.exploitantEmail, password: d.motDePasse },
  });
  attendu(connexion.statut === 200, 'l’exploitant se connecte', `HTTP ${connexion.statut}`);
  if (connexion.statut !== 200) return;

  const campagne = d.campagne;

  // --- 2. Une parcelle, avec son contour ----------------------------------
  const suffixe = Date.now().toString().slice(-6);
  const creation = await client.appeler('/api/parcels', {
    methode: 'POST',
    corps: {
      name: `Parcelle du parcours ${suffixe}`,
      internalNumber: `E2E-${suffixe}`,
      commune: 'Sainte-Test',
      drainedSoil: false,
      geometry: carre(1.9 + Math.random() * 0.01, 48.3),
    },
  });
  attendu(creation.statut === 201, 'une parcelle est créée', `HTTP ${creation.statut}`);
  const parcelId = creation.json?.id;
  if (!parcelId) return;

  // La superficie est calculée par PostGIS, pas saisie : elle doit être là.
  const fiche = await client.appeler(`/api/parcels/${parcelId}`);
  const surface = Number(fiche.json?.areaHa ?? 0);
  attendu(
    surface > 5 && surface < 10,
    'la superficie est calculée à partir du contour',
    `${surface.toFixed(4)} ha`,
  );

  // --- 3. Une culture sur la campagne -------------------------------------
  // Les listes de référentiel sont servies sous `items` : le vérifier plutôt
  // que de le supposer évite un audit qui échoue sur sa propre lecture.
  const cultures = await client.appeler('/api/crops');
  const ble = (cultures.json?.items ?? []).find((c) => c.code === 'BLE_TENDRE');
  attendu(Boolean(ble), 'le référentiel des cultures est servi');
  if (!ble) return;

  const culture = await client.appeler(`/api/parcels/${parcelId}/crops`, {
    methode: 'POST',
    corps: {
      cropId: ble.id,
      campaignYear: campagne,
      sowingDate: `${campagne - 1}-10-15`,
      expectedHarvestDate: `${campagne}-07-20`,
    },
  });
  attendu(culture.statut === 201, 'une culture est déclarée', `HTTP ${culture.statut}`);
  const cropYearId = culture.json?.id;

  // Et elle ressort bien sur la campagne demandée, pas sur une autre.
  // `/api/parcels` sert `items`, et la culture y est un objet `{id, name,
  // variety}` — pas une chaîne. Lire la mauvaise forme donnerait un audit qui
  // échoue sur sa propre lecture, ce qui est pire qu'un audit absent.
  const liste = await client.appeler(`/api/parcels?year=${campagne}`);
  const enListe = (liste.json?.items ?? []).find((p) => p.id === parcelId);
  attendu(
    enListe?.crop?.name === ble.name,
    'la culture apparaît sur la liste de la bonne campagne',
    JSON.stringify(enListe?.crop ?? null),
  );

  // L'autre moitié du contrôle : elle ne doit PAS ressortir sur la campagne
  // précédente. Une culture qui s'affiche sur toutes les campagnes fausse
  // l'assolement déclaré autant qu'une culture absente.
  const listeAnterieure = await client.appeler(`/api/parcels?year=${campagne - 1}`);
  const anterieure = (listeAnterieure.json?.items ?? []).find((p) => p.id === parcelId);
  attendu(
    anterieure !== undefined && !anterieure.crop,
    'elle ne déborde pas sur la campagne précédente',
    JSON.stringify(anterieure?.crop ?? null),
  );

  // --- 4. Un traitement, et ses avertissements ----------------------------
  const traitement = await client.appeler(`/api/parcels/${parcelId}/phytosanitary`, {
    methode: 'POST',
    corps: {
      appliedOn: `${campagne}-04-15`,
      productName: 'PRODUIT HORS CATALOGUE (parcours)',
      cropYearId,
      dose: 2,
      doseUnit: 'L/ha',
      treatedAreaHa: Math.min(surface, 6),
    },
  });
  attendu(traitement.statut === 201, 'un traitement est enregistré', `HTTP ${traitement.statut}`);
  attendu(
    Array.isArray(traitement.json?.warnings),
    'le serveur rend la liste de ses avertissements, même vide',
  );

  // --- 5. Un apport de fertilisant ----------------------------------------
  const engrais = await client.appeler('/api/fertilizers');
  const ammonitrate = (engrais.json?.items ?? []).find((f) =>
    /ammonitrate/i.test(f.name ?? ''),
  );
  attendu(Boolean(ammonitrate), 'le référentiel des engrais est servi');

  if (ammonitrate) {
    const apport = await client.appeler(`/api/parcels/${parcelId}/fertilization`, {
      methode: 'POST',
      corps: {
        appliedOn: `${campagne}-03-01`,
        inputType: 'MINERAL',
        fertilizerId: ammonitrate.id,
        // Obligatoire (`fertilizationSchema`) : le cahier d'épandage doit
        // porter le nom du produit tel qu'il a été employé, même si l'engrais
        // référencé disparaît plus tard du référentiel.
        productLabel: ammonitrate.name,
        cropYearId,
        dose: 120,
        doseUnit: 'kg/ha',
        treatedAreaHa: Math.min(surface, 6),
      },
    });
    attendu(apport.statut === 201, 'un apport est enregistré', `HTTP ${apport.statut}`);

    /*
     * L'azote apporté est calculé par le serveur depuis la teneur du
     * référentiel, jamais saisi par le client. La réponse le rend deux fois :
     * dans `computed`, et dans la ligne `item` telle qu'elle est écrite.
     *
     * Les deux doivent concorder. Si elles divergeaient, l'écran afficherait un
     * chiffre et le cahier d'épandage en porterait un autre — c'est le second
     * qui part au contrôle.
     */
    const calcule = Number(apport.json?.computed?.nSupplied ?? NaN);
    const ecrit = Number(apport.json?.item?.nSupplied ?? NaN);
    attendu(
      calcule > 0,
      'l’azote apporté est calculé depuis la teneur de l’engrais',
      `${calcule} kg N/ha`,
    );
    attendu(
      Math.abs(calcule - ecrit) < 0.001,
      'l’azote annoncé est celui qui est enregistré',
      `calculé ${calcule} / écrit ${ecrit}`,
    );
    // 120 kg/ha d'un engrais à 33,5 % font 40,2 kg N/ha : le chiffre doit être
    // celui du produit choisi, pas une valeur par défaut.
    const attendue = (120 * Number(ammonitrate.nPercent ?? 0)) / 100;
    attendu(
      Number.isFinite(attendue) && attendue > 0 && Math.abs(calcule - attendue) < 0.01,
      'le calcul suit la teneur du produit choisi',
      `${calcule} attendu ${attendue} (${ammonitrate.nPercent} %)`,
    );
  }

  // --- 6. Le contrôle avant épandage --------------------------------------
  const epandage = await client.appeler('/api/regulatory/spreading', {
    methode: 'POST',
    corps: {
      parcelId,
      date: `${campagne}-04-20`,
      quantite: 20,
      unite: 't/ha',
      campaignYear: campagne,
    },
  });
  attendu(epandage.statut === 200, 'le contrôle avant épandage répond', `HTTP ${epandage.statut}`);
  attendu(
    epandage.json?.niveau !== 'CONFORME',
    'il ne dit pas « conforme » sans référentiel chargé',
    epandage.json?.niveau,
  );
  attendu(
    (epandage.json?.points ?? []).some((p) => p.verdict === 'indetermine'),
    'il nomme ce qu’il n’a pas pu vérifier',
  );

  /*
   * Ce qui vient d'être vérifié, c'est la **dégradation honnête** : sans
   * référentiel, le contrôle refuse de conclure et dit lequel lui manque.
   * C'est le comportement voulu, et il compte.
   *
   * Mais ce n'est pas le contrôle lui-même. Le chemin « référentiel chargé,
   * période d'interdiction franchie, plafond dépassé » n'est pas exercé ici :
   * il l'est par `tests/epandage.test.ts`, qui pose ses propres règles en base
   * plutôt que d'attendre un référentiel officiel.
   */
  if ((epandage.json?.points ?? []).every((p) => p.verdict === 'indetermine')) {
    limite(
      'le contrôle avant épandage sur référentiel chargé',
      'aucune règle d’épandage n’est chargée dans cette base — tous les points ressortent indéterminés',
      'npm test -- tests/epandage.test.ts (règles posées en base), ou charger un référentiel territorial',
    );
  }

  // --- 7. Le registre et la conformité ------------------------------------
  const conformite = await client.appeler(`/api/regulatory/compliance?year=${campagne}`);
  attendu(conformite.statut === 200, 'le rapport de conformité est produit');
  attendu(
    !JSON.stringify(conformite.json ?? {}).includes('légalement conforme'),
    'le rapport n’affirme jamais la conformité légale',
  );

  const ift = await client.appeler(`/api/regulatory/ift?year=${campagne}`);
  attendu(ift.statut === 200, 'l’IFT répond');
  attendu(
    ift.json?.configured === true || (ift.json?.caveats ?? []).length > 0,
    'sans référentiel de doses, l’IFT dit pourquoi il ne calcule pas',
  );
  if (ift.json?.configured !== true) {
    limite(
      'le calcul de l’IFT sur doses de référence officielles',
      'le référentiel des doses de référence n’est pas chargé dans cette base',
      'npm test -- tests/ephy-doses.test.ts (doses posées en base), ou importer le référentiel officiel',
    );
  }

  // --- 8. Les exports ------------------------------------------------------
  for (const [dataset, type] of [
    ['phytosanitaire', 'csv'],
    ['cultures', 'csv'],
    ['parcelles', 'csv'],
  ]) {
    const exp = await client.appeler(
      `/api/exports?dataset=${dataset}&year=${campagne}&format=${type}`,
    );
    attendu(
      exp.statut === 200 && exp.taille > 50,
      `l’export ${dataset} (${type}) est produit`,
      `HTTP ${exp.statut}, ${exp.taille} octets`,
    );
    if (dataset === 'phytosanitaire' && exp.statut === 200) {
      attendu(
        exp.texte.includes(`E2E-${suffixe}`) || exp.texte.includes('Parcelle du parcours'),
        'l’export contient la parcelle qui vient d’être saisie',
      );
    }
  }

  const pdf = await client.appeler(
    `/api/exports?dataset=phytosanitaire&year=${campagne}&format=pdf`,
  );
  attendu(
    pdf.statut === 200 && pdf.taille > 1000,
    'le registre phytosanitaire sort en PDF',
    `HTTP ${pdf.statut}, ${pdf.taille} octets`,
  );

  // --- 9. Le téléphone : instantané, saisie hors ligne, remontée ----------
  const mobile = new Client();
  const connexionMobile = await mobile.appeler('/api/auth/login', {
    methode: 'POST',
    corps: { email: d.exploitantEmail, password: d.motDePasse, client: 'native' },
    entetes: { origin: 'capacitor://localhost' },
  });
  const jeton = connexionMobile.json?.token ?? connexionMobile.json?.accessToken;
  attendu(Boolean(jeton), 'l’application mobile obtient un jeton');
  if (jeton) {
    mobile.jeton = jeton;

    const instantane = await mobile.appeler('/api/mobile/bootstrap');
    attendu(instantane.statut === 200, 'l’instantané hors ligne est servi');

    const parcellesEmbarquees = instantane.json?.parcels ?? [];
    attendu(
      parcellesEmbarquees.some((p) => p.id === parcelId),
      'la parcelle créée au bureau est dans l’instantané du téléphone',
    );
    attendu(
      parcellesEmbarquees.every((p) => p.geometry !== undefined),
      'chaque parcelle embarque son contour, pour fonctionner sans réseau',
    );
    const catalogue = instantane.json?.referential?.phytoCatalogue;
    attendu(
      Array.isArray(catalogue),
      'le catalogue E-Phy embarqué est une liste, même vide',
      `${(catalogue ?? []).length} produit(s)`,
    );
    attendu(
      instantane.json?.referential?.phytoCatalogueSource !== undefined,
      'la provenance du catalogue embarqué est indiquée',
    );

    /*
     * Un catalogue vide est le comportement juste quand le référentiel E-Phy
     * n'a pas été importé — mais ce n'est pas une vérification du catalogue.
     * Dire « ✓ catalogue embarqué » sur zéro produit serait faux.
     */
    if ((catalogue ?? []).length === 0) {
      limite(
        'le contenu du catalogue E-Phy embarqué',
        'le référentiel E-Phy n’est pas importé dans cette base (data.gouv.fr est bloqué par le mandataire de l’environnement)',
        'npm run ephy:sync -- --zip <archive ANSES>, puis relancer cet audit',
      );
    } else {
      attendu(
        catalogue.every((p) => p.amm && p.name),
        'chaque produit embarqué porte son AMM et son nom',
      );
      attendu(
        catalogue.some((p) => Array.isArray(p.usages) && p.usages.length > 0),
        'au moins un produit embarque ses usages, pour le contrôle de dose hors réseau',
      );
    }

    // Une saisie faite au champ, rejouée par la file d'attente.
    const clientId = `e2e-${suffixe}-${Math.random().toString(36).slice(2, 10)}`;
    const remontee = await mobile.appeler('/api/sync', {
      methode: 'POST',
      corps: {
        operations: [
          {
            clientId,
            kind: 'operation.create',
            parcelId,
            capturedAt: new Date().toISOString(),
            payload: {
              performedOn: `${campagne}-04-18`,
              type: 'LABOUR',
              notes: 'Saisi au champ, sans réseau',
            },
          },
        ],
      },
    });
    attendu(remontee.statut === 200, 'la file d’attente est rejouée', `HTTP ${remontee.statut}`);
    attendu(remontee.json?.applied === 1, 'la saisie hors ligne est appliquée');

    // Et rejouée deux fois, elle ne crée pas de doublon.
    const rejeu = await mobile.appeler('/api/sync', {
      methode: 'POST',
      corps: {
        operations: [
          {
            clientId,
            kind: 'operation.create',
            parcelId,
            payload: {
              performedOn: `${campagne}-04-18`,
              type: 'LABOUR',
              notes: 'Saisi au champ, sans réseau',
            },
          },
        ],
      },
    });
    attendu(
      rejeu.json?.results?.[0]?.status === 'replayed',
      'un lot renvoyé ne crée aucun doublon',
      rejeu.json?.results?.[0]?.status,
    );

    /*
     * Le travail saisi au champ se retrouve au bureau — aux deux endroits où
     * l'exploitant le cherchera.
     *
     * La chronologie ne porte volontairement les notes d'aucun type
     * d'événement : c'est une frise de titres qui renvoie vers l'onglet. C'est
     * donc la fiche des travaux qu'il faut interroger pour la saisie complète,
     * et la chronologie pour vérifier que l'événement y figure.
     */
    const travaux = await client.appeler(`/api/parcels/${parcelId}/operations`);
    const saisie = (travaux.json?.items ?? []).find((o) =>
      (o.notes ?? '').includes('Saisi au champ'),
    );
    attendu(
      saisie !== undefined,
      'la saisie du champ est enregistrée avec sa note',
      `${(travaux.json?.items ?? []).length} travail/travaux`,
    );
    attendu(
      saisie?.type === 'LABOUR',
      'le type de travail saisi au champ est conservé',
      String(saisie?.type),
    );

    const frise = await client.appeler(`/api/parcels/${parcelId}/history`);
    attendu(
      (frise.json?.events ?? []).some((e) => e.kind === 'OPERATION'),
      'ce qui a été saisi au champ apparaît dans la chronologie',
      `${(frise.json?.events ?? []).length} événement(s)`,
    );
  }

  // --- 10. Le cloisonnement tient jusqu'au bout ---------------------------
  const voisin = new Client();
  await voisin.appeler('/api/auth/login', {
    methode: 'POST',
    corps: { email: d.voisinEmail, password: d.motDePasse },
  });
  const tentative = await voisin.appeler(`/api/parcels/${parcelId}`);
  attendu(
    tentative.statut === 404,
    'la parcelle du parcours reste invisible au voisin',
    `HTTP ${tentative.statut}`,
  );

  console.info(`\n${echecs === 0 ? '✓' : '✗'} parcours complet : ${echecs} problème(s).`);
  if (problemes.length) {
    console.info('\nProblèmes :');
    for (const p of problemes) console.info(`  · ${p}`);
  }

  // Les limitations ne font pas échouer l'audit — elles l'empêchent d'être lu
  // comme une couverture complète. Les taire reviendrait à présenter un
  // parcours partiel comme un parcours entier.
  if (limites.length) {
    console.info(`\n${limites.length} vérification(s) impossible(s) dans cet environnement :`);
    for (const l of limites) {
      console.info(`  ◌ ${l.quoi}`);
      console.info(`      pourquoi : ${l.pourquoi}`);
      console.info(`      vérifiable par : ${l.commande}`);
    }
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
