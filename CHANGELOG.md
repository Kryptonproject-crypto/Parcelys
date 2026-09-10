# Journal des versions

Ce fichier dit **ce qui a changé et pourquoi**, pas la liste des commits. Un
défaut corrigé y figure avec ce qu'il produisait : c'est ce qui permet, un an
plus tard, de comprendre pourquoi une décision a été prise.

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
npm run test:ci          # build puis 430+ tests
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
