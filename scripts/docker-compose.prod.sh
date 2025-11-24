#!/bin/bash
# Script para ejecutar docker-compose con las variables de entorno de producción
# Uso: ./docker-compose.prod.sh [comandos de docker-compose]
# Ejemplo: ./docker-compose.prod.sh up -d
#          ./docker-compose.prod.sh down
#          ./docker-compose.prod.sh logs -f backend

set -e

# Get the directory where the script is located (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Change to project root directory
cd "$PROJECT_ROOT"

ENV_FILE=".env.prod"

# Verificar que existe el archivo .env.prod
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: No se encontró el archivo $ENV_FILE"
  echo ""
  echo "💡 Crea el archivo $ENV_FILE en la raíz del proyecto con las variables de producción"
  echo "   Puedes copiar desde .env.example como base"
  exit 1
fi

echo "📋 Cargando variables de entorno desde $ENV_FILE..."
echo ""

# Cargar variables de entorno desde .env.prod
# Esto exporta todas las variables al entorno actual
set -a  # Automáticamente exporta todas las variables
source "$ENV_FILE"
set +a  # Desactiva el modo automático de exportación

echo "✅ Variables de entorno cargadas desde $ENV_FILE"
echo ""

# Sobrescribir EXPO_PUBLIC_API_URL con el valor del .env de desarrollo
# El frontend usará la URL de desarrollo mientras que el resto usa producción
DEV_ENV_FILE=".env"
if [ -f "$DEV_ENV_FILE" ]; then
  echo "📋 Cargando EXPO_PUBLIC_API_URL desde $DEV_ENV_FILE (desarrollo)..."
  # Extraer solo EXPO_PUBLIC_API_URL del archivo .env de desarrollo
  # Usamos grep y sed para obtener el valor sin comentarios ni espacios
  DEV_API_URL=$(grep -E "^EXPO_PUBLIC_API_URL=" "$DEV_ENV_FILE" | sed 's/^EXPO_PUBLIC_API_URL=//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | head -n 1)
  
  if [ -n "$DEV_API_URL" ]; then
    export EXPO_PUBLIC_API_URL="$DEV_API_URL"
    echo "✅ EXPO_PUBLIC_API_URL sobrescrito con valor de desarrollo: $EXPO_PUBLIC_API_URL"
  else
    echo "⚠️  No se encontró EXPO_PUBLIC_API_URL en $DEV_ENV_FILE"
    echo "   Se usará el valor de $ENV_FILE (si existe)"
  fi
else
  echo "⚠️  No se encontró el archivo $DEV_ENV_FILE"
  echo "   Se usará EXPO_PUBLIC_API_URL de $ENV_FILE (si existe)"
fi
echo ""

# Verificar que NODE_ENV esté configurado (importante para producción)
if [ -z "$NODE_ENV" ]; then
  echo "⚠️  Advertencia: NODE_ENV no está configurado en $ENV_FILE"
  echo "   Se recomienda establecer NODE_ENV=production"
  echo ""
fi

# Ejecutar docker-compose con los argumentos pasados
echo "🚀 Ejecutando docker-compose con variables de producción..."
echo ""

# Pasar todos los argumentos a docker-compose
docker-compose "$@"

