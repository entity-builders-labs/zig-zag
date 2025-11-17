#!/bin/bash

# Script para importar variables de entorno desde .env.fly a Fly.io
# Uso: ./fly-secrets-import.sh [app-name]

set -e

APP_NAME="${1:-zig-zag-backend}"
ENV_FILE="${2:-.env.fly}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: Archivo $ENV_FILE no encontrado"
  echo "💡 Crea el archivo copiando: cp cloud-run/env/backend.env.example $ENV_FILE"
  exit 1
fi

echo "📦 Importando variables de entorno desde $ENV_FILE a Fly.io app: $APP_NAME"
echo ""

# Contador de variables importadas
count=0

# Lee el archivo línea por línea
while IFS= read -r line || [ -n "$line" ]; do
  # Ignora comentarios y líneas vacías
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  
  # Separa key y value
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    
    # Elimina espacios al inicio y final
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    # Elimina comillas si existen
    value=$(echo "$value" | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
    
    # Solo procesa si key y value no están vacíos
    if [ -n "$key" ] && [ -n "$value" ]; then
      echo "  ✓ Configurando: $key"
      fly secrets set "${key}=${value}" --app "$APP_NAME" > /dev/null 2>&1
      ((count++))
    fi
  fi
done < "$ENV_FILE"

echo ""
echo "✅ Importación completada: $count variables configuradas"
echo "💡 Verifica con: fly secrets list --app $APP_NAME"

