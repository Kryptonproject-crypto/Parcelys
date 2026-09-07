import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@/lib/env';
import { badRequest } from '@/lib/api/errors';

/**
 * Types de fichiers acceptés. La validation croise l'extension, le type MIME
 * déclaré et la signature binaire réelle : un exécutable renommé en `.pdf`
 * est rejeté.
 */
const ALLOWED: Array<{
  extensions: string[];
  mimeTypes: string[];
  /** Signature en tête de fichier (magic bytes). */
  magic?: number[][];
}> = [
  {
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  {
    extensions: ['.jpg', '.jpeg'],
    mimeTypes: ['image/jpeg'],
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    extensions: ['.png'],
    mimeTypes: ['image/png'],
    magic: [[0x89, 0x50, 0x4e, 0x47]],
  },
  {
    extensions: ['.webp'],
    mimeTypes: ['image/webp'],
    magic: [[0x52, 0x49, 0x46, 0x46]], // RIFF
  },
  {
    extensions: ['.csv', '.txt'],
    mimeTypes: ['text/csv', 'text/plain', 'application/csv'],
  },
  {
    extensions: ['.xlsx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    magic: [[0x50, 0x4b, 0x03, 0x04]], // ZIP
  },
];

export const ALLOWED_EXTENSIONS = ALLOWED.flatMap((a) => a.extensions);

function matchesMagic(buffer: Buffer, signatures: number[][]): boolean {
  return signatures.some((signature) =>
    signature.every((byte, index) => buffer[index] === byte),
  );
}

export type ValidatedFile = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  buffer: Buffer;
};

/** Valide un fichier téléversé (extension, taille, MIME, signature). */
export function validateUpload(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): ValidatedFile {
  const env = getEnv();
  const extension = path.extname(params.fileName).toLowerCase();

  if (!extension) throw badRequest('Le fichier doit avoir une extension.');

  const rule = ALLOWED.find((a) => a.extensions.includes(extension));
  if (!rule) {
    throw badRequest(
      `Extension « ${extension} » non autorisée. Formats acceptés : ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }

  if (params.buffer.length === 0) throw badRequest('Le fichier est vide.');
  if (params.buffer.length > env.UPLOAD_MAX_BYTES) {
    throw badRequest(
      `Fichier trop volumineux (max ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)} Mo).`,
    );
  }

  const declaredMime = params.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (declaredMime && !rule.mimeTypes.includes(declaredMime)) {
    throw badRequest(
      `Le type déclaré (${declaredMime}) ne correspond pas à l'extension ${extension}.`,
    );
  }

  if (rule.magic && !matchesMagic(params.buffer, rule.magic)) {
    throw badRequest(
      "Le contenu du fichier ne correspond pas à son extension. Téléversement refusé.",
    );
  }

  // Nom de fichier assaini : ni séparateur de chemin, ni caractère de contrôle.
  const safeName = path
    .basename(params.fileName)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .slice(0, 180);

  return {
    fileName: safeName,
    mimeType: declaredMime || rule.mimeTypes[0] || 'application/octet-stream',
    sizeBytes: params.buffer.length,
    checksum: createHash('sha256').update(params.buffer).digest('hex'),
    buffer: params.buffer,
  };
}

/**
 * Écrit le fichier sous un nom aléatoire, dans un dossier propre à
 * l'exploitation. Le nom d'origine n'est jamais utilisé sur le disque, ce qui
 * élimine tout risque de traversée de répertoire.
 */
export async function storeDocument(
  farmId: string,
  file: ValidatedFile,
): Promise<string> {
  const env = getEnv();
  const extension = path.extname(file.fileName).toLowerCase();
  const storageKey = path.posix.join(farmId, `${randomUUID()}${extension}`);
  const absolutePath = path.join(path.resolve(env.UPLOAD_DIR), storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer, { mode: 0o640 });

  return storageKey;
}

/** Résout une clé de stockage en chemin absolu, en refusant toute évasion. */
function resolveStoragePath(storageKey: string): string {
  const root = path.resolve(getEnv().UPLOAD_DIR);
  const absolute = path.resolve(root, storageKey);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw badRequest('Chemin de fichier invalide.');
  }
  return absolute;
}

export async function readDocument(storageKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageKey));
}

export async function deleteDocument(storageKey: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}

export { formatBytes } from '@/lib/storage/format';
