# Activity Engine: Destination Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tour generation for a city-scale destination (e.g. "Buenos Aires") explore the destination's real structure — its actual neighborhoods, streets, and POIs — and rank every candidate (POI or composite walk) by relevance to the user's stated interests, instead of today's single point+radius search ranked by Google rating alone.

**Architecture:** A new destination-resolution step (Nominatim → real OSM city boundary) runs before candidate search. If the destination resolves to a city/town, a bounded shortlist of its real neighborhoods (Overpass `map_to_area`, not radius guessing) is explored using the existing composite-generation pipeline unchanged; POIs are still sourced via the existing `ActivitiesService.findAll`, just bounded by the city's own geometry. Every candidate — POI or composite — is then re-ranked by one unified, interest-aware relevance score before being truncated to what the LLM sees. A quality-aware crawl-refresh gate ensures a thin candidate pool self-heals instead of staying permanently stuck.

**Tech Stack:** NestJS/TypeScript backend, Prisma/PostgreSQL+pgvector, Overpass API (OSM), Nominatim (OSM), Jest.

**Spec:** `docs/superpowers/specs/2026-08-21-activity-engine-design.md`

## Global Constraints

- Nominatim resolution is used only to classify a destination as area-scale (`addresstype` is `city`/`town`/`village`) — `state`/`country`/no-result all fall back to today's point-scale flow unchanged (spec: "Explicitly out of scope").
- All within-a-known-area queries (neighborhoods, streets, POIs) use Overpass `map_to_area` polygon containment — never a radius guess — once a real boundary is resolved.
- Neighborhood `admin_level` is filtered relative to the resolved city's own `admin_level` + 1, never a fixed absolute range (the spike showed Buenos Aires' city boundary itself sits at `admin_level=8`, adjacent to its own barrios at `admin_level=9`).
- `MIN_SUFFICIENT_ACTIVITIES = 15` is the crawl-refresh threshold (matches the existing 15-item candidate slice sent to the LLM).
- Neighborhood shortlist size `K = 6` (existing-`ActivityFamily` neighborhoods first, then POI density).
- Candidate relevance = `interestSimilarity` (embedding cosine similarity, primary term, weight 1.0) + `qualityBonus` (POIs: `weightedScore/5 * 0.2`; curated composites: flat `+0.15`; everything else: `0`). Never a flat neutral prior standing in for a real rating.
- No `interests` supplied (or embeddings unavailable) → ranking falls back to quality-only sort, unchanged from today for a request that gave no interest signal.
- Every new external call (Nominatim, new Overpass query types) must degrade to today's point-scale behavior on failure/timeout/empty result — never throw, never block generation (same defensive pattern `OsmPlacesService` already uses everywhere).
- All new Nominatim/Overpass calls are gated behind the existing `USE_MOCK_MAPS`/`MOCK_MAPS_MODE` cached-wrapper pattern, so tests/CI never hit them unintentionally.

---

### Task 1: Crawl-refresh gate becomes quality-aware, not zero-vs-nonzero

**Files:**
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.ts:159-275`
- Test: `be/src/modules/tours/services/tour-activity-generation.service.spec.ts`

**Interfaces:**
- Consumes: nothing new — same `activitiesService.findAll`, `googlePlacesService.crawlAndSaveActivities`, `buildDbSearchStep` already wired.
- Produces: nothing new — internal behavior change only, same method signature.

- [ ] **Step 1: Write the failing test — crawl fires on a thin-but-nonzero pool**

Add to `tour-activity-generation.service.spec.ts`, inside the top-level `describe('TourActivityGenerationService', ...)` block:

```ts
it('triggers a Google Places crawl when the DB pool is thin but not empty', async () => {
  const thinPoiId = testUuid();
  activitiesService.findAll
    .mockResolvedValueOnce([
      { id: thinPoiId, name: 'Only one place', latitude: -34.62, longitude: -58.37 },
    ])
    .mockResolvedValueOnce([
      { id: thinPoiId, name: 'Only one place', latitude: -34.62, longitude: -58.37 },
    ]);
  prisma.activity.findMany.mockResolvedValue([
    { id: thinPoiId, latitude: -34.62, longitude: -58.37, kind: ActivityKind.POI },
  ]);
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: thinPoiId,
          activityName: 'Only one place',
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Visit it',
          latitude: -34.62,
          longitude: -58.37,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalled();
});

it('does not trigger a crawl once the pool already meets the sufficiency threshold', async () => {
  const fifteenActivities = Array.from({ length: 15 }, (_, i) => ({
    id: testUuid(),
    name: `Place ${i}`,
    latitude: -34.62,
    longitude: -58.37,
  }));
  activitiesService.findAll.mockResolvedValue(fifteenActivities);
  prisma.activity.findMany.mockResolvedValue(
    fifteenActivities.map((a) => ({
      id: a.id,
      latitude: a.latitude,
      longitude: a.longitude,
      kind: ActivityKind.POI,
    })),
  );
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: fifteenActivities[0].id,
          activityName: fifteenActivities[0].name,
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Visit it',
          latitude: -34.62,
          longitude: -58.37,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  expect(googlePlacesService.crawlAndSaveActivities).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts -t "thin but not empty"`
Expected: FAIL — `crawlAndSaveActivities` was not called (today's code only crawls on exactly zero results).

- [ ] **Step 3: Implement the threshold**

In `tour-activity-generation.service.ts`, add a class field next to the existing `logger` field (around line 49-50):

```ts
  private readonly logger = new Logger(TourActivityGenerationService.name);
  // A pool below this size is treated the same as empty — worth a crawl
  // refresh — because it can't fill the ~15-item candidate window the LLM
  // sees. Matches the existing nearbyActivitiesSample.slice(0, 15) below.
  private readonly MIN_SUFFICIENT_ACTIVITIES = 15;
```

Then change line 186 (`if (nearbyActivities.length > 0) {`) to:

```ts
          if (nearbyActivities.length >= this.MIN_SUFFICIENT_ACTIVITIES) {
```

And line 209 (`traceSteps.push(buildDbSearchStep([], radius / 1000));`) — this branch now also runs for a *thin, nonzero* pool, so the trace must show what was actually found before the crawl, not an empty list:

```ts
            traceSteps.push(buildDbSearchStep(nearbyActivities, radius / 1000));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts`
Expected: PASS — both new tests, and all pre-existing tests in this file (the zero-result crawl path and the ≥15-result no-crawl path are both still covered).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/tour-activity-generation.service.ts be/src/modules/tours/services/tour-activity-generation.service.spec.ts
git commit -m "fix(be): trigger crawl refresh on a thin pool, not only an empty one"
```

---

### Task 2: Candidate relevance ranking (pure util)

**Files:**
- Create: `be/src/modules/tours/utils/candidate-ranking.util.ts`
- Test: `be/src/modules/tours/utils/candidate-ranking.util.spec.ts`

**Interfaces:**
- Produces: `RankableCandidate` interface, `rankCandidatesByRelevance<T extends RankableCandidate>(candidates: T[], similarityById: Map<string, number> | null): T[]` — used by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `be/src/modules/tours/utils/candidate-ranking.util.spec.ts`:

```ts
import { rankCandidatesByRelevance, RankableCandidate } from './candidate-ranking.util';

describe('rankCandidatesByRelevance', () => {
  it('falls back to weightedScore-only order when similarityById is null (no interests supplied)', () => {
    const candidates: RankableCandidate[] = [
      { id: 'low', source: 'poi', weightedScore: 3.5 },
      { id: 'high', source: 'poi', weightedScore: 4.8 },
    ];

    const result = rankCandidatesByRelevance(candidates, null);

    expect(result.map((c) => c.id)).toEqual(['high', 'low']);
  });

  it('ranks a lower-rated POI above a higher-rated one when its interest similarity is higher', () => {
    const candidates: RankableCandidate[] = [
      { id: 'high-rated-irrelevant', source: 'poi', weightedScore: 4.9 },
      { id: 'lower-rated-relevant', source: 'poi', weightedScore: 4.0 },
    ];
    const similarityById = new Map([
      ['high-rated-irrelevant', 0.1],
      ['lower-rated-relevant', 0.9],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((c) => c.id)).toEqual(['lower-rated-relevant', 'high-rated-irrelevant']);
  });

  it('gives a curated composite a fixed quality bonus instead of a fake rating', () => {
    const candidates: RankableCandidate[] = [
      { id: 'curated-walk', source: 'composite', isCurated: true },
      { id: 'adhoc-walk', source: 'composite', isCurated: false },
    ];
    const similarityById = new Map([
      ['curated-walk', 0.5],
      ['adhoc-walk', 0.5],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((c) => c.id)).toEqual(['curated-walk', 'adhoc-walk']);
  });

  it('treats a candidate missing from similarityById as zero interest similarity, not an error', () => {
    const candidates: RankableCandidate[] = [
      { id: 'has-embedding', source: 'poi', weightedScore: 3.0 },
      { id: 'no-embedding', source: 'poi', weightedScore: 3.0 },
    ];
    const similarityById = new Map([['has-embedding', 0.8]]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    expect(result.map((c) => c.id)).toEqual(['has-embedding', 'no-embedding']);
  });

  it('lets a POI and a composite compete on the same scale given equal interest similarity', () => {
    const candidates: RankableCandidate[] = [
      { id: 'mediocre-poi', source: 'poi', weightedScore: 3.0 },
      { id: 'curated-walk', source: 'composite', isCurated: true },
    ];
    const similarityById = new Map([
      ['mediocre-poi', 0.5],
      ['curated-walk', 0.5],
    ]);

    const result = rankCandidatesByRelevance(candidates, similarityById);

    // 0.5 + (3.0/5 * 0.2) = 0.62 for the POI vs 0.5 + 0.15 = 0.65 for the
    // curated composite — the composite wins on a mediocre-but-real rating.
    expect(result.map((c) => c.id)).toEqual(['curated-walk', 'mediocre-poi']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test candidate-ranking.util.spec.ts`
Expected: FAIL with "Cannot find module './candidate-ranking.util'"

- [ ] **Step 3: Implement**

Create `be/src/modules/tours/utils/candidate-ranking.util.ts`:

```ts
// Interest-aware, source-agnostic candidate ranking. A POI and a composite
// walk are scored on the same 0-ish scale instead of competing on Google
// rating alone — see docs/superpowers/specs/2026-08-21-activity-engine-design.md,
// "Unified, interest-aware candidate ranking".
export interface RankableCandidate {
  id: string;
  source: 'poi' | 'composite';
  /** POI only — ActivitiesService.findAll's Bayesian-weighted rating, 0-5. */
  weightedScore?: number;
  /** Composite only — true for a pre-vetted generate-templates variant. */
  isCurated?: boolean;
}

const MAX_WEIGHTED_SCORE = 5;
// Small on purpose relative to interestSimilarity's 0-1 range — quality is a
// tie-breaker here, not the primary signal, unlike ActivitiesService.findAll's
// own weightedScore-first sort (which this function does not replace, only
// feeds from, when interests are present).
const POI_QUALITY_WEIGHT = 0.2;
// Deliberately less than POI_QUALITY_WEIGHT's max (0.2) — a curated composite
// is a solid signal but shouldn't automatically outrank a very well-reviewed
// matching POI on interest similarity alone.
const CURATED_COMPOSITE_BONUS = 0.15;

function qualityBonus(candidate: RankableCandidate): number {
  if (candidate.source === 'poi') {
    return ((candidate.weightedScore ?? 0) / MAX_WEIGHTED_SCORE) * POI_QUALITY_WEIGHT;
  }
  return candidate.isCurated ? CURATED_COMPOSITE_BONUS : 0;
}

/**
 * Sorts candidates descending by relevance. With no interest signal
 * (`similarityById === null` — the caller passes this when `interests` is
 * empty or embeddings are unavailable), falls back to exactly today's
 * weightedScore-only order, so a request with no interests keeps its
 * existing behavior. A candidate absent from `similarityById` (no indexed
 * embedding) is treated as zero interest similarity, not an error.
 */
export function rankCandidatesByRelevance<T extends RankableCandidate>(
  candidates: T[],
  similarityById: Map<string, number> | null,
): T[] {
  if (!similarityById) {
    return [...candidates].sort((a, b) => (b.weightedScore ?? 0) - (a.weightedScore ?? 0));
  }

  return [...candidates]
    .map((candidate) => ({
      candidate,
      relevance: (similarityById.get(candidate.id) ?? 0) + qualityBonus(candidate),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((s) => s.candidate);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test candidate-ranking.util.spec.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/candidate-ranking.util.ts be/src/modules/tours/utils/candidate-ranking.util.spec.ts
git commit -m "feat(be): add source-agnostic, interest-aware candidate ranking util"
```

---

### Task 3: VectorStoreService — similarity scores for a specific candidate set

**Files:**
- Modify: `be/src/shared/ai/services/vector-store.service.ts`
- Test: `be/src/shared/ai/services/vector-store.service.spec.ts` (create if it doesn't exist yet — check first with `ls be/src/shared/ai/services/vector-store.service.spec.ts`)

**Interfaces:**
- Consumes: `AiEmbeddingService.getEmbeddings()` (existing), `PrismaService.$queryRaw` (existing).
- Produces: `VectorStoreService.getSimilarityScores(candidateIds: string[], queryText: string): Promise<Map<string, number>>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Create (or extend) `be/src/shared/ai/services/vector-store.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { VectorStoreService } from './vector-store.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { PrismaService } from '../../../core/database/prisma.service';

describe('VectorStoreService.getSimilarityScores', () => {
  let service: VectorStoreService;
  let embeddingService: { getEmbeddings: jest.Mock };
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    embeddingService = { getEmbeddings: jest.fn() };
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorStoreService,
        { provide: AiEmbeddingService, useValue: embeddingService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(VectorStoreService);
  });

  it('returns an empty map without querying when embeddings are unavailable', async () => {
    embeddingService.getEmbeddings.mockReturnValue(null);

    const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

    expect(result.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns an empty map without querying when there are no candidate ids', async () => {
    embeddingService.getEmbeddings.mockReturnValue({ embedQuery: jest.fn() });

    const result = await service.getSimilarityScores([], 'history, art');

    expect(result.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('embeds the query text and returns cosine similarity (1 - distance) per candidate id', async () => {
    const embedQuery = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    embeddingService.getEmbeddings.mockReturnValue({ embedQuery });
    prisma.$queryRaw.mockResolvedValue([
      { id: 'a', distance: 0.2 },
      { id: 'b', distance: 0.9 },
    ]);

    const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

    expect(embedQuery).toHaveBeenCalledWith('history, art');
    expect(result.get('a')).toBeCloseTo(0.8);
    expect(result.get('b')).toBeCloseTo(0.1);
  });

  it('omits candidates that have no indexed embedding rather than defaulting them', async () => {
    const embedQuery = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    embeddingService.getEmbeddings.mockReturnValue({ embedQuery });
    prisma.$queryRaw.mockResolvedValue([{ id: 'a', distance: 0.2 }]);

    const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test vector-store.service.spec.ts -t "getSimilarityScores"`
Expected: FAIL — `service.getSimilarityScores is not a function`.

- [ ] **Step 3: Implement**

In `be/src/shared/ai/services/vector-store.service.ts`, add this method to the `VectorStoreService` class (after `findSimilarActivities`, before `resetVectorStore`):

```ts
  /**
   * Cosine similarity (1 - cosine distance) between an embedding of
   * `queryText` and each of `candidateIds`' own stored embedding — scoped to
   * exactly this candidate set, unlike findSimilarActivities' open-ended
   * top-k search. A candidate with no indexed embedding is simply absent
   * from the returned map (callers treat a missing id as zero similarity),
   * not defaulted to any particular value here.
   */
  async getSimilarityScores(
    candidateIds: string[],
    queryText: string,
  ): Promise<Map<string, number>> {
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings || candidateIds.length === 0) return new Map();

    const queryVector = await embeddings.embedQuery(queryText);
    const literal = this.toVectorLiteral(queryVector);

    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, embedding <=> ${literal}::vector AS distance
      FROM "activity"
      WHERE id IN (${Prisma.join(candidateIds)}) AND embedding IS NOT NULL
    `;

    return new Map(rows.map((row) => [row.id, 1 - row.distance]));
  }
```

Add `Prisma` to the existing import at the top of the file (it currently imports only `Activity` from `@prisma/client`):

```ts
import { Activity, Prisma } from '@prisma/client';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test vector-store.service.spec.ts`
Expected: PASS, all 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/shared/ai/services/vector-store.service.ts be/src/shared/ai/services/vector-store.service.spec.ts
git commit -m "feat(be): add VectorStoreService.getSimilarityScores for a bounded candidate set"
```

---

### Task 4: Wire interest-aware ranking into TourActivityGenerationService

**Files:**
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.ts`
- Modify: `be/src/modules/tours/utils/generation-trace-builder.util.ts:123-137` (`buildEmbeddingsStep`)
- Test: `be/src/modules/tours/services/tour-activity-generation.service.spec.ts`

**Interfaces:**
- Consumes: `rankCandidatesByRelevance` (Task 2), `VectorStoreService.getSimilarityScores` (Task 3), existing `GenerateTourOptions.interests`.
- Produces: candidates offered to the LLM are now interest-ranked before the `slice(0, 15)` truncation; no change to the method's own public signature.

- [ ] **Step 1: Write the failing test**

Add to `tour-activity-generation.service.spec.ts`. First, add `getSimilarityScores: jest.fn().mockResolvedValue(new Map())` to the `VectorStoreService` mock in `beforeEach` — currently `{ provide: VectorStoreService, useValue: {} }` (line 133); change it to a named `vectorStoreService` variable declared alongside the other `let ... : any;` mocks, so tests can override it:

```ts
    vectorStoreService = { getSimilarityScores: jest.fn().mockResolvedValue(new Map()) };
```

and change the provider line to `{ provide: VectorStoreService, useValue: vectorStoreService }`.

Then add the test:

```ts
it('ranks a lower-rated but more relevant POI ahead of a higher-rated irrelevant one when interests are given', async () => {
  const relevantId = testUuid();
  const irrelevantId = testUuid();
  toursService.findOne.mockResolvedValue(
    buildTour({
      metadata: {
        options: {
          latitude: -34.62,
          longitude: -58.37,
          radius: 3000,
          interests: ['history'],
        },
        originalPrompt: 'A tour',
      },
    }),
  );
  activitiesService.findAll.mockResolvedValue(
    Array.from({ length: 16 }, (_, i) => ({
      id: i === 0 ? irrelevantId : i === 1 ? relevantId : testUuid(),
      name: i === 0 ? 'Irrelevant but top-rated' : i === 1 ? 'Relevant history site' : `Filler ${i}`,
      latitude: -34.62,
      longitude: -58.37,
      rating: i === 0 ? 4.9 : 3.5,
      ratingCount: 100,
    })),
  );
  vectorStoreService.getSimilarityScores.mockResolvedValue(
    new Map([
      [irrelevantId, 0.05],
      [relevantId, 0.95],
    ]),
  );
  prisma.activity.findMany.mockResolvedValue([
    { id: relevantId, latitude: -34.62, longitude: -58.37, kind: ActivityKind.POI },
  ]);
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: relevantId,
          activityName: 'Relevant history site',
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Visit it',
          latitude: -34.62,
          longitude: -58.37,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  expect(vectorStoreService.getSimilarityScores).toHaveBeenCalledWith(
    expect.arrayContaining([relevantId, irrelevantId]),
    'history',
  );
  const [, callArgs] = langChainService.generateChatResponse.mock.calls[0];
  // The prompt's "Available activities" text must list the relevant,
  // lower-rated site ahead of the irrelevant, higher-rated one.
  expect(callArgs.indexOf('Relevant history site')).toBeLessThan(
    callArgs.indexOf('Irrelevant but top-rated'),
  );
});

it('scores an existing curated composite variant from findAll by its curated bonus, not a fake rating', async () => {
  const curatedWalkId = testUuid();
  const mediocrePoiId = testUuid();
  toursService.findOne.mockResolvedValue(
    buildTour({
      metadata: {
        options: {
          latitude: -34.62,
          longitude: -58.37,
          radius: 3000,
          interests: ['history'],
        },
        originalPrompt: 'A tour',
      },
    }),
  );
  activitiesService.findAll.mockResolvedValue([
    {
      id: mediocrePoiId,
      name: 'Mediocre plain POI',
      latitude: -34.62,
      longitude: -58.37,
      rating: 3.0,
      ratingCount: 50,
      kind: 'POI',
      weightedScore: 3.2,
    },
    {
      id: curatedWalkId,
      name: 'San Telmo Historic Walk',
      latitude: -34.62,
      longitude: -58.37,
      kind: 'NEIGHBORHOOD_WALK',
      isCurated: true,
      weightedScore: 4.0, // the old flat PRIOR_MEAN default — must NOT be used for a composite
    },
  ]);
  vectorStoreService.getSimilarityScores.mockResolvedValue(
    new Map([
      [mediocrePoiId, 0.5],
      [curatedWalkId, 0.5],
    ]),
  );
  prisma.activity.findMany.mockResolvedValue([
    { id: curatedWalkId, latitude: -34.62, longitude: -58.37, kind: ActivityKind.NEIGHBORHOOD_WALK },
  ]);
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: curatedWalkId,
          activityName: 'San Telmo Historic Walk',
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Walk it',
          latitude: -34.62,
          longitude: -58.37,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  // Equal interest similarity (0.5): the curated composite's +0.15 bonus
  // must be compared against the POI's weightedScore-derived bonus
  // (3.2/5*0.2=0.128), not against the composite's own weightedScore field
  // (which would wrongly put it at 4.0/5*0.2=0.16, an even bigger margin,
  // masking whether the source-based branch actually ran instead of just
  // falling through to the 'poi' formula).
  const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
  expect(promptArg.indexOf('San Telmo Historic Walk')).toBeLessThan(
    promptArg.indexOf('Mediocre plain POI'),
  );
});

it('does not call getSimilarityScores when the tour has no interests', async () => {
  const poiId = testUuid();
  activitiesService.findAll.mockResolvedValue([
    { id: poiId, name: 'Museo', latitude: -34.62, longitude: -58.37 },
  ]);
  prisma.activity.findMany.mockResolvedValue([
    { id: poiId, latitude: -34.62, longitude: -58.37, kind: ActivityKind.POI },
  ]);
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: poiId,
          activityName: 'Museo',
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Visit it',
          latitude: -34.62,
          longitude: -58.37,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  expect(vectorStoreService.getSimilarityScores).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts -t "relevance"`
Expected: FAIL — today's code doesn't call `getSimilarityScores` at all, and orders candidates by rating only, so "Irrelevant but top-rated" appears first.

- [ ] **Step 3: Implement**

In `tour-activity-generation.service.ts`, add imports at the top:

```ts
import { rankCandidatesByRelevance, RankableCandidate } from '../utils/candidate-ranking.util';
```

Replace the two `nearbyActivitiesSample`/`refreshedActivitiesSample` blocks (lines ~194-201 and ~241-251) — both currently do `nearbyActivities.slice(0, 15)` then format directly — with a shared ranking step. Concretely, change:

```ts
            const nearbyActivitiesSample = nearbyActivities.slice(0, 15);
            nearbyActivitiesSample.forEach((act: any) => {
              candidateActivityIds.add(act.id);
              candidateActivitiesById.set(act.id, act);
            });
```

to:

```ts
            const nearbyActivitiesSample = await this.rankAndSliceActivities(
              nearbyActivities,
              options.interests,
            );
            nearbyActivitiesSample.forEach((act: any) => {
              candidateActivityIds.add(act.id);
              candidateActivitiesById.set(act.id, act);
            });
```

and identically for the refreshed-activities block:

```ts
                const refreshedActivitiesSample = await this.rankAndSliceActivities(
                  refreshedActivities,
                  options.interests,
                );
```

Add a new private method to the class (near `updateGenerationStatus`):

```ts
  /**
   * Re-ranks a DB-proximity result set by interest relevance before slicing
   * to the LLM's candidate window — see candidate-ranking.util.ts and
   * docs/superpowers/specs/2026-08-21-activity-engine-design.md. No
   * interests, or embeddings unavailable/failing: falls back to the DB's own
   * weightedScore + distance order (today's exact behavior), sliced the
   * same way.
   */
  private async rankAndSliceActivities(
    activities: any[],
    interests: string[] | undefined,
  ): Promise<any[]> {
    if (!interests || interests.length === 0) {
      return activities.slice(0, 15);
    }

    let similarityById: Map<string, number> | null = null;
    try {
      similarityById = await this.vectorStoreService.getSimilarityScores(
        activities.map((a) => a.id),
        interests.join(', '),
      );
    } catch (error: any) {
      this.logger.warn(
        `Interest-similarity lookup failed, falling back to rating-only ranking: ${error.message}`,
      );
    }

    // A row from ActivitiesService.findAll can itself be an existing
    // composite variant (kind NEIGHBORHOOD_WALK/ROUTE/EXPERIENCE) — those
    // must score as 'composite' (isCurated bonus), never 'poi'
    // (weightedScore), or they'd keep inheriting the exact flat-prior
    // unfairness this design set out to remove (spec root cause #3).
    const rankable: (RankableCandidate & { original: any })[] = activities.map((a) => ({
      id: a.id,
      source: a.kind && a.kind !== 'POI' ? 'composite' : 'poi',
      weightedScore: a.weightedScore,
      isCurated: a.isCurated,
      original: a,
    }));
    return rankCandidatesByRelevance(rankable, similarityById)
      .slice(0, 15)
      .map((r) => r.original);
  }
```

Finally, update the now-stale `buildEmbeddingsStep` in `generation-trace-builder.util.ts` — its summary currently claims embeddings are indexed but never used for selection, which is no longer true when interests are present:

```ts
export function buildEmbeddingsStep(
  offeredCount: number,
  indexedCount: number,
  interestsUsedForRanking: boolean,
): GenerationTraceStep {
  return {
    stage: 'embeddings',
    label: 'Embeddings (pgvector)',
    summary: interestsUsedForRanking
      ? `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
        'usado junto con el rating para priorizar candidatos según los intereses declarados.'
      : `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
        'pero no se usaron para la selección: esta generación no tenía intereses declarados, así que se ' +
        'ordenó únicamente por rating y proximidad.',
  };
}
```

Update its one call site in `tour-activity-generation.service.ts` (search for `buildEmbeddingsStep(offeredIds.length, indexedCount)`) to pass the third argument:

```ts
        traceSteps.push(
          buildEmbeddingsStep(
            offeredIds.length,
            indexedCount,
            !!options.interests?.length,
          ),
        );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts`
Expected: PASS, all tests in the file including the two new ones.

Run: `cd be && yarn test generation-trace-builder`
Expected: PASS (check first whether `generation-trace-builder.util.spec.ts` exists — if it does, its `buildEmbeddingsStep` calls need the new third argument added; if it doesn't exist, skip).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/tour-activity-generation.service.ts be/src/modules/tours/services/tour-activity-generation.service.spec.ts be/src/modules/tours/utils/generation-trace-builder.util.ts
git commit -m "feat(be): rank POI candidates by interest relevance before the LLM sees them"
```

---

### Task 5: Nominatim client — interface + real HTTP service

**Files:**
- Create: `be/src/modules/integrations/osm/interfaces/nominatim.interface.ts`
- Create: `be/src/modules/integrations/osm/services/nominatim-api.service.ts`
- Test: `be/src/modules/integrations/osm/services/nominatim-api.service.spec.ts`

**Interfaces:**
- Produces: `INominatimApiService.search(query: string): Promise<NominatimResult[]>`, `NominatimResult { osmType: 'node' | 'way' | 'relation'; osmId: number; addresstype: string; displayName: string; importance: number }` — used by Task 6 (cache wrapper) and Task 12 (destination resolution).

- [ ] **Step 1: Write the failing test**

Create `be/src/modules/integrations/osm/services/nominatim-api.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NominatimApiService } from './nominatim-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NominatimApiService', () => {
  let service: NominatimApiService;

  beforeEach(() => {
    const configService = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new NominatimApiService(configService);
  });

  it('maps a Nominatim response into NominatimResult[]', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          osm_type: 'relation',
          osm_id: 1224652,
          addresstype: 'city',
          display_name: 'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
          importance: 0.783,
        },
      ],
    });

    const result = await service.search('Buenos Aires');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName: 'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
        importance: 0.783,
      },
    ]);
  });

  it('sends a self-identifying User-Agent (Nominatim usage policy) and a bounded limit', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Barcelona');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/search'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
        params: expect.objectContaining({ q: 'Barcelona', format: 'jsonv2', limit: 5 }),
      }),
    );
  });

  it('returns an empty array (not a throw) when the request fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    const result = await service.search('Barcelona');

    expect(result).toEqual([]);
  });

  it('returns an empty array (not a throw) on timeout', async () => {
    mockedAxios.get.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

    const result = await service.search('Barcelona');

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test nominatim-api.service.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `be/src/modules/integrations/osm/interfaces/nominatim.interface.ts`:

```ts
export interface NominatimResult {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  // Nominatim's own place classification — 'city'/'town'/'village' is what
  // destination-resolution.service.ts uses to decide area-scale vs
  // point-scale; 'state'/'country' and everything finer-grained than a
  // settlement falls back to point-scale. See NEIGHBORHOOD_ADMIN_LEVEL note
  // in osm-places.service.ts for why admin_level alone can't do this job.
  addresstype: string;
  displayName: string;
  importance: number;
}

export interface INominatimApiService {
  search(query: string): Promise<NominatimResult[]>;
}
```

Create `be/src/modules/integrations/osm/services/nominatim-api.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { INominatimApiService, NominatimResult } from '../interfaces/nominatim.interface';

const DEFAULT_API_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_TIMEOUT_MS = 10000;
const RESULT_LIMIT = 5;
// Same self-identification requirement as Overpass's public instance — see
// overpass-api.service.ts's USER_AGENT comment.
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

interface NominatimApiResponseItem {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  addresstype: string;
  display_name: string;
  importance: number;
}

@Injectable()
export class NominatimApiService implements INominatimApiService {
  private readonly logger = new Logger(NominatimApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiUrl(): string {
    return this.configService.get<string>('NOMINATIM_API_URL') || DEFAULT_API_URL;
  }

  private get timeoutMs(): number {
    return parseInt(
      this.configService.get<string>('NOMINATIM_TIMEOUT_MS') || String(DEFAULT_TIMEOUT_MS),
      10,
    );
  }

  async search(query: string): Promise<NominatimResult[]> {
    try {
      const response = await axios.get<NominatimApiResponseItem[]>(this.apiUrl, {
        headers: { 'User-Agent': USER_AGENT },
        params: { q: query, format: 'jsonv2', limit: RESULT_LIMIT },
        timeout: this.timeoutMs,
      });

      return (response.data || []).map((item) => ({
        osmType: item.osm_type,
        osmId: item.osm_id,
        addresstype: item.addresstype,
        displayName: item.display_name,
        importance: item.importance,
      }));
    } catch (error: any) {
      this.logger.warn(`Nominatim search failed for "${query}": ${error.message}`);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test nominatim-api.service.spec.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/integrations/osm/interfaces/nominatim.interface.ts be/src/modules/integrations/osm/services/nominatim-api.service.ts be/src/modules/integrations/osm/services/nominatim-api.service.spec.ts
git commit -m "feat(be): add a Nominatim client for destination name resolution"
```

---

### Task 6: Cached Nominatim wrapper + module wiring

**Files:**
- Create: `be/src/modules/integrations/osm/services/cached-nominatim-api.service.ts`
- Modify: `be/src/modules/integrations/osm/osm.module.ts`
- Test: `be/src/modules/integrations/osm/services/cached-nominatim-api.service.spec.ts`

**Interfaces:**
- Consumes: `INominatimApiService` (Task 5).
- Produces: DI token `'NominatimApiService'` resolving to either the real or cached implementation, mirroring the existing `'OverpassApiService'` token — used by Task 12.

- [ ] **Step 1: Write the failing test**

Create `be/src/modules/integrations/osm/services/cached-nominatim-api.service.spec.ts` (mirrors the shape you'd write for `cached-overpass-api.service.spec.ts` — check first whether that file already exists with `ls be/src/modules/integrations/osm/services/cached-overpass-api.service.spec.ts` and match its exact structure if so; otherwise use this):

```ts
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { CachedNominatimApiService } from './cached-nominatim-api.service';
import { INominatimApiService } from '../interfaces/nominatim.interface';

describe('CachedNominatimApiService', () => {
  let realService: jest.Mocked<INominatimApiService>;
  let service: CachedNominatimApiService;
  const cacheDir = fs.mkdtempSync('/tmp/nominatim-cache-test-');

  beforeEach(() => {
    realService = { search: jest.fn() };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'STORAGE_PATH' ? cacheDir.replace(/\/osm-cache$/, '') : undefined,
      ),
    } as unknown as ConfigService;
    service = new CachedNominatimApiService(configService, realService);
  });

  it('calls the real service and caches the result on a cache miss (write mode default)', async () => {
    realService.search.mockResolvedValue([
      { osmType: 'relation', osmId: 1, addresstype: 'city', displayName: 'Test City', importance: 0.9 },
    ]);

    const result = await service.search('Test City');

    expect(realService.search).toHaveBeenCalledWith('Test City');
    expect(result[0].addresstype).toBe('city');
  });

  it('does not call the real service twice for the same query', async () => {
    realService.search.mockResolvedValue([]);

    await service.search('Repeated Query');
    await service.search('Repeated Query');

    expect(realService.search).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test cached-nominatim-api.service.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `be/src/modules/integrations/osm/services/cached-nominatim-api.service.ts`, mirroring `cached-overpass-api.service.ts`'s caching mechanics exactly (same `MOCK_MAPS_MODE`, same cache-dir/key scheme, under a sibling `nominatim-cache` directory so it never collides with `osm-cache`):

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { INominatimApiService, NominatimResult } from '../interfaces/nominatim.interface';

@Injectable()
export class CachedNominatimApiService implements INominatimApiService {
  private readonly logger = new Logger(CachedNominatimApiService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict';

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealNominatimApiService')
    private readonly realService: INominatimApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') || path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'nominatim-cache');
    this.mode = (this.configService.get<string>('MOCK_MAPS_MODE') as any) || 'read';

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCachePath(query: string): string {
    const hash = crypto.createHash('md5').update(query).digest('hex');
    return path.join(this.cacheDir, `search-${hash}.json`);
  }

  async search(query: string): Promise<NominatimResult[]> {
    const cachePath = this.getCachePath(query);

    if (fs.existsSync(cachePath)) {
      this.logger.log(`[CachedNominatimApiService] Cache hit for "${query}"`);
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedNominatimApiService] Strict mode: cache miss for "${query}" and real API calls are disabled.`,
      );
    }

    this.logger.log(`[CachedNominatimApiService] Cache miss for "${query}". Calling real API...`);
    const result = await this.realService.search(query);

    if (this.mode === 'write') {
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
      } catch (err: any) {
        this.logger.error(`Failed to write Nominatim cache: ${err.message}`);
      }
    }

    return result;
  }
}
```

Modify `be/src/modules/integrations/osm/osm.module.ts` to wire the same real/cached-by-`USE_MOCK_MAPS` pattern already used for Overpass:

```ts
import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OverpassApiService } from './services/overpass-api.service';
import { CachedOverpassApiService } from './services/cached-overpass-api.service';
import { NominatimApiService } from './services/nominatim-api.service';
import { CachedNominatimApiService } from './services/cached-nominatim-api.service';
import { OsmPlacesService } from './services/osm-places.service';
import { IOverpassApiService } from './interfaces/overpass.interface';
import { INominatimApiService } from './interfaces/nominatim.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    OverpassApiService,
    CachedOverpassApiService,
    NominatimApiService,
    CachedNominatimApiService,
    {
      provide: 'RealOverpassApiService',
      useExisting: OverpassApiService,
    },
    {
      provide: 'OverpassApiService',
      useFactory: (
        configService: ConfigService,
        real: IOverpassApiService,
        cached: CachedOverpassApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        if (useMock) {
          const logger = new Logger('OsmModule');
          const mode = configService.get('MOCK_MAPS_MODE') || 'read';
          logger.log(`⚠️  Using MOCK Overpass API (USE_MOCK_MAPS=true, mode=${mode})`);
        }
        return useMock ? cached : real;
      },
      inject: [ConfigService, 'RealOverpassApiService', CachedOverpassApiService],
    },
    {
      provide: 'RealNominatimApiService',
      useExisting: NominatimApiService,
    },
    {
      provide: 'NominatimApiService',
      useFactory: (
        configService: ConfigService,
        real: INominatimApiService,
        cached: CachedNominatimApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        return useMock ? cached : real;
      },
      inject: [ConfigService, 'RealNominatimApiService', CachedNominatimApiService],
    },
    OsmPlacesService,
  ],
  // 'NominatimApiService' is exported alongside OsmPlacesService (not
  // folded behind it) because DestinationResolutionService (tours module,
  // Task 12) injects it directly — OsmPlacesService's own job is Overpass
  // geometry/boundary lookups, not name resolution, so this keeps that
  // separation instead of growing OsmPlacesService a name-search method it
  // doesn't otherwise need.
  exports: [OsmPlacesService, 'NominatimApiService'],
})
export class OsmModule {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test cached-nominatim-api.service.spec.ts`
Expected: PASS, both tests.

Run: `cd be && yarn build`
Expected: compiles cleanly (verifies the module wiring is well-typed).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/integrations/osm/services/cached-nominatim-api.service.ts be/src/modules/integrations/osm/services/cached-nominatim-api.service.spec.ts be/src/modules/integrations/osm/osm.module.ts
git commit -m "feat(be): wire Nominatim behind the existing USE_MOCK_MAPS cache pattern"
```

---

### Task 7: Overpass query builders — boundary-by-id, admin-boundaries-within-area, features-within-area

**Files:**
- Modify: `be/src/modules/integrations/osm/interfaces/overpass.interface.ts`
- Modify: `be/src/modules/integrations/osm/utils/overpass-query.util.ts`
- Test: `be/src/modules/integrations/osm/utils/overpass-query.util.spec.ts`

**Interfaces:**
- Produces: `buildBoundaryByIdQuery`, `buildAdminBoundariesWithinAreaQuery`, `buildStreetsWithinAreaQuery`, `buildPoisWithinAreaQuery` — used by Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `overpass-query.util.spec.ts`:

```ts
import {
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildStreetsWithinAreaQuery,
  buildPoisWithinAreaQuery,
} from './overpass-query.util';

describe('buildBoundaryByIdQuery', () => {
  it('queries a specific relation by id and asks for full geometry', () => {
    const query = buildBoundaryByIdQuery({ osmType: 'relation', osmId: 1224652 });

    expect(query).toContain('relation(1224652)');
    expect(query).toContain('out geom;');
  });

  it('queries a specific way by id when the boundary is a way, not a relation', () => {
    const query = buildBoundaryByIdQuery({ osmType: 'way', osmId: 42 });

    expect(query).toContain('way(42)');
    expect(query).toContain('out geom;');
  });
});

describe('OverpassElement center field', () => {
  it('is typed as optional on OverpassElement, for the out tags center response shape', () => {
    // Compile-time check, not a runtime assertion: buildAdminBoundariesWithinAreaQuery
    // and buildStreetsWithinAreaQuery/buildPoisWithinAreaQuery below all use
    // `out tags center;`, not `out geom;` — deliberately (a city can have
    // dozens of neighborhoods; fetching every one's full polygon would risk
    // the same 413 payload problem street-candidate capping already guards
    // against elsewhere). Overpass's `center` modifier adds a lightweight
    // { lat, lon } to each way/relation instead of full geometry — see
    // osm-geometry.util.ts's centroid fallback (Task 9) for how that's
    // turned into a usable OsmCandidate despite having no polygon.
    const el: import('../interfaces/overpass.interface').OverpassElement = {
      type: 'relation',
      id: 1,
      tags: { name: 'San Telmo' },
      center: { lat: -34.62, lon: -58.37 },
    };
    expect(el.center).toEqual({ lat: -34.62, lon: -58.37 });
  });
});

describe('buildAdminBoundariesWithinAreaQuery', () => {
  it('uses map_to_area on the given relation, not a radius', () => {
    const query = buildAdminBoundariesWithinAreaQuery({ osmType: 'relation', osmId: 1224652 });

    expect(query).toContain('relation(1224652)');
    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('["boundary"="administrative"](area.a)');
    expect(query).not.toContain('around:');
    expect(query).toContain('out tags center;');
  });
});

describe('buildStreetsWithinAreaQuery', () => {
  it('uses map_to_area, filtering named highways, not a radius', () => {
    const query = buildStreetsWithinAreaQuery({ osmType: 'relation', osmId: 2223069 });

    expect(query).toContain('relation(2223069)');
    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('way["highway"]["name"](area.a)');
    expect(query).not.toContain('around:');
  });
});

describe('buildPoisWithinAreaQuery', () => {
  it('uses map_to_area, filtering named tourism/amenity/historic/leisure nodes', () => {
    const query = buildPoisWithinAreaQuery({ osmType: 'relation', osmId: 2223069 });

    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('node["tourism"]["name"](area.a)');
    expect(query).toContain('node["historic"]["name"](area.a)');
    expect(query).not.toContain('around:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test overpass-query.util.spec.ts`
Expected: FAIL — the four new functions don't exist yet.

- [ ] **Step 3: Implement**

Add to `overpass-query.util.ts`, after the existing `buildStreetsQuery`:

```ts
export interface QueryByIdParams {
  osmType: 'way' | 'relation';
  osmId: number;
}

export function buildBoundaryByIdQuery({ osmType, osmId }: QueryByIdParams): string {
  return ['[out:json][timeout:25];', `${osmType}(${osmId});`, 'out geom;'].join('\n');
}

// All three "within area" queries below share the same map_to_area pattern —
// validated live against Overpass in the spike (see docs/superpowers/specs/
// 2026-08-21-activity-engine-design.md, "Spike validation"): a resolved
// relation/way's own real polygon, never a radius guess.
export function buildAdminBoundariesWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    '  relation["boundary"="administrative"](area.a);',
    '  way["boundary"="administrative"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}

export function buildStreetsWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    'way["highway"]["name"](area.a);',
    'out tags center;',
  ].join('\n');
}

export function buildPoisWithinAreaQuery({ osmType, osmId }: QueryByIdParams): string {
  return [
    '[out:json][timeout:30];',
    `${osmType}(${osmId});`,
    'map_to_area->.a;',
    '(',
    '  node["tourism"]["name"](area.a);',
    '  node["amenity"~"^(marketplace|place_of_worship)$"]["name"](area.a);',
    '  node["historic"]["name"](area.a);',
    '  node["leisure"~"^(park|square)$"]["name"](area.a);',
    ');',
    'out tags center;',
  ].join('\n');
}
```

Add the matching param interfaces and method signatures to `overpass.interface.ts` (after the existing `QueryStreetsParams`). Also extend `OverpassElement` itself with the `center` field Overpass's `out center` modifier adds to a way/relation — `buildAdminBoundariesWithinAreaQuery`/`buildStreetsWithinAreaQuery`/`buildPoisWithinAreaQuery` all request `out tags center;` rather than `out geom;` (a city can have dozens of neighborhoods; fetching every one's full polygon risks the same oversized-payload problem the existing street-candidate cap already guards against), so their responses carry a lightweight centroid instead of full geometry:

```ts
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  // Present on nodes.
  lat?: number;
  lon?: number;
  // Present on ways (a simple point sequence).
  geometry?: { lat: number; lon: number }[];
  // Present on relations.
  members?: OverpassRelationMember[];
  // Present on a way/relation fetched with `out center` instead of
  // `out geom` — a lightweight centroid in place of full polygon geometry.
  // See osm-geometry.util.ts's fallback handling (Task 9).
  center?: { lat: number; lon: number };
}

export interface QueryByIdParams {
  osmType: 'way' | 'relation';
  osmId: number;
}
```

and extend `IOverpassApiService`:

```ts
export interface IOverpassApiService {
  queryBoundaryByName(params: QueryBoundaryByNameParams): Promise<OverpassElement[]>;
  queryContainingBoundary(params: QueryContainingBoundaryParams): Promise<OverpassElement[]>;
  queryStreets(params: QueryStreetsParams): Promise<OverpassElement[]>;
  queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryAdminBoundariesWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryStreetsWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
  queryPoisWithinArea(params: QueryByIdParams): Promise<OverpassElement[]>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test overpass-query.util.spec.ts`
Expected: PASS, all new tests (pre-existing ones untouched).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/integrations/osm/interfaces/overpass.interface.ts be/src/modules/integrations/osm/utils/overpass-query.util.ts be/src/modules/integrations/osm/utils/overpass-query.util.spec.ts
git commit -m "feat(be): add map_to_area Overpass query builders for area-scoped exploration"
```

---

### Task 8: Extend OverpassApiService + CachedOverpassApiService with the new queries

**Files:**
- Modify: `be/src/modules/integrations/osm/services/overpass-api.service.ts`
- Modify: `be/src/modules/integrations/osm/services/cached-overpass-api.service.ts`
- Test: `be/src/modules/integrations/osm/services/overpass-api.service.spec.ts` (check if it exists first; if not, this task only needs the `cached-overpass-api.service.spec.ts` coverage below plus Task 9's tests, which exercise these through `OsmPlacesService`)

**Interfaces:**
- Consumes: `buildBoundaryByIdQuery`, `buildAdminBoundariesWithinAreaQuery`, `buildStreetsWithinAreaQuery`, `buildPoisWithinAreaQuery` (Task 7).
- Produces: `IOverpassApiService`'s four new methods, fully implemented on both the real and cached services — used by Task 9.

- [ ] **Step 1: Write the failing test**

Run `ls be/src/modules/integrations/osm/services/cached-overpass-api.service.spec.ts` first. If it already exists, add the block below into its existing `describe('CachedOverpassApiService', ...)` body, reusing its existing `service`/`realService`/`configService` setup. If it does not exist, create it with this full content:

```ts
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CachedOverpassApiService } from './cached-overpass-api.service';
import { IOverpassApiService } from '../interfaces/overpass.interface';

describe('CachedOverpassApiService', () => {
  let realService: jest.Mocked<IOverpassApiService>;
  let configService: ConfigService;
  let service: CachedOverpassApiService;

  beforeEach(() => {
    const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'overpass-cache-test-'));
    realService = {
      queryBoundaryByName: jest.fn(),
      queryContainingBoundary: jest.fn(),
      queryStreets: jest.fn(),
      queryBoundaryById: jest.fn(),
      queryAdminBoundariesWithinArea: jest.fn(),
      queryStreetsWithinArea: jest.fn(),
      queryPoisWithinArea: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => (key === 'STORAGE_PATH' ? storagePath : undefined)),
    } as unknown as ConfigService;
    service = new CachedOverpassApiService(configService, realService);
  });

  it('delegates queryBoundaryById to the real service and caches by params', async () => {
    realService.queryBoundaryById.mockResolvedValue([]);

    await service.queryBoundaryById({ osmType: 'relation', osmId: 1224652 });
    await service.queryBoundaryById({ osmType: 'relation', osmId: 1224652 });

    expect(realService.queryBoundaryById).toHaveBeenCalledTimes(1);
  });

  it('delegates queryAdminBoundariesWithinArea to the real service and caches by params', async () => {
    realService.queryAdminBoundariesWithinArea.mockResolvedValue([]);

    await service.queryAdminBoundariesWithinArea({ osmType: 'relation', osmId: 1224652 });
    await service.queryAdminBoundariesWithinArea({ osmType: 'relation', osmId: 1224652 });

    expect(realService.queryAdminBoundariesWithinArea).toHaveBeenCalledTimes(1);
  });

  it('delegates queryStreetsWithinArea to the real service and caches by params', async () => {
    realService.queryStreetsWithinArea.mockResolvedValue([]);

    await service.queryStreetsWithinArea({ osmType: 'relation', osmId: 2223069 });
    await service.queryStreetsWithinArea({ osmType: 'relation', osmId: 2223069 });

    expect(realService.queryStreetsWithinArea).toHaveBeenCalledTimes(1);
  });

  it('delegates queryPoisWithinArea to the real service and caches by params', async () => {
    realService.queryPoisWithinArea.mockResolvedValue([]);

    await service.queryPoisWithinArea({ osmType: 'relation', osmId: 2223069 });
    await service.queryPoisWithinArea({ osmType: 'relation', osmId: 2223069 });

    expect(realService.queryPoisWithinArea).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test cached-overpass-api.service.spec.ts`
Expected: FAIL — `queryStreetsWithinArea` doesn't exist on `CachedOverpassApiService` yet.

- [ ] **Step 3: Implement**

In `overpass-api.service.ts`, add the new imports:

```ts
import {
  IOverpassApiService,
  OverpassElement,
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
} from '../interfaces/overpass.interface';
import {
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildStreetsWithinAreaQuery,
  buildPoisWithinAreaQuery,
} from '../utils/overpass-query.util';
```

Add these four methods to the `OverpassApiService` class, after `queryStreets`:

```ts
  async queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.execute(buildBoundaryByIdQuery(params));
  }

  async queryAdminBoundariesWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.execute(buildAdminBoundariesWithinAreaQuery(params));
  }

  async queryStreetsWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.execute(buildStreetsWithinAreaQuery(params));
  }

  async queryPoisWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.execute(buildPoisWithinAreaQuery(params));
  }
```

In `cached-overpass-api.service.ts`, add the same import addition (`QueryByIdParams`) and these four methods to `CachedOverpassApiService`, after `queryStreets`:

```ts
  async queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryBoundaryById', params, () =>
      this.realService.queryBoundaryById(params),
    );
  }

  async queryAdminBoundariesWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryAdminBoundariesWithinArea', params, () =>
      this.realService.queryAdminBoundariesWithinArea(params),
    );
  }

  async queryStreetsWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryStreetsWithinArea', params, () =>
      this.realService.queryStreetsWithinArea(params),
    );
  }

  async queryPoisWithinArea(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryPoisWithinArea', params, () =>
      this.realService.queryPoisWithinArea(params),
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test cached-overpass-api.service.spec.ts overpass-api.service.spec.ts`
Expected: PASS.

Run: `cd be && yarn typecheck`
Expected: no errors — confirms both classes still fully satisfy `IOverpassApiService`.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/integrations/osm/services/overpass-api.service.ts be/src/modules/integrations/osm/services/cached-overpass-api.service.ts be/src/modules/integrations/osm/services/cached-overpass-api.service.spec.ts
git commit -m "feat(be): implement the new area-scoped Overpass queries on both services"
```

---

### Task 9: OsmPlacesService — findNeighborhoodsWithin, findStreetsWithin, findPoisWithin, getBoundaryById

**Files:**
- Modify: `be/src/modules/integrations/osm/services/osm-places.service.ts`
- Modify: `be/src/modules/integrations/osm/utils/osm-geometry.util.ts`
- Modify: `be/src/modules/activities/services/composite-activity.service.ts` (only `centroidOfGeometry`, see Step 3 — required because it's the other consumer of the `GeoJsonGeometry` union this task extends)
- Test: `be/src/modules/integrations/osm/services/osm-places.service.spec.ts`
- Test: `be/src/modules/activities/services/composite-activity.service.spec.ts` (check it exists with `ls`; add the one test below to its existing suite)

**Interfaces:**
- Consumes: `IOverpassApiService`'s four new methods (Task 8), existing `OsmCandidate`/`toCandidate`.
- Produces: `OsmPlacesService.getBoundaryById(osmType, osmId): Promise<OsmCandidate | null>`, `findNeighborhoodsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]>`, `findStreetsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]>`, `findPoisWithin(boundary: OsmCandidate): Promise<OsmCandidate[]>` — used by Task 11 (shortlist scoring glue), Task 12, Task 13.

- [ ] **Step 1: Write the failing tests**

Add to `osm-places.service.spec.ts`. First extend the `overpassApi` mock in `setup()` (around line 14-18) to include the four new methods:

```ts
    overpassApi = {
      queryBoundaryByName: jest.fn(),
      queryContainingBoundary: jest.fn(),
      queryStreets: jest.fn(),
      queryBoundaryById: jest.fn(),
      queryAdminBoundariesWithinArea: jest.fn(),
      queryStreetsWithinArea: jest.fn(),
      queryPoisWithinArea: jest.fn(),
    };
```

Then add:

```ts
describe('getBoundaryById', () => {
  it('maps a resolved relation into an OsmCandidate', async () => {
    const relation: OverpassElement = {
      type: 'relation',
      id: 1224652,
      tags: { name: 'Buenos Aires', admin_level: '8' },
      members: [
        {
          type: 'way',
          ref: 1,
          role: 'outer',
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    };
    overpassApi.queryBoundaryById.mockResolvedValue([relation]);

    const result = await service.getBoundaryById('relation', 1224652);

    expect(result?.id).toBe('osm:relation:1224652');
    expect(result?.tags.admin_level).toBe('8');
  });

  it('returns null (not a throw) when Overpass fails', async () => {
    overpassApi.queryBoundaryById.mockRejectedValue(new Error('down'));

    const result = await service.getBoundaryById('relation', 1);

    expect(result).toBeNull();
  });

  it('returns null when nothing is returned', async () => {
    overpassApi.queryBoundaryById.mockResolvedValue([]);

    const result = await service.getBoundaryById('relation', 1);

    expect(result).toBeNull();
  });
});

describe('findNeighborhoodsWithin', () => {
  const cityBoundary = {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation' as const,
    osmId: 1224652,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name: 'Buenos Aires', admin_level: '8' },
  };

  it('filters to admin_level = city level + 1, relative, not a fixed absolute range', async () => {
    // `out tags center` (buildAdminBoundariesWithinAreaQuery) — no
    // members/geometry, only a lightweight centroid. See osm-geometry.util.ts's
    // center fallback.
    const sanTelmo: OverpassElement = {
      type: 'relation',
      id: 2223069,
      tags: { name: 'San Telmo', admin_level: '9' },
      center: { lat: -34.62, lon: -58.37 },
    };
    const comuna: OverpassElement = {
      type: 'relation',
      id: 4261029,
      tags: { name: 'Comuna 1', admin_level: '5' },
      center: { lat: -34.61, lon: -58.38 },
    };
    const country: OverpassElement = {
      type: 'relation',
      id: 286393,
      tags: { name: 'Argentina', admin_level: '2' },
      center: { lat: -34.0, lon: -64.0 },
    };
    overpassApi.queryAdminBoundariesWithinArea.mockResolvedValue([sanTelmo, comuna, country]);

    const result = await service.findNeighborhoodsWithin(cityBoundary);

    expect(result.map((c) => c.name)).toEqual(['San Telmo']);
  });

  it('returns an empty array (not a throw) when Overpass fails', async () => {
    overpassApi.queryAdminBoundariesWithinArea.mockRejectedValue(new Error('down'));

    const result = await service.findNeighborhoodsWithin(cityBoundary);

    expect(result).toEqual([]);
  });
});

describe('findStreetsWithin', () => {
  const neighborhood = {
    id: 'osm:relation:2223069',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 2223069,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name: 'San Telmo' },
  };

  it('maps named ways within the area into OsmCandidate[], falling back to their center (out tags center has no line geometry)', async () => {
    overpassApi.queryStreetsWithinArea.mockResolvedValue([
      {
        type: 'way',
        id: 47521387,
        tags: { name: 'Defensa', highway: 'pedestrian' },
        center: { lat: -34.621, lon: -58.371 },
      },
    ]);

    const result = await service.findStreetsWithin(neighborhood);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'osm:way:47521387',
        name: 'Defensa',
        geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
      }),
    ]);
  });

  it('returns an empty array (not a throw) when Overpass fails', async () => {
    overpassApi.queryStreetsWithinArea.mockRejectedValue(new Error('down'));

    const result = await service.findStreetsWithin(neighborhood);

    expect(result).toEqual([]);
  });
});

describe('findPoisWithin', () => {
  const neighborhood = {
    id: 'osm:relation:2223069',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 2223069,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name: 'San Telmo' },
  };

  it('maps named tourism/historic/etc nodes within the area into OsmCandidate[]', async () => {
    overpassApi.queryPoisWithinArea.mockResolvedValue([
      {
        type: 'node',
        id: 123,
        tags: { name: 'Casa Mínima', historic: 'yes' },
        lat: -34.621,
        lon: -58.371,
      },
    ]);

    const result = await service.findPoisWithin(neighborhood);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'osm:node:123',
        name: 'Casa Mínima',
        geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
      }),
    ]);
  });

  it('returns an empty array (not a throw) when Overpass fails', async () => {
    overpassApi.queryPoisWithinArea.mockRejectedValue(new Error('down'));

    const result = await service.findPoisWithin(neighborhood);

    expect(result).toEqual([]);
  });
});
```

Note two gaps `toCandidate` (shared by every method in this file) will hit with these new element shapes, both fixed in Step 3:
1. A `node` element (a POI) has no `geometry`/`members` array at all — `overpassElementToGeoJson` only handles `'way'`/`'relation'` today and returns `null` for anything else, so `toCandidate` would drop every POI node.
2. A `way`/`relation` fetched via `out tags center` (findNeighborhoodsWithin's query) has no `members`/`geometry` either — only the new `center` field (Task 7) — so the *existing* way/relation branches would also return `null` for these, dropping every neighborhood.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test osm-places.service.spec.ts`
Expected: FAIL — `getBoundaryById`, `findNeighborhoodsWithin`, `findStreetsWithin`, `findPoisWithin` don't exist yet.

- [ ] **Step 3: Implement**

First, fix node geometry handling in `be/src/modules/integrations/osm/utils/osm-geometry.util.ts` — add a `Point` case and handle nodes in `overpassElementToGeoJson`:

```ts
export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: LonLat[][] }
  | { type: 'MultiPolygon'; coordinates: LonLat[][][] }
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Point'; coordinates: LonLat };
```

and in `overpassElementToGeoJson`:

```ts
export function overpassElementToGeoJson(
  element: OverpassElement,
): GeoJsonGeometry | null {
  if (element.type === 'node') {
    if (element.lat == null || element.lon == null) return null;
    return { type: 'Point', coordinates: [element.lon, element.lat] };
  }

  const detailed =
    element.type === 'way' ? wayToGeoJson(element) : relationToGeoJson(element);
  if (detailed) return detailed;

  // A way/relation fetched with `out center` instead of `out geom` (see
  // findNeighborhoodsWithin) carries no members/geometry — fall back to its
  // lightweight centroid rather than dropping it. Only reached when the
  // element genuinely has no detailed geometry (the `out geom` case above
  // always wins when present, unchanged from today).
  if (element.center) {
    return { type: 'Point', coordinates: [element.center.lon, element.center.lat] };
  }

  return null;
}
```

Now, in `osm-places.service.ts`, add the four new methods after `findBoundaryByName`:

```ts
  /**
   * A specific boundary already identified by id (e.g. from
   * DestinationResolutionService's Nominatim lookup) — as opposed to
   * findContainingBoundary (point-based) or findBoundaryByName (name-based
   * search near a point). Never throws, same defensive fallback as its
   * siblings.
   */
  async getBoundaryById(
    osmType: 'way' | 'relation',
    osmId: number,
  ): Promise<OsmCandidate | null> {
    try {
      const elements = await this.overpassApi.queryBoundaryById({ osmType, osmId });
      const candidates = elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
      return candidates[0] ?? null;
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryBoundaryById failed for ${osmType}/${osmId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Real named neighborhoods inside a resolved city boundary — a true
   * polygon-containment query (map_to_area), not one arbitrary point's
   * containing boundary. Filtered to admin_level = the city's own level + 1,
   * relative rather than a fixed absolute range: the spike showed
   * admin_level semantics vary by country (Buenos Aires' own city boundary
   * is admin_level=8, immediately adjacent to its real barrios at
   * admin_level=9) — see docs/superpowers/specs/2026-08-21-activity-engine-
   * design.md. Never throws.
   */
  async findNeighborhoodsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    const cityAdminLevel = parseInt(boundary.tags.admin_level || '', 10);
    if (isNaN(cityAdminLevel)) return [];

    try {
      const elements = await this.overpassApi.queryAdminBoundariesWithinArea({
        osmType: boundary.osmType,
        osmId: boundary.osmId,
      });
      return elements
        .filter((el) => parseInt(el.tags?.admin_level || '', 10) === cityAdminLevel + 1)
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryAdminBoundariesWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Named streets within a resolved neighborhood's own polygon — replaces
   * findStreetsNear's radius guess for the area-scale path (point-scale
   * destinations still use findStreetsNear, which has no polygon of its
   * own to query against). Never throws.
   */
  async findStreetsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    try {
      const elements = await this.overpassApi.queryStreetsWithinArea({
        osmType: boundary.osmType,
        osmId: boundary.osmId,
      });
      return elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryStreetsWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Named tourism/historic/etc POI nodes within a resolved neighborhood's
   * own polygon. Never throws.
   */
  async findPoisWithin(boundary: OsmCandidate): Promise<OsmCandidate[]> {
    try {
      const elements = await this.overpassApi.queryPoisWithinArea({
        osmType: boundary.osmType,
        osmId: boundary.osmId,
      });
      return elements
        .map((el) => this.toCandidate(el))
        .filter((c): c is OsmCandidate => c !== null);
    } catch (error: any) {
      this.logger.warn(
        `Overpass queryPoisWithinArea failed for ${boundary.id}: ${error.message}`,
      );
      return [];
    }
  }
```

Adding `'Point'` to the shared `GeoJsonGeometry` union has one more consumer that must be updated in the same task: `CompositeActivityService.centroidOfGeometry` (`be/src/modules/activities/services/composite-activity.service.ts:108-122`) is called from `resolveWaypointActivity` for *any* `osm:`-prefixed waypoint id — including a POI node the LLM picks directly as a composite stop (exactly what happened in the spike: `osm:node:1123575836` etc. were chosen as real waypoints). Today it only branches on `'LineString'`/`'Polygon'`/else-assume-`'MultiPolygon'`; a `'Point'` would silently fall into the `MultiPolygon` branch and index into a tuple that isn't nested, either throwing or returning garbage. Add an explicit branch:

```ts
  private centroidOfGeometry(geometry: GeoJsonGeometry): {
    latitude: number;
    longitude: number;
  } {
    if (geometry.type === 'Point') {
      return { latitude: geometry.coordinates[1], longitude: geometry.coordinates[0] };
    }

    const ring: [number, number][] =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];

    const longitude = ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
    const latitude = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    return { latitude, longitude };
  }
```

Add this test inside the existing `describe('waypoint token materialization', ...)` block in `composite-activity.service.spec.ts` (right after the `'materializes an "osm:way:…" token as kind: ROUTE, never POI'` test at line ~264-310), reusing that block's own `osmCandidate()` fixture helper and `prisma`/`service` from the outer `beforeEach`:

```ts
it('materializes an "osm:node:…" POI token (Point geometry) without throwing', async () => {
  const poi = await prisma.activity.create({
    data: {
      name: 'Plaza Dorrego',
      kind: ActivityKind.POI,
      latitude: -34.62,
      longitude: -58.37,
    },
  });

  const nodeCandidate = osmCandidate({
    id: 'osm:node:123',
    osmType: 'node',
    osmId: 123,
    name: 'Casa Mínima',
    geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
    tags: { name: 'Casa Mínima', historic: 'yes' },
  });

  const variant = await service.createOrReuseComposite({
    name: 'San Telmo Historic Walk',
    kind: ActivityKind.NEIGHBORHOOD_WALK,
    variantTheme: VariantTheme.HISTORY,
    areaCandidate: osmCandidate(),
    waypointIds: [poi.id, 'osm:node:123'],
    candidateOsmFeaturesById: new Map([['osm:node:123', nodeCandidate]]),
  });

  const rows = await prisma.activityWaypoint.findMany({
    where: { compositeActivityId: variant.id },
  });
  const materialized = await prisma.activity.findUnique({
    where: {
      id: rows.find((r: any) => r.waypointActivityId !== poi.id).waypointActivityId,
    },
  });

  expect(materialized.kind).toBe(ActivityKind.ROUTE);
  expect(materialized.latitude).toBeCloseTo(-34.621);
  expect(materialized.longitude).toBeCloseTo(-58.371);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test osm-places.service.spec.ts osm-geometry.util.spec.ts composite-activity.service.spec.ts`
Expected: PASS. Check `osm-geometry.util.spec.ts`'s existing tests still pass unchanged (the `Point` addition is additive, not a breaking change to `Polygon`/`MultiPolygon`/`LineString` handling).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/integrations/osm/services/osm-places.service.ts be/src/modules/integrations/osm/services/osm-places.service.spec.ts be/src/modules/integrations/osm/utils/osm-geometry.util.ts be/src/modules/activities/services/composite-activity.service.ts be/src/modules/activities/services/composite-activity.service.spec.ts
git commit -m "feat(be): add polygon-scoped neighborhood/street/POI queries to OsmPlacesService"
```

---

### Task 10: Geometry search-area util — boundingBoxToCenterRadius

**Files:**
- Create: `be/src/modules/tours/utils/geometry-search-area.util.ts`
- Test: `be/src/modules/tours/utils/geometry-search-area.util.spec.ts`

**Interfaces:**
- Consumes: `GeoJsonGeometry` (from `@integrations/osm/utils/osm-geometry.util`).
- Produces: `boundingBoxToCenterRadius(geometry: GeoJsonGeometry): { latitude: number; longitude: number; radiusMeters: number }` — used by Task 13 to bound the existing `ActivitiesService.findAll` call by a resolved city's real geometry instead of the FE-derived viewport radius.

- [ ] **Step 1: Write the failing test**

Create `be/src/modules/tours/utils/geometry-search-area.util.spec.ts`:

```ts
import { boundingBoxToCenterRadius } from './geometry-search-area.util';

describe('boundingBoxToCenterRadius', () => {
  it('centers on the midpoint of a Polygon bounding box', () => {
    const result = boundingBoxToCenterRadius({
      type: 'Polygon',
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    });

    expect(result.latitude).toBeCloseTo(-34.615, 2);
    expect(result.longitude).toBeCloseTo(-58.43, 2);
    expect(result.radiusMeters).toBeGreaterThan(0);
  });

  it('covers every ring across a MultiPolygon (exclaves), not just the first', () => {
    const result = boundingBoxToCenterRadius({
      type: 'MultiPolygon',
      coordinates: [
        [[[-58.40, -34.60], [-58.39, -34.60], [-58.39, -34.59], [-58.40, -34.59], [-58.40, -34.60]]],
        [[[-58.30, -34.50], [-58.29, -34.50], [-58.29, -34.49], [-58.30, -34.49], [-58.30, -34.50]]],
      ],
    });

    // The radius must be large enough to span both disjoint exclaves, not
    // just the first polygon's own tiny bounding box.
    expect(result.radiusMeters).toBeGreaterThan(10000);
  });

  it('returns a radius large enough that every corner is actually inside it', () => {
    const geometry: import('@integrations/osm/utils/osm-geometry.util').GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    };
    const { latitude, longitude, radiusMeters } = boundingBoxToCenterRadius(geometry);

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    for (const [lon, lat] of geometry.coordinates[0]) {
      expect(haversine(latitude, longitude, lat, lon)).toBeLessThanOrEqual(radiusMeters + 1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test geometry-search-area.util.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `be/src/modules/tours/utils/geometry-search-area.util.ts`:

```ts
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function collectAllPoints(geometry: GeoJsonGeometry): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  const pushRing = (ring: [number, number][]) => {
    for (const [lon, lat] of ring) points.push({ lat, lon });
  };

  if (geometry.type === 'Point') {
    points.push({ lat: geometry.coordinates[1], lon: geometry.coordinates[0] });
  } else if (geometry.type === 'LineString') {
    pushRing(geometry.coordinates);
  } else if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(pushRing);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) => polygon.forEach(pushRing));
  }
  return points;
}

/**
 * Derives a center+radius that fully covers a real boundary's own geometry —
 * used to bound ActivitiesService.findAll (still a center+radius query) by
 * a resolved city's actual extent instead of an autocomplete viewport
 * guess. See docs/superpowers/specs/2026-08-21-activity-engine-design.md,
 * "POI sourcing at area scale".
 */
export function boundingBoxToCenterRadius(
  geometry: GeoJsonGeometry,
): { latitude: number; longitude: number; radiusMeters: number } {
  const points = collectAllPoints(geometry);
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  const radiusMeters = Math.max(
    ...points.map((p) => haversineMeters(center, p)),
  );

  return { latitude: center.lat, longitude: center.lon, radiusMeters };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test geometry-search-area.util.spec.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/geometry-search-area.util.ts be/src/modules/tours/utils/geometry-search-area.util.spec.ts
git commit -m "feat(be): derive a search center+radius from a real boundary's own geometry"
```

---

### Task 11: Neighborhood shortlist scoring (pure util)

**Files:**
- Create: `be/src/modules/tours/utils/neighborhood-shortlist.util.ts`
- Test: `be/src/modules/tours/utils/neighborhood-shortlist.util.spec.ts`

**Interfaces:**
- Consumes: `OsmCandidate` (existing).
- Produces: `NeighborhoodScoringInput { candidate: OsmCandidate; hasExistingFamily: boolean; poiCount: number }`, `shortlistNeighborhoods(inputs: NeighborhoodScoringInput[], k?: number): OsmCandidate[]` — used by Task 13 (which supplies `hasExistingFamily`/`poiCount` via Prisma queries).

- [ ] **Step 1: Write the failing tests**

Create `be/src/modules/tours/utils/neighborhood-shortlist.util.spec.ts`:

```ts
import { shortlistNeighborhoods, NeighborhoodScoringInput } from './neighborhood-shortlist.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

function candidate(name: string): OsmCandidate {
  return {
    id: `osm:relation:${name}`,
    name,
    osmType: 'relation',
    osmId: 1,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name },
  };
}

describe('shortlistNeighborhoods', () => {
  it('prioritizes a neighborhood with an existing curated family over one with more raw POIs', () => {
    const inputs: NeighborhoodScoringInput[] = [
      { candidate: candidate('Cold but POI-dense'), hasExistingFamily: false, poiCount: 100 },
      { candidate: candidate('San Telmo'), hasExistingFamily: true, poiCount: 5 },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result[0].name).toBe('San Telmo');
  });

  it('among neighborhoods with the same existing-family status, ranks by POI density', () => {
    const inputs: NeighborhoodScoringInput[] = [
      { candidate: candidate('Sparse'), hasExistingFamily: false, poiCount: 2 },
      { candidate: candidate('Dense'), hasExistingFamily: false, poiCount: 50 },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result.map((c) => c.name)).toEqual(['Dense', 'Sparse']);
  });

  it('caps the result to k (default 6)', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from({ length: 20 }, (_, i) => ({
      candidate: candidate(`Neighborhood ${i}`),
      hasExistingFamily: false,
      poiCount: i,
    }));

    const result = shortlistNeighborhoods(inputs);

    expect(result).toHaveLength(6);
  });

  it('respects an explicit k override', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from({ length: 10 }, (_, i) => ({
      candidate: candidate(`Neighborhood ${i}`),
      hasExistingFamily: false,
      poiCount: i,
    }));

    const result = shortlistNeighborhoods(inputs, 3);

    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test neighborhood-shortlist.util.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `be/src/modules/tours/utils/neighborhood-shortlist.util.ts`:

```ts
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

export interface NeighborhoodScoringInput {
  candidate: OsmCandidate;
  /** True if this neighborhood already has a curated ActivityFamily. */
  hasExistingFamily: boolean;
  /** Cheap proxy for "this is a real, interesting area" — see spec §2. */
  poiCount: number;
}

const DEFAULT_SHORTLIST_SIZE = 6;

/**
 * A city can return dozens of real neighborhoods (Buenos Aires alone has
 * 48) — not all are worth exploring per generation. Existing-family
 * neighborhoods come first (near-zero marginal cost, reuses trusted
 * content), then POI density as a tie-breaker. See
 * docs/superpowers/specs/2026-08-21-activity-engine-design.md, "Area-scale
 * exploration".
 */
export function shortlistNeighborhoods(
  inputs: NeighborhoodScoringInput[],
  k: number = DEFAULT_SHORTLIST_SIZE,
): OsmCandidate[] {
  return [...inputs]
    .sort((a, b) => {
      if (a.hasExistingFamily !== b.hasExistingFamily) {
        return a.hasExistingFamily ? -1 : 1;
      }
      return b.poiCount - a.poiCount;
    })
    .slice(0, k)
    .map((input) => input.candidate);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test neighborhood-shortlist.util.spec.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/neighborhood-shortlist.util.ts be/src/modules/tours/utils/neighborhood-shortlist.util.spec.ts
git commit -m "feat(be): add neighborhood shortlist scoring (existing families first, then POI density)"
```

---

### Task 12: DestinationResolutionService — point-scale vs. area-scale

**Files:**
- Create: `be/src/modules/tours/services/destination-resolution.service.ts`
- Create: `be/src/modules/tours/services/destination-resolution.service.spec.ts`
- Modify: `be/src/modules/tours/tours.module.ts` (register the new provider)

**Interfaces:**
- Consumes: `INominatimApiService` (Task 5/6, injected via `'NominatimApiService'` token), `OsmPlacesService.getBoundaryById` (Task 9), `CompositeActivityService.resolveArea` (existing).
- Produces: `DestinationResolutionService.resolveDestination(destinationText: string | undefined): Promise<DestinationResolution>` where `type DestinationResolution = { scale: 'point' } | { scale: 'area'; areaActivity: Activity; boundary: OsmCandidate }` — used by Task 13.

- [ ] **Step 1: Write the failing tests**

Create `be/src/modules/tours/services/destination-resolution.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind } from '@prisma/client';
import { DestinationResolutionService } from './destination-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';

describe('DestinationResolutionService', () => {
  let service: DestinationResolutionService;
  let nominatimApi: { search: jest.Mock };
  let osmPlacesService: { getBoundaryById: jest.Mock };
  let compositeActivityService: { resolveArea: jest.Mock };

  beforeEach(async () => {
    nominatimApi = { search: jest.fn() };
    osmPlacesService = { getBoundaryById: jest.fn() };
    compositeActivityService = { resolveArea: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DestinationResolutionService,
        { provide: 'NominatimApiService', useValue: nominatimApi },
        { provide: OsmPlacesService, useValue: osmPlacesService },
        { provide: CompositeActivityService, useValue: compositeActivityService },
      ],
    }).compile();

    service = module.get(DestinationResolutionService);
  });

  it('resolves a city-addresstype result to area-scale and persists the AREA activity', async () => {
    nominatimApi.search.mockResolvedValue([
      { osmType: 'relation', osmId: 1224652, addresstype: 'city', displayName: 'Buenos Aires', importance: 0.8 },
    ]);
    const boundary = {
      id: 'osm:relation:1224652',
      name: 'Buenos Aires',
      osmType: 'relation' as const,
      osmId: 1224652,
      geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      tags: { name: 'Buenos Aires', admin_level: '8' },
    };
    osmPlacesService.getBoundaryById.mockResolvedValue(boundary);
    const areaActivity = { id: 'area-1', kind: ActivityKind.AREA, name: 'Buenos Aires' };
    compositeActivityService.resolveArea.mockResolvedValue(areaActivity);

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({ scale: 'area', areaActivity, boundary });
    expect(compositeActivityService.resolveArea).toHaveBeenCalledWith(boundary);
  });

  it.each(['state', 'country'])(
    'falls back to point-scale for a %s-level Nominatim result',
    async (addresstype) => {
      nominatimApi.search.mockResolvedValue([
        { osmType: 'relation', osmId: 1, addresstype, displayName: 'x', importance: 0.9 },
      ]);

      const result = await service.resolveDestination('Some place');

      expect(result).toEqual({ scale: 'point' });
      expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
    },
  );

  it('falls back to point-scale when Nominatim returns nothing', async () => {
    nominatimApi.search.mockResolvedValue([]);

    const result = await service.resolveDestination('123 Main St');

    expect(result).toEqual({ scale: 'point' });
  });

  it('falls back to point-scale when no destination text is given', async () => {
    const result = await service.resolveDestination(undefined);

    expect(result).toEqual({ scale: 'point' });
    expect(nominatimApi.search).not.toHaveBeenCalled();
  });

  it('falls back to point-scale when the resolved boundary geometry cannot be fetched', async () => {
    nominatimApi.search.mockResolvedValue([
      { osmType: 'relation', osmId: 1224652, addresstype: 'city', displayName: 'Buenos Aires', importance: 0.8 },
    ]);
    osmPlacesService.getBoundaryById.mockResolvedValue(null);

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({ scale: 'point' });
  });

  it('falls back to point-scale (never throws) when Nominatim itself fails', async () => {
    nominatimApi.search.mockRejectedValue(new Error('network down'));

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({ scale: 'point' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test destination-resolution.service.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `be/src/modules/tours/services/destination-resolution.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Activity } from '@prisma/client';
import { OsmPlacesService, OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';

// Nominatim's own place classification for a destination big enough to have
// internal structure worth exploring — see docs/superpowers/specs/
// 2026-08-21-activity-engine-design.md, "Destination resolution". Anything
// finer-grained (a house, a specific amenity) or a state/country (out of
// scope per the design) falls back to point-scale.
const AREA_SCALE_ADDRESS_TYPES = new Set(['city', 'town', 'village']);

export type DestinationResolution =
  | { scale: 'point' }
  | { scale: 'area'; areaActivity: Activity; boundary: OsmCandidate };

@Injectable()
export class DestinationResolutionService {
  private readonly logger = new Logger(DestinationResolutionService.name);

  constructor(
    @Inject('NominatimApiService')
    private readonly nominatimApi: INominatimApiService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly compositeActivityService: CompositeActivityService,
  ) {}

  /**
   * Point-scale vs. area-scale, per the design's core reframing: a city
   * should never collapse to a point+radius. Degrades to point-scale (never
   * throws) on any failure — this must never block the point-scale flow
   * that already works today.
   */
  async resolveDestination(destinationText: string | undefined): Promise<DestinationResolution> {
    if (!destinationText) return { scale: 'point' };

    try {
      const results = await this.nominatimApi.search(destinationText);
      const best = results[0];
      if (!best || !AREA_SCALE_ADDRESS_TYPES.has(best.addresstype)) {
        return { scale: 'point' };
      }

      const boundary = await this.osmPlacesService.getBoundaryById(best.osmType as 'way' | 'relation', best.osmId);
      if (!boundary) return { scale: 'point' };

      const areaActivity = await this.compositeActivityService.resolveArea(boundary);
      return { scale: 'area', areaActivity, boundary };
    } catch (error: any) {
      this.logger.warn(
        `Destination resolution failed for "${destinationText}", falling back to point-scale: ${error.message}`,
      );
      return { scale: 'point' };
    }
  }
}
```

Register it in `be/src/modules/tours/tours.module.ts` — add `DestinationResolutionService` to the `providers` array (find the existing `providers: [...]` list and add it alongside `CompositeGenerationService`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test destination-resolution.service.spec.ts`
Expected: PASS, all 6 tests (the `it.each` counts as 2).

Run: `cd be && yarn build`
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/destination-resolution.service.ts be/src/modules/tours/services/destination-resolution.service.spec.ts be/src/modules/tours/tours.module.ts
git commit -m "feat(be): add DestinationResolutionService — Nominatim-driven point vs area scale"
```

---

### Task 13: Wire area-scale exploration into TourActivityGenerationService

**Files:**
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.ts`
- Test: `be/src/modules/tours/services/tour-activity-generation.service.spec.ts`

**Interfaces:**
- Consumes: `DestinationResolutionService.resolveDestination` (Task 12), `OsmPlacesService.findNeighborhoodsWithin/findStreetsWithin/findPoisWithin` (Task 9), `shortlistNeighborhoods` (Task 11), `boundingBoxToCenterRadius` (Task 10), existing `CompositeGenerationService`/`ActivitiesService.findAll`/`rankAndSliceActivities` (Task 4).
- Produces: `generateTourActivities` now explores a shortlisted set of real neighborhoods for an area-scale destination, sourcing both existing and freshly-synthesized composite candidates from each, alongside a city-bounded POI search — before falling through to the exact same LLM-generation/verification/persistence code that already exists.

- [ ] **Step 1: Write the failing test**

Add to `tour-activity-generation.service.spec.ts`. First, add `destinationResolutionService = { resolveDestination: jest.fn().mockResolvedValue({ scale: 'point' }) };` to the `beforeEach` mocks (defaulting every existing test to point-scale, so none of them need to change), register it as a provider (`{ provide: DestinationResolutionService, useValue: destinationResolutionService }`), and extend `osmPlacesService`'s mock with `findNeighborhoodsWithin`, `findStreetsWithin`, `findPoisWithin` (all `jest.fn().mockResolvedValue([])` by default). Also extend the existing `prisma.activity` mock (currently only `{ findMany: jest.fn()... }`) with `findFirst`, and add a new `activityFamily` key — both default to "nothing exists yet":

```ts
    prisma.activity.findFirst = jest.fn().mockResolvedValue(null);
    prisma.activityFamily = { count: jest.fn().mockResolvedValue(0) };
```

```ts
it('explores shortlisted neighborhoods and offers their real streets/POIs as composite candidates for an area-scale destination', async () => {
  toursService.findOne.mockResolvedValue(
    buildTour({
      metadata: {
        options: { latitude: -34.62, longitude: -58.37, radius: 3000, destination: 'Buenos Aires' },
        originalPrompt: 'A tour of San Telmo',
      },
    }),
  );
  const boundary = {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation' as const,
    osmId: 1224652,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    },
    tags: { name: 'Buenos Aires', admin_level: '8' },
  };
  const areaActivity = { id: 'area-ba', kind: ActivityKind.AREA, name: 'Buenos Aires' };
  destinationResolutionService.resolveDestination.mockResolvedValue({
    scale: 'area',
    areaActivity,
    boundary,
  });
  const sanTelmo = {
    id: 'osm:relation:2223069',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 2223069,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name: 'San Telmo', admin_level: '9' },
  };
  osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([sanTelmo]);
  osmPlacesService.findStreetsWithin.mockResolvedValue([
    { id: 'osm:way:1', name: 'Defensa', osmType: 'way', osmId: 1, geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] }, tags: { name: 'Defensa', highway: 'pedestrian' } },
  ]);
  osmPlacesService.findPoisWithin.mockResolvedValue([]);
  activitiesService.findAll.mockResolvedValue([]);
  langChainService.generateChatResponse.mockResolvedValue(aiJsonResponse({}));

  await service.generateTourActivities(TOUR_ID);

  expect(destinationResolutionService.resolveDestination).toHaveBeenCalledWith('Buenos Aires');
  expect(osmPlacesService.findNeighborhoodsWithin).toHaveBeenCalledWith(boundary);
  expect(osmPlacesService.findStreetsWithin).toHaveBeenCalledWith(sanTelmo);
  const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
  expect(promptArg).toContain('Defensa');
});

it('bounds the POI search by the resolved area geometry instead of the tour options radius', async () => {
  const boundary = {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation' as const,
    osmId: 1224652,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    },
    tags: { name: 'Buenos Aires', admin_level: '8' },
  };
  destinationResolutionService.resolveDestination.mockResolvedValue({
    scale: 'area',
    areaActivity: { id: 'area-ba', kind: ActivityKind.AREA, name: 'Buenos Aires' },
    boundary,
  });
  osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([]);
  activitiesService.findAll.mockResolvedValue([]);
  langChainService.generateChatResponse.mockResolvedValue(aiJsonResponse({}));

  await service.generateTourActivities(TOUR_ID);

  const [, , radiusArg] = activitiesService.findAll.mock.calls[0];
  // The mock tour's own options.radius is 3000 — the area-bounded call must
  // use a different, geometry-derived radius, not that value.
  expect(radiusArg).not.toBe(3000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts -t "area-scale"`
Expected: FAIL — `DestinationResolutionService` isn't consumed at all yet.

- [ ] **Step 3: Implement**

In `tour-activity-generation.service.ts`, add imports:

```ts
import { DestinationResolutionService } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import { shortlistNeighborhoods } from '../utils/neighborhood-shortlist.util';
```

Add `DestinationResolutionService` to the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly googlePlacesService: GooglePlacesService,
    private readonly tourImageService: TourImageService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly compositeGenerationService: CompositeGenerationService,
    private readonly destinationResolutionService: DestinationResolutionService,
  ) {}
```

Immediately before the `if (options?.latitude && options?.longitude) {` block (the one starting around line 159, now shifted slightly by Task 1's changes), insert the destination-resolution step and branch the search area it feeds into:

```ts
      const destinationResolution = await this.destinationResolutionService.resolveDestination(
        options.destination,
      );
      const isAreaScale = destinationResolution.scale === 'area';

      // Area-scale: the search area is the resolved boundary's own extent,
      // never the FE-derived viewport radius. Point-scale: today's exact
      // behavior, unchanged.
      const searchArea = isAreaScale
        ? boundingBoxToCenterRadius(destinationResolution.boundary.geometry)
        : { latitude: options.latitude, longitude: options.longitude, radiusMeters: options.radius || 25000 };

      if (options?.latitude && options?.longitude) {
        const radius = searchArea.radiusMeters;
        const activityLimit = 20;
```

(This replaces the existing `const radius = options.radius || 25000;` line — delete it, since `radius` now comes from `searchArea.radiusMeters`.) Every subsequent use of `options.latitude`/`options.longitude` inside this block for the POI/OSM/embeddings search (not for the final route-optimization step, which legitimately anchors on the user's original point) must switch to `searchArea.latitude`/`searchArea.longitude`. Concretely, update these existing call sites within the same `if` block:

```ts
          const nearbyActivities = await Promise.race([
            this.activitiesService.findAll(
              searchArea.latitude.toString(),
              searchArea.longitude.toString(),
              radius,
              activityLimit,
            ),
```

and the Google Places crawl fallback's coordinates:

```ts
              await this.googlePlacesService.crawlAndSaveActivities({
                latitude: searchArea.latitude,
                longitude: searchArea.longitude,
                radius: Math.min(radius, 5000),
              });

              const refreshedActivities = await this.activitiesService.findAll(
                searchArea.latitude.toString(),
                searchArea.longitude.toString(),
                radius,
                activityLimit,
              );
```

Leave `optimizeActivityOrder` (near the end of the method) using `options.latitude`/`options.longitude` unchanged — the route still starts from the user's actual point, only candidate *sourcing* is area-bounded.

Now replace the existing single-point OSM candidate gathering block (`const [rawStreetCandidates, resolvedArea] = await Promise.all([...])` through the `traceSteps.push(buildOsmBoundaryStep(areaCandidate));` line) with a branch: point-scale keeps exactly today's logic; area-scale explores the shortlisted neighborhoods instead.

```ts
        let streetCandidates: OsmCandidate[] = [];
        let areaCandidate: OsmCandidate | null = null;

        if (isAreaScale) {
          areaCandidate = destinationResolution.boundary;
          const rawNeighborhoods = await this.osmPlacesService.findNeighborhoodsWithin(
            destinationResolution.boundary,
          );
          // findPoisWithin is called once per raw neighborhood here — its
          // result doubles as the shortlisting signal (poiCount) AND, for
          // whichever neighborhoods end up shortlisted below, the actual POI
          // candidates offered to the LLM (no second fetch) — validated live
          // in the spike, where a neighborhood's real POI nodes (monuments,
          // museums) were legitimately chosen as composite waypoints
          // alongside its streets, not merely a scoring input.
          const poisByNeighborhoodId = new Map<string, OsmCandidate[]>();
          const scoringInputs = await Promise.all(
            rawNeighborhoods.map(async (neighborhood) => {
              const neighborhoodActivity = await this.prisma.activity.findFirst({
                where: { externalId: `${neighborhood.osmType}/${neighborhood.osmId}`, kind: ActivityKind.AREA },
                select: { id: true },
              });
              const existingFamilyCount = neighborhoodActivity
                ? await this.prisma.activityFamily.count({
                    where: { areaActivityId: neighborhoodActivity.id },
                  })
                : 0;
              const pois = await this.osmPlacesService.findPoisWithin(neighborhood);
              poisByNeighborhoodId.set(neighborhood.id, pois);
              return {
                candidate: neighborhood,
                hasExistingFamily: existingFamilyCount > 0,
                poiCount: pois.length,
              };
            }),
          );
          const shortlisted = shortlistNeighborhoods(scoringInputs);

          const perNeighborhood = await Promise.all(
            shortlisted.map(async (neighborhood) => ({
              streets: await this.osmPlacesService.findStreetsWithin(neighborhood),
              pois: poisByNeighborhoodId.get(neighborhood.id) ?? [],
            })),
          );
          // Streets and POI nodes from every shortlisted neighborhood, merged
          // into the same candidate set the LLM sees as "Available OSM
          // features" — a POI node can be picked as a waypoint exactly like
          // a street (see composite-activity.service.ts's Point-geometry
          // handling, this same task). Capped to 20 total, same rationale as
          // the point-scale path below (Overpass/Groq payload limits).
          streetCandidates = perNeighborhood
            .flatMap((n) => [...n.streets, ...n.pois])
            .slice(0, 20);

          traceSteps.push(
            buildNeighborhoodShortlistStep(rawNeighborhoods, shortlisted),
          );
        } else {
          const [rawStreetCandidates, resolvedArea] = await Promise.all([
            this.osmPlacesService.findStreetsNear(
              searchArea.latitude,
              searchArea.longitude,
              radius,
            ),
            this.osmPlacesService.findContainingBoundary(searchArea.latitude, searchArea.longitude),
          ]);
          streetCandidates = rawStreetCandidates.slice(0, 20);
          areaCandidate = resolvedArea;
        }

        candidateOsmFeaturesById = new Map(streetCandidates.map((c) => [c.id, c]));
        const streetsStep = buildOsmStreetsStep(streetCandidates);
        traceSteps.push(streetsStep);
        traceCandidateLists.push(streetsStep.candidates ?? []);
        traceSteps.push(buildOsmBoundaryStep(areaCandidate));
```

`buildNeighborhoodShortlistStep` is added in Task 14 — this task's own tests only assert on `findStreetsWithin`/`findNeighborhoodsWithin` being called and the resulting streets reaching the prompt, so a stub trace-builder import failing to resolve is expected to be fixed by Task 14, done immediately after this one (both tasks touch the same generation-trace-builder file; do them back to back).

Also update `generateTourActivities`'s prompt-building line that currently uses `enhancedPrompt || prompt` — no change needed there. Finally, update the earlier `buildPromptFromParams`/destination lookup: nothing else changes, since `options.destination` was already being read for `resolveDestination` above.

- [ ] **Step 4: Run tests to verify they pass**

This task's tests will not fully pass until Task 14 adds `buildNeighborhoodShortlistStep` — run both together:

Run: `cd be && yarn test tour-activity-generation.service.spec.ts`
Expected: FAIL only on the missing `buildNeighborhoodShortlistStep` import until Task 14 is done; all other assertions (streets reaching the prompt, area-bounded radius) should already pass once Task 14's stub exists. Proceed to Task 14 before considering this task's tests green.

- [ ] **Step 5: Commit** (after Task 14 makes the full suite pass)

```bash
git add be/src/modules/tours/services/tour-activity-generation.service.ts be/src/modules/tours/services/tour-activity-generation.service.spec.ts
git commit -m "feat(be): explore shortlisted real neighborhoods for area-scale destinations"
```

---

### Task 14: Generation trace — destination-resolution & neighborhood-shortlist steps

**Files:**
- Modify: `be/src/modules/tours/interfaces/generation-trace.interface.ts`
- Modify: `be/src/modules/tours/utils/generation-trace-builder.util.ts`
- Modify: `be/src/modules/tours/services/tour-activity-generation.service.ts` (push the new step)
- Test: `be/src/modules/tours/utils/generation-trace-builder.util.spec.ts` (create if it doesn't already exist)

**Interfaces:**
- Produces: `buildNeighborhoodShortlistStep(allNeighborhoods: OsmCandidate[], shortlisted: OsmCandidate[]): GenerationTraceStep` — consumed by Task 13's already-written call site.

- [ ] **Step 1: Write the failing test**

Create (or extend) `be/src/modules/tours/utils/generation-trace-builder.util.spec.ts`:

```ts
import { buildNeighborhoodShortlistStep } from './generation-trace-builder.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

function candidate(name: string): OsmCandidate {
  return {
    id: `osm:relation:${name}`,
    name,
    osmType: 'relation',
    osmId: 1,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name },
  };
}

describe('buildNeighborhoodShortlistStep', () => {
  it('lists every real neighborhood found, marking which ones were shortlisted', () => {
    const sanTelmo = candidate('San Telmo');
    const laBoca = candidate('La Boca');
    const recoleta = candidate('Recoleta');

    const step = buildNeighborhoodShortlistStep([sanTelmo, laBoca, recoleta], [sanTelmo, laBoca]);

    expect(step.stage).toBe('neighborhood_shortlist');
    expect(step.summary).toContain('3');
    expect(step.summary).toContain('2');
    const offeredNames = step.candidates?.map((c) => c.name);
    expect(offeredNames).toEqual(['San Telmo', 'La Boca', 'Recoleta']);
    const sanTelmoCandidate = step.candidates?.find((c) => c.name === 'San Telmo');
    const recoletaCandidate = step.candidates?.find((c) => c.name === 'Recoleta');
    expect(sanTelmoCandidate?.chosen).toBe(true);
    expect(recoletaCandidate?.chosen).toBe(false);
  });

  it('summarizes finding zero neighborhoods without erroring', () => {
    const step = buildNeighborhoodShortlistStep([], []);

    expect(step.summary).toContain('0');
    expect(step.candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test generation-trace-builder.util.spec.ts`
Expected: FAIL — `buildNeighborhoodShortlistStep` doesn't exist yet.

- [ ] **Step 3: Implement**

Add `'destination_resolution'` and `'neighborhood_shortlist'` to the `TraceStage` union in `generation-trace.interface.ts`, and correct the now-stale top-of-file comment about `embeddings`:

```ts
// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
export type TraceStage =
  | 'destination_resolution'
  | 'db_search'
  | 'google_places_crawl'
  | 'osm_streets'
  | 'osm_boundary'
  | 'neighborhood_shortlist'
  | 'embeddings'
  | 'wikidata_enrichment'
  | 'llm_generation'
  | 'verification';
```

Add to `generation-trace-builder.util.ts`, after `buildOsmBoundaryStep`:

```ts
export function buildNeighborhoodShortlistStep(
  allNeighborhoods: OsmCandidate[],
  shortlisted: OsmCandidate[],
): GenerationTraceStep {
  const shortlistedIds = new Set(shortlisted.map((c) => c.id));
  return {
    stage: 'neighborhood_shortlist',
    label: 'Barrios explorados (destino a nivel ciudad)',
    summary:
      allNeighborhoods.length > 0
        ? `${allNeighborhoods.length} barrios reales encontrados; ${shortlisted.length} explorados a fondo (con familia curada existente o más POIs cercanos).`
        : 'No se encontraron barrios reales dentro del límite de esta ciudad.',
    candidates: allNeighborhoods.map(
      (c): TraceCandidate => ({
        source: 'osm',
        id: c.id,
        name: c.name,
        detail: osmDetail(c),
        offered: true,
        chosen: shortlistedIds.has(c.id),
      }),
    ),
  };
}
```

Note `osmDetail` is already defined earlier in this file (used by `buildOsmStreetsStep`) — reuse it, no need to redefine.

Add a matching, minimal `destination_resolution` trace step builder right above it (used by Task 13's `generateTourActivities`, pushed right after `resolveDestination` resolves):

```ts
export function buildDestinationResolutionStep(
  destinationText: string | undefined,
  resolution: { scale: 'point' } | { scale: 'area'; boundary: OsmCandidate },
): GenerationTraceStep {
  return {
    stage: 'destination_resolution',
    label: 'Resolución del destino',
    summary:
      resolution.scale === 'area'
        ? `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se exploran sus barrios reales en vez de un único punto+radio.`
        : destinationText
          ? `"${destinationText}" no resolvió a un límite de ciudad/pueblo real — se usa el punto+radio de siempre.`
          : 'No se especificó un destino de texto — se usa el punto+radio de siempre.',
  };
}
```

In `tour-activity-generation.service.ts`, push this step right after the `destinationResolution` variable is computed (Task 13's insertion point):

```ts
      const destinationResolution = await this.destinationResolutionService.resolveDestination(
        options.destination,
      );
      traceSteps.push(buildDestinationResolutionStep(options.destination, destinationResolution));
      const isAreaScale = destinationResolution.scale === 'area';
```

Add `buildDestinationResolutionStep` and `buildNeighborhoodShortlistStep` to the existing `import { ... } from '../utils/generation-trace-builder.util';` block at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test generation-trace-builder.util.spec.ts tour-activity-generation.service.spec.ts`
Expected: PASS — both this task's new tests and Task 13's previously-blocked tests are now green.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/interfaces/generation-trace.interface.ts be/src/modules/tours/utils/generation-trace-builder.util.ts be/src/modules/tours/utils/generation-trace-builder.util.spec.ts be/src/modules/tours/services/tour-activity-generation.service.ts
git commit -m "feat(be): trace destination resolution and neighborhood shortlist in the bitácora"
```

---

### Task 15: Integration test — thin-DB / area-scale scenario end-to-end

**Files:**
- Test: `be/src/modules/tours/services/tour-activity-generation.service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-14 — this task adds no new production code, only a test that exercises the full path together.

- [ ] **Step 1: Write the test**

Add to `tour-activity-generation.service.spec.ts`:

```ts
it('reproduces the Barcelona scenario: a thin, off-topic DB pool for an area-scale destination triggers both a crawl and a neighborhood shortlist, and ranks the LLM candidates by interest', async () => {
  toursService.findOne.mockResolvedValue(
    buildTour({
      metadata: {
        options: {
          latitude: 41.42,
          longitude: 2.15,
          radius: 11000,
          destination: 'Barcelona',
          interests: ['history', 'architecture'],
        },
        originalPrompt: 'A tour of Barcelona',
      },
    }),
  );

  const boundary = {
    id: 'osm:relation:347950',
    name: 'Barcelona',
    osmType: 'relation' as const,
    osmId: 347950,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[2.05, 41.32], [2.23, 41.32], [2.23, 41.47], [2.05, 41.47], [2.05, 41.32]]],
    },
    tags: { name: 'Barcelona', admin_level: '8' },
  };
  destinationResolutionService.resolveDestination.mockResolvedValue({
    scale: 'area',
    areaActivity: { id: 'area-bcn', kind: ActivityKind.AREA, name: 'Barcelona' },
    boundary,
  });

  const ciutatVella = {
    id: 'osm:relation:900001',
    name: 'Ciutat Vella',
    osmType: 'relation' as const,
    osmId: 900001,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name: 'Ciutat Vella', admin_level: '9' },
  };
  osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([ciutatVella]);
  osmPlacesService.findPoisWithin.mockResolvedValue([]);
  osmPlacesService.findStreetsWithin.mockResolvedValue([
    {
      id: 'osm:way:501',
      name: 'La Rambla',
      osmType: 'way',
      osmId: 501,
      geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] },
      tags: { name: 'La Rambla', highway: 'pedestrian' },
    },
  ]);

  // Only a handful of low-relevance activities exist locally — same shape
  // as the real Barcelona bug report (hiking trails near Collserola).
  const hikingTrailId = testUuid();
  const historicSiteId = testUuid();
  activitiesService.findAll
    .mockResolvedValueOnce([
      { id: hikingTrailId, name: 'Collserola hiking trail', latitude: 41.42, longitude: 2.10, rating: 4.5, ratingCount: 300 },
    ])
    .mockResolvedValueOnce([
      { id: hikingTrailId, name: 'Collserola hiking trail', latitude: 41.42, longitude: 2.10, rating: 4.5, ratingCount: 300 },
      { id: historicSiteId, name: 'Barri Gòtic historic site', latitude: 41.38, longitude: 2.17, rating: 4.2, ratingCount: 50 },
    ]);
  vectorStoreService.getSimilarityScores.mockResolvedValue(
    new Map([
      [hikingTrailId, 0.05],
      [historicSiteId, 0.9],
    ]),
  );
  prisma.activity.findMany.mockResolvedValue([
    { id: historicSiteId, latitude: 41.38, longitude: 2.17, kind: ActivityKind.POI },
  ]);
  langChainService.generateChatResponse.mockResolvedValue(
    aiJsonResponse({
      activities: [
        {
          activityId: historicSiteId,
          activityName: 'Barri Gòtic historic site',
          dayNumber: 1,
          startTime: '10:00',
          duration: 60,
          notes: 'Visit it',
          latitude: 41.38,
          longitude: 2.17,
        },
      ],
    }),
  );

  await service.generateTourActivities(TOUR_ID);

  // 1. The thin pool (1 result) triggered a crawl refresh.
  expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalled();
  // 2. The destination resolved to area-scale and explored a real neighborhood.
  expect(osmPlacesService.findStreetsWithin).toHaveBeenCalledWith(ciutatVella);
  // 3. The historically-relevant, lower-rated site outranked the irrelevant
  //    higher-rated one in what the LLM was offered.
  const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
  expect(promptArg.indexOf('Barri Gòtic historic site')).toBeLessThan(
    promptArg.indexOf('Collserola hiking trail'),
  );
  // 4. The bitácora records both new stages. tour.update is called with a
  //    single { where, data } argument (see the $transaction block in
  //    generateTourActivities), so the mock call is a one-element array.
  const [lastUpdateCall] = prisma.tour.update.mock.calls[prisma.tour.update.mock.calls.length - 1];
  const stages = lastUpdateCall.data.metadata.generationTrace.steps.map((s: any) => s.stage);
  expect(stages).toEqual(
    expect.arrayContaining(['destination_resolution', 'neighborhood_shortlist']),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test tour-activity-generation.service.spec.ts -t "reproduces the Barcelona scenario"`
Expected: FAIL if any prior task's wiring has a gap — this is the integration checkpoint for the whole plan. Debug against whichever assertion fails first.

- [ ] **Step 3: No new implementation** — this test should pass purely from Tasks 1-14's code. If it doesn't, the gap is in how those tasks were wired together (e.g., a missed `import`, an argument passed in the wrong order) — fix the specific wiring bug in the relevant file from Tasks 1-14, not by adding new logic here.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd be && yarn test`
Expected: PASS, entire suite — this confirms nothing in Tasks 1-14 broke an existing test elsewhere in the codebase.

Run: `cd be && yarn check` (typecheck + lint)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/tour-activity-generation.service.spec.ts
git commit -m "test(be): add end-to-end coverage reproducing the Barcelona bug report scenario"
```

---

## After this plan

Not covered here (see spec's "Explicitly out of scope"): destinations larger than a city, the separate dead `crawler_search` 24h-freshness bug in `HybridSearchService`, and any frontend changes (none are needed — `options.destination` already flows end-to-end today). Manually verify the fix against a real destination once Task 15 is green: seed or clear a local area's data, generate a tour for a city-scale destination with interests set, and confirm the bitácora (`fe/app/tours/[id]/bitacora.tsx`) shows the new `destination_resolution`/`neighborhood_shortlist` steps and a plausible mix of POI and composite picks.
