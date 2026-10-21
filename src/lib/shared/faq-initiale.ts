/**
 * Contenu initial du centre d'aide.
 *
 * Inséré une seule fois en base au premier affichage (voir
 * `src/lib/aide/faq.ts`) — les entrées ajoutées ensuite (`ajouteeEn`) le sont
 * une fois sur les serveurs déjà installés —, puis modifiable par
 * l'administrateur général dans
 * `/administration/aide` — sans toucher au code. L'application mobile en
 * embarque une copie pour s'afficher sans réseau.
 *
 * Chaque réponse décrit ce que Parcelys fait **réellement** à la date de la
 * version 0.11.0, relu dans le code. Celles qui dépendent d'un réglage de
 * l'instance ou d'un point réglementaire à confirmer portent `aVerifier` : le
 * centre d'aide les affiche avec la mention « À vérifier ».
 *
 * Mise en forme : paragraphes séparés par une ligne vide ; une ligne qui
 * commence par « - » est une puce.
 */

export type FaqCategorieInitiale = {
  slug: string;
  titre: string;
  description: string;
  entrees: Array<{
    slug: string;
    question: string;
    reponse: string;
    motsCles?: string;
    aVerifier?: boolean;
    /**
     * Version qui a ajouté l'entrée, quand elle est postérieure au contenu
     * initial (0.11.0). Ces entrées sont livrées **une fois** aux serveurs
     * déjà installés (voir `livrerNouvellesEntrees`) : sans cela, une aide
     * écrite après la première installation n'y apparaîtrait jamais.
     */
    ajouteeEn?: string;
  }>;
};

export const FAQ_INITIALE: FaqCategorieInitiale[] = [
  {
    slug: 'compte',
    titre: 'Création et accès au compte',
    description: 'Inscription, connexion, mot de passe, adresse e-mail.',
    entrees: [
      {
        slug: 'compte-creer',
        question: 'Comment créer un compte Parcelys ?',
        reponse:
          "Les inscriptions ne sont pas libres : il faut un code d'invitation, de la forme PRCL-XXXX-XXXX-XXXX, délivré par un administrateur de Parcelys.\n\n" +
          "- Ouvrez la page Inscription et saisissez le code : le formulaire vous dit ce qu'il prévoit (créer votre exploitation, en rejoindre une, ou un compte de technicien).\n" +
          "- Un code est valable 14 jours par défaut, et ne sert qu'une fois.\n" +
          "- Un code peut être réservé à une adresse e-mail précise : il ne fonctionne alors que pour elle.\n\n" +
          'Vous n’avez pas de code ? Écrivez-nous depuis la page Contact.',
        motsCles: 'inscription invitation code PRCL nouveau compte',
      },
      {
        slug: 'compte-verification',
        question: "Je n'ai pas reçu le code de vérification de mon adresse e-mail",
        reponse:
          "Après l'inscription, un code à 6 chiffres est envoyé à votre adresse. Il est valable 15 minutes.\n\n" +
          '- Regardez dans les courriers indésirables.\n' +
          '- Depuis l’écran de vérification, demandez un nouveau code (quelques envois par quart d’heure au maximum).\n' +
          "- Si l'adresse saisie était fausse, contactez-nous : un administrateur peut la corriger après vérification de votre identité.",
        motsCles: 'code 6 chiffres email mail spam vérifier',
      },
      {
        slug: 'compte-mot-de-passe',
        question: "J'ai oublié mon mot de passe",
        reponse:
          'Sur la page de connexion, choisissez « Mot de passe oublié ». Un lien de réinitialisation vous est envoyé ; il est valable 30 minutes et ne sert qu’une fois.\n\n' +
          'Le nouveau mot de passe doit compter au moins 10 caractères, dont une minuscule, une majuscule et un chiffre.',
        motsCles: 'oubli réinitialiser lien connexion',
      },
      {
        slug: 'compte-verrouille',
        question: 'Mon compte est verrouillé',
        reponse:
          'Après 8 échecs de connexion, le compte est verrouillé 15 minutes : c’est une protection contre les tentatives de devinette du mot de passe. Attendez, ou réinitialisez le mot de passe.\n\n' +
          'Si votre compte est « suspendu », c’est une décision d’un administrateur : contactez-nous.',
        motsCles: 'bloqué verrouillage suspendu échec',
      },
      {
        slug: 'compte-email',
        question: "Comment changer l'adresse e-mail de mon compte ?",
        reponse:
          'Depuis « Mon profil », demandez le changement : un code est envoyé à la nouvelle adresse, et le changement n’est effectif qu’une fois ce code saisi. L’ancienne adresse est prévenue.',
        motsCles: 'adresse mail changer profil',
      },
      {
        slug: 'compte-sessions',
        question: 'Combien de temps reste-t-on connecté ?',
        reponse:
          'Une session dure au plus 14 jours, et se ferme après 7 jours sans activité (valeurs par défaut, réglables sur le serveur). Depuis « Mon profil », vous voyez vos sessions ouvertes et pouvez les fermer toutes.',
        motsCles: 'déconnexion session appareil durée',
        aVerifier: true,
      },
    ],
  },
  {
    slug: 'exploitations',
    titre: 'Gestion des exploitations',
    description: 'Membres, rôles, techniciens, pulvérisateur.',
    entrees: [
      {
        slug: 'exploitation-membres',
        question: 'Comment ajouter un salarié ou un associé à mon exploitation ?',
        reponse:
          "Chaque personne a son propre compte. Pour qu'elle rejoigne votre exploitation, un administrateur de Parcelys lui délivre un code d'invitation rattaché à votre exploitation, avec le rôle voulu.\n\n" +
          "- Propriétaire : accès complet, y compris la suppression de l'exploitation.\n" +
          '- Administrateur : parcelles, membres et paramètres.\n' +
          '- Salarié : saisie des interventions et des documents.\n' +
          '- Lecture seule : consultation et exports.\n\n' +
          'Demandez le code depuis la page Contact en précisant votre numéro client et le rôle souhaité.',
        motsCles: 'membre salarié associé rôle inviter équipe',
      },
      {
        slug: 'exploitation-technicien',
        question: 'Comment donner accès à mon technicien ou à mon conseiller ?',
        reponse:
          "Dans « Paramètres → Experts agronomiques », créez un code d'accès conseil et remettez-le à votre technicien. Il l'active depuis son compte : votre exploitation apparaît alors dans son portefeuille.\n\n" +
          "Le technicien lit vos parcelles et vos registres et peut vous adresser des préconisations ; il ne saisit rien dans vos registres. Vous pouvez mettre fin à l'accès à tout moment, depuis le même écran.",
        motsCles: 'expert conseiller technicien accès conseil préconisation',
      },
      {
        slug: 'exploitation-plusieurs',
        question: "J'ai plusieurs exploitations : comment passer de l'une à l'autre ?",
        reponse:
          "Le sélecteur en haut de la barre latérale liste les exploitations dont vous êtes membre. Chaque exploitation a ses propres parcelles, registres et numéro client.",
        motsCles: 'changer exploitation sélecteur plusieurs',
      },
      {
        slug: 'exploitation-bio',
        ajouteeEn: '0.12.0',
        question: 'Où indiquer que mon exploitation est en agriculture biologique ?',
        reponse:
          "Dans « Paramètres », champ « Agriculture biologique ». Toute l'exploitation en bio, ou aucune surface en bio : la mention est portée d'office sur chaque traitement. En partie seulement : elle se donne à chaque traitement. Non renseignée, elle reste vide dans le registre — jamais supposée.",
        motsCles: 'bio agriculture biologique conversion registre mention',
      },
      {
        slug: 'exploitation-pulverisateur',
        question: 'Pourquoi renseigner mon pulvérisateur ?',
        reponse:
          "Dans « Paramètres », le type de pulvérisateur et son éventuel moyen anti-dérive permettent à Parcelys d'indiquer, à la saisie d'un traitement, si une distance de sécurité peut être réduite. Tant que ce n'est pas renseigné, Parcelys ne suppose rien et applique la distance sans réduction.",
        motsCles: 'pulvérisateur anti-dérive buses ZNT distance',
      },
    ],
  },
  {
    slug: 'carte',
    titre: 'Cartographie et parcelles',
    description: 'Contours, surfaces, import TéléPAC, couches de la carte.',
    entrees: [
      {
        slug: 'carte-creer-parcelle',
        question: 'Comment créer une parcelle ?',
        reponse:
          'Depuis « Parcelles → Nouvelle parcelle », tracez le contour sur la carte puis complétez les informations. La surface est recalculée par le serveur à partir du contour : elle ne se saisit pas à la main.',
        motsCles: 'tracer dessiner contour nouvelle parcelle surface',
      },
      {
        slug: 'carte-import-pac',
        question: 'Puis-je importer mes parcelles depuis TéléPAC ?',
        reponse:
          'Oui. Dans « PAC / TéléPAC », importez le fichier de votre dossier : l’export XML de TéléPAC, ou un shapefile (fichiers .shp, .shx, .dbf, .prj, ou une archive .zip).\n\n' +
          '- Un réimport n’ajoute que ce qui est nouveau et ne réécrit pas les noms que vous avez donnés à vos parcelles.\n' +
          '- Les codes de culture TéléPAC sont affichés sous leur nom réel.',
        motsCles: 'telepac pac import xml shapefile dossier',
      },
      {
        slug: 'carte-surface',
        question: 'La surface affichée diffère de celle de ma déclaration PAC',
        reponse:
          'Parcelys calcule la surface à partir du contour enregistré. Un contour légèrement différent de celui de TéléPAC, ou une projection différente, donne un écart de quelques ares. En cas de doute, c’est la surface de votre déclaration qui fait foi pour la PAC.',
        motsCles: 'surface hectares écart différence',
        aVerifier: true,
      },
      {
        slug: 'carte-couches',
        question: 'Que montrent les couches de la carte (cours d’eau, zones réglementaires) ?',
        reponse:
          "Les couches affichent les données publiques importées sur votre serveur Parcelys par l'administrateur, avec leur source et leur date. Une couche qui n'a pas été importée n'est pas affichée — Parcelys ne la remplace pas par une estimation. La carte de l'application mobile garde les couches pour un usage sans réseau.",
        motsCles: 'cours eau couche carte zone znt bcae',
      },
    ],
  },
  {
    slug: 'fertilisation',
    titre: 'Fertilisation et épandage',
    description: 'Apports, plan de fumure, épandage d’effluents.',
    entrees: [
      {
        slug: 'fertilisation-saisir',
        question: 'Où saisir un apport d’engrais ou d’effluent ?',
        reponse:
          "Les apports s'enregistrent depuis la fiche d'une parcelle, onglet « Apports », ou depuis l'application mobile au champ. Le « Registre des apports » les reprend tous, par campagne.",
        motsCles: 'apport engrais fumier lisier effluent saisir',
      },
      {
        slug: 'fertilisation-plan',
        question: 'Parcelys calcule-t-il ma dose d’azote ?',
        reponse:
          'Parcelys propose un plan prévisionnel par la méthode du bilan, à partir des paramètres du référentiel régional importé. Si un paramètre nécessaire manque, le calcul est refusé et le paramètre manquant est indiqué — Parcelys ne complète jamais par une valeur supposée.\n\n' +
          'Le plan reste votre document : vérifiez-le avec votre conseiller.',
        motsCles: 'azote bilan dose plan fumure prévisionnel gren',
        aVerifier: true,
      },
      {
        slug: 'fertilisation-epandage',
        question: 'Comment savoir si je peux épandre à une date donnée ?',
        reponse:
          'Lorsque le programme d’actions nitrates de votre zone a été importé, Parcelys signale à la saisie les périodes et conditions qui s’appliquent, avec la règle d’origine. Sans référentiel importé, il l’indique comme « indéterminé » : vérifiez alors auprès de votre DDT ou de votre chambre d’agriculture.',
        motsCles: 'épandage calendrier interdiction période nitrates zone vulnérable',
        aVerifier: true,
      },
      {
        slug: 'fertilisation-cahier',
        ajouteeEn: '0.12.0',
        question: 'Que contient le cahier d’enregistrement « nitrates » ?',
        reponse:
          "En zone vulnérable, le cahier d'enregistrement des pratiques est tenu par îlot et mis à jour après chaque semis, apport et récolte. Il porte notamment : la culture et sa date d'implantation, le rendement réalisé, et pour chaque apport d'azote la date, la surface, la nature du fertilisant, sa teneur en azote et la quantité d'azote apportée ; ainsi que la gestion de l'interculture (couvert, destruction). Il se conserve cinq ans.\n\n" +
          "Dans Parcelys : les cultures (semis, récolte, rendement), les apports (« Registre des apports » : teneur en N, N à l'hectare, N total), les couverts et le plan de fumure. Pour un produit hors référentiel, indiquez l'azote apporté à la saisie : sinon il reste non chiffré. Le programme d'actions régional peut ajouter des exigences.",
        motsCles: 'cahier enregistrement nitrates zone vulnérable azote teneur rendement interculture',
        aVerifier: true,
      },
    ],
  },
  {
    slug: 'phyto',
    titre: 'Registre phytosanitaire',
    description: 'Traitements, catalogue E-Phy, doses, ZNT, stock.',
    entrees: [
      {
        slug: 'phyto-saisir',
        question: 'Comment enregistrer un traitement ?',
        reponse:
          "Depuis la fiche d'une parcelle, onglet « Phytosanitaire », ou depuis l'application mobile. Cherchez le produit par son nom ou son numéro d'AMM : Parcelys reprend les usages, doses et conditions du catalogue officiel E-Phy de l'ANSES, sans les modifier.",
        motsCles: 'traitement saisir produit amm registre',
      },
      {
        slug: 'phyto-corriger',
        ajouteeEn: '0.11.2',
        question: 'Corriger ou supprimer un traitement, un apport, un travail',
        reponse:
          "Sur le site, fiche de la parcelle : « Modifier » ou « Supprimer » sur la ligne (aussi depuis les registres Apports et Phytosanitaire). Dans l'application, ouvrez la parcelle puis la rubrique : chaque enregistrement porte les mêmes boutons, réseau ou pas — la correction part à la synchronisation. Les quantités et les éléments fertilisants sont recalculés, la sortie de stock d'un traitement suit la nouvelle dose, la météo du jour de l'intervention est conservée, et chaque correction est inscrite au journal avec l'ancienne et la nouvelle valeur.",
        motsCles: 'corriger modifier supprimer erreur dose traitement apport travail couvert culture',
      },
      {
        slug: 'phyto-mentions-2026',
        ajouteeEn: '0.12.0',
        question: 'Quelles mentions mon registre phytosanitaire doit-il porter ?',
        reponse:
          "Depuis le 1er janvier 2026 (arrêté du 24 décembre 2025, qui applique le règlement européen 2023/564), le registre porte notamment :\n" +
          "- le SIRET de l'exploitation, et celui du prestataire ou de l'exploitation en entraide quand ce n'est pas vous qui avez traité ;\n" +
          "- le nom commercial du produit et son numéro d'AMM ;\n" +
          "- la date, et les heures de début et de fin quand l'autorisation du produit les encadre ;\n" +
          "- la dose et son unité, la surface traitée, la culture, et le stade (BBCH) quand l'autorisation le limite ;\n" +
          "- la localisation de la parcelle (îlot PAC ou coordonnées) ;\n" +
          "- la conduite en agriculture biologique.\n\n" +
          "Parcelys les demande à la saisie (site et application) ; la localisation vient de la parcelle, le SIRET et la conduite bio des Paramètres. Cible, opérateur, volume de bouillie et météo ne sont pas tous exigés par ce texte mais restent demandés : c'est ce qu'un contrôle ou un conseiller regarde. La liste officielle complète est l'annexe I de l'arrêté.",
        motsCles: 'registre mentions obligatoires siret amm heure stade bbch bio prestataire entraide 2026',
        aVerifier: true,
      },
      {
        slug: 'phyto-registre-numerique',
        ajouteeEn: '0.12.0',
        question: 'Le registre phytosanitaire numérique obligatoire en 2027',
        reponse:
          "Le règlement européen 2023/564, modifié par le règlement 2025/2203, impose un registre au format électronique lisible par machine à partir du 1er janvier 2027 : un tableau structuré ou un logiciel, pas un cahier scanné ni un PDF.\n\n" +
          "Selon les modalités françaises annoncées (arrêté du 24 décembre 2025) : de 2027 à 2029, une saisie d'abord sur papier reste possible si elle est convertie au format électronique avant le 31 janvier de l'année suivante ; à partir de 2030, la conversion doit se faire dans les 30 jours.\n\n" +
          "Avec Parcelys, la saisie est déjà électronique. « Exports › Registre phytosanitaire numérique » produit le registre de l'année civile en CSV, Excel ou JSON : une information par colonne, dates ISO, nombres à point décimal. Les mentions manquantes sont comptées en tête du fichier.",
        motsCles: 'registre numérique électronique 2027 obligatoire csv json lisible machine',
        aVerifier: true,
      },
      {
        slug: 'phyto-retire',
        question: 'Mon produit est retiré du marché : puis-je encore l’utiliser ?',
        reponse:
          "Un produit retiré n'est pas forcément interdit : l'ANSES publie, usage par usage, une date de fin d'utilisation (délai d'écoulement des stocks). Parcelys affiche « Retiré le … — utilisable jusqu'au … » et accepte le traitement jusqu'à cette date. Après, il le signale comme interdit.\n\n" +
          "Le numéro d'AMM complet retrouve toujours le produit, même retiré.",
        motsCles: 'retiré délai écoulement fin utilisation amm interdit',
      },
      {
        slug: 'phyto-catalogue',
        question: 'Le catalogue ne correspond pas à l’étiquette de mon produit',
        reponse:
          "Parcelys reprend le catalogue E-Phy tel qu'il a été synchronisé (date visible dans « Paramètres »). En cas de divergence, c'est l'étiquette et la décision d'autorisation en vigueur qui font foi. Signalez-nous l'écart depuis la page Contact : nous vérifierons la synchronisation.",
        motsCles: 'e-phy anses étiquette erreur catalogue',
      },
      {
        slug: 'phyto-stock',
        question: 'Comment fonctionne le stock de produits ?',
        reponse:
          "Enregistrez vos achats (produit, quantité, numéro de lot) dans « Stocks » ou depuis l'application. À la saisie d'un traitement, choisissez le produit dans votre stock : la quantité utilisée est décomptée du lot.",
        motsCles: 'stock achat lot quantité',
      },
    ],
  },
  {
    slug: 'referentiels',
    titre: 'Référentiels et alertes réglementaires',
    description: 'D’où viennent les règles, ce que signifient les alertes.',
    entrees: [
      {
        slug: 'referentiels-source',
        question: 'D’où viennent les règles que Parcelys applique ?',
        reponse:
          "Des référentiels officiels importés par l'administrateur (catalogue E-Phy, programme d'actions nitrates, référentiels régionaux, couches publiques), chacun conservé avec sa source, sa version et sa date. Parcelys n'invente aucune valeur réglementaire : une donnée absente est affichée « indéterminé ».",
        motsCles: 'source référentiel version règle officielle',
      },
      {
        slug: 'referentiels-conformite',
        question: 'Que signifie la page « Conformité » ?',
        reponse:
          "C'est une synthèse des vérifications automatiques de la campagne : chaque constat cite la règle et la donnée qui l'ont produit. Ce n'est pas un certificat : Parcelys ne déclare jamais une exploitation « conforme ». L'absence d'alerte signifie seulement qu'aucune règle importée n'a été enfreinte par les données saisies.",
        motsCles: 'conformité alerte constat contrôle vérification',
      },
      {
        slug: 'referentiels-indetermine',
        question: 'Pourquoi certaines valeurs sont-elles « indéterminé » ?',
        reponse:
          "Parce que la donnée nécessaire n'est pas disponible : référentiel non importé, information manquante sur la parcelle ou le produit. Parcelys préfère dire qu'il ne sait pas plutôt que d'afficher une valeur plausible. Complétez la donnée signalée, ou vérifiez auprès de l'organisme compétent.",
        motsCles: 'indéterminé inconnu manquant',
      },
    ],
  },
  {
    slug: 'exports',
    titre: 'Export des données',
    description: 'Registres PDF, Excel, CSV, dossier de contrôle, vos données personnelles.',
    entrees: [
      {
        slug: 'exports-registres',
        question: 'Comment exporter mes registres ?',
        reponse:
          'La page « Exportations » génère, par campagne et par parcelle, les registres au format PDF, Excel (XLSX) ou CSV : registre parcellaire, phytosanitaire, des apports, des travaux, bilan de fertilisation, cahier d’épandage, historique des interventions, assolement.',
        motsCles: 'export pdf excel csv xlsx registre télécharger',
      },
      {
        slug: 'exports-dossier',
        question: 'Qu’est-ce que le dossier de contrôle ?',
        reponse:
          "« Conformité → Dossier de contrôle » rassemble, pour une campagne, les pièces qu'un contrôle demande, et indique celles qui manquent. Il sert à préparer un contrôle, pas à s'y substituer.",
        motsCles: 'contrôle dossier pièces campagne',
      },
      {
        slug: 'exports-personnel',
        question: 'Comment récupérer ou supprimer mes données personnelles ?',
        reponse:
          'Depuis « Mon profil », vous pouvez exporter à tout moment l’ensemble de vos données personnelles, ou supprimer votre compte. Les registres réglementaires de l’exploitation restent attachés à l’exploitation, qui doit les conserver.',
        motsCles: 'rgpd données personnelles export suppression compte',
      },
    ],
  },
  {
    slug: 'numero',
    titre: 'Numéro client',
    description: 'À quoi il sert, où le trouver.',
    entrees: [
      {
        slug: 'numero-quoi',
        question: 'Qu’est-ce que mon numéro client ?',
        reponse:
          'Chaque exploitation a un numéro de la forme EXP-000123, chaque technicien un numéro TEC-000045. Il est attribué automatiquement à la création et ne change jamais.\n\n' +
          "Il sert à nous parler : donnez-le quand vous nous contactez, nous retrouvons votre dossier sans vous demander d'autres informations. Ce n'est ni un mot de passe ni une preuve d'identité.",
        motsCles: 'numéro client exp tec identifiant référence',
      },
      {
        slug: 'numero-ou',
        question: 'Où trouver mon numéro client ?',
        reponse:
          '- Sur le site : « Mon profil », à côté de chaque exploitation.\n' +
          "- Dans l'application mobile : « Réglages ».\n" +
          '- Il est prérempli dans le formulaire de contact quand vous êtes connecté.',
        motsCles: 'trouver numéro profil réglages',
      },
      {
        slug: 'numero-demande',
        question: 'Et le numéro DEM-… ?',
        reponse:
          'C’est le numéro de votre demande de support. Il est indiqué à l’envoi du formulaire et dans les e-mails que nous vous adressons ; rappelez-le si vous nous écrivez à propos de cette demande.',
        motsCles: 'dem ticket demande support numéro',
      },
    ],
  },
  {
    slug: 'technique',
    titre: 'Problèmes techniques',
    description: 'Application mobile, synchronisation, maintenance.',
    entrees: [
      {
        slug: 'technique-hors-ligne',
        question: 'Puis-je saisir sans réseau au champ ?',
        reponse:
          "Oui, avec l'application mobile. Les saisies faites sans réseau sont mises en file d'attente et envoyées au retour de la connexion ; le voyant de synchronisation indique ce qui reste à partir. Ne vous déconnectez pas tant que la file n'est pas vide : la déconnexion la vide.",
        motsCles: 'hors ligne réseau synchronisation file attente mobile',
      },
      {
        slug: 'technique-registres-appli',
        ajouteeEn: '0.11.1',
        question: 'Voir depuis l’application ce qui a déjà été fait sur une parcelle',
        reponse:
          "Ouvrez la parcelle : les rubriques Général, Cultures, Apports, Phyto, Travaux et Historique reprennent celles du site. Elles sont gardées dans le téléphone à chaque synchronisation et restent lisibles sans réseau ; la date de la dernière mise à jour est écrite en bas de la fiche. Une saisie pas encore envoyée apparaît dans sa rubrique, marquée « en attente d'envoi ».",
        motsCles: 'registre historique traitements apports travaux consulter mobile fiche parcelle',
      },
      {
        slug: 'technique-gps',
        ajouteeEn: '0.11.1',
        question: 'La position GPS est imprécise',
        reponse:
          "Vérifiez d'abord que Parcelys a la position exacte : Réglages du téléphone › Applications › Parcelys › Autorisations › Position › « Utiliser la position exacte » ; avec la seule position approximative, l'erreur peut atteindre plusieurs centaines de mètres. À découvert, laissez au GPS quelques secondes : « Où suis-je ? » et « Poser un sommet » écoutent plusieurs points et affichent la précision obtenue (±… m). Sous les arbres, près des bâtiments ou en cabine, la précision se dégrade.",
        motsCles: 'gps position précision localisation où suis-je sommet contour imprécis',
      },
      {
        slug: 'technique-cible-operateur',
        ajouteeEn: '0.12.0',
        question: 'Cible, opérateur, heures : où les saisir dans l’application ?',
        reponse:
          "Dans le formulaire de traitement, sous la dose : « Cible » (les cibles autorisées pour le produit et celles déjà saisies sont proposées), « Opérateur » (repris de votre dernière saisie sur le téléphone), surface traitée, bouillie, heures de début et de fin. « Autres mentions du registre » ouvre le stade, le prestataire ou l'entraide et la mention bio. Un traitement déjà enregistré se complète avec « Modifier ».",
        motsCles: 'cible opérateur heure stade prestataire application mobile traitement compléter',
      },
      {
        slug: 'technique-mise-a-jour-appli',
        question: 'Comment mettre à jour l’application mobile ?',
        reponse:
          "Quand une nouvelle version est publiée, « Réglages » l'annonce et propose de télécharger le fichier d'installation (APK, Android). Synchronisez vos saisies avant d'installer la mise à jour.",
        motsCles: 'mise à jour apk android version installer',
        aVerifier: true,
      },
      {
        slug: 'technique-maintenance',
        question: 'Le site affiche « maintenance »',
        reponse:
          "Un administrateur a mis le service en maintenance, le temps d'une mise à jour. Vos données ne sont pas touchées ; réessayez un peu plus tard. Le formulaire de contact reste accessible.",
        motsCles: 'maintenance indisponible panne',
      },
      {
        slug: 'technique-signaler',
        question: 'Comment signaler un problème efficacement ?',
        reponse:
          "Depuis la page Contact, précisez la page concernée, ce que vous faisiez, ce que vous attendiez et ce qui s'est produit. Une capture d'écran en pièce jointe aide beaucoup (PDF, PNG, JPEG, WebP ou texte, 5 Mo au plus).",
        motsCles: 'bug erreur problème signaler capture',
      },
    ],
  },
  {
    slug: 'contact',
    titre: 'Contact et assistance',
    description: 'Écrire au support, suivre une demande.',
    entrees: [
      {
        slug: 'contact-ecrire',
        question: 'Comment contacter l’assistance ?',
        reponse:
          'Par le formulaire de la page Contact. Connecté, votre nom, votre adresse et votre numéro client sont préremplis, et la demande arrive directement à l’administrateur qui suit votre exploitation. Vous recevez un numéro de demande (DEM-…).',
        motsCles: 'contact support assistance aide écrire formulaire',
      },
      {
        slug: 'contact-suivre',
        question: 'Comment suivre ma demande ?',
        reponse:
          '- Connecté : « Mes demandes » (depuis votre profil) liste vos demandes, leur statut et les réponses ; vous pouvez y répondre.\n' +
          '- Sans compte ou non connecté : un e-mail vous donne un lien personnel de suivi, valable 90 jours. Ne le transmettez à personne.\n\n' +
          'Statuts : nouvelle, en cours, en attente de votre réponse, résolue, fermée.',
        motsCles: 'suivi demande statut réponse ticket',
      },
      {
        slug: 'contact-anonyme',
        question: 'Pourquoi me demande-t-on de confirmer mon identité ?',
        reponse:
          "Une demande envoyée sans être connecté ne prouve pas qui l'a écrite. Tant que votre identité n'est pas vérifiée, nous ne communiquons aucune donnée de votre compte ou de votre exploitation. Le plus simple : connectez-vous et écrivez depuis la page Contact.",
        motsCles: 'identité vérifier sécurité anonyme',
      },
      {
        slug: 'contact-cookies',
        ajouteeEn: '0.12.0',
        question: 'Quels cookies Parcelys utilise-t-il, et que fait-il de mes données ?',
        reponse:
          "Un seul cookie, celui qui vous garde connecté, et quelques préférences gardées dans votre navigateur : aucune publicité, aucune mesure d'audience, aucune revente. Le détail est dans « Cookies et traceurs » ; ce que deviennent vos données, combien de temps elles sont gardées et comment exercer vos droits, dans « Données personnelles » (liens en bas de chaque page).",
        motsCles: 'cookies rgpd données personnelles confidentialité cnil',
      },
    ],
  },
];
