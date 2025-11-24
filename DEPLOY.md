# Deploy en Fly.io

Este documento explica cómo hacer deploy del backend en Fly.io.

## Prerrequisitos

1. Instalar Fly CLI:

```bash
curl -L https://fly.io/install.sh | sh
```

2. Iniciar sesión en Fly.io:

```bash
fly auth login
```

## Configuración inicial

1. Crear una nueva aplicación en Fly.io (si no existe):

```bash
fly apps create zig-zag-backend
```

## Configuración de Base de Datos

Tienes dos opciones para la base de datos:

### Opción A: Supabase (Recomendado para empezar)

**Ventajas:**

- Plan gratuito generoso (500 MB de base de datos)
- Dashboard visual muy útil para desarrollo
- Configuración más simple
- Incluye autenticación, storage y funciones edge

**Pasos:**

1. Crear cuenta en [Supabase](https://supabase.com) (si no tienes una)

2. Crear un nuevo proyecto:

   - Ve a https://supabase.com/dashboard
   - Click en "New Project"
   - Elige un nombre (ej: `zig-zag`)
   - Elige una región cercana (ej: `US East`)
   - Espera a que se cree el proyecto (~2 minutos)

3. Obtener la connection string:

   - En el dashboard de Supabase, ve a **Settings** → **Database**
   - Busca la sección "Connection string"
   - Copia la URI que dice "URI" (formato: `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres`)
   - Reemplaza `[YOUR-PASSWORD]` con la contraseña que configuraste al crear el proyecto

4. Configurar la variable en Fly.io:

```bash
fly secrets set DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres" --app zig-zag-backend
```

**Nota:** También puedes usar el script `fly-secrets-import.sh` y agregar `DATABASE_URL` a tu archivo `.env.fly`

### Opción B: Fly.io Postgres (Todo en un solo proveedor)

**Ventajas:**

- Todo en Fly.io (app + base de datos)
- Latencia más baja si tu app está en Fly.io
- Más control sobre la configuración

**Pasos:**

1. Crear una base de datos PostgreSQL en Fly.io:

```bash
fly postgres create --name zig-zag-db --region iad
```

2. Conectar la base de datos a la aplicación:

```bash
fly postgres attach --app zig-zag-backend zig-zag-db
```

Esto automáticamente configurará la variable `DATABASE_URL` en tu aplicación.

## Configurar variables de entorno

### Opción 1: Usar archivo .env.fly (Recomendado)

1. Crea un archivo `.env.fly` en la raíz del proyecto con todas las variables necesarias:

```bash
# Copia el archivo de ejemplo y edítalo
cp cloud-run/env/backend.env.example .env.fly
```

2. Edita `.env.fly` y completa los valores (especialmente las API keys y DATABASE_URL)

3. Importa todas las variables de una vez:

**Método recomendado: Usar el script helper**

```bash
# Usa el script incluido (más fácil y seguro)
./fly-secrets-import.sh zig-zag-backend
```

**Método alternativo: Script manual**

Si prefieres hacerlo manualmente, puedes usar este script:

```bash
# Lee el archivo .env.fly y configura cada variable
while IFS= read -r line || [ -n "$line" ]; do
  # Ignora comentarios y líneas vacías
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue

  # Separa key y value
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    # Elimina espacios y comillas
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs | sed 's/^"//;s/"$//')

    # Configura el secreto
    if [ -n "$key" ] && [ -n "$value" ]; then
      fly secrets set "${key}=${value}" --app zig-zag-backend
    fi
  fi
done < .env.fly
```

**Nota:** El archivo `.env.fly` debe contener solo las variables que quieres configurar en formato `KEY=VALUE` (una por línea). Puedes excluir `DATABASE_URL` si ya la configuraste al conectar PostgreSQL, o incluirla si quieres sobrescribirla. Las líneas que empiezan con `#` se ignoran.

### Opción 2: Configurar variables individualmente

Si prefieres configurar variables una por una:

```bash
# Variables requeridas
fly secrets set DATABASE_URL="postgresql://..." --app zig-zag-backend
fly secrets set DIRECT_URL="postgresql://..." --app zig-zag-backend

# Variables opcionales pero recomendadas
fly secrets set OPENAI_API_KEY="tu-api-key" --app zig-zag-backend
fly secrets set GOOGLE_MAPS_API_KEY="tu-api-key" --app zig-zag-backend
fly secrets set CHROMA_URL="http://tu-chroma-instance:8000" --app zig-zag-backend

# Variables de configuración
fly secrets set NODE_ENV="production" --app zig-zag-backend
fly secrets set CORS_ENABLED="true" --app zig-zag-backend
fly secrets set CORS_ORIGIN="*" --app zig-zag-backend
fly secrets set SWAGGER_ENABLED="true" --app zig-zag-backend

# Variables de AI (opcionales)
fly secrets set ENABLE_AI="true" --app zig-zag-backend
fly secrets set AI_PROVIDER="openai" --app zig-zag-backend
fly secrets set AI_MODEL="gpt-3.5-turbo" --app zig-zag-backend
fly secrets set OPENAI_DEFAULT_MODEL="gpt-3.5-turbo" --app zig-zag-backend
fly secrets set OPENAI_TEMPERATURE="0.7" --app zig-zag-backend
fly secrets set OPENAI_TIMEOUT="60000" --app zig-zag-backend
fly secrets set EMBEDDINGS_MODEL="nomic-embed-text" --app zig-zag-backend
```

### Verificar variables configuradas

Para ver todas las variables de entorno configuradas:

```bash
fly secrets list --app zig-zag-backend
```

## Migraciones de base de datos

Antes del primer deploy, necesitas crear las tablas en la base de datos. El proyecto incluye un script de setup automatizado que detecta si hay migraciones y aplica la estrategia correcta.

### Setup Automático (Recomendado)

El script `be/scripts/setup-db.sh` se ejecuta automáticamente cuando usas Docker Compose. También puedes ejecutarlo manualmente:

**Con Docker Compose:**

El setup se ejecuta automáticamente al iniciar el contenedor. Solo asegúrate de tener `DATABASE_URL` configurada:

```bash
# Si usas Supabase, configura DATABASE_URL en tu .env o docker-compose.yml
docker-compose up backend
```

**Manualmente (dentro del contenedor o localmente):**

```bash
cd be
# Configura DATABASE_URL según tu caso
export DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
yarn prisma:setup
# O directamente:
sh scripts/setup-db.sh
```

El script:

- ✅ Genera el Prisma Client
- ✅ Si hay migraciones en `prisma/migrations`, aplica `prisma migrate deploy`
- ✅ Si no hay migraciones, usa `prisma db push` (útil para desarrollo)

### Setup Manual (Si prefieres control total)

#### Opción A: Usar `prisma db push` (Rápido para empezar)

Esta opción crea las tablas directamente desde el schema sin crear archivos de migración. Útil para desarrollo o cuando no tienes migraciones aún.

**Si usas Supabase:**

```bash
cd be
# Obtén la DATABASE_URL desde Supabase Dashboard → Settings → Database
DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres" npx prisma db push
```

**Si usas Fly.io Postgres:**

```bash
cd be
DATABASE_URL="$(fly secrets list --app zig-zag-backend | grep DATABASE_URL | awk '{print $2}')" npx prisma db push
```

#### Opción B: Crear migraciones primero (Recomendado para producción)

Esta opción crea archivos de migración que puedes versionar y aplicar en diferentes ambientes.

**Paso 1: Crear las migraciones iniciales (desde tu máquina local)**

```bash
cd be
# Obtén la DATABASE_URL desde Supabase Dashboard → Settings → Database
DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres" yarn prisma:migrate --name init
```

Esto creará un directorio `prisma/migrations` con las migraciones y aplicará los cambios a la base de datos.

**Paso 2: Aplicar migraciones en producción (desde Fly.io)**

```bash
fly ssh console --app zig-zag-backend
# Dentro del contenedor:
cd be
yarn prisma:deploy
```

**Nota:** Si `prisma migrate deploy` no hace nada, significa que:

- No hay migraciones en `prisma/migrations` (usa la Opción A o crea las migraciones primero)
- O todas las migraciones ya están aplicadas (verifica con `npx prisma migrate status`)

## Deploy

1. Hacer deploy de la aplicación:

```bash
fly deploy
```

2. Verificar el estado:

```bash
fly status
```

3. Ver los logs:

```bash
fly logs
```

## Comandos útiles

- Ver información de la app: `fly info`
- Ver variables de entorno: `fly secrets list`
- Abrir una consola SSH: `fly ssh console`
- Ver métricas: `fly metrics`
- Escalar la aplicación: `fly scale count 2` (para 2 instancias)

## Troubleshooting

### La aplicación no inicia

- Revisa los logs: `fly logs`
- Verifica las variables de entorno: `fly secrets list`
- Asegúrate de que la base de datos esté accesible

### Error de conexión a la base de datos

- Verifica que la base de datos esté conectada: `fly postgres list`
- Revisa la variable `DATABASE_URL`: `fly secrets list`

### Error en las migraciones

- Ejecuta las migraciones manualmente desde SSH: `fly ssh console`
- Verifica que Prisma esté instalado: `npx prisma --version`

## Notas

- El puerto se configura automáticamente a través de la variable `PORT` (fly.io usa 3000)
- La aplicación se construye usando el Dockerfile en `be/Dockerfile`
- El contexto de build es la raíz del proyecto (monorepo)
- Las variables de entorno se configuran como secrets en Fly.io para mayor seguridad
