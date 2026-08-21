# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zig-Zag is a travel/exploration app that generates AI-powered activity and tour recommendations. It's a yarn workspaces monorepo with two packages:

- `be/` — NestJS backend (TypeScript, Prisma/PostgreSQL + pgvector, LangChain)
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

There is no unit test runner in `fe/package.json`. E2E is Playwright, against an already-running instance of the app (it does not spawn its own server):

```bash
yarn test:e2e                # playwright test --config e2e/playwright.config.ts
```

Points at `E2E_WEB_URL` (default `http://localhost:19006`) and the backend's `API_URL`. Specs colocated in `fe/e2e/`, most tagged `@live` (they call real backend/AI endpoints — see `fe/e2e/auth-helper.ts` for the dev-mode email+code login flow used to authenticate, and `fe/e2e/composite-fixture-helper.ts` for seeding a composite-activity tour via the backend's `seed-e2e-composite` CLI command instead of a live generation).

### Backend CLI scripts (from `be/`, via nest-commander)

```bash
yarn script <command-name> [options]     # bootstraps a NestJS app context, no HTTP server
yarn match:init                          # rebuild pgvector embeddings for all activities (match-activities)
yarn crawl                               # run the Google Places location crawler CLI
yarn script generate-templates --lat=... --lng=... --name="..." [--themes=history,food] [--update-existing]
                                          # pre-generate curated composite-activity variants (walks/routes/experiences) for an area offline
```

See `be/src/commands/README.md` for the full command list (embedding rebuild, image audit, metadata regeneration).

## Architecture

### Backend layering (`be/src`)

NestJS modules are organized in three layers, imported into `AppModule` in this order (order matters — `ConfigModule` must precede `PrismaModule`):

1. **`core/`** — config (`@nestjs/config` via `registerAs`) and `PrismaService` (global). Foundational; everything else depends on it.
2. **`shared/ai/`** — `LangChainService` (LLM chat/completion, supports OpenAI or Ollama via `AI_PROVIDER`), `VectorStoreService` (pgvector similarity search), `AiEmbeddingService`, `AiCacheService` (file-based response caching in `be/storage/ai-cache/`), `ImageGenerationService` (DALL-E covers).
3. **`modules/`** — domain modules: `activities`, `tours`, `integrations` (`google-places`, `osm` — Overpass API for streets/boundaries, `wikidata` — narrative context). Each follows controller → service → dto/interfaces layout.

Key cross-cutting flows (see module READMEs for full detail):

- **Hybrid search** (`POST /activities/search-hybrid`): queries PostgreSQL by proximity (Haversine), then non-blockingly triggers a Google Places background crawl if the area hasn't been crawled in the last 24h (tracked via `CrawlerSearch`).
- **Tour generation** (`POST /tours/generate-tour` → `TourGenerationService.createTourFromWizard` → `TourActivityGenerationService.generateTourActivities`): creates a DB tour record immediately, then generates activities in the background using LangChain + existing DB activities, optionally followed by a DALL-E cover image. `tour.metadata.generationStatus`/`generationMessage` track live progress through a real sequence of stages (search → AI itinerary → save → cover image) — the frontend's loading screen reads these, not a fake/simulated progress state. Candidate selection in this live path is **purely geographic proximity (Haversine)** — despite `VectorStoreService` embeddings being indexed for every activity on write, nothing in this flow queries them; pgvector similarity search (`findSimilarActivities`) only runs inside `TourGenerationService.generateTour()`, a separate `@deprecated` method the wizard doesn't call (still used by `TourLocationService` as a fallback when there aren't enough nearby tours). A step-by-step trace of exactly what each generation stage found/decided (`tour.metadata.generationTrace`) is readable in-app via a `__DEV__`-only "bitácora" screen (`fe/app/tours/[id]/bitacora.tsx`, linked from tour detail) — see `docs/superpowers/specs/2026-08-20-generation-bitacora-design.md`.
- **Composite activities**: `Activity.kind` extends beyond a single POI point to `NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE` (multi-stop, backed by real OpenStreetMap streets/boundaries via the `osm` module) and `AREA` (a geographic container, e.g. a neighborhood). Same anti-hallucination guardrail as POI generation: the LLM only ever references real candidate IDs (existing `Activity`s or OSM features), verified server-side (`composite-activity-verification.util.ts`) before persisting. `CompositeActivityService` handles race-safe area/family/variant resolution; `ActivityFamily` groups variants of the same area+experience-type (e.g. "San Telmo Walk" containing a historic-themed and a food-themed variant); `ActivityWaypoint` is a variant's current ordered content, `TourActivityWaypoint` is a frozen per-tour snapshot of it (so a tour stays stable even if the shared variant's waypoints are edited later). Optional Wikidata narrative context enriches a variant's `description` when OSM provides a `wikidata` QID — best-effort, generation succeeds without it. `generate-templates` (CLI, above) pre-curates variants for an area offline instead of only generating them ad hoc during a live tour request.
- AI provider (OpenAI/Groq/Ollama) and behavior toggles (`ENABLE_AI`, `AI_CACHE_MODE`, `USE_MOCK_MAPS`, `MOCK_MAPS_MODE`, `ALLOW_API_FALLBACK`) are all env-driven — check `.env.example` and `be/src/shared/ai/ai.config.ts` before assuming a given provider/behavior is active. Composite-activity fetches add `OVERPASS_API_URL`/`OVERPASS_TIMEOUT_MS`/`OVERPASS_MAX_RADIUS_METERS`/`OVERPASS_MAX_CONCURRENCY` and `WIKIDATA_API_URL`, reusing `USE_MOCK_MAPS`/`MOCK_MAPS_MODE` so tests/CI never hit them unintentionally.

Database: PostgreSQL via Prisma. Core models are `Activity` (now with `kind: ActivityKind` and, for a variant, `variantTheme`/`familyId`/`boundary`), `ActivityFamily`, `ActivityWaypoint`, `Tour`, `TourActivity` (join table with ordering/travel-time), `TourActivityWaypoint`, `CrawlerSearch`, `Source`, `ActivityRelationship`, `KnownActivityType` — see `be/prisma/README.md` for field-level detail.

### Frontend (`fe/`)

Expo Router file-based routing under `fe/app/`: a `(tabs)` group (home/map/saved/profile) plus a `tours/` stack (list → wizard → `[id]` detail → `[id]/review`) pushed over the tabs. Provider nesting in `app/_layout.tsx` (outermost first): `GluestackUIProvider` → `SafeAreaProvider` → `ErrorBoundary` → `GestureHandlerRootView` → `AuthProvider` → `AppProvider` → `RootNavigator` → `AutocompleteDropdownContextProvider` (innermost, wraps the route `Stack` itself, inside `RootNavigator`'s post-auth-redirect logic — not a flat top-level wrapper).

**Theme/design system**: `fe/config.ts` — not `fe/components/ui/gluestack-ui-provider/config.ts`, which is unused CLI-scaffold leftover — is what `GluestackUIProvider` actually renders with (`createConfig({ ...defaultConfig, tokens: { colors: {...} } })`). All `$primary*`/`$textLight*`/`$backgroundLight*`/etc. style-prop tokens resolve against this file. Current palette: ink (`#16232a`) / paper (`#f6f3ea`/`#fbf9f3`) / brass (`#c89b3c`, `primary` — commit-action buttons, POI accents) / rose (`#b85c6b`, `tertiary` — composite/experience accents). Headings use a serif display face via `fe/constants/typography.ts`'s `FONT_DISPLAY` (system serif — `Georgia`/`serif`, no bundled font asset), applied per-component with `style={{ fontFamily: FONT_DISPLAY }}` since Gluestack has no theme-level font-family override hook for this. Button color convention: ink background for navigation actions, brass (with dark ink text/icon for contrast) for commit actions.

- **`context/app.tsx`** — single global `AppContext`/`AppProvider` holding map center, selected address, cached activities, and search radius. `getActivities()` is the main data-fetch entry point, calling `POST /activities/search-hybrid`.
- **`api/`** — all backend HTTP calls go through here (axios instance in `api/config/axios.ts`, base URL from `EXPO_PUBLIC_API_URL`). `tours.ts` and `activities.ts` hold typed API functions; `hooks/useApi.ts` is a generic fetch hook.
- **`features/`** — business-logic modules pairing a hook with UI (`activities/`, `map/` — has a `.web.tsx` platform fallback for web maps, including polygon/polyline rendering for composite-activity boundaries and routes, `tours/` including the wizard flow in `use-create-tour.ts`).
- **`components/`** — presentational components grouped by screen area (`home/`, `tour-details/` — `TourStopCard` for a plain POI stop vs `CompositeStopCard` for a multi-waypoint walk/route/experience (rose accent, mini-map, editable checklist mode used by the review screen), `CompositeActivityDetail` for a composite variant's own full-detail screen, `GenerationPipeline` for the tour-generation loading screen's real stage checklist — `tours/` for the wizard form, `ui/` for primitives like the bottom sheet).
- **Composite activities on the frontend**: `app/tours/[id].tsx` redirects to `app/tours/[id]/review.tsx` right after generation completes if the tour has a reviewable composite stop, letting the user exclude waypoints (min 2, else the full snapshot is kept) before landing on the final detail view; `app/activities/[id].tsx` branches to `CompositeActivityDetail` when `activity.kind !== 'POI'` instead of the flat single-POI layout.

### Docker Compose services

`docker-compose.yml` defines `postgres` (profile `dev`, local-only, image `pgvector/pgvector:pg15` — production uses AWS RDS via `DATABASE_URL`), `backend`, `frontend` (build target controlled by `BUILD_TARGET`: `ios` default, `dev`, `web`, `lan`), `cors-proxy`, and `ollama` (profile `local-ai`, for local LLM inference as an alternative to OpenAI/Groq). The `backend` service builds `be/Dockerfile`'s `builder` stage explicitly (`target: builder`) — the Dockerfile's final `runner` stage is production-only (installed with `--production`, no devDependencies), which can't run `nest start --watch`.

## Deployment

Production deploys target AWS — see `AWS_DEPLOYMENT.md` for details. Frontend: S3 + CloudFront. API: CloudFront + ALB in front of an EC2 instance. PostgreSQL (with `pgvector`) on RDS. Deploys run through GitHub Actions (`.github/workflows/cd.yml`) after CI passes on `main`; there is no manual `yarn deploy` script. The environment is stopped by default to save cost — `make aws-start` / `make aws-status` / `make aws-stop`.
