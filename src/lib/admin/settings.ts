import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Réglages d'instance modifiables depuis l'administration, sans redéploiement.
 *
 * Ne contient jamais de secret : les clés d'API et les identifiants restent
 * dans l'environnement (`src/lib/env.ts`).
 */

export const SETTING_KEYS = {
  maintenanceEnabled: 'maintenance.enabled',
  maintenanceMessage: 'maintenance.message',
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedById?: string | null,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedById: updatedById ?? null },
    update: { value, updatedById: updatedById ?? null },
  });
}

export type MaintenanceMode = {
  enabled: boolean;
  message: string;
  updatedAt: Date | null;
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  'Parcelys est momentanément en maintenance. Vos données sont intactes ; le service revient dans quelques minutes.';

/**
 * Petit cache en mémoire : l'état de maintenance est consulté à chaque page et
 * à chaque écriture. Dix secondes suffisent à éviter une requête par appel sans
 * rendre la bascule perceptiblement lente.
 */
let cache: { value: MaintenanceMode; readAt: number } | null = null;
const CACHE_TTL_MS = 10_000;

export function invalidateMaintenanceCache(): void {
  cache = null;
}

/**
 * Mode maintenance : l'application reste servie mais les comptes non
 * administrateurs sont redirigés vers une page d'information. Les
 * administrateurs continuent d'accéder à tout, précisément pour pouvoir
 * intervenir.
 */
export async function getMaintenanceMode(): Promise<MaintenanceMode> {
  if (cache && Date.now() - cache.readAt < CACHE_TTL_MS) return cache.value;
  const value = await readMaintenanceMode();
  cache = { value, readAt: Date.now() };
  return value;
}

async function readMaintenanceMode(): Promise<MaintenanceMode> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: { in: [SETTING_KEYS.maintenanceEnabled, SETTING_KEYS.maintenanceMessage] },
    },
  });

  const enabled =
    rows.find((r) => r.key === SETTING_KEYS.maintenanceEnabled)?.value === 'true';
  const message =
    rows.find((r) => r.key === SETTING_KEYS.maintenanceMessage)?.value ??
    DEFAULT_MAINTENANCE_MESSAGE;
  const updatedAt = rows.reduce<Date | null>(
    (latest, row) =>
      latest === null || row.updatedAt > latest ? row.updatedAt : latest,
    null,
  );

  return { enabled, message, updatedAt };
}

export async function setMaintenanceMode(
  params: { enabled: boolean; message?: string | null },
  updatedById: string,
): Promise<MaintenanceMode> {
  await setSetting(
    SETTING_KEYS.maintenanceEnabled,
    params.enabled ? 'true' : 'false',
    updatedById,
  );
  if (params.message !== undefined && params.message !== null) {
    await setSetting(
      SETTING_KEYS.maintenanceMessage,
      params.message.trim() || DEFAULT_MAINTENANCE_MESSAGE,
      updatedById,
    );
  }
  invalidateMaintenanceCache();
  return getMaintenanceMode();
}
