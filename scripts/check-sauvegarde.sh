#!/usr/bin/env bash
#
# Le cycle complet : sauvegarde → restauration → comparaison.
#
#   npm run check:sauvegarde
#
# ─────────────────────────────────────────────────────────────────────────────
# POURQUOI CE CONTRÔLE EXISTE
# ─────────────────────────────────────────────────────────────────────────────
#
# `scripts/backup.sh` vérifie déjà ce qu'il écrit. Mais vérifier qu'une archive
# est relisible n'est pas vérifier qu'elle est **restaurable** : un dump peut
# être complet et refuser de se rejouer (extension absente, ordre des
# contraintes, propriétaire inexistant).
#
# Ce contrôle fait donc le tour complet, sur une base jetable :
#
#   1. il écrit une sauvegarde de la base de développement ;
#   2. il la restaure ailleurs ;
#   3. il compare le nombre de lignes de chaque table ;
#   4. il compare l'empreinte des contours parcellaires — ce sont eux qui
#      portent les superficies, donc les déclarations ;
#   5. il efface la base jetable.
#
# Il ne touche jamais à la base en service : l'essai à blanc de
# `scripts/restore.sh` est précisément prévu pour ça.

set -euo pipefail

RACINE=$(cd "$(dirname "$0")/.." && pwd)
DEST=$(mktemp -d /tmp/parcelys-check-sauvegarde.XXXXXX)
DB_NAME=${PARCELYS_DB:-parcelys}
DATA_DIR=$(mktemp -d /tmp/parcelys-check-donnees.XXXXXX)

echecs=0
attendu() {
  if [ "$1" = 1 ]; then
    printf '✓ %s\n' "$2"
  else
    printf '✗ %s%s\n' "$2" "${3:+ — $3}"
    echecs=$((echecs + 1))
  fi
}

nettoyer() {
  rm -rf "$DEST" "$DATA_DIR"
  su postgres -c "dropdb --if-exists '${DB_NAME}_essai'" 2>/dev/null || true
}
trap nettoyer EXIT

# De quoi vérifier que les documents joints font bien le voyage.
mkdir -p "$DATA_DIR/documents"
printf 'analyse de sol du 12 mars\n' > "$DATA_DIR/documents/analyse.txt"

# --- 1. Écrire ---------------------------------------------------------------

if PARCELYS_DB="$DB_NAME" PARCELYS_DATA_DIR="$DATA_DIR" \
   bash "$RACINE/scripts/backup.sh" "$DEST" > "$DEST/sortie.log" 2>&1; then
  attendu 1 "une sauvegarde est produite"
else
  attendu 0 "une sauvegarde est produite" "$(tail -3 "$DEST/sortie.log")"
  exit 1
fi

ARCHIVE=$(find "$DEST" -maxdepth 1 -name 'base-*.sql.gz' | head -1)
DOCS=$(find "$DEST" -maxdepth 1 -name 'documents-*.tar.gz' | head -1)

attendu "$([ -s "$ARCHIVE" ] && echo 1 || echo 0)" \
  "l'archive de base n'est pas vide" "$(du -h "$ARCHIVE" 2>/dev/null | cut -f1)"
attendu "$([ -s "$DOCS" ] && echo 1 || echo 0)" \
  "les documents joints sont sauvegardés"

# Le marqueur que pg_dump n'écrit qu'une fois terminé : une archive gzip valide
# peut porter un SQL tronqué.
if gunzip -c "$ARCHIVE" | tail -15 | grep -q 'PostgreSQL database dump complete'; then
  attendu 1 "l'archive porte la marque de fin de pg_dump"
else
  attendu 0 "l'archive porte la marque de fin de pg_dump"
fi

# --- 2. Restaurer et comparer ------------------------------------------------

SORTIE=$(PARCELYS_BACKUP_DIR="$DEST" PARCELYS_DB="$DB_NAME" PARCELYS_DATA_DIR="$DATA_DIR" \
  bash "$RACINE/scripts/restore.sh" 2>&1) || true

printf '%s\n' "$SORTIE" | sed 's/^/    /'

if printf '%s' "$SORTIE" | grep -q 'Archive restaurée'; then
  attendu 1 "l'archive se restaure dans une base jetable"
else
  attendu 0 "l'archive se restaure dans une base jetable"
fi

if printf '%s' "$SORTIE" | grep -q 'même nombre de lignes'; then
  attendu 1 "toutes les tables sont restaurées à l'identique"
else
  attendu 0 "toutes les tables sont restaurées à l'identique" \
    "$(printf '%s' "$SORTIE" | grep -c '^  ~ ' || true) table(s) diffèrent"
fi

if printf '%s' "$SORTIE" | grep -q 'empreintes identiques'; then
  attendu 1 "les contours parcellaires sont intacts"
else
  attendu 0 "les contours parcellaires sont intacts"
fi

if printf '%s' "$SORTIE" | grep -q 'Base d.essai effacée'; then
  attendu 1 "la base jetable est effacée après l'essai"
else
  attendu 0 "la base jetable est effacée après l'essai"
fi

# --- 3. L'archive incomplète est-elle refusée ? ------------------------------
#
# Le cas qui compte vraiment : une archive tronquée que gzip déclare bonne.
# Si la restauration l'acceptait, on découvrirait le problème le jour de
# l'incident — c'est-à-dire trop tard.

TRONQUEE="$DEST/base-0000-00-00_0000.sql.gz"
# `head` ferme le tuyau dès qu'il a ses 50 lignes : `gunzip` reçoit SIGPIPE, et
# `set -o pipefail` en fait un échec de tout le script. On isole donc la
# fabrication de l'archive tronquée dans un sous-shell sans `pipefail`.
#
# Sans cette précaution le script s'arrêtait ici en silence : les huit contrôles
# précédents s'affichaient, le neuvième — celui qui compte le plus — ne
# s'exécutait jamais, et le décompte final non plus.
( set +o pipefail; gunzip -c "$ARCHIVE" | head -50 | gzip > "$TRONQUEE" )
if PARCELYS_BACKUP_DIR="$DEST" PARCELYS_DB="$DB_NAME" \
   bash "$RACINE/scripts/restore.sh" "$TRONQUEE" >/dev/null 2>&1; then
  attendu 0 "une archive tronquée est refusée" "elle a été acceptée"
else
  attendu 1 "une archive tronquée est refusée avant toute restauration"
fi

printf '\n%s contrôle(s) en échec.\n' "$echecs"
[ "$echecs" -eq 0 ] || exit 1
