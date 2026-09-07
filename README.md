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
- [Configuration](#configuration)
- [Référentiel phytosanitaire E-Phy](#référentiel-phytosanitaire-e-phy)
- [Déploiement](#déploiement)
- [Déploiement sur Raspberry Pi](#déploiement-sur-raspberry-pi)
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

Le seed crée un compte de démonstration :

```
demo@parcelys.local / Demo1234!
```

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
npm run build
npm run db:deploy       # applique les migrations
npm run start
```

Placez l'application derrière un reverse proxy en HTTPS (nginx, Caddy,
Traefik) : les cookies de session passent en `Secure` dès que
`NODE_ENV=production`.

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

---

## Tests

```bash
npm run build     # requis : les tests d'API démarrent le serveur compilé
npm test
```

**140 tests** répartis en huit suites :

| Suite | Portée |
| --- | --- |
| `security-isolation` | Un utilisateur de l'exploitation A ne peut atteindre aucune donnée de l'exploitation B — lecture, écriture, suppression, listes, exports, documents, changement d'exploitation. |
| `auth` | Inscription, connexion, mauvais mot de passe, verrouillage anti-bruteforce, vérification d'e-mail (code incorrect, expiré, trop de tentatives, renvoi), réinitialisation, sessions, CSRF. |
| `parcels` | Création, calcul de superficie PostGIS, géométrie invalide, recouvrement, versionnement, suppression logique, permissions par rôle, filtres. |
| `agronomy` | Cultures, apports (`dose × surface`, bilan NPK), traitements phytosanitaires, travaux, historique, exports PDF/Excel/CSV. |
| `ephy-import` | Parsing des CSV officiels (Windows-1252, `;`), correspondance des colonnes, idempotence, colonnes manquantes, recherche, provenance. |
| `rate-limit` | Fenêtre glissante, isolation par clé, expiration, persistance, purge. |
| `units` | Calculs de fertilisation, aire géodésique, mots de passe, jetons, validation, campagne culturale. |
| `pages` | Rendu serveur des 30 pages avec une session réelle, redirections d'authentification, en-têtes de sécurité, origines de tuiles autorisées par la CSP et application du thème sans clignotement. |

Les tests d'API et de pages démarrent un vrai serveur Next et passent par la
chaîne HTTP complète (cookies, CSRF, permissions, rendu serveur). Ils s'exécutent sur une base réelle —
définissez `TEST_DATABASE_URL` pour utiliser une base dédiée :

```bash
TEST_DATABASE_URL="postgresql://parcelys:parcelys@localhost:5432/parcelys_test" npm test
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
│   └── maintenance.ts          # purges périodiques
│
├── src/
│   ├── app/
│   │   ├── (auth)/             # connexion, inscription, vérification, mot de passe
│   │   ├── (app)/              # dashboard, parcelles, cultures, apports,
│   │   │                       # phytosanitaire, météo, registres, historique,
│   │   │                       # documents, exports, profil, paramètres
│   │   └── api/                # routes REST
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
│       ├── services/           # historique, tableau de bord, fertilisation
│       └── storage/            # documents (validation et écriture)
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
| Journalisation | Journal d'audit des actions sensibles (connexion, échecs, exports, suppressions) |

Les en-têtes de sécurité (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) sont définis dans [`next.config.ts`](next.config.ts).

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
| `POST` | `/api/auth/register` | Inscription |
| `POST` | `/api/auth/login` | Connexion |
| `POST` | `/api/auth/verify-email` | Vérification par code |
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
