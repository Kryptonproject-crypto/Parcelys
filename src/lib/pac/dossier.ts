/**
 * Lecture d'un dossier TéléPAC déposé par l'utilisateur.
 *
 * L'utilisateur dépose ce qu'il a téléchargé depuis TéléPAC : une archive ZIP,
 * ou les fichiers un à un. On ne lui demande jamais ses identifiants TéléPAC —
 * Parcelys ne se connecte pas au portail, il travaille sur les fichiers fournis.
 *
 * Deux formats sont lus, parce que TéléPAC en propose deux :
 *
 *   · l'**export graphique**, un jeu Shapefile (quatre fichiers qui vont
 *     ensemble) ;
 *   · le **dossier lui-même**, en XML.
 *
 * Le second a longtemps été ignoré « poliment », ce qui revenait à refuser le
 * fichier que TéléPAC donne spontanément à l'exploitant. Les deux formats
 * produisent désormais la même chose — des `DossierLayer` — et empruntent
 * ensuite exactement le même chemin : analyse, rapprochement, sauvegarde,
 * écriture. Une seule chaîne à vérifier, pas deux.
 */

import { Open } from 'unzipper';
import path from 'node:path';
import { detectSrid, readShapefile, type ShapeFeature } from '@/lib/pac/shapefile';
import { getTelepacAdapter, looksLikeIlotLayer, type FieldMapping } from '@/lib/pac/adapter';
import {
  lireTelepacXml,
  versShapeFeatures,
  sridProbable,
  kindPourCouche,
  mappingPourCouche,
  provenanceXml,
  TelepacXmlError,
  type TelepacDeclaration,
  type TelepacEntite,
} from '@/lib/pac/telepac-xml';
import type { PacFeatureKind } from '@prisma/client';

export type DeposedFile = { name: string; buffer: Buffer };

export type DossierLayer = {
  /** Nom de base commun aux quatre fichiers (« PARCELLES_2026 »). */
  name: string;
  kind: PacFeatureKind;
  isIlotLayer: boolean;
  features: ShapeFeature[];
  columns: string[];
  srid: number | null;
  sridLabel: string;
  warnings: string[];
  /**
   * Correspondance déjà établie, quand la source la donne sans ambiguïté.
   *
   * Le Shapefile ne la fournit pas : ses noms de colonnes varient d'un
   * producteur à l'autre, et l'adaptateur ne peut que proposer. Le XML, lui,
   * porte sa propre structure — la deviner à partir des noms serait faire
   * semblant d'ignorer ce qu'on vient de lire.
   */
  mapping?: FieldMapping;
};

export type DossierReadResult = {
  layers: DossierLayer[];
  /** Fichiers reçus mais dont ce module ne fait rien. */
  ignored: string[];
  /** Problèmes qui empêchent d'exploiter une partie du dossier. */
  problems: string[];
  /**
   * Ce que Parcelys peut affirmer de ce dossier et sur quoi il s'appuie.
   * Absent quand la source ne dit rien d'elle-même (cas du Shapefile).
   */
  provenance?: string;
  /** En-tête du dossier XML : PACAGE, campagne, version de schéma, SIRET. */
  declaration?: TelepacDeclaration;
};

export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DossierError';
  }
}

/** Extensions qui composent un jeu Shapefile. */
const SHAPE_EXTS = new Set(['.shp', '.shx', '.dbf', '.prj', '.cpg']);

/**
 * Développe les archives et rend une liste de fichiers plate.
 *
 * Une archive TéléPAC peut en contenir une autre ; on descend d'un niveau, pas
 * plus — au-delà, c'est probablement que l'utilisateur s'est trompé de fichier,
 * et mieux vaut le lui dire que de fouiller indéfiniment.
 */
export async function flattenFiles(files: DeposedFile[]): Promise<DeposedFile[]> {
  const plats: DeposedFile[] = [];

  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      plats.push(file);
      continue;
    }

    let archive;
    try {
      archive = await Open.buffer(file.buffer);
    } catch {
      throw new DossierError(
        `« ${file.name} » ne peut pas être ouvert comme archive ZIP. ` +
          "Le fichier est peut-être incomplet : retéléchargez-le depuis TéléPAC.",
      );
    }

    for (const entry of archive.files) {
      if (entry.type !== 'File') continue;
      // Les archives portent parfois des dossiers : seul le nom final compte.
      const base = path.basename(entry.path);
      if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
      plats.push({ name: base, buffer: await entry.buffer() });
    }
  }

  return plats;
}

/**
 * Un fichier a-t-il la forme d'un export XML TéléPAC ?
 *
 * L'extension ne suffit pas : un dossier peut contenir d'autres XML
 * (accompagnement, accusés). On regarde donc le début du contenu, où
 * l'espace de noms d'échange producteur est annoncé. Le prologue et la
 * déclaration de racine sont en ASCII, quel que soit l'encodage du reste.
 */
function ressembleAuXmlTelepac(file: DeposedFile): boolean {
  if (!/\.xml$/i.test(file.name)) return false;
  const debut = file.buffer.subarray(0, 2048).toString('ascii');
  return /echange-producteur|<producteurs[\s>]/i.test(debut);
}

/** Une couche par nature d'entité : îlots, parcelles, SNA, ZDH. */
function couchesDuXml(
  nomFichier: string,
  entites: TelepacEntite[],
  couche: 'ilots' | 'parcelles' | 'sna' | 'zdh',
  avertissementsCommuns: string[],
): DossierLayer | null {
  if (entites.length === 0) return null;

  const { features, colonnes, points, sansGeometrie } = versShapeFeatures(entites);
  const anneaux = features.flatMap((f) => f.rings);
  const { srid, label } = sridProbable(anneaux);

  const warnings = [...avertissementsCommuns];
  if (points > 0) {
    warnings.push(
      `${points} entité(s) sont des points et non des surfaces — des arbres isolés, le plus ` +
        'souvent. Leur position est conservée, mais elles n’ont pas de surface : Parcelys ' +
        'ne leur en invente pas.',
    );
  }
  if (sansGeometrie > 0) {
    warnings.push(
      `${sansGeometrie} entité(s) sans géométrie exploitable. Leurs attributs sont conservés.`,
    );
  }

  return {
    name: `${nomFichier.replace(/\.xml$/i, '')} — ${couche}`,
    kind: kindPourCouche(couche),
    isIlotLayer: couche === 'ilots',
    features,
    columns: colonnes,
    srid,
    sridLabel: label,
    warnings,
    mapping: mappingPourCouche(couche, colonnes),
  };
}

/** Regroupe les fichiers en couches et lit celles qui sont exploitables. */
export async function readDossier(
  files: DeposedFile[],
  year: number,
): Promise<DossierReadResult> {
  const plats = await flattenFiles(files);
  const adapter = getTelepacAdapter(year);

  // Regroupement par nom de base : « PARCELLES.shp » et « PARCELLES.dbf »
  // forment une seule couche.
  const groupes = new Map<string, Map<string, Buffer>>();
  const ignored: string[] = [];
  const xmlTelepac: DeposedFile[] = [];

  for (const file of plats) {
    if (ressembleAuXmlTelepac(file)) {
      xmlTelepac.push(file);
      continue;
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!SHAPE_EXTS.has(ext)) {
      ignored.push(file.name);
      continue;
    }
    const base = file.name.slice(0, -ext.length);
    const groupe = groupes.get(base) ?? new Map<string, Buffer>();
    groupe.set(ext, file.buffer);
    groupes.set(base, groupe);
  }

  // ---- Dossier XML --------------------------------------------------------
  //
  // Traité en premier et rendu seul : un dépôt qui contient à la fois le XML et
  // l'export graphique décrit deux fois le même parcellaire. Les mélanger
  // ferait entrer chaque parcelle deux fois.
  if (xmlTelepac.length > 0) {
    const premier = xmlTelepac[0];
    if (!premier) throw new DossierError('Fichier XML illisible.');

    let lu;
    try {
      lu = lireTelepacXml(premier.buffer);
    } catch (cause) {
      if (cause instanceof TelepacXmlError) throw new DossierError(cause.message);
      throw cause;
    }

    const communs = [...lu.warnings];
    for (const autre of xmlTelepac.slice(1)) ignored.push(autre.name);
    if (xmlTelepac.length > 1) {
      communs.push(
        `${xmlTelepac.length} dossiers XML ont été déposés ; seul « ${premier.name} » a été lu. ` +
          'Importez les campagnes une par une : chacune a la sienne.',
      );
    }
    if (groupes.size > 0) {
      communs.push(
        "Un export graphique accompagnait le dossier XML : il a été laissé de côté. " +
          'Les deux décrivent le même parcellaire, et les lire tous les deux importerait ' +
          'chaque parcelle en double.',
      );
      for (const base of groupes.keys()) ignored.push(base);
    }

    const layers = (
      [
        couchesDuXml(premier.name, lu.ilots, 'ilots', communs),
        couchesDuXml(premier.name, lu.parcelles, 'parcelles', communs),
        couchesDuXml(premier.name, lu.sna, 'sna', communs),
        couchesDuXml(premier.name, lu.zdh, 'zdh', communs),
      ] satisfies Array<DossierLayer | null>
    ).filter((c): c is DossierLayer => c !== null);

    if (layers.length === 0) {
      throw new DossierError(
        "Ce dossier XML ne contient ni îlot, ni parcelle, ni SNA, ni ZDH exploitables.",
      );
    }

    return {
      layers,
      ignored,
      // Les branches écartées volontairement (effectifs animaux, demandes
      // d'aides) sont annoncées, pas confondues avec un problème.
      problems: [],
      provenance: `${provenanceXml(lu.declaration)}${
        lu.ignores.length > 0 ? ` Non repris : ${lu.ignores.join(' ')}` : ''
      }`,
      declaration: lu.declaration,
    };
  }

  if (groupes.size === 0) {
    throw new DossierError(
      "Aucune donnée géographique n'a été trouvée dans ce dépôt.\n" +
        'Parcelys lit deux formats, tous deux téléchargeables depuis TéléPAC :\n' +
        '  · le dossier au format XML, tel qu’il est proposé au téléchargement ;\n' +
        '  · l’export graphique, un jeu de fichiers .shp, .shx, .dbf et .prj.\n' +
        (ignored.length > 0
          ? `Reçu, mais d’aucun de ces deux formats : ${ignored.slice(0, 5).join(', ')}.`
          : ''),
    );
  }

  const layers: DossierLayer[] = [];
  const problems: string[] = [];

  for (const [base, parts] of groupes) {
    const shp = parts.get('.shp');
    const dbf = parts.get('.dbf');

    // On ne lit jamais un .shp seul : sans son .dbf, la couche n'aurait ni
    // numéro de parcelle ni culture — des polygones anonymes.
    if (!shp) {
      problems.push(`« ${base} » : fichier .shp manquant, couche ignorée.`);
      continue;
    }
    if (!dbf) {
      problems.push(
        `« ${base} » : fichier .dbf manquant. Les géométries seraient importées ` +
          'sans aucun attribut — ni numéro de parcelle, ni culture. Couche ignorée.',
      );
      continue;
    }

    const prjBuffer = parts.get('.prj');
    const prj = prjBuffer ? prjBuffer.toString('utf8') : undefined;

    try {
      const lu = readShapefile({ shp, shx: parts.get('.shx'), dbf, prj });
      const { srid, label } = detectSrid(prj);

      layers.push({
        name: base,
        kind: adapter.guessKind(base),
        isIlotLayer: looksLikeIlotLayer(base),
        features: lu.features,
        columns: lu.fields,
        srid,
        sridLabel: label,
        warnings: lu.warnings,
      });
    } catch (cause) {
      // Une couche illisible ne doit pas emporter tout le dossier : les autres
      // restent exploitables, et l'utilisateur voit précisément ce qui coince.
      problems.push(
        `« ${base} » : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  if (layers.length === 0) {
    throw new DossierError(
      "Aucune couche n'a pu être lue.\n" + problems.map((p) => `  · ${p}`).join('\n'),
    );
  }

  return { layers, ignored, problems };
}
