# PR 10: Deterministic Daily Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the itinerary LLM's day-assignment/ordering/feasibility role in the wizard tour-generation path with a deterministic `GreedyDailyPlanningSolver` that consumes PR 9's ranked candidate pool directly and produces a feasible, mobility-aware, opening-hours-aware multi-day plan.

**Architecture:** A provider-neutral `DailyPlanningSolver` interface with one V1 implementation (`GreedyDailyPlanningSolver`) composed from four pure, independently-testable utils (deterministic sort/anchors, hard-constraint+soft-scoring placement, per-day ordering/scheduling, bounded local improvement), fed by a `PlanningCandidateNormalizerService` that converts PR 9's ranked `Activity` rows into `PlanningActivityCandidate[]`, using an `ApproximateTravelEstimateProvider` (Haversine + config speeds, always `approximate: true`) for all travel estimates. An independent `TourPlanningFeasibilityValidatorService` re-derives feasibility from the solution without trusting the solver. `TourActivityGenerationService`'s wizard path is rewired to call this pipeline instead of `runItinerarySelection()`'s LLM call, and completeness/format-coverage validation move to run on the planned output.

**Tech Stack:** NestJS, TypeScript, Prisma, Jest. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`

## Global Constraints

- Duration is minutes inside the planning layer; persisted `Activity.duration`/`TourActivity.duration` stay hours — convert exactly once at each boundary (spec "Duration unit").
- `TravelMode` in code is the existing `TransportationMode` enum (`WALKING`/`DRIVING`/`PUBLIC_TRANSPORT`/`CYCLING`) — never a new parallel enum.
- No OR-Tools, no external routing API (OSRM/Valhalla/GraphHopper/Google Routes/Mapbox/OpenRouteService), no live transit data, no LLM narrative generation, no schema migration, no touching `/tours/nearby` or its deprecated chain, no touching the Places field-mask/crawl-gate/quota work already shipped separately.
- Internal composite walking is computed in memory at normalization time; never derived from `Activity.duration`; represented as `undefined` (unknown) when too few waypoint coordinates resolve, with a conservative configurable policy fallback applied only where mobility constraints are actively checked.
- `TourActivity` gets no new Prisma columns. Planned minutes-from-midnight live only in the solution/trace; persisted `startTime` is only set when a real tour-start base date exists (`request.startDates[0]`), never invented.
- `generation-audit.util.ts` is not modified.
- `route-optimizer.util.ts` is deleted (confirmed single caller, the wizard path). `travel-time-calculator.util.ts` is kept (confirmed second caller in the deprecated `/tours/nearby` chain) — only its wizard call site is removed, and the file gets a legacy comment.
- The solver fully replaces `runItinerarySelection()`'s selection role in the wizard's critical path — the itinerary LLM call is removed from `TourActivityGenerationService.generateTourActivities()`'s feasibility-determining flow (confirmed decision, spec's "Core invariant" diagram).
- A composite's per-tour waypoint trimming (the old `selectedWaypointIds` the LLM used to return) is not reproduced by the solver — every composite is scheduled with its full current waypoint set. This is safe: the post-generation review screen (`app/tours/[id]/review.tsx`, outside this plan's scope) already lets the user exclude waypoints after generation.
- Per-activity `notes` text (previously LLM-authored) is not populated by this plan — no narrative generation is in scope. `TourActivity.notes` is `null` for solver-generated tours until a future narrative pass exists.

---

## File Structure

**New:**
- `be/src/modules/tours/interfaces/daily-planning.interface.ts` — all core planning types, tokens, and interfaces (`Coordinate`, `BoundingBox`, `SpatialFootprint`, `PlanningActivityCandidate`, `DailyPlanningWindow`, `DailyPlanningInput`, `PlannedActivity`, `PlannedDay`, `PlanningRejectionReason`, `UnselectedPlanningCandidate`, `DailyPlanningSolution`, `DailyPlanningSolver` + `DAILY_PLANNING_SOLVER` token, `TravelEstimate`, `TravelEstimateProvider` + `TRAVEL_ESTIMATE_PROVIDER` token, `PlanningFeasibilityIssue`, `PlanningFeasibilityResult`, `TourPlanningFeasibilityValidator` + token, `NormalizedOpeningHours` family).
- `be/src/modules/tours/config/daily-planning-policy.config.ts` — `DailyPlanningPolicy` + `registerAs('dailyPlanningPolicy', ...)`.
- `be/src/modules/tours/utils/normalized-opening-hours.util.ts` (+ `.spec.ts`) — `parseOpeningHours()`, `isOpenDuring()`.
- `be/src/modules/tours/utils/spatial-footprint.util.ts` (+ `.spec.ts`) — `buildPointFootprint()`, `footprintDistanceMeters()`.
- `be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts` (+ `.spec.ts`) — `sortCandidatesDeterministically()`, `selectDailyAnchors()`.
- `be/src/modules/tours/utils/daily-planning-placement.util.ts` (+ `.spec.ts`) — `placeCandidates()`, `checkHardConstraints()`, `scoreCandidateForDay()`, `DayAccumulator`, `PlacementContext`.
- `be/src/modules/tours/utils/daily-planning-ordering.util.ts` (+ `.spec.ts`) — `orderAndScheduleDay()`.
- `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts` (+ `.spec.ts`) — `runBoundedLocalImprovement()`.
- `be/src/modules/tours/services/approximate-travel-estimate.provider.ts` (+ `.spec.ts`) — `ApproximateTravelEstimateProvider`.
- `be/src/modules/tours/services/planning-candidate-normalizer.service.ts` (+ `.spec.ts`) — `PlanningCandidateNormalizerService`.
- `be/src/modules/tours/services/greedy-daily-planning.solver.ts` (+ `.spec.ts`) — `GreedyDailyPlanningSolver`.
- `be/src/modules/tours/services/tour-planning-feasibility-validator.service.ts` (+ `.spec.ts`) — `TourPlanningFeasibilityValidatorService`.

**Modified:**
- `be/src/core/config/config.module.ts` — register `dailyPlanningPolicyConfig`.
- `be/src/modules/tours/tours.module.ts` — register new providers + DI tokens.
- `be/src/modules/tours/utils/generation-trace-builder.util.ts` — add `buildDailyPlanningStep()`.
- `be/src/modules/tours/services/tour-activity-generation.service.ts` — replace the LLM-selection critical path with the solver pipeline; remove `optimizeActivityOrder`/wizard `updateTravelTimesForActivities` calls; persist from `DailyPlanningSolution`.
- `be/src/modules/tours/utils/travel-time-calculator.util.ts` — add a legacy/deprecated-path-only comment.

**Deleted:**
- `be/src/modules/tours/utils/route-optimizer.util.ts` + `route-optimizer.util.spec.ts`.

---

### Task 1: Core planning domain types

**Files:**
- Create: `be/src/modules/tours/interfaces/daily-planning.interface.ts`
- Test: `be/src/modules/tours/interfaces/daily-planning.interface.spec.ts`

**Interfaces:**
- Produces: every type/token listed under "New" above for this file — every later task imports from here.

- [ ] **Step 1: Write the failing smoke test**

Pure type files have no runtime behavior to fail-first on, so this "test" is a compile-and-construct smoke check — it fails today because the module doesn't exist yet.

```ts
// be/src/modules/tours/interfaces/daily-planning.interface.spec.ts
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  DailyPlanningSolution,
  PlanningActivityCandidate,
  NormalizedOpeningHours,
} from './daily-planning.interface';

describe('daily-planning.interface', () => {
  it('exposes string DI tokens', () => {
    expect(DAILY_PLANNING_SOLVER).toBe('DAILY_PLANNING_SOLVER');
    expect(TRAVEL_ESTIMATE_PROVIDER).toBe('TRAVEL_ESTIMATE_PROVIDER');
    expect(TOUR_PLANNING_FEASIBILITY_VALIDATOR).toBe(
      'TOUR_PLANNING_FEASIBILITY_VALIDATOR',
    );
  });

  it('constructs a valid PlanningActivityCandidate literal', () => {
    const candidate: PlanningActivityCandidate = {
      activityId: 'a1',
      kind: 'POI',
      title: 'Test',
      durationMinutes: 60,
      spatialFootprint: { type: 'POINT', centroid: { lat: 1, lng: 2 } },
      semanticScore: 0.5,
    };
    expect(candidate.durationMinutes).toBe(60);
  });

  it('constructs a valid unknown NormalizedOpeningHours', () => {
    const hours: NormalizedOpeningHours = { status: 'unknown' };
    expect(hours.status).toBe('unknown');
  });

  it('constructs a valid empty DailyPlanningSolution', () => {
    const solution: DailyPlanningSolution = {
      days: [],
      unselected: [],
      score: 0,
      metadata: { solver: 'test', approximateTravel: true },
    };
    expect(solution.days).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn jest src/modules/tours/interfaces/daily-planning.interface.spec.ts`
Expected: FAIL — `Cannot find module './daily-planning.interface'`

- [ ] **Step 3: Implement the types**

```ts
// be/src/modules/tours/interfaces/daily-planning.interface.ts
import { ActivityKind } from '@prisma/client';
import {
  ExperienceFormat,
  MobilityPreferences,
  TravelPace,
  TransportationMode,
} from './tour-generation.interface';
import { DestinationResolution } from '../services/destination-resolution.service';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type SimplifiedLineGeometry = Coordinate[];

export type SpatialFootprint =
  | { type: 'POINT'; centroid: Coordinate }
  | { type: 'AREA'; centroid: Coordinate; bounds?: BoundingBox }
  | {
      type: 'LINE';
      centroid: Coordinate;
      bounds?: BoundingBox;
      geometry?: SimplifiedLineGeometry;
    };

export interface NormalizedOpeningHoursRange {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}

export interface NormalizedOpeningHoursKnown {
  status: 'known';
  /** 0 = Sunday .. 6 = Saturday (JS Date#getDay()). A present key with an
   * empty array means genuinely closed that day; an absent key means no
   * parseable data for that specific day (treated as unknown, not closed). */
  rangesByWeekday: Record<number, NormalizedOpeningHoursRange[]>;
}

export interface NormalizedOpeningHoursUnknown {
  status: 'unknown';
}

export type NormalizedOpeningHours =
  | NormalizedOpeningHoursKnown
  | NormalizedOpeningHoursUnknown;

export interface PlanningActivityCandidate {
  activityId: string;
  kind: ActivityKind | 'POI';
  title: string;
  /** Minutes — converted once from the persisted hours value at the
   * normalization boundary. Never mixed with hours downstream. */
  durationMinutes: number;
  spatialFootprint: SpatialFootprint;
  openingHours?: NormalizedOpeningHours;
  semanticScore: number;
  qualityScore?: number;
  themes?: string[];
  formats?: ExperienceFormat[];
  areaId?: string;
  familyId?: string;
  variantKey?: string;
  mobility?: {
    /** undefined = unknown — never derived from durationMinutes. */
    internalWalkingMinutes?: number;
    internalWalkingDistanceMeters?: number;
    internalTravelMinutes?: number;
  };
  metadata?: {
    source?: string;
    rating?: number;
    userRatingCount?: number;
  };
}

export interface DailyPlanningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}

export interface DailyPlanningInput {
  destination: DestinationResolution;
  requestedDays: number;
  candidates: PlanningActivityCandidate[];
  mobility: MobilityPreferences;
  travelPace: TravelPace;
  planningWindow: DailyPlanningWindow;
  requestedFormats?: ExperienceFormat[];
  /** ISO date strings, in request order. Empty when the tour has no
   * confirmed start date — opening-hours weekday checks are then skipped
   * (unknown-day policy) rather than guessing a date. */
  startDates: string[];
}

export interface TravelEstimate {
  mode: TransportationMode;
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
}

export const TRAVEL_ESTIMATE_PROVIDER = 'TRAVEL_ESTIMATE_PROVIDER';

export interface TravelEstimateProvider {
  estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate>;
}

export interface PlannedActivity {
  activityId: string;
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  travelFromPrevious?: TravelEstimate;
}

export interface PlannedDay {
  dayNumber: number;
  activities: PlannedActivity[];
  totalActivityMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  utilizationMinutes: number;
}

export type PlanningRejectionReason =
  | 'DAILY_TIME_CAPACITY_EXCEEDED'
  | 'MAX_WALKING_PER_DAY_EXCEEDED'
  | 'MAX_CONTINUOUS_WALKING_EXCEEDED'
  | 'NO_ALLOWED_TRAVEL_MODE'
  | 'OPENING_HOURS_INCOMPATIBLE'
  | 'DUPLICATE_ACTIVITY'
  | 'INVALID_SPATIAL_FOOTPRINT'
  | 'INVALID_COMPOSITE'
  | 'NO_FEASIBLE_DAY'
  | 'LOWER_RANKED_THAN_SELECTED'
  | 'FORMAT_REDUNDANCY'
  | 'FAMILY_VARIANT_REDUNDANCY';

export interface UnselectedPlanningCandidate {
  activityId: string;
  reasons: PlanningRejectionReason[];
}

export interface DailyPlanningSolution {
  days: PlannedDay[];
  unselected: UnselectedPlanningCandidate[];
  score: number;
  metadata: {
    solver: string;
    approximateTravel: boolean;
    iterations?: number;
  };
}

export const DAILY_PLANNING_SOLVER = 'DAILY_PLANNING_SOLVER';

export interface DailyPlanningSolver {
  solve(input: DailyPlanningInput): Promise<DailyPlanningSolution>;
}

export interface PlanningFeasibilityIssue {
  code: string;
  message: string;
}

export interface PlanningFeasibilityResult {
  valid: boolean;
  issues: PlanningFeasibilityIssue[];
}

export const TOUR_PLANNING_FEASIBILITY_VALIDATOR =
  'TOUR_PLANNING_FEASIBILITY_VALIDATOR';

export interface TourPlanningFeasibilityValidator {
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn jest src/modules/tours/interfaces/daily-planning.interface.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd be && yarn typecheck`
Expected: no errors (confirms `DestinationResolution` and `tour-generation.interface.ts` imports resolve)

- [ ] **Step 6: Commit**

```bash
git add be/src/modules/tours/interfaces/daily-planning.interface.ts be/src/modules/tours/interfaces/daily-planning.interface.spec.ts
git commit -m "feat(tours): PR10 core daily-planning domain types"
```

---

### Task 2: `DailyPlanningPolicy` config

**Files:**
- Create: `be/src/modules/tours/config/daily-planning-policy.config.ts`
- Test: `be/src/modules/tours/config/daily-planning-policy.config.spec.ts`
- Modify: `be/src/core/config/config.module.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DailyPlanningPolicy` interface, `dailyPlanningPolicyConfig` default export (a `ConfigFactory`, `.KEY` usable via `@Inject(dailyPlanningPolicyConfig.KEY)`).

- [ ] **Step 1: Write the failing test**

```ts
// be/src/modules/tours/config/daily-planning-policy.config.spec.ts
import dailyPlanningPolicyConfig from './daily-planning-policy.config';

describe('dailyPlanningPolicyConfig', () => {
  afterEach(() => {
    delete process.env.DAILY_PLANNING_WALKING_SPEED_KMH;
  });

  it('provides sane defaults', () => {
    const policy = dailyPlanningPolicyConfig();
    expect(policy.travel.walkingSpeedKmh).toBeGreaterThan(0);
    expect(policy.travel.detourFactor).toBeGreaterThanOrEqual(1);
    expect(policy.paceTargets.fast.preferredActivitiesMax).toBeGreaterThan(
      policy.paceTargets.relaxed.preferredActivitiesMax,
    );
    expect(policy.localImprovement.maxIterations).toBeGreaterThan(0);
  });

  it('reads walking speed from env', () => {
    process.env.DAILY_PLANNING_WALKING_SPEED_KMH = '6';
    const policy = dailyPlanningPolicyConfig();
    expect(policy.travel.walkingSpeedKmh).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn jest src/modules/tours/config/daily-planning-policy.config.spec.ts`
Expected: FAIL — `Cannot find module './daily-planning-policy.config'`

- [ ] **Step 3: Implement the config**

```ts
// be/src/modules/tours/config/daily-planning-policy.config.ts
import { registerAs } from '@nestjs/config';

export interface DailyPlanningPolicy {
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
    /** Applied only when a composite's own internal-walking estimate is
     * unknown and mobility constraints are actively being checked. */
    unknownFallbackMinutes: number;
  };
  scoring: {
    semanticWeight: number;
    qualityWeight: number;
    formatWeight: number;
    familyVariantPenaltyWeight: number;
    dayBalanceWeight: number;
  };
  localImprovement: {
    maxIterations: number;
  };
  window: {
    startMinutesFromMidnight: number;
    endMinutesFromMidnight: number;
  };
}

export default registerAs(
  'dailyPlanningPolicy',
  (): DailyPlanningPolicy => ({
    paceTargets: {
      relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
      moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
      fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
    },
    travel: {
      detourFactor: Number(process.env.DAILY_PLANNING_DETOUR_FACTOR ?? 1.3),
      walkingSpeedKmh: Number(
        process.env.DAILY_PLANNING_WALKING_SPEED_KMH ?? 4.5,
      ),
      bikeSpeedKmh: Number(process.env.DAILY_PLANNING_BIKE_SPEED_KMH ?? 13),
      carUrbanSpeedKmh: Number(
        process.env.DAILY_PLANNING_CAR_URBAN_SPEED_KMH ?? 25,
      ),
    },
    internalWalking: {
      unknownFallbackMinutes: Number(
        process.env.DAILY_PLANNING_INTERNAL_WALKING_FALLBACK_MINUTES ?? 20,
      ),
    },
    scoring: {
      semanticWeight: 1,
      qualityWeight: 0.5,
      formatWeight: 0.75,
      familyVariantPenaltyWeight: 0.5,
      dayBalanceWeight: 0.25,
    },
    localImprovement: {
      maxIterations: Number(
        process.env.DAILY_PLANNING_LOCAL_IMPROVEMENT_MAX_ITERATIONS ?? 50,
      ),
    },
    window: {
      startMinutesFromMidnight: Number(
        process.env.DAILY_PLANNING_WINDOW_START_MINUTES ?? 9 * 60,
      ),
      endMinutesFromMidnight: Number(
        process.env.DAILY_PLANNING_WINDOW_END_MINUTES ?? 20 * 60,
      ),
    },
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn jest src/modules/tours/config/daily-planning-policy.config.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register in the global ConfigModule**

Modify `be/src/core/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { databaseConfig } from './database.config';
import { appConfig } from './app.config';
import aiConfig from '../../shared/ai/ai.config';
import authConfig from './auth.config';
import dailyPlanningPolicyConfig from '../../modules/tours/config/daily-planning-policy.config';
import * as path from 'path';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(__dirname, '../../..', '.env'),
        '.env',
      ],
      load: [
        appConfig,
        databaseConfig,
        aiConfig,
        authConfig,
        dailyPlanningPolicyConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
```

- [ ] **Step 6: Run full config test suite**

Run: `cd be && yarn jest src/core/config`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add be/src/modules/tours/config/daily-planning-policy.config.ts be/src/modules/tours/config/daily-planning-policy.config.spec.ts be/src/core/config/config.module.ts
git commit -m "feat(tours): PR10 daily-planning policy config"
```

---

### Task 3: Normalized opening-hours parser

**Files:**
- Create: `be/src/modules/tours/utils/normalized-opening-hours.util.ts`
- Test: `be/src/modules/tours/utils/normalized-opening-hours.util.spec.ts`

**Interfaces:**
- Consumes: `NormalizedOpeningHours`, `NormalizedOpeningHoursRange` (Task 1).
- Produces: `parseOpeningHours(weekdayText): NormalizedOpeningHours`, `isOpenDuring(hours, weekday, startMinutesFromMidnight, endMinutesFromMidnight): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/normalized-opening-hours.util.spec.ts
import { parseOpeningHours, isOpenDuring } from './normalized-opening-hours.util';

describe('parseOpeningHours', () => {
  it('parses a simple single range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[1]).toEqual([
        { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 },
      ]);
    }
  });

  it('parses multiple ranges on the same day', () => {
    const hours = parseOpeningHours([
      'Monday: 12:00 – 3:00 PM, 8:00 PM – 12:00 AM',
    ]);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[1]).toHaveLength(2);
      expect(hours.rangesByWeekday[1][0]).toEqual({
        startMinutesFromMidnight: 720,
        endMinutesFromMidnight: 900,
      });
      // "8:00 PM – 12:00 AM" ends exactly at midnight, same-day close.
      expect(hours.rangesByWeekday[1][1]).toEqual({
        startMinutesFromMidnight: 1200,
        endMinutesFromMidnight: 1440,
      });
    }
  });

  it('parses a fully closed day', () => {
    const hours = parseOpeningHours(['Sunday: Closed']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[0]).toEqual([]);
    }
  });

  it('splits a range crossing midnight across two weekdays', () => {
    const hours = parseOpeningHours(['Friday: 11:00 PM – 2:00 AM']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[5]).toEqual([
        { startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1440 },
      ]);
      expect(hours.rangesByWeekday[6]).toEqual([
        { startMinutesFromMidnight: 0, endMinutesFromMidnight: 120 },
      ]);
    }
  });

  it('returns unknown for unparseable text', () => {
    expect(parseOpeningHours(['garbled nonsense line'])).toEqual({
      status: 'unknown',
    });
  });

  it('returns unknown for missing input', () => {
    expect(parseOpeningHours(undefined)).toEqual({ status: 'unknown' });
    expect(parseOpeningHours([])).toEqual({ status: 'unknown' });
  });
});

describe('isOpenDuring', () => {
  it('treats unknown status as open (existing unknown-availability policy)', () => {
    expect(isOpenDuring({ status: 'unknown' }, 1, 600, 660)).toBe(true);
  });

  it('treats a missing weekday entry as open (no data for that day, not closed)', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 2, 600, 660)).toBe(true);
  });

  it('rejects a window outside the known range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 1, 480, 540)).toBe(false); // 8:00-9:00, before opening
  });

  it('accepts a window inside the known range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 1, 600, 660)).toBe(true);
  });

  it('rejects any window on a genuinely closed day', () => {
    const hours = parseOpeningHours(['Sunday: Closed']);
    expect(isOpenDuring(hours, 0, 600, 660)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/normalized-opening-hours.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

```ts
// be/src/modules/tours/utils/normalized-opening-hours.util.ts
import {
  NormalizedOpeningHours,
  NormalizedOpeningHoursRange,
} from '../interfaces/daily-planning.interface';

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const TIME_RANGE_12H =
  /(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/g;
const TIME_RANGE_24H = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/g;

function to12hMinutes(hourStr: string, minuteStr: string, meridiem: string): number {
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;
  return hour * 60 + parseInt(minuteStr, 10);
}

function to24hMinutes(hourStr: string, minuteStr: string): number {
  return parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
}

function parseDayLine(line: string): NormalizedOpeningHoursRange[] | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const rest = line.slice(colonIndex + 1).trim();
  if (/closed/i.test(rest)) return [];

  const ranges: NormalizedOpeningHoursRange[] = [];
  let match: RegExpExecArray | null;

  TIME_RANGE_12H.lastIndex = 0;
  while ((match = TIME_RANGE_12H.exec(rest)) !== null) {
    ranges.push({
      startMinutesFromMidnight: to12hMinutes(match[1], match[2], match[3]),
      endMinutesFromMidnight: to12hMinutes(match[4], match[5], match[6]),
    });
  }

  if (ranges.length === 0) {
    TIME_RANGE_24H.lastIndex = 0;
    while ((match = TIME_RANGE_24H.exec(rest)) !== null) {
      ranges.push({
        startMinutesFromMidnight: to24hMinutes(match[1], match[2]),
        endMinutesFromMidnight: to24hMinutes(match[3], match[4]),
      });
    }
  }

  return ranges.length > 0 ? ranges : null;
}

/** Google-style `weekdayText` → a real per-weekday structure. Unlike
 * generation-audit.util.ts's checkOpeningHours (which checks every range
 * against every day regardless of the tour's actual date), this maps each
 * range to its real weekday so day-aware hard-constraint checking is
 * possible. Scoped to the planner only — generation-audit.util.ts is not
 * touched or superseded. */
export function parseOpeningHours(
  weekdayText: string[] | null | undefined,
): NormalizedOpeningHours {
  if (!weekdayText || weekdayText.length === 0) {
    return { status: 'unknown' };
  }

  const rangesByWeekday: Record<number, NormalizedOpeningHoursRange[]> = {};
  let parsedAnyDay = false;

  for (const line of weekdayText) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const dayName = line.slice(0, colonIndex).trim().toLowerCase();
    const weekday = WEEKDAY_NAMES[dayName];
    if (weekday === undefined) continue;

    const parsed = parseDayLine(line);
    if (parsed === null) continue;
    parsedAnyDay = true;

    const sameDayRanges = rangesByWeekday[weekday] ?? [];
    for (const range of parsed) {
      if (range.endMinutesFromMidnight <= range.startMinutesFromMidnight) {
        // Crosses midnight: today gets [start, 24:00), tomorrow gets [00:00, end).
        sameDayRanges.push({
          startMinutesFromMidnight: range.startMinutesFromMidnight,
          endMinutesFromMidnight: 1440,
        });
        const nextWeekday = (weekday + 1) % 7;
        const nextDayRanges = rangesByWeekday[nextWeekday] ?? [];
        nextDayRanges.push({
          startMinutesFromMidnight: 0,
          endMinutesFromMidnight: range.endMinutesFromMidnight,
        });
        rangesByWeekday[nextWeekday] = nextDayRanges;
      } else {
        sameDayRanges.push(range);
      }
    }
    rangesByWeekday[weekday] = sameDayRanges;
  }

  if (!parsedAnyDay) {
    return { status: 'unknown' };
  }
  return { status: 'known', rangesByWeekday };
}

/** Unknown status, and a missing weekday key, both mean "no data" and are
 * never treated as closed — matches this domain's existing
 * unknown-availability policy. Only an explicitly empty range array (a real
 * parsed "Closed") rejects. */
export function isOpenDuring(
  hours: NormalizedOpeningHours,
  weekday: number,
  startMinutesFromMidnight: number,
  endMinutesFromMidnight: number,
): boolean {
  if (hours.status === 'unknown') return true;
  const ranges = hours.rangesByWeekday[weekday];
  if (ranges === undefined) return true;
  return ranges.some(
    (r) =>
      startMinutesFromMidnight >= r.startMinutesFromMidnight &&
      endMinutesFromMidnight <= r.endMinutesFromMidnight,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/normalized-opening-hours.util.spec.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/normalized-opening-hours.util.ts be/src/modules/tours/utils/normalized-opening-hours.util.spec.ts
git commit -m "feat(tours): PR10 normalized opening-hours parser"
```

---

### Task 4: Spatial footprint util

**Files:**
- Create: `be/src/modules/tours/utils/spatial-footprint.util.ts`
- Test: `be/src/modules/tours/utils/spatial-footprint.util.spec.ts`

**Interfaces:**
- Consumes: `SpatialFootprint`, `Coordinate` (Task 1); `calculateDistance` from `@shared/utils/distance.utils` (existing).
- Produces: `buildPointFootprint(lat, lng): SpatialFootprint`, `footprintDistanceMeters(a, b): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/spatial-footprint.util.spec.ts
import { buildPointFootprint, footprintDistanceMeters } from './spatial-footprint.util';

describe('buildPointFootprint', () => {
  it('builds a POINT footprint from lat/lng', () => {
    expect(buildPointFootprint(-34.6, -58.4)).toEqual({
      type: 'POINT',
      centroid: { lat: -34.6, lng: -58.4 },
    });
  });
});

describe('footprintDistanceMeters', () => {
  it('returns 0 for identical points', () => {
    const a = buildPointFootprint(-34.6, -58.4);
    expect(footprintDistanceMeters(a, a)).toBe(0);
  });

  it('returns a positive distance in meters for distinct points', () => {
    const a = buildPointFootprint(-34.6037, -58.3816); // Buenos Aires
    const b = buildPointFootprint(-34.6158, -58.3734); // ~1.4km away
    const distance = footprintDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/spatial-footprint.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/utils/spatial-footprint.util.ts
import { calculateDistance } from '@shared/utils/distance.utils';
import { SpatialFootprint } from '../interfaces/daily-planning.interface';

export function buildPointFootprint(lat: number, lng: number): SpatialFootprint {
  return { type: 'POINT', centroid: { lat, lng } };
}

export function footprintDistanceMeters(
  a: SpatialFootprint,
  b: SpatialFootprint,
): number {
  const km = calculateDistance(
    { latitude: a.centroid.lat, longitude: a.centroid.lng },
    { latitude: b.centroid.lat, longitude: b.centroid.lng },
  );
  return km * 1000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/spatial-footprint.util.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/spatial-footprint.util.ts be/src/modules/tours/utils/spatial-footprint.util.spec.ts
git commit -m "feat(tours): PR10 spatial footprint util"
```

---

### Task 5: `ApproximateTravelEstimateProvider`

**Files:**
- Create: `be/src/modules/tours/services/approximate-travel-estimate.provider.ts`
- Test: `be/src/modules/tours/services/approximate-travel-estimate.provider.spec.ts`

**Interfaces:**
- Consumes: `TravelEstimateProvider`, `TravelEstimate`, `SpatialFootprint` (Task 1); `DailyPlanningPolicy` (Task 2); `footprintDistanceMeters` (Task 4); `TransportationMode` (existing, `tour-generation.interface.ts`).
- Produces: `ApproximateTravelEstimateProvider` (injectable class implementing `TravelEstimateProvider`).

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/services/approximate-travel-estimate.provider.spec.ts
import { ApproximateTravelEstimateProvider } from './approximate-travel-estimate.provider';
import { buildPointFootprint } from '../utils/spatial-footprint.util';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

describe('ApproximateTravelEstimateProvider', () => {
  const policy: DailyPlanningPolicy = {
    paceTargets: {
      relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
      moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
      fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
    },
    travel: { detourFactor: 1.3, walkingSpeedKmh: 5, bikeSpeedKmh: 15, carUrbanSpeedKmh: 25 },
    internalWalking: { unknownFallbackMinutes: 20 },
    scoring: { semanticWeight: 1, qualityWeight: 0.5, formatWeight: 0.75, familyVariantPenaltyWeight: 0.5, dayBalanceWeight: 0.25 },
    localImprovement: { maxIterations: 50 },
    window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
  };
  const provider = new ApproximateTravelEstimateProvider(policy);
  const a = buildPointFootprint(-34.6037, -58.3816);
  const b = buildPointFootprint(-34.6158, -58.3734);

  it('always reports approximate: true', async () => {
    const estimate = await provider.estimate(a, b, [TransportationMode.WALKING]);
    expect(estimate.approximate).toBe(true);
  });

  it('prefers walking when allowed', async () => {
    const estimate = await provider.estimate(a, b, [
      TransportationMode.DRIVING,
      TransportationMode.WALKING,
    ]);
    expect(estimate.mode).toBe(TransportationMode.WALKING);
    expect(estimate.walkingMinutes).toBeGreaterThan(0);
  });

  it('uses the first allowed mode when walking is not allowed', async () => {
    const estimate = await provider.estimate(a, b, [TransportationMode.DRIVING]);
    expect(estimate.mode).toBe(TransportationMode.DRIVING);
    expect(estimate.walkingMinutes).toBe(0);
  });

  it('applies the detour factor to straight-line distance', async () => {
    const estimate = await provider.estimate(a, b, [TransportationMode.WALKING]);
    expect(estimate.distanceMeters).toBeGreaterThan(1000 * policy.travel.detourFactor);
  });

  it('throws when no allowed modes are given', async () => {
    await expect(provider.estimate(a, b, [])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/services/approximate-travel-estimate.provider.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/services/approximate-travel-estimate.provider.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { footprintDistanceMeters } from '../utils/spatial-footprint.util';

@Injectable()
export class ApproximateTravelEstimateProvider implements TravelEstimateProvider {
  constructor(
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate> {
    if (allowedModes.length === 0) {
      throw new Error(
        'ApproximateTravelEstimateProvider.estimate called with no allowed transportation modes',
      );
    }

    const distanceMeters =
      footprintDistanceMeters(from, to) * this.policy.travel.detourFactor;
    const mode = this.pickMode(allowedModes);
    const speedKmh = this.speedForMode(mode);
    const durationMinutes =
      speedKmh > 0 ? (distanceMeters / 1000 / speedKmh) * 60 : 0;
    const isWalking = mode === TransportationMode.WALKING;

    return {
      mode,
      durationMinutes,
      distanceMeters,
      walkingMinutes: isWalking ? durationMinutes : 0,
      walkingDistanceMeters: isWalking ? distanceMeters : 0,
      approximate: true,
    };
  }

  private pickMode(allowedModes: TransportationMode[]): TransportationMode {
    // Prefer walking when allowed — matches the product default of a
    // walkable tour; otherwise use the first allowed mode deterministically.
    if (allowedModes.includes(TransportationMode.WALKING)) {
      return TransportationMode.WALKING;
    }
    return allowedModes[0];
  }

  private speedForMode(mode: TransportationMode): number {
    switch (mode) {
      case TransportationMode.WALKING:
        return this.policy.travel.walkingSpeedKmh;
      case TransportationMode.CYCLING:
        return this.policy.travel.bikeSpeedKmh;
      case TransportationMode.DRIVING:
        return this.policy.travel.carUrbanSpeedKmh;
      case TransportationMode.PUBLIC_TRANSPORT:
        // No real transit routing in V1 — a conservative urban-driving-speed
        // proxy, per the spec's explicit non-goal on transit APIs.
        return this.policy.travel.carUrbanSpeedKmh;
      default:
        return this.policy.travel.walkingSpeedKmh;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/services/approximate-travel-estimate.provider.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/approximate-travel-estimate.provider.ts be/src/modules/tours/services/approximate-travel-estimate.provider.spec.ts
git commit -m "feat(tours): PR10 ApproximateTravelEstimateProvider"
```

---

### Task 6: Deterministic candidate sort + anchor selection

**Files:**
- Create: `be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts`
- Test: `be/src/modules/tours/utils/daily-planning-candidate-sort.util.spec.ts`

**Interfaces:**
- Consumes: `PlanningActivityCandidate` (Task 1).
- Produces: `sortCandidatesDeterministically(candidates): PlanningActivityCandidate[]`, `selectDailyAnchors(sortedCandidates, requestedDays): PlanningActivityCandidate[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/daily-planning-candidate-sort.util.spec.ts
import {
  sortCandidatesDeterministically,
  selectDailyAnchors,
} from './daily-planning-candidate-sort.util';
import { PlanningActivityCandidate } from '../interfaces/daily-planning.interface';

function candidate(
  id: string,
  semanticScore: number,
  qualityScore?: number,
): PlanningActivityCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
    semanticScore,
    qualityScore,
  };
}

describe('sortCandidatesDeterministically', () => {
  it('sorts by semantic score descending', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('low', 0.2),
      candidate('high', 0.9),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual(['high', 'low']);
  });

  it('breaks a semantic tie by quality score descending', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('low-quality', 0.5, 1),
      candidate('high-quality', 0.5, 4),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual([
      'high-quality',
      'low-quality',
    ]);
  });

  it('breaks a full tie by activityId lexical ascending, stably', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('b', 0.5, 1),
      candidate('a', 0.5, 1),
    ]);
    expect(sorted.map((c) => c.activityId)).toEqual(['a', 'b']);
  });

  it('never treats an undefined qualityScore as worse than 0', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('zero-quality', 0.5, 0),
      candidate('unknown-quality', 0.5, undefined),
    ]);
    // unknown (0 fallback) ties with an explicit 0 — falls through to the
    // lexical tie-break, not an implicit penalty below the explicit 0.
    expect(sorted.map((c) => c.activityId)).toEqual([
      'unknown-quality',
      'zero-quality',
    ]);
  });
});

describe('selectDailyAnchors', () => {
  it('picks the top N sorted candidates as anchors, one per day', () => {
    const sorted = [candidate('a', 0.9), candidate('b', 0.8), candidate('c', 0.7)];
    expect(selectDailyAnchors(sorted, 2).map((c) => c.activityId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns fewer anchors than requested when candidates run out', () => {
    const sorted = [candidate('a', 0.9)];
    expect(selectDailyAnchors(sorted, 3)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-candidate-sort.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts
import { PlanningActivityCandidate } from '../interfaces/daily-planning.interface';

/** Deterministic initial ordering used to drive anchor seeding and the
 * greedy placement loop. Only semantic/quality/lexical signals — requested-
 * format relevance, geographic compactness, and redundancy are handled by
 * the day-placement soft score (daily-planning-placement.util.ts) and local
 * improvement, not duplicated here. Never depends on DB result order or
 * object iteration order. */
export function sortCandidatesDeterministically(
  candidates: PlanningActivityCandidate[],
): PlanningActivityCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.semanticScore !== a.semanticScore) {
      return b.semanticScore - a.semanticScore;
    }
    const aQuality = a.qualityScore ?? 0;
    const bQuality = b.qualityScore ?? 0;
    if (bQuality !== aQuality) {
      return bQuality - aQuality;
    }
    return a.activityId.localeCompare(b.activityId);
  });
}

/** Seeds each requested day with one strong, deterministic anchor so top
 * candidates don't all land on day 1. V1: the top `requestedDays` candidates
 * from the stable sort, one per day in order. No complex optimizer. */
export function selectDailyAnchors(
  sortedCandidates: PlanningActivityCandidate[],
  requestedDays: number,
): PlanningActivityCandidate[] {
  return sortedCandidates.slice(0, requestedDays);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-candidate-sort.util.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts be/src/modules/tours/utils/daily-planning-candidate-sort.util.spec.ts
git commit -m "feat(tours): PR10 deterministic candidate sort and anchor selection"
```

---

### Task 7: Hard-constraint checking + soft-scoring day placement

**Files:**
- Create: `be/src/modules/tours/utils/daily-planning-placement.util.ts`
- Test: `be/src/modules/tours/utils/daily-planning-placement.util.spec.ts`

**Interfaces:**
- Consumes: `PlanningActivityCandidate`, `PlanningRejectionReason`, `UnselectedPlanningCandidate`, `DailyPlanningWindow`, `TravelEstimateProvider` (Task 1); `DailyPlanningPolicy` (Task 2); `MobilityPreferences`, `ExperienceFormat`, `TransportationMode` (existing); `isOpenDuring` (Task 3).
- Produces: `DayAccumulator`, `PlacementContext` interfaces; `placeCandidates(sortedCandidates, requestedDays, context): Promise<{ days: Map<number, DayAccumulator>; unselected: UnselectedPlanningCandidate[] }>`; `checkHardConstraints(candidate, acc, context): Promise<{ feasible: boolean; reasons: PlanningRejectionReason[] }>` (also consumed directly by Task 9's local improvement); `scoreCandidateForDay(candidate, acc, context): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/daily-planning-placement.util.spec.ts
import {
  placeCandidates,
  checkHardConstraints,
  scoreCandidateForDay,
  DayAccumulator,
  PlacementContext,
} from './daily-planning-placement.util';
import { PlanningActivityCandidate, TravelEstimateProvider } from '../interfaces/daily-planning.interface';
import { TransportationMode, ExperienceFormat } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function candidate(overrides: Partial<PlanningActivityCandidate> = {}): PlanningActivityCandidate {
  return {
    activityId: overrides.activityId ?? 'a1',
    kind: 'POI',
    title: 'Test',
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
    semanticScore: 0.5,
    ...overrides,
  };
}

function fakeTravelEstimateProvider(
  overrides: Partial<Awaited<ReturnType<TravelEstimateProvider['estimate']>>> = {},
): TravelEstimateProvider {
  return {
    estimate: jest.fn().mockResolvedValue({
      mode: TransportationMode.WALKING,
      durationMinutes: 10,
      distanceMeters: 800,
      walkingMinutes: 10,
      walkingDistanceMeters: 800,
      approximate: true,
      ...overrides,
    }),
  };
}

const policy: DailyPlanningPolicy = {
  paceTargets: {
    relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
    moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
    fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
  },
  travel: { detourFactor: 1.3, walkingSpeedKmh: 5, bikeSpeedKmh: 15, carUrbanSpeedKmh: 25 },
  internalWalking: { unknownFallbackMinutes: 20 },
  scoring: { semanticWeight: 1, qualityWeight: 0.5, formatWeight: 0.75, familyVariantPenaltyWeight: 0.5, dayBalanceWeight: 0.25 },
  localImprovement: { maxIterations: 50 },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 }, // 9:00-20:00, 660 min/day
};

function baseContext(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    policy,
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate' as any,
      accessibilityNeeds: [],
    },
    planningWindow: policy.window,
    requestedFormats: [],
    travelEstimateProvider: fakeTravelEstimateProvider(),
    startDates: [],
    ...overrides,
  };
}

function emptyDay(dayNumber: number): DayAccumulator {
  return { dayNumber, assigned: [], totalActivityMinutes: 0, totalWalkingMeters: 0 };
}

describe('checkHardConstraints', () => {
  it('accepts a candidate that fits comfortably in an empty day', async () => {
    const result = await checkHardConstraints(candidate(), emptyDay(1), baseContext());
    expect(result.feasible).toBe(true);
  });

  it('rejects a candidate that exceeds the daily time capacity', async () => {
    const acc: DayAccumulator = { dayNumber: 1, assigned: [], totalActivityMinutes: 650, totalWalkingMeters: 0 };
    const result = await checkHardConstraints(candidate({ durationMinutes: 60 }), acc, baseContext());
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('DAILY_TIME_CAPACITY_EXCEEDED');
  });

  it('rejects when the day already has an assigned activity and the leg exceeds max continuous walking', async () => {
    const context = baseContext({
      mobility: {
        allowedTransportationModes: [TransportationMode.WALKING],
        maxWalkingDistancePerDayMeters: 10000,
        maxContinuousWalkingDistanceMeters: 500,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      travelEstimateProvider: fakeTravelEstimateProvider({ walkingDistanceMeters: 800 }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'prev' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const result = await checkHardConstraints(candidate({ activityId: 'next' }), acc, context);
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_CONTINUOUS_WALKING_EXCEEDED');
  });

  it('rejects when total daily walking would exceed the limit', async () => {
    const context = baseContext({
      mobility: {
        allowedTransportationModes: [TransportationMode.WALKING],
        maxWalkingDistancePerDayMeters: 500,
        maxContinuousWalkingDistanceMeters: 3000,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      travelEstimateProvider: fakeTravelEstimateProvider({ walkingDistanceMeters: 800 }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'prev' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const result = await checkHardConstraints(candidate({ activityId: 'next' }), acc, context);
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_WALKING_PER_DAY_EXCEEDED');
  });

  it('rejects a candidate outside its known opening hours when a base date exists', async () => {
    const context = baseContext({ startDates: ['2026-09-07'] }); // a real Monday
    const result = await checkHardConstraints(
      candidate({
        openingHours: {
          status: 'known',
          rangesByWeekday: { 1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 }] }, // 10:00-11:00 Monday only
        },
      }),
      emptyDay(1), // day starts at window start, 9:00 — before the 10:00 opening
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('OPENING_HOURS_INCOMPATIBLE');
  });

  it('does not hard-reject on opening hours when no base date exists (unknown weekday policy)', async () => {
    const result = await checkHardConstraints(
      candidate({
        openingHours: {
          status: 'known',
          rangesByWeekday: { 1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 }] },
        },
      }),
      emptyDay(1),
      baseContext({ startDates: [] }),
    );
    expect(result.reasons).not.toContain('OPENING_HOURS_INCOMPATIBLE');
  });
});

describe('scoreCandidateForDay', () => {
  it('never penalizes an undefined qualityScore relative to an explicit 0', () => {
    const scoreUnknown = scoreCandidateForDay(candidate({ qualityScore: undefined }), emptyDay(1), baseContext());
    const scoreZero = scoreCandidateForDay(candidate({ qualityScore: 0 }), emptyDay(1), baseContext());
    expect(scoreUnknown).toBe(scoreZero);
  });

  it('rewards a candidate matching a requested format', () => {
    const context = baseContext({ requestedFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS] });
    const withFormat = scoreCandidateForDay(
      candidate({ formats: [ExperienceFormat.NEIGHBORHOOD_WALKS] }),
      emptyDay(1),
      context,
    );
    const withoutFormat = scoreCandidateForDay(candidate({ formats: [] }), emptyDay(1), context);
    expect(withFormat).toBeGreaterThan(withoutFormat);
  });

  it('penalizes a same-family candidate already assigned that day', () => {
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'existing', familyId: 'fam-1' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const sameFamily = scoreCandidateForDay(candidate({ familyId: 'fam-1' }), acc, baseContext());
    const differentFamily = scoreCandidateForDay(candidate({ familyId: 'fam-2' }), acc, baseContext());
    expect(sameFamily).toBeLessThan(differentFamily);
  });
});

describe('placeCandidates', () => {
  it('places every hard-feasible candidate somewhere across the requested days', async () => {
    const { days, unselected } = await placeCandidates(
      [candidate({ activityId: 'a' }), candidate({ activityId: 'b' })],
      2,
      baseContext(),
    );
    const totalAssigned = Array.from(days.values()).reduce((sum, d) => sum + d.assigned.length, 0);
    expect(totalAssigned).toBe(2);
    expect(unselected).toHaveLength(0);
  });

  it('marks a duplicate activityId as unselected with DUPLICATE_ACTIVITY', async () => {
    const { unselected } = await placeCandidates(
      [candidate({ activityId: 'dup' }), candidate({ activityId: 'dup' })],
      1,
      baseContext(),
    );
    expect(unselected).toEqual([{ activityId: 'dup', reasons: ['DUPLICATE_ACTIVITY'] }]);
  });

  it('rejects with NO_FEASIBLE_DAY when requestedDays is 0', async () => {
    const { unselected } = await placeCandidates([candidate()], 0, baseContext());
    expect(unselected[0].reasons).toContain('NO_FEASIBLE_DAY');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-placement.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/utils/daily-planning-placement.util.ts
import {
  DailyPlanningWindow,
  PlanningActivityCandidate,
  PlanningRejectionReason,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import {
  ExperienceFormat,
  MobilityPreferences,
  TransportationMode,
} from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { isOpenDuring } from './normalized-opening-hours.util';

export interface DayAccumulator {
  dayNumber: number;
  assigned: PlanningActivityCandidate[];
  totalActivityMinutes: number;
  totalWalkingMeters: number;
}

export interface PlacementContext {
  policy: DailyPlanningPolicy;
  mobility: MobilityPreferences;
  planningWindow: DailyPlanningWindow;
  requestedFormats: ExperienceFormat[];
  travelEstimateProvider: TravelEstimateProvider;
  /** ISO date strings — empty means no confirmed base date, so weekday-
   * specific opening-hours checks are skipped rather than guessed. */
  startDates: string[];
}

function isCompositeKind(kind: PlanningActivityCandidate['kind']): boolean {
  return kind === 'NEIGHBORHOOD_WALK' || kind === 'ROUTE' || kind === 'EXPERIENCE';
}

function resolveWeekday(startDates: string[], dayNumber: number): number | undefined {
  if (startDates.length === 0) return undefined;
  const base = new Date(startDates[0]);
  if (Number.isNaN(base.getTime())) return undefined;
  const target = new Date(base);
  target.setDate(base.getDate() + (dayNumber - 1));
  return target.getDay();
}

function internalWalkingMeters(
  candidate: PlanningActivityCandidate,
  policy: DailyPlanningPolicy,
): number {
  if (candidate.mobility?.internalWalkingDistanceMeters !== undefined) {
    return candidate.mobility.internalWalkingDistanceMeters;
  }
  if (isCompositeKind(candidate.kind)) {
    // Unknown internal walking on a composite: apply the explicit,
    // configurable conservative V1 fallback — never derived from duration.
    return (policy.internalWalking.unknownFallbackMinutes * policy.travel.walkingSpeedKmh * 1000) / 60;
  }
  return 0;
}

export async function checkHardConstraints(
  candidate: PlanningActivityCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): Promise<{ feasible: boolean; reasons: PlanningRejectionReason[] }> {
  const reasons: PlanningRejectionReason[] = [];

  if (
    candidate.spatialFootprint.centroid.lat === undefined ||
    candidate.spatialFootprint.centroid.lng === undefined ||
    Number.isNaN(candidate.spatialFootprint.centroid.lat) ||
    Number.isNaN(candidate.spatialFootprint.centroid.lng)
  ) {
    return { feasible: false, reasons: ['INVALID_SPATIAL_FOOTPRINT'] };
  }

  const previous = acc.assigned[acc.assigned.length - 1];
  const travel = previous
    ? await context.travelEstimateProvider.estimate(
        previous.spatialFootprint,
        candidate.spatialFootprint,
        context.mobility.allowedTransportationModes,
      )
    : null;

  if (travel && !context.mobility.allowedTransportationModes.includes(travel.mode)) {
    reasons.push('NO_ALLOWED_TRAVEL_MODE');
  }

  const dayWindowMinutes =
    context.planningWindow.endMinutesFromMidnight - context.planningWindow.startMinutesFromMidnight;
  const projectedActivityMinutes =
    acc.totalActivityMinutes +
    candidate.durationMinutes +
    (candidate.mobility?.internalTravelMinutes ?? 0) +
    (travel?.durationMinutes ?? 0);
  if (projectedActivityMinutes > dayWindowMinutes) {
    reasons.push('DAILY_TIME_CAPACITY_EXCEEDED');
  }

  const legWalkingMeters = travel?.walkingDistanceMeters ?? 0;
  const candidateInternalWalkingMeters = internalWalkingMeters(candidate, context.policy);
  const projectedWalkingMeters =
    acc.totalWalkingMeters + candidateInternalWalkingMeters + legWalkingMeters;
  if (
    context.mobility.allowedTransportationModes.includes(TransportationMode.WALKING) &&
    projectedWalkingMeters > context.mobility.maxWalkingDistancePerDayMeters
  ) {
    reasons.push('MAX_WALKING_PER_DAY_EXCEEDED');
  }
  // V1 treats one inter-Activity leg as one continuous segment (documented
  // approximation — see the spec's "internal walking, reconciled" section).
  if (legWalkingMeters > context.mobility.maxContinuousWalkingDistanceMeters) {
    reasons.push('MAX_CONTINUOUS_WALKING_EXCEEDED');
  }

  if (candidate.openingHours) {
    const weekday = resolveWeekday(context.startDates, acc.dayNumber);
    if (weekday !== undefined) {
      const proposedStart = context.planningWindow.startMinutesFromMidnight + acc.totalActivityMinutes;
      const proposedEnd = proposedStart + candidate.durationMinutes;
      if (!isOpenDuring(candidate.openingHours, weekday, proposedStart, proposedEnd)) {
        reasons.push('OPENING_HOURS_INCOMPATIBLE');
      }
    }
    // No confirmed base date: cannot evaluate a weekday-specific window —
    // treated as unknown, same policy as missing opening-hours data.
  }

  return { feasible: reasons.length === 0, reasons };
}

export function scoreCandidateForDay(
  candidate: PlanningActivityCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): number {
  const { scoring } = context.policy;
  const semantic = scoring.semanticWeight * candidate.semanticScore;
  // Unknown quality contributes 0, never a penalty relative to an explicit 0.
  const quality = scoring.qualityWeight * (candidate.qualityScore ?? 0);
  const formatBonus =
    candidate.formats?.some((f) => context.requestedFormats.includes(f))
      ? scoring.formatWeight
      : 0;
  const dayBalanceBonus = scoring.dayBalanceWeight * (1 / (acc.assigned.length + 1));
  const familyPenalty =
    candidate.familyId && acc.assigned.some((a) => a.familyId === candidate.familyId)
      ? scoring.familyVariantPenaltyWeight
      : 0;
  return semantic + quality + formatBonus + dayBalanceBonus - familyPenalty;
}

export async function placeCandidates(
  sortedCandidates: PlanningActivityCandidate[],
  requestedDays: number,
  context: PlacementContext,
): Promise<{ days: Map<number, DayAccumulator>; unselected: UnselectedPlanningCandidate[] }> {
  const days = new Map<number, DayAccumulator>();
  for (let d = 1; d <= requestedDays; d++) {
    days.set(d, { dayNumber: d, assigned: [], totalActivityMinutes: 0, totalWalkingMeters: 0 });
  }

  const placedIds = new Set<string>();
  const unselected: UnselectedPlanningCandidate[] = [];

  for (const candidate of sortedCandidates) {
    if (placedIds.has(candidate.activityId)) {
      unselected.push({ activityId: candidate.activityId, reasons: ['DUPLICATE_ACTIVITY'] });
      continue;
    }

    let bestDay: number | null = null;
    let bestScore = -Infinity;
    const dayFailureReasons = new Set<PlanningRejectionReason>();

    for (const [dayNumber, acc] of days) {
      const feasibility = await checkHardConstraints(candidate, acc, context);
      if (!feasibility.feasible) {
        feasibility.reasons.forEach((r) => dayFailureReasons.add(r));
        continue;
      }
      const score = scoreCandidateForDay(candidate, acc, context);
      if (score > bestScore) {
        bestScore = score;
        bestDay = dayNumber;
      }
    }

    if (bestDay === null) {
      unselected.push({
        activityId: candidate.activityId,
        reasons: dayFailureReasons.size > 0 ? Array.from(dayFailureReasons) : ['NO_FEASIBLE_DAY'],
      });
      continue;
    }

    const acc = days.get(bestDay)!;
    const previous = acc.assigned[acc.assigned.length - 1];
    const travel = previous
      ? await context.travelEstimateProvider.estimate(
          previous.spatialFootprint,
          candidate.spatialFootprint,
          context.mobility.allowedTransportationModes,
        )
      : null;

    acc.assigned.push(candidate);
    acc.totalActivityMinutes +=
      candidate.durationMinutes + (candidate.mobility?.internalTravelMinutes ?? 0) + (travel?.durationMinutes ?? 0);
    acc.totalWalkingMeters += internalWalkingMeters(candidate, context.policy) + (travel?.walkingDistanceMeters ?? 0);
    placedIds.add(candidate.activityId);
  }

  return { days, unselected };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-placement.util.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/daily-planning-placement.util.ts be/src/modules/tours/utils/daily-planning-placement.util.spec.ts
git commit -m "feat(tours): PR10 hard-constraint checking and soft-scoring day placement"
```

---

### Task 8: Within-day ordering and time-window scheduling

**Files:**
- Create: `be/src/modules/tours/utils/daily-planning-ordering.util.ts`
- Test: `be/src/modules/tours/utils/daily-planning-ordering.util.spec.ts`

**Interfaces:**
- Consumes: `PlanningActivityCandidate`, `PlannedDay`, `PlannedActivity`, `TravelEstimateProvider`, `DailyPlanningWindow` (Task 1); `sortCandidatesDeterministically` (Task 6); `footprintDistanceMeters` (Task 4); `TransportationMode` (existing).
- Produces: `OrderingContext` interface; `orderAndScheduleDay(dayNumber, candidates, context): Promise<PlannedDay>`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/daily-planning-ordering.util.spec.ts
import { orderAndScheduleDay, OrderingContext } from './daily-planning-ordering.util';
import { PlanningActivityCandidate, TravelEstimateProvider } from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';

function candidate(id: string, lat: number, lng: number, durationMinutes = 60): PlanningActivityCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes,
    spatialFootprint: { type: 'POINT', centroid: { lat, lng } },
    semanticScore: 0.5,
  };
}

function realTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn(async (from, to) => {
      const dLat = to.centroid.lat - from.centroid.lat;
      const dLng = to.centroid.lng - from.centroid.lng;
      const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000; // rough degrees-to-meters
      return {
        mode: TransportationMode.WALKING,
        durationMinutes: (distanceMeters / 1000 / 4.5) * 60,
        distanceMeters,
        walkingMinutes: (distanceMeters / 1000 / 4.5) * 60,
        walkingDistanceMeters: distanceMeters,
        approximate: true,
      };
    }),
  };
}

function context(): OrderingContext {
  return {
    travelEstimateProvider: realTravelEstimateProvider(),
    planningWindow: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
    allowedTransportationModes: [TransportationMode.WALKING],
  };
}

describe('orderAndScheduleDay', () => {
  it('returns an empty PlannedDay for no candidates', async () => {
    const day = await orderAndScheduleDay(1, [], context());
    expect(day.activities).toEqual([]);
    expect(day.dayNumber).toBe(1);
  });

  it('schedules a single candidate starting at the planning window start', async () => {
    const day = await orderAndScheduleDay(1, [candidate('a', 0, 0)], context());
    expect(day.activities[0].startMinutesFromMidnight).toBe(540);
    expect(day.activities[0].endMinutesFromMidnight).toBe(600);
    expect(day.activities[0].travelFromPrevious).toBeUndefined();
  });

  it('orders by nearest-neighbor from the previous stop', async () => {
    // start at (0,0); (0,0.001) is much closer than (0,1)
    const day = await orderAndScheduleDay(
      1,
      [candidate('near', 0, 0.001), candidate('far', 0, 1), candidate('start', 0, 0)],
      context(),
    );
    expect(day.activities.map((a) => a.activityId)).toEqual(['start', 'near', 'far']);
  });

  it('accumulates travel time between consecutive activities', async () => {
    const day = await orderAndScheduleDay(1, [candidate('a', 0, 0), candidate('b', 0, 0.01)], context());
    expect(day.totalTravelMinutes).toBeGreaterThan(0);
    expect(day.activities[1].travelFromPrevious).toBeDefined();
    expect(day.activities[1].startMinutesFromMidnight).toBeGreaterThan(
      day.activities[0].endMinutesFromMidnight,
    );
  });

  it('reports total activity minutes independent of travel time', async () => {
    const day = await orderAndScheduleDay(1, [candidate('a', 0, 0, 60), candidate('b', 0, 0.01, 90)], context());
    expect(day.totalActivityMinutes).toBe(150);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-ordering.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/utils/daily-planning-ordering.util.ts
import {
  DailyPlanningWindow,
  PlannedActivity,
  PlannedDay,
  PlanningActivityCandidate,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { sortCandidatesDeterministically } from './daily-planning-candidate-sort.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

export interface OrderingContext {
  travelEstimateProvider: TravelEstimateProvider;
  planningWindow: DailyPlanningWindow;
  allowedTransportationModes: TransportationMode[];
}

function pickNearest(
  from: PlanningActivityCandidate,
  candidates: PlanningActivityCandidate[],
): PlanningActivityCandidate {
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = footprintDistanceMeters(from.spatialFootprint, candidate.spatialFootprint);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Orders one day's already-assigned candidates and turns them into a
 * scheduled PlannedDay. Deterministic-sort start point, then nearest-
 * neighbor for the rest — matches the spec's "opening-hours-constrained
 * first, otherwise nearest feasible" heuristic in its simplified V1 form;
 * genuine opening-hours re-validation after reordering is the independent
 * TourPlanningFeasibilityValidator's job (Task 11), not duplicated here. */
export async function orderAndScheduleDay(
  dayNumber: number,
  candidates: PlanningActivityCandidate[],
  context: OrderingContext,
): Promise<PlannedDay> {
  if (candidates.length === 0) {
    return {
      dayNumber,
      activities: [],
      totalActivityMinutes: 0,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 0,
    };
  }

  const remaining = sortCandidatesDeterministically(candidates);
  const scheduled: PlannedActivity[] = [];
  let cursorMinutes = context.planningWindow.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let previous: PlanningActivityCandidate | null = null;

  while (remaining.length > 0) {
    const next = previous ? pickNearest(previous, remaining) : remaining[0];
    remaining.splice(remaining.indexOf(next), 1);

    let travel: TravelEstimate | undefined;
    if (previous) {
      travel = await context.travelEstimateProvider.estimate(
        previous.spatialFootprint,
        next.spatialFootprint,
        context.allowedTransportationModes,
      );
      cursorMinutes += travel.durationMinutes;
      totalTravelMinutes += travel.durationMinutes;
      totalWalkingMinutes += travel.walkingMinutes;
    }

    const start = cursorMinutes;
    const end = start + next.durationMinutes + (next.mobility?.internalTravelMinutes ?? 0);
    scheduled.push({
      activityId: next.activityId,
      startMinutesFromMidnight: start,
      endMinutesFromMidnight: end,
      travelFromPrevious: travel,
    });
    totalWalkingMinutes += next.mobility?.internalWalkingMinutes ?? 0;
    cursorMinutes = end;
    previous = next;
  }

  const totalActivityMinutes = candidates.reduce((sum, c) => sum + c.durationMinutes, 0);

  return {
    dayNumber,
    activities: scheduled,
    totalActivityMinutes,
    totalTravelMinutes,
    totalWalkingMinutes,
    utilizationMinutes: cursorMinutes - context.planningWindow.startMinutesFromMidnight,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-ordering.util.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/daily-planning-ordering.util.ts be/src/modules/tours/utils/daily-planning-ordering.util.spec.ts
git commit -m "feat(tours): PR10 within-day ordering and time-window scheduling"
```

---

### Task 9: Bounded local improvement

**Files:**
- Create: `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts`
- Test: `be/src/modules/tours/utils/daily-planning-local-improvement.util.spec.ts`

**Interfaces:**
- Consumes: `DayAccumulator`, `PlacementContext`, `checkHardConstraints` (Task 7); `footprintDistanceMeters` (Task 4); `Coordinate`, `PlanningActivityCandidate` (Task 1).
- Produces: `runBoundedLocalImprovement(days, context): Promise<{ days: Map<number, DayAccumulator>; iterations: number }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/utils/daily-planning-local-improvement.util.spec.ts
import { runBoundedLocalImprovement } from './daily-planning-local-improvement.util';
import { DayAccumulator, PlacementContext } from './daily-planning-placement.util';
import { PlanningActivityCandidate, TravelEstimateProvider } from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function candidate(id: string, lat: number, lng: number, familyId?: string): PlanningActivityCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat, lng } },
    semanticScore: 0.5,
    familyId,
  };
}

function stubTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn().mockResolvedValue({
      mode: TransportationMode.WALKING,
      durationMinutes: 5,
      distanceMeters: 300,
      walkingMinutes: 5,
      walkingDistanceMeters: 300,
      approximate: true,
    }),
  };
}

const policy: DailyPlanningPolicy = {
  paceTargets: {
    relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
    moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
    fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
  },
  travel: { detourFactor: 1.3, walkingSpeedKmh: 5, bikeSpeedKmh: 15, carUrbanSpeedKmh: 25 },
  internalWalking: { unknownFallbackMinutes: 20 },
  scoring: { semanticWeight: 1, qualityWeight: 0.5, formatWeight: 0.75, familyVariantPenaltyWeight: 0.5, dayBalanceWeight: 0.25 },
  localImprovement: { maxIterations: 20 },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
};

function context(): PlacementContext {
  return {
    policy,
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate' as any,
      accessibilityNeeds: [],
    },
    planningWindow: policy.window,
    requestedFormats: [],
    travelEstimateProvider: stubTravelEstimateProvider(),
    startDates: [],
  };
}

describe('runBoundedLocalImprovement', () => {
  it('moves an activity from an overloaded day to a lighter day', async () => {
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a', 0, 0), candidate('b', 0, 0.001), candidate('c', 0, 0.002)],
          totalActivityMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [2, { dayNumber: 2, assigned: [], totalActivityMinutes: 0, totalWalkingMeters: 0 }],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(days, context());
    expect(improved.get(1)!.assigned.length).toBeLessThan(3);
    expect(improved.get(2)!.assigned.length).toBeGreaterThan(0);
  });

  it('swaps two candidates to improve geographic compactness', async () => {
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a1', 0, 0), candidate('far-from-a', 10, 10)],
          totalActivityMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [candidate('b1', 10, 10.001), candidate('near-a-actually', 0, 0.001)],
          totalActivityMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(days, context());
    const day1Ids = improved.get(1)!.assigned.map((a) => a.activityId);
    // 'near-a-actually' (0, 0.001) belongs with 'a1' (0,0), not 'far-from-a' (10,10).
    expect(day1Ids).toContain('near-a-actually');
  });

  it('never exceeds the configured max iterations', async () => {
    const days = new Map<number, DayAccumulator>([
      [1, { dayNumber: 1, assigned: [candidate('a', 0, 0)], totalActivityMinutes: 60, totalWalkingMeters: 0 }],
      [2, { dayNumber: 2, assigned: [candidate('b', 1, 1)], totalActivityMinutes: 60, totalWalkingMeters: 0 }],
    ]);
    const { iterations } = await runBoundedLocalImprovement(days, context());
    expect(iterations).toBeLessThanOrEqual(policy.localImprovement.maxIterations);
  });

  it('does not move a candidate when it would violate a hard constraint at the destination', async () => {
    const tightContext: PlacementContext = {
      ...context(),
      mobility: { ...context().mobility, maxWalkingDistancePerDayMeters: 1 },
    };
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a', 0, 0), candidate('b', 0, 0.001), candidate('c', 0, 0.002)],
          totalActivityMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [2, { dayNumber: 2, assigned: [], totalActivityMinutes: 0, totalWalkingMeters: 0 }],
    ]);
    const { days: improved } = await runBoundedLocalImprovement(days, tightContext);
    expect(improved.get(1)!.assigned.length).toBe(3); // no move possible under the tight walking limit
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-local-improvement.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/utils/daily-planning-local-improvement.util.ts
import { Coordinate, PlanningActivityCandidate } from '../interfaces/daily-planning.interface';
import { DayAccumulator, PlacementContext, checkHardConstraints } from './daily-planning-placement.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

function dayCentroid(acc: DayAccumulator): Coordinate | null {
  if (acc.assigned.length === 0) return null;
  const lat = acc.assigned.reduce((sum, a) => sum + a.spatialFootprint.centroid.lat, 0) / acc.assigned.length;
  const lng = acc.assigned.reduce((sum, a) => sum + a.spatialFootprint.centroid.lng, 0) / acc.assigned.length;
  return { lat, lng };
}

function distanceToCentroid(candidate: PlanningActivityCandidate, centroid: Coordinate | null): number {
  if (!centroid) return 0;
  return footprintDistanceMeters(candidate.spatialFootprint, { type: 'POINT', centroid });
}

function withoutCandidate(acc: DayAccumulator, remove: PlanningActivityCandidate): DayAccumulator {
  return { ...acc, assigned: acc.assigned.filter((a) => a.activityId !== remove.activityId) };
}

/** Move: relocate one Activity from a day with meaningfully more assigned
 * Activities to a lighter day, only when hard-feasible at the destination. */
async function tryMove(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<boolean> {
  for (const [fromDay, fromAcc] of days) {
    for (const candidate of fromAcc.assigned) {
      for (const [toDay, toAcc] of days) {
        if (toDay === fromDay) continue;
        if (toAcc.assigned.length + 1 >= fromAcc.assigned.length) continue;

        const feasibility = await checkHardConstraints(candidate, toAcc, context);
        if (!feasibility.feasible) continue;

        fromAcc.assigned = fromAcc.assigned.filter((a) => a.activityId !== candidate.activityId);
        fromAcc.totalActivityMinutes -= candidate.durationMinutes;
        toAcc.assigned.push(candidate);
        toAcc.totalActivityMinutes += candidate.durationMinutes;
        return true;
      }
    }
  }
  return false;
}

/** Swap: exchange two Activities across two days when it strictly reduces
 * combined distance-to-day-centroid (geographic compactness), and both
 * resulting days stay hard-feasible. */
async function trySwap(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<boolean> {
  const entries = Array.from(days.entries());
  for (const [dayA, accA] of entries) {
    for (const [dayB, accB] of entries) {
      if (dayB <= dayA) continue;
      for (const candidateA of accA.assigned) {
        for (const candidateB of accB.assigned) {
          const centroidA = dayCentroid(accA);
          const centroidB = dayCentroid(accB);
          const currentSpread =
            distanceToCentroid(candidateA, centroidA) + distanceToCentroid(candidateB, centroidB);
          const swappedSpread =
            distanceToCentroid(candidateB, centroidA) + distanceToCentroid(candidateA, centroidB);
          if (swappedSpread >= currentSpread) continue;

          const feasibleInA = await checkHardConstraints(
            candidateB,
            withoutCandidate(accA, candidateA),
            context,
          );
          const feasibleInB = await checkHardConstraints(
            candidateA,
            withoutCandidate(accB, candidateB),
            context,
          );
          if (!feasibleInA.feasible || !feasibleInB.feasible) continue;

          accA.assigned = accA.assigned.map((a) => (a.activityId === candidateA.activityId ? candidateB : a));
          accB.assigned = accB.assigned.map((a) => (a.activityId === candidateB.activityId ? candidateA : a));
          return true;
        }
      }
    }
  }
  return false;
}

/** Bounded, deterministic local improvement — no randomization, no
 * simulated annealing. Stops as soon as neither a move nor a swap improves
 * anything, or the iteration bound is reached. */
export async function runBoundedLocalImprovement(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<{ days: Map<number, DayAccumulator>; iterations: number }> {
  let iterations = 0;
  const maxIterations = context.policy.localImprovement.maxIterations;

  while (iterations < maxIterations) {
    iterations++;
    const movedOrSwapped = (await tryMove(days, context)) || (await trySwap(days, context));
    if (!movedOrSwapped) break;
  }

  return { days, iterations };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/utils/daily-planning-local-improvement.util.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/daily-planning-local-improvement.util.ts be/src/modules/tours/utils/daily-planning-local-improvement.util.spec.ts
git commit -m "feat(tours): PR10 bounded local improvement (move + swap)"
```

---

### Task 10: `GreedyDailyPlanningSolver`

**Files:**
- Create: `be/src/modules/tours/services/greedy-daily-planning.solver.ts`
- Test: `be/src/modules/tours/services/greedy-daily-planning.solver.spec.ts`

**Interfaces:**
- Consumes: `DailyPlanningSolver`, `DailyPlanningInput`, `DailyPlanningSolution`, `TRAVEL_ESTIMATE_PROVIDER` (Task 1); `sortCandidatesDeterministically` (Task 6); `placeCandidates`, `PlacementContext` (Task 7); `runBoundedLocalImprovement` (Task 9); `orderAndScheduleDay` (Task 8); `DailyPlanningPolicy` (Task 2).
- Produces: `GreedyDailyPlanningSolver` (injectable, implements `DailyPlanningSolver`).

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/services/greedy-daily-planning.solver.spec.ts
import { GreedyDailyPlanningSolver } from './greedy-daily-planning.solver';
import { DailyPlanningInput, TravelEstimateProvider } from '../interfaces/daily-planning.interface';
import { TransportationMode, TravelPace } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function realishTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn(async (from, to) => {
      const dLat = to.centroid.lat - from.centroid.lat;
      const dLng = to.centroid.lng - from.centroid.lng;
      const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
      return {
        mode: TransportationMode.WALKING,
        durationMinutes: (distanceMeters / 1000 / 4.5) * 60,
        distanceMeters,
        walkingMinutes: (distanceMeters / 1000 / 4.5) * 60,
        walkingDistanceMeters: distanceMeters,
        approximate: true,
      };
    }),
  };
}

const policy: DailyPlanningPolicy = {
  paceTargets: {
    relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
    moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
    fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
  },
  travel: { detourFactor: 1.3, walkingSpeedKmh: 5, bikeSpeedKmh: 15, carUrbanSpeedKmh: 25 },
  internalWalking: { unknownFallbackMinutes: 20 },
  scoring: { semanticWeight: 1, qualityWeight: 0.5, formatWeight: 0.75, familyVariantPenaltyWeight: 0.5, dayBalanceWeight: 0.25 },
  localImprovement: { maxIterations: 20 },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
};

function baseInput(overrides: Partial<DailyPlanningInput> = {}): DailyPlanningInput {
  return {
    destination: {} as any,
    requestedDays: 2,
    candidates: [],
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [],
    },
    travelPace: TravelPace.MODERATE,
    planningWindow: policy.window,
    startDates: [],
    ...overrides,
  };
}

function candidate(id: string, semanticScore = 0.5) {
  return {
    activityId: id,
    kind: 'POI' as const,
    title: id,
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT' as const, centroid: { lat: 0, lng: Math.random() * 0.01 } },
    semanticScore,
  };
}

describe('GreedyDailyPlanningSolver', () => {
  it('produces exactly the requested number of day buckets', async () => {
    const solver = new GreedyDailyPlanningSolver(realishTravelEstimateProvider(), policy);
    const solution = await solver.solve(baseInput({ requestedDays: 3, candidates: [candidate('a'), candidate('b')] }));
    expect(solution.days).toHaveLength(3);
  });

  it('returns partial utilization instead of fabricating candidates when input is insufficient', async () => {
    const solver = new GreedyDailyPlanningSolver(realishTravelEstimateProvider(), policy);
    const solution = await solver.solve(baseInput({ requestedDays: 3, candidates: [candidate('only-one')] }));
    const totalScheduled = solution.days.reduce((sum, d) => sum + d.activities.length, 0);
    expect(totalScheduled).toBe(1);
  });

  it('always reports approximateTravel: true for the V1 provider', async () => {
    const solver = new GreedyDailyPlanningSolver(realishTravelEstimateProvider(), policy);
    const solution = await solver.solve(baseInput({ candidates: [candidate('a')] }));
    expect(solution.metadata.approximateTravel).toBe(true);
  });

  it('is deterministic: repeated solves on identical input produce a deep-equal solution', async () => {
    const solver = new GreedyDailyPlanningSolver(realishTravelEstimateProvider(), policy);
    const input = baseInput({
      requestedDays: 2,
      candidates: [candidate('a', 0.9), candidate('b', 0.5), candidate('c', 0.7)],
    });
    const first = await solver.solve(input);
    const second = await solver.solve(input);
    expect(first).toEqual(second);
  });

  it('never expands a duplicate activityId in the input into two planned instances', async () => {
    const solver = new GreedyDailyPlanningSolver(realishTravelEstimateProvider(), policy);
    const dup = candidate('dup');
    const solution = await solver.solve(baseInput({ requestedDays: 1, candidates: [dup, { ...dup }] }));
    const totalScheduled = solution.days.reduce((sum, d) => sum + d.activities.length, 0);
    expect(totalScheduled).toBe(1);
    expect(solution.unselected.some((u) => u.activityId === 'dup')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/services/greedy-daily-planning.solver.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/services/greedy-daily-planning.solver.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  DailyPlanningSolver,
  PlannedDay,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { sortCandidatesDeterministically } from '../utils/daily-planning-candidate-sort.util';
import { PlacementContext, placeCandidates } from '../utils/daily-planning-placement.util';
import { runBoundedLocalImprovement } from '../utils/daily-planning-local-improvement.util';
import { orderAndScheduleDay } from '../utils/daily-planning-ordering.util';

@Injectable()
export class GreedyDailyPlanningSolver implements DailyPlanningSolver {
  constructor(
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async solve(input: DailyPlanningInput): Promise<DailyPlanningSolution> {
    const sorted = sortCandidatesDeterministically(input.candidates);
    const context: PlacementContext = {
      policy: this.policy,
      mobility: input.mobility,
      planningWindow: input.planningWindow,
      requestedFormats: input.requestedFormats ?? [],
      travelEstimateProvider: this.travelEstimateProvider,
      startDates: input.startDates,
    };

    const { days, unselected } = await placeCandidates(sorted, input.requestedDays, context);
    const { iterations } = await runBoundedLocalImprovement(days, context);

    const plannedDays: PlannedDay[] = [];
    for (const [dayNumber, acc] of days) {
      const planned = await orderAndScheduleDay(dayNumber, acc.assigned, {
        travelEstimateProvider: this.travelEstimateProvider,
        planningWindow: input.planningWindow,
        allowedTransportationModes: input.mobility.allowedTransportationModes,
      });
      plannedDays.push(planned);
    }
    plannedDays.sort((a, b) => a.dayNumber - b.dayNumber);

    const score = plannedDays.reduce((sum, d) => sum + d.activities.length, 0);

    return {
      days: plannedDays,
      unselected,
      score,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: true,
        iterations,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/services/greedy-daily-planning.solver.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/greedy-daily-planning.solver.ts be/src/modules/tours/services/greedy-daily-planning.solver.spec.ts
git commit -m "feat(tours): PR10 GreedyDailyPlanningSolver"
```

---

### Task 11: `TourPlanningFeasibilityValidatorService`

**Files:**
- Create: `be/src/modules/tours/services/tour-planning-feasibility-validator.service.ts`
- Test: `be/src/modules/tours/services/tour-planning-feasibility-validator.service.spec.ts`

**Interfaces:**
- Consumes: `TourPlanningFeasibilityValidator`, `DailyPlanningSolution`, `DailyPlanningInput`, `PlanningFeasibilityResult` (Task 1).
- Produces: `TourPlanningFeasibilityValidatorService` (injectable, implements `TourPlanningFeasibilityValidator`).

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/services/tour-planning-feasibility-validator.service.spec.ts
import { TourPlanningFeasibilityValidatorService } from './tour-planning-feasibility-validator.service';
import { DailyPlanningInput, DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { TransportationMode, TravelPace } from '../interfaces/tour-generation.interface';

function baseInput(overrides: Partial<DailyPlanningInput> = {}): DailyPlanningInput {
  return {
    destination: {} as any,
    requestedDays: 1,
    candidates: [
      {
        activityId: 'a',
        kind: 'POI',
        title: 'a',
        durationMinutes: 60,
        spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
        semanticScore: 0.5,
      },
    ],
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [],
    },
    travelPace: TravelPace.MODERATE,
    planningWindow: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
    startDates: [],
    ...overrides,
  };
}

function validSolution(): DailyPlanningSolution {
  return {
    days: [
      {
        dayNumber: 1,
        activities: [{ activityId: 'a', startMinutesFromMidnight: 540, endMinutesFromMidnight: 600 }],
        totalActivityMinutes: 60,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        utilizationMinutes: 60,
      },
    ],
    unselected: [],
    score: 1,
    metadata: { solver: 'test', approximateTravel: true },
  };
}

describe('TourPlanningFeasibilityValidatorService', () => {
  const validator = new TourPlanningFeasibilityValidatorService();

  it('accepts a valid solution', () => {
    const result = validator.validate(validSolution(), baseInput());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a day-count mismatch', () => {
    const result = validator.validate(validSolution(), baseInput({ requestedDays: 2 }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DAY_COUNT_MISMATCH')).toBe(true);
  });

  it('rejects a duplicate activity across days', () => {
    const solution = validSolution();
    solution.days.push({
      dayNumber: 2,
      activities: [{ activityId: 'a', startMinutesFromMidnight: 540, endMinutesFromMidnight: 600 }],
      totalActivityMinutes: 60,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 60,
    });
    const result = validator.validate(solution, baseInput({ requestedDays: 2 }));
    expect(result.issues.some((i) => i.code === 'DUPLICATE_ACTIVITY')).toBe(true);
  });

  it('rejects an activity scheduled out of chronological order', () => {
    const solution = validSolution();
    solution.days[0].activities.push({
      activityId: 'a2',
      startMinutesFromMidnight: 500, // before the previous activity's end (600)
      endMinutesFromMidnight: 560,
    });
    solution.days[0].activities.push;
    const input = baseInput({
      candidates: [
        ...baseInput().candidates,
        {
          activityId: 'a2',
          kind: 'POI',
          title: 'a2',
          durationMinutes: 60,
          spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
          semanticScore: 0.5,
        },
      ],
    });
    const result = validator.validate(solution, input);
    expect(result.issues.some((i) => i.code === 'CHRONOLOGICAL_ORDER_VIOLATION')).toBe(true);
  });

  it('rejects an activity that runs past the planning window', () => {
    const solution = validSolution();
    solution.days[0].activities[0].endMinutesFromMidnight = 1300; // past 1200
    const result = validator.validate(solution, baseInput());
    expect(result.issues.some((i) => i.code === 'DAILY_TIME_CAPACITY_EXCEEDED')).toBe(true);
  });

  it('rejects a day number outside the requested range', () => {
    const solution = validSolution();
    solution.days[0].dayNumber = 5;
    const result = validator.validate(solution, baseInput());
    expect(result.issues.some((i) => i.code === 'INVALID_DAY_NUMBER')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/services/tour-planning-feasibility-validator.service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/services/tour-planning-feasibility-validator.service.ts
import { Injectable } from '@nestjs/common';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlanningFeasibilityIssue,
  PlanningFeasibilityResult,
  TourPlanningFeasibilityValidator,
} from '../interfaces/daily-planning.interface';

@Injectable()
export class TourPlanningFeasibilityValidatorService
  implements TourPlanningFeasibilityValidator
{
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult {
    const issues: PlanningFeasibilityIssue[] = [];

    if (solution.days.length !== input.requestedDays) {
      issues.push({
        code: 'DAY_COUNT_MISMATCH',
        message: `Expected ${input.requestedDays} days, got ${solution.days.length}.`,
      });
    }

    const seenActivityIds = new Set<string>();

    for (const day of solution.days) {
      let cursor = input.planningWindow.startMinutesFromMidnight;
      let dayWalkingMeters = 0;

      for (const activity of day.activities) {
        if (seenActivityIds.has(activity.activityId)) {
          issues.push({
            code: 'DUPLICATE_ACTIVITY',
            message: `Activity ${activity.activityId} is scheduled more than once.`,
          });
        }
        seenActivityIds.add(activity.activityId);

        if (activity.startMinutesFromMidnight < cursor) {
          issues.push({
            code: 'CHRONOLOGICAL_ORDER_VIOLATION',
            message: `Day ${day.dayNumber}: activity ${activity.activityId} starts before the previous activity ends.`,
          });
        }
        cursor = activity.endMinutesFromMidnight;

        const candidate = input.candidates.find((c) => c.activityId === activity.activityId);
        if (!candidate) {
          issues.push({
            code: 'UNKNOWN_ACTIVITY',
            message: `Activity ${activity.activityId} is not part of the offered candidate pool.`,
          });
          continue;
        }

        if (activity.travelFromPrevious) {
          dayWalkingMeters += activity.travelFromPrevious.walkingDistanceMeters;
          if (!input.mobility.allowedTransportationModes.includes(activity.travelFromPrevious.mode)) {
            issues.push({
              code: 'DISALLOWED_TRAVEL_MODE',
              message: `Day ${day.dayNumber}: the leg into ${activity.activityId} used a disallowed transportation mode.`,
            });
          }
          if (
            activity.travelFromPrevious.walkingDistanceMeters >
            input.mobility.maxContinuousWalkingDistanceMeters
          ) {
            issues.push({
              code: 'MAX_CONTINUOUS_WALKING_EXCEEDED',
              message: `Day ${day.dayNumber}: the leg into ${activity.activityId} exceeds the continuous walking limit.`,
            });
          }
        }
        dayWalkingMeters += candidate.mobility?.internalWalkingDistanceMeters ?? 0;
      }

      if (cursor > input.planningWindow.endMinutesFromMidnight) {
        issues.push({
          code: 'DAILY_TIME_CAPACITY_EXCEEDED',
          message: `Day ${day.dayNumber} runs past the planning window.`,
        });
      }
      if (dayWalkingMeters > input.mobility.maxWalkingDistancePerDayMeters) {
        issues.push({
          code: 'MAX_WALKING_PER_DAY_EXCEEDED',
          message: `Day ${day.dayNumber} exceeds the daily walking limit.`,
        });
      }
      if (day.dayNumber < 1 || day.dayNumber > input.requestedDays) {
        issues.push({
          code: 'INVALID_DAY_NUMBER',
          message: `Day number ${day.dayNumber} is outside the requested range.`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/services/tour-planning-feasibility-validator.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/tour-planning-feasibility-validator.service.ts be/src/modules/tours/services/tour-planning-feasibility-validator.service.spec.ts
git commit -m "feat(tours): PR10 independent TourPlanningFeasibilityValidator"
```

---

### Task 12: `PlanningCandidateNormalizerService`

**Files:**
- Create: `be/src/modules/tours/services/planning-candidate-normalizer.service.ts`
- Test: `be/src/modules/tours/services/planning-candidate-normalizer.service.spec.ts`

**Interfaces:**
- Consumes: `PlanningActivityCandidate`, `TRAVEL_ESTIMATE_PROVIDER`, `TravelEstimateProvider` (Task 1); `buildPointFootprint` (Task 4); `parseOpeningHours` (Task 3); `CandidateScoreBreakdown` (existing, `candidate-ranking.util.ts`); `EXPERIENCE_FORMAT_ACTIVITY_KIND` (existing, `experience-format-kind.util.ts`); `PrismaService` (existing).
- Produces: `PlanningCandidateNormalizerService.normalize(activities, scoreBreakdownById): Promise<PlanningActivityCandidate[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
// be/src/modules/tours/services/planning-candidate-normalizer.service.spec.ts
import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { ActivityKind } from '@prisma/client';

describe('PlanningCandidateNormalizerService', () => {
  let prisma: any;
  let travelEstimateProvider: any;
  let service: PlanningCandidateNormalizerService;

  beforeEach(() => {
    prisma = { activityWaypoint: { findMany: jest.fn().mockResolvedValue([]) } };
    travelEstimateProvider = {
      estimate: jest.fn().mockResolvedValue({
        mode: TransportationMode.WALKING,
        durationMinutes: 5,
        distanceMeters: 300,
        walkingMinutes: 5,
        walkingDistanceMeters: 300,
        approximate: true,
      }),
    };
    service = new PlanningCandidateNormalizerService(prisma, travelEstimateProvider, {
      internalWalking: { unknownFallbackMinutes: 20 },
    } as any);
  });

  it('converts persisted hours duration to planning minutes exactly once', async () => {
    const [candidate] = await service.normalize(
      [{ id: 'a', kind: ActivityKind.POI, name: 'A', latitude: 1, longitude: 2, duration: 2.5 }],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(150);
  });

  it('defaults duration to 0 minutes when unset', async () => {
    const [candidate] = await service.normalize(
      [{ id: 'a', kind: ActivityKind.POI, name: 'A', latitude: 1, longitude: 2, duration: null }],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(0);
  });

  it('carries the score breakdown into semanticScore/qualityScore', async () => {
    const [candidate] = await service.normalize(
      [{ id: 'a', kind: ActivityKind.POI, name: 'A', latitude: 1, longitude: 2, duration: 1 }],
      new Map([['a', { semanticSimilarity: 0.8, qualityBonus: 0.4, proximityBonus: 0, diversityBonus: 0, totalScore: 1.2 }]]),
    );
    expect(candidate.semanticScore).toBe(0.8);
    expect(candidate.qualityScore).toBe(0.4);
  });

  it('maps POI to POINT_VISITS and NEIGHBORHOOD_WALK to NEIGHBORHOOD_WALKS', async () => {
    const [poi, walk] = await service.normalize(
      [
        { id: 'poi', kind: ActivityKind.POI, name: 'POI', latitude: 1, longitude: 2, duration: 1 },
        { id: 'walk', kind: ActivityKind.NEIGHBORHOOD_WALK, name: 'Walk', latitude: 1, longitude: 2, duration: null },
      ],
      new Map(),
    );
    expect(poi.formats).toEqual(['point_visits']);
    expect(walk.formats).toEqual(['neighborhood_walks']);
  });

  it('never derives internal walking from duration — represents it as unknown with too few waypoints', async () => {
    prisma.activityWaypoint.findMany.mockResolvedValue([]);
    const [walk] = await service.normalize(
      [{ id: 'walk', kind: ActivityKind.NEIGHBORHOOD_WALK, name: 'Walk', latitude: 1, longitude: 2, duration: 3 }],
      new Map(),
    );
    expect(walk.mobility?.internalWalkingMinutes).toBeUndefined();
  });

  it('computes internal walking from ordered waypoint coordinates when resolvable', async () => {
    prisma.activityWaypoint.findMany.mockResolvedValue([
      { order: 1, waypointActivity: { latitude: 0, longitude: 0 } },
      { order: 2, waypointActivity: { latitude: 0, longitude: 0.001 } },
    ]);
    const [walk] = await service.normalize(
      [{ id: 'walk', kind: ActivityKind.NEIGHBORHOOD_WALK, name: 'Walk', latitude: 1, longitude: 2, duration: null }],
      new Map(),
    );
    expect(walk.mobility?.internalWalkingMinutes).toBe(5);
    expect(travelEstimateProvider.estimate).toHaveBeenCalledWith(
      { type: 'POINT', centroid: { lat: 0, lng: 0 } },
      { type: 'POINT', centroid: { lat: 0, lng: 0.001 } },
      [TransportationMode.WALKING],
    );
  });

  it('parses opening hours from the raw weekdayText shape', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'a',
          kind: ActivityKind.POI,
          name: 'A',
          latitude: 1,
          longitude: 2,
          duration: 1,
          openingHours: { weekdayText: ['Monday: 9:00 AM – 6:00 PM'] },
        },
      ],
      new Map(),
    );
    expect(candidate.openingHours?.status).toBe('known');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn jest src/modules/tours/services/planning-candidate-normalizer.service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// be/src/modules/tours/services/planning-candidate-normalizer.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ActivityKind } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  PlanningActivityCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { ExperienceFormat, TransportationMode } from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';
import { buildPointFootprint } from '../utils/spatial-footprint.util';
import { parseOpeningHours } from '../utils/normalized-opening-hours.util';

function isCompositeKind(kind: ActivityKind): boolean {
  return (
    kind === ActivityKind.NEIGHBORHOOD_WALK ||
    kind === ActivityKind.ROUTE ||
    kind === ActivityKind.EXPERIENCE
  );
}

const KIND_TO_FORMAT = new Map<ActivityKind, ExperienceFormat>(
  Object.entries(EXPERIENCE_FORMAT_ACTIVITY_KIND).map(([format, kind]) => [
    kind as ActivityKind,
    format as ExperienceFormat,
  ]),
);

function activityKindToFormats(kind: ActivityKind): ExperienceFormat[] {
  if (kind === ActivityKind.POI) return [ExperienceFormat.POINT_VISITS];
  const format = KIND_TO_FORMAT.get(kind);
  return format ? [format] : [];
}

@Injectable()
export class PlanningCandidateNormalizerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async normalize(
    activities: any[],
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>,
  ): Promise<PlanningActivityCandidate[]> {
    return Promise.all(
      activities.map((activity) => this.normalizeOne(activity, scoreBreakdownById.get(activity.id))),
    );
  }

  private async normalizeOne(
    activity: any,
    scoreBreakdown: CandidateScoreBreakdown | undefined,
  ): Promise<PlanningActivityCandidate> {
    const kind: ActivityKind = activity.kind ?? ActivityKind.POI;
    const mobility = isCompositeKind(kind) ? await this.computeInternalWalking(activity) : undefined;

    return {
      activityId: activity.id,
      kind,
      title: activity.name,
      // Persisted duration is hours — converted once, here, at the
      // normalization boundary. Never mixed with hours downstream.
      durationMinutes: (activity.duration ?? 0) * 60,
      spatialFootprint: buildPointFootprint(activity.latitude, activity.longitude),
      openingHours: parseOpeningHours(activity.openingHours?.weekdayText),
      semanticScore: scoreBreakdown?.semanticSimilarity ?? 0,
      qualityScore: scoreBreakdown?.qualityBonus,
      formats: activityKindToFormats(kind),
      areaId: activity.familyId ?? undefined,
      familyId: activity.familyId ?? undefined,
      variantKey: activity.variantTheme ?? undefined,
      mobility,
      metadata: {
        source: activity.metadata?.placesProvider,
        rating: activity.rating,
        userRatingCount: activity.ratingCount,
      },
    };
  }

  private async computeInternalWalking(
    composite: any,
  ): Promise<PlanningActivityCandidate['mobility']> {
    const waypoints = await this.prisma.activityWaypoint.findMany({
      where: { compositeActivityId: composite.id },
      orderBy: { order: 'asc' },
      include: { waypointActivity: true },
    });

    const resolvable = waypoints.filter(
      (w: any) => w.waypointActivity.latitude != null && w.waypointActivity.longitude != null,
    );

    if (resolvable.length < 2) {
      // Too few resolvable waypoints to estimate a real internal-walking
      // distance — represented as unknown, never a duration-derived guess.
      return {
        internalWalkingMinutes: undefined,
        internalWalkingDistanceMeters: undefined,
        internalTravelMinutes: undefined,
      };
    }

    let totalMinutes = 0;
    let totalMeters = 0;
    for (let i = 0; i < resolvable.length - 1; i++) {
      const from = buildPointFootprint(
        resolvable[i].waypointActivity.latitude,
        resolvable[i].waypointActivity.longitude,
      );
      const to = buildPointFootprint(
        resolvable[i + 1].waypointActivity.latitude,
        resolvable[i + 1].waypointActivity.longitude,
      );
      const estimate = await this.travelEstimateProvider.estimate(from, to, [
        TransportationMode.WALKING,
      ]);
      totalMinutes += estimate.durationMinutes;
      totalMeters += estimate.distanceMeters;
    }

    return {
      internalWalkingMinutes: totalMinutes,
      internalWalkingDistanceMeters: totalMeters,
      internalTravelMinutes: totalMinutes,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn jest src/modules/tours/services/planning-candidate-normalizer.service.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/planning-candidate-normalizer.service.ts be/src/modules/tours/services/planning-candidate-normalizer.service.spec.ts
git commit -m "feat(tours): PR10 PlanningCandidateNormalizerService"
```

---

### Task 13: DI wiring in `tours.module.ts`

**Files:**
- Modify: `be/src/modules/tours/tours.module.ts`

**Interfaces:**
- Consumes: every class/token from Tasks 1-12.
- Produces: nothing new — makes `DAILY_PLANNING_SOLVER`, `TRAVEL_ESTIMATE_PROVIDER`, `TOUR_PLANNING_FEASIBILITY_VALIDATOR`, and `PlanningCandidateNormalizerService` injectable throughout `ToursModule`.

- [ ] **Step 1: Modify `tours.module.ts`**

Add these imports alongside the existing ones:

```ts
import { GreedyDailyPlanningSolver } from './services/greedy-daily-planning.solver';
import { ApproximateTravelEstimateProvider } from './services/approximate-travel-estimate.provider';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';
import { TourPlanningFeasibilityValidatorService } from './services/tour-planning-feasibility-validator.service';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
```

Add to the `providers` array (after `GeminiDiscoveryProvider`, before the existing token bindings):

```ts
    GreedyDailyPlanningSolver,
    ApproximateTravelEstimateProvider,
    PlanningCandidateNormalizerService,
    TourPlanningFeasibilityValidatorService,
    {
      provide: TRAVEL_ESTIMATE_PROVIDER,
      useExisting: ApproximateTravelEstimateProvider,
    },
    {
      // Only one V1 implementation — swappable for a future OR-Tools solver
      // without changing any caller, matching the existing
      // GROUNDED_SEARCH_PROVIDER static-swap pattern.
      provide: DAILY_PLANNING_SOLVER,
      useExisting: GreedyDailyPlanningSolver,
    },
    {
      provide: TOUR_PLANNING_FEASIBILITY_VALIDATOR,
      useExisting: TourPlanningFeasibilityValidatorService,
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd be && yarn typecheck`
Expected: no errors

- [ ] **Step 3: Boot the Nest DI graph to catch wiring mistakes**

```ts
// be/src/modules/tours/tours.module.spec.ts (new, minimal — only if this file doesn't already exist; if it exists, add this test to it)
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';

describe('ToursModule DI wiring (PR10)', () => {
  it('resolves the new daily-planning providers without error', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(DAILY_PLANNING_SOLVER)).toBeDefined();
    expect(moduleRef.get(TRAVEL_ESTIMATE_PROVIDER)).toBeDefined();
    expect(moduleRef.get(TOUR_PLANNING_FEASIBILITY_VALIDATOR)).toBeDefined();
    expect(moduleRef.get(PlanningCandidateNormalizerService)).toBeDefined();
    await moduleRef.close();
  });
});
```

Run: `cd be && yarn jest src/modules/tours/tours.module.spec.ts`
Expected: PASS — confirms no missing-provider/circular-dependency errors

- [ ] **Step 4: Commit**

```bash
git add be/src/modules/tours/tours.module.ts be/src/modules/tours/tours.module.spec.ts
git commit -m "feat(tours): PR10 DI wiring for daily-planning providers"
```

---

### Task 14: Add `buildDailyPlanningStep` to the trace builder

**Files:**
- Modify: `be/src/modules/tours/utils/generation-trace-builder.util.ts`
- Test: `be/src/modules/tours/utils/generation-trace-builder.util.spec.ts` (existing file — add to it)

**Interfaces:**
- Consumes: `DailyPlanningSolution` (Task 1).
- Produces: `buildDailyPlanningStep(solution: DailyPlanningSolution): GenerationTraceStep`, consumed by Task 15's integration.

- [ ] **Step 1: Write the failing test**

Add to the existing `generation-trace-builder.util.spec.ts`:

```ts
import { buildDailyPlanningStep } from './generation-trace-builder.util';

describe('buildDailyPlanningStep', () => {
  it('summarizes a solution into a trace step', () => {
    const step = buildDailyPlanningStep({
      days: [
        {
          dayNumber: 1,
          activities: [{ activityId: 'a', startMinutesFromMidnight: 540, endMinutesFromMidnight: 600 }],
          totalActivityMinutes: 60,
          totalTravelMinutes: 5,
          totalWalkingMinutes: 5,
          utilizationMinutes: 65,
        },
      ],
      unselected: [{ activityId: 'b', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] }],
      score: 1,
      metadata: { solver: 'GreedyDailyPlanningSolver', approximateTravel: true, iterations: 3 },
    });
    expect(step.name).toBe('daily_planning');
    expect(step.summary).toContain('GreedyDailyPlanningSolver');
    expect(step.summary).toContain('1'); // selected count
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn jest src/modules/tours/utils/generation-trace-builder.util.spec.ts -t "buildDailyPlanningStep"`
Expected: FAIL — `buildDailyPlanningStep is not a function`

- [ ] **Step 3: Implement**

Add to `generation-trace-builder.util.ts` (follow the file's existing `buildXStep` naming/shape convention — inspect one existing builder in this file first to match its exact `GenerationTraceStep` field names before writing this one):

```ts
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';

export function buildDailyPlanningStep(
  solution: DailyPlanningSolution,
): GenerationTraceStep {
  const selectedCount = solution.days.reduce((sum, d) => sum + d.activities.length, 0);
  return {
    name: 'daily_planning',
    summary:
      `Solver ${solution.metadata.solver} planned ${solution.days.length} day(s): ` +
      `${selectedCount} activities selected, ${solution.unselected.length} unselected ` +
      `(approximate travel: ${solution.metadata.approximateTravel}, ` +
      `local-improvement iterations: ${solution.metadata.iterations ?? 0}).`,
    details: {
      days: solution.days.map((d) => ({
        dayNumber: d.dayNumber,
        activityCount: d.activities.length,
        totalActivityMinutes: d.totalActivityMinutes,
        totalTravelMinutes: d.totalTravelMinutes,
        totalWalkingMinutes: d.totalWalkingMinutes,
        utilizationMinutes: d.utilizationMinutes,
      })),
      unselected: solution.unselected,
      score: solution.score,
    },
  };
}
```

**Note for the implementer:** the exact `GenerationTraceStep` shape (does it use `name`/`summary`/`details`, or different field names?) must match this file's existing convention exactly — read `buildCoverageAnalysisStep` or `buildPlacesCrawlStep` in the same file immediately before writing this function and mirror their field names precisely. The field names above are illustrative of the *content*, not a guaranteed-exact match to the existing type.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn jest src/modules/tours/utils/generation-trace-builder.util.spec.ts`
Expected: PASS, including all pre-existing tests in this file (no regression)

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/generation-trace-builder.util.ts be/src/modules/tours/utils/generation-trace-builder.util.spec.ts
git commit -m "feat(tours): PR10 daily_planning generation-trace step"
```

---

### Task 15: Integrate the solver into `TourActivityGenerationService`'s wizard path

**Files:**
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.ts`
- Modify: `be/src/modules/tours/utils/travel-time-calculator.util.ts` (comment only)
- Delete: `be/src/modules/tours/utils/route-optimizer.util.ts`, `be/src/modules/tours/utils/route-optimizer.util.spec.ts`
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.spec.ts` (existing — adjust mocks/assertions for the removed LLM-selection path)

**Interfaces:**
- Consumes: `PlanningCandidateNormalizerService.normalize` (Task 12); `DAILY_PLANNING_SOLVER`/`DailyPlanningSolver` (Tasks 1, 10); `TOUR_PLANNING_FEASIBILITY_VALIDATOR`/`TourPlanningFeasibilityValidator` (Tasks 1, 11); `buildDailyPlanningStep` (Task 14); existing `TourCompletenessValidator`/`TourFormatCoverageValidator` (unchanged internals — only their call-site inputs change).

This is the largest task in the plan. Work through it as five focused sub-steps rather than one giant diff, committing after each so a reviewer can follow the change.

- [ ] **Step 1: Inject the three new dependencies**

In `tour-activity-generation.service.ts`, add to the constructor (after `proposalResolver`):

```ts
    private readonly planningCandidateNormalizer: PlanningCandidateNormalizerService,
    @Inject(DAILY_PLANNING_SOLVER)
    private readonly dailyPlanningSolver: DailyPlanningSolver,
    @Inject(TOUR_PLANNING_FEASIBILITY_VALIDATOR)
    private readonly tourPlanningFeasibilityValidator: TourPlanningFeasibilityValidator,
```

Add the matching imports at the top of the file:

```ts
import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import {
  DAILY_PLANNING_SOLVER,
  DailyPlanningSolver,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  TourPlanningFeasibilityValidator,
  DailyPlanningInput,
} from '../interfaces/daily-planning.interface';
import { buildDailyPlanningStep } from '../utils/generation-trace-builder.util'; // add to the existing import block from this file
```

Run: `cd be && yarn typecheck`
Expected: FAIL — the spec file's test module doesn't provide these three new constructor dependencies yet (expected at this point; fixed in Step 5)

- [ ] **Step 2: Replace the LLM-selection critical path**

Replace the entire block from `const tourChain = this.compositeGenerationService.createTourChain();` (currently line 1141) through the closing of the corrective-retry `if` block (currently line 1378, the closing `}` before the blank line at 1379) with:

```ts
      const planningCandidates = await this.planningCandidateNormalizer.normalize(
        ranked,
        scoreBreakdownById,
      );

      const planningInput: DailyPlanningInput = {
        destination: destinationResolution,
        requestedDays: request.days,
        candidates: planningCandidates,
        mobility: request.mobility,
        travelPace: request.mobility.travelPace,
        planningWindow: {
          startMinutesFromMidnight: 9 * 60,
          endMinutesFromMidnight: 20 * 60,
        },
        requestedFormats: request.intent.experienceFormats,
        startDates: request.startDates,
      };

      const planningSolution = await this.dailyPlanningSolver.solve(planningInput);

      const feasibilityResult = this.tourPlanningFeasibilityValidator.validate(
        planningSolution,
        planningInput,
      );
      if (!feasibilityResult.valid) {
        throw new Error(
          `Deterministic daily planning produced an infeasible solution: ${feasibilityResult.issues
            .map((i) => `${i.code}: ${i.message}`)
            .join('; ')}`,
        );
      }

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario planificado. Guardando actividades...',
      );

      const isFoodFocusedIntent =
        request.intent.interests.length === 1 && request.intent.interests[0] === 'food';

      const selectedIds = new Set(
        planningSolution.days.flatMap((day) => day.activities.map((a) => a.activityId)),
      );
      const completenessInput: TourCompletenessInput = {
        requestedDays: request.days,
        travelPace: request.mobility.travelPace,
        isFoodFocusedIntent,
        selectedActivities: planningSolution.days.flatMap((day) =>
          day.activities.map((activity) => {
            const candidate = candidateActivitiesById.get(activity.activityId);
            return {
              activityId: activity.activityId,
              dayNumber: day.dayNumber,
              durationHours:
                (activity.endMinutesFromMidnight - activity.startMinutesFromMidnight) / 60,
              isMeal: candidate?.type === 'food',
            };
          }),
        ),
        viableUnusedCandidateCount: planningSolution.unselected.length,
      };
      const completeness = this.tourCompletenessValidator.validate(completenessInput);

      // Physically-infeasible reasons never count as "available" for
      // requested-format coverage — a pool candidate that couldn't fit any
      // day under hard mobility constraints must not be treated as an
      // ignored option, and must never be forced into the tour to satisfy
      // the format (spec "Requested format coverage").
      const physicallyInfeasibleReasons = new Set<string>([
        'DAILY_TIME_CAPACITY_EXCEEDED',
        'MAX_WALKING_PER_DAY_EXCEEDED',
        'MAX_CONTINUOUS_WALKING_EXCEEDED',
        'NO_ALLOWED_TRAVEL_MODE',
        'OPENING_HOURS_INCOMPATIBLE',
        'NO_FEASIBLE_DAY',
        'INVALID_SPATIAL_FOOTPRINT',
        'INVALID_COMPOSITE',
      ]);
      const infeasibleActivityIds = new Set(
        planningSolution.unselected
          .filter((u) => u.reasons.some((r) => physicallyInfeasibleReasons.has(r)))
          .map((u) => u.activityId),
      );
      const formatCoverageInput: TourFormatCoverageInput = {
        requestedExperienceFormats: request.intent.experienceFormats,
        selectedActivities: Array.from(selectedIds)
          .map((activityId): TourFormatCoverageActivityRef | null => {
            const candidate = candidateActivitiesById.get(activityId);
            return candidate?.kind ? { activityId, kind: candidate.kind } : null;
          })
          .filter((ref): ref is TourFormatCoverageActivityRef => ref !== null),
        availableCandidateActivities: Array.from(candidateActivitiesById.entries())
          .filter(([id, candidate]) => candidate.kind && !infeasibleActivityIds.has(id))
          .map(([activityId, candidate]) => ({
            activityId,
            kind: candidate.kind as ActivityKind,
          })),
      };
      const formatCoverage = this.tourFormatCoverageValidator.validate(formatCoverageInput);

      // No corrective LLM re-invocation: the deterministic solver already
      // ran exhaustively over the same inputs it would be re-run with, and
      // there is no more LLM selection call to retry with feedback. A
      // completeness/format-coverage shortfall is still recorded in the
      // trace below, not silently absorbed — same "completed ≠ every gate
      // passed" contract as before, just without the now-obsolete retry.
      const correctiveRetryAttempted = false;
```

- [ ] **Step 3: Run typecheck to catch reference errors**

Run: `cd be && yarn typecheck`
Expected: errors pointing at any remaining reference to now-removed variables (`aiResponse`, `hallucinatedCount`, `duplicateCount`, `auditResult`, `uniqueActivities`, `orderedActivities`) further down the file — fix each in Step 4.

- [ ] **Step 4: Replace ordering/persistence to use the planned solution**

Replace the block starting at (what was) `let orderedActivities = uniqueActivities;` through `activities = updateTravelTimesForActivities(activities, activitiesMap);` (the whole ordering/DTO-transform/travel-time block) with:

```ts
      // PR10: day/order/timing/travel come directly from the deterministic
      // solution — no route-optimizer, no post-hoc travel-time fill-in, no
      // AI-shaped DTO transform (every activityId is already real, drawn
      // straight from the offered candidate pool, so no hallucination check
      // is needed either).
      const activities = planningSolution.days.flatMap((day) =>
        day.activities.map((planned, index) => {
          const candidate = candidateActivitiesById.get(planned.activityId);
          const nextInDay = day.activities[index + 1];
          return {
            activityId: planned.activityId,
            activityName: candidate?.name ?? 'Activity',
            activityType: candidate?.type ?? 'Activity',
            activityLatitude: candidate?.latitude,
            activityLongitude: candidate?.longitude,
            duration: (planned.endMinutesFromMidnight - planned.startMinutesFromMidnight) / 60,
            startTime: this.resolvePlannedStartTime(
              request.startDates,
              day.dayNumber,
              planned.startMinutesFromMidnight,
            ),
            notes: undefined as string | undefined,
            dayNumber: day.dayNumber,
            order: index + 1,
            travelTimeToNext: nextInDay?.travelFromPrevious?.durationMinutes,
            distanceToNext: nextInDay?.travelFromPrevious
              ? nextInDay.travelFromPrevious.distanceMeters / 1000
              : undefined,
          };
        }),
      );

      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => !!id);

      let kindByActivityId = new Map<string, ActivityKind>();
      const waypointIdsByActivityId = new Map<string, string[]>();

      if (activityIds.length > 0) {
        const activityEntities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: { id: true, latitude: true, longitude: true, kind: true },
        });

        kindByActivityId = new Map(activityEntities.map((act) => [act.id, act.kind]));

        const nonPoiActivityIds = activityEntities
          .filter((act) => act.kind !== ActivityKind.POI)
          .map((act) => act.id);
        if (nonPoiActivityIds.length > 0) {
          const waypointRows = await this.prisma.activityWaypoint.findMany({
            where: { compositeActivityId: { in: nonPoiActivityIds } },
            orderBy: { order: 'asc' },
          });
          for (const row of waypointRows) {
            const list = waypointIdsByActivityId.get(row.compositeActivityId) ?? [];
            list.push(row.waypointActivityId);
            waypointIdsByActivityId.set(row.compositeActivityId, list);
          }
        }
      }
```

Then, in the persistence transaction below, keep the existing `tx.tourActivity.create(...)` / waypoint-snapshot loop exactly as-is (it already reads generically from the `activities` array by field name — `activity.activityId`, `activity.dayNumber`, `activity.order`, etc. — which the new construction above still provides). Two changes inside that same loop:

1. Delete the reference to `selectedWaypointIdsByActivityId` (the old per-tour waypoint-trim map the LLM used to populate) — replace:

```ts
            const requested = selectedWaypointIdsByActivityId.get(
              activity.activityId as string,
            );
            const finalWaypointIds =
              verifySelectedWaypointSubset(
                requested,
                new Set(actualWaypointIds),
              ) ?? actualWaypointIds;
```

   with:

```ts
            // PR10: no LLM-driven per-tour waypoint trimming anymore —
            // every composite schedules with its full current waypoint set.
            // Per-tour trimming still exists post-generation via the review
            // screen (app/tours/[id]/review.tsx, outside this backend plan).
            const finalWaypointIds = actualWaypointIds;
```

2. In the final `tx.tour.update(...)` metadata block, replace the `generationTrace` object's contents:

```ts
              generationTrace: {
                steps: [...traceSteps, buildDailyPlanningStep(planningSolution)],
                tourCompleteness: {
                  ...completeness,
                  retryAttempted: correctiveRetryAttempted,
                },
                tourFormatCoverage: {
                  ...formatCoverage,
                  retryAttempted: correctiveRetryAttempted,
                },
              },
```

(This drops the now-meaningless `aiReasoning`/`hallucinatedCount`/`duplicateCount`/`auditFindings` fields — there is no more LLM response to report reasoning from, and no hallucination is possible since every scheduled `activityId` is drawn directly from the offered candidate pool by construction. The frontend's `GenerationBitacora` component displaying these fields as optional is a known follow-up outside this backend-only plan — flag it to the user after this task, don't silently fix it here.)

- [ ] **Step 5: Add the `resolvePlannedStartTime` private helper**

Add near the other private helpers in the class:

```ts
  /** PR10: no new Prisma columns. If a real base date exists, combine it
   * with the planned day/minutes into a real Date; otherwise never invent
   * one — dayNumber/order/duration alone carry the schedule, and full
   * minutes-precise timing survives only in the planning trace/result. */
  private resolvePlannedStartTime(
    startDates: string[],
    dayNumber: number,
    startMinutesFromMidnight: number,
  ): Date | undefined {
    if (startDates.length === 0) return undefined;
    const base = new Date(startDates[0]);
    if (Number.isNaN(base.getTime())) return undefined;
    const result = new Date(base);
    result.setDate(base.getDate() + (dayNumber - 1));
    result.setHours(0, startMinutesFromMidnight, 0, 0);
    return result;
  }
```

- [ ] **Step 6: Remove the now-dead imports and delete `route-optimizer.util.ts`**

Remove the `optimizeActivityOrder` import and the `updateTravelTimesForActivities` import (the wizard file no longer calls either).

```bash
rm be/src/modules/tours/utils/route-optimizer.util.ts be/src/modules/tours/utils/route-optimizer.util.spec.ts
```

Add a legacy comment at the top of `travel-time-calculator.util.ts` (its only remaining caller is the deprecated `/tours/nearby` chain):

```ts
// LEGACY: as of PR10, the wizard path (TourActivityGenerationService) no
// longer calls this — travel times come directly from the deterministic
// planning solution. This file survives only because the deprecated
// /tours/nearby chain (tour-generation.service.ts) still calls it. Delete
// this file once that path is retired or migrated (see
// docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md,
// "Legacy utility fate").
```

- [ ] **Step 7: Run a global caller search before finalizing the deletion**

Run: `cd be && grep -rn "optimizeActivityOrder\|route-optimizer" src --include="*.ts"`
Expected: zero matches (confirms the deletion is safe — re-run this immediately before committing, since call sites can shift during implementation)

- [ ] **Step 8: Update `tour-activity-generation.service.spec.ts`**

This existing spec file's `beforeEach` currently mocks `langChainService`, `compositeGenerationService.createTourChain()`, and asserts on `uniqueActivities`/LLM-response-shaped behavior for the wizard path. Update it to:

1. Add mock providers for `PlanningCandidateNormalizerService`, `dailyPlanningSolver` (the `DAILY_PLANNING_SOLVER` token), and `tourPlanningFeasibilityValidator` (the `TOUR_PLANNING_FEASIBILITY_VALIDATOR` token) to the `Test.createTestingModule` providers array, each with a `jest.fn()`-based stub matching the real interfaces from Task 1.
2. For every existing test that previously drove behavior by mocking `langChainService.generateChatResponse(...)` to return a JSON itinerary, replace that mock with a `dailyPlanningSolver.solve` mock returning an equivalent `DailyPlanningSolution` (same `dayNumber`/`activityId`/`startTime` intent, expressed as `PlannedActivity[]` with `startMinutesFromMidnight`/`endMinutesFromMidnight` instead of an AI JSON blob).
3. Delete tests that specifically exercised the old LLM-retry-on-completeness-failure loop (`'retries exactly once and persists the fuller retry result...'`, `'does not loop a second time...'`) — that retry no longer exists per this plan's explicit scope decision. Keep `TourCompletenessValidator`/`TourFormatCoverageValidator`'s own unit tests untouched; only this integration spec's retry-specific tests are removed.
4. Keep every PR 8/PR 9 entity-resolution and unified-candidate-pool test unchanged in intent — they exercise `allEligibleActivitiesById`/`rankAndSliceActivities`, upstream of this task's change, and should still pass once the mocks above are in place.

This step doesn't have a single code block — it requires reading the existing spec file's current ~40 tests and adjusting each mock individually. Do this test-by-test, running the suite after each fix rather than all at once.

- [ ] **Step 9: Run the full spec file**

Run: `cd be && yarn jest src/modules/tours/services/tour-activity-generation.service.spec.ts`
Expected: PASS, same or greater test count as before this task (minus the 2 deleted retry-loop tests, which the earlier PR9 cost-hotfix session already brought to 41 — expect ~39 passing here, adjust as tests are added/removed in Step 8)

- [ ] **Step 10: Commit**

```bash
git add be/src/modules/tours/services/tour-activity-generation.service.ts be/src/modules/tours/services/tour-activity-generation.service.spec.ts be/src/modules/tours/utils/travel-time-calculator.util.ts
git rm be/src/modules/tours/utils/route-optimizer.util.ts be/src/modules/tours/utils/route-optimizer.util.spec.ts
git commit -m "feat(tours): PR10 wire deterministic daily planning into the wizard generation path"
```

---

### Task 16: Full regression pass and remaining spec-scenario coverage

**Files:**
- No new files. Adds any test scenarios from the spec's 30-item list not already covered by Tasks 1-15's unit tests, in whichever existing spec file is the natural home for each (cross-reference against the spec document's "Testing" section).

- [ ] **Step 1: Run the full backend suite**

Run: `cd be && yarn typecheck && yarn lint:check && yarn test`
Expected: PASS, zero regressions outside this plan's intended changes

- [ ] **Step 2: Cross-check spec scenario coverage**

Go through the spec's 30 numbered test scenarios (`docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`, "Testing" section) one by one against the tests already written in Tasks 1-15. Scenarios already covered:
- #1-3, #6-7, #14-15, #18, #23-24, #30 → Task 10 (`greedy-daily-planning.solver.spec.ts`) and Task 7 (`daily-planning-placement.util.spec.ts`).
- #4-5, #8-9 → Task 7.
- #10, #12 → Task 7 (duplicate handling) and Task 8 (composite as one unit — implicit in `orderAndScheduleDay` operating on whole candidates, not waypoints).
- #11 → Task 12 (`planning-candidate-normalizer.service.spec.ts`).
- #13 → Task 9 (swap test).
- #16-17 → new, add to Task 15's spec file (`tour-activity-generation.service.spec.ts`): one test asserting a physically-infeasible pool candidate for a requested format is excluded from `availableCandidateActivities` and never forced into `selectedActivities`; one test asserting a genuinely feasible one is preserved.
- #19-20 → Task 9.
- #21 → Task 11.
- #22 → Task 7 (`DAILY_TIME_CAPACITY_EXCEEDED` test already covers travel-time-inclusion via the fake provider's non-zero duration).
- #25 → new, add to Task 15's spec file: one test asserting `/tours/nearby`'s deprecated chain (`tour-generation.service.ts`) is untouched — e.g. it still imports and calls `updateTravelTimesForActivities`, confirming Task 15 Step 6 didn't remove its only remaining caller.
- #26 → new, add to Task 15's spec file: an integration assertion that `langChainService.generateChatResponse`/`compositeGenerationService.createTourChain` are never called anywhere in `generateTourActivities()`'s wizard path.
- #27 → Task 12 (duration hours→minutes conversion test).
- #28 → Task 3 (`isOpenDuring` unknown-status test) and Task 7 (no-base-date opening-hours test).
- #29 → Task 7 (`INVALID_SPATIAL_FOOTPRINT` — add if not already present; `checkHardConstraints`' NaN/undefined centroid guard was implemented in Task 7 Step 3 but confirm a test exists for it, add one if missing).

Add whichever of the above are still missing (primarily #16, #17, #25, #26, and confirm #29) as concrete Jest tests in their listed files now, following the same patterns already established in those files' existing tests.

- [ ] **Step 3: Run the full suite again**

Run: `cd be && yarn test`
Expected: PASS, full coverage of all 30 spec scenarios confirmed present across the suite

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(tours): PR10 close remaining spec-scenario coverage gaps"
```

---

## Self-Review Notes

Performed against the spec (`docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`) after drafting all tasks above:

1. **Spec coverage:** Every "Implement" scope item (1-13, spec §Scope) maps to a task: provider-neutral abstraction → Task 1; V1 solver → Tasks 6-10; transport-aware estimates → Task 5; hard mobility constraints → Task 7; daily capacity → Task 7; opening-hours feasibility → Tasks 3, 7; composite handling → Tasks 7, 12; within-day ordering → Task 8; bounded local improvement → Task 9; independent validation → Task 11; planning trace → Task 14; integration → Task 15; deterministic tests → Tasks 1-16 throughout, closed out in Task 16.
2. **Placeholder scan:** No "TBD"/"TODO" in any task's code. Task 15 Step 8 is intentionally described as a manual per-test adjustment rather than a fixed code block, because it operates on ~40 pre-existing tests this plan doesn't control the current exact content of — that's a legitimate exception (a mechanical, well-specified adjustment procedure, not an unspecified "add appropriate tests").
3. **Type consistency, checked explicitly:** `TravelMode` → `TransportationMode` used consistently from Task 1 onward (not reintroduced as a separate type anywhere). `checkHardConstraints`'s exact signature (`candidate, acc, context`) is identical across Task 7 (definition), Task 9 (`tryMove`/`trySwap` reuse), and Task 10 (not called directly, but `PlacementContext` constructed identically). `PlanningActivityCandidate.durationMinutes` is never read as hours anywhere past Task 12's normalizer. `DailyPlanningInput.startDates` (added during drafting, not in the original spec prose verbatim) is consistently threaded from Task 1's type through Task 10's solver and Task 15's integration — flagged here explicitly since it's a plan-level addition beyond the spec's literal text, needed to make the opening-hours weekday resolution in Task 7 actually work; it does not contradict the spec (which already discusses `request.startDates` conceptually under "Persisted schedule (reconciled)") but the spec's own `DailyPlanningInput` code sample omitted it — this plan's version is the authoritative one to implement.
