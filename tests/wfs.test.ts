import { describe, expect, it } from 'vitest';
import {
  WfsError,
  classifyResourceFormat,
  describeWfs,
  explainFormat,
  fetchWfsFeatures,
  parseCapabilities,
} from '../src/lib/regulatory/wfs';

/**
 * Lecture d'un service WFS.
 *
 * Ce que ces tests protègent : **un exploitant doit pouvoir importer le zonage
 * de sa propre région**. Le cas rencontré en Auvergne-Rhône-Alpes l'a montré —
 * les deux jeux publiés par la DREAL n'étaient disponibles qu'en `wms`, `wfs`
 * et `mapinfo tab`, et la première version concluait « aucune ressource
 * exploitable ». Le zonage existait, Parcelys ne savait pas le lire.
 *
 * Les documents ci-dessous reproduisent la forme réelle d'un GetCapabilities
 * GeoServer, préfixes de namespace compris.
 */

const CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:ows="http://www.opengis.net/ows/1.1">
  <ows:ServiceIdentification>
    <ows:Title>DREAL Auvergne-Rhône-Alpes — Nitrates</ows:Title>
  </ows:ServiceIdentification>
  <ows:OperationsMetadata>
    <ows:Operation name="GetFeature">
      <ows:Parameter name="outputFormat">
        <ows:AllowedValues>
          <ows:Value>text/xml; subtype=gml/3.2</ows:Value>
          <ows:Value>application/json</ows:Value>
          <ows:Value>csv</ows:Value>
        </ows:AllowedValues>
      </ows:Parameter>
    </ows:Operation>
  </ows:OperationsMetadata>
  <FeatureTypeList>
    <FeatureType>
      <Name>nitrates:zones_vulnerables_2021</Name>
      <Title>Zones vulnérables 2021</Title>
      <Abstract>Zones vulnérables à la pollution par les nitrates d'origine agricole.</Abstract>
      <DefaultCRS>urn:ogc:def:crs:EPSG::2154</DefaultCRS>
      <OtherCRS>urn:ogc:def:crs:EPSG::4326</OtherCRS>
    </FeatureType>
    <FeatureType>
      <Name>nitrates:zones_actions_renforcees</Name>
      <Title>Zones d'actions renforcées</Title>
      <DefaultCRS>urn:ogc:def:crs:EPSG::2154</DefaultCRS>
    </FeatureType>
  </FeatureTypeList>
</wfs:WFS_Capabilities>`;

/** Réponse d'un service en erreur — rendue en HTTP 200, ce qui piège. */
const EXCEPTION = `<?xml version="1.0"?>
<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1" version="2.0.0">
  <ows:Exception exceptionCode="InvalidParameterValue">
    <ows:ExceptionText>Unknown output format: application/json</ows:ExceptionText>
  </ows:Exception>
</ows:ExceptionReport>`;

function polygone(decalage = 0) {
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [4.8 + decalage, 45.7],
          [4.9 + decalage, 45.7],
          [4.9 + decalage, 45.8],
          [4.8 + decalage, 45.8],
          [4.8 + decalage, 45.7],
        ],
      ],
    },
    properties: { nom: `Zone ${decalage}` },
  };
}

/** `fetch` simulé, qui répond selon l'URL demandée. */
function fauxService(reponses: Array<{ contient: string; corps: string }>) {
  const appels: string[] = [];
  const f = (async (url: string | URL) => {
    const s = String(url);
    appels.push(s);
    const trouvee = reponses.find((r) => s.includes(r.contient));
    return {
      ok: true,
      status: 200,
      text: async () => trouvee?.corps ?? '',
      json: async () => JSON.parse(trouvee?.corps ?? '{}'),
    } as Response;
  }) as unknown as typeof fetch;
  return { f, appels };
}

describe('Service WFS', () => {
  // -------------------------------------------------------------------------
  // GetCapabilities
  // -------------------------------------------------------------------------

  it('lit les couches et les formats d’un GetCapabilities', () => {
    const cap = parseCapabilities(CAPABILITIES);

    expect(cap.version).toBe('2.0.0');
    expect(cap.title).toBe('DREAL Auvergne-Rhône-Alpes — Nitrates');
    expect(cap.layers).toHaveLength(2);
    expect(cap.layers[0]?.name).toBe('nitrates:zones_vulnerables_2021');
    expect(cap.layers[0]?.title).toBe('Zones vulnérables 2021');
    expect(cap.layers[0]?.abstract).toContain('nitrates');
    expect(cap.layers[0]?.crs).toContain('urn:ogc:def:crs:EPSG::2154');
  });

  it('ne confond pas la version de XML avec celle du service', () => {
    // Tout GetCapabilities commence par `<?xml version="1.0"?>`. Prendre le
    // premier `version=` du document ramenait « 1.0 » pour tous les services :
    // Parcelys envoyait alors `typeName`/`maxFeatures` à un serveur 2.0.0 et,
    // surtout, ne paginait plus — un zonage de 8 000 polygones s'importait à
    // 1 000, sans le moindre message.
    expect(CAPABILITIES.startsWith('<?xml version="1.0"')).toBe(true);
    expect(parseCapabilities(CAPABILITIES).version).toBe('2.0.0');
  });

  it('lit la version annoncée dans l’identification du service, à défaut de racine', () => {
    const sansAttribut = CAPABILITIES.replace(
      '<wfs:WFS_Capabilities version="2.0.0"',
      '<wfs:WFS_Capabilities',
    ).replace(
      '<ows:ServiceIdentification>',
      '<ows:ServiceIdentification>\n    <ows:ServiceTypeVersion>1.1.0</ows:ServiceTypeVersion>\n    <ows:ServiceTypeVersion>2.0.0</ows:ServiceTypeVersion>',
    );

    // Le service gère les deux : on retient la plus élevée, seule à paginer.
    expect(parseCapabilities(sansAttribut).version).toBe('2.0.0');
  });

  it('ordonne les versions par nombre, pas par texte', () => {
    const dixEtNeuf = CAPABILITIES.replace(
      '<wfs:WFS_Capabilities version="2.0.0"',
      '<wfs:WFS_Capabilities',
    ).replace(
      '<ows:ServiceIdentification>',
      '<ows:ServiceIdentification>\n    <ows:ServiceTypeVersion>1.10.0</ows:ServiceTypeVersion>\n    <ows:ServiceTypeVersion>1.9.0</ows:ServiceTypeVersion>',
    );

    // En ordre texte, « 1.9.0 » passerait après « 1.10.0 ».
    expect(parseCapabilities(dixEtNeuf).version).toBe('1.10.0');
  });

  it('suppose la version la plus prudente quand rien n’est annoncé', () => {
    const muet = CAPABILITIES.replace(
      '<wfs:WFS_Capabilities version="2.0.0"',
      '<wfs:WFS_Capabilities',
    );
    expect(parseCapabilities(muet).version).toBe('1.1.0');
  });

  it('repère le format rendant du GeoJSON parmi ceux annoncés', () => {
    const cap = parseCapabilities(CAPABILITIES);
    expect(cap.outputFormats).toContain('application/json');
    expect(cap.geojsonFormat).toBe('application/json');
  });

  it('signale un service qui ne sait pas rendre de GeoJSON', () => {
    const sansJson = CAPABILITIES.replace('<ows:Value>application/json</ows:Value>', '');
    const cap = parseCapabilities(sansJson);
    // Ni JSON ni geo+json : on ne se rabat pas sur du GML qu'on ne sait pas lire.
    expect(cap.geojsonFormat).toBeNull();
  });

  /**
   * Un service en erreur répond en HTTP 200 avec un ExceptionReport. Sans ce
   * contrôle, on rendrait « 0 couche » — ce qui se lirait « ce service n'expose
   * rien » alors qu'il a refusé la requête.
   */
  it('ne prend pas un rapport d’erreur pour un service vide', () => {
    expect(() => parseCapabilities(EXCEPTION)).toThrow(WfsError);
    expect(() => parseCapabilities(EXCEPTION)).toThrow(/Unknown output format/);
  });

  it('refuse un document qui n’est pas un GetCapabilities', () => {
    expect(() => parseCapabilities('<html><body>404</body></html>')).toThrow(
      /pas un document GetCapabilities/,
    );
  });

  it('interroge le service avec les bons paramètres', async () => {
    const { f, appels } = fauxService([{ contient: 'GetCapabilities', corps: CAPABILITIES }]);
    await describeWfs('https://dreal.example/geoserver/ows', f);

    expect(appels[0]).toContain('SERVICE=WFS');
    expect(appels[0]).toContain('REQUEST=GetCapabilities');
  });

  /**
   * Une URL de service porte souvent déjà `service=wfs` en minuscules. Ajouter
   * `SERVICE=WFS` sans retirer l'existant produit une requête à deux valeurs,
   * que certains serveurs rejettent.
   */
  it('remplace les paramètres déjà présents, sans les doubler', async () => {
    const { f, appels } = fauxService([{ contient: 'GetCapabilities', corps: CAPABILITIES }]);
    await describeWfs('https://dreal.example/ows?service=wfs&request=GetMap', f);

    const url = new URL(appels[0] ?? '');
    expect(url.searchParams.getAll('SERVICE')).toEqual(['WFS']);
    expect(url.searchParams.getAll('service')).toEqual([]);
    expect(url.searchParams.get('REQUEST')).toBe('GetCapabilities');
    expect(url.searchParams.getAll('request')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // GetFeature
  // -------------------------------------------------------------------------

  it('demande du GeoJSON en 4326 avec les paramètres de la version 2', async () => {
    const { f, appels } = fauxService([
      {
        contient: 'GetFeature',
        corps: JSON.stringify({ type: 'FeatureCollection', features: [polygone()], numberMatched: 1 }),
      },
    ]);

    const resultat = await fetchWfsFeatures(
      {
        serviceUrl: 'https://dreal.example/ows',
        typeName: 'nitrates:zones_vulnerables_2021',
        version: '2.0.0',
        outputFormat: 'application/json',
        pageSize: 10,
      },
      f,
    );

    const url = new URL(appels[0] ?? '');
    expect(url.searchParams.get('typeNames')).toBe('nitrates:zones_vulnerables_2021');
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('startIndex')).toBe('0');
    expect(url.searchParams.get('srsName')).toBe('EPSG:4326');
    expect(resultat.features).toHaveLength(1);
    expect(resultat.total).toBe(1);
  });

  /**
   * Les noms de paramètres changent entre les versions, et c'est l'erreur la
   * plus commune : `typeNames`/`count` en 2.0.0, `typeName`/`maxFeatures`
   * avant. Un mauvais nom fait répondre « paramètre manquant » ou, pire,
   * ignorer la limite.
   */
  it('emploie les noms de paramètres de la version 1.1.0', async () => {
    const { f, appels } = fauxService([
      { contient: 'GetFeature', corps: JSON.stringify({ features: [polygone()] }) },
    ]);

    await fetchWfsFeatures(
      {
        serviceUrl: 'https://dreal.example/ows',
        typeName: 'zv',
        version: '1.1.0',
        pageSize: 500,
      },
      f,
    );

    const url = new URL(appels[0] ?? '');
    expect(url.searchParams.get('typeName')).toBe('zv');
    expect(url.searchParams.get('maxFeatures')).toBe('500');
    expect(url.searchParams.get('typeNames')).toBeNull();
    expect(url.searchParams.get('startIndex')).toBeNull();
  });

  /**
   * Sans pagination, on importerait « les 1 000 premiers » polygones en croyant
   * tout avoir — et des parcelles ressortiraient hors zone alors qu'elles y
   * sont. C'est une erreur invisible, donc la pire.
   */
  it('parcourt toutes les pages jusqu’à une page incomplète', async () => {
    let appel = 0;
    const f = (async (url: string | URL) => {
      appel += 1;
      const startIndex = new URL(String(url)).searchParams.get('startIndex');
      // Deux pages pleines de 2, puis une page de 1 : fin.
      const lot = appel <= 2 ? [polygone(appel), polygone(appel + 10)] : [polygone(99)];
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ features: lot, numberMatched: 5, startIndex }),
      } as Response;
    }) as unknown as typeof fetch;

    const resultat = await fetchWfsFeatures(
      {
        serviceUrl: 'https://dreal.example/ows',
        typeName: 'zv',
        version: '2.0.0',
        pageSize: 2,
      },
      f,
    );

    expect(appel).toBe(3);
    expect(resultat.features).toHaveLength(5);
    expect(resultat.total).toBe(5);
  });

  it('s’arrête sur une page vide', async () => {
    let appel = 0;
    const f = (async () => {
      appel += 1;
      const lot = appel === 1 ? [polygone(), polygone(1)] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify({ features: lot }) } as Response;
    }) as unknown as typeof fetch;

    const resultat = await fetchWfsFeatures(
      { serviceUrl: 'https://x/ows', typeName: 'zv', version: '2.0.0', pageSize: 2 },
      f,
    );
    expect(resultat.features).toHaveLength(2);
    expect(appel).toBe(2);
  });

  /**
   * Un serveur qui ignore la pagination renverrait indéfiniment la même page.
   * Le garde-fou empêche une boucle sans fin sur un Raspberry Pi.
   */
  it('s’arrête et le dit au-delà du plafond d’entités', async () => {
    const f = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ features: [polygone(), polygone(1)] }),
      }) as Response) as unknown as typeof fetch;

    await expect(
      fetchWfsFeatures(
        {
          serviceUrl: 'https://x/ows',
          typeName: 'zv',
          version: '2.0.0',
          pageSize: 2,
          maxFeatures: 6,
        },
        f,
      ),
    ).rejects.toThrow(/import interrompu/);
  });

  it('explique un refus rendu en XML plutôt que « JSON invalide »', async () => {
    const { f } = fauxService([{ contient: 'GetFeature', corps: EXCEPTION }]);

    await expect(
      fetchWfsFeatures(
        { serviceUrl: 'https://x/ows', typeName: 'zv', version: '2.0.0' },
        f,
      ),
    ).rejects.toThrow(/Unknown output format/);
  });

  // -------------------------------------------------------------------------
  // Classement des formats
  // -------------------------------------------------------------------------

  it('distingue un service lisible d’un service qui ne l’est pas', () => {
    expect(classifyResourceFormat('wfs')).toBe('wfs');
    expect(classifyResourceFormat('WFS')).toBe('wfs');
    expect(classifyResourceFormat('wms')).toBe('wms');
    expect(classifyResourceFormat('geojson')).toBe('fichier');
    expect(classifyResourceFormat('shp')).toBe('fichier');
    expect(classifyResourceFormat('mapinfo tab')).toBe('illisible');
    expect(classifyResourceFormat(null)).toBe('illisible');
  });

  /**
   * Les deux formats réellement rencontrés chez Kevin. « Aucune ressource
   * exploitable » ne suffisait pas : il faut dire pourquoi et vers quoi se
   * tourner, sans quoi le jeu passe pour inutilisable alors que le producteur
   * publie le même zonage autrement.
   */
  it('oriente au lieu de constater, sur les formats non lisibles', () => {
    expect(explainFormat('wms')).toContain('images');
    expect(explainFormat('wms')).toContain('WFS');

    expect(explainFormat('mapinfo tab')).toContain('MapInfo');
    expect(explainFormat('mapinfo tab')).toContain('GeoJSON');

    expect(explainFormat('pdf')).toContain('document');
  });
});
