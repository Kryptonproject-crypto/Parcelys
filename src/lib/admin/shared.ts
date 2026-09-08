/**
 * Types et libellés de l'administration partagés entre le serveur et les
 * composants clients. `overview.ts` importe `server-only` : tout ce dont les
 * tableaux ont besoin à l'exécution vit ici.
 */

export type AdminUserFilter =
  | 'tous'
  | 'actifs'
  | 'suspendus'
  | 'non-verifies'
  | 'admins';

export const USER_FILTER_LABELS: Record<AdminUserFilter, string> = {
  tous: 'Tous',
  actifs: 'Actifs',
  suspendus: 'Suspendus',
  'non-verifies': 'À vérifier',
  admins: 'Administrateurs',
};

export type AdminUserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isDemo: boolean;
  activeSessions: number;
  memberships: Array<{ farmId: string; farmName: string; role: string }>;
};

export type AdminInvitationRow = {
  id: string;
  codeHint: string;
  status: 'ACTIVE' | 'USED' | 'REVOKED' | 'EXPIRED';
  email: string | null;
  farmId: string | null;
  farmName: string | null;
  role: string;
  grantsPlatformAdmin: boolean;
  note: string | null;
  expiresAt: string;
  usedAt: string | null;
  usedByEmail: string | null;
  createdAt: string;
  createdBy: string;
};

export type AdminFarmOption = { id: string; name: string };

export type AdminFarmRow = {
  id: string;
  name: string;
  city: string | null;
  department: string | null;
  isDemo: boolean;
  createdAt: string;
  members: number;
  parcels: number;
  areaHa: number;
  owners: string[];
};
