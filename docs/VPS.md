# Installer Parcelys sur un VPS

Marche à suivre complète, du serveur nu à `https://parcelys.fr` en HTTPS.
Comptez **45 minutes** la première fois. Chaque commande est à taper telle
quelle, dans l'ordre ; les valeurs à remplacer sont signalées.

> **Pourquoi un VPS et pas un hébergement mutualisé ?** Parcelys a besoin de
> l'extension **PostGIS** dans PostgreSQL — son installation demande les droits
> superutilisateur sur le serveur de base, qu'un mutualisé n'accorde pas — et
> d'un **processus Node permanent**. Le détail est dans
> [`DEPLOIEMENT.md`](DEPLOIEMENT.md#où-héberger-parcelys-).

## Sommaire

1. [Choisir la machine](#1-choisir-la-machine)
2. [Premier contact et durcissement](#2-premier-contact-et-durcissement)
3. [Pare-feu](#3-pare-feu)
4. [PostgreSQL et PostGIS](#4-postgresql-et-postgis)
5. [Node.js et l'utilisateur de service](#5-nodejs-et-lutilisateur-de-service)
6. [Installer Parcelys](#6-installer-parcelys)
7. [Configurer l'instance](#7-configurer-linstance)
8. [Compiler et vérifier](#8-compiler-et-vérifier)
9. [Le service systemd](#9-le-service-systemd)
10. [Le domaine parcelys.fr](#10-le-domaine-parcelysfr)
11. [nginx et HTTPS](#11-nginx-et-https)
12. [Créer le premier compte](#12-créer-le-premier-compte)
13. [Catalogue E-Phy](#13-catalogue-e-phy)
14. [Sauvegardes](#14-sauvegardes)
15. [Supervision](#15-supervision)
16. [Mettre à jour](#16-mettre-à-jour)
17. [Quand ça ne marche pas](#17-quand-ça-ne-marche-pas)

---

## 1. Choisir la machine

| | Minimum | Confortable |
| --- | --- | --- |
| Processeur | 2 vCPU | 2–4 vCPU |
| Mémoire | 2 Go | 4 Go |
| Disque | 20 Go SSD | 40 Go SSD |
| Système | Debian 12 ou Ubuntu 24.04 | idem |

En dessous de 2 Go, la compilation de Next échoue faute de mémoire — on peut
s'en sortir avec un fichier d'échange (§ 17), mais 4 Go coûtent 2 € de plus et
évitent le problème.

Hetzner (CX22, ~4 €/mois), Scaleway (DEV1-S), OVH (VPS Value), Infomaniak et
PulseHeberd conviennent tous. Prenez un centre de données en France ou en
Allemagne : les données d'exploitation restent alors dans l'Union européenne, ce
qui simplifie le volet RGPD.

À la commande, **déposez votre clé SSH** plutôt que de recevoir un mot de passe
par e-mail. Si vous n'en avez pas encore, depuis votre poste :

```bash
ssh-keygen -t ed25519 -C "parcelys"
cat ~/.ssh/id_ed25519.pub          # à coller chez l'hébergeur
```

---

## 2. Premier contact et durcissement

```bash
ssh root@203.0.113.10              # ← l'IP donnée par l'hébergeur
```

Mettez le système à jour, puis créez un compte d'administration : travailler en
`root` au quotidien est le meilleur moyen de casser une machine par distraction.

```bash
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban

adduser kevin                      # ← votre prénom, mot de passe solide
usermod -aG sudo kevin

# Recopie votre clé SSH sur le nouveau compte.
rsync --archive --chown=kevin:kevin ~/.ssh /home/kevin
```

**Sans fermer cette session**, ouvrez un second terminal et vérifiez que le
nouveau compte fonctionne :

```bash
ssh kevin@203.0.113.10
sudo echo "les droits fonctionnent"
```

Tant que ce second terminal ne répond pas, ne touchez à rien : c'est le premier
qui vous permettra de réparer. Une fois la connexion confirmée, interdisez
l'accès direct à `root` et l'authentification par mot de passe :

```bash
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

`fail2ban` bannit les adresses qui insistent sur SSH ; il tourne dès son
installation, sans configuration.

---

## 3. Pare-feu

Trois ports ouverts, pas un de plus. **PostgreSQL n'est pas exposé** : il
n'écoute que sur la boucle locale, et rien ne doit pouvoir l'atteindre depuis
l'extérieur.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp              # HTTP, pour le renouvellement des certificats
sudo ufw allow 443/tcp             # HTTPS
sudo ufw --force enable
sudo ufw status verbose
```

---

## 4. PostgreSQL et PostGIS

```bash
sudo apt install -y postgresql postgresql-postgis
```

Créez le rôle et la base. **Remplacez le mot de passe** — il ne servira qu'à
l'application, gardez-le dans un gestionnaire de mots de passe :

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE parcelys LOGIN PASSWORD 'CHANGEZ-MOI-mot-de-passe-long';
CREATE DATABASE parcelys OWNER parcelys;
SQL

# PostGIS s'installe dans la base, par le superutilisateur.
sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

Vérifiez tout de suite — c'est la dépendance sans laquelle rien ne marchera :

```bash
sudo -u postgres psql -d parcelys -c 'SELECT postgis_lib_version();'
```

Une version doit s'afficher (`3.4.2` ou approchant). Si la commande échoue,
n'allez pas plus loin : aucune superficie ne serait calculable.

---

## 5. Node.js et l'utilisateur de service

Node 20 ou 22, depuis le dépôt de NodeSource — la version des dépôts Debian est
trop ancienne.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version                     # doit afficher v22.x
```

L'application tournera sous un compte dédié, sans mot de passe et sans shell :
si quelqu'un compromettait le service, il n'obtiendrait pas une session.

```bash
sudo adduser --system --group --home /opt/parcelys --shell /usr/sbin/nologin parcelys
```

---

## 6. Installer Parcelys

```bash
sudo git clone https://github.com/kryptonproject-crypto/parcelys.git /opt/parcelys
sudo chown -R parcelys:parcelys /opt/parcelys
cd /opt/parcelys
```

Les dépendances et la compilation se font sous le compte de service, pour que
les fichiers produits lui appartiennent :

```bash
sudo -u parcelys npm ci
```

---

## 7. Configurer l'instance

```bash
sudo -u parcelys cp .env.example .env
sudo -u parcelys nano .env
```

Le minimum vital, à adapter :

```ini
NODE_ENV=production

# Le mot de passe choisi au § 4.
DATABASE_URL="postgresql://parcelys:CHANGEZ-MOI-mot-de-passe-long@localhost:5432/parcelys?schema=public"

# L'adresse exacte servie, en HTTPS. Elle sert aux liens des e-mails, au
# contrôle d'origine CSRF et au marquage Secure des cookies : une valeur
# approximative fait échouer les connexions sans message clair.
APP_URL="https://parcelys.fr"
APP_NAME="Parcelys"

# Envoi des e-mails de vérification et de réinitialisation. « console » écrit
# les codes dans les journaux : acceptable pour votre premier compte, à changer
# avant d'inviter qui que ce soit.
EMAIL_PROVIDER=smtp
EMAIL_FROM="Parcelys <no-reply@parcelys.fr>"
SMTP_HOST=mail.votre-hebergeur.fr
SMTP_PORT=587
SMTP_USER=no-reply@parcelys.fr
SMTP_PASSWORD=le-mot-de-passe-de-la-boîte
SMTP_SECURE=false

# Dossiers de données, hors du dossier de code : une mise à jour ne doit
# jamais pouvoir les effacer.
UPLOAD_DIR="/var/lib/parcelys/documents"
EPHY_DATA_DIR="/var/lib/parcelys/ephy"

# Dépôt surveillé pour les mises à jour. Sans lui, aucune requête ne sort.
UPDATE_REPOSITORY="kryptonproject-crypto/parcelys"
```

Le fichier contient le mot de passe de la base : verrouillez-le.

```bash
sudo chmod 600 /opt/parcelys/.env
sudo chown parcelys:parcelys /opt/parcelys/.env

sudo mkdir -p /var/lib/parcelys/documents /var/lib/parcelys/ephy
sudo chown -R parcelys:parcelys /var/lib/parcelys
```

> **Boîte e-mail.** Si votre domaine est chez un hébergeur mutualisé (O2switch,
> OVH…), servez-vous de son SMTP : ses adresses IP sont connues des filtres
> anti-spam, contrairement à celle d'un VPS neuf. C'est une bonne raison de
> garder le mutualisé pour le courrier et le DNS.

---

## 8. Compiler et vérifier

```bash
cd /opt/parcelys
sudo -u parcelys npm run db:deploy     # crée le schéma
sudo -u parcelys npm run build         # ~2 à 4 minutes
```

`npm run build` compile **et complète la sortie autonome** : Next n'y copie ni
les feuilles de style ni le dossier `public`, et le serveur les servirait
autrement en 404 — la page s'afficherait sans mise en forme, sans qu'aucune
erreur ne le signale.

Puis le contrôle avant démarrage :

```bash
sudo -u parcelys npm run preflight
```

Il vérifie la configuration, la base, PostGIS, les migrations, les dossiers et
la compilation. Il doit se terminer par `✓ Instance prête`. Les lignes
précédées de `!` sont des avertissements — par exemple l'absence de catalogue
E-Phy —, celles précédées de `✗` doivent être corrigées avant de continuer.

---

## 9. Le service systemd

```bash
sudo nano /etc/systemd/system/parcelys.service
```

```ini
[Unit]
Description=Parcelys — gestion parcellaire agricole
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

# Le service n'écrit que dans ses dossiers de données.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/var/lib/parcelys /opt/parcelys/.next

[Install]
WantedBy=multi-user.target
```

`HOSTNAME=127.0.0.1` est important : l'application n'écoute que sur la boucle
locale, et seul nginx lui parle. Sans cela, le port 3000 serait joignable
directement, court-circuitant HTTPS.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parcelys
sudo systemctl status parcelys        # doit afficher « active (running) »
```

Vérifiez que l'application répond, avant même de brancher le domaine :

```bash
curl -s http://127.0.0.1:3000/api/health
# {"status":"ok","checks":{"database":true,"postgis":true}}
```

---

## 10. Le domaine parcelys.fr

Chez votre bureau d'enregistrement (ou l'hébergeur qui gère la zone), trois
enregistrements. Remplacez `203.0.113.10` par l'IP du VPS.

| Type | Nom | Valeur | Rôle |
| --- | --- | --- | --- |
| `A` | `@` | `203.0.113.10` | `parcelys.fr` — l'application et son API |
| `A` | `www` | `203.0.113.10` | redirigé vers `parcelys.fr` |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | seul Let's Encrypt peut émettre un certificat |

Si vous gardez vos boîtes e-mail ailleurs, **ne touchez pas aux enregistrements
`MX`, `SPF`, `DKIM` et `DMARC`** : seuls les `A` changent.

Attendez la propagation avant de demander un certificat :

```bash
dig +short parcelys.fr             # doit renvoyer votre IP
```

Comptez de quelques minutes à quelques heures.

### Faut-il un sous-domaine pour l'API ?

Non. L'API est servie par la même application, sous `/api`, sur la même
origine : `https://parcelys.fr/api/…`. Un `api.parcelys.fr` séparé imposerait
du CORS avec identifiants entre deux origines, un assouplissement de
`SameSite`, et une surface CSRF nouvelle — pour aucun bénéfice, l'application
mobile s'authentifiant par jeton `Bearer` et non par cookie.

---

## 11. nginx et HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/parcelys.fr
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name parcelys.fr www.parcelys.fr;
    return 301 https://parcelys.fr$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.parcelys.fr;

    ssl_certificate     /etc/letsencrypt/live/parcelys.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/parcelys.fr/privkey.pem;

    return 301 https://parcelys.fr$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name parcelys.fr;

    ssl_certificate     /etc/letsencrypt/live/parcelys.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/parcelys.fr/privkey.pem;

    # Photos de parcelles et pièces jointes. Doit couvrir UPLOAD_MAX_BYTES,
    # sinon nginx rejette avant que l'application ne puisse répondre.
    client_max_body_size 20M;

    # Les fichiers compilés portent une empreinte dans leur nom : ils ne
    # changent jamais à URL constante.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

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

`X-Forwarded-For` n'est pas décoratif : c'est de là que viennent l'adresse IP
inscrite au journal d'audit et celle qu'utilise la limitation de débit. Sans
lui, toutes les requêtes semblent venir de `127.0.0.1` et une seule tentative
malveillante bloquerait tout le monde.

```bash
sudo ln -s /etc/nginx/sites-available/parcelys.fr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d parcelys.fr -d www.parcelys.fr
sudo nginx -t && sudo systemctl reload nginx
```

Certbot demande une adresse e-mail, obtient les certificats et installe le
renouvellement automatique. Vérifiez-le une fois :

```bash
sudo certbot renew --dry-run
```

Ouvrez `https://parcelys.fr` : la page d'accueil doit s'afficher **avec sa mise
en forme**. Une page sans style signalerait que les fichiers statiques manquent
— relancez alors `npm run build` (§ 8).

---

## 12. Créer le premier compte

L'inscription est fermée : créer un compte exige un code délivré par un
administrateur. **Le tout premier compte d'une base vide fait exception** — il
s'inscrit sans code et devient administrateur de l'instance.

Rendez-vous sur `https://parcelys.fr/inscription` et créez-le.

Un code de vérification à six chiffres est envoyé par e-mail. Si vous êtes
encore en `EMAIL_PROVIDER=console`, il est dans les journaux :

```bash
sudo journalctl -u parcelys -n 50 | grep -A 6 "code de vérification"
```

Ensuite, tout nouveau compte passe par « Administration → Invitations ». Pour un
expert agronomique, choisissez le type de compte « Expert agronomique » : il
n'aura aucune exploitation, et ce sont les exploitations qui lui ouvriront
l'accès depuis « Paramètres → Experts agronomiques ».

Si l'accès administrateur est un jour perdu, il se rétablit depuis le serveur :

```bash
cd /opt/parcelys && sudo -u parcelys npm run admin -- promouvoir votre@adresse.fr
```

---

## 13. Catalogue E-Phy

Parcelys ne produit **aucune** donnée réglementaire. Sans catalogue importé, la
recherche de produits reste vide et les registres portent la mention « produit
non vérifié au catalogue ». C'est volontaire : mieux vaut une case vide qu'une
autorisation inventée.

Pour l'activer, récupérez l'URL de l'archive ZIP du jeu de données officiel
**« E-Phy : catalogue des produits phytopharmaceutiques »** publié par l'ANSES
sur `data.gouv.fr`, puis :

```bash
sudo -u parcelys nano /opt/parcelys/.env      # EPHY_DATA_URL="https://…/ephy.zip"
cd /opt/parcelys && sudo -u parcelys npm run ephy:sync
sudo systemctl restart parcelys
```

La date de synchronisation s'affiche ensuite sur les registres et les exports
PDF, comme l'exige la traçabilité.

Une resynchronisation hebdomadaire, l'ANSES publiant des mises à jour :

```bash
sudo crontab -u parcelys -e
```

```cron
0 3 * * 1 cd /opt/parcelys && /usr/bin/npm run ephy:sync >> /var/log/parcelys-ephy.log 2>&1
30 3 * * * cd /opt/parcelys && /usr/bin/npm run maintenance >> /var/log/parcelys.log 2>&1
```

---

## 14. Sauvegardes

Trois choses à sauvegarder, deux véritablement irremplaçables.

| Quoi | Où | Irremplaçable ? |
| --- | --- | --- |
| Base de données | PostgreSQL | **Oui** — parcellaire, registres, préconisations |
| Documents joints | `/var/lib/parcelys/documents` | **Oui** — factures, analyses, photos |
| Archive E-Phy | `/var/lib/parcelys/ephy` | Non — retéléchargeable |

```bash
sudo nano /usr/local/bin/parcelys-backup
```

```bash
#!/bin/bash
# Sauvegarde quotidienne de Parcelys.
set -euo pipefail

DEST=/var/backups/parcelys
STAMP=$(date +%F)
mkdir -p "$DEST"

sudo -u postgres pg_dump parcelys | gzip > "$DEST/base-$STAMP.sql.gz"
tar czf "$DEST/documents-$STAMP.tar.gz" -C /var/lib/parcelys documents

# Deux semaines sur place. Le vrai filet est la copie hors machine, ci-dessous.
find "$DEST" -name '*.gz' -mtime +14 -delete
```

```bash
sudo chmod +x /usr/local/bin/parcelys-backup
sudo crontab -e
```

```cron
15 2 * * * /usr/local/bin/parcelys-backup >> /var/log/parcelys-backup.log 2>&1
```

**Une sauvegarde qui reste sur la machine ne protège de rien.** Recopiez-la
ailleurs — l'espace de sauvegarde de votre hébergeur, un disque chez vous, ou
un stockage objet :

```bash
sudo apt install -y rclone
# rclone config, puis :
15 3 * * * rclone sync /var/backups/parcelys distant:parcelys-sauvegardes
```

**Essayez la restauration au moins une fois.** Une sauvegarde jamais restaurée
n'est pas une sauvegarde :

```bash
sudo systemctl stop parcelys
sudo -u postgres dropdb parcelys
sudo -u postgres createdb -O parcelys parcelys
sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
gunzip -c /var/backups/parcelys/base-2027-03-01.sql.gz \
  | sudo -u postgres psql -d parcelys
sudo tar xzf /var/backups/parcelys/documents-2027-03-01.tar.gz -C /var/lib/parcelys
sudo systemctl start parcelys
```

---

## 15. Supervision

L'essentiel tient en une URL. `https://parcelys.fr/api/health` renvoie `200`
quand la base et PostGIS répondent, `503` sinon — et **ne demande aucune
authentification**, pour qu'un superviseur externe puisse l'appeler.

Un service gratuit comme UptimeRobot ou BetterStack, réglé sur cette adresse,
vous préviendra par courriel avant vos utilisateurs. Cela vaut mieux qu'un
contrôle depuis la machine elle-même, qui ne dira rien si elle est éteinte.

Les journaux :

```bash
sudo journalctl -u parcelys -f            # en direct
sudo journalctl -u parcelys --since today
sudo journalctl -u parcelys -p err        # erreurs seulement
```

L'application tient par ailleurs son propre **journal d'audit**, consultable
dans « Administration → Journal d'audit » : connexions, créations de comptes,
suppressions, accès de conseil ouverts et retirés.

---

## 16. Mettre à jour

« Administration → Maintenance » indique si une version plus récente a été
publiée. **Rien ne s'installe tout seul** : une mise à jour touche la base d'un
registre réglementaire, elle se fait à un moment choisi, sauvegarde faite.

```bash
cd /opt/parcelys

sudo /usr/local/bin/parcelys-backup        # d'abord la sauvegarde
sudo systemctl stop parcelys

sudo -u parcelys git pull
sudo -u parcelys npm ci
sudo -u parcelys npm run db:deploy
sudo -u parcelys npm run build
sudo -u parcelys npm run preflight

sudo systemctl start parcelys
curl -s https://parcelys.fr/api/health
```

Si quelque chose se passe mal, revenez à la version précédente et restaurez la
base depuis la sauvegarde prise à l'instant (§ 14).

---

## 17. Quand ça ne marche pas

**Le service ne démarre pas.**

```bash
sudo systemctl status parcelys
sudo journalctl -u parcelys -n 50
sudo -u parcelys npm run preflight    # dit ce qui manque, et comment y remédier
```

**Le site s'affiche sans aucune mise en forme.** Les fichiers statiques
manquent dans la sortie autonome. Recompilez :

```bash
cd /opt/parcelys && sudo -u parcelys npm run build && sudo systemctl restart parcelys
```

**« Origine non autorisée » à la connexion.** `APP_URL` ne correspond pas à
l'adresse réellement servie. Elle doit valoir exactement `https://parcelys.fr`,
sans barre finale, en `https`. Corrigez `.env` puis redémarrez.

**502 Bad Gateway.** nginx ne joint pas l'application : soit le service est
arrêté, soit il n'écoute pas sur `127.0.0.1:3000`.

```bash
sudo systemctl status parcelys
curl -s http://127.0.0.1:3000/api/health
```

**La compilation est tuée par manque de mémoire** (sur une machine à 2 Go) :

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**« PostGIS absent ».** L'extension n'a pas été créée dans la bonne base :

```bash
sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

**Les e-mails ne partent pas.** Vérifiez les variables `SMTP_*`, puis les
journaux au moment d'un envoi. En attendant, `EMAIL_PROVIDER=console` écrit les
codes dans `journalctl -u parcelys`.

**Toutes les connexions sont bloquées d'un coup.** La limitation de débit voit
toutes les requêtes venir de la même adresse : `X-Forwarded-For` manque dans la
configuration nginx (§ 11). Pour débloquer immédiatement :

```bash
sudo -u postgres psql -d parcelys -c 'DELETE FROM rate_limit_counters;'
```

**Un compte est verrouillé** après trop d'échecs : « Administration →
Utilisateurs → Déverrouiller », ou depuis le serveur si vous n'avez plus
d'accès administrateur :

```bash
sudo -u postgres psql -d parcelys \
  -c "UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE email = 'votre@adresse.fr';"
```

---

## Aide-mémoire

```bash
sudo systemctl status parcelys        # état du service
sudo systemctl restart parcelys       # redémarrer
sudo journalctl -u parcelys -f        # journaux en direct
curl -s https://parcelys.fr/api/health

cd /opt/parcelys
sudo -u parcelys npm run preflight             # diagnostic complet
sudo -u parcelys npm run admin -- lister       # comptes de l'instance
sudo -u parcelys npm run admin -- inviter      # délivrer un code
sudo -u parcelys npm run ephy:sync             # catalogue officiel
sudo /usr/local/bin/parcelys-backup            # sauvegarde immédiate
```
