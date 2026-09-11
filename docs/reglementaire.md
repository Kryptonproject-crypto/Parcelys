# Le socle réglementaire de Parcelys

Version 0.9.5. Ce document explique **comment Parcelys se comporte face à la
réglementation**, et surtout ce qu'il refuse de faire.

À lire avec [`docs/audit-reglementaire.md`](./audit-reglementaire.md), qui dit
d'où l'on part, et [`docs/ephy.md`](./ephy.md), qui décrit le seul référentiel
déjà pleinement opérationnel.

---

## 1. Le principe qui gouverne tout

> **Parcelys ne détient aucune valeur réglementaire en propre.**

Toute valeur qui sert à calculer une dose, à opposer une période ou à qualifier
un zonage provient d'un jeu de données importé depuis une source officielle,
versionné, daté et territorialisé.

Il en découle trois comportements, systématiques :

| Situation | Ce que Parcelys fait | Ce qu'il ne fait pas |
|---|---|---|
| Référentiel absent | Répond « impossible de vérifier », nomme le référentiel manquant et dit comment l'importer | Ne calcule pas une valeur plausible |
| Donnée manquante | Nomme la donnée et ce qu'elle empêche | Ne la remplace pas par un zéro |
| Règle inconnue | Se tait explicitement | N'extrapole pas depuis une règle voisine |

Ce n'est pas de la prudence excessive. Une dose prévisionnelle fausse se
retrouve dans le plan, dans le bilan, dans le cahier d'enregistrement, et finit
opposée à l'exploitant.

---

## 2. Ce que Parcelys ne dira jamais

> « Votre exploitation est conforme. »

Parcelys n'en sait rien. Il connaît les données saisies et les référentiels
importés. Une exploitation peut être irréprochable dans le logiciel et en
infraction sur le terrain — ou l'inverse, si une donnée manque.

La formulation employée partout est donc :

> « Aucune anomalie détectée selon les données et référentiels actuellement
> disponibles. »

Et lorsque rien n'a pu être vérifié :

> « Aucune vérification réglementaire n'a pu être effectuée : N référentiels
> n'ont pas été importés. L'absence d'anomalie ne signifie donc rien ici. »

Cette phrase est produite par le moteur (`summarize()` dans
`src/lib/regulatory/compliance.ts`) et **jamais reformulée dans l'interface** :
dupliquée dans trois écrans, elle finirait reformulée dans l'un d'eux, et c'est
toujours la reformulation qui promet la conformité. Un test le garde
(`tests/regulatory-compliance.test.ts`).

### Les quatre niveaux

| Niveau | Sens | Couleur |
|---|---|---|
| `OK` | Vérifié, rien à signaler | vert |
| `INDETERMINE` | **La vérification n'a pas pu avoir lieu** | gris |
| `VERIFICATION` | Demande un regard humain | ambre |
| `ANOMALIE` | Écart net à une règle connue | rouge |

`INDETERMINE` n'est jamais affiché en vert. C'est ce qui distingue un logiciel
honnête d'un logiciel rassurant : sans ce niveau, tout ce qui n'est pas vérifié
passerait pour vérifié.

---

## 3. Le contexte réglementaire de la parcelle

### Une intersection, jamais une commune

La tentation est de raisonner par commune : « la parcelle est à Artenay, Artenay
est en zone vulnérable, donc la parcelle l'est ». C'est faux dans les deux sens.

Une commune peut n'être classée qu'en partie. Une parcelle de 8,4 ha peut être à
cheval : 4,8 ha dedans, 3,6 ha dehors. Le raisonnement par commune impose alors
des contraintes à des hectares qui n'en relèvent pas — ou n'en impose aucune à
ceux qui en relèvent.

Parcelys croise donc les géométries pour de vrai :

```
géométrie de la parcelle  ×  géométrie du zonage  =  surface concernée
```

Résultat rendu :

```
Zone vulnérable : partiellement
4,82 ha concernés sur 8,42 ha — 57,2 % de la parcelle.
Le reste n'est pas concerné.
Source : DREAL Centre-Val de Loire — version 2024-07
```

Les surfaces sont calculées en `geography` (mètres sur l'ellipsoïde), comme les
superficies de parcelles. `ST_Area` sur du 4326 rendrait des degrés carrés.

**Seuil de couverture totale : 99,5 %.** Ce n'est pas une tolérance
réglementaire mais géométrique — un contour tracé à la main et un zonage
numérisé ne coïncident jamais au mètre près.

### Ce qui n'est pas déterminé le dit

Un zonage non importé produit une ligne explicite dans le contexte :

```
Zone vulnérable aux nitrates — impossible de vérifier.
Le référentiel « zones-vulnerables » n'a pas été importé.
Importez-le depuis l'administration : Référentiels → zones-vulnerables.
```

Sans cette ligne, l'absence de zonage se lirait comme « parcelle non
concernée ». C'est la différence entre « non » et « on ne sait pas ».

---

## 4. Historique : une campagne garde ses règles

Une règle de 2026 ne doit pas venir corriger rétroactivement la campagne 2024.

Chaque référentiel porte `appliesFrom` / `appliesTo`, et
`resolveReferential({ code, territories, at })` retient **la version en vigueur à
la date demandée**, pas la plus récente. Le territoire est résolu du plus précis
au plus général : département, puis région, puis national.

Une nouvelle version ne supprime jamais l'ancienne : celle-ci passe en
`REMPLACE` et reste lisible. C'est la seule façon de rouvrir une campagne
plusieurs années plus tard et d'y retrouver les mêmes chiffres.

Le détail d'un calcul de bilan est en outre figé dans
`NitrogenPlan.computation` : même si le référentiel a changé depuis, le
raisonnement tel qu'il a été fait reste consultable.

---

## 5. Bilan azoté : un raisonnement, pas un chiffre

```
besoin  −  (reliquat + sol + précédent + irrigation + autres)  =  apport
```

Chaque terme vient d'ailleurs, et **aucun n'est inventé**. Le bilan rend son
propre raisonnement, ligne à ligne, avec l'origine de chaque valeur :

```
BESOIN CULTURE            210 kg N/ha   Référentiel GREN Centre 2026

FOURNITURES
  Reliquat sortie hiver    52 kg N/ha   Analyse de sol du 10/02/2026
  Fourniture du sol        35 kg N/ha   Référentiel GREN Centre 2026
  Effet du précédent       20 kg N/ha   Précédent : Colza
  Irrigation                0 kg N/ha   Parcelle non irriguée
  Autres                    0 kg N/ha   Aucune déclarée
                          ───────────
  TOTAL                   107 kg N/ha

BESOIN D'APPORT           103 kg N/ha
```

Un terme manquant **bloque le bilan** et le dit :

```
Bilan incalculable — reliquat azoté sortie hiver manquant.
→ Enregistrez une analyse de sol, ou saisissez le reliquat.
```

### La seule conversion autorisée

L'azote apporté par l'irrigation :

```
mg/L de nitrate × m³/ha → kg de nitrate/ha → × 14/62 → kg N/ha
```

Purement dimensionnelle, et elle ne suppose aucune donnée agronomique. La teneur
publiée est celle du **nitrate**, pas de l'azote : confondre les deux
surestimerait la fourniture d'un facteur 4,4 et conduirait à sous-fertiliser.

### Prévisionnel contre réalisé

Le réalisé n'est jamais ressaisi : c'est la somme de l'azote des apports déjà
enregistrés sur la campagne, ramenée à l'hectare. Une saisie, deux lectures.

Un dépassement non justifié devient une anomalie, avec l'action à mener :

```
⚠ Dépassement du prévisionnel sans justification
  165 kg N/ha réalisés pour 150 prévus (+15 kg N/ha).
  → Enregistrez une justification d'écart, avec sa cause et son justificatif.
```

---

## 6. IFT : un rapport de doses, pas un compteur

```
IFT = (dose appliquée / dose de référence) × (surface traitée / surface)
```

Une demi-dose sur la moitié d'une parcelle vaut **0,25**. Deux passages à pleine
dose valent **2**. Compter les traitements donnerait 1 et 2 — juste par accident
dans le second cas, faux dans le premier.

**Sans référentiel de doses de référence, aucun IFT n'est calculé.** La
tentation serait d'afficher le nombre de traitements en attendant : ce serait
donner un chiffre faux sous un nom juste, et l'exploitant le comparerait à des
références nationales sans savoir qu'il compare autre chose.

Un traitement sans dose de référence, ou dans une unité non convertible, est
**compté à part** — jamais assimilé à un IFT nul, qui se lirait « sans impact »
alors que la vérité est « non calculable ».

Comme pour le contrôle de dose : **jamais de conversion entre masse et volume**,
la densité des produits n'étant pas publiée.

---

## 7. Les référentiels

### Ceux que Parcelys sait exploiter

| Code | Domaine | Sans lui |
|---|---|---|
| `ephy` | Produits phytopharmaceutiques | Aucune vérification de dose ni de ZNT |
| `ift-doses-reference` | Doses de référence IFT | Aucun IFT calculé |
| `zones-vulnerables` | Zonage nitrates | Classement de la parcelle indéterminé |
| `zones-action-renforcee` | Prescriptions renforcées | Non opposées |
| `programme-actions-nitrates` | Périodes, plafonds, couverture | Aucun calendrier vérifié |
| `gren` | Calcul de la dose prévisionnelle | Dose non calculée, plan saisissable à la main |
| `captages` | Protection de la ressource | Proximité non détectée |
| `cours-eau` | Distances réglementaires | Proximité non détectée |

Le catalogue vit dans `src/lib/regulatory/referentials.ts`. **Il ne contient
aucune donnée** : il déclare quels jeux de données Parcelys sait utiliser et où
les trouver. C'est une carte des sources, pas un cache de valeurs.

### Trouver un référentiel : l'API data.gouv.fr

Parcelys interroge l'API publique de data.gouv.fr
(`https://www.data.gouv.fr/api/1/`, lecture sans authentification) pour
**découvrir** les jeux de données plutôt que pour les deviner.

```bash
npm run referentiels -- chercher --code zones-vulnerables \
    --territoire "Centre-Val de Loire"
```

```
→ Recherche sur data.gouv.fr : « zones vulnérables nitrates Centre-Val de Loire »

  ⚠ Aucun jeu national : des dizaines de jeux régionaux et départementaux,
    de millésimes différents. Choisir CELUI de son territoire.

  1. Zones vulnérables aux nitrates — Centre-Val de Loire
     identifiant : 5bbb6d6cff66bd4dc17bfd5a
     producteur  : DREAL Centre-Val de Loire
     licence     : lov2
     mise à jour : 15/11/2024
     ressource   : zv_2024.geojson [geojson] — 4.2 Mo
```

Puis :

```bash
npm run referentiels -- importer-zonage --code zones-vulnerables \
    --dataset 5bbb6d6cff66bd4dc17bfd5a --territoire 24
```

La **version est déduite** de la date de modification de la ressource
(`2024-11-15`), le producteur et la licence sont conservés comme provenance, et
l'URL retenue est `latest` — celle qui suit les rééditions.

#### Pourquoi le programme ne choisit pas tout seul

Deux constats, vérifiés et non supposés :

1. **Il n'existe pas de jeu national « zones vulnérables ».** Il en existe des
   dizaines, par région et par département, de millésimes différents (2007,
   2015, 2016, 2021…). Retenir automatiquement « le premier résultat »
   importerait le zonage d'une autre région : des parcelles seraient classées à
   tort, d'autres ne le seraient pas, et rien ne le signalerait.

2. **Les slugs ne sont pas stables.** La documentation de l'API le dit :
   « utilisez les identifiants techniques dans les scripts de production, les
   slugs peuvent changer ». Un slug écrit dans le code cesse un jour de
   fonctionner — au mieux l'import échoue, au pire il ramène autre chose.

Le catalogue ne contient donc que des **termes de recherche** et les formats
exploitables. Le CLI montre les candidats avec leur producteur, leur licence et
leur date ; l'exploitant reconnaît le sien ; l'identifiant technique retenu est
conservé avec la version.

#### Repérer une réédition

`isNewerThan()` compare la date de la ressource distante à celle du dernier
import. Cela sert à **prévenir** qu'un zonage a été réédité — jamais à le
remplacer tout seul. Un référentiel qui changerait sans qu'on le sache
modifierait rétroactivement le classement de parcelles déjà déclarées.

### Aucune URL codée en dur

Les adresses des jeux officiels changent. Une URL périmée écrite dans le code
produit soit une erreur, soit — bien pire — l'import silencieux d'une version
obsolète que plus personne ne remarque.

Chaque référentiel lit son adresse dans une variable d'environnement
(`ZONES_VULNERABLES_URL`, `IFT_DATA_URL`…). Sans elle, il reste
« non configuré », ce que l'interface affiche en toutes lettres.

### Services web : WFS oui, WMS non

Les DREAL publient leurs zonages **en services web bien plus souvent qu'en
fichiers**. Le cas rencontré en Auvergne-Rhône-Alpes est représentatif : des deux
jeux publiés, l'un n'existait qu'en `wms` et `wfs`, l'autre en `mapinfo tab`. Un
exploitant de cette région ne pouvait donc pas importer le zonage de sa propre
région — pas une limite acceptable, un défaut.

La distinction compte, et elle n'est pas de vocabulaire :

| Format | Ce qu'il rend | Utilisable ? |
| --- | --- | --- |
| **WFS** | des géométries et leurs attributs | **oui** — c'est ce qu'il faut |
| **WMS** | une image de carte déjà dessinée | non : on ne croise pas une image avec une parcelle |
| **MapInfo TAB/MIF** | un fichier propriétaire | non lu par Parcelys |

Quand une ressource n'est pas exploitable, `chercher` ne se contente plus de le
constater : il dit **pourquoi** et **quoi faire à la place** — pour un WMS,
demander le WFS équivalent, que le même producteur publie presque toujours.

```bash
# Lister les couches exposées par un service (Parcelys n'en choisit aucune)
npm run referentiels -- importer-zonage --code zones-vulnerables \
    --dataset <identifiant> --ressource <identifiant> --territoire 69

# Importer la couche retenue
npm run referentiels -- importer-zonage --code zones-vulnerables \
    --dataset <identifiant> --couche nitrates:zones_vulnerables_2021 --territoire 69
```

Un service WFS expose couramment plusieurs couches — zones vulnérables, ZAR,
communes. En choisir une automatiquement importerait le mauvais zonage sans que
rien ne le signale : les couches sont listées, l'humain tranche.

Deux détails techniques qui ont chacun leur test, parce qu'ils se trompent en
silence :

- **La version du service n'est pas celle du document XML.** Tout
  GetCapabilities commence par `<?xml version="1.0"?>` ; lire le premier
  `version=` ramène « 1.0 » pour tous les services. Parcelys aurait alors envoyé
  les paramètres de la version 1 à un serveur 2.0.0 et, surtout, cessé de
  paginer : un zonage de 8 000 polygones se serait importé à 1 000, sans
  message. La version est lue sur l'élément racine, ou dans
  `ServiceTypeVersion`.
- **La pagination change de nom selon la version** : `typeNames`/`count`/
  `startIndex` en 2.0.0, `typeName`/`maxFeatures` avant.

### Importer

```bash
# Ce qui est importé, dans quelle version, et ce qui manque
npm run referentiels -- etat

# Chercher un jeu sur data.gouv.fr (ne choisit pas à votre place)
npm run referentiels -- chercher --code zones-vulnerables --territoire "Bretagne"

# Importer celui qu'on a retenu — la version vient de la ressource
npm run referentiels -- importer-zonage --code zones-vulnerables \
    --dataset <identifiant> --territoire 53

# Un zonage, depuis un fichier ou une URL
npm run referentiels -- importer-zonage --code zones-vulnerables \
    --version 2024-07 --territoire 24 --fichier ./zv.geojson

# Fichier en Lambert-93 : la reprojection est faite par PostGIS
npm run referentiels -- importer-zonage --code cours-eau \
    --version 2026 --srid 2154 --url "$COURS_EAU_URL"

# À lancer après CHAQUE import de zonage
npm run referentiels -- recalculer-contextes
```

`--version` est obligatoire. Sans version, impossible de savoir quelle édition a
servi à classer une parcelle, ni de rouvrir une campagne passée avec le bon
zonage.

Le journal conserve chaque tentative, réussie ou non — et les avertissements
d'un import par ailleurs réussi : un import qui a écarté 40 entités reste un
import diminué, et cela doit rester visible.

---

## 5 bis. Plafond d'azote organique, et cahier d'épandage

### Pourquoi 170 n'est écrit nulle part

Le plafond d'azote issu d'effluents d'élevage — 170 kg N/ha de SAU et par an en
zone vulnérable — est le chiffre le plus connu de la directive nitrates. Il
serait tentant de l'écrire en constante.

Trois raisons l'interdisent, et chacune suffirait :

- **Il ne s'applique pas partout.** Hors zone vulnérable, il n'est pas
  opposable. Une exploitation entièrement hors zone verrait une alerte qui ne la
  concerne pas — et cesserait de lire les alertes.
- **Des dérogations existent.** Certains programmes régionaux, certains systèmes
  d'élevage relèvent le plafond ou en ajoutent un autre.
- **Un chiffre en dur n'a pas de source.** Un exploitant contrôlé doit pouvoir
  dire d'où vient la valeur qu'on lui oppose. « C'est écrit dans le logiciel »
  n'est pas une réponse.

Parcelys calcule donc **toujours** ce qui a été épandu — une donnée de
l'exploitation, jamais indisponible — et ne le compare à un plafond que si le
programme d'actions en fournit un. Sinon il affiche la quantité et dit qu'il n'y
a rien à quoi la comparer.

Un programme d'actions est un **arrêté**, pas un jeu de données : les règles se
saisissent, et `--source` est obligatoire.

```bash
npm run referentiels -- regle --code plafond-azote-organique \
    --valeur 170 --unite "kg N/ha" --territoire 45 \
    --depuis 2024-01-01 --version "PAR-CVL-7" \
    --source "Arrêté du 19/12/2011, art. 2 — PAR Centre-Val de Loire"
```

### Le piège des unités, et ce qu'il a coûté

`nSupplied` est une **dose à l'hectare**, pas un total. C'est ce que produit
`computeNutrients` (dose × teneur), et sa documentation le dit.

`comparePlanToActual` supposait l'inverse et redivisait par la surface traitée.
Sur une parcelle de 74 ha, un apport de 112,5 kg N/ha ressortait à
**1,51 kg N/ha** : le réalisé était environ 75 fois trop bas, et le contrôle de
dépassement du prévisionnel — la vérification centrale de la fertilisation
azotée — ne se serait pratiquement jamais déclenché.

Deux détails rendaient le défaut invisible :

- sur une parcelle **entièrement** traitée, la double erreur s'annulait ;
- deux fixtures de test encodaient la convention inverse, et se contredisaient
  entre elles (`agronomy.test.ts` attendait 67 kg N/ha là où
  `regulatory-nitrogen.test.ts` écrivait un total).

Le calcul retenu tient compte d'un traitement partiel :

```
réalisé (kg N/ha de parcelle) = Σ (dose kg N/ha × surface traitée) / surface de la parcelle
```

Un test de non-régression traite volontairement **4 ha sur 10** : c'est le seul
cas où l'ancienne erreur ne s'annule pas.

### Le cahier d'épandage est produit, jamais saisi

Chaque ligne vient d'un apport organique déjà enregistré. Un cahier saisi à part
aurait divergé du registre dès le premier oubli — et c'est le cahier qu'un
contrôle lirait.

Les lignes incomplètes **ne sont pas écartées** : un cahier amputé de ses lignes
gênantes se présenterait mieux et vaudrait moins. Ce qui manque est écrit sur la
ligne, et compté en tête du document.

Le pied de page porte le plafond opposé **avec sa référence de texte**, ou dit
qu'aucun n'est configuré. Il n'écrit jamais 170 de lui-même.

### Vérifier

```bash
npm run check:plafond
```

Éprouve les deux sens : sans règle importée, aucun verdict ; avec une règle, le
dépassement **et** le respect, chacun avec sa source. Le seuil du test est
dérivé des données réelles de la base plutôt que fixé à 170 — un test qui
dépendrait du chiffre officiel n'éprouverait pas le mécanisme.

---

## 7 bis. Couverture des sols, irrigation, rotation

### Ce que Parcelys ne codera pas

En zone vulnérable, le programme d'actions nitrates impose une couverture des
sols pendant l'interculture. Mais **les périodes, les espèces admises et les
modes de destruction autorisés relèvent du programme d'actions régional** : ils
diffèrent d'une région à l'autre et changent d'un programme au suivant.

Écrire « couverture obligatoire du 1er septembre au 15 novembre » serait
inventer une règle. Elle serait fausse pour la plupart des régions, et — bien
pire — fausse **silencieusement** : l'exploitant lirait un « conforme » qui ne
vaut rien.

Parcelys enregistre donc ce qui a été fait (nature, espèces, semis, levée,
destruction, mode) et confronte au référentiel régional **quand il est
importé**. Sans lui, le constat est `INDETERMINE`, avec la phrase de ce qui
n'est pas vérifiable.

### Ce qui est vérifié sans aucun référentiel

La **cohérence des dates** : une destruction avant le semis, une levée avant le
semis. Ce sont des erreurs de saisie, pas des questions réglementaires, et les
signaler ne suppose aucune règle régionale. Elles sortent en `ANOMALIE`.

Une parcelle en zone vulnérable sans aucun couvert saisi sort en
`VERIFICATION`, formulée comme telle : Parcelys constate **une absence de
saisie**, pas une absence de couvert.

### Trois états pour un zonage, jamais deux

`zones.some(z => z.kind === 'ZONE_VULNERABLE')` rend `false` aussi bien pour une
parcelle hors zone que pour une parcelle dont on n'a **aucune donnée de
zonage** — référentiel non importé, contour non tracé. Les deux se lisaient
alors « pas concernée », et l'un des deux était un mensonge silencieux : une
contrainte qui s'applique peut-être disparaissait de l'écran, sans un mot.

`statutZonage()` rend donc `dedans`, `dehors` ou `indetermine`, et l'appelant
doit traiter les trois.

### Irrigation : un travail, pas un objet à part

L'irrigation s'enregistre comme n'importe quel travail sur la parcelle
(`AgriculturalOperation`, type `IRRIGATION`), avec sa date, son opérateur et sa
météo. Un second modèle en parallèle aurait fatalement divergé du premier.

S'y ajoutent le volume (hauteur d'eau en mm ou m³/ha — 1 mm sur 1 ha = 10 m³) et
la teneur en **nitrate** de l'eau. La distinction n'est pas de vocabulaire : les
analyses rendent des mg/L de NO₃, pas d'azote. Les confondre surestimerait la
fourniture d'un facteur 4,4 et conduirait à sous-fertiliser.

L'azote apporté par l'eau figure **hors** du réalisé de fertilisation, dans une
ligne à lui : l'eau n'est pas un apport d'engrais, c'est une fourniture du
bilan. Les confondre ferait apparaître un dépassement là où il n'y en a pas.
Sans le volume **et** la teneur, rien n'est chiffré — et la raison est dite.

### Rotation : lue, jamais ressaisie

Une rotation n'est pas une donnée à saisir, c'est la succession des cultures
déjà enregistrées. Un modèle « rotation » à remplir aurait produit une seconde
vérité, divergente dès la première campagne mal tenue.

La vue rotation est donc une lecture de `CropYear`, affichée sur la page
Cultures existante. Elle signale une seule chose : le **retour de la même
culture**, avec l'écart minimal en années. Elle ne dit pas si une rotation est
bonne — les règles de retour relèvent de la PAC, d'un cahier des charges ou de
l'agronomie régionale, et aucune n'est universelle.

Un tiret dans le tableau signale une campagne **sans culture enregistrée**, pas
une jachère.

### Vérifier

```bash
npx vitest run tests/couverture.test.ts   # cohérence des dates, statut de zonage, INSEE
npm run check:couverture                  # sur une vraie base, sans référentiel importé
```

Le second est le plus important : il vérifie que sur une base **sans** programme
d'actions, aucun constat n'affirme une règle de période et la synthèse ne
prononce aucune conformité. Un test unitaire ne peut pas le prouver.

---

## 7 ter. Dossier de contrôle, justificatifs, documents verrouillés

### Ce qu'un contrôle demande

Pas « montrez-moi votre logiciel », mais des **pièces** : le registre
phytosanitaire de telle campagne, le cahier d'épandage, le certificat
individuel, le dernier contrôle du pulvérisateur, le plan prévisionnel de
fumure.

Le dossier de contrôle (`/conformite/dossier`) rassemble ce qui existe et **dit
ce qui manque**. C'est la seconde partie qui compte : un dossier qui n'afficherait
que les pièces présentes se lirait comme complet.

Il est distinct de la synthèse de conformité, et les deux répondent à des
questions différentes :

| Écran | Question |
| --- | --- |
| `/conformite` | qu'est-ce qui cloche dans mes **données** ? |
| `/conformite/dossier` | qu'est-ce que je sors si on sonne **demain** ? |

### Ce qu'il ne dira jamais

Qu'il est complet. La liste des pièces exigibles dépend du contrôle, de
l'exploitation et de ses productions ; Parcelys en connaît une partie. La phrase
affichée en tête le dit :

> Ce dossier rassemble les pièces que Parcelys sait produire ou retrouver. Il ne
> prétend pas être la liste des pièces exigibles lors d'un contrôle […].
> L'absence d'une pièce non listée ici ne signifie pas qu'elle n'est pas
> demandée.

Ce n'est pas une formule de prudence : un exploitant qui croirait son dossier
complet parce que Parcelys l'affiche ainsi arriverait au contrôle sans une pièce
que Parcelys ignore.

### Justificatifs typés

Les catégories de documents comprennent désormais les pièces qu'un contrôle
réclame nommément : certificat individuel, contrôle du pulvérisateur, attestation
de conseil stratégique, plan d'épandage, justificatif d'écart, bulletin de santé
du végétal.

**Parcelys ne calcule aucune date de fin de validité.** Les durées relèvent de la
réglementation et changent — cinq ans pour un certificat individuel aujourd'hui,
pas nécessairement demain, et pas partout. La date est recopiée de la pièce ;
Parcelys signale seulement qu'elle est passée.

Une pièce n'est « périmée » que si **toutes** celles de sa catégorie le sont :
un renouvellement remplace le précédent, et signaler l'ancien serait faux.

### Verrouiller un document

Verrouiller **n'empêche pas de saisir**. L'exploitation continue de travailler.
Cela crée une **copie datée qui ne bougera plus** — la seule façon de répondre,
deux ans plus tard, à « que contenait le registre que vous avez présenté ? ».

Trois propriétés, chacune sous test :

- **Rien n'est jamais écrasé.** Une nouvelle version s'ajoute (`version`
  s'incrémente) ; l'ancienne reste consultable.
- **Un contenu identique ne crée pas de doublon.** Une pile de versions
  identiques rendrait l'historique illisible. L'empreinte SHA-256 le détecte.
- **Les lacunes sont conservées avec le document.** Un registre incomplet reste
  incomplet ; effacer ses manques le maquillerait.

Le contenu figé est produit **côté serveur**. Accepter un contenu transmis par
le navigateur reviendrait à laisser verrouiller n'importe quoi sous le nom d'un
registre officiel.

### Vérifier

```bash
npm run check:dossier
```

Le test décisif : il verrouille un cahier, **ajoute un apport après coup**, et
vérifie que la copie figée est restée à son nombre de lignes pendant que les
données vivantes avançaient. C'est la seule façon de prouver qu'un verrou
verrouille.

---

## 7 quater. Les zonages sur la carte

### Sur la carte existante, pas à côté

Une seconde carte « réglementaire » aurait obligé à comparer deux écrans pour
répondre à une question simple — « cette parcelle-là est-elle dedans ? » — et les
deux auraient fini par diverger en cadrage, en fond et en style. Les couches
s'ajoutent donc à la carte que l'exploitant connaît déjà : liste des parcelles et
fiche de parcelle.

Elles sont **éteintes au départ**. La carte sert d'abord à voir ses parcelles, et
six zonages superposés d'emblée les rendraient illisibles. Elles se posent
**sous** les contours : un zonage par-dessus masquerait précisément ce qu'on
cherche à situer.

### On ne charge jamais le zonage entier

Un zonage régional compte des milliers de polygones, souvent des dizaines de
mégaoctets. Les envoyer rendrait la carte inutilisable sur un téléphone au bord
d'un champ — c'est-à-dire là où elle sert.

Seules sont renvoyées les zones **qui recoupent l'emprise des parcelles**,
élargie d'une marge : une limite qui passe juste à côté explique pourquoi une
parcelle est classée « partiellement », et la couper au ras du bord la rendrait
incompréhensible. Les géométries sont légèrement simplifiées — à l'échelle d'une
parcelle, quelques mètres de généralisation ne se voient pas et divisent le poids
par cinq ou dix.

Quand une couche ne montre qu'une partie du référentiel, le panneau le dit :
« 12 zones affichées sur 3 480 (emprise de vos parcelles) ».

### La provenance ne quitte jamais la couche

Chaque couche porte sa source, sa version et son territoire, affichés sous son
nom. Une couche sans provenance laisserait croire à une vérité intemporelle,
alors qu'un zonage est daté et révisé — et que c'est la version en vigueur à la
date de l'intervention qui compte.

### Un piège PostGIS qui aurait tout empêché

`ST_Extent` rend une `box2d`, dont le cast en `geometry` porte le **SRID 0**. La
croiser telle quelle avec des zones en 4326 échoue net :

```
ERROR: ST_Intersects: Operation on mixed SRID geometries (MultiPolygon, 4326) != (Polygon, 0)
```

Aucune couche ne se serait jamais affichée. Le SRID est reposé explicitement, et
`npm run check:carte` le vérifie sur une vraie base — c'est ce script qui a
trouvé le défaut.

### Vérifier

```bash
npm run check:carte
```

Crée deux zones : une sur les parcelles, une à 550 km. Vérifie que la première
est renvoyée, la seconde écartée, que la provenance accompagne la couche et que
le poids reste transportable.

---

## 7 quinquies. Avant d'épandre (0.9.5)

### La question telle qu'elle se pose au champ

« Est-ce que je peux épandre là, aujourd'hui, cette quantité ? »

`POST /api/regulatory/spreading` y répond **sans rien écrire**. C'est une
simulation : on la relance en changeant la date ou la dose autant de fois qu'on
veut, sans laisser de trace. L'apport lui-même se saisit ailleurs, une fois
épandu.

Trois contrôles, chacun avec son propre verdict. Tous puisent dans le
référentiel `programme-actions-nitrates` résolu pour le territoire de la
parcelle — commune, puis département, puis région, puis national :

| Contrôle | Règle recherchée |
|---|---|
| Période d'interdiction | `periode-interdiction-epandage` |
| Distance aux cours d'eau | `distance-epandage-cours-eau`, croisée avec les zones `COURS_EAU` |
| Distance aux habitations | `distance-epandage-habitation` |
| Plafond d'azote organique | `plafondAzoteOrganique`, rapporté à la SAU concernée |

Le contrôle du plafond ne se contente pas d'appeler `plafondAzoteOrganique` :
celui-ci ne connaît que les parcelles ayant **déjà** reçu un apport organique,
alors que la question posée ici est prospective. La parcelle visée est donc
ajoutée à la surface quand elle n'a encore rien reçu.

### Trois états, jamais deux

`CONFORME` · `A_VERIFIER` · `NON_CONFORME`.

La règle qui compte est celle du milieu : **si un seul contrôle n'a pas pu être
fait, la réponse n'est jamais `CONFORME`.** Un référentiel absent produit
`A_VERIFIER` avec le nom de ce qui manque, pas un feu vert par défaut.

Et même tout au vert, le message dit « aucune anomalie détectée selon les
données et référentiels actuellement disponibles » — pas « conforme ». La
nuance est celle de la section 2, et elle tient ici aussi.

### L'azote, quand il est calculable

L'azote apporté vient de la teneur enregistrée pour le produit organique, par la
formule qu'emploie déjà le bilan NPK (`dose × nContent × surface`, où `nContent`
est une teneur **en kg d'azote par tonne ou par m³**, pas un pourcentage).

Sans teneur renseignée — le cas habituel tant qu'aucune analyse n'a été faite —
l'azote reste nul et le contrôle du plafond ressort indéterminé. Supposer une
composition reviendrait à fabriquer le chiffre sur lequel repose tout le
contrôle.

### Vérifier

```bash
npm test -- tests/epandage.test.ts
```

Onze cas, qui posent leurs propres règles en base : période franchie, période
qui enjambe le 1ᵉʳ janvier, plafond dépassé, référentiel absent, et le
cloisonnement entre exploitations.

---

## 7 sexies. Les limites d'emploi d'un produit (0.9.5)

E-Phy ne fournit pas que la dose. Chaque usage porte aussi le nombre maximal
d'applications, l'intervalle minimal entre deux passages et le délai avant
récolte. Jusqu'à 0.9.5, Parcelys les importait et les affichait sans jamais les
opposer : seule la dose était vérifiée.

`src/lib/ephy/limites.ts` les vérifie maintenant à la saisie, et ajoute les
conditions d'emploi qui ne se calculent pas mais se rappellent — délai de
rentrée, mentions abeilles, riverains.

### Ce qui n'est pas deviné

Le catalogue contient des valeurs qui ne sont pas des nombres : « 2 à 3 »,
« selon la culture ». Elles ne sont pas interprétées — ni arrondies, ni prises
au plus favorable. Le contrôle les ignore et le dit.

### Un piège d'ordre d'exécution

`buildPhytoWarnings` est appelé **après** l'écriture du traitement. L'historique
du produit contenait donc le traitement en cours, et le deuxième passage d'un
produit qui en autorise deux déclenchait l'alerte du troisième. La ligne qu'on
vient d'écrire est désormais exclue du décompte.

### Vérifier

```bash
npm test -- tests/phyto-control.test.ts
```

---

## 8. Ce qui n'est pas encore là

Volontairement listé, pour qu'aucune absence ne passe pour une couverture.

**Priorité 2 (0.7.0)** — ~~stocks et lots~~ · ~~couverture des sols~~ ·
~~irrigation comme événement~~ · ~~rotations~~ · ~~plafond d'azote organique~~ ·
~~cahier d'épandage~~ · ~~dossier de contrôle~~ · ~~justificatifs typés~~ ·
~~couches réglementaires sur la carte~~. **Priorité 2 terminée.**

**Priorité 3 (0.8.0)** — détection automatique des nouvelles versions de
référentiels · alertes avancées · registre phytosanitaire électronique lisible
par machine · assistance branchée sur le moteur (jamais sur sa propre mémoire).

**Hors périmètre, et qui le restera** — Parcelys ne se substitue ni à
l'étiquette d'un produit, ni à la décision d'autorisation en vigueur, ni au
conseil d'un technicien. En cas de divergence, c'est la source officielle qui
fait foi.

### Deux domaines entiers qui ne sont pas modélisés (audit 0.9.5)

L'audit 0.9.5 les a cherchés dans les 54 modèles du schéma. Ils n'y sont pas.
C'est écrit ici pour qu'on ne le découvre pas en cherchant l'écran.

**L'élevage et le classement ICPE.** Aucun modèle de cheptel, d'effectif
animal, d'UGB, de bâtiment ni de régime ICPE. Parcelys tient le parcellaire ;
il ne sait rien du troupeau.

Ce qu'il en connaît malgré tout, c'est l'aval : les effluents une fois épandus.
Le fumier et le lisier existent comme produits organiques, l'apport
s'enregistre, et le plafond de 170 kg N/ha issu d'effluents d'élevage est
opposé quand le référentiel du territoire est chargé
(`src/lib/regulatory/organic-nitrogen.ts`).

Conséquence directe : les effectifs animaux présents dans l'export TéléPAC ne
sont pas repris — l'adaptateur le dit à l'import plutôt que de les laisser
disparaître en silence (`src/lib/pac/telepac-xml.ts`). Un plan d'épandage
dimensionné sur le cheptel ne peut donc pas être calculé par Parcelys : la
production d'azote du troupeau n'y est pas connue.

**La certification AB et les MAEC.** Aucun modèle d'engagement, de mesure
souscrite, de période de conversion, d'organisme certificateur ni de cahier des
charges. Un exploitant en bio saisit ses interventions comme un autre ; Parcelys
n'oppose aucune règle propre à l'AB et ne vérifie aucun engagement MAEC.

Ce n'est pas un manque discret : un produit interdit en AB ne sera pas signalé
comme tel, parce que la notion n'existe pas dans le modèle. Le contrôle
phytosanitaire raisonne sur le catalogue E-Phy — autorisation, dose, DAR, ZNT,
conditions d'emploi — et sur rien d'autre.

Les implanter demanderait, pour chacun, le même socle que le reste : un
référentiel officiel, versionné, daté et territorialisé. Tant qu'il n'est pas
là, la règle de la section 1 s'applique — mieux vaut l'absence qu'une règle
inventée.
