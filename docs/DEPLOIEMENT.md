# Déploiement de Parcelys

Ce guide couvre la question de l'hébergement, le domaine, la mise à jour et la
sauvegarde.

> **Vous installez sur un VPS ?** Suivez plutôt
> **[`VPS.md`](VPS.md)** : la marche à suivre y est complète et ordonnée, du
> serveur nu à `https://parcelys.fr` en HTTPS, avec le durcissement SSH, le
> pare-feu, le service systemd et les sauvegardes. Le présent document reste la
> référence pour comprendre les choix d'hébergement.

- [Où héberger Parcelys ?](#où-héberger-parcelys-)
- [Le domaine parcelys.fr](#le-domaine-parcelysfr)
- [Installation sur un VPS ou un Raspberry Pi](#installation-sur-un-vps-ou-un-raspberry-pi)
- [Reverse proxy et HTTPS](#reverse-proxy-et-https)
- [Mise à jour](#mise-à-jour)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [APK Android](#apk-android)

---

## Où héberger Parcelys ?

La réponse courte : **il faut une machine où l'on est administrateur** — VPS,
serveur dédié, Raspberry Pi. Un hébergement mutualisé de type cPanel ne
convient pas, et ce n'est pas une question de puissance.

### Ce que Parcelys exige du serveur

| Exigence | Pourquoi | Mutualisé ? |
| --- | --- | --- |
| **PostgreSQL avec l'extension PostGIS** | Les superficies sont calculées par `ST_Area(geom::geography)`, pas par le navigateur. C'est ce qui fait foi. | Installer une extension PostgreSQL demande les droits superutilisateur sur le serveur de base. Un hébergement mutualisé ne les accorde pas. |
| **Un processus Node.js permanent** | Next.js en mode `standalone` est un serveur, pas un dossier de fichiers PHP. Il doit rester allumé, être relancé s'il tombe, et écouter un port. | Certains mutualisés proposent Node via Passenger, avec des limites de mémoire et de durée d'exécution mal adaptées à un rendu serveur permanent. |
| **Un disque inscriptible et persistant** | Les documents joints aux parcelles et l'archive E-Phy sont écrits sur disque. | Généralement possible, mais rarement avec des quotas confortables. |
| **Des tâches planifiées** | Synchronisation E-Phy, purge des sessions expirées. | Souvent possible (cron), ce n'est pas le point bloquant. |

**PostGIS est le point de blocage réel.** Sans lui, aucune superficie, aucune
détection de chevauchement, aucun export cartographique — c'est-à-dire plus de
logiciel parcellaire du tout. Retirer PostGIS pour calculer les surfaces en
JavaScript reviendrait à inscrire dans un registre réglementaire des chiffres
approximatifs : ce n'est pas une option.

### Les trois options qui marchent

**1. Raspberry Pi 4 ou 5 (8 Go), chez soi.** C'est le choix le plus économique
et il tient très bien la charge d'une exploitation : quelques comptes, quelques
milliers de parcelles. Il faut une IP fixe ou un DNS dynamique, et ouvrir le
port 443 sur la box. Prévoyez un SSD USB plutôt qu'une carte SD — PostgreSQL
use les cartes SD, et une base corrompue un jour de contrôle serait fâcheuse.

**2. Un VPS (Hetzner, Scaleway, OVH, Infomaniak…).** Comptez 2 vCPU et 4 Go de
mémoire, autour de 5 à 10 € par mois. C'est l'option la plus simple à
sécuriser et à sauvegarder, et la seule qui garantisse une disponibilité
correcte si des experts agronomiques extérieurs consultent l'instance.

**3. Un hébergement Node + une base PostgreSQL managée qui propose PostGIS.**
Neon, Supabase et Scaleway proposent PostGIS sur leurs offres PostgreSQL
managées ; l'application peut alors tourner sur n'importe quel hébergeur
capable de faire vivre un processus Node (Railway, Fly.io, Clever Cloud, ou un
VPS minimal). Vérifiez que `CREATE EXTENSION postgis` est autorisé avant de
vous engager.

### Et O2switch ?

O2switch est un hébergement mutualisé cPanel. Avant d'écarter la piste,
posez-leur les trois questions qui décident :

1. Puis-je créer une base **PostgreSQL** (et non MySQL/MariaDB) ?
2. Puis-je y activer l'extension **PostGIS** (`CREATE EXTENSION postgis`) ?
3. Puis-je faire tourner un **processus Node.js 20 permanent** avec le rendu
   serveur de Next.js ?

Si l'une des trois réponses est non — et sur un mutualisé, la deuxième l'est
presque toujours —, Parcelys ne peut pas y être hébergé. En revanche, O2switch
reste parfaitement utile pour ce qu'un mutualisé fait bien : **héberger votre
zone DNS et vos boîtes e-mail `@parcelys.fr`**, pendant que l'application vit
sur un VPS ou sur le Pi. C'est même une bonne répartition : le SMTP d'un
hébergeur établi passe mieux les filtres anti-spam que celui d'une IP
résidentielle.

---

## Le domaine parcelys.fr

Trois enregistrements suffisent. Remplacez `203.0.113.10` par l'adresse IP
publique du serveur.

| Type | Nom | Valeur | Rôle |
| --- | --- | --- | --- |
| `A` | `@` | `203.0.113.10` | `parcelys.fr` — l'application et son API |
| `A` | `www` | `203.0.113.10` | redirigé vers `parcelys.fr` |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | seul Let's Encrypt peut émettre un certificat |

Si le serveur est chez vous derrière une IP dynamique, remplacez les `A` par un
`CNAME` vers votre fournisseur de DNS dynamique.

### Faut-il un sous-domaine pour l'API ?

Non, et c'est délibéré. L'API de Parcelys est servie par la même application,
sous `/api`, sur la même origine que l'interface :

```
https://parcelys.fr/            interface web
https://parcelys.fr/api/…       API (web et application mobile)
```

Un `api.parcelys.fr` séparé n'apporterait rien ici et coûterait cher : le
cookie de session est `HttpOnly` et `SameSite=Lax`, donc lié à l'origine ; le
séparer imposerait du CORS avec identifiants entre deux origines, un
assouplissement de `SameSite`, et une surface d'attaque CSRF nouvelle. Comme
l'application mobile s'authentifie par jeton `Authorization: Bearer` et non par
cookie, elle n'a aucun besoin d'une origine dédiée.

Un sous-domaine devient justifié le jour où l'API est servie par un autre
processus que l'interface. Ce n'est pas le cas aujourd'hui.

### Configuration correspondante

```ini
# .env
APP_URL="https://parcelys.fr"
EMAIL_FROM="Parcelys <no-reply@parcelys.fr>"
NODE_ENV=production
```

`APP_URL` sert à trois choses : les liens des e-mails, le contrôle d'origine
CSRF, et le `Secure` des cookies. Une valeur qui ne correspond pas exactement à
l'adresse servie fait échouer les connexions depuis un navigateur, sans message
clair. Vérifiez-la en premier si quelque chose ne fonctionne pas après une mise
en ligne.

---

## Installation sur un VPS ou un Raspberry Pi

La marche à suivre détaillée est dans **[`VPS.md`](VPS.md)** — durcissement
SSH, pare-feu, PostgreSQL, service systemd, nginx et HTTPS, pas à pas. En
résumé :

```bash
# PostgreSQL + PostGIS
sudo apt install -y postgresql postgresql-postgis nginx
sudo -u postgres psql -c "CREATE ROLE parcelys LOGIN PASSWORD 'un-mot-de-passe-solide';"
sudo -u postgres psql -c "CREATE DATABASE parcelys OWNER parcelys;"
sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Application
sudo git clone https://github.com/kryptonproject-crypto/parcelys.git /opt/parcelys
cd /opt/parcelys
cp .env.example .env
$EDITOR .env              # DATABASE_URL, APP_URL, EMAIL_*, UPDATE_REPOSITORY
npm ci
npm run db:deploy         # applique les migrations
npm run build             # compile ET complète la sortie autonome
npm run preflight         # doit afficher « Instance prête »
```

`npm run build` ne se contente pas de compiler : il copie aussi `.next/static`
et `public/` dans la sortie autonome. Next ne le fait pas, et le serveur
répondrait 404 sur toutes les feuilles de style — la page s'afficherait sans
mise en forme, sans qu'aucune erreur ne le signale.

### Service systemd

```ini
# /etc/systemd/system/parcelys.service
[Unit]
Description=Parcelys
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=parcelys
Group=parcelys
WorkingDirectory=/opt/parcelys
EnvironmentFile=/opt/parcelys/.env
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1

# Refuse de démarrer sur une instance mal configurée, plutôt que de servir une
# application qui semble saine et tombera au premier utilisateur.
ExecStartPre=/usr/bin/npm run preflight
ExecStart=/usr/bin/npm run start

Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/parcelys /opt/parcelys/.next

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parcelys
sudo systemctl status parcelys
curl -s http://127.0.0.1:3000/api/health
```

### Le premier compte

L'inscription publique est fermée. Le tout premier compte d'une base vide fait
exception : il s'inscrit sans code et devient administrateur de l'instance.
Rendez-vous sur `https://parcelys.fr/inscription` et créez-le. Ensuite, tout
nouveau compte exige un code délivré depuis « Administration → Invitations ».

Si l'accès administrateur est perdu, il se rétablit depuis le serveur :

```bash
cd /opt/parcelys && npm run admin -- promouvoir votre@adresse.fr
```

---

## Reverse proxy et HTTPS

```nginx
# /etc/nginx/sites-available/parcelys.fr
server {
    listen 80;
    listen [::]:80;
    server_name parcelys.fr www.parcelys.fr;
    return 301 https://parcelys.fr$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name parcelys.fr;

    ssl_certificate     /etc/letsencrypt/live/parcelys.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/parcelys.fr/privkey.pem;

    # Photos de parcelles et pièces jointes : la limite doit couvrir
    # UPLOAD_MAX_BYTES, sinon nginx rejette avant que l'application ne réponde.
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        # Un export PDF sur une grande exploitation peut dépasser la minute.
        proxy_read_timeout 180s;
    }
}
```

`X-Forwarded-For` n'est pas décoratif : c'est de là que vient l'adresse IP
inscrite au journal d'audit et utilisée par la limitation de débit. Sans lui,
toutes les requêtes semblent venir de `127.0.0.1` et une seule connexion
malveillante bloquerait tout le monde.

```bash
sudo ln -s /etc/nginx/sites-available/parcelys.fr /etc/nginx/sites-enabled/
sudo certbot --nginx -d parcelys.fr -d www.parcelys.fr
sudo nginx -t && sudo systemctl reload nginx
```

---

## Mise à jour

Renseignez `UPDATE_REPOSITORY` dans le `.env` :

```ini
UPDATE_REPOSITORY="kryptonproject-crypto/parcelys"
```

« Administration → Maintenance » affiche alors la version installée, la
dernière version publiée, et un bouton « Vérifier maintenant ». L'application
de terrain signale de son côté qu'un nouvel APK est disponible.

**Rien ne s'installe automatiquement**, et c'est voulu : une mise à jour touche
la base de données d'un registre réglementaire. Elle se fait à un moment choisi,
sauvegarde faite.

```bash
cd /opt/parcelys
sudo systemctl stop parcelys

pg_dump -U parcelys parcelys | gzip > "/var/backups/parcelys-$(date +%F).sql.gz"

git pull
npm ci
npm run db:deploy
npm run build

sudo systemctl start parcelys
```

Sans `UPDATE_REPOSITORY`, aucune requête ne sort de l'instance : une machine
isolée du réseau le reste.

---

## Sauvegarde et restauration

Trois choses à sauvegarder, et une seule est vraiment irremplaçable.

| Quoi | Où | Irremplaçable ? |
| --- | --- | --- |
| Base de données | PostgreSQL | **Oui** — parcellaire, registres, préconisations |
| Documents joints | `UPLOAD_DIR` (`./storage/documents`) | **Oui** — factures, analyses, photos |
| Archive E-Phy | `EPHY_DATA_DIR` (`./data/ephy`) | Non — retéléchargeable |

```bash
#!/bin/bash
# /etc/cron.daily/parcelys-backup
set -euo pipefail
DEST=/var/backups/parcelys
mkdir -p "$DEST"
STAMP=$(date +%F)

pg_dump -U parcelys parcelys | gzip > "$DEST/base-$STAMP.sql.gz"
tar czf "$DEST/documents-$STAMP.tar.gz" -C /opt/parcelys storage

# Deux semaines d'historique sur place ; copiez-les ailleurs.
find "$DEST" -name '*.gz' -mtime +14 -delete
```

Une sauvegarde qui reste sur la même machine ne protège de rien : recopiez-la
sur un autre disque, ou chez un hébergeur tiers. Et **essayez la restauration
au moins une fois** — une sauvegarde jamais restaurée n'est pas une sauvegarde.

```bash
# Restauration
sudo systemctl stop parcelys
sudo -u postgres dropdb parcelys
sudo -u postgres createdb -O parcelys parcelys
sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
gunzip -c /var/backups/parcelys/base-2027-03-01.sql.gz | psql -U parcelys parcelys
tar xzf /var/backups/parcelys/documents-2027-03-01.tar.gz -C /opt/parcelys
sudo systemctl start parcelys
```

### Tâches planifiées

```cron
# Catalogue E-Phy : le lundi à 3 h
0 3 * * 1 cd /opt/parcelys && /usr/bin/npm run ephy:sync >> /var/log/parcelys-ephy.log 2>&1

# Purge des sessions expirées et des compteurs de limitation, chaque nuit
30 3 * * * cd /opt/parcelys && /usr/bin/npm run maintenance >> /var/log/parcelys.log 2>&1
```

---

## APK Android

Le workflow `.github/workflows/apk.yml` compile l'application de terrain.

**Publier une version.** Une étiquette `v…` déclenche la compilation et joint
l'APK à la publication GitHub — d'où l'instance et l'application le proposent
ensuite au téléchargement :

```bash
npm version 1.1.0 --no-git-tag-version   # à la racine
git commit -am "Version 1.1.0"
git tag v1.1.0
git push origin main --tags
```

**Essayer sans publier.** Depuis l'onglet « Actions », lancez « APK Android »
manuellement : l'APK est déposé comme artefact de la compilation, avec son
empreinte SHA-256.

### Signature

Sans clé de signature, le workflow produit un APK non signé : utilisable pour
un essai, mais qu'Android refusera d'installer tel quel. Pour des APK
installables, créez une clé **une fois pour toutes** et gardez-la
précieusement — la perdre empêcherait toute mise à jour des installations
existantes, qui devraient être désinstallées puis réinstallées.

```bash
keytool -genkeypair -v -keystore parcelys.jks -alias parcelys \
        -keyalg RSA -keysize 4096 -validity 10000

base64 -w0 parcelys.jks   # à copier dans le secret GitHub
```

Ajoutez ensuite quatre secrets au dépôt (Settings → Secrets and variables →
Actions) :

| Secret | Contenu |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | le magasin de clés encodé en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | mot de passe du magasin |
| `ANDROID_KEY_ALIAS` | `parcelys` |
| `ANDROID_KEY_PASSWORD` | mot de passe de la clé |

Le fichier `.jks` ne doit **jamais** être versionné.

### Adresse du serveur dans l'application

L'APK ne contient aucune adresse en dur : à la première connexion,
l'utilisateur saisit celle de son instance — `parcelys.fr`. Le schéma `https://`
est ajouté automatiquement s'il est omis. C'est ce qui permet à un même APK de
servir plusieurs exploitations auto-hébergées.
