# Deploy on Fly.io

This document explains how to deploy the backend on Fly.io.

## Prerequisites

1. Install Fly CLI:

```bash
curl -L https://fly.io/install.sh | sh
```

2. Log in to Fly.io:

```bash
fly auth login
```

## Initial Configuration

1. Create a new application on Fly.io (if it doesn't exist):

```bash
fly apps create zig-zag-backend
```

## Chroma Deployment (Vector Database)

Chroma is the vector database used for semantic search and embeddings. You can deploy it as a separate application on Fly.io.

### Prerequisites

- Fly CLI installed and authenticated (see "Prerequisites" section above)

### Create the Chroma application

**⚠️ IMPORTANT:** You must create the application BEFORE creating the volume. The volume requires the application to exist to be attached.

1. Create a new application for Chroma:

```bash
fly apps create zig-zag-chroma
```

2. Create one or more persistent volumes for Chroma data:

**Option A: Single volume (for development/testing)**

```bash
fly volumes create chroma_data --size 1 --region iad --app zig-zag-chroma
```

**Option B: Multiple volumes (recommended for production)**

Fly.io recommends creating at least 2 volumes to avoid downtime. If a host fails, the application can continue running with the other volume:

```bash
# Create the first volume
fly volumes create chroma_data --size 1 --region iad --app zig-zag-chroma

# Create a second volume (optional but recommended)
fly volumes create chroma_data_2 --size 1 --region iad --app zig-zag-chroma
```

**Notes:**

- Adjust the size (`--size`) according to your needs. The minimum volume is 1GB.
- Make sure to create the volumes in the same region where you will deploy the application (in this case `iad`).
- Volumes will be automatically attached when you deploy the application according to the configuration in `fly-chroma.toml`.
- If you create multiple volumes, you will need to update `fly-chroma.toml` to include all mounts (see troubleshooting section).

### Chroma Deploy

1. Use the `fly-chroma.toml` configuration file:

```bash
fly deploy --config fly-chroma.toml
```

2. Verify that Chroma is running:

```bash
fly status --app zig-zag-chroma
```

3. View logs:

```bash
fly logs --app zig-zag-chroma
```

### Get Chroma URL

Once deployed, get the public URL of your Chroma instance:

```bash
# Get the full URL
fly status --app zig-zag-chroma | grep "Hostname"

# Or the direct URL will be:
# https://zig-zag-chroma.fly.dev
```

### Configure CHROMA_URL in backend

After deploying Chroma, configure the `CHROMA_URL` variable in your backend application:

```bash
# Use the public URL of your Chroma instance
fly secrets set CHROMA_URL="https://zig-zag-chroma.fly.dev" --app zig-zag-backend
```

**Note:** Make sure to use the full URL with `https://` and without the port (Fly.io handles routing automatically).

### Verify connection

You can verify that Chroma is working correctly:

```bash
# Verify health check
curl https://zig-zag-chroma.fly.dev/api/v1/heartbeat
```

You should receive a JSON response with the Chroma status.

### Useful commands for Chroma

- View app info: `fly info --app zig-zag-chroma`
- View real-time logs: `fly logs --app zig-zag-chroma`
- Open SSH console: `fly ssh console --app zig-zag-chroma`
- View metrics: `fly metrics --app zig-zag-chroma`
- Restart application: `fly apps restart zig-zag-chroma`

### Chroma Troubleshooting

**Chroma does not start:**

- Check logs: `fly logs --app zig-zag-chroma`
- Verify volume exists: `fly volumes list --app zig-zag-chroma`

**Connection error from backend:**

- Verify `CHROMA_URL` is configured correctly: `fly secrets list --app zig-zag-backend`
- Ensure you use the full URL with `https://`
- Verify both applications are in the same region for lower latency

**Data does not persist:**

- Verify volume is mounted: `fly volumes list --app zig-zag-chroma`
- Volume must be at `/data` according to configuration
- If you created multiple volumes, Chroma will only use one by default. To use multiple volumes, you would need to configure replication in Chroma or use a distributed file system

**Health check fails:**

- If the endpoint `/api/v1/heartbeat` does not work, you can change the health check in `fly-chroma.toml` to use `tcp_checks` instead of `http_checks`, or change the path to `/`
- You can also temporarily disable the health check for debugging

**Error creating volume: "is not a valid answer" or "zig-zag-chroma is not a valid answer":**

- **IMPORTANT:** You must create the application FIRST before creating the volume
- Run: `fly apps create zig-zag-chroma` before creating the volume
- The volume requires the application to exist before it can be created
- When Fly.io asks "Do you still want to use the volumes feature? (y/N)", answer `y` to continue

## Ollama Cloud Configuration (AI)

For production, it is recommended to use **Ollama Cloud** instead of running Ollama locally. This saves resources and simplifies deployment.

### Prerequisites

1. Create account at [Ollama Cloud](https://ollama.com/cloud)
2. Get your API key from the dashboard

### Configuration on Fly.io

**Recommended method: Use configuration script**

```bash
./configure-ollama-cloud.sh
```

This script will guide you step by step to configure Ollama Cloud.

**Alternative method: Manual configuration**

1. Configure environment variables:

```bash
# Configure Ollama Cloud
fly secrets set OLLAMA_BASE_URL="https://api.ollama.com" --app zig-zag-backend
fly secrets set OLLAMA_API_KEY="your-ollama-cloud-api-key" --app zig-zag-backend

# Configure AI provider
fly secrets set AI_PROVIDER="ollama" --app zig-zag-backend
fly secrets set AI_MODEL="llama3.2:3b" --app zig-zag-backend
fly secrets set ENABLE_AI="true" --app zig-zag-backend

# Optional configuration
fly secrets set OLLAMA_TIMEOUT="240000" --app zig-zag-backend  # 4 minutes (240 seconds)
fly secrets set EMBEDDINGS_MODEL="nomic-embed-text" --app zig-zag-backend
```

2. Verify configuration:

```bash
fly secrets list --app zig-zag-backend | grep OLLAMA
```

### Important notes

- **Ollama Cloud** uses `https://api.ollama.com` as base URL
- You need a valid **API key** from Ollama Cloud
- Default timeout is 4x base timeout (240 seconds) for large models
- **Embeddings** may require additional configuration if using Ollama Cloud (some embedding models may not be available on Cloud)

### Alternative: Use OpenAI or Groq

If you prefer to use another AI provider:

```bash
# For OpenAI
fly secrets set AI_PROVIDER="openai" --app zig-zag-backend
fly secrets set OPENAI_API_KEY="your-api-key" --app zig-zag-backend
fly secrets set OPENAI_DEFAULT_MODEL="gpt-3.5-turbo" --app zig-zag-backend

# For Groq
fly secrets set AI_PROVIDER="groq" --app zig-zag-backend
fly secrets set GROQ_API_KEY="your-api-key" --app zig-zag-backend
```

## Database Configuration

### 🏗️ Database Architecture

**Local Development (Docker):**

- ✅ Uses **Local PostgreSQL** in Docker Compose (automatic)
- ✅ No need to configure `DATABASE_URL` - used automatically
- ✅ Database: `postgresql://postgres:postgres@postgres:5432/zigzag`

**Production (Fly.io):**

- ✅ Uses **Supabase** (recommended)
- ✅ Configure `DATABASE_URL` and `DIRECT_URL` in Fly.io secrets
- ✅ Uses Session Pooler (port 6543) for IPv4 compatibility

### Production Configuration (Supabase - Recommended)

**Advantages:**

- Generous free plan (500 MB database)
- Very useful visual dashboard for development
- Simpler configuration
- Includes authentication, storage, and edge functions

**Steps:**

1. Create account at [Supabase](https://supabase.com) (if you don't have one)

2. Create a new project:

   - Go to https://supabase.com/dashboard
   - Click on "New Project"
   - Choose a name (e.g., `zig-zag`)
   - Choose a nearby region (e.g., `US East`)
   - Wait for the project to be created (~2 minutes)

3. Get connection string:

   - In Supabase Dashboard, go to **Settings** → **Database**
   - Find "Connection string" section
   - **IMPORTANT:** Select:
     - **Type:** URI
     - **Source:** Primary Database
     - **Method:** Session Pooler (⚠️ NOT Direct connection)
   - Copy URI (must have port **6543**, not 5432)
   - Format: `postgresql://postgres:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`
   - Replace `[YOUR-PASSWORD]` with the password you set when creating the project

4. Configure variables in Fly.io:

```bash
# IMPORTANT: Use Session Pooler (port 6543), NOT Direct connection (5432)
# Direct connection does NOT work with IPv4 on Fly.io
fly secrets set DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@aws-0-[region].pooler.supabase.com:6543/postgres" --app zig-zag-backend
fly secrets set DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@aws-0-[region].pooler.supabase.com:6543/postgres" --app zig-zag-backend
```

**Note:** You can also use `fly-secrets-import.sh` script and add `DATABASE_URL` to your `.env.fly` file

### Option B: Fly.io Postgres (All in one provider)

**Advantages:**

- All in Fly.io (app + database)
- Lower latency if your app is on Fly.io
- More control over configuration

**Steps:**

1. Create a PostgreSQL database on Fly.io:

```bash
fly postgres create --name zig-zag-db --region iad
```

2. Connect database to application:

```bash
fly postgres attach --app zig-zag-backend zig-zag-db
```

This will automatically configure the `DATABASE_URL` variable in your application.

## Configure Environment Variables

### Option 1: Use .env.fly file (Recommended)

1. Create a `.env.fly` file in the project root with all necessary variables:

```bash
# Copy example file and edit it
cp cloud-run/env/backend.env.example .env.fly
```

2. Edit `.env.fly` and fill in values (especially API keys and DATABASE_URL)

3. Import all variables at once:

**Recommended method: Use helper script**

```bash
# Use included script (easier and safer)
./fly-secrets-import.sh zig-zag-backend
```

**Alternative method: Manual script**

If you prefer to do it manually, you can use this script:

```bash
# Read .env.fly file and configure each variable
while IFS= read -r line || [ -n "$line" ]; do
  # Ignore comments and empty lines
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue

  # Separate key and value
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    # Remove spaces and quotes
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs | sed 's/^"//;s/"$//')

    # Configure secret
    if [ -n "$key" ] && [ -n "$value" ]; then
      fly secrets set "${key}=${value}" --app zig-zag-backend
    fi
  fi
done < .env.fly
```

**Note:** The `.env.fly` file should contain only variables you want to configure in `KEY=VALUE` format (one per line). You can exclude `DATABASE_URL` if you already configured it when connecting PostgreSQL, or include it if you want to overwrite it. Lines starting with `#` are ignored.

### Option 2: Configure variables individually

If you prefer to configure variables one by one:

```bash
# Required variables
fly secrets set DATABASE_URL="postgresql://..." --app zig-zag-backend
fly secrets set DIRECT_URL="postgresql://..." --app zig-zag-backend

# Optional but recommended variables
fly secrets set OPENAI_API_KEY="your-api-key" --app zig-zag-backend
fly secrets set GOOGLE_MAPS_API_KEY="your-api-key" --app zig-zag-backend
# If you deployed Chroma on Fly.io, use public URL:
fly secrets set CHROMA_URL="https://zig-zag-chroma.fly.dev" --app zig-zag-backend

# Configuration variables
fly secrets set NODE_ENV="production" --app zig-zag-backend
fly secrets set CORS_ENABLED="true" --app zig-zag-backend
fly secrets set CORS_ORIGIN="*" --app zig-zag-backend
fly secrets set SWAGGER_ENABLED="true" --app zig-zag-backend

# AI variables (optional)
fly secrets set ENABLE_AI="true" --app zig-zag-backend
fly secrets set AI_PROVIDER="ollama" --app zig-zag-backend
fly secrets set AI_MODEL="llama3.2:3b" --app zig-zag-backend
fly secrets set EMBEDDINGS_MODEL="nomic-embed-text" --app zig-zag-backend

# Ollama Cloud configuration (for production)
# Get your API key from https://ollama.com/cloud
fly secrets set OLLAMA_BASE_URL="https://api.ollama.com" --app zig-zag-backend
fly secrets set OLLAMA_API_KEY="your-ollama-cloud-api-key" --app zig-zag-backend
fly secrets set OLLAMA_TIMEOUT="240000" --app zig-zag-backend  # 4 minutes for large models

# Alternative: OpenAI (if you prefer to use OpenAI instead of Ollama)
# fly secrets set AI_PROVIDER="openai" --app zig-zag-backend
# fly secrets set OPENAI_API_KEY="your-api-key" --app zig-zag-backend
# fly secrets set OPENAI_DEFAULT_MODEL="gpt-3.5-turbo" --app zig-zag-backend
# fly secrets set OPENAI_TEMPERATURE="0.7" --app zig-zag-backend
# fly secrets set OPENAI_TIMEOUT="60000" --app zig-zag-backend
```

### Verify configured variables

To view all configured environment variables:

```bash
fly secrets list --app zig-zag-backend
```

## Database Migrations

Before the first deploy, you need to create the tables in the database. The project includes an automated setup script that detects if there are migrations and applies the correct strategy.

### Automatic Setup (Recommended)

The `be/scripts/setup-db.sh` script runs automatically when you use Docker Compose. You can also run it manually:

**With Docker Compose:**

The setup runs automatically when starting the container. Just make sure you have `DATABASE_URL` configured:

```bash
# If using Supabase, configure DATABASE_URL in your .env or docker-compose.yml
docker-compose up backend
```

**Manually (inside container or locally):**

```bash
cd be
# Configure DATABASE_URL according to your case
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
yarn prisma:setup
# Or directly:
sh scripts/setup-db.sh
```

The script:

- ✅ Generates Prisma Client
- ✅ If migrations exist in `prisma/migrations`, applies `prisma migrate deploy`
- ✅ If no migrations, uses `prisma db push` (useful for development)

### Manual Setup (If you prefer full control)

#### Option A: Use `prisma db push` (Fast to start)

This option creates tables directly from schema without creating migration files. Useful for development or when you don't have migrations yet.

**If using Supabase:**

```bash
cd be
# Get DATABASE_URL from Supabase Dashboard → Settings → Database
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres" npx prisma db push
```

**If using Fly.io Postgres:**

```bash
cd be
DATABASE_URL="$(fly secrets list --app zig-zag-backend | grep DATABASE_URL | awk '{print $2}')" npx prisma db push
```

#### Option B: Create migrations first (Recommended for production)

This option creates migration files that you can version and apply in different environments.

**Step 1: Create initial migrations (from local machine)**

```bash
cd be
# Get DATABASE_URL from Supabase Dashboard → Settings → Database
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres" yarn prisma:migrate --name init
```

This will create a `prisma/migrations` directory with migrations and apply changes to database.

**Step 2: Apply migrations in production (from Fly.io)**

```bash
fly ssh console --app zig-zag-backend
# Inside container:
cd be
yarn prisma:deploy
```

**Note:** If `prisma migrate deploy` does nothing, it means that:

- There are no migrations in `prisma/migrations` (use Option A or create migrations first)
- Or all migrations are already applied (verify with `npx prisma migrate status`)

## Deploy

1. Deploy the application:

```bash
fly deploy
```

2. Verify status:

```bash
fly status
```

3. View logs:

```bash
fly logs
```

## Useful commands

- View app info: `fly info`
- View environment variables: `fly secrets list`
- Open SSH console: `fly ssh console`
- View metrics: `fly metrics`
- Scale application: `fly scale count 2` (for 2 instances)

## Troubleshooting

### Application does not start

- Check logs: `fly logs`
- Verify environment variables: `fly secrets list`
- Make sure database is accessible

### Database connection error

- Verify database is connected: `fly postgres list`
- Check `DATABASE_URL` variable: `fly secrets list`

### Migration error

- Run migrations manually from SSH: `fly ssh console`
- Verify Prisma is installed: `npx prisma --version`

### Ollama Cloud connection error

- Verify API key is correct: `fly secrets list --app zig-zag-backend | grep OLLAMA_API_KEY`
- Verify `OLLAMA_BASE_URL` is configured as `https://api.ollama.com`
- Check logs for specific error: `fly logs --app zig-zag-backend`
- Make sure selected model is available in Ollama Cloud
- If timeout is too short, increase `OLLAMA_TIMEOUT` (default 240000ms = 4 minutes)

## Frontend Deployment

### Prerequisites

1. Create frontend application on Fly.io:

```bash
fly apps create zig-zag-frontend
```

### Configure Environment Variables

The frontend needs the Google Maps API key to work. **IMPORTANT**: Fly.io secrets are NOT available automatically during Docker build, only at runtime. Since Expo needs the variable during build, you must pass it explicitly.

#### Option 1: Use deploy script (Recommended)

The `deploy-fe.sh` script handles everything automatically:

```bash
# Pass API key as argument
./deploy-fe.sh "your-google-maps-api-key"

# Or export it first
export EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="your-google-maps-api-key"
./deploy-fe.sh
```

The script:

- ✅ Configures secret in Fly.io automatically
- ✅ Passes API key as build arg during build
- ✅ Verifies everything is configured correctly

#### Option 2: Manual deploy with build arg

```bash
# 1. Configure secret in Fly.io (for runtime)
fly secrets set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key" --app zig-zag-frontend

# 2. Export variable locally (for build)
export EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key"

# 3. Deploy with build arg
fly deploy --config fly-fe.toml --build-arg EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="$EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
```

#### Option 3: Use [env] in fly-fe.toml (Development only)

⚠️ **DO NOT version file with secret included**

Edit `fly-fe.toml` and add in `[env]` section:

```toml
[env]
  NODE_ENV = "production"
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = "your-api-key-here"
```

Then deploy normally:

```bash
fly deploy --config fly-fe.toml
```

**⚠️ IMPORTANT:**

- `EXPO_PUBLIC_*` variables are embedded at build-time, not runtime
- If you change the secret later, you need to do a new deploy
- Verify in build logs: you should see "Building with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY set: YES"

### Deploy

**Recommended method (using script):**

```bash
./deploy-fe.sh "your-api-key"
```

**Manual method:**

```bash
fly deploy --config fly-fe.toml --build-arg EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key"
```

2. Verify that frontend is running:

```bash
fly status --app zig-zag-frontend
```

3. View logs:

```bash
fly logs --app zig-zag-frontend
```

### Verify configured variables

To view all configured environment variables:

```bash
fly secrets list --app zig-zag-frontend
```

### Frontend Troubleshooting

#### Map does not load / useJsApiLoader Error

**Cause:** The `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` variable is not configured or not available.

**Solution:**

1. Verify that the secret is configured:

   ```bash
   fly secrets list --app zig-zag-frontend | grep GOOGLE_MAPS
   ```

2. If not configured, configure it:

   ```bash
   fly secrets set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key" --app zig-zag-frontend
   ```

3. Do a new deploy so the variable is embedded in the build:

   ```bash
   fly deploy --config fly-fe.toml
   ```

4. Verify in build logs that the variable is available:
   ```bash
   fly logs --app zig-zag-frontend
   ```
   You should see: "Building with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY set: YES"

## Notes

- The port is configured automatically via `PORT` variable (fly.io uses 3000)
- The application is built using the Dockerfile at `be/Dockerfile`
- The build context is the project root (monorepo)
- Environment variables are configured as secrets in Fly.io for greater security
- **Frontend:** `EXPO_PUBLIC_*` variables are embedded in the bundle during build, so they must be configured as secrets before deploy
