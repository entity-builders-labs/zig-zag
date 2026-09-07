# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zig-Zag is a travel/exploration app that generates AI-powered activity and tour recommendations. It's a yarn workspaces monorepo with two packages:

- `be/` — NestJS backend (TypeScript, Prisma/PostgreSQL + pgvector, LangChain)
- `fe/` — React Native mobile app (Expo Router, Gluestack UI, NativeWind)

Detailed architecture docs already exist as README.md files inside most subdirectories (`be/src/modules/*/README.md`, `be/src/core/README.md`, `be/src/shared/ai/README.md`, `fe/app/README.md`, `fe/api/README.md`, `fe/features/README.md`, `fe/components/README.md`, `fe/context/README.md`, `be/prisma/README.md`, `be/src/commands/README.md`). Read the relevant one before working in that area — they cover architecture in more depth than is repeated here.

### Mandatory tour-engine architecture

Before changing Experience/tour generation, destination resolution, candidate
retrieval or ranking, embeddings, transport-aware spatial feasibility, routing,
travel-time calculation, itinerary scheduling, Google Places/OSM integrations,
multi-component Experiences, or grounded Experience Discovery, read
`docs/architecture/activity-discovery-and-tour-generation.md` completely (the
filename predates the Experience Domain V2 rearchitecture; the content is
kept current for the V2 model).

It documents the target flow and architectural invariants, including the
separation between Destination Resolution, catalog refill, Experience
Discovery, Entity Resolution, Validation, and Tour Generation. It does **not**
mean every component in the diagrams is already implemented: inspect the
current code and the linked implementation plan before acting — see also
`docs/superpowers/plans/2026-09-02-experience-domain-v2-recovery-completion-plan.md`
for the checkpoint-by-checkpoint recovery status.

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

Points at `E2E_WEB_URL` (default `http://localhost:19006`) and the backend's `API_URL`. Two ways to serve the frontend for this, matched to the two Makefile targets: `make fe-web` (`expo start --web --port 19006` — Expo SDK 54's web dev server defaults to `:8081`, so the port is pinned explicitly; `:19006` is also the origin registered for Google Sign-In in Google Cloud Console) for interactive use, or `make fe-web-e2e` (static `build:web` export served via `python3 -m http.server 19006`, matching what `ci.yml` actually runs) before `test-e2e*` targets — the two can't run at once, they'd fight over the port. Specs colocated in `fe/e2e/`, most tagged `@live` (they call real backend/AI endpoints — see `fe/e2e/auth-helper.ts` for the dev-mode email+code login flow used to authenticate). **`fe/e2e/tour-review-edit-waypoints.spec.ts`, `composite-stop-rendering.spec.ts`, and `composite-area-polygon.spec.ts` are currently broken/orphaned** — they depend on `fe/e2e/composite-fixture-helper.ts`'s `seed-e2e-composite` CLI command, which was removed with the Activity domain (no replacement fixture-seeding command exists yet for Experience/GeoEntity), and hardcode pre-migration field names (`tourActivityId`/`variantId`/`familyId`/`areaId`).

### Backend CLI scripts (from `be/`, via nest-commander)

There are currently **no registered commands** — every Activity-era command (embedding rebuild, image audit, metadata regeneration, `generate-templates`, the Google Places crawler, `seed-e2e-composite`) was removed with the domain cutover and must not be reintroduced; `be/package.json`'s `crawl`/`script` scripts and the `ScriptsModule` bootstrap (`src/commands/scripts/cli.ts`) still exist but currently have nothing to invoke. Tour generation only runs through the async HTTP API (`POST /tours/generate-tour`) now. See `be/src/commands/README.md` before adding a new command.

## Architecture

### Backend layering (`be/src`)

NestJS modules are organized in three layers, imported into `AppModule` in this order (order matters — `ConfigModule` must precede `PrismaModule`):

1. **`core/`** — config (`@nestjs/config` via `registerAs`) and `PrismaService` (global). Foundational; everything else depends on it.
2. **`shared/ai/`** — `LangChainService` (LLM chat/completion, supports OpenAI or Ollama via `AI_PROVIDER`), `VectorStoreService` (pgvector similarity search), `AiEmbeddingService`, `AiCacheService` (file-based response caching in `be/storage/ai-cache/`), `ImageGenerationService` (DALL-E covers).
3. **`modules/`** — domain modules: `tours` (also owns the deterministic planner/engine — see below), `media` (`@Global()`; image/photo enrichment), `integrations` (`google-places`, `osm` — Overpass API for streets/boundaries, `wikidata` — content-safety only, see below), `outbox`, `notifications` (SSE), `auth`. There is no `activities` module anymore — the legacy `Activity`/`ActivityKind` domain was fully removed (Prisma migration `20260902120000_remove_activity_domain_v2`); every schedulable tourism unit is now an `Experience`, see below.

Key cross-cutting flows (see module READMEs for full detail — several are being resynced post-migration, so cross-check against real code, not just the README, when in doubt):

- **Experience domain model**: `GeoEntity` (`PLACE`/`AREA`/`ROUTE`) represents physical reality only and is never itself schedulable. `Experience` is the only schedulable tourism unit — made of one or more ordered `ExperienceComponent`s (`order` nullable, meaning "no intrinsic sequence"), each pointing at a `GeoEntity`. A single-`PLACE` visit is still an Experience with one component; a neighborhood walk or thematic route is a multi-component Experience — there is no separate structural "composite" kind anymore. `Trait`s (backed by dynamic `TraitDefinition` lookup data, not a closed enum) are soft descriptors (theme/mobility/activity-style/environment/spatial-pattern/discovery-style). `TourExperience` + `TourExperienceComponent` freeze a per-Tour snapshot of a selected Experience so a Tour stays stable even if the shared Experience is later edited/re-enriched.
- **Tour generation** (`POST /tours/generate-tour` → `TourGenerationService.createTourFromWizard` → atomic `Tour` + `TourGenerationRequested` outbox event → `TourGenerationProcessorService` consumer → `ExperienceGenerationService.generateTourExperiences`): creates the DB tour record immediately, then generates Experiences in the background, optionally followed by media enrichment. **No LLM participates in ranking/planning/scheduling** — a deterministic solver selects and schedules; the LLM only interprets free-text preferences (see below) and extracts grounded discovery candidates, never itinerary structure. `tour.metadata.generationStatus`/`generationMessage` track live progress — the frontend's loading screen and `fe/api/hooks/useSSE.ts` (real SSE, `GET /notifications/tours/:id/stream`, not polling) read these. Candidate selection combines catalog proximity with semantic pgvector relevance, quality, and requested-preference scoring (`experience-preference-evaluator.util.ts` — a real structured evaluator over name/description/themes/traits/required components, distinct from the looser `theme-matching.util.ts` keyword heuristic used only for coverage's theme-summary signal) before the ranked window reaches the deterministic planner.
- **Coverage and discovery**: `CoverageAnalyzer` measures relevance (not just count) against requested themes/traits/intents and a required-candidate-count derived from days/pace. **Governing invariant**: a missing *positive* preference (theme/trait/intent) may lower satisfaction or trigger discovery, but must never by itself fail a Tour — only a genuinely infeasible pool (`eligibleCandidateCount === 0`, or the analyzer's own explicit `action: 'fail'`) may abort generation; this is enforced by `isCoverageFatal()` (`coverage-decision.util.ts`) at the one call site that can throw, deliberately excluding `decision.requiresAdditionalDiscovery` from that check. When coverage is insufficient, `ExperienceDiscoveryPlannerService` builds a provider-neutral, kind-agnostic query (no `ActivityKind`/`ProposalKind`/`targetKind` — `ExperienceCandidate` has no structural `kind` field, only `themes[]`/`traits[]`/`componentHints[]`); `day_trip` is one soft intent/facet among others (`visit`/`walk`/`food`/`nightlife`/`route_like`), not a separate domain/planner/model. Extraction (`GroqDiscoveryProvider`/`GeminiDiscoveryProvider`) may only cite supplied grounded evidence. `ExperienceProposalResolverService` resolves each candidate's components against trusted geo providers only (Places/OSM — never LLM-claimed coordinates/IDs) and runs geographic validation (`CompositeGeographicValidationService`) before persistence via `ExperienceCatalogService`. Dedupe (`experience-dedupe.util.ts`) is a real `SAME`/`NEW`/`AMBIGUOUS` classifier (name similarity + semantic similarity + role-aware component overlap + distance) — `AMBIGUOUS` is excluded from the offered pool rather than force-merged.
- **Deterministic planning**: `PlanningCandidateNormalizerService` converts the ranked window into `PlanningExperienceCandidate[]` (spatial footprints, `componentFootprints[]` for internal routing, opening hours). `GreedyDailyPlanningSolver` (`DAILY_PLANNING_SOLVER` token) greedily places candidates into exactly `requestedDays` buckets under **hard** constraints (transport modes, max walking per day, max continuous walking — including a candidate's own *internal* continuous walking across its components, daily time capacity including travel, opening hours, no duplicates) and a soft score, then runs bounded local improvement and time-schedules each day; travel comes from a provider-neutral `TravelEstimateProvider` (Geoapify-backed with an approximate Haversine fallback, wrapped by `ResilientTravelEstimateProvider`). Everything is deterministic: identical input yields a deep-equal solution. `TourPlanningFeasibilityValidatorService` independently re-derives feasibility from the solution alone. Inter-candidate travel/ordering routes by per-component `startFootprint`/`endFootprint` (derived in `PlanningCandidateNormalizerService`, falling back to `spatialFootprint` only when a candidate has fewer than 2 component footprints), not one generic footprint per Experience, so a multi-stop walk/route is no longer scheduled as if it were a single point. A step-by-step Bitácora V3 trace (`tour.metadata.generationTrace`, `version: 3`) is persisted on the tour row (readable for any past tour) and shown in-app via a `__DEV__`-only accordion (`GenerationBitacora`, `fe/app/tours/[id].tsx`).
- **Media enrichment**: async, non-fatal, eventual — `MediaEnrichmentProcessorService` fetches photos from Wikimedia Commons (no Google Places photo provider is wired despite a `'google_places'` type slot) and persists `ExperienceMedia` rows (URLs/provenance only, never binaries) plus `Experience.mediaStatus`. `RETRYABLE_FAILURE` (429/5xx/network) is never negative-cached; only an authoritative empty result is. On completion, `NotificationDeliveryService` pushes a real `experience.media.updated` SSE event (photos included) to both the experience and tour channels; the frontend also gets `mediaPresentation` (primary photo + fallback) resolved server-side on every full tour fetch (`ToursService.withMediaPresentation`), which also decorates the response with `dayTotals` (per-day aggregated experience/travel minutes, computed on every read from the persisted `TourExperience` rows — see `day-totals.util.ts`) and each experience's `experiencePresentation` (its derived geometry-display mode).
- **Preferences**: `PreferenceInterpreterService` interprets a user's free-text `additionalPreferences` with an LLM (deterministic regex fallback if it fails) into `NormalizedPreferenceIntent` — `preferredThemes`/`preferredTraits`/`preferredIntents` (positive, always soft) vs. `excludedThemes`/`excludedTraits`/`softConstraints` (negative, soft — score penalty) vs. `hardExclusions` (negative, hard — filters candidates, with an explicit `hardExclusionRelaxed` fallback if it would otherwise empty the pool). There is currently no way to mark a *positive* preference as required/mandatory, by design (matches invariant above and how comparable AI itinerary tools — e.g. TripAdvisor's — treat interest chips as pure-soft, recovering via post-generation editing instead).
- **Post-generation editing**: `app/tours/[id]/review.tsx` lets a user *see* a checklist for excluding waypoints from a multi-component Experience before landing on the tour detail view — **today this is display-only; `handleConfirm` does not persist the exclusion** (no backend endpoint/schema field exists yet). Do not assume unchecking a waypoint here has any effect until that ships.

AI provider (OpenAI/Groq/Ollama) and behavior toggles (`ENABLE_AI`, `AI_CACHE_MODE`, `USE_MOCK_MAPS`, `MOCK_MAPS_MODE`, `ALLOW_API_FALLBACK`) are all env-driven — check `.env.example` and `be/src/shared/ai/ai.config.ts` before assuming a given provider/behavior is active. `OVERPASS_API_URL`/`OVERPASS_TIMEOUT_MS`/`OVERPASS_MAX_RADIUS_METERS`/`OVERPASS_MAX_CONCURRENCY` and `WIKIDATA_API_URL` reuse `USE_MOCK_MAPS`/`MOCK_MAPS_MODE` so tests/CI never hit them unintentionally.

Database: PostgreSQL via Prisma. Core models are `GeoEntity` (+ `GeoEntityIdentity` for provider identity), `Experience` (+ `ExperienceComponent`, `ExperienceEvidence`, `ExperienceMedia`, `TraitDefinition`/`ExperienceTrait`), `Tour`, `TourExperience` (+ `TourExperienceComponent` snapshot), `CrawlerSearch`, `Source` — see `be/prisma/README.md` for field-level detail. There is no `Activity`/`ActivityFamily`/`ActivityWaypoint`/`TourActivity`/`TourActivityWaypoint`/`ActivityRelationship`/`KnownActivityType` anymore.

### Frontend (`fe/`)

Expo Router file-based routing under `fe/app/`: a `(tabs)` group (home/map/saved/profile) plus a `tours/` stack (list → wizard → `[id]` detail → `[id]/review`) pushed over the tabs. Provider nesting in `app/_layout.tsx` (outermost first): `GluestackUIProvider` → `SafeAreaProvider` → `ErrorBoundary` → `GestureHandlerRootView` → `AuthProvider` → `AppProvider` → `RootNavigator` → `AutocompleteDropdownContextProvider` (innermost, wraps the route `Stack` itself, inside `RootNavigator`'s post-auth-redirect logic — not a flat top-level wrapper).

**Theme/design system**: `fe/config.ts` — not `fe/components/ui/gluestack-ui-provider/config.ts`, which is unused CLI-scaffold leftover — is what `GluestackUIProvider` actually renders with (`createConfig({ ...defaultConfig, tokens: { colors: {...} } })`). All `$primary*`/`$textLight*`/`$backgroundLight*`/etc. style-prop tokens resolve against this file. Current palette: ink (`#16232a`) / paper (`#f6f3ea`/`#fbf9f3`) / brass (`#c89b3c`, `primary` — commit-action buttons, POI accents) / rose (`#b85c6b`, `tertiary` — composite/experience accents). Headings use a serif display face via `fe/constants/typography.ts`'s `FONT_DISPLAY` (system serif — `Georgia`/`serif`, no bundled font asset), applied per-component with `style={{ fontFamily: FONT_DISPLAY }}` since Gluestack has no theme-level font-family override hook for this. Button color convention: ink background for navigation actions, brass (with dark ink text/icon for contrast) for commit actions.

- **`context/app.tsx`** — single global `AppContext`/`AppProvider` holding only map center, selected address, and search radius (no cached-activities data-fetch anymore — there is no standalone activity/experience search screen; Experiences are only ever browsed inside a generated Tour).
- **`api/`** — all backend HTTP calls go through here (axios instance in `api/config/axios.ts`, base URL from `EXPO_PUBLIC_API_URL`). `tours.ts` (Experience/Tour-shaped types) and `experiences.ts` hold typed API functions; `hooks/useApi.ts` is a generic fetch hook, `hooks/useSSE.ts` is the real SSE client (`XMLHttpRequest`-based `EventSource` polyfill, needed for RN + a custom `Authorization` header) used by the tour detail screen for live generation/media-enrichment push.
- **`features/`** — business-logic modules pairing a hook with UI (`map/` — has a `.web.tsx` platform fallback for web maps, including polygon/polyline rendering for multi-component Experience boundaries and routes, `tours/` including the wizard flow in `use-create-tour.ts`, `notifications/`). `features/activities/` is an empty, untracked leftover directory.
- **`components/`** — presentational components grouped by screen area (`home/`, `tour-details/` — `TourStopCard` for a single-component Experience stop vs `CompositeStopCard` for a multi-component walk/route/experience (rose accent, mini-map, `editable`/`onToggleComponent` props currently only wired from the review screen), `GenerationPipeline` for the tour-generation loading screen's real stage checklist — `tours/` for the wizard form, `ui/` for primitives like the bottom sheet). There is no standalone Experience detail screen/route (no `CompositeActivityDetail` or `app/activities/[id].tsx` equivalent) — a component is only ever shown inline within a Tour.
- **Post-generation waypoint review**: `app/tours/[id].tsx` redirects to `app/tours/[id]/review.tsx` right after generation completes if the tour has a reviewable multi-component stop, letting the user *see* a checklist for excluding waypoints (min 2, else the full snapshot is kept) — **this is currently display-only; nothing is persisted** (`handleConfirm` calls no API; no backend endpoint/schema field exists yet for it).

### Docker Compose services

`docker-compose.yml` defines `postgres` (profile `dev`, local-only, image `pgvector/pgvector:pg15` — production uses AWS RDS via `DATABASE_URL`), `backend`, `frontend` (build target controlled by `BUILD_TARGET`: `ios` default, `dev`, `web`, `lan`), `cors-proxy`, and `ollama` (profile `local-ai`, for local LLM inference as an alternative to OpenAI/Groq). The `backend` service builds `be/Dockerfile`'s `builder` stage explicitly (`target: builder`) — the Dockerfile's final `runner` stage is production-only (installed with `--production`, no devDependencies), which can't run `nest start --watch`.

## Deployment

Production deploys target AWS — see `AWS_DEPLOYMENT.md` for details. Frontend: S3 + CloudFront. API: CloudFront + ALB in front of an EC2 instance. PostgreSQL (with `pgvector`) on RDS. Deploys run through GitHub Actions (`.github/workflows/cd.yml`) after CI passes on `main`; there is no manual `yarn deploy` script. The environment is stopped by default to save cost — `make aws-start` / `make aws-status` / `make aws-stop`.
