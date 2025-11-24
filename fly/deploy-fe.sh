#!/bin/bash
# Script para deploy del frontend con el secret de Google Maps API
# Uso: ./deploy-fe.sh [api-key]
#   Si pasas la API key como argumento, se usará para el build
#   Si no, intentará leerla del entorno o de fly-fe.toml

set -e

# Get the directory where the script is located (fly directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root directory
cd "$PROJECT_ROOT"

APP_NAME="zig-zag-frontend"
SECRET_NAME="EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
CONFIG_FILE="fly/fly-fe.toml"

echo "🚀 Deploying frontend to Fly.io..."
echo ""

# Function to find .env file (priority: .env.prod > .env.fly > fe/.env.prod > fe/.env.fly > fe/.env > .env)
# RECOMMENDED: Use .env.prod in project root for production
# FALLBACK: Supports fe/.env.* for backward compatibility
find_env_file() {
  # First, check in root folder (RECOMMENDED for production)
  for file in ".env.prod" ".env.fly"; do
    if [ -f "$file" ]; then
      echo "$file"
      return
    fi
  done
  
  # Fallback to fe/ folder (for backward compatibility)
  for file in "fe/.env.prod" "fe/.env.fly" "fe/.env"; do
    if [ -f "$file" ]; then
      echo "$file"
      return
    fi
  done
  
  # Last resort: root .env (development file - not recommended for production)
  if [ -f ".env" ]; then
    echo ".env"
    return
  fi
  
  echo ""
}

# Frontend-specific environment variables (only EXPO_PUBLIC_* variables)
is_frontend_var() {
  local key="$1"
  # Only include frontend variables
  [[ "$key" =~ ^EXPO_PUBLIC_ ]]
}

# Function to import only missing or changed frontend variables from .env file to Fly.io
import_env_to_fly() {
  local env_file="$1"
  if [ ! -f "$env_file" ]; then
    return 1
  fi
  
  echo "📄 Reading frontend variables from $env_file..."
  echo ""
  
  # Get list of currently configured secrets
  local configured_secrets=$(fly secrets list --app "$APP_NAME" 2>/dev/null | awk 'NR>1 {print $1}' || echo "")
  
  local count=0
  local secrets_to_set=()
  local skipped_count=0
  
  # Read the file line by line
  while IFS= read -r line || [ -n "$line" ]; do
    # Ignore comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    
    # Parse key=value
    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"
      
      # Trim spaces
      key=$(echo "$key" | xargs)
      value=$(echo "$value" | xargs)
      
      # Remove quotes if present
      value=$(echo "$value" | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
      
      # Only process if key and value are not empty
      if [ -n "$key" ] && [ -n "$value" ]; then
        # Filter: only frontend variables (EXPO_PUBLIC_*)
        if is_frontend_var "$key"; then
          # Only set if not already configured (skip if already exists)
          if echo "$configured_secrets" | grep -q "^${key}$"; then
            echo "   ⊘ Skipping $key (already configured)"
            ((skipped_count++))
          else
            secrets_to_set+=("${key}=${value}")
            echo "   ✓ Found (new): $key"
            ((count++))
          fi
        else
          echo "   ⊘ Skipping $key (backend variable)"
        fi
      fi
    fi
  done < "$env_file"
  
  if [ ${#secrets_to_set[@]} -gt 0 ]; then
    echo ""
    echo "🔧 Configuring ${#secrets_to_set[@]} new secrets in Fly.io..."
    for secret_pair in "${secrets_to_set[@]}"; do
      local secret_name=$(echo "$secret_pair" | cut -d'=' -f1)
      echo "   → Setting $secret_name..."
      fly secrets set "$secret_pair" --app "$APP_NAME" > /dev/null 2>&1
    done
    echo "✅ ${#secrets_to_set[@]} new secrets configured"
    if [ $skipped_count -gt 0 ]; then
      echo "   ℹ️  $skipped_count secrets already configured (skipped)"
    fi
    echo ""
    return 0
  else
    if [ $skipped_count -gt 0 ]; then
      echo ""
      echo "✅ All frontend secrets are already configured ($skipped_count found, 0 new)"
      echo ""
      return 0  # Success: all secrets are configured
    else
      echo "   ⚠️  No frontend variables found in $env_file"
      echo ""
      return 1  # Error: no variables found
    fi
  fi
}

# Try to import only missing frontend variables from .env file
ENV_FILE_FOUND=$(find_env_file)
if [ -n "$ENV_FILE_FOUND" ]; then
  echo "📋 Checking for missing frontend variables in $ENV_FILE_FOUND..."
  import_env_to_fly "$ENV_FILE_FOUND" || true  # Don't fail if all are already configured
fi

# Determinar de dónde obtener las variables
API_KEY=""
API_URL=""
ENV_FILE="${ENV_FILE_FOUND:-.env.prod}"

# Función para leer variable del .env
read_env_var() {
  local var_name="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^[[:space:]]*${var_name}[[:space:]]*=" "$ENV_FILE" 2>/dev/null | head -1 | sed -E 's/^[^=]*=[[:space:]]*["'\'']?([^"'\'']*)["'\'']?[[:space:]]*$/\1/'
  fi
}

# Opción 1: Del archivo .env (prioridad más alta)
if [ -f "$ENV_FILE" ]; then
  # Lee la API key del archivo .env
  API_KEY=$(read_env_var "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY")
  if [ -n "$API_KEY" ]; then
    echo "✅ Usando API key del archivo .env"
  fi
  
  # Lee la API URL del archivo .env
  API_URL=$(read_env_var "EXPO_PUBLIC_API_URL")
  if [ -n "$API_URL" ]; then
    echo "✅ Usando API URL del archivo .env: $API_URL"
  else
    # Si no está en .env, usar la URL por defecto del backend en Fly.io
    API_URL="https://zig-zag-backend.fly.dev"
    echo "⚠️  EXPO_PUBLIC_API_URL no encontrada en .env, usando URL por defecto: $API_URL"
  fi
fi

# Opción 2: Pasada como argumento (sobrescribe .env)
if [ -z "$API_KEY" ] && [ -n "$1" ]; then
  API_KEY="$1"
  echo "✅ Usando API key pasada como argumento"
# Opción 3: Del entorno local
elif [ -z "$API_KEY" ] && [ -n "$EXPO_PUBLIC_GOOGLE_MAPS_API_KEY" ]; then
  API_KEY="$EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
  echo "✅ Usando API key del entorno local (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)"
# Opción 4: Verificar si está en fly-fe.toml
elif [ -z "$API_KEY" ] && grep -q "^[[:space:]]*EXPO_PUBLIC_GOOGLE_MAPS_API_KEY[[:space:]]*=" "$CONFIG_FILE" 2>/dev/null; then
  echo "✅ API key encontrada en $CONFIG_FILE"
  echo "📦 Deployando (el secret se tomará de [env] en $CONFIG_FILE)..."
  # Context in fly-fe.toml is set to ".", dockerfile is "fe/Dockerfile.prod" relative to project root
  fly deploy --config "$CONFIG_FILE" --app "$APP_NAME"
  echo ""
  echo "✅ Deploy completado!"
  exit 0
fi

# Si no tenemos API_URL, usar la URL por defecto del backend
if [ -z "$API_URL" ]; then
  API_URL="https://zig-zag-backend.fly.dev"
  echo "⚠️  Usando API URL por defecto: $API_URL"
fi

# Si aún no tenemos la API key, mostrar error
if [ -z "$API_KEY" ]; then
  echo "❌ No se encontró EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
  echo ""
  echo "💡 Opciones para configurar la API key:"
  echo ""
  echo "   1. Agrégala en el archivo .env en la raíz del proyecto:"
  echo "      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=\"tu-api-key\""
  echo "      EXPO_PUBLIC_API_URL=\"https://zig-zag-backend.fly.dev\""
  echo ""
  echo "   2. Pásala como argumento:"
  echo "      ./deploy-fe.sh \"tu-api-key\""
  echo ""
  echo "   3. Expórtala en tu terminal:"
  echo "      export EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=\"tu-api-key\""
  echo "      ./deploy-fe.sh"
  echo ""
    echo "   4. Agrégala en fly-fe.toml en la sección [env]:"
  echo "      [env]"
  echo "        EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = \"tu-api-key\""
  echo "      ⚠️  NO versiones el archivo con el secret incluido"
  echo ""
  exit 1
fi

# Verificar que el secret esté configurado en Fly.io (para runtime)
echo "🔍 Verificando que el secret esté configurado en Fly.io..."
if ! fly secrets list --app "$APP_NAME" 2>/dev/null | grep -q "$SECRET_NAME"; then
  echo "⚠️  El secret $SECRET_NAME no está configurado en Fly.io"
  echo "💡 Configurándolo ahora..."
  fly secrets set "$SECRET_NAME=$API_KEY" --app "$APP_NAME"
  echo "✅ Secret configurado en Fly.io"
else
  echo "✅ Secret ya configurado en Fly.io"
fi

echo ""
echo "📦 Iniciando deploy con build args..."
echo "   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: [configurado]"
echo "   EXPO_PUBLIC_API_URL: $API_URL"
# Context in fly-fe.toml is set to ".", dockerfile is "fe/Dockerfile.prod" relative to project root
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME" \
  --build-arg EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="$API_KEY" \
  --build-arg EXPO_PUBLIC_API_URL="$API_URL"

echo ""
echo "✅ Deploy completado!"

