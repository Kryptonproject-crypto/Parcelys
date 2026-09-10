# Le catalogue E-Phy dans Parcelys

Ce document décrit **ce que contient réellement** le jeu de données officiel de
l'ANSES, tel qu'il a été relevé sur l'édition du **8 septembre 2026**, et ce que
Parcelys en fait. Il existe parce que plusieurs choses, dans ces fichiers, ne
sont pas ce que leurs intitulés annoncent — et que s'en apercevoir a coûté un
import entier.

Règle qui gouverne tout le reste : **rien n'est déduit d'une donnée absente**.
Une ZNT non publiée n'est pas une ZNT nulle, une culture absente du catalogue
n'est pas une culture autorisée, une dose en kilogrammes ne se compare pas à une
dose en litres.

---

## 1. L'archive

L'export est un ZIP d'une dizaine de CSV (séparateur `;`, encodage UTF-8 dans
les fichiers `*_utf8.csv`). Parcelys en lit quatre :

| Rôle | Fichier | Lignes (éd. 2026-09) |
|---|---|---|
| Produits | `produits_utf8.csv` | 15 139 |
| Usages | `usages_des_produits_autorises_utf8.csv` | 19 608 |
| Substances | `substance_active_utf8.csv` | 1 337 |
| Conditions d'emploi | `produits_condition_emploi_utf8.csv` | 29 486 |

Les autres (`mfsc_et_mixte_*`, `permis_de_commerce_parallele`,
`produits_classe_et_mention_danger`, `produits_phrases_de_risque`) ne sont pas
importés.

Le choix du fichier est fait par `resolveDataFile()` (`src/lib/ephy/schema.ts`),
qui **refuse de choisir** plutôt que de deviner quand plusieurs noms
correspondent : les noms se ressemblent beaucoup, et se tromper de fichier
produit un catalogue d'apparence normale mais faux.

---

## 2. Le catalogue est un historique, pas une liste de courses

Sur 15 139 produits, **12 449 sont retirés du marché** et 2 690 sont autorisés.
C'est normal : E-Phy conserve l'historique des autorisations.

Conséquence pratique : afficher les résultats de recherche sans filtre montre
majoritairement des produits qu'on n'a plus le droit d'appliquer. C'est ce que
faisait Parcelys jusqu'à la version 0.5.0, et cela donnait l'impression d'un
catalogue erroné alors qu'il était simplement complet.

Ce que fait Parcelys :

- la recherche **écarte les produits retirés par défaut** ;
- elle dit toujours **combien** ont été écartés (`withdrawnHidden`) ;
- un clic les rappelle — ils restent nécessaires pour compléter un registre
  antérieur au retrait ;
- un produit retiré est badgé « Retiré du marché » avec sa date de retrait, et
  sélectionner un produit retiré affiche un avertissement ;
- enregistrer un traitement à une date **postérieure** au retrait déclenche un
  avertissement au serveur (`buildPhytoWarnings`).

Les produits retirés ne sont jamais supprimés de la base : un traitement de 2019
porte légitimement sur un produit retiré depuis, et le registre doit rester
vérifiable.

---

## 3. Les pièges des fichiers d'usages

### 3.1 Les colonnes ne portent pas ce que leur nom annonce

Dans `usages_des_produits_autorises_utf8.csv`, l'en-tête déclare, dans l'ordre :

```
… ; identifiant usage lib court ; identifiant usage ; date decision ; …
```

mais les **valeurs arrivent inversées** par rapport à ce qu'on en attendrait :

```
… ; 15105913 ; Orge*Désherbage ; 19/06/2019 ; …
       ▲              ▲
   « lib court »  « identifiant usage »
   = le CODE       = le LIBELLÉ
```

Se fier aux intitulés nomme donc toutes les cultures `00610005`, `15105913`…
C'est exactement ce qui s'est produit lors du premier import : 19 609 usages
importés, doses et ZNT correctes, et pas une seule culture lisible.

Dans `produits_usages_utf8.csv`, il n'y a qu'une colonne — « identifiant
usage » — et elle porte le libellé.

**Ce que fait Parcelys** : `looksLikeUsageLabel()` tranche sur le *contenu*, pas
sur l'intitulé. Un libellé d'usage E-Phy s'écrit `culture*traitement*cible` et
contient toujours des `*` ; c'est la seule propriété que les deux fichiers
partagent réellement.

### 3.2 Une coquille dans l'en-tête officiel

`produits_usages_utf8.csv` écrit `tade cultural max (BBCH)` — sans le « s ».
L'alias est repris tel quel dans `USAGE_COLUMNS` : le corriger reviendrait à ne
plus lire la colonne.

### 3.3 Quel fichier pour quoi

| | `usages_des_produits_autorises` | `produits_usages` |
|---|---|---|
| Lignes | 19 608 | 81 555 |
| États d'usage | Autorisé (18 463), Retrait (1 051) | Retrait (62 998), Autorisé (18 463) |
| Intervalle mini entre applications | absent | présent (7 196 lignes) |
| Libellé d'usage | 2ᵉ colonne candidate | seule colonne |

Parcelys retient le premier : les doses opposables sont celles des usages en
vigueur, et le second fichier est à 77 % composé d'usages retirés. La colonne
« intervalle minimum » manque donc — c'est signalé comme avertissement à
l'import, et **rien n'est inventé pour la remplacer** ; l'information figure
souvent en texte libre dans la condition d'emploi.

---

## 4. Doses autorisées et surdosage

`src/lib/ephy/dose.ts` rapproche la dose saisie de la dose retenue au catalogue.
Ce module est **partagé entre le site et l'application mobile** (alias
`@partage` dans `mobile/vite.config.ts`) : deux implémentations d'une même règle
réglementaire finiraient par diverger, et c'est celle du téléphone — utilisée au
champ — qui serait la mauvaise.

### Ce qu'il fait

1. Il ne retient que les usages **en vigueur** (`etat usage` = « Autorisé »).
2. Il rapproche la culture par inclusion dans les deux sens : le catalogue dit
   « Blé », l'assolement « Blé tendre d'hiver ». Au-delà, il ne devine pas :
   « Orge » ne vaut pas pour « Blé ».
3. Quand plusieurs cibles coexistent pour une culture, il retient **la dose la
   plus élevée**. Retenir la plus faible produirait une fausse alerte à chaque
   traitement de l'autre cible, et une fausse alerte finit par faire ignorer les
   vraies.
4. Il tolère 0,5 % d'écart, pour absorber les arrondis d'unité (2 000 mL/ha
   contre 2 L/ha) — pas pour tolérer un dépassement.

### Ce qu'il refuse de faire

**Convertir entre familles d'unités.** `L/ha` et `kg/ha` ne se comparent pas sans
la densité du produit, que le catalogue ne publie pas. `L/hL` (dose de bouillie)
ne se compare pas à `L/ha` sans le volume appliqué. Devant deux unités
incomparables, le verdict est `unites-incomparables` — jamais un dépassement
supposé, jamais un feu vert.

Les 80 unités de dose du fichier officiel vont de `L/ha` à `diffuseurs/ha`,
`g/trou de plantation` et `KG/KG VERS`. Seules les familles réellement
convertibles (préfixes métriques à dénominateur identique) sont déclarées.

**Interpréter une dose non numérique.** Le fichier contient « voir conditions
d'emploi », « SANS DOSE », « VOIR ETIQUETAGE FABRICANT », « .. ». Ces valeurs
donnent `dose-non-exploitable`, pas 0.

### Les verdicts

| Verdict | Sens |
|---|---|
| `conforme` | Dose ≤ dose retenue, unités comparables |
| `depassement` | Dose > dose retenue → alerte de surdosage |
| `unites-incomparables` | Masse contre volume, ou dose de bouillie contre dose/ha |
| `usage-inconnu` | Aucun usage en vigueur du produit ne couvre cette culture |
| `dose-non-exploitable` | Le catalogue ne publie pas de dose chiffrée pour cet usage |
| `hors-catalogue` | Produit saisi librement, aucune référence à opposer |

Le contrôle **avertit, il ne bloque pas**. Le catalogue ne connaît ni les
dérogations, ni les mélanges, ni les doses réduites décidées à la parcelle ; et
l'étiquette du produit fait foi. Refuser l'enregistrement d'un traitement
réellement effectué produirait un registre faux, ce qui est pire qu'un registre
annoté.

Les avertissements sont produits **côté serveur** (`buildPhytoWarnings`) et pas
seulement dans le formulaire : l'application mobile enregistre hors ligne et
rejoue sa file par `/api/sync`, qui appelle le même gestionnaire. Un contrôle
qui n'existerait que dans le navigateur laisserait passer tout ce qui a été
saisi au champ, c'est-à-dire l'essentiel.

---

## 5. ZNT

Le fichier d'usages publie **trois** zones non traitées, une par colonne :

| Colonne | Renseignée (éd. 2026-09) |
|---|---|
| `ZNT aquatique (en m)` | 15 551 usages |
| `ZNT arthropodes non cibles (en m)` | 2 660 |
| `ZNT plantes non cibles (en m)` | 3 391 |

Valeurs rencontrées pour la ZNT aquatique : 5, 20, 50 et 100 m.

Parcelys affiche les trois séparément, à l'usage près. **Une ZNT non publiée
s'affiche par un tiret, jamais par « 0 m »** : c'est une donnée absente, pas une
absence de contrainte.

---

## 6. Sol drainé

Le drainage ne figure dans **aucune colonne dédiée**. Il vit en texte libre dans
`produits_condition_emploi_utf8.csv`, sous les catégories « Environnement
faune » et « Environnement milieu », le plus souvent sous forme de mention
SPe 2 :

> Condition: - SPe 2 : Pour protéger les organismes aquatiques, ne pas appliquer
> sur sol artificiellement drainé.

> Condition: Ne pas appliquer ce produit sur sols drainés.

> Condition: - Pour protéger les organismes aquatiques, ne pas appliquer ce
> produit sur sols artificiellement drainés en période de drainage

**382 conditions sur 29 486** mentionnent le drainage.

### Ce que fait Parcelys

- `conditionConcernsDrainedSoil()` repère ces conditions à l'import (racine
  « drain ») et pose un marqueur ; le libellé reste celui de l'ANSES, mot pour
  mot. Aucune règle n'est déduite du texte.
- `drainedSoilSeverity()` distingue l'interdiction franche (« ne pas
  appliquer », « interdit ») de la condition à vérifier. Hors interdiction
  reconnue, la condition est présentée comme « à vérifier », jamais comme
  neutre.
- La parcelle porte un champ `drainedSoil` à **trois états** : `true`, `false`,
  et `null` pour « non renseigné ». `null` n'est pas traité comme « non
  drainé » : prendre l'absence de réponse pour un « non » ferait taire
  l'avertissement précisément là où il manque. Dans ce cas l'interface invite à
  renseigner l'information.

---

## 7. Lancer une synchronisation

```bash
# Depuis l'URL officielle configurée dans .env (EPHY_DATA_URL)
npm run ephy:sync

# Depuis une archive déjà téléchargée
npm run ephy:sync -- --zip ./ephy.zip

# Depuis un dossier déjà décompressé
npm run ephy:sync -- --dir ./ephy

# Vider le catalogue avant de réimporter (le registre est conservé)
npm run ephy:sync -- --purge
```

Le script affiche le fichier retenu pour chaque rôle. **Lisez ces quatre
lignes** : c'est la seule façon de s'apercevoir d'un mauvais choix sans relire
la base.

Sortie attendue sur l'édition 2026-09 :

```
  → produits   : produits_utf8.csv
  → usages     : usages_des_produits_autorises_utf8.csv
  → substances : substance_active_utf8.csv
  → conditions : produits_condition_emploi_utf8.csv

✓ Synchronisation E-Phy terminée
  produits        : 15140
  substances      : 1338
  usages          : 19609
  conditions      : 29487
  ⚠ Champs usages non renseignés : minIntervalDays.
```

L'avertissement sur `minIntervalDays` est normal (§ 3.3).

### Vérifier après import

```sql
-- Aucune culture ne doit être un code numérique (cf. § 3.1)
SELECT count(*) FROM phyto_usages WHERE crop_label ~ '^[0-9]+$';   -- attendu : 0

-- Les trois ZNT doivent être distinctes
SELECT count(*) FILTER (WHERE znt_aquatic_m IS NOT NULL),
       count(*) FILTER (WHERE znt_arthropod_m IS NOT NULL),
       count(*) FILTER (WHERE znt_plant_m IS NOT NULL)
FROM phyto_usages;

-- Conditions visant les sols drainés
SELECT count(*) FROM phyto_conditions WHERE concerns_drained_soil;
```

---

## 8. Ce que Parcelys n'a pas et n'invente pas

- **La densité des produits.** D'où le refus de convertir masse ↔ volume.
- **L'intervalle minimum entre applications** dans le fichier retenu (§ 3.3).
- **Les DVP (dispositifs végétalisés permanents)** en tant que donnée
  structurée : ils apparaissent en texte libre dans les conditions d'emploi et
  sont affichés comme tels.
- **Les mélanges.** Le catalogue documente les produits un par un ; Parcelys ne
  se prononce pas sur les associations.
- **Les dérogations et arrêtés préfectoraux.** Hors du jeu de données.

Dans tous ces cas, l'interface renvoie à l'étiquette du produit, qui fait foi.
