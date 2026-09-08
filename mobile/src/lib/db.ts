import { openDB, type IDBPDatabase } from 'idb';
import type { QueuedOperation, Snapshot } from './types';

/**
 * Base locale de l'appareil.
 *
 * Deux magasins :
 *  - `cache` : le dernier instantané reçu du serveur, pour que l'application
 *    reste consultable sans réseau ;
 *  - `outbox` : les saisies faites hors ligne, en attente d'envoi.
 *
 * IndexedDB plutôt que `localStorage` : les géométries de parcelles dépassent
 * vite le mégaoctet, et l'écriture doit être transactionnelle — perdre une
 * saisie de traitement phytosanitaire n'est pas une option.
 */

const DB_NAME = 'parcelys';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';
const SNAPSHOT_KEY = 'snapshot';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        database.createObjectStore(CACHE_STORE);
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        // La clé est l'identifiant client : réenregistrer une opération la
        // remplace au lieu de la dupliquer.
        database.createObjectStore(OUTBOX_STORE, { keyPath: 'clientId' });
      }
    },
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Instantané
// ---------------------------------------------------------------------------

export async function readSnapshot(): Promise<Snapshot | null> {
  return ((await (await db()).get(CACHE_STORE, SNAPSHOT_KEY)) as Snapshot) ?? null;
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await (await db()).put(CACHE_STORE, snapshot, SNAPSHOT_KEY);
}

export async function clearCache(): Promise<void> {
  const database = await db();
  await database.clear(CACHE_STORE);
}

// ---------------------------------------------------------------------------
// File d'attente
// ---------------------------------------------------------------------------

export async function readOutbox(): Promise<QueuedOperation[]> {
  const operations = (await (await db()).getAll(OUTBOX_STORE)) as QueuedOperation[];
  // L'ordre de saisie compte : une parcelle créée au champ doit partir avant
  // les interventions qui s'y rattachent.
  return operations.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function enqueue(operation: QueuedOperation): Promise<void> {
  await (await db()).put(OUTBOX_STORE, operation);
}

export async function dequeue(clientId: string): Promise<void> {
  await (await db()).delete(OUTBOX_STORE, clientId);
}

export async function updateQueued(
  clientId: string,
  changes: Partial<QueuedOperation>,
): Promise<void> {
  const database = await db();
  const existing = (await database.get(OUTBOX_STORE, clientId)) as
    | QueuedOperation
    | undefined;
  if (!existing) return;
  await database.put(OUTBOX_STORE, { ...existing, ...changes });
}

export async function outboxCount(): Promise<number> {
  return (await db()).count(OUTBOX_STORE);
}

export async function clearOutbox(): Promise<void> {
  await (await db()).clear(OUTBOX_STORE);
}
