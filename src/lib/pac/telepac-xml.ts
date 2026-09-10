/**
 * Lecture de l'export XML TéléPAC (« échange producteur »).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TéléPAC propose deux téléchargements : un export graphique (Shapefile) et le
 * dossier lui-même, en XML. Jusqu'ici Parcelys ne savait lire que le premier, et
 * rangeait le second parmi « les fichiers dont ce module n'a que faire ». Un
 * exploitant qui déposait son dossier XML — le fichier que TéléPAC lui donne
 * spontanément — s'entendait répondre qu'aucune donnée géographique n'avait été
 * trouvée. C'était exact et parfaitement inutile.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE SAIT, ET D'OÙ IL LE SAIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les notices officielles décrivant ce format n'ont pas pu être consultées. La
 * structure codée ici a été **établie sur des exports réels**, en confrontant
 * cinq campagnes d'une même exploitation (2022 à 2026, versions de schéma
 * `Echanges-producteur-export-2022-V4`, `2023-V6`, `2024-V4` et `2026-V1`).
 *
 * C'est une source moins forte qu'une notice, et le module le dit : la
 * correspondance qu'il produit est marquée « constatée », pas « officielle », et
 * l'utilisateur la voit avant d'importer. La distinction n'est pas cosmétique —
 * « constaté sur cinq dossiers » n'autorise pas à affirmer « c'est le format ».
 *
 * Ce qui a été vérifié sur ces fichiers, et qui vaut donc d'être écrit :
 *
 *   · l'en-tête `producteur` porte `numero-pacage`, `campagne` et `fichier-xsd` ;
 *   · les géométries sont en GML 2 (`outerBoundaryIs` / `innerBoundaryIs`) ;
 *   · un `gml:Polygon` n'a **jamais** plus d'un contour extérieur — 2 984
 *     polygones examinés, 2 984 contours extérieurs ;
 *   · les SNA sont tantôt des polygones, tantôt des **points** (157 sur 560 en
 *     2026 : des arbres isolés) ;
 *   · aucune de ces géométries ne déclare son système de coordonnées. Il est
 *     donc *proposé* d'après l'ordre de grandeur, jamais imposé (voir
 *     `sridProbable`) ;
 *   · `surface-admissible` est exprimée en **ares** (rapport médian 1,0000 face
 *     à l'aire géométrique, sur les 113 parcelles qui la portent en 2026).
 *
 * Ce qui n'a pas été vérifié n'est pas deviné : les attributs inconnus sont
 * conservés tels quels dans `attributes` plutôt qu'interprétés.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE LAISSE DE CÔTÉ, ET POURQUOI IL LE DIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le dossier contient aussi les effectifs animaux et le détail des demandes
 * d'aides. Parcelys gère le parcellaire : ces branches ne sont pas lues. Elles
 * sont **nommées** dans `ignores` plutôt que passées sous silence, pour que
 * personne ne croie que Parcelys les a prises en compte.
 */

import { SaxesParser } from 'saxes';
import type { PacFeatureKind } from '@prisma/client';
import type { Ring, ShapeFeature } from '@/lib/pac/shapefile';
import type { FieldGuess, FieldMapping } from '@/lib/pac/adapter';

export class TelepacXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelepacXmlError';
  }
}

/** Ce que le fichier déclare de lui-même. Rien n'est déduit ici. */
export type TelepacDeclaration = {
  /** Numéro PACAGE porté par l'en-tête. */
  pacage: string | null;
  /** « Courante » ou « Precedente » — la campagne en cours n'a pas le même contenu. */
  campagne: string | null;
  /** Version du schéma d'échange, telle qu'annoncée (« …-2026-V1 »). */
  fichierXsd: string | null;
  siret: string | null;
  exploitation: string | null;
  /** Encodage lu dans le prologue, pas supposé. */
  encodage: string;
};

export type TelepacGeometry =
  | { type: 'polygone'; anneaux: Ring[] }
  | { type: 'point'; point: [number, number] }
  | { type: 'absente' };

export type TelepacEntite = {
  geometrie: TelepacGeometry;
  attributs: Record<string, string | number | null>;
};

export type TelepacXmlResult = {
  declaration: TelepacDeclaration;
  ilots: TelepacEntite[];
  parcelles: TelepacEntite[];
  sna: TelepacEntite[];
  zdh: TelepacEntite[];
  /** Branches présentes dans le fichier que ce lecteur ne traite pas. Nommées. */
  ignores: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

/**
 * Encodage annoncé par le prologue.
 *
 * Les exports examinés sont en ISO-8859-1. Le lire en UTF-8 ne casserait pas
 * l'analyse — les balises sont en ASCII — mais abîmerait discrètement les seuls
 * endroits où l'accent compte : le nom de l'exploitation et celui des associés.
 * « Mikaël » deviendrait « Mika<?> » dans un dossier de contrôle.
 *
 * Le prologue est lui-même en ASCII par construction (XML 1.0, § 4.3.3), on peut
 * donc le lire sans savoir encore quel encodage employer.
 */
export function encodageDeclare(buffer: Buffer): string | null {
  const prologue = buffer.subarray(0, 200).toString('ascii');
  return /<\?xml[^>]*\bencoding\s*=\s*["']([\w.-]+)["']/i.exec(prologue)?.[1] ?? null;
}

function decoder(buffer: Buffer): { texte: string; encodage: string; warning: string | null } {
  const declare = encodageDeclare(buffer);
  const normalise = (declare ?? 'UTF-8').toLowerCase();

  // ISO-8859-1 et latin1 désignent le même jeu, et `Buffer.toString('latin1')`
  // fait exactement la correspondance octet → point de code attendue.
  if (normalise === 'iso-8859-1' || normalise === 'latin1' || normalise === 'iso8859-1') {
    return { texte: buffer.toString('latin1'), encodage: declare ?? 'ISO-8859-1', warning: null };
  }
  if (normalise === 'utf-8' || normalise === 'utf8') {
    return { texte: buffer.toString('utf8'), encodage: declare ?? 'UTF-8', warning: null };
  }

  // Un encodage qu'on ne sait pas traiter : on applique le défaut de la norme
  // XML et on le dit, plutôt que de rendre des accents faux sans prévenir.
  return {
    texte: buffer.toString('utf8'),
    encodage: declare ?? 'UTF-8',
    warning:
      `Le fichier annonce l'encodage « ${declare} », que Parcelys ne sait pas traiter. ` +
      "Il a été lu en UTF-8 : les caractères accentués des noms propres peuvent être abîmés. " +
      'Les codes et les géométries, eux, ne contiennent que des caractères ASCII.',
  };
}

// ---------------------------------------------------------------------------
// Coordonnées GML 2
// ---------------------------------------------------------------------------

/**
 * `<gml:coordinates>` → anneau.
 *
 * GML 2 laisse le producteur choisir ses séparateurs et les annoncer par les
 * attributs `cs`, `ts` et `decimal`. Les exports examinés emploient tous les
 * valeurs par défaut, mais les honorer coûte trois lignes et évite d'avoir à y
 * revenir devant un fichier d'une autre origine.
 */
export function lireCoordonnees(
  texte: string,
  options: { cs?: string; ts?: string; decimal?: string } = {},
): Ring {
  const cs = options.cs ?? ',';
  const ts = options.ts ?? ' ';
  const decimal = options.decimal ?? '.';

  const anneau: Ring = [];
  // Le séparateur de tuples annoncé est un espace : les retours à la ligne du
  // fichier en font partie, sans quoi chaque ligne produirait un point aberrant.
  const tuples = ts === ' ' ? texte.trim().split(/\s+/) : texte.trim().split(ts);

  for (const tuple of tuples) {
    if (!tuple) continue;
    const parts = tuple.split(cs);
    const brutX = parts[0];
    const brutY = parts[1];
    if (brutX === undefined || brutY === undefined) continue;
    const x = Number(decimal === '.' ? brutX : brutX.replace(decimal, '.'));
    const y = Number(decimal === '.' ? brutY : brutY.replace(decimal, '.'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    anneau.push([x, y]);
  }

  return anneau;
}

/**
 * Système de coordonnées probable, d'après l'ordre de grandeur.
 *
 * Ces exports ne déclarent aucun `srsName` : le SRID ne peut donc qu'être
 * **proposé**. Il l'est d'après l'emprise du Lambert-93, qui ne recouvre celle
 * d'aucun autre système susceptible d'apparaître ici — des degrés WGS-84 valent
 * au plus 180, un Lambert-93 vaut au moins 100 000.
 *
 * Rendre `null` plutôt que de trancher au jugé n'est pas de la timidité :
 * l'interface sait déjà demander le système à l'utilisateur quand il manque
 * (`sridOverride`), et un parcellaire projeté depuis le mauvais système atterrit
 * à des centaines de kilomètres de chez lui.
 */
export function sridProbable(anneaux: Ring[]): { srid: number | null; label: string } {
  const points = anneaux.flat();
  if (points.length === 0) return { srid: null, label: 'Aucune géométrie à examiner' };

  let dansLambert93 = 0;
  for (const [x, y] of points) {
    if (x >= 0 && x <= 1_300_000 && y >= 6_000_000 && y <= 7_200_000) dansLambert93 += 1;
  }

  if (dansLambert93 === points.length) {
    return {
      srid: 2154,
      label: 'Lambert-93 (EPSG:2154) — proposé d’après l’emprise, le fichier ne le déclare pas',
    };
  }

  return {
    srid: null,
    label:
      "Le fichier ne déclare pas son système de coordonnées et l'ordre de grandeur " +
      "ne correspond pas au Lambert-93. Indiquez-le avant d'importer.",
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Branches connues que ce lecteur ne traite pas, avec la raison affichée. */
const BRANCHES_IGNOREES: Record<string, string> = {
  'effectifs-animaux':
    'Effectifs animaux (bovins, ovins…) : Parcelys gère le parcellaire, ces données ne sont pas reprises.',
  'demandes-aides-pilier1-et-AR':
    "Demandes d'aides du premier pilier : déclaratif d'aide, sans effet sur le parcellaire.",
  'demandes-aides-pilier2':
    "Demandes d'aides du second pilier : déclaratif d'aide, sans effet sur le parcellaire.",
  'autres-obligations':
    "Autres obligations déclarées (BCAE, transmission de données) : sans effet sur le parcellaire.",
};

type Contexte = {
  entite: TelepacEntite | null;
  /** Contours en cours, séparés pour garantir l'ordre extérieur puis trous. */
  exterieurs: Ring[];
  interieurs: Ring[];
  point: [number, number] | null;
};

function nouveauContexte(): Contexte {
  return { entite: null, exterieurs: [], interieurs: [], point: null };
}

function figerGeometrie(ctx: Contexte, warnings: string[], quoi: string): TelepacGeometry {
  if (ctx.point) return { type: 'point', point: ctx.point };
  if (ctx.exterieurs.length === 0) return { type: 'absente' };

  // Un contour extérieur unique est ce que produisent tous les fichiers
  // examinés. S'il en arrivait plusieurs, les fusionner en un seul polygone
  // ferait passer les suivants pour des trous : mieux vaut ne garder que le
  // premier et le dire, quitte à ce que l'utilisateur redemande son export.
  if (ctx.exterieurs.length > 1) {
    warnings.push(
      `${quoi} : ${ctx.exterieurs.length} contours extérieurs dans une même géométrie. ` +
        'Seul le premier a été retenu — signalez ce dossier, ce cas était inconnu.',
    );
  }

  const premier = ctx.exterieurs[0];
  if (!premier) return { type: 'absente' };
  return { type: 'polygone', anneaux: [premier, ...ctx.interieurs] };
}

/**
 * Lit un export XML TéléPAC.
 *
 * L'analyse est faite en flux : le fichier de 2026 pèse 1,2 Mo et le Raspberry
 * Pi qui fait tourner Parcelys n'a pas de mémoire à gaspiller, mais surtout, un
 * lecteur en flux permet de traverser les branches non traitées sans les
 * construire.
 */
export function lireTelepacXml(buffer: Buffer): TelepacXmlResult {
  const { texte, encodage, warning } = decoder(buffer);
  const warnings: string[] = warning ? [warning] : [];

  const declaration: TelepacDeclaration = {
    pacage: null,
    campagne: null,
    fichierXsd: null,
    siret: null,
    exploitation: null,
    encodage,
  };

  const ilots: TelepacEntite[] = [];
  const parcelles: TelepacEntite[] = [];
  const sna: TelepacEntite[] = [];
  const zdh: TelepacEntite[] = [];
  const ignores = new Set<string>();

  const pile: string[] = [];
  let texteCourant = '';

  // Contexte géométrique courant : l'îlot englobe ses parcelles, il faut donc
  // deux contextes vivants en même temps.
  let ctxIlot = nouveauContexte();
  let ctxParcelle = nouveauContexte();
  let ctxAutre = nouveauContexte();
  /** Numéro d'îlot courant, recopié sur chaque parcelle pour le rattachement. */
  let ilotCourant: string | null = null;
  /** Profondeur à laquelle une branche ignorée a commencé, 0 si aucune. */
  let profondeurIgnoree = 0;

  const parser = new SaxesParser({ fragment: false });
  parser.on('error', (erreur) => {
    throw new TelepacXmlError(
      `Le fichier n'est pas un XML valide : ${erreur.message}. ` +
        'Retéléchargez-le depuis TéléPAC — un téléchargement interrompu produit ce message.',
    );
  });

  const dernier = (): string => pile[pile.length - 1] ?? '';
  const dans = (nom: string): boolean => pile.includes(nom);

  parser.on('opentag', (noeud) => {
    const nom = noeud.name;
    pile.push(nom);
    texteCourant = '';

    if (profondeurIgnoree > 0) return;
    const raison = BRANCHES_IGNOREES[nom];
    if (raison) {
      ignores.add(raison);
      profondeurIgnoree = pile.length;
      return;
    }

    const attrs = noeud.attributes as Record<string, string>;

    if (nom === 'producteur') {
      declaration.pacage = attrs['numero-pacage'] ?? null;
      declaration.campagne = attrs['campagne'] ?? null;
      declaration.fichierXsd = attrs['fichier-xsd'] ?? null;
      return;
    }

    if (nom === 'ilot') {
      ctxIlot = nouveauContexte();
      ilotCourant = attrs['numero-ilot'] ?? null;
      ctxIlot.entite = {
        geometrie: { type: 'absente' },
        attributs: {
          'numero-ilot': ilotCourant,
          'numero-ilot-reference': attrs['numero-ilot-reference'] ?? null,
          commune: null,
        },
      };
      return;
    }

    if (nom === 'parcelle' && dans('ilot')) {
      ctxParcelle = nouveauContexte();
      ctxParcelle.entite = {
        geometrie: { type: 'absente' },
        attributs: { 'numero-ilot': ilotCourant, 'numero-parcelle': null },
      };
      return;
    }

    if (nom === 'sna-declaree' || nom === 'zdh-declaree') {
      ctxAutre = nouveauContexte();
      ctxAutre.entite = { geometrie: { type: 'absente' }, attributs: {} };
      return;
    }

    // Les attributs des sous-éléments d'une parcelle sont recopiés à plat :
    // `culture-principale production-semences="false"` devient la colonne
    // `production-semences`. L'aperçu peut ainsi les montrer sans que ce module
    // ait à connaître la signification de chacun — et une campagne qui en
    // ajoute un le voit arriver sans qu'on ait à toucher au code.
    //
    // Les dérobées sont préfixées : `culture-derobee` porte ses codes en
    // attributs (`melange-SIE-culture1`), et un couvert d'interculture ne doit
    // jamais pouvoir passer pour la culture déclarée.
    if (ctxParcelle.entite && dans('parcelle') && nom !== 'parcelle') {
      const prefixe = nom === 'culture-derobee' || dans('culture-derobee') ? 'derobee-' : '';
      for (const [cle, valeur] of Object.entries(attrs)) {
        ctxParcelle.entite.attributs[`${prefixe}${cle}`] = valeur;
      }
      return;
    }
  });

  parser.on('text', (t) => {
    texteCourant += t;
  });

  parser.on('closetag', () => {
    const nom = dernier();
    const valeur = texteCourant.trim();
    texteCourant = '';

    if (profondeurIgnoree > 0) {
      if (pile.length === profondeurIgnoree) profondeurIgnoree = 0;
      pile.pop();
      return;
    }

    if (nom === 'gml:coordinates' && valeur) {
      const anneau = lireCoordonnees(valeur);
      const estPoint = dans('gml:Point');
      const estInterieur = dans('gml:innerBoundaryIs');
      // À qui appartient cette géométrie ? À l'élément le plus proche dans la
      // pile — une parcelle est toujours plus profonde que son îlot.
      const cible = dans('parcelle') ? ctxParcelle : dans('ilot') ? ctxIlot : ctxAutre;
      const premier = anneau[0];
      if (estPoint) {
        if (premier) cible.point = premier;
      } else if (estInterieur) {
        cible.interieurs.push(anneau);
      } else {
        cible.exterieurs.push(anneau);
      }
      pile.pop();
      return;
    }

    if (nom === 'siret') declaration.siret = valeur || null;
    if (nom === 'exploitation') declaration.exploitation = valeur || null;

    if (ctxIlot.entite && nom === 'commune' && !dans('parcelle')) {
      ctxIlot.entite.attributs['commune'] = valeur || null;
    }

    if (ctxParcelle.entite && dans('parcelle') && nom !== 'parcelle' && valeur) {
      // Tout élément textuel devient une colonne homonyme : `code-culture`,
      // `precision`, `surface-admissible`, `portee`…
      //
      // Sauf sous `culture-derobee` : la campagne 2022 y répète un
      // `<code-culture>`, qui écraserait celui de la culture principale et
      // ferait passer un couvert d'interculture pour la culture déclarée. Les
      // dérobées sont donc préfixées, ni perdues ni confondues.
      const cle = dans('culture-derobee') ? `derobee-${nom}` : nom;
      ctxParcelle.entite.attributs[cle] = valeur;
    }

    if (ctxAutre.entite && (dans('sna-declaree') || dans('zdh-declaree'))) {
      // Les intersections SNA↔îlot et SNA↔parcelle sont des listes : elles ne
      // rentrent pas dans une colonne. Elles sont laissées de côté ici et
      // reprises plus bas, où elles peuvent être agrégées.
      const dansIntersection = dans('intersectionsSnaIlots') || dans('intersectionsSnaParcelles');
      if (!dansIntersection && valeur && nom !== 'sna-declaree' && nom !== 'zdh-declaree') {
        ctxAutre.entite.attributs[nom] = valeur;
      }
    }

    // Fermetures d'entités : on fige la géométrie et on range.
    if (nom === 'ilot' && ctxIlot.entite) {
      ctxIlot.entite.geometrie = figerGeometrie(ctxIlot, warnings, `Îlot ${ilotCourant ?? '?'}`);
      ilots.push(ctxIlot.entite);
      ctxIlot = nouveauContexte();
      ilotCourant = null;
    }

    if (nom === 'parcelle' && ctxParcelle.entite) {
      const numero = ctxParcelle.entite.attributs['numero-parcelle'];
      ctxParcelle.entite.geometrie = figerGeometrie(
        ctxParcelle,
        warnings,
        `Parcelle ${String(numero ?? '?')} de l'îlot ${ilotCourant ?? '?'}`,
      );
      parcelles.push(ctxParcelle.entite);
      ctxParcelle = nouveauContexte();
    }

    if ((nom === 'sna-declaree' || nom === 'zdh-declaree') && ctxAutre.entite) {
      // Un identifiant canonique, sous un nom stable.
      //
      // Une ZDH porte `numeroZdh` quand elle vient du référentiel, mais
      // `numeroZdhcreationTas` quand c'est l'exploitant qui l'a dessinée — 5 des
      // 75 du dossier 2026 sont dans ce cas. Pointer la correspondance sur le
      // premier nom laisserait ces cinq-là sans identifiant, donc sans moyen de
      // les retrouver d'une campagne à l'autre.
      const attributs = ctxAutre.entite.attributs;
      const numero =
        nom === 'sna-declaree'
          ? (attributs['numeroSna'] ?? null)
          : (attributs['numeroZdh'] ?? attributs['numeroZdhcreationTas'] ?? null);
      attributs[nom === 'sna-declaree' ? 'numero-sna' : 'numero-zdh'] = numero;

      ctxAutre.entite.geometrie = figerGeometrie(
        ctxAutre,
        warnings,
        `${nom === 'sna-declaree' ? 'SNA' : 'ZDH'} ${String(numero)}`,
      );
      (nom === 'sna-declaree' ? sna : zdh).push(ctxAutre.entite);
      ctxAutre = nouveauContexte();
    }

    pile.pop();
  });

  parser.write(texte).close();

  if (declaration.pacage === null && ilots.length === 0) {
    throw new TelepacXmlError(
      "Ce fichier XML n'a pas la forme d'un export TéléPAC : ni numéro PACAGE, ni îlot. " +
        'Déposez le dossier téléchargé depuis TéléPAC, pas un fichier produit par un autre outil.',
    );
  }

  return { declaration, ilots, parcelles, sna, zdh, ignores: [...ignores], warnings };
}

// ---------------------------------------------------------------------------
// Vers le format commun d'import
// ---------------------------------------------------------------------------

/**
 * Une entité TéléPAC devient une entité de dossier.
 *
 * Le reste de la chaîne d'import — analyse, rapprochement, sauvegarde, écriture
 * — travaille sur `ShapeFeature`. En rendant cette forme-là, le XML emprunte
 * exactement le même chemin que le Shapefile : rien à dupliquer, et une seule
 * chaîne à vérifier.
 *
 * Une géométrie ponctuelle ne rentre pas dans `rings` : elle est portée par
 * l'attribut `geometrie-point`, et la couche la signale. Le point n'est pas
 * transformé en petit carré — inventer un rayon serait inventer une surface.
 */
export function versShapeFeatures(entites: TelepacEntite[]): {
  features: ShapeFeature[];
  colonnes: string[];
  points: number;
  sansGeometrie: number;
} {
  const colonnes = new Set<string>();
  let points = 0;
  let sansGeometrie = 0;

  const features: ShapeFeature[] = entites.map((entite, index) => {
    const attributs: Record<string, string | number | null> = { ...entite.attributs };

    let wkt: string | null = null;
    if (entite.geometrie.type === 'point') {
      points += 1;
      const [x, y] = entite.geometrie.point;
      attributs['geometrie-point'] = `${x} ${y}`;
      wkt = `POINT(${x} ${y})`;
    } else if (entite.geometrie.type === 'absente') {
      sansGeometrie += 1;
    }

    for (const cle of Object.keys(attributs)) colonnes.add(cle);

    return {
      recordNumber: index + 1,
      rings: entite.geometrie.type === 'polygone' ? entite.geometrie.anneaux : [],
      attributes: attributs,
      wkt,
    };
  });

  return { features, colonnes: [...colonnes], points, sansGeometrie };
}

/**
 * Surface admissible déclarée, convertie en hectares.
 *
 * L'unité n'est écrite nulle part dans le fichier. Elle a été établie en
 * comparant, sur les 113 parcelles du dossier 2026 qui la portent, la valeur
 * déclarée à l'aire calculée sur la géométrie : le rapport médian vaut 1,0000
 * quand la valeur est lue en ares, soit deux ordres de grandeur d'écart avec
 * n'importe quelle autre lecture plausible.
 *
 * Cette surface n'est **pas** la surface graphique, et l'écart n'a pas toujours
 * le signe qu'on attendrait. Sur le dossier 2026 examiné, 9 parcelles sur 113
 * portent une surface admissible **supérieure** à leur propre géométrie —
 * jusqu'à 1,08 ha pour l'une d'elles — alors qu'au niveau de l'îlot les deux
 * totaux se rejoignent (548,57 ares de géométrie contre 549 déclarés pour
 * l'îlot 22). La cause n'a pas pu être vérifiée faute de notice ; elle n'est
 * donc pas écrite ici comme un fait.
 *
 * Deux conséquences, elles, sont sûres :
 *
 *   · cette valeur ne remplace jamais l'aire mesurée sur la géométrie, qui
 *     reste ce que Parcelys tient pour la surface de la parcelle ;
 *   · un écart entre les deux n'est **pas** une anomalie et ne doit pas être
 *     signalé comme telle. Le faire produirait une alerte sur des parcelles
 *     parfaitement déclarées — le genre de faux positif qui apprend à
 *     l'utilisateur à ne plus lire les alertes.
 */
export function surfaceAdmissibleHa(brut: string | number | null | undefined): number | null {
  if (brut === null || brut === undefined || brut === '') return null;
  const ares = Number(brut);
  if (!Number.isFinite(ares)) return null;
  return ares / 100;
}

/** Nature d'une couche issue du XML. Aucune heuristique : la source est connue. */
export function kindPourCouche(couche: 'ilots' | 'parcelles' | 'sna' | 'zdh'): PacFeatureKind {
  if (couche === 'parcelles') return 'PARCELLE';
  if (couche === 'sna') return 'SNA';
  if (couche === 'zdh') return 'ZDH';
  return 'AUTRE';
}

/**
 * Correspondance des colonnes pour une couche issue du XML.
 *
 * Rien n'est deviné ici : contrairement au Shapefile, dont les noms de colonnes
 * varient d'un producteur à l'autre, la structure XML est celle qui vient
 * d'être lue. La correspondance est donc **établie**, et marquée « constatée »
 * — ni « proposée », ce qui serait se sous-estimer, ni « officielle », ce qui
 * serait s'attribuer une notice qu'on n'a pas lue.
 *
 * `area` reste délibérément vide. Le champ sert à comparer une surface déclarée
 * à celle mesurée sur la géométrie, et le seul candidat du fichier —
 * `surface-admissible` — ne mesure pas la même chose : les rattacher ferait
 * apparaître un écart sur des parcelles correctes.
 */
export function mappingPourCouche(
  couche: 'ilots' | 'parcelles' | 'sna' | 'zdh',
  colonnes: string[],
): FieldMapping {
  const etabli = (column: string | null): FieldGuess => ({
    column: column && colonnes.includes(column) ? column : null,
    confidence: column && colonnes.includes(column) ? 'constate' : 'inconnu',
    candidates: colonnes,
  });

  if (couche === 'ilots') {
    return {
      externalId: etabli('numero-ilot-reference'),
      ilot: etabli('numero-ilot'),
      numero: etabli('numero-ilot'),
      cropCode: etabli(null),
      cropLabel: etabli(null),
      area: etabli(null),
    };
  }

  if (couche === 'parcelles') {
    return {
      externalId: etabli(null),
      ilot: etabli('numero-ilot'),
      numero: etabli('numero-parcelle'),
      cropCode: etabli('code-culture'),
      // Le fichier ne porte que le code, jamais son libellé. Le laisser vide
      // est la seule réponse honnête : un libellé inventé dans un dossier de
      // contrôle est pire qu'un code brut.
      cropLabel: etabli(null),
      area: etabli(null),
    };
  }

  // `numero-sna` / `numero-zdh` : l'identifiant canonique posé à la lecture,
  // qui vaut aussi pour les ZDH dessinées par l'exploitant.
  const identifiant = couche === 'sna' ? 'numero-sna' : 'numero-zdh';
  return {
    externalId: etabli(identifiant),
    ilot: etabli(null),
    numero: etabli(identifiant),
    cropCode: etabli(null),
    cropLabel: etabli(null),
    area: etabli(null),
  };
}

/**
 * Ce que Parcelys peut affirmer d'un dossier XML, et sur quoi il s'appuie.
 *
 * Affiché tel quel avant l'import. L'utilisateur doit pouvoir juger de la
 * solidité de ce qu'on lui montre, y compris quand elle est moyenne.
 */
export function provenanceXml(declaration: TelepacDeclaration): string {
  const version = declaration.fichierXsd ?? 'non annoncée';
  const campagne =
    declaration.campagne === 'Courante'
      ? 'campagne en cours'
      : declaration.campagne === 'Precedente'
        ? 'campagne antérieure'
        : (declaration.campagne ?? 'campagne non précisée');

  return (
    `Dossier XML TéléPAC, schéma « ${version} » (${campagne}). ` +
    "La structure a été établie en confrontant cinq exports réels, sans notice officielle : " +
    'les correspondances ci-dessous sont constatées, pas certifiées. ' +
    "Le fichier ne déclare pas son système de coordonnées — celui qui est proposé l'est " +
    "d'après l'emprise des géométries. Vérifiez-le : un parcellaire projeté depuis le " +
    'mauvais système atterrit à des centaines de kilomètres.'
  );
}
