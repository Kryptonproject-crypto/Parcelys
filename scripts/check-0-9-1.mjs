/**
 * Ce que la version 0.9.1 promet, vérifié au navigateur.
 *
 *   npm run check:091
 *
 * Les contrôles génériques (`check:pages`, `check:modales`, `check:security`)
 * disent que les pages tiennent et que le cloisonnement tient. Ils ne disent
 * rien de ce que cette version-ci a ajouté : chercher « cote » et trouver
 * « La Côte », renommer une parcelle sans passer par l'assistant, lire la
 * période de la campagne affichée, effacer définitivement une exploitation.
 *
 * Ces quatre-là se vérifient en les faisant, dans un vrai navigateur, contre un
 * vrai serveur. Un test qui appellerait l'API ne verrait pas qu'un bouton
 * manque, ni qu'un champ n'est pas atteignable.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@parcelys.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo1234!';

let echecs = 0;

function attendu(condition, quoi, detail = '') {
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
  if (!condition) {
    echecs += 1;
    process.exitCode = 1;
  }
}

async function connecter(page) {
  await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|parcelles)/, { timeout: 20_000 });
}

async function main() {
  const navigateur = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? undefined,
  });
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await connecter(page);

    /*
     * --- 1. Renommer, puis retrouver par ce nom -------------------------
     *
     * L'essai pose lui-même l'état dont il a besoin, plutôt que de compter
     * sur ce que le seed a laissé. Une première version renommait une parcelle
     * préparée à l'avance : elle passait une fois, puis échouait à la seconde
     * puisqu'elle avait changé le nom qu'elle cherchait. Un contrôle qu'on ne
     * peut pas relancer ne sert qu'une fois.
     *
     * Au passage, c'est le parcours de Kevin, dans l'ordre : l'import nomme
     * « Îlot 39 — parcelle 3 », on renomme, on retrouve par le nom donné.
     */
    await page.goto(`${BASE}/parcelles`, { waitUntil: 'domcontentloaded' });
    await page.click('main a[href^="/parcelles/c"]');
    await page.waitForURL(/\/parcelles\/[^/?]+/, { timeout: 20_000 });
    const fiche = page.url().split('?')[0];

    async function renommer(nom, lieuDit) {
      await page.goto(fiche, { waitUntil: 'domcontentloaded' });
      await page.click('button:has-text("Renommer")');
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
      await page.fill('#renommer-nom', nom);
      if (lieuDit !== undefined) await page.fill('#renommer-lieu', lieuDit);
      await page.click('[role="dialog"] button:has-text("Enregistrer")');
      await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 15_000 });
      await page.waitForTimeout(1200);
    }

    const boutonRenommer = await page.$('button:has-text("Renommer")');
    attendu(boutonRenommer !== null, 'la fiche parcelle offre « Renommer »');

    await renommer('La Côte du Chêne', 'Les Sauvattes');
    attendu(
      (await page.textContent('h1')).includes('La Côte du Chêne'),
      'le nom donné est enregistré et affiché',
      await page.textContent('h1'),
    );

    await page.goto(`${BASE}/parcelles?q=cote`, { waitUntil: 'domcontentloaded' });
    attendu(
      (await page.textContent('body')).includes('La Côte du Chêne'),
      'la recherche « cote », sans accent, trouve « La Côte du Chêne »',
    );

    await page.goto(`${BASE}/parcelles?q=CHENE`, { waitUntil: 'domcontentloaded' });
    attendu(
      (await page.textContent('body')).includes('La Côte du Chêne'),
      'ni la casse ni l’accent ne font échouer la recherche',
    );

    await page.goto(`${BASE}/parcelles?q=sauvattes`, { waitUntil: 'domcontentloaded' });
    attendu(
      (await page.textContent('body')).includes('La Côte du Chêne'),
      'la recherche porte aussi sur le lieu-dit',
    );

    await page.goto(`${BASE}/parcelles?q=betterave-qui-nexiste-pas`, {
      waitUntil: 'domcontentloaded',
    });
    attendu(
      !(await page.textContent('body')).includes('La Côte du Chêne'),
      'un terme sans correspondance ne rend pas la parcelle',
    );

    await renommer('La Croix Rouge');
    await page.goto(`${BASE}/parcelles?q=croix`, { waitUntil: 'domcontentloaded' });
    attendu(
      (await page.textContent('body')).includes('La Croix Rouge'),
      'un nouveau nom se retrouve tout de suite par la recherche',
    );

    // --- 2. La campagne affichée dit sa période -------------------------
    await page.goto(`${BASE}/parcelles`, { waitUntil: 'domcontentloaded' });
    const texteListe = await page.textContent('body');
    attendu(
      /1ᵉʳ août \d{4} → 31 juillet \d{4}/.test(texteListe),
      'la période de la campagne est écrite sous le sélecteur',
      (texteListe.match(/1ᵉʳ août \d{4} → 31 juillet \d{4}/) ?? [''])[0],
    );
    const options = await page.$$eval('select#annee option', (n) => n.map((o) => o.textContent));
    attendu(
      options.some((o) => /culture\(s\)|vide/.test(o ?? '')),
      'chaque campagne proposée dit ce qu’elle contient',
      (options[0] ?? '').trim(),
    );

    // --- 3. La page PAC accepte le XML et dit sa campagne ---------------
    await page.goto(`${BASE}/pac`, { waitUntil: 'domcontentloaded' });
    const accept = await page.getAttribute('#pac-files', 'accept');
    attendu(
      (accept ?? '').includes('.xml'),
      'le dépôt PAC accepte l’export XML de TéléPAC',
      accept ?? '(aucun)',
    );
    attendu(
      /1ᵉʳ août \d{4} → 31 juillet \d{4}/.test(await page.textContent('body')),
      'la page PAC dit la période de la campagne qu’elle affiche',
    );

    /*
     * --- 4. L'effacement définitif n'est offert qu'après suppression ----
     *
     * Le contrôle porte **ligne par ligne**, et non sur le texte de la page :
     * la liste montre les exploitations actives et les supprimées ensemble, et
     * une première version de cet essai cherchait « Effacer définitivement »
     * dans la page entière. Elle échouait dès qu'une exploitation supprimée s'y
     * trouvait — c'est-à-dire quand le bouton était exactement là où il devait
     * être. Un contrôle qui se trompe de cible ne protège rien.
     */
    await page.goto(`${BASE}/administration/exploitations`, { waitUntil: 'domcontentloaded' });

    const lignes = await page.$$eval('tbody tr', (rangs) =>
      rangs.map((rang) => ({
        texte: rang.textContent ?? '',
        boutons: [...rang.querySelectorAll('button')].map((b) => b.textContent ?? ''),
      })),
    );
    attendu(lignes.length > 0, 'la liste des exploitations est affichée', `${lignes.length} ligne(s)`);

    // Une exploitation active porte « Supprimer » et rien d'autre : on ne peut
    // pas effacer définitivement en un seul geste depuis la liste.
    const actives = lignes.filter((l) => l.boutons.some((b) => b.includes('Supprimer')));
    attendu(
      actives.length > 0 &&
        actives.every((l) => !l.boutons.some((b) => b.includes('Effacer définitivement'))),
      'une exploitation active n’offre que la suppression réversible',
      `${actives.length} exploitation(s) active(s)`,
    );

    // Une exploitation déjà supprimée porte les deux : la rétablir, ou tout effacer.
    const supprimees = lignes.filter((l) => l.boutons.some((b) => b.includes('Rétablir')));
    attendu(
      supprimees.length === 0 ||
        supprimees.every((l) => l.boutons.some((b) => b.includes('Effacer définitivement'))),
      'une exploitation supprimée offre le rétablissement et l’effacement définitif',
      `${supprimees.length} exploitation(s) supprimée(s)`,
    );

    // Et l'écran d'effacement exige le nom retapé : le bouton reste inerte
    // tant que la saisie ne correspond pas.
    if (supprimees.length > 0) {
      await page.click('button:has-text("Effacer définitivement")');
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
      const inerte = await page.isDisabled(
        '[role="dialog"] button:has-text("Effacer définitivement")',
      );
      attendu(inerte, 'le bouton d’effacement reste inerte tant que le nom n’est pas retapé');

      await page.fill('#purge-confirmation', 'nom qui ne correspond pas');
      attendu(
        await page.isDisabled('[role="dialog"] button:has-text("Effacer définitivement")'),
        'un nom approchant ne suffit pas non plus',
      );
    }
  } finally {
    await navigateur.close();
  }

  console.info(`\n${echecs === 0 ? '✓' : '✗'} version 0.9.1 : ${echecs} écart(s).`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
