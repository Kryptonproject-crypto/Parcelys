# Données qui manquent au moteur de calcul

État au 21 octobre 2026, version 0.12.0.

Parcelys ne complète jamais une donnée absente : un contrôle qui en dépend
ressort « indéterminé » ou « à vérifier », avec la donnée qui manque. Ce
document les rassemble, de la plus utile à la moins utile, et dit qui peut les
fournir. Le détail des référentiels régionaux est dans
[`referentiels-aura.md`](referentiels-aura.md) ; le fonctionnement du moteur
dans [`reglementaire.md`](reglementaire.md).

## 1. À renseigner une fois, dans Parcelys (l'exploitant)

| Donnée | Où | Ce qu'elle débloque |
| --- | --- | --- |
| SIRET de l'exploitation | Paramètres | mention obligatoire du registre phyto depuis le 1er janvier 2026 ; colonne `siret_exploitation` du registre numérique |
| Conduite en agriculture biologique | Paramètres | mention « agriculture biologique » portée d'office sur chaque traitement (sinon demandée à chaque fois) |
| Type de pulvérisateur et moyen anti-dérive | Paramètres | réduction possible de la ZNT d'un point d'eau et des distances aux habitations |
| Sol drainé, parcelle par parcelle | Fiche parcelle › Modifier | interdictions d'emploi sur sol drainé (mentions SPe) ; « non renseigné » déclenche un avertissement à chaque traitement concerné |
| Culture de la campagne, avec date de semis et rendement réalisé | Fiche parcelle › Culture, ou l'application | cahier d'enregistrement « nitrates », bilan, DAR, IFT ; une parcelle sans culture n'est contrôlée sur rien de tout cela |
| Cible et opérateur des traitements déjà saisis | Phytosanitaire › filtre « incomplets » › Modifier | registre complet ; « À faire » les compte un par un |

## 2. À fournir au fil de la campagne (l'exploitant, son conseiller)

| Donnée | Ce qu'elle débloque |
| --- | --- |
| Analyses de sol (date, laboratoire, valeurs) | termes du bilan azoté (Mh, reliquats) ; sans elles, la dose prévisionnelle est refusée et le terme manquant nommé |
| Reliquat azoté sortie d'hiver | idem : le bilan GREN ne se calcule pas sans |
| Teneurs des effluents de l'exploitation (analyse du fumier, du lisier, du digestat) | azote épandu chiffré, plafond d'azote organique, classement type I/II/III ; sans analyse, l'apport reste « sans teneur » |
| Azote des engrais saisis hors référentiel | champ « Azote apporté » de l'application ou N/P/K du site ; sinon l'apport ne compte pas dans le bilan |
| Besoin de la variété de blé quand elle n'est pas référencée | dose prévisionnelle du blé (les tableaux Arvalis–COMIFER ne sont pas publics) |
| Heures et stade BBCH des traitements dont l'autorisation les encadre | mentions exigées dans ces cas ; E-Phy ne les donne qu'en texte, Parcelys ne peut pas savoir seul qu'elles sont exigées |
| Certificat individuel (Certiphyto), contrôle du pulvérisateur | pièces du dossier de contrôle ; à déposer dans Documents |

## 3. Référentiels publics non importés (l'administrateur)

| Référentiel | Conséquence aujourd'hui |
| --- | --- |
| Programme d'actions **national** nitrates (périodes d'interdiction, plafond de 170 kg N/ha organique, définition des types 0 à III) | ces contrôles restent « indéterminés » ; seuls les renforcements régionaux importés sont opposés |
| 6e programme d'actions régional et GREN de 2018 | campagnes antérieures au 1er septembre 2024 non contrôlées |
| Fiche GREN 19 antérieure au 15 juillet 2025 | Kéq et azote potentiellement libéré indisponibles avant cette date |
| Rf et Mh de la betterave en Rhône-Alpes ; Pi du maïs en Auvergne | dose non calculée dans ces cas |
| Cartographie DREAL des zones d'actions renforcées ; périmètres de protection de captage | ZAR reconstituées « à vérifier », six captages au périmètre indéterminé |
| Couche BCAE et cartographie départementale des points d'eau | bandes enherbées et ZNT « à vérifier », jamais déduites de la carte |
| Sections cadastrales des communes classées « pour quelques sections » | appartenance à la zone vulnérable indéterminée |
| Groupes GCU2 à GCU6 de l'IFT 2025 | IFT 2025 de ces cultures non calculé |
| Petites régions agricoles, zones PPRI | dérogations « cannes de maïs » non opposées |
| Arrêtés départementaux (charte riverains, points d'eau) | distances aux habitations et ZNT locales « à vérifier » |

## 4. Ce que personne ne fournit encore sous forme exploitable

| Donnée | Pourquoi elle manque | Ce que fait Parcelys |
| --- | --- | --- |
| Codes cultures OEPP | prévus par le règlement (UE) 2023/564, pas de table de correspondance publique avec la nomenclature PAC à notre connaissance | le registre numérique porte le code culture PAC, et le dit |
| Stades d'application autorisés, en données | E-Phy les publie en texte libre dans les conditions d'emploi | affiche le texte ; ne contrôle pas le stade |
| Restrictions horaires (mention « abeilles »), en données | même raison | affiche la condition ; demande les heures, ne les vérifie pas |
| Texte consolidé de l'annexe I de l'arrêté du 24 décembre 2025 | non consulté directement ici (Légifrance inaccessible depuis l'environnement de travail) ; liste établie d'après les DRAAF et la presse agricole | les entrées d'aide correspondantes portent « À vérifier » |

## 5. Sur vos propres données

Le rapport de conformité de chaque campagne compte les constats « non
vérifiables » et nomme, pour chacun, la donnée qui manque. C'est la liste à
reprendre en premier : elle ne contient que ce qui bloque **vos** parcelles.
