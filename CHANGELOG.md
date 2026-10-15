# Journal des versions

Ce fichier dit **ce qui a changé et pourquoi**, pas la liste des commits. Un
défaut corrigé y figure avec ce qu'il produisait : c'est ce qui permet, un an
plus tard, de comprendre pourquoi une décision a été prise.

---

## 0.10.3 — Une interface qui tient sur un téléphone, des listes qu'on lit

### Ce qui était cassé

Les libellés de la nomenclature PAC (« Prairie permanente - herbe
prédominante (ressources fourragères ligneuses absentes ou peu présentes) »)
cassaient les listes : dans l'application, la culture poussait le nom de la
parcelle hors de sa carte et l'écran glissait sur le côté ; sur le site, la
page Parcelles et le tableau de bord s'élargissaient à 800 px, si bien qu'un
téléphone les affichait dézoomés. Un élément de grille ne s'élargit plus
au-delà de sa colonne, les étiquettes s'arrêtent sur des points de
suspension, et le contrôle automatique des pages mesure désormais la largeur
de l'appareil, plus celle de la fenêtre.

### L'application de terrain

- **Accueil** : quatre tuiles à portée de pouce (Où suis-je ?, Carte, Stock,
  Conseils), une recherche avec effacement, un **filtre par culture** (« Prairie
  permanente 58 », « Blé tendre d'hiver 12 »…) et une liste compacte : le nom,
  la culture et sa couleur, la surface. Les parcelles se suivent dans l'ordre
  des îlots (4-3 avant 4-26, Îlot 2 avant Îlot 10).
- **Carte** : chaque parcelle prend la couleur de sa famille de culture
  (prairies, céréales, maïs, oléagineux, protéagineux, fourrages, non
  cultivé), avec la légende sous la carte.
- **Fiche** : la culture en entier, sous la surface ; le numéro n'est plus
  répété quand le nom le dit déjà.
- Le voyant de synchronisation dit « À jour » en plus court ; le stock écrit
  « L » et « mL ».

### Le site

- **Parcelles** : recherche, culture et campagne sur une ligne, le reste sous
  « Plus de filtres » ; des cartes lisibles (nom, surface, culture et sa
  couleur, interventions), « En production » n'étant plus affiché puisque
  c'est l'état ordinaire ; ordre naturel des numéros, aussi dans les listes de
  choix des registres, apports, traitements, documents, exports et de
  l'historique.
- **Conformité et tableau de bord** : les constats identiques sont regroupés —
  « Parcelle en zone vulnérable · 53 parcelles » une fois, au lieu de
  cinquante-trois cartes. Le détail parcelle par parcelle reste à un clic ; le
  plus grave vient en tête.
- **Cartes** : couleur par culture et légende, comme dans l'application ; les
  couches réglementaires se replient sous la carte.
- **Cultures** : la répartition prend les couleurs des familles et les noms
  courts, le libellé entier au survol.
- Les liens verts restent lisibles en mode sombre.

### Audit

Les 71 pages du site, sur ordinateur et sur téléphone, et les 14 écrans de
l'application ont été parcourus automatiquement sur une exploitation de 134
parcelles : aucune erreur, aucun débordement. Parcours réels vérifiés dans le
navigateur : achat d'un produit, traitement pris dans le stock (le lot
diminue), apport, et chacun des 24 exports (PDF, Excel, CSV), l'export
TéléPAC, le dossier de contrôle et l'export des données du compte.

---

## 0.10.2 — Les cultures sous leur vrai nom, le pulvérisateur de l'exploitation

### « Blé tendre d'hiver », plus « BTH »

Un dossier TéléPAC ne donne que le code de la culture ; Parcelys le prenait
pour nom, et c'est « PPH », « PTR », « SNE » qui s'affichaient partout. Les
cultures portent désormais le libellé de la nomenclature des cultures PAC
(Agence Bio, 372 codes, version 2.7.0 du 1er octobre 2026) : « Prairie
permanente - herbe prédominante (…) », « Autre prairie temporaire de 5 ans ou
moins », « Surface agricole temporairement non exploitée ». Le code reste,
pour l'export TéléPAC.

La mise à jour renomme les cultures existantes **dont le nom est encore
exactement le code** ; un nom choisi par l'exploitant n'est pas touché. Un
code absent de la nomenclature reste affiché tel quel.

Ce que cela change au-delà de l'affichage :

- **Règles du programme d'actions nitrates** : elles reconnaissent une culture
  à son nom. « BTH » n'était reconnu comme rien, et les règles visant les
  céréales d'hiver restaient indéterminées ; « Blé tendre d'hiver » l'est.
- **Usages E-Phy** : la dose, les ZNT et le nombre de passages se lisent sur
  l'usage de la culture traitée. « BTH » n'en trouvait aucun. Le rapprochement
  se fait maintenant sur des mots entiers, au singulier (« Prairies » du
  catalogue, « prairie temporaire » de la déclaration), respecte les
  exclusions (« Maïs (hors maïs doux) » ne prend pas les usages du maïs doux),
  écarte les usages « Porte graine » d'une culture qui n'en est pas une, et
  rattache le triticale et l'épeautre au blé, le colza aux crucifères
  oléagineuses, la luzerne aux légumineuses fourragères — d'après les
  conditions d'emploi du catalogue lui-même.
- **Export shapefile** : le libellé de culture n'est plus tronqué à 64
  caractères, et l'apostrophe typographique (« d’hiver ») ne devient plus un
  caractère de contrôle dans le `.dbf`.

### Le pulvérisateur de l'exploitation

« Paramètres → **Pulvérisateur** » : le type (rampe, jet porté, pneumatique,
à dos), le moyen anti-dérive — aucun, ou la classe de réduction de dérive de
la liste officielle (50, 66, 75 ou 90 %) et le matériel —, et si
l'exploitation applique la charte d'engagements riverains de son département.
Chaque réponse peut rester « je ne sais pas » : Parcelys ne suppose jamais un
équipement.

À chaque traitement, Parcelys en tire :

- **ZNT des points d'eau** : une ZNT de 20 ou 50 m peut être ramenée à 5 m
  avec un moyen réduisant la dérive d'au moins 66 %, le long d'un point d'eau
  bordé d'un dispositif végétalisé permanent d'au moins 5 m, le traitement
  étant enregistré (arrêté du 4 mai 2017, annexe 3). La phrase le dit, sous
  cette condition ; 100 m ne se réduit pas ; une autorisation qui impose
  elle-même un dispositif végétalisé est citée mot pour mot.
- **Distance aux habitations** : celle de l'autorisation du produit quand elle
  en fixe une (537 produits), l'option retenue selon le matériel déclaré ;
  sinon, l'arrêté : produits de biocontrôle et à faible risque exemptés ;
  20 m incompressibles pour les mentions de danger les plus graves ; 10 m
  pour une culture haute ; 5 m pour une culture basse, ramenés à 3 m avec un
  matériel d'au moins 66 % et la charte. Pour un produit suspecté CMR, la
  distance reste **indéterminée** (10 m s'il figure sur la liste ministérielle,
  non importée), et la phrase le dit.

### Ce qui manque toujours

- **Points d'eau de l'Allier** (arrêté préfectoral et cartographie de la DDT).
- **Liste ministérielle des produits CMR 2 à 10 m**, et confirmation des
  mentions H370 et H372 dans la liste des 20 m.
- **Charte riverains de l'Allier** : approuvée ou non, Parcelys ne le sait pas
  — l'exploitant le déclare.
- **Réduction de la distance aux habitations en culture haute** : selon la
  culture et le matériel, non chiffrée.
- **Position des habitations**, **distances d'épandage aux cours d'eau**
  (programme d'actions national).

---

## 0.10.1 — Réimport PAC qui ne réécrit rien, ZNT par défaut, stock au champ

### Réimporter son dossier PAC ne modifie plus les parcelles existantes

Une parcelle déjà connue — par son numéro d'îlot et de parcelle, ou par son
contour — est désormais **conservée telle quelle** : nom donné, numéro
interne, contour, commune. L'import n'y complète que ce qui était vide (numéro
PAC, commune) et la culture déclarée de la campagne si aucune n'est saisie ;
il ajoute les parcelles nouvelles. Auparavant, chaque parcelle reconnue
recevait le contour du dossier — une nouvelle version à chaque import, même
identique.

Quand le contour a changé dans TéléPAC, l'aperçu le signale (« contour
différent : 12,40 → 12,85 ha ») avec une case pour le reprendre ; rien n'est
remplacé sans elle. La fiche de la parcelle affiche ses numéros TéléPAC
campagne par campagne : un renommage n'y touche pas.

### ZNT aquatique : la largeur par défaut de l'arrêté

Un usage sans ZNT aquatique dans le catalogue n'était suivi d'aucun rappel.
L'arrêté du 4 mai 2017 (art. 12-III) fixe pourtant une zone non traitée d'au
moins **5 m** quand l'autorisation et l'étiquette n'en prévoient pas.
Parcelys l'applique désormais — sauf quand une condition d'emploi de l'ANSES
fixe la ZNT dans son texte (1 120 produits le font), qui est alors citée mot
pour mot, et sauf pour les produits autorisés sur plantes aquatiques ou en
rizière (art. 13-II). Les écoulements de la BD TOPAGE à moins de cette
largeur sont cités, comme pour les ZNT du catalogue.

### Mentions de danger et riverains

Les mentions de danger des produits (fichier E-Phy
`produits_phrases_de_risque`) sont importées. Un produit cancérogène,
mutagène ou reprotoxique (H340/H341, H350/H351, H360/H361 — 761 produits) le
signale à la saisie : les distances de sécurité aux abords des habitations le
concernant ne sont pas réductibles par la charte. La distance elle-même n'est
pas chiffrée — voir « Ce qui manque ».

### L'application de terrain

- **Stock** : ce qui reste, lot par lot, et **Enregistrer un achat** depuis le
  téléphone, hors réseau compris — rejoué par la synchronisation sur la route
  du site, une seule fois même si l'envoi est répété.
- **Carte** : les couches ne restent plus muettes en cas d'échec. Serveur pas
  encore mis à jour, pas de réseau, premier calcul trop long : l'écran dit
  lequel. Le délai accordé au premier calcul passe à deux minutes.

### Ce qui manque, et que Parcelys n'invente pas

- **Points d'eau de l'Allier** : la ZNT s'applique le long des points d'eau
  désignés par arrêté préfectoral. La BD TOPAGE situe les écoulements, pas
  leur désignation : l'arrêté et sa cartographie (DDT de l'Allier) ne sont pas
  importés.
- **Distances riverains** : texte consolidé de l'arrêté du 4 mai 2017
  (articles 14-1 et suivants, modifiés en 2022 et 2023), liste des produits de
  l'annexe 5 (Bulletin officiel), charte départementale de l'Allier, position
  des habitations.
- **Distances d'épandage aux cours d'eau** : elles relèvent du programme
  d'actions national (arrêté du 19 décembre 2011 modifié), non fourni.

---

## 0.10.0 — Le stock à la pulvérisation, une application rapide sur un Pi

### Enregistrer un achat, traiter depuis son stock

« Stocks → **Enregistrer un achat** » : le produit (choisi dans le catalogue
E-Phy pour un phytosanitaire, dans le référentiel ou nommé pour le reste), la
quantité reçue, la date, le numéro de lot, le fournisseur, la date limite
d'utilisation et le prix. L'article, le lot et l'entrée en stock sont créés en
une fois ; plusieurs produits d'une même facture s'enchaînent sans ressaisir la
date ni le fournisseur. Une unité inconvertible (des kilos d'un produit suivi en
litres) est refusée, sans rien laisser à moitié créé.

À la saisie d'un traitement — sur le site comme sur l'application de terrain —
les **produits en stock** sont proposés d'abord, avec leur reste ; le lot est
présélectionné quand il n'y en a qu'un. Le traitement enregistré sort la
quantité employée de ce lot. Un lot vide n'est plus proposé. Hors réseau,
l'application propose les produits en stock de la dernière synchronisation.

### Plus rapide, sans rien changer aux résultats

Mesuré sur une exploitation fictive de 150 parcelles, avec les référentiels
d'Auvergne-Rhône-Alpes importés (le Raspberry Pi est plusieurs fois plus lent,
dans les mêmes proportions) :

| | avant | après |
| --- | --- | --- |
| Tableau de bord | 9,6 s | 1,7 s — et la page s'affiche sans attendre la conformité |
| Fiche d'une parcelle | 2,0 s, 2,2 Mo | 0,06 s, 70 Ko |
| Conformité | 9,1 s | 2,0 s |
| Dossier de contrôle | 8,5 s | 1,7 s |

- **Distance aux cours d'eau** : la requête mesurait la distance géodésique de
  la parcelle à la Loire entière (20 000 sommets) avant d'écarter ce qui était
  trop loin. Les candidats sont désormais retenus à plat, puis seulement
  mesurés : 50 ms → 6 ms par parcelle, mêmes conditions, même résultat.
- **Contexte réglementaire** : la fiche d'une parcelle le recalculait à chaque
  ouverture. Il est relu tant que son **empreinte** — contour, commune, état
  des référentiels, version du calcul — est inchangée, et recalculé dès qu'elle
  change. Ce qui corrige au passage un défaut : un contour retracé ne mettait
  pas à jour le contexte lu par la synthèse de conformité tant que la fiche
  n'avait pas été ouverte.
- **Synthèse de conformité** : 6 789 requêtes pour une campagne, l'essentiel
  relisant la même parcelle pour chacun de ses apports. Chaque fait est
  désormais lu une fois par calcul (`src/lib/memoire-calcul.ts`) — 1 824
  requêtes. Rien n'est gardé d'un calcul à l'autre : une anomalie corrigée
  disparaît à l'affichage suivant.
- **Couches de la carte** : calculées une fois tant que les parcelles et les
  référentiels ne changent pas, et chargées quand on allume une couche plutôt
  qu'intégrées à chaque page.
- Vérification : les sorties de la synthèse, du dossier de contrôle et de
  l'IFT ont été comparées avant et après sur l'exploitation fictive ; elles
  sont identiques, à une exception près, voulue : voir ci-dessous.

### Cours d'eau à égale distance : un ordre fixe

Une parcelle traversée par plusieurs écoulements les a tous « à 0 m », et le
contrôle de la bande enherbée en cite trois. Lesquels dépendait de l'ordre
interne de la base, si bien que le message pouvait changer d'un affichage à
l'autre. L'ordre est désormais fixé (distance, puis nature, libellé, code).
Mêmes constats, mêmes niveaux, mêmes distances — seuls les écoulements cités
à égalité peuvent différer de la version précédente. Les traitements d'un même
jour, dans l'IFT, suivent de même l'ordre de saisie.

### La carte de l'application : les cours d'eau

La carte de l'application de terrain affiche les couches réglementaires du
site, sous les parcelles : réseau hydrographique, plans d'eau et surfaces en
eau d'office, zones vulnérables, zones d'actions renforcées, aires de captage
et points de prélèvement à la demande. Elles sont enregistrées sur l'appareil
à chaque synchronisation — retéléchargées seulement quand elles ont changé — et
restent visibles sans réseau, avec leur source, leur version et leur date.
L'écran rappelle qu'un tracé de la BD TOPAGE situe un écoulement, il ne dit
pas s'il est cours d'eau BCAE ou point d'eau au sens de l'arrêté ZNT.

Sur le site comme sur l'application, une couche trop fournie garde désormais
les éléments **les plus proches des parcelles**, et non les premiers venus :
sur 15 000 tronçons autour d'une exploitation, le plafond pouvait écarter le
ruisseau qui longe la parcelle. Le plafond passe à 1 000 pour l'eau, dont les
tracés sont coupés à l'emprise de l'exploitation (une rivière entière pesait
plus d'un mégaoctet).

### Raspberry Pi

- `npm run contextes` met à jour les contextes réglementaires périmés ;
  `update-pi.sh` le lance après le redémarrage.
- L'import des référentiels d'Auvergne-Rhône-Alpes supprime ses tables
  intermédiaires des zones vulnérables et des aires de captage une fois
  versées.

---

## 0.9.9 — Les référentiels d'Auvergne-Rhône-Alpes, appliqués

Les référentiels officiels fournis dans `data/referentiels-aura/` ne sont plus
seulement affichés : ils décident des contrôles et des calculs. Ce qui manque
reste « indéterminé » et le dit ; rien n'est complété par estimation.

### Les textes, transcrits avec leur source

Le 7e programme d'actions régional (arrêté n° 24-135 modifié par le n° 24-162),
la liste des zones d'actions renforcées et le référentiel GREN (arrêté
n° 24-147 et ses 21 fiches) sont transcrits en règles structurées, dans
`data/referentiels-aura/transcriptions/`. Chaque règle porte son article, sa
page, sa citation mot pour mot, son territoire et sa date d'entrée en vigueur ;
chaque PDF cité est vérifié par son empreinte à l'import. Une règle se lit **à
la date de l'intervention** : un apport de février 2024 n'est pas jugé selon un
programme entré en vigueur en septembre 2024.

Chaque constat affiche désormais la règle appliquée : texte, référentiel et
version, territoire, période de validité, et la citation repliée.

### Ce qui est contrôlé

- **Apports** : à l'enregistrement, et dans la synthèse — allongement régional
  de l'interdiction du type III, fractionnement, épandages sur couverts (azote
  potentiellement libéré de la fiche GREN 19), digestats, mesures des ZAR.
- **Couverts** : date limite d'implantation, destruction, légumineuses pures,
  mesures des ZAR.
- **Zones vulnérables** : la commune classée « quelques sections » laisse
  l'appartenance indéterminée ; les sept communes retirées par le tribunal
  administratif le 6 juin 2024 restent classées pour les campagnes
  antérieures ; un bassin dont aucune commune n'est publiée ne vaut pas
  « hors zone ».
- **Zones d'actions renforcées** : reconstituées par l'aire d'alimentation du
  captage quand elle existe (« à vérifier », la cartographie de la DREAL fait
  foi), indéterminées sinon.
- **Cours d'eau** : la BD TOPAGE situe les écoulements et mesure les distances ;
  la bande enherbée et la ZNT restent « à vérifier » — la carte ne désigne ni
  les cours d'eau BCAE ni les points d'eau préfectoraux.

### La dose prévisionnelle, selon les fiches

Nouvel écran **Plan prévisionnel de fumure**, culture par culture, depuis
l'onglet Apports. La formule est celle de la fiche de la culture et de
l'ex-région ; chaque terme est lu dans le tableau de la fiche ; le plan est
enregistré avec son calcul et la trace de chaque règle. La dose n'est pas
calculée quand un terme manque, et l'écran dit lequel. Un dépassement se
justifie sur le même écran, avec les motifs de l'arrêté.

Les produits organiques de l'exploitation se créent dans Paramètres, avec leur
analyse et leur classement réglementaire choisi parmi les dénominations de la
fiche GREN 19.

### Corrigé

- **IFT** : la dose de référence prise était la première ligne venue pour le
  produit et la culture — parfois la dose de **traitement de semences**,
  jusqu'à vingt fois plus élevée — et, à défaut, celle d'**une autre culture**.
  C'est désormais la dose à la culture (ou à la cible saisie), jamais une autre.
- **Unités** : une dose d'engrais en L/ha était comptée comme des kg/ha ; des
  m³ d'un produit analysé à la tonne, comme des tonnes. Sans densité, l'azote
  n'est plus calculé.
- Réimporter une campagne IFT créait une seconde version active.
- Le plan prévisionnel de fumure n'est plus exigé hors zone vulnérable, ni
  dans la synthèse ni dans le dossier de contrôle.

### Administration

La page **Référentiels réglementaires** montre chaque version conservée :
statut, version, millésime, territoire, source, date d'import, validité,
nombre d'entrées, état de l'intégration et données manquantes, avec les
fichiers sources vérifiés.

### Mise à jour du Raspberry Pi

`update-pi.sh` installe GDAL (`gdal-bin`). Après la mise à jour :

```bash
cd /opt/parcelys && sudo -u parcelys npm run referentiels:aura
sudo -u parcelys npm run check:referentiels-aura
```

---

## 0.9.8 — La même carte au champ qu'au bureau

La 0.9.7 avait ajouté une carte à l'application : des contours dessinés à la
main, sans fond de plan. Elle fonctionnait, mais ce n'était pas la carte du
site — et c'est la carte du site qu'il faut au champ.

### Leaflet des deux côtés, et les mêmes fonds

L'application utilise désormais **la même bibliothèque que le site**, avec les
mêmes fonds de plan — Satellite (imagerie Esri) et Plan — et un sélecteur pour
passer de l'un à l'autre. Le satellite est affiché par défaut : au champ, c'est
lui qui permet de reconnaître une limite, une haie, un chemin.

Les couleurs des parcelles, les fonds et le libellé qui nomme une parcelle
vivent maintenant dans `src/lib/shared/carte.ts`, lu par le site **et** par
l'application. Le site les y prend aussi : ils n'étaient définis qu'à un seul
endroit, ils le restent. `tests/carte.test.ts` refuse qu'une couleur soit
réécrite à la main d'un côté ou de l'autre — c'est exactement ainsi que les
deux cartes auraient recommencé à diverger.

L'adresse du fond « Plan » vient du serveur (`MAP_TILE_URL`), transmise dans
l'instantané : changer de fournisseur de tuiles ne demande pas de recompiler et
de réinstaller l'APK.

### Hors réseau, la carte reste utile

Le fond de plan demande du réseau ; les contours, non — ils viennent du cache
de l'appareil. Au milieu d'un champ sans couverture, les parcelles s'affichent
donc toujours, sur fond vide, et un bandeau dit pourquoi le fond manque au lieu
de laisser chercher.

### Trois défauts trouvés en pilotant l'écran, pas en le relisant

- **Debout dans sa parcelle, on ne pouvait pas la sélectionner.** Le repère de
  position et son cercle de précision interceptaient l'appui : au milieu d'une
  parcelle — le cas ordinaire —, on tapait sur son propre point et rien ne
  s'ouvrait. Les deux ne sont plus cliquables. Le diagnostic a été obtenu en
  demandant au navigateur ce qui se trouvait sous le doigt : `path trait
  #ffffff`, le repère.
- **L'infobulle restait ouverte en travers de la carte.** Une infobulle s'ouvre
  au survol, et un doigt ne survole pas : au premier appui elle s'ouvrait et
  restait, masquant les parcelles voisines. Elle est remplacée au champ par la
  fiche sous la carte, plus lisible au soleil et à portée du pouce. Le site, où
  l'on survole à la souris, la garde.
- **L'attribution recouvrait la barre d'échelle.** Sur 390 points de large,
  celle d'Esri tient sur deux lignes et passait par-dessus. Elle est désormais
  posée sous la carte — la licence exige qu'elle soit visible, pas qu'elle soit
  dans le cadre — et elle suit le fond affiché.

### Ce que cela coûte

L'application pèse 139 ko compressés au lieu de 95 : Leaflet et son habillage.
C'est le prix d'une vraie carte, et il est payé une fois à l'installation.

### Ce qui n'y est pas encore

Les **couches réglementaires** (zones vulnérables, captages, cours d'eau) sont
sur la carte du site, pas encore sur celle de l'application : il faudrait les
embarquer dans l'instantané hors ligne, ce qui alourdit chaque
synchronisation. Elles sont éteintes par défaut sur le site.

---

## 0.9.7 — Le parcellaire sur une carte, et les saisies qui partent enfin

### Rien ne partait tout seul : aucune saisie n'atteignait le serveur

Le défaut le plus grave de cette version, et il ne concernait pas que le
renommage : **toute saisie faite au champ restait dans le téléphone**.

`runSync` n'avait qu'un seul appelant dans toute l'application : le bouton de
l'écran de la file d'attente. Rien ne déclenchait d'envoi — ni l'ouverture de
l'application, ni le retour du réseau, ni une saisie faite en zone couverte. Un
traitement phytosanitaire noté dans la parcelle, un apport, un couvert, un
renommage : tout attendait que l'exploitant pense à ouvrir un écran que rien ne
lui demandait d'ouvrir.

Le bandeau hors réseau promettait pourtant l'inverse, mot pour mot : « vos
saisies partiront à la reconnexion ». Elles ne partaient pas.

Constaté en pilotant l'application compilée contre un vrai serveur : la
parcelle renommée affichait son nouveau nom sur le téléphone — l'écriture
locale est optimiste — et gardait l'ancien en base de données.

L'envoi part désormais de lui-même dès qu'il y a du réseau et quelque chose en
attente. Une saisie **refusée** par le serveur ne déclenche pas de réessai sans
fin : les tentatives s'espacent puis s'arrêtent, parce qu'un refus reste un
refus et qu'il faut alors corriger la saisie. Le voyant rouge et l'écran de la
file sont là pour ça. Une nouvelle saisie, ou un envoi manuel qui aboutit,
réarme l'envoi automatique.

### Renommer une parcelle était impossible dès qu'un champ restait vide

L'écran de renommage envoie ses trois libellés à chaque enregistrement, et
`null` pour celui qu'on laisse vide. Le schéma de validation refusait `null` :
le serveur répondait « Données invalides » et **rejetait le renommage entier**.
Une parcelle sans numéro interne ni lieu-dit — le cas courant — ne pouvait donc
pas être renommée du tout.

Le même corps étant envoyé par le site, le renommage y était cassé de la même
façon.

Dans la foulée, un second défaut du même helper : `''` était transformé en
« champ absent », si bien qu'**aucun champ texte optionnel ne pouvait être
effacé** par l'API. Un lieu-dit saisi par erreur restait attaché à la parcelle
pour de bon.

Les trois intentions sont maintenant distinguées, comme elles le sont déjà pour
`drainedSoil` : champ absent, on ne touche pas ; champ vidé (`''` ou `null`),
on efface ; texte, on écrit.

### Voir ses parcelles sur une carte

Nouvel écran, accessible depuis le parcellaire à côté de « Où suis-je ? ».

Il dessine **tous les contours déjà en cache**, avec la position de l'opérateur
et la précision annoncée par le GPS. Il s'ouvre donc au milieu d'un champ, sans
réseau — le seul moment où l'on en a vraiment besoin. On pince pour zoomer, on
glisse pour se déplacer, on touche une parcelle pour l'ouvrir : de là, on la
renomme ou on y saisit une intervention.

Pas de fond de plan, et l'écran le dit : une photo aérienne suppose des tuiles
téléchargées, donc du réseau. Les parcelles sans contour sont listées à part
plutôt que passées sous silence, avec la raison.

Les calculs — projection, cadrage, zoom, étiquettes — vivent dans le terrain
commun et sont couverts par `tests/carte.test.ts` : un carré du terrain reste
un carré à l'écran, le nord est en haut, l'emprise entière tient dans la vue,
le point qu'on pince reste sous le doigt.

### Trois défauts d'affichage trouvés en pilotant l'écran

Aucun n'était visible à la compilation.

- Les boutons de zoom ne faisaient rien : la zone qui écoute les gestes
  capturait le pointeur et les boutons posés dessus ne recevaient jamais leur
  clic. Ils paraissaient présents et répondaient au doigt sans effet.
- « Tout voir » englobait la position : un relevé GPS pris loin — ou aberrant —
  réduisait le parcellaire à trois pixels. Le bouton montre désormais le
  parcellaire, toujours le même, quoi qu'annonce le GPS.
- Les noms trop longs débordaient sur la parcelle voisine, et le repère de
  position se posait par-dessus le nom (« Les ● bles »). Les noms sont rognés à
  la largeur de leur parcelle, et l'étiquette s'écarte du repère.

### Vérification

`scripts/check-carte-mobile.mjs` pilote l'application compilée dans un
navigateur, contre un vrai serveur et une vraie base : connexion, carte,
zoom, appui sur une parcelle, renommage avec champs vides, et **lecture du
serveur** pour confirmer que le nouveau nom y est bien arrivé.

---

## 0.9.6 — Le Pi se relève, et les stocks démarrent tout seuls

### La mise à jour pouvait sauter des étapes en annonçant un succès

Trouvé en répondant à une question simple : « comment je fais la mise à jour,
maintenant que le script a changé ? »

`update-pi.sh` fait un `git pull` sur le dépôt **qui le contient** : il se
réécrit lui-même en cours d'exécution. Or bash ne charge pas un script en
mémoire — il le lit au fur et à mesure en retenant sa **position en octets**.
Quand le fichier change sous lui, il reprend à la même position dans un contenu
devenu différent.

Reproduit en remplaçant l'ancienne version du fichier par la nouvelle à
l'endroit du `git pull` : bash a enchaîné sur des lignes du nouveau fichier,
produit « step: command not found » et « die: command not found », sauté
plusieurs étapes, puis affiché « Mise à jour terminée » et rendu **le code 0**.

C'est exactement la panne que l'en-tête du script dit vouloir éviter — « on
redémarre l'ancienne version en croyant avoir mis à jour, et rien ne le
signale ». Et de façon **intermittente**, selon la taille du fichier et
l'endroit modifié : une mise à jour réussie ne prouvait rien sur la suivante.

Le script commence désormais par se recopier hors du dépôt et se relancer
depuis cette copie. Le dépôt peut alors changer autant qu'il veut.


### Après un redémarrage, Parcelys revient — vraiment

Le service était bien activé au démarrage. Cela ne suffisait pas.

Au démarrage du Pi, PostgreSQL et Parcelys partent **ensemble**, et sur carte SD
la base met plusieurs secondes à ouvrir sa socket. Parcelys arrivait le premier,
le contrôle avant démarrage ne trouvait pas la base, et le service échouait :
après une coupure de courant, la machine était allumée et le site éteint.

Le réflexe — ordonner Parcelys après PostgreSQL — ne règle rien, pour deux
raisons qui tiennent à Debian :

1. **`postgresql.service` ne démarre rien.** C'est une méta-unité dont
   l'`ExecStart` est `/bin/true` ; son propre fichier le dit. `After=` et
   `Requires=` sur elle n'ordonnent et ne garantissent rien.
2. **L'unité réelle ignore ses propres échecs.** `postgresql@16-main.service`
   lance le cluster avec `ExecStart=-…` — le tiret signifie « ignorer l'échec »,
   et le commentaire Debian l'explique : *recovery might take arbitrarily long*.

Aucun ordonnancement systemd ne peut donc garantir qu'une requête passera. Le
démarrage **attend** désormais que la base réponde pour de bon — jusqu'à trois
minutes, un essai toutes les deux secondes — puis échoue avec un message lisible
si elle ne revient jamais (`preflight.mjs --attendre`).

Trois autres corrections vont avec :

- `Restart=always` et **aucune limite de tentatives**. Par défaut systemd
  abandonne après cinq échecs en dix secondes et laisse le service en panne
  *définitivement* : sur la machine d'une exploitation qui redémarre sans
  personne devant l'écran, c'est le pire comportement possible.
- Les chemins de `node` et `npm` sont **résolus à l'installation**. Ils étaient
  codés en dur vers `/usr/bin`, ce qui est faux dès que Node vient d'ailleurs —
  l'unité pointait alors vers un fichier inexistant. L'installateur acceptait
  pourtant un Node déjà présent sans regarder où.
- `postgresql` et `cloudflared` sont activés au démarrage, et le `start.conf` du
  cluster est vérifié : en `manual`, la base ne se lève jamais.

**L'unité ne vivait que dans `install-pi.sh`, et `update-pi.sh` n'y touchait
pas.** Une machine installée il y a six mois gardait donc la sienne
indéfiniment : aucune correction de démarrage ne lui serait parvenue, pas même
celle-ci. Elle est maintenant dans `scripts/service-systemd.sh`, appelé par
l'installation, par chaque mise à jour, et lu par le contrôle.

`npm run check:demarrage` vérifie tout cela sans redémarrer ; `--sur-la-machine`
ajoute l'état réel des unités sur le Pi, et `--couper-la-base` éprouve l'attente
en arrêtant réellement PostgreSQL. Les dix contrôles ont été falsifiés un à un.

### Un contrôle rougissait pour une raison étrangère au code

`check:couverture` vérifie que, **sans zonage importé**, une zone vulnérable
ressort « indéterminée ». Mais la suite de tests n'efface ses lignes qu'au début
de chaque cas : le dernier exécuté laisse les siennes. Enchaîner `npm test` puis
`npm run verif:sans-navigateur` faisait donc échouer ce contrôle sans qu'aucun
défaut n'existe.

Il constate désormais l'état de la base et dit ce qu'il n'a pas pu vérifier,
plutôt que d'échouer à tort. Il ne supprime pas les zonages : sur le Pi, ce sont
ceux de l'exploitation.

### Stocks : importer les produits déjà employés

L'écran des stocks était en **lecture seule**. Le modèle savait rattacher un
article au catalogue E-Phy ou au référentiel des engrais depuis le début, l'API
aussi — mais aucun écran ne l'appelait. Commencer à suivre son local voulait dire
tout ressaisir à la main, alors que chaque traitement et chaque apport nomme déjà
son produit.

Le bouton **« Importer les produits déjà employés »** liste ce qui est employé et
qu'aucun article ne suit, avec le nombre d'utilisations et la date du dernier
emploi. Cocher, valider : les articles sont créés et rattachés au référentiel —
et les « utilisations non rattachées », qui ne voyaient jusqu'ici que les
produits déjà suivis, commencent dès lors à faire leur travail.

**L'unité n'est pas devinée.** Celle qui est proposée est celle des saisies —
`quantityUnit` pour un traitement, `totalUnit` pour un apport —, jamais
`doseUnit`, qui est une dose *par hectare* : un stock tenu en « kg/ha » n'a aucun
sens. Et quand les saisies ne s'accordent pas, le même produit étant noté tantôt
en litres tantôt en kilos, aucune n'est retenue d'office : l'écran les énumère
avec leur nombre d'occurrences et laisse trancher. Prendre la plus fréquente
reviendrait à décider d'une densité que Parcelys refuse de décider.

Importer crée le **suivi**, pas le stock : le solde reste à zéro tant qu'aucune
entrée n'est saisie, et l'écran le dit — une liste qui se remplit donne
facilement l'impression d'un local inventorié.

Deux cas traités plutôt que subis : un article saisi à la main avant l'import est
**rattaché** et non dupliqué ; et un import dont rien n'aboutit répond en erreur,
pas en succès vide — c'est l'audit de cloisonnement qui l'a relevé, une tentative
d'importer le produit d'une autre exploitation « aboutissant » en 200 alors
qu'elle n'avait rien créé.

---

## 0.9.5 — Un audit qui cherche à échouer

Cette version n'ajoute presque pas d'écrans. Elle vérifie ceux qui existent —
et corrige ce que la vérification a trouvé.

La règle suivie du début à la fin : **une fonctionnalité n'est pas fonctionnelle
parce qu'elle figure dans le code ou à l'écran.** Chaque contrôle ajouté a été
éprouvé en cassant volontairement ce qu'il surveille, pour s'assurer qu'il vire
au rouge. Un contrôle qui ne peut pas échouer ne vérifie rien.

### Une date pouvait s'afficher décalée d'un jour

Le défaut le plus sérieux de cet audit, et le moins visible. Trouvé en suivant
un avertissement React sur `/portefeuille` qui n'avait l'air de rien.

`toLocaleDateString('fr-FR')` sans fuseau lit la date dans celui **du
processus**. Le serveur tourne en UTC — celui de ce dépôt comme celui du
Raspberry Pi tel qu'il est livré —, le navigateur à l'heure de Paris.

Conséquence : un traitement enregistré le 11 septembre à 22 h 30 UTC
s'affichait « 11/09/2026 » dans le HTML servi et « 12/09/2026 » après
hydratation. Le registre phytosanitaire est une pièce opposable ; une date
décalée d'un jour entre l'écran et l'export n'y est pas un détail d'affichage.

Le même défaut atteignait la campagne culturale, et plus gravement :
`campagneCourante` employait `getMonth()`, donc le fuseau de la machine. Le
31 juillet à 23 h 00 UTC, il est déjà le 1ᵉʳ août en France — le serveur
comptait une campagne, le navigateur l'autre. Une saisie faite ce soir-là
atterrissait dans une campagne et s'affichait dans l'autre, ce que l'en-tête du
module interdisait explicitement depuis 0.9.1.

Le fuseau de l'exploitation (`Europe/Paris`) fait désormais foi partout, quelle
que soit la machine qui calcule. Les bornes de campagne sont de vrais instants
français, et non plus des minuits du fuseau du serveur — ce qui laissait dehors
les saisies du 1ᵉʳ août entre minuit et deux heures.

`tests/fuseau.test.ts` éprouve les deux, avec des instants pris juste avant
minuit à Paris : c'est là, et seulement là, que les deux lectures divergeaient.

### Le contrôle phytosanitaire ne lisait qu'un tiers du catalogue

E-Phy fournit, pour chaque usage, le nombre maximal d'applications, l'intervalle
minimal entre deux passages et le délai avant récolte. Parcelys les importait,
les affichait — et ne s'en servait pas. Seule la dose était opposée.

Les trois sont désormais vérifiés à la saisie (`src/lib/ephy/limites.ts`), avec
les conditions d'emploi qui ne se calculent pas mais se rappellent : délai de
rentrée, mentions abeilles, riverains.

Un piège rencontré en chemin : `buildPhytoWarnings` est appelé **après**
l'écriture du traitement, donc le traitement en cours était compté dans
l'historique. Le deuxième passage d'un produit qui en autorise deux déclenchait
l'alerte du troisième. Corrigé en excluant la ligne qu'on vient d'écrire.

Les valeurs non numériques du catalogue — « 2 à 3 », « selon la culture » — ne
sont pas devinées : elles sont ignorées, et le contrôle le dit.

### Un contrôle avant épandage, qui ne conclut jamais à la légère

« Est-ce que je peux épandre là, aujourd'hui, cette quantité ? »
`POST /api/regulatory/spreading` répond sans rien écrire : on le relance autant
qu'on veut en changeant la date ou la dose.

Il vérifie la période d'interdiction, les distances aux cours d'eau et aux
habitations, et le plafond d'azote organique. Surtout, il distingue trois états
— et **ne dit jamais « conforme » quand une vérification n'a pas pu être faite**.
Sans référentiel chargé, la réponse est « à vérifier », avec le nom de ce qui
manque.

L'azote apporté suit la formule déjà employée par le bilan NPK. En employer une
autre aurait donné deux chiffres différents pour le même apport selon l'écran
consulté — pire que pas de chiffre du tout.

### Les pages d'erreur parlaient anglais

Aucune page 404 ni 500 n'existait : Next.js servait les siennes, en anglais, au
milieu d'un logiciel entièrement en français. Trois pages ajoutées, dont une qui
n'utilise que des styles en ligne, parce qu'une erreur globale peut survenir
avant que la feuille de style ne soit chargée.

Une parcelle inexistante affichait de surcroît une page vide plutôt qu'un
message : le garde-fou d'accès ne savait pas traduire « introuvable » en 404.

### Le titre d'une page divulguait le nom d'une parcelle d'autrui

L'onglet du navigateur affichait le nom de la parcelle avant que le contrôle
d'accès n'ait rendu son verdict. Le titre est maintenant produit par le même
contrôle que la page.

### La restauration des sauvegardes n'avait jamais été essayée

Un script de sauvegarde existait et vérifiait ce qu'il écrivait. Mais une
archive relisible n'est pas une archive **restaurable** : un dump peut être
complet et refuser de se rejouer.

`scripts/restore.sh` fait donc l'essai à blanc par défaut, dans une base
jetable, et compare le nombre de lignes de chaque table et l'empreinte des
contours parcellaires — ce sont eux qui portent les superficies, donc les
déclarations. `npm run check:sauvegarde` enchaîne le cycle complet et vérifie
aussi qu'une archive tronquée est **refusée** avant toute restauration.

### Outillage d'audit

Quatre vérifications qui se lancent d'une commande — `npm run audit:tout` :
47 pages sur trois profils, 76 routes d'API dont sept tentatives de franchir
le cloisonnement, un parcours complet du compte vide à la synchronisation
hors ligne, et un relevé de performance.

Ce qui ne peut pas être vérifié ici est annoncé comme tel, avec la commande qui
le vérifierait ailleurs — jamais transformé en coche verte.

### Trois pièges de l'outillage, qui auraient fait de faux constats

- Le serveur d'audit tuait le processus parent et laissait l'enfant tenir le
  port : la vérification s'exécutait contre l'**ancien** build et signalait des
  feuilles de style introuvables qui ne l'étaient pas.
- Le navigateur de Playwright change de numéro de révision à chaque mise à jour
  de la bibliothèque ; dix vérifications s'arrêtaient alors sur « installez le
  navigateur ». Elles cherchent maintenant celui qui est présent
  (`scripts/lib/navigateur.mjs`).
- La suite de tests vide la base. Lancer `npm test` puis une vérification au
  navigateur faisait expirer la connexion au bout de trente secondes, sans dire
  pourquoi. Le compte est désormais éprouvé par l'API d'abord, et le message dit
  quoi faire (`scripts/lib/compte.mjs`).

### Un fichier statique manquant passait inaperçu

L'audit des pages ne relevait que les erreurs serveur (5xx). Un fichier absent
répond 404 — ou 400 pour une icône déclarée dans les métadonnées, comme l'a
montré l'essai. Toute réponse qui n'est pas un succès sur un fichier statique
est maintenant signalée.

### Ce qui n'est pas là, écrit noir sur blanc

L'audit a cherché l'élevage et le classement ICPE, la certification AB et les
MAEC dans les 54 modèles du schéma. Ils n'y sont pas, et
[`docs/reglementaire.md`](./docs/reglementaire.md) dit maintenant ce que cela
empêche — notamment qu'un produit interdit en AB **ne sera pas signalé comme
tel**, faute que la notion existe.

---

## 0.9.1 — Une seule campagne, un nom qu'on retrouve, et une faille fermée

### Une exploitation pouvait écrire dans le parcellaire d'une autre

Trouvé en auditant le cloisonnement des modèles PAC, qui sont arrivés après les
55 contrôles de sécurité existants et n'y figuraient pas.

L'aperçu d'import permet de désigner soi-même la parcelle qu'une entité du
dossier doit mettre à jour, quand la correspondance proposée ne convient pas.
Cet identifiant vient du navigateur, et il était employé tel quel :
`parcel.update({ where: { id } })` ne regarde pas à qui la parcelle appartient.

Mesuré sur la base avant correction : un import lancé depuis l'exploitation A,
avec l'identifiant d'une parcelle de l'exploitation B glissé dans les décisions,
**réécrivait cette parcelle-là** — type, code INSEE, `pacId`, superficie
(12,3456 ha devenus 2,6702), plus une géométrie et une culture créées chez le
voisin. Aucune des deux exploitations n'en voyait rien.

Deux garde-fous, parce qu'ils ne protègent pas la même chose : la demande est
refusée et le dit, et l'écriture elle-même est bornée à l'exploitation, de sorte
que la base refuse la ligne étrangère même si un futur chemin de code
contournait la vérification. Les deux ont été éprouvés séparément, en
débranchant l'un puis l'autre.

`tests/cloisonnement-pac.test.ts` rejoue cette attaque, et couvre le reste du
domaine PAC : sauvegardes, campagnes, îlots, entités.

### Deux campagnes différentes, le même jour, sur le même écran

La page PAC prenait l'année civile ; tout le reste du site prenait la campagne
culturale, qui bascule au 1ᵉʳ août. Le 11 septembre 2026, Parcelys affichait
donc « Campagne 2026 » sur la page PAC et « Campagne 2027 » sur la liste des
parcelles, sans qu'un mot explique l'écart.

Ce n'était pas qu'une gêne. Un dossier TéléPAC 2026 importé ce jour-là rattache
ses cultures à la campagne 2026 ; la liste des parcelles, qui affiche la
campagne en cours, montrait alors 141 parcelles « sans culture déclarée ». Les
cultures étaient bien en base — c'est l'écran qui regardait ailleurs.

Une seule définition désormais (`src/lib/shared/campagne.ts`), partagée avec
l'application mobile. Et surtout, les écrans **disent** de quoi ils parlent :

- la période est écrite sous chaque sélecteur — « 1ᵉʳ août 2026 → 31 juillet 2027 » ;
- chaque campagne proposée dit ce qu'elle contient : « 2026 — 141 culture(s), 47 îlots PAC » ;
- quand la campagne affichée est vide et qu'une autre ne l'est pas, un bandeau
  le signale et offre le lien. Il ne bascule pas tout seul : une saisie qui
  atterrirait dans une campagne qu'on n'a pas choisie serait pire que la liste
  vide qu'on corrige.

La campagne s'incrémente d'elle-même chaque 1ᵉʳ août — 2027, puis 2028 —, sans
tâche annuelle ni bascule à la main. Le 1ᵉʳ août est un **usage** des grandes
cultures, pas une date réglementaire, et Parcelys ne le présente jamais comme
telle.

Sur la page PAC, le sélecteur commande enfin toute la page : il ne changeait
qu'une variable locale, si bien qu'on pouvait choisir 2025, importer dans 2025,
et lire au-dessus « Campagne 2026 » avec les chiffres de 2026.

### Le dossier 2022 ne pouvait pas être importé

Constaté en rejouant les cinq campagnes réelles de bout en bout : l'import de
2022 s'arrêtait sur `Self-intersection`, et toute la campagne était perdue.

La géométrie n'avait rien. Îlot 28 parcelle 40, 55 sommets : **valide** dans le
fichier, valide après réparation, valide après projection — et invalide dès
qu'elle passait par le GeoJSON qui la transporte jusqu'à la base. `ST_AsGeoJSON`
arrondit à neuf décimales par défaut, soit un dixième de millimètre, et
l'arrondi repliait deux sommets voisins l'un sur l'autre.

Quinze décimales partout où une géométrie **revient en base** : analyse
d'import, sauvegarde avant import, lecture pour modification. Les cinq campagnes
2022→2026 s'importent désormais sans un échec.

### Donner un nom à sa parcelle, et la retrouver avec

Un import TéléPAC nomme les parcelles d'après la déclaration : « Îlot 39 —
parcelle 3 ». C'est juste, et inutilisable au quotidien.

**Renommer** se faisait jusqu'ici par l'assistant complet — la carte, le
contour, le type de sol — pour changer trois mots. Un bouton « Renommer » ouvre
maintenant un formulaire qui ne porte que le nom, le numéro interne et le
lieu-dit, sur le site comme dans l'application de terrain, où il part par la
file d'attente comme toute saisie et s'affiche aussitôt, réseau ou pas.

**Chercher** ne trouvait pas ce qu'on tapait : la recherche était insensible à
la casse, pas aux accents. « cote » ne trouvait pas « La Côte », « chene » ne
trouvait pas « Le Chêne ». Or on tape sans accent, au champ, sur un téléphone —
c'est précisément là que la recherche sert.

La comparaison se fait des deux côtés sans accent, dans la base comme dans
l'application. Deux implémentations, donc un risque de divergence :
`tests/recherche-parcelles.test.ts` les confronte sur des noms réels. Il a
d'ailleurs servi tout de suite, en attrapant une table SQL qui rendait
« vallee de l'auf » là où le JavaScript rendait « vallee de l'œuf ».

### Doublons, hectares, indépendance des campagnes

Vérifié sur les cinq dossiers réels 2022→2026, importés l'un après l'autre dans
une vraie base :

- **aucun doublon** : ni deux parcelles pour un même couple îlot/parcelle, ni
  deux fois la même parcelle déclarée dans une campagne ;
- **les hectares concordent** : la surface affichée est celle que mesure
  PostGIS à moins d'un demi-mètre carré sur 150 parcelles, et le total mesuré
  rejoint le total déclaré à 0,00 % sur chacune des cinq campagnes
  (431,87 / 431,75 / 543,18 / 544,54 / 542,80 ha) ;
- **les campagnes sont indépendantes** : 58 parcelles portent des cultures
  différentes selon l'année, et importer une campagne ne touche pas aux
  précédentes.

Un défaut au passage : TéléPAC réattribue les numéros libérés d'une campagne à
l'autre, et quand deux parcelles distinctes revendiquaient « 13-72 », la seconde
restait **sans aucun numéro interne** — 6 parcelles sur 150, introuvables en
tapant leur numéro, et rien ne le disait. Parcelys ne fond toujours pas les deux
parcelles, ce serait déplacer un registre phytosanitaire sur le mauvais champ ;
mais le numéro est désormais complété (« 13-72 (2025) ») et le fait est
**annoncé** à la fin de l'import.

### L'administrateur peut effacer une exploitation pour de bon

La suppression était uniquement logique : `deleted_at` renseigné, rien d'effacé.
C'est ce qu'il faut la plupart du temps — les registres se conservent — mais pas
pour honorer une demande d'effacement.

« Effacer définitivement » détruit tout : parcelles et contours, registres,
apports, travaux, campagnes PAC, documents, **jusqu'aux fichiers sur le disque**,
que la base ne connaît pas et qui seraient restés sans cela.

Trois verrous, parce qu'un seul ne suffit pas à une action sans retour :
l'exploitation doit déjà être supprimée, son nom exact doit être retapé, et ce
qui va être détruit est compté et annoncé avant d'agir. Le journal
d'administration, lui, survit — avec le nom disparu et le décompte.

Les comptes des membres ne sont pas supprimés : ils subsistent sans
exploitation. C'est dit à l'écran.

### Aussi

- Le dépôt PAC acceptait `.zip` et les fichiers Shapefile, mais **pas `.xml`** —
  le seul format que TéléPAC donne réellement. Le sélecteur de fichiers grisait
  donc le fichier que l'exploitant possède.
- La recherche de l'application de terrain porte aussi sur le lieu-dit.
- `npm run check:091` rejoue au navigateur ce que cette version promet.

---

## 0.9.0 — Ce que l'import rapporte vraiment, et trouver sa parcelle

### L'import PAC remplissait la carte, pas la fiche

Le dossier TéléPAC porte le code INSEE de la commune (sur l'îlot), le numéro
d'îlot et de parcelle, et le code culture (sur la parcelle). Aucun des trois
n'atteignait la fiche : la parcelle importée arrivait avec un contour, une
surface, et rien d'autre. Signalé après le premier import réel.

Les trois remontent désormais. Sur le dossier 2026 : **141 parcelles sur 141**
avec leur code INSEE et leur culture déclarée, 138 avec leur numéro d'îlot.

Deux choses ne sont pas inventées pour autant :

- **Le nom de la commune n'est pas dans le dossier.** Il est retrouvé par le
  même géocodeur que la saisie manuelle, une requête par commune distincte, et
  seulement s'il tombe d'accord avec le code INSEE déclaré. Sans réseau, le code
  part seul.
- **Le code culture PAC (« BTH ») et celui de Parcelys (« BLE_TENDRE ») sont
  deux référentiels distincts**, sans correspondance officielle dans le dossier.
  Une culture portant le code déclaré est donc créée, et vous la renommez une
  fois : le rattachement vaut ensuite pour toutes les campagnes, puisque c'est
  le code qui fait la clé.

La culture créée par un import porte une note qui dit d'où elle vient. Une
déclaration corrigée peut ainsi corriger ce qu'un import précédent avait écrit,
**sans jamais toucher** à une culture que vous avez saisie ou corrigée — la
note disparaît dès qu'on modifie la ligne.

### Réimporter créait des parcelles en double

Trouvé en vérifiant le point précédent : réimporter le même dossier 2026 créait
**8 parcelles en trop sur 140**. Le rapprochement se faisait uniquement par
géométrie — meilleur recouvrement au-dessus de 0,30 —, et quand deux parcelles
voisines se ressemblent ou qu'un contour a bougé, il se trompe de voisine ou ne
trouve personne.

Le dossier désigne pourtant chaque parcelle par son numéro d'îlot et son numéro
dans cet îlot. C'est la clé que l'administration emploie, et un import précédent
l'a déjà enregistrée. Le rapprochement se fait donc par **identité** d'abord, la
géométrie ne servant plus que de repli — pour un premier import, ou une parcelle
renumérotée. Résultat mesuré : 0 doublon, 134 parcelles rapprochées par leur
numéro. L'aperçu dit maintenant sur quoi repose chaque rapprochement.

Une parcelle ne peut par ailleurs plus être revendiquée deux fois : sans cette
garde, deux entités du dossier se rapprochant de la même parcelle la mettaient
toutes deux à jour, et la géométrie retenue dépendait de l'ordre de lecture.

### Trouver sa parcelle

**L'espace expert n'avait aucune recherche.** Sur une exploitation de cent
parcelles, il fallait deviner en tâtonnant sur la carte. Un champ filtre
maintenant la liste à la frappe, sans recharger la page — une recherche qui
coûte une seconde par lettre sur une liaison de campagne ne sert à personne.
Nom, numéro d'îlot, commune, lieu-dit, culture : les cinq façons dont on désigne
une parcelle.

**« Où suis-je ? » sur l'application.** Chercher par le nom suppose qu'on le
connaisse ; sur cent parcelles importées d'un dossier PAC, elles s'appellent
« Îlot 39 — parcelle 3 » et personne ne les a en tête. Le bouton ouvre la
parcelle où l'on se trouve, calculé dans le téléphone à partir des géométries en
cache — donc sans réseau, ce qui est la situation.

Trois réponses, jamais quatre : on est dans une parcelle, on n'est dans aucune —
et la plus proche est alors nommée sans être ouverte —, ou la position est
introuvable. Ouvrir « la plus proche » quand on roule sur la route qui la borde
ferait saisir un traitement sur la mauvaise parcelle. Les trous comptent : une
mare au milieu d'une parcelle n'est pas la parcelle.

### Le retour à la liste perdait tout

Depuis une fiche parcelle, « ← Retour aux parcelles » pointait sur `/parcelles`
en dur : recherche, filtre, vue et campagne étaient perdus. Sur 140 parcelles,
cela veut dire refaire la recherche à chaque aller-retour — et on n'en fait pas
deux. Le contexte de la liste voyage désormais avec le lien et revient avec lui.

---

## 0.8.1 — Deux défauts trouvés en déployant

La 0.8.0 ne s'est pas installée. Les deux défauts ci-dessous ont la même
racine : une vérification qui passait chez moi et ne pouvait pas passer
ailleurs.

### La compilation échouait sur un dépôt fraîchement cloné

```
./mobile/src/lib/db.ts:1:43
Type error: Cannot find module 'idb'
```

Le `tsconfig.json` de la racine exclut `mobile/` — et un commentaire y explique
précisément cette panne, pour l'avoir déjà payée une fois. Mais l'exclusion ne
vaut que pour la collecte des fichiers : un fichier inclus qui **importe** un
module mobile le rattrape dans le graphe de types malgré tout. Trois tests
ajoutés en 0.8.0 importaient `../mobile/src/…`, et le graphe mobile mène à
`idb`, dépendance déclarée dans `mobile/package.json`, absente à la racine.

La compilation réussissait donc chez qui développe les deux côte à côte —
`mobile/node_modules` est là — et échouait chez qui déploie. Le service est
resté sur la version précédente, ce qui est le bon comportement du script de
mise à jour, mais personne ne l'avait vu venir.

La logique partagée a désormais un terrain commun que l'application compile par
ses alias : `src/lib/ephy/catalogue-local.ts` et `src/lib/shared/sync-status.ts`.
Un test de garde échoue si un fichier du serveur réimporte de `mobile/src/`, et
un autre si le terrain commun se met à importer Prisma ou `server-only` — la
même erreur en sens inverse ferait échouer la compilation de l'APK.

Au passage, `OfflineCatalogueEntry` était défini deux fois, serveur et mobile,
pour la même forme. Une seule définition désormais.

### Le haut des fenêtres de saisie était hors d'atteinte

Signalé sur le formulaire de traitement phytosanitaire : « l'onglet est plus
grand et je ne vois pas tout ».

Le dialogue était centré verticalement par `items-center`. Un dialogue plus haut
que la fenêtre déborde alors des deux côtés à parts égales, et **le haut passe
hors de portée du défilement**, qui ne remonte pas au-dessus de son origine.
Mesuré sur un écran de 768 px : dialogue de 1 003 px, haut à −117 px, et il y
restait après avoir remonté à fond. Le titre et les premiers champs étaient
perdus.

Le défaut ne se voyait pas sur téléphone, où le centrage ne s'appliquait pas —
d'où un contrôle de mise en page qui mesurait sept largeurs mobiles sans rien
trouver. Il touchait **quatre formulaires**, pas un : culture, couvert
d'interculture, apport et traitement. Le phyto était le pire, avec 202 px perdus
sur un écran de 600 px.

Le centrage passe par des marges automatiques, qui se réduisent à zéro plutôt
que de rogner. Le dialogue est en outre plafonné à la hauteur de la fenêtre :
le titre reste visible et c'est le formulaire qui défile — sur un formulaire de
quinze champs, faire défiler le tout fait perdre de vue ce qu'on remplit et sur
quelle parcelle.

`npm run check:modales` ouvre sept formulaires à quatre hauteurs d'écran, 28
mesures, et vérifie qu'aucune partie n'est inatteignable. Sa capacité à
détecter le défaut a été vérifiée en le remettant.

---

## 0.8.0 — Le dossier TéléPAC, et le hors-ligne qui vérifie vraiment

Cinq exports TéléPAC réels — les campagnes 2022 à 2026 d'une même
exploitation — ont servi de matière. Ils ont montré deux choses : Parcelys ne
savait pas lire le fichier que TéléPAC donne, et le contrôle réglementaire du
téléphone s'arrêtait dès que le réseau tombait.

### Ce qui est nouveau

**Import du dossier XML TéléPAC.** TéléPAC propose deux téléchargements :
l'export graphique (Shapefile) et le dossier lui-même, en XML. Parcelys ne
savait lire que le premier et rangeait le second parmi « les fichiers dont ce
module n'a que faire ». Un exploitant qui déposait le fichier que TéléPAC lui
donne spontanément s'entendait répondre qu'aucune donnée géographique n'avait
été trouvée : exact, et parfaitement inutile.

La structure a été établie en confrontant cinq exports réels, faute de notice
officielle. Elle est donc annoncée **constatée**, jamais officielle — cinq
dossiers ne prouvent pas qu'un sixième leur ressemblera. Les deux formats
empruntent maintenant la même chaîne : une seule à vérifier, pas deux.

Trois points où l'honnêteté a coûté quelque chose :

- Le fichier ne déclare **pas** son système de coordonnées. Il est proposé
  d'après l'emprise et l'utilisateur doit le confirmer : un parcellaire projeté
  depuis le mauvais système atterrit à des centaines de kilomètres.
- `surface-admissible` n'est pas rattachée au champ « surface déclarée ». Sur le
  dossier 2026, 9 parcelles sur 113 la portent **supérieure** à leur propre
  géométrie — jusqu'à 1,08 ha — alors que les totaux se rejoignent au niveau de
  l'îlot. La cause n'a pas pu être vérifiée ; signaler l'écart produirait une
  alerte sur des parcelles correctes.
- Le libellé de culture reste vide : le fichier ne porte que le code.

Effectifs animaux et demandes d'aides ne sont pas lus, et sont **nommés** plutôt
que passés sous silence.

**Le contrôle de dose fonctionne sans réseau.** L'instantané mobile ne portait
des produits que le nom, l'AMM et la dernière dose. Les usages officiels — dose
retenue, culture autorisée, ZNT, délai avant récolte — demandaient un appel
réseau. Hors connexion, l'application acceptait donc un traitement **sans le
moindre contrôle réglementaire**, au champ, pulvérisateur en route. Pire, le
raccourci le plus utilisé — reprendre un produit déjà employé — effaçait les
usages et vérifiait donc le moins.

Les produits qu'une exploitation emploie sont peu nombreux : leurs usages
officiels partent désormais dans l'instantané, dans la même forme que la réponse
en ligne. 1,5 Ko par produit, 60 produits au plus. Ce n'est pas le catalogue
E-Phy, et l'application ne le laisse jamais croire : un produit jamais employé
se dit « pas dans ceux que vous avez employés », jamais « produit inconnu ».

**Changement d'adresse e-mail**, web et mobile. `EMAIL_CHANGE` était déclaré
dans le schéma depuis le début sans que rien ne l'utilise. L'adresse est
l'identifiant de connexion et l'endroit où arrivent les liens de
réinitialisation : la modifier sans vérification donnerait à quiconque passe
devant un écran resté ouvert le moyen de s'approprier le compte. Mot de passe
redemandé, code envoyé à la **nouvelle** adresse, ancienne prévenue dès la
demande — pas seulement à la fin.

**Voyant de synchronisation**, cinq états dérivés et jamais stockés. Hors
connexion n'est pas une panne : c'est la situation normale au champ, et la
peindre en rouge apprendrait à ne plus regarder le voyant.

### Défauts corrigés

**Un second import de la même campagne doublait toutes les entités PAC.** 769
entités devenaient 1 538, mesuré sur un dossier réel. Rien ne le signalait : la
carte affichait les mêmes contours deux fois et le décompte des SNA était faux.
Réimporter son dossier pour vérifier que ça a marché est pourtant le geste le
plus naturel qui soit.

**157 des 560 SNA de 2026 sont des points** — des arbres isolés — que la colonne
`geometry(MultiPolygon)` refusait. Élargie ; aucun rayon n'est inventé pour un
point, il n'a donc pas de surface.

**Deux débordements horizontaux**, aucun visible à 390 px : `/phytosanitaire` à
768 px en tablette, `/profil` à 320 px. Le contrôle ne mesurait qu'à une seule
largeur ; il en couvre sept, soit 168 mesures.

**Vingt-cinq textes disaient « instance » à l'utilisateur** — « Instance
privée », « Premier compte de l'instance », « Administrateur de l'instance ». Ce
mot décrit la façon dont le logiciel tourne, ce qui ne regarde pas l'exploitant.
Aucun comportement n'a changé ; un test de garde empêche le retour.

### Vérifier

```bash
npm run test:ci                          # build puis 497 tests
npm run check:telepac -- <dossiers.xml>  # 77 contrôles, cinq campagnes réelles
npm run check:pac -- <2025.xml> <2026.xml>  # import complet en base
```

`check:pac` vérifie ce qu'aucun test unitaire ne peut voir : interventions,
registre phytosanitaire, apports et cultures **intacts** après import, et la
campagne 2025 encore entière après l'import de 2026.

**`npm run verif:navigateur` remet la limite de débit à zéro avant de
commencer**, et plus seulement entre les contrôles. `check:security` coupe
volontairement la connexion à la fin de son parcours — c'est l'un de ses 55
contrôles. Le paquet lancé deux fois de suite échouait donc toujours au second
passage, dès le premier écran, sur un délai d'attente qui ne désignait pas la
cause. Constaté en le lançant deux fois.

---

## 0.7.0 — Priorité 2 du socle réglementaire

Six manques annoncés en 0.6.0 sont comblés. Six défauts ont été trouvés en
vérifiant le travail — sur une vraie base, puis au navigateur — et deux d'entre
eux étaient antérieurs à cette version.

### Ce qui est nouveau

**Stocks et lots.** La question d'un contrôle n'est pas « combien vous
reste-t-il », c'est « quel lot a été appliqué sur quelle parcelle, et d'où
venait-il ». Le chaînage achat → lot → traitement → parcelle répond à celle-là.

Le solde n'est jamais stocké : c'est la somme des mouvements, signés. Un compteur
mis à jour à chaque écriture finit toujours par mentir. Une masse ne se convertit
jamais en volume — la densité varie d'un produit à l'autre. Le stock ne se
décrémente pas tout seul : le rattachement est choisi, et les utilisations non
rattachées sont listées en tête de l'écran pour que l'écart soit visible.

**Couverture des sols, irrigation, rotation.** Les périodes de couverture
obligatoire relèvent du programme d'actions régional ; Parcelys enregistre ce qui
a été fait et répond « non vérifiable » tant qu'il ne l'a pas. Il vérifie tout de
même la cohérence des dates, qui ne suppose aucune règle. L'irrigation s'ajoute
au travail existant, avec la teneur en **nitrate** de l'eau. La rotation est lue
des cultures déjà saisies — aucun modèle nouveau.

**Plafond d'azote organique.** Le chiffre de 170 kg N/ha n'est écrit nulle part :
il ne s'applique pas hors zone vulnérable, connaît des dérogations, et un chiffre
en dur n'a pas de source à montrer. Parcelys calcule toujours ce qui a été épandu
et ne le compare que si le programme d'actions fournit un plafond — avec sa
référence de texte.

**Cahier d'épandage**, produit à partir des apports enregistrés, jamais ressaisi.
Ses lignes incomplètes sont conservées avec leurs lacunes.

**Dossier de contrôle et justificatifs typés.** Il rassemble les pièces et dit
lesquelles manquent. Il ne se dit jamais complet : la liste des pièces exigibles
dépend du contrôle, Parcelys n'en connaît qu'une partie, et il l'écrit.

**Documents verrouillés.** Verrouiller ne bloque pas la saisie : cela crée une
copie datée qui ne bouge plus. Rien n'est écrasé, un contenu identique ne crée
pas de doublon, et les lacunes du moment restent attachées au document.

**Couches réglementaires sur la carte existante**, éteintes au départ, posées
sous les parcelles, restreintes à l'emprise de l'exploitation, chacune avec sa
source et sa version.

**Import d'un zonage depuis un service WFS.** Les DREAL publient en services web
bien plus souvent qu'en fichiers ; sans cela, un exploitant ne pouvait pas
importer le zonage de sa propre région.

**Application mobile** : irrigation, couvert d'interculture, et le numéro de lot
saisi le bidon en main — la seule information de traçabilité qui se perd si on ne
la note pas sur place.

### Défauts corrigés

**L'azote réalisé était environ 75 fois trop bas.** `nSupplied` est une dose à
l'hectare — c'est ce que produit `computeNutrients` et sa documentation le dit —
mais `comparePlanToActual` la traitait comme un total et redivisait par la
surface. Le contrôle de dépassement du prévisionnel, vérification centrale de la
fertilisation azotée, ne se serait pratiquement jamais déclenché. Le défaut était
invisible parce que la double erreur s'annulait sur une parcelle entièrement
traitée, et parce que deux fixtures de test encodaient la convention inverse en
se contredisant l'une l'autre.

**Une parcelle sans donnée de zonage passait pour « hors zone ».**
`zones.some(...)` rendait `false` aussi bien pour une parcelle hors zone que pour
une parcelle dont le référentiel n'était pas importé. Une contrainte qui
s'applique peut-être disparaissait de l'écran, sans un mot. Trois états
désormais, jamais deux.

**La version WFS lue était celle du document XML.** Tout GetCapabilities commence
par `<?xml version="1.0"?>` : Parcelys en déduisait un service d'avant la 2.0.0,
envoyait les mauvais paramètres et surtout cessait de paginer. Un zonage de 8 000
polygones se serait importé à 1 000, sans message.

**`ST_Extent` perd le SRID.** Les couches de la carte ne se seraient jamais
affichées. Trouvé par le script de vérification, pas par un test unitaire.

**Deux tables imbriquées** cassaient l'hydratation React sur deux écrans :
`TableWrapper` rend déjà un `<table>`.

**Le logo pouvait disparaître jusqu'au redémarrage du service.** L'optimiseur
d'images de Next garde en mémoire une promesse par variante (fichier, largeur,
qualité, format). Un client qui se déconnecte pendant l'encodage — un téléphone
qui perd le réseau au milieu d'un champ — laisse cette promesse sans réponse, et
toutes les requêtes suivantes pour la même variante attendent indéfiniment.
Constaté sur `/_next/image?url=/icone.png&w=48` : 70 ms sur un serveur neuf,
jamais de réponse après une requête interrompue, alors que toutes les autres
largeurs du même fichier continuaient de répondre. Ces icônes sont désormais
servies telles quelles : à 20 ou 32 pixels, les optimiser économisait quelques
kilo-octets et achetait ce mode de panne.

**Deux scripts du dépôt se contredisaient** sur les comptes d'audit :
`check-corrections` attendait une adresse qu'aucun script ne crée, et échouait
sur un délai d'attente qui ne désignait pas la cause.

### Vérifier

```bash
npm run test:ci          # build puis 429 tests
npm run check:stocks     # solde, cloisonnement, traçabilité, sur une vraie base
npm run check:couverture # qu'aucune règle régionale ne soit inventée
npm run check:plafond    # les deux sens du plafond, avec et sans règle
npm run check:dossier    # qu'un verrou verrouille vraiment
npm run check:carte      # emprise, provenance, poids
npm run check:security   # 55 contrôles de cloisonnement
```

Deux commandes groupent tout, dans le bon ordre :

```bash
npm run verif:sans-navigateur   # les cinq contrôles sur base
npm start &                     # puis, serveur démarré :
npm run verif:navigateur        # comptes d'audit, écrans, pages, mobile, sécurité
```

**L'ordre n'est pas décoratif**, et deux pièges ont coûté du temps avant d'être
compris :

- `check:security` coupe volontairement la connexion après une série d'essais
  infructueux — c'est même l'un de ses 55 contrôles. Lancé en premier, il bloque
  tous les contrôles au navigateur qui suivent, avec des délais d'attente qui ne
  désignent pas la cause. Il passe donc **en dernier**.
- `check:advisory` **révoque l'accès de l'expert** à la fin de son parcours, ce
  qui est précisément ce qu'il vérifie. Tout contrôle qui suit trouve un
  portefeuille vide. Il passe donc après `check:corrections`, et
  `npm run audit:comptes` sait maintenant réactiver une mission révoquée au lieu
  d'échouer sur la contrainte d'unicité.

Troisième piège, hors ordre : `next dev` écrase la sortie de production dans
`.next`, et un serveur relancé après lui sert l'ancien code. Reconstruire avant
de vérifier.

---

## 0.6.1 — API data.gouv.fr

Découverte des référentiels par l'API plutôt que par des URL codées en dur : il
n'existe pas de jeu national « zones vulnérables », et les slugs changent.

## 0.6.0 — Socle réglementaire

Référentiels versionnés et territorialisés, contexte réglementaire de la parcelle
par intersection géométrique, bilan azoté explicable, IFT sur doses de référence,
tableau de bord de conformité. Aucune valeur réglementaire n'est détenue en
propre par Parcelys.

## 0.5.0 — E-Phy exploitable

Produits retirés signalés, dose autorisée par culture, alerte de surdosage, ZNT
et sol drainé.
