# 🌾 Parcelys

Logiciel de gestion parcellaire agricole : cartographie des parcelles, suivi des
cultures, registre des apports, registre phytosanitaire, météo locale et exports
réglementaires.

Application web auto-hébergeable — conçue pour tourner aussi bien sur un serveur
que sur un Raspberry Pi.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Pile technique](#pile-technique)
- [Interface](#interface)
- [Installation](#installation)
- [Administration et inscriptions](#administration-et-inscriptions)
- [Configuration](#configuration)
- [Référentiel phytosanitaire E-Phy](#référentiel-phytosanitaire-e-phy)
- [Déploiement](#déploiement)
- [Déploiement sur Raspberry Pi](#déploiement-sur-raspberry-pi)
- [Mises à jour](#mises-à-jour)
- [Application mobile (Android)](#application-mobile-android)
- [Maintenance](#maintenance)
- [Tests](#tests)
- [Architecture](#architecture)
- [Sécurité](#sécurité)
- [RGPD](#rgpd)
- [API](#api)

---

## Fonctionnalités

| Module | Description |
| --- | --- |
| **Parcelles** | Dessin des contours sur carte (OpenStreetMap ou fond satellite), superficie calculée par PostGIS sur l'ellipsoïde WGS84, géométries versionnées, détection des recouvrements, recherche d'adresse (Base Adresse Nationale). |
| **Cultures** | Culture, variété, dates de semis et de récolte, rendement. Référentiel de 29 cultures + cultures personnalisées. Historique conservé campagne après campagne. |
| **Apports** | Apports organiques et minéraux. Quantité totale calculée (`dose × surface`) et bilan des éléments fertilisants N, P₂O₅, K₂O — jamais estimé lorsque la teneur du produit est inconnue. |
| **Phytosanitaire** | Saisie des traitements avec recherche du produit dans le catalogue officiel **E-Phy** (AMM, substances actives, usages autorisés), relevé automatique des conditions météo, registre généré automatiquement. |
| **Travaux** | Labour, déchaumage, semis, récolte, transport… avec matériel, opérateur et durée. |
| **Météo** | Conditions actuelles, prévisions horaires et journalières sur la parcelle ou le siège d'exploitation. Évaluation de la fenêtre de traitement (vent, pluie, température). |
| **Historique** | Chronologie complète par parcelle : cultures, récoltes, apports, traitements, travaux, documents. |
| **Documents** | Factures, analyses de sol, photos, documents administratifs. Validation d'extension, de type MIME et de signature binaire. |
| **Exports** | Registre parcellaire, phytosanitaire, apports, cultures, travaux et historique, en **PDF**, **Excel** et **CSV**, filtrables par campagne et par parcelle. |
| **Multi-exploitations** | Un utilisateur peut appartenir à plusieurs exploitations, avec quatre rôles : propriétaire, administrateur, salarié, lecture seule. |
| **Administration** | Instance fermée : aucun compte ne peut être créé sans code d'invitation délivré par un administrateur. Onglet dédié pour les comptes, les invitations, les exploitations, le journal d'audit, le mode maintenance et les purges. |
| **Application mobile** | APK Android (Capacitor) pour le terrain : relevé de parcelle au GPS (contour marché ou sommets posés), saisie des traitements, apports et travaux **hors réseau**, file d'attente et synchronisation idempotente. Voir [`mobile/`](mobile/README.md). |

---

## Pile technique

- **Next.js 15** (App Router) + **React 19** + **TypeScript strict**
- **Tailwind CSS 4**
- **PostgreSQL 16** + **PostGIS 3.4** (géométries stockées en base)
- **Prisma 6** (ORM, requêtes paramétrées)
- **Leaflet** (cartographie, sans dépendance de plugin)
- **Zod** (validation stricte, côté serveur comme côté client)
- **Vitest** (tests unitaires, base réelle et API HTTP)

---

## Interface

- **Thème clair et sombre**, choisi explicitement et mémorisé. Le thème est posé
  avant le premier rendu : pas de clignotement au chargement.
- **Jetons sémantiques** (`surface`, `ink`, `line`, `accent`…) : une seule
  définition par thème, aucune couleur en dur dans les pages.
- **Typographie Inter**, auto-hébergée par Next — aucune requête vers un tiers,
  donc rien à ouvrir dans la CSP.
- **Icônes Lucide** dans toute l'interface de travail ; les emoji restent
  cantonnés aux contenus éditoriaux.
- **Graphiques** dessinés en HTML/SVG, sans bibliothèque : répartition de
  l'assolement et interventions par mois. La palette est validée pour les deux
  thèmes (séparation daltonisme ΔE ≥ 8), les couleurs sont attribuées dans un
  ordre fixe et jamais recyclées, et chaque série porte toujours un libellé
  chiffré — la couleur n'est jamais le seul porteur d'information.
- **Confirmations et notifications** intégrées : ni `window.confirm`, ni
  `window.alert`. Une suppression annonce précisément ce qu'elle efface.
- **Responsive** du téléphone au grand écran, avec barre de navigation basse sur
  mobile, et respect de `prefers-reduced-motion`.

---

## Installation

### Prérequis

- Node.js ≥ 20.11
- PostgreSQL ≥ 14 avec l'extension **PostGIS**
  (ou Docker, qui fournit les deux)

### Démarrage rapide

```bash
git clone <url-du-dépôt> parcelys
cd parcelys

# 1. Base de données (Docker) — ou utilisez votre propre PostgreSQL/PostGIS
docker compose up -d db

# 2. Configuration
cp .env.example .env
#    Renseignez au minimum DATABASE_URL

# 3. Dépendances, migrations et données de démonstration
npm install
npm run db:migrate
npm run db:seed

# 4. Lancement
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

Le seed crée un compte de démonstration, qui est aussi **administrateur de
l'instance** :

```
demo@parcelys.local / Demo1234!
```

> L'inscription publique est fermée : c'est depuis ce compte, dans l'onglet
> **Administration**, que se délivrent les codes d'invitation permettant de créer
> les autres comptes. Voir [Administration et inscriptions](#administration-et-inscriptions).

> Les données de démonstration sont marquées `isDemo` en base, et l'application
> affiche un bandeau d'avertissement sur ces exploitations. Elles ne sont pas
> créées lorsque `NODE_ENV=production` (sauf `SEED_DEMO=true`).

### Sans Docker

Créez la base et activez PostGIS :

```sql
CREATE ROLE parcelys LOGIN PASSWORD 'parcelys';
CREATE DATABASE parcelys OWNER parcelys;
\c parcelys
CREATE EXTENSION IF NOT EXISTS postgis;
```

Puis reprenez à l'étape 2.

---

## Administration et inscriptions

**L'inscription publique est fermée.** Cliquer sur « Créer mon compte » ne suffit
pas : il faut un **code d'invitation** délivré par un administrateur de
l'instance. C'est le mode de fonctionnement d'un service auto-hébergé — vous
décidez qui entre.

### Deux niveaux d'autorité, à ne pas confondre

| | Portée | Pouvoirs |
| --- | --- | --- |
| **Administrateur d'instance** | Toute l'installation | Comptes, invitations, exploitations, journal d'audit, maintenance. **Aucun accès aux parcelles et aux registres** des exploitations dont il n'est pas membre. |
| **Administrateur d'exploitation** (`FarmRole.ADMIN`) | Une exploitation | Parcelles, saisies, membres et paramètres de cette exploitation. |

### Le premier compte

Sur une base vide, la première inscription se fait **sans code** : personne ne
peut encore en délivrer. Ce compte devient automatiquement administrateur de
l'instance. Dès qu'il existe, tout nouveau compte exige une invitation.

Le seed de démonstration crée déjà un tel compte
(`demo@parcelys.local` / `Demo1234!`) : sur une installation semée, allez
directement dans **Administration → Invitations**.

### Délivrer une invitation

Depuis **Administration → Invitations**, ou en ligne de commande :

```bash
npm run admin -- lister                              # administrateurs et codes
npm run admin -- inviter                             # crée sa propre exploitation
npm run admin -- inviter --exploitation <id> --role EMPLOYEE
npm run admin -- inviter --email jean@ferme.fr --jours 7
npm run admin -- promouvoir camille@exemple.fr       # administrateur d'instance
npm run admin -- retrograder camille@exemple.fr
```

Un code a la forme `PRCL-8F3A-KT2M-QWX7` (alphabet sans caractères ambigus, il
se dicte au téléphone). Il porte :

- la **nature du compte** : exploitation, expert agronomique, ou administration ;
- l'**exploitation rejointe** — ou aucune, et son titulaire crée la sienne en
  devenant propriétaire ;
- le **rôle** accordé dans cette exploitation ;
- une **adresse e-mail imposée**, facultative ;
- une **échéance** (14 jours par défaut, 90 au maximum) ;
- éventuellement le **rôle d'administrateur d'instance**.

Il est **à usage unique** et n'est **affiché qu'une seule fois**, à sa création :
seule son empreinte SHA-256 est stockée, comme pour les mots de passe et les
jetons de session. Parcelys ne l'envoie pas par e-mail — transmettez-le
vous-même.

### Gérer les comptes

**Administration → Utilisateurs** permet de suspendre un compte (sessions fermées
immédiatement, connexion refusée, données intactes), de le réactiver, de lever un
verrouillage après échecs de connexion, de valider une adresse e-mail, de fermer
les sessions ouvertes, d'accorder ou retirer le rôle d'administrateur d'instance,
et de supprimer un compte.

Deux garde-fous sont appliqués côté serveur : on ne peut ni se suspendre ou se
déclasser soi-même, ni retirer le **dernier** administrateur — sans quoi
l'instance deviendrait ingérable. Si cela arrive malgré tout,
`npm run admin -- promouvoir <email>` rattrape la situation depuis le serveur.

Supprimer un compte qui est **l'unique propriétaire** d'une exploitation demande
un second geste : l'écran nomme les exploitations concernées et propose soit de
désigner un autre propriétaire, soit de les supprimer avec le compte.

### Les trois natures de compte

| Nature | Espace | Ce qu'elle voit |
| --- | --- | --- |
| **Exploitation** | Une exploitation à elle | Parcelles, cultures, registres, exports |
| **Expert agronomique** | Un portefeuille | Les exploitations qui l'ont missionné, en lecture, plus ses préconisations |
| **Administration** | Aucun des deux | Comptes, invitations, exploitations, experts, journal d'audit, maintenance |

Un compte d'**administration** n'est ni une exploitation ni un expert : il gère
l'instance. Il ne crée pas d'exploitation à l'inscription, n'apparaît dans aucun
décompte de surface, et n'a accès à aucune donnée agronomique — administrer
l'instance n'est pas administrer les données des exploitations.

À distinguer du **rôle d'administrateur d'instance**, qui est un droit et non une
nature : un exploitant peut l'avoir sans cesser d'exploiter, ce qui est le cas de
quiconque installe Parcelys chez lui et du premier compte créé.

### Supprimer une exploitation

**Administration → Exploitations** supprime et rétablit une exploitation. La
suppression est **logique** : `deleted_at` est renseigné, rien n'est effacé. Une
exploitation porte des registres phytosanitaires et des bilans de fertilisation,
que l'exploitant doit conserver et qu'un clic ne doit pas pouvoir détruire. Les
exploitations supprimées restent listées — sans quoi le geste ne pourrait pas se
défaire — et les experts qui les suivaient en perdent l'accès immédiatement.

### Confier des exploitations à un expert

**Administration → Experts** délivre un code d'inscription à un expert, puis lui
confie une ou **plusieurs** exploitations en une fois : un expert en suit autant
qu'on lui en donne. Chaque exploitation concernée en est avertie et peut mettre
fin à la mission elle-même ; l'opération est journalisée, et le journal distingue
un accès décidé par l'administration d'un accès consenti par l'exploitation.

La voie ordinaire reste que l'exploitation délivre son propre code depuis
**Paramètres → Experts agronomiques** : c'est elle qui décide qui lit ses données.

### Mode maintenance

**Administration → Maintenance** coupe l'accès à l'application pour tout le monde
sauf les administrateurs, avec un message personnalisable. Les pages redirigent
vers `/maintenance` et les écritures API répondent `503 MAINTENANCE`. La même
page expose l'état du système (PostgreSQL, PostGIS, taille de la base,
référentiel E-Phy, fournisseurs configurés) et les purges de données périmées.

---

## Configuration

Toutes les variables sont documentées dans [`.env.example`](.env.example) et
validées au démarrage : une configuration incomplète produit un message
d'erreur explicite plutôt qu'une panne silencieuse.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL + PostGIS | — (**requis**) |
| `APP_URL` | URL publique (liens e-mail, contrôle d'origine CSRF) | `http://localhost:3000` |
| `EMAIL_PROVIDER` | `console`, `smtp` ou `resend` | `console` |
| `WEATHER_PROVIDER` | `open-meteo` (sans clé) ou `openweathermap` | `open-meteo` |
| `MAP_TILE_URL` | Fond de carte XYZ | OpenStreetMap |
| `GEOCODER_URL` | Recherche d'adresse | Base Adresse Nationale |
| `EPHY_DATA_URL` | Archive du catalogue E-Phy | — (voir ci-dessous) |
| `UPLOAD_DIR` | Stockage des documents | `./storage/documents` |
| `PASSWORD_HASH_COST` | Coût bcrypt (10–15) | `12` |

### Intégrations externes

Aucune intégration n'est requise pour démarrer, et **aucune n'est simulée** :

- **E-mail** — `console` écrit le message (code de vérification compris) dans les
  logs. Basculez sur `smtp` ou `resend` en production.
- **Météo** — Open-Meteo fonctionne sans clé. Sans réseau, l'interface affiche
  « météo indisponible » plutôt qu'une valeur inventée.
- **E-Phy** — tant qu'aucune synchronisation n'a eu lieu, la recherche de
  produits est vide et l'annonce clairement.

---

## Référentiel phytosanitaire E-Phy

> **Parcelys ne génère jamais de donnée réglementaire.**
> Numéros d'AMM, substances actives, usages, doses et conditions d'emploi
> proviennent exclusivement du catalogue officiel **E-Phy** publié par l'ANSES.
> L'interface affiche systématiquement la source et la date de dernière
> synchronisation.

### Mise en place

1. Récupérez l'URL de l'archive ZIP du jeu de données ouvert
   « E-Phy : catalogue des produits phytopharmaceutiques » sur data.gouv.fr.
2. Renseignez-la dans `.env` :

   ```bash
   EPHY_DATA_URL="https://.../ephy.zip"
   ```

3. Lancez la synchronisation :

   ```bash
   npm run ephy:sync
   ```

Autres modes d'import :

```bash
npm run ephy:sync -- --zip ./ephy.zip     # archive locale
npm run ephy:sync -- --dir ./data/ephy    # dossier déjà décompressé
npm run ephy:sync -- --url https://...    # URL ponctuelle
```

L'import est **idempotent** (mise à jour par numéro d'AMM) et **résilient aux
variations d'intitulés de colonnes** entre éditions : chaque champ est associé à
plusieurs alias, comparés après normalisation. Une colonne absente laisse le
champ vide — elle n'est jamais devinée — et l'import le signale dans son rapport,
consultable dans **Paramètres → Référentiel phytosanitaire**.

### Synchronisation automatique

```cron
# Tous les lundis à 3 h 00
0 3 * * 1 cd /opt/parcelys && /usr/bin/npm run ephy:sync >> /var/log/parcelys-ephy.log 2>&1
```

---

## Déploiement

> **Sur un VPS : [`docs/VPS.md`](docs/VPS.md)** — du serveur nu à
> `https://parcelys.fr` en HTTPS (45 min).
>
> **Sur un Raspberry Pi, chez soi :
> [`docs/RASPBERRY-PI.md`](docs/RASPBERRY-PI.md)** — avec un tunnel Cloudflare,
> donc sans IP publique ni port ouvert. C'est la marche à suivre pour une
> connexion Starlink, 4G ou toute autre liaison derrière un CGNAT.
>
> **Choix d'hébergement, domaine, sauvegardes, APK :**
> [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

### Où héberger Parcelys ?

Il faut une machine où l'on est administrateur : **VPS, serveur dédié ou
Raspberry Pi**. Un hébergement mutualisé de type cPanel ne convient pas, et ce
n'est pas une question de puissance — Parcelys a besoin de l'extension
**PostGIS** dans PostgreSQL, dont l'installation demande les droits
superutilisateur sur le serveur de base, et d'un **processus Node.js
permanent**. Les superficies inscrites aux registres sont calculées par
PostGIS ; s'en passer reviendrait à y porter des chiffres approximatifs.

Un mutualisé reste utile pour ce qu'il fait bien : héberger la zone DNS et les
boîtes e-mail du domaine, pendant que l'application vit sur un VPS ou sur le
Pi. Le détail des trois options viables est dans
[`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md#où-héberger-parcelys-).

### Docker Compose (recommandé)

```bash
cp .env.example .env
# Renseignez APP_URL, EMAIL_*, et EPHY_DATA_URL

docker compose up -d
```

Les migrations sont appliquées automatiquement au démarrage du conteneur.
Documents et archives E-Phy sont conservés dans le volume `parcelys-data`.

### Sans Docker

```bash
npm ci
npm run db:deploy       # applique les migrations
npm run build           # compile et complète la sortie autonome
npm run preflight       # doit afficher « Instance prête »
npm run start
```

`npm run build` copie aussi `.next/static` et `public/` dans la sortie
autonome : Next ne le fait pas, et le serveur répondrait 404 sur toutes les
feuilles de style — la page s'afficherait sans mise en forme, sans qu'aucune
erreur ne le signale.

`npm run preflight` vérifie configuration, base, PostGIS, migrations et
dossiers avant d'ouvrir le service. Placez-le en `ExecStartPre` de l'unité
systemd : l'instance refuse alors de démarrer plutôt que de servir une
application qui semble saine et tombera au premier utilisateur.

Placez l'application derrière un reverse proxy en HTTPS (nginx, Caddy,
Traefik) : les cookies de session passent en `Secure` dès que
`NODE_ENV=production`. `GET /api/health` renvoie `200` quand la base et
PostGIS répondent, `503` sinon — c'est l'adresse à donner à un superviseur.

---

## Déploiement sur Raspberry Pi

Testé sur Raspberry Pi 4/5 sous Raspberry Pi OS 64 bits.

```bash
# PostgreSQL + PostGIS
sudo apt update
sudo apt install -y postgresql postgresql-postgis

sudo -u postgres psql <<'SQL'
CREATE ROLE parcelys LOGIN PASSWORD 'choisissez-un-mot-de-passe';
CREATE DATABASE parcelys OWNER parcelys;
\c parcelys
CREATE EXTENSION IF NOT EXISTS postgis;
SQL

# Application
git clone <url-du-dépôt> /opt/parcelys
cd /opt/parcelys
cp .env.example .env   # renseignez DATABASE_URL et APP_URL
npm ci
npm run build
npm run db:deploy
npm run start
```

Quelques points d'attention :

- **Hachage des mots de passe** — Argon2id est utilisé si le paquet natif
  optionnel `@node-rs/argon2` s'installe ; sinon bcrypt (implémentation pure JS,
  donc portable, y compris en 32 bits). Sur un Pi, `PASSWORD_HASH_COST=11`
  offre un bon compromis entre sécurité et temps de connexion.
- **Docker** — l'image est multi-architecture et fonctionne en arm64.
- **Service systemd** :

  ```ini
  # /etc/systemd/system/parcelys.service
  [Unit]
  Description=Parcelys
  After=network.target postgresql.service

  [Service]
  Type=simple
  User=pi
  WorkingDirectory=/opt/parcelys
  EnvironmentFile=/opt/parcelys/.env
  ExecStart=/usr/bin/npm run start
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```

---

## Mises à jour

Renseignez le dépôt à surveiller dans le `.env` :

```ini
UPDATE_REPOSITORY="kryptonproject-crypto/parcelys"
```

« Administration → Maintenance » affiche alors la version installée, la
dernière version publiée et ses notes, avec un bouton « Vérifier maintenant ».
L'application de terrain signale de son côté qu'un nouvel APK est disponible,
avec son lien de téléchargement.

**Rien ne s'installe automatiquement.** Une mise à jour touche la base d'un
registre réglementaire : elle se fait à un moment choisi, sauvegarde faite, par
`git pull && npm ci && npm run db:deploy && npm run build`. Sans
`UPDATE_REPOSITORY`, aucune requête ne sort de l'instance — une machine isolée
du réseau le reste.

---

## Application mobile (Android)

Une application de terrain, empaquetée en APK avec Capacitor, complète
l'application web : [`mobile/README.md`](mobile/README.md) détaille son
fonctionnement et la construction de l'APK.

Elle ne reprend que ce qui se fait dans un champ — relever une parcelle au GPS,
saisir un traitement, un apport ou un travail — et le fait **sans réseau**, ce
qui est la situation ordinaire au milieu d'une parcelle.

```bash
cd mobile
npm install
npm run dev     # essai dans un navigateur, le GPS fonctionne
npm run apk     # APK de test (JDK 21 + Android SDK requis)
```

### Comment le hors ligne tient debout

Chaque saisie part dans une file d'attente locale (IndexedDB), réseau ou non.
À la synchronisation, `POST /api/sync` **rejoue les routes existantes de
l'API** — `POST /api/parcels`, `.../phytosanitary`… — plutôt que de
réimplémenter les règles métier : le calcul de superficie par PostGIS, le bilan
NPK, les contrôles de surface traitée et le journal d'audit sont donc
strictement les mêmes qu'en ligne.

Chaque opération porte un identifiant produit par l'appareil, transmis en
`Idempotency-Key`. Un lot renvoyé après une réponse perdue **ne crée aucun
doublon** : le serveur renvoie la réponse initiale. Une opération refusée reste
dans la file, avec son motif affiché, jusqu'à correction ou suppression — rien
ne disparaît en silence d'un registre réglementaire.

### Ce que l'application n'invente pas

La superficie affichée pendant le relevé est une **estimation** calculée sur le
téléphone ; celle qui fait foi est calculée par PostGIS à l'enregistrement, et
l'écran le dit. Hors ligne, les produits phytosanitaires proposés sont ceux que
l'exploitation a **réellement employés** depuis douze mois, avec leur AMM
d'origine ; la recherche dans le catalogue officiel E-Phy reste en ligne.

### Configuration côté serveur

Seule `MOBILE_APP_ORIGINS` est concernée — elle contient déjà les origines des
WebView Capacitor par défaut. L'instance doit être servie en **HTTPS** :
Android bloque le trafic en clair.

---

## Maintenance

```bash
npm run maintenance
```

Purge les sessions expirées, les codes de vérification, les jetons de
réinitialisation, les compteurs de limitation de débit, et applique la durée de
conservation des journaux (365 jours par défaut, `AUDIT_RETENTION_DAYS`).

À planifier quotidiennement :

```cron
30 3 * * * cd /opt/parcelys && /usr/bin/npm run maintenance >> /var/log/parcelys-maintenance.log 2>&1
```

Les mêmes purges sont disponibles à la demande dans **Administration →
Maintenance**, qui expose aussi le mode maintenance et l'état du système. Pour
les opérations sur les comptes depuis le serveur (promouvoir un administrateur,
délivrer un code sans passer par l'interface), voir
[Administration et inscriptions](#administration-et-inscriptions) :

```bash
npm run admin -- lister
```

---

## Tests

```bash
npm run build     # requis : les tests d'API démarrent le serveur compilé
npm test
```

**191 tests** répartis en dix suites :

| Suite | Portée |
| --- | --- |
| `security-isolation` | Un utilisateur de l'exploitation A ne peut atteindre aucune donnée de l'exploitation B — lecture, écriture, suppression, listes, exports, documents, changement d'exploitation. |
| `auth` | Inscription (amorçage du premier compte, refus sans code), connexion, mauvais mot de passe, verrouillage anti-bruteforce, vérification d'e-mail (code incorrect, expiré, trop de tentatives, renvoi), réinitialisation, sessions, CSRF. |
| `admin` | Administration réservée aux administrateurs d'instance, codes d'invitation (empreinte seule, usage unique, expiration, révocation, restriction d'adresse, rattachement et rôle), suspension et réactivation de comptes, protection du dernier administrateur, mode maintenance, purges. |
| `mobile-sync` | Authentification par jeton Bearer sans cookie, CORS et pré-vol des origines Capacitor, CSRF toujours appliquée dès qu'un cookie est présent, idempotence des écritures (rejeu, clé réutilisée, échec non mémorisé, isolation entre appareils), instantané hors ligne, rejeu d'un lot de saisies, refus indépendants, respect des rôles, relève des changements. |
| `parcels` | Création, calcul de superficie PostGIS, géométrie invalide, recouvrement, versionnement, suppression logique, permissions par rôle, filtres. |
| `agronomy` | Cultures, apports (`dose × surface`, bilan NPK), traitements phytosanitaires, travaux, historique, exports PDF/Excel/CSV. |
| `ephy-import` | Parsing des CSV officiels (Windows-1252, `;`), correspondance des colonnes, idempotence, colonnes manquantes, recherche, provenance. |
| `rate-limit` | Fenêtre glissante, isolation par clé, expiration, persistance, purge. |
| `units` | Calculs de fertilisation, aire géodésique, mots de passe, jetons, validation, campagne culturale. |
| `pages` | Rendu serveur des pages avec une session réelle, section d'administration visible des seuls administrateurs, redirections d'authentification, en-têtes de sécurité, origines de tuiles autorisées par la CSP et application du thème sans clignotement. |

Les tests d'API et de pages démarrent un vrai serveur Next et passent par la
chaîne HTTP complète (cookies, CSRF, permissions, rendu serveur). Ils s'exécutent sur une base réelle —
définissez `TEST_DATABASE_URL` pour utiliser une base dédiée :

```bash
TEST_DATABASE_URL="postgresql://parcelys:parcelys@localhost:5432/parcelys_test" npm test
```

### Mise en page sur téléphone

Un débordement horizontal ne se voit ni sur un écran de bureau, ni dans les
tests d'API — qui ne mesurent rien. Un contrôle dédié ouvre chaque page dans un
navigateur à 390 px et signale l'élément fautif quand il y en a un :

```bash
npm run build && npm start          # dans un terminal
node scripts/check-mobile-layout.mjs http://127.0.0.1:3000
```

---

## Architecture

```
parcelys/
├── prisma/
│   ├── schema.prisma           # 24 modèles, géométrie PostGIS
│   ├── migrations/             # dont index GIST et index partiels
│   └── seed.ts                 # référentiel global + exploitation de démo
│
├── scripts/
│   ├── ephy-sync.ts            # import du catalogue officiel
│   ├── admin.ts                # administration en ligne de commande
│   ├── maintenance.ts          # purges périodiques
│   └── check-mobile-layout.mjs # contrôle de mise en page à 390 px
│
├── src/
│   ├── app/
│   │   ├── (auth)/             # connexion, inscription, vérification, mot de passe
│   │   ├── (app)/              # dashboard, parcelles, cultures, apports,
│   │   │                       # phytosanitaire, météo, registres, historique,
│   │   │                       # documents, exports, profil, paramètres
│   │   ├── (admin)/            # administration de l'instance
│   │   └── api/                # routes REST, dont /api/sync et /api/admin/*
│   │
│   ├── components/
│   │   ├── map/                # carte Leaflet (affichage et dessin)
│   │   ├── forms/              # formulaires de saisie et recherche E-Phy
│   │   ├── layout/             # sidebar, navigation mobile
│   │   └── ui/                 # bibliothèque de composants
│   │
│   └── lib/
│       ├── auth/               # sessions, mots de passe, RBAC, débit, jetons
│       ├── api/                # enrobage des routes, mapping d'erreurs
│       ├── geo/                # PostGIS, aire géodésique, géocodage
│       ├── ephy/               # parseur, import, recherche
│       ├── weather/            # abstraction fournisseur + implémentations
│       ├── email/              # abstraction fournisseur + gabarits
│       ├── exports/            # jeux de données et rendus PDF/XLSX/CSV
│       ├── admin/              # comptes, réglages d'instance, statistiques
│       ├── services/           # historique, tableau de bord, fertilisation, mobile
│       └── storage/            # documents (validation et écriture)
│
├── mobile/                     # application de terrain (Vite + Capacitor)
│   ├── src/screens/            # connexion, parcelles, relevé GPS, saisies, file
│   ├── src/lib/                # API, IndexedDB, synchronisation, géodésie, GPS
│   └── android/                # projet Android, prêt à produire l'APK
│
└── tests/
```

### Principes

- **Le serveur fait autorité.** Superficies, quantités totales, éléments
  fertilisants et caractéristiques produit sont calculés ou repris côté serveur ;
  une valeur envoyée par le client est ignorée.
- **Les intégrations externes sont abstraites.** Météo et e-mail passent par une
  interface : changer de fournisseur ne touche pas le code appelant.
- **Rien n'est inventé.** Une donnée absente reste vide et l'interface le dit.

---

## Sécurité

| Mesure | Mise en œuvre |
| --- | --- |
| Hachage des mots de passe | Argon2id si disponible, sinon bcrypt ; empreintes auto-descriptives |
| Sessions | Jeton aléatoire de 32 octets, stocké **haché** ; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production |
| Expiration | 14 jours maximum, 7 jours d'inactivité, révocation immédiate |
| Déconnexion globale | Révocation de toutes les sessions, depuis le profil |
| Bruteforce | Limitation de débit par IP **et** par compte + verrouillage temporaire après 8 échecs |
| Limitation de débit | Persistée en base (résiste au redémarrage et au multi-instance) |
| CSRF | `SameSite=Lax` + vérification d'origine sur toute requête mutante |
| Injection SQL | Prisma et requêtes paramétrées, y compris pour PostGIS |
| XSS | Échappement React, CSP stricte, en-têtes de sécurité |
| Validation | Zod sur toutes les entrées, avec erreurs par champ |
| Permissions | Vérifiées côté serveur à chaque route, jamais seulement en interface |
| Isolation | Chaque requête est contrainte à l'exploitation de l'utilisateur ; un identifiant étranger renvoie **404** et non 403 |
| Fichiers | Extension, taille, type MIME **et signature binaire** ; nom de stockage aléatoire, pas de traversée de répertoire |
| Journalisation | Journal d'audit des actions sensibles (connexion, échecs, exports, suppressions, opérations d'administration) |
| Inscriptions | Fermées : un code d'invitation à usage unique, délivré par un administrateur, est exigé. Stocké **haché**, jamais réaffiché, limité en débit contre le balayage |
| Administration | Autorité distincte des rôles d'exploitation ; vérifiée à chaque page et à chaque route `/api/admin/*`. Impossible de retirer le dernier administrateur ou de se déclasser soi-même |
| Suspension | Un compte suspendu voit ses sessions révoquées immédiatement et sa reconnexion refusée, après vérification du mot de passe pour ne pas révéler l'existence du compte |
| Application mobile | Jeton `Authorization: Bearer` et **aucun cookie** : la CSRF est structurellement impossible, et la vérification d'origine reste appliquée dès qu'un cookie est présent. CORS limité à une liste fermée d'origines, sans `Allow-Credentials` |
| Rejeu des saisies | Clé d'idempotence liée à l'empreinte du jeton de session : deux appareils ne peuvent pas se lire mutuellement, et un rejeu ne duplique aucun enregistrement réglementaire |
| Adresse du visiteur | Lue dans l'en-tête écrit par le proxy de confiance, **dernière entrée** de `X-Forwarded-For` — celle qu'un visiteur ne peut pas amorcer. `CLIENT_IP_HEADER=cf-connecting-ip` derrière Cloudflare |

Les en-têtes de sécurité (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) sont définis dans [`next.config.ts`](next.config.ts).

### Dépendances

`npm audit --omit=dev` tourne à chaque intégration continue. Trois avis
subsistent aujourd'hui, tous **hors du chemin d'exécution servi** — ils sont
listés ici plutôt que passés sous silence :

| Paquet | Par | Pourquoi ce n'est pas une surface d'attaque ici |
| --- | --- | --- |
| `deepmerge-ts` | `prisma` → `@prisma/config` | Outil en ligne de commande. Ne s'exécute que pendant `db:deploy` et `prisma generate`, sur des fichiers de configuration que vous maîtrisez. |
| `postcss` | copie interne de `next` | Compilation des feuilles de style. Ne s'exécute pas au service d'une requête. |
| `uuid` | `exceljs` | La faille exige de passer un `buf` à `uuid` v3/v5/v6. Parcelys n'appelle jamais `uuid` directement. |

Cette liste est à revérifier à chaque mise à jour : un avis peut passer de
l'outillage au code servi.

---

## RGPD

- **Consentement** — CGU et politique de confidentialité acceptées explicitement
  à l'inscription, avec horodatage.
- **Droit d'accès et portabilité** — export JSON complet depuis le profil.
- **Droit à l'effacement** — suppression du compte, avec suppression des
  exploitations dont l'utilisateur est le seul membre ; les exploitations
  partagées sont conservées pour ne pas détruire les registres de tiers.
- **Minimisation** — durées de conservation appliquées par `npm run maintenance`.
- **Cookies** — un seul cookie, strictement nécessaire (session). Aucune mesure
  d'audience, donc pas de bandeau de consentement.

Les pages [`/cgu`](src/app/cgu/page.tsx) et
[`/confidentialite`](src/app/confidentialite/page.tsx) contiennent une trame
fidèle aux traitements réellement effectués ; **elle doit être complétée
(identité de l'éditeur, hébergeur) et validée juridiquement avant toute mise en
production.**

---

## API

Documentation complète : [`docs/API.md`](docs/API.md).

Aperçu :

| Méthode | Route | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Inscription (code d'invitation exigé) |
| `POST` | `/api/auth/invitation/check` | Vérifie un code sans le consommer |
| `POST` | `/api/auth/login` | Connexion |
| `POST` | `/api/auth/verify-email` | Vérification par code |
| `GET` | `/api/admin/users` | Comptes de l'instance (administrateur) |
| `PATCH/DELETE` | `/api/admin/users/:id` | Suspendre, réactiver, déverrouiller, supprimer |
| `GET/POST` | `/api/admin/invitations` | Lister et délivrer des codes |
| `DELETE` | `/api/admin/invitations/:id` | Révoquer un code |
| `GET/POST` | `/api/admin/maintenance` | Mode maintenance |
| `POST` | `/api/admin/cleanup` | Purges de données périmées |
| `GET` | `/api/mobile/bootstrap` | Instantané complet pour le cache hors ligne |
| `POST` | `/api/sync` | Rejeu d'un lot de saisies faites hors réseau |
| `GET` | `/api/sync?since=` | Changements depuis la dernière relève |
| `GET` | `/api/parcels` | Liste des parcelles |
| `POST` | `/api/parcels` | Création (géométrie GeoJSON) |
| `GET/PUT/DELETE` | `/api/parcels/:id` | Fiche, modification, suppression |
| `GET/POST` | `/api/parcels/:id/crops` | Cultures |
| `GET/POST` | `/api/parcels/:id/fertilization` | Apports + bilan NPK |
| `GET/POST` | `/api/parcels/:id/phytosanitary` | Traitements |
| `GET` | `/api/parcels/:id/history` | Historique |
| `GET` | `/api/phytosanitary/products` | Recherche E-Phy |
| `GET` | `/api/weather` | Météo locale |
| `GET` | `/api/exports` | Exports PDF / Excel / CSV |

---

## Évolutions prévues

L'architecture est préparée pour : import/export RPG, imagerie satellite et
NDVI, analyses de sol, bilan azoté et plan prévisionnel de fumure, gestion du
matériel et des stocks, ISOXML, application mobile.

---

## Licence

À définir par l'éditeur du service.
