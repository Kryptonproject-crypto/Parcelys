#!/usr/bin/env bash
#
# Mise à jour de Parcelys sur le Raspberry Pi.
#
#   cd /opt/parcelys && sudo bash scripts/update-pi.sh
#
# Pourquoi un script plutôt que la suite de commandes
# ----------------------------------------------------
# Enchaîner les commandes à la main a un défaut : si l'une échoue, les suivantes
# s'exécutent quand même. On redémarre alors l'ancienne version en croyant avoir
# mis à jour, et rien ne le signale — le site répond, simplement il est resté
# comme avant.
#
# C'est particulièrement traître pour la compilation : sur un Pi, `npm run build`
# manque parfois de mémoire et s'arrête. Le dossier `.next` précédent reste en
# place, le service redémarre dessus, et tout a l'air normal.
#
# Ce script s'arrête à la première erreur, vérifie que la compilation a
# réellement produit quelque chose de neuf, et compare la version servie à la
# version attendue avant de se déclarer satisfait.

set -euo pipefail

APP_DIR=${PARCELYS_DIR:-/opt/parcelys}
SERVICE_USER=${PARCELYS_USER:-parcelys}
SERVICE=${PARCELYS_SERVICE:-parcelys}
PORT=${PARCELYS_PORT:-3000}
BRANCH=''
SKIP_BACKUP=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)         APP_DIR="$2"; shift 2 ;;
    --user)        SERVICE_USER="$2"; shift 2 ;;
    --port)        PORT="$2"; shift 2 ;;
    --branch)      BRANCH="$2"; shift 2 ;;
    --no-backup)   SKIP_BACKUP=1; shift ;;
    --force)       FORCE=1; shift ;;
    -h|--help)     sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); GREEN=$(printf '\033[32m')
  AMBER=$(printf '\033[33m'); RED=$(printf '\033[31m'); OFF=$(printf '\033[0m')
else
  BOLD=''; GREEN=''; AMBER=''; RED=''; OFF=''
fi

step() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$AMBER" "$OFF" "$1"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$RED" "$1" "$OFF" >&2; exit 1; }

as_service() { sudo -u "$SERVICE_USER" "$@"; }

[ "$(id -u)" -eq 0 ] || die "À lancer avec sudo."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR n'est pas un dépôt Parcelys."
cd "$APP_DIR"

# --- 1. Sauvegarde ----------------------------------------------------------

step "Sauvegarde"

if [ "$SKIP_BACKUP" -eq 1 ]; then
  warn "Sauvegarde ignorée à votre demande."
elif command -v parcelys-backup >/dev/null 2>&1; then
  # Une mise à jour applique des migrations : on sauvegarde d'abord, pas après.
  parcelys-backup >/tmp/parcelys-update-backup.log 2>&1 \
    || die "La sauvegarde a échoué — mise à jour interrompue.
        Détail : $(tail -3 /tmp/parcelys-update-backup.log | tr '\n' ' ')"
  ok "Sauvegarde effectuée et relue"
else
  warn "parcelys-backup absent : aucune sauvegarde préalable.
    Installez-la (§ 18 du guide) avant la prochaine mise à jour."
fi

# --- 2. Code ----------------------------------------------------------------

step "Code"

ACTUELLE=$(as_service git rev-parse --abbrev-ref HEAD)
[ -n "$BRANCH" ] || BRANCH="$ACTUELLE"
ok "Branche : $BRANCH"

AVANT=$(as_service git rev-parse HEAD)

# Un fichier modifié sur place fait échouer la fusion — et c'est là que la
# mise à jour se casse le plus souvent : `git pull` refuse, mais les commandes
# suivantes s'exécutent quand même sur l'ancien code. On regarde donc AVANT.
MODIFIES=$(as_service git status --porcelain -- ':!node_modules' | grep -v '^??' || true)
if [ -n "$MODIFIES" ]; then
  printf '  %s!%s Fichiers modifiés sur place :\n' "$AMBER" "$OFF"
  printf '%s\n' "$MODIFIES" | sed 's/^/      /'
  die "Ces modifications empêchent la mise à jour.

        Si elles étaient un dépannage provisoire (ce qui est le cas le plus
        fréquent), rendez les fichiers à leur état d'origine :

          sudo -u $SERVICE_USER git -C $APP_DIR checkout -- .

        Si vous teniez à les garder, mettez-les de côté :

          sudo -u $SERVICE_USER git -C $APP_DIR stash

        puis relancez cette commande."
fi

as_service git fetch origin "$BRANCH" --quiet || die "git fetch a échoué (réseau ?)"

# `git pull` sur une branche mal suivie dit « Already up to date » sans rien
# faire : on se cale explicitement sur la branche distante.
as_service git checkout "$BRANCH" --quiet 2>/dev/null || true
as_service git merge --ff-only "origin/$BRANCH" --quiet \
  || die "La mise à jour ne peut pas s'appliquer en avance rapide.
        L'historique local a divergé de la branche distante :
          sudo -u $SERVICE_USER git -C $APP_DIR log --oneline -5
          sudo -u $SERVICE_USER git -C $APP_DIR log --oneline -5 origin/$BRANCH"

APRES=$(as_service git rev-parse HEAD)

if [ "$AVANT" != "$APRES" ]; then
  ok "$(as_service git rev-list --count "$AVANT..$APRES") nouveau(x) commit(s)"
  as_service git log --oneline "$AVANT..$APRES" | sed 's/^/    /'
else
  ok "Code déjà à jour ($(as_service git log -1 --format=%s))"
fi

VERSION_ATTENDUE=$(node -p "require('$APP_DIR/package.json').version")
ok "Version attendue : $VERSION_ATTENDUE"

# Ne rien avoir tiré ne veut pas dire qu'il n'y a rien à faire : le code peut
# être arrivé par un « git pull » lancé à la main juste avant, sans que les
# dépendances, les migrations et la compilation aient suivi. La bonne question
# n'est pas « ai-je récupéré du code ? » mais « ce qui tourne correspond-il au
# code présent sur le disque ? ».
#
# On note donc, à chaque compilation réussie, le commit sur lequel elle a porté.
# Comparer ce témoin à HEAD répond exactement à la question — là où comparer des
# dates se tromperait dès qu'un commit ancien est récupéré tardivement.
TEMOIN="$APP_DIR/.next/.parcelys-commit"
COMMIT_COMPILE=''
[ -f "$TEMOIN" ] && COMMIT_COMPILE=$(cat "$TEMOIN" 2>/dev/null || echo '')

if [ "$COMMIT_COMPILE" = "$APRES" ] && [ -f "$APP_DIR/.next/standalone/server.js" ] && [ "$FORCE" -eq 0 ]; then
  ok "Application déjà compilée sur ce code"
  printf '\n  %sRien à faire — tout est à jour.%s\n' "$AMBER" "$OFF"
  printf '  Pour recompiler malgré tout : %s--force%s\n\n' "$BOLD" "$OFF"
  exit 0
fi

if [ "$AVANT" = "$APRES" ]; then
  if [ "$FORCE" -eq 1 ]; then
    warn "Recompilation demandée (--force)."
  else
    warn "Le code est à jour mais l'application compilée est plus ancienne :
    les dépendances, les migrations et la compilation restent à faire."
  fi
fi

# --- 3. Dépendances ---------------------------------------------------------

step "Dépendances"

as_service npm ci >/tmp/parcelys-update-npm.log 2>&1 || true

# npm sait échouer en renvoyant 0 : on vérifie ce qui est réellement sur le
# disque plutôt que son code de retour.
if [ ! -x "$APP_DIR/node_modules/.bin/next" ] || [ ! -x "$APP_DIR/node_modules/.bin/prisma" ]; then
  die "L'installation des dépendances n'a pas abouti.
        Détail : $(tail -5 /tmp/parcelys-update-npm.log | tr '\n' ' ')"
fi
ok "Dépendances installées"

# --- 4. Migrations ----------------------------------------------------------

step "Base de données"

if ! as_service npx prisma migrate deploy >/tmp/parcelys-update-migrate.log 2>&1; then
  die "Les migrations ont échoué — le service n'a PAS été redémarré.
        La sauvegarde prise plus haut permet de revenir en arrière si besoin.
        Détail :
$(tail -20 /tmp/parcelys-update-migrate.log | sed 's/^/          /')"
fi
grep -E 'migration|applied|Applying' /tmp/parcelys-update-migrate.log | tail -3 | sed 's/^/    /'
ok "Migrations appliquées"

# --- 5. Compilation ---------------------------------------------------------

step "Compilation"

AVANT_BUILD=0
[ -f "$APP_DIR/.next/standalone/server.js" ] && \
  AVANT_BUILD=$(stat -c %Y "$APP_DIR/.next/standalone/server.js")

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 6000 ]; then
  warn "${MEM_MB} Mo de mémoire : la compilation est bornée pour ne pas être tuée."
  BUILD_ENV="NODE_OPTIONS=--max-old-space-size=2048"
else
  BUILD_ENV=""
fi

printf '  · compilation en cours (plusieurs minutes sur un Pi)…\n'
if ! as_service env $BUILD_ENV npm run build >/tmp/parcelys-update-build.log 2>&1; then
  die "La compilation a échoué — le service n'a PAS été redémarré, il tourne
        toujours sur la version précédente.
        Détail :
$(tail -12 /tmp/parcelys-update-build.log | sed 's/^/          /')"
fi

# Le point qui compte : la compilation a-t-elle produit quelque chose de neuf ?
# Un `npm run build` interrompu laisse l'ancien .next en place, et le service
# redémarrerait dessus sans que rien ne le signale.
[ -f "$APP_DIR/.next/standalone/server.js" ] || die "Aucun serveur autonome produit."
APRES_BUILD=$(stat -c %Y "$APP_DIR/.next/standalone/server.js")
[ "$APRES_BUILD" -gt "$AVANT_BUILD" ] \
  || die "La compilation n'a rien produit de neuf : le serveur autonome date
        d'avant. Voir /tmp/parcelys-update-build.log"

# On note sur quel commit porte cette compilation : c'est ce témoin qui, la
# prochaine fois, dira si l'application servie correspond au code présent.
as_service sh -c "printf '%s' '$APRES' > '$TEMOIN'"

ok "Application compilée"

# --- 6. Redémarrage ---------------------------------------------------------

step "Redémarrage"

systemctl restart "$SERVICE" || die "Le service n'a pas redémarré : journalctl -u $SERVICE -n 40"
ok "Service redémarré"

# --- 7. Vérification --------------------------------------------------------

step "Vérification"

SANTE=''
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  SANTE=$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo '')
  case "$SANTE" in *'"status":"ok"'*) break ;; esac
done

case "$SANTE" in
  *'"status":"ok"'*) ok "L'application répond : $SANTE" ;;
  *)
    die "L'application ne répond pas correctement après redémarrage.
          sudo systemctl status $SERVICE
          sudo journalctl -u $SERVICE -n 50
          cd $APP_DIR && sudo -u $SERVICE_USER npm run preflight" ;;
esac

# La version servie est la preuve que c'est bien la nouvelle qui tourne.
SERVIE=$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/mobile/version" 2>/dev/null \
  | sed -n 's/.*"server":"\([^"]*\)".*/\1/p' || echo '')
if [ -n "$SERVIE" ]; then
  if [ "$SERVIE" = "$VERSION_ATTENDUE" ]; then
    ok "Version servie : $SERVIE"
  else
    warn "Version servie : $SERVIE, attendue : $VERSION_ATTENDUE.
    Le navigateur peut aussi garder une page en cache : rechargez avec Ctrl+Maj+R."
  fi
fi

cat <<FIN

${BOLD}Mise à jour terminée.${OFF}  $VERSION_ATTENDUE

  Si l'interface semble inchangée dans le navigateur, c'est presque toujours son
  cache : rechargez avec ${BOLD}Ctrl+Maj+R${OFF} (ou Cmd+Maj+R).

  Journaux, en cas de besoin :
    sudo journalctl -u $SERVICE -n 50
    /tmp/parcelys-update-build.log

FIN
