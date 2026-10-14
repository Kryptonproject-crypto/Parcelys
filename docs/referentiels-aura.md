# Référentiels réglementaires — Auvergne-Rhône-Alpes

Ce document dit **ce qui est intégré, d'où cela vient, à quoi cela sert dans
Parcelys, et ce qui manque**. Il est tenu à jour avec le code : une donnée qui
change de millésime change ici aussi. La page **Administration → Référentiels**
affiche les mêmes informations, lues en base.

Les fichiers source sont dans `data/referentiels-aura/` ; les transcriptions des
arrêtés, dans `data/referentiels-aura/transcriptions/` (voir son `README.md`).

---

## Importer, vérifier

```bash
# Tout, dans l'ordre (E-Phy, IFT, contour régional, zones vulnérables, AAC,
# BD TOPAGE, captages, puis les règles du PAR7, des ZAR et du GREN)
npm run referentiels:aura

# Une partie seulement
npm run referentiels:aura -- --seulement cours-eau,captages
npm run referentiels:aura -- --sans ephy,ift

# Vérifier les moteurs sur les données importées (exploitation fictive posée
# sur des emplacements réels, supprimée en partant)
npm run check:referentiels-aura
```

L'import a besoin de **GDAL** (`ogr2ogr`) : les GeoPackage nationaux sont chargés
en flux, sans être tenus en mémoire. `scripts/install-pi.sh` et
`scripts/update-pi.sh` l'installent (`gdal-bin`).

Chaque fichier employé est **vérifié par son empreinte SHA-256**, enregistrée avec
la version importée ; les PDF dont les règles sont transcrites sont vérifiés à
chaque import — si l'un change, l'import s'arrête plutôt que d'opposer une
transcription périmée.

---

## Ce qui est intégré

| Référentiel | Version / millésime | Territoire | Contenu | Employé par |
| --- | --- | --- | --- | --- |
| Catalogue E-Phy (ANSES) | **2026-10-13** | national | 15 156 produits (2 744 sans date de retrait), 8 237 substances, 81 613 usages dont 15 523 avec ZNT aquatique et 17 863 avec délai avant récolte, 29 641 conditions d'emploi | dose maximale, retrait, nombre d'applications, intervalle, DAR, ZNT, conditions d'emploi (sol drainé, délai de rentrée, abeilles, riverains) |
| Doses de référence IFT | **2026** (GCU1 à GCU6) et **2025** (GCU1 seul) | national | 257 160 et 60 285 doses | IFT, **par campagne** |
| Contour régional | empreinte `76ef7153ee54` | 84 | 1 contour | rattache la parcelle à l'AURA (et donc au PAR7 et au GREN) |
| Zones vulnérables | **2021**, révision du 12/05/2025 | 84 | 1 125 communes (498 Loire-Bretagne, 627 Rhône-Méditerranée) | contexte de la parcelle, champ d'application du PAR7 et du plan de fumure |
| Aires d'alimentation de captage | **2026-09-15** | 84 | 89 aires | contexte de la parcelle ; reconstitution des ZAR |
| BD TOPAGE | **2026** | 84 | 402 215 tronçons, 18 796 cours d'eau, 97 903 surfaces, 3 894 plans d'eau, 3 bassins | bassin de la parcelle, distances, bande enherbée (à vérifier), ZNT (rappel) |
| Captages (Sandre) | **2024-06-05** | 84 | 22 479 ouvrages, 23 787 points de prélèvement | contexte de la parcelle (distances) |
| Programme d'actions régional (PAR7) | arrêté n° **24-135** du 19/07/2024 modifié par le n° **24-162** du 12/09/2024 | 84 | 34 règles, en vigueur depuis le 01/09/2024 | contrôle de chaque apport et de chaque couvert |
| Zones d'actions renforcées | annexe 1 du PAR7 modifiée | 84 | 17 captages, 18 périmètres (11 reconstitués par l'AAC, 6 indéterminés) | prescriptions renforcées des ZAR |
| Référentiel GREN | arrêté n° **24-147** du 07/08/2024 ; fiches du 21/06/2024 (fiche 19 du 15/07/2025) | 84 | 113 règles et tableaux | dose prévisionnelle (plan de fumure), Kéq, teneurs et azote potentiellement libéré des produits organiques |

---

## Comment chaque référentiel est réellement employé

### Une règle se lit à la date de l'intervention, sur le territoire de la parcelle

Toute règle transcrite porte son **texte** (arrêté, article, page), sa
**citation** mot pour mot, son **territoire** et sa **date d'entrée en vigueur**.
Elle n'est opposée qu'à une intervention datée **après** cette date, sur une
parcelle dont le contour recoupe le **contour régional** importé. Un épandage de
février 2024 relève du 6e programme (non fourni) : il ressort « indéterminé », pas
contrôlé avec le 7e.

Chaque constat affiche la trace de la règle : règle, texte, référentiel et
version, territoire, période de validité, et la citation repliée.

### Zones vulnérables : la commune n'est pas la zone

| Classement publié | Communes | Conclusion |
| --- | --- | --- |
| « toutes sections » | 899 | le contour communal **est** la zone : **dedans** |
| « quelques sections » | 219 | l'arrêté vise des sections que le fichier ne nomme pas : **indéterminé** |
| « suppression » (décisions du TA du 6 juin 2024) | 7 | **classée jusqu'au 06/06/2024**, plus ensuite |

Le classement est une **chronologie** : une commune retirée en 2024 reste classée
pour les campagnes antérieures. Le bassin hydrographique de la parcelle est
déterminé par la BD TOPAGE ; une parcelle d'un bassin dont aucune commune n'est
publiée (Adour-Garonne) a un zonage **indéterminé**, pas « hors zone ».

### Zones d'actions renforcées

La liste des captages vient de l'annexe 1 du PAR7 (modifiée par le n° 24-162).
Aucune cartographie n'est fournie. Pour chaque captage :

- quand une **aire d'alimentation** du référentiel national recoupe la commune
  citée, elle sert de périmètre, **découpée à la région** — le périmètre est
  marqué « reconstitué », et tout constat qui en dépend est « à vérifier » : la
  cartographie de la DREAL fait foi ;
- sinon, la commune citée sert d'emprise, et l'appartenance de la parcelle est
  **indéterminée**.

### Programme d'actions (PAR7)

Contrôlés à l'enregistrement de chaque apport (affichés dans le formulaire) et
dans la synthèse de conformité :

- allongement régional de l'interdiction des fertilisants de type III
  (15-28 février) avant une culture de printemps récoltée dans l'année ;
- fractionnement des apports de type III (100 kg N/ha, adaptations du maïs, des
  noyers, des engrais à libération progressive) ;
- épandages sur CINE et CIE (plafonds d'azote potentiellement libéré, calculé
  avec les coefficients de la fiche GREN 19) ;
- phase liquide des digestats (sol nu, septembre) ;
- couverture des sols : date limite d'implantation (« à vérifier » au-delà, les
  dispenses n'étant pas connues de Parcelys), destruction (1er novembre, huit
  semaines, sols argileux), destruction chimique, légumineuses pures ;
- ZAR : interdiction d'épandage sur CINE, premier apport plafonné, couverts,
  repousses, retournement de prairies ;
- bande enherbée : un écoulement de la BD TOPAGE à moins de 5 m du contour rend
  le point « à vérifier » — la couche « BCAE » qui désigne les cours d'eau
  concernés n'est pas fournie, et la carte seule ne crée jamais l'obligation.

Les autres règles du PAR7 sont **transcrites, importées et affichées** (page des
référentiels, mentions des constats), mais pas opposées automatiquement : elles
dépendent de données que Parcelys ne recueille pas — dispenses de couverture
(taux d'argile, culture suivante porte-graines, pérenne ou alliacée, boues de
papeterie), cannes de maïs (contours des PRA et des PPRI non fournis), repousses
de céréales hors ZAR (taux de couverture), maraîchage en ZAR, analyse des
digestats, durée recommandée, suivi des parcelles sans couvert, dérogations
issues du 6e programme.

Un fertilisant **minéral azoté** est de type III. Les autres types se
**déclarent** sur la fiche du produit (Paramètres → Produits organiques), avec
les dénominations de la fiche GREN 19 : Parcelys ne déduit pas le type d'un nom.

### GREN : la dose prévisionnelle

Écran **Plan prévisionnel de fumure**, par culture (onglet Apports de la
parcelle). La fiche est choisie par la culture (fiche 1), la formule par
l'ex-région (Auvergne : 03, 15, 43, 63 ; Rhône-Alpes : 01, 07, 26, 38, 42, 69, 73,
74), à partir du **code INSEE de la parcelle**. Chaque terme est lu dans le
tableau de la fiche ; Pf = b × y (plafond de 330 pour le colza), Nirr = V × C /
443, Xpro = quantité × teneur × Kéq, Pi du colza par la matière verte, 1/CAU du
maïs en Rhône-Alpes. L'objectif de rendement est la moyenne des cinq dernières
campagnes de l'exploitation hors extrêmes, à défaut la fiche 20, à défaut une
valeur déclarée et justifiée. La règle des petites doses s'applique (entre 0 et
30 u : 30 u possibles ; bilan négatif : aucun apport).

**Le calcul s'arrête** — et dit pourquoi — dès qu'un terme indispensable manque :
cellule vide d'un tableau, tableau non transcrit pour l'ex-région, formule
ambiguë, moins de cinq campagnes de rendement sans autre choix, fiche 19 absente
à la date du bilan, terme « sans objet » non déclaré. Le plan est enregistré avec
son calcul **tel qu'il a été fait** et la trace de chaque règle ; un dépassement
du prévisionnel se justifie sur le même écran (motifs de l'art. 8 de l'arrêté).

### E-Phy, IFT, ZNT, DAR

- La **dose de référence IFT** est celle de la culture (ou de la cible saisie
  quand elle est exactement celle du fichier) — jamais une dose de traitement de
  semences, jamais celle d'une autre culture. Les noms de culture sont ceux du
  catalogue E-Phy, choisis dans le panneau d'usage de la saisie.
- La **ZNT aquatique** de l'usage est rappelée ; si un écoulement de la BD TOPAGE
  passe à moins de cette distance du contour, il est nommé avec sa distance —
  **sans conclure que la ZNT s'applique** : c'est la désignation des points
  d'eau par arrêté préfectoral qui la rend applicable, et sa cartographie n'est
  pas fournie.
- Le **délai avant récolte** est opposé à la date de récolte de la culture.

---

## Ce qui manque, et ce que cela empêche

| Donnée | Conséquence dans Parcelys |
| --- | --- |
| Périodes d'interdiction **nationales** (PAN), plafond de 170 kg N/ha et définition des types 0 à III | ces contrôles restent « indéterminés » ; seuls les renforcements régionaux sont opposés |
| 6e programme d'actions (2018-248) et GREN de 2018 | les campagnes antérieures au 01/09/2024 ne sont pas contrôlées |
| Fiche GREN 19 antérieure au 15/07/2025 | Kéq, teneurs et azote potentiellement libéré indisponibles avant cette date : Xpro et les plafonds CINE/CIE indéterminés |
| Besoins du blé par variété (tableaux Arvalis – COMIFER) | l'exploitant déclare le besoin de sa variété, ou indique qu'elle n'est pas référencée |
| Rf et Mh de la betterave en Rhône-Alpes ; Pi du maïs en Auvergne | dose non calculée dans ces cas (Pi = 0 déclaré lève l'ambiguïté du maïs) |
| Cartographie DREAL des ZAR ; périmètres de protection de captage | ZAR reconstituées « à vérifier », 6 captages au périmètre indéterminé |
| Couche « BCAE » ; cartographie départementale des points d'eau | bande enherbée et ZNT « à vérifier », jamais déduites de la carte |
| Sections cadastrales des communes « quelques sections » | appartenance à la zone vulnérable indéterminée |
| Groupes GCU2 à GCU6 de la campagne IFT 2025 | IFT 2025 de ces cultures non calculé |
| Petites régions agricoles et zones PPRI | dérogations « cannes de maïs » non opposées (texte affiché) |
| `07_AAC/AAC.gpkg.zip` | archive tronquée, écartée — `AAC_FRA.gpkg.zip` contient les mêmes aires |

---

## Règles de tenue

1. **Une version par campagne pour l'IFT.** Les campagnes coexistent ; aucune ne
   remplace l'autre.
2. **Une version remplace la précédente pour un zonage ou un programme.** La
   précédente passe en « remplacée » — jamais supprimée, pour que les campagnes
   closes restent lisibles avec la règle de leur date.
3. **Rien n'est déduit d'une donnée absente.** Un champ vide reste vide, une
   appartenance indécidable reste indéterminée, un calcul incomplet ne donne pas
   de chiffre — et l'interface dit pourquoi.
4. **Chaque règle porte sa source** : texte, article, page, citation, version,
   territoire, dates de validité.
5. **Une transcription se vérifie** : `data/referentiels-aura/transcriptions/`
   cite chaque PDF par son empreinte, et l'import refuse une source modifiée.
