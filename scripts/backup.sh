#!/usr/bin/env bash
#
# Sauvegarde de Parcelys.
#
#   sudo /usr/local/bin/parcelys-backup [dossier]
#
# Sauvegarde la base et les documents joints. Le dossier de destination peut
# être passé en argument, sinon PARCELYS_BACKUP_DIR, sinon /var/backups/parcelys.
#
# Une sauvegarde qui reste sur la même mémoire que les données ne protège de
# rien : quand le support meurt, il emporte les deux. Visez un autre support —
# une clé USB, un disque externe, un stockage distant.
#
# Le script **vérifie** que ce qu'il vient d'écrire est relisible et complet,
# et supprime toute archive partielle : une archive corrompue qu'on découvre le
# jour de la restauration n'est pas une sauvegarde — elle est pire, parce
# qu'elle a donné l'illusion d'en être une.

set -euo pipefail

# Réglages posés à l'installation (nom de la base, dossiers, destination). Le
# fichier n'emploie que la forme « : "${VAR:=valeur}" », qui n'écrase rien :
# une variable déjà présente dans l'environnement — et a fortiori l'argument de
# ligne de commande — reste prioritaire.
if [ -r /etc/default/parcelys-backup ]; then
  # shellcheck source=/dev/null
  . /etc/default/parcelys-backup
fi

DEST=${1:-${PARCELYS_BACKUP_DIR:-/var/backups/parcelys}}
DB_NAME=${PARCELYS_DB:-parcelys}
DATA_DIR=${PARCELYS_DATA_DIR:-/var/lib/parcelys}
KEEP_DAYS=${PARCELYS_BACKUP_KEEP_DAYS:-14}

STAMP=$(date +%F_%H%M)
BASE="$DEST/base-$STAMP.sql.gz"
DOCS="$DEST/documents-$STAMP.tar.gz"

log() { printf '%s  %s\n' "$(date '+%F %T')" "$1"; }
die() { printf '%s  ERREUR : %s\n' "$(date '+%F %T')" "$1" >&2; exit 1; }

# Taille lisible (« 45K », « 1,2G ») plutôt qu'arrondie au mégaoctet : afficher
# « 1 Mo » pour une archive de 45 Ko donne une fausse idée de ce qui a été écrit.
taille() { du -h "$1" | cut -f1; }

# --- Nettoyage des archives partielles --------------------------------------

# Si le script s'arrête en cours de route — pg_dump qui échoue, disque plein,
# machine éteinte — les fichiers déjà commencés restent sur le disque. Ils
# portent un nom d'archive valide et, pour une base vide, passent même le test
# d'intégrité de gzip. On les efface : mieux vaut constater qu'il manque une
# sauvegarde que croire en avoir une.
TERMINE=0
nettoyer() {
  [ "$TERMINE" = 1 ] && return 0
  local f
  for f in "$BASE" "$DOCS"; do
    if [ -e "$f" ]; then
      rm -f "$f"
      printf '%s  archive incomplète supprimée : %s\n' "$(date '+%F %T')" "$f" >&2
    fi
  done
  return 0
}
trap nettoyer EXIT

# --- Destination ------------------------------------------------------------

mkdir -p "$DEST" || die "impossible de créer $DEST"
[ -w "$DEST" ] || die "$DEST n'est pas inscriptible"

# Une clé USB débranchée laisse son point de montage vide : on écrirait alors
# sur la carte SD sans s'en apercevoir, et la sauvegarde ne protégerait plus de
# rien. On refuse plutôt que de faire semblant.
DEST_SRC=$(findmnt -n -o SOURCE --target "$DEST" 2>/dev/null || echo '')
ROOT_SRC=$(findmnt -n -o SOURCE / 2>/dev/null || echo '')
if [ -n "${PARCELYS_BACKUP_REQUIRE_MOUNT:-}" ] && [ "$DEST_SRC" = "$ROOT_SRC" ]; then
  die "$DEST se trouve sur le même support que le système ($ROOT_SRC).
        Le support externe est-il branché et monté ?"
fi

# --- Place disponible -------------------------------------------------------

DB_SIZE_MB=$(su postgres -c "psql -tAc \"SELECT pg_database_size('$DB_NAME')/1024/1024\"" 2>/dev/null || echo 0)
DOCS_SIZE_MB=$(du -sm "$DATA_DIR/documents" 2>/dev/null | cut -f1 || echo 0)
NEEDED_MB=$(( (DB_SIZE_MB + DOCS_SIZE_MB) / 2 + 100 ))   # compressé, avec marge
FREE_MB=$(df -Pm "$DEST" | tail -1 | awk '{print $4}')

if [ "$FREE_MB" -lt "$NEEDED_MB" ]; then
  die "place insuffisante sur $DEST : ${FREE_MB} Mo libres, ~${NEEDED_MB} Mo nécessaires.
        Réduisez PARCELYS_BACKUP_KEEP_DAYS (actuellement $KEEP_DAYS) ou libérez de la place."
fi

# --- Base de données --------------------------------------------------------

log "Sauvegarde de la base « $DB_NAME »…"
su postgres -c "pg_dump --no-owner '$DB_NAME'" | gzip > "$BASE" \
  || die "pg_dump a échoué"

# Relecture. gunzip décompresse réellement l'archive et contrôle sa somme, ce
# qui écarte une écriture corrompue. Mais un dump interrompu proprement produit
# une archive gzip *valide* dont le contenu SQL est tronqué : on exige donc en
# plus la ligne que pg_dump n'écrit qu'une fois le dump terminé. Elle n'est pas
# toujours la dernière — les versions récentes ajoutent un jeton « \unrestrict »
# après —, d'où la fenêtre de quelques lignes.
gunzip -c "$BASE" | tail -15 | grep -q 'PostgreSQL database dump complete' \
  || die "l'archive de base est incomplète ou corrompue : $BASE"
log "  base : $BASE ($(taille "$BASE"), relue et complète)"

# --- Documents --------------------------------------------------------------

if [ -d "$DATA_DIR/documents" ]; then
  log "Sauvegarde des documents joints…"
  tar czf "$DOCS" -C "$DATA_DIR" documents || die "tar a échoué"
  tar tzf "$DOCS" >/dev/null || die "l'archive de documents est corrompue : $DOCS"
  log "  documents : $DOCS ($(taille "$DOCS"), relue sans erreur)"
else
  log "  aucun document à sauvegarder"
fi

# À partir d'ici les archives sont écrites et vérifiées : elles ne doivent plus
# être effacées, même si la rotation qui suit rencontre un problème.
TERMINE=1

# --- Rotation ---------------------------------------------------------------

# On ne purge qu'après avoir écrit ET vérifié : une sauvegarde ratée ne doit
# jamais entraîner la suppression des précédentes.
DELETED=$(find "$DEST" -maxdepth 1 -name '*.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "  $DELETED archive(s) de plus de $KEEP_DAYS jours supprimée(s)"
fi

REMAINING=$(find "$DEST" -maxdepth 1 -name 'base-*.sql.gz' | wc -l)
log "Terminé — $REMAINING sauvegarde(s) de base dans $DEST"

# Rappel utile : une copie sur un seul support n'est pas une sauvegarde.
if [ "$DEST_SRC" = "$ROOT_SRC" ]; then
  log "AVERTISSEMENT : $DEST est sur le même support que le système."
  log "                Recopiez ces archives ailleurs (clé USB, stockage distant)."
fi
