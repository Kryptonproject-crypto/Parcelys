import { parse } from 'csv-parse/sync';
import {
  normalizeHeader,
  type ColumnMap,
} from '@/lib/ephy/schema';

export type CsvRow = Record<string, string>;

/**
 * Décode un CSV E-Phy. Les exports officiels sont diffusés en Windows-1252 ;
 * on détecte un éventuel BOM UTF-8 et on bascule le décodeur en conséquence.
 */
export function decodeCsv(buffer: Buffer): string {
  const hasUtf8Bom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf;

  if (hasUtf8Bom) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }

  // Une séquence UTF-8 valide sans caractère de remplacement indique de l'UTF-8.
  const asUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!asUtf8.includes('�')) return asUtf8;

  return new TextDecoder('windows-1252').decode(buffer);
}

/** Détecte le séparateur (`;` dans les exports E-Phy, `,` en secours). */
function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] ? (counts[0][0] as string) : ';';
}

export function parseCsv(buffer: Buffer): CsvRow[] {
  const text = decodeCsv(buffer);
  return parse(text, {
    columns: true,
    delimiter: detectDelimiter(text),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    bom: true,
  }) as CsvRow[];
}

/**
 * Construit la table de correspondance entre les champs internes et les
 * intitulés réellement présents dans le fichier. Les champs sans colonne
 * correspondante restent `null` — ils ne seront pas renseignés.
 */
export function resolveColumns<T extends string>(
  headers: string[],
  columnMap: ColumnMap<T>,
): { resolved: Record<T, string | null>; missing: T[] } {
  const normalized = new Map<string, string>();
  for (const header of headers) {
    normalized.set(normalizeHeader(header), header);
  }

  const resolved = {} as Record<T, string | null>;
  const missing: T[] = [];

  for (const field of Object.keys(columnMap) as T[]) {
    const aliases = columnMap[field];
    let match: string | null = null;

    // 1. correspondance exacte sur un alias
    for (const alias of aliases) {
      const found = normalized.get(alias);
      if (found) {
        match = found;
        break;
      }
    }

    // 2. correspondance par préfixe (colonnes suffixées par une unité)
    if (!match) {
      for (const alias of aliases) {
        for (const [key, original] of normalized) {
          if (key.startsWith(alias) || alias.startsWith(key)) {
            match = original;
            break;
          }
        }
        if (match) break;
      }
    }

    resolved[field] = match;
    if (!match) missing.push(field);
  }

  return { resolved, missing };
}

export function pick<T extends string>(
  row: CsvRow,
  resolved: Record<T, string | null>,
  field: T,
): string | undefined {
  const column = resolved[field];
  if (!column) return undefined;
  const value = row[column];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Convertit une date E-Phy (`JJ/MM/AAAA` ou ISO) sans supposer de valeur. */
export function parseFrenchDate(value: string | undefined): Date | null {
  if (!value) return null;

  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (fr) {
    const [, day, month, year] = fr;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = Date.parse(value);
  return Number.isNaN(iso) ? null : new Date(iso);
}

/** Découpe une liste de substances actives (« A | B », « A, B », « A ; B »). */
export function splitSubstances(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[|;]/)
    .flatMap((part) => (part.includes(',') && !/\d,\d/.test(part) ? part.split(',') : [part]))
    .map((part) =>
      part
        // supprime la concentration accolée : « glyphosate 360 g/L »
        .replace(/\((.*?)\)/g, ' ')
        .trim(),
    )
    .filter((part) => part.length > 1);
}
