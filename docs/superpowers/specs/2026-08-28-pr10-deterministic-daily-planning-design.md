# PR 10: Deterministic Daily Planning + Transport-Aware Feasibility

## Status

Design approved by section (2026-08-28). Not yet implemented. Feeds the
writing-plans skill for a concrete implementation plan.

## Context

The tour-generation pipeline already has canonical Activity candidates
(`POI`/`AREA`/`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`), composite Activities
with reusable waypoints, candidate acquisition/discovery (PR 7-8), PR 9's
unified ranked candidate pool, completeness validation (PR 7.2), and requested
format coverage validation (PR 7.4). What it does not have is a deterministic
owner of **day assignment, ordering, and physical feasibility** — today the
itinerary LLM effectively decides which day an Activity lands on and its
order, enforced only by weak post-hoc checks. `docs/architecture/activity-discovery-and-tour-generation.md`'s
"Transport-aware spatial feasibility" section and architectural invariant 9
("the user's allowed transportation modes must drive deterministic
travel-time analysis... A prompt instruction is not enforcement") already
name this gap; PR 10 closes it.

This PR moves day assignment, grouping, ordering, and physical feasibility
out of the LLM and into deterministic backend logic. The LLM stops being the
authority for: which day an Activity belongs to, whether two Activities
physically fit together, whether daily walking limits are exceeded, whether a
day exceeds time capacity, whether opening hours make the schedule
impossible, or whether the itinerary satisfies mobility constraints. The
backend owns planning. The LLM may still produce narrative/presentation copy
later, never core feasibility.

### Core invariant

```
UnifiedCandidatePool (PR9)
  -> DailyPlanningSolver
  -> DailyPlanningSolution
  -> TourPlanningFeasibilityValidator
  -> Completeness validation (PR 7.2, re-scoped to the planned tour)
  -> Requested format coverage validation (PR 7.4, re-scoped to the planned tour)
  -> snapshot / persist
  -> optional narrative generation
```

The LLM must not repair or override deterministic feasibility decisions. A
tour is never generated and then handed to the LLM to "fix" impossible days.
Planning is deterministic for identical inputs.

## Codebase audit findings that shape this design

A full audit (2026-08-28) of the real generation pipeline confirmed the
following facts, which override assumptions that don't match current code:

1. **Duration is hours, consistently, in the live path.** `Activity.duration`
   and `TourActivity.duration` (both Prisma `Float?`) are hours throughout
   `activity-prompt-formatter.util.ts`, `activity-transformer.util.ts`
   (`parseDuration`), and `TourCompletenessValidator`'s input construction.
   The only minutes-labeled duration code (`contextual-activities.prompt.ts`,
   `prompts/index.ts`) has zero live callers — dead code, not a real risk to
   this PR, but a landmine if ever resurrected.
2. **Composite Activities (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`) never get
   `duration` populated at creation** (`CompositeActivityService.createOrReuseComposite()`
   never sets it) — it is `null` today. `ActivityWaypoint`/`TourActivityWaypoint`
   carry no distance/duration fields at all. There is no existing signal for
   how long or how far a composite takes to traverse internally.
3. **No `PlanningActivityCandidate`/`SpatialFootprint`/`DailyPlanningWindow`-equivalent
   type exists anywhere in `be/src`.** The closest existing shapes
   (`RankableCandidate`/`RankedCandidate<T>`/`CandidateScoreBreakdown` in
   `candidate-ranking.util.ts`, `CoverageCandidate` in
   `coverage-analysis.interface.ts`, `ActivityForPrompt` in
   `activity-prompt-formatter.util.ts`) are each too thin or wrong-purposed to
   reuse directly. What actually reaches the LLM today is the full Prisma
   `Activity` row (`original` field on the ranking wrapper), not a slim
   planning-specific type.
4. **`TourActivity` has no persisted minutes-from-midnight or explicit
   end-time field.** Only `startTime: DateTime?` (in practice almost always
   `undefined` — `activity-transformer.util.ts`'s `parseStartTime` discards
   the LLM's bare `"HH:MM"` string because there's no base date to combine it
   with), `duration: Float?` (hours), `dayNumber: Int?`, `order: Int`.
5. **`route-optimizer.util.ts`'s `optimizeActivityOrder()` runs once, across
   the entire multi-day tour as one flat list with one shared origin** —
   contradicts the architecture doc's own target rule ("Optimize order per
   day. Do not run one global route across multiple days."). Confirms PR 10's
   per-day ordering step is a real fix, not a redundant addition.
6. **`TourCompletenessValidator` and `TourFormatCoverageValidator` both run on
   the LLM's raw verified picks (`uniqueActivities`)**, before
   `optimizeActivityOrder`/`updateTravelTimesForActivities` ever run. Moving
   them after deterministic planning (per this design) is a real pipeline
   reordering, not an additive integration.
7. **Opening hours are raw Google `weekdayText: string[]`, never structured
   intervals, anywhere in the codebase.** The existing
   `generation-audit.util.ts`'s `checkOpeningHours()` explicitly does not map
   ranges to a specific weekday (checks every activity against every range
   mentioned for the place, regardless of tour date) — a disclosed
   limitation, not reusable authority for a real per-weekday hard constraint.
8. **Mobility fields (`allowedTransportationModes`, `maxWalkingDistancePerDayMeters`,
   `maxContinuousWalkingDistanceMeters`, `accessibilityNeeds`) are read only
   for prompt prose today, never for enforcement.** `prompt-builder.util.ts`
   literally tells the LLM "deterministic enforcement arrives in the
   spatial-feasibility stage" — confirming PR 10 is exactly the intended
   activation point, with no prior enforcement code to reconcile.
9. **The two tour-generation entry paths do not converge today.**
   `POST /tours/generate-tour` (wizard) →
   `TourGenerationService.createTourFromWizard()` →
   `TourActivityGenerationService.generateTourActivities()` is the real,
   PR9-integrated path. `GET /tours/nearby` → `TourLocationService` →
   the **`@deprecated`** `TourGenerationService.generateTour()` runs an
   entirely separate, simpler chain with its own prompts, no PR9
   ranking/windowing, no completeness/format-coverage validation, and never
   calls `TourActivityGenerationService`/`CompositeGenerationService`.
10. **Caller check for the two utils PR 10 supersedes:**
    `optimizeActivityOrder` (`route-optimizer.util.ts`) has exactly one real
    caller, `tour-activity-generation.service.ts:1446` (wizard path only).
    `updateTravelTimesForActivities` (`travel-time-calculator.util.ts`) has
    two real callers: `tour-activity-generation.service.ts:1508` (wizard) and
    `tour-generation.service.ts:525` (the deprecated `/tours/nearby` chain).

## Explicit scope decision: `/tours/nearby` is out of scope

`GET /tours/nearby`'s generation fallback uses the `@deprecated`
`TourGenerationService.generateTour()`, an entirely separate pipeline that
never touches PR 9's ranking/windowing or PR 7.2/7.4's validators. PR 10 does
**not** migrate or converge this path. Scope is the wizard/canonical PR 9
pipeline only. This must be documented explicitly as separate, un-addressed
debt — not implied to be already covered by this PR's completion.

## Scope

**Implement:**

1. Provider-neutral daily planning abstraction (`DailyPlanningSolver`).
2. Deterministic V1 solver (`GreedyCapacitatedDailyPlanningSolver`).
3. Transport-aware travel estimates (`TravelEstimateProvider`, V1
   `ApproximateTravelEstimateProvider`).
4. Explicit hard mobility constraints.
5. Daily capacity constraints.
6. Opening-hours feasibility (new normalizer, scoped to the planner).
7. Composite Activity handling, including in-memory internal-walking
   estimation.
8. Deterministic ordering within each day.
9. Bounded local improvement after initial greedy assignment.
10. Independent feasibility validation (`TourPlanningFeasibilityValidator`).
11. Planning trace/observability.
12. Integration into the wizard generation entry path only.
13. Deterministic tests (30 scenarios, listed below).

**Do NOT implement in this PR:** OR-Tools, live traffic, transit APIs,
turn-by-turn directions, map rendering, LLM day planning, discovery redesign,
PR 8/PR 9 redesign, food/meal architecture redesign, `GeoFeature`,
provider-specific route APIs (OSRM/Valhalla/GraphHopper/Google
Routes/Mapbox/OpenRouteService), dynamic real-time opening-hours fetching,
itinerary narrative-generation redesign, the Places cost-control work, the
search/enrichment Places split, Gemini/Groq discovery extraction changes,
SerpApi discovery changes, hidden fallbacks, or migration of `/tours/nearby`.

## Architecture

A provider-neutral planning contract:

```ts
interface DailyPlanningSolver {
  solve(input: DailyPlanningInput): Promise<DailyPlanningSolution>;
}
```

V1 implementation: `GreedyCapacitatedDailyPlanningSolver`. The interface must
allow a future `OrToolsDailyPlanningSolver` without changing domain callers.
The solver must not depend directly on Prisma, Google Maps SDK, OpenAI,
Gemini, Groq, or SerpApi — it operates on normalized planning candidates
only.

### `DailyPlanningInput`

```ts
interface DailyPlanningInput {
  destination: DestinationResolution; // the real existing type (destination-resolution.service.ts:52) — not a "ResolvedDestination" that does not exist in this codebase
  requestedDays: number;
  candidates: PlanningActivityCandidate[];
  mobility: MobilityPreferences; // reuse tour-generation.interface.ts's existing type (finding #8: already fully shaped)
  travelPace: TravelPace;
  planningWindow: DailyPlanningWindow;
  requestedFormats?: ExperienceFormat[];
  context?: PlanningContext; // deliberately open extension point, not further specified in this PR
}
```

Reuse existing types where already available (`MobilityPreferences`,
`TravelPace`, `ExperienceFormat`); do not duplicate domain concepts.

### `PlanningActivityCandidate`

A new type — nothing in the codebase resembles it (finding #3). Built from
PR 9's ranked/windowed output (the full `Activity` row plus its
`CandidateScoreBreakdown`), normalized once at the planning boundary:

```ts
interface PlanningActivityCandidate {
  activityId: string;
  kind: ActivityKind;
  title: string;
  durationMinutes: number; // converted once from the persisted hours value (finding #1)
  spatialFootprint: SpatialFootprint;
  openingHours?: NormalizedOpeningHours; // new type, see "Opening hours normalization"
  semanticScore: number;
  qualityScore?: number;
  themes?: string[];
  formats?: ExperienceFormat[];
  areaId?: string;
  familyId?: string;
  variantKey?: string;
  mobility?: {
    internalWalkingMinutes?: number; // undefined = unknown, never derived from duration (see below)
    internalWalkingDistanceMeters?: number;
    internalTravelMinutes?: number;
  };
  metadata?: {
    source?: string;
    rating?: number;
    userRatingCount?: number;
  };
}
```

The planning layer never relies on raw provider DTOs; Google Place IDs and
OSM IDs are never planning identity. Use canonical Activity identity only.

**Duration unit:** Planning uses minutes internally. Convert once, at the
boundary where `PlanningActivityCandidate` is built from the persisted-hours
`Activity.duration`. Add a regression test asserting a stored-hours value is
never misinterpreted as minutes (finding #1 confirms this isn't a live bug
today, but the conversion boundary must be tested so it can't become one).

### `SpatialFootprint`

A lightweight planning geometry abstraction — not a `GeoFeature`:

```ts
type SpatialFootprint =
  | { type: 'POINT'; centroid: Coordinate }
  | { type: 'AREA'; centroid: Coordinate; bounds?: BoundingBox }
  | {
      type: 'LINE';
      centroid: Coordinate;
      bounds?: BoundingBox;
      geometry?: SimplifiedLineGeometry;
    };

interface Coordinate {
  lat: number;
  lng: number;
}
```

The V1 solver primarily uses centroids. Kept as a discriminated union (not
collapsed to a single point type) because `ROUTE`/`AREA`/composite Activities
are not semantically points — no full GIS abstraction in this PR.

### Composite Activities as first-class planning units

`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE` are treated as first-class planning
units, never expanded into separate top-level Activities during planning. A
composite has its own duration, its own spatial footprint, and a possible
internal walking/travel cost that counts toward mobility constraints (not
double-counted as inter-Activity travel).

**Internal walking, reconciled (finding #2 — nothing computes this today):**

- Computed **in memory during planning**, from the composite's canonical
  waypoints in order, using the same approximate Haversine + detour-factor +
  speed model as `TravelEstimateProvider` (see below). Nothing new is
  persisted in this PR.
- **Never derived from `Activity.duration`.** Duration does not imply
  walking distance/time — a composite's `duration` and its internal walking
  cost are independent signals, and `duration` is unpopulated for composites
  today anyway (finding #2).
- If there are not enough resolvable waypoint coordinates to estimate
  internal walking, the value is represented as **unknown**
  (`internalWalkingMinutes: undefined`), never a synthetic zero or a
  duration-derived guess.
- For requests with active walking constraints, apply an explicit,
  conservative **V1 policy value** from `DailyPlanningPolicy` config (a
  configurable conservative default) when the internal-walking estimate is
  unknown — not an implicit formula based on duration.
- The result is documented as approximate (matches the rest of the
  `TravelEstimateProvider` contract, which sets `approximate: true`
  everywhere in V1).

### `TravelEstimateProvider`

`TravelMode` below is the existing `TransportationMode` enum
(`tour-generation.interface.ts`: `WALKING`/`DRIVING`/`PUBLIC_TRANSPORT`/`CYCLING`),
reused directly — not a new parallel enum.

```ts
interface TravelEstimateProvider {
  estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate>;
}

interface TravelEstimate {
  mode: TransportationMode;
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
}
```

V1 implementation: `ApproximateTravelEstimateProvider`, using Haversine
distance between centroids, a configurable detour factor, and conservative
speed assumptions per allowed mode (illustrative only — real values live in
policy config): walk ~4.5 km/h, bike ~12-15 km/h, car a conservative urban
average. No provider-specific route API in this PR (no OSRM, no Google
Routes, no Mapbox). `approximate = true` always for the V1 provider. Future
providers may swap in a real routing engine without changing the solver
contract.

**Memoization:** travel estimates are pairwise and may be requested
repeatedly. Memoize within one `solve()` call using a stable pair key
(`fromActivityId + toActivityId + allowedModes`). No distributed cache in
this PR.

### Hard constraints

Hard constraints reject infeasible placements outright — they are not
scoring penalties.

1. **Requested day count.** `requestedDays = N` produces exactly N day
   buckets (partially utilized if candidates run out; never silently
   collapsed to fewer days).
2. **Allowed mobility modes.** Never select a mode outside
   `mobility.allowedTransportationModes`.
3. **Maximum walking per day.** Inter-Activity walking + internal composite
   walking, summed, must not exceed `maxWalkingDistancePerDayMeters`
   (existing unit: meters, confirmed no drift — finding: mobility contract
   audit).
4. **Maximum continuous walking**, independent of the daily total. A single
   uninterrupted walking segment must not exceed
   `maxContinuousWalkingDistanceMeters`. V1 treats one inter-Activity leg as
   one continuous segment; a composite's own internal continuous-walking
   exposure is used when known, otherwise a conservative approximation from
   the policy default (documented, not silently assumed).
5. **Daily time capacity.** Activity durations + inter-Activity travel
   durations together must fit the day's time budget; travel time is never
   ignored when computing capacity.
6. **Opening hours.** A candidate may only be scheduled in a
   weekday-and-time-compatible interval. If no valid slot exists, reject the
   placement. Unknown/unparseable hours are never treated as "closed" —
   follow the existing unknown-availability policy.
7. **Canonical identity uniqueness.** The same canonical Activity does not
   appear twice in one tour (V1 default: no duplicates; no known domain
   reason to allow it today).
8. **Composite integrity.** Never schedule archived, structurally invalid, or
   broken-waypoint-reference composites. PR 8/PR 9 should already filter most
   of these; this is a defensive re-check, not new validation authority.

**Hard reject behavior:** a candidate that cannot fit any day simply remains
unselected. Never force every candidate into the itinerary; never violate a
hard constraint to improve completeness. Completeness is evaluated **after**
physical planning.

### Pace is a soft target; mobility limits stay hard

`travelPace` (`relaxed`/`moderate`/`fast`) influences preferred Activities
per day, day-utilization tolerance, and density scoring — never a license to
ignore hard mobility limits. Illustrative soft density targets (not hard
constraints): relaxed 2-4/day, moderate 3-5/day, fast 4-7/day. If hard
constraints allow fewer, select fewer.

### `DailyPlanningWindow`

Centralizes daily time windows instead of scattering literal times through
the solver:

```ts
interface DailyPlanningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}
```

Defaults owned by application config/domain policy, one source of truth.

## V1 solver: `GreedyCapacitatedDailyPlanningSolver`

Deterministic — no randomization. High-level flow:

1. Normalize and sort candidates deterministically.
2. Identify strong anchors (long composite walk, major `EXPERIENCE`, high
   semantic score, or narrow-opening-hours Activity) and seed each day with
   one, to avoid every top candidate landing on day 1. Anchor selection is
   itself deterministic — no complex optimizer.
3. Place remaining candidates into the best hard-feasible day by soft score.
4. Order each day spatially/temporally.
5. Run bounded local improvement.
6. Return unselected candidates with stable rejection reasons.

**Deterministic sorting** uses stable tie-breakers: semantic score desc,
quality score desc, requested-format relevance, compactness potential,
`activityId` lexical ascending as the final tie-break. Never depends on DB
result order or JS object iteration order.

### Day placement and soft scoring

For each remaining candidate, evaluate every day where placement is
hard-feasible, then score:

```
placementScore =
    semanticWeight * semanticScore
  + qualityWeight * qualityScore
  + formatWeight * requestedFormatBonus
  + themeDiversityBonus
  + dayBalanceBonus
  - travelPenalty
  - geographicSpreadPenalty
  - redundancyPenalty
  - familyVariantPenalty
```

Hard constraints are always checked before scoring — never expressed as a
large negative penalty. Weights are centralized in one `DailyPlanningPolicy`
config object, not scattered as magic constants; no weight-tuning/overfitting
in this PR.

**Unknown quality is never a penalty.** `qualityScore: undefined` must not
score as if it were `rating = 0` — consistent with PR 9's existing rule.

**Geographic compactness** prefers Activities close to others on the same
day, using centroid distance/estimated travel time — not exact route
geometry.

**Day balance** prefers reasonable utilization across days (never, e.g., 7
Activities on day 1 and 1 each on days 2-3 when an equally hard-feasible more
balanced assignment exists) — but semantic relevance and hard feasibility
outrank symmetry.

**Family/variant redundancy** (e.g. two variants of the same
`ActivityFamily`, like a "San Telmo Walk" historic vs. food variant) gets a
soft penalty, not a hard reject — no domain policy today requires a hard
same-family exclusion.

### Ordering inside a day

After assignment, order each day deterministically: opening-hours-constrained
candidates first where necessary, otherwise nearest feasible next candidate,
preferring minimal travel, always preserving hard constraints. The LLM never
reorders Activities. Produces scheduled time windows:

```ts
interface PlannedActivity {
  activityId: string;
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  travelFromPrevious?: TravelEstimate;
}

interface PlannedDay {
  dayNumber: number;
  activities: PlannedActivity[];
  totalActivityMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  utilizationMinutes: number;
}
```

**Opening-hours scheduling:** never schedule outside a normalized valid
window (e.g. a museum open 10:00-17:00 is never placed at 08:30). If waiting
is allowed by current product policy, model it explicitly; otherwise choose
a different ordering. Never invent an opening-hour interval.

**Meal handling:** no redesign in this PR. If an existing planning policy
already reserves lunch/dinner windows, preserve that behavior as-is; if meals
are today only a completeness expectation and not a canonical Activity, do
not fabricate restaurant Activities here. Any existing daily meal-time
reservation is centralized in planning policy rather than embedded in LLM
instructions.

### Bounded local improvement

After initial greedy placement, run a bounded deterministic pass. Allowed V1
operations: move one Activity between two days, swap one Activity between two
days, reorder a day. Only accept a change that preserves all hard constraints
and improves the total planning score. Bound the search explicitly (e.g. max
iterations, max candidate pairs evaluated). No simulated annealing, no
randomness, no genetic algorithms, no unbounded combinatorial search.

### Forward compatibility with a future optimizer

Keep the interface compatible with a future `VRP`/`VRP with time
windows`/`CP-SAT` replacement without prematurely modeling every OR-Tools
concept now. The V1 domain input already contains what a future optimizer
would need: durations, travel estimates, opening hours, day capacities,
mobility limits, candidate scores.

## `DailyPlanningSolution`

```ts
interface DailyPlanningSolution {
  days: PlannedDay[];
  unselected: UnselectedPlanningCandidate[];
  score: number;
  metadata: {
    solver: string;
    approximateTravel: boolean;
    iterations?: number;
  };
}

interface UnselectedPlanningCandidate {
  activityId: string;
  reasons: PlanningRejectionReason[];
}
```

Stable rejection-reason codes, not free-form strings:
`DAILY_TIME_CAPACITY_EXCEEDED`, `MAX_WALKING_PER_DAY_EXCEEDED`,
`MAX_CONTINUOUS_WALKING_EXCEEDED`, `NO_ALLOWED_TRAVEL_MODE`,
`OPENING_HOURS_INCOMPATIBLE`, `DUPLICATE_ACTIVITY`,
`INVALID_SPATIAL_FOOTPRINT`, `INVALID_COMPOSITE`, `NO_FEASIBLE_DAY`,
`LOWER_RANKED_THAN_SELECTED`, `FORMAT_REDUNDANCY`,
`FAMILY_VARIANT_REDUNDANCY`.

## `TourPlanningFeasibilityValidator`

An independent validator that does not assume the solver is correct:

```ts
interface TourPlanningFeasibilityValidator {
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult;
}
```

Independently re-verifies: exact requested day count, no duplicate canonical
Activities, daily time capacity, walking per day, continuous walking,
allowed travel modes, opening-hours compatibility, chronological ordering,
travel-time inclusion, composite internal-walking inclusion, valid day
numbering. On failure, the generation fails explicitly — the validator never
silently repairs its own failure. It is a safety boundary, not a second
planner.

## Opening hours normalization (reconciled)

No structured opening-hours type exists today (finding #7); this PR builds
one, scoped to the planner:

- New `NormalizedOpeningHours` type: parses Google's raw `weekdayText:
  string[]` into a real per-weekday structure (day → one or more time
  ranges), unlike today's `checkOpeningHours()` which checks every range
  against every day regardless of the tour's actual date.
- **`generation-audit.util.ts` is not touched in this PR** — its existing
  callers keep using the old coarse pass/fail check unchanged. The new
  normalizer is a fresh, separate module the planner owns, not a
  replacement of that file's public contract.
- Unknown/unparseable hours never become an implicit "closed" — apply the
  same unknown-availability policy already used elsewhere in the domain
  (never assume unavailability from missing data).
- Test coverage required: a simple single range; multiple ranges in one day;
  a fully closed day; a range crossing midnight (if any real data exhibits
  this shape); unparseable/unknown text.

## Persisted schedule (reconciled)

No new Prisma columns in this PR (finding #4 confirms none exist today, and
this PR does not add any):

- `PlannedActivity.startMinutesFromMidnight`/`endMinutesFromMidnight` live in
  memory — part of the `DailyPlanningSolution` and the generation trace, not
  the database schema.
- If a real base date for the tour exists, persist `TourActivity.startTime`
  by combining `tour start date + dayNumber + startMinutesFromMidnight` into
  a real `DateTime`. `TourActivity.duration` stays persisted in hours,
  converted from the in-memory minutes value at the persistence boundary
  (inverse of the conversion described under `PlanningActivityCandidate`).
- If no reliable base date exists, do not invent one. Persist
  `dayNumber`/`order`/`duration` as today; the full minutes-precise timing
  is only guaranteed to survive in the planning trace/result, not in the
  `TourActivity` row itself, for that case.
- `dayNumber` and `order` continue to be set from the solver's per-day
  ordering output (`order` reset per day, fixing finding #5's global-ordering
  bug as a side effect).

## Legacy utility fate (reconciled, with confirmed callers)

- **`route-optimizer.util.ts` (`optimizeActivityOrder`)** — exactly one real
  caller, the wizard path (`tour-activity-generation.service.ts:1446`,
  finding #10). No caller in the deprecated `/tours/nearby` chain. **Delete
  the file and its call site in this PR** once the solver's per-day ordering
  covers its role.
- **`travel-time-calculator.util.ts` (`updateTravelTimesForActivities`)** —
  two real callers: the wizard path
  (`tour-activity-generation.service.ts:1508`) and the deprecated
  `/tours/nearby` chain (`tour-generation.service.ts:525`, finding #10).
  **Remove only the wizard-path call site.** Keep the file itself, since
  `/tours/nearby` still depends on it and that path is explicitly out of
  scope. Add a code comment marking it legacy/deprecated-path-only, and note
  in this document (not just a comment) that it should be deleted once
  `/tours/nearby` is retired or migrated — that removal is separate,
  un-scheduled debt, not implied to be done by PR 10.
- Before physically deleting either file, re-run a global caller search as a
  final check immediately before the deletion commit (call sites can shift
  during implementation).

## Integration into the wizard generation flow

Both completeness (PR 7.2) and requested-format-coverage (PR 7.4) validation
move to run **after** deterministic planning, evaluating the planned tour,
not the LLM's raw picks (finding #6 confirms this is a real reordering of
today's pipeline, not additive):

```
candidate pool (PR 9)
  -> deterministic planning (DailyPlanningSolver)
  -> feasibility validation (TourPlanningFeasibilityValidator)
  -> completeness validation (now over PlannedDay[], not uniqueActivities)
  -> requested format coverage validation (now over PlannedDay[])
  -> persist
```

If completeness fails: never ask the LLM to invent more Activities; the
existing PR 7.2/PR 9 acquisition/requery policy may still run, but any retry
returns to the canonical candidate pool and back through the deterministic
planner — never a second, separate LLM "fix" pass. Preserve the existing
bound of at most one corrective retry; no unbounded planning retry loop.

**Requested format coverage now requires physical feasibility, not just pool
presence.** Example: the pool contains a viable `NEIGHBORHOOD_WALK` for a
requested `neighborhood_walks` format, but it cannot fit any requested day
under hard mobility constraints — it must not count as "available" for final
format-coverage enforcement, and it must not be forced into the tour merely
to satisfy the format. Distinguish "available in candidate pool" from
"physically feasible for this planning request"; use the latter for
format-coverage enforcement. The existing kind mapping stays: `point_visits →
POI`, `neighborhood_walks → NEIGHBORHOOD_WALK`, `thematic_routes → ROUTE`,
`experiences → EXPERIENCE`; `AREA` never satisfies `neighborhood_walks`.

### PR 9 boundary

PR 9 remains responsible for candidate quality, semantic ranking, candidate
window construction, requested-format representation, and canonical
candidate normalization. PR 10 is responsible for physical day assignment,
grouping, ordering, time feasibility, travel feasibility, and mobility
feasibility. The solver consumes PR 9's scores as planning inputs; it never
duplicates PR 9's ranking logic.

### No LLM planning authority

Remove reliance on prompt instructions asking the LLM to decide day
grouping, Activities-per-day count, exact order, walking feasibility,
geographic feasibility, or opening-hours feasibility. If a later LLM call
receives the already-planned itinerary, it may write descriptions, add
narrative transitions, explain why Activities fit together, or localize
user-facing text — it must never add/remove canonical Activities, move them
between days, change scheduled times, alter canonical IDs, change travel
modes, invent travel durations, or override feasibility.

## Planning trace/observability

Structured trace data, matching this codebase's existing bitácora
conventions:

- **Input:** requestedDays, travelPace, allowedModes, maxWalkingPerDay,
  maxContinuousWalking, candidate count.
- **Per candidate:** semantic score, quality score if present, duration,
  spatial footprint type, format, family/variant identity.
- **Assignment:** selected day, placement score, travel estimate, hard
  feasibility result.
- **Rejection:** stable rejection reasons.
- **Per day:** Activity count, activity minutes, travel minutes, walking
  minutes, utilization, approximate-travel flag.
- **Solution:** selected count, unselected count, total score, solver name,
  local-improvement iteration count.

Never log full sensitive user free text unnecessarily, and never log huge
raw provider responses.

## Determinism guarantee

Given identical candidate input, mobility, opening hours, config, and travel
estimates, the solver must produce identical day assignment, ordering,
selected set, rejection reasons, and score. Tests must confirm this directly
(repeatability test, listed below).

## Configuration

Centralize planning policy — no magic constants scattered through the
solver:

```ts
interface DailyPlanningPolicy {
  paceTargets: {
    relaxed: { preferredActivitiesMin: number; preferredActivitiesMax: number };
    moderate: { preferredActivitiesMin: number; preferredActivitiesMax: number };
    fast: { preferredActivitiesMin: number; preferredActivitiesMax: number };
  };
  travel: {
    detourFactor: number;
    walkingSpeedKmh: number;
    bikeSpeedKmh: number;
    carUrbanSpeedKmh: number;
  };
  internalWalking: {
    // conservative V1 default used only when a composite's own internal
    // walking estimate is unknown (see "Internal walking, reconciled")
    unknownFallbackMinutes: number;
  };
  scoring: {
    semanticWeight: number;
    qualityWeight: number;
    formatWeight: number;
    travelPenaltyWeight: number;
    redundancyPenaltyWeight: number;
    familyVariantPenaltyWeight: number;
    dayBalanceWeight: number;
  };
  localImprovement: {
    maxIterations: number;
  };
}
```

Reuse this codebase's existing application-config conventions
(`registerAs`-based, per `be/src/shared/ai/ai.config.ts`'s pattern) rather
than inventing a new configuration mechanism.

## Error boundaries

Distinguish **candidate infeasibility** (a normal result — the candidate
remains unselected with a reason) from **planner/system failure** (malformed
planning input, an impossible `requestedDays` value, a travel-estimate
provider crash, invalid solver output, or the feasibility validator
detecting internal inconsistency). System failures surface as generation
errors per this codebase's existing conventions. A single candidate not
fitting is never an exception.

## Performance

V1 target sizes are the bounded candidate windows PR 9 already produces.
Avoid unnecessary O(N³) behavior. Pairwise travel estimates may be O(N²) but
are memoized per `solve()` call. Local improvement is explicitly bounded. No
full destination-wide distance matrix precomputation, and no external route
API calls in V1.

## Testing

Unit/integration tests must cover at minimum:

1. Exact requested day count (`requestedDays=3` → `solution.days.length === 3`).
2. Moderate balanced assignment (9 feasible candidates, 3 days → deterministic, reasonably balanced).
3. Daily capacity: a candidate that cannot fit remaining time is not selected for that day.
4. Max walking per day: inter-Activity + internal composite walking exceeding the limit is a hard reject.
5. Max continuous walking: a single long leg exceeding the limit is a hard reject even when total daily walking is under the daily max.
6. Allowed modes: a disallowed mode is never chosen.
7. Approximate travel: the V1 provider always reports `approximate: true`.
8. Opening hours: a museum open 10:00-17:00 is never scheduled outside that window.
9. Narrow opening-hours anchor: ordering accommodates a narrow valid interval when feasible.
10. No duplicate Activity: the same canonical Activity in the input yields at most one planned instance.
11. Composite walking: a `NEIGHBORHOOD_WALK` with a resolvable internal-walking estimate has it included in the daily walking total.
12. Composite first-class behavior: a composite remains one planned Activity; its waypoints are never expanded into top-level Activities.
13. Geographic compactness: given two otherwise-equivalent plans, the solver prefers lower travel cost.
14. Unknown quality: `qualityScore: undefined` is never penalized as `qualityScore = 0`.
15. Family redundancy: two variants from the same family receive a soft penalty discouraging both when an equivalent alternative exists.
16. Requested format physically infeasible: a pool candidate for a requested format that violates a hard mobility limit is not forced into the plan and does not count as physically-viable format coverage.
17. Requested format feasible: a genuinely feasible candidate for a requested format is preserved through soft scoring and the final planned tour satisfies the format when no higher-priority hard conflict exists.
18. Deterministic tie-breaking: equal scores/distances resolve via the `activityId` lexical tie-break, stably.
19. Local improvement move: a bounded move improves the score from a suboptimal initial greedy placement.
20. Local improvement swap: a swap that improves compactness without breaking constraints is accepted.
21. Validator catches a solver bug: a manually constructed invalid solution is rejected by `TourPlanningFeasibilityValidator`.
22. Travel time counted: Activity durations alone fit the day, but durations + travel exceed it → infeasible.
23. `requestedDays` exceeding natural clusters: the exact day-bucket count is still returned.
24. Insufficient candidates: requested 3 days with only 4 feasible candidates returns 3 days with partial utilization — no fabricated Activities.
25. Both generation entry paths: **N/A as originally scoped** — only the wizard path is integrated in this PR; add a test instead confirming `/tours/nearby`'s deprecated chain is untouched/unaffected by this change.
26. Old LLM day authority removed: integration test asserting generation no longer relies on LLM-returned day assignment as the source of truth.
27. Duration unit boundary: a stored-hours `Activity.duration` value is correctly converted to planning minutes (regression guard for finding #1's boundary, even though no live bug exists today).
28. Opening hours unknown: preserve and explicitly test the existing unknown-hours-is-not-closed policy.
29. Invalid spatial footprint: a candidate without a usable centroid/geometry gets a stable rejection, not a crash.
30. Deterministic repeatability: running the solver multiple times on the same fixture produces a deep-equal solution.

Plus, per the "Opening hours normalization" section: a simple single range, multiple ranges in one day, a fully closed day, a midnight-crossing range (if it occurs in real data), and unparseable/unknown text.

## Implementation sequence

1. Inspect current generation flow and existing candidate/domain types (done — see "Codebase audit findings" above).
2. Identify the canonical candidate shape produced by PR 9 (done — `RankableCandidate`/`RankedCandidate<T>` plus the full `Activity` row).
3. Introduce planning DTOs only where necessary.
4. Implement `SpatialFootprint` normalization.
5. Implement `TravelEstimateProvider`.
6. Implement `ApproximateTravelEstimateProvider`.
7. Implement the `DailyPlanningSolver` interface.
8. Implement `GreedyCapacitatedDailyPlanningSolver`.
9. Implement deterministic ordering/scheduling.
10. Implement bounded local improvement.
11. Implement `TourPlanningFeasibilityValidator`.
12. Integrate after PR 9 candidate acquisition/ranking, in the wizard path only.
13. Move completeness validation after planning.
14. Move requested-format-coverage validation after planning.
15. Persist the deterministic solution per the reconciled persistence approach (no schema changes).
16. Remove LLM day-planning authority from the wizard prompt/schema.
17. Delete `route-optimizer.util.ts` and its wizard call site (confirmed no other caller). Remove `travel-time-calculator.util.ts`'s wizard call site only, keep the file for `/tours/nearby`, and mark it legacy in-code.
18. Add observability/trace.
19. Add the 30+ deterministic tests above.
20. Run the existing test suite and fix regressions.

## Non-goals (restated)

No OR-Tools, no live traffic, no transit APIs, no turn-by-turn directions, no
map rendering, no LLM day planning, no discovery/PR8/PR9 redesign, no
food/meal architecture redesign, no `GeoFeature`, no provider-specific route
APIs, no dynamic real-time opening-hours fetching, no itinerary
narrative-generation redesign, no touching the Places cost-control work
(field mask, crawl-gate, quotas — already shipped separately), no
search/enrichment Places split, no Gemini/Groq discovery-extraction changes,
no SerpApi discovery changes, no hidden fallbacks, no LLM remaining a hidden
planner behind a new interface, and no migration of `/tours/nearby` (explicit
separate debt).

## Final architectural invariant

The final tour structure is decided by deterministic backend planning. PR 9
decides which canonical Activities are good candidates. PR 10 decides
whether and how those candidates can physically fit into the requested days.
Hard mobility, time, travel, and opening-hours constraints are backend
authority. Completeness and requested-format coverage evaluate the
physically planned itinerary. The LLM may explain the itinerary; it must
never determine its feasibility.
