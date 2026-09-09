import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  'recommendations',
  'advisory_engagements',
  'invitation_codes',
  'app_settings',
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
  /** Administrateur de l'instance (section /administration). */
  platformAdmin?: boolean;
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
      isPlatformAdmin: params.platformAdmin ?? false,
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

/** Crée un compte expert agronomique, sans exploitation. */
export async function createExpert(params: {
  email: string;
  password?: string;
  organization?: string;
}): Promise<{ id: string; email: string; password: string }> {
  const password = params.password ?? 'MotDePasse1';
  const user = await prisma.user.create({
    data: {
      email: params.email,
      emailNormalized: params.email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 4),
      firstName: 'Expert',
      lastName: 'Agronome',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
      accountType: 'AGRONOMIST',
      organization: params.organization ?? 'Chambre d’agriculture',
    },
  });
  return { id: user.id, email: user.email, password };
}

/** Ouvre une mission de conseil entre un expert et une exploitation. */
export async function grantAdvisoryAccess(params: {
  farmId: string;
  expertId: string;
  grantedById?: string;
}): Promise<string> {
  const engagement = await prisma.advisoryEngagement.create({
    data: {
      farmId: params.farmId,
      expertId: params.expertId,
      grantedById: params.grantedById ?? null,
    },
  });
  return engagement.id;
}

/**
 * Insère un code d'invitation dont le test connaît la valeur en clair.
 * En base, seule l'empreinte est stockée — comme en production.
 */
export async function createInvitationCode(params: {
  code: string;
  createdById: string;
  farmId?: string | null;
  /** `ADVISOR` n'est pas un rôle de membre : il marque un code de mission. */
  role?: 'OWNER' | 'ADMIN' | 'EMPLOYEE' | 'VIEWER' | 'ADVISOR';
  email?: string | null;
  grantsPlatformAdmin?: boolean;
  expiresInMs?: number;
  revoked?: boolean;
  purpose?: 'ACCOUNT' | 'ADVISORY_ACCESS';
  accountType?: 'FARMER' | 'AGRONOMIST' | 'ADMIN';
}): Promise<{ id: string; code: string }> {
  const normalized = params.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const invitation = await prisma.invitationCode.create({
    data: {
      codeHash: createHash('sha256').update(normalized).digest('hex'),
      codeHint: `PRCL-${normalized.slice(4, 8)}`,
      createdById: params.createdById,
      farmId: params.farmId ?? null,
      role: params.role ?? 'OWNER',
      email: params.email ? params.email.toLowerCase() : null,
      grantsPlatformAdmin: params.grantsPlatformAdmin ?? false,
      purpose: params.purpose ?? 'ACCOUNT',
      accountType: params.accountType ?? 'FARMER',
      expiresAt: new Date(Date.now() + (params.expiresInMs ?? 14 * 24 * 3600 * 1000)),
      revokedAt: params.revoked ? new Date() : null,
    },
  });
  return { id: invitation.id, code: params.code };
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
