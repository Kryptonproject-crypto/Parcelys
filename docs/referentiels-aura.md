# Référentiels réglementaires — Auvergne-Rhône-Alpes

Ce document dit **ce qui a été intégré, d'où cela vient, et ce qui manque**. Il
est tenu à jour avec le code : une donnée qui change de millésime change ici
aussi.

Les fichiers source sont dans `data/referentiels-aura/`.

---

## Ce qui est réellement opposable aujourd'hui

| Référentiel | Version / millésime | Territoire | Entrées | Utilisé par |
| --- | --- | --- | --- | --- |
| Catalogue E-Phy | **2026-10-13** | national | 15 156 produits, 81 613 usages, 1 338 substances, 29 641 conditions | contrôle de dose, ZNT, DAR, nombre d'applications, intervalle, conditions d'emploi |
| Doses de référence IFT | **2026** et **2025** | national | 257 160 et 60 285 | calcul de l'IFT, par campagne |
| Zones vulnérables nitrates | **2021**, mise à jour 12/05/2025 | AURA (84) | 1 125 communes | contexte réglementaire de la parcelle |
| Aires d'alimentation de captage | **2026-09-15** | AURA (84) | 89 | contexte réglementaire de la parcelle |

### Commandes d'import

```bash
# E-Phy — millésime le plus récent de l'archive fournie
npm run ephy:sync -- --zip data/referentiels-aura/decisionamm-intrant-format-csv-20261013-utf8.zip

# IFT — une campagne à la fois, jamais deux
npm run referentiels -- importer-ift --dossier data/referentiels-aura/02_IFT --campagne 2026
npm run referentiels -- importer-ift --dossier data/referentiels-aura/02_IFT --campagne 2025

# Zones vulnérables (décompresser l'archive au préalable)
npm run referentiels -- importer-zonage --code zones-vulnerables \
  --fichier <…>/l_zv_s_r84.json --version "2021-maj-2025-05-12" \
  --territoire 84 --srid 4326 --champ-code insee_com --champ-libelle nom_com

# Aires d'alimentation de captage (découpage sur l'AURA par ogr2ogr)
ogr2ogr -f GeoJSON aac_aura.geojson \
  "/vsizip/data/referentiels-aura/07_AAC/AAC_FRA.gpkg.zip" AAC_FRA \
  -t_srs EPSG:4326 -nlt MULTIPOLYGON \
  -clipsrc data/referentiels-aura/00_LIMITES/region_aura.geojson
npm run referentiels -- importer-zonage --code aires-alimentation-captage \
  --fichier aac_aura.geojson --version 2026-09-15 --territoire 84 --srid 4326 \
  --champ-code CdAAC --champ-libelle NomDeAACAdministratif

# Après tout import de zonage
npm run referentiels -- recalculer-contextes
```

---

## Ce que les sources disent, et ce qu'elles ne disent pas

### E-Phy — deux fichiers d'usages, deux contenus

L'archive officielle porte **deux** fichiers d'usages, et les confondre coûte
cher :

| Fichier | Lignes | Porte le libellé de culture | Porte l'intervalle minimum | Usages retirés |
| --- | --- | --- | --- | --- |
| `usages_des_produits_autorises_utf8.csv` | 19 594 | oui | **non** | non |
| `produits_usages_utf8.csv` | 81 613 | non (code seul) | oui | **oui — 63 075** |

Parcelys lit les deux : le premier sert de dictionnaire de libellés, le second
donne la couverture et l'historique. Résultat : 100 % des usages importés
portent une culture, et l'intervalle minimum est renseigné pour 7 215 d'entre
eux — **exactement le compte du fichier source**. Pour les 92 % restants la
source est muette, et le champ reste vide.

Deux millésimes ont été fournis (08/09/2026 et 13/10/2026). Le plus récent est
retenu ; l'autre est redondant.

### IFT — la campagne 2025 est incomplète

Le ministère publie un fichier par groupe de cultures, GCU1 à GCU6.

| Campagne | Fichiers fournis | Doses | État |
| --- | --- | --- | --- |
| 2026 | GCU1 à GCU6 | 257 160 | complet |
| 2025 | **GCU1 seul** | 60 285 | **partiel** — cinq groupes de cultures manquent |

L'IFT d'une campagne se calcule avec les doses de cette campagne **et d'aucune
autre**. Une campagne non importée n'est pas calculée : l'écran dit laquelle
manque et lesquelles sont disponibles. Un IFT absent se voit ; un IFT faux ne se
voit pas.

### Zones vulnérables — un zonage à la commune

Source : **DREAL Auvergne-Rhône-Alpes**, « Zones vulnérables 2021 à la pollution
aux nitrates agricoles », révision du 12 mai 2025 à la suite des décisions du
tribunal administratif du 6 juin 2024. Échelle 1:50 000.

Textes fondateurs cités par la source :

- arrêté **21-323 du 23 juillet 2021** — bassin Rhône-Méditerranée ;
- arrêté du **30 août 2021** — bassin Loire-Bretagne.

Bassins effectivement présents dans le fichier : **Rhône-Méditerranée** (627
communes) et **Loire-Bretagne** (498). **Aucune commune Adour-Garonne**, bien
que le résumé du jeu mentionne un arrêté pour ce bassin — l'AURA n'en compte
pas, ou elles ne sont pas publiées ici.

**La géométrie publiée est le contour communal, pas celui de la zone.** La
généalogie du jeu le dit mot pour mot : « Établi à partir d'une liste des
communes par arrêté préfectoral ».

| Classement | Communes | Ce que Parcelys en conclut |
| --- | --- | --- |
| « toutes sections » | 907 | le contour communal **est** la zone : une parcelle qui le recoupe est **dedans** |
| « quelques sections » | 218 | l'arrêté ne vise que certaines sections cadastrales, que le fichier ne nomme pas : **indéterminé** |

Pour les 218 communes partiellement classées, conclure « dedans » classerait à
tort, et « dehors » dispenserait à tort. Le contexte de la parcelle porte donc
une indétermination explicite, avec ce qu'il faut consulter : l'arrêté de
délimitation et les sections qu'il vise.

Le **bassin** est conservé sur chaque zone : c'est lui qui désigne l'arrêté
opposable.

### Aires d'alimentation de captage — aucune n'est délimitée par arrêté

Source : référentiel national des AAC (agences de l'eau), millésime interne du
GeoPackage **2026-09-15**. 89 aires en Auvergne-Rhône-Alpes, réparties sur
**trois bassins** : Rhône-Méditerranée (62), Loire-Bretagne (22),
**Adour-Garonne (5)**.

L'attribut `ArreteDelimitationAAC` vaut **False pour les 89**. Aucune de ces
aires n'est donc délimitée par un arrêté préfectoral, et leur périmètre n'est
pas opposable tel quel. L'attribut est conservé et affiché.

Une AAC n'est **pas** un captage : le captage est l'ouvrage, l'AAC est la
surface dont les eaux l'alimentent. Ce sont deux référentiels distincts dans
Parcelys (`aires-alimentation-captage` et `captages`), de millésimes et de
producteurs différents.

---

## Ce qui n'est pas intégré, et pourquoi

### Zones d'actions renforcées — aucune géométrie fournie

Le seul fichier fourni (`04_ZAR/mzarvf.pdf`, « version juillet 2024 », DRAAF et
DREAL AURA) est une fiche de deux pages. Elle contient :

- la **liste des captages classés en ZAR** en Auvergne-Rhône-Alpes (15 entrées,
  avec commune et département) ;
- les **mesures renforcées** applicables, chiffrées ;
- la règle de délimitation : « Les limites des ZAR sont les aires
  d'alimentation de captages **lorsqu'elles ont été délimitées**, sinon les
  périmètres de protection du code de la santé, sinon, les communes »
  (code de l'environnement, art. R.211-81-1 et R.211-81-1-1).

Elle ne contient **aucun périmètre géographique**. Et comme les 89 AAC d'AURA
sont toutes sans arrêté de délimitation, la cascade de la fiche ne permet pas
davantage de reconstituer les limites : il faudrait les périmètres de protection
du code de la santé, qui ne sont pas dans les fichiers fournis.

L'appartenance d'une parcelle à une ZAR reste donc **indéterminée**. Les
cartographies sont publiées par la DREAL AURA ; leur adresse figure dans la
fiche.

### Programme d'actions nitrates, GREN, captages, cours d'eau

Fournis, analysés, **pas encore intégrés** :

| Fichiers | État | Ce qu'il reste à faire |
| --- | --- | --- |
| `05_PAN_PAR/` — 7 pièces, dont l'arrêté PAR7 et son modificatif | lus | transformer les périodes, plafonds et conditions en règles structurées |
| `06_GREN/` — arrêté + 21 fiches techniques | lus | extraire les tableaux (besoin, fourniture du sol, coefficients) |
| `09_CAPTAGES/` — ouvrages et points de prélèvement, France entière, 2024-06 | lus | **la colonne `geom` de `regulatory_zones` est un `MultiPolygon`** : des points n'y entrent pas. Une migration est nécessaire |
| `08_BD_TOPAGE_AURA/` — 402 215 tronçons, 18 796 cours d'eau | lus | même contrainte : des lignes n'entrent pas dans un `MultiPolygon` |

La contrainte de type géométrique est structurelle et doit être traitée avant
l'import des captages et de l'hydrographie : la lever revient à élargir la
colonne en `geometry(Geometry, 4326)` et à vérifier que tous les calculs de
surface existants continuent de fonctionner.

### Un fichier inutilisable

`07_AAC/AAC.gpkg.zip` (4 222 976 octets) est une **archive tronquée** : l'en-tête
nomme bien `AAC.gpkg`, mais le répertoire central du ZIP est absent. Ni `unzip`,
ni Python, ni GDAL ne l'ouvrent. Aucune donnée n'en a été tirée — récupérer
partiellement un référentiel réglementaire reviendrait à en inventer la partie
manquante.

`07_AAC/AAC_FRA.gpkg.zip` couvre la France entière et contient les AAC d'AURA :
rien n'est perdu.

---

## Règles de tenue de ce référentiel

1. **Une version par campagne pour l'IFT.** Les campagnes coexistent ; aucune ne
   remplace l'autre. `finishImport` reçoit `remplaceLesVersionsAnterieures:
   false` pour ce domaine.
2. **Une version remplace la précédente pour un zonage.** Une nouvelle
   délimitation se substitue à l'ancienne, qui passe en « remplacée » — jamais
   supprimée, pour que les campagnes closes restent lisibles.
3. **Rien n'est déduit d'une donnée absente.** Un champ vide reste vide, une
   appartenance indécidable reste indéterminée, et l'interface le dit.
4. **Chaque règle porte sa source.** Référentiel, version, territoire, dates de
   validité, et référence du texte quand elle existe.
