import { adminCan, type AdminPermission, type AdminRole } from '@/lib/admin/roles';
import {
  IconAdmin,
  IconAdmins,
  IconHelp,
  IconPortfolio,
  IconServer,
  IconSupport,
  IconAudit,
  IconDashboard,
  IconFarm,
  IconInvitation,
  IconMaintenance,
  IconUsers,
  IconAdvisor,
  IconDocuments,
  IconCrops,
  IconExport,
  IconHistory,
  IconInputs,
  IconParcels,
  IconPhyto,
  IconProfile,
  IconArea,
  IconRegistry,
  IconSecurity,
  IconStock,
  IconSettings,
  IconWeather,
  type LucideIcon,
} from '@/components/ui/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Libellé court pour la barre inférieure mobile. */
  shortLabel?: string;
  /** Présent dans la navigation mobile (4 emplacements). */
  mobile?: boolean;
  group: 'exploitation' | 'suivi' | 'documents';
};

export const MAIN_NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Tableau de bord',
    shortLabel: 'Accueil',
    icon: IconDashboard,
    mobile: true,
    group: 'exploitation',
  },
  {
    href: '/parcelles',
    label: 'Parcelles',
    icon: IconParcels,
    mobile: true,
    group: 'exploitation',
  },
  { href: '/cultures', label: 'Cultures', icon: IconCrops, group: 'exploitation' },

  { href: '/apports', label: 'Apports', icon: IconInputs, mobile: true, group: 'suivi' },
  {
    href: '/phytosanitaire',
    label: 'Phytosanitaire',
    shortLabel: 'Phyto',
    icon: IconPhyto,
    mobile: true,
    group: 'suivi',
  },
  { href: '/stocks', label: 'Stocks', icon: IconStock, group: 'suivi' },
  { href: '/meteo', label: 'Météo', icon: IconWeather, group: 'suivi' },
  {
    href: '/preconisations',
    label: 'Préconisations',
    icon: IconAdvisor,
    group: 'suivi',
  },

  { href: '/pac', label: 'PAC / TéléPAC', icon: IconArea, group: 'documents' },
  {
    href: '/conformite',
    label: 'Conformité',
    icon: IconSecurity,
    group: 'documents',
  },
  {
    href: '/conformite/dossier',
    label: 'Dossier de contrôle',
    shortLabel: 'Dossier',
    icon: IconAudit,
    group: 'documents',
  },
  { href: '/registres', label: 'Registres', icon: IconRegistry, group: 'documents' },
  { href: '/historique', label: 'Historique', icon: IconHistory, group: 'documents' },
  { href: '/documents', label: 'Documents', icon: IconDocuments, group: 'documents' },
  { href: '/exports', label: 'Exportations', icon: IconExport, group: 'documents' },
];

export const NAV_GROUPS: Array<{ key: NavItem['group']; label: string }> = [
  { key: 'exploitation', label: 'Exploitation' },
  { key: 'suivi', label: 'Suivi cultural' },
  { key: 'documents', label: 'Registres & exports' },
];

export const FOOTER_NAV: NavItem[] = [
  { href: '/profil', label: 'Profil', icon: IconProfile, group: 'exploitation' },
  { href: '/parametres', label: 'Paramètres', icon: IconSettings, group: 'exploitation' },
  { href: '/aide', label: 'Aide et contact', icon: IconHelp, group: 'exploitation' },
];

/**
 * Entrée d'administration de l'instance, affichée uniquement aux
 * administrateurs. La visibilité du lien n'est qu'un confort : l'autorisation
 * est vérifiée par `requirePageAdmin` sur chaque page et par
 * `requirePlatformAdmin` sur chaque route d'API.
 */
export const ADMIN_NAV: NavItem = {
  href: '/administration',
  label: 'Administration',
  icon: IconAdmin,
  group: 'exploitation',
};

export type AdminNavGroup = 'pilotage' | 'clients' | 'organisation' | 'systeme';

/** Une section d'administration, et la permission sans laquelle elle n'apparaît pas. */
export type AdminSection = NavItem & {
  permission: AdminPermission;
  adminGroup: AdminNavGroup;
};

export const ADMIN_NAV_GROUPS: Array<{ key: AdminNavGroup; label: string }> = [
  { key: 'pilotage', label: 'Pilotage' },
  { key: 'clients', label: 'Clients' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'systeme', label: 'Système' },
];

/**
 * Sous-navigation de la section d'administration.
 *
 * Chaque entrée porte la permission qui la conditionne (`src/lib/admin/roles.ts`)
 * : un administrateur secondaire ne voit que les siennes. Masquer n'est qu'un
 * confort — la page et sa route revérifient côté serveur.
 */
export const ADMIN_SECTIONS: AdminSection[] = (
  [
    ['/administration', "Vue d'ensemble", IconAdmin, 'dashboard:read', 'pilotage'],
    ['/administration/support', 'Support', IconSupport, 'support:read', 'pilotage'],
    ['/administration/exploitations', 'Exploitations', IconFarm, 'farms:read', 'clients'],
    ['/administration/experts', 'Techniciens', IconAdvisor, 'technicians:read', 'clients'],
    ['/administration/utilisateurs', 'Comptes', IconUsers, 'users:read', 'clients'],
    ['/administration/invitations', 'Invitations', IconInvitation, 'invitations:read', 'clients'],
    ['/administration/administrateurs', 'Administrateurs', IconAdmins, 'admins:manage', 'organisation'],
    ['/administration/portefeuilles', 'Portefeuilles', IconPortfolio, 'portfolios:manage', 'organisation'],
    ['/administration/aide', 'Centre d’aide', IconHelp, 'faq:manage', 'organisation'],
    ['/administration/referentiels', 'Référentiels', IconRegistry, 'referentials:manage', 'systeme'],
    ['/administration/journal', "Journal d'audit", IconAudit, 'audit:read', 'systeme'],
    ['/administration/maintenance', 'Maintenance', IconMaintenance, 'maintenance:manage', 'systeme'],
    ['/administration/serveur', 'État du serveur', IconServer, 'server:read', 'systeme'],
  ] as const
).map(([href, label, icon, permission, adminGroup]) => ({
  href,
  label,
  icon,
  permission,
  adminGroup,
  group: 'exploitation' as const,
}));

/** Les sections qu'un rôle a le droit de voir. */
export function adminSectionsFor(role: AdminRole | null | undefined): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => adminCan(role, section.permission));
}

/**
 * Routes d'accueil d'une section : elles ne s'allument que sur elles-mêmes.
 *
 * Sans cette exception, `/administration` s'allumerait aussi sur
 * `/administration/utilisateurs` — et deux entrées de la barre paraîtraient
 * actives en même temps.
 */
const ACCUEILS_DE_SECTION = new Set(['/dashboard', '/administration']);

/** Un lien est actif pour sa route exacte et ses sous-routes. */
export function isNavActive(pathname: string, href: string): boolean {
  if (ACCUEILS_DE_SECTION.has(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Les quatre raccourcis d'administration sur téléphone.
 *
 * Choisis, et non pris dans l'ordre : ce sont les écrans où l'on se rend
 * réellement depuis un téléphone. La grille en compte quatre, et les intitulés
 * sont raccourcis — « Vue d'ensemble » ne tient pas dans une colonne. Les deux
 * niveaux d'administration ont les mêmes : ce sont des sections que le
 * secondaire voit aussi, bornées à son périmètre.
 */
export function adminMobileNavFor(role: AdminRole | null | undefined): NavItem[] {
  return (
    [
      ['/administration', 'Accueil'],
      ['/administration/support', 'Support'],
      ['/administration/exploitations', 'Fermes'],
      ['/administration/experts', 'Techniciens'],
    ] as const
  )
    .map(([href, shortLabel]) => {
      // Désignées par leur route, pas par leur rang : réordonner ADMIN_SECTIONS ne
      // doit pas changer la barre du téléphone à notre insu.
      const section = ADMIN_SECTIONS.find((item) => item.href === href);
      if (!section) throw new Error(`Section d'administration inconnue : ${href}`);
      return { ...section, shortLabel };
    })
    .filter((section) => adminCan(role, section.permission));
}

/** Compatibilité : la barre du téléphone d'un administrateur général. */
export const ADMIN_MOBILE_NAV: NavItem[] = adminMobileNavFor('GENERAL');
