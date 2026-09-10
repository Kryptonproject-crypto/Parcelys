import { describe, expect, it } from 'vitest';
import {
  TelepacXmlError,
  encodageDeclare,
  lireCoordonnees,
  lireTelepacXml,
  mappingPourCouche,
  provenanceXml,
  sridProbable,
  surfaceAdmissibleHa,
  versShapeFeatures,
} from '../src/lib/pac/telepac-xml';

/**
 * Lecture de l'export XML TéléPAC.
 *
 * Ce que ces tests protègent : **un exploitant doit pouvoir importer le dossier
 * que TéléPAC lui donne**. Parcelys ne savait lire que l'export graphique
 * (Shapefile) et rangeait le XML parmi les fichiers « dont ce module n'a que
 * faire » — c'est-à-dire qu'il refusait le téléchargement le plus courant, avec
 * un message parfaitement exact et parfaitement inutile.
 *
 * La fixture ci-dessous reproduit la forme des exports réels — cinq campagnes
 * confrontées, versions de schéma 2022-V4 à 2026-V1 — mais avec des
 * identifiants inventés. Un numéro PACAGE, un SIRET et un nom d'exploitation
 * réels n'ont rien à faire dans un dépôt de code.
 *
 * Elle réunit à dessein les cas qui ont posé problème :
 *
 *   · l'encodage ISO-8859-1 et un prénom accentué ;
 *   · un îlot troué (`innerBoundaryIs`) ;
 *   · une SNA ponctuelle, qui n'a pas de surface ;
 *   · une ZDH sans `numeroZdh`, identifiée par `numeroZdhcreationTas` ;
 *   · une culture dérobée, dont le code ne doit pas passer pour la principale ;
 *   · des effectifs animaux, qui doivent être écartés **et annoncés**.
 */

/** Un carré de `cote` mètres dont le coin bas-gauche est en (x, y). */
function carre(x: number, y: number, cote: number): string {
  return [
    `${x},${y}`,
    `${x + cote},${y}`,
    `${x + cote},${y + cote}`,
    `${x},${y + cote}`,
    `${x},${y}`,
  ].join(' ');
}

function polygone(exterieur: string, interieur?: string): string {
  return `<gml:Polygon>
    <gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${exterieur}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs>
    ${
      interieur
        ? `<gml:innerBoundaryIs><gml:LinearRing><gml:coordinates>${interieur}</gml:coordinates></gml:LinearRing></gml:innerBoundaryIs>`
        : ''
    }
  </gml:Polygon>`;
}

/** Coordonnées Lambert-93 plausibles pour l'Allier. */
const X = 697_000;
const Y = 6_594_000;

const DOSSIER = `<?xml version="1.0" encoding="ISO-8859-1"?>
<producteurs xmlns="urn:x-telepac:fr.gouv.agriculture.telepac:echange-producteur" xmlns:gml="http://www.opengis.net/gml">
<producteur numero-pacage="099000001" campagne="Courante" fichier-xsd="Echanges-producteur-export-2026-V1">
 <demandeur>
  <identification-societe>
   <exploitation>GAEC D'ESSAI &amp; FILS</exploitation>
   <associes>
    <associe numero-pacage="099000002">
     <identite><civilite>Monsieur</civilite><nom>DURAND</nom><prenoms>Micka\xebl</prenoms></identite>
    </associe>
   </associes>
  </identification-societe>
  <siret>00000000000000</siret>
 </demandeur>
 <effectifs-animaux>
  <effectif-animal>
   <effectif-present><type-animal-2>PP</type-animal-2><nb-animaux-2>4000</nb-animaux-2></effectif-present>
  </effectif-animal>
 </effectifs-animaux>
 <rpg>
  <ilot numero-ilot="1" numero-ilot-reference="099000001990">
   <commune>03046</commune>
   <geometrie>${polygone(carre(X, Y, 200), carre(X + 50, Y + 50, 20))}</geometrie>
   <parcelles>
    <parcelle>
     <descriptif-parcelle numero-parcelle="9">
      <culture-principale production-semences="false" declare-IAE="true">
       <code-culture>BTH</code-culture>
       <precision>004</precision>
      </culture-principale>
      <culture-derobee melange-SIE-culture1="DMD" melange-SIE-culture2="DTR" />
      <engagements-maec surface-cible="false" />
     </descriptif-parcelle>
     <geometrie>${polygone(carre(X, Y, 100))}</geometrie>
     <surface-admissible>98</surface-admissible>
    </parcelle>
    <parcelle>
     <descriptif-parcelle numero-parcelle="10">
      <culture-principale production-semences="false">
       <code-culture>PPH</code-culture>
      </culture-principale>
      <engagements-maec surface-cible="false" />
     </descriptif-parcelle>
     <geometrie>${polygone(carre(X + 100, Y, 100))}</geometrie>
    </parcelle>
   </parcelles>
  </ilot>
  <sna-declaree>
   <numeroSna>099000123456</numeroSna>
   <categorieSna>VG</categorieSna>
   <typeSna>A1</typeSna>
   <surfaceGraphique>2.37</surfaceGraphique>
   <geometrie>${polygone(carre(X + 10, Y + 10, 20))}</geometrie>
  </sna-declaree>
  <sna-declaree>
   <numeroSna>099000123457</numeroSna>
   <categorieSna>AT</categorieSna>
   <typeSna>A2</typeSna>
   <geometrie><gml:Point><gml:coordinates>${X + 42},${Y + 42}</gml:coordinates></gml:Point></geometrie>
  </sna-declaree>
  <zdh-declaree>
   <numeroZdh>099000900001</numeroZdh>
   <densiteVegetation>D10_30</densiteVegetation>
   <geometrie>${polygone(carre(X + 300, Y, 50))}</geometrie>
  </zdh-declaree>
  <zdh-declaree>
   <numeroZdhcreationTas>3</numeroZdhcreationTas>
   <densiteVegetation>MOINS_10</densiteVegetation>
   <geometrie>${polygone(carre(X + 400, Y, 50))}</geometrie>
  </zdh-declaree>
 </rpg>
</producteur>
</producteurs>`;

/** Le dossier tel qu'il arrive : des octets en ISO-8859-1, pas une chaîne. */
function dossierEnOctets(texte = DOSSIER): Buffer {
  return Buffer.from(texte, 'latin1');
}

describe('Export XML TéléPAC', () => {
  describe('Encodage', () => {
    it('lit l’encodage annoncé par le prologue plutôt que de le supposer', () => {
      expect(encodageDeclare(dossierEnOctets())).toBe('ISO-8859-1');
      expect(encodageDeclare(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><a/>'))).toBe(
        'UTF-8',
      );
      expect(encodageDeclare(Buffer.from('<a/>'))).toBeNull();
    });

    it('rend les accents d’un nom propre intacts', () => {
      // Le seul endroit où l'encodage compte : les balises sont en ASCII, les
      // noms ne le sont pas. « Mickaël » lu en UTF-8 deviendrait illisible, et
      // ce nom part dans un dossier de contrôle.
      const lu = lireTelepacXml(dossierEnOctets());
      expect(lu.declaration.exploitation).toBe("GAEC D'ESSAI & FILS");
      expect(lu.declaration.encodage).toBe('ISO-8859-1');
    });
  });

  describe('Coordonnées GML', () => {
    it('lit les paires séparées par des espaces, retours à la ligne compris', () => {
      const anneau = lireCoordonnees('1,2\n   3,4\n  5,6 ');
      expect(anneau).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it('honore les séparateurs annoncés quand ils ne sont pas ceux par défaut', () => {
      expect(lireCoordonnees('1:2|3:4', { cs: ':', ts: '|' })).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('écarte un tuple incomplet sans emporter l’anneau', () => {
      expect(lireCoordonnees('1,2 3 4,5')).toEqual([
        [1, 2],
        [4, 5],
      ]);
    });
  });

  describe('Système de coordonnées', () => {
    it('propose le Lambert-93 d’après l’emprise', () => {
      const { srid } = sridProbable([
        [
          [X, Y],
          [X + 10, Y + 10],
        ],
      ]);
      expect(srid).toBe(2154);
    });

    it('ne tranche pas quand l’ordre de grandeur ne correspond pas', () => {
      // Des degrés WGS-84. Projeter au jugé déplacerait le parcellaire de
      // centaines de kilomètres : mieux vaut demander.
      const { srid, label } = sridProbable([
        [
          [3.1, 46.4],
          [3.2, 46.5],
        ],
      ]);
      expect(srid).toBeNull();
      expect(label).toContain('Indiquez-le');
    });
  });

  describe('Lecture du dossier', () => {
    const lu = lireTelepacXml(dossierEnOctets());

    it('lit l’en-tête sans rien deviner', () => {
      expect(lu.declaration.pacage).toBe('099000001');
      expect(lu.declaration.campagne).toBe('Courante');
      expect(lu.declaration.fichierXsd).toBe('Echanges-producteur-export-2026-V1');
      expect(lu.declaration.siret).toBe('00000000000000');
    });

    it('lit îlots, parcelles, SNA et ZDH', () => {
      expect(lu.ilots).toHaveLength(1);
      expect(lu.parcelles).toHaveLength(2);
      expect(lu.sna).toHaveLength(2);
      expect(lu.zdh).toHaveLength(2);
    });

    it('conserve le trou d’un îlot au lieu de l’ignorer', () => {
      const ilot = lu.ilots[0];
      expect(ilot?.geometrie.type).toBe('polygone');
      if (ilot?.geometrie.type !== 'polygone') throw new Error('géométrie attendue');
      // Un contour, un trou : deux anneaux, dans cet ordre.
      expect(ilot.geometrie.anneaux).toHaveLength(2);
      expect(ilot.geometrie.anneaux[0]?.[0]).toEqual([X, Y]);
    });

    it('rattache chaque parcelle au numéro de son îlot', () => {
      expect(lu.parcelles.map((p) => p.attributs['numero-ilot'])).toEqual(['1', '1']);
      expect(lu.parcelles.map((p) => p.attributs['numero-parcelle'])).toEqual(['9', '10']);
    });

    it('remonte le code culture et sa précision', () => {
      expect(lu.parcelles[0]?.attributs['code-culture']).toBe('BTH');
      expect(lu.parcelles[0]?.attributs['precision']).toBe('004');
      expect(lu.parcelles[1]?.attributs['code-culture']).toBe('PPH');
    });

    it('ne laisse pas une dérobée passer pour la culture principale', () => {
      // Le défaut serait invisible et grave : le registre afficherait un
      // couvert d'interculture comme culture déclarée.
      const p = lu.parcelles[0];
      expect(p?.attributs['code-culture']).toBe('BTH');
      expect(p?.attributs['derobee-melange-SIE-culture1']).toBe('DMD');
      expect(p?.attributs['derobee-melange-SIE-culture2']).toBe('DTR');
    });

    it('recopie à plat les attributs du descriptif', () => {
      expect(lu.parcelles[0]?.attributs['declare-IAE']).toBe('true');
      expect(lu.parcelles[0]?.attributs['production-semences']).toBe('false');
    });

    it('garde une SNA ponctuelle comme point, sans lui inventer de surface', () => {
      const point = lu.sna.find((s) => s.geometrie.type === 'point');
      expect(point).toBeDefined();
      if (point?.geometrie.type !== 'point') throw new Error('point attendu');
      expect(point.geometrie.point).toEqual([X + 42, Y + 42]);
      expect(point.attributs['numero-sna']).toBe('099000123457');
    });

    it('identifie une ZDH dessinée par l’exploitant, qui n’a pas de numéro officiel', () => {
      // 5 des 75 ZDH du dossier 2026 réel sont dans ce cas. S'appuyer sur le
      // seul `numeroZdh` les laisserait sans identifiant, donc introuvables
      // d'une campagne à l'autre.
      expect(lu.zdh.map((z) => z.attributs['numero-zdh'])).toEqual(['099000900001', '3']);
    });

    it('écarte les effectifs animaux et le dit', () => {
      expect(lu.ignores.join(' ')).toContain('Effectifs animaux');

      // Écarté ne veut pas dire lu et jeté : rien de cette branche ne doit
      // s'être glissé dans les entités.
      //
      // L'assertion porte sur les noms d'éléments, pas sur la valeur « 4000 » :
      // une première version cherchait cette chaîne et échouait, parce qu'elle
      // apparaît dans la coordonnée 6594000. Le contrôle accusait le code d'une
      // fuite qui n'existait pas.
      const clefs = [...lu.parcelles, ...lu.sna, ...lu.zdh].flatMap((e) =>
        Object.keys(e.attributs),
      );
      expect(clefs.filter((c) => /animal|animaux|effectif/i.test(c))).toEqual([]);
    });

    it('refuse un XML qui n’est pas un dossier TéléPAC', () => {
      expect(() =>
        lireTelepacXml(Buffer.from('<?xml version="1.0"?><catalogue><item/></catalogue>')),
      ).toThrow(TelepacXmlError);
    });

    it('nomme le fichier plutôt que le format quand le XML est cassé', () => {
      expect(() => lireTelepacXml(Buffer.from('<producteurs><ilot '))).toThrow(/TéléPAC|valide/);
    });
  });

  describe('Vers le format commun d’import', () => {
    const lu = lireTelepacXml(dossierEnOctets());

    it('rend des entités de la même forme que celles d’un Shapefile', () => {
      const { features, colonnes } = versShapeFeatures(lu.parcelles);
      expect(features).toHaveLength(2);
      expect(features[0]?.recordNumber).toBe(1);
      expect(features[0]?.rings).toHaveLength(1);
      expect(colonnes).toContain('code-culture');
    });

    it('porte la géométrie ponctuelle en WKT, jamais en anneaux', () => {
      const { features, points } = versShapeFeatures(lu.sna);
      expect(points).toBe(1);
      const point = features.find((f) => f.wkt);
      expect(point?.wkt).toBe(`POINT(${X + 42} ${Y + 42})`);
      expect(point?.rings).toHaveLength(0);
    });

    it('établit la correspondance au lieu de la deviner', () => {
      const { colonnes } = versShapeFeatures(lu.parcelles);
      const mapping = mappingPourCouche('parcelles', colonnes);
      expect(mapping.ilot.column).toBe('numero-ilot');
      expect(mapping.ilot.confidence).toBe('constate');
      expect(mapping.cropCode.column).toBe('code-culture');

      // Le libellé de culture n'est pas dans le fichier : le laisser vide est
      // la seule réponse honnête. Un libellé inventé dans un dossier de
      // contrôle est pire qu'un code brut.
      expect(mapping.cropLabel.column).toBeNull();

      // `surface-admissible` ne mesure pas la surface graphique : la brancher
      // sur `area` ferait apparaître un écart sur des parcelles correctes.
      expect(mapping.area.column).toBeNull();
    });

    it('annonce une provenance qui ne se surestime pas', () => {
      const texte = provenanceXml(lu.declaration);
      expect(texte).toContain('Echanges-producteur-export-2026-V1');
      expect(texte).toContain('constatées');
      expect(texte).not.toContain('officielle du ministère');
      // Le SRID est proposé : l'utilisateur doit le vérifier.
      expect(texte).toContain('Vérifiez');
    });
  });

  describe('Surface admissible', () => {
    it('convertit les ares en hectares', () => {
      expect(surfaceAdmissibleHa('267')).toBeCloseTo(2.67, 6);
      expect(surfaceAdmissibleHa(98)).toBeCloseTo(0.98, 6);
    });

    it('rend null plutôt que zéro quand la valeur manque', () => {
      // Zéro se lirait comme « aucune surface admissible », ce qui est une
      // affirmation ; l'absence n'en est pas une.
      expect(surfaceAdmissibleHa(null)).toBeNull();
      expect(surfaceAdmissibleHa(undefined)).toBeNull();
      expect(surfaceAdmissibleHa('')).toBeNull();
      expect(surfaceAdmissibleHa('n/c')).toBeNull();
    });

    it('correspond à l’ordre de grandeur de la géométrie', () => {
      // La parcelle 9 fait 100 m de côté, soit 1 ha ; le dossier déclare 98
      // ares. Si l'unité était mal lue, l'écart serait d'un facteur cent.
      const lu = lireTelepacXml(dossierEnOctets());
      const declaree = surfaceAdmissibleHa(
        lu.parcelles[0]?.attributs['surface-admissible'] as string,
      );
      expect(declaree).toBeCloseTo(0.98, 6);
    });
  });
});
