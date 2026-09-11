# Journal des versions

Ce fichier dit **ce qui a changé et pourquoi**, pas la liste des commits. Un
défaut corrigé y figure avec ce qu'il produisait : c'est ce qui permet, un an
plus tard, de comprendre pourquoi une décision a été prise.

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
