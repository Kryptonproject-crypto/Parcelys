import {
  IconAdmin,
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
  { href: '/meteo', label: 'Météo', icon: IconWeather, group: 'suivi' },
  {
    href: '/preconisations',
    label: 'Préconisations',
    icon: IconAdvisor,
    group: 'suivi',
  },

  { href: '/pac', label: 'PAC / TéléPAC', icon: IconArea, group: 'documents' },
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

/** Sous-navigation de la section d'administration. */
export const ADMIN_SECTIONS: NavItem[] = [
  {
    href: '/administration',
    label: "Vue d'ensemble",
    icon: IconAdmin,
    group: 'exploitation',
  },
  {
    href: '/administration/utilisateurs',
    label: 'Utilisateurs',
    icon: IconUsers,
    group: 'exploitation',
  },
  {
    href: '/administration/invitations',
    label: 'Invitations',
    icon: IconInvitation,
    group: 'exploitation',
  },
  {
    href: '/administration/exploitations',
    label: 'Exploitations',
    icon: IconFarm,
    group: 'exploitation',
  },
  {
    href: '/administration/experts',
    label: 'Experts',
    icon: IconUsers,
    group: 'exploitation',
  },
  {
    href: '/administration/journal',
    label: "Journal d'audit",
    icon: IconAudit,
    group: 'exploitation',
  },
  {
    href: '/administration/maintenance',
    label: 'Maintenance',
    icon: IconMaintenance,
    group: 'exploitation',
  },
];

/** Un lien est actif pour sa route exacte et ses sous-routes. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
