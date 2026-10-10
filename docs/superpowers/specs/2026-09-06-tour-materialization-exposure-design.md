# Tour materialization & exposure — design

Status: draft, pending user review
Branch: `feat/experience-domain-v2`
Related: `docs/architecture/activity-discovery-and-tour-generation.md`, `CONTEXT.md`, session brainstorm 2026-09-06

## Context

A new itinerary-presentation UI was prototyped (per-day themed titles, an
inter-experience timeline with travel mode/time/distance, a composite
Experience's own internal stop-by-stop route with transit between stops, a
map showing each Experience's real geometry — point, shaded area, or real
route line — instead of a single pin, and multiple transport-mode options
per leg).

Investigating what it would take to build these screens surfaced a
significant finding, verified directly against the running code: **most of
the domain data the UI needs is already computed by
`GreedyDailyPlanningSolver`**, but is discarded between the solver's output
and what gets persisted/exposed to the frontend. This is not a new backend
capability so much as plumbing an existing one all the way through.

Verified directly in the codebase (not assumed):

- `PlannedExperience` (`be/src/modules/tours/interfaces/daily-planning.interface.ts:134`)
  already carries `travelFromPrevious?: TravelEstimate` — `TravelEstimate` has
  `mode`, `durationMinutes`, `distanceMeters`, `walkingMinutes`,
  `walkingDistanceMeters`, `approximate`, `provider`, `fallbackReason`.
- `PlannedDay` already carries `totalTravelMinutes`, `totalWalkingMinutes`,
  `utilizationMinutes`.
- The frontend's `TourExperience` contract (`fe/api/tours.ts:65`) has none of
  this — `id`, `experienceId`, `dayNumber`, `order`, `startTime`, `duration`,
  `notes`, `components`, `experience`. Nothing about travel to/from it.
- `ApproximateTravelEstimateProvider` (the only `TravelEstimateProvider`
  implementation today) computes distance/duration from footprints with a
  detour factor and per-mode speed — always `approximate: true`, never a real
  street-following route. It has no `geometry` field to put one in even if it
  did.
- The persistence step that snapshots a Tour
  (`experience-generation.service.ts:1734`, inside the
  `tx.tourExperience.create(...)` block) already writes per-component
  `latitude`/`longitude`/`geometry` onto `TourExperienceComponent` — so a
  composite Experience's raw shape survives into the snapshot — but:
  - it never writes `travelFromPrevious` (the column doesn't exist), and
  - its component order line reads `order: component.order ?? index + 1`
    (`experience-generation.service.ts:1747`) — when the shared
    `ExperienceComponent.order` is genuinely `null` (no real intrinsic-order
    evidence — the documented, correct state per `CONTEXT.md`'s
    `ExperienceComponent` entry), this **permanently bakes a fabricated
    array-position order into the frozen Tour snapshot**, indistinguishable
    later from a real evidence-backed sequence.
  - Separately, the frontend also does its own `component.order ?? index`
    fallback (`fe/components/tour-details/build-stops.ts:32`) — a second,
    independent place the same fabrication can happen, on top of whatever the
    backend already baked in.
- `GET /tours/:id` (`tours.service.ts:187`) returns the Prisma-included rows
  close to as-is (only decorated with `mediaPresentation` via
  `withMediaPresentation`) — any new column added to `TourExperience`/
  `TourExperienceComponent` reaches the API response with no extra mapping
  code required.

## Goals

1. Persist and expose the solver's already-computed per-leg travel
   (mode/duration/distance/approximate/provider) and per-day totals, so the
   frontend can render transit connectors and day summaries without
   recomputing anything.
2. Make a composite Experience's presentation geometry (point / shaded area /
   real route line / multiple discrete points) explicit in the API response,
   instead of the frontend inferring it from raw component counts/shapes.
3. Stop conflating "no intrinsic order exists for this Experience's
   components" with "here is an arbitrary array-position order" — at both the
   point where a Tour snapshot is persisted and the point where the frontend
   renders it.
4. (Stretch, explicitly separable) Make the connecting line drawn on the map
   between two Experiences follow real streets instead of a straight
   Haversine-derived line.

## Non-goals

- No change to `themes`/`traits`/`intents`, `CoverageAnalyzer`, the
  discovery/acquisition pipeline, the resolver, geographic validation, dedupe,
  embeddings, or the solver's own selection/scheduling logic. This spec is
  about **not losing** data those already produce, not producing new domain
  decisions.
- No change to how many days a Tour has, how Experiences are chosen, or
  scheduling itself.
- Per-day *themed titles* ("Vino y naturaleza") and per-Experience *"¿Por qué
  está en tu tour?"* justification text are UI-screen concerns that consume
  `themes`/`traits`/`intents` matches — real, but out of scope here; they
  belong with the UI-screens sub-project once this contract exists to build
  on.
- Offering the *user a choice* of transport mode per leg (walk vs bike vs
  drive vs bus, each computed) is out of scope for this pass — today's
  `travelFromPrevious` reflects the one mode the solver actually chose for
  that leg under the request's allowed-modes constraint. Computing every
  allowed mode for every leg is a real, separable enhancement to
  `TravelEstimateProvider`'s call pattern; noted as a candidate follow-up, not
  part of this spec.

## Design

### Block 1 — Persist and expose per-leg travel + per-day totals

**Schema** (`be/prisma/schema.prisma`):

```prisma
model TourExperience {
  ...
  travelFromPrevious Json? // TravelEstimate shape, see below — null for a day's first stop
  ...
}
```

Stored as `Json` (matching the existing `metadata`/`geometry` convention in
this schema) rather than exploded into columns — `TravelEstimate` is a
provider-neutral value object, not something queried on directly, and JSON
keeps this additive (no migration needed if the shape grows).

Shape persisted (mirrors `TravelEstimate` exactly, so the solver's own output
round-trips with no lossy remapping):

```ts
{
  mode: TransportationMode;
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
  provider?: string;
  fallbackReason?: string;
}
```

**Persistence** (`experience-generation.service.ts`'s `tx.tourExperience.create`
block): add `travelFromPrevious: selected.travelFromPrevious ?? null` to the
`data` object. `selected` is already the `PlannedExperience` — the value is
sitting right there, this is a one-line addition once the schema field exists.

**Day totals**: not persisted as a separate aggregate. `PlannedDay`'s
`totalTravelMinutes`/`totalWalkingMinutes`/`utilizationMinutes` are trivially
re-derivable at read time by summing the (now-persisted) per-`TourExperience`
`duration` and `travelFromPrevious.durationMinutes`/`walkingMinutes` grouped by
`dayNumber` — computing them fresh on every read avoids a second source of
truth that could drift from the individual rows it's supposed to summarize.
Exposed as a `dayTotals` array alongside `experiences` in the `GET /tours/:id`
response (one entry per distinct `dayNumber` present).

### Block 2 — Presentation geometry per Experience

New response-shaping step, added the same way `mediaPresentation` already is
(`tours.service.ts`'s `withMediaPresentation`) — computed on read from
already-persisted `TourExperienceComponent` rows, not stored:

```ts
interface ExperiencePresentation {
  geometryMode: 'POINT' | 'AREA' | 'ROUTE' | 'MULTI_POINT';
  geometry?: GeoJSON.Geometry; // present when geometryMode !== 'POINT' and a component carries one
  hasIntrinsicSequence: boolean; // see Block 4
}
```

Derivation rule — a pure function reading only already-persisted
`TourExperienceComponent[]` fields (`geometry`/`role`), no re-validation, no
new service call:

- 1 component, no `geometry` (or a `Point` geometry) → `POINT`.
- 1 component with a `Polygon`/`MultiPolygon` geometry (an `AREA`-kind
  GeoEntity) → `AREA`, `geometry` = that polygon.
- ≥2 components where one component's own persisted `role` is `'route'` or
  `'area'` and its `geometry` is a `LineString`/`Polygon`/`MultiPolygon` (the
  anchor `CompositeGeographicValidationService`'s `canonical_geometry`/
  `canonical_area` strategy picked at *generation* time — its geometry
  already lives on that one component's row, persisted the same way every
  other component's is) → `ROUTE` (or `AREA`), `geometry` = that one
  component's own geometry.
- ≥2 components with no such anchor component (every component is a plain
  `Point`, e.g. "Plazas históricas de Mendoza") → `MULTI_POINT`, no single
  `geometry` — the frontend draws each component's own point plus the
  connectors from Block 4 ordering.

This reuses geometry the resolver already attached to `GeoEntity`/
`TourExperienceComponent.geometry` at persist time (Block 2 does not change
what gets resolved or persisted there) — it only makes the *interpretation*
of that already-stored shape explicit in the API response instead of leaving
the frontend to infer it from component count.

### Block 3 — Real routing geometry (explicitly the one net-new backend capability)

`TravelEstimateProvider` interface gains an optional `geometry` field on its
return value:

```ts
interface TravelEstimate {
  ...
  geometry?: GeoJSON.LineString; // real street-following path, when a routing provider supplied one
}
```

New `TravelEstimateProvider` implementation (a real routing API — Google
Routes/Directions, OSRM, GraphHopper, Mapbox Directions, etc.) queried first;
`ApproximateTravelEstimateProvider` remains as the fallback (unreachable
provider, over quota, or a mode/region it doesn't cover) and continues
returning `approximate: true` with no `geometry` exactly as today — the map
falls back to drawing a straight line for that one leg, never blocking the
rest of the Tour.

**Provider choice is an open decision, deliberately not made in this spec** —
it has real cost/quota/self-hosting tradeoffs (see Open Questions) that
Blocks 1/2/4 do not depend on. Those three ship and are independently useful
with only the approximate provider, exactly as today; Block 3 layers in
cleanly whenever a provider is chosen, behind the same
`TravelEstimateProvider` interface already in place (swap point already
exists: `TRAVEL_ESTIMATE_PROVIDER` token).

### Block 4 — Separate intrinsic order from Tour execution order

Two distinct, already-named concepts get kept genuinely distinct instead of
collapsing into one array-position number:

- **Intrinsic order** — `ExperienceComponent.order` (nullable, catalog-level,
  shared across every Tour that includes this Experience). `null` is the
  correct value when no real evidence supports a sequence (per `CONTEXT.md`).
  Not touched by this spec — already modeled correctly at the type level; the
  bug is entirely in what happens to it downstream.
- **Tour execution order** — what *this Tour's* solver actually decided for
  visiting this Experience's components, which may exist even when intrinsic
  order doesn't (the solver orders "Plazas históricas de Mendoza"'s stops for
  routing efficiency even though the Experience itself has no canonical
  order). Lives on `TourExperienceComponent.order` — already its own column,
  separate from the shared `ExperienceComponent.order` — the schema already
  supports this distinction; only the *values written into it* are wrong
  today.

**Correction from an initial draft of this spec**: verified directly against
`buildOrderedComponentFootprints`
(`be/src/modules/tours/utils/spatial-footprint.util.ts:100`) that the solver
does **not** compute its own optimized internal visiting sequence for a
composite's components — that function only *sorts by whatever `order`
already exists* (`left.order ?? MAX_SAFE_INTEGER`), it never derives a new
one. So there is no separate "solver-decided sequence" to fall back to for an
intrinsically unordered Experience — the fix is narrower and simpler than
first described:

**Fix, at the exact site identified**
(`experience-generation.service.ts:1747`): replace
`order: component.order ?? index + 1` with `order: component.order ?? null`
— preserve `null` exactly when the shared `ExperienceComponent.order` is
`null`, instead of fabricating an array-position sequence. When a real
intrinsic order *does* exist (evidence-backed, per
`experience-proposal-resolver.service.ts`'s own
`orderedByEvidence ? index + 1 : null` logic at candidate-resolution time),
that real value already flows through unchanged — this fix only removes the
fabrication in the `null` case.

A genuinely unordered Experience (e.g. "Plazas históricas de Mendoza", `null`
on every component) therefore has no meaningful visiting sequence to display
at all — the correct UI treatment is exactly the unordered rendering the
prototype itself showed ("Incluye: • Plaza España • Plaza Chile ..."), not a
numbered list, and no inter-component travel connectors either (there is no
real "first go here, then there" to time). `hasIntrinsicSequence` in
`ExperiencePresentation` (Block 2) is `true` when any component has a
non-null `order`, telling the frontend which of the two renderings applies —
without it having to guess from array position.

Also fix the frontend's own independent `?? index` fallback
(`fe/components/tour-details/build-stops.ts:32`) to stop fabricating order
client-side once the backend stops doing so — otherwise the backend fix is
undone one layer up.

## Data flow (after this change)

```
GreedyDailyPlanningSolver
       │  PlannedDay[] { totalTravelMinutes, totalWalkingMinutes, ... }
       │  PlannedExperience[] { travelFromPrevious, order, ... }
       ▼
experience-generation.service.ts persistence step
       │  TourExperience.travelFromPrevious  (Block 1, new column)
       │  TourExperienceComponent.order      (Block 4, preserved real order
       │                                      or null, never fabricated index+1)
       ▼
tours.service.ts findOne()
       │  + dayTotals (Block 1, computed on read)
       │  + experiencePresentation per Experience (Block 2, computed on read)
       ▼
GET /tours/:id response
       ▼
Frontend (build-stops.ts, map rendering) — mechanical once this contract
exists; a separate sub-project (UI screens), out of scope here.
```

## Error handling

- `travelFromPrevious` is `null` for a day's first stop (no previous
  Experience to travel from) — not an error, not defaulted to a zero
  estimate.
- A `TravelEstimateProvider` failure (real routing provider unreachable/over
  quota) must degrade to the approximate provider's estimate for that one leg
  — matching the existing `fallbackReason` field's purpose — never fail Tour
  generation over a routing lookup.
- `ExperiencePresentation` derivation has no fallible external calls — it's a
  pure function over already-persisted data — so no new failure mode here
  beyond a defensive default (`POINT`, no geometry) if a component genuinely
  has neither coordinates nor geometry, matching the existing
  `Number.isFinite(...)` guards already used in `findVerifiedWithin`.

## Testing

- Unit tests for the `ExperiencePresentation` derivation function covering
  all four `geometryMode` outcomes plus the "no coordinates at all" defensive
  default.
- Unit test for the day-totals-on-read computation (sums match a hand-built
  fixture of `TourExperience` rows with known `duration`/`travelFromPrevious`
  values).
- Regression test at the exact fixed site: persisting a Tour whose Experience
  has `ExperienceComponent.order: null` for every component must NOT produce
  sequential `TourExperienceComponent.order` values — asserts `null` survives
  into the snapshot instead, and (separately) asserts a real evidence-backed
  order already present on `ExperienceComponent.order` still survives
  unchanged.
- `tours.service.spec.ts`: `GET /tours/:id` response includes
  `travelFromPrevious` and `dayTotals`/`experiencePresentation` for a
  multi-day, multi-component fixture tour.
- Block 3 (once a provider is chosen): the usual live-verification discipline
  this codebase already applies to external providers — a real call against
  the chosen routing API, confirmed against real known streets, before
  trusting it in production; provider-down fallback path tested by forcing a
  failure and asserting `approximate: true` with no `geometry` reaches the
  response.

## Rollout / sequencing

Blocks 1, 2, and 4 have no dependency on each other and no dependency on
Block 3 — they can land as one PR (they touch the same handful of files) with
Block 3 deliberately deferred behind its own open decision. This directly
unblocks the itinerary list/timeline and the "an Experience is not always a
single pin" map rendering; only the real-street-following connector line
waits on picking a routing provider.

## Open questions

1. **Routing provider for Block 3** — Google Routes API (cost, quota, most
   accurate for driving/transit), OSRM self-hosted (free, no quota, needs
   hosting + a road network extract — same operational shape as the local
   Overpass instance this session already stood up), GraphHopper, or Mapbox
   Directions. Not decided here; recommend picking this only once Blocks 1/2/4
   are live and the UI-screens sub-project is ready to actually render a
   drawn route, so the choice is made against real usage patterns (which
   modes/regions matter most) rather than speculatively.
2. **Multi-mode travel estimates per leg** (walk *and* bike *and* drive *and*
   bus, each computed, letting the user pick) is explicitly out of scope
   (Non-goals) but was called out as a real UI-screen desire — flagged here
   so the UI-screens sub-project's own spec addresses it explicitly rather
   than silently dropping it.
