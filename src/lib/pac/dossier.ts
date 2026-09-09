/**
 * Lecture d'un dossier TéléPAC déposé par l'utilisateur.
 *
 * L'utilisateur dépose ce qu'il a téléchargé depuis TéléPAC : une archive ZIP,
 * ou les fichiers un à un. On ne lui demande jamais ses identifiants TéléPAC —
 * Parcelys ne se connecte pas au portail, il travaille sur les fichiers fournis.
 *
 * Le travail de ce module est de faire le tri : reconnaître les jeux Shapefile
 * (quatre fichiers qui vont ensemble), signaler ceux qui sont incomplets, et
 * ignorer poliment le reste — un dossier TéléPAC contient aussi des PDF, des
 * XML et des fichiers d'accompagnement dont ce module n'a que faire.
 */

import { Open } from 'unzipper';
import path from 'node:path';
import { detectSrid, readShapefile, type ShapeFeature } from '@/lib/pac/shapefile';
import { getTelepacAdapter, looksLikeIlotLayer } from '@/lib/pac/adapter';
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
};

export type DossierReadResult = {
  layers: DossierLayer[];
  /** Fichiers reçus mais dont ce module ne fait rien. */
  ignored: string[];
  /** Problèmes qui empêchent d'exploiter une partie du dossier. */
  problems: string[];
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

  for (const file of plats) {
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

  if (groupes.size === 0) {
    throw new DossierError(
      "Aucun jeu de données géographiques n'a été trouvé dans ce dépôt. " +
        'Un export graphique TéléPAC contient au minimum un fichier .shp, ' +
        'accompagné de ses .shx, .dbf et .prj.',
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
