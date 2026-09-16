#!/usr/bin/env bash
#
# L'unité systemd de Parcelys, et son démarrage automatique.
#
#   sudo bash scripts/service-systemd.sh
#   sudo bash scripts/service-systemd.sh --dir /opt/parcelys --user parcelys --port 3000
#
# ─────────────────────────────────────────────────────────────────────────────
# POURQUOI CE FICHIER EXISTE SÉPARÉMENT
# ─────────────────────────────────────────────────────────────────────────────
#
# L'unité était écrite dans `install-pi.sh`, et nulle part ailleurs. Or
# `update-pi.sh` ne la réécrit jamais : une machine installée il y a six mois
# gardait donc son ancienne unité indéfiniment, et aucune correction de
# démarrage ne lui parvenait — pas même celle qui la faisait revenir après une
# coupure de courant.
#
# Les trois entrées s'appuient désormais sur ce seul fichier :
#
#   · `install-pi.sh`   à l'installation ;
#   · `update-pi.sh`    à chaque mise à jour, pour que les corrections arrivent ;
#   · `check-demarrage.sh` qui y lit l'unité pour la vérifier — au lieu d'en
#     recopier une version qui dériverait.
#
# ─────────────────────────────────────────────────────────────────────────────
# CE QUE L'UNITÉ DOIT GARANTIR
# ─────────────────────────────────────────────────────────────────────────────
#
# Qu'après une coupure de courant, sans personne devant l'écran, Parcelys
# revienne. Les directives qui le permettent sont commentées une à une
# ci-dessous ; `npm run check:demarrage` vérifie qu'elles y sont toutes, et
# sait échouer sur chacune.

set -euo pipefail

APP_DIR=/opt/parcelys
DATA_DIR=/var/lib/parcelys
SERVICE_USER=parcelys
PORT=3000

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)  APP_DIR="$2"; shift 2 ;;
    --data) DATA_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

ENV_FILE="$APP_DIR/.env"
SERVICE_FILE="/etc/systemd/system/parcelys.service"

# Reprises d'`install-pi.sh` quand ce script est appelé seul.
if ! command -v ok >/dev/null 2>&1; then
  if [ -t 1 ]; then
    GREEN=$(printf '\033[32m'); AMBER=$(printf '\033[33m'); OFF=$(printf '\033[0m')
  else
    GREEN=''; AMBER=''; OFF=''
  fi
  ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
  warn() { printf '  %s!%s %s\n' "$AMBER" "$OFF" "$1"; }
fi

HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  HAS_SYSTEMD=1
fi

[ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }

# --- L'unité -----------------------------------------------------------------

# L'unité réelle du cluster, pas la méta-unité.
#
# Sur Debian, `postgresql.service` ne démarre rien : c'est une méta-unité
# dont l'`ExecStart` est `/bin/true`. S'ordonner après elle n'ordonne rien.
# L'unité qui compte s'appelle `postgresql@16-main.service` — le numéro
# varie, on le demande donc au système plutôt que de le supposer.
PG_UNIT=$(
  systemctl list-unit-files 'postgresql@*.service' --no-legend 2>/dev/null |
    awk '{print $1}' | head -1
)
[ -n "$PG_UNIT" ] || PG_UNIT="postgresql.service"

# Où sont réellement `node` et `npm` ?
#
# systemd n'a pas de PATH utilisable : `ExecStart=` exige un chemin absolu.
# L'unité les codait en dur dans `/usr/bin`, ce qui est juste quand ce script
# installe Node depuis les dépôts — mais il accepte aussi un Node **déjà
# présent** (plus haut), sans regarder où. Une installation par nvm ou par
# archive le place ailleurs, et l'unité pointait alors vers un fichier
# inexistant : le service ne démarrait jamais, au premier amorçage comme à
# tous les suivants.
NODE_BIN=$(command -v node 2>/dev/null || echo /usr/bin/node)
NPM_BIN=$(command -v npm 2>/dev/null || echo /usr/bin/npm)

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Parcelys — gestion parcellaire agricole
After=network-online.target postgresql.service $PG_UNIT
Wants=network-online.target postgresql.service

# Pourquoi \`Wants=\` et non \`Requires=\` :
#
# \`Requires=\` fait échouer Parcelys si PostgreSQL échoue — et sur une carte SD,
# un cluster lent à se lever est fréquent alors qu'il finit par répondre. Avec
# \`Requires=\`, une base en recouvrement au moment du démarrage éteignait le
# service pour de bon. C'est \`ExecStartPre\` ci-dessous qui garantit que la base
# répond vraiment, ce qu'aucune dépendance systemd ne sait faire ici.

# Aucune limite au nombre de tentatives de démarrage.
#
# Par défaut, systemd abandonne après 5 échecs en 10 s et laisse le service en
# panne **définitivement**, jusqu'à une intervention manuelle. Pour le serveur
# d'une exploitation, qui redémarre sans personne devant l'écran, c'est le pire
# comportement possible : une coupure de courant un dimanche, et le service
# reste éteint jusqu'au lundi.
#
# Le risque habituel de cette désactivation — une boucle de redémarrage qui
# consomme la machine — n'existe pas ici : chaque tentative attend la base
# jusqu'à 180 s avant d'échouer, la boucle est donc lente et le journal lisible.
#
# Cette directive appartient à [Unit] et non à [Service] : systemd l'y a
# déplacée en version 229, et la laisser dans [Service] provoque un
# avertissement « Unknown key name » sur les versions récentes.
StartLimitIntervalSec=0

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
#
# \`--attendre 180\` : au démarrage de la machine, PostgreSQL et Parcelys partent
# ensemble et la base met plusieurs secondes à ouvrir sa socket. Sans cette
# attente, le contrôle la trouvait injoignable et le service échouait — après un
# redémarrage, Parcelys restait éteint. Voir l'en-tête de scripts/preflight.mjs.
#
# \`node\` directement plutôt que \`npm run\` : un intermédiaire de moins au
# démarrage, et un signal qui atteint le bon processus.
ExecStartPre=$NODE_BIN $APP_DIR/scripts/preflight.mjs --attendre 180
ExecStart=$NPM_BIN run start

# Toujours relancer, y compris après un arrêt propre mais inattendu.
Restart=always
RestartSec=10

# Le contrôle avant démarrage peut attendre la base jusqu'à 180 s : sans cette
# marge, systemd tuerait le démarrage avant que la base ait fini de se lever.
TimeoutStartSec=300

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
  ok "Unité écrite et activée au démarrage"
else
  warn "Unité écrite dans $SERVICE_FILE, mais systemd n'est pas actif ici :
    elle démarrera au prochain amorçage de la machine."
fi

# --- Démarrage automatique ---------------------------------------------------
#
# Écrire l'unité ne suffit pas : encore faut-il que ce dont elle dépend démarre
# aussi. Cette partie vérifie — et corrige — le reste de la chaîne.

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  etat=$(systemctl is-enabled postgresql 2>/dev/null || echo absent)
  if [ "$etat" = enabled ]; then
    ok "postgresql démarrera au prochain amorçage"
  else
    systemctl enable --quiet postgresql >/dev/null 2>&1 &&
      ok "postgresql activé au démarrage (il ne l'était pas : « $etat »)" ||
      warn "postgresql n'a pas pu être activé au démarrage (« $etat »)."
  fi

  # Le cluster ne se lève que si son `start.conf` dit « auto » : le générateur
  # systemd de Debian ne crée le lien de démarrage que dans ce cas. En
  # « manual », la base n'existe pas au démarrage et Parcelys attend en vain.
  for conf in /etc/postgresql/*/*/start.conf; do
    [ -e "$conf" ] || continue
    mode=$(sed 's/#.*$//; /^[[:space:]]*$/d; s/^[[:space:]]*//' "$conf" | head -1)
    cluster=$(basename "$(dirname "$conf")")
    if [ "$mode" = auto ]; then
      ok "cluster $cluster : démarrage automatique"
    else
      warn "cluster $cluster en « $mode » : il ne démarrera pas tout seul.
    Corrigez avec :  echo auto | sudo tee $conf"
    fi
  done

  # Le tunnel : sans lui, le site reste injoignable de l'extérieur après un
  # redémarrage, même si Parcelys tourne parfaitement en local. Ce script ne
  # sait pas le créer — cela demande une autorisation par navigateur — mais s'il
  # est déjà là, il doit démarrer tout seul.
  if systemctl list-unit-files cloudflared.service --no-legend 2>/dev/null | grep -q cloudflared; then
    etat=$(systemctl is-enabled cloudflared 2>/dev/null || echo absent)
    if [ "$etat" = enabled ]; then
      ok "le tunnel Cloudflare démarrera au prochain amorçage"
    else
      systemctl enable --quiet cloudflared >/dev/null 2>&1 &&
        ok "tunnel Cloudflare activé au démarrage (il ne l'était pas)" ||
        warn "Le tunnel Cloudflare n'a pas pu être activé au démarrage."
    fi
  else
    warn "Tunnel Cloudflare absent : après un redémarrage, Parcelys ne sera
    joignable qu'en local. Voir § 13 de docs/RASPBERRY-PI.md."
  fi
fi
