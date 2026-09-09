# Installer Parcelys sur un Raspberry Pi, derrière un tunnel Cloudflare

Marche à suivre complète pour héberger `parcelys.fr` **chez vous**, sur un
Raspberry Pi, avec une connexion Starlink — donc **sans IP publique et sans
ouvrir le moindre port**.

Comptez **1 h 30** la première fois, dont une bonne demi-heure de compilation
sur le Pi. Chaque commande est à taper telle quelle, dans l'ordre ; les valeurs
à remplacer sont signalées par `← …`.

## Sommaire

1. [Pourquoi un tunnel, et pas une redirection de port](#1-pourquoi-un-tunnel-et-pas-une-redirection-de-port)
2. [Ce qu'il vous faut](#2-ce-quil-vous-faut)
3. [Préparer la carte et le premier démarrage](#3-préparer-la-carte-et-le-premier-démarrage)
4. [Démarrer sur le SSD](#4-démarrer-sur-le-ssd)
   · [4 bis. Vous n'avez pas de SSD](#4-bis-vous-navez-pas-de-ssd)
   · [4 ter. Raccourci : le script d'installation](#4-ter-raccourci--le-script-dinstallation)
5. [Durcissement et pare-feu](#5-durcissement-et-pare-feu)
6. [PostgreSQL et PostGIS](#6-postgresql-et-postgis)
7. [Node.js et l'utilisateur de service](#7-nodejs-et-lutilisateur-de-service)
8. [Installer Parcelys](#8-installer-parcelys)
9. [Configurer l'instance](#9-configurer-linstance)
10. [Compiler sur le Pi](#10-compiler-sur-le-pi)
11. [Le service systemd](#11-le-service-systemd)
12. [Le domaine parcelys.fr chez Cloudflare](#12-le-domaine-parcelysfr-chez-cloudflare)
13. [Créer le tunnel](#13-créer-le-tunnel)
14. [Régler Cloudflare pour Parcelys](#14-régler-cloudflare-pour-parcelys)
15. [Créer le premier compte](#15-créer-le-premier-compte)
16. [Catalogue E-Phy](#16-catalogue-e-phy)
17. [L'application mobile](#17-lapplication-mobile)
18. [Sauvegardes](#18-sauvegardes)
19. [Vivre avec Starlink](#19-vivre-avec-starlink)
20. [Mettre à jour](#20-mettre-à-jour)
21. [Quand ça ne marche pas](#21-quand-ça-ne-marche-pas)

---

## 1. Pourquoi un tunnel, et pas une redirection de port

Starlink place ses abonnés derrière un **CGNAT** : votre routeur n'a pas
d'adresse IP publique à lui, il en partage une avec des centaines d'autres
abonnés. Concrètement, **aucune redirection de port n'est possible** — il n'y a
pas d'adresse vers laquelle pointer `parcelys.fr`, et rien ne peut initier une
connexion vers chez vous.

Le tunnel Cloudflare renverse le sens de la connexion. Un petit service,
`cloudflared`, tourne sur le Pi et ouvre une connexion **sortante** vers le
réseau Cloudflare — exactement comme votre navigateur ouvre une connexion vers
un site. Quand quelqu'un demande `parcelys.fr`, Cloudflare fait redescendre la
requête par ce tunnel déjà ouvert.

```
Visiteur ──HTTPS──▶ Cloudflare ◀══tunnel sortant══ cloudflared ──▶ Parcelys
                                                    (le Pi)      127.0.0.1:3000
```

Ce que cela vous apporte, au-delà de contourner le CGNAT :

- **Aucun port ouvert.** Votre box reste fermée. Il n'y a littéralement rien à
  attaquer depuis Internet — les scans de ports ne trouvent rien.
- **HTTPS sans certificat à gérer.** Cloudflare présente le certificat et le
  renouvelle. Pas de certbot, pas de renouvellement à surveiller.
- **L'IP change sans conséquence.** Starlink vous en attribue une nouvelle
  régulièrement ; le tunnel se rétablit tout seul.
- **Gratuit** pour cet usage, sans limite de trafic pertinente ici.

Le prix à payer, qu'il faut connaître : **si Starlink tombe, le site tombe**.
Le § 19 explique ce qui continue de fonctionner malgré tout — et c'est
l'essentiel du travail au champ.

---

## 2. Ce qu'il vous faut

| | Minimum | Recommandé |
| --- | --- | --- |
| Modèle | Raspberry Pi 4, 4 Go | **Pi 5, 8 Go** |
| Stockage | **SSD USB** | SSD USB 250 Go |
| Système | Raspberry Pi OS **64 bits** | idem (Bookworm) |
| Alimentation | officielle | officielle |

Deux points ne se négocient pas.

**Le SSD.** PostgreSQL écrit sans cesse ; une carte microSD s'use en quelques
mois et meurt sans prévenir. Une base corrompue le jour d'un contrôle, c'est
exactement ce qu'on cherche à éviter. Un boîtier USB 3.0 avec un SSD de 120 Go
coûte une vingtaine d'euros — c'est la meilleure dépense de cette
installation.

**Le 64 bits.** Le client PostgreSQL de Parcelys (Prisma) fournit des binaires
pour `arm64`, pas pour `armhf`. En 32 bits, l'installation échoue.

Vérifiez, si le Pi tourne déjà :

```bash
uname -m        # doit afficher aarch64
```

Il vous faut aussi un compte Cloudflare (gratuit) et le domaine `parcelys.fr`
chez votre bureau d'enregistrement — nous transférerons seulement la **gestion
DNS** à Cloudflare, pas le domaine lui-même.

---

## 3. Préparer la carte et le premier démarrage

Depuis votre ordinateur, avec **Raspberry Pi Imager** :

1. Modèle : votre Pi. Système : **Raspberry Pi OS Lite (64-bit)** — pas besoin
   de bureau, il consommerait de la mémoire pour rien.
2. Cliquez sur la roue dentée (« Modifier les réglages ») :
   - nom d'hôte : `parcelys`
   - activez SSH, **avec authentification par clé publique**
   - collez votre clé publique (`cat ~/.ssh/id_ed25519.pub`)
   - nom d'utilisateur : `kevin` ← le vôtre, et un mot de passe solide
   - Wi-Fi si le Pi n'est pas en Ethernet — **préférez l'Ethernet**, un tunnel
     permanent supporte mal les micro-coupures du Wi-Fi
3. Écrivez sur la microSD, insérez-la, démarrez le Pi.

Si vous n'avez pas encore de clé SSH :

```bash
ssh-keygen -t ed25519 -C "parcelys"
```

Trouvez le Pi sur votre réseau et connectez-vous :

```bash
ssh kevin@parcelys.local
# à défaut, cherchez son adresse dans l'interface de votre routeur :
# ssh kevin@192.168.1.50
```

**Fixez son adresse locale** dans votre routeur (bail DHCP statique) : les
sauvegardes et l'accès SSH s'en trouveront stables.

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

---

## 4. Démarrer sur le SSD

> Pas de SSD sous la main ? Passez au **§ 4 bis** : l'installation fonctionne
> très bien sur la carte microSD seule, à condition de savoir où mettre les
> sauvegardes. Une clé USB n'est pas un substitut de SSD, et le § 4 bis explique
> pourquoi.

Branchez le SSD sur un port **USB 3.0** (les bleus). Copiez-y le système :

```bash
sudo apt install -y rpi-clone     # ou utilisez « Accessoires → SD Card Copier »
lsblk                             # repérez le SSD, typiquement sda
sudo rpi-clone sda
```

Éteignez, **retirez la microSD**, rallumez. Le Pi 4 (firmware récent) et le
Pi 5 démarrent sur USB sans réglage. Vérifiez :

```bash
lsblk
findmnt /                         # la racine doit être sur /dev/sda…
```

Ajoutez de la mémoire d'échange : la compilation de Next en réclame plus que ce
qu'un Pi 4 offre. Sur SSD, c'est sans danger pour le matériel.

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
free -h                           # ~2 Go de swap
```

---

## 4 bis. Vous n'avez pas de SSD

Une clé USB **ne remplace pas** un SSD, et le plus souvent ne vaut pas mieux
qu'une bonne carte microSD. Le contrôleur d'une clé grand public est rudimentaire,
il n'a pas de mémoire cache, et il encaisse mal les écritures aléatoires
courtes — c'est-à-dire exactement ce que fait PostgreSQL toute la journée. Y
déplacer la base ne prolongerait pas la vie de l'installation ; il arrive même
qu'elle raccourcisse, et les blocages d'entrées-sorties d'une clé lente se
voient immédiatement à l'usage.

**Le bon emploi d'une clé de 30 Go est donc ailleurs : comme destination de
sauvegarde.** Une sauvegarde, c'est une grosse écriture séquentielle par jour —
le seul régime où une clé USB se comporte honnêtement. Et c'est ce qui vous
sauvera réellement le jour où la carte lâchera.

Donc, en attendant un vrai SSD :

- **système et base sur la carte microSD**, avec les réglages ménageants que le
  script applique tout seul (voir plus bas) ;
- **clé USB comme cible de sauvegarde**, montée à demeure ;
- **une copie hors de la maison** malgré tout (§ 18) : la clé est branchée sur le
  Pi, elle partirait avec lui en cas de vol, d'orage ou de dégât des eaux.

### Monter la clé à demeure

Un montage par UUID plutôt que par `/dev/sda1` : l'ordre des périphériques
change d'un démarrage à l'autre, le UUID non.

```bash
lsblk -o NAME,SIZE,FSTYPE,TRAN,MOUNTPOINT      # repérez la clé (TRAN=usb)
sudo blkid /dev/sda1                            # relevez UUID="…"
```

Si elle est encore en FAT32 ou exFAT, reformatez-la en ext4 — un `tar` de
documents avec ses droits Unix n'y survivrait pas autrement. **Ceci efface la
clé :**

```bash
sudo mkfs.ext4 -L PARCELYS-SAUV /dev/sda1
sudo blkid /dev/sda1                            # le UUID a changé, relevez-le
```

```bash
sudo mkdir -p /media/sauvegardes
sudo nano /etc/fstab
```

```fstab
# nofail : si la clé est débranchée, le Pi démarre quand même au lieu de
# s'arrêter sur une invite de réparation à laquelle personne ne répondra.
UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /media/sauvegardes  ext4  defaults,nofail,noatime  0  2
```

```bash
sudo mount -a
findmnt /media/sauvegardes                      # doit afficher /dev/sda1
```

Puis indiquez cette destination à l'installateur :

```bash
sudo bash scripts/install-pi.sh --backup-dir /media/sauvegardes/parcelys
```

Le script vérifie alors que la destination est bien sur un **autre support** que
le système, et inscrit `PARCELYS_BACKUP_REQUIRE_MOUNT=1` dans sa configuration :
si la clé est débranchée le jour venu, la sauvegarde **échoue bruyamment** au
lieu d'écrire sur la carte SD en faisant croire que tout va bien.

### Ce que le script adapte de lui-même sur mémoire flash

Détecté automatiquement (carte microSD, ou disque USB non rotatif) :

- **zram au lieu d'un fichier d'échange.** Un fichier d'échange sur mémoire
  flash est le meilleur moyen de l'user : c'est l'usage le plus intensif en
  écriture qui soit. zram comprime en mémoire vive et n'écrit rien sur le
  support.
- **Points de reprise PostgreSQL espacés** (`checkpoint_timeout=30min`,
  `max_wal_size=2GB`, `wal_compression=on`) : moins d'écritures, plus grosses.
- **Journal des requêtes lentes désactivé.**

Ce qui n'est **pas** touché, volontairement : `synchronous_commit` reste à `on`.
Le passer à `off` réduirait encore l'usure, au prix de perdre les dernières
transactions en cas de coupure. Pour un registre phytosanitaire — un document
réglementaire, opposable en cas de contrôle — c'est un prix qu'on ne paie pas.

### Et si vous voulez quand même essayer la clé comme disque système

C'est votre droit, mais mesurez d'abord, sur la clé montée, plutôt que de vous
fier à l'emballage :

```bash
# Écriture aléatoire 4K : c'est ce chiffre qui compte pour une base,
# pas le débit séquentiel annoncé sur la boîte.
sudo apt install -y fio
sudo fio --name=alea --directory=/media/sauvegardes --size=512M \
         --rw=randwrite --bs=4k --iodepth=1 --numjobs=1 --runtime=30 \
         --time_based --end_fsync=1
sudo rm -f /media/sauvegardes/alea.0.0
```

En dessous de quelques centaines d'IOPS en écriture aléatoire, la clé sera plus
lente que la carte microSD. Comparez les deux avant de déplacer quoi que ce soit.

---

## 4 ter. Raccourci : le script d'installation

Les étapes 5 à 11 — paquets, PostgreSQL, PostGIS, compte de service, code,
configuration, compilation, service systemd — tiennent en une commande :

```bash
curl -fsSL https://raw.githubusercontent.com/kryptonproject-crypto/parcelys/main/scripts/install-pi.sh \
  | sudo bash
```

Le script est **idempotent** : on peut le relancer sans rien casser. Il
n'écrase jamais un `.env` existant, ne recrée pas une base déjà là, engendre un
mot de passe de base solide, et **vérifie le résultat de chaque étape** plutôt
que son code de retour — `npm` sait échouer en renvoyant 0.

Pour voir ce qu'il ferait sans rien modifier :

```bash
curl -fsSL https://raw.githubusercontent.com/kryptonproject-crypto/parcelys/main/scripts/install-pi.sh \
  | sudo bash -s -- --dry-run
```

Il ne s'occupe **pas** du tunnel Cloudflare : celui-ci demande une autorisation
dans un navigateur, qu'aucun script ne peut donner à votre place. Reprenez au
§ 12 une fois l'application en route.

Si vous préférez comprendre chaque étape — ce qui n'est jamais du temps perdu
sur une machine qui gardera vos registres —, poursuivez la lecture : les
sections suivantes font exactement ce que le script automatise.

---

## 5. Durcissement et pare-feu

```bash
sudo apt install -y curl git ufw fail2ban
```

Le pare-feu est ici **plus strict que sur un serveur classique** : avec un
tunnel, il n'y a aucun port à ouvrir sur Internet. On n'autorise que le réseau
local, pour SSH.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 22   # ← votre plage locale
sudo ufw --force enable
sudo ufw status verbose
```

> Adaptez `192.168.1.0/24` à votre réseau : `ip -4 addr show` vous donne
> l'adresse du Pi, et donc la plage. Avec le routeur Starlink par défaut, c'est
> souvent `192.168.1.0/24`.

Interdisez la connexion par mot de passe, votre clé étant déjà en place :

```bash
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

**Ne fermez pas cette session** avant d'avoir vérifié, depuis un second
terminal, que `ssh kevin@parcelys.local` fonctionne toujours.

---

## 6. PostgreSQL et PostGIS

```bash
sudo apt install -y postgresql postgresql-postgis
```

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE parcelys LOGIN PASSWORD 'CHANGEZ-MOI-mot-de-passe-long';
CREATE DATABASE parcelys OWNER parcelys;
SQL

sudo -u postgres psql -d parcelys -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

Vérifiez immédiatement — c'est la dépendance sans laquelle rien ne marchera :

```bash
sudo -u postgres psql -d parcelys -c 'SELECT postgis_lib_version();'
```

Une version doit s'afficher. Sans PostGIS, aucune superficie n'est calculable,
et Parcelys n'a plus d'objet.

Un réglage utile sur un Pi, où la mémoire est comptée :

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '256MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '16MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET random_page_cost = 1.1;"  # SSD
sudo systemctl restart postgresql
```

---

## 7. Node.js et l'utilisateur de service

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version                    # v22.x
```

L'application tournera sous un compte dédié, sans mot de passe ni shell :

```bash
sudo adduser --system --group --home /opt/parcelys --shell /usr/sbin/nologin parcelys
```

---

## 8. Installer Parcelys

```bash
sudo git clone https://github.com/kryptonproject-crypto/parcelys.git /opt/parcelys
sudo chown -R parcelys:parcelys /opt/parcelys
cd /opt/parcelys
sudo -u parcelys npm ci
```

Sur un Pi, `npm ci` prend cinq à dix minutes. C'est normal.

---

## 9. Configurer l'instance

```bash
sudo -u parcelys cp .env.example .env
sudo -u parcelys nano .env
```

```ini
NODE_ENV=production

DATABASE_URL="postgresql://parcelys:CHANGEZ-MOI-mot-de-passe-long@localhost:5432/parcelys?schema=public"

# L'adresse publique servie par Cloudflare, en HTTPS — même si le Pi, lui,
# ne parle qu'en HTTP à cloudflared sur la boucle locale.
APP_URL="https://parcelys.fr"
APP_NAME="Parcelys"

# Derrière Cloudflare, c'est CF-Connecting-IP qui porte l'adresse réelle du
# visiteur. Cloudflare l'écrase à chaque requête : il ne peut pas être forgé,
# contrairement à X-Forwarded-For, que n'importe qui peut amorcer.
# Cette adresse alimente la limitation de débit et le journal d'audit.
CLIENT_IP_HEADER=cf-connecting-ip

# Un Pi hache les mots de passe plus lentement qu'un serveur : 11 garde une
# connexion vive sans rogner sérieusement sur la sécurité.
PASSWORD_HASH_COST=11

EMAIL_PROVIDER=smtp
EMAIL_FROM="Parcelys <no-reply@parcelys.fr>"
SMTP_HOST=mail.votre-hebergeur.fr
SMTP_PORT=587
SMTP_USER=no-reply@parcelys.fr
SMTP_PASSWORD=le-mot-de-passe-de-la-boîte
SMTP_SECURE=false

# Sur le SSD, hors du dossier de code : une mise à jour ne doit jamais
# pouvoir les effacer.
UPLOAD_DIR="/var/lib/parcelys/documents"
EPHY_DATA_DIR="/var/lib/parcelys/ephy"

UPDATE_REPOSITORY="kryptonproject-crypto/parcelys"
```

```bash
sudo chmod 600 /opt/parcelys/.env
sudo chown parcelys:parcelys /opt/parcelys/.env

sudo mkdir -p /var/lib/parcelys/documents /var/lib/parcelys/ephy
sudo chown -R parcelys:parcelys /var/lib/parcelys
```

> **La boîte e-mail.** Un Pi derrière Starlink est le plus mauvais expéditeur
> de courrier qui soit : l'IP est partagée, résidentielle, et systématiquement
> mal notée. **N'installez pas de serveur SMTP.** Servez-vous de celui d'un
> hébergeur — celui de votre domaine, ou un service transactionnel gratuit sur
> les premiers volumes.

---

## 10. Compiler sur le Pi

```bash
cd /opt/parcelys
sudo -u parcelys npm run db:deploy
sudo -u parcelys npm run build
```

> La compilation télécharge une fois la police Inter chez Google, puis la sert
> depuis votre instance. Lancez-la quand la liaison est stable ; en cas
> d'échec, relancez simplement.

**Comptez 10 à 20 minutes** sur un Pi 4, 5 à 8 sur un Pi 5. Si la compilation
est tuée en cours de route, c'est la mémoire : vérifiez le swap du § 4, puis
recommencez avec une limite explicite.

```bash
sudo -u parcelys NODE_OPTIONS="--max-old-space-size=2048" npm run build
```

Puis le contrôle avant démarrage :

```bash
sudo -u parcelys npm run preflight
```

Il doit se terminer par `✓ Instance prête`. Les lignes précédées de `!` sont
des avertissements, celles précédées de `✗` sont à corriger avant d'aller plus
loin.

---

## 11. Le service systemd

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

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/parcelys /opt/parcelys/.next

[Install]
WantedBy=multi-user.target
```

`HOSTNAME=127.0.0.1` est important : l'application n'écoute que sur la boucle
locale. Seul `cloudflared`, sur la même machine, peut lui parler — rien sur
votre réseau local, et *a fortiori* rien depuis Internet.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parcelys
sudo systemctl status parcelys           # « active (running) »

curl -s http://127.0.0.1:3000/api/health
# {"status":"ok","checks":{"database":true,"postgis":true}}
```

Tant que cette réponse n'est pas `ok`, inutile de continuer : le tunnel ne
ferait que publier une application en panne.

---

## 12. Le domaine parcelys.fr chez Cloudflare

Le tunnel fonctionne en créant un enregistrement DNS d'un type particulier, qui
**n'existe que chez Cloudflare**. Il faut donc que Cloudflare gère la zone DNS
de `parcelys.fr`. Le domaine reste chez votre bureau d'enregistrement ; seuls
les serveurs de noms changent.

1. Créez un compte sur `dash.cloudflare.com` (gratuit).
2. « Add a site » → `parcelys.fr` → plan **Free**.
3. Cloudflare lit votre zone actuelle et propose de la recopier. **Vérifiez que
   vos enregistrements de messagerie y sont** : `MX`, et les `TXT` de SPF,
   DKIM, DMARC. S'ils manquent, ajoutez-les à la main **avant** l'étape
   suivante, sinon vos e-mails cesseront d'arriver.
4. Cloudflare affiche deux serveurs de noms, du genre
   `alice.ns.cloudflare.com` et `bob.ns.cloudflare.com`.
5. Chez votre bureau d'enregistrement, remplacez les serveurs de noms actuels
   par ces deux-là.

La propagation prend de quelques minutes à 24 heures. Cloudflare vous envoie un
courriel quand la zone est active. Vérifiez :

```bash
dig +short NS parcelys.fr
```

> **N'ajoutez aucun enregistrement `A` pour `parcelys.fr`.** L'étape suivante en
> créera un, d'un type spécial, qui pointe vers le tunnel.

---

## 13. Créer le tunnel

Sur le Pi :

```bash
# Dépôt officiel Cloudflare, pour recevoir les mises à jour de sécurité.
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update && sudo apt install -y cloudflared
cloudflared --version
```

### Autoriser le Pi

```bash
cloudflared tunnel login
```

Une URL s'affiche. **Ouvrez-la depuis votre ordinateur** (le Pi n'a pas de
navigateur), connectez-vous à Cloudflare, choisissez `parcelys.fr` et
autorisez. Un certificat est déposé dans `~/.cloudflared/cert.pem`.

### Créer le tunnel et sa route

```bash
cloudflared tunnel create parcelys
```

La commande affiche un identifiant du genre
`6ff42ae2-765d-4adf-8112-31c55c1551ef` et crée un fichier
`~/.cloudflared/<identifiant>.json` — **c'est le secret du tunnel, ne le
partagez pas**.

```bash
# Note l'identifiant dans une variable pour la suite.
TUNNEL_ID=$(cloudflared tunnel list | awk '/parcelys/ {print $1}')
echo "$TUNNEL_ID"
```

Les deux enregistrements DNS, créés automatiquement :

```bash
cloudflared tunnel route dns parcelys parcelys.fr
cloudflared tunnel route dns parcelys www.parcelys.fr
```

Vous verrez apparaître dans le tableau de bord Cloudflare deux `CNAME` vers
`<identifiant>.cfargotunnel.com`, avec le nuage orange (« proxied »). C'est
normal : ce nom ne résout que dans le réseau Cloudflare.

### La configuration du tunnel

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

```yaml
# ← remplacez par l'identifiant affiché par « cloudflared tunnel create »
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /etc/cloudflared/tunnel.json

# Deux connexions au réseau Cloudflare plutôt que quatre : sur une liaison
# satellite, mieux vaut moins de sessions, mais stables.
ha-connections: 2

ingress:
  - hostname: parcelys.fr
    service: http://127.0.0.1:3000
    originRequest:
      # Un export PDF sur une grande exploitation peut demander une minute.
      connectTimeout: 30s
      # Sur satellite, les temps d'aller-retour sont longs : on laisse
      # respirer avant de conclure à une panne.
      tcpKeepAlive: 30s
      keepAliveTimeout: 90s

  - hostname: www.parcelys.fr
    service: http://127.0.0.1:3000

  # Obligatoire : tout ce qui ne correspond à rien ci-dessus est refusé.
  - service: http_status:404
```

Copiez le secret du tunnel là où le service ira le chercher :

```bash
sudo cp ~/.cloudflared/"$TUNNEL_ID".json /etc/cloudflared/tunnel.json
sudo chmod 600 /etc/cloudflared/tunnel.json
sudo chown root:root /etc/cloudflared/tunnel.json
```

### Installer le service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Les journaux doivent montrer des connexions établies :

```bash
sudo journalctl -u cloudflared -n 30
# … Registered tunnel connection  connIndex=0 …
```

**Ouvrez `https://parcelys.fr`.** La page d'accueil doit s'afficher, avec sa
mise en forme, et le cadenas dans la barre d'adresse. Depuis n'importe où dans
le monde — sans qu'un seul port soit ouvert chez vous.

---

## 14. Régler Cloudflare pour Parcelys

Quatre réglages comptent. Les deux premiers sont indispensables.

### SSL/TLS : mode « Full »

Tableau de bord → **SSL/TLS → Overview** → **Full**.

Ne choisissez pas « Flexible » : Cloudflare parlerait en HTTP à
`cloudflared`, alors que l'application se croit en HTTPS. Les cookies de
session, marqués `Secure`, ne seraient jamais renvoyés — personne ne pourrait
se connecter. « Full » convient : le trajet Cloudflare → Pi ne quitte pas la
boucle locale du Pi, il n'a pas besoin d'être chiffré une seconde fois.

Activez au passage **SSL/TLS → Edge Certificates → Always Use HTTPS**.

### Ne mettez pas Cloudflare Access devant

Cloudflare Zero Trust propose d'ajouter une page de connexion devant le site.
**Ne l'activez pas sur `parcelys.fr`** : l'application mobile s'authentifie par
jeton, elle ne saurait pas franchir cette page, et la synchronisation hors
ligne cesserait de fonctionner. Parcelys a déjà son propre contrôle d'accès —
inscription fermée par code, sessions, rôles, journal d'audit.

### Ne forcez pas la mise en cache

Par défaut, Cloudflare ne met en cache que les fichiers statiques : c'est
exactement ce qu'il faut. **Ne créez pas de règle « Cache Everything »** sur ce
domaine : elle servirait à un visiteur la page d'un autre, cookie de session
compris.

Un réglage utile en revanche, **Speed → Optimization → Brotli** : la liaison
satellite est le maillon lent, et compresser davantage se sent à l'usage.

### Ce que Cloudflare impose

| Limite (plan gratuit) | Valeur | Conséquence pour Parcelys |
| --- | --- | --- |
| Taille d'un envoi | 100 Mo | Sans effet : les pièces jointes sont bornées à 15 Mo. |
| Durée d'une requête | 100 s | Un export PDF très volumineux pourrait être coupé. Filtrez alors par campagne. |
| Trafic | pas de limite pratique | — |

---

## 15. Créer le premier compte

L'inscription est fermée : créer un compte exige un code délivré par un
administrateur. **Le tout premier compte d'une base vide fait exception** — il
s'inscrit sans code et devient administrateur de l'instance.

Rendez-vous sur `https://parcelys.fr/inscription` et créez-le.

Un code de vérification à six chiffres arrive par e-mail. Si vous êtes encore
en `EMAIL_PROVIDER=console`, il est dans les journaux :

```bash
sudo journalctl -u parcelys -n 50 | grep -A 6 "code de vérification"
```

Ensuite, tout nouveau compte passe par « Administration → Invitations ». Pour un
expert agronomique, choisissez le type de compte « Expert agronomique » : il
n'aura aucune exploitation, et ce sont les exploitations qui lui ouvriront
l'accès depuis « Paramètres → Experts agronomiques ».

Accès administrateur perdu ? Depuis le Pi :

```bash
cd /opt/parcelys && sudo -u parcelys npm run admin -- promouvoir votre@adresse.fr
```

---

## 16. Catalogue E-Phy

Parcelys ne produit **aucune** donnée réglementaire. Sans catalogue importé, la
recherche de produits reste vide et les registres portent la mention « produit
non vérifié au catalogue ». C'est délibéré : mieux vaut une case vide qu'une
autorisation inventée.

Récupérez l'URL de l'archive ZIP du jeu de données officiel **« E-Phy :
catalogue des produits phytopharmaceutiques »** publié par l'ANSES sur
`data.gouv.fr`, puis :

```bash
sudo -u parcelys nano /opt/parcelys/.env    # EPHY_DATA_URL="https://…/ephy.zip"
cd /opt/parcelys && sudo -u parcelys npm run ephy:sync
sudo systemctl restart parcelys
```

L'import prend plusieurs minutes sur un Pi. La date de synchronisation
s'affiche ensuite sur les registres et les exports PDF.

Tâches planifiées — la nuit, quand la liaison est libre :

```bash
sudo crontab -u parcelys -e
```

```cron
0 3 * * 1 cd /opt/parcelys && /usr/bin/npm run ephy:sync >> /var/log/parcelys-ephy.log 2>&1
30 3 * * * cd /opt/parcelys && /usr/bin/npm run maintenance >> /var/log/parcelys.log 2>&1
```

---

## 17. L'application mobile

L'APK ne contient aucune adresse en dur : à la première connexion, on saisit
celle de son instance. Tapez **`parcelys.fr`** — le `https://` est ajouté
automatiquement.

Rien de particulier à faire côté tunnel : l'application parle à
`https://parcelys.fr/api/…` comme le navigateur, et s'authentifie par jeton
plutôt que par cookie.

Pour produire l'APK, poussez une étiquette de version — le workflow GitHub le
compile et le joint à la publication :

```bash
git tag v1.0.0 && git push origin v1.0.0
```

L'application signale ensuite elle-même les nouvelles versions, et
« Administration → Maintenance » fait de même pour le serveur.

---

## 18. Sauvegardes

Sur un Pi chez soi, la sauvegarde n'est pas une précaution : c'est la seule
chose qui vous sépare d'une perte définitive. Un SSD meurt, un orage grille une
alimentation, une fausse manœuvre efface une base.

Le script d'installation (§ 4 ter) met tout cela en place : il installe
`scripts/backup.sh` sous `/usr/local/bin/parcelys-backup`, écrit ses réglages
dans `/etc/default/parcelys-backup`, planifie une exécution quotidienne à 02h30,
et **en lance une immédiatement** — pour que l'échec éventuel se produise devant
vous plutôt qu'un an plus tard.

```bash
sudo parcelys-backup                    # sauvegarde immédiate
ls -lh /var/backups/parcelys            # ou votre --backup-dir
systemctl list-timers parcelys-backup   # prochaine exécution
```

Pour l'installer à la main, ou pour changer de destination :

```bash
sudo install -m 755 /opt/parcelys/scripts/backup.sh /usr/local/bin/parcelys-backup
sudo nano /etc/default/parcelys-backup
```

```bash
: "${PARCELYS_DB:=parcelys}"
: "${PARCELYS_DATA_DIR:=/var/lib/parcelys}"
: "${PARCELYS_BACKUP_DIR:=/media/sauvegardes/parcelys}"
: "${PARCELYS_BACKUP_KEEP_DAYS:=14}"
# Refuse la sauvegarde si le support externe est absent (voir plus bas).
: "${PARCELYS_BACKUP_REQUIRE_MOUNT:=1}"
```

### Ce que ce script fait de plus qu'un `pg_dump` en cron

Chacun de ces points vient d'un scénario où l'on croit avoir des sauvegardes
sans en avoir :

- **Il relit ce qu'il vient d'écrire.** `gunzip` recalcule la somme de contrôle,
  et le script exige en plus la ligne `PostgreSQL database dump complete` que
  `pg_dump` n'écrit qu'une fois terminé. C'est le contrôle qui compte : un dump
  interrompu en cours de route produit une archive gzip **parfaitement valide**
  au contenu tronqué. `gzip -t` la déclare bonne ; la restauration, elle, ne le
  fera pas.
- **Il efface les archives partielles.** Une base injoignable produisait sans
  cela un fichier `base-….sql.gz` de 20 octets — nom crédible, extension
  crédible, contenu vide — qui prenait sa place dans la liste et vous laissait
  croire à une sauvegarde.
- **Il refuse d'écrire sur le mauvais support.** Avec
  `PARCELYS_BACKUP_REQUIRE_MOUNT=1`, si la clé USB est débranchée, son point de
  montage est un simple dossier vide de la carte SD : la sauvegarde y
  atterrirait sans un mot, et disparaîtrait avec la carte. Le script s'arrête
  plutôt que de faire semblant.
- **Il vérifie la place disponible avant de commencer**, et ne supprime les
  anciennes archives qu'**après** avoir écrit et vérifié la nouvelle — une
  sauvegarde ratée ne doit jamais emporter les précédentes.

**Une sauvegarde qui reste sur le Pi ne protège de rien.** Recopiez-la ailleurs.
Le plus simple, et gratuit jusqu'à 10 Go : Cloudflare R2, que vous avez déjà.

```bash
sudo apt install -y rclone
rclone config          # « s3 » → fournisseur « Cloudflare R2 »
```

```cron
15 3 * * * rclone sync /var/backups/parcelys r2:parcelys-sauvegardes
```

### Essayez la restauration une fois

Une sauvegarde jamais restaurée n'est pas une sauvegarde, c'est une supposition.
Faites l'essai **à côté**, dans une base jetable : vous vérifiez la sauvegarde
sans risquer celle qui est en service.

```bash
ARCHIVE=/var/backups/parcelys/base-2027-03-01.sql.gz   # adaptez la date

sudo -u postgres dropdb --if-exists parcelys_essai
sudo -u postgres createdb parcelys_essai
gunzip -c "$ARCHIVE" | sudo -u postgres psql -q parcelys_essai
```

Comparez ensuite la copie à l'original — c'est là qu'on apprend si l'archive
vaut quelque chose. Les géométries sont le point sensible : ce sont elles qui
portent les superficies, et donc les déclarations.

```bash
# Nombre de lignes de chaque table, dans les deux bases : doit être identique.
for db in parcelys parcelys_essai; do
  echo -n "$db : "
  sudo -u postgres psql -tA -d "$db" -c "
    SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
      SELECT c.relname AS t,
             (xpath('/row/c/text()', query_to_xml(
                format('SELECT count(*) AS c FROM public.%I', c.relname),
                false, true, '')))[1]::text::bigint AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
        AND c.relname <> 'spatial_ref_sys') s;"
done

# Empreinte des contours parcellaires : doit donner deux fois la même somme.
for db in parcelys parcelys_essai; do
  echo -n "$db : "
  sudo -u postgres psql -tA -d "$db" \
    -c "SELECT md5(string_agg(ST_AsText(geom), '|' ORDER BY id)) FROM parcel_geometries;"
done
```

Deux lignes identiques à chaque fois : l'archive est bonne. Nettoyez :

```bash
sudo -u postgres dropdb parcelys_essai
```

Pour une **vraie** restauration, après un incident :

```bash
sudo systemctl stop parcelys
sudo -u postgres dropdb parcelys
sudo -u postgres createdb -O parcelys parcelys
gunzip -c "$ARCHIVE" | sudo -u postgres psql -q parcelys
sudo tar xzf /var/backups/parcelys/documents-2027-03-01.tar.gz -C /var/lib/parcelys
sudo systemctl start parcelys
curl -s http://127.0.0.1:3000/api/health
```

L'extension PostGIS est comprise dans le dump : inutile de la recréer à la main
avant de restaurer.

---

## 19. Vivre avec Starlink

### Ce qui s'arrête, et ce qui continue

Quand la liaison tombe — averse, obstruction, coupure de courant côté box —, le
tunnel tombe avec elle et `https://parcelys.fr` devient injoignable.

**Mais c'est précisément le cas pour lequel l'application de terrain a été
faite.** Une fois les données téléchargées, l'APK fonctionne sans réseau :
relever une parcelle au GPS, saisir un traitement, un apport, un travail. Tout
part dans une file d'attente locale et se synchronise au retour du réseau, sans
doublon. Au champ, vous n'avez de toute façon ni la liaison satellite ni le
Wi-Fi de la maison.

Ce qui s'arrête vraiment : la consultation depuis un navigateur, et l'accès de
vos experts agronomiques. Rarement urgent.

### Et l'accès en local, quand Internet est coupé ?

C'est tentant, mais **cela ne fonctionne pas simplement**, et il vaut mieux le
savoir que de le découvrir un jour de panne. En production, les cookies de
session sont marqués `Secure` : un navigateur ne les renvoie que sur une
connexion HTTPS. Or `http://192.168.1.50:3000` n'est pas du HTTPS — la page
s'afficherait, mais la connexion échouerait sans message clair.

Les vraies réponses, dans l'ordre de bon sens :

1. **L'application mobile**, qui est faite pour ça et couvre le travail au
   champ.
2. Un **certificat local** avec `mkcert` et un nginx sur le Pi, si vous tenez à
   consulter depuis un ordinateur de la maison pendant une coupure. C'est une
   installation supplémentaire, à ne monter que si le besoin est réel.

### Redémarrages et coupures de courant

Les deux services démarrent tout seuls (`systemctl enable`), et le tunnel se
rétablit dès que la liaison revient. Un onduleur, même petit, évite au Pi les
extinctions brutales — PostgreSQL n'aime pas ça.

### Surveiller depuis l'extérieur

`https://parcelys.fr/api/health` renvoie `200` quand la base et PostGIS
répondent, `503` sinon, et ne demande aucune authentification. Branchez-y un
service gratuit (UptimeRobot, BetterStack) : vous saurez que le Pi ou la
liaison a lâché avant que quelqu'un vous le signale.

Sur satellite, réglez la vérification à **5 minutes** et tolérez un échec avant
alerte : les micro-coupures sont normales et ne méritent pas un courriel.

---

## 20. Mettre à jour

« Administration → Maintenance » indique si une version plus récente a été
publiée. **Rien ne s'installe tout seul** : une mise à jour touche la base d'un
registre réglementaire.

```bash
cd /opt/parcelys

sudo /usr/local/bin/parcelys-backup        # d'abord la sauvegarde
sudo systemctl stop parcelys

sudo -u parcelys git pull
sudo -u parcelys npm ci
sudo -u parcelys npm run db:deploy
sudo -u parcelys npm run build             # 10 à 20 min sur un Pi
sudo -u parcelys npm run preflight

sudo systemctl start parcelys
curl -s https://parcelys.fr/api/health
```

Le tunnel n'a pas besoin d'être touché : `cloudflared` continue de tourner et
reprend le service dès que l'application répond.

Mettez `cloudflared` à jour avec le système :

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 21. Quand ça ne marche pas

**Le site est injoignable.** Remontez la chaîne, du plus proche au plus
lointain :

```bash
curl -s http://127.0.0.1:3000/api/health   # 1. l'application
sudo systemctl status cloudflared           # 2. le tunnel
sudo journalctl -u cloudflared -n 30        # 3. ses connexions
dig +short parcelys.fr                      # 4. le DNS
```

**Erreur 502 ou 1033 de Cloudflare.** Le tunnel tourne mais n'atteint pas
l'application : elle est arrêtée, ou n'écoute pas sur `127.0.0.1:3000`.

```bash
sudo systemctl status parcelys
sudo journalctl -u parcelys -n 50
sudo -u parcelys npm run preflight
```

**Impossible de se connecter, sans message clair.** Presque toujours le mode
SSL/TLS : vérifiez qu'il est sur **Full** et non « Flexible » (§ 14). En
« Flexible », les cookies `Secure` ne reviennent jamais.

**« Origine non autorisée ».** `APP_URL` ne correspond pas à l'adresse servie.
Elle doit valoir exactement `https://parcelys.fr`, sans barre finale.

**Le site s'affiche sans aucune mise en forme.** Les fichiers statiques
manquent dans la sortie autonome :

```bash
cd /opt/parcelys && sudo -u parcelys npm run build && sudo systemctl restart parcelys
```

**La compilation est tuée.** Mémoire insuffisante : vérifiez le swap (§ 4),
puis `NODE_OPTIONS="--max-old-space-size=2048" npm run build`.

**« Failed to fetch Inter from Google Fonts ».** La compilation télécharge la
police une fois, chez Google — ensuite elle est servie par votre instance, sans
requête vers un tiers. Sur une liaison satellite intermittente, l'appel peut
échouer. Attendez que la liaison soit stable et relancez : le résultat est mis
en cache dans `.next/cache`, les compilations suivantes n'y reviendront pas.

**Tout est lent.** Regardez d'abord si le Pi ne bride pas sa fréquence
(alimentation insuffisante ou chaleur) :

```bash
vcgencmd get_throttled     # 0x0 = tout va bien
vcgencmd measure_temp      # au-delà de 80 °C, il ralentit
```

Un dissipateur ou un petit ventilateur règlent la question.

**Le tunnel se reconnecte sans arrêt.** Passez le Pi en Ethernet s'il est en
Wi-Fi, et vérifiez `ha-connections: 2` dans la configuration : sur satellite,
moins de connexions mais stables valent mieux que quatre instables.

**Les e-mails ne partent pas.** Vérifiez les variables `SMTP_*`. N'essayez pas
d'envoyer directement depuis le Pi : une IP résidentielle Starlink est rejetée
par à peu près tous les destinataires.

---

## Aide-mémoire

```bash
# État
sudo systemctl status parcelys cloudflared
curl -s http://127.0.0.1:3000/api/health
curl -s https://parcelys.fr/api/health

# Journaux
sudo journalctl -u parcelys -f
sudo journalctl -u cloudflared -f

# Tunnel
cloudflared tunnel list
cloudflared tunnel info parcelys

# Application
cd /opt/parcelys
sudo -u parcelys npm run preflight          # diagnostic complet
sudo -u parcelys npm run admin -- lister    # comptes de l'instance
sudo -u parcelys npm run admin -- inviter   # délivrer un code
sudo -u parcelys npm run ephy:sync          # catalogue officiel
sudo /usr/local/bin/parcelys-backup         # sauvegarde immédiate

# Matériel
vcgencmd get_throttled                      # 0x0 attendu
df -h /                                     # place restante sur le SSD
```
