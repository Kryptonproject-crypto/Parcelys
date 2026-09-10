# Le socle réglementaire de Parcelys

Version 0.6.1. Ce document explique **comment Parcelys se comporte face à la
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

## 8. Ce qui n'est pas encore là

Volontairement listé, pour qu'aucune absence ne passe pour une couverture.

**Priorité 2 (0.7.0)** — stocks et lots · couverture des sols (CIPAN/CINE) ·
irrigation comme événement · rotations · plafond d'azote organique · dossier de
contrôle · justificatifs typés · couches réglementaires sur la carte.

**Priorité 3 (0.8.0)** — détection automatique des nouvelles versions de
référentiels · alertes avancées · registre phytosanitaire électronique lisible
par machine · assistance branchée sur le moteur (jamais sur sa propre mémoire).

**Hors périmètre, et qui le restera** — Parcelys ne se substitue ni à
l'étiquette d'un produit, ni à la décision d'autorisation en vigueur, ni au
conseil d'un technicien. En cas de divergence, c'est la source officielle qui
fait foi.
