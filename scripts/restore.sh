#!/usr/bin/env bash
#
# Restauration d'une sauvegarde de Parcelys.
#
#   sudo parcelys-restore                          # essai à blanc de la dernière archive
#   sudo parcelys-restore /chemin/base-....sql.gz  # essai à blanc d'une archive précise
#   sudo parcelys-restore --remplacer              # la vraie restauration, après incident
#
# ─────────────────────────────────────────────────────────────────────────────
# POURQUOI CE SCRIPT EXISTE
# ─────────────────────────────────────────────────────────────────────────────
#
# La sauvegarde était installée, planifiée et vérifiée. La restauration, elle,
# n'était qu'une **procédure écrite** dans le guide : une douzaine de commandes
# `psql` à recopier à la main. C'est-à-dire à recopier le jour où la carte SD a
# lâché, sous la pression, peut-être depuis un téléphone.
#
# Une sauvegarde qu'on ne sait pas restaurer vite n'est pas une sauvegarde.
#
# ─────────────────────────────────────────────────────────────────────────────
# DEUX MODES, ET LE PLUS SÛR PAR DÉFAUT
# ─────────────────────────────────────────────────────────────────────────────
#
# **Essai à blanc** (défaut) : l'archive est restaurée dans une base jetable,
# à côté de celle qui est en service, puis comparée à elle — nombre de lignes
# par table, et empreinte des contours parcellaires. C'est l'exercice qu'il faut
# faire une fois par trimestre, sans rien risquer. La base jetable est effacée
# à la fin.
#
# **Remplacement** (`--remplacer`) : la vraie restauration après incident. Elle
# arrête le service, remplace la base, réinstalle les documents et redémarre.
# Elle exige de retaper le nom de la base : on ne détruit pas des registres
# réglementaires sur une faute de frappe.

set -euo pipefail

if [ -r /etc/default/parcelys-backup ]; then
  # shellcheck source=/dev/null
  . /etc/default/parcelys-backup
fi

DEST=${PARCELYS_BACKUP_DIR:-/var/backups/parcelys}
DB_NAME=${PARCELYS_DB:-parcelys}
DB_USER=${PARCELYS_DB_USER:-parcelys}
DATA_DIR=${PARCELYS_DATA_DIR:-/var/lib/parcelys}
SERVICE=${PARCELYS_SERVICE:-parcelys}

ARCHIVE=''
REMPLACER=0
GARDER_ESSAI=0

while [ $# -gt 0 ]; do
  case "$1" in
    --remplacer) REMPLACER=1; shift ;;
    --garder-essai) GARDER_ESSAI=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) printf 'Option inconnue : %s\n' "$1" >&2; exit 2 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

log() { printf '%s  %s\n' "$(date '+%F %T')" "$1"; }
die() { printf '%s  ERREUR : %s\n' "$(date '+%F %T')" "$1" >&2; exit 1; }

sql() { su postgres -c "psql -tAq -d '$1' -c \"$2\""; }

# --- Quelle archive ? -------------------------------------------------------

if [ -z "$ARCHIVE" ]; then
  # La plus récente. `sort` sur le nom suffit : l'horodatage est en tête et au
  # format ISO, donc l'ordre alphabétique est l'ordre chronologique.
  ARCHIVE=$(find "$DEST" -maxdepth 1 -name 'base-*.sql.gz' | sort | tail -1)
  [ -n "$ARCHIVE" ] || die "aucune archive dans $DEST. Lancez d'abord « sudo parcelys-backup »."
  log "Archive retenue (la plus récente) : $ARCHIVE"
fi

[ -r "$ARCHIVE" ] || die "archive illisible : $ARCHIVE"

# Le même contrôle qu'à l'écriture : une archive gzip peut être valide et son
# contenu SQL tronqué. La ligne finale de pg_dump n'apparaît qu'une fois le dump
# terminé.
gunzip -c "$ARCHIVE" | tail -15 | grep -q 'PostgreSQL database dump complete' \
  || die "cette archive est incomplète ou corrompue : $ARCHIVE
        N'essayez pas de la restaurer. Prenez la précédente."
log "Archive relue et complète."

# L'archive des documents qui porte le même horodatage, s'il y en a une.
STAMP=$(basename "$ARCHIVE" | sed -E 's/^base-(.*)\.sql\.gz$/\1/')
DOCS="$DEST/documents-$STAMP.tar.gz"

# ---------------------------------------------------------------------------
# Mode remplacement
# ---------------------------------------------------------------------------

if [ "$REMPLACER" = 1 ]; then
  printf '\n'
  printf 'Vous allez REMPLACER la base « %s » par le contenu de :\n' "$DB_NAME"
  printf '    %s\n' "$ARCHIVE"
  printf '\nTout ce que la base contient depuis cette sauvegarde sera perdu :\n'
  printf 'parcelles, registres phytosanitaires, apports, campagnes PAC.\n'
  printf '\nPour confirmer, retapez le nom de la base : '
  read -r confirmation
  [ "$confirmation" = "$DB_NAME" ] || die "nom non confirmé ; rien n'a été touché."

  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE"; then
    log "Arrêt de $SERVICE…"
    systemctl stop "$SERVICE"
    REDEMARRER=1
  else
    REDEMARRER=0
  fi

  # Une sauvegarde de ce qu'on s'apprête à écraser. Si l'archive s'avérait
  # mauvaise malgré le contrôle, tout serait perdu sans elle.
  FILET="$DEST/avant-restauration-$(date +%F_%H%M).sql.gz"
  log "Sauvegarde de l'état actuel avant remplacement…"
  su postgres -c "pg_dump --no-owner '$DB_NAME'" | gzip > "$FILET" \
    || log "  (impossible : la base est peut-être déjà perdue — on continue)"
  [ -s "$FILET" ] && log "  filet de sécurité : $FILET"

  log "Remplacement de la base…"
  su postgres -c "dropdb --if-exists '$DB_NAME'"
  su postgres -c "createdb -O '$DB_USER' '$DB_NAME'"
  gunzip -c "$ARCHIVE" | su postgres -c "psql -q -d '$DB_NAME'" \
    || die "la restauration a échoué. Le filet de sécurité est dans $FILET"

  if [ -r "$DOCS" ]; then
    log "Réinstallation des documents joints…"
    mkdir -p "$DATA_DIR"
    tar xzf "$DOCS" -C "$DATA_DIR"
  else
    log "Aucune archive de documents pour cet horodatage ($DOCS)."
  fi

  if [ "$REDEMARRER" = 1 ]; then
    log "Redémarrage de $SERVICE…"
    systemctl start "$SERVICE"
    sleep 3
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT:-3000}/api/health"; then
      log "  le service répond."
    else
      log "  ATTENTION : le service ne répond pas encore. « journalctl -u $SERVICE -n 50 »"
    fi
  fi

  log "Restauration terminée."
  exit 0
fi

# ---------------------------------------------------------------------------
# Mode essai à blanc
# ---------------------------------------------------------------------------

ESSAI="${DB_NAME}_essai"

log "Essai à blanc dans la base « $ESSAI » — « $DB_NAME » n'est pas touchée."
su postgres -c "dropdb --if-exists '$ESSAI'"
su postgres -c "createdb '$ESSAI'"
gunzip -c "$ARCHIVE" | su postgres -c "psql -q -d '$ESSAI'" >/dev/null 2>&1 \
  || die "l'archive n'a pas pu être restaurée dans $ESSAI."
log "Archive restaurée."

# --- Comparaison ------------------------------------------------------------
#
# Deux mesures, et deux questions différentes :
#
#   · le nombre de lignes par table dit si quelque chose manque ;
#   · l'empreinte des contours dit si les géométries sont intactes — ce sont
#     elles qui portent les superficies, donc les déclarations.
#
# Les écarts ne sont pas forcément des défauts : la base en service a continué
# de vivre depuis la sauvegarde. Le script compte les écarts et les nomme, sans
# conclure à la place de qui lit.

compter() {
  sql "$1" "
    SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
      SELECT c.relname AS t,
             (xpath('/row/c/text()', query_to_xml(
                format('SELECT count(*) AS c FROM public.%I', c.relname),
                false, true, '')))[1]::text::bigint AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('spatial_ref_sys', '_prisma_migrations')) s;"
}

empreinte() {
  sql "$1" "SELECT coalesce(md5(string_agg(ST_AsText(geom), '|' ORDER BY id)), 'aucune')
            FROM parcel_geometries;"
}

LIGNES_VIVE=$(compter "$DB_NAME" || echo '')
LIGNES_ESSAI=$(compter "$ESSAI")
GEOM_VIVE=$(empreinte "$DB_NAME" || echo '')
GEOM_ESSAI=$(empreinte "$ESSAI")

printf '\n'
if [ -z "$LIGNES_VIVE" ]; then
  log "La base en service est injoignable : l'archive est restaurable, mais rien à comparer."
  log "Contenu restauré : $LIGNES_ESSAI"
else
  ECARTS=0
  for paire in $LIGNES_ESSAI; do
    table=${paire%%=*}
    nEssai=${paire##*=}
    nVive=$(printf '%s\n' $LIGNES_VIVE | tr ' ' '\n' | grep "^$table=" | cut -d= -f2 || echo '?')
    if [ "$nEssai" != "$nVive" ]; then
      printf '  ~ %-34s sauvegarde %-8s  en service %s\n' "$table" "$nEssai" "$nVive"
      ECARTS=$((ECARTS + 1))
    fi
  done

  if [ "$ECARTS" -eq 0 ]; then
    log "Toutes les tables ont le même nombre de lignes que la base en service."
  else
    log "$ECARTS table(s) diffèrent — normal si la base a vécu depuis la sauvegarde."
  fi

  if [ "$GEOM_VIVE" = "$GEOM_ESSAI" ]; then
    log "Contours parcellaires : empreintes identiques ($GEOM_ESSAI)."
  else
    log "Contours parcellaires : empreintes différentes."
    log "  sauvegarde  : $GEOM_ESSAI"
    log "  en service  : $GEOM_VIVE"
    log "  (attendu si des parcelles ont été modifiées depuis la sauvegarde)"
  fi
fi

# --- Les documents ----------------------------------------------------------

if [ -r "$DOCS" ]; then
  N=$(tar tzf "$DOCS" | grep -c '[^/]$' || true)
  log "Archive des documents : $N fichier(s), relue sans erreur."
else
  log "Aucune archive de documents pour cet horodatage."
fi

if [ "$GARDER_ESSAI" = 1 ]; then
  log "Base d'essai « $ESSAI » conservée, à vous de l'effacer."
else
  su postgres -c "dropdb --if-exists '$ESSAI'"
  log "Base d'essai effacée."
fi

printf '\n'
log "L'archive est restaurable. Pour une vraie restauration : sudo parcelys-restore --remplacer"
