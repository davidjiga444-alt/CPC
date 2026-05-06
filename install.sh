#!/bin/bash
# ============================================================
#  MyCMS - Script de instalación para Ubuntu Server 24.04
#  Uso: sudo bash install.sh
# ============================================================

set -e  # Parar si hay cualquier error

# ── Colores ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Instalando MyCMS (TFG)            ║"
echo "║        Ubuntu Server 24.04               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Comprobar root ───────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  error "Este script debe ejecutarse como root. Usa: sudo bash install.sh"
fi

# ── Comprobar Ubuntu 24.04 ───────────────────────────────────
if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
  warn "No se detectó Ubuntu 24.04. Continuando igualmente..."
fi

# ── PASO 1: Actualizar sistema ───────────────────────────────
info "Actualizando paquetes del sistema..."
apt-get update -qq
apt-get upgrade -y -qq
success "Sistema actualizado"

# ── PASO 2: Instalar dependencias base ───────────────────────
info "Instalando dependencias base (curl, git, build-essential, nginx, ufw)..."
apt-get install -y -qq curl wget git build-essential nginx ufw
success "Dependencias instaladas"

# ── PASO 3: Instalar Node.js 20 LTS ─────────────────────────
info "Comprobando Node.js..."
if command -v node &> /dev/null; then
  CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
    success "Node.js $(node -v) ya está instalado"
  else
    warn "Node.js antiguo detectado (v$CURRENT_NODE). Actualizando a v$NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs
    success "Node.js $(node -v) instalado"
  fi
else
  info "Instalando Node.js $NODE_VERSION LTS..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs
  success "Node.js $(node -v) instalado"
fi

# Guardar ruta exacta de node para el servicio systemd
NODE_BIN=$(which node)

# ── PASO 4: Preparar directorios ─────────────────────────────
info "Preparando directorio de instalación: $APP_DIR"
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public/uploads"
mkdir -p "$APP_DIR/data"

# Copiar archivos del proyecto (desde el directorio del script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Copiando archivos desde $SCRIPT_DIR..."

rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='data/*.db' \
  --exclude='data/*.db-*' \
  --exclude='.env' \
  "$SCRIPT_DIR/" "$APP_DIR/"

success "Archivos copiados a $APP_DIR"

# ── PASO 5: Instalar dependencias Node ───────────────────────
info "Instalando dependencias de Node.js (npm install)..."
cd "$APP_DIR"
npm install --omit=dev --quiet
success "Dependencias de Node.js instaladas"

# ── PASO 6: Generar .env con SESSION_SECRET seguro ───────────
# CORRECCIÓN: Generamos el secreto ANTES del heredoc para poder
# incrustarlo correctamente en el .env y en el servicio systemd
info "Generando configuración de entorno (.env)..."

SESSION_SECRET_VALUE=$(openssl rand -base64 32)

# Crear .env de producción
cat > "$APP_DIR/.env" << ENVEOF
NODE_ENV=production
PORT=$PORT
SESSION_SECRET=$SESSION_SECRET_VALUE
SITE_URL=http://$(hostname -I | awk '{print $1}')
ENVEOF

chmod 600 "$APP_DIR/.env"
success ".env creado con SESSION_SECRET seguro"

# ── PASO 7: Permisos ─────────────────────────────────────────
info "Configurando permisos..."
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod -R 775 "$APP_DIR/public/uploads"
chmod -R 775 "$APP_DIR/data"
chmod 640 "$APP_DIR/.env"
success "Permisos configurados"

# ── PASO 8: Crear servicio systemd ───────────────────────────
info "Creando servicio systemd..."

# CORRECCIÓN: Usamos 'ENVEOF' con comillas para que las variables
# de bash NO se expandan dentro del heredoc del servicio.
# Las variables de entorno las carga Node.js desde el archivo .env.
cat > /etc/systemd/system/${APP_NAME}.service << 'SVCEOF_PLACEHOLDER'
[Unit]
Description=MyCMS - CMS personalizado TFG
After=network.target

[Service]
Type=simple
SVCEOF_PLACEHOLDER

# Añadir las líneas con variables expandidas
cat >> /etc/systemd/system/${APP_NAME}.service << SVCEOF
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$APP_NAME
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl start "$APP_NAME"

sleep 3

if systemctl is-active --quiet "$APP_NAME"; then
  success "Servicio $APP_NAME arrancado correctamente"
else
  warn "El servicio no arrancó. Diagnóstico:"
  journalctl -u "$APP_NAME" -n 15 --no-pager
fi

# ── PASO 9: Configurar Nginx ─────────────────────────────────
info "Configurando Nginx como proxy inverso..."

SERVER_IP=$(hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/$APP_NAME << NGINXEOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Logs
    access_log /var/log/nginx/${APP_NAME}_access.log;
    error_log  /var/log/nginx/${APP_NAME}_error.log;

    # Tamaño máximo de subida
    client_max_body_size 20M;

    # Archivos estáticos servidos directamente por Nginx (más rápido)
    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Resto de peticiones → Node.js
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
NGINXEOF

# Activar sitio y desactivar el default de Nginx
ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Verificar configuración antes de recargar
if nginx -t 2>/dev/null; then
  systemctl restart nginx
  systemctl enable nginx
  success "Nginx configurado y reiniciado"
else
  warn "Error en la configuración de Nginx. Revisa con: nginx -t"
fi

# ── PASO 10: Firewall ────────────────────────────────────────
info "Configurando firewall (UFW)..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'

# CORRECCIÓN BUG: 'set -e' hacía que ufw deny fallara si la regla
# ya existía. Usamos '|| true' para ignorar errores no críticos.
ufw deny "$PORT" 2>/dev/null || true

success "Firewall configurado (SSH + HTTP/HTTPS abiertos, puerto $PORT bloqueado externamente)"

# ── RESUMEN FINAL ────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         ✅  MyCMS instalado con éxito               ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  🌐  Sitio web:  http://$SERVER_IP"
echo "║  🔧  Instalador: http://$SERVER_IP/setup"
echo "║  🔑  Admin:      http://$SERVER_IP/admin"
echo "║  📁  Archivos:   $APP_DIR"
echo "║                                                      ║"
echo "║  Comandos útiles:                                    ║"
echo "║  • Ver logs:    journalctl -u $APP_NAME -f"
echo "║  • Reiniciar:   systemctl restart $APP_NAME"
echo "║  • Estado:      systemctl status $APP_NAME"
echo "║  • Nginx logs:  tail -f /var/log/nginx/${APP_NAME}_error.log"
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}➡  Abre el navegador en: http://$SERVER_IP/setup${NC}"
echo ""
