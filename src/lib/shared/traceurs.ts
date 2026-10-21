/**
 * Ce que Parcelys dépose ou lit sur l'appareil de l'utilisateur.
 *
 * Une seule liste, pour la page « Cookies et traceurs » et pour le test qui la
 * confronte au code (`tests/traceurs.test.ts`) : un stockage ajouté sans être
 * déclaré ici fait échouer la suite. Une page de cookies qui en oublie un
 * n'informe pas — elle rassure à tort.
 *
 * Cadre : article 82 de la loi Informatique et Libertés, et lignes directrices
 * de la CNIL (délibération n° 2020-091 du 17 septembre 2020). Un traceur
 * **strictement nécessaire** au service expressément demandé par l'utilisateur
 * est exempté de consentement — mais pas d'information. Tous ceux de Parcelys
 * le sont : il n'y a ni mesure d'audience, ni publicité, ni réseau social.
 * Si un jour un traceur non exempté était ajouté, il faudrait un recueil de
 * consentement préalable, et cette liste le dirait (`exempte: false`).
 */

export type Traceur = {
  /** Nom tel qu'il apparaît dans le navigateur ou l'appareil. */
  nom: string;
  /** Où il vit. */
  support: 'cookie' | 'stockage local du navigateur' | 'stockage de l’application';
  finalite: string;
  duree: string;
  /** Strictement nécessaire au service demandé : exempté de consentement. */
  exempte: boolean;
  /** Pour un traceur exempté, ce qui le rend nécessaire. */
  justification: string;
};

export const TRACEURS_SITE: Traceur[] = [
  {
    nom: 'parcelys_session',
    support: 'cookie',
    finalite:
      'Vous garder connecté : identifie votre session auprès du serveur. HttpOnly (illisible par les scripts), SameSite=Lax, transmis uniquement en HTTPS en production.',
    duree: '14 jours au plus, 7 jours sans activité ; supprimé à la déconnexion.',
    exempte: true,
    justification: 'Authentification : sans lui, aucune page de votre espace ne peut s’afficher.',
  },
  {
    nom: 'parcelys-theme',
    support: 'stockage local du navigateur',
    finalite: 'Retenir le thème clair ou sombre que vous avez choisi.',
    duree: 'Jusqu’à ce que vous changiez de thème ou effaciez les données du site.',
    exempte: true,
    justification: 'Personnalisation de l’interface demandée par vous, sans autre usage.',
  },
  {
    nom: 'parcelys.dernier-operateur',
    support: 'stockage local du navigateur',
    finalite:
      'Proposer, dans le formulaire de traitement, le nom de l’opérateur saisi la dernière fois sur cet appareil.',
    duree: 'Jusqu’à la saisie suivante ou l’effacement des données du site.',
    exempte: true,
    justification: 'Commodité de saisie demandée par vous ; jamais transmise au serveur pour elle-même.',
  },
  {
    nom: 'parcelys.cookies-informe',
    support: 'stockage local du navigateur',
    finalite: 'Ne plus afficher le bandeau d’information sur les cookies une fois lu.',
    duree: '13 mois, puis le bandeau réapparaît une fois.',
    exempte: true,
    justification: 'Mémorise votre lecture de l’information ; aucun autre usage.',
  },
];

export const TRACEURS_APPLICATION: Traceur[] = [
  {
    nom: 'parcelys.session, parcelys.serverUrl, parcelys.farmId',
    support: 'stockage de l’application',
    finalite:
      'Rester connecté dans l’application de terrain, y compris sans réseau : jeton de session, adresse de votre serveur, exploitation affichée.',
    duree: 'Jusqu’à la déconnexion ou la désinstallation.',
    exempte: true,
    justification: 'Authentification.',
  },
  {
    nom: 'snapshot, registres et file d’attente (parcelles, registres, saisies en attente)',
    support: 'stockage de l’application',
    finalite:
      'Consulter vos parcelles et enregistrer une intervention au champ sans réseau ; les saisies partent à la reconnexion.',
    duree: 'Remplacées à chaque synchronisation ; effacées à la déconnexion ou à la désinstallation.',
    exempte: true,
    justification: 'C’est le service demandé : saisir au champ, hors réseau.',
  },
  {
    nom: 'parcelys.carte.couches, parcelys.faq, parcelys.dernier-operateur',
    support: 'stockage de l’application',
    finalite: 'Couches de carte affichées, aide consultable hors ligne, dernier opérateur saisi.',
    duree: 'Jusqu’à modification ou désinstallation.',
    exempte: true,
    justification: 'Préférences et contenus demandés par vous.',
  },
];

/**
 * Ressources chargées directement par le navigateur auprès d'un tiers. Ce ne
 * sont pas des traceurs déposés par Parcelys, mais le tiers reçoit l'adresse
 * IP de l'appareil et la zone de carte affichée, comme pour toute image
 * chargée depuis un autre site. On le dit plutôt que de le taire.
 */
export const RESSOURCES_TIERCES = [
  {
    nom: 'Fond de carte « plan »',
    fournisseur: 'OpenStreetMap (par défaut ; le serveur peut en configurer un autre)',
    quand: 'À l’affichage d’une carte.',
  },
  {
    nom: 'Fond de carte « satellite »',
    fournisseur: 'Esri — ArcGIS Online (société établie aux États-Unis)',
    quand: 'Seulement si vous choisissez la vue satellite.',
  },
] as const;

/** Clés de stockage local réellement employées par le site (contrôlées par test). */
export const CLES_STOCKAGE_SITE = TRACEURS_SITE.filter((t) => t.support !== 'cookie').map((t) => t.nom);
