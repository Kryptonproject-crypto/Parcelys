/**
 * Lecture d'un service WFS.
 *
 * ## Pourquoi c'est indispensable, et pas un raffinement
 *
 * Les DREAL publient leurs zonages **en services web bien plus souvent qu'en
 * fichiers**. Le cas rencontré en Auvergne-Rhône-Alpes est représentatif :
 *
 *   · zones vulnérables 2021 → `wms`, `wfs`
 *   · zones vulnérables 2017 → `mapinfo tab`
 *
 * Ni l'un ni l'autre n'était importable par la première version, qui n'attendait
 * que du GeoJSON ou du Shapefile. Autrement dit : un exploitant de cette région
 * ne pouvait pas importer le zonage de sa propre région. Ce n'était pas une
 * limite acceptable, c'était un défaut.
 *
 * ## WMS et WFS ne sont pas la même chose
 *
 * Confusion fréquente, et lourde de conséquences ici :
 *
 *   · **WMS** rend des *images* — une carte déjà dessinée. On ne peut pas
 *     croiser une image avec une parcelle. Inutilisable pour un calcul de
 *     surface, et Parcelys le dit plutôt que d'essayer.
 *   · **WFS** rend des *entités* — des géométries et leurs attributs. C'est
 *     exactement ce qu'il faut, et souvent directement en GeoJSON.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne devine pas la couche à importer. Un service WFS de DREAL en expose
 * couramment plusieurs — zones vulnérables, ZAR, communes — et en choisir une
 * au hasard importerait le mauvais zonage sans que rien ne le signale. Les
 * couches sont listées, l'humain choisit.
 */

export type WfsLayer = {
  /** Nom technique, à passer en `typeNames`. */
  name: string;
  title: string;
  abstract: string | null;
  /** Systèmes de coordonnées annoncés par le service. */
  crs: string[];
};

export type WfsCapabilities = {
  /** Version annoncée : « 2.0.0 », « 1.1.0 »… */
  version: string;
  title: string | null;
  layers: WfsLayer[];
  /** Formats de sortie annoncés pour GetFeature. */
  outputFormats: string[];
  /** Un format rendant du GeoJSON est-il disponible ? */
  geojsonFormat: string | null;
};

export class WfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WfsError';
  }
}

export type Fetcher = typeof fetch;

/**
 * Formats de sortie rendant du GeoJSON, par ordre de préférence.
 *
 * Les serveurs ne les nomment pas tous pareil : GeoServer annonce
 * `application/json` et `application/geo+json`, MapServer `geojson`, d'autres
 * `json`. On les cherche tous plutôt que d'en supposer un.
 */
const FORMATS_GEOJSON = [
  'application/geo+json',
  'application/json',
  'geojson',
  'json',
];

/** Ajoute des paramètres à une URL sans écraser ceux qu'elle porte déjà. */
function avecParametres(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  // Les URL de service portent souvent déjà `SERVICE=WFS` ou un chemin `/ows`.
  // On remplace en insensible à la casse : `REQUEST` et `request` coexistent
  // selon les serveurs, et en laisser deux produit une requête ambiguë.
  for (const [cle, valeur] of Object.entries(params)) {
    for (const existante of [...url.searchParams.keys()]) {
      if (existante.toLowerCase() === cle.toLowerCase()) {
        url.searchParams.delete(existante);
      }
    }
    url.searchParams.set(cle, valeur);
  }
  return url.toString();
}

async function lireTexte(url: string, fetcher: Fetcher): Promise<string> {
  let reponse: Response;
  try {
    reponse = await fetcher(url, {
      headers: { 'User-Agent': 'Parcelys/referentiels' },
      redirect: 'follow',
    });
  } catch (erreur) {
    throw new WfsError(
      `Service WFS injoignable : ${erreur instanceof Error ? erreur.message : 'erreur réseau'}`,
    );
  }
  if (!reponse.ok) {
    throw new WfsError(`Le service WFS a répondu ${reponse.status}.`);
  }
  return reponse.text();
}

/**
 * Version WFS réellement annoncée par le service.
 *
 * ## Le piège, et il coûte cher
 *
 * Tout GetCapabilities commence par `<?xml version="1.0" encoding="UTF-8"?>`.
 * Chercher le premier `version="…"` du document ramène donc **la version de
 * XML**, pas celle de WFS — et toujours « 1.0 », quel que soit le service.
 *
 * Les conséquences ne sont pas cosmétiques. Parcelys en aurait déduit un
 * service d'avant la 2.0.0, donc :
 *
 *   · `typeName` et `maxFeatures` au lieu de `typeNames` et `count` — refusé
 *     par les serveurs stricts ;
 *   · **aucune pagination**, la boucle s'arrêtant après la première page pour
 *     les versions antérieures à la 2.
 *
 * Un zonage régional de 8 000 polygones se serait importé « avec succès » à
 * 1 000 polygones. Des parcelles seraient ressorties hors zone vulnérable
 * alors qu'elles y sont, sans qu'aucun message ne le signale. C'est le genre
 * d'erreur qu'on ne découvre qu'au contrôle.
 *
 * On lit donc l'attribut porté par l'élément racine `WFS_Capabilities`, et à
 * défaut le `ServiceTypeVersion` annoncé dans l'identification du service — en
 * retenant la plus élevée quand plusieurs sont proposées, puisque le service
 * les gère toutes et que la 2.0.0 pagine.
 */
function lireVersion(xml: string): string {
  const racine = /<(?:\w+:)?WFS_Capabilities\s[^>]*?\bversion\s*=\s*["']([\d.]+)["']/i
    .exec(xml)?.[1];
  if (racine) return racine;

  const annoncees = [
    ...xml.matchAll(/<(?:ows:)?ServiceTypeVersion(?:\s[^>]*)?>([\s\S]*?)<\//gi),
  ]
    .map((m) => m[1]?.trim())
    .filter((v): v is string => Boolean(v && /^\d+(\.\d+)*$/.test(v)));

  if (annoncees.length > 0) {
    return [...annoncees].sort(comparerVersions).at(-1) as string;
  }

  // À défaut, on suppose 1.1.0 : le plus petit dénominateur commun, et le code
  // adapte ensuite les noms de paramètres.
  return '1.1.0';
}

/** Ordre naturel des versions : 1.9.0 précède 2.0.0, contrairement à l'ordre texte. */
function comparerVersions(a: string, b: string): number {
  const ma = a.split('.').map(Number);
  const mb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ma.length, mb.length); i += 1) {
    const diff = (ma[i] ?? 0) - (mb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Extraction des couches et formats depuis un GetCapabilities.
 *
 * Analyse par expressions régulières plutôt que par un analyseur XML complet,
 * et c'est un choix assumé : ajouter une dépendance XML pour lire un document
 * dont on n'exploite que trois balises ne se justifie pas sur un Raspberry Pi.
 *
 * La limite est réelle et connue : les préfixes de namespace varient
 * (`wfs:FeatureType`, `FeatureType`), on les accepte tous. En revanche, si le
 * document ne correspond à rien de reconnaissable, on ne rend pas une liste
 * vide — on lève une erreur. Une liste vide se lirait « ce service n'expose
 * aucune couche », ce qui serait faux.
 */
export function parseCapabilities(xml: string): WfsCapabilities {
  if (!/WFS_Capabilities|FeatureTypeList/i.test(xml)) {
    // Un service en erreur renvoie souvent un ExceptionReport, en HTTP 200.
    const exception = /<(?:ows:)?ExceptionText[^>]*>([\s\S]*?)<\//i.exec(xml);
    throw new WfsError(
      exception?.[1]
        ? `Le service a renvoyé une erreur : ${exception[1].trim()}`
        : 'La réponse n’est pas un document GetCapabilities WFS.',
    );
  }

  const version = lireVersion(xml);

  const title =
    /<(?:ows:)?Title(?:\s[^>]*)?>([\s\S]*?)<\//i.exec(xml)?.[1]?.trim() ?? null;

  const layers: WfsLayer[] = [];
  const blocs = xml.matchAll(/<(?:\w+:)?FeatureType[^>]*>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi);

  for (const bloc of blocs) {
    const contenu = bloc[1] ?? '';
    const name = /<(?:\w+:)?Name[^>]*>([\s\S]*?)<\//i.exec(contenu)?.[1]?.trim();
    if (!name) continue;

    layers.push({
      name,
      title: /<(?:\w+:)?Title[^>]*>([\s\S]*?)<\//i.exec(contenu)?.[1]?.trim() ?? name,
      abstract:
        /<(?:\w+:)?Abstract[^>]*>([\s\S]*?)<\//i.exec(contenu)?.[1]?.trim() ?? null,
      crs: [
        ...new Set(
          [...contenu.matchAll(/<(?:\w+:)?(?:DefaultCRS|DefaultSRS|OtherCRS|OtherSRS)[^>]*>([\s\S]*?)<\//gi)]
            .map((m) => m[1]?.trim())
            .filter((v): v is string => Boolean(v)),
        ),
      ],
    });
  }

  // Formats de sortie : déclarés dans l'opération GetFeature.
  const outputFormats = [
    ...new Set(
      [...xml.matchAll(/<(?:ows:)?Value[^>]*>([\s\S]*?)<\//gi)]
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v))
        .filter((v) => v.includes('/') || /json|gml|csv|shape/i.test(v)),
    ),
  ];

  const geojsonFormat =
    FORMATS_GEOJSON.find((attendu) =>
      outputFormats.some((f) => f.toLowerCase() === attendu),
    ) ??
    outputFormats.find((f) => /geo\+json|geojson/i.test(f)) ??
    outputFormats.find((f) => /json/i.test(f)) ??
    null;

  return { version, title, layers, outputFormats, geojsonFormat };
}

/** Interroge le service et rend ce qu'il expose. */
export async function describeWfs(
  serviceUrl: string,
  fetcher: Fetcher = fetch,
): Promise<WfsCapabilities> {
  const url = avecParametres(serviceUrl, {
    SERVICE: 'WFS',
    REQUEST: 'GetCapabilities',
  });
  return parseCapabilities(await lireTexte(url, fetcher));
}

/** Une page de résultats GeoJSON. */
type PageGeoJSON = {
  type?: string;
  features?: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown> | null;
  }>;
  numberMatched?: number;
  numberReturned?: number;
};

export type WfsFetchResult = {
  features: NonNullable<PageGeoJSON['features']>;
  /** Total annoncé par le service, quand il le dit. */
  total: number | null;
  /** Version et format réellement employés, pour la traçabilité. */
  version: string;
  outputFormat: string;
  typeName: string;
};

/**
 * Récupère toutes les entités d'une couche, page par page.
 *
 * La pagination n'est pas une optimisation : un zonage régional compte des
 * milliers de polygones, et beaucoup de serveurs plafonnent silencieusement une
 * requête sans limite. Sans pagination, on importerait « les 1 000 premiers »
 * en croyant tout avoir — et des parcelles ressortiraient hors zone alors
 * qu'elles y sont.
 *
 * Les noms de paramètres diffèrent selon la version, et c'est la source
 * d'erreur la plus commune : `typeNames`/`count` en 2.0.0, `typeName`/
 * `maxFeatures` avant. On envoie ceux de la version annoncée par le service.
 */
export async function fetchWfsFeatures(
  params: {
    serviceUrl: string;
    typeName: string;
    version?: string;
    outputFormat?: string;
    /** Taille de page. 1 000 est un compromis usuel. */
    pageSize?: number;
    /** Garde-fou : au-delà, on s'arrête et on le dit. */
    maxFeatures?: number;
    onProgress?: (recues: number, total: number | null) => void;
  },
  fetcher: Fetcher = fetch,
): Promise<WfsFetchResult> {
  const version = params.version ?? '2.0.0';
  const deuxPointZero = version.startsWith('2');
  const outputFormat = params.outputFormat ?? 'application/json';
  const pageSize = params.pageSize ?? 1000;
  const maxFeatures = params.maxFeatures ?? 200_000;

  const features: NonNullable<PageGeoJSON['features']> = [];
  let total: number | null = null;
  let debut = 0;

  for (;;) {
    const url = avecParametres(params.serviceUrl, {
      SERVICE: 'WFS',
      VERSION: version,
      REQUEST: 'GetFeature',
      [deuxPointZero ? 'typeNames' : 'typeName']: params.typeName,
      outputFormat,
      // On demande du 4326 au service : sa reprojection vaut mieux que la
      // nôtre, il connaît le système d'origine de ses propres données.
      srsName: 'EPSG:4326',
      [deuxPointZero ? 'count' : 'maxFeatures']: String(pageSize),
      ...(deuxPointZero ? { startIndex: String(debut) } : {}),
    });

    const brut = await lireTexte(url, fetcher);

    let page: PageGeoJSON;
    try {
      page = JSON.parse(brut) as PageGeoJSON;
    } catch {
      // Un serveur qui ne sait pas rendre le format demandé répond souvent en
      // XML — un ExceptionReport, ou du GML. Le dire précisément vaut mieux
      // qu'un « JSON invalide » qui n'oriente vers rien.
      const exception = /<(?:ows:)?ExceptionText[^>]*>([\s\S]*?)<\//i.exec(brut);
      throw new WfsError(
        exception?.[1]
          ? `Le service a refusé la requête : ${exception[1].trim()}`
          : `Le service n’a pas rendu de GeoJSON pour « ${outputFormat} ». ` +
            'Vérifiez les formats annoncés par son GetCapabilities.',
      );
    }

    const lot = page.features ?? [];
    if (typeof page.numberMatched === 'number') total = page.numberMatched;
    features.push(...lot);
    params.onProgress?.(features.length, total);

    // Trois façons d'être arrivé au bout, et il faut les trois : une page
    // incomplète, une page vide, ou un service sans pagination qui renverrait
    // indéfiniment la même chose.
    if (lot.length === 0 || lot.length < pageSize || !deuxPointZero) break;
    if (features.length >= maxFeatures) {
      throw new WfsError(
        `Plus de ${maxFeatures.toLocaleString('fr-FR')} entités : import interrompu. ` +
          'Restreignez la couche, ou téléchargez le fichier complet auprès du producteur.',
      );
    }
    debut += lot.length;
  }

  return { features, total, version, outputFormat, typeName: params.typeName };
}

/**
 * Le format d'une ressource désigne-t-il un service, et lequel ?
 *
 * Sert à orienter l'import : un WFS se lit, un WMS ne se lit pas — et un
 * MapInfo TAB n'est pas un service du tout, mais un format que Parcelys ne
 * sait pas ouvrir. Les trois méritent des messages différents.
 */
export function classifyResourceFormat(
  format: string | null,
): 'wfs' | 'wms' | 'fichier' | 'illisible' {
  const f = (format ?? '').trim().toLowerCase();
  if (f === 'wfs' || f.includes('wfs')) return 'wfs';
  if (f === 'wms' || f.includes('wms')) return 'wms';
  if (['geojson', 'json', 'shp', 'zip', 'csv', 'xlsx'].includes(f)) return 'fichier';
  return 'illisible';
}

/** Ce qu'on peut dire d'un format qu'on ne sait pas lire. */
export function explainFormat(format: string | null): string {
  const f = (format ?? '').trim().toLowerCase();

  if (f.includes('wms')) {
    return (
      'WMS rend des images de carte, pas des géométries : on ne peut pas croiser ' +
      'une image avec une parcelle. Cherchez le service WFS équivalent, que le ' +
      'même producteur publie presque toujours.'
    );
  }
  if (f.includes('mapinfo') || f === 'tab' || f === 'mif') {
    return (
      'MapInfo TAB/MIF n’est pas lu par Parcelys. Demandez au producteur une ' +
      'version GeoJSON ou Shapefile, ou utilisez son service WFS s’il en publie un.'
    );
  }
  if (f === 'pdf' || f === 'html') {
    return 'Ce format est un document, pas une donnée géographique exploitable.';
  }
  return `Format « ${format ?? 'non précisé'} » non exploitable par Parcelys.`;
}
