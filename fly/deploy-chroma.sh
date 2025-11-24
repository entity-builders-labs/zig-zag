#!/bin/bash
# Script para deploy de ChromaDB a Fly.io (OPCIONAL - Solo si prefieres auto-hospedar)
# 
# ⚠️  RECOMENDACIÓN: Usa TryChroma Cloud (https://www.trychroma.com/cloud) en su lugar
# Es más económico, más simple y no requiere mantener infraestructura.
#
# Uso: ./deploy-chroma.sh

set -e

# Get the directory where the script is located (fly directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root directory
cd "$PROJECT_ROOT"

APP_NAME="zig-zag-chroma"
CONFIG_FILE="fly-chroma.toml"

echo "⚠️  ADVERTENCIA: Deployar ChromaDB en Fly.io requiere mantener la máquina encendida (costos continuos)"
echo "💡 RECOMENDACIÓN: Usa TryChroma Cloud en su lugar (más económico y simple)"
echo "   Visita: https://www.trychroma.com/cloud"
echo ""
read -p "¿Continuar con deploy en Fly.io? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Deploy cancelado"
  exit 1
fi

echo "🚀 Deploying ChromaDB to Fly.io..."
echo ""

# Verificar que la aplicación existe
if ! fly apps list 2>/dev/null | grep -q "^${APP_NAME}$"; then
  echo "⚠️  La aplicación $APP_NAME no existe."
  echo "💡 Creando la aplicación..."
  fly apps create "$APP_NAME" --org personal
  echo "✅ Aplicación creada"
  echo ""
fi

# Verificar que existe un volumen
VOLUMES=$(fly volumes list --app "$APP_NAME" 2>/dev/null | grep -c "chroma_data" || echo "0")
if [ "$VOLUMES" -eq 0 ]; then
  echo "⚠️  No se encontró ningún volumen para ChromaDB."
  echo "💡 Creando volumen..."
  fly volumes create chroma_data --size 1 --region iad --app "$APP_NAME"
  echo "✅ Volumen creado"
  echo ""
fi

# Deploy
echo "📦 Starting deployment..."
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME"

echo ""
echo "✅ Deploy completado!"
echo ""
echo "💡 Useful commands:"
echo "   fly logs --app $APP_NAME          # View logs"
echo "   fly status --app $APP_NAME        # Check status"
echo "   fly ssh console --app $APP_NAME  # SSH into container"
echo ""
echo "📋 URL de ChromaDB: https://${APP_NAME}.fly.dev"
echo "   Configura esta URL en tu backend como CHROMA_URL"
echo ""

