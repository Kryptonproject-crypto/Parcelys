/**
 * Client de l'API data.gouv.fr.
 *
 * Contrat vérifié sur la documentation officielle (septembre 2026) :
 *
 *   · racine        https://www.data.gouv.fr/api/1/
 *   · lecture       aucune authentification
 *   · écriture      en-tête `X-API-KEY` — Parcelys ne fait que lire
 *   · pagination    { data, page, page_size, total, next_page, previous_page }
 *   · adressage     par identifiant technique OU par slug
 *
 * ## Pourquoi une découverte, et pas une liste d'URL
 *
 * Deux constats l'imposent, et aucun des deux n'est un détail.
 *
 * **Il n'existe pas de jeu national « zones vulnérables ».** Il en existe des
 * dizaines, par région et par département, avec des millésimes différents
 * (2007, 2015, 2016, 2021…). Coder un identifiant en dur importerait le zonage
 * d'une autre région que la sienne — une erreur silencieuse, qui classerait des
 * parcelles à tort et n'en classerait pas d'autres.
 *
 * **Les slugs changent.** La documentation le dit explicitement : « utilisez
 * les identifiants techniques dans les scripts de production, les slugs peuvent
 * changer ». Un slug écrit dans le code cesse de fonctionner un jour, sans
 * prévenir, et au mieux l'import échoue — au pire il ramène autre chose.
 *
 * Parcelys interroge donc l'API, montre les candidats, et laisse choisir. Le
 * choix retenu est ensuite conservé avec son identifiant technique et sa
 * version.
 */

const RACINE = 'https://www.data.gouv.fr/api/1';

/** Ressource d'un jeu de données, telle que l'API la rend. */
export type DatagouvResource = {
  id: string;
  title: string;
  description: string | null;
  /** `shp`, `geojson`, `csv`, `zip`… tel que déclaré par le producteur. */
  format: string | null;
  url: string;
  /** URL stable pointant toujours la dernière version du fichier. */
  latest: string | null;
  filesize: number | null;
  mime: string | null;
  /** ISO 8601. C'est ce qui sert à repérer une nouvelle édition. */
  last_modified: string | null;
};

export type DatagouvDataset = {
  id: string;
  slug: string;
  title: string;
  /** Description en Markdown, souvent longue. */
  description: string | null;
  page: string | null;
  last_update: string | null;
  organization: { id: string; name: string } | null;
  license: string | null;
  frequency: string | null;
  resources: DatagouvResource[];
};

export type DatagouvPage<T> = {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  next_page: string | null;
  previous_page: string | null;
};

export class DatagouvError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DatagouvError';
  }
}

/**
 * `fetch` injectable.
 *
 * Les tests n'ont pas de réseau — et ne doivent pas en avoir : un test qui
 * dépend de data.gouv.fr échoue le jour où le service est lent, ce qui n'a
 * rien à voir avec le code testé.
 */
export type Fetcher = typeof fetch;

async function lire<T>(chemin: string, fetcher: Fetcher = fetch): Promise<T> {
  const url = `${RACINE}${chemin}`;

  let reponse: Response;
  try {
    reponse = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Parcelys/referentiels' },
      redirect: 'follow',
    });
  } catch (erreur) {
    throw new DatagouvError(
      `data.gouv.fr injoignable : ${erreur instanceof Error ? erreur.message : 'erreur réseau'}. ` +
        'Vérifiez la connexion de la machine — Parcelys ne travaille pas avec une copie locale périmée.',
    );
  }

  if (!reponse.ok) {
    // La lecture de l'API ne demande aucune authentification : un 401 ou un
    // 403 ne vient donc presque jamais de data.gouv.fr, mais d'un proxy ou
    // d'un pare-feu sur le chemin. Le dire évite de chercher une clé d'API
    // qui n'existe pas.
    const intermediaire =
      reponse.status === 403 || reponse.status === 401
        ? ' La lecture de cette API ne demande aucune authentification : ' +
          'ce refus vient probablement d’un proxy ou d’un pare-feu entre cette ' +
          'machine et data.gouv.fr, pas du service lui-même.'
        : '';

    throw new DatagouvError(
      `data.gouv.fr a répondu ${reponse.status} pour ${chemin}.${intermediaire}`,
      reponse.status,
    );
  }

  return (await reponse.json()) as T;
}

/**
 * Recherche des jeux de données.
 *
 * `organization` filtre par producteur, ce qui compte plus qu'il n'y paraît :
 * une recherche « zones vulnérables » ramène aussi bien des DREAL que des
 * réutilisations associatives, et seule la source officielle fait référence.
 */
export async function searchDatasets(
  params: {
    query: string;
    pageSize?: number;
    page?: number;
    organization?: string;
  },
  fetcher: Fetcher = fetch,
): Promise<DatagouvPage<DatagouvDataset>> {
  const recherche = new URLSearchParams({
    q: params.query,
    page_size: String(Math.min(params.pageSize ?? 10, 50)),
    page: String(params.page ?? 1),
  });
  if (params.organization) recherche.set('organization', params.organization);

  return lire<DatagouvPage<DatagouvDataset>>(
    `/datasets/?${recherche.toString()}`,
    fetcher,
  );
}

/** Un jeu de données, par identifiant technique ou par slug. */
export async function getDataset(
  idOrSlug: string,
  fetcher: Fetcher = fetch,
): Promise<DatagouvDataset> {
  return lire<DatagouvDataset>(`/datasets/${encodeURIComponent(idOrSlug)}/`, fetcher);
}

/** Formats que Parcelys sait lire pour un zonage, du plus commode au moins. */
export const FORMATS_ZONAGE = ['geojson', 'json', 'shp', 'zip'] as const;

/**
 * Retient la ressource la plus exploitable d'un jeu de données.
 *
 * L'ordre des formats n'est pas indifférent : le GeoJSON s'importe directement,
 * le Shapefile suppose une archive complète (.shp/.dbf/.shx/.prj), et un `zip`
 * peut contenir n'importe quoi. On préfère donc le plus simple, et à format
 * égal la ressource **la plus récemment modifiée** — c'est la seule façon
 * d'attraper une réédition d'un jeu dont le titre n'a pas bougé.
 *
 * Renvoie `null` plutôt qu'un pis-aller quand aucun format n'est exploitable :
 * l'appelant le dit à l'utilisateur, qui choisira la ressource lui-même.
 */
export function pickResource(
  dataset: DatagouvDataset,
  formats: readonly string[] = FORMATS_ZONAGE,
): DatagouvResource | null {
  const normalise = (f: string | null): string => (f ?? '').trim().toLowerCase();

  for (const format of formats) {
    const candidates = dataset.resources.filter((r) => normalise(r.format) === format);
    if (candidates.length === 0) continue;

    return [...candidates].sort((a, b) => {
      const da = a.last_modified ? Date.parse(a.last_modified) : 0;
      const db = b.last_modified ? Date.parse(b.last_modified) : 0;
      return db - da;
    })[0] as DatagouvResource;
  }

  return null;
}

/**
 * Version déduite d'une ressource.
 *
 * On prend la date de dernière modification, au jour : c'est ce qui distingue
 * deux éditions d'un même jeu, et cela reste lisible dans le centre des
 * référentiels (« zones-vulnerables, version 2024-11-15 »).
 *
 * À défaut de date, on ne fabrique rien : l'appelant réclamera `--version`.
 * Une version inventée rendrait impossible de savoir quelle édition a servi à
 * classer une parcelle.
 */
export function versionOf(resource: DatagouvResource): string | null {
  if (!resource.last_modified) return null;
  const date = new Date(resource.last_modified);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Résultat d'une découverte, prêt à afficher. */
export type Candidate = {
  datasetId: string;
  slug: string;
  title: string;
  organization: string | null;
  page: string | null;
  license: string | null;
  lastUpdate: string | null;
  resource: DatagouvResource | null;
  /** Formats présents, pour comprendre pourquoi aucune ressource n'a été retenue. */
  availableFormats: string[];
};

/**
 * Cherche les jeux candidats pour un référentiel, et prépare le choix.
 *
 * **Ne choisit pas à la place de l'utilisateur.** Une recherche « zones
 * vulnérables » ramène des dizaines de jeux régionaux ; en retenir un
 * automatiquement reviendrait à tirer au sort le zonage d'une région. Le CLI
 * affiche les candidats, l'humain tranche, et l'identifiant retenu est
 * conservé.
 */
export async function findCandidates(
  params: {
    query: string;
    formats?: readonly string[];
    organization?: string;
    limit?: number;
  },
  fetcher: Fetcher = fetch,
): Promise<Candidate[]> {
  const page = await searchDatasets(
    {
      query: params.query,
      pageSize: params.limit ?? 10,
      ...(params.organization ? { organization: params.organization } : {}),
    },
    fetcher,
  );

  return page.data.map((dataset) => ({
    datasetId: dataset.id,
    slug: dataset.slug,
    title: dataset.title,
    organization: dataset.organization?.name ?? null,
    page: dataset.page,
    license: dataset.license,
    lastUpdate: dataset.last_update,
    resource: pickResource(dataset, params.formats ?? FORMATS_ZONAGE),
    availableFormats: [
      ...new Set(
        dataset.resources
          .map((r) => (r.format ?? '').trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
  }));
}

/**
 * Une édition plus récente est-elle disponible ?
 *
 * Compare la date de la ressource distante à celle de l'import en base. Sert au
 * contrôle périodique : prévenir qu'un zonage a été réédité, sans jamais le
 * remplacer tout seul. Un référentiel qui changerait sans qu'on le sache
 * modifierait rétroactivement le classement de parcelles déjà déclarées.
 */
export function isNewerThan(
  resource: DatagouvResource,
  importedAt: Date | null,
): boolean {
  if (!importedAt) return true;
  if (!resource.last_modified) return false;
  const distante = Date.parse(resource.last_modified);
  return Number.isFinite(distante) && distante > importedAt.getTime();
}
