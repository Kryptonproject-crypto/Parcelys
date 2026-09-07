import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { getBaseUrl, startServer, stopServer, TestClient } from './helpers/server';

/**
 * Rendu des pages.
 *
 * Les tests d'API ne couvrent pas le rendu serveur : une page peut échouer en
 * 500 alors que toutes ses routes répondent correctement — c'est le cas d'un
 * composant client qui touche `window` à l'import et n'est pas exclu du SSR.
 * Cette suite vérifie que chaque page répond 200 et contient bien son contenu.
 */
describe('Rendu des pages', () => {
  let client: TestClient;
  let cookie: string;
  let parcelId: string;

  /** Récupère une page en suivant la session et renvoie son HTML. */
  async function fetchPage(
    path: string,
    authenticated = true,
  ): Promise<{ status: number; html: string; location: string | null }> {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      headers: authenticated ? { Cookie: cookie } : {},
      redirect: 'manual',
    });
    return {
      status: response.status,
      html: await response.text(),
      location: response.headers.get('location'),
    };
  }

  /** Une page rendue sans exception serveur et contenant le texte attendu. */
  async function expectPage(path: string, expectedText: string): Promise<void> {
    const { status, html } = await fetchPage(path);
    expect(status, `${path} — statut HTTP`).toBe(200);
    // Next renvoie cette page générique en cas d'exception non gérée.
    expect(html, `${path} — exception serveur`).not.toContain('server-side exception');
    expect(html, `${path} — contenu`).toContain(expectedText);
  }

  beforeAll(async () => {
    await startServer();
    await resetDatabase();

    const owner = await createUserWithFarm({
      email: 'pages@ferme.test',
      farmName: 'Ferme des Pages',
    });

    client = new TestClient();
    const login = await client.login(owner.email, owner.password);
    cookie =
      login.headers
        .getSetCookie()
        .find((c) => c.startsWith('parcelys_session='))
        ?.split(';')[0] ?? '';
    expect(cookie).not.toBe('');

    // Une parcelle réelle, avec géométrie : les pages qui affichent la carte
    // ne sont exercées que si des données existent.
    const parcel = await client.post<{ id: string }>('/api/parcels', {
      name: 'Parcelle de rendu',
      internalNumber: 'R-01',
      commune: 'Artenay',
      geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
    });
    parcelId = parcel.body.id;

    const crop = await prisma.crop.create({
      data: { farmId: owner.farmId, code: 'BLE', name: 'Blé tendre' },
    });
    await client.post(`/api/parcels/${parcelId}/crops`, {
      cropId: crop.id,
      campaignYear: 2026,
      variety: 'Rubisko',
    });
    await client.post(`/api/parcels/${parcelId}/fertilization`, {
      appliedOn: '2026-02-25',
      inputType: 'MINERAL',
      productLabel: 'Ammonitrate 33,5 %',
      dose: 180,
      doseUnit: 'kg/ha',
    });
    await client.post(`/api/parcels/${parcelId}/phytosanitary`, {
      appliedOn: '2026-03-15',
      productName: 'Produit de test',
      dose: 1.5,
      doseUnit: 'L/ha',
      captureWeather: false,
    });
    await client.post(`/api/parcels/${parcelId}/operations`, {
      performedOn: '2025-09-05',
      type: 'LABOUR',
    });
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  it('affiche les pages publiques', async () => {
    for (const [path, text] of [
      ['/', 'Parcelys'],
      ['/connexion', 'Se connecter'],
      ['/inscription', 'Créer mon compte'],
      ['/mot-de-passe-oublie', 'Mot de passe oublié'],
      ['/verification-email', 'Vérifier mon adresse'],
      ['/cgu', 'Conditions générales'],
      ['/confidentialite', 'confidentialité'],
    ] as const) {
      const { status, html } = await fetchPage(path, false);
      expect(status, `${path} — statut HTTP`).toBe(200);
      expect(html, `${path} — contenu`).toContain(text);
    }
  });

  it('affiche le tableau de bord avec la carte de l’exploitation', async () => {
    await expectPage('/dashboard', 'Tableau de bord');
  });

  it('affiche les parcelles dans les trois vues', async () => {
    await expectPage('/parcelles', 'Parcelle de rendu');
    await expectPage('/parcelles?vue=tableau', 'Superficie');
    await expectPage('/parcelles?vue=carte', 'Carte');
  });

  it('affiche la création et la modification d’une parcelle', async () => {
    await expectPage('/parcelles/nouvelle', 'Dessiner la parcelle');
    await expectPage(`/parcelles/${parcelId}/modifier`, 'Ajuster le contour');
  });

  it('affiche tous les onglets de la fiche parcelle', async () => {
    for (const [onglet, text] of [
      ['general', 'Référence cadastrale'],
      ['culture', 'Campagne'],
      ['apports', 'Bilan des éléments'],
      ['phytosanitaire', 'sources officielles'],
      ['travaux', 'Matériel'],
      ['historique', 'Culture'],
      ['documents', 'document'],
    ] as const) {
      await expectPage(`/parcelles/${parcelId}?onglet=${onglet}`, text);
    }
  });

  it('affiche les pages transverses', async () => {
    for (const [path, text] of [
      ['/cultures', 'assolement'],
      ['/apports', 'Registre des apports'],
      ['/phytosanitaire', 'catalogue officiel'],
      ['/registres', 'Registre des traitements'],
      ['/historique', 'Historique des interventions'],
      ['/documents', 'Documents'],
      ['/exports', 'Que souhaitez-vous exporter'],
      ['/meteo', 'Météo'],
      ['/notifications', 'Notifications'],
      ['/profil', 'Mon profil'],
      ['/parametres', 'Paramètres'],
    ] as const) {
      await expectPage(path, text);
    }
  });

  it('redirige vers la connexion sans session', async () => {
    for (const path of ['/dashboard', '/parcelles', '/profil', '/exports']) {
      const { status, location } = await fetchPage(path, false);
      expect(status, `${path} — statut HTTP`).toBe(307);
      expect(location, `${path} — redirection`).toContain('/connexion');
    }
  });

  it('redirige un utilisateur connecté hors des pages d’authentification', async () => {
    for (const path of ['/', '/connexion', '/inscription']) {
      const { status, location } = await fetchPage(path);
      expect(status, `${path} — statut HTTP`).toBe(307);
      expect(location, `${path} — redirection`).toContain('/dashboard');
    }
  });

  it('autorise les tuiles du fond de carte dans la CSP', async () => {
    const response = await fetch(`${getBaseUrl()}/`, { redirect: 'manual' });
    const csp = response.headers.get('content-security-policy') ?? '';
    const imgSrc = csp.split(';').find((d) => d.trim().startsWith('img-src')) ?? '';

    // Piège corrigé : `*.tile.openstreetmap.org` ne couvre pas l'hôte nu, et
    // sans lui la carte reste vide en production.
    expect(imgSrc).toContain('https://tile.openstreetmap.org');
    // Fond satellite.
    expect(imgSrc).toContain('https://server.arcgisonline.com');
  });

  it('applique le thème avant le premier rendu', async () => {
    const { html } = await fetchPage('/connexion', false);

    // Le script synchrone évite le clignotement clair → sombre au chargement.
    expect(html).toContain("document.documentElement.setAttribute('data-theme'");
    expect(html).toContain('parcelys-theme');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('applique les en-têtes de sécurité', async () => {
    const response = await fetch(`${getBaseUrl()}/`, { redirect: 'manual' });

    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    // L'en-tête révélant la technologie sous-jacente est désactivé.
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
