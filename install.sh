#!/bin/bash
# ============================================================
#  NovaCMS - Script de instalación para Ubuntu Server 24.04
#  Uso: sudo bash install.sh
# ============================================================

set -e  # Parar si hay cualquier error

# ── Colores ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # Sin color

# ── Variables ────────────────────────────────────────────────
APP_NAME="mycms"
APP_DIR="/var/www/$APP_NAME"
APP_USER="www-data"
NODE_VERSION="20"
PORT=3000

# ── Funciones de log ─────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Comprobaciones previas ───────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Instalando NovaCMS                ║"
echo "║        TFG - Ubuntu Server 24.04         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Comprobar que se ejecuta como root
if [ "$EUID" -ne 0 ]; then
  error "Este script debe ejecutarse como root. Usa: sudo bash install.sh"
fi

# Comprobar Ubuntu 24.04
if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
  warn "No se detectó Ubuntu 24.04. Continuando de todas formas..."
fi

# ── PASO 1: Actualizar sistema ───────────────────────────────
info "Actualizando paquetes del sistema..."
apt-get update -qq
apt-get upgrade -y -qq
success "Sistema actualizado"

# ── PASO 2: Instalar dependencias base ───────────────────────
info "Instalando dependencias base..."
apt-get install -y -qq curl wget git build-essential nginx ufw
success "Dependencias instaladas"

# ── PASO 3: Instalar Node.js 20 LTS ─────────────────────────
info "Instalando Node.js $NODE_VERSION LTS..."
if command -v node &> /dev/null; then
  CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
    success "Node.js $(node -v) ya está instalado"
  else
    warn "Node.js encontrado pero versión antigua. Actualizando..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
  success "Node.js $(node -v) instalado"
fi

# ── PASO 4: Crear directorio de la aplicación ────────────────
info "Preparando directorio de instalación: $APP_DIR"
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public/uploads"
mkdir -p "$APP_DIR/data"

# Copiar archivos del proyecto (desde el directorio actual)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Copiando archivos desde $SCRIPT_DIR..."

rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  "$SCRIPT_DIR/" "$APP_DIR/"

success "Archivos copiados a $APP_DIR"

# ── PASO 5: Instalar dependencias Node ───────────────────────
info "Instalando dependencias de Node.js..."
cd "$APP_DIR"
npm install --omit=dev --quiet
success "Dependencias de Node.js instaladas"

# ── PASO 6: Permisos ─────────────────────────────────────────
info "Configurando permisos..."
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod -R 775 "$APP_DIR/public/uploads"
chmod -R 775 "$APP_DIR/data"
success "Permisos configurados"

# ── PASO 7: Crear servicio systemd ───────────────────────────
info "Creando servicio systemd..."

cat > /etc/systemd/system/$APP_NAME.service << EOF
[Unit]
Description=NovaCMS - CMS personalizado TFG
Documentation=https://github.com/tu-usuario/mycms
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(which node) server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=$APP_NAME
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=SESSION_SECRET=$(openssl rand -base64 32)

[Install]
WantedBy=multi-user.target
EOF

# Activar y arrancar el servicio
systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl start "$APP_NAME"

sleep 2

if systemctl is-active --quiet "$APP_NAME"; then
  success "Servicio $APP_NAME arrancado correctamente"
else
  warn "El servicio no arrancó. Comprueba: journalctl -u $APP_NAME -n 20"
fi

# ── PASO 8: Configurar Nginx ─────────────────────────────────
info "Configurando Nginx como proxy inverso..."

# Obtener IP del servidor
SERVER_IP=$(hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/$APP_NAME << EOF
server {
    listen 80;
    server_name $SERVER_IP _;

    # Logs
    access_log /var/log/nginx/${APP_NAME}_access.log;
    error_log  /var/log/nginx/${APP_NAME}_error.log;

    # Tamaño máximo de subida (imágenes, medios)
    client_max_body_size 20M;

    # Archivos estáticos directamente desde Nginx (más rápido)
    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Todo lo demás va al servidor Node.js
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}
EOF

# Activar el sitio en Nginx
ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Comprobar configuración de Nginx
if nginx -t 2>/dev/null; then
  systemctl restart nginx
  systemctl enable nginx
  success "Nginx configurado y reiniciado"
else
  warn "Error en la configuración de Nginx. Comprueba manualmente."
fi

# ── PASO 9: Configurar firewall ──────────────────────────────
info "Configurando firewall (UFW)..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'
ufw deny "$PORT"   # Bloquear acceso directo a Node, solo por Nginx
success "Firewall configurado"

# ── RESUMEN FINAL ────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           ✅  NovaCMS instalado con éxito            ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  🌐  Sitio web:  http://$SERVER_IP                   "
echo "║  🔧  Admin:      http://$SERVER_IP/setup             "
echo "║  📁  Archivos:   $APP_DIR                            "
echo "║                                                      ║"
echo "║  Comandos útiles:                                    ║"
echo "║  • Ver logs:    journalctl -u $APP_NAME -f           "
echo "║  • Reiniciar:   systemctl restart $APP_NAME          "
echo "║  • Estado:      systemctl status $APP_NAME           "
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Abre el navegador y ve a: http://$SERVER_IP/setup${NC}"
echo ""
