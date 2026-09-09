#!/usr/bin/env bash
#
# Acheminement des e-mails de Parcelys depuis le Raspberry Pi.
#
#   sudo bash scripts/setup-mail.sh --relay smtp-relay.brevo.com:587 \
#        --user 9x2ab001@smtp-brevo.com --password 'xxxxxxxx' \
#        --sender 'no-reply@parcelys.fr'
#
# Pourquoi un relais, et pas un serveur de messagerie complet
# -----------------------------------------------------------
# Émettre directement depuis une connexion domestique ne fonctionne pas, et
# surtout pas derrière Starlink :
#
#   · l'adresse IP est partagée (CGNAT) — impossible d'obtenir l'enregistrement
#     inverse (PTR) que réclament Gmail, Outlook et la plupart des serveurs ;
#   · les plages résidentielles figurent dans les listes de blocage (Spamhaus
#     PBL) : le message est refusé avant même d'être lu ;
#   · le port 25 sortant est généralement bloqué par le fournisseur d'accès.
#
# Les codes de vérification n'arriveraient donc jamais, ou finiraient en
# indésirable — ce qui est pire, parce que rien ne le signale.
#
# Ce script installe donc Postfix en **client de relais** : il n'accepte de
# courrier que depuis la machine elle-même, et le remet à un service SMTP
# authentifié, qui dispose, lui, de la réputation nécessaire. Postfix apporte en
# prime une file d'attente : si la liaison satellite tombe au moment où
# quelqu'un s'inscrit, le message part dès qu'elle revient, au lieu d'être perdu.

set -euo pipefail

RELAY=''
SMTP_USER=''
SMTP_PASSWORD=''
SENDER=''
DOMAIN=parcelys.fr
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --relay)    RELAY="$2"; shift 2 ;;
    --user)     SMTP_USER="$2"; shift 2 ;;
    --password) SMTP_PASSWORD="$2"; shift 2 ;;
    --sender)   SENDER="$2"; shift 2 ;;
    --domain)   DOMAIN="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

[ "$(id -u)" -eq 0 ] || die "À lancer avec sudo."
[ -n "$RELAY" ] || die "Indiquez le relais : --relay hote:port (voir --help)."
[ -n "$SMTP_USER" ] || die "Indiquez l'identifiant du relais : --user …"
[ -n "$SMTP_PASSWORD" ] || die "Indiquez le mot de passe du relais : --password …"
SENDER=${SENDER:-no-reply@$DOMAIN}

case "$RELAY" in
  *:*) RELAY_HOST=${RELAY%:*}; RELAY_PORT=${RELAY##*:} ;;
  *)   RELAY_HOST=$RELAY; RELAY_PORT=587 ;;
esac

if [ "$RELAY_PORT" = "25" ]; then
  warn "Port 25 : il est presque toujours bloqué en sortie chez les fournisseurs
    d'accès grand public, Starlink compris. Le port 587 est celui prévu pour la
    soumission authentifiée."
fi

# --- Installation -----------------------------------------------------------

step "Postfix"

if [ "$DRY_RUN" -eq 0 ]; then
  # « Satellite system » : Postfix ne délivre rien lui-même, il relaie tout.
  debconf-set-selections <<EOF
postfix postfix/main_mailer_type select Satellite system
postfix postfix/mailname string $DOMAIN
postfix postfix/relayhost string [$RELAY_HOST]:$RELAY_PORT
EOF
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postfix libsasl2-modules \
    >>/var/log/parcelys-mail.log 2>&1 || die "installation de Postfix impossible (voir /var/log/parcelys-mail.log)"
fi
ok "Postfix et les modules SASL installés"

# --- Configuration ----------------------------------------------------------

step "Relais $RELAY_HOST:$RELAY_PORT"

if [ "$DRY_RUN" -eq 0 ]; then
  # Les identifiants du relais : lisibles par root seul. Un relais authentifié
  # dont le mot de passe fuite sert à envoyer du courrier en votre nom.
  printf '[%s]:%s %s:%s\n' "$RELAY_HOST" "$RELAY_PORT" "$SMTP_USER" "$SMTP_PASSWORD" \
    > /etc/postfix/sasl_passwd
  chmod 600 /etc/postfix/sasl_passwd
  postmap /etc/postfix/sasl_passwd
  chmod 600 /etc/postfix/sasl_passwd.db 2>/dev/null || true

  # Tout part de la même adresse : c'est elle que couvrent SPF et DKIM. Sans
  # cette réécriture, Postfix expédierait « parcelys@raspberry.local », que le
  # relais refuserait — ou que le destinataire classerait en indésirable.
  printf '/.+/ %s\n' "$SENDER" > /etc/postfix/sender_canonical
  postmap /etc/postfix/sender_canonical 2>/dev/null || true

  postconf -e "myhostname = $DOMAIN"
  postconf -e "mydomain = $DOMAIN"
  postconf -e "myorigin = \$mydomain"
  postconf -e "relayhost = [$RELAY_HOST]:$RELAY_PORT"

  # N'accepter de courrier que de la machine elle-même. Un Postfix joignable
  # depuis l'extérieur et capable de relayer est un relais ouvert : il servirait
  # à envoyer du courrier indésirable en votre nom, et le domaine serait
  # blacklisté en quelques heures.
  postconf -e 'inet_interfaces = loopback-only'
  postconf -e 'mynetworks = 127.0.0.0/8 [::1]/128'
  postconf -e 'mydestination ='
  postconf -e 'relay_domains ='

  postconf -e 'smtp_sasl_auth_enable = yes'
  postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd'
  postconf -e 'smtp_sasl_security_options = noanonymous'
  postconf -e 'sender_canonical_maps = regexp:/etc/postfix/sender_canonical'

  # Chiffrement obligatoire vers le relais : le mot de passe SASL circule
  # dedans, et il ne doit pas passer en clair.
  postconf -e 'smtp_tls_security_level = encrypt'
  postconf -e 'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt'
  postconf -e 'smtp_tls_loglevel = 1'

  # La liaison satellite tombe : on réessaie longtemps plutôt que d'abandonner
  # un code de vérification.
  postconf -e 'maximal_queue_lifetime = 3d'
  postconf -e 'bounce_queue_lifetime = 1d'
fi
ok "Relais configuré, expéditeur réécrit en « $SENDER »"
ok "Postfix n'écoute que sur la boucle locale (aucun relais ouvert)"

if [ "$DRY_RUN" -eq 0 ]; then
  systemctl restart postfix 2>/dev/null || service postfix restart 2>/dev/null || \
    warn "Postfix n'a pas pu redémarrer ; « journalctl -u postfix -n 30 »."
fi
ok "Postfix redémarré"

# --- Vérifications ----------------------------------------------------------

step "Vérifications"

if [ "$DRY_RUN" -eq 0 ]; then
  # Un Postfix qui écouterait ailleurs que sur la boucle locale doit être vu
  # tout de suite, pas le jour où le domaine est blacklisté.
  LISTEN=$(postconf -h inet_interfaces 2>/dev/null || echo '?')
  case "$LISTEN" in
    loopback-only|localhost) ok "inet_interfaces = $LISTEN" ;;
    *) die "inet_interfaces = $LISTEN : Postfix accepterait du courrier venu du
        réseau. Corrigez avant d'aller plus loin." ;;
  esac

  if [ -r /etc/postfix/sasl_passwd ]; then
    PERMS=$(stat -c '%a' /etc/postfix/sasl_passwd)
    if [ "$PERMS" = "600" ]; then
      ok "identifiants du relais en 600"
    else
      warn "/etc/postfix/sasl_passwd est en $PERMS, attendu 600"
    fi
  fi
fi

cat <<FIN

${BOLD}Postfix est prêt.${OFF} Reste deux choses, que ce script ne peut pas faire :

${BOLD}1. Pointer Parcelys vers Postfix${OFF} — dans /opt/parcelys/.env :

     EMAIL_PROVIDER=smtp
     SMTP_HOST=127.0.0.1
     SMTP_PORT=25
     SMTP_SECURE=false
     EMAIL_FROM="Parcelys <$SENDER>"

   (pas d'identifiants ici : Postfix tourne sur la machine, et c'est lui qui
   s'authentifie auprès du relais)

     sudo systemctl restart parcelys
     cd /opt/parcelys && sudo -u parcelys npm run email:test -- vous@exemple.fr

${BOLD}2. Autoriser votre domaine dans le DNS${OFF} (Cloudflare, zone $DOMAIN).
   Sans ces enregistrements, les messages partiront mais seront classés en
   indésirable. Le relais vous donne les valeurs exactes ; la forme est :

     TXT   @              "v=spf1 include:<relais> ~all"
     TXT   <sél>._domainkey   "v=DKIM1; k=rsa; p=…"   (fourni par le relais)
     TXT   _dmarc         "v=DMARC1; p=none; rua=mailto:postmaster@$DOMAIN"

   Vérification, une fois propagé :

     dig +short TXT $DOMAIN | grep spf
     dig +short TXT _dmarc.$DOMAIN

${BOLD}Aide-mémoire${OFF}

  mailq                          # messages en attente
  postqueue -f                   # forcer un nouvel essai
  journalctl -u postfix -n 40    # pourquoi un message est refusé
  tail -f /var/log/mail.log

FIN
