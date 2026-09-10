import { describe, expect, it } from 'vitest';
import {
  DatagouvError,
  findCandidates,
  getDataset,
  isNewerThan,
  pickResource,
  searchDatasets,
  versionOf,
  type DatagouvDataset,
  type DatagouvResource,
} from '../src/lib/regulatory/datagouv';

/**
 * Client de l'API data.gouv.fr.
 *
 * Les réponses sont **simulées**, avec la structure réelle documentée par
 * data.gouv.fr (septembre 2026) : `{ data, page, page_size, total, next_page,
 * previous_page }` pour une page, et pour une ressource `id, title, format,
 * url, latest, filesize, mime, last_modified`.
 *
 * Simulées, et c'est délibéré : un test qui appellerait vraiment data.gouv.fr
 * échouerait le jour où le service est lent ou en maintenance, ce qui n'aurait
 * rien à voir avec le code testé. Ce qui est vérifié ici, c'est notre lecture
 * du contrat — pas la disponibilité d'un service public.
 */

function ressource(over: Partial<DatagouvResource> = {}): DatagouvResource {
  return {
    id: 'r1',
    title: 'Zones vulnérables 2024',
    description: null,
    format: 'geojson',
    url: 'https://static.data.gouv.fr/resources/zv/20241115/zv.geojson',
    latest: 'https://www.data.gouv.fr/fr/datasets/r/abc-123',
    filesize: 4_200_000,
    mime: 'application/geo+json',
    last_modified: '2024-11-15T09:30:00+00:00',
    ...over,
  };
}

function jeu(over: Partial<DatagouvDataset> = {}): DatagouvDataset {
  return {
    id: '5bbb6d6cff66bd4dc17bfd5a',
    slug: 'zones-vulnerables-nitrates-centre-val-de-loire',
    title: 'Zones vulnérables aux nitrates — Centre-Val de Loire',
    description: null,
    page: 'https://www.data.gouv.fr/datasets/zones-vulnerables-nitrates',
    last_update: '2024-11-15T09:30:00+00:00',
    organization: { id: 'org-1', name: 'DREAL Centre-Val de Loire' },
    license: 'lov2',
    frequency: 'punctual',
    resources: [ressource()],
    ...over,
  };
}

/** `fetch` simulé : rend une réponse et retient l'URL appelée. */
function faussetFetch(corps: unknown, statut = 200) {
  const appels: string[] = [];
  const f = (async (url: string | URL) => {
    appels.push(String(url));
    return {
      ok: statut >= 200 && statut < 300,
      status: statut,
      json: async () => corps,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, appels };
}

describe('API data.gouv.fr', () => {
  // -------------------------------------------------------------------------
  // Contrat de l'API
  // -------------------------------------------------------------------------

  it('interroge la bonne racine avec les paramètres documentés', async () => {
    const { f, appels } = faussetFetch({
      data: [jeu()],
      page: 1,
      page_size: 10,
      total: 1,
      next_page: null,
      previous_page: null,
    });

    const page = await searchDatasets({ query: 'zones vulnérables nitrates' }, f);

    expect(appels[0]).toContain('https://www.data.gouv.fr/api/1/datasets/');
    expect(appels[0]).toContain('q=zones+vuln%C3%A9rables+nitrates');
    expect(appels[0]).toContain('page_size=10');
    expect(page.total).toBe(1);
    expect(page.data[0]?.title).toContain('Centre-Val de Loire');
  });

  it('borne la taille de page, pour ne pas réclamer un listing entier', async () => {
    const { f, appels } = faussetFetch({
      data: [],
      page: 1,
      page_size: 50,
      total: 0,
      next_page: null,
      previous_page: null,
    });
    await searchDatasets({ query: 'test', pageSize: 500 }, f);
    expect(appels[0]).toContain('page_size=50');
  });

  it('lit un jeu par identifiant technique comme par slug', async () => {
    const { f, appels } = faussetFetch(jeu());

    await getDataset('5bbb6d6cff66bd4dc17bfd5a', f);
    expect(appels[0]).toContain('/datasets/5bbb6d6cff66bd4dc17bfd5a/');

    await getDataset('zones-vulnerables-nitrates', f);
    expect(appels[1]).toContain('/datasets/zones-vulnerables-nitrates/');
  });

  it('dit clairement qu’un service public est injoignable', async () => {
    const f = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    await expect(searchDatasets({ query: 'x' }, f)).rejects.toThrow(DatagouvError);
    await expect(searchDatasets({ query: 'x' }, f)).rejects.toThrow(/injoignable/);
    // Et surtout : pas de repli sur une copie locale périmée.
    await expect(searchDatasets({ query: 'x' }, f)).rejects.toThrow(/périmée/);
  });

  it('remonte un code HTTP d’erreur plutôt que de rendre une page vide', async () => {
    const { f } = faussetFetch({}, 503);
    await expect(getDataset('x', f)).rejects.toThrow(/503/);
  });

  /**
   * Constaté en développement : le proxy de l'environnement rend un 403 que
   * l'on peut prendre pour un refus de data.gouv.fr. Or la lecture de cette
   * API ne demande aucune clé — chercher une authentification serait perdre
   * du temps sur une piste inexistante.
   */
  it('oriente vers le proxy plutôt que vers une clé d’API sur un 403', async () => {
    const { f } = faussetFetch({}, 403);
    await expect(getDataset('x', f)).rejects.toThrow(/aucune authentification/);
    await expect(getDataset('x', f)).rejects.toThrow(/proxy ou d’un pare-feu/);
  });

  // -------------------------------------------------------------------------
  // Choix de la ressource
  // -------------------------------------------------------------------------

  it('préfère le format le plus directement exploitable', async () => {
    const dataset = jeu({
      resources: [
        ressource({ id: 'shp', format: 'shp' }),
        ressource({ id: 'geo', format: 'geojson' }),
        ressource({ id: 'zip', format: 'zip' }),
      ],
    });
    // GeoJSON s'importe directement ; le SHP suppose une archive complète.
    expect(pickResource(dataset)?.id).toBe('geo');
  });

  /**
   * Le cas qui compte pour attraper une réédition : deux ressources du même
   * format, dont l'une a été remise à jour sans que le titre change.
   */
  it('retient la ressource la plus récente à format égal', () => {
    const dataset = jeu({
      resources: [
        ressource({ id: 'vieille', last_modified: '2021-03-01T00:00:00+00:00' }),
        ressource({ id: 'recente', last_modified: '2024-11-15T09:30:00+00:00' }),
      ],
    });
    expect(pickResource(dataset)?.id).toBe('recente');
  });

  it('ne se rabat pas sur un format qu’il ne sait pas lire', () => {
    const dataset = jeu({
      resources: [
        ressource({ id: 'pdf', format: 'pdf' }),
        ressource({ id: 'html', format: 'html' }),
      ],
    });
    // Mieux vaut rendre null et laisser choisir que d'importer un PDF.
    expect(pickResource(dataset)).toBeNull();
  });

  it('tolère un format écrit en majuscules ou entouré d’espaces', () => {
    const dataset = jeu({ resources: [ressource({ format: '  GeoJSON ' })] });
    expect(pickResource(dataset)?.format).toBe('  GeoJSON ');
  });

  // -------------------------------------------------------------------------
  // Version
  // -------------------------------------------------------------------------

  it('déduit la version de la date de la ressource', () => {
    expect(versionOf(ressource())).toBe('2024-11-15');
  });

  it('n’invente pas de version quand la date manque', () => {
    // Une version inventée rendrait impossible de savoir quelle édition a
    // servi à classer une parcelle.
    expect(versionOf(ressource({ last_modified: null }))).toBeNull();
    expect(versionOf(ressource({ last_modified: 'pas une date' }))).toBeNull();
  });

  it('repère une édition plus récente que le dernier import', () => {
    const r = ressource({ last_modified: '2024-11-15T09:30:00+00:00' });

    expect(isNewerThan(r, new Date('2024-07-01'))).toBe(true);
    expect(isNewerThan(r, new Date('2025-01-01'))).toBe(false);
    // Jamais importé : tout est plus récent.
    expect(isNewerThan(r, null)).toBe(true);
    // Sans date distante, on ne conclut pas à une nouveauté.
    expect(isNewerThan(ressource({ last_modified: null }), new Date('2020-01-01'))).toBe(
      false,
    );
  });

  // -------------------------------------------------------------------------
  // Découverte
  // -------------------------------------------------------------------------

  it('prépare les candidats sans en choisir un', async () => {
    const { f } = faussetFetch({
      data: [
        jeu({ id: 'a', title: 'Zones vulnérables — Centre-Val de Loire' }),
        jeu({
          id: 'b',
          title: 'Zones vulnérables — Bretagne',
          organization: { id: 'o2', name: 'DREAL Bretagne' },
        }),
      ],
      page: 1,
      page_size: 10,
      total: 2,
      next_page: null,
      previous_page: null,
    });

    const candidats = await findCandidates({ query: 'zones vulnérables nitrates' }, f);

    // Deux régions ressortent : c'est exactement pourquoi le programme ne
    // tranche pas. Choisir « le premier » importerait le zonage breton
    // sur des parcelles de Beauce.
    expect(candidats).toHaveLength(2);
    expect(candidats[0]?.organization).toBe('DREAL Centre-Val de Loire');
    expect(candidats[1]?.organization).toBe('DREAL Bretagne');
    // Chaque candidat porte de quoi décider.
    expect(candidats[0]?.datasetId).toBe('a');
    expect(candidats[0]?.license).toBe('lov2');
    expect(candidats[0]?.resource?.format).toBe('geojson');
  });

  it('explique pourquoi un candidat n’a aucune ressource exploitable', async () => {
    const { f } = faussetFetch({
      data: [
        jeu({
          resources: [
            ressource({ format: 'pdf' }),
            ressource({ id: 'r2', format: 'html' }),
          ],
        }),
      ],
      page: 1,
      page_size: 10,
      total: 1,
      next_page: null,
      previous_page: null,
    });

    const [candidat] = await findCandidates({ query: 'zones vulnérables' }, f);

    expect(candidat?.resource).toBeNull();
    // Les formats présents sont rendus : sans eux, l'utilisateur ne saurait
    // pas si le jeu est inutilisable ou si Parcelys a mal cherché.
    expect(candidat?.availableFormats).toEqual(['pdf', 'html']);
  });

  it('préfère l’URL « latest », qui suit les rééditions', () => {
    const r = ressource();
    // `url` désigne un dépôt figé et daté ; `latest` suit le fichier courant.
    expect(r.url).toContain('20241115');
    expect(r.latest).toContain('/datasets/r/');
  });
});
