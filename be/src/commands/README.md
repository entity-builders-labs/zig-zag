# Commands Module

CLI commands for maintenance and data processing tasks. Built with [nest-commander](https://docs.nestjs.com/recipes/nest-commander).

## Architecture

```
commands/
├── commands.module.ts                # Global commands module
└── scripts/
    ├── cli.ts                        # CLI bootstrap entrypoint
    └── commands/
        ├── scripts.module.ts         # Scripts sub-module
        ├── embedding-checker.command.ts  # Rebuild vector embeddings
        ├── image-audit.command.ts        # Audit activity images
        ├── metadata-checker.command.ts   # Regenerate AI metadata
        ├── generate-templates.command.ts # Pre-generate curated composite activity variants
        └── seed-e2e-composite.command.ts # Seed a composite-stop tour fixture for frontend e2e tests
```

## Available Commands

### `match-activities` (Embedding Checker)

Rebuilds pgvector embeddings (`Activity.embedding`) for every activity with non-null `metadata`:

```bash
yarn script match-activities
```

Options:

- `--search-prompt "outdoor activities..."` — after rebuilding, run a test similarity search with this prompt instead of the default `"outdoor activities"`

### `image-audit`

Audits activity photos and identifies missing/broken images.

### `metadata-checker`

Regenerates AI-powered metadata for activities that lack it.

### `generate-templates`

Pre-generates curated composite activity variants (neighborhood walks, routes,
experiences) for a named area, offline — one LLM proposal per requested
theme, reusing the exact same propose→verify→persist pipeline as live tour
generation (`CompositeGenerationService`). Persisted variants get
`isCurated: true`.

```bash
yarn script generate-templates --lat=-34.6212 --lng=-58.3731 --name="San Telmo"
yarn script generate-templates --lat=-34.6212 --lng=-58.3731 --name="San Telmo" --themes=history,food,tango
yarn script generate-templates --lat=-34.6212 --lng=-58.3731 --name="San Telmo" --themes=history --update-existing
```

Options:

- `--lat` / `--lng` (required) — coordinates near the area, used both to resolve the OSM boundary by name and as the center of the OSM streets / nearby-activities candidate search
- `--name` (required) — the area/neighborhood name to resolve via OSM (`queryBoundaryByName`); the command aborts if no boundary is found
- `--radius` — search radius in meters (default `2000`, same walkable-scale default as live generation's Overpass street search)
- `--themes` — comma-separated `VariantTheme` values (default: `HISTORY,FOOD,ART,QUICK`); an unrecognized value fails fast before any generation happens
- `--update-existing` — if a variant already exists for a given theme (same `familyId`+`variantTheme`), replace its waypoints with the new proposal instead of leaving it untouched (the default)

### `seed-e2e-composite`

Seeds a tour with a composite (waypoint/boundary) stop directly via Prisma — for frontend Playwright e2e tests (`fe/e2e/composite-area-polygon.spec.ts`, `composite-stop-rendering.spec.ts`, `tour-review-edit-waypoints.spec.ts`). There is deliberately no HTTP endpoint to create composite Activities (see `CompositeActivityService`'s module doc); this bypasses that guardrail on purpose, the same way `be/prisma/seed.ts` bypasses normal app flows for seeding.

```bash
yarn script seed-e2e-composite --owner-email=e2e-test@example.com --boundary-kind=polygon-hole
```

Options:

- `--owner-email` (required) — email of an existing `User` (create one first via the real auth flow, e.g. `apiLogin()` in `fe/e2e/auth-helper.ts`)
- `--boundary-kind` — `none` (default, plain multi-waypoint walk) | `polygon` | `polygon-hole` | `multipolygon` | `linestring` (a top-level `kind: ROUTE` stop with no waypoints, its own trace as content)
- `--simulate-later-edit` — after seeding, edits the variant's live `ActivityWaypoint` content (via `CompositeActivityService.updateVariantWaypoints`) without touching the tour's own `TourActivityWaypoint` snapshot — for asserting the snapshot stays stable even after the shared variant changes
- `--waypoint-count` — 2 (default) or 3 waypoints in the snapshot/live content — 3 is for the pre-confirmation review screen's e2e spec, which needs room to deselect one stop and still stay at/above the minimum of 2
- `--tour-name` — override the seeded tour's name

Prints exactly one line to stdout, `E2E_FIXTURE_JSON:{...}`, with the created `tourId`/`tourActivityId`/etc — parsed by the Playwright-side helper.

## Running Commands

```bash
# From the project root
yarn script <command-name> [options]
```

The CLI bootstraps a NestJS application context (without HTTP server) via `scripts/cli.ts`.
