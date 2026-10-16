/**
 * Demandes de support : libellés et règles partagés entre le serveur, le site
 * et l'application mobile.
 */

export type StatutDemande = 'NEW' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export const STATUTS_DEMANDE: StatutDemande[] = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
];

export const LIBELLES_STATUT: Record<StatutDemande, string> = {
  NEW: 'Nouvelle',
  IN_PROGRESS: 'En cours',
  WAITING_CUSTOMER: 'En attente du client',
  RESOLVED: 'Résolue',
  CLOSED: 'Fermée',
};

/** Couleur de pastille, dans le vocabulaire des badges du site. */
export const TONS_STATUT: Record<StatutDemande, 'blue' | 'amber' | 'green' | 'neutral' | 'red'> = {
  NEW: 'blue',
  IN_PROGRESS: 'amber',
  WAITING_CUSTOMER: 'neutral',
  RESOLVED: 'green',
  CLOSED: 'neutral',
};

export function demandeOuverte(statut: StatutDemande): boolean {
  return statut !== 'RESOLVED' && statut !== 'CLOSED';
}

export type IdentiteDemandeur = 'ACCOUNT' | 'EMAIL_CONFIRMED' | 'UNVERIFIED';

export const LIBELLES_IDENTITE: Record<IdentiteDemandeur, string> = {
  ACCOUNT: 'Compte connecté',
  EMAIL_CONFIRMED: 'Adresse e-mail confirmée',
  UNVERIFIED: 'Identité non vérifiée',
};

/** Page ou fonctionnalité concernée : la liste proposée dans le formulaire. */
export const RUBRIQUES_SUPPORT = [
  { value: 'compte', label: 'Compte et connexion' },
  { value: 'exploitations', label: 'Exploitations et membres' },
  { value: 'carte', label: 'Cartographie et parcelles' },
  { value: 'pac', label: 'PAC / TéléPAC' },
  { value: 'fertilisation', label: 'Fertilisation et épandage' },
  { value: 'phyto', label: 'Registre phytosanitaire' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'referentiels', label: 'Référentiels et alertes réglementaires' },
  { value: 'exports', label: 'Exports et dossier de contrôle' },
  { value: 'mobile', label: 'Application mobile' },
  { value: 'numero', label: 'Numéro client' },
  { value: 'donnees', label: 'Données personnelles' },
  { value: 'autre', label: 'Autre' },
] as const;

export type RubriqueSupport = (typeof RUBRIQUES_SUPPORT)[number]['value'];

export function libelleRubrique(valeur: string | null | undefined): string {
  return RUBRIQUES_SUPPORT.find((r) => r.value === valeur)?.label ?? 'Non précisée';
}

/**
 * Pièce jointe : une seule par message, 5 Mo au plus, et seulement ce qu'on
 * envoie pour montrer un problème — capture d'écran, PDF, texte. Le serveur
 * vérifie en plus la signature binaire de chaque fichier.
 */
export const PIECE_JOINTE = {
  maxOctets: 5 * 1024 * 1024,
  extensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt'],
  accept: '.pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain',
} as const;

export const LIMITES_TEXTE = {
  sujet: 150,
  description: 5000,
  message: 5000,
} as const;
