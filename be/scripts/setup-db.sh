#!/bin/sh
# Script para setup de base de datos
# Maneja tanto migraciones como db push según corresponda

set -e

echo "🔧 Setting up database..."

# Verificar que DATABASE_URL esté configurada
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL no está configurada"
  echo "   En Fly.io, asegúrate de que DATABASE_URL esté configurada como secret:"
  echo "   fly secrets set DATABASE_URL=\"postgresql://...\" --app zig-zag-backend"
  exit 1
fi

# Verificar que DATABASE_URL no esté vacía
if [ "$DATABASE_URL" = "" ]; then
  echo "❌ ERROR: DATABASE_URL está vacía"
  exit 1
fi

echo "✅ DATABASE_URL configurada (${#DATABASE_URL} caracteres)"

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

# Función helper para manejar errores de base de datos
handle_db_error() {
  local OUTPUT="$1"
  local EXIT_CODE="$2"
  
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
    else
      echo ""
      echo "💡 Verifica:"
      echo "   - Que PostgreSQL esté corriendo"
      echo "   - Que DATABASE_URL sea correcta"
      echo "   - Que las credenciales sean válidas"
      echo "   - Que la base de datos exista"
    fi
  else
    echo "❌ Error al aplicar schema (código: $EXIT_CODE)"
    echo "   Verifica la conexión a la base de datos y las credenciales"
  fi
}

# Verificar si existen migraciones
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  MIGRATION_COUNT=$(ls -1 prisma/migrations 2>/dev/null | wc -l)
  echo "📋 Migraciones encontradas ($MIGRATION_COUNT), aplicando migraciones..."
  echo "   Migraciones disponibles: $(ls -1 prisma/migrations 2>/dev/null | tr '\n' ' ')"
  # Verificar que DATABASE_URL esté disponible antes de ejecutar migrate deploy
  if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL no está disponible para prisma migrate deploy"
    exit 1
  fi
  
  # Exportar DATABASE_URL explícitamente para asegurar que Prisma la vea
  export DATABASE_URL
  if [ -n "$DIRECT_URL" ]; then
    export DIRECT_URL
  fi
  
  OUTPUT=$(npx prisma migrate deploy 2>&1) || {
    EXIT_CODE=$?
    echo "$OUTPUT"
    # Check for datasource configuration errors
    if echo "$OUTPUT" | grep -q "datasource property is required\|The datasource property"; then
      echo ""
      echo "❌ ERROR: Problema con la configuración del datasource en prisma.config.ts"
      echo "   DATABASE_URL disponible: $([ -n "$DATABASE_URL" ] && echo "Sí (${#DATABASE_URL} chars)" || echo "No")"
      echo ""
      echo "💡 SOLUCIÓN: Verifica que DATABASE_URL esté configurada correctamente en Fly.io:"
      echo "   fly secrets list --app zig-zag-backend"
      echo ""
    fi
    # Check if there's a schema drift (schema has changes not in migrations)
    if echo "$OUTPUT" | grep -q "drift\|Drift\|migration history"; then
      echo ""
      echo "⚠️  ADVERTENCIA: Se detectó drift entre el schema y las migraciones"
      echo "   Esto significa que el schema tiene cambios que no están en las migraciones"
      echo ""
      echo "💡 SOLUCIÓN: Necesitas crear una migración para los cambios:"
      echo "   1. Conecta a la base de datos de producción"
      echo "   2. Ejecuta: cd be && npx prisma migrate dev --name add_missing_columns"
      echo "   3. Esto creará una migración con los cambios faltantes"
      echo "   4. Luego despliega nuevamente"
      echo ""
      echo "   O temporalmente, puedes usar db push (NO recomendado para producción):"
      echo "   npx prisma db push --accept-data-loss"
      echo ""
    fi
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
  if [ "$NODE_ENV" = "production" ]; then
    echo "   ⚠️  ADVERTENCIA: Estás en PRODUCCIÓN sin migraciones!"
    echo "   Esto puede causar problemas si el schema cambió."
    echo "   💡 RECOMENDACIÓN: Crea migraciones antes de deployar a producción:"
    echo "      cd be && yarn prisma:migrate --name init"
    echo ""
  else
    echo "   (Esto es normal en desarrollo. Para producción, crea migraciones primero)"
  fi
  
  # Mostrar información de diagnóstico
  echo "🔍 Información de conexión:"
  echo "   Host: $(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p' || echo 'N/A')"
  echo "   Base de datos: $(echo "$DATABASE_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p' || echo 'N/A')"
  
  # Ejecutar db push
  # Nota: En Alpine, timeout puede no estar disponible
  # Si se queda colgado, el usuario puede cancelar y crear migraciones
  echo "📋 Ejecutando db push..."
  echo "   ⏳ Esto puede tardar unos momentos (especialmente la primera vez)..."
  
  # Intentar con timeout si está disponible
  if command -v timeout > /dev/null 2>&1; then
    echo "   ⏱️  Usando timeout de 120 segundos..."
    OUTPUT=$(timeout 120 npx prisma db push --accept-data-loss 2>&1) || {
      EXIT_CODE=$?
      echo "$OUTPUT"
      if [ $EXIT_CODE -eq 124 ]; then
        echo ""
        echo "❌ Timeout: db push se quedó colgado después de 120 segundos"
        echo ""
        echo "💡 Soluciones:"
        echo "   1. Verifica que PostgreSQL esté corriendo y accesible"
        echo "   2. Verifica los logs de PostgreSQL: docker-compose logs postgres"
        echo "   3. Intenta crear migraciones en su lugar:"
        echo "      npx prisma migrate dev --name init"
        exit $EXIT_CODE
      fi
      handle_db_error "$OUTPUT" "$EXIT_CODE"
      exit $EXIT_CODE
    }
  else
    # Sin timeout - ejecutar directamente con más logging
    echo "   ⚠️  timeout no disponible, ejecutando sin límite de tiempo..."
    echo "   Si se queda colgado, presiona Ctrl+C y crea migraciones: npx prisma migrate dev --name init"
    OUTPUT=$(npx prisma db push --accept-data-loss 2>&1) || {
      EXIT_CODE=$?
      echo "$OUTPUT"
      handle_db_error "$OUTPUT" "$EXIT_CODE"
      exit $EXIT_CODE
    }
  fi
  
  echo "$OUTPUT"
  echo "✅ Schema aplicado exitosamente"
fi

echo "🎉 Database setup completado!"

