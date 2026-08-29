# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zig-Zag is a travel/exploration app that generates AI-powered activity and tour recommendations. It's a yarn workspaces monorepo with two packages:

- `be/` — NestJS backend (TypeScript, Prisma/PostgreSQL + pgvector, LangChain)
- `fe/` — React Native mobile app (Expo Router, Gluestack UI, NativeWind)

Detailed architecture docs already exist as README.md files inside most subdirectories (`be/src/modules/*/README.md`, `be/src/core/README.md`, `be/src/shared/ai/README.md`, `fe/app/README.md`, `fe/api/README.md`, `fe/features/README.md`, `fe/components/README.md`, `fe/context/README.md`, `be/prisma/README.md`, `be/src/commands/README.md`). Read the relevant one before working in that area — they cover architecture in more depth than is repeated here.

### Mandatory tour-engine architecture

Before changing tour/activity generation, destination resolution, candidate
retrieval or ranking, embeddings, transport-aware spatial feasibility, routing,
travel-time calculation, itinerary scheduling, Google Places/OSM integrations,
composite Activities, or the future Activity Discovery pipeline, read
`docs/architecture/activity-discovery-and-tour-generation.md` completely.

It documents the target flow and architectural invariants, including the
separation between Destination Resolution, catalog refill, Activity Discovery,
Entity Resolution, Validation, and Tour Generation. It does **not** mean every
component in the diagrams is already implemented: inspect the current code and
the linked implementation plan before acting.

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

Points at `E2E_WEB_URL` (default `http://localhost:19006`) and the backend's `API_URL`. Two ways to serve the frontend for this, matched to the two Makefile targets: `make fe-web` (`expo start --web --port 19006` — Expo SDK 54's web dev server defaults to `:8081`, so the port is pinned explicitly; `:19006` is also the origin registered for Google Sign-In in Google Cloud Console) for interactive use, or `make fe-web-e2e` (static `build:web` export served via `python3 -m http.server 19006`, matching what `ci.yml` actually runs) before `test-e2e*` targets — the two can't run at once, they'd fight over the port. Specs colocated in `fe/e2e/`, most tagged `@live` (they call real backend/AI endpoints — see `fe/e2e/auth-helper.ts` for the dev-mode email+code login flow used to authenticate, and `fe/e2e/composite-fixture-helper.ts` for seeding a composite-activity tour via the backend's `seed-e2e-composite` CLI command instead of a live generation).

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
- **Catalog admission** (`CatalogIdentityValidator`): a Text Search candidate is validated against the union of every acquisition category (`INTEREST_ACQUISITION_CATEGORIES`) covered by the request's interests, not just the single category of whichever operation happened to return it first — exact-`placeId` dedup upstream keeps only one operation's copy of a place returned by multiple seed queries, and a real place spanning multiple legitimate categories (the common case for genuinely iconic landmarks) must not be penalized for winning that arbitrary race. `PlacesCrawlProvenance.rejectedCandidates` (bounded, surfaced in the bitácora's `places_crawl` step) records which specific real place was rejected and why, not just an aggregate count per reason.
- **Tour generation** (`POST /tours/generate-tour` → `TourGenerationService.createTourFromWizard` → `TourActivityGenerationService.generateTourActivities`): creates a DB tour record immediately, then generates activities in the background from existing DB activities, optionally followed by a DALL-E cover image. As of PR 10 **no LLM participates in this path** — a deterministic solver both selects and schedules (see below). `tour.metadata.generationStatus`/`generationMessage` track live progress through a real sequence of stages (search → deterministic daily planning → save → cover image) — the frontend's loading screen reads these, not a fake/simulated progress state. Candidate selection in this live path is **not purely geographic**: the flow retrieves catalog candidates geographically, then combines semantic pgvector relevance, quality, and proximity before deciding which real Activity IDs reach the deterministic planner. PR 6 adds a deterministic coverage-quality gate so a thin or irrelevant pool no longer counts as sufficient just because nearby rows exist. PR 7 (corrected by PR 7.1) implements provider-neutral grounded Activity Discovery (`ActivityDiscoveryService`) as two separate provider interfaces: a `GroundedSearchProvider` gathers real search evidence first (default `SerpApiGroundedSearchService` — a plain Google-search API, decoupled from the extraction model's own token/rate quota; `GroqGroundedSearchService`, using Groq's `browser_search` tool, remains available behind the same interface — swap in `tours.module.ts`), then a `SearchGroundedDiscoveryProvider` (`GroqDiscoveryProvider`) extracts structured proposals that may only cite that supplied evidence, enforced at both the proposal and individual-entity-hint level. The live wizard flow only calls `discoverGaps()` today — `discoverBootstrap()` exists but nothing in the request path calls it, and `CoverageAnalyzer`'s specific acquisition decision (Text Search vs Nearby vs grounded bootstrap vs grounded gap vs explicit failure) isn't yet branched on individually; that finer routing is PR 9's job. PR 8 wires `ActivityProposalResolutionService` (geographic/entity disambiguation via Places + OSM, including a bounded exact `OsmMembershipService` containment adapter) into this same discovery branch: an accepted proposal is persisted as a real Activity (composites via `CompositeActivityService`, POIs direct), and PR 9 re-queries those same newly-persisted rows by ID (`ActivitiesService.findManyByIds`) so they compete in *this same request's* own ranked pool, not only a future generation's. PR 9's window-selection step (`selectBoundedWindow` in `candidate-window-selection.util.ts`) then reserves top slots for every requested experience format that has real matches in the ranked pool — a plain top-N score slice can otherwise starve a real `NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE` candidate out of the offered window even though the pool has it, since POIs usually outnumber composites — and caps repeated `ActivityFamily` variants (`MAX_VARIANTS_PER_FAMILY`) before filling the rest by rank; a new `candidate_pool` bitácora stage records per-candidate source (catalog/refill/discovery), score breakdown, and full-pool-vs-offered-window counts per requested format, and a dedicated pre-planning coverage gate fails generation explicitly (before any persistence) if the fully-merged pool is still genuinely unusable, layered alongside — not replacing — PR 7.2/7.4's post-planning quality gates. Required-hint roles in `resolveCompositeProposal` are kind-specific, matching what the discovery prompt actually promises: `NEIGHBORHOOD_WALK` requires an area hint, `ROUTE` requires a route hint, `EXPERIENCE` requires neither upfront (its sufficiency is judged structurally — ≥2 resolved entities, or one if venue-centric) — an area hint is optional for `ROUTE`/`EXPERIENCE` and, when absent, the request's destination boundary is used for scoping and persistence instead. PR 7.2 adds a deterministic `TourCompletenessValidator` (independent of PR 6's pool-level `CoverageAnalyzer`) that flags a day whose selected activities don't reasonably fill the requested time for its travel pace while viable candidates remain unused; since PR 10 it runs on the solver's planned days rather than an LLM's raw picks, and there is no corrective regeneration left to trigger (no itinerary LLM call remains on this path), so a shortfall simply stays visible in `generationTrace.tourCompleteness` — `generationStatus: 'completed'` means the generation process finished, not that every quality gate passed. PR 7.4 adds a second, independent post-generation gate, `TourFormatCoverageValidator`: themes ("what you're interested in") and experience formats ("how you want to experience it" — point visits/neighborhood walks/thematic routes/experiences) are validated separately, so a tour that fully satisfies every requested theme using only POIs can still be flagged if the offered pool had a viable `NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE` candidate for a format the user explicitly asked for and none of it was selected — never the reverse (a requested format with zero real candidates in the pool is CoverageAnalyzer/acquisition's concern, not a selection failure, and neither validator ever asks for a fabricated one). Since PR 10 it too evaluates the planned tour, and a candidate the solver hard-rejected as physically infeasible no longer counts as "available" for either gate; like completeness, it no longer triggers any retry. The format→kind mapping (`EXPERIENCE_FORMAT_ACTIVITY_KIND`) is centralized so `CoverageAnalyzer`'s pre-generation deficit and this post-generation validator never diverge. PR 10 replaces the itinerary LLM on this path with a deterministic `GreedyDailyPlanningSolver` (`DAILY_PLANNING_SOLVER` token, swappable): `PlanningCandidateNormalizerService` converts PR 9's ranked window into `PlanningActivityCandidate[]` (hours→minutes converted once, spatial footprints, Google `weekdayText` parsed into per-weekday `NormalizedOpeningHours`, a composite's internal walking computed from its own waypoints), then the solver greedily places candidates into exactly `requestedDays` buckets under **hard** constraints (allowed transportation modes, max walking per day, max continuous walking, daily time capacity including travel, opening hours, no duplicates) and a soft score (semantic/quality/requested-format/day-balance/family-variant), runs bounded local improvement (move/swap), and orders + time-schedules each day; travel comes from a provider-neutral `TravelEstimateProvider` (V1 `ApproximateTravelEstimateProvider` — Haversine + configurable detour factor and per-mode speeds, always `approximate: true`). Everything is deterministic: identical input always yields a deep-equal solution. An independent `TourPlanningFeasibilityValidatorService` re-derives feasibility from the solution alone (never trusting the solver's own metadata) and generation fails explicitly rather than persisting an infeasible plan. All weights/speeds/limits live in `daily-planning-policy.config.ts` (`registerAs('dailyPlanningPolicy')`); `route-optimizer.util.ts` is deleted and `travel-time-calculator.util.ts` survives only for the deprecated `/tours/nearby` chain, which PR 10 deliberately does **not** migrate (still LLM-planned — separate, un-scheduled debt). See `docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`. The LLM planning semantics behind the older flow (density guidance, meal handling, geographic/multi-day balance, requested-format coverage, anti-fabrication) still live in one shared `TOUR_PLANNING_POLICY_PROMPT` composed into the itinerary prompts that remain — now only the `/tours/nearby` chain's. A step-by-step trace of exactly what each generation stage found/decided (`tour.metadata.generationTrace`) is persisted on the tour row itself (not transient — readable for any past tour, not just a live generation) and readable in-app via a `__DEV__`-only inline accordion on the tour detail screen itself (`GenerationBitacora` component, `bitacora-toggle` in `fe/app/tours/[id].tsx` — not a separate route) — see `docs/superpowers/specs/2026-08-20-generation-bitacora-design.md`.
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
