import 'server-only';
import os from 'node:os';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';

/**
 * État du serveur, relevé à l'instant, pour l'administrateur général.
 *
 * Lecture seule : aucune commande n'est exposée, et aucun secret n'est lu —
 * ni l'adresse de la base, ni les clés, ni les mots de passe. On montre ce
 * qu'il faut pour savoir si la machine va bien : base, espace disque,
 * mémoire, charge, migrations, compteurs de numéros.
 */

export async function databaseHealth(): Promise<{
  postgres: string;
  postgis: string | null;
  sizeMb: number | null;
  error: string | null;
}> {
  try {
    const [versionRow] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
    const [postgisRow] = await prisma.$queryRaw<Array<{ v: string }>>`SELECT postgis_lib_version() AS v`;
    const [sizeRow] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT pg_database_size(current_database()) AS bytes
    `;
    return {
      // « PostgreSQL 16.4 on x86_64… » → on garde les deux premiers mots.
      postgres: versionRow?.version.split(' ').slice(0, 2).join(' ') ?? 'PostgreSQL',
      postgis: postgisRow?.v ?? null,
      sizeMb: sizeRow ? Number(sizeRow.bytes) / (1024 * 1024) : null,
      error: null,
    };
  } catch (error) {
    return {
      postgres: 'indisponible',
      postgis: null,
      sizeMb: null,
      error: error instanceof Error ? error.message.split('\n')[0] ?? 'Erreur' : 'Erreur inconnue',
    };
  }
}

export type ServerState = {
  node: string;
  platform: string;
  uptimeHours: number;
  processRssMb: number;
  memory: { totalMb: number; freeMb: number };
  load: number[];
  cpus: number;
  disk: { path: string; freeGb: number; totalGb: number } | null;
  migrations: { applied: number; last: string | null; failed: number } | null;
  counters: Array<{ prefix: string; lastValue: number }>;
};

export async function serverState(): Promise<ServerState> {
  const env = getEnv();
  const uploads = path.resolve(env.UPLOAD_DIR);

  let disk: ServerState['disk'] = null;
  try {
    const fs = await statfs(uploads);
    disk = {
      path: 'stockage des documents',
      freeGb: (fs.bavail * fs.bsize) / 1024 ** 3,
      totalGb: (fs.blocks * fs.bsize) / 1024 ** 3,
    };
  } catch {
    disk = null;
  }

  let migrations: ServerState['migrations'] = null;
  try {
    const rows = await prisma.$queryRaw<
      Array<{ applied: bigint; failed: bigint; last: string | null }>
    >`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::bigint AS failed,
        (SELECT migration_name FROM _prisma_migrations
          WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) AS last
      FROM _prisma_migrations
    `;
    const row = rows[0];
    if (row) migrations = { applied: Number(row.applied), failed: Number(row.failed), last: row.last };
  } catch {
    migrations = null;
  }

  const counters = await prisma.customerNumberCounter
    .findMany({ orderBy: { prefix: 'asc' } })
    .then((rows) => rows.map((r) => ({ prefix: r.prefix, lastValue: Number(r.lastValue) })))
    .catch(() => []);

  return {
    node: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    uptimeHours: process.uptime() / 3600,
    processRssMb: process.memoryUsage().rss / 1024 ** 2,
    memory: { totalMb: os.totalmem() / 1024 ** 2, freeMb: os.freemem() / 1024 ** 2 },
    load: os.loadavg(),
    cpus: os.cpus().length,
    disk,
    migrations,
    counters,
  };
}
