#!/usr/bin/env bash
# Installation et mise à jour du serveur BOM (Boîte à Outils de Manifestation)
# sur Debian ou Ubuntu, derrière TON reverse proxy Apache 2.
#
#   curl -fsSLO https://raw.githubusercontent.com/ImDarling-bit/BOM/main/server/install.sh
#   sudo bash install.sh
#
# Si BOM est déjà installé, le script le détecte, affiche les nouveautés et
# propose la mise à jour (les comptes admin et la configuration sont gardés).
# Après la première installation, il est aussi disponible ici :
#   sudo bash /opt/bom/server/install.sh
#
# Variables facultatives (sinon le script pose la question) :
#   BOM_ACTION=update|reconfigure|quit   choix si BOM est déjà installé
#   BOM_PROXY_LOCAL=o|n   Apache est-il sur cette machine ?
#   BOM_PROXY_IP=…        IP de la machine Apache (si elle est ailleurs)
#   BOM_PORT=8080         port du serveur BOM
#   BOM_DOMAIN=…          nom de domaine public (pour générer la config Apache)
#   BOM_ADMIN=…           identifiant du premier compte admin

set -euo pipefail

REPO_URL="${BOM_REPO_URL:-https://github.com/ImDarling-bit/BOM.git}"
BRANCH="${BOM_BRANCH:-main}"
APP_DIR=/opt/bom
STATE_DIR=/var/lib/bom
DB_PATH="$STATE_DIR/bom.db"
SERVICE=bom
SERVICE_FILE="/etc/systemd/system/$SERVICE.service"
CONF_DIR=/etc/bom
CONF="$CONF_DIR/install.conf"
NODE_MIN=20

# Réglages (remplis par les questions ou relus depuis l'installation existante).
PROXY_LOCAL=n
PROXY_IP=""
PORT=8080
HOST=0.0.0.0
DOMAIN=bom.mondomaine.org
NODE_BIN=""

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m/!\\ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERREUR : %s\033[0m\n' "$*" >&2; exit 1; }

# Questions lues sur le terminal, même si le script arrive par un tuyau (curl | bash).
ask() {
  local question="$1" default="${2:-}" answer=""
  if [ -r /dev/tty ]; then
    read -r -p "$question${default:+ [$default]} : " answer < /dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}

yes_default() { case "$1" in [nN]*) return 1 ;; *) return 0 ;; esac; }
no_default() { case "$1" in [oOyY]*) return 0 ;; *) return 1 ;; esac; }

# --- Détection ---------------------------------------------------------------------

is_installed() { [ -d "$APP_DIR/.git" ] && [ -f "$SERVICE_FILE" ]; }

version_of() { git -C "$APP_DIR" describe --tags --always "$1" 2>/dev/null || echo "?"; }

# Relit la configuration d'une installation existante.
load_existing() {
  if [ -f "$CONF" ]; then
    # shellcheck disable=SC1090
    . "$CONF"
  else
    # Installation faite par une ancienne version du script : on déduit les réglages.
    local env_line
    env_line="$(grep -E '^Environment=' "$SERVICE_FILE" || true)"
    PORT="$(sed -nE 's/.*PORT=([0-9]+).*/\1/p' <<< "$env_line")"
    HOST="$(sed -nE 's/.*HOST=([^ ]+).*/\1/p' <<< "$env_line")"
    [ "$HOST" = 127.0.0.1 ] && PROXY_LOCAL=o || PROXY_LOCAL=n
    if [ -f "$APP_DIR/apache-bom.conf" ]; then
      DOMAIN="$(awk '/ServerName/ {print $2; exit}' "$APP_DIR/apache-bom.conf")"
    fi
  fi
  PORT="${PORT:-8080}"
  HOST="${HOST:-0.0.0.0}"
  NODE_BIN="$(sed -nE 's/^ExecStart=([^ ]+) .*/\1/p' "$SERVICE_FILE")"
  [ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
}

save_conf() {
  mkdir -p "$CONF_DIR"
  cat > "$CONF" <<EOF
# Réglages de l'installation BOM (relus lors des mises à jour)
PROXY_LOCAL=$PROXY_LOCAL
PROXY_IP=$PROXY_IP
PORT=$PORT
HOST=$HOST
DOMAIN=$DOMAIN
EOF
}

# --- Étapes communes ------------------------------------------------------------------

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }

ensure_packages() {
  info "Installation des paquets (git, Node.js, outils de compilation, sqlite3)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates build-essential python3 sqlite3 >/dev/null
  if ! command -v node >/dev/null || [ "$(node_major)" -lt "$NODE_MIN" ]; then
    apt-get install -y -qq nodejs npm >/dev/null 2>&1 || true
  fi
  if ! command -v node >/dev/null || [ "$(node_major)" -lt "$NODE_MIN" ]; then
    info "Node.js de la distribution trop ancien : installation de Node.js 22 (dépôt NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  NODE_BIN="$(command -v node)"
  info "Node.js $(node -v)"
}

install_deps() {
  info "Installation des dépendances du serveur"
  (cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
}

write_service() {
  info "Configuration du service systemd « $SERVICE »"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=BOM (Boite a Outils de Manifestation)
After=network-online.target
Wants=network-online.target

[Service]
User=bom
Group=bom
WorkingDirectory=$APP_DIR/server
ExecStart=$NODE_BIN server.mjs
Environment=HOST=$HOST PORT=$PORT DB_PATH=$DB_PATH
StateDirectory=bom
StateDirectoryMode=0700
Restart=always
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable -q "$SERVICE"
}

restart_and_check() {
  info "Démarrage du serveur"
  systemctl restart "$SERVICE"
  for _ in $(seq 1 20); do
    curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "le serveur ne répond pas. Regarde : journalctl -u $SERVICE -n 50"
}

cli() { (cd "$APP_DIR/server" && runuser -u bom -- env DB_PATH="$DB_PATH" "$NODE_BIN" admin-cli.mjs "$@"); }

backend_address() {
  local lan
  lan="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
  [ -n "$lan" ] || lan="$(hostname -I | awk '{print $1}')"
  if [ "$PROXY_LOCAL" = o ]; then echo 127.0.0.1; else echo "$lan"; fi
}

write_apache() {
  local backend="$1"
  cat > "$APP_DIR/apache-bom.conf" <<EOF
# Config Apache 2.4.47+ pour BOM, générée par install.sh
# Modules : a2enmod proxy proxy_http headers ssl rewrite
# Certificat : chemins Certbot / Let's Encrypt par défaut, adapte-les si ton outil est différent.

<VirtualHost *:80>
    ServerName $DOMAIN
    RewriteEngine On
    # Laisse passer les vérifications de renouvellement du certificat
    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>

<VirtualHost *:443>
    ServerName $DOMAIN

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/$DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN/privkey.pem

    # Indispensable : le panneau admin vérifie que l'origine correspond au domaine.
    ProxyRequests Off
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"

    # upgrade=websocket : le chat (/ws) et le panneau (/admin/ws) passent par WebSocket.
    ProxyPass        "/" "http://$backend:$PORT/" upgrade=websocket
    ProxyPassReverse "/" "http://$backend:$PORT/"
    ProxyTimeout 120

    # Anonymat : pas de journal d'accès (sinon Apache note l'IP de chaque manifestant·e).
    CustomLog /dev/null combined

    Header always set Strict-Transport-Security "max-age=31536000"
</VirtualHost>
EOF
}

# --- Mise à jour ------------------------------------------------------------------------

do_update() {
  load_existing
  [ -n "$NODE_BIN" ] || ensure_packages
  if [ "$(node_major)" -lt "$NODE_MIN" ]; then ensure_packages; write_service; fi

  info "Recherche des nouveautés sur GitHub"
  git -C "$APP_DIR" fetch -q --tags origin "$BRANCH"
  local current latest count old
  old="$(git -C "$APP_DIR" rev-parse HEAD)"
  current="$(version_of HEAD)"
  latest="$(version_of "origin/$BRANCH")"
  count="$(git -C "$APP_DIR" rev-list --count "HEAD..origin/$BRANCH")"

  echo
  echo "  Version installée : $current"
  echo "  Dernière version  : $latest"
  echo

  if [ "$count" -eq 0 ]; then
    vert "  BOM est déjà à jour."
    no_default "$(ask "Réinstaller quand même les dépendances et redémarrer ? (o/N)" "n")" || return 0
  else
    echo "  $count changement(s) à installer :"
    git -C "$APP_DIR" log --format='    - %s' "HEAD..origin/$BRANCH" | head -15
    echo
    yes_default "$(ask "Mettre à jour maintenant ? (O/n)" "o")" || { echo "Rien n'a été modifié."; return 0; }
    info "Mise à jour du code"
    git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
  fi

  install_deps
  save_conf
  restart_and_check

  echo
  vert "================================================================"
  vert " BOM est à jour ($(version_of HEAD)) et tourne."
  vert "================================================================"
  echo "  Adresse locale : http://$(backend_address):$PORT"
  echo "  Panneau        : https://$DOMAIN/admin"
  echo "  Comptes admin et configuration : inchangés."
  echo "  La manif en mémoire (positions, signalements) repart à zéro après le redémarrage."
  echo "  Revenir en arrière : git -C $APP_DIR reset --hard ${old:0:12} && sudo bash $APP_DIR/server/install.sh"
  echo
}

# --- Installation complète ----------------------------------------------------------------

do_install() {
  local reconfigure="${1:-}"
  if [ -n "$reconfigure" ]; then load_existing; fi

  local def_local="$PROXY_LOCAL" def_port="$PORT" def_domain="$DOMAIN"
  PROXY_LOCAL="${BOM_PROXY_LOCAL:-$(ask "Ton Apache tourne-t-il sur CETTE machine ? (o/n)" "$def_local")}"
  case "$PROXY_LOCAL" in [oOyY]*) PROXY_LOCAL=o ;; *) PROXY_LOCAL=n ;; esac
  PROXY_IP=""
  if [ "$PROXY_LOCAL" = n ]; then
    PROXY_IP="${BOM_PROXY_IP:-$(ask "IP locale de la machine Apache (vide = ne pas filtrer)" "")}"
  fi
  PORT="${BOM_PORT:-$(ask "Port du serveur BOM" "$def_port")}"
  [[ "$PORT" =~ ^[0-9]+$ ]] || fail "port invalide : $PORT"
  DOMAIN="${BOM_DOMAIN:-$(ask "Nom de domaine public de BOM (ex. bom.mondomaine.org)" "$def_domain")}"
  if [ "$PROXY_LOCAL" = o ]; then HOST=127.0.0.1; else HOST=0.0.0.0; fi

  ensure_packages

  if ! id bom >/dev/null 2>&1; then
    info "Création de l'utilisateur système « bom »"
    useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin bom
  fi

  if [ -d "$APP_DIR/.git" ]; then
    info "Mise à jour du code dans $APP_DIR"
    git -C "$APP_DIR" fetch -q --tags origin "$BRANCH"
    git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
  else
    info "Téléchargement du code dans $APP_DIR"
    git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  install_deps
  write_service
  save_conf
  restart_and_check

  if [ "$PROXY_LOCAL" = n ] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    if [ -n "$PROXY_IP" ]; then
      info "Pare-feu : port $PORT ouvert uniquement pour $PROXY_IP"
      ufw allow from "$PROXY_IP" to any port "$PORT" proto tcp >/dev/null
    else
      warn "ufw est actif : ouvre le port $PORT pour ta machine Apache (ufw allow from <IP> to any port $PORT proto tcp)"
    fi
  fi

  if cli list 2>/dev/null | grep -q "Aucun compte"; then
    echo
    info "Création du premier compte du panneau d'administration"
    local admin
    admin="${BOM_ADMIN:-$(ask "Identifiant admin" "admin")}"
    if [ -r /dev/tty ]; then
      cli add "$admin" < /dev/tty || warn "compte non créé : relance plus tard avec la commande indiquée à la fin"
    else
      warn "pas de terminal : crée le compte plus tard avec la commande indiquée à la fin"
    fi
  fi

  local backend
  backend="$(backend_address)"
  write_apache "$backend"

  echo
  vert "================================================================"
  vert " BOM est installé et tourne ($(version_of HEAD))."
  vert "================================================================"
  echo
  echo "  Adresse locale du serveur (à mettre dans Apache) :"
  vert "      http://$backend:$PORT"
  echo
  echo "  Config Apache prête à l'emploi :"
  echo "      $APP_DIR/apache-bom.conf"
  echo "    1. copie-la sur ta machine Apache dans /etc/apache2/sites-available/bom.conf"
  echo "    2. certificat : certbot certonly --apache -d $DOMAIN   (ou ton outil habituel)"
  echo "    3. a2enmod proxy proxy_http headers ssl rewrite && a2ensite bom"
  echo "    4. apachectl configtest && systemctl reload apache2"
  echo
  echo "  Adresses de l'app :"
  echo "      EXPO_PUBLIC_WS_URL  = wss://$DOMAIN/ws"
  echo "      EXPO_PUBLIC_API_URL = https://$DOMAIN"
  echo "  Panneau d'administration : https://$DOMAIN/admin"
  echo
  echo "  Comptes admin :"
  echo "      sudo runuser -u bom -- env DB_PATH=$DB_PATH node $APP_DIR/server/admin-cli.mjs list|add|passwd|reset-2fa <identifiant>"
  echo "  Journaux : journalctl -u $SERVICE -f"
  echo "  Mise à jour : sudo bash $APP_DIR/server/install.sh"
  echo
}

# --- Point d'entrée -----------------------------------------------------------------------

main() {
  [ "$(id -u)" -eq 0 ] || fail "lance le script avec sudo : sudo bash install.sh"
  command -v apt-get >/dev/null || fail "ce script vise Debian ou Ubuntu (apt-get introuvable)."

  echo
  vert "BOM — Boîte à Outils de Manifestation"
  echo

  if ! is_installed; then
    info "Aucune installation détectée : installation complète."
    do_install
    return
  fi

  info "BOM est déjà installé dans $APP_DIR (version $(version_of HEAD))."
  if systemctl is-active -q "$SERVICE"; then echo "    Service : en marche"; else warn "Service : arrêté"; fi
  echo
  echo "  1) Mettre à jour (recommandé)"
  echo "  2) Reconfigurer (reposer les questions : port, Apache, domaine)"
  echo "  3) Quitter"
  local choice="${BOM_ACTION:-$(ask "Ton choix" "1")}"
  case "$choice" in
    1 | update) do_update ;;
    2 | reconfigure) do_install reconfigure ;;
    *) echo "Rien n'a été modifié." ;;
  esac
}

# Tout le script est lu avant de s'exécuter : une mise à jour peut remplacer ce
# fichier pendant qu'il tourne sans le casser.
main "$@"; exit $?
