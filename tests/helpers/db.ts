import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Base de test.
 *
 * `TEST_DATABASE_URL` doit pointer vers une base PostgreSQL + PostGIS dédiée :
 * les tests la vident entre chaque suite. À défaut, `DATABASE_URL` est utilisée
 * — pratique en développement local, à éviter sur des données réelles.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'TEST_DATABASE_URL (ou DATABASE_URL) doit être défini pour exécuter les tests.',
  );
}

process.env.DATABASE_URL = url;

export const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Applique les migrations sur la base de test. */
export function migrateTestDatabase(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}

/**
 * Vide les tables métier.
 *
 * `DELETE` plutôt que `TRUNCATE` : le serveur de test conserve un pool de
 * connexions ouvert, et `TRUNCATE` réclame un verrou ACCESS EXCLUSIVE qui
 * attendrait indéfiniment. `DELETE` ne prend que des verrous de ligne.
 * L'ordre suit les dépendances de clés étrangères, des feuilles vers les
 * racines.
 */
const TABLES_IN_DELETION_ORDER = [
  'audit_logs',
  'notifications',
  'documents',
  'weather_records',
  'agricultural_operations',
  'phytosanitary_applications',
  'fertilizer_applications',
  'crop_years',
  'parcel_geometries',
  'parcels',
  'crops',
  'fertilizers',
  'organic_inputs',
  'phyto_usages',
  'product_substances',
  'phytosanitary_products',
  'active_substances',
  'ephy_sync_runs',
  'email_verification_codes',
  'password_reset_tokens',
  'sessions',
  'farm_members',
  'farms',
  'users',
  'rate_limit_counters',
] as const;

export async function resetDatabase(): Promise<void> {
  for (const table of TABLES_IN_DELETION_ORDER) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}

export type TestUser = {
  id: string;
  email: string;
  password: string;
  farmId: string;
};

/** Crée un utilisateur vérifié, propriétaire d'une exploitation. */
export async function createUserWithFarm(params: {
  email: string;
  farmName: string;
  password?: string;
  role?: 'OWNER' | 'ADMIN' | 'EMPLOYEE' | 'VIEWER';
}): Promise<TestUser> {
  const password = params.password ?? 'MotDePasse1';
  const user = await prisma.user.create({
    data: {
      email: params.email,
      emailNormalized: params.email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 4),
      firstName: 'Test',
      lastName: 'Utilisateur',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
    },
  });

  const farm = await prisma.farm.create({
    data: {
      name: params.farmName,
      members: { create: { userId: user.id, role: params.role ?? 'OWNER' } },
    },
  });

  return { id: user.id, email: user.email, password, farmId: farm.id };
}

/** Polygone rectangulaire fermé, en coordonnées GeoJSON [lng, lat]. */
export function testPolygon(
  lng = 1.88,
  lat = 48.08,
  width = 0.01,
  height = 0.006,
): { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + width, lat],
        [lng + width, lat + height],
        [lng, lat + height],
        [lng, lat],
      ],
    ],
  };
}
