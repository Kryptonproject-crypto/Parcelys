export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Affiché dans la barre inférieure mobile. */
  mobile?: boolean;
};

export const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Tableau de bord', icon: '🏠', mobile: true },
  { href: '/parcelles', label: 'Parcelles', icon: '🗺️', mobile: true },
  { href: '/cultures', label: 'Cultures', icon: '🌱' },
  { href: '/apports', label: 'Apports', icon: '💧', mobile: true },
  { href: '/phytosanitaire', label: 'Phytosanitaire', icon: '🧪', mobile: true },
  { href: '/meteo', label: 'Météo', icon: '🌦️' },
  { href: '/registres', label: 'Registres', icon: '📋' },
  { href: '/historique', label: 'Historique', icon: '📊' },
  { href: '/documents', label: 'Documents', icon: '📁' },
  { href: '/exports', label: 'Exportations', icon: '📤' },
];

export const FOOTER_NAV: NavItem[] = [
  { href: '/profil', label: 'Profil', icon: '👤' },
  { href: '/parametres', label: 'Paramètres', icon: '⚙️' },
];

/** Un lien est actif pour sa route exacte et ses sous-routes. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
