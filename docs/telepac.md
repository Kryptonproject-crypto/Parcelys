# PAC / TéléPAC — importer, modifier, exporter

Ce module permet d'apporter dans Parcelys le parcellaire téléchargé depuis
TéléPAC, d'y travailler toute l'année comme sur n'importe quelle parcelle, puis
de préparer les fichiers de l'échange retour.

> **À lire d'abord.** Parcelys ne se connecte jamais à TéléPAC, ne dépose aucune
> déclaration et ne vous demandera jamais vos identifiants du portail. Il
> travaille sur les fichiers que **vous** téléchargez, et prépare des fichiers
> que **vous** réimportez. Le dépôt et la signature se font sur
> `telepac.agriculture.gouv.fr`, et nulle part ailleurs.

## Sommaire

1. [Ce que ce module sait faire, et ce qu'il ne sait pas](#1-ce-que-ce-module-sait-faire-et-ce-quil-ne-sait-pas)
2. [Récupérer vos fichiers depuis TéléPAC](#2-récupérer-vos-fichiers-depuis-télépac)
3. [Les importer dans Parcelys](#3-les-importer-dans-parcelys)
4. [Vérifier l'import](#4-vérifier-limport)
5. [Modifier vos parcelles](#5-modifier-vos-parcelles)
6. [Lancer le contrôle PAC](#6-lancer-le-contrôle-pac)
7. [Générer l'export](#7-générer-lexport)
8. [Réimporter dans TéléPAC](#8-réimporter-dans-télépac)
9. [Revenir en arrière](#9-revenir-en-arrière)
10. [Limites connues](#10-limites-connues)
11. [Pour les développeurs](#11-pour-les-développeurs)

---

## 1. Ce que ce module sait faire, et ce qu'il ne sait pas

**Il sait** lire un jeu de données géographiques Shapefile, reconnaître le
Lambert-93, reprojeter sans perte utile, mesurer les surfaces avec PostGIS,
rapprocher les parcelles importées de celles déjà présentes, conserver
l'historique, contrôler la cohérence du parcellaire, et produire un Shapefile
en Lambert-93.

**Il ne sait pas** — et ne prétend pas savoir — quel est le schéma exact des
fichiers d'échange de TéléPAC pour une campagne donnée. Les notices officielles
(TéléPAC, ministère de l'Agriculture, ASP) n'ont pas pu être consultées lors de
l'écriture de ce module. Plutôt que de coder un schéma supposé, le module :

- lit les colonnes réellement présentes dans **vos** fichiers ;
- vous **propose** une correspondance, d'après des noms courants ;
- vous demande de la confirmer avant d'écrire quoi que ce soit.

C'est un peu plus long qu'un import automatique. C'est aussi la seule façon
honnête de procéder tant que le schéma n'a pas été vérifié sur la notice de la
campagne — voir la [section 10](#10-limites-connues).

---

## 2. Récupérer vos fichiers depuis TéléPAC

Connectez-vous sur `telepac.agriculture.gouv.fr` avec vos identifiants
habituels, et cherchez la fonction de téléchargement de vos données graphiques
pour la campagne concernée. Selon les années et les rubriques, TéléPAC met à
disposition un récapitulatif PDF, un export de données, et un jeu de données
géographiques.

Parcelys lit **deux formats**, et l'un des deux suffit.

### A. Le dossier au format XML — le plus simple

C'est le fichier que TéléPAC propose spontanément au téléchargement, nommé
quelque chose comme `DossierPAC2026_dossier_003015584_20260910.xml`. Un seul
fichier, rien à décompresser, rien à assortir.

Il contient les îlots, les parcelles, leurs géométries, les codes culture, les
SNA et les ZDH. Déposez-le tel quel.

> **Ce que Parcelys en lit, et ce qu'il en laisse.** Le dossier contient aussi
> vos effectifs animaux et le détail de vos demandes d'aides. Parcelys gère le
> parcellaire : ces branches ne sont **pas** reprises, et l'aperçu vous le dit
> plutôt que de les passer sous silence.

> ⚠️ **Le fichier ne dit pas dans quel système de coordonnées il est.** Parcelys
> en propose un d'après l'ordre de grandeur des coordonnées — Lambert-93 dans
> tous les dossiers examinés — mais c'est une proposition, pas une lecture.
> **Vérifiez-la avant d'importer** : un parcellaire projeté depuis le mauvais
> système atterrit à des centaines de kilomètres de chez vous.

### B. L'export graphique — un jeu Shapefile

Si vous avez téléchargé les **données graphiques** plutôt que le dossier : soit
une archive ZIP, soit un ensemble de fichiers portant le même nom et des
extensions différentes.

> ⚠️ **Les quatre fichiers vont ensemble.** Un Shapefile n'est pas un fichier,
> c'est un jeu :
>
> | Extension | Contenu |
> |---|---|
> | `.shp` | les contours |
> | `.shx` | l'index qui permet d'y accéder |
> | `.dbf` | les attributs : numéro de parcelle, îlot, culture |
> | `.prj` | le système de coordonnées |
>
> Sans le `.dbf`, vos parcelles arriveraient sans numéro ni culture. Sans le
> `.prj`, personne ne peut savoir où elles se trouvent. Parcelys refuse
> d'importer un `.shp` seul plutôt que de produire des polygones anonymes.
>
> **Le plus simple est de déposer l'archive ZIP sans la décompresser.**

---

## 3. Les importer dans Parcelys

Menu **PAC / TéléPAC**.

1. Choisissez la **campagne** (par défaut, l'année en cours).
2. Cliquez sur **Fichiers** et sélectionnez votre dossier XML, votre archive
   ZIP, ou les quatre fichiers Shapefile ensemble.
3. **Analyser le dossier.**

> **Ne déposez pas les deux à la fois.** Le XML et l'export graphique décrivent
> le même parcellaire : les lire tous les deux importerait chaque parcelle en
> double. Si les deux sont présents, Parcelys retient le XML et vous dit qu'il
> a laissé l'autre de côté.

> **Une campagne à la fois.** Chaque dossier porte la sienne. Importer 2026
> n'efface pas 2025 : les deux campagnes coexistent, avec leurs propres
> géométries et leurs propres cultures déclarées.

Rien n'est encore écrit. L'analyse lit les fichiers, détecte le système de
coordonnées, mesure les surfaces et compare aux parcelles déjà présentes.

---

## 4. Vérifier l'import

L'aperçu est l'étape qui compte. Regardez, dans l'ordre :

**Le système de coordonnées.** Un badge vert « Lambert-93 (EPSG:2154) » indique
qu'il a été lu dans le `.prj`. Un badge rouge signifie qu'il n'a pas pu être
déterminé : l'import s'arrête là, car convertir au jugé déplacerait votre
parcellaire de plusieurs centaines de mètres sans que rien ne le signale.

**La correspondance des colonnes.** Parcelys affiche ce qu'il a compris :

```
Îlot                : NUM_ILOT
Numéro de parcelle  : NUM_PARCEL
Code culture        : CODE_CULTU
Surface déclarée    : SURF_PARC
```

Vérifiez-la. C'est une **proposition**, pas une certitude — l'encadré orange le
rappelle à chaque import.

**Le décompte.**

- 🟢 *n* parcelles valides
- 🟠 *n* déjà présentes — Parcelys a reconnu une parcelle que vous avez déjà, et
  propose de la **mettre à jour** plutôt que d'en créer une seconde
- 🔴 *n* géométries invalides

**Le détail.** Chaque ligne indique l'îlot, le numéro, la culture, la surface
mesurée, et le rapprochement proposé avec le pourcentage de recouvrement.

Le rapprochement compare les emprises réelles : deux découpages du même champ se
reconnaissent, deux parcelles voisines non. En dessous de 30 % de recouvrement,
Parcelys considère qu'il s'agit d'une parcelle différente.

Si tout est cohérent : **Importer**.

---

## 5. Modifier vos parcelles

Une parcelle importée depuis TéléPAC est **une parcelle Parcelys comme les
autres**. Elle apparaît sur la carte, dans la liste, et vous y accédez à tout ce
que Parcelys sait faire : culture, fertilisation, phytosanitaire,
interventions, semis, récolte, rendement, historique.

Le module PAC n'est pas un espace séparé : il alimente le parcellaire, puis
s'efface.

Ce qui est conservé en plus, du côté PAC :

- le rattachement à l'**îlot** ;
- l'**identifiant** et le **numéro** d'origine ;
- le **code culture** déclaré ;
- la **géométrie d'origine**, dans son système de coordonnées d'origine ;
- **tous les attributs du fichier**, y compris ceux que Parcelys ne comprend
  pas — ils sont gardés plutôt qu'écartés.

**Vos modifications sont tracées.** Chaque changement de contour, de surface ou
de culture sur une parcelle issue de TéléPAC enregistre la date, l'utilisateur,
l'ancienne et la nouvelle valeur. Vous savez ainsi ce qui a bougé depuis
l'import — et le tableau de bord l'affiche : « 🟢 Dossier PAC synchronisé » ou
« 🟠 *n* modifications depuis le dernier import ».

**Les campagnes précédentes ne sont jamais écrasées.** Importer 2026 ne touche
ni à votre blé 2024 ni à votre maïs 2025 : les cultures sont rattachées à une
campagne, et les géométries sont versionnées. L'ancien contour reste consultable
après une mise à jour.

---

## 6. Lancer le contrôle PAC

Bouton **Lancer le contrôle PAC**. Il vérifie :

| Contrôle | Niveau |
|---|---|
| Parcelles sans contour | 🔴 erreur |
| Géométries invalides | 🔴 erreur |
| Chevauchements de plus d'un are | 🔴 erreur |
| Identifiant PAC porté par plusieurs parcelles | 🔴 erreur |
| Parcelles de moins d'un are | 🟠 avertissement |
| Parcelles non rattachées à un îlot | 🟠 avertissement |
| Parcelles sans code culture | 🟠 avertissement |
| Parcelles sans culture pour la campagne | 🟠 avertissement |

> ⚠️ **Ce contrôle n'est pas celui de TéléPAC.** Il porte sur la cohérence
> géométrique et interne de votre parcellaire. Il ne vérifie ni l'admissibilité
> des surfaces, ni l'éligibilité aux aides, ni les règles propres à la campagne.
> Un dossier « conforme » ici est un dossier dont la géométrie tient debout —
> pas un dossier accepté. Les contrôles réglementaires sont ceux de TéléPAC, et
> eux seuls font foi.

---

## 7. Générer l'export

Bouton **Préparer l'export**. Le contrôle est relancé automatiquement ; une
erreur bloquante arrête la génération. Vous pouvez passer outre
(**Exporter malgré les erreurs**) si vous savez ce que vous faites.

Vous obtenez une archive `parcelys-pac-2026.zip` contenant :

```
parcelys-pac-2026.shp    les contours, en Lambert-93 (EPSG:2154)
parcelys-pac-2026.shx    l'index
parcelys-pac-2026.dbf    les attributs
parcelys-pac-2026.prj    le système de coordonnées
parcelys-pac-2026.cpg    l'encodage des attributs
LISEZ-MOI.txt            ce que contient l'export, et ce qu'il reste à faire
```

Colonnes du `.dbf` : `ID_PARCEL`, `NOM`, `NUM_ILOT`, `NUM_PARCEL`, `CODE_CULTU`,
`LIB_CULTU`, `SURF_HA`, `CAMPAGNE`.

**Vérifiez le fichier avant de vous en servir.** C'est un Shapefile standard :
ouvrez-le dans QGIS (gratuit) pour voir vos parcelles avant de les envoyer où
que ce soit.

---

## 8. Réimporter dans TéléPAC

Parcelys s'arrête ici. La suite vous appartient :

```
PARCELYS  →  export  →  TÉLÉPAC  →  import  →  vérification  →  signature / dépôt
```

Connectez-vous à TéléPAC, utilisez sa fonction d'import, **vérifiez le résultat
à l'écran**, puis signez et déposez.

> Parcelys affiche « Export préparé pour TéléPAC », jamais « déclaration
> envoyée ». La différence n'est pas cosmétique : tant que vous n'avez pas signé
> sur le portail, votre déclaration n'existe pas.

---

## 9. Revenir en arrière

**Une sauvegarde du parcellaire est prise automatiquement avant chaque import**,
avant que quoi que ce soit ne bouge. Elle apparaît dans « Sauvegardes avant
import » avec sa date, son nombre de parcelles et sa surface.

**Rétablir** remet le parcellaire dans cet état. Les parcelles créées depuis sont
retirées du parcellaire actif — mais **jamais effacées définitivement** : une
restauration ne doit pas être plus destructrice que l'import qu'elle répare.

---

## 10. Limites connues

Elles sont écrites ici parce qu'elles sont réelles, pas pour la forme.

### Le schéma des fichiers TéléPAC n'a pas été vérifié sur notice

Les notices officielles de la campagne n'ont pas pu être consultées lors de
l'écriture du module.

**Pour le dossier XML**, la structure a été établie autrement : en confrontant
cinq exports réels d'une même exploitation, campagnes 2022 à 2026, schémas
`Echanges-producteur-export-2022-V4`, `2023-V6`, `2024-V4` et `2026-V1`. C'est
une source plus solide qu'une devinette et moins qu'une notice — cinq dossiers
ne prouvent pas qu'un sixième leur ressemblera. L'aperçu annonce donc la
correspondance comme **constatée**, jamais officielle.

Ce qui a été vérifié sur ces fichiers, et qui vaut donc d'être écrit :

| Constat | Sur quoi |
|---|---|
| Géométries en GML 2, avec trous | 2 984 polygones |
| Jamais plus d'un contour extérieur par polygone | 2 984 sur 2 984 |
| Les SNA sont tantôt des surfaces, tantôt des **points** | 157 points sur 560 en 2026 |
| Aucun système de coordonnées n'est déclaré | les cinq campagnes |
| `surface-admissible` est exprimée en **ares** | rapport médian 1,0000 sur 113 parcelles |
| Le libellé de culture est absent : seul le code figure | les cinq campagnes |

Et ce qui reste inexpliqué, écrit plutôt que taisé : sur le dossier 2026,
**9 parcelles sur 113 portent une surface admissible supérieure à leur propre
géométrie**, jusqu'à 1,08 ha pour l'une d'elles, alors qu'au niveau de l'îlot
les deux totaux se rejoignent (548,57 ares mesurés contre 549 déclarés pour
l'îlot 22). Faute de notice, la cause n'est pas établie. Parcelys ne signale
donc **pas** cet écart comme une anomalie : le faire produirait une alerte sur
des parcelles parfaitement déclarées, et c'est ainsi qu'on apprend à un
utilisateur à ne plus lire les alertes.

**Pour l'export graphique** (Shapefile), rien de tel : les noms de colonnes
varient d'un producteur à l'autre. Conséquences :

- la correspondance des colonnes est **proposée**, pas certifiée : vérifiez-la à
  chaque import ;
- l'export produit un Shapefile valide en Lambert-93, mais **rien ne garantit
  que la fonction d'import de TéléPAC l'accepte tel quel** pour une campagne
  donnée — noms de colonnes attendus, couches exigées, contraintes annuelles.

**Avant de vous en servir pour une déclaration**, comparez les colonnes de
l'export avec ce que demande la notice de la campagne, disponible sur TéléPAC.
Si elles diffèrent, dites-le : ajouter un adaptateur de campagne est une petite
modification (voir [section 11](#11-pour-les-développeurs)).

### Ce qui n'est pas géré

- **Les SNA et ZDH** sont importées, conservées et distinguées des parcelles,
  mais ne sont pas encore éditables dans l'interface.
- **Le découpage et la fusion de parcelles** se font par l'édition
  cartographique ordinaire de Parcelys, pas par un outil PAC dédié.
- **Le référentiel des codes culture** est prévu dans le modèle
  (`pac_crop_codes`, avec campagne, code, libellé, version et provenance) mais
  n'est pas pré-rempli : aucun code n'est inventé. Les codes de vos fichiers
  sont transportés tels quels.
- **Hors métropole** : seul le Lambert-93 est reconnu automatiquement. Les
  départements d'outre-mer emploient d'autres systèmes ; le fichier sera lu,
  mais son système devra être indiqué à la main.

### Ce que Parcelys ne fera jamais

- se connecter à TéléPAC ;
- demander vos identifiants du portail ;
- déposer ou signer une déclaration à votre place.

---

## 11. Pour les développeurs

### Organisation

| Fichier | Rôle |
|---|---|
| `src/lib/pac/shapefile.ts` | lecture/écriture Shapefile, d'après la spécification ESRI |
| `src/lib/pac/adapter.ts` | `TelepacAdapter`, versionné par campagne |
| `src/lib/pac/dossier.ts` | tri des fichiers déposés, regroupement en couches |
| `src/lib/pac/analyze.ts` | projection, mesure, rapprochement — n'écrit rien |
| `src/lib/pac/apply.ts` | sauvegarde puis écriture ; restauration |
| `src/lib/pac/control.ts` | contrôle du dossier |
| `src/lib/pac/export.ts` | génération des fichiers |

Routes : `POST/PUT /api/pac/import`, `GET /api/pac/control`,
`GET /api/pac/export`, `GET/POST /api/pac/snapshots`.

Tables : `pac_campaigns`, `pac_ilots`, `pac_features`, `pac_imports`,
`pac_snapshots`, `pac_changes`, `pac_crop_codes`. **Aucune table existante n'a
été modifiée** : les parcelles restent dans `parcels`, leurs géométries dans
`parcel_geometries`, les campagnes dans `crop_years`.

### Ajouter une campagne

Quand la notice d'une campagne a été lue et que ses colonnes sont connues,
déclarez-les dans `src/lib/pac/adapter.ts` :

```ts
const ADAPTERS = new Map<number, TelepacAdapter>([
  // …
  [2027, {
    year: 2027,
    label: 'Campagne PAC 2027',
    provenance: 'Notice officielle TéléPAC 2027, consultée le JJ/MM/AAAA.',
    guessMapping: (columns) => ({ /* colonnes certaines, confiance « officiel » */ }),
    guessKind,
  }],
]);
```

Rien d'autre ne change dans Parcelys : c'est tout l'objet de cette couche.

### Systèmes de coordonnées

Toutes les projections passent par PostGIS (`ST_Transform`), qui porte PROJ et
qui fait déjà foi pour les surfaces. **N'ajoutez pas de bibliothèque de
projection côté JavaScript** : il y aurait alors deux vérités possibles pour une
même parcelle. Les surfaces sont mesurées par `ST_Area(geom::geography)`, jamais
lues dans le fichier — la surface déclarée est affichée à côté quand elle
diffère, comme information.

### Tests

```bash
npx vitest run tests/pac-shapefile.test.ts   # conformité du format
npx vitest run tests/pac-workflow.test.ts    # parcours complet
```

`pac-shapefile.test.ts` relit nos fichiers avec le paquet `shapefile`,
implémentation indépendante de la même spécification : se relire soi-même ne
prouverait rien, deux erreurs symétriques se compensant.

`pac-workflow.test.ts` couvre le parcours entier — import, rapprochement,
modification, contrôle, export, réimport — et vérifie notamment que les surfaces
ne dérivent pas d'un aller-retour à l'autre.
