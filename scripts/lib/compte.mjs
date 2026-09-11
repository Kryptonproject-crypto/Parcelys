/**
 * Le compte de démonstration existe-t-il, et peut-il se connecter ?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Huit vérifications au navigateur ouvrent `/connexion`, saisissent le compte
 * de démonstration, et attendent la redirection vers `/dashboard`. Quand le
 * compte n'existe pas — ou que son mot de passe a changé, ou que le limiteur de
 * débit a fermé la porte —, la redirection ne vient jamais, et la vérification
 * s'arrête au bout de trente secondes sur :
 *
 *     page.waitForURL: Timeout 30000ms exceeded.
 *     waiting for navigation to "**\/dashboard" until "load"
 *
 * Ce message ne dit ni ce qui manque, ni quoi faire. Il ressemble même à une
 * lenteur de l'application, alors que l'application n'est pas en cause.
 *
 * Le cas est banal : la suite de tests vide la base à chaque exécution
 * (`resetDatabase`). Lancer `npm test` puis une vérification au navigateur
 * suffit donc à effacer le compte que celle-ci attend. C'est arrivé pendant
 * l'audit 0.9.5.
 *
 * Une question posée à l'API avant d'ouvrir le navigateur répond en quelques
 * millisecondes et sait dire lequel des trois cas on est.
 */

/**
 * Vérifie la connexion par l'API, et s'arrête avec une explication utile si
 * elle échoue. Rend le corps de la réponse en cas de succès.
 */
export async function verifierCompte(base, email, motDePasse) {
  let reponse;
  try {
    reponse = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: motDePasse }),
    });
  } catch (cause) {
    arreter(
      `le serveur ne répond pas sur ${base}`,
      'Démarrez-le : bash scripts/audit-serveur.sh',
      cause.message,
    );
    return null;
  }

  if (reponse.ok) return reponse.json().catch(() => ({}));

  const corps = await reponse.text();
  const code = extraireCode(corps);

  if (reponse.status === 429 || /RATE_LIMIT/i.test(code)) {
    arreter(
      `le limiteur de débit refuse la connexion de ${email}`,
      'Remettez les compteurs à zéro : npm run audit:debit',
      `HTTP ${reponse.status}`,
    );
  } else if (reponse.status === 401) {
    arreter(
      `le compte ${email} n’existe pas, ou son mot de passe a changé`,
      'Recréez le jeu de démonstration : npm run db:seed\n' +
        '  (la suite de tests vide la base — relancez le seed après « npm test »)',
      `HTTP ${reponse.status}`,
    );
  } else {
    arreter(
      `la connexion de ${email} a échoué`,
      'Regardez le journal du serveur : /tmp/parcelys-audit-serveur.log',
      `HTTP ${reponse.status} ${corps.slice(0, 200)}`,
    );
  }
  return null;
}

function extraireCode(corps) {
  try {
    return JSON.parse(corps)?.error?.code ?? '';
  } catch {
    return '';
  }
}

function arreter(quoi, remede, detail) {
  console.error(`\n✗ ${quoi}`);
  if (detail) console.error(`  ${detail}`);
  console.error(`\n  → ${remede}\n`);
  process.exit(1);
}
