#!/usr/bin/env bash
#
# Installation de Parcelys sur un Raspberry Pi (ou tout Debian/Ubuntu).
#
#   curl -fsSL https://raw.githubusercontent.com/kryptonproject-crypto/parcelys/main/scripts/install-pi.sh | sudo bash
#
# ou, depuis un dépôt déjà cloné :
#
#   sudo bash scripts/install-pi.sh
#
# Le script est **idempotent** : on peut le relancer sans rien casser. Il
# n'écrase jamais un fichier de configuration existant, ne recrée pas une base
# déjà là, et se contente de compléter ce qui manque.
#
# Il ne s'occupe PAS du tunnel Cloudflare : celui-ci demande une autorisation
# dans un navigateur, qu'aucun script ne peut donner à votre place. La marche à
# suivre est au § 13 de docs/RASPBERRY-PI.md, et le script vous y renvoie une
# fois l'application en route.
#
# Options :
#   --dir <chemin>      dossier d'installation      (défaut : /opt/parcelys)
#   --data <chemin>     dossier de données          (défaut : /var/lib/parcelys)
#   --db <nom>          nom de la base              (défaut : parcelys)
#   --user <nom>        compte de service           (défaut : parcelys)
#   --domain <domaine>  domaine public              (défaut : parcelys.fr)
#   --port <port>       port d'écoute local         (défaut : 3000)
#   --branch <branche>  branche à installer         (défaut : main)
#   --backup-dir <chem> destination des sauvegardes (défaut : /var/backups/parcelys)
#   --no-service        n'installe pas l'unité systemd
#   --dry-run           montre les actions sans rien exécuter

set -euo pipefail

# --- Réglages ---------------------------------------------------------------

APP_DIR=/opt/parcelys
DATA_DIR=/var/lib/parcelys
DB_NAME=parcelys
SERVICE_USER=parcelys
DOMAIN=parcelys.fr
PORT=3000
BRANCH=main
BACKUP_DIR=/var/backups/parcelys
INSTALL_SERVICE=1
DRY_RUN=0
REPO_URL=https://github.com/kryptonproject-crypto/parcelys.git
NODE_MAJOR=22

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        APP_DIR="$2"; shift 2 ;;
    --data)       DATA_DIR="$2"; shift 2 ;;
    --db)         DB_NAME="$2"; shift 2 ;;
    --user)       SERVICE_USER="$2"; shift 2 ;;
    --domain)     DOMAIN="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --repo)       REPO_URL="$2"; shift 2 ;;
    --no-service) INSTALL_SERVICE=0; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

ENV_FILE="$APP_DIR/.env"
SERVICE_FILE="/etc/systemd/system/parcelys.service"

# --- Présentation -----------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); GREEN=$(printf '\033[32m')
  AMBER=$(printf '\033[33m'); RED=$(printf '\033[31m'); OFF=$(printf '\033[0m')
else
  BOLD=''; GREEN=''; AMBER=''; RED=''; OFF=''
fi

step()  { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '  %s!%s %s\n' "$AMBER" "$OFF" "$1"; }
die()   { printf '\n  %s✗ %s%s\n\n' "$RED" "$1" "$OFF" >&2; exit 1; }

# Exécute, ou montre seulement en mode simulation.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  · %s\n' "$*"
  else
    "$@"
  fi
}

# Idem pour une commande qui a besoin d'un shell (redirections, tubes).
run_sh() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  · sh -c %s\n' "$1"
  else
    sh -c "$1"
  fi
}

# `systemctl` n'existe pas partout : conteneurs, WSL, chroot d'installation.
# On retombe sur `service`, et on renonce sans faire échouer l'installation —
# le reste du travail garde son sens.
HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  HAS_SYSTEMD=1
fi

service_do() {
  action=$1; unit=$2
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  · systemctl %s %s\n' "$action" "$unit"
    return 0
  fi
  if [ "$HAS_SYSTEMD" -eq 1 ]; then
    systemctl "$action" "$unit" >/dev/null 2>&1 && return 0
  fi
  service "$unit" "$action" >/dev/null 2>&1 && return 0
  return 1
}

# --- Contrôles préalables ---------------------------------------------------

step "Contrôles préalables"

[ "$(id -u)" -eq 0 ] || die "À lancer avec sudo : sudo bash $0"

command -v apt-get >/dev/null 2>&1 \
  || die "Ce script vise Debian et Ubuntu (Raspberry Pi OS compris)."

ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64|x86_64)
    ok "Architecture $ARCH" ;;
  armv7l|armv6l)
    die "Système 32 bits ($ARCH). Parcelys réclame un système 64 bits : le
     client PostgreSQL ne fournit pas de binaire pour cette architecture.
     Réinstallez Raspberry Pi OS en version 64 bits." ;;
  *)
    warn "Architecture inhabituelle ($ARCH) : on continue, sans garantie." ;;
esac

TOTAL_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$((TOTAL_MB + SWAP_MB))" -lt 3500 ]; then
  warn "Mémoire + échange : ${TOTAL_MB} + ${SWAP_MB} Mo. La compilation de Next
    en réclame davantage. Le script ajoutera de l'échange."
  NEED_SWAP=1
else
  ok "Mémoire suffisante (${TOTAL_MB} Mo + ${SWAP_MB} Mo d'échange)"
  NEED_SWAP=0
fi

FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${FREE_GB:-0}" -lt 8 ]; then
  die "Il reste ${FREE_GB} Go sur la racine ; comptez 8 Go au minimum."
fi
ok "Espace disque : ${FREE_GB} Go libres"

# Support de la racine. Une mémoire flash grand public — carte microSD comme
# clé USB — encaisse mal les écritures aléatoires incessantes de PostgreSQL.
# On ne refuse pas d'installer : on adapte les réglages et on insiste sur les
# sauvegardes, qui sont alors la seule protection réelle.
ROOT_SRC=$(findmnt -n -o SOURCE / 2>/dev/null || echo '')
ROOT_DISK=$(lsblk -no PKNAME "$ROOT_SRC" 2>/dev/null | head -1 || echo '')
ON_FLASH=0

case "$ROOT_SRC" in
  /dev/mmcblk*)
    ON_FLASH=1
    warn "Racine sur carte microSD ($ROOT_SRC). PostgreSQL écrit sans cesse et
    l'usera. Les réglages seront adaptés, mais sauvegardez ailleurs, tous les
    jours — c'est ce qui vous sauvera le jour où la carte lâchera." ;;
  *)
    # `rota=0` et un transport USB : très probablement une clé, pas un SSD.
    if [ -n "$ROOT_DISK" ] && [ "$(cat "/sys/block/$ROOT_DISK/queue/rotational" 2>/dev/null || echo 1)" = "0" ] &&
       [ "$(lsblk -no TRAN "/dev/$ROOT_DISK" 2>/dev/null | head -1)" = "usb" ]; then
      ON_FLASH=1
      ok "Racine sur $ROOT_SRC (USB)"
      warn "S'il s'agit d'une clé USB et non d'un SSD, son endurance en écriture
    est faible : les réglages seront adaptés, et les sauvegardes quotidiennes
    hors machine deviennent indispensables."
    else
      [ -n "$ROOT_SRC" ] && ok "Racine sur $ROOT_SRC"
    fi ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n  %sSimulation : rien ne sera modifié.%s\n' "$AMBER" "$OFF"
fi

# --- Mémoire d'échange ------------------------------------------------------

if [ "$NEED_SWAP" -eq 1 ]; then
  step "Mémoire d'échange"

  # Sur mémoire flash, un fichier d'échange est le meilleur moyen d'user le
  # support : c'est l'usage le plus intensif en écriture qui soit. zram
  # comprime en mémoire vive et n'écrit rien sur le disque. On y gagne moins
  # de place qu'avec un fichier, mais assez pour compiler.
  if [ "$ON_FLASH" -eq 1 ]; then
    run_sh "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq zram-tools >>'/var/log/parcelys-install.log' 2>&1 || true"
    if [ -f /etc/default/zramswap ] || [ -d /etc/default ]; then
      if [ "$DRY_RUN" -eq 0 ]; then
        # La moitié de la mémoire vive, comprimée : compte double en pratique.
        printf 'ALGO=zstd\nPERCENT=60\nPRIORITY=100\n' > /etc/default/zramswap
      fi
      if service_do restart zramswap || service_do start zramswap; then
        ok "Échange compressé en mémoire (zram) — aucune écriture disque"
      else
        warn "zram n'a pas pu démarrer ; la compilation risque de manquer de
    mémoire. Relancez-la au besoin avec :
    NODE_OPTIONS=--max-old-space-size=2048 npm run build"
      fi
    fi
  elif [ -f /etc/dphys-swapfile ]; then
    run_sh "dphys-swapfile swapoff || true"
    run_sh "sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile"
    run_sh "dphys-swapfile setup >/dev/null && dphys-swapfile swapon"
    ok "2 Go d'échange (dphys-swapfile)"
  elif [ ! -f /swapfile ]; then
    run_sh "fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile"
    run_sh "grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab"
    ok "2 Go d'échange (/swapfile)"
  else
    ok "Fichier d'échange déjà en place"
  fi
fi

# --- Paquets ----------------------------------------------------------------

step "Paquets système"

# La sortie d'apt part dans un journal : on ne la montre qu'en cas d'échec.
# Des dizaines de lignes de « Setting up… » noieraient les messages qui
# comptent, et le script en produit peu.
APT_LOG=/var/log/parcelys-install.log
run_sh "apt-get update -qq >>'$APT_LOG' 2>&1 || { tail -20 '$APT_LOG'; exit 1; }"
run_sh "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git ca-certificates gnupg ufw postgresql postgresql-postgis \
  >>'$APT_LOG' 2>&1 || { tail -20 '$APT_LOG'; exit 1; }"
ok "PostgreSQL, PostGIS, git, ufw (journal : $APT_LOG)"

if command -v node >/dev/null 2>&1 &&
   [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; then
  ok "Node.js $(node --version) déjà présent"
else
  run_sh "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - >>'$APT_LOG' 2>&1"
  run_sh "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs \
    >>'$APT_LOG' 2>&1 || { tail -20 '$APT_LOG'; exit 1; }"
  ok "Node.js installé"
fi

# --- Base de données --------------------------------------------------------

step "Base de données"

service_do start postgresql || true
if [ "$HAS_SYSTEMD" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  systemctl enable postgresql >/dev/null 2>&1 || true
fi

# On s'assure que la base répond avant de lui parler. Sans ce contrôle, le
# script enchaînait sur des erreurs psql brutes, illisibles pour qui découvre
# l'installation — alors que la cause tient en une phrase.
if [ "$DRY_RUN" -eq 0 ]; then
  WAITED=0
  until su postgres -c 'psql -tAc "SELECT 1"' >/dev/null 2>&1; do
    [ "$WAITED" -ge 30 ] && die "PostgreSQL ne répond pas après 30 secondes.
     Vérifiez son état :  sudo systemctl status postgresql
     et ses journaux    :  sudo journalctl -u postgresql -n 30"
    sleep 2
    WAITED=$((WAITED + 2))
  done
  ok "PostgreSQL répond"
fi

# Mot de passe conservé s'il existe déjà : relancer le script ne doit pas
# invalider la configuration en place.
if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  DB_PASSWORD=$(sed -n 's|^DATABASE_URL="postgresql://[^:]*:\([^@]*\)@.*|\1|p' "$ENV_FILE" | head -1)
  ok "Mot de passe de base repris de la configuration existante"
else
  DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
  ok "Mot de passe de base engendré"
fi
[ -n "$DB_PASSWORD" ] || die "Impossible de déterminer le mot de passe de la base."

if [ "$DRY_RUN" -eq 0 ]; then
  ROLE_EXISTS=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$SERVICE_USER'\"" || echo '')
  if [ "$ROLE_EXISTS" = "1" ]; then
    su postgres -c "psql -qc \"ALTER ROLE $SERVICE_USER WITH LOGIN PASSWORD '$DB_PASSWORD'\"" >/dev/null
    ok "Rôle « $SERVICE_USER » mis à jour"
  else
    su postgres -c "psql -qc \"CREATE ROLE $SERVICE_USER LOGIN PASSWORD '$DB_PASSWORD'\"" >/dev/null
    ok "Rôle « $SERVICE_USER » créé"
  fi

  DB_EXISTS=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" || echo '')
  if [ "$DB_EXISTS" = "1" ]; then
    ok "Base « $DB_NAME » déjà présente"
  else
    su postgres -c "createdb -O $SERVICE_USER $DB_NAME"
    ok "Base « $DB_NAME » créée"
  fi

  su postgres -c "psql -d $DB_NAME -qc 'CREATE EXTENSION IF NOT EXISTS postgis'" >/dev/null
  POSTGIS=$(su postgres -c "psql -d $DB_NAME -tAc 'SELECT postgis_lib_version()'" 2>/dev/null || echo '')
  [ -n "$POSTGIS" ] || die "PostGIS ne s'est pas activé. Sans lui, aucune superficie
     n'est calculable : l'installation s'arrête ici."
  ok "PostGIS $POSTGIS actif"
else
  printf '  · création du rôle, de la base, puis activation de PostGIS\n'
fi

# Réglages adaptés à une petite machine.
if [ "$DRY_RUN" -eq 0 ]; then
  su postgres -c "psql -qc \"ALTER SYSTEM SET shared_buffers = '256MB'\"" >/dev/null
  su postgres -c "psql -qc \"ALTER SYSTEM SET work_mem = '16MB'\"" >/dev/null
  su postgres -c "psql -qc \"ALTER SYSTEM SET random_page_cost = 1.1\"" >/dev/null

  # Sur mémoire flash, on espace les écritures plutôt que d'en réduire la
  # sûreté. Des points de reprise plus rares et étalés, un journal comprimé :
  # la base reste aussi fiable, elle écrit simplement moins souvent.
  # `synchronous_commit` n'est PAS touché — le désactiver ferait perdre les
  # dernières transactions en cas de coupure, ce qu'un registre réglementaire
  # ne peut pas se permettre.
  if [ "$ON_FLASH" -eq 1 ]; then
    su postgres -c "psql -qc \"ALTER SYSTEM SET checkpoint_timeout = '30min'\"" >/dev/null
    su postgres -c "psql -qc \"ALTER SYSTEM SET checkpoint_completion_target = 0.9\"" >/dev/null
    su postgres -c "psql -qc \"ALTER SYSTEM SET max_wal_size = '2GB'\"" >/dev/null
    su postgres -c "psql -qc \"ALTER SYSTEM SET wal_compression = on\"" >/dev/null
    su postgres -c "psql -qc \"ALTER SYSTEM SET bgwriter_lru_maxpages = 100\"" >/dev/null
    su postgres -c "psql -qc \"ALTER SYSTEM SET log_min_duration_statement = -1\"" >/dev/null
    ok "Écritures espacées pour ménager la mémoire flash"
  fi
  if service_do restart postgresql; then
    ok "PostgreSQL réglé pour une petite machine"
  else
    warn "Réglages enregistrés, mais PostgreSQL n'a pas pu être redémarré.
    Ils prendront effet au prochain redémarrage du service."
  fi
fi

# --- Compte de service et dossiers ------------------------------------------

step "Compte de service et dossiers"

if id "$SERVICE_USER" >/dev/null 2>&1; then
  ok "Compte système « $SERVICE_USER » déjà présent"
else
  run adduser --system --group --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "Compte système « $SERVICE_USER » créé"
fi

run mkdir -p "$DATA_DIR/documents" "$DATA_DIR/ephy"
run chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
ok "Dossiers de données : $DATA_DIR"

# --- Code -------------------------------------------------------------------

step "Code de l'application"

if [ -d "$APP_DIR/.git" ]; then
  run_sh "cd '$APP_DIR' && sudo -u '$SERVICE_USER' git fetch --quiet origin '$BRANCH'"
  run_sh "cd '$APP_DIR' && sudo -u '$SERVICE_USER' git checkout --quiet '$BRANCH'"
  run_sh "cd '$APP_DIR' && sudo -u '$SERVICE_USER' git pull --quiet --ff-only origin '$BRANCH'"
  ok "Dépôt mis à jour sur « $BRANCH »"
else
  run_sh "git clone --quiet --branch '$BRANCH' '$REPO_URL' '$APP_DIR'"
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  ok "Dépôt cloné dans $APP_DIR"
fi

# --- Configuration ----------------------------------------------------------

step "Configuration"

if [ -f "$ENV_FILE" ]; then
  ok "Fichier .env existant conservé — rien n'est écrasé"
  warn "Vérifiez APP_URL et les variables SMTP_* avant d'ouvrir le service."
else
  if [ "$DRY_RUN" -eq 0 ]; then
    cat > "$ENV_FILE" <<ENVFILE
# Configuration de Parcelys — engendrée par scripts/install-pi.sh
# $(date '+%d/%m/%Y %H:%M')

NODE_ENV=production

DATABASE_URL="postgresql://$SERVICE_USER:$DB_PASSWORD@localhost:5432/$DB_NAME?schema=public"

# L'adresse publique servie par Cloudflare. Elle sert aux liens des e-mails, au
# contrôle d'origine CSRF et au marquage Secure des cookies : une valeur
# approximative fait échouer les connexions sans message clair.
APP_URL="https://$DOMAIN"
APP_NAME="Parcelys"

# Derrière un tunnel Cloudflare, c'est CF-Connecting-IP qui porte l'adresse
# réelle du visiteur : Cloudflare l'écrase à chaque requête, il ne peut donc pas
# être forgé, contrairement à X-Forwarded-For.
CLIENT_IP_HEADER=cf-connecting-ip

# Un Raspberry Pi hache plus lentement qu'un serveur : 11 garde une connexion
# vive sans rogner sérieusement sur la sécurité.
PASSWORD_HASH_COST=11

# À COMPLÉTER avant d'inviter d'autres comptes. « console » écrit les codes de
# vérification dans les journaux au lieu de les envoyer.
#   sudo journalctl -u parcelys | grep -A 6 "code de vérification"
#
# N'installez pas de serveur SMTP sur le Pi : une IP résidentielle est rejetée
# par à peu près tous les destinataires. Servez-vous de celui de votre
# hébergeur de domaine.
EMAIL_PROVIDER=console
EMAIL_FROM="Parcelys <no-reply@$DOMAIN>"
# EMAIL_PROVIDER=smtp
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_SECURE=false

UPLOAD_DIR="$DATA_DIR/documents"
EPHY_DATA_DIR="$DATA_DIR/ephy"

# Catalogue officiel des produits phytopharmaceutiques (ANSES, data.gouv.fr).
# Sans lui, la recherche de produits reste vide et les registres le signalent.
#   sudo -u $SERVICE_USER npm run ephy:sync
# EPHY_DATA_URL="https://…/ephy.zip"

# Dépôt surveillé pour les mises à jour. Rien ne s'installe automatiquement.
UPDATE_REPOSITORY="kryptonproject-crypto/parcelys"

RATE_LIMIT_ENABLED=true
ENVFILE
    chmod 600 "$ENV_FILE"
    chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  fi
  ok "Fichier .env créé (mot de passe de base engendré, permissions 600)"
fi

# --- Dépendances et compilation ---------------------------------------------

step "Dépendances et compilation"

printf '  Cette étape prend 10 à 20 minutes sur un Raspberry Pi.\n'

# npm peut échouer **en renvoyant 0** : le défaut « Exit handler never called »
# laisse une installation à moitié faite et un code de sortie trompeur. On
# vérifie donc le résultat sur le disque, jamais le code de retour seul.
npm_install_ok() {
  [ -x "$APP_DIR/node_modules/.bin/next" ] && [ -x "$APP_DIR/node_modules/.bin/prisma" ]
}

if [ "$DRY_RUN" -eq 0 ]; then
  sudo -u "$SERVICE_USER" sh -c "cd '$APP_DIR' && npm ci --no-audit --no-fund" || true

  if ! npm_install_ok; then
    # Deuxième essai sous root, puis restitution des droits. Certains systèmes
    # refusent à un compte système les liens de `node_modules/.bin`.
    warn "L'installation sous « $SERVICE_USER » n'a pas abouti ; nouvel essai
    en tant que root, puis restitution des droits."
    rm -rf "$APP_DIR/node_modules"
    ( cd "$APP_DIR" && npm ci --no-audit --no-fund ) || true
    chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  fi

  npm_install_ok || die "Les dépendances ne se sont pas installées.
     Journal :  ls $APP_DIR/.npm/_logs/
     Réessayez :  cd $APP_DIR && sudo -u $SERVICE_USER npm ci"
  ok "Dépendances installées"
else
  printf '  · npm ci, puis vérification de node_modules/.bin\n'
fi

run_sh "cd '$APP_DIR' && sudo -u '$SERVICE_USER' npm run db:deploy"
ok "Migrations appliquées"

# La limite mémoire évite que la compilation soit tuée sur une petite machine.
run_sh "cd '$APP_DIR' && sudo -u '$SERVICE_USER' env NODE_OPTIONS=--max-old-space-size=2048 npm run build"

# Même prudence : c'est la présence du serveur autonome ET de ses fichiers
# statiques qui atteste d'une compilation complète. Sans les seconds, le site
# s'afficherait sans aucune mise en forme, et rien ne le signalerait.
if [ "$DRY_RUN" -eq 0 ]; then
  [ -f "$APP_DIR/.next/standalone/server.js" ] \
    || die "La compilation n'a pas produit de serveur autonome.
     Relancez :  cd $APP_DIR && sudo -u $SERVICE_USER npm run build"
  [ -d "$APP_DIR/.next/standalone/.next/static" ] \
    || die "Les fichiers statiques manquent dans la sortie autonome.
     Relancez :  cd $APP_DIR && sudo -u $SERVICE_USER npm run build"
fi
ok "Application compilée"

# --- Service ----------------------------------------------------------------

if [ "$INSTALL_SERVICE" -eq 1 ]; then
  step "Service systemd"

  if [ "$DRY_RUN" -eq 0 ]; then
    cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Parcelys — gestion parcellaire agricole
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=PORT=$PORT
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
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=$DATA_DIR $APP_DIR/.next

[Install]
WantedBy=multi-user.target
UNIT
    if [ "$HAS_SYSTEMD" -eq 1 ]; then
      systemctl daemon-reload
      systemctl enable --quiet parcelys
      systemctl restart parcelys
      ok "Service installé et démarré"
    else
      warn "Unité écrite dans $SERVICE_FILE, mais systemd n'est pas actif ici :
    elle démarrera au prochain amorçage de la machine."
    fi
  else
    ok "Service installé et démarré"
  fi
fi

# --- Sauvegardes ------------------------------------------------------------

step "Sauvegardes"

# Sur mémoire flash, la question n'est pas de savoir *si* le support lâchera
# mais quand. Les sauvegardes ne sont donc pas une option qu'on ajoutera plus
# tard : elles sont la seule chose qui distingue une panne d'un désastre.

BACKUP_BIN=/usr/local/bin/parcelys-backup
BACKUP_CONF=/etc/default/parcelys-backup

if [ -f "$APP_DIR/scripts/backup.sh" ] || [ "$DRY_RUN" -eq 1 ]; then
  run install -m 755 "$APP_DIR/scripts/backup.sh" "$BACKUP_BIN"
  run mkdir -p "$BACKUP_DIR"
  # Un dump contient tout : comptes, registres, empreintes de mots de passe.
  run chmod 700 "$BACKUP_DIR"

  # Une clé USB débranchée laisse son point de montage vide et l'écriture
  # retombe silencieusement sur la carte SD : la sauvegarde ne protégerait
  # alors plus de rien. Si la destination est sur un autre support, on demande
  # au script d'exiger qu'il soit bien monté.
  BACKUP_SRC=$(findmnt -n -o SOURCE --target "$BACKUP_DIR" 2>/dev/null || echo '')
  REQUIRE_MOUNT=''
  if [ -n "$BACKUP_SRC" ] && [ "$BACKUP_SRC" != "$ROOT_SRC" ]; then
    REQUIRE_MOUNT=1
    ok "Destination $BACKUP_DIR sur $BACKUP_SRC — support distinct du système"
  else
    warn "Les sauvegardes iront sur le même support que le système.
    Elles disparaîtront avec lui. Branchez une clé USB ou un disque, montez-le,
    puis relancez avec « --backup-dir /media/… » (§ 4 bis du guide)."
  fi

  if [ "$DRY_RUN" -eq 0 ]; then
    cat > "$BACKUP_CONF" <<CONF
# Réglages de la sauvegarde de Parcelys, lus par $BACKUP_BIN.
# La forme « : "\${VAR:=valeur}" » n'écrase pas une variable déjà définie.
: "\${PARCELYS_DB:=$DB_NAME}"
: "\${PARCELYS_DATA_DIR:=$DATA_DIR}"
: "\${PARCELYS_BACKUP_DIR:=$BACKUP_DIR}"
: "\${PARCELYS_BACKUP_KEEP_DAYS:=14}"
CONF
    # Ajouté à part : le corps varie, et la ligne doit arriver telle quelle dans
    # le fichier — c'est le script de sauvegarde qui l'interprétera, pas nous.
    # shellcheck disable=SC2016  # la ligne doit rester littérale dans le fichier
    if [ -n "$REQUIRE_MOUNT" ]; then
      printf '\n# Refuse la sauvegarde si le support externe est absent.\n' >> "$BACKUP_CONF"
      printf ': "${PARCELYS_BACKUP_REQUIRE_MOUNT:=1}"\n' >> "$BACKUP_CONF"
    else
      printf '\n# À décommenter une fois la destination sur un support externe :\n' >> "$BACKUP_CONF"
      printf '# : "${PARCELYS_BACKUP_REQUIRE_MOUNT:=1}"\n' >> "$BACKUP_CONF"
    fi
    chmod 644 "$BACKUP_CONF"
  fi
  ok "Réglages dans $BACKUP_CONF"

  # Planification quotidienne. `Persistent=true` rattrape l'exécution manquée
  # si le Pi était éteint à l'heure dite — sur une machine domestique, c'est
  # la différence entre une sauvegarde et une intention.
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    cat > /etc/systemd/system/parcelys-backup.service <<UNIT
[Unit]
Description=Sauvegarde de Parcelys
After=postgresql.service
Requires=postgresql.service

[Service]
Type=oneshot
ExecStart=$BACKUP_BIN
UNIT
    cat > /etc/systemd/system/parcelys-backup.timer <<UNIT
[Unit]
Description=Sauvegarde quotidienne de Parcelys

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --quiet --now parcelys-backup.timer
    ok "Sauvegarde quotidienne à 02h30 (systemctl list-timers parcelys-backup)"
  elif [ "$DRY_RUN" -eq 0 ]; then
    printf '30 2 * * * root %s >> /var/log/parcelys-backup.log 2>&1\n' "$BACKUP_BIN" \
      > /etc/cron.d/parcelys-backup
    chmod 644 /etc/cron.d/parcelys-backup
    ok "Sauvegarde quotidienne à 02h30 (cron)"
  else
    ok "Sauvegarde quotidienne à 02h30"
  fi

  # Une sauvegarde jamais exécutée n'est qu'une hypothèse : on la lance une
  # fois, tout de suite, pour que l'échec éventuel se produise devant vous.
  if [ "$DRY_RUN" -eq 0 ]; then
    if "$BACKUP_BIN" >/tmp/parcelys-backup-test.log 2>&1; then
      ok "Première sauvegarde effectuée et relue : $(find "$BACKUP_DIR" -maxdepth 1 -name 'base-*.sql.gz' | wc -l) archive(s)"
    else
      warn "La première sauvegarde a échoué. Détail :"
      sed 's/^/    /' /tmp/parcelys-backup-test.log | tail -8
    fi
    rm -f /tmp/parcelys-backup-test.log
  fi
else
  warn "scripts/backup.sh introuvable : sauvegardes non installées."
fi

# --- Pare-feu ---------------------------------------------------------------

step "Pare-feu"

# Avec un tunnel, aucun port n'est à ouvrir sur Internet : la connexion part du
# Pi. On n'autorise SSH que depuis le réseau local.
LAN=$(ip -4 -o route show to default 2>/dev/null | awk '{print $3}' | head -1 | sed 's/\.[0-9]*$/.0\/24/')
if [ -n "$LAN" ]; then
  run_sh "ufw --force default deny incoming >/dev/null"
  run_sh "ufw --force default allow outgoing >/dev/null"
  run_sh "ufw allow from $LAN to any port 22 comment 'SSH réseau local' >/dev/null"
  ok "SSH autorisé depuis $LAN, tout le reste refusé"
  warn "Le pare-feu n'est PAS activé automatiquement : vérifiez la règle
    ci-dessus, puis « sudo ufw enable ». Une règle erronée vous couperait
    l'accès à votre propre machine."
else
  warn "Réseau local non détecté : réglez ufw à la main (§ 5 du guide)."
fi

# --- Vérification -----------------------------------------------------------

step "Vérification"

if [ "$DRY_RUN" -eq 0 ]; then
  sleep 4
  HEALTH=$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo '')
  case "$HEALTH" in
    *'"status":"ok"'*)
      ok "L'application répond : $HEALTH" ;;
    *)
      printf '\n'
      warn "L'application ne répond pas encore correctement."
      printf '    sudo systemctl status parcelys\n'
      printf '    sudo journalctl -u parcelys -n 50\n'
      printf '    cd %s && sudo -u %s npm run preflight\n' "$APP_DIR" "$SERVICE_USER" ;;
  esac
fi

# --- Suite ------------------------------------------------------------------

cat <<FIN

${BOLD}Installation terminée.${OFF}

L'application tourne sur http://127.0.0.1:$PORT, et **uniquement** là : elle
n'est joignable ni depuis votre réseau, ni depuis Internet. C'est voulu — le
tunnel Cloudflare s'en chargera.

${BOLD}La suite, à faire à la main${OFF} (§ 12 et 13 de docs/RASPBERRY-PI.md) :

  1. Passer la zone DNS de $DOMAIN chez Cloudflare.
     Vérifiez d'abord que vos enregistrements MX, SPF, DKIM et DMARC sont
     recopiés, sinon vos e-mails cesseront d'arriver.

  2. Installer et ouvrir le tunnel :

     sudo apt install -y cloudflared
     cloudflared tunnel login          # à autoriser depuis un navigateur
     cloudflared tunnel create parcelys
     cloudflared tunnel route dns parcelys $DOMAIN
     cloudflared tunnel route dns parcelys www.$DOMAIN

     puis /etc/cloudflared/config.yml, et :
     sudo cloudflared service install && sudo systemctl enable --now cloudflared

  3. Régler SSL/TLS sur ${BOLD}Full${OFF} dans le tableau de bord Cloudflare.
     En « Flexible », les cookies de session ne reviennent jamais et personne
     ne peut se connecter.

  4. Créer le premier compte sur https://$DOMAIN/inscription — il devient
     administrateur de l'instance, sans code d'invitation.

${BOLD}Aide-mémoire${OFF}

  sudo systemctl status parcelys
  sudo journalctl -u parcelys -f
  cd $APP_DIR && sudo -u $SERVICE_USER npm run preflight
  curl -s http://127.0.0.1:$PORT/api/health

  sudo parcelys-backup                 # sauvegarde immédiate
  ls -lh $BACKUP_DIR                   # ce qui est réellement sauvegardé

FIN
