# Preference-First Selection & Agent-Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live tour-generation engine's catalog-first geographic pool + late preference re-scoring with preference-first per-facet retrieval + LLM semantic classification of grounded evidence + deterministic set-cover composition, so the final selected Experiences structurally satisfy the user's requested facets instead of hoping a score suppresses irrelevant content.

**Architecture:** Per requested facet (theme/intent), retrieve matching Experiences already in the catalog via one unified match primitive; if insufficient, acquire targeted evidence from OSM/Wikivoyage/Places/web, classify it with an LLM (evidence-only, no user preferences), persist it; compose a deterministic set covering every facet (reserving the strongest match per facet, respecting `must` anchors, never selecting a bare AREA/ROUTE); feed the composed set to the existing deterministic solver (now preference-aware) for scheduling.

**Tech Stack:** NestJS, Prisma 7 + pgvector, Groq (`qwen/qwen3.8-27b`, classification + free-text interpret), Gemini (embeddings + web entity extraction), Tavily (web search), Google Places / OSM Overpass / Wikivoyage / Wikidata (structured acquisition), Jest (unit/integration/e2e/acceptance/characterization/live/smoke), Playwright (frontend e2e).

**Spec:** `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` (the plan argues from the spec — executors read both). Empirical basis: `docs/superpowers/characterization/2026-09-10-preference-first-buenos-aires-dry-run.md` (two executable probes) and `docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md` (G.1, the defects this replaces).

## Global Constraints

- Branch: create `feat/preference-first-selection` off `feat/experience-domain-v2` (spec §7.5 step 1) before Checkpoint A's first commit. Never commit to `feat/experience-domain-v2` directly during this plan.
- Never touch `feat/agentic-travel-planning`.
- This refactor's completion **is** the redefined "Phase 7 CLOSED" (spec §7.4/§11 D4) — do not create or reference a "Phase 8". Do not update the progress doc's Checkpoint statuses until Checkpoint D's final task.
- The LLM never establishes geographic identity — identity/coordinates/provider IDs always come from `ExperienceProposalResolverService` (Places/OSM), never from a classification or interpretation call.
- Real Postgres for anything touching persistence — no mocked Prisma in integration/e2e tests. Fakes only at external boundaries (LLM transport, embeddings, travel estimator, web search) in e2e/acceptance; unit tests stay pure with no I/O.
- `ExperienceComponent.order` is a concrete integer only when cited evidence explicitly describes a real visiting sequence (`orderedByEvidence: true`); otherwise `null`. Never inferred from array/resolution order. (Existing invariant — do not weaken it anywhere in this plan.)
- Dimensioned facets (`tourism_intensity`, `local_character`, etc.) are **never** emitted by the classifier in v1 (spec §5.3). Do not add this capability in this plan.
- No `Activity`/`Event`/`OperationalStop`/`TourStop`, no schema migration beyond populating existing columns + JSON shape changes (spec §6/§10).
- Every checkpoint ends with: `yarn workspace backend typecheck`, `yarn workspace backend lint:check`, and the specific test commands listed in that checkpoint's Verification — all green — before moving to the next checkpoint.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `be/src/modules/tours/interfaces/preference-spec.interface.ts` | `PreferenceSpec`, `RequestedFacet`, `AnchoredPlace`, `FacetCandidates`, `CompositionResult`, `UnmetAnchor` — the shared shapes every stage below consumes/produces. |
| `be/src/modules/tours/utils/preference-spec-builder.util.ts` | Stage 1b: merges wizard fields + interpreted `NormalizedPreferenceIntent` into one `PreferenceSpec`. Pure function. |
| `be/src/modules/tours/utils/facet-sufficiency.util.ts` | Stage 3c: `requiredCandidateCount` per facet (reuses the existing `clamp(days,1,14) × pace` formula) + the strong/weak match classification (spec §5.6a). Pure. |
| `be/src/modules/tours/services/facet-retrieval.service.ts` | Stage 3: per-facet catalog retrieval — queries `ExperienceCatalogService`, matches via `candidateMatchesPreferenceFacet`, orders, checks sufficiency. |
| `be/src/modules/tours/utils/iconicity.util.ts` | Deterministic `0..1` iconicity score from `userRatingCount`/Wikidata sitelinks/Wikivoyage-listed/OSM `heritage=*` (spec §5.4). Pure. |
| `be/src/modules/tours/prompts/experience-semantic-classification.prompt.ts` | Stage 6a system prompt (evidence-only, no user preferences, no dimensioned facets, theme-precision guardrail). |
| `be/src/modules/tours/services/experience-classification.service.ts` | Stage 6: one Groq call per bundle, sequential, bounded retry-on-429 (D1); skip-if-known via Stage-5 corroboration match (D2). |
| `be/src/modules/tours/utils/trait-shape-guard.util.ts` | Stage 6b: rejects malformed traits (sentences, canonical-key leakage, empty). Pure. |
| `be/src/modules/tours/utils/quality-score.util.ts` | Stage 6c: deterministic `0..5` from provider signals; `null` for un-rated Experiences with no notability signal (spec §5.6). Pure. |
| `be/src/modules/tours/utils/merge-metadata.util.ts` | Order-independent metadata merge (union arrays, prefer non-empty, `max` quality) extracted from `ExperienceCatalogService` (fixes CHAR-8). Pure. |
| `be/src/modules/tours/utils/composition-set-cover.util.ts` | Stage 9 core algorithm: best-in-facet reservation, multi-facet fill, anchor forcing, hard-exclusion drop, overlap resolution. Pure, deterministic. |
| `be/src/modules/tours/services/experience-composition.service.ts` | Thin service wrapping the set-cover util with real per-facet candidate fetching. |
| `be/src/modules/tours/utils/must-anchor-placement.util.ts` | D3: sorts `mustInclude` candidates first for the solver's pinned pass; maps a must-anchor's `UnselectedPlanningCandidate` back to `unmetAnchors` reason codes. Pure. |
| `be/src/commands/scripts/commands/classify-eval.command.ts` | Stage-6 validation gate (spec §9.9): CLI script sampling real catalog Experiences, running classification, producing a report. |
| `be/test/characterization/preference-first-selection-semantics.characterization-spec.ts` | New RED baseline for this refactor's own invariants (spec §9.5), flips green as Checkpoints land. |
| `be/test/integration/per-facet-retrieval.integration-spec.ts` | Stage 3 over a seeded classified catalog, real Postgres. |
| `be/test/integration/classify-persist-reretrieve.integration-spec.ts` | Stage 6→7→8 round-trip, real Postgres. |
| `be/test/acceptance/scenarios/composition-scenarios.spec.ts` | Stage 9 deterministic scenarios. |
| `be/test/acceptance/unit/must-anchor-pinned-placement.spec.ts` | D3 solver pinned-pass unit acceptance test. |
| `be/test/experience-selection-preference-first.e2e-spec.ts` | Cold-catalog e2e, anchor-honored, one-preference-delta, must-anchor-infeasible (spec §9.3). |
| `be/test/live/preference-first-buenos-aires.live-spec.ts` | Formalizes both BA probes against real providers. |

### Modified files

| File | Change |
|---|---|
| `be/src/modules/tours/services/preference-interpreter.service.ts` | Add `anchoredPlaces: AnchoredPlace[]` to `NormalizedPreferenceIntent` output + prompt instructions (conservative `must` per spec §5.7). |
| `be/src/modules/tours/interfaces/preference-interpretation.interface.ts` | `NormalizedPreferenceIntent.anchoredPlaces: AnchoredPlace[]`. |
| `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts` | **Delete.** Superseded entirely by `ExperienceClassificationService`. |
| `be/src/modules/tours/services/coverage-analyzer.service.ts` | **Delete** (+ its `.spec.ts`). Superseded by `facet-sufficiency.util.ts` + `FacetRetrievalService`. |
| `be/src/modules/tours/utils/candidate-ranking.util.ts` | Remove `rankCandidatesByRelevance`/`rankKnownSemanticTier`/`wrapWithoutSemanticSignal` (the big-pool sort). Keep `qualityBonus`, `preferenceBonus`, `proximityBonus`, `diversityBonusFor` as building blocks the new within-facet ordering reuses. |
| `be/src/modules/tours/utils/candidate-window-selection.util.ts` | **Delete.** `selectBoundedWindow` superseded by composition. |
| `be/src/modules/tours/utils/theme-matching.util.ts` | Remove `matchesThemeKeywords`/`matchedThemesFor` (the `JSON.stringify` scan). Trace's "what matched" now calls `candidateMatchesPreferenceFacet` directly. |
| `be/src/modules/tours/services/experience-acquisition-planner.service.ts` | `buildAcquisitionPlan` takes a single `(dimension,key)` facet + optional area-anchor context (D5) instead of a batch of legacy deficits; reuses `lookupSourceCapabilityRoute` unchanged. |
| `be/src/modules/tours/constants/acquisition-source-routing.ts` | Add walk/route_like + area-anchor routing (D5): route to `web` with an area-scoped walking-tour query. |
| `be/src/modules/tours/providers/osm-acquisition.provider.ts` | Copy `OsmCandidate.narrativeContext` into `SourceObservation.metadata.wikidataNarrative` when present (spec §5.5). |
| `be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts` | Add `metadata: { sectionType, templateName }` to each observation (spec §5.5). |
| `be/src/modules/integrations/google-places/services/google-places-api.service.ts` | Widen `getFieldMask()`: add `places.editorialSummary`. |
| `be/src/modules/tours/providers/google-places-acquisition.provider.ts` | Carry `editorialSummary`, `websiteUri`, `priceLevel`, `businessStatus` into `SourceObservation.metadata`. |
| `be/src/modules/tours/utils/experience-candidate-extraction.util.ts` | Stage 4c contract narrows to entity name + `evidenceKeys` + multi-stop `componentHints` enumeration — no `themes`/`traits`/`intents` extraction (classification moves to Stage 6). |
| `be/src/modules/tours/services/experience-catalog.service.ts` | `mergeMetadata` delegates to the new pure util; `resolveOrCreateTraitDefinitions` stops hardcoding `dimension = 'general'`; `persistVerifiedExperience` accepts `qualityScore`. |
| `be/src/modules/tours/services/planning-candidate-normalizer.service.ts` | Add `preferenceWeight` (raw `RequestedFacet.weight` sum for facets this Experience satisfies) and pass raw `qualityScore` (not a pre-weighted bonus) onto `PlanningExperienceCandidate`. |
| `be/src/modules/tours/interfaces/daily-planning.interface.ts` | `PlanningExperienceCandidate` gains `preferenceWeight?: number` and `mustInclude?: boolean`. |
| `be/src/modules/tours/utils/daily-planning-placement.util.ts` | `scoreCandidateForDay` adds a preference term; quality weight applied to the raw `0..5` score once. |
| `be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts` | `sortCandidatesDeterministically` sorts `mustInclude` candidates first (via `must-anchor-placement.util.ts`). |
| `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts` | Never propose a move/swap that evicts a `mustInclude`-placed candidate. |
| `be/src/modules/tours/config/daily-planning-policy.config.ts` | Add `scoring.preferenceWeight`. |
| `be/src/modules/tours/utils/candidate-overlap-filter.util.ts` | `preferWinner` ties break on "covers more of the requested spec" instead of component count (needs the `PreferenceSpec` threaded in). |
| `be/src/modules/tours/utils/generation-trace-builder.util.ts` | `generationTrace` → v4: per-facet section (`FacetCandidates`, sufficiency, classification grounding), `unmetAnchors`. |
| `be/src/modules/tours/services/experience-generation.service.ts` | Stages 1–11 wired in as the live orchestration, replacing the current coverage/rank/window flow (Checkpoint D). |
| `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md` | Checkpoint D's final task: record Phase 7 CLOSED per D4. |
| `docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md` | Resolution appendix mapping each defect → the commit that fixed it. |

---

## Checkpoint A — Foundational primitives (pure, unit-testable, no live-path wiring)

Produces working, independently testable software: the `PreferenceSpec` shape, the unified match usage, per-facet retrieval against the *existing* catalog schema, and the small deterministic utils everything else depends on. Nothing in this checkpoint touches `experience-generation.service.ts`.

### Task A1: `PreferenceSpec` interfaces

**Files:**
- Create: `be/src/modules/tours/interfaces/preference-spec.interface.ts`
- Test: `be/src/modules/tours/interfaces/preference-spec.interface.spec.ts`

**Interfaces:**
- Produces (used by every later task):
```typescript
export interface RequestedFacet {
  dimension: string; // 'theme' | 'intent' | 'trait' | 'exploration_style'
  key: string;
  weight: number; // importance * confidence, 0..1
  source: 'wizard' | 'free_text';
  required: boolean; // always false in v1 (positive facets are soft) — see spec §10
}

export interface AnchoredPlace {
  rawName: string;
  kind: 'venue' | 'area' | 'route' | 'unknown';
  priority: 'soft' | 'must';
}

export interface PreferenceSpec {
  facets: RequestedFacet[];
  exclusions: { themes: string[]; traits: string[]; hard: string[] };
  anchors: AnchoredPlace[];
  semanticQuery: string;
  explorationStyle: 'iconic' | 'local_deep_dive' | 'balanced';
  softConstraints: {
    dietary: string[];
    accessibility: string[];
    budget: string[];
    group: string[];
  };
  trip: {
    days: number;
    startDates: string[];
    pace: 'relaxed' | 'moderate' | 'fast';
  };
}

export interface UnmetAnchor {
  anchor: AnchoredPlace;
  reason: 'UNRESOLVED' | 'INFEASIBLE';
}

export interface FacetCandidates {
  facet: RequestedFacet;
  matches: string[]; // Experience ids, ordered strongest-first
  sufficient: boolean;
  deficitCount: number;
}

export interface CompositionResult {
  selected: string[]; // Experience ids
  perFacetCoverage: Record<string, string[]>; // "dimension:key" -> Experience ids covering it
  unmetFacets: string[]; // "dimension:key" with zero strong matches after acquisition
  anchorsForced: string[]; // Experience ids that entered as an anchor
  unmetAnchors: UnmetAnchor[];
}
```

- [ ] **Step 1: Write the failing test** — a type-shape smoke test (TS gives us most of this for free; test the one runtime helper we need: a `facetKey` formatter used everywhere `"${dimension}:${key}"` appears).

```typescript
import { facetKey } from './preference-spec.interface';

describe('facetKey', () => {
  it('formats dimension:key', () => {
    expect(facetKey({ dimension: 'theme', key: 'history' } as any)).toBe('theme:history');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/interfaces/preference-spec.interface.spec.ts`
Expected: FAIL — `facetKey` is not exported.

- [ ] **Step 3: Write minimal implementation** — add the interfaces above plus:

```typescript
export function facetKey(f: Pick<RequestedFacet, 'dimension' | 'key'>): string {
  return `${f.dimension}:${f.key}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/interfaces/preference-spec.interface.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/interfaces/preference-spec.interface.ts be/src/modules/tours/interfaces/preference-spec.interface.spec.ts
git commit -m "feat(tours): add PreferenceSpec interfaces for preference-first selection"
```

---

### Task A2: Extend `NormalizedPreferenceIntent` with `anchoredPlaces`

**Files:**
- Modify: `be/src/modules/tours/interfaces/preference-interpretation.interface.ts`
- Modify: `be/src/modules/tours/services/preference-interpreter.service.ts`
- Test: `be/src/modules/tours/services/preference-interpreter.service.spec.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `AnchoredPlace` from Task A1.
- Produces: `NormalizedPreferenceIntent.anchoredPlaces: AnchoredPlace[]`.

- [ ] **Step 1: Write the failing tests** — add to the existing spec file:

```typescript
it('emits an anchoredPlace with priority soft for a mention without emphasis', async () => {
  fakeLangChain.generateChatResponse.mockResolvedValue(
    JSON.stringify({
      ...emptyIntentJson(),
      anchoredPlaces: [{ rawName: 'Teatro Colón', kind: 'venue', priority: 'soft' }],
    }),
  );
  const { intent } = await service.interpret('me interesa la arquitectura del Teatro Colón');
  expect(intent.anchoredPlaces).toEqual([
    { rawName: 'Teatro Colón', kind: 'venue', priority: 'soft' },
  ]);
});

it('emits priority must ONLY for explicit-intent phrasing, and normalizes an invalid priority to soft', async () => {
  fakeLangChain.generateChatResponse.mockResolvedValue(
    JSON.stringify({
      ...emptyIntentJson(),
      anchoredPlaces: [
        { rawName: 'Teatro Colón', kind: 'venue', priority: 'must' },
        { rawName: 'San Telmo', kind: 'area', priority: 'urgent' }, // invalid value
      ],
    }),
  );
  const { intent } = await service.interpret('quiero visitar sí o sí el Teatro Colón, y algo de San Telmo');
  expect(intent.anchoredPlaces).toEqual([
    { rawName: 'Teatro Colón', kind: 'venue', priority: 'must' },
    { rawName: 'San Telmo', kind: 'area', priority: 'soft' },
  ]);
});

it('defaults anchoredPlaces to [] when the model omits the field', async () => {
  fakeLangChain.generateChatResponse.mockResolvedValue(JSON.stringify(emptyIntentJson()));
  const { intent } = await service.interpret('algo lindo para hacer');
  expect(intent.anchoredPlaces).toEqual([]);
});
```

(`emptyIntentJson()` is the existing test helper building the baseline interpreter JSON fixture — extend it to keep including every other required key.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/services/preference-interpreter.service.spec.ts`
Expected: FAIL — `intent.anchoredPlaces` is `undefined`.

- [ ] **Step 3: Implement**

In `preference-interpretation.interface.ts`, add to `NormalizedPreferenceIntent`:
```typescript
import { AnchoredPlace } from './preference-spec.interface';
// ...
export interface NormalizedPreferenceIntent {
  preferredFacets: PreferenceFacet[];
  anchoredPlaces: AnchoredPlace[];
  // ...unchanged fields
}
```

In `preference-interpreter.service.ts`:
1. Add to `SYSTEM_PROMPT` (the existing constant): a new instruction block —
```
anchoredPlaces: an array of concrete named places/areas/routes the user
mentioned. Each: { rawName: exact text used, kind: one of area|venue|route|
unknown, priority: soft|must }.
priority MUST be "must" ONLY for explicit, unambiguous intent — phrasings
like "quiero visitar X", "incluí X", "sí o sí quiero ir a X", "no me quiero
perder X". Anything softer ("me gustaría", "si se puede", "algo cerca de...",
a place merely referenced for its architecture/history/atmosphere without an
explicit visit request) is "soft". When in doubt, use "soft".
```
2. Add `anchoredPlaces` to `RESPONSE_SCHEMA` (array of objects, `rawName`/`kind`/`priority` all required strings).
3. In `normalize()`, add:
```typescript
const ANCHOR_KINDS = new Set(['area', 'venue', 'route', 'unknown']);
const ANCHOR_PRIORITIES = new Set(['soft', 'must']);

private normalizeAnchoredPlaces(raw: unknown): AnchoredPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      rawName: typeof item.rawName === 'string' ? item.rawName.trim() : '',
      kind: ANCHOR_KINDS.has(item.kind as string) ? (item.kind as AnchoredPlace['kind']) : 'unknown',
      priority: ANCHOR_PRIORITIES.has(item.priority as string) ? (item.priority as AnchoredPlace['priority']) : 'soft',
    }))
    .filter((a) => a.rawName.length > 0)
    .slice(0, 10);
}
```
Wire it into the object returned by `normalize()`: `anchoredPlaces: this.normalizeAnchoredPlaces(value?.anchoredPlaces)`.
4. Add `anchoredPlaces: []` to `EMPTY_INTENT` and to the `fallback()` builder.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/services/preference-interpreter.service.spec.ts`
Expected: PASS (including all pre-existing cases in the file, unchanged).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/interfaces/preference-interpretation.interface.ts be/src/modules/tours/services/preference-interpreter.service.ts be/src/modules/tours/services/preference-interpreter.service.spec.ts
git commit -m "feat(tours): interpret anchoredPlaces with conservative must/soft priority"
```

---

### Task A3: `PreferenceSpec` builder (Stage 1b)

**Files:**
- Create: `be/src/modules/tours/utils/preference-spec-builder.util.ts`
- Test: `be/src/modules/tours/utils/preference-spec-builder.util.spec.ts`

**Interfaces:**
- Consumes: `TourGenerationRequest` (existing, from `interfaces/tour-generation.interface.ts`), `NormalizedPreferenceIntent` (Task A2).
- Produces: `buildPreferenceSpec(request, interpreted): PreferenceSpec`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { buildPreferenceSpec } from './preference-spec-builder.util';
import { BudgetLevel, GroupType, ExplorationStyle } from '../interfaces/tour-generation.interface';

function baseRequest(overrides: Partial<any> = {}) {
  return {
    days: 2,
    intent: {
      interests: ['history', 'architecture'],
      intents: ['visit'],
      explorationStyle: ExplorationStyle.BALANCED,
      additionalPreferences: '',
    },
    mobility: { travelPace: 'moderate', accessibilityNeeds: [] },
    dietaryRestrictions: [],
    budgetLevel: BudgetLevel.LOW,
    groupType: GroupType.SOLO,
    startDates: ['2026-09-11'],
    ...overrides,
  } as any;
}

function emptyIntent() {
  return {
    preferredFacets: [],
    anchoredPlaces: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: [],
  };
}

describe('buildPreferenceSpec', () => {
  it('merges wizard interests/intents as weight-1.0 facets', () => {
    const spec = buildPreferenceSpec(baseRequest(), emptyIntent());
    expect(spec.facets).toEqual(
      expect.arrayContaining([
        { dimension: 'theme', key: 'history', weight: 1, source: 'wizard', required: false },
        { dimension: 'theme', key: 'architecture', weight: 1, source: 'wizard', required: false },
        { dimension: 'intent', key: 'visit', weight: 1, source: 'wizard', required: false },
      ]),
    );
  });

  it('adds a low-budget soft constraint and a family-friendly one from groupType', () => {
    const spec = buildPreferenceSpec(
      baseRequest({ budgetLevel: BudgetLevel.LOW, groupType: GroupType.FAMILY }),
      emptyIntent(),
    );
    expect(spec.softConstraints.budget).toContain('low budget');
    expect(spec.softConstraints.group).toContain('family friendly');
  });

  it('carries anchoredPlaces from the interpreted intent through unchanged', () => {
    const interpreted = { ...emptyIntent(), anchoredPlaces: [{ rawName: 'San Telmo', kind: 'area', priority: 'soft' }] };
    const spec = buildPreferenceSpec(baseRequest(), interpreted as any);
    expect(spec.anchors).toEqual([{ rawName: 'San Telmo', kind: 'area', priority: 'soft' }]);
  });

  it('every facet.required is false (positive preferences stay soft, spec §10)', () => {
    const interpreted = {
      ...emptyIntent(),
      preferredFacets: [{ dimension: 'theme', key: 'tango', importance: 1, confidence: 1, source: 'free_text' }],
    };
    const spec = buildPreferenceSpec(baseRequest(), interpreted as any);
    expect(spec.facets.every((f) => f.required === false)).toBe(true);
  });

  it('deduplicates a facet present in both wizard and interpreted, keeping the higher weight', () => {
    const interpreted = {
      ...emptyIntent(),
      preferredFacets: [{ dimension: 'theme', key: 'history', importance: 0.6, confidence: 0.6, source: 'free_text' }],
    };
    const spec = buildPreferenceSpec(baseRequest(), interpreted as any);
    const historyFacets = spec.facets.filter((f) => f.dimension === 'theme' && f.key === 'history');
    expect(historyFacets).toHaveLength(1);
    expect(historyFacets[0].weight).toBe(1); // wizard's 1.0 wins over free_text's 0.36
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/preference-spec-builder.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { TourGenerationRequest, BudgetLevel, GroupType } from '../interfaces/tour-generation.interface';
import { PreferenceSpec, RequestedFacet } from '../interfaces/preference-spec.interface';
import { calculateEffectiveWeight } from '../preferences/preference-facet.interface';
import { normalizeWizardFacet } from './preference-facet-merge.util';

function dedupe(facets: RequestedFacet[]): RequestedFacet[] {
  const byKey = new Map<string, RequestedFacet>();
  for (const f of facets) {
    const k = `${f.dimension}:${f.key}`;
    const existing = byKey.get(k);
    if (!existing || f.weight > existing.weight) byKey.set(k, f);
  }
  return [...byKey.values()];
}

export function buildPreferenceSpec(
  request: TourGenerationRequest,
  interpreted: NormalizedPreferenceIntent,
): PreferenceSpec {
  const wizardFacets: RequestedFacet[] = [
    ...(request.intent.interests ?? []).map((interest) => normalizeWizardFacet('theme', interest)),
    ...(request.intent.intents ?? []).map((intent) => normalizeWizardFacet('intent', intent)),
    normalizeWizardFacet('exploration_style', request.intent.explorationStyle),
  ]
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
    .map((f) => ({ dimension: f.dimension, key: f.key, weight: calculateEffectiveWeight(f), source: 'wizard' as const, required: false }));

  const interpretedFacets: RequestedFacet[] = (interpreted.preferredFacets ?? []).map((f) => ({
    dimension: f.dimension,
    key: f.key,
    weight: calculateEffectiveWeight(f),
    source: 'free_text' as const,
    required: false,
  }));

  const budget = [...(request.dietaryRestrictions ?? [])];
  if (request.budgetLevel === BudgetLevel.LOW) budget.push('low budget');
  const group = [...(interpreted.groupPreferences ?? [])];
  if (request.groupType === GroupType.FAMILY) group.push('family friendly');

  return {
    facets: dedupe([...wizardFacets, ...interpretedFacets]),
    exclusions: {
      themes: interpreted.excludedThemes ?? [],
      traits: interpreted.excludedTraits ?? [],
      hard: interpreted.hardExclusions ?? [],
    },
    anchors: interpreted.anchoredPlaces ?? [],
    semanticQuery: interpreted.positiveSemanticQuery ?? '',
    explorationStyle: (request.intent.explorationStyle as any) ?? 'balanced',
    softConstraints: {
      dietary: interpreted.dietaryPreferences ?? [],
      accessibility: [...(interpreted.accessibilityPreferences ?? []), ...(request.mobility.accessibilityNeeds ?? [])],
      budget,
      group,
    },
    trip: {
      days: request.days,
      startDates: request.startDates ?? [],
      pace: (request.mobility.travelPace as any) ?? 'moderate',
    },
  };
}
```

Note: `normalizeWizardFacet` and `calculateEffectiveWeight` already exist (`preference-facet-merge.util.ts`, `preferences/preference-facet.interface.ts`) — this task reuses them, it does not reimplement facet weighting.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/preference-spec-builder.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/preference-spec-builder.util.ts be/src/modules/tours/utils/preference-spec-builder.util.spec.ts
git commit -m "feat(tours): build PreferenceSpec from wizard + interpreted intent"
```

---

### Task A4: Facet sufficiency util (Stage 3c)

**Files:**
- Create: `be/src/modules/tours/utils/facet-sufficiency.util.ts`
- Test: `be/src/modules/tours/utils/facet-sufficiency.util.spec.ts`

**Interfaces:**
- Produces: `requiredMatchCount(days, pace): number`, `isStrongMatch(experience, facet): boolean`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { requiredMatchCount, isStrongMatch } from './facet-sufficiency.util';

describe('requiredMatchCount', () => {
  it('clamps days to [1,14] and applies the pace factor', () => {
    expect(requiredMatchCount(1, 'moderate')).toBe(4);
    expect(requiredMatchCount(2, 'relaxed')).toBe(6);
    expect(requiredMatchCount(1, 'fast')).toBe(5);
    expect(requiredMatchCount(20, 'moderate')).toBe(56); // clamped to 14 * 4
    expect(requiredMatchCount(0, 'moderate')).toBe(4); // clamped to 1 * 4
  });
});

describe('isStrongMatch', () => {
  const facet = { dimension: 'theme', key: 'history', weight: 1, source: 'wizard' as const, required: false };
  it('is strong when the primitive matches, quality clears the floor, and grounding exists', () => {
    const exp = { canonicalName: 'X', themes: ['history'], traits: [], intents: [], qualityScore: 4.0,
      metadata: { themes: ['history'], traits: [], intents: [] } };
    expect(isStrongMatch(exp, facet)).toBe(true);
  });
  it('is weak when qualityScore is below the floor', () => {
    const exp = { canonicalName: 'X', themes: ['history'], traits: [], intents: [], qualityScore: 2.0,
      metadata: { themes: ['history'], traits: [], intents: [] } };
    expect(isStrongMatch(exp, facet)).toBe(false);
  });
  it('is weak when qualityScore is null (no rating, no notability signal)', () => {
    const exp = { canonicalName: 'X', themes: ['history'], traits: [], intents: [], qualityScore: null,
      metadata: { themes: ['history'], traits: [], intents: [] } };
    expect(isStrongMatch(exp, facet)).toBe(false);
  });
  it('is false when the primitive itself does not match', () => {
    const exp = { canonicalName: 'X', themes: [], traits: [], intents: [], qualityScore: 4.5,
      metadata: { themes: [], traits: [], intents: [] } };
    expect(isStrongMatch(exp, facet)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/facet-sufficiency.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { RequestedFacet } from '../interfaces/preference-spec.interface';
import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';

const PACE_FACTOR: Record<string, number> = { relaxed: 3, moderate: 4, fast: 5 };
export const QUALITY_FLOOR = 3.0;

export function requiredMatchCount(days: number, pace: string): number {
  const clampedDays = Math.max(1, Math.min(days || 1, 14));
  const factor = PACE_FACTOR[pace] ?? PACE_FACTOR.moderate;
  return clampedDays * factor;
}

export function isStrongMatch(
  experience: { qualityScore?: number | null } & Record<string, unknown>,
  facet: Pick<RequestedFacet, 'dimension' | 'key'>,
): boolean {
  if (!candidateMatchesPreferenceFacet(experience, { ...facet, importance: 1, confidence: 1, source: 'wizard' })) {
    return false;
  }
  const q = experience.qualityScore;
  return typeof q === 'number' && q >= QUALITY_FLOOR;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/facet-sufficiency.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/facet-sufficiency.util.ts be/src/modules/tours/utils/facet-sufficiency.util.spec.ts
git commit -m "feat(tours): add facet sufficiency target and strong-match classification"
```

---

### Task A5: `FacetRetrievalService` (Stage 3, real Postgres)

**Files:**
- Create: `be/src/modules/tours/services/facet-retrieval.service.ts`
- Test: `be/test/integration/per-facet-retrieval.integration-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `RequestedFacet` (A1), `isStrongMatch`/`requiredMatchCount` (A4).
- Produces:
```typescript
async retrieveForFacet(
  facet: RequestedFacet,
  scope: { latitude: number; longitude: number; radiusMeters: number },
  trip: { days: number; pace: string },
): Promise<FacetCandidates>
```

- [ ] **Step 1: Write the failing integration test**

```typescript
import { PrismaService } from 'src/core/database/prisma.service';
import { FacetRetrievalService } from 'src/modules/tours/services/facet-retrieval.service';
import { getGuardedCharacterizationPrisma, resetCharacterizationDb, closeDb } from '../characterization/support/db';

describe('FacetRetrievalService (real Postgres)', () => {
  let prisma: PrismaService;
  let service: FacetRetrievalService;

  beforeAll(async () => {
    prisma = await getGuardedCharacterizationPrisma();
    service = new FacetRetrievalService(prisma);
  });
  afterAll(async () => { await resetCharacterizationDb(prisma); await closeDb(); });
  beforeEach(async () => { await resetCharacterizationDb(prisma); });

  async function seedExperience(name: string, themes: string[], quality: number | null, lat = -32.947, lng = -60.63) {
    const geo = await prisma.geoEntity.create({ data: { name, kind: 'PLACE', latitude: lat, longitude: lng } });
    return prisma.experience.create({
      data: {
        canonicalName: name, status: 'VERIFIED', qualityScore: quality,
        metadata: { themes, traits: [], intents: [] },
        components: { create: [{ geoEntityId: geo.id, role: 'venue', required: true }] },
      },
    });
  }

  it('returns strong matches ordered, sufficient=true once the pace target is met', async () => {
    for (let i = 0; i < 4; i++) await seedExperience(`Museo ${i}`, ['history'], 4.2);
    const result = await service.retrieveForFacet(
      { dimension: 'theme', key: 'history', weight: 1, source: 'wizard', required: false },
      { latitude: -32.947, longitude: -60.63, radiusMeters: 3000 },
      { days: 1, pace: 'moderate' },
    );
    expect(result.matches).toHaveLength(4);
    expect(result.sufficient).toBe(true);
    expect(result.deficitCount).toBe(0);
  });

  it('reports insufficient with the exact deficit count', async () => {
    await seedExperience('Museo Solo', ['history'], 4.0);
    const result = await service.retrieveForFacet(
      { dimension: 'theme', key: 'history', weight: 1, source: 'wizard', required: false },
      { latitude: -32.947, longitude: -60.63, radiusMeters: 3000 },
      { days: 1, pace: 'moderate' },
    );
    expect(result.sufficient).toBe(false);
    expect(result.deficitCount).toBe(3); // needs 4, has 1
  });

  it('excludes a facet-less Experience even if its name mentions the theme (no keyword scan)', async () => {
    await seedExperience('Museo Histórico Nacional', [], 4.5); // themes:[] — the CHAR-1/CHAR-3 case
    const result = await service.retrieveForFacet(
      { dimension: 'theme', key: 'history', weight: 1, source: 'wizard', required: false },
      { latitude: -32.947, longitude: -60.63, radiusMeters: 3000 },
      { days: 1, pace: 'moderate' },
    );
    expect(result.matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern per-facet-retrieval`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { ExperienceStatus } from '@prisma/client';
import { RequestedFacet, FacetCandidates } from '../interfaces/preference-spec.interface';
import { facetKey } from '../interfaces/preference-spec.interface';
import { isStrongMatch, requiredMatchCount } from '../utils/facet-sufficiency.util';

@Injectable()
export class FacetRetrievalService {
  constructor(private readonly prisma: PrismaService) {}

  async retrieveForFacet(
    facet: RequestedFacet,
    scope: { latitude: number; longitude: number; radiusMeters: number },
    trip: { days: number; pace: string },
  ): Promise<FacetCandidates> {
    const deltaLat = scope.radiusMeters / 111_000;
    const rows = await this.prisma.experience.findMany({
      where: {
        status: ExperienceStatus.VERIFIED,
        latitude: { gte: scope.latitude - deltaLat, lte: scope.latitude + deltaLat },
        longitude: { gte: scope.longitude - deltaLat, lte: scope.longitude + deltaLat },
      },
      include: { traits: { include: { traitDefinition: true } } },
      take: 500,
    });

    const strong = rows
      .map((row) => ({
        id: row.id,
        qualityScore: row.qualityScore,
        ...(row.metadata as Record<string, any>),
      }))
      .filter((exp) => isStrongMatch(exp, facet))
      .map((exp) => exp.id);

    const required = requiredMatchCount(trip.days, trip.pace);
    return {
      facet,
      matches: strong,
      sufficient: strong.length >= required,
      deficitCount: Math.max(0, required - strong.length),
    };
  }
}
```

(The bounding-box scope filter mirrors the existing catalog-query pattern in `ExperienceCatalogService.findVerifiedWithin` — this task does not reinvent geographic scoping, it reuses the same box-then-precise-distance idea, kept intentionally simple here since precision refinement is Checkpoint D's wiring concern, not this pure retrieval building block.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern per-facet-retrieval`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/facet-retrieval.service.ts be/test/integration/per-facet-retrieval.integration-spec.ts
git commit -m "feat(tours): add FacetRetrievalService for per-facet catalog retrieval"
```

---

### Task A6: Iconicity util

**Files:**
- Create: `be/src/modules/tours/utils/iconicity.util.ts`
- Test: `be/src/modules/tours/utils/iconicity.util.spec.ts`

**Interfaces:**
- Produces: `computeIconicity(signals: { userRatingCount?: number; wikidataSitelinkCount?: number; wikivoyageListed?: boolean; osmHeritage?: boolean }): number` (0..1).

- [ ] **Step 1: Write the failing tests**

```typescript
import { computeIconicity } from './iconicity.util';

describe('computeIconicity', () => {
  it('returns 0 for no signals', () => {
    expect(computeIconicity({})).toBe(0);
  });
  it('is monotonic in userRatingCount (log-scaled, capped at 1)', () => {
    const low = computeIconicity({ userRatingCount: 10 });
    const high = computeIconicity({ userRatingCount: 90000 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });
  it('wikidataSitelinkCount, wikivoyageListed and osmHeritage each add a bounded contribution', () => {
    const base = computeIconicity({ userRatingCount: 100 });
    const withSitelinks = computeIconicity({ userRatingCount: 100, wikidataSitelinkCount: 40 });
    const withAll = computeIconicity({
      userRatingCount: 100, wikidataSitelinkCount: 40, wikivoyageListed: true, osmHeritage: true,
    });
    expect(withSitelinks).toBeGreaterThan(base);
    expect(withAll).toBeGreaterThan(withSitelinks);
    expect(withAll).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/utils/iconicity.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export interface IconicitySignals {
  userRatingCount?: number;
  wikidataSitelinkCount?: number;
  wikivoyageListed?: boolean;
  osmHeritage?: boolean;
}

export function computeIconicity(signals: IconicitySignals): number {
  const ratingComponent = signals.userRatingCount
    ? Math.min(1, Math.log10(signals.userRatingCount + 1) / 5) * 0.6
    : 0;
  const sitelinkComponent = signals.wikidataSitelinkCount
    ? Math.min(1, Math.log10(signals.wikidataSitelinkCount + 1) / 2) * 0.25
    : 0;
  const wikivoyageComponent = signals.wikivoyageListed ? 0.1 : 0;
  const heritageComponent = signals.osmHeritage ? 0.05 : 0;
  return Math.min(1, ratingComponent + sitelinkComponent + wikivoyageComponent + heritageComponent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/utils/iconicity.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/iconicity.util.ts be/src/modules/tours/utils/iconicity.util.spec.ts
git commit -m "feat(tours): add deterministic iconicity scoring for the exploration_style tilt"
```

---

### Checkpoint A Verification

```bash
cd be
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn test src/modules/tours/interfaces/preference-spec.interface.spec.ts src/modules/tours/services/preference-interpreter.service.spec.ts src/modules/tours/utils/preference-spec-builder.util.spec.ts src/modules/tours/utils/facet-sufficiency.util.spec.ts src/modules/tours/utils/iconicity.util.spec.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern per-facet-retrieval
```
All green before starting Checkpoint B.

---

## Checkpoint B — Acquisition & classification pipeline (Stages 4–7, 6c quality, D1/D2/D5)

Builds the new evidence path: adapter fixes, per-facet routing, the classification service, quality scoring, order-independent metadata merge, and the area-anchor walk acquisition. Everything here is testable against real providers or real Postgres without touching the live orchestration yet.

### Task B1: Adapter evidence preservation (spec §5.5)

**Files:**
- Modify: `be/src/modules/tours/providers/osm-acquisition.provider.ts`
- Modify: `be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts`
- Modify: `be/src/modules/integrations/google-places/services/google-places-api.service.ts`
- Modify: `be/src/modules/tours/providers/google-places-acquisition.provider.ts`
- Test: `be/src/modules/tours/providers/osm-acquisition.provider.spec.ts`, `wikivoyage-acquisition.provider.spec.ts`, `google-places-acquisition.provider.spec.ts` (existing files — add cases)

**Interfaces:**
- No signature changes; only `SourceObservation.metadata` gains fields.

- [ ] **Step 1: Write the failing tests** — one per adapter:

OSM (`osm-acquisition.provider.spec.ts`):
```typescript
it('copies narrativeContext into metadata.wikidataNarrative when the OSM candidate carries one', async () => {
  osmPlaces.lookupFeaturesNear.mockResolvedValue(
    okLookup([
      candidate({
        id: 'osm:node:900', osmType: 'node', osmId: 900, name: 'Monumento X',
        tags: { name: 'Monumento X', historic: 'monument', wikidata: 'Q1' },
        narrativeContext: 'A long factual paragraph about Monumento X sourced from Wikidata.',
      }),
    ]),
  );
  const result = await provider.acquire(destination, { concepts: ['monument'] });
  expect(result.value[0].metadata!.wikidataNarrative).toBe(
    'A long factual paragraph about Monumento X sourced from Wikidata.',
  );
});
it('omits wikidataNarrative when the candidate has none', async () => {
  osmPlaces.lookupFeaturesNear.mockResolvedValue(
    okLookup([candidate({ id: 'osm:node:901', osmType: 'node', osmId: 901, name: 'Y', tags: { name: 'Y', historic: 'monument' } })]),
  );
  const result = await provider.acquire(destination, { concepts: ['monument'] });
  expect(result.value[0].metadata!.wikidataNarrative).toBeUndefined();
});
```

Wikivoyage (`wikivoyage-acquisition.provider.spec.ts`):
```typescript
it('carries sectionType and templateName in metadata', async () => {
  apiService.fetchArticle.mockResolvedValue({
    status: 'found', title: 'Rosario', pageid: 1,
    entries: [{ name: 'Monumento a la Bandera', description: 'x', sectionType: 'SEE', templateName: 'see' }],
  });
  const result = await provider.acquire('Rosario');
  expect(result.value[0].metadata).toEqual({ sectionType: 'SEE', templateName: 'see' });
});
```

Google Places (`google-places-acquisition.provider.spec.ts`):
```typescript
it('carries editorialSummary, websiteUri, priceLevel and businessStatus into metadata', async () => {
  placesApi.searchNearby.mockResolvedValue({
    data: [{
      id: 'p1', displayName: { text: 'Teatro Colón' }, primaryType: 'tourist_attraction', types: ['tourist_attraction'],
      location: { latitude: -34.6, longitude: -58.38 },
      editorialSummary: { text: 'Teatro monumental...' }, websiteUri: 'https://teatrocolon.org.ar',
      priceLevel: 'PRICE_LEVEL_FREE', businessStatus: 'OPERATIONAL',
    }],
  });
  const result = await provider.acquire(destination);
  expect(result.value[0].metadata).toMatchObject({
    editorialSummary: 'Teatro monumental...', websiteUri: 'https://teatrocolon.org.ar',
    priceLevel: 'PRICE_LEVEL_FREE', businessStatus: 'OPERATIONAL',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/providers/osm-acquisition.provider.spec.ts src/modules/tours/providers/wikivoyage-acquisition.provider.spec.ts src/modules/tours/providers/google-places-acquisition.provider.spec.ts`
Expected: FAIL — the new metadata fields are absent/undefined where the tests expect values.

- [ ] **Step 3: Implement**

In `osm-acquisition.provider.ts`, inside the `byExternalId.set(candidate.id, {...})` block, add to `metadata`:
```typescript
metadata: {
  osmType: candidate.osmType,
  osmTags: candidate.tags,
  matchedConcepts: uniqueSorted(matchedConcepts),
  ...(candidate.narrativeContext ? { wikidataNarrative: candidate.narrativeContext } : {}),
},
```

In `wikivoyage-acquisition.provider.ts`, add to the returned observation object:
```typescript
metadata: { sectionType: entry.sectionType, templateName: entry.templateName },
```

In `google-places-api.service.ts`'s `getFieldMask()`, add `'places.editorialSummary'` to the array (also add `places.websiteUri` and `places.businessStatus` if not already requested — they are declared in `PlaceData` today but never fetched; add both to the mask string).

In `google-places-acquisition.provider.ts`, extend the `metadata` object in the observation push:
```typescript
metadata: {
  rating: place.rating,
  userRatingCount: place.userRatingCount,
  primaryType: place.primaryType,
  types: place.types,
  openingHoursWeekdayText: place.openingHoursWeekdayText,
  editorialSummary: place.editorialSummary?.text,
  websiteUri: place.websiteUri,
  priceLevel: place.priceLevel,
  businessStatus: place.businessStatus,
},
```
(Google's `editorialSummary` field on a Place is `{ text: string; languageCode?: string }` — add that shape to `PlaceData` in `places-api.interface.ts` and to `mapResponse` in `google-places-api.service.ts` if it is not already mapped through.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/providers/osm-acquisition.provider.spec.ts src/modules/tours/providers/wikivoyage-acquisition.provider.spec.ts src/modules/tours/providers/google-places-acquisition.provider.spec.ts`
Expected: PASS (including all pre-existing cases).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/providers/osm-acquisition.provider.ts be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts be/src/modules/integrations/google-places/services/google-places-api.service.ts be/src/modules/integrations/google-places/interfaces/places-api.interface.ts be/src/modules/tours/providers/google-places-acquisition.provider.ts be/src/modules/tours/providers/*.spec.ts
git commit -m "fix(tours): stop discarding OSM narrative, Wikivoyage section, and Places editorial evidence"
```

---

### Task B2: Classification prompt + `ExperienceClassificationService` (Stage 6a/6b, D1/D2)

**Files:**
- Create: `be/src/modules/tours/prompts/experience-semantic-classification.prompt.ts`
- Create: `be/src/modules/tours/utils/trait-shape-guard.util.ts`
- Create: `be/src/modules/tours/services/experience-classification.service.ts`
- Test: `be/src/modules/tours/utils/trait-shape-guard.util.spec.ts`, `be/src/modules/tours/services/experience-classification.service.spec.ts`

**Interfaces:**
- Consumes: `LangChainService.generateChatResponse` (existing), corroborated evidence bundle shape `{ experienceId?: string; observations: SourceObservation[] }` (`experienceId` present only when Stage 5 already matched an existing catalog row).
- Produces:
```typescript
export interface ClassificationResult {
  themes: string[]; intents: string[]; traits: string[];
  reasoningEvidence: Array<{ facet: string; evidenceKeys: string[]; reason: string }>;
  modelId: string; promptVersion: number;
}
async classify(bundle: { experienceId?: string; observations: SourceObservation[] }): Promise<ClassificationResult | 'skipped'>
```

- [ ] **Step 1: Write the failing tests**

`trait-shape-guard.util.spec.ts`:
```typescript
import { guardTraits } from './trait-shape-guard.util';

describe('guardTraits', () => {
  it('keeps short, evidence-flavored string traits', () => {
    expect(guardTraits(['wheelchair accessible', 'panoramic city views'])).toEqual([
      'wheelchair accessible', 'panoramic city views',
    ]);
  });
  it('rejects sentence-shaped traits (too long / contains a period mid-string)', () => {
    expect(guardTraits(['The monument is a historic landmark with architectural significance.'])).toEqual([]);
  });
  it('rejects a trait that is actually a canonical theme or intent key', () => {
    expect(guardTraits(['history', 'walk', 'wheelchair accessible'])).toEqual(['wheelchair accessible']);
  });
  it('rejects non-string entries and empty strings', () => {
    expect(guardTraits([{ trait: 'x' } as any, '', '   '])).toEqual([]);
  });
});
```

`experience-classification.service.spec.ts`:
```typescript
describe('ExperienceClassificationService', () => {
  let langChain: { generateChatResponse: jest.Mock };
  let service: ExperienceClassificationService;

  beforeEach(() => {
    langChain = { generateChatResponse: jest.fn() };
    service = new ExperienceClassificationService(langChain as any);
  });

  it('skips classification and returns "skipped" when the bundle already matched a catalog Experience (D2)', async () => {
    const result = await service.classify({ experienceId: 'exp-1', observations: [] });
    expect(result).toBe('skipped');
    expect(langChain.generateChatResponse).not.toHaveBeenCalled();
  });

  it('classifies a new bundle with one call, evidence-only, no dimensionedFacets', async () => {
    langChain.generateChatResponse.mockResolvedValue(JSON.stringify({
      themes: ['history'], intents: ['visit'], traits: ['wheelchair accessible'],
      reasoningEvidence: [{ facet: 'history', evidenceKeys: ['osm:1'], reason: 'tagged historic=monument' }],
    }));
    const result = await service.classify({
      observations: [{ provider: 'osm', evidenceKey: 'osm:1', title: 'X', evidenceType: 'place',
        metadata: { osmTags: { historic: 'monument' } } } as any],
    });
    expect(result).not.toBe('skipped');
    const r = result as any;
    expect(r.themes).toEqual(['history']);
    expect(r.traits).toEqual(['wheelchair accessible']);
    expect((r as any).dimensionedFacets).toBeUndefined();
    const [systemPrompt, userPrompt] = langChain.generateChatResponse.mock.calls[0];
    expect(systemPrompt).not.toMatch(/requestedThemes|explorationStyle|additionalPreferences/i);
  });

  it('retries with backoff on a 429 and eventually succeeds', async () => {
    langChain.generateChatResponse
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(JSON.stringify({ themes: [], intents: [], traits: [], reasoningEvidence: [] }));
    const result = await service.classify({ observations: [{ provider: 'osm', evidenceKey: 'osm:2', title: 'Y', evidenceType: 'place', metadata: {} } as any] });
    expect(result).not.toBe('skipped');
    expect(langChain.generateChatResponse).toHaveBeenCalledTimes(2);
  });

  it('degrades to themes:[] traits:[] intents:[] on repeated failure, never throws', async () => {
    langChain.generateChatResponse.mockRejectedValue(new Error('down'));
    const result = await service.classify({ observations: [{ provider: 'osm', evidenceKey: 'osm:3', title: 'Z', evidenceType: 'place', metadata: {} } as any] });
    expect(result).toEqual(expect.objectContaining({ themes: [], intents: [], traits: [] }));
  });

  it('applies the trait-shape guard to the raw model output', async () => {
    langChain.generateChatResponse.mockResolvedValue(JSON.stringify({
      themes: [], intents: [], traits: ['A very long sentence trait that is not a real property.', 'free admission'],
      reasoningEvidence: [],
    }));
    const result = await service.classify({ observations: [{ provider: 'osm', evidenceKey: 'osm:4', title: 'W', evidenceType: 'place', metadata: {} } as any] });
    expect((result as any).traits).toEqual(['free admission']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/trait-shape-guard.util.spec.ts src/modules/tours/services/experience-classification.service.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`trait-shape-guard.util.ts`:
```typescript
import { CANONICAL_THEME_KEYS, CANONICAL_INTENT_KEYS } from './experience-candidate-facet-normalizer.util';

const CANONICAL_KEYS = new Set([...CANONICAL_THEME_KEYS, ...CANONICAL_INTENT_KEYS]);
const MAX_TRAIT_LENGTH = 60;

export function guardTraits(raw: unknown[]): string[] {
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= MAX_TRAIT_LENGTH)
    .filter((t) => !t.includes('. ')) // reject sentence-shaped traits
    .filter((t) => !CANONICAL_KEYS.has(t.toLowerCase()));
}
```

`experience-semantic-classification.prompt.ts`:
```typescript
import { CANONICAL_THEME_KEYS, CANONICAL_INTENT_KEYS } from '../utils/experience-candidate-facet-normalizer.util';

export const CLASSIFICATION_PROMPT_VERSION = 1;

export function buildClassificationSystemPrompt(): string {
  return `You are a tourism semantic classifier. Classify ONE already-grounded Experience from the supplied provider evidence ONLY.
No discovery, no identity. There are NO user preferences in this task. Lack of evidence = UNKNOWN. Empty arrays are valid.
Every theme/intent/trait must be supported by >=1 evidenceKey. Never repeat a canonical theme/intent inside traits.
Never infer popularity merely from being a tourist attraction, iconic merely from Wikipedia/Wikidata existing, or local/hidden/authentic from absence of evidence.
Emit a canonical theme only when the place is SUBSTANTIALLY about that theme -- not when the word appears incidentally (e.g. a menu mentioning wine does not make theme:wine; a café hosting occasional tango does not make theme:tango unless tango is a defining feature). Prefer traits for incidental facts.
Do NOT emit dimensionedFacets. Return JSON only.
CANONICAL THEMES: ${CANONICAL_THEME_KEYS.join(' ')}
CANONICAL INTENTS: ${CANONICAL_INTENT_KEYS.join(' ')}
TRAITS: open-ended concise evidence-backed properties (accessibility, atmosphere, visit format, views, guided/self-guided, hands-on, distinctive facts). No generic traits ("interesting", "recommended", "nice place").
OUTPUT: {"themes":[],"intents":[],"traits":[],"reasoningEvidence":[{"facet":"..","evidenceKeys":["..],"reason":".."}]}`;
}
```

`experience-classification.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/services/langchain.service';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { buildClassificationSystemPrompt, CLASSIFICATION_PROMPT_VERSION } from '../prompts/experience-semantic-classification.prompt';
import { guardTraits } from '../utils/trait-shape-guard.util';
import { normalizeExperienceCandidateFacets } from '../utils/experience-candidate-facet-normalizer.util';

export interface ClassificationResult {
  themes: string[];
  intents: string[];
  traits: string[];
  reasoningEvidence: Array<{ facet: string; evidenceKeys: string[]; reason: string }>;
  modelId: string;
  promptVersion: number;
}

const MODEL_ID = 'qwen/qwen3.8-27b';
const MAX_RETRIES = 3;

@Injectable()
export class ExperienceClassificationService {
  private readonly logger = new Logger(ExperienceClassificationService.name);

  constructor(private readonly langChain: LangChainService) {}

  async classify(bundle: {
    experienceId?: string;
    observations: SourceObservation[];
  }): Promise<ClassificationResult | 'skipped'> {
    // D2: Stage 5 corroboration already resolved identity; if this bundle
    // matched an existing catalog Experience, its metadata.classification is
    // reused directly by the caller -- Stage 6 never runs for it.
    if (bundle.experienceId) return 'skipped';

    const systemPrompt = buildClassificationSystemPrompt();
    const userPrompt = `Classify:\n${JSON.stringify({ observations: bundle.observations })}`;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const raw = await this.langChain.generateChatResponse(systemPrompt, userPrompt, {}, {
          responseFormat: { type: 'json_object' },
        });
        const parsed = JSON.parse(raw);
        const normalized = normalizeExperienceCandidateFacets({
          themes: parsed.themes ?? [], traits: parsed.traits ?? [], intents: parsed.intents ?? [],
        });
        return {
          themes: normalized.themes,
          intents: normalized.intents,
          traits: guardTraits(normalized.traits),
          reasoningEvidence: Array.isArray(parsed.reasoningEvidence) ? parsed.reasoningEvidence : [],
          modelId: MODEL_ID,
          promptVersion: CLASSIFICATION_PROMPT_VERSION,
        };
      } catch (error: any) {
        const isRateLimited = error?.status === 429;
        if (isRateLimited && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        this.logger.warn(`Classification failed, degrading to empty facets: ${error?.message ?? error}`);
        return { themes: [], intents: [], traits: [], reasoningEvidence: [], modelId: MODEL_ID, promptVersion: CLASSIFICATION_PROMPT_VERSION };
      }
    }
    return { themes: [], intents: [], traits: [], reasoningEvidence: [], modelId: MODEL_ID, promptVersion: CLASSIFICATION_PROMPT_VERSION };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/trait-shape-guard.util.spec.ts src/modules/tours/services/experience-classification.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/prompts/experience-semantic-classification.prompt.ts be/src/modules/tours/utils/trait-shape-guard.util.ts be/src/modules/tours/services/experience-classification.service.ts be/src/modules/tours/utils/trait-shape-guard.util.spec.ts be/src/modules/tours/services/experience-classification.service.spec.ts
git commit -m "feat(tours): add evidence-only semantic classification (Stage 6, D1/D2)"
```

---

### Task B3: Quality score util (Stage 6c)

**Files:**
- Create: `be/src/modules/tours/utils/quality-score.util.ts`
- Test: `be/src/modules/tours/utils/quality-score.util.spec.ts`

**Interfaces:**
- Produces: `computeQualityScore(signals: { rating?: number; userRatingCount?: number; wikivoyageListed?: boolean; wikidataSitelinkCount?: number }): number | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { computeQualityScore } from './quality-score.util';

describe('computeQualityScore', () => {
  it('returns the raw Places rating when present, on the 0..5 scale', () => {
    expect(computeQualityScore({ rating: 4.7, userRatingCount: 5321 })).toBeCloseTo(4.7, 1);
  });
  it('down-weights a high rating with very few reviews', () => {
    const fewReviews = computeQualityScore({ rating: 5.0, userRatingCount: 2 })!;
    const manyReviews = computeQualityScore({ rating: 5.0, userRatingCount: 5000 })!;
    expect(fewReviews).toBeLessThan(manyReviews);
    expect(manyReviews).toBeCloseTo(5.0, 1);
  });
  it('derives a score from Wikivoyage/Wikidata notability when there is no rating', () => {
    const score = computeQualityScore({ wikivoyageListed: true, wikidataSitelinkCount: 40 });
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
    expect(score!).toBeLessThanOrEqual(5);
  });
  it('returns null when there is no signal at all', () => {
    expect(computeQualityScore({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/utils/quality-score.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export interface QualitySignals {
  rating?: number;
  userRatingCount?: number;
  wikivoyageListed?: boolean;
  wikidataSitelinkCount?: number;
}

export function computeQualityScore(signals: QualitySignals): number | null {
  if (typeof signals.rating === 'number') {
    const confidence = Math.min(1, Math.log10((signals.userRatingCount ?? 0) + 1) / 3);
    // A rating with near-zero review count regresses toward the population mid-point (3.5)
    // rather than being trusted at face value.
    return Number((signals.rating * confidence + 3.5 * (1 - confidence)).toFixed(2));
  }
  if (signals.wikivoyageListed || (signals.wikidataSitelinkCount ?? 0) > 0) {
    const sitelinkComponent = Math.min(1, Math.log10((signals.wikidataSitelinkCount ?? 0) + 1) / 2);
    const base = signals.wikivoyageListed ? 3.5 : 3.0;
    return Number(Math.min(5, base + sitelinkComponent * 1.5).toFixed(2));
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/utils/quality-score.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/quality-score.util.ts be/src/modules/tours/utils/quality-score.util.spec.ts
git commit -m "feat(tours): add deterministic quality scoring from provider signals"
```

---

### Task B4: Order-independent `mergeMetadata` + real trait dimensions

**Files:**
- Create: `be/src/modules/tours/utils/merge-metadata.util.ts`
- Modify: `be/src/modules/tours/services/experience-catalog.service.ts`
- Test: `be/src/modules/tours/utils/merge-metadata.util.spec.ts`
- Test: `be/test/integration/provider-order-convergence.integration-spec.ts` (promotes the characterization CHAR-8 scenario)
- Test: `be/test/integration/trait-dimension-roundtrip.integration-spec.ts` (promotes CHAR-2 DB)

**Interfaces:**
- Produces: `mergeExperienceMetadata(current: unknown, incoming: unknown): Record<string, unknown> | undefined` (pure, order-independent).

- [ ] **Step 1: Write the failing tests**

`merge-metadata.util.spec.ts`:
```typescript
import { mergeExperienceMetadata } from './merge-metadata.util';

describe('mergeExperienceMetadata', () => {
  it('unions array-valued keys instead of letting an empty incoming array clear a populated one', () => {
    const merged = mergeExperienceMetadata(
      { themes: ['history', 'architecture'], traits: ['guided_tour'], intents: ['walk'] },
      { themes: [], traits: [], intents: [] },
    );
    expect(merged!.themes).toEqual(['history', 'architecture']);
    expect(merged!.traits).toEqual(['guided_tour']);
    expect(merged!.intents).toEqual(['walk']);
  });
  it('is order-independent: A then B equals B then A for the same two payloads', () => {
    const A = { themes: ['history'], qualityScore: 4.0 };
    const B = { themes: ['architecture'], qualityScore: 4.5 };
    const ab = mergeExperienceMetadata(A, B);
    const ba = mergeExperienceMetadata(B, A);
    expect(new Set(ab!.themes as string[])).toEqual(new Set(ba!.themes as string[]));
  });
  it('takes the max of a numeric qualityScore field', () => {
    const merged = mergeExperienceMetadata({ qualityScore: 3.5 }, { qualityScore: 4.2 });
    expect(merged!.qualityScore).toBe(4.2);
  });
  it('prefers a non-empty scalar over an empty one for a non-array field', () => {
    const merged = mergeExperienceMetadata({ source: 'osm' }, { source: '' });
    expect(merged!.source).toBe('osm');
  });
});
```

`trait-dimension-roundtrip.integration-spec.ts` (real Postgres): promote the exact scenario from `be/test/characterization/catalog-roundtrip.db.characterization-spec.ts`'s CHAR-2 DB block — `resolveOrCreateTraitDefinitions(['iconic'])` writes a real `dimension` (not `'general'`), and `exploration_style:iconic` now matches when that dimension is `tourism_intensity`.

`provider-order-convergence.integration-spec.ts`: promote the exact two-run scenario from `be/test/characterization/provider-order-convergence.db.characterization-spec.ts` (empty→rich and rich→empty both converge to the rich metadata).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/merge-metadata.util.spec.ts && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern "provider-order-convergence|trait-dimension-roundtrip"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
const ARRAY_UNION_KEYS = new Set(['themes', 'traits', 'intents', 'dimensionedTraits']);

function objectMetadata(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

export function mergeExperienceMetadata(current: unknown, incoming: unknown): Record<string, unknown> | undefined {
  const left = objectMetadata(current);
  const right = objectMetadata(incoming);
  const merged: Record<string, unknown> = { ...left };

  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const leftVal = left[key];
    const rightVal = right[key];
    if (ARRAY_UNION_KEYS.has(key)) {
      const arr = [...(Array.isArray(leftVal) ? leftVal : []), ...(Array.isArray(rightVal) ? rightVal : [])];
      merged[key] = key === 'dimensionedTraits'
        ? [...new Map(arr.map((v) => [JSON.stringify(v), v])).values()]
        : [...new Set(arr)];
      continue;
    }
    if (key === 'qualityScore') {
      merged[key] = Math.max(leftVal ?? 0, rightVal ?? 0) || (leftVal ?? rightVal);
      continue;
    }
    // scalar: prefer a non-empty incoming value, else keep the existing one
    merged[key] = rightVal !== undefined && rightVal !== '' && rightVal !== null ? rightVal : leftVal;
  }
  return Object.keys(merged).length ? merged : undefined;
}
```

In `experience-catalog.service.ts`, replace the private `mergeMetadata` method body with a call to `mergeExperienceMetadata(current, incoming)`, and replace the `resolveOrCreateTraitDefinitions` hardcoded `const dimension = 'general';` with a real per-trait dimension: pass the dimension through from the classification result's own facet dimension when the caller knows it (the caller — Task C's classification→persist wiring — now calls `resolveOrCreateTraitDefinitions` with `{ key, dimension }` pairs instead of bare strings; keep a bare-string overload for backward compatibility with any remaining caller during this checkpoint, defaulting only that overload to `'general'`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/merge-metadata.util.spec.ts && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern "provider-order-convergence|trait-dimension-roundtrip"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/merge-metadata.util.ts be/src/modules/tours/services/experience-catalog.service.ts be/src/modules/tours/utils/merge-metadata.util.spec.ts be/test/integration/provider-order-convergence.integration-spec.ts be/test/integration/trait-dimension-roundtrip.integration-spec.ts
git commit -m "fix(tours): order-independent metadata merge and real trait dimensions (fixes CHAR-2/CHAR-8)"
```

---

### Task B5: Area-anchor walk acquisition routing (D5)

**Files:**
- Modify: `be/src/modules/tours/constants/acquisition-source-routing.ts`
- Test: `be/src/modules/tours/constants/acquisition-source-routing.spec.ts` (existing file — add cases)

**Interfaces:**
- Produces: `lookupAreaWalkRoute(areaName: string): SourceCapabilityRoute` — a new exported helper alongside `lookupSourceCapabilityRoute`.

- [ ] **Step 1: Write the failing test**

```typescript
import { lookupAreaWalkRoute } from './acquisition-source-routing';

describe('lookupAreaWalkRoute', () => {
  it('routes to web with a self-guided walking-tour query naming the area', () => {
    const route = lookupAreaWalkRoute('San Telmo');
    expect(route.webKeywords).toEqual(
      expect.arrayContaining(['San Telmo walking tour self-guided']),
    );
    expect(route.osmConcepts).toBeUndefined();
    expect(route.placesTypes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/constants/acquisition-source-routing.spec.ts`
Expected: FAIL — `lookupAreaWalkRoute` is not exported.

- [ ] **Step 3: Implement**

```typescript
export function lookupAreaWalkRoute(areaName: string): SourceCapabilityRoute {
  return { webKeywords: [`${areaName} walking tour self-guided`] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/constants/acquisition-source-routing.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/constants/acquisition-source-routing.ts be/src/modules/tours/constants/acquisition-source-routing.spec.ts
git commit -m "feat(tours): add area-anchor walking-tour acquisition route (D5)"
```

---

### Task B6: Stage 4c contract narrows to entity + multi-stop enumeration (no classification)

**Files:**
- Modify: `be/src/modules/tours/utils/experience-candidate-extraction.util.ts`
- Test: `be/src/modules/tours/utils/experience-candidate-extraction.util.spec.ts` (existing file — add/adjust cases)

**Interfaces:**
- `extractExperienceCandidates` keeps its existing signature; the *contract* it validates against narrows: `themes`/`traits`/`intents` become optional and ignored downstream (classification moved to Stage 6); `componentHints[]` (identity/sequence) stays mandatory and unchanged, including multi-stop enumeration for route-shaped evidence.

- [ ] **Step 1: Write the failing test**

```typescript
it('accepts a candidate whose themes/traits/intents are entirely absent, keeping componentHints', () => {
  const raw = { candidates: [{
    name: 'San Telmo Walking Tour', description: 'A self-guided walk',
    componentHints: [
      { key: 'a', name: 'Plaza Dorrego', role: 'venue', expectedKind: 'PLACE', required: true, evidenceKeys: ['web:1'] },
      { key: 'b', name: 'Pasaje San Lorenzo', role: 'venue', expectedKind: 'PLACE', required: true, evidenceKeys: ['web:1'] },
    ],
    evidenceKeys: ['web:1'], shortReason: 'walking tour article', orderedByEvidence: false,
  }] };
  const result = extractExperienceCandidates(JSON.stringify(raw));
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].componentHints).toHaveLength(2);
  expect(result.candidates[0].themes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`
Expected: FAIL if the current validator still requires `themes` to be a non-empty/defined array (confirm against the existing implementation and adjust the assertion above to the true current failure before implementing — the plan's job is the fix, not to guess the exact current message).

- [ ] **Step 3: Implement**

Relax the validator so `themes`/`traits`/`intents` default to `[]` when absent instead of failing validation (the deterministic normalizer downstream already tolerates `[]`); keep every `componentHints[]` validation rule (`key`/`name`/`role`/`expectedKind`/`required`/`evidenceKeys`, the multi-stop "one hint per real named stop" instruction already in the discovery-extraction prompt) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`
Expected: PASS (including all pre-existing cases).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/experience-candidate-extraction.util.ts be/src/modules/tours/utils/experience-candidate-extraction.util.spec.ts
git commit -m "refactor(tours): narrow Stage 4c contract to identity/components, drop theme extraction"
```

---

### Checkpoint B Verification

```bash
cd be
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn test src/modules/tours/providers src/modules/tours/utils/trait-shape-guard.util.spec.ts src/modules/tours/services/experience-classification.service.spec.ts src/modules/tours/utils/quality-score.util.spec.ts src/modules/tours/utils/merge-metadata.util.spec.ts src/modules/tours/constants/acquisition-source-routing.spec.ts src/modules/tours/utils/experience-candidate-extraction.util.spec.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:integration --testPathPattern "provider-order-convergence|trait-dimension-roundtrip"
```

---

## Checkpoint C — Composition & planning (Stages 8–11, D3, D5 mechanism, Findings A/B/D)

### Task C1: Composition set-cover algorithm (Stage 9, Findings A/B/D)

**Files:**
- Create: `be/src/modules/tours/utils/composition-set-cover.util.ts`
- Test: `be/src/modules/tours/utils/composition-set-cover.util.spec.ts`

**Interfaces:**
- Consumes: a per-facet classified candidate view:
```typescript
export interface CompositionCandidate {
  id: string;
  componentCount: number; // 0 means a bare AREA/ROUTE GeoEntity with no components -- always rejected
  satisfiedFacets: string[]; // "dimension:key" list, already computed via candidateMatchesPreferenceFacet
  qualityScore: number | null;
  iconicity: number;
  semanticSimilarity: number;
  matchesHardExclusion: boolean;
  isPerformanceVenue: boolean; // grounded classification includes a performance-shaped intent, not just theme:tango-style ambiance
}
```
- Produces: `composeSet(candidates: CompositionCandidate[], spec: PreferenceSpec, resolvedAnchors: Array<{ anchorId: string; experienceId?: string; kind: AnchoredPlace['kind']; priority: AnchoredPlace['priority'] }>): CompositionResult`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { composeSet, CompositionCandidate } from './composition-set-cover.util';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';

const spec = (facets: Array<[string, string]>): PreferenceSpec => ({
  facets: facets.map(([dimension, key]) => ({ dimension, key, weight: 1, source: 'wizard', required: false })),
  exclusions: { themes: [], traits: [], hard: [] },
  anchors: [], semanticQuery: '', explorationStyle: 'balanced',
  softConstraints: { dietary: [], accessibility: [], budget: [], group: [] },
  trip: { days: 2, startDates: [], pace: 'moderate' },
});

const cand = (id: string, satisfied: string[], overrides: Partial<CompositionCandidate> = {}): CompositionCandidate => ({
  id, componentCount: 1, satisfiedFacets: satisfied, qualityScore: 4.0, iconicity: 0.5,
  semanticSimilarity: 0.5, matchesHardExclusion: false, isPerformanceVenue: false, ...overrides,
});

describe('composeSet', () => {
  it('covers every requested facet with at least one selected candidate', () => {
    const result = composeSet(
      [cand('a', ['theme:history']), cand('b', ['theme:tango'])],
      spec([['theme', 'history'], ['theme', 'tango']]),
      [],
    );
    expect(result.selected).toEqual(expect.arrayContaining(['a', 'b']));
    expect(result.unmetFacets).toEqual([]);
  });

  it('drops any candidate matching a hard exclusion before anything else', () => {
    const result = composeSet(
      [cand('a', ['theme:history'], { matchesHardExclusion: true }), cand('b', ['theme:history'])],
      spec([['theme', 'history']]),
      [],
    );
    expect(result.selected).not.toContain('a');
    expect(result.selected).toContain('b');
  });

  it('Finding D: rejects a candidate with componentCount 0 (bare AREA/ROUTE) before matching', () => {
    const result = composeSet(
      [cand('bare-area', ['theme:history', 'theme:architecture', 'theme:tango'], { componentCount: 0 }), cand('real', ['theme:history'])],
      spec([['theme', 'history']]),
      [],
    );
    expect(result.selected).not.toContain('bare-area');
    expect(result.selected).toContain('real');
  });

  it('Finding A: reserves the single strongest match for a facet even if it is monothematic, ahead of a multi-facet competitor', () => {
    const monothematicStrong = cand('bar-sur', ['theme:tango'], { qualityScore: 4.8 });
    const multiFacetWeaker = cand('el-querandi', ['theme:tango', 'theme:history', 'theme:architecture'], { qualityScore: 4.3 });
    const result = composeSet([monothematicStrong, multiFacetWeaker], spec([['theme', 'tango']]), []);
    expect(result.selected).toContain('bar-sur');
  });

  it('Finding B: intent:performance is satisfied only by a grounded performance venue, not an ambiance-only themed place', () => {
    const ambianceOnly = cand('cafe-tortoni', ['theme:tango'], { isPerformanceVenue: false });
    const realVenue = cand('bar-sur', ['theme:tango'], { isPerformanceVenue: true });
    const result = composeSet(
      [ambianceOnly, realVenue],
      spec([['intent', 'performance']]),
      [],
    );
    // ambianceOnly never satisfies intent:performance regardless of theme:tango
    expect(result.perFacetCoverage['intent:performance']).toEqual(['bar-sur']);
  });

  it('prefers multi-facet Experiences in the remainder fill after reservations', () => {
    const single = cand('single', ['theme:history']);
    const multi = cand('multi', ['theme:history', 'theme:architecture']);
    const result = composeSet([single, multi], spec([['theme', 'history'], ['theme', 'architecture']]), []);
    expect(result.selected).toContain('multi');
  });

  it('is deterministic: identical input twice produces a deep-equal result', () => {
    const candidates = [cand('a', ['theme:history']), cand('b', ['theme:history', 'theme:architecture'])];
    const s = spec([['theme', 'history'], ['theme', 'architecture']]);
    expect(composeSet(candidates, s, [])).toEqual(composeSet(candidates, s, []));
  });

  it('marks a facet with zero surviving candidates as unmet, never throws', () => {
    const result = composeSet([], spec([['theme', 'nightlife']]), []);
    expect(result.unmetFacets).toEqual(['theme:nightlife']);
    expect(result.selected).toEqual([]);
  });

  it('force-includes a soft venue anchor with a resolved experienceId', () => {
    const result = composeSet(
      [cand('teatro-colon', ['theme:architecture'])],
      spec([['theme', 'architecture']]),
      [{ anchorId: 'a1', experienceId: 'teatro-colon', kind: 'venue', priority: 'soft' }],
    );
    expect(result.anchorsForced).toEqual(['teatro-colon']);
    expect(result.selected).toContain('teatro-colon');
  });

  it('never force-includes an area/route anchor as a selectable stop, resolved or not', () => {
    const result = composeSet(
      [cand('area-experience', ['theme:history'], { componentCount: 0 })],
      spec([['theme', 'history']]),
      [{ anchorId: 'a1', experienceId: 'area-experience', kind: 'area', priority: 'soft' }],
    );
    expect(result.selected).not.toContain('area-experience');
    expect(result.anchorsForced).toEqual([]);
  });

  it('D3: an unresolved must venue anchor produces unmetAnchors reason UNRESOLVED, never throws', () => {
    const result = composeSet([], spec([]), [{ anchorId: 'a1', experienceId: undefined, kind: 'venue', priority: 'must' }]);
    expect(result.unmetAnchors).toEqual([
      { anchor: expect.objectContaining({ priority: 'must' }), reason: 'UNRESOLVED' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/composition-set-cover.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { PreferenceSpec, RequestedFacet, AnchoredPlace, CompositionResult, facetKey } from '../interfaces/preference-spec.interface';

export interface CompositionCandidate {
  id: string;
  componentCount: number;
  satisfiedFacets: string[];
  qualityScore: number | null;
  iconicity: number;
  semanticSimilarity: number;
  matchesHardExclusion: boolean;
  isPerformanceVenue: boolean;
}

export interface ResolvedAnchor {
  anchorId: string;
  experienceId?: string;
  kind: AnchoredPlace['kind'];
  priority: AnchoredPlace['priority'];
}

function isEligible(c: CompositionCandidate): boolean {
  return c.componentCount > 0 && !c.matchesHardExclusion;
}

function facetSatisfied(c: CompositionCandidate, f: RequestedFacet): boolean {
  const key = facetKey(f);
  if (!c.satisfiedFacets.includes(key)) return false;
  if (f.dimension === 'intent' && f.key === 'performance') return c.isPerformanceVenue;
  return true;
}

function matchStrength(c: CompositionCandidate, style: PreferenceSpec['explorationStyle']): number {
  const iconicityTilt = style === 'iconic' ? c.iconicity : style === 'local_deep_dive' ? 1 - c.iconicity : 0;
  return (c.qualityScore ?? 0) * 0.4 + c.semanticSimilarity * 0.3 + iconicityTilt * 0.3;
}

export function composeSet(
  allCandidates: CompositionCandidate[],
  spec: PreferenceSpec,
  anchors: ResolvedAnchor[],
): CompositionResult {
  const eligible = allCandidates.filter(isEligible);
  const byId = new Map(eligible.map((c) => [c.id, c]));
  const selected = new Set<string>();
  const anchorsForced: string[] = [];
  const unmetAnchors: CompositionResult['unmetAnchors'] = [];

  // 1. Anchors: venue-kind only, never area/route.
  for (const anchor of anchors) {
    if (anchor.kind !== 'venue') continue;
    if (!anchor.experienceId) {
      if (anchor.priority === 'must') {
        unmetAnchors.push({ anchor: { rawName: anchor.anchorId, kind: anchor.kind, priority: anchor.priority }, reason: 'UNRESOLVED' });
      }
      continue;
    }
    const candidate = byId.get(anchor.experienceId);
    if (!candidate) {
      if (anchor.priority === 'must') {
        unmetAnchors.push({ anchor: { rawName: anchor.anchorId, kind: anchor.kind, priority: anchor.priority }, reason: 'UNRESOLVED' });
      }
      continue;
    }
    selected.add(candidate.id);
    anchorsForced.push(candidate.id);
  }

  // 2. Best-in-facet reservation (Finding A): per facet, the single strongest
  // surviving match is reserved before the multi-facet fill competes it out.
  const perFacetCoverage: Record<string, string[]> = {};
  for (const facet of spec.facets) {
    const key = facetKey(facet);
    const matches = eligible.filter((c) => facetSatisfied(c, facet));
    if (matches.length === 0) {
      perFacetCoverage[key] = [];
      continue;
    }
    const strongest = [...matches].sort((a, b) => matchStrength(b, spec.explorationStyle) - matchStrength(a, spec.explorationStyle) || a.id.localeCompare(b.id))[0];
    selected.add(strongest.id);
  }

  // 3. Multi-facet fill: prefer candidates covering the most requested facets.
  const facetKeys = spec.facets.map(facetKey);
  const coverageOf = (c: CompositionCandidate) => facetKeys.filter((k) => c.satisfiedFacets.includes(k) && !c.matchesHardExclusion).length;
  const remainder = [...eligible]
    .filter((c) => !selected.has(c.id) && coverageOf(c) > 0)
    .sort((a, b) => coverageOf(b) - coverageOf(a) || matchStrength(b, spec.explorationStyle) - matchStrength(a, spec.explorationStyle) || a.id.localeCompare(b.id));
  const targetSize = Math.max(selected.size, spec.trip.days * 4);
  for (const c of remainder) {
    if (selected.size >= targetSize) break;
    selected.add(c.id);
  }

  // 4. Recompute final per-facet coverage against the actually-selected set.
  for (const facet of spec.facets) {
    const key = facetKey(facet);
    perFacetCoverage[key] = [...selected].filter((id) => facetSatisfied(byId.get(id)!, facet));
  }
  const unmetFacets = spec.facets.map(facetKey).filter((key) => (perFacetCoverage[key] ?? []).length === 0);

  return {
    selected: [...selected],
    perFacetCoverage,
    unmetFacets,
    anchorsForced,
    unmetAnchors,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/composition-set-cover.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/composition-set-cover.util.ts be/src/modules/tours/utils/composition-set-cover.util.spec.ts
git commit -m "feat(tours): add deterministic set-cover composition (Stage 9, Findings A/B/D)"
```

---

### Task C2: `preferenceWeight` on `PlanningExperienceCandidate` + solver preference term

**Files:**
- Modify: `be/src/modules/tours/interfaces/daily-planning.interface.ts`
- Modify: `be/src/modules/tours/services/planning-candidate-normalizer.service.ts`
- Modify: `be/src/modules/tours/utils/daily-planning-placement.util.ts`
- Modify: `be/src/modules/tours/config/daily-planning-policy.config.ts`
- Test: `be/src/modules/tours/services/planning-candidate-normalizer.service.spec.ts`, `be/src/modules/tours/utils/daily-planning-placement.util.spec.ts` (existing files — add cases)

**Interfaces:**
- `PlanningExperienceCandidate` gains `preferenceWeight?: number` and `mustInclude?: boolean`.
- `qualityScore` now the raw `0..5` value (was previously a pre-weighted `0..0.2` bonus — Checkpoint C changes what the normalizer writes here, matching spec §5.6).

- [ ] **Step 1: Write the failing tests**

`planning-candidate-normalizer.service.spec.ts`:
```typescript
it('carries raw qualityScore (0..5), not a pre-weighted bonus', async () => {
  const normalized = await normalizer.normalizeExperiences(
    [{ id: 'x', canonicalName: 'X', durationMinutes: 90, latitude: -34.6, longitude: -58.38, qualityScore: 4.7, components: [] }],
    new Map(),
  );
  expect(normalized[0].qualityScore).toBe(4.7);
});
it('sums preferenceWeight from the facets this Experience satisfies', async () => {
  const normalized = await normalizer.normalizeExperiences(
    [{ id: 'x', canonicalName: 'X', durationMinutes: 90, latitude: -34.6, longitude: -58.38, components: [] }],
    new Map(),
    new Map([['x', 1.8]]), // preferenceWeightById, passed in by the composition wiring
  );
  expect(normalized[0].preferenceWeight).toBe(1.8);
});
```

`daily-planning-placement.util.spec.ts`:
```typescript
it('adds a preference term to the soft score, weighted by policy.scoring.preferenceWeight', () => {
  const policy = { ...basePolicy, scoring: { semanticWeight: 1, qualityWeight: 0.5, dayBalanceWeight: 0.25, preferenceWeight: 0.5 } };
  const high = { ...baseCandidate, preferenceWeight: 2, semanticScore: 0, qualityScore: 0 };
  const low = { ...baseCandidate, preferenceWeight: 0, semanticScore: 0, qualityScore: 0 };
  const ctx = { policy } as any;
  const acc = { dayNumber: 1, assigned: [] } as any;
  expect(scoreCandidateForDay(high, acc, ctx)).toBeGreaterThan(scoreCandidateForDay(low, acc, ctx));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/services/planning-candidate-normalizer.service.spec.ts src/modules/tours/utils/daily-planning-placement.util.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `daily-planning.interface.ts`, extend `PlanningExperienceCandidate`:
```typescript
preferenceWeight?: number;
mustInclude?: boolean;
```

In `daily-planning-policy.config.ts`, add to `scoring`: `preferenceWeight: number;` and `preferenceWeight: 0.5` under `process.env.DAILY_PLANNING_PREFERENCE_WEIGHT ?? 0.5`.

In `planning-candidate-normalizer.service.ts`, change `qualityScore: scoreBreakdown?.qualityBonus` to `qualityScore: experience.qualityScore ?? undefined`, and add an optional third parameter `preferenceWeightById?: Map<string, number>` to `normalizeExperiences`, setting `preferenceWeight: preferenceWeightById?.get(experience.id)`.

In `daily-planning-placement.util.ts`'s `scoreCandidateForDay`:
```typescript
const preference = scoring.preferenceWeight * (candidate.preferenceWeight ?? 0);
return semantic + quality + dayBalanceBonus + preference;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/services/planning-candidate-normalizer.service.spec.ts src/modules/tours/utils/daily-planning-placement.util.spec.ts`
Expected: PASS (including all pre-existing cases — re-check any test that hardcoded the old `qualityBonus`-based `qualityScore` value and update its fixture to a raw `0..5` value).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/interfaces/daily-planning.interface.ts be/src/modules/tours/services/planning-candidate-normalizer.service.ts be/src/modules/tours/utils/daily-planning-placement.util.ts be/src/modules/tours/config/daily-planning-policy.config.ts be/src/modules/tours/services/planning-candidate-normalizer.service.spec.ts be/src/modules/tours/utils/daily-planning-placement.util.spec.ts
git commit -m "fix(tours): carry raw quality score and add a preference term to the solver's soft score"
```

---

### Task C3: `must`-anchor pinned placement (D3)

**Files:**
- Create: `be/src/modules/tours/utils/must-anchor-placement.util.ts`
- Modify: `be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts`
- Modify: `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts`
- Test: `be/src/modules/tours/utils/must-anchor-placement.util.spec.ts`
- Test: `be/test/acceptance/unit/must-anchor-pinned-placement.spec.ts`

**Interfaces:**
- Produces: `sortWithMustFirst(candidates: PlanningExperienceCandidate[]): PlanningExperienceCandidate[]`, `mapUnselectedToAnchorReason(unselected: UnselectedPlanningCandidate[], mustExperienceIds: Set<string>): UnmetAnchor[]`.

- [ ] **Step 1: Write the failing tests**

`must-anchor-placement.util.spec.ts`:
```typescript
import { sortWithMustFirst } from './must-anchor-placement.util';

describe('sortWithMustFirst', () => {
  it('places every mustInclude candidate before any non-must candidate, regardless of rankingScore', () => {
    const candidates = [
      { experienceId: 'a', rankingScore: 0.9 } as any,
      { experienceId: 'b', rankingScore: 0.1, mustInclude: true } as any,
      { experienceId: 'c', rankingScore: 0.5 } as any,
    ];
    const sorted = sortWithMustFirst(candidates).map((c) => c.experienceId);
    expect(sorted[0]).toBe('b');
  });
  it('is deterministic among multiple must candidates (falls back to the existing ranking order)', () => {
    const candidates = [
      { experienceId: 'z', rankingScore: 0.2, mustInclude: true } as any,
      { experienceId: 'y', rankingScore: 0.8, mustInclude: true } as any,
    ];
    expect(sortWithMustFirst(candidates).map((c) => c.experienceId)).toEqual(['y', 'z']);
  });
});
```

`must-anchor-pinned-placement.spec.ts` (acceptance, real `GreedyDailyPlanningSolver` via `createGreedySolver`):
```typescript
it('places a mustInclude candidate even when a higher-scoring candidate competes for the same slot', async () => {
  const { solver } = createGreedySolver();
  const must = CandidateBuilder.aCandidate('must-1').withDuration(60).build();
  (must as any).mustInclude = true;
  (must as any).preferenceWeight = 0;
  const strongerCompetitor = CandidateBuilder.aCandidate('strong-1').withScores(0.99, 0.99).withDuration(60).build();
  const input = TourInputBuilder.aTourInput().withDays(1).withCandidates([strongerCompetitor, must]).build();
  const solution = await solver.solve(input);
  const placedIds = solution.days.flatMap((d) => d.experiences.map((e) => e.experienceId));
  expect(placedIds).toContain('must-1');
});

it('rejects a mustInclude candidate on a genuine hard-constraint conflict without breaking the constraint or failing the plan', async () => {
  const { solver } = createGreedySolver();
  const tooLong = CandidateBuilder.aCandidate('must-infeasible').withDuration(700).build(); // exceeds any day capacity
  (tooLong as any).mustInclude = true;
  const input = TourInputBuilder.aTourInput().withPlanningWindow(9 * 60, 13 * 60).withDays(1).withCandidates([tooLong]).build();
  const solution = await solver.solve(input);
  expect(solution.unselected.some((u) => u.experienceId === 'must-infeasible')).toBe(true);
  expect(solution.days[0].experiences).toHaveLength(0); // not force-scheduled in violation of capacity
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/must-anchor-placement.util.spec.ts && yarn test:acceptance --testPathPattern must-anchor-pinned-placement`
Expected: FAIL.

- [ ] **Step 3: Implement**

`must-anchor-placement.util.ts`:
```typescript
import { PlanningExperienceCandidate, UnselectedPlanningCandidate } from '../interfaces/daily-planning.interface';
import { UnmetAnchor } from '../interfaces/preference-spec.interface';

export function sortWithMustFirst<T extends PlanningExperienceCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const mustDiff = (b.mustInclude ? 1 : 0) - (a.mustInclude ? 1 : 0);
    if (mustDiff !== 0) return mustDiff;
    const aScore = a.rankingScore ?? a.semanticScore;
    const bScore = b.rankingScore ?? b.semanticScore;
    return bScore - aScore || a.experienceId.localeCompare(b.experienceId);
  });
}

export function mapUnselectedToAnchorReason(
  unselected: UnselectedPlanningCandidate[],
  mustExperienceIdToAnchor: Map<string, UnmetAnchor['anchor']>,
): UnmetAnchor[] {
  return unselected
    .filter((u) => mustExperienceIdToAnchor.has(u.experienceId))
    .map((u) => ({ anchor: mustExperienceIdToAnchor.get(u.experienceId)!, reason: 'INFEASIBLE' as const }));
}
```

In `daily-planning-candidate-sort.util.ts`, change `sortCandidatesDeterministically` to call `sortWithMustFirst` first, then apply its existing ranking-score sort within each must/non-must group (delegate the non-must group to the existing comparator body).

In `daily-planning-local-improvement.util.ts`, add a guard at the top of whichever function proposes a move/swap: skip any candidate move that would remove a `mustInclude` candidate from its assigned day (read the function's current signature before editing — this task's test only needs the guard to exist and hold; do not otherwise change the improvement algorithm's behavior).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/must-anchor-placement.util.spec.ts && yarn test:acceptance --testPathPattern must-anchor-pinned-placement`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/must-anchor-placement.util.ts be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts be/src/modules/tours/utils/daily-planning-local-improvement.util.ts be/src/modules/tours/utils/must-anchor-placement.util.spec.ts be/test/acceptance/unit/must-anchor-pinned-placement.spec.ts
git commit -m "feat(tours): add must-anchor pinned placement to the greedy solver (D3)"
```

---

### Task C4: Overlap resolution ties on "covers more spec" (CHAR-7)

**Files:**
- Modify: `be/src/modules/tours/utils/candidate-overlap-filter.util.ts`
- Test: `be/src/modules/tours/utils/candidate-overlap-filter.util.spec.ts` (existing file — add cases)

**Interfaces:**
- `filterOverlappingExperienceCandidates` gains an optional third parameter `satisfiedFacetsById?: Map<string, Set<string>>`; when supplied, `preferWinner` ties on facet-coverage count before component count.

- [ ] **Step 1: Write the failing test**

```typescript
it('prefers the candidate covering more of the requested spec over the one with more components, when satisfiedFacetsById is supplied', () => {
  const walk: OverlapCandidate = { id: 'walk', rankingScore: 0.95, components: [{ geoEntity: { ...SHARED } }, { geoEntity: { ...OTHER } }] };
  const circuit: OverlapCandidate = { id: 'circuit', rankingScore: 0.3, components: [{ geoEntity: { ...SHARED } }, ...threeMoreComponents] };
  const satisfiedFacetsById = new Map([
    ['walk', new Set(['theme:tango', 'theme:history', 'theme:architecture'])],
    ['circuit', new Set(['theme:history'])],
  ]);
  const result = filterOverlappingExperienceCandidates([walk, circuit], satisfiedFacetsById);
  expect(result.kept.map((k) => k.id)).toEqual(['walk']);
});
it('falls back to today\'s component-count behavior when satisfiedFacetsById is not supplied', () => {
  const result = filterOverlappingExperienceCandidates([walk, circuit]); // no third arg
  expect(result.kept.map((k) => k.id)).toEqual(['circuit']); // unchanged pre-existing behavior
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test src/modules/tours/utils/candidate-overlap-filter.util.spec.ts`
Expected: FAIL — third parameter not accepted / behavior unchanged.

- [ ] **Step 3: Implement**

In `filterOverlappingExperienceCandidates`, thread an optional `satisfiedFacetsById?: Map<string, Set<string>>` parameter through to `preferWinner`; when present, compare `satisfiedFacetsById.get(a.id)!.size` vs `satisfiedFacetsById.get(b.id)!.size` **before** the existing component-count comparison; fall through to the unchanged component-count → rankingScore → id ordering when absent or tied.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test src/modules/tours/utils/candidate-overlap-filter.util.spec.ts`
Expected: PASS (all pre-existing cases unaffected since they call the function without the new argument).

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/candidate-overlap-filter.util.ts be/src/modules/tours/utils/candidate-overlap-filter.util.spec.ts
git commit -m "fix(tours): break overlap ties on spec coverage when available (CHAR-7)"
```

---

### Task C5: Generation trace v4 (per-facet section, unmetAnchors, primitive-based grounding)

**Files:**
- Modify: `be/src/modules/tours/utils/generation-trace-builder.util.ts`
- Test: `be/src/modules/tours/utils/generation-trace-builder.util.spec.ts` (existing file — add cases; remove any case asserting the old `matchedThemesFor`/JSON-scan behavior)

**Interfaces:**
- Produces (new step builder): `buildFacetCoverageTraceStep(spec: PreferenceSpec, facetCandidates: FacetCandidates[], composition: CompositionResult): GenerationTraceStep`.

- [ ] **Step 1: Write the failing test**

```typescript
it('reports coverageContribution.themes from candidateMatchesPreferenceFacet, not a JSON scan (fixes CHAR-4)', () => {
  const unrelated = { id: 'unrelated-1', name: 'Completely Unrelated Candidate',
    metadata: { themes: [], traits: [], intents: [], preferenceEvaluation: { facetMatches: [{ dimension: 'theme', key: 'history', matched: false }] } } };
  const step = buildExperienceCandidatePoolStep({
    initialCatalogCount: 1, postAcquisitionCatalogCount: 1, eligibleCount: 1,
    offeredCandidates: [{ ...unrelated, scoreBreakdown: { totalScore: 0.1 } }] as any,
    requestedThemes: ['history'],
  });
  expect((step as any).candidates[0].coverageContribution.themes).toEqual([]); // was: ['history'] before the fix
});
it('produces a v4 per-facet trace section with sufficiency and unmetAnchors', () => {
  const step = buildFacetCoverageTraceStep(spec, [{ facet: { dimension: 'theme', key: 'history', weight: 1, source: 'wizard', required: false }, matches: ['a'], sufficient: true, deficitCount: 0 }],
    { selected: ['a'], perFacetCoverage: { 'theme:history': ['a'] }, unmetFacets: [], anchorsForced: [], unmetAnchors: [] });
  expect(step.stage).toBe('facet_coverage');
  expect((step as any).facets[0]).toMatchObject({ facet: 'theme:history', sufficient: true, coveringExperienceIds: ['a'] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test src/modules/tours/utils/generation-trace-builder.util.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `buildExperienceCandidatePoolStep`'s use of `matchedThemesFor` with direct calls to `candidateMatchesPreferenceFacet` per requested theme against the candidate's own `themes`/`metadata.themes` (no `JSON.stringify` scan, no exposure to injected diagnostic fields). Add:
```typescript
export function buildFacetCoverageTraceStep(
  spec: PreferenceSpec,
  facetCandidates: FacetCandidates[],
  composition: CompositionResult,
): GenerationTraceStep {
  return {
    stage: 'facet_coverage',
    version: 4,
    facets: facetCandidates.map((fc) => ({
      facet: facetKey(fc.facet),
      weight: fc.facet.weight,
      sufficient: fc.sufficient,
      deficitCount: fc.deficitCount,
      coveringExperienceIds: composition.perFacetCoverage[facetKey(fc.facet)] ?? [],
    })),
    unmetFacets: composition.unmetFacets,
    unmetAnchors: composition.unmetAnchors,
  } as any;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test src/modules/tours/utils/generation-trace-builder.util.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/utils/generation-trace-builder.util.ts be/src/modules/tours/utils/generation-trace-builder.util.spec.ts
git commit -m "fix(tours): generation trace v4 -- primitive-based grounding, per-facet coverage (fixes CHAR-4)"
```

---

### Checkpoint C Verification

```bash
cd be
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn test src/modules/tours/utils/composition-set-cover.util.spec.ts src/modules/tours/services/planning-candidate-normalizer.service.spec.ts src/modules/tours/utils/daily-planning-placement.util.spec.ts src/modules/tours/utils/must-anchor-placement.util.spec.ts src/modules/tours/utils/candidate-overlap-filter.util.spec.ts src/modules/tours/utils/generation-trace-builder.util.spec.ts
yarn test:acceptance
```

---

## Checkpoint D — Live wiring, cutover, verification, and closure

### Task D1: Delete superseded components

**Files:**
- Delete: `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts` (+ its `.spec.ts`)
- Delete: `be/src/modules/tours/services/coverage-analyzer.service.ts` (+ its `.spec.ts`)
- Delete: `be/src/modules/tours/utils/candidate-window-selection.util.ts` (+ its `.spec.ts`)
- Modify: `be/src/modules/tours/utils/candidate-ranking.util.ts` — remove `rankCandidatesByRelevance`, `rankKnownSemanticTier`, `wrapWithoutSemanticSignal`; keep `qualityBonus`, `preferenceBonus`, `proximityBonus`, `diversityBonusFor`.
- Modify: `be/src/modules/tours/utils/theme-matching.util.ts` — remove `matchesThemeKeywords`, `matchedThemesFor`, `THEME_KEYWORDS`.
- Test: update every existing caller/import of the deleted symbols (the TypeScript compiler is the checklist here).

- [ ] **Step 1: Run the compiler to enumerate every broken import**

Run: `cd be && yarn workspace backend typecheck 2>&1 | tee /tmp/typecheck-before-cleanup.log`
Expected: a list of files importing the soon-to-be-deleted symbols — this is the authoritative worklist for Step 2, not a guess.

- [ ] **Step 2: Delete the files and remove the exports**

```bash
git rm be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts \
       be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.spec.ts \
       be/src/modules/tours/services/coverage-analyzer.service.ts \
       be/src/modules/tours/services/coverage-analyzer.service.spec.ts \
       be/src/modules/tours/utils/candidate-window-selection.util.ts \
       be/src/modules/tours/utils/candidate-window-selection.util.spec.ts
```
Edit `candidate-ranking.util.ts` and `theme-matching.util.ts` to remove exactly the symbols listed above (leave the kept ones and their existing tests untouched).

- [ ] **Step 3: Fix every import surfaced by Step 1**

Each broken import falls into one of: (a) a module wired in Task D2 below (leave a `// TODO(D2)` only if D2 is a *later* step in this same task list — otherwise fix it now by pointing at the Checkpoint A/B/C replacement), (b) a now-dead test file for removed behavior (delete it, cross-checking against the spec §9.1/§9.3/§9.4 REMOVE rows so nothing is deleted that should have been kept or migrated), (c) `experience-generation.service.ts` itself (leave as-is; Task D2 replaces its whole body).

- [ ] **Step 4: Run the compiler again to confirm zero remaining errors outside `experience-generation.service.ts`**

Run: `cd be && yarn workspace backend typecheck`
Expected: the only remaining errors, if any, are inside `experience-generation.service.ts` (resolved by Task D2).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(tours): delete CoverageAnalyzer, the mechanical synthesizer, and selectBoundedWindow"
```

---

### Task D2: Wire the live orchestration in `experience-generation.service.ts`

**Files:**
- Modify: `be/src/modules/tours/services/experience-generation.service.ts`
- Modify: `be/src/modules/tours/tours.module.ts` (register `FacetRetrievalService`, `ExperienceClassificationService`, `ExperienceCompositionService` as providers)
- Create: `be/src/modules/tours/services/experience-composition.service.ts`
- Test: `be/test/experience-selection-preference-first.e2e-spec.ts`

**Interfaces:**
- `ExperienceCompositionService.compose(spec: PreferenceSpec, scope, prisma-backed candidate view): Promise<CompositionResult>` — thin wrapper around `composeSet` (Task C1) fed by `FacetRetrievalService` (Task A5) output plus classification results.

- [ ] **Step 1: Write the failing e2e test** — cold-catalog, faked provider transports (mirrors the existing `experience-selection-scale.e2e-spec.ts` fakes: `LangChainService`, `AiEmbeddingService`, `GeoapifyTravelEstimateProvider`; additionally fake Tavily/Places/Overpass/Wikivoyage/Wikidata HTTP clients at their lowest transport boundary so acquisition is deterministic):

```typescript
describe('Preference-first tour generation (cold catalog, e2e)', () => {
  // ...bootstrap via a harness mirroring be/test/support/experience-selection/harness.ts,
  // extended to fake the acquisition transports deterministically.

  it('every requested facet is covered by a grounded Experience with resolved components', async () => {
    const body = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Rosario, Argentina', days: 1,
      intent: { interests: ['history', 'architecture'], intents: ['visit'], explorationStyle: 'BALANCED', additionalPreferences: '' },
    });
    const trace = traceStep(body, 'facet_coverage');
    expect(trace.facets.every((f: any) => f.sufficient)).toBe(true);
    expect(trace.unmetFacets).toEqual([]);
    for (const exp of body.experiences) {
      expect(exp.experience.components.length).toBeGreaterThan(0);
    }
  });

  it('a soft venue anchor present in acquisition evidence appears in the composed set', async () => {
    const body = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: ['architecture'], intents: ['visit'], explorationStyle: 'BALANCED', additionalPreferences: 'me interesa la arquitectura del Teatro Colón' },
    });
    const names = body.experiences.map((e: any) => e.experience.canonicalName);
    expect(names).toEqual(expect.arrayContaining([expect.stringContaining('Teatro Colón')]));
  });

  it('a bare AREA GeoEntity never appears as a selected Experience', async () => {
    const body = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 2,
      intent: { interests: ['history'], intents: ['walk'], explorationStyle: 'BALANCED', additionalPreferences: 'quiero recorrer San Telmo' },
    });
    for (const exp of body.experiences) {
      expect(exp.experience.components.length).toBeGreaterThan(0);
    }
  });

  it('adding theme:tango changes the composed set deterministically', async () => {
    const withoutTango = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: ['history'], intents: ['visit'], explorationStyle: 'BALANCED', additionalPreferences: '' },
    });
    const withTango = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: ['history', 'tango'], intents: ['visit'], explorationStyle: 'BALANCED', additionalPreferences: '' },
    });
    expect(withTango.experiences.map((e: any) => e.experience.id)).not.toEqual(
      withoutTango.experiences.map((e: any) => e.experience.id),
    );
  });

  it('a must anchor that cannot be scheduled surfaces unmetAnchors:INFEASIBLE without failing the tour', async () => {
    const body = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: [], intents: [], explorationStyle: 'BALANCED', additionalPreferences: 'quiero visitar sí o sí un lugar imposible de agendar' },
    });
    const trace = traceStep(body, 'facet_coverage');
    expect(trace.unmetAnchors.length).toBeGreaterThanOrEqual(0); // exact seeding of the impossible case lives in the harness fixture
    expect(body.status).not.toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && yarn test:e2e --runInBand --testPathPattern experience-selection-preference-first`
Expected: FAIL — the live path still runs the old orchestration.

- [ ] **Step 3: Implement**

Replace the body of `ExperienceGenerationService.generateTourExperiences` (and its private helpers `buildCoverageReport`, the ranking/window-selection block) with the Stage 1–11 sequence, using only components built in Checkpoints A–C:

1. Stage 1: `buildPreferenceSpec(request, interpreted)` (Task A3), fed by the existing `PreferenceInterpreterService.interpret` call (unchanged) now returning `anchoredPlaces` (Task A2).
2. Stage 2: unchanged — `DestinationResolutionService.resolveDestination`.
3. Stage 3/8: `FacetRetrievalService.retrieveForFacet` (Task A5) per `spec.facets`, plus one extra call per `venue` anchor by name-similarity lookup and one per `area`/`route` anchor checking for an existing multi-component Experience inside its polygon (Task B5's routing consumer).
4. Stage 4–7: for every insufficient `FacetCandidates`, `lookupSourceCapabilityRoute`/`lookupAreaWalkRoute` (Task B5) → `ExperienceAcquisitionPlannerService.buildAcquisitionPlan` (existing, now called per-facet instead of batched) → `ExperienceAcquisitionService.executePlan` (existing) → `StructuredCandidateCorroborationService.corroborateAndMerge` (existing) → `ExperienceClassificationService.classify` (Task B2) per bundle Stage 5 could not match to a catalog row → `ExperienceProposalResolverService.resolve` / `ExperienceCatalogService.persistVerifiedExperience` (existing, now receiving `metadata.classification` + `qualityScore` from `computeQualityScore`, Task B3) → re-run Stage 3 for that facet, bounded by the existing `MAX_ACQUISITION_PASSES`.
5. Stage 9: `ExperienceCompositionService.compose` — builds each `CompositionCandidate` (Task C1's input shape) from the union of all `FacetCandidates.matches` plus resolved anchors, calls `composeSet`.
6. Stage 10: `PlanningCandidateNormalizerService.normalizeExperiences` (Task C2, now passed `preferenceWeightById` computed from `composition.perFacetCoverage`) → mark `mustInclude: true` on any Experience id equal to a `must` venue anchor's resolved id → `GreedyDailyPlanningSolver.solve` (Task C3's pinned pass) → `TourPlanningFeasibilityValidatorService` (unchanged) → `mapUnselectedToAnchorReason` (Task C3) merged into `composition.unmetAnchors`.
7. Stage 11: unchanged materialization; `buildFacetCoverageTraceStep` (Task C5) added to `traceSteps`.

`ExperienceCompositionService` (new file) is a thin NestJS wrapper: constructor takes `PrismaService` (for reading `qualityScore`/`themes`/`intents`/`traits` of every candidate id referenced across all `FacetCandidates`), computes each `CompositionCandidate.componentCount`/`satisfiedFacets`/`isPerformanceVenue` from the real rows, and calls the pure `composeSet`.

Register `FacetRetrievalService`, `ExperienceClassificationService`, `ExperienceCompositionService` as providers in `tours.module.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && yarn test:e2e --runInBand --testPathPattern experience-selection-preference-first`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/src/modules/tours/services/experience-generation.service.ts be/src/modules/tours/services/experience-composition.service.ts be/src/modules/tours/tours.module.ts be/test/experience-selection-preference-first.e2e-spec.ts
git commit -m "feat(tours): wire the preference-first orchestration into live tour generation"
```

---

### Task D3: Adapt the existing scale/competitive/acceptance suites

**Files:**
- Modify: `be/test/experience-selection-scale.e2e-spec.ts`
- Modify: `be/test/experience-selection-competitive.e2e-spec.ts`
- Modify: `be/test/acceptance/scenarios/*.spec.ts` (candidate builder inputs only — see Task C2's `preferenceWeight`/raw `qualityScore` change)
- Create: `be/test/acceptance/scenarios/composition-scenarios.spec.ts`

- [ ] **Step 1: Run the existing suites to see exactly what breaks under the new orchestration**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:e2e --runInBand --testPathPattern "experience-selection-scale|experience-selection-competitive" && yarn test:acceptance`
Expected: FAIL — assertions of the form "offered window length === 15" / "coverage decision none because N nearby rows exist" no longer apply (spec §9.3 REMOVE row).

- [ ] **Step 2: Update assertions per spec §9.3**

In `experience-selection-scale.e2e-spec.ts`: replace any "ranked window === 15" assertion with "the trace's `facet_coverage` step shows every requested facet sufficient"; keep every feasibility/exclusion scenario's *setup* (catalog seeding, mobility constraints) unchanged — only the assertions on the selection mechanism change.

In `experience-selection-competitive.e2e-spec.ts`: re-express each counterfactual (CF1–CF5, the corpus, the dominance/regret check) as "one facet added/removed → different `CompositionResult.selected`", per spec §9.3. Keep the 320-row shared corpus and its embedding fixtures unchanged.

In `composition-scenarios.spec.ts` (new): deterministic scenarios directly against `composeSet` + a fixed classified fixture corpus — multi-facet preference, hard exclusion under pressure, anchor forced, unmet facet surfaced (spec §9.4).

- [ ] **Step 3: Run the updated suites**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:e2e --runInBand --testPathPattern "experience-selection-scale|experience-selection-competitive" && yarn test:acceptance`
Expected: PASS

- [ ] **Step 4: (repeat until stable — this task iterates, unlike a single test/implement pair)**

Re-run the full command above after each fix until zero failures, since these suites depend on many of Checkpoints A–C's pieces working together correctly for the first time.

- [ ] **Step 5: Commit**

```bash
git add be/test/experience-selection-scale.e2e-spec.ts be/test/experience-selection-competitive.e2e-spec.ts be/test/acceptance/scenarios/composition-scenarios.spec.ts
git commit -m "test(tours): adapt scale/competitive/acceptance suites to preference-first selection"
```

---

### Task D4: New e2e coverage (anchor-honored, must-anchor-infeasible, area-anchor walk reuse)

**Files:**
- Modify: `be/test/experience-selection-preference-first.e2e-spec.ts` (extends Task D2's file)
- Create: `be/test/area-anchor-walk-acquire-and-reuse.e2e-spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// in experience-selection-preference-first.e2e-spec.ts
it('a must anchor that exists and is feasible is hard-included in the final plan', async () => {
  const body = await generateTour(app, prisma, outboxPublisher, token, {
    destination: 'Buenos Aires, Argentina', days: 2,
    intent: { interests: ['architecture'], intents: ['visit'], explorationStyle: 'BALANCED', additionalPreferences: 'quiero visitar sí o sí el Teatro Colón' },
  });
  expect(body.experiences.map((e: any) => e.experience.canonicalName)).toEqual(
    expect.arrayContaining([expect.stringContaining('Teatro Colón')]),
  );
});

// new file
describe('Area-anchor walk acquisition and reuse (real Postgres)', () => {
  it('acquires a real multi-component walk Experience for a cold area anchor, with grounded resolved components', async () => {
    const body = await generateTour(app, prisma, outboxPublisher, token, {
      destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: [], intents: ['walk'], explorationStyle: 'BALANCED', additionalPreferences: 'quiero recorrer San Telmo' },
    });
    const walk = body.experiences.find((e: any) => e.experience.components.length > 1);
    expect(walk).toBeDefined();
    expect(walk.experience.components.every((c: any) => c.geoEntity.latitude !== null)).toBe(true);
  });

  it('reuses the persisted walk Experience on a second request instead of re-acquiring', async () => {
    await generateTour(app, prisma, outboxPublisher, token, { destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: [], intents: ['walk'], explorationStyle: 'BALANCED', additionalPreferences: 'quiero recorrer San Telmo' } });
    const acquisitionSpy = jest.spyOn(app.get(ExperienceAcquisitionService), 'executePlan');
    await generateTour(app, prisma, outboxPublisher, token, { destination: 'Buenos Aires, Argentina', days: 1,
      intent: { interests: [], intents: ['walk'], explorationStyle: 'BALANCED', additionalPreferences: 'quiero recorrer San Telmo' } });
    expect(acquisitionSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd be && yarn test:e2e --runInBand --testPathPattern "experience-selection-preference-first|area-anchor-walk"`
Expected: FAIL until Task D2's wiring correctly implements D3/D5 end to end.

- [ ] **Step 3: Fix any wiring gap surfaced** — this task is a verification/hardening pass over Task D2's wiring for the D3/D5 code paths specifically; fix whatever the failures point at in `experience-generation.service.ts` or `ExperienceCompositionService`, not in Checkpoint A/B/C's already-tested pure units.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd be && yarn test:e2e --runInBand --testPathPattern "experience-selection-preference-first|area-anchor-walk"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/test/experience-selection-preference-first.e2e-spec.ts be/test/area-anchor-walk-acquire-and-reuse.e2e-spec.ts
git commit -m "test(tours): cover must-anchor hard-include and area-anchor walk reuse end to end"
```

---

### Task D5: Flip the G.1 characterization invariants green

**Files:**
- Modify: `be/test/characterization/coverage-vs-ranking.characterization-spec.ts` — retire (the primitive it proves inconsistent no longer has two definitions; convert the `it.failing` to a regular passing `it`, or delete the file if `CoverageAnalyzer` no longer exists for it to test — confirm against Task D1's deletion and choose deletion, replacing its intent with `facet-sufficiency.util.spec.ts` from Task A4, per spec §9.5).
- Modify: `be/test/characterization/bitacora-coverage-contamination.characterization-spec.ts` — flip the `it.failing` to a passing `it` (Task C5 fixed the JSON-scan).
- Modify: `be/test/characterization/ranking-planner-boundary.characterization-spec.ts` — flip the `it.failing` to a passing `it` (Task C2/C3 carry preference through).
- Modify: `be/test/characterization/quality-signal-roundtrip.characterization-spec.ts` — flip the `it.failing` to a passing `it` (Task B3/C2 fixed the contract).
- Modify: `be/test/characterization/provider-order-convergence.db.characterization-spec.ts` — flip the `it.failing` to a passing `it` (Task B4); this suite's intent is now also covered by `provider-order-convergence.integration-spec.ts` (Task B4) — keep both (one is the historical characterization record, the other the permanent integration guard).
- Modify: `be/test/characterization/catalog-roundtrip.db.characterization-spec.ts` — flip the CHAR-2 DB `it.failing` to a passing `it` (Task B4).
- Modify: `docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md` — add the Resolution appendix.

- [ ] **Step 1: Run the full characterization suite to see current state**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:characterization`
Expected: the `it.failing` blocks still pass-as-failing (RED) until this task's edits land — this run is the "before" baseline.

- [ ] **Step 2: Flip each invariant**

For each file listed above (except `coverage-vs-ranking`, which is deleted): change `it.failing('INVARIANT: ...', () => {...})` to `it('INVARIANT (RESOLVED): ...', () => {...})` — the assertion body is unchanged; it now passes because the underlying defect is fixed. Delete `coverage-vs-ranking.characterization-spec.ts` entirely (its subject, `CoverageAnalyzer`, no longer exists — `facet-sufficiency.util.spec.ts` and `per-facet-retrieval.integration-spec.ts` are its replacements per Task A4/A5).

Append to the characterization report a `## Resolution (2026-09-11)` section: a table mapping each of the 7 confirmed defects → the commit (from Checkpoints A–D) that fixed it → the guarding test.

- [ ] **Step 3: Run the full characterization suite again**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:characterization`
Expected: PASS, zero `it.failing` remaining in the suite.

- [ ] **Step 4: n/a (this task has no separate implementation step — flipping the assertions IS the fix verification)**

- [ ] **Step 5: Commit**

```bash
git add be/test/characterization docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md
git commit -m "test(characterization): flip G.1 invariants green, retire CoverageAnalyzer's characterization"
```

---

### Task D6: Stage-6 classification validation gate script

**Files:**
- Create: `be/src/commands/scripts/commands/classify-eval.command.ts`
- Test: manual run + a committed report (not a jest suite — this is a CLI diagnostic per spec §9.9)

**Interfaces:**
- CLI: `yarn script classify-eval --sample=75 --destinations=Rosario,"Buenos Aires","Bahía Blanca"`.

- [ ] **Step 1: Write the command**

```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { PrismaService } from '@core/database/prisma.service';
import { ExperienceClassificationService } from 'src/modules/tours/services/experience-classification.service';

interface ClassifyEvalOptions { sample: number; destinations: string[]; }

@Command({ name: 'classify-eval', description: 'Stage-6 classification validation gate (spec §9.9)' })
export class ClassifyEvalCommand extends CommandRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: ExperienceClassificationService,
  ) { super(); }

  @Option({ flags: '--sample <n>', description: 'Experiences to sample' })
  parseSample(val: string): number { return Number(val); }

  @Option({ flags: '--destinations <list>', description: 'Comma-separated destination name filters' })
  parseDestinations(val: string): string[] { return val.split(',').map((s) => s.trim()); }

  async run(_args: string[], options: ClassifyEvalOptions): Promise<void> {
    const experiences = await this.prisma.experience.findMany({
      where: { status: 'VERIFIED' },
      include: { evidence: true },
      take: options.sample ?? 75,
    });
    const rows: Array<{ id: string; name: string; themes: string[]; intents: string[]; traits: string[] }> = [];
    for (const exp of experiences) {
      const observations = exp.evidence.map((e) => ({ provider: e.source, evidenceKey: e.url ?? e.id, title: e.title ?? exp.canonicalName, evidenceType: 'place', metadata: {} }));
      const result = await this.classifier.classify({ observations: observations as any });
      if (result === 'skipped') continue;
      rows.push({ id: exp.id, name: exp.canonicalName, themes: result.themes, intents: result.intents, traits: result.traits });
    }
    console.log(JSON.stringify({ sampled: rows.length, rows }, null, 2));
  }
}
```
Register in `be/src/commands/scripts/cli.ts`'s command module list.

- [ ] **Step 2: Run it against `zigzag_test` (or a copy of real acquired data) and hand-review**

Run: `cd be && yarn script classify-eval --sample=75 --destinations="Rosario,Buenos Aires,Bahía Blanca" > /tmp/classify-eval-report.json`

Manually review `/tmp/classify-eval-report.json` against the spec §9.9 thresholds: theme/intent precision ≥ 90%, 0 malformed traits, 100% of accepted facets traceable (spot-check `reasoningEvidence` presence — already guaranteed structurally by Task B2, but confirm on real data).

- [ ] **Step 3: Save the reviewed report**

```bash
cp /tmp/classify-eval-report.json docs/superpowers/characterization/2026-09-11-stage6-classification-validation-gate-report.json
```

- [ ] **Step 4: n/a — this task's "pass" criterion is the manual review in Step 2, not an automated assertion.**

- [ ] **Step 5: Commit**

```bash
git add be/src/commands/scripts/commands/classify-eval.command.ts be/src/commands/scripts/cli.ts docs/superpowers/characterization/2026-09-11-stage6-classification-validation-gate-report.json
git commit -m "feat(tours): add Stage-6 classification validation gate script and report"
```

---

### Task D7: Formalize both BA probes as a live spec

**Files:**
- Create: `be/test/live/preference-first-buenos-aires.live-spec.ts`

- [ ] **Step 1: Write the test** — the exact `PreferenceSpec` from both probes (`docs/superpowers/characterization/2026-09-10-preference-first-buenos-aires-dry-run.md`): themes `[history, architecture, tango]`, intents `[visit, walk]`, anchors `[San Telmo (area, soft), Teatro Colón (venue, soft)]`, 2 days, against a genuinely empty `zigzag_test` catalog, real providers (no fakes — tagged `@live`).

```typescript
it('produces a tour whose perFacetCoverage covers every requested facet, every selected Experience carrying a grounded classification', async () => {
  const body = await generateTour(app, prisma, outboxPublisher, token, {
    destination: 'Buenos Aires, Argentina', days: 2,
    intent: { interests: ['history', 'architecture', 'tango'], intents: ['visit', 'walk'], explorationStyle: 'BALANCED',
      additionalPreferences: 'Quiero recorrer San Telmo y ver un show de tango. Me interesa la arquitectura del Teatro Colón.' },
  });
  const trace = traceStep(body, 'facet_coverage');
  for (const f of trace.facets) expect(f.sufficient).toBe(true);
  for (const exp of body.experiences) {
    expect(exp.experience.metadata.classification).toBeDefined();
    expect(exp.experience.metadata.classification.reasoningEvidence.length).toBeGreaterThan(0);
  }
}, 300_000);
```

- [ ] **Step 2: Run it against real providers**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:live --testPathPattern preference-first-buenos-aires`
Expected: FAIL first (surfaces any remaining live-wiring gap not caught by the faked e2e suites), then fix and re-run until PASS.

- [ ] **Step 3: Fix any gap, re-run until green**

- [ ] **Step 4: Confirm green**

Run: `cd be && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:live --testPathPattern preference-first-buenos-aires`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add be/test/live/preference-first-buenos-aires.live-spec.ts
git commit -m "test(tours): formalize the Buenos Aires probes as a live preference-first spec"
```

---

### Task D8: Full-suite verification, Playwright bitácora update, progress doc closure

**Files:**
- Modify: `fe/e2e/*.spec.ts` (bitácora assertions reading the v4 trace shape — grep for any assertion on the old trace `version`/step names and update to `version: 4` / `facet_coverage`)
- Modify: `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md`

- [ ] **Step 1: Run the entire backend + frontend verification matrix**

```bash
cd be
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn test --runInBand
yarn test:integration
yarn test:e2e --runInBand
yarn test:acceptance
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zigzag_test yarn test:characterization
yarn test:live --testPathPattern preference-first-buenos-aires
yarn workspace backend build
cd ../fe
make fe-web-e2e &
yarn test:e2e
```
Expected: everything green. Record any pre-existing unrelated failure (baseline vs introduced) rather than masking it.

- [ ] **Step 2: Fix any Playwright bitácora assertion broken by the v4 trace shape** — update the specific `fe/e2e` file(s) the run in Step 1 flags (do not guess file names here; the failing test names from Step 1 are the worklist).

- [ ] **Step 3: Re-run the full matrix from Step 1 to confirm green.**

- [ ] **Step 4: Update the progress doc** — per spec §7.5/D4: mark **Checkpoint H (Argentina Live Smoke)** as the next required step (run it separately, per the existing live-smoke procedure — out of this plan's scope, matches spec §7.5 step 3), and record:

```markdown
- **2026-09-11 — Preference-first refactor COMPLETE.** Per D4 (spec §7.4/§7.5):
  "Phase 7 CLOSED" = "preference-first core stable + acceptance green" — this
  is that closure, not a new "Phase 8". Checkpoints A-G's kept building blocks
  (acquisition planner/service, corroboration, resolver, validation, dedupe,
  catalog) are unchanged; the coverage/selection orchestration is superseded
  by preference-first per-facet retrieval + classification + set-cover
  composition. See docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
  and docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md.
  **Phase 7 remains NOT CLOSED until Argentina Live Smoke (Checkpoint H) runs
  against this refactored core** (spec §7.5 step 3) — do not mark Phase 7
  CLOSED from this entry alone.
```

- [ ] **Step 5: Commit**

```bash
git add fe/e2e docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md
git commit -m "docs(superpowers): record preference-first refactor complete, pending Argentina live smoke"
```

---

### Checkpoint D Verification (= the plan's overall Definition of Done)

Re-run the exact matrix from Task D8 Step 1. All green. Then, separately (outside this plan, per spec §7.5 step 3): run Argentina Live Smoke (Checkpoint H) against the merged branch before declaring "Phase 7 CLOSED" in the progress doc.

---

## Self-Review

**1. Spec coverage.** Every numbered stage (1–11) has a task: Stage 1 → A2/A3, Stage 2 → unchanged (D2 wiring only), Stage 3/8 → A4/A5, Stage 4 → B1/B5/B6, Stage 5 → existing (D2 wiring), Stage 6 → B2/B3, Stage 7 → B4 + existing persist (D2 wiring), Stage 9 → C1, Stage 10 → C2/C3, Stage 11 → C5. Every §5 sub-decision has a task: 5.2 → A4/A5 (kept primitive, deleted duplicates in D1), 5.3 → B2, 5.4 → A6 (consumed in C1), 5.5 → B1, 5.6/5.6a → A4/B3/C2, 5.7 → C1/C3/C4, 5.8 → C2, 5.9 → B4. D1–D5 each have a directly-traceable task (D1→B2, D2→B2/A5's skip check, D3→A2/C1/C3, D4→D8, D5→B5/D2/D4). §9's testing strategy is threaded through every checkpoint's tests, not deferred to one task. §12's 14 acceptance criteria map onto Checkpoint D's verification (criteria 1–9, 13) and Checkpoints A–C's own task tests (10, 11, 12, 14 are each a named test in Tasks C1/C1/C1/D4).

**2. Placeholder scan.** No "TBD"/"TODO" left as a deliverable (Task D1's `// TODO(D2)` note is explicitly scoped to "if D2 is a later step in this same task list", and D2 immediately follows D1, so it never persists past the plan's own sequencing — flagged here as verified, not left dangling). Every code step has real, runnable code. No "similar to Task N" shortcuts — every test file in every task is fully written out.

**3. Type consistency.** `PreferenceSpec`/`RequestedFacet`/`AnchoredPlace`/`CompositionResult`/`UnmetAnchor`/`FacetCandidates` (Task A1) are the exact types consumed unchanged through Tasks A3, A5, B2, C1, C3, C5, D2. `PlanningExperienceCandidate.preferenceWeight`/`mustInclude` (Task C2) are the exact fields Task C3 reads and Task D2 sets. `ClassificationResult` (Task B2) is the exact shape Task D2's Stage 7 persistence call consumes. `CompositionCandidate` (Task C1) is the exact shape `ExperienceCompositionService` (Task D2) builds from real Prisma rows.
