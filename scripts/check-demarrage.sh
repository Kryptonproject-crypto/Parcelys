#!/usr/bin/env bash
#
# Parcelys revient-il tout seul après un redémarrage ?
#
#   npm run check:demarrage              # contrôles sûrs, partout
#   sudo bash scripts/check-demarrage.sh --sur-la-machine
#                                        # + l'état réel des unités
#   sudo bash scripts/check-demarrage.sh --couper-la-base
#                                        # + éprouve l'attente pour de vrai
#
# ─────────────────────────────────────────────────────────────────────────────
# POURQUOI CE CONTRÔLE EXISTE
# ─────────────────────────────────────────────────────────────────────────────
#
# « Le service est installé » et « le service revient après une coupure de
# courant » sont deux affirmations différentes. La première se vérifie d'un
# coup d'œil ; la seconde ne se vérifie qu'en redémarrant, ce qu'on ne fait pas
# volontiers sur la machine qui tient l'exploitation.
#
# Ce script vérifie donc les conditions qui, réunies, font qu'un redémarrage se
# passe bien — et il sait échouer sur chacune.
#
# ─────────────────────────────────────────────────────────────────────────────
# LES DEUX PIÈGES QUI ONT MOTIVÉ CE TRAVAIL
# ─────────────────────────────────────────────────────────────────────────────
#
# 1. **`postgresql.service` ne démarre rien.** Sur Debian c'est une méta-unité
#    dont l'`ExecStart` est `/bin/true` ; le fichier le dit lui-même. Un
#    `After=postgresql.service` n'ordonne donc strictement rien.
#
# 2. **L'unité réelle ignore ses propres échecs.** `postgresql@16-main.service`
#    démarre le cluster avec `ExecStart=-…` — le tiret signifie « ignorer
#    l'échec », et le commentaire Debian l'explique : « recovery might take
#    arbitrarily long ». systemd la déclare démarrée alors que la base peut
#    encore être indisponible.
#
# Conclusion : **aucun ordonnancement systemd ne peut garantir qu'une requête
# passera.** Seule une attente active le peut, et c'est ce que fait
# `preflight.mjs --attendre`. Ce script vérifie qu'elle est bien en place, et
# qu'elle fonctionne.

set -uo pipefail

RACINE=$(cd "$(dirname "$0")/.." && pwd)
SOURCE_UNITE="$RACINE/scripts/service-systemd.sh"
SUR_LA_MACHINE=0
COUPER_LA_BASE=0

for arg in "$@"; do
  case "$arg" in
    --sur-la-machine) SUR_LA_MACHINE=1 ;;
    --couper-la-base) SUR_LA_MACHINE=1; COUPER_LA_BASE=1 ;;
    *) printf 'Option inconnue : %s\n' "$arg"; exit 2 ;;
  esac
done

echecs=0
limites=0

attendu() {
  if [ "$1" = 1 ]; then
    printf '✓ %s\n' "$2"
  else
    printf '✗ %s%s\n' "$2" "${3:+ — $3}"
    echecs=$((echecs + 1))
  fi
}

# Ce qui ne peut pas être vérifié ici : ni un succès ni un échec.
limite() {
  printf '◌ %s — non vérifiable ici : %s\n' "$1" "$2"
  limites=$((limites + 1))
}

# --- 1. L'unité que l'installateur écrit -------------------------------------
#
# Lue dans `scripts/service-systemd.sh`, le seul endroit où elle est écrite —
# `install-pi.sh` et `update-pi.sh` l'appellent tous deux. En recopier une
# version ici ferait dériver le contrôle de ce qui est réellement installé, et
# un contrôle vert porterait alors sur une unité qui n'existe nulle part.

printf '\n▸ l’unité systemd telle que l’installateur l’écrit\n\n'

ATELIER=$(mktemp -d /tmp/parcelys-demarrage.XXXXXX)
UNITE="$ATELIER/parcelys.service"
trap 'rm -rf "$ATELIER"' EXIT

# Les variables du heredoc sont remplacées ici, explicitement.
#
# Pas `envsubst` : il vient de gettext, qui n'est pas installé partout — ni sur
# cette machine, ni forcément sur un Raspberry Pi fraîchement image. Un contrôle
# qui dépend d'un outil absent ne signale pas un défaut de Parcelys, il signale
# son propre environnement — et c'est ce qu'il a fait au premier essai.
NODE_BIN=$(command -v node 2>/dev/null || echo /usr/bin/node)
NPM_BIN=$(command -v npm 2>/dev/null || echo /usr/bin/npm)

# Bornée à la première unité rencontrée : une plage awk se rouvre à chaque
# occurrence, et tant que l'unité vivait dans `install-pi.sh` — qui en écrit
# deux, Parcelys et la sauvegarde — le premier essai les capturait ensemble,
# d'où une section [Timer] parasite et un `Requires=` qui semblait subsister
# alors qu'il venait de l'autre unité. La borne reste utile par précaution.
awk '/^\[Unit\]$/{dedans=1} dedans{print} /^WantedBy=multi-user\.target$/{if(dedans) exit}' \
  "$SOURCE_UNITE" |
  # Le corps du heredoc échappe les accents graves pour le shell : les rendre.
  sed 's/\\`/`/g' |
  sed -e 's#\$APP_DIR#/opt/parcelys#g' \
      -e 's#\$DATA_DIR#/var/lib/parcelys#g' \
      -e 's#\$SERVICE_USER#parcelys#g' \
      -e 's#\$ENV_FILE#/opt/parcelys/.env#g' \
      -e 's#\$PORT#3000#g' \
      -e 's#\$PG_UNIT#postgresql@16-main.service#g' \
      -e "s#[\$]NODE_BIN#${NODE_BIN}#g" \
      -e "s#[\$]NPM_BIN#${NPM_BIN}#g" > "$UNITE"

# Sans extraction, tous les contrôles suivants liraient un fichier vide — et
# ceux qui cherchent l'ABSENCE d'une directive passeraient au vert sur du vide.
# Une réussite sur rien est pire qu'un échec : on s'arrête ici.
if [ ! -s "$UNITE" ] || ! grep -q '^\[Service\]$' "$UNITE"; then
  attendu 0 'l’unité a pu être extraite de l’installateur' \
    'extraction vide ou incomplète — les contrôles suivants seraient sans objet'
  printf '\n✗ %s écart(s).\n' "$echecs"
  exit 1
fi
attendu 1 'l’unité a pu être extraite de l’installateur' \
  "$(wc -l < "$UNITE" | tr -d ' ') lignes"

# systemd valide sa propre syntaxe mieux que n'importe quelle expression
# régulière : une directive mal placée ou mal orthographiée se voit ici.
if command -v systemd-analyze >/dev/null 2>&1; then
  SORTIE=$(systemd-analyze verify "$UNITE" 2>&1)
  # Les avertissements portant sur des chemins absents (/opt/parcelys n'existe
  # pas sur une machine de développement) ne disent rien de la validité.
  # `is not executable` porte sur les binaires du Pi, absents de cette machine
  # de développement : ce n'est pas un défaut de l'unité. Le contrôle suivant
  # vérifie séparément que les chemins sont absolus, et `--sur-la-machine`
  # vérifie qu'ils existent là où ça compte.
  PERTINENT=$(printf '%s\n' "$SORTIE" |
    grep -viE 'not found|does not exist|is not executable|command not found' || true)
  if [ -z "$PERTINENT" ]; then
    attendu 1 'systemd valide la syntaxe de l’unité'
  else
    attendu 0 'systemd valide la syntaxe de l’unité' "$(printf '%s' "$PERTINENT" | head -3)"
  fi
else
  limite 'la validation syntaxique de l’unité' 'systemd-analyze absent'
fi

# --- 2. Les directives qui font qu'un redémarrage se passe bien --------------

printf '\n▸ ce qui rend le redémarrage sûr\n\n'

dans_unite() { grep -qE "$1" "$UNITE"; }

attendu "$(dans_unite '^WantedBy=multi-user\.target$' && echo 1 || echo 0)" \
  'le service est rattaché à la cible de démarrage (WantedBy)'

attendu "$(dans_unite '^Restart=always$' && echo 1 || echo 0)" \
  'le service est toujours relancé (Restart=always)'

# `StartLimitIntervalSec=0` doit être dans [Unit] : systemd l'y a déplacée en
# version 229, et la laisser dans [Service] provoque un avertissement.
SECTION_LIMITE=$(awk '/^\[/{s=$0} /^StartLimitIntervalSec=/{print s}' "$UNITE")
attendu "$([ "$SECTION_LIMITE" = '[Unit]' ] && echo 1 || echo 0)" \
  'la limite de tentatives est levée, dans la bonne section' \
  "trouvée dans ${SECTION_LIMITE:-aucune section}"

attendu "$(dans_unite '^StartLimitIntervalSec=0$' && echo 1 || echo 0)" \
  'systemd n’abandonnera pas après cinq tentatives'

# Le cœur du sujet : l'attente de la base.
attendu "$(dans_unite '^ExecStartPre=.*preflight\.mjs --attendre [0-9]+' && echo 1 || echo 0)" \
  'le démarrage attend que la base réponde vraiment'

ATTENTE=$(grep -oE 'preflight\.mjs --attendre [0-9]+' "$UNITE" | grep -oE '[0-9]+$' || echo 0)
DELAI=$(grep -oE '^TimeoutStartSec=[0-9]+' "$UNITE" | grep -oE '[0-9]+$' || echo 0)
attendu "$([ "$DELAI" -gt "$ATTENTE" ] && echo 1 || echo 0)" \
  'systemd laisse à cette attente le temps d’aboutir' \
  "attente ${ATTENTE} s, délai systemd ${DELAI} s"

# Le piège corrigé : `Requires=postgresql.service` liait le sort de Parcelys à
# une méta-unité qui ne démarre rien, et le faisait échouer pour de bon quand
# le cluster tardait.
attendu "$(dans_unite '^Requires=postgresql\.service$' && echo 0 || echo 1)" \
  'Parcelys ne dépend plus durement d’une méta-unité qui ne démarre rien'

attendu "$(dans_unite '^After=.*postgresql@' && echo 1 || echo 0)" \
  'l’ordre tient compte de l’unité réelle du cluster, pas seulement de la méta-unité'

# systemd n'a pas de PATH : un `ExecStart=node …` ne démarrerait jamais. Et un
# chemin codé en dur vers `/usr/bin` est faux dès que Node vient d'ailleurs —
# l'installateur les résout donc à l'installation.
RELATIFS=$(grep -E '^ExecStart(Pre)?=' "$UNITE" | grep -vcE '^ExecStart(Pre)?=/' || true)
attendu "$([ "${RELATIFS:-1}" -eq 0 ] && echo 1 || echo 0)" \
  'les commandes de démarrage sont des chemins absolus' \
  "${RELATIFS} relative(s)"

attendu "$(grep -qE '^ExecStart(Pre)?=\$' "$UNITE" && echo 0 || echo 1)" \
  'aucune variable n’est restée sans être remplacée'

# --- 3. L'attente fonctionne-t-elle vraiment ? -------------------------------
#
# Les deux points précédents lisent un fichier. Celui-ci exécute le code.

printf '\n▸ l’attente de la base, exécutée\n\n'

if [ "$COUPER_LA_BASE" -eq 1 ]; then
  # Ne jamais faire cela sans qu'on l'ait demandé : couper la base d'une
  # exploitation en service pour éprouver un contrôle serait absurde.
  if ! command -v pg_ctlcluster >/dev/null 2>&1; then
    limite 'l’essai en coupant la base' 'pg_ctlcluster absent'
  else
    VERSION_CLUSTER=$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1" "$2}')
    if [ -z "$VERSION_CLUSTER" ]; then
      limite 'l’essai en coupant la base' 'aucun cluster PostgreSQL détecté'
    else
      # shellcheck disable=SC2086
      pg_ctlcluster $VERSION_CLUSTER stop >/dev/null 2>&1 || true
      sleep 1

      # La base revient au bout de 6 s : l'attente doit la rattraper.
      # shellcheck disable=SC2086
      ( sleep 6; pg_ctlcluster $VERSION_CLUSTER start >/dev/null 2>&1 ) &

      DEBUT=$(date +%s)
      if (cd "$RACINE" && set -a && . ./.env 2>/dev/null; set +a;
          node scripts/preflight.mjs --attendre 60 >/dev/null 2>&1); then
        ECOULE=$(( $(date +%s) - DEBUT ))
        attendu "$([ "$ECOULE" -ge 5 ] && echo 1 || echo 0)" \
          'le démarrage a bien attendu la base au lieu d’échouer' "${ECOULE} s"
      else
        attendu 0 'le démarrage a bien attendu la base au lieu d’échouer' \
          'preflight a échoué alors que la base est revenue'
      fi

      # shellcheck disable=SC2086
      pg_ctlcluster $VERSION_CLUSTER start >/dev/null 2>&1 || true
    fi
  fi
else
  limite 'l’attente éprouvée en coupant réellement la base' \
    'demande --couper-la-base (à ne pas lancer sur la machine en service)'
fi

# --- 4. L'état réel de la machine --------------------------------------------

if [ "$SUR_LA_MACHINE" -eq 1 ]; then
  printf '\n▸ l’état des unités sur cette machine\n\n'

  if ! command -v systemctl >/dev/null 2>&1 ||
     ! systemctl is-system-running >/dev/null 2>&1; then
    limite 'l’état réel des unités' 'systemd n’est pas actif ici'
  else
    for unite in parcelys postgresql; do
      etat=$(systemctl is-enabled "$unite" 2>/dev/null || echo absent)
      attendu "$([ "$etat" = enabled ] && echo 1 || echo 0)" \
        "$unite démarre au boot" "$etat"
    done

    # Le cluster ne démarre que si son `start.conf` dit « auto » : le
    # générateur Debian ne crée le lien que dans ce cas. En « manual », la base
    # ne se lève jamais et Parcelys attend en vain.
    for conf in /etc/postgresql/*/*/start.conf; do
      [ -e "$conf" ] || continue
      mode=$(sed 's/#.*$//; /^[[:space:]]*$/d; s/^[[:space:]]*//' "$conf" | head -1)
      attendu "$([ "$mode" = auto ] && echo 1 || echo 0)" \
        "le cluster $(basename "$(dirname "$conf")") démarre automatiquement" \
        "start.conf : ${mode:-vide}"
    done

    # Le tunnel : sans lui, le site reste injoignable de l'extérieur même si
    # Parcelys tourne. C'est la moitié du « ça remarche après un reboot ».
    if systemctl list-unit-files cloudflared.service >/dev/null 2>&1 &&
       systemctl list-unit-files cloudflared.service --no-legend 2>/dev/null | grep -q cloudflared; then
      etat=$(systemctl is-enabled cloudflared 2>/dev/null || echo absent)
      attendu "$([ "$etat" = enabled ] && echo 1 || echo 0)" \
        'le tunnel Cloudflare démarre au boot' "$etat"
    else
      limite 'le tunnel Cloudflare' \
        'cloudflared n’est pas installé — le site ne sera joignable qu’en local'
    fi
  fi
else
  limite 'l’état réel des unités' 'demande --sur-la-machine (à lancer sur le Pi)'
fi

# --- Bilan -------------------------------------------------------------------

printf '\n%s %s écart(s).\n' "$([ "$echecs" -eq 0 ] && echo '✓' || echo '✗')" "$echecs"
if [ "$limites" -gt 0 ]; then
  printf '%s vérification(s) non faites ici — voir les lignes ◌ ci-dessus.\n' "$limites"
fi
[ "$echecs" -eq 0 ] || exit 1
