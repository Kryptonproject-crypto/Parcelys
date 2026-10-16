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
  | 'experts'
  | 'admins';

export const USER_FILTER_LABELS: Record<AdminUserFilter, string> = {
  tous: 'Tous',
  actifs: 'Actifs',
  suspendus: 'Suspendus',
  'non-verifies': 'À vérifier',
  experts: 'Experts agronomiques',
  admins: 'Administrateurs',
};

/** Taille de page des listes d'administration. */
export const ADMIN_PAGE_SIZE = 50;

export type AdminPage<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type AdminUserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Numéro client d'un technicien (`TEC-…`) ; `null` pour les autres comptes. */
  technicianNumber: string | null;
  /** Niveau d'administration du compte, s'il en a un. */
  adminRole: 'GENERAL' | 'SECONDARY' | null;
  /** Portefeuille d'un technicien. */
  portfolioName: string | null;
  /**
   * L'administrateur qui regarde peut-il agir sur ce compte ? Calculé côté
   * serveur ; l'interface s'en sert pour griser, le serveur revérifie.
   */
  manageable: boolean;
  /**
   * Exploitant ou expert agronomique. Sans cette distinction, un compte expert
   * — qui n'a par nature aucune exploitation — se lit comme un compte
   * d'exploitation resté vide.
   */
  accountType: 'FARMER' | 'AGRONOMIST' | 'ADMIN';
  /** Structure de rattachement d'un expert (chambre, coopérative, cabinet). */
  organization: string | null;
  /** Exploitations suivies en conseil : le portefeuille de l'expert. */
  advisedFarms: Array<{ farmId: string; farmName: string; customerNumber: string | null }>;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isDemo: boolean;
  activeSessions: number;
  memberships: Array<{
    farmId: string;
    farmName: string;
    role: string;
    customerNumber: string | null;
  }>;
};

export type AdminInvitationRow = {
  id: string;
  codeHint: string;
  accountType: 'FARMER' | 'AGRONOMIST' | 'ADMIN';
  grantsSecondaryAdmin: boolean;
  portfolioName: string | null;
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

export type AdminFarmOption = {
  id: string;
  name: string;
  customerNumber?: string | null;
};

export type AdminPortfolioOption = { id: string; name: string };

export type AdminFarmRow = {
  id: string;
  name: string;
  /** `EXP-…` : attribué par la base, définitif. */
  customerNumber: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  /** Supprimée logiquement : elle reste listée, pour pouvoir la rétablir. */
  deleted: boolean;
  city: string | null;
  department: string | null;
  isDemo: boolean;
  createdAt: string;
  members: number;
  parcels: number;
  /**
   * Enregistrements du registre phytosanitaire.
   *
   * Affiché avant un effacement définitif : c'est ce chiffre-là qui dit ce
   * qu'on s'apprête à détruire. « Des registres » ne se mesure pas.
   */
  phytoRecords: number;
  areaHa: number;
  owners: string[];
  /** Les propriétaires en détail — la forme historique de `GET /api/admin/farms`. */
  ownerAccounts: Array<{ id: string; email: string; name: string }>;
  siret: string | null;
  deletedAt: string | null;
};

/** Un compte expert et les exploitations qu'il suit, pour l'écran d'administration. */
export type AdminExpertEngagement = {
  id: string;
  farmId: string;
  farmName: string;
  customerNumber: string | null;
  status: 'ACTIVE' | 'ENDED';
  startedAt: string;
  endedAt: string | null;
};

export type AdminExpertRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  technicianNumber: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  organization: string | null;
  advisorCertificate: string | null;
  suspended: boolean;
  emailVerified: boolean;
  createdAt: string;
  engagements: AdminExpertEngagement[];
};
