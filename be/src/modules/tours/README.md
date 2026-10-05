# Tours Module

The most complex module in the backend — handles AI-powered tour generation, CRUD operations, and location-based tour discovery.

## Architecture

By far the largest module (53 services, 44 utils as of this writing) — it owns the whole Experience Domain V2 engine, not just tour CRUD. Representative layout (not exhaustive):

```
tours/
├── controllers/
│   └── tours.controller.ts              # REST API endpoints
├── dto/
│   ├── create-tour.dto.ts               # Manual tour creation
│   ├── create-tour-from-wizard.dto.ts   # Canonical wizard intent + mobility
│   └── update-tour.dto.ts
├── interfaces/                          # Experience/GeoEntity/coverage/discovery/daily-planning contracts
├── prompts/
│   └── media-generation.prompt.ts       # Only LLM prompt still owned directly by this module
├── services/
│   ├── tours.service.ts                 # CRUD operations
│   ├── tour-generation.service.ts       # Wizard entry point → atomic Tour + outbox event
│   ├── tour-generation-processor.service.ts # Outbox consumer — actually runs generation
│   ├── experience-generation.service.ts # The orchestrator: preferences → coverage → discovery →
│   │                                     # resolution → ranking → deterministic planning → snapshots
│   ├── experience-catalog.service.ts    # Verified Experience/GeoEntity persistence + trait/dedupe wiring
│   ├── experience-discovery-planner.service.ts, {gemini,groq,ollama,cloudflare}-discovery.provider.ts
│   │                                     # Grounded discovery query planning + extraction (transport only)
│   ├── locality-recovering-discovery-extractor.ts # The extractor the app uses: provider extraction,
│   │                                     # then source locality recovery (amendment §19.1)
│   ├── experience-proposal-resolver.service.ts # Component resolution + geographic validation
│   ├── coverage-analyzer.service.ts     # Relevance-based coverage gate (see CLAUDE.md invariant)
│   ├── greedy-daily-planning.solver.ts, planning-candidate-normalizer.service.ts,
│   │   tour-planning-feasibility-validator.service.ts # Deterministic scheduling
│   ├── preference-interpreter.service.ts # Free-text → typed NormalizedPreferenceIntent
│   ├── tour-image.service.ts            # Cover image generation (DALL-E)
│   └── tour-location.service.ts         # Read-only nearby-tour lookup over persisted TourExperience
├── utils/                               # daily-planning-*, experience-dedupe, theme-matching,
│                                         # experience-preference-evaluator, coverage-decision, trace builders, etc.
└── tours.module.ts
```

## Key Flows

### Tour Generation (Wizard → AI)

The primary flow when a user creates a tour from the mobile app wizard:

1. **`POST /tours/generate-tour`** → `ToursController.generateTour()`
2. **`TourGenerationService.createTourFromWizard()`**:
   - Validates and normalizes one canonical `TourGenerationRequest`
   - Creates a basic tour record and persists that request in PostgreSQL
   - Builds selector input from typed intent and mobility preferences
   - Kicks off **background** activity generation (non-blocking)
3. **The async tour-generation processor** (background):
   - Reads only the persisted canonical generation request
   - Interprets free-text preferences through the configured LLM
   - Discovers candidate Experiences with grounded search, through acquisition
     work units (`utils/acquisition-strategy-selector.util.ts`): each open
     `intent:walk` / `intent:route_like` deficit has its own unit
     (`AREA_ROUTE_WALK` or `DEDICATED_INTENT`); everything else is one
     `GENERIC` unit; planner backfill is `PLANNER_CAPACITY`
   - When a multi-component gap remains, re-extracts from the full text of
     selected sources (`utils/source-content-windowing.util.ts`). A heading
     section up to `DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS` is an editorial unit
     that always reaches one extraction whole. A window that cuts a unit
     (`sectionComplete: false`) can never close the gap, so a prefix of a
     source-defined itinerary is never persisted as the whole of it. An
     extracted itinerary is enumerated exhaustively and in order. It is split
     only where the source states a motorized transfer, and it is never
     truncated: `MAX_COMPONENT_HINTS` rejects an oversized candidate instead
     (RW4-EXTRACT-COMPLETENESS-1).
   - Resolves component hints against Places/OSM and validates geographic coherence.
     A policy class (`DEFAULT` / `WALK` / `ROUTE_LIKE`) is granted per candidate,
     only by the unit that owns that walk/route_like deficit and only to its
     multi-component candidates (`utils/geographic-validation-authorization.util.ts`).
     Authorization never supplies geometry: the Experience's geographic scope
     is derived by one owner (`utils/experience-geographic-scope.policy.ts`) from
     a verified source-backed AREA/ROUTE component, a user-named anchor, or the
     destination; resolution is two-phase (scope hints first, then components
     searched in the scope-derived window). A user-named anchor (and, for a
     DEFAULT/WALK candidate, the destination) is a STRICT constraint; a
     source-named AREA/ROUTE is DESCRIPTIVE context whose mismatches are
     recorded facts. A `ROUTE_LIKE` composition with no enclosing canonical
     geometry is judged on its verified components plus ONE supporting source
     record (`SOURCE_DEFINED_COMPONENTS`, `utils/source-composition-support.policy.ts`),
     with members acquired by a country-bounded provider query — a missing
     AREA is never `GEOGRAPHIC_SCOPE_UNKNOWN`; identity stays fail-closed.
     Beyond the destination, a unique name is identity only inside a
     geography the source states (the component's grounded locality or a
     verified source-named AREA); country-wide uniqueness alone is not
     (`GEOGRAPHIC_CORRESPONDENCE`, amendment §19.2 of
     `docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`).
     Only `ROUTE_LIKE` (without a strict anchor) may extend beyond the destination; the
     trip-destination relation is a fact, and only Experiences WITHIN the
     destination are tour-eligible from the destination window
     (`utils/tour-destination-eligibility.policy.ts`). See spec
     `docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md` Part II (§P2-18).
   - Runs deterministic daily planning and persists `TourExperience` snapshots
   - Publishes media work through the existing outbox flow

The request distinguishes thematic interests, exploration style,
allowed transportation modes, daily/continuous walking
limits, pace, accessibility, and bounded additional preferences. PR 4 captures
and traces every dimension; deterministic walking and transport enforcement is
deliberately deferred to the spatial-feasibility stage.

### Nearby Tours Discovery

- **`GET /tours/nearby?lat=X&lng=Y&category=Z`**
- `TourLocationService.getNearbyTours()` is **read-only** — it looks up existing, already-persisted `Tour → TourExperience → Experience → ExperienceComponent → GeoEntity` rows near the coordinates. It never triggers generation. (No auth guard on this route today — known gap.)

### LangChain Prompts

There is no itinerary/planning prompt in this module's live path (planning is a deterministic solver, never an LLM). `prompts/` holds the media prompt and the two shared discovery contracts every extractor provider sends unchanged: `experience-discovery-extraction.prompt.ts` (candidates and components) and `component-locality-recovery.prompt.ts` (the bounded follow-up that classifies source statements naming a component; the backend admits a locality deterministically, see `utils/component-locality-recovery.util.ts`). `PreferenceInterpreterService` builds its prompt inline.

## API Endpoints

| Method   | Path                             | Description                            |
| -------- | -------------------------------- | -------------------------------------- |
| `GET`    | `/tours/experiences/nearby`      | Verified Experience catalog lookup near a point |
| `POST`   | `/tours`                         | Create a tour manually                 |
| `POST`   | `/tours/generate-tour`           | Generate tour from wizard preferences  |
| `GET`    | `/tours/nearby`                  | Find tours near a location             |
| `GET`    | `/tours`                         | List all tours (paginated, filterable) |
| `GET`    | `/tours/:id`                     | Get tour by ID                         |
| `PATCH`  | `/tours/:id`                     | Update a tour                          |
| `DELETE` | `/tours/:id`                     | Delete a tour                          |

## Dependencies

- **`LangChainService`** — AI model interaction (from `shared/ai`)
- **`VectorStoreService`** — pgvector similarity search (from `shared/ai`)
- **`ExperienceCatalogService`** — Verified Experience and component snapshots
- **`ImageGenerationService`** — DALL-E cover images (from `shared/ai`)
- **`PrismaService`** — Database access (from `core/database`)
