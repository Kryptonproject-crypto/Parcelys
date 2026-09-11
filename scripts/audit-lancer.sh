#!/usr/bin/env bash
#
# Enchaîne les trois audits qui ont besoin d'un serveur et de données.
#
#   bash scripts/audit-lancer.sh            # les trois
#   bash scripts/audit-lancer.sh e2e        # un seul
#
# ─────────────────────────────────────────────────────────────────────────────
# POURQUOI CE LANCEUR
# ─────────────────────────────────────────────────────────────────────────────
#
# Les trois audits partagent la même préparation, et chacune de ses étapes a
# déjà produit un faux résultat au moins une fois :
#
#   - le débit non remis à zéro fait échouer la connexion, et l'audit rapporte
#     « l'exploitant ne se connecte pas » alors que c'est le limiteur qui fait
#     son travail ;
#   - les jeux d'essai sont annoncés sur la sortie standard en JSON **indenté**,
#     donc `tail -1` n'en récupère que l'accolade fermante ;
#   - le serveur laissé d'une exécution précédente sert l'ancien build.
#
# Reproduire cette préparation à la main à chaque fois, c'est réintroduire ces
# trois pièges à chaque fois.

set -euo pipefail

RACINE=$(cd "$(dirname "$0")/.." && pwd)
cd "$RACINE"

QUOI=${1:-tout}

printf '→ remise à zéro des compteurs de débit\n'
npm run audit:debit --silent >/dev/null

printf '→ jeux d’essai\n'
# Le JSON est indenté : on prend le bloc entre la première accolade ouvrante en
# début de ligne et la dernière fermante, pas la dernière ligne.
SORTIE=$(npm run audit:fixtures --silent)
AUDIT_DONNEES=$(printf '%s\n' "$SORTIE" | sed -n '/^{/,/^}/p')
export AUDIT_DONNEES

if ! printf '%s' "$AUDIT_DONNEES" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s))'; then
  printf '✗ les jeux d’essai n’ont pas produit de JSON lisible\n%s\n' "$SORTIE"
  exit 1
fi

code=0
lancer() {
  printf '\n════ %s ════\n' "$1"
  shift
  "$@" || code=1
}

case "$QUOI" in
  pages) lancer 'pages' npm run audit:complet --silent ;;
  api)   lancer 'API' npm run audit:api --silent ;;
  e2e)   lancer 'bout en bout' npm run audit:e2e --silent ;;
  perf)  lancer 'performance' npm run audit:perf --silent ;;
  tout)
    lancer 'pages' npm run audit:complet --silent
    lancer 'API' npm run audit:api --silent
    lancer 'bout en bout' npm run audit:e2e --silent
    lancer 'performance' npm run audit:perf --silent
    ;;
  *) printf 'Usage: %s [pages|api|e2e|perf|tout]\n' "$0"; exit 2 ;;
esac

exit "$code"
