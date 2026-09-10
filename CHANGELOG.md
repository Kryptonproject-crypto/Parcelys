# Journal des versions

Ce fichier dit **ce qui a changé et pourquoi**, pas la liste des commits. Un
défaut corrigé y figure avec ce qu'il produisait : c'est ce qui permet, un an
plus tard, de comprendre pourquoi une décision a été prise.

---

## 0.7.0 — Priorité 2 du socle réglementaire

Six manques annoncés en 0.6.0 sont comblés. Trois défauts ont été trouvés en
vérifiant le travail sur une vraie base, et deux d'entre eux étaient antérieurs.

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

Les scripts au navigateur (`check:pages`, `check:mobile`, `check:advisory`,
`check:admin`, `check:corrections`) demandent le serveur démarré et les comptes
d'audit : `npm run audit:comptes` d'abord. Ils se lancent **avant**
`check:security`, qui coupe volontairement la connexion après une série d'essais
infructueux et bloquerait les suivants.

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
