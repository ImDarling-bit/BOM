#!/usr/bin/env bash
# Installation / mise à jour du serveur BOM (Boîte à Outils de Manifestation)
# sur Debian ou Ubuntu, derrière TON reverse proxy Apache 2.
#
#   curl -fsSLO https://raw.githubusercontent.com/ImDarling-bit/BOM/main/server/install.sh
#   sudo bash install.sh
#
# Relancer le script met à jour le code et redémarre le service : les comptes
# admin sont conservés.
#
# Variables facultatives (sinon le script pose la question) :
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
NODE_MIN=20

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m/!\\ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERREUR : %s\033[0m\n' "$*" >&2; exit 1; }

# Questions lues sur le terminal, même si le script arrive par un tuyau (curl | bash).
ask() {
  local question="$1" default="${2:-}" answer
  if [ -r /dev/tty ]; then
    read -r -p "$question${default:+ [$default]} : " answer < /dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}

[ "$(id -u)" -eq 0 ] || fail "lance le script avec sudo : sudo bash install.sh"
command -v apt-get >/dev/null || fail "ce script vise Debian ou Ubuntu (apt-get introuvable)."

# --- Questions ------------------------------------------------------------------

echo
vert "Installation de BOM — Boîte à Outils de Manifestation"
echo

PROXY_LOCAL="${BOM_PROXY_LOCAL:-$(ask "Ton Apache tourne-t-il sur CETTE machine ? (o/n)" "n")}"
case "$PROXY_LOCAL" in [oOyY]*) PROXY_LOCAL=o ;; *) PROXY_LOCAL=n ;; esac

PROXY_IP=""
if [ "$PROXY_LOCAL" = n ]; then
  PROXY_IP="${BOM_PROXY_IP:-$(ask "IP locale de la machine Apache (vide = ne pas filtrer)" "")}"
fi
PORT="${BOM_PORT:-$(ask "Port du serveur BOM" "8080")}"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "port invalide : $PORT"
DOMAIN="${BOM_DOMAIN:-$(ask "Nom de domaine public de BOM (ex. bom.mondomaine.org)" "bom.mondomaine.org")}"

if [ "$PROXY_LOCAL" = o ]; then HOST=127.0.0.1; else HOST=0.0.0.0; fi

# --- Paquets ----------------------------------------------------------------------

info "Installation des paquets (git, Node.js, outils de compilation, sqlite3)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 sqlite3 >/dev/null

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
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

# --- Utilisateur et code --------------------------------------------------------------

if ! id bom >/dev/null 2>&1; then
  info "Création de l'utilisateur système « bom »"
  useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin bom
fi

if [ -d "$APP_DIR/.git" ]; then
  info "Mise à jour du code dans $APP_DIR"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  info "Téléchargement du code dans $APP_DIR"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

info "Installation des dépendances du serveur"
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# --- Service systemd -------------------------------------------------------------------

info "Configuration du service systemd « $SERVICE »"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
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
systemctl restart "$SERVICE"

info "Démarrage du serveur"
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
  || fail "le serveur ne répond pas. Regarde : journalctl -u $SERVICE -n 50"

# --- Pare-feu (si ufw est actif) ---------------------------------------------------------

if [ "$PROXY_LOCAL" = n ] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  if [ -n "$PROXY_IP" ]; then
    info "Pare-feu : port $PORT ouvert uniquement pour $PROXY_IP"
    ufw allow from "$PROXY_IP" to any port "$PORT" proto tcp >/dev/null
  else
    warn "ufw est actif : ouvre le port $PORT pour ta machine Apache (ufw allow from <IP> to any port $PORT proto tcp)"
  fi
fi

# --- Premier compte admin ------------------------------------------------------------------

cli() { (cd "$APP_DIR/server" && runuser -u bom -- env DB_PATH="$DB_PATH" "$NODE_BIN" admin-cli.mjs "$@"); }

if cli list 2>/dev/null | grep -q "Aucun compte"; then
  echo
  info "Création du premier compte du panneau d'administration"
  ADMIN="${BOM_ADMIN:-$(ask "Identifiant admin" "admin")}"
  if [ -r /dev/tty ]; then
    cli add "$ADMIN" < /dev/tty || warn "compte non créé : relance plus tard avec la commande indiquée à la fin"
  else
    warn "pas de terminal : crée le compte plus tard avec la commande indiquée à la fin"
  fi
fi

# --- Config Apache ---------------------------------------------------------------------------

LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
[ -n "$LAN_IP" ] || LAN_IP="$(hostname -I | awk '{print $1}')"
if [ "$PROXY_LOCAL" = o ]; then BACKEND="127.0.0.1"; else BACKEND="$LAN_IP"; fi

APACHE_CONF="$APP_DIR/apache-bom.conf"
cat > "$APACHE_CONF" <<EOF
# Config Apache 2.4.47+ pour BOM, générée par install.sh
# Modules : a2enmod proxy proxy_http headers ssl rewrite
# Certificat : chemins Certbot / Let's Encrypt par défaut, adapte-les si ton outil est différent.

<VirtualHost *:80>
    ServerName $DOMAIN
    RewriteEngine On
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>

<VirtualHost *:443>
    ServerName $DOMAIN

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/$DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN/privkey.pem

    # Indispensable : le panneau admin vérifie que l'origine correspond au domaine.
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"

    # upgrade=websocket : le chat (/ws) et le panneau (/admin/ws) passent par WebSocket.
    ProxyPass        "/" "http://$BACKEND:$PORT/" upgrade=websocket
    ProxyPassReverse "/" "http://$BACKEND:$PORT/"
    ProxyTimeout 120

    # Anonymat : pas de journal d'accès (sinon Apache note l'IP de chaque manifestant·e).
    CustomLog /dev/null combined

    Header always set Strict-Transport-Security "max-age=31536000"
</VirtualHost>
EOF

# --- Résumé ------------------------------------------------------------------------------------

echo
vert "================================================================"
vert " BOM est installé et tourne."
vert "================================================================"
echo
echo "  Adresse locale du serveur (à mettre dans Apache) :"
vert "      http://$BACKEND:$PORT"
echo
echo "  Config Apache prête à l'emploi :"
echo "      $APACHE_CONF"
echo "    1. copie-la sur ta machine Apache dans /etc/apache2/sites-available/bom.conf"
echo "    2. certificat : certbot certonly --apache -d $DOMAIN   (ou ton outil habituel)"
echo "    3. a2enmod proxy proxy_http headers ssl rewrite && a2ensite bom"
echo "    4. apachectl configtest && systemctl reload apache2"
echo
echo "  Ensuite, adresses à me donner pour l'app :"
echo "      EXPO_PUBLIC_WS_URL  = wss://$DOMAIN/ws"
echo "      EXPO_PUBLIC_API_URL = https://$DOMAIN"
echo "  Panneau d'administration : https://$DOMAIN/admin"
echo
echo "  Comptes admin :"
echo "      cd $APP_DIR/server && runuser -u bom -- env DB_PATH=$DB_PATH node admin-cli.mjs list|add|passwd|reset-2fa <identifiant>"
echo "  Journaux : journalctl -u $SERVICE -f        Mise à jour : relance ce script."
echo
