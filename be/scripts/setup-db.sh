#!/bin/sh
# Script para setup de base de datos
# Maneja tanto migraciones como db push según corresponda

set -e

echo "🔧 Setting up database..."

# Verificar que DATABASE_URL esté configurada
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL no está configurada"
  exit 1
fi

# Detectar si es Supabase
IS_SUPABASE=false
if echo "$DATABASE_URL" | grep -q "supabase.co"; then
  IS_SUPABASE=true
  echo "🔍 Detectado Supabase"
fi

# Configurar DIRECT_URL
if [ -z "$DIRECT_URL" ]; then
  if [ "$IS_SUPABASE" = true ] && echo "$DATABASE_URL" | grep -q "pooler.supabase.com"; then
    echo "⚠️  DIRECT_URL no configurada y DATABASE_URL es un pooler de Supabase"
    echo "   Para migraciones, Prisma necesita DIRECT_URL"
    echo "   Opciones:"
    echo "   1. Usar Session Pooler también para DIRECT_URL (recomendado para IPv4)"
    echo "   2. Comprar IPv4 add-on en Supabase y usar conexión directa (puerto 5432)"
    echo ""
    echo "   Usando DATABASE_URL (pooler) como DIRECT_URL..."
    export DIRECT_URL="$DATABASE_URL"
  elif [ "$IS_SUPABASE" = true ] && echo "$DATABASE_URL" | grep -q ":5432"; then
    echo "⚠️  ADVERTENCIA: Conexión directa de Supabase (puerto 5432) detectada"
    echo "   ⚠️  La conexión directa NO es compatible con IPv4"
    echo "   Si estás en Docker o una red IPv4, esto fallará con error P1001"
    echo ""
    echo "   Soluciones:"
    echo "   1. Usar Session Pooler (puerto 6543) - compatible con IPv4"
    echo "      Obtén la URL desde: Supabase Dashboard → Settings → Database → Connection string → Session Pooler"
    echo "   2. Comprar IPv4 add-on en Supabase"
    echo ""
    echo "   Usando DATABASE_URL como DIRECT_URL (puede fallar en IPv4)..."
    export DIRECT_URL="$DATABASE_URL"
  elif [ "$IS_SUPABASE" = true ]; then
    echo "📝 Usando DATABASE_URL como DIRECT_URL (Supabase)"
    export DIRECT_URL="$DATABASE_URL"
  else
    echo "📝 Usando DATABASE_URL como DIRECT_URL"
    export DIRECT_URL="$DATABASE_URL"
  fi
else
  echo "✅ DIRECT_URL configurada"
fi

# Mostrar información de diagnóstico (sin mostrar contraseñas)
echo ""
echo "📊 Database Configuration:"
echo "   DATABASE_URL: ${DATABASE_URL%%@*}@..."
if [ "$IS_SUPABASE" = true ]; then
  if echo "$DATABASE_URL" | grep -q ":5432"; then
    echo "   ⚠️  Conexión directa (5432) - puede fallar en IPv4"
  elif echo "$DATABASE_URL" | grep -q ":6543"; then
    echo "   ✅ Session Pooler (6543) - compatible con IPv4"
  fi
  echo "   💡 Verifica que el proyecto esté activo en: https://supabase.com/dashboard"
fi
echo ""

echo "📦 Generating Prisma Client..."
npx prisma generate

# Verificar si existen migraciones
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "📋 Migraciones encontradas, aplicando migraciones..."
  OUTPUT=$(npx prisma migrate deploy 2>&1) || {
    EXIT_CODE=$?
    echo "$OUTPUT"
    if echo "$OUTPUT" | grep -q "P1001\|Can't reach database server"; then
      echo ""
      echo "❌ ERROR P1001: No se puede conectar al servidor de base de datos"
      if [ "$IS_SUPABASE" = true ] && echo "$DATABASE_URL" | grep -q ":5432"; then
        echo ""
        echo "🔴 PROBLEMA: La conexión directa de Supabase (puerto 5432) NO es compatible con IPv4"
        echo ""
        echo "✅ SOLUCIÓN: Usa el Session Pooler de Supabase (puerto 6543)"
        echo ""
        echo "Pasos:"
        echo "1. Ve a Supabase Dashboard → Settings → Database"
        echo "2. En 'Connection string', selecciona:"
        echo "   - Type: URI"
        echo "   - Source: Primary Database"
        echo "   - Method: Session Pooler (NO Direct connection)"
        echo "3. Copia la URL (debe tener puerto 6543, no 5432)"
        echo "4. Actualiza tu DATABASE_URL y DIRECT_URL con esa URL"
        echo ""
        echo "Ejemplo de URL correcta:"
        echo "postgresql://postgres:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres"
        echo ""
      fi
      exit $EXIT_CODE
    fi
    exit $EXIT_CODE
  }
  echo "$OUTPUT"
  echo "✅ Migraciones aplicadas exitosamente"
else
  echo "⚠️  No se encontraron migraciones, usando db push..."
  echo "   (Esto es normal en desarrollo. Para producción, crea migraciones primero)"
  OUTPUT=$(timeout 60 npx prisma db push --skip-generate --accept-data-loss 2>&1) || {
    EXIT_CODE=$?
    echo "$OUTPUT"
    if echo "$OUTPUT" | grep -q "P1001\|Can't reach database server"; then
      echo ""
      echo "❌ ERROR P1001: No se puede conectar al servidor de base de datos"
      if [ "$IS_SUPABASE" = true ] && echo "$DATABASE_URL" | grep -q ":5432"; then
        echo ""
        echo "🔴 PROBLEMA: La conexión directa de Supabase (puerto 5432) NO es compatible con IPv4"
        echo ""
        echo "✅ SOLUCIÓN: Usa el Session Pooler de Supabase (puerto 6543)"
        echo ""
        echo "Pasos:"
        echo "1. Ve a Supabase Dashboard → Settings → Database"
        echo "2. En 'Connection string', selecciona:"
        echo "   - Type: URI"
        echo "   - Source: Primary Database"
        echo "   - Method: Session Pooler (NO Direct connection)"
        echo "3. Copia la URL (debe tener puerto 6543, no 5432)"
        echo "4. Actualiza tu DATABASE_URL y DIRECT_URL con esa URL"
        echo ""
        echo "Ejemplo de URL correcta:"
        echo "postgresql://postgres:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres"
        echo ""
      elif [ "$IS_SUPABASE" = true ]; then
        echo ""
        echo "💡 Verifica:"
        echo "   - Que el proyecto de Supabase esté activo (no pausado)"
        echo "   - Que las credenciales sean correctas"
        echo "   - Que la URL de conexión sea válida"
      fi
    elif [ $EXIT_CODE -eq 124 ]; then
      echo "❌ Timeout: db push se quedó colgado"
      echo "   Esto puede pasar si usas pooler para migraciones"
    else
      echo "❌ Error al aplicar schema (código: $EXIT_CODE)"
      echo "   Verifica la conexión a la base de datos y las credenciales"
    fi
    exit $EXIT_CODE
  }
  echo "$OUTPUT"
  echo "✅ Schema aplicado exitosamente"
fi

echo "🎉 Database setup completado!"

