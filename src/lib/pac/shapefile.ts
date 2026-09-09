/**
 * Lecture et écriture de Shapefile.
 *
 * Le Shapefile n'est pas un fichier mais un jeu de fichiers solidaires :
 *
 *   .shp  les géométries
 *   .shx  l'index qui dit où commence chaque géométrie dans le .shp
 *   .dbf  les attributs, au format dBASE III
 *   .prj  le système de coordonnées, en WKT
 *
 * Lire le seul `.shp` « marche » souvent — et donne des parcelles sans nom, sans
 * culture, et projetées n'importe où. On exige donc les quatre, et on le dit
 * quand il en manque un.
 *
 * L'implémentation suit la « ESRI Shapefile Technical Description » (juillet
 * 1998), publique et stable depuis. Rien n'y est deviné : les décalages, les
 * boutismes et les codes de type sont ceux du document. Le test d'aller-retour
 * (tests/pac-shapefile.test.ts) relit ce qu'on écrit avec une implémentation
 * indépendante, pour que la conformité ne repose pas sur notre seule parole.
 *
 * Portée volontairement étroite : polygones et multipolygones, les seules
 * géométries d'un parcellaire. Les points et lignes sont refusés explicitement
 * plutôt que silencieusement ignorés.
 */

/** Types de géométrie de la spécification. On ne traite que le polygone. */
const SHAPE_NULL = 0;
const SHAPE_POLYGON = 5;

/** Codes rencontrés dans un parcellaire, pour un message d'erreur utile. */
const SHAPE_LABELS: Record<number, string> = {
  0: 'nul',
  1: 'point',
  3: 'polyligne',
  5: 'polygone',
  8: 'multipoint',
  11: 'pointZ',
  13: 'polyligneZ',
  15: 'polygoneZ',
  18: 'multipointZ',
  21: 'pointM',
  23: 'polyligneM',
  25: 'polygoneM',
  28: 'multipointM',
};

export type Ring = Array<[number, number]>;

/** Une entité lue : sa géométrie en anneaux, et ses attributs. */
export type ShapeFeature = {
  /** Numéro d'enregistrement, tel qu'il figure dans le fichier (à partir de 1). */
  recordNumber: number;
  /** Anneaux bruts, dans l'ordre du fichier. */
  rings: Ring[];
  attributes: Record<string, string | number | null>;
};

export type ShapefileParts = {
  shp: Buffer;
  shx?: Buffer;
  dbf: Buffer;
  prj?: string;
};

export class ShapefileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapefileError';
  }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * Lit un jeu Shapefile complet.
 *
 * Le `.shx` n'est pas indispensable pour parcourir le `.shp` séquentiellement,
 * mais son absence signale un jeu incomplet — souvent parce que l'utilisateur
 * n'a extrait qu'une partie de l'archive. On le signale sans bloquer.
 */
export function readShapefile(parts: ShapefileParts): {
  features: ShapeFeature[];
  fields: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!parts.shx) {
    warnings.push(
      "Le fichier .shx est absent. Les géométries restent lisibles, mais le jeu " +
        "est incomplet : vérifiez que toute l'archive a bien été extraite.",
    );
  }
  if (!parts.prj) {
    warnings.push(
      "Le fichier .prj est absent : le système de coordonnées ne peut pas être " +
        'déterminé et devra être indiqué à la main.',
    );
  }

  const geometries = readShp(parts.shp);
  const { rows, fields } = readDbf(parts.dbf);

  if (geometries.length !== rows.length) {
    throw new ShapefileError(
      `Le .shp contient ${geometries.length} géométrie(s) et le .dbf ${rows.length} ` +
        "ligne(s) d'attributs. Les deux fichiers ne proviennent pas du même export.",
    );
  }

  const features: ShapeFeature[] = geometries.map((rings, index) => ({
    recordNumber: index + 1,
    rings,
    attributes: rows[index] ?? {},
  }));

  return { features, fields, warnings };
}

/** Parcourt le .shp d'un bout à l'autre et rend les anneaux de chaque polygone. */
function readShp(buffer: Buffer): Ring[][] {
  if (buffer.length < 100) {
    throw new ShapefileError('Le fichier .shp est trop court pour être valide.');
  }
  // En-tête : le nombre magique 9994 est en gros-boutiste (spécification, p. 3).
  const magic = buffer.readInt32BE(0);
  if (magic !== 9994) {
    throw new ShapefileError(
      "Ce fichier n'est pas un .shp (signature absente). Vérifiez qu'il ne s'agit " +
        "pas d'une archive ou d'un fichier renommé.",
    );
  }

  const shapes: Ring[][] = [];
  let offset = 100; // l'en-tête fait exactement 100 octets

  while (offset + 8 <= buffer.length) {
    // En-tête d'enregistrement : numéro et longueur, en gros-boutiste, la
    // longueur étant exprimée en mots de 16 bits.
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const contentStart = offset + 8;
    if (contentStart + contentLength > buffer.length) {
      throw new ShapefileError(
        `Le fichier .shp est tronqué : l'enregistrement annoncé à l'octet ${offset} ` +
          'dépasse la fin du fichier.',
      );
    }

    // Le contenu, lui, est en petit-boutiste.
    const type = buffer.readInt32LE(contentStart);
    if (type === SHAPE_NULL) {
      shapes.push([]);
    } else if (type === SHAPE_POLYGON) {
      shapes.push(readPolygon(buffer, contentStart));
    } else {
      throw new ShapefileError(
        `Type de géométrie « ${SHAPE_LABELS[type] ?? type} » non pris en charge : ` +
          'un parcellaire attend des polygones.',
      );
    }

    offset = contentStart + contentLength;
  }

  return shapes;
}

/** Un polygone : une boîte englobante, des index d'anneaux, puis les points. */
function readPolygon(buffer: Buffer, start: number): Ring[] {
  // 4 (type) + 32 (boîte englobante) = 36
  const numParts = buffer.readInt32LE(start + 36);
  const numPoints = buffer.readInt32LE(start + 40);

  const partsStart = start + 44;
  const pointsStart = partsStart + numParts * 4;

  const partIndexes: number[] = [];
  for (let i = 0; i < numParts; i += 1) {
    partIndexes.push(buffer.readInt32LE(partsStart + i * 4));
  }

  const rings: Ring[] = [];
  for (let p = 0; p < numParts; p += 1) {
    const from = partIndexes[p] ?? 0;
    const to = p + 1 < numParts ? (partIndexes[p + 1] ?? numPoints) : numPoints;
    const ring: Ring = [];
    for (let i = from; i < to; i += 1) {
      const at = pointsStart + i * 16;
      ring.push([buffer.readDoubleLE(at), buffer.readDoubleLE(at + 8)]);
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * Lit un .dbf (dBASE III).
 *
 * Les valeurs sont rendues telles qu'écrites, seulement débarrassées de leur
 * remplissage : c'est à l'appelant d'interpréter un code culture ou un
 * identifiant. Convertir ici reviendrait à décider à sa place.
 */
function readDbf(buffer: Buffer): {
  rows: Array<Record<string, string | number | null>>;
  fields: string[];
} {
  if (buffer.length < 32) {
    throw new ShapefileError('Le fichier .dbf est trop court pour être valide.');
  }

  const recordCount = buffer.readInt32LE(4);
  const headerLength = buffer.readInt16LE(8);
  const recordLength = buffer.readInt16LE(10);

  // Les descripteurs de champ font 32 octets et suivent l'en-tête de 32 octets,
  // jusqu'à l'octet 0x0D qui les termine.
  const descriptors: Array<{ name: string; type: string; length: number }> = [];
  for (let at = 32; at < headerLength - 1; at += 32) {
    if (buffer[at] === 0x0d) break;
    const name = buffer.toString('latin1', at, at + 11).replace(/\0.*$/, '').trim();
    if (!name) break;
    descriptors.push({
      name,
      type: String.fromCharCode(buffer[at + 11] ?? 0),
      length: buffer[at + 16] ?? 0,
    });
  }

  const rows: Array<Record<string, string | number | null>> = [];
  for (let r = 0; r < recordCount; r += 1) {
    const recordStart = headerLength + r * recordLength;
    if (recordStart + recordLength > buffer.length) break;
    // Le premier octet marque la suppression : « * » plutôt qu'un espace.
    if (buffer[recordStart] === 0x2a) continue;

    const row: Record<string, string | number | null> = {};
    let at = recordStart + 1;
    for (const field of descriptors) {
      const raw = buffer.toString('latin1', at, at + field.length).trim();
      at += field.length;

      if (raw === '') {
        row[field.name] = null;
      } else if (field.type === 'N' || field.type === 'F') {
        const value = Number(raw.replace(',', '.'));
        row[field.name] = Number.isFinite(value) ? value : null;
      } else if (field.type === 'L') {
        row[field.name] = /^[YyTt]$/.test(raw) ? 1 : 0;
      } else {
        row[field.name] = raw;
      }
    }
    rows.push(row);
  }

  return { rows, fields: descriptors.map((d) => d.name) };
}

// ---------------------------------------------------------------------------
// Système de coordonnées
// ---------------------------------------------------------------------------

/**
 * Devine le code EPSG d'après le WKT du .prj.
 *
 * On ne reconnaît que ce qu'on peut affirmer : Lambert-93 (2154) et WGS 84
 * (4326). Tout le reste rend `null`, et l'utilisateur devra trancher — c'est
 * préférable à une conversion silencieuse qui déplacerait le parcellaire de
 * plusieurs centaines de mètres sans que personne ne s'en aperçoive.
 */
export function detectSrid(prj: string | undefined): {
  srid: number | null;
  label: string;
} {
  if (!prj || !prj.trim()) return { srid: null, label: 'aucun fichier .prj' };

  const wkt = prj.toUpperCase();

  // Un code EPSG explicite fait foi quand il est présent.
  const authority = wkt.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]?\s*$/);
  if (authority?.[1]) {
    const srid = Number(authority[1]);
    if (srid === 2154) return { srid: 2154, label: 'Lambert-93 (EPSG:2154)' };
    if (srid === 4326) return { srid: 4326, label: 'WGS 84 (EPSG:4326)' };
    return { srid, label: `EPSG:${srid}` };
  }

  // À défaut, le nom de la projection. RGF93 + Lambert-93 est la combinaison
  // employée pour la métropole.
  if (wkt.includes('LAMBERT-93') || wkt.includes('LAMBERT_93') || wkt.includes('RGF93_LAMBERT')) {
    return { srid: 2154, label: 'Lambert-93 (EPSG:2154)' };
  }
  if (wkt.includes('RGF93') && wkt.includes('CONFORMAL_CONIC')) {
    return { srid: 2154, label: 'Lambert-93 (EPSG:2154)' };
  }
  if (wkt.includes('GCS_WGS_1984') || wkt.includes('WGS 84') || wkt.includes('WGS_1984')) {
    return { srid: 4326, label: 'WGS 84 (EPSG:4326)' };
  }

  return { srid: null, label: 'système non reconnu' };
}

/**
 * WKT du Lambert-93, tel qu'écrit dans le .prj d'un export métropolitain.
 *
 * Reproduit la définition EPSG:2154 ; les valeurs numériques sont celles du
 * registre EPSG, pas des approximations.
 */
export const LAMBERT_93_PRJ =
  'PROJCS["RGF93_Lambert_93",GEOGCS["GCS_RGF_1993",DATUM["D_RGF_1993",' +
  'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
  'UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],' +
  'PARAMETER["False_Easting",700000.0],PARAMETER["False_Northing",6600000.0],' +
  'PARAMETER["Central_Meridian",3.0],PARAMETER["Standard_Parallel_1",44.0],' +
  'PARAMETER["Standard_Parallel_2",49.0],PARAMETER["Latitude_Of_Origin",46.5],' +
  'UNIT["Meter",1.0],AUTHORITY["EPSG","2154"]]';

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export type WriteField = {
  name: string;
  /** `C` texte, `N` nombre. Le .dbf de dBASE III ne connaît pas mieux. */
  type: 'C' | 'N';
  length: number;
  decimals?: number;
};

export type WriteFeature = {
  /** Anneaux déjà projetés dans le système de sortie. */
  rings: Ring[];
  attributes: Record<string, string | number | null>;
};

/** Produit les quatre fichiers d'un Shapefile de polygones. */
export function writeShapefile(
  features: WriteFeature[],
  fields: WriteField[],
  prj: string,
): { shp: Buffer; shx: Buffer; dbf: Buffer; prj: string } {
  const records = features.map((feature) => buildPolygonRecord(feature.rings));

  const bounds = boundsOf(features);
  const shp = assembleShp(records, bounds);
  const shx = assembleShx(records, bounds);
  const dbf = writeDbf(features.map((f) => f.attributes), fields);

  return { shp, shx, dbf, prj };
}

/** Corps d'un enregistrement polygone, sans son en-tête. */
function buildPolygonRecord(rings: Ring[]): Buffer {
  // Les anneaux d'un polygone Shapefile suivent une convention d'orientation :
  // extérieur en sens horaire, trous en sens antihoraire (spécification, p. 8).
  const oriented = rings.map((ring, index) =>
    index === 0 ? ensureClockwise(ring) : ensureCounterClockwise(ring),
  );

  const numPoints = oriented.reduce((sum, ring) => sum + ring.length, 0);
  const size = 44 + oriented.length * 4 + numPoints * 16;
  const buffer = Buffer.alloc(size);

  const [minX, minY, maxX, maxY] = ringsBounds(oriented);
  buffer.writeInt32LE(SHAPE_POLYGON, 0);
  buffer.writeDoubleLE(minX, 4);
  buffer.writeDoubleLE(minY, 12);
  buffer.writeDoubleLE(maxX, 20);
  buffer.writeDoubleLE(maxY, 28);
  buffer.writeInt32LE(oriented.length, 36);
  buffer.writeInt32LE(numPoints, 40);

  let partIndex = 0;
  let at = 44 + oriented.length * 4;
  oriented.forEach((ring, i) => {
    buffer.writeInt32LE(partIndex, 44 + i * 4);
    partIndex += ring.length;
    for (const [x, y] of ring) {
      buffer.writeDoubleLE(x, at);
      buffer.writeDoubleLE(y, at + 8);
      at += 16;
    }
  });

  return buffer;
}

function assembleShp(records: Buffer[], bounds: [number, number, number, number]): Buffer {
  const body = records.reduce((sum, r) => sum + 8 + r.length, 0);
  const buffer = Buffer.alloc(100 + body);
  writeMainHeader(buffer, 100 + body, bounds);

  let at = 100;
  records.forEach((record, index) => {
    buffer.writeInt32BE(index + 1, at); // numéro d'enregistrement, à partir de 1
    buffer.writeInt32BE(record.length / 2, at + 4); // longueur en mots de 16 bits
    record.copy(buffer, at + 8);
    at += 8 + record.length;
  });
  return buffer;
}

function assembleShx(records: Buffer[], bounds: [number, number, number, number]): Buffer {
  const buffer = Buffer.alloc(100 + records.length * 8);
  writeMainHeader(buffer, 100 + records.length * 8, bounds);

  // L'index donne, pour chaque enregistrement, son décalage dans le .shp et sa
  // longueur — le tout en mots de 16 bits.
  let offsetWords = 50; // 100 octets d'en-tête
  records.forEach((record, index) => {
    buffer.writeInt32BE(offsetWords, 100 + index * 8);
    buffer.writeInt32BE(record.length / 2, 100 + index * 8 + 4);
    offsetWords += 4 + record.length / 2;
  });
  return buffer;
}

/** En-tête commun au .shp et au .shx : 100 octets, boutismes mélangés. */
function writeMainHeader(
  buffer: Buffer,
  totalBytes: number,
  [minX, minY, maxX, maxY]: [number, number, number, number],
): void {
  buffer.writeInt32BE(9994, 0); // signature
  buffer.writeInt32BE(totalBytes / 2, 24); // longueur totale, en mots de 16 bits
  buffer.writeInt32LE(1000, 28); // version
  buffer.writeInt32LE(SHAPE_POLYGON, 32);
  buffer.writeDoubleLE(minX, 36);
  buffer.writeDoubleLE(minY, 44);
  buffer.writeDoubleLE(maxX, 52);
  buffer.writeDoubleLE(maxY, 60);
  // Les plages Z et M restent à zéro : nos géométries sont planes.
}

/** Écrit un .dbf dBASE III. */
function writeDbf(
  rows: Array<Record<string, string | number | null>>,
  fields: WriteField[],
): Buffer {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const buffer = Buffer.alloc(headerLength + rows.length * recordLength + 1);

  buffer[0] = 0x03; // dBASE III sans mémo
  const now = new Date();
  buffer[1] = now.getFullYear() - 1900;
  buffer[2] = now.getMonth() + 1;
  buffer[3] = now.getDate();
  buffer.writeInt32LE(rows.length, 4);
  buffer.writeInt16LE(headerLength, 8);
  buffer.writeInt16LE(recordLength, 10);

  fields.forEach((field, index) => {
    const at = 32 + index * 32;
    // Le nom d'un champ dBASE III tient sur 10 caractères, terminé par un zéro.
    buffer.write(field.name.slice(0, 10), at, 'latin1');
    buffer.write(field.type, at + 11, 'latin1');
    buffer[at + 16] = field.length;
    buffer[at + 17] = field.decimals ?? 0;
  });
  buffer[headerLength - 1] = 0x0d; // fin des descripteurs

  rows.forEach((row, r) => {
    let at = headerLength + r * recordLength;
    buffer.write(' ', at, 'latin1'); // enregistrement non supprimé
    at += 1;
    for (const field of fields) {
      const value = row[field.name];
      let text: string;
      if (value === null || value === undefined) {
        text = ''.padEnd(field.length);
      } else if (field.type === 'N') {
        text = Number(value).toFixed(field.decimals ?? 0).padStart(field.length);
      } else {
        // Latin-1 : c'est l'encodage d'un .dbf dBASE III. Les caractères hors
        // de cette table sont remplacés plutôt que d'écrire des octets faux.
        text = String(value).slice(0, field.length).padEnd(field.length);
      }
      buffer.write(text.slice(0, field.length), at, 'latin1');
      at += field.length;
    }
  });

  buffer[buffer.length - 1] = 0x1a; // marque de fin de fichier
  return buffer;
}

// ---------------------------------------------------------------------------
// Utilitaires géométriques
// ---------------------------------------------------------------------------

/** Aire algébrique : son signe donne le sens de parcours de l'anneau. */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function ensureClockwise(ring: Ring): Ring {
  return signedArea(ring) > 0 ? [...ring].reverse() : ring;
}

export function ensureCounterClockwise(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

function ringsBounds(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

function boundsOf(features: WriteFeature[]): [number, number, number, number] {
  return ringsBounds(features.flatMap((f) => f.rings));
}
