#!/usr/bin/env bash
#
# Démarre le serveur de Parcelys pour un audit, proprement.
#
#   bash scripts/audit-serveur.sh [port]
#
# Pourquoi un script plutôt qu'un « npm start & » :
#
# Un serveur laissé en place d'une vérification à l'autre sert l'ancien build.
# La page rend alors le HTML d'avant, qui référence des feuilles de style que le
# nouveau build a renommées : le navigateur signale « Refused to apply style…
# MIME type text/html », et l'audit croit avoir trouvé un défaut de production
# alors qu'il a trouvé son propre serveur périmé. C'est arrivé.
#
# Ce script arrête donc **toujours** ce qui tourne avant de démarrer, et attend
# que /api/health réponde avant de rendre la main.

set -euo pipefail

PORT=${1:-3000}
RACINE=$(cd "$(dirname "$0")/.." && pwd)
JOURNAL=${PARCELYS_AUDIT_LOG:-/tmp/parcelys-audit-serveur.log}

# --- Arrêter ce qui tourne ---------------------------------------------------
#
# Deux motifs, et non un seul.
#
# `node .next/standalone/server.js` démarre un **enfant** qui se renomme
# `next-server (v15.x)` : c'est lui qui tient le port. Ne viser que
# `standalone/server.js` tue le parent et laisse l'enfant en place ; le nouveau
# serveur ne peut alors pas se lier au port, s'arrête, et le contrôle de santé
# répond — servi par l'ancien.
#
# Ce n'est pas théorique : l'audit a signalé pendant plusieurs minutes des
# feuilles de style « introuvables » qui l'étaient bel et bien, parce que le
# serveur survivant servait le HTML d'un build précédent.
#
# Par la ligne de commande plutôt que par le port : `ss -p` demande des droits
# qu'on n'a pas toujours, et rend alors une liste vide — on croirait le port
# libre.
MOTIF='standalone/server\.js|next-server'

arreter() {
  local signal=$1
  mapfile -t pids < <(pgrep -f "$MOTIF" || true)
  [ ${#pids[@]} -eq 0 ] && return 1
  for pid in "${pids[@]}"; do
    kill "$signal" "$pid" 2>/dev/null || true
  done
  return 0
}

if arreter -TERM; then
  for _ in $(seq 1 20); do
    pgrep -f "$MOTIF" >/dev/null || break
    sleep 0.5
  done
  arreter -KILL || true
  sleep 0.5
  echo "· serveur précédent arrêté"
fi

# --- Démarrer ----------------------------------------------------------------

cd "$RACINE"
PORT="$PORT" nohup node .next/standalone/server.js > "$JOURNAL" 2>&1 &

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
    echo "✓ serveur prêt sur $PORT (journal : $JOURNAL)"
    exit 0
  fi
  sleep 1
done

echo "✗ le serveur n'a pas répondu sur $PORT" >&2
tail -20 "$JOURNAL" >&2
exit 1
