# Prisma Schema & Migrations

Database schema for PostgreSQL (+ `pgvector`), managed by [Prisma ORM](https://www.prisma.io/).

## Architecture

```
prisma/
├── schema.prisma          # Database schema definition
├── seed.ts                # Database seeding script
└── migrations/
    └── <timestamp>_<name>/
        └── migration.sql
```

The legacy `Activity`/`ActivityKind`/`TourActivity` domain (single-POI activities, composite variants/families/waypoints) was removed in migration `20260902120000_remove_activity_domain_v2` as part of the **Experience Domain V2** rearchitecture — it drops those tables/enums idempotently and is safe to run against a database that never had them. Every schedulable tourism unit is now an `Experience`; do not reintroduce the old model.

## Data Models

### `GeoEntity` (table: `geo_entity`)

Physical reality only — never itself schedulable. `kind` is one of `PLACE | AREA | ROUTE`.

| Field                 | Type            | Description                                             |
| --------------------- | --------------- | -------------------------------------------------------- |
| `id`                  | UUID            | Primary key                                              |
| `name`                | String          | Entity name                                              |
| `kind`                | `GeoEntityKind` | `PLACE` \| `AREA` \| `ROUTE`                              |
| `latitude/longitude`  | Float?          | Representative point                                     |
| `geometry`            | Json?           | Canonical geometry (polygon/route), when resolved         |
| `address`             | String?         |                                                            |
| `metadata`            | Json?           |                                                            |
| `verifiedHintNames`   | String[]        | Verified hint memory: exact component-hint texts that previously resolved VERIFIED to this entity (verbatim) |
| `verifiedHintNameKeys`| String[]        | `normalizeGeoName()` of each, positionally aligned (DB `CHECK` on equal cardinality), deduplicated by key |
| `identities`          | → `GeoEntityIdentity[]` | Provider identities (see below)                    |

**Indexes**: `(kind)`, `(latitude, longitude)`, GIN `(verifiedHintNameKeys)`, plus the raw-SQL PostGIS GiST location index.

**Verified hint memory is not an alias engine.** A key is appended (one atomic, idempotent `UPDATE`, `ExperienceCatalogService.rememberVerifiedHintName`) only after IdentityVerifier accepted an external resolution of that exact hint to this entity; never from string similarity, never backfilled. It is not globally unique — the same key may live on several GeoEntities, and the catalog-first lookup (`findGeoEntityCandidatesForHint`, `"verifiedHintNameKeys" @> ARRAY[key]` within kind + bbox) keeps that multiplicity (2+ → ambiguous, no winner). `name` stays the canonical display name.

### `GeoEntityIdentity` (table: `geo_entity_identity`)

A provider's identity for a `GeoEntity` (e.g. a Google Place ID or an OSM element). Provider identity is deliberately *not* Experience identity — cross-provider merging is handled by dedupe (below), never by this table alone.

**Unique**: `(provider, externalId)`

### `Experience` (table: `experience`)

The only schedulable tourism unit. Made of one or more ordered `ExperienceComponent`s.

| Field                | Type               | Description                                            |
| --------------------- | ------------------ | ------------------------------------------------------- |
| `id`                  | UUID                | Primary key                                              |
| `canonicalName`       | String              |                                                           |
| `description`         | String?             |                                                           |
| `durationMinutes`     | Int?                |                                                           |
| `price`               | Float?              |                                                           |
| `status`              | `ExperienceStatus`  | `PENDING` \| `VERIFIED` \| `REJECTED` \| `ARCHIVED`      |
| `qualityScore`        | Float?              |                                                           |
| `latitude/longitude`  | Float?              | Representative point (logistical/search metadata, not identity) |
| `openingHours`        | Json?               |                                                           |
| `metadata`            | Json?               | Includes free-form `themes`/`traits`/`intents` used by ranking/coverage |
| `mediaStatus`         | `MediaStatus`       | `PENDING` \| `ENRICHED` \| `FAILED`                       |
| `embedding`           | `vector(256)`       | pgvector embedding for semantic ranking                  |
| `components`          | → `ExperienceComponent[]` |                                                     |
| `evidence`            | → `ExperienceEvidence[]` | Grounded-discovery evidence, when sourced externally |
| `traits`              | → `ExperienceTrait[]` | Via `TraitDefinition` (dynamic lookup, not a closed enum) |
| `media`                | → `ExperienceMedia[]` | Persisted photo URLs/provenance                        |
| `tourExperiences`     | → `TourExperience[]` | Every Tour that has ever included this Experience        |

**Indexes**: `(status)`, `(latitude, longitude)`, `(embeddingProvider, embeddingModel, embeddingDimensions, embeddingDocumentVersion)`

### `ExperienceComponent` (table: `experience_component`)

One `GeoEntity`'s participation in an `Experience`.

| Field          | Type    | Description                                                        |
| -------------- | ------- | -------------------------------------------------------------------- |
| `order`        | Int?    | Nullable — `null` means no intrinsic sequence, not "unspecified"    |
| `role`         | String? |                                                                       |
| `required`     | Boolean | `true` by default — a required component may never be silently dropped |

**Unique**: `(experienceId, geoEntityId)` — a loop route (same `GeoEntity` twice in one Experience) is currently unrepresentable; known limitation.

### `ExperienceEvidence` (table: `experience_evidence`)

Grounded-search evidence backing a discovered Experience (`source`, `url`, `title`, `snippet`). Additive — never overwritten, only appended.

### `ExperienceMedia` (table: `experience_media`)

Persisted photo URLs and provenance only — **never binary image data**. Populated by `MediaEnrichmentProcessorService` (Wikimedia Commons today).

**Unique**: `(experienceId, url)`. **Indexes**: `(experienceId, position)`, `(provider)`

### `TraitDefinition` / `ExperienceTrait` (tables: `trait_definition`, `experience_trait`)

Dynamic trait vocabulary (`dimension` + `key`, e.g. `theme:history`), not a closed Prisma enum — new traits don't require a migration. `ExperienceTrait` is the many-to-many join.

### `Tour` (table: `tour`)

A generated itinerary. `experiences` → `TourExperience[]` (the schedulable snapshots, see below) — there is no direct `activities`/`stops` relation.

### `TourExperience` (table: `tour_experience`)

A **frozen per-Tour snapshot** of a selected `Experience` — the shared `Experience` may be enriched/edited later; this row (and its component snapshots) preserve exactly what the traveller was given.

| Field                | Type      | Description                          |
| -------------------- | --------- | -------------------------------------- |
| `dayNumber`          | Int?      |                                        |
| `order`               | Int       | Position within the day                |
| `startTime`          | DateTime? |                                        |
| `duration`           | Float?    |                                        |
| `notes`              | String?   |                                        |
| `travelFromPrevious` | Json?     | The solver's per-leg `TravelEstimate` for how the traveller got to this experience from the previous one that day; `null` (a real SQL NULL, via `Prisma.DbNull`) for a day's first stop |

**Unique**: `(tourId, experienceId, dayNumber, order)`. **Indexes**: `(tourId)`, `(experienceId)`

### `TourExperienceComponent` (table: `tour_experience_component`)

A frozen snapshot of one `ExperienceComponent` at the time it was selected into a `TourExperience` (own `name`/`latitude`/`longitude`/`geometry` copy, not a live join). **Known gap**: no `excluded` flag exists yet, so the post-generation waypoint-review screen (`fe/app/tours/[id]/review.tsx`) cannot actually persist an exclusion today — see `CLAUDE.md`.

### `CrawlerSearch` (table: `crawler_search`)

Tracks which areas have been crawled to prevent redundant Google Places API calls. Unique by `(latitude, longitude)`.

### `Source` (table: `source`)

Data source tracking — `"external"` (Google Places), `"ai"` (generated), or `"manual"`.

### `OutboxEvent` (table: `outbox_event`)

Transactional outbox for durable async Tour generation and media enrichment (`PENDING → PROCESSING → PUBLISHED/FAILED`, with `attemptCount`/`maxAttempts`/`leaseUntil` for lease-based retry).

### `NegativeMediaLookup` (table: `negative_media_lookup`)

Negative cache for authoritative-empty media lookups only — a retryable provider failure (429/5xx/network) is never cached here.

### `User` / `EmailLoginCode` / `UserDevice` / `WebPushSubscription`

Auth (Google/Apple/email-code login) and push-notification device registration. Unrelated to the Experience domain.

## Common Commands

```bash
# Generate Prisma Client after schema changes
yarn prisma generate

# Create a new migration
yarn prisma migrate dev --name <migration_name>

# Apply migrations in production
yarn prisma migrate deploy

# Open Prisma Studio (DB GUI)
yarn prisma studio

# Seed the database
yarn prisma db seed
```
