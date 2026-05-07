#!/bin/bash
set -e

# Script de despliegue para Ubuntu
# Uso: sudo bash deploy.sh

APP_DIR="/var/www/mycms"
cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "ERROR: No se detecta un repositorio Git en $APP_DIR."
  echo "Asegúrate de que el directorio se originó desde un clone de Git."
  exit 1
fi

echo "[deploy] Actualizando código desde origin/main..."
git fetch --all --prune
if git show-ref --verify --quiet refs/heads/main; then
  git checkout main
else
  git checkout -B main
fi
git reset --hard origin/main

echo "[deploy] Instalando dependencias de Node.js..."
npm install --omit=dev --quiet

echo "[deploy] Reiniciando servicio mycms..."
systemctl restart mycms

echo "[deploy] Despliegue completado."
