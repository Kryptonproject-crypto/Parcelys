# Audit réglementaire de Parcelys

État au 10 septembre 2026, version 0.5.0 — 38 modèles de données, 63 routes
d'API, 44 pages, 322 tests.

Ce rapport répond à la consigne : **ne rien recréer de ce qui existe.** Il liste
ce que Parcelys sait déjà faire, ce qu'il fait à moitié, ce qui manque, et
surtout ce qui est présent mais **réglementairement insuffisant** — la catégorie
la plus dangereuse, parce qu'elle donne l'illusion d'être couverte.

---

## A. Existe déjà 🟢

| Domaine | État | Où |
|---|---|---|
| Authentification, sessions, rôles, invitations | 🟢 | `src/lib/auth/`, 3 types de comptes |
| Exploitations, membres, cloisonnement des données | 🟢 | `Farm`, `FarmMember`, `requireFarmAccess` |
| Parcelles + géométrie PostGIS versionnée | 🟢 | `Parcel`, `ParcelGeometry`, superficie par `ST_Area(geography)` |
| Cartographie Leaflet, tracé, import Shapefile | 🟢 | `components/map/`, `lib/pac/shapefile.ts` |
| Cultures et campagnes | 🟢 | `Crop`, `CropYear` (unique par parcelle/campagne) |
| Interventions : apports, phyto, travaux | 🟢 | `FertilizerApplication`, `PhytosanitaryApplication`, `AgriculturalOperation` |
| Météo attachée à chaque intervention | 🟢 | 6 colonnes, relevé au moment de la saisie |
| Catalogue E-Phy officiel (15 140 produits) | 🟢 | `lib/ephy/`, import versionné, `EphySyncRun` |
| Dose autorisée par culture, surdosage, ZNT, sol drainé | 🟢 | 0.5.0 — `lib/ephy/dose.ts`, `lib/services/phyto-control.ts` |
| Registre phytosanitaire généré depuis les interventions | 🟢 | `/registres`, aucune ressaisie |
| Exports CSV / XLSX / PDF | 🟢 | `lib/exports/`, 8 jeux de données |
| PAC : îlots, entités, imports, snapshots, contrôle, export | 🟢 | `lib/pac/`, `PacCampaign` → `PacChange` |
| Référentiel de codes culture PAC versionné | 🟢 | `PacCropCode` (année + version + source) |
| Documents joints, catégorisés | 🟢 | `Document` |
| Journal d'audit | 🟢 | `AuditLog` |
| Application mobile hors ligne, file idempotente | 🟢 | `mobile/`, `/api/sync` |
| Espace expert agronomique, préconisations | 🟢 | `AdvisoryEngagement`, `Recommendation` |
| Administration : utilisateurs, exploitations, experts, maintenance | 🟢 | `/administration` |

**Constat.** La couche « métier de terrain » est solide et le principe *une
saisie alimente plusieurs sorties* est déjà en place pour le phytosanitaire. Le
travail à faire n'est pas de la rebâtir, mais de brancher dessus une couche
réglementaire.

---

## B. Partiel 🟠

| Domaine | Ce qui existe | Ce qui manque |
|---|---|---|
| **Fertilisation** | Saisie, N/P/K apportés, bilan NPK simple (`computeNutrientBalance`) | Aucun prévisionnel, aucun objectif de rendement, aucun reliquat, aucune fourniture du sol |
| **Bilan NPK** | Somme des apports par campagne | Ce n'est **pas** un bilan azoté réglementaire : pas de besoin de la culture, pas de fournitures, pas d'équilibre |
| **Cahier d'épandage** | Les apports organiques sont enregistrés | Pas de distinction azote total / efficace, pas d'origine d'effluent, pas de contrôle de période |
| **Contrôle phyto** | Dose, ZNT, sol drainé, produit retiré (0.5.0) | Pas de nombre d'applications déjà réalisées, pas de DAR vérifié contre la récolte, pas d'IFT |
| **PAC / TéléPAC** | Import, travail, contrôle, export | Pas de lien vers les zonages réglementaires, pas de RPG |
| **Cartographie** | Parcelles, îlots PAC, fond Plan/Satellite | Aucune couche réglementaire (zones vulnérables, captages, cours d'eau) |
| **Tableau de bord** | Surfaces, interventions, tâches | Aucun indicateur de conformité |
| **Rotations** | `CropYear` porte la campagne | Aucune vue rotation, aucun précédent exploité par un calcul |
| **Documents** | Dépôt et catégories | Aucune génération automatique de document réglementaire (hors registre phyto) |

---

## C. Manquant 🔴

Aucune trace dans le code actuel :

1. **Moteur de règles réglementaires** — les seules valeurs réglementaires
   présentes sont celles d'E-Phy. Rien pour les nitrates, l'épandage, la
   couverture des sols.
2. **Référentiels versionnés et territorialisés** — `PacCropCode` est le seul
   modèle versionné ; le principe n'est pas généralisé.
3. **Zones réglementaires géographiques** — aucune table, aucune intersection.
4. **Contexte réglementaire de la parcelle** — département, région, bassin, zone
   vulnérable, ZAR, captage : rien n'est déterminé automatiquement.
5. **Programme d'actions nitrates (national / régional)** — absent.
6. **Plan prévisionnel de fumure (PPF)** — absent.
7. **Bilan azoté réglementaire explicable** — absent.
8. **Prévisionnel vs réalisé, justification d'écart** — absent.
9. **Cahier d'enregistrement des pratiques (CEP)** — absent en tant que document
   verrouillé par campagne.
10. **Plafond d'azote organique** — absent.
11. **Couverture des sols (CIPAN/CINE, dates, destruction)** — absent.
12. **Analyses de sol et reliquat sortie hiver** — absent.
13. **Irrigation et azote apporté par l'eau** — absent.
14. **IFT** — absent, y compris le référentiel de doses de référence.
15. **Stocks et lots** — absents.
16. **Dossier de contrôle** — absent.
17. **Justificatifs typés** — `Document` existe mais sans rattachement à un
    objet réglementaire.
18. **Historique réglementaire** — aucune notion de règle applicable à une date.

---

## D. Réglementairement insuffisant ⚠️

La catégorie qui compte le plus, parce que ces fonctions **existent** et
pourraient laisser croire que le sujet est traité.

| Fonction | Pourquoi c'est insuffisant |
|---|---|
| `computeNutrientBalance` | Additionne les apports. Un bilan azoté réglementaire part du **besoin de la culture** et retranche les **fournitures** (reliquat, sol, précédent, irrigation). Le résultat actuel ne répond à aucune obligation. |
| Registre phytosanitaire | Correct sur le fond, mais aucune distinction entre le **minimum réglementaire** et les informations de confort. Et il n'est disponible qu'en PDF/CSV/XLSX sans structure figée — à revoir pour l'échéance du registre électronique lisible par machine. |
| Apports organiques | Enregistrés comme un engrais quelconque. Ni origine d'effluent, ni azote efficace, ni rattachement au plafond d'azote organique. |
| Contrôle de dose phyto | Compare à la dose retenue au catalogue. Ne vérifie ni le **nombre d'applications déjà faites**, ni le **DAR** au regard de la date de récolte prévue. |
| `Parcel.drainedSoil` | Bonne base, mais c'est la seule caractéristique réglementaire de la parcelle. Pente, proximité d'un cours d'eau, zone vulnérable : rien. |
| Contrôle PAC | Vérifie la cohérence interne du dossier. Ne confronte à aucun zonage ni à aucune règle externe. |
| Exports | Produisent des tableaux. Aucun n'est un **document réglementaire daté, versionné et verrouillé**. |

---

## E. Données manquantes

Tables et champs à créer (détail dans `prisma/schema.prisma` après 0.6.0) :

**Moteur** — `RegulatoryReferential`, `RegulatoryRule`, `RegulatoryImport`
**Géographie** — `RegulatoryZone` (PostGIS), `ParcelRegulatoryContext`
**Fertilisation** — `NitrogenPlan`, `NitrogenPlanEntry`, `NitrogenPlanDeviation`
**Sol** — `SoilAnalysis`
**Eau** — `IrrigationEvent`
**Couverture** — `SoilCover`
**Phyto** — `IftReference`, dose de référence sur `PhytoUsage`
**Conformité** — `ComplianceFinding`
**Parcelle** — pente moyenne, distance au cours d'eau, type de sol, îlot cultural
**Effluents** — origine, azote efficace, espèce, sur `FertilizerApplication`

---

## F. Sources publiques

| Donnée | Source officielle | Format | Fréquence | Licence |
|---|---|---|---|---|
| Produits phytopharmaceutiques | E-Phy — ANSES, via data.gouv.fr | ZIP de CSV | mensuelle | Licence Ouverte |
| Doses de référence IFT | Ministère de l'Agriculture | XLSX / CSV | annuelle | Licence Ouverte |
| Zones vulnérables nitrates | DREAL / data.gouv.fr, services WFS | GeoJSON / SHP / WFS | à chaque révision | Licence Ouverte |
| Zones d'actions renforcées | DREAL régionales | GeoJSON / SHP | à chaque PAR | Licence Ouverte |
| Programmes d'actions régionaux | DRAAF / Légifrance | texte + arrêté | à chaque PAR | — |
| Référentiels GREN | GREN régionaux / DRAAF | PDF / XLSX | annuelle | variable |
| Captages, AAC | Services publics de l'eau / data.gouv.fr | GeoJSON / WFS | variable | Licence Ouverte |
| Cours d'eau (BD TOPO) | IGN / Géoplateforme | WFS / GeoJSON | annuelle | Licence Ouverte |
| Communes, codes INSEE | API Découpage administratif | JSON | continue | Licence Ouverte |
| RPG | IGN / data.gouv.fr | SHP / GeoPackage | annuelle | Licence Ouverte |
| Codes culture PAC | Ministère / TéléPAC | CSV | annuelle | — |

> **Contrainte constatée pendant cet audit.** Depuis l'environnement
> d'intégration, `data.gouv.fr`, `data.geopf.fr` et `geo.api.gouv.fr` sont
> **refusés par la politique réseau**. Aucun de ces jeux de données n'a donc pu
> être téléchargé ici, et **aucun n'a été recréé de mémoire**.
>
> C'est précisément le cas d'usage prévu par la section 30 du cahier des
> charges : on construit l'abstraction, la variable d'environnement et le
> pipeline d'import ; le référentiel reste marqué **« non configuré »** jusqu'à
> ce qu'une synchronisation réelle soit lancée depuis le Raspberry Pi, qui
> dispose d'un accès réseau. C'est exactement le fonctionnement déjà éprouvé
> pour E-Phy.

---

## G. Frontend à enrichir (écrans existants)

Aucun écran n'est remplacé. Sont **complétés** :

| Écran | Ajout |
|---|---|
| `/parcelles/[id]` — onglet Général | Bloc « Contexte réglementaire » : zonages, surfaces concernées, sources |
| `/parcelles/[id]` — onglet Apports | Bandeau PPF : prévu / réalisé / écart, et justification si dépassement |
| Formulaire d'apport (`FertilizationForm`) | Alerte de dépassement, période d'épandage, azote efficace |
| Formulaire phyto (`PhytoForm`) | IFT du traitement, nombre d'applications déjà faites |
| `/dashboard` | Carte « Conformité » — sans jamais affirmer la conformité légale |
| `/registres` | Onglets CEP et cahier d'épandage, à côté du registre phyto |
| Carte (`ParcelsMap`) | Couches réglementaires, avec source et date par couche |
| `/administration` | Centre des référentiels : versions, dates, journal d'import |

## H. Nouveaux écrans (strictement nécessaires)

1. `/fertilisation/ppf` — plan prévisionnel de fumure et bilan azoté expliqué.
2. `/conformite` — synthèse des anomalies et dossier de contrôle.
3. `/administration/referentiels` — état, versions et import des référentiels.

Trois écrans, pas davantage. Tout le reste s'ajoute à l'existant.

---

## Plan d'implémentation

**0.6.0 — socle réglementaire** (cette version)
Moteur de règles versionné · zones géographiques et intersections réelles ·
contexte réglementaire de la parcelle · PPF et bilan azoté explicable ·
prévisionnel vs réalisé et justification · analyses de sol · IFT sur doses de
référence · CEP et cahier d'épandage · centre des référentiels · tableau de bord
de conformité.

**0.7.0 — priorité 2**
Stocks et lots · couverture des sols · irrigation · rotations · plafond d'azote
organique · dossier de contrôle · justificatifs typés · couches réglementaires
sur la carte.

**0.8.0 — priorité 3**
Mise à jour automatique des référentiels (détection de version) · alertes
avancées · registre phytosanitaire électronique lisible par machine ·
assistance IA branchée sur le moteur, jamais sur sa propre mémoire.
