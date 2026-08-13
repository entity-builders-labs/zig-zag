# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zig-Zag is a travel/exploration app that generates AI-powered activity and tour recommendations. It's a yarn workspaces monorepo with two packages:

- `be/` — NestJS backend (TypeScript, Prisma/PostgreSQL, LangChain, ChromaDB)
- `fe/` — React Native mobile app (Expo Router, Gluestack UI, NativeWind)

Detailed architecture docs already exist as README.md files inside most subdirectories (`be/src/modules/*/README.md`, `be/src/core/README.md`, `be/src/shared/ai/README.md`, `fe/app/README.md`, `fe/api/README.md`, `fe/features/README.md`, `fe/components/README.md`, `fe/context/README.md`, `be/prisma/README.md`, `be/src/commands/README.md`). Read the relevant one before working in that area — they cover architecture in more depth than is repeated here.

## Commands

### Setup

```bash
yarn install                # installs root + workspaces (be, fe)
cp .env.example .env         # single .env at repo root feeds docker-compose, be, and fe
```

### Running the stack

```bash
yarn simulator               # (recommended) build native iOS app + start full docker stack
yarn simulator:android       # same, for Android emulator
docker-compose up -d         # start full stack (requires .env; COMPOSE_PROFILES=dev enables local postgres)
docker-compose --profile dev up -d   # explicit form if COMPOSE_PROFILES isn't set

yarn start                   # frontend only (expo dev client), from root
yarn start:be                # backend only (nest start --watch), from root
yarn start:fe                # frontend only, alias of `yarn start`
```

Backend runs on port 4000 (mapped from container port 3000) when using docker-compose; Swagger UI is at `/api/docs` when `SWAGGER_ENABLED=true`.

### Backend (`cd be`)

```bash
yarn start:dev               # nest start --watch
yarn build                   # nest build
yarn typecheck               # tsc --noEmit
yarn lint:check              # eslint, no fix
yarn lint                    # eslint --fix
yarn check                   # typecheck + lint:check (run before considering backend work done)

yarn test                    # jest, all specs
yarn test path/to/x.spec.ts  # single test file
yarn test:watch
yarn test:cov
yarn test:e2e                # jest --config ./test/jest-e2e.json

yarn prisma:generate         # regenerate Prisma client after schema changes
yarn prisma:migrate          # create + apply a dev migration
yarn prisma:studio           # DB GUI at localhost:5555
yarn seed                    # run prisma/seed.ts
```

Jest root is `be/src`; spec files use `*.spec.ts` colocated next to the code under test.

### Frontend (`cd fe`)

```bash
yarn start                   # expo start --dev-client
yarn ios / yarn android       # native run
yarn build:web               # expo export --platform web
```

There is no configured test runner in `fe/package.json`.

### Backend CLI scripts (from `be/`, via nest-commander)

```bash
yarn script <command-name> [options]     # bootstraps a NestJS app context, no HTTP server
yarn match:init                          # rebuild ChromaDB embeddings (check-embeddings --initialize-store)
yarn crawl                               # run the Google Places location crawler CLI
```

See `be/src/commands/README.md` for the full command list (embedding rebuild, image audit, metadata regeneration).

## Architecture

### Backend layering (`be/src`)

NestJS modules are organized in three layers, imported into `AppModule` in this order (order matters — `ConfigModule` must precede `PrismaModule`):

1. **`core/`** — config (`@nestjs/config` via `registerAs`) and `PrismaService` (global). Foundational; everything else depends on it.
2. **`shared/ai/`** — `LangChainService` (LLM chat/completion, supports OpenAI or Ollama via `AI_PROVIDER`), `VectorStoreService` (ChromaDB similarity search), `AiEmbeddingService`, `AiCacheService` (file-based response caching in `be/storage/ai-cache/`), `ImageGenerationService` (DALL-E covers).
3. **`modules/`** — domain modules: `activities`, `tours`, `integrations` (Google Places). Each follows controller → service → dto/interfaces layout.

Key cross-cutting flows (see module READMEs for full detail):

- **Hybrid search** (`POST /activities/search-hybrid`): queries PostgreSQL by proximity (Haversine), then non-blockingly triggers a Google Places background crawl if the area hasn't been crawled in the last 24h (tracked via `CrawlerSearch`).
- **Tour generation** (`POST /tours/generate-tour`): creates a DB tour record immediately, then generates activities in the background using LangChain + existing DB activities + ChromaDB similarity search, optionally followed by a DALL-E cover image.
- AI provider (OpenAI/Groq/Ollama) and behavior toggles (`ENABLE_AI`, `AI_CACHE_MODE`, `USE_MOCK_MAPS`, `MOCK_MAPS_MODE`, `ALLOW_API_FALLBACK`) are all env-driven — check `.env.example` and `be/src/shared/ai/ai.config.ts` before assuming a given provider/behavior is active.

Database: PostgreSQL via Prisma. Core models are `Activity`, `Tour`, `TourActivity` (join table with ordering/travel-time), `CrawlerSearch`, `Source`, `ActivityRelationship`, `KnownActivityType` — see `be/prisma/README.md` for field-level detail.

### Frontend (`fe/`)

Expo Router file-based routing under `fe/app/`: a `(tabs)` group (home/map/saved/profile) plus a `tours/` stack (list → wizard → `[id]` detail) pushed over the tabs. Provider nesting in `app/_layout.tsx` (outermost first): `GluestackUIProvider` → `SafeAreaProvider` → `ErrorBoundary` → `GestureHandlerRootView` → `AppProvider` → `AutocompleteDropdownContextProvider`.

- **`context/app.tsx`** — single global `AppContext`/`AppProvider` holding map center, selected address, cached activities, and search radius. `getActivities()` is the main data-fetch entry point, calling `POST /activities/search-hybrid`.
- **`api/`** — all backend HTTP calls go through here (axios instance in `api/config/axios.ts`, base URL from `EXPO_PUBLIC_API_URL`). `tours.ts` and `activities.ts` hold typed API functions; `hooks/useApi.ts` is a generic fetch hook.
- **`features/`** — business-logic modules pairing a hook with UI (`activities/`, `map/` — has a `.web.tsx` platform fallback for web maps, `tours/` including the wizard flow in `use-create-tour.ts`).
- **`components/`** — presentational components grouped by screen area (`home/`, `tour-details/`, `tours/` for the wizard form, `ui/` for primitives like the Gluestack provider and bottom sheet).

### Docker Compose services

`docker-compose.yml` defines `postgres` (profile `dev`, local-only — production uses Supabase via `DATABASE_URL`), `backend`, `frontend` (build target controlled by `BUILD_TARGET`: `ios` default, `dev`, `web`, `lan`), `cors-proxy`, `chroma` (ChromaDB), and `ollama` (profile `local-ai`, for local LLM inference as an alternative to OpenAI/Groq).

## Deployment

Production deploys target AWS — see `AWS_DEPLOYMENT.md` for details. Frontend: S3 + CloudFront. API: CloudFront + ALB in front of an EC2 instance. Chroma on its own EC2 instance. PostgreSQL on RDS. Deploys run through GitHub Actions (`.github/workflows/cd.yml`) after CI passes on `main-mvp`; there is no manual `yarn deploy` script. The environment is stopped by default to save cost — `make aws-start` / `make aws-status` / `make aws-stop`.
