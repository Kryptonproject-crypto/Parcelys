# Audit complet de Parcelys — version 0.9.5

Audit mené le 11 septembre 2026, du dépôt à la base, en passant par le
navigateur et l'application de terrain.

La règle suivie du début à la fin, et qui explique la forme de ce rapport :

> **Une fonctionnalité n'est pas fonctionnelle parce qu'elle figure dans le code
> ou à l'écran.**

Chaque contrôle ajouté pendant cet audit a été éprouvé en **cassant
volontairement** ce qu'il surveille, pour vérifier qu'il vire au rouge. Un
contrôle qui ne peut pas échouer ne vérifie rien, et un rapport qui ne liste que
des coches vertes ne prouve rien.

Deuxième règle, tout aussi tenue : **une vérification impossible n'est jamais
transformée en « OK »**. La section 8 liste ce qui n'a pas pu être vérifié ici,
pourquoi, et la commande qui le vérifierait ailleurs.

---

## 1. État final

| | |
|---|---|
| Version | **0.9.5** (site, application de terrain, `versionCode` 905) |
| Branche | `claude/parcelys-saas-agricole-7iqlgw` |
| Commit | `12a56fb` |
| Étiquette `v0.9.5` | **à poser par Kevin** — voir section 7 |
| Tests | **567**, répartis en 36 fichiers — tous au vert |
| Typage | `tsc --noEmit` sans erreur (mode strict, `noUncheckedIndexedAccess`) |
| Lint | aucun avertissement |
| Compilation | site et application de terrain compilent (90,69 ko gz pour le mobile) |
| Audits au navigateur et à l'API | **125 contrôles**, 0 problème |
| Pages vérifiées | 47 sur trois profils (exploitant, expert, administrateur) |
| Routes d'API sondées | 76 sur 76 (aucune oubliée : la couverture est vérifiée) |
| Responsive | 27 pages × 7 largeurs = 189 mesures, aucun débordement |
| Sauvegarde → restauration | cycle complet éprouvé, y compris le refus d'une archive tronquée |

Le périmètre réel du logiciel : **54 modèles** de données, **76 routes** d'API,
**49 pages**.

---

## 2. Les 24 domaines passés en revue

Le verdict porte sur ce qui a été **constaté**, pas sur ce qui est censé
fonctionner.

| # | Domaine | Verdict | Comment il a été constaté |
|---|---|---|---|
| 1 | Comptes, sessions, mots de passe | ✅ | `tests/auth.test.ts`, audit API (34 routes refusent un inconnu) |
| 2 | Cloisonnement entre exploitations | ✅ | 7 tentatives d'accès à la parcelle d'autrui, toutes repoussées ; `tests/security-isolation.test.ts` |
| 3 | Rôles et permissions (exploitant / expert / admin) | ✅ | 6 routes d'administration refusent un exploitant ordinaire |
| 4 | Parcellaire et géométries | ✅ | Parcours complet : contour dessiné → superficie calculée par PostGIS (5,1560 ha) |
| 5 | Campagnes culturales | ⚠️→✅ | **Défaut trouvé et corrigé** (§3.1) ; `tests/fuseau.test.ts` |
| 6 | Cultures et assolement | ✅ | Une culture déclarée ressort sur sa campagne, et **pas** sur la précédente |
| 7 | Traitements phytosanitaires | ⚠️→✅ | **Défaut trouvé et corrigé** (§3.2) ; 22 cas dans `tests/phyto-control.test.ts` |
| 8 | Catalogue E-Phy (doses, ZNT, DAR) | ✅ | `tests/ephy-doses.test.ts` sur le format officiel réel |
| 9 | Fertilisation et bilan NPK | ✅ | Azote calculé depuis la teneur du produit, vérifié contre la valeur écrite |
| 10 | Épandage d'effluents | ➕ | **Nouveau** (§4.3) ; 11 cas dans `tests/epandage.test.ts` |
| 11 | Plafond d'azote organique | ✅ | `tests/regulatory-nitrogen.test.ts` ; repris par le contrôle avant épandage |
| 12 | Zonages réglementaires et carte | ✅ | `npm run check:carte` : la zone proche renvoyée, celle à 550 km écartée |
| 13 | Élevage et classement ICPE | ❌ | **Non implémenté** — voir §6 |
| 14 | Conformité et IFT | ✅ | Le rapport n'affirme jamais la conformité légale (vérifié par chaîne interdite) |
| 15 | Certification AB et MAEC | ❌ | **Non implémenté** — voir §6 |
| 16 | Import TéléPAC (XML et Shapefile) | ✅ | `tests/telepac-xml.test.ts`, `tests/pac-workflow.test.ts` |
| 17 | Cloisonnement du domaine PAC | ✅ | `tests/cloisonnement-pac.test.ts` (faille fermée en 0.9.1) |
| 18 | Exports (CSV, PDF) | ✅ | Produits, non vides, et contenant la parcelle saisie à l'instant |
| 19 | Stocks et lots | ✅ | `tests/stock.test.ts`, `npm run check:stocks` |
| 20 | Dossier de contrôle et justificatifs | ✅ | `npm run check:dossier` : versions verrouillées, empreintes distinctes |
| 21 | Application de terrain (hors ligne) | ✅ | Instantané servi, file d'attente rejouée, doublon refusé au rejeu |
| 22 | Synchronisation et idempotence | ✅ | Un lot renvoyé rend `replayed`, sans créer de second enregistrement |
| 23 | Affichage sur téléphone | ✅ | 189 mesures sur 7 largeurs, de 320 à 768 px |
| 24 | Sauvegarde et restauration | ⚠️→✅ | **Jamais essayée jusqu'ici** (§3.5) ; cycle complet désormais vérifié |

Légende — ✅ vérifié · ⚠️→✅ défaut trouvé puis corrigé et éprouvé · ➕ ajouté
par cet audit · ❌ absent du logiciel, dit comme tel.

---

## 3. Ce que l'audit a trouvé

Six défauts réels, rangés du plus grave au moins grave. Chacun est décrit avec
ce qu'il **produisait**, pas seulement ce qu'il était.

### 3.1 Une date pouvait s'afficher décalée d'un jour

Le plus sérieux, et le moins visible. Trouvé en suivant un avertissement React
sur `/portefeuille` qui n'avait l'air de rien (erreur #418, hydratation).

`toLocaleDateString('fr-FR')` sans fuseau lit la date dans celui **du
processus**. Le serveur tourne en UTC — celui de ce dépôt comme celui du
Raspberry Pi tel qu'il est livré —, le navigateur de Kevin à l'heure de Paris.

Un traitement enregistré le 11 septembre à 22 h 30 UTC s'affichait donc
« 11/09/2026 » dans le HTML servi, et « 12/09/2026 » après hydratation.

> Le registre phytosanitaire est une pièce opposable. Une date décalée d'un jour
> entre l'écran et l'export n'y est pas un défaut d'affichage.

Le même défaut touchait la campagne culturale, et plus gravement :
`campagneCourante` employait `getMonth()`, donc le fuseau de la machine. Le
31 juillet à 23 h 00 UTC il est déjà le 1ᵉʳ août en France ; le serveur comptait
une campagne, le navigateur l'autre. Une saisie faite ce soir-là atterrissait
dans une campagne et s'affichait dans l'autre — ce que l'en-tête du module
interdisait explicitement depuis la 0.9.1.

### 3.2 Le contrôle phytosanitaire ne lisait qu'un tiers du catalogue

E-Phy fournit, pour chaque usage, le **nombre maximal d'applications**,
l'**intervalle minimal** entre deux passages et le **délai avant récolte**.
Parcelys les importait et les affichait — et n'opposait que la dose.

Un troisième passage d'un produit qui en autorise deux ne déclenchait rien.

### 3.3 Le décompte incluait le traitement qu'on venait d'écrire

Découvert en écrivant le contrôle du point précédent. `buildPhytoWarnings` est
appelé **après** l'insertion. L'historique du produit contenait donc le
traitement en cours, et le deuxième passage d'un produit qui en autorise deux
déclenchait l'alerte du troisième.

Un contrôle faux dans l'autre sens est aussi nuisible qu'un contrôle absent :
l'exploitant apprend à ignorer les alertes.

### 3.4 Les pages d'erreur parlaient anglais, et une page se vidait

Aucune page 404 ni 500 n'existait : Next.js servait les siennes, en anglais, au
milieu d'un logiciel entièrement en français.

Pire, une parcelle inexistante affichait une page **vide** plutôt qu'un message :
le garde-fou d'accès ne savait pas traduire « introuvable » en 404.

### 3.5 La restauration des sauvegardes n'avait jamais été essayée

Un script de sauvegarde existait, et vérifiait ce qu'il écrivait.

Mais vérifier qu'une archive est **relisible** n'est pas vérifier qu'elle est
**restaurable** : un dump peut être complet et refuser de se rejouer — extension
absente, ordre des contraintes, propriétaire inexistant. Rien ne l'avait jamais
essayé.

> Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. C'est un
> fichier.

### 3.6 Le titre de l'onglet révélait le nom d'une parcelle d'autrui

Le titre du navigateur était produit avant que le contrôle d'accès n'ait rendu
son verdict. Le nom d'une parcelle appartenant à une autre exploitation
apparaissait donc dans l'onglet, avant le refus.

---

## 4. Les corrections, une par une

### 4.1 Le fuseau de l'exploitation fait foi

| | |
|---|---|
| **Problème** | Dates et campagnes lues dans le fuseau du processus (§3.1) |
| **Cause** | `toLocaleDateString` sans `timeZone` ; `getMonth()` / `getFullYear()` sont locaux |
| **Fichiers** | `src/lib/shared/campagne.ts`, `src/components/ui/index.tsx` |
| **Correction** | `FUSEAU_EXPLOITATION = 'Europe/Paris'` imposé partout. `partiesFr()` lit le jour civil français ; `instantFr()` produit de vrais instants pour les bornes de campagne, au lieu de minuits du fuseau serveur |
| **Test** | `tests/fuseau.test.ts` — 10 cas, sur des instants pris **juste avant minuit à Paris**, c'est-à-dire encore la veille en UTC : c'est là, et seulement là, que les deux lectures divergeaient |
| **Falsifié** | Les deux corrections retirées séparément → 2 cas rouges, exactement ceux attendus |

Effet secondaire corrigé au passage : les bornes de campagne, calculées avec
`new Date(annee, 7, 1)`, laissaient dehors les saisies du 1ᵉʳ août entre minuit
et deux heures.

Le module reste **pur** (aucun import) : l'application de terrain l'utilise via
`@commun/campagne`, et `tests/cloisonnement-mobile.test.ts` l'exige. `Intl` est
un objet global, pas une dépendance.

### 4.2 Les limites d'emploi sont opposées

| | |
|---|---|
| **Problème** | Nombre d'applications, intervalle et DAR importés mais jamais vérifiés (§3.2 et §3.3) |
| **Cause** | Le contrôle ne lisait que la dose ; et il comptait le traitement qu'on venait d'écrire |
| **Fichiers** | `src/lib/ephy/limites.ts` (nouveau), `src/lib/services/phyto-control.ts`, `src/app/api/parcels/[id]/phytosanitary/route.ts` |
| **Correction** | Les trois limites vérifiées à la saisie, plus les conditions d'emploi qui se rappellent sans se calculer (délai de rentrée, abeilles, riverains). Le décompte exclut la ligne qu'on vient d'écrire (`applicationId`, `saufLuiMeme`) |
| **Test** | `tests/phyto-control.test.ts`, porté de 12 à **22 cas** |
| **Falsifié** | Les trois contrôles numériques retirés de la liste → 4 cas rouges |

Les valeurs non numériques du catalogue — « 2 à 3 », « selon la culture » — ne
sont **pas** devinées : ni arrondies, ni prises au plus favorable. Elles sont
écartées, et le contrôle le dit (§34).

### 4.3 Un contrôle avant épandage (nouveau)

| | |
|---|---|
| **Besoin** | « Est-ce que je peux épandre là, aujourd'hui, cette quantité ? » |
| **Fichiers** | `src/lib/regulatory/epandage.ts`, `src/app/api/regulatory/spreading/route.ts` |
| **Comportement** | **N'écrit rien** : c'est une simulation, relançable en changeant la date ou la dose. Vérifie la période d'interdiction, les distances aux cours d'eau et aux habitations, le plafond d'azote organique |
| **Garde-fou** | Trois états — `CONFORME`, `A_VERIFIER`, `NON_CONFORME`. **Si un seul contrôle n'a pas pu être fait, la réponse n'est jamais `CONFORME`** |
| **Test** | `tests/epandage.test.ts` — 11 cas, dont la période qui enjambe le 1ᵉʳ janvier et le refus inter-exploitations |

Trois pièges rencontrés en l'écrivant, et corrigés plutôt que contournés :

1. `plafondAzoteOrganique` ne connaît que les parcelles ayant **déjà** reçu un
   apport ; la question posée ici est prospective. La parcelle visée est donc
   ajoutée à la surface quand elle n'a encore rien reçu.
2. L'azote suit la formule du bilan NPK (`dose × nContent × surface`, où
   `nContent` est en **kg d'azote par tonne**, pas un pourcentage). En employer
   une autre aurait donné deux chiffres différents pour le même apport selon
   l'écran consulté.
3. Ma première version lisait une clé que `organic-nitrogen.ts` n'emploie pas.
   Alignée sur l'existante plutôt que d'en introduire une seconde.

### 4.4 Des pages d'erreur en français, et un vrai 404

| | |
|---|---|
| **Problème** | Pages d'erreur absentes ; parcelle inexistante → page vide (§3.4) |
| **Fichiers** | `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/lib/auth/page-guards.ts` |
| **Correction** | Trois pages ajoutées. `global-error.tsx` n'emploie que des styles en ligne : une erreur globale peut survenir avant le chargement de la feuille de style. `handleAuthFailure` traduit `NOT_FOUND` en `notFound()` |
| **Test** | Audit des pages, cas 404 : vérifié sur le **texte rendu et le titre** |

Une limite assumée et documentée : le squelette de chargement de `(app)` envoie
les en-têtes avant le verdict, si bien que la page 404 rend un corps correct
avec un statut 200. Mesuré dans les deux sens en retirant puis remettant le
squelette. Dégrader l'affichage pour un code de statut n'a pas paru un bon
échange ; le choix est écrit dans `src/app/(app)/loading.tsx`.

### 4.5 Une restauration réellement essayée

| | |
|---|---|
| **Problème** | Aucune restauration n'avait jamais été tentée (§3.5) |
| **Fichiers** | `scripts/restore.sh` (nouveau), `scripts/check-sauvegarde.sh` (nouveau), `scripts/install-pi.sh` |
| **Correction** | Essai à blanc **par défaut** dans une base jetable ; comparaison du nombre de lignes de chaque table et de l'empreinte des contours parcellaires. `--remplacer` pour la vraie restauration : confirmation au clavier, sauvegarde de secours, arrêt du service, contrôle de santé |
| **Test** | `npm run check:sauvegarde` — 9 contrôles, dont le **refus d'une archive tronquée** |

### 4.6 Le titre ne fuit plus

| | |
|---|---|
| **Problème** | Le nom d'une parcelle d'autrui apparaissait dans l'onglet (§3.6) |
| **Fichier** | `src/app/(app)/parcelles/[id]/page.tsx` |
| **Correction** | `generateMetadata` passe par `requirePageParcelAccess`, le même contrôle que la page |

---

## 5. Les pièges de l'outillage — quatre faux constats évités

Cette section existe parce qu'un audit qui se trompe est plus dangereux qu'un
audit absent : il donne une confiance imméritée, ou fait corriger ce qui n'est
pas cassé.

**Le serveur périmé.** `node .next/standalone/server.js` démarre un **enfant**
qui se renomme `next-server` et tient le port. Ne viser que le parent laissait
l'enfant en place : le nouveau serveur ne se liait pas, s'arrêtait, et le
contrôle de santé répondait — servi par l'ancien build. L'audit a signalé
plusieurs minutes durant des feuilles de style « introuvables » qui ne l'étaient
pas. Corrigé dans `scripts/audit-serveur.sh` (deux motifs, pas un).

**Les préchargements de Next.js.** 44 échecs sur 45 venaient de requêtes
`?_rsc=` passant par le mandataire de l'environnement. Le seul vrai défaut se
noyait dedans.

**Le navigateur de Playwright.** Sa révision change à chaque mise à jour de la
bibliothèque ; dix vérifications s'arrêtaient alors sur « installez le
navigateur ». Une vérification qui ne s'exécute pas ressemble beaucoup à une
vérification qui passe. `scripts/lib/navigateur.mjs` cherche désormais celui qui
est présent.

**La base vidée par les tests.** `npm test` efface la base. Lancer ensuite une
vérification au navigateur faisait expirer la connexion au bout de trente
secondes, sans dire pourquoi. `scripts/lib/compte.mjs` interroge l'API d'abord
et nomme le remède (`npm run db:seed`).

Un cinquième point, côté produit celui-là : l'audit des pages ne relevait que
les **5xx**. Un fichier statique absent répond 404 — ou **400** pour une icône
déclarée dans les métadonnées, comme l'a montré l'essai en retirant réellement
`favicon-32.png`. Guetter une liste de codes aurait laissé passer le cas même
qui a motivé le contrôle : toute réponse qui n'est pas un succès sur un fichier
statique est désormais signalée.

---

## 6. Deux domaines entiers qui ne sont pas modélisés

Cherchés dans les 54 modèles du schéma. Ils n'y sont pas. Écrit ici et dans
[`docs/reglementaire.md`](./reglementaire.md) pour qu'on ne le découvre pas en
cherchant l'écran.

**L'élevage et le classement ICPE.** Aucun modèle de cheptel, d'effectif animal,
d'UGB, de bâtiment ni de régime ICPE.

Ce que Parcelys connaît malgré tout, c'est l'aval : fumier et lisier existent
comme produits organiques, l'apport s'enregistre, et le plafond de 170 kg N/ha
issu d'effluents d'élevage est opposé quand le référentiel du territoire est
chargé. Mais **un plan d'épandage dimensionné sur le cheptel ne peut pas être
calculé** : la production d'azote du troupeau n'est pas connue. Les effectifs
animaux présents dans l'export TéléPAC ne sont pas repris — l'adaptateur le dit
à l'import plutôt que de les laisser disparaître en silence.

**La certification AB et les MAEC.** Aucun modèle d'engagement, de mesure
souscrite, de période de conversion ni d'organisme certificateur.

Ce n'est pas un manque discret : **un produit interdit en AB ne sera pas signalé
comme tel**, parce que la notion n'existe pas dans le modèle. Le contrôle
phytosanitaire raisonne sur le catalogue E-Phy — autorisation, dose, DAR, ZNT,
conditions d'emploi — et sur rien d'autre.

Les implanter demanderait le même socle que le reste : un référentiel officiel,
versionné, daté et territorialisé. Tant qu'il n'est pas là, mieux vaut l'absence
qu'une règle inventée.

---

## 7. Sources réglementaires

Aucune valeur réglementaire n'est détenue par Parcelys en propre. Rappel du
principe, inchangé depuis la 0.6.0 :

| Référentiel | Source | État dans ce dépôt |
|---|---|---|
| E-Phy (produits, usages, doses, ZNT, DAR, conditions) | ANSES, via data.gouv.fr | Importable ; **non chargé ici** (§8) |
| Programme d'actions nitrates (périodes, distances, plafond) | Arrêtés préfectoraux et national | Importable, territorialisé ; **non chargé ici** |
| Zonages (zones vulnérables, cours d'eau) | Services WFS officiels | Importable par service web ; `npm run check:carte` |
| Doses de référence IFT | Ministère de l'agriculture | Importable ; **non chargé ici** |
| Codes culture PAC | TéléPAC | Chargé |

Aucune URL n'est codée en dur : les jeux se cherchent par l'API data.gouv.fr, et
c'est l'utilisateur qui choisit — le programme ne décide jamais seul quel jeu
fait autorité.

Les deux phrases que Parcelys ne prononce jamais, vérifiées automatiquement :

- « Votre exploitation est légalement conforme » — remplacée par « Aucune
  anomalie détectée selon les données et référentiels actuellement disponibles ».
- « Déclaration envoyée » — l'export TéléPAC dit « Export préparé pour TéléPAC ».

---

## 8. Ce qui n'a pas pu être vérifié ici

Listé plutôt que passé sous silence, avec le moyen de le vérifier.

| Ce qui n'a pas été vérifié | Pourquoi | Comment le vérifier |
|---|---|---|
| Le contenu du catalogue E-Phy embarqué hors ligne | Le référentiel n'est pas importé dans cette base : data.gouv.fr est bloqué par le mandataire de l'environnement | `npm run ephy:sync -- --zip <archive ANSES>`, puis `npm run audit:e2e` |
| Le calcul de l'IFT sur doses de référence | Même raison | `npm test -- tests/ephy-doses.test.ts` couvre le calcul sur des doses posées en base |
| Le contrôle avant épandage sur référentiel chargé | Aucune règle d'épandage n'est chargée ici | `npm test -- tests/epandage.test.ts` pose ses propres règles |
| Les tuiles de carte et le géocodeur | Bloqués par le mandataire | Sur le Pi, où ils répondent |
| La météo | Service tiers injoignable depuis cet environnement | Sur le Pi |
| L'APK sur un vrai téléphone | Aucun appareil ici ; l'APK se construit à l'étiquette | Après la pose de `v0.9.5` |
| Les temps de réponse **ressentis** | Mesurés sur cette machine, avec 3 parcelles | `npm run audit:perf` sur le Pi |

Les chiffres de performance relevés ici (médiane la plus élevée : 76 ms pour le
tableau de bord, 68 ms pour la page conformité) servent de point de comparaison
d'une version à l'autre. Ils ne disent pas ce que Kevin ressentira : le Pi est
plus lent, sa base plus fournie, et le tunnel ajoute un aller-retour.

---

## 9. Git et mise à jour

```
Branche  claude/parcelys-saas-agricole-7iqlgw
Commit   12a56fb  Parcelys 0.9.5 — un audit qui cherche à échouer
Poussée  faite
```

**L'étiquette `v0.9.5` reste à poser.** Le jeton de cette session est limité à
la branche et reçoit un refus (HTTP 403) sur les étiquettes — comme pour
`v0.9.0` et `v0.9.1`. C'est elle qui déclenche la construction de l'APK.

```bash
git fetch origin
git tag -a v0.9.5 12a56fb -m "Parcelys 0.9.5"
git push origin v0.9.5
```

Mettre à jour le Raspberry Pi :

```bash
cd /opt/parcelys && sudo bash scripts/update-pi.sh
```

Vérifier la sauvegarde après la mise à jour — c'est le moment où cela compte le
plus :

```bash
sudo parcelys-backup           # écrit une archive
sudo parcelys-restore          # essai à blanc, ne touche pas la base en service
```

---

## 10. Dernier contrôle, après le commit

Tout ce qui suit a été exécuté sur l'arbre commité, dans cet ordre.

```
tsc --noEmit                      aucune erreur
eslint                            aucun avertissement
vitest run                        567 tests, 36 fichiers, tous verts
next build                        compilé, sortie standalone complète
mobile: tsc + vite build          compilé, 90,69 ko gz

npm run audit:tout
  pages          47 pages, 3 profils          0 problème
  API            76 routes, 7 attaques        0 problème
  bout en bout   du compte vide à la synchro  0 problème
  performance    18/18 cibles mesurées        0 au-dessus de 1 s
                                              → 125 contrôles verts

npm run check:mobile              27 pages × 7 largeurs = 189 mesures, 0 débordement
npm run check:sauvegarde          9 contrôles, cycle complet, archive tronquée refusée
npm run verif:sans-navigateur     stocks, couverture, plafond, dossier, carte, sauvegarde
```

Deux vérifications restent au nom de Kevin, parce qu'elles ne peuvent pas se
faire ici : poser l'étiquette `v0.9.5`, et relancer `npm run audit:perf` sur le
Pi pour savoir ce que l'application donne sur la vraie machine, avec les vraies
parcelles.
