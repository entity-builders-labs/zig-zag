# Tour Materialization & Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop discarding data `GreedyDailyPlanningSolver` already computes (per-leg travel, per-day totals, a composite Experience's real presentation geometry, and the difference between "no intrinsic order" and "array position") between the solver's output and what a Tour persists/exposes via `GET /tours/:id`.

**Architecture:** Three small, independently testable pure functions
(`buildTourExperienceCreateData`, `deriveExperiencePresentation`,
`computeDayTotals`) sit at the two existing seams that already move data
between the solver and the API — the Tour-snapshot persistence step in
`experience-generation.service.ts`, and the read-side decoration step in
`tours.service.ts` (`withMediaPresentation`, which already runs the same
kind of "decorate the raw Prisma rows before returning them" work for
photos). No new services, no new API routes — existing ones gain fields.

**Tech Stack:** NestJS, Prisma (Postgres), Jest — backend. Expo/React Native,
TypeScript, no test runner — frontend (verified directly: no `test` script,
no jest/vitest in `fe/package.json`; frontend steps in this plan verify with
`npx tsc --noEmit` instead of a test suite, matching what the project
actually has).

**Spec:** `docs/superpowers/specs/2026-09-06-tour-materialization-exposure-design.md`
— Blocks 1, 2, and 4 only. Block 3 (real routing-provider geometry) is
explicitly deferred per that spec's own Open Questions and is **not** part
of this plan.

## Global Constraints

- No backward-compatibility requirement and no data migration for any
  existing Tour rows — if a schema change leaves old rows without the new
  field, that's fine; nothing in this plan reads old rows expecting the new
  field to already be populated on them.
- Every new backend function is a pure function over plain data — no new
  service classes, no new DI providers.
- Match existing casts already used in this codebase for Prisma `Json?`
  fields (e.g. `experience-catalog.service.ts`'s
  `metadata as Prisma.InputJsonValue | undefined`) rather than inventing a
  new convention.
- Backend tests are colocated `*.spec.ts` files run via `yarn test` (Jest
  root is `be/src`), per this repo's existing convention — not new to this
  plan.

---

## Task 1: Add `travelFromPrevious` to `TourExperience`

**Files:**
- Modify: `be/prisma/schema.prisma:262-281` (the `TourExperience` model)

**Interfaces:**
- Produces: a nullable `Json` column, `TourExperience.travelFromPrevious`,
  available to every later task in this plan via the generated Prisma
  Client.

- [ ] **Step 1: Add the column to the schema**

In `be/prisma/schema.prisma`, inside `model TourExperience`, add
`travelFromPrevious` right after `notes`:

```prisma
model TourExperience {
  id                 String                    @id @default(uuid())
  tourId             String
  experienceId       String
  dayNumber          Int?
  order              Int                       @default(1)
  startTime          DateTime?
  duration           Float?
  notes              String?
  travelFromPrevious Json?
  tour               Tour                      @relation(fields: [tourId], references: [id], onDelete: Cascade)
  experience         Experience                @relation(fields: [experienceId], references: [id], onDelete: Restrict)
  components         TourExperienceComponent[]
  createdAt          DateTime                  @default(now())
  updatedAt          DateTime                  @updatedAt

  @@unique([tourId, experienceId, dayNumber, order])
  @@index([tourId])
  @@index([experienceId])
  @@map("tour_experience")
}
```

- [ ] **Step 2: Create and apply the migration**

Run (from `be/`):
```bash
cd be && yarn prisma:migrate
```
When prompted for a migration name, use `add_tour_experience_travel_from_previous`.

Expected: a new folder under `be/prisma/migrations/` containing a
`migration.sql` with an `ALTER TABLE "tour_experience" ADD COLUMN
"travelFromPrevious" JSONB;` (nullable — no data loss, no backfill needed
per this plan's Global Constraints).

- [ ] **Step 3: Regenerate the Prisma Client**

```bash
cd be && yarn prisma:generate
```

Expected: no errors. `Prisma.TourExperienceCreateInput` (and the
`TourExperience` model type) now include `travelFromPrevious?:
Prisma.InputJsonValue | null`.

- [ ] **Step 4: Verify the backend still typechecks and builds**

```bash
cd be && yarn typecheck
```

Expected: 0 new errors (the pre-existing `test/acceptance/*` fixture errors
unrelated to this schema, if present, are not this task's concern — do not
fix them here).

- [ ] **Step 5: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations/
git commit -m "feat(schema): add TourExperience.travelFromPrevious column"
```

---

## Task 2: Persist real per-leg travel and stop fabricating component order

**Files:**
- Create: `be/src/modules/tours/utils/tour-experience-snapshot.util.ts`
- Test: `be/src/modules/tours/utils/tour-experience-snapshot.util.spec.ts`
- Modify: `be/src/modules/tours/services/experience-generation.service.ts:1655-1680` (thread `travelFromPrevious` through `selectedExperiences`)
- Modify: `be/src/modules/tours/services/experience-generation.service.ts:1734-1758` (use the new pure function instead of the inline object)

**Interfaces:**
- Consumes: `TravelEstimate` from `be/src/modules/tours/interfaces/daily-planning.interface.ts` (already exists: `{ mode, durationMinutes, distanceMeters, walkingMinutes, walkingDistanceMeters, approximate, provider?, fallbackReason? }`).
- Produces: `buildTourExperienceCreateData(tourId, selected, experience):
  Prisma.TourExperienceCreateInput` — used by Task 2's own service wiring
  and by no one else in this plan.

**Context verified this session:** `experience-generation.service.ts`'s
`selectedExperiences` construction (around line 1655) already computes
`travelTimeToNext`/`distanceToNext` from `nextInDay?.travelFromPrevious`, but
those two fields are dead — grepped the whole file, nothing reads them
after they're set. This task adds the *current* experience's own
`travelFromPrevious` (the natural "how did I get here" direction the API
should expose) without touching those two pre-existing unused fields —
they're out of scope for this plan.

- [ ] **Step 1: Write the failing tests for the pure snapshot-mapper**

Create `be/src/modules/tours/utils/tour-experience-snapshot.util.spec.ts`:

```ts
import { buildTourExperienceCreateData } from './tour-experience-snapshot.util';

describe('buildTourExperienceCreateData', () => {
  const baseSelected = {
    dayNumber: 1,
    order: 2,
    startTime: new Date('2026-09-06T14:00:00.000Z'),
    duration: 1.5,
    notes: undefined as string | undefined,
    travelFromPrevious: null as any,
  };

  const experienceWithOrderedComponents = {
    id: 'exp-1',
    components: [
      {
        geoEntityId: 'geo-1',
        order: 2,
        role: 'venue',
        required: true,
        geoEntity: {
          name: 'Plaza Dorrego',
          latitude: -34.6205,
          longitude: -58.3718,
          geometry: { type: 'Point', coordinates: [-58.3718, -34.6205] },
        },
      },
      {
        geoEntityId: 'geo-2',
        order: 1,
        role: 'venue',
        required: true,
        geoEntity: {
          name: 'San Telmo Fair',
          latitude: -34.6114,
          longitude: -58.3719,
          geometry: { type: 'Point', coordinates: [-58.3719, -34.6114] },
        },
      },
    ],
  };

  it('persists a real, evidence-backed component order unchanged', () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithOrderedComponents,
    );

    expect(result.components.create).toEqual([
      expect.objectContaining({ geoEntityId: 'geo-1', order: 2 }),
      expect.objectContaining({ geoEntityId: 'geo-2', order: 1 }),
    ]);
  });

  it('preserves null order instead of fabricating an array-position sequence (real regression)', () => {
    // Verified live this session: the old code did
    // `order: component.order ?? index + 1`, permanently baking a fake
    // sequence into the Tour snapshot for a genuinely unordered Experience
    // ("Plazas históricas de Mendoza" style — no real intrinsic order).
    const experienceWithUnorderedComponents = {
      id: 'exp-2',
      components: [
        {
          geoEntityId: 'geo-3',
          order: null,
          role: 'venue',
          required: true,
          geoEntity: {
            name: 'Plaza España',
            latitude: -32.89,
            longitude: -68.84,
            geometry: null,
          },
        },
        {
          geoEntityId: 'geo-4',
          order: null,
          role: 'venue',
          required: true,
          geoEntity: {
            name: 'Plaza Chile',
            latitude: -32.891,
            longitude: -68.841,
            geometry: null,
          },
        },
      ],
    };

    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithUnorderedComponents,
    );

    expect(result.components.create).toEqual([
      expect.objectContaining({ geoEntityId: 'geo-3', order: null }),
      expect.objectContaining({ geoEntityId: 'geo-4', order: null }),
    ]);
  });

  it('persists travelFromPrevious when the solver computed one', () => {
    const travelFromPrevious = {
      mode: 'WALKING',
      durationMinutes: 12,
      distanceMeters: 850,
      walkingMinutes: 12,
      walkingDistanceMeters: 850,
      approximate: true,
      provider: 'approximate',
    };

    const result = buildTourExperienceCreateData(
      'tour-1',
      { ...baseSelected, travelFromPrevious },
      experienceWithOrderedComponents,
    );

    expect(result.travelFromPrevious).toEqual(travelFromPrevious);
  });

  it('persists null travelFromPrevious for a day\'s first stop', () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      { ...baseSelected, travelFromPrevious: null },
      experienceWithOrderedComponents,
    );

    expect(result.travelFromPrevious).toBeNull();
  });

  it('maps every scalar field onto the create input', () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithOrderedComponents,
    );

    expect(result).toEqual(
      expect.objectContaining({
        tourId: 'tour-1',
        experienceId: 'exp-1',
        dayNumber: 1,
        order: 2,
        startTime: baseSelected.startTime,
        duration: 1.5,
        notes: undefined,
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd be && yarn test src/modules/tours/utils/tour-experience-snapshot.util.spec.ts
```

Expected: FAIL — `Cannot find module './tour-experience-snapshot.util'`.

- [ ] **Step 3: Implement the pure function**

Create `be/src/modules/tours/utils/tour-experience-snapshot.util.ts`:

```ts
import { Prisma } from '@prisma/client';

export interface PlannedExperienceForSnapshot {
  dayNumber: number;
  order: number;
  startTime?: Date;
  duration: number;
  notes?: string;
  travelFromPrevious?: unknown;
}

export interface ExperienceComponentForSnapshot {
  geoEntityId: string;
  order: number | null;
  role: string | null;
  required: boolean;
  geoEntity: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    geometry: unknown;
  };
}

export interface ExperienceEntityForSnapshot {
  id: string;
  components: ExperienceComponentForSnapshot[];
}

/**
 * Pure mapper from the solver's own planned-experience shape + the resolved
 * Experience entity to exactly the `data` object
 * `tx.tourExperience.create({ data })` needs. Extracted so the two real bugs
 * fixed here (order fabrication, discarded travelFromPrevious) are covered
 * by fast, dependency-free tests instead of only reachable through the full
 * generation service.
 *
 * Component `order` is passed through as-is (`component.order`, no `??`
 * fallback) — verified live this session that fabricating `index + 1` when
 * `order` is genuinely `null` (no real intrinsic-order evidence) permanently
 * destroys that "unordered" signal in the frozen Tour snapshot.
 */
export function buildTourExperienceCreateData(
  tourId: string,
  selected: PlannedExperienceForSnapshot,
  experience: ExperienceEntityForSnapshot,
): Prisma.TourExperienceUncheckedCreateInput {
  return {
    tourId,
    experienceId: experience.id,
    dayNumber: selected.dayNumber,
    order: selected.order,
    startTime: selected.startTime,
    duration: selected.duration,
    notes: selected.notes,
    travelFromPrevious: (selected.travelFromPrevious ??
      null) as Prisma.InputJsonValue | null,
    components: {
      create: experience.components.map((component) => ({
        geoEntityId: component.geoEntityId,
        order: component.order,
        role: component.role,
        required: component.required,
        name: component.geoEntity.name,
        latitude: component.geoEntity.latitude,
        longitude: component.geoEntity.longitude,
        geometry: component.geoEntity.geometry as
          | Prisma.InputJsonValue
          | undefined,
      })),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd be && yarn test src/modules/tours/utils/tour-experience-snapshot.util.spec.ts
```

Expected: PASS, 5/5.

Note: verified directly against the generated Prisma client
(`node_modules/.prisma/client/index.d.ts`'s
`TourExperienceUncheckedCreateInput`, which the existing pre-Task-2 code
already uses at this same call site) that `tourId`/`experienceId` are flat
scalar fields, not a nested-connect shape — the implementation above already
matches this; no ambiguity to resolve here. (An earlier draft of this plan
incorrectly assumed a nested-connect shape before this was checked — fixed
before finalizing.)

- [ ] **Step 5: Thread `travelFromPrevious` through `selectedExperiences`**

In `experience-generation.service.ts`, in the `selectedExperiences` mapping
(around line 1655-1680), add `travelFromPrevious: planned.travelFromPrevious
?? null` to the returned object — do not remove the existing
`travelTimeToNext`/`distanceToNext` fields (out of scope, already unused
elsewhere in this file, not this task's concern):

```ts
      const selectedExperiences = planningSolution.days.flatMap((day) =>
        day.experiences.map((planned, index) => {
          const candidate = candidateExperiencesById.get(planned.experienceId);
          const nextInDay = day.experiences[index + 1];
          return {
            experienceId: planned.experienceId,
            experienceName: candidate?.name ?? 'Experience',
            duration:
              (planned.endMinutesFromMidnight -
                planned.startMinutesFromMidnight) /
              60,
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
            travelFromPrevious: planned.travelFromPrevious ?? null,
          };
        }),
      );
```

- [ ] **Step 6: Use the new function at the persistence call site**

In the same file, find the `tx.tourExperience.create({ data: { ... } })`
call (around line 1734-1758) and replace its inline `data` object with a
call to `buildTourExperienceCreateData`:

```ts
          await tx.tourExperience.create({
            data: buildTourExperienceCreateData(tourId, selected, experience),
          });
```

Add the import at the top of `experience-generation.service.ts`:

```ts
import { buildTourExperienceCreateData } from '../utils/tour-experience-snapshot.util';
```

- [ ] **Step 7: Run the full tours test suite**

```bash
cd be && yarn test src/modules/tours --silent
```

Expected: all suites pass (existing suite count/pass count from before this
task, plus the 5 new tests from Step 1).

- [ ] **Step 8: Typecheck and lint**

```bash
cd be && yarn typecheck && yarn lint:check
```

Expected: 0 new errors/warnings introduced by this task's files.

- [ ] **Step 9: Commit**

```bash
git add be/src/modules/tours/utils/tour-experience-snapshot.util.ts \
        be/src/modules/tours/utils/tour-experience-snapshot.util.spec.ts \
        be/src/modules/tours/services/experience-generation.service.ts
git commit -m "fix(tours): persist travelFromPrevious, stop fabricating component order"
```

---

## Task 3: Derive `ExperiencePresentation` (geometry mode) from persisted components

**Files:**
- Create: `be/src/modules/tours/utils/experience-presentation.util.ts`
- Test: `be/src/modules/tours/utils/experience-presentation.util.spec.ts`

**Interfaces:**
- Produces: `deriveExperiencePresentation(components):
  ExperiencePresentation` and the `ExperiencePresentation`/`GeometryMode`
  types — consumed by Task 5.
- Pure function, no dependency on Tasks 1/2 — can be built and tested
  independently, wired in by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `be/src/modules/tours/utils/experience-presentation.util.spec.ts`:

```ts
import { deriveExperiencePresentation } from './experience-presentation.util';

describe('deriveExperiencePresentation', () => {
  it('returns POINT with no geometry for a single component with no geometry', () => {
    const result = deriveExperiencePresentation([
      { role: 'venue', order: null, geometry: null },
    ]);
    expect(result).toEqual({ geometryMode: 'POINT', hasIntrinsicSequence: false });
  });

  it('returns POINT for a single component with a Point geometry', () => {
    const result = deriveExperiencePresentation([
      {
        role: 'venue',
        order: null,
        geometry: { type: 'Point', coordinates: [-58.37, -34.6] },
      },
    ]);
    expect(result.geometryMode).toBe('POINT');
  });

  it('returns AREA with the polygon for a single AREA-kind component', () => {
    const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const result = deriveExperiencePresentation([
      { role: 'area', order: null, geometry: polygon },
    ]);
    expect(result).toEqual({
      geometryMode: 'AREA',
      geometry: polygon,
      hasIntrinsicSequence: false,
    });
  });

  it('returns ROUTE using the anchor component\'s LineString geometry, for a multi-component composite with a route anchor', () => {
    const line = { type: 'LineString', coordinates: [[-58.37, -34.6], [-58.36, -34.61]] };
    const result = deriveExperiencePresentation([
      { role: 'venue', order: 1, geometry: { type: 'Point', coordinates: [-58.37, -34.6] } },
      { role: 'route', order: null, geometry: line },
      { role: 'venue', order: 2, geometry: { type: 'Point', coordinates: [-58.36, -34.61] } },
    ]);
    expect(result).toEqual({
      geometryMode: 'ROUTE',
      geometry: line,
      hasIntrinsicSequence: true,
    });
  });

  it('returns MULTI_POINT with no single geometry when several components have no anchor (real example: "Plazas históricas de Mendoza")', () => {
    const result = deriveExperiencePresentation([
      { role: 'venue', order: null, geometry: { type: 'Point', coordinates: [0, 0] } },
      { role: 'venue', order: null, geometry: { type: 'Point', coordinates: [1, 1] } },
    ]);
    expect(result).toEqual({ geometryMode: 'MULTI_POINT', hasIntrinsicSequence: false });
  });

  it('sets hasIntrinsicSequence true when any component has a non-null order, even without an anchor', () => {
    const result = deriveExperiencePresentation([
      { role: 'venue', order: 1, geometry: null },
      { role: 'venue', order: 2, geometry: null },
    ]);
    expect(result.hasIntrinsicSequence).toBe(true);
  });

  it('defaults to POINT with no geometry for zero components (defensive default)', () => {
    const result = deriveExperiencePresentation([]);
    expect(result).toEqual({ geometryMode: 'POINT', hasIntrinsicSequence: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd be && yarn test src/modules/tours/utils/experience-presentation.util.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

Create `be/src/modules/tours/utils/experience-presentation.util.ts`:

```ts
export type GeometryMode = 'POINT' | 'AREA' | 'ROUTE' | 'MULTI_POINT';

export interface ExperiencePresentation {
  geometryMode: GeometryMode;
  geometry?: unknown;
  hasIntrinsicSequence: boolean;
}

export interface ComponentForPresentation {
  role: string | null;
  order: number | null;
  geometry: unknown;
}

function geometryTypeOf(geometry: unknown): string | undefined {
  if (
    geometry &&
    typeof geometry === 'object' &&
    'type' in (geometry as Record<string, unknown>)
  ) {
    return (geometry as { type?: string }).type;
  }
  return undefined;
}

/**
 * Pure function over already-persisted `TourExperienceComponent` fields
 * (`role`, `order`, `geometry`) — no re-validation, no new provider call.
 * The anchor case (ROUTE/AREA for a multi-component Experience) reuses
 * whatever geometry `CompositeGeographicValidationService`'s
 * `canonical_geometry`/`canonical_area` strategy already picked at
 * generation time and persisted onto that one component's own row.
 */
export function deriveExperiencePresentation(
  components: ComponentForPresentation[],
): ExperiencePresentation {
  const hasIntrinsicSequence = components.some((c) => c.order != null);

  if (components.length === 0) {
    return { geometryMode: 'POINT', hasIntrinsicSequence };
  }

  if (components.length === 1) {
    const type = geometryTypeOf(components[0].geometry);
    if (type === 'Polygon' || type === 'MultiPolygon') {
      return {
        geometryMode: 'AREA',
        geometry: components[0].geometry,
        hasIntrinsicSequence,
      };
    }
    return { geometryMode: 'POINT', hasIntrinsicSequence };
  }

  const anchor = components.find((c) => {
    const type = geometryTypeOf(c.geometry);
    return (
      (c.role === 'route' || c.role === 'area') &&
      (type === 'LineString' || type === 'Polygon' || type === 'MultiPolygon')
    );
  });
  if (anchor) {
    const type = geometryTypeOf(anchor.geometry);
    return {
      geometryMode: type === 'LineString' ? 'ROUTE' : 'AREA',
      geometry: anchor.geometry,
      hasIntrinsicSequence,
    };
  }

  return { geometryMode: 'MULTI_POINT', hasIntrinsicSequence };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd be && yarn test src/modules/tours/utils/experience-presentation.util.spec.ts
```

Expected: PASS, 7/7.

- [ ] **Step 5: Typecheck and lint**

```bash
cd be && yarn typecheck && yarn lint:check
```

- [ ] **Step 6: Commit**

```bash
git add be/src/modules/tours/utils/experience-presentation.util.ts \
        be/src/modules/tours/utils/experience-presentation.util.spec.ts
git commit -m "feat(tours): derive ExperiencePresentation geometry mode"
```

---

## Task 4: Compute per-day totals from persisted `TourExperience` rows

**Files:**
- Create: `be/src/modules/tours/utils/day-totals.util.ts`
- Test: `be/src/modules/tours/utils/day-totals.util.spec.ts`

**Interfaces:**
- Produces: `computeDayTotals(experiences): DayTotals[]` and the `DayTotals`
  type — consumed by Task 5.
- Consumes: `duration` (hours, per `TourExperience.duration: Float?` — this
  codebase's convention, confirmed at the call site in
  `experience-generation.service.ts` where `duration = (end - start) / 60`
  converts minutes to hours) and the `travelFromPrevious` shape persisted by
  Task 2 (`durationMinutes`, `walkingMinutes`).

- [ ] **Step 1: Write the failing tests**

Create `be/src/modules/tours/utils/day-totals.util.spec.ts`:

```ts
import { computeDayTotals } from './day-totals.util';

describe('computeDayTotals', () => {
  it('sums experience duration (hours→minutes) and travel minutes per day', () => {
    const result = computeDayTotals([
      { dayNumber: 1, duration: 1.5, travelFromPrevious: null },
      {
        dayNumber: 1,
        duration: 2,
        travelFromPrevious: { durationMinutes: 12, walkingMinutes: 12 },
      },
      {
        dayNumber: 1,
        duration: 2,
        travelFromPrevious: { durationMinutes: 16, walkingMinutes: 0 },
      },
    ]);

    expect(result).toEqual([
      {
        dayNumber: 1,
        experienceCount: 3,
        totalExperienceMinutes: 330, // (1.5 + 2 + 2) * 60
        totalTravelMinutes: 28, // 12 + 16
        totalWalkingMinutes: 12,
        totalMinutes: 358,
      },
    ]);
  });

  it('keeps multiple days separate and sorted by dayNumber', () => {
    const result = computeDayTotals([
      { dayNumber: 2, duration: 1, travelFromPrevious: null },
      { dayNumber: 1, duration: 1, travelFromPrevious: null },
    ]);

    expect(result.map((day) => day.dayNumber)).toEqual([1, 2]);
  });

  it('ignores experiences with no dayNumber', () => {
    const result = computeDayTotals([
      { dayNumber: null, duration: 1, travelFromPrevious: null },
    ]);

    expect(result).toEqual([]);
  });

  it('treats a null duration and null travelFromPrevious as zero, not NaN', () => {
    const result = computeDayTotals([
      { dayNumber: 1, duration: null, travelFromPrevious: null },
    ]);

    expect(result).toEqual([
      {
        dayNumber: 1,
        experienceCount: 1,
        totalExperienceMinutes: 0,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        totalMinutes: 0,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd be && yarn test src/modules/tours/utils/day-totals.util.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

Create `be/src/modules/tours/utils/day-totals.util.ts`:

```ts
export interface DayTotals {
  dayNumber: number;
  experienceCount: number;
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  totalMinutes: number;
}

export interface TourExperienceForDayTotals {
  dayNumber: number | null;
  duration: number | null;
  travelFromPrevious?: {
    durationMinutes: number;
    walkingMinutes: number;
  } | null;
}

/**
 * Computed on every read rather than persisted as a separate aggregate —
 * trivially re-derivable from the same rows it summarizes, so there is no
 * second source of truth that could drift from them.
 */
export function computeDayTotals(
  experiences: TourExperienceForDayTotals[],
): DayTotals[] {
  const byDay = new Map<number, TourExperienceForDayTotals[]>();
  for (const experience of experiences) {
    if (experience.dayNumber == null) continue;
    const list = byDay.get(experience.dayNumber) ?? [];
    list.push(experience);
    byDay.set(experience.dayNumber, list);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, dayExperiences]) => {
      const totalExperienceMinutes = dayExperiences.reduce(
        (sum, experience) => sum + (experience.duration ?? 0) * 60,
        0,
      );
      const totalTravelMinutes = dayExperiences.reduce(
        (sum, experience) =>
          sum + (experience.travelFromPrevious?.durationMinutes ?? 0),
        0,
      );
      const totalWalkingMinutes = dayExperiences.reduce(
        (sum, experience) =>
          sum + (experience.travelFromPrevious?.walkingMinutes ?? 0),
        0,
      );
      return {
        dayNumber,
        experienceCount: dayExperiences.length,
        totalExperienceMinutes,
        totalTravelMinutes,
        totalWalkingMinutes,
        totalMinutes: totalExperienceMinutes + totalTravelMinutes,
      };
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd be && yarn test src/modules/tours/utils/day-totals.util.spec.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Typecheck and lint**

```bash
cd be && yarn typecheck && yarn lint:check
```

- [ ] **Step 6: Commit**

```bash
git add be/src/modules/tours/utils/day-totals.util.ts \
        be/src/modules/tours/utils/day-totals.util.spec.ts
git commit -m "feat(tours): compute per-day totals from persisted TourExperience rows"
```

---

## Task 5: Expose `dayTotals` and `experiencePresentation` from `GET /tours/:id`

**Files:**
- Modify: `be/src/modules/tours/services/tours.service.ts:219-237` (`withMediaPresentation`)
- Test: `be/src/modules/tours/services/tours.service.spec.ts`

**Interfaces:**
- Consumes: `computeDayTotals` (Task 4), `deriveExperiencePresentation`
  (Task 3).
- Produces: `GET /tours/:id`'s JSON response gains `tour.dayTotals:
  DayTotals[]` and `tour.experiences[].experiencePresentation:
  ExperiencePresentation`.

- [ ] **Step 1: Write the failing tests**

In `be/src/modules/tours/services/tours.service.spec.ts`, inside the
existing `describe('findOne', ...)` block, add:

```ts
    it('decorates each experience with experiencePresentation, derived from its components', async () => {
      const tour = {
        id: 'tour-1',
        ownerId: 'user-1',
        experiences: [
          {
            id: 'te-1',
            dayNumber: 1,
            duration: 1.5,
            travelFromPrevious: null,
            components: [
              { role: 'venue', order: null, geometry: null },
            ],
            experience: { id: 'exp-1', canonicalName: 'Plaza Dorrego' },
          },
        ],
      };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      const result = await service.findOne('tour-1', 'user-1');

      expect(result.experiences[0].experiencePresentation).toEqual({
        geometryMode: 'POINT',
        hasIntrinsicSequence: false,
      });
    });

    it('adds dayTotals summarizing every experience by dayNumber', async () => {
      const tour = {
        id: 'tour-1',
        ownerId: 'user-1',
        experiences: [
          {
            id: 'te-1',
            dayNumber: 1,
            duration: 1.5,
            travelFromPrevious: null,
            components: [],
            experience: { id: 'exp-1' },
          },
          {
            id: 'te-2',
            dayNumber: 1,
            duration: 2,
            travelFromPrevious: { durationMinutes: 12, walkingMinutes: 12 },
            components: [],
            experience: { id: 'exp-2' },
          },
        ],
      };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      const result = await service.findOne('tour-1', 'user-1');

      expect(result.dayTotals).toEqual([
        {
          dayNumber: 1,
          experienceCount: 2,
          totalExperienceMinutes: 210,
          totalTravelMinutes: 12,
          totalWalkingMinutes: 12,
          totalMinutes: 222,
        },
      ]);
    });

    it('still returns the tour unchanged by reference when it has no experiences array', async () => {
      const tour = { id: 'tour-1', ownerId: 'user-1' };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      await expect(service.findOne('tour-1', 'user-1')).resolves.toBe(tour);
    });
```

(That last test already exists earlier in the file at line 130-135 with
identical intent — this task must not break it; it is repeated here only to
make explicit that Task 5's change is checked against it. Do not duplicate
the test if one with this exact behavior already passes — only add the
first two `it(...)` blocks above.)

- [ ] **Step 2: Run the tests to verify the two new ones fail**

```bash
cd be && yarn test src/modules/tours/services/tours.service.spec.ts
```

Expected: the two new tests FAIL (`experiencePresentation`/`dayTotals` are
`undefined`); all pre-existing tests in this file still PASS.

- [ ] **Step 3: Wire the two new pure functions into `withMediaPresentation`**

In `be/src/modules/tours/services/tours.service.ts`, add the imports:

```ts
import { computeDayTotals } from '../utils/day-totals.util';
import { deriveExperiencePresentation } from '../utils/experience-presentation.util';
```

Replace the `withMediaPresentation` method (currently at lines 219-237)
with:

```ts
  private withMediaPresentation<T extends { experiences?: any[] }>(tour: T): T {
    if (!Array.isArray(tour.experiences)) return tour;
    return {
      ...tour,
      dayTotals: computeDayTotals(tour.experiences),
      experiences: tour.experiences.map((tourExperience) => {
        if (!tourExperience?.experience) return tourExperience;
        return {
          ...tourExperience,
          experiencePresentation: deriveExperiencePresentation(
            tourExperience.components ?? [],
          ),
          experience: {
            ...tourExperience.experience,
            mediaPresentation:
              this.mediaPresentationResolver.resolvePresentation(
                tourExperience.experience,
              ),
          },
        };
      }),
    } as T;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd be && yarn test src/modules/tours/services/tours.service.spec.ts
```

Expected: PASS, all tests in the file including the two new ones.

- [ ] **Step 5: Run the full backend test suite**

```bash
cd be && yarn test --silent
```

Expected: PASS, every suite (this confirms nothing elsewhere in the backend
depended on `withMediaPresentation`'s exact previous return shape in a way
this change breaks).

- [ ] **Step 6: Typecheck and lint**

```bash
cd be && yarn typecheck && yarn lint:check
```

- [ ] **Step 7: Commit**

```bash
git add be/src/modules/tours/services/tours.service.ts \
        be/src/modules/tours/services/tours.service.spec.ts
git commit -m "feat(tours): expose dayTotals and experiencePresentation from GET /tours/:id"
```

- [ ] **Step 8: Live smoke test against the real Docker stack**

Rebuild and restart only the backend container (never `zigzag-postgres` —
it holds real data):

```bash
docker-compose build backend
docker-compose up -d --no-deps backend
```

Wait for `Nest application successfully started` in `docker logs
zigzag-backend`, then fetch a real, already-generated multi-day Tour (any
tour id already in the local database works) and confirm the JSON response
now includes `dayTotals` and each experience's `experiencePresentation`:

```bash
curl -s http://localhost:4000/tours/<a-real-tour-id> \
  -H "Authorization: Bearer <a-real-token>" | python3 -m json.tool | grep -A5 "dayTotals\|experiencePresentation"
```

Expected: both fields present with plausible values (non-empty
`dayTotals`, a `geometryMode` string per experience). This is the same
live-verification discipline used throughout this session — do not
consider this task done on unit tests alone.

---

## Task 6: Extend the frontend `TourExperience` contract

**Files:**
- Modify: `fe/api/tours.ts:6-87` (`Tour`, `TourExperienceComponent`, `TourExperience` interfaces)

**Interfaces:**
- Produces: `TravelFromPrevious`, `DayTotals`, `ExperiencePresentation`
  types, and the new optional fields on `Tour`/`TourExperience`/
  `TourExperienceComponent` — consumed by Task 7.

**Note on testing:** verified directly — `fe/package.json` has no `test`
script and no jest/vitest dependency; this repo's own frontend testing is
Playwright e2e against a running instance (`fe/e2e/`), not applicable to a
type-only change. This task's verification step is a typecheck, not a test
run — that is the real, existing state of this project, not a shortcut
taken by this plan.

- [ ] **Step 1: Add the new interfaces and fields**

In `fe/api/tours.ts`, add after `MediaPresentation` (currently ending around
line 63):

```ts
export interface TravelFromPrevious {
  mode: 'WALKING' | 'CYCLING' | 'DRIVING' | 'PUBLIC_TRANSPORT';
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
  provider?: string;
  fallbackReason?: string;
}

export interface DayTotals {
  dayNumber: number;
  experienceCount: number;
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  totalMinutes: number;
}

export interface ExperiencePresentation {
  geometryMode: 'POINT' | 'AREA' | 'ROUTE' | 'MULTI_POINT';
  geometry?: unknown;
  hasIntrinsicSequence: boolean;
}
```

Update `TourExperienceComponent` (currently lines 27-37) — widen `order` to
allow `null` (it already allowed `undefined`; this makes the "no intrinsic
order" case explicit instead of ambiguous with "not fetched yet"):

```ts
export interface TourExperienceComponent {
  id: string;
  geoEntityId: string;
  order?: number | null;
  role?: string;
  required: boolean;
  name: string;
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
}
```

Update `TourExperience` (currently lines 65-87) to add
`travelFromPrevious`/`experiencePresentation`:

```ts
export interface TourExperience {
  id: string;
  experienceId: string;
  dayNumber?: number;
  order: number;
  startTime?: string;
  duration?: number;
  notes?: string;
  travelFromPrevious?: TravelFromPrevious | null;
  experiencePresentation?: ExperiencePresentation;
  components: TourExperienceComponent[];
  experience?: {
    id: string;
    canonicalName?: string;
    name?: string;
    description?: string;
    status?: string;
    mediaUpdatedAt?: string;
    mediaPresentation?: MediaPresentation;
    themes?: string[];
    traits?: Array<{ trait: string; value?: string }>;
    components?: Array<{ name: string; role?: string; latitude?: number; longitude?: number }>;
  };
}
```

Update `Tour` (currently lines 6-25) to add `dayTotals`:

```ts
export interface Tour {
  id: string;
  name: string;
  description?: string;
  coverImage?: string;
  duration?: number;
  price?: number;
  totalDistance?: number;
  totalDays?: number;
  categories?: string[];
  /** Canonical V2 tour snapshots. */
  experiences?: TourExperience[];
  dayTotals?: DayTotals[];
  metadata?: any;
  options?: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    includeExistingExperiences?: boolean;
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd fe && npx tsc --noEmit
```

Expected: 0 new errors. (Widening `TourExperienceComponent.order` to allow
`null` may surface new errors at call sites that assumed it was always a
`number` — those are Task 7's job to fix, not this task's; if this command
reports errors in files this task didn't touch, note them and proceed to
Task 7, which fixes the two known ones.)

- [ ] **Step 3: Commit**

```bash
git add fe/api/tours.ts
git commit -m "feat(fe): add travelFromPrevious/dayTotals/experiencePresentation types"
```

---

## Task 7: Stop the frontend from fabricating component order too

**Files:**
- Modify: `fe/components/tour-details/build-stops.ts:31-34`
- Modify: `fe/components/tour-details/types.ts:26`
- Modify: `fe/components/tour-details/CompositeStopCard.tsx:61-63`

**Interfaces:**
- Consumes: `TourExperienceComponent.order: number | null | undefined`
  (Task 6).

**Context verified this session:** `build-stops.ts:32` does `component.order
?? index` — the exact same fabrication bug as the backend's
`experience-generation.service.ts:1747`, fixed independently client-side.
`TourStopComposite.components[].order` is currently typed `number`
(non-nullable) in `types.ts:26`; widening it to `number | null` is required
for the fix and requires `CompositeStopCard.tsx`'s sort
(`a.order - b.order`, unsafe if either is `null`) to become null-safe too.
`CompositeExperienceDetail.tsx` uses a *different* type (`ExperienceDetail`,
fetched from a standalone `/experiences/:id` endpoint, not a Tour snapshot)
and is out of scope for this plan.

- [ ] **Step 1: Widen the type**

In `fe/components/tour-details/types.ts`, change line 26:

```ts
  components: Array<{ order: number | null; component: { id: string; name: string; latitude?: number; longitude?: number } }>;
```

- [ ] **Step 2: Stop fabricating order in `build-stops.ts`**

In `fe/components/tour-details/build-stops.ts`, change line 32 from:

```ts
        order: component.order ?? index,
```

to:

```ts
        order: component.order ?? null,
```

(`index` is still available as the second `.map()` argument even though it
is no longer used for `order` — leave the parameter in place; TypeScript
does not complain about an unused-but-declared arrow function parameter
here since `component` before it is used.)

- [ ] **Step 3: Make the composite-stop sort null-safe**

In `fe/components/tour-details/CompositeStopCard.tsx`, change lines 61-63
from:

```ts
  const orderedComponents = [...data.components].sort(
    (a, b) => a.order - b.order
  );
```

to:

```ts
  const orderedComponents = [...data.components].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) -
      (b.order ?? Number.MAX_SAFE_INTEGER)
  );
```

(A component with no real order sorts after every ordered one and keeps a
stable relative position among other unordered components — matches the
same convention `buildOrderedComponentFootprints`
(`be/src/modules/tours/utils/spatial-footprint.util.ts:100`) already uses
backend-side, verified this session.)

- [ ] **Step 4: Typecheck**

```bash
cd fe && npx tsc --noEmit
```

Expected: 0 errors — including the ones Task 6 may have surfaced at these
exact two call sites.

- [ ] **Step 5: Commit**

```bash
git add fe/components/tour-details/types.ts \
        fe/components/tour-details/build-stops.ts \
        fe/components/tour-details/CompositeStopCard.tsx
git commit -m "fix(fe): stop fabricating component order, sort null-safely"
```

---

## Self-review notes (fixed inline while writing this plan, not left for later)

- **Spec coverage:** Block 1 (Tasks 1, 2, 4, 5) ✓. Block 2 (Task 3, wired in
  Task 5) ✓. Block 4 (Task 2's order fix + Task 7's frontend fix) ✓. Block 3
  intentionally absent per the spec's own deferral.
- **Type consistency:** `TravelEstimate`-shaped data flows unchanged from
  `PlannedExperience.travelFromPrevious` (Task 2) through
  `TourExperience.travelFromPrevious` (Task 1's column) to
  `computeDayTotals`'s input (Task 4) to the frontend `TravelFromPrevious`
  interface (Task 6) — same field names (`durationMinutes`,
  `walkingMinutes`, etc.) at every hop, checked by hand across all four
  tasks.
- **Placeholder scan:** none found — every step has real, complete code; the
  one explicit exception (Task 2 Step 3's note about checking Prisma's
  generated relation-input shape) is a genuine, narrow verification step
  with concrete instructions for both possible outcomes, not a deferred
  decision.
