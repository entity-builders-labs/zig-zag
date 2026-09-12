# Preference-First Selection & Agent-Convergence — Implementation Plan

> **Execution rule:** implement task-by-task. The canonical source of truth is
> `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`.
> If code/current tests conflict with that spec, characterize first and change
> the implementation; do not silently reintroduce legacy semantics.

**Goal:** Replace the live tour-generation engine's catalog-first broad pool +
late preference scoring with preference-first per-facet retrieval, targeted
acquisition, evidence-only semantic classification, canonical persistence,
deterministic weighted composition, and preference-aware deterministic daily
planning.

**Branching:** create `feat/preference-first-selection` from the current
`feat/experience-domain-v2`. Do not implement this plan directly on
`feat/experience-domain-v2`. Never touch `feat/agentic-travel-planning` in this
plan.

**Phase semantics:** this work finalizes Phase 7; it is not Phase 8. Phase 7 is
closed after the preference-first core is stable, its acceptance matrix is
green, and the branch is merged back to `feat/experience-domain-v2`. Argentina
live smoke happens after that merge and gates convergence into
`feat/unified-agentic-travel-planning`.

---

## 0. Non-negotiable implementation invariants

1. `explorationStyle` is a field on `PreferenceSpec`, **never a RequestedFacet**.
   It must never enter per-facet retrieval, sufficiency, acquisition deficits or
   `unmetFacets`.
2. A requested facet is satisfied by **>= 1 strong match** in v1.
3. `days × pace` is a **GLOBAL initial portfolio-breadth target**, never a quota
   per facet and never the final Tour cardinality. Duration/travel/opening-hours
   feasibility determines the final scheduled count.
4. `soft` venue anchors are a strong ordering boost only. They are not forced.
   `must` venue anchors are hard-included only when resolved and feasible.
5. Existing `experienceId` alone does not mean classification can be skipped.
   Reuse only a current, valid persisted classification.
6. Semantic classification emits themes/intents/freeform traits only in v1. It
   does not fabricate structured trait dimensions.
7. Per-facet retrieval reuses the canonical catalog geography/hydration boundary
   (`ExperienceCatalogService` or a method added there). Do not create a second
   arbitrary `Prisma.findMany(... take: 500)` catalog implementation.
8. Quality for multi-component walks/routes can derive from component quality /
   notability when the composite itself has no rating.
9. A selectable Experience has >=1 resolved component. Bare AREA/ROUTE entities
   are never scheduled.
10. `ExperienceComponent.order` is non-null only when cited evidence explicitly
    proves a real sequence.
11. Real Postgres for persistence/integration/e2e. Fake only external provider /
    LLM / embedding / travel-estimator transports where deterministic tests need
    isolation.
12. Do not add Activity/Event/OperationalStop/TourStop or a classification cache
    table in this plan.
13. Trace v4 remains fully auditable, but the primary Bitácora is a concise
    product decision surface: no rule ID, enum, service name or raw payload may
    be required to understand a step. Technical details stay available behind
    expansion.
14. Composition preserves a deterministic ranked reservoir beyond the initial
    portfolio target. The planner may consume it when meaningful usable capacity
    remains; only after the reservoir is exhausted may bounded planner-triggered
    acquisition run. Never add low-quality filler merely to occupy every minute.
15. Embeddings are **ranking-only personalization**. `semanticSimilarity` may
    order already eligible/matching Experiences but never creates a facet match,
    changes weak→strong, satisfies coverage, stops acquisition, bypasses hard
    exclusions/geography/evidence/identity, or overrides planner feasibility.
16. `explorationStyle` is also **ranking-only personalization**. It is projected
    over independent evidence-backed `prominence`, `tourismIntensity` and
    `localCharacter` signals. Low prominence is not local character, high
    prominence is not low quality, missing evidence is `unknown` rather than
    zero, and `local_deep_dive` is never implemented as `1 - prominence`.

---

## 1. Target shapes and helpers

### New files

- `be/src/modules/tours/interfaces/preference-spec.interface.ts`
- `be/src/modules/tours/utils/preference-spec-builder.util.ts`
- `be/src/modules/tours/utils/preference-sufficiency.util.ts`
- `be/src/modules/tours/services/facet-retrieval.service.ts`
- `be/src/modules/tours/utils/exploration-signals.util.ts`
- `be/src/modules/tours/prompts/experience-semantic-classification.prompt.ts`
- `be/src/modules/tours/services/experience-classification.service.ts`
- `be/src/modules/tours/utils/trait-shape-guard.util.ts`
- `be/src/modules/tours/utils/quality-score.util.ts`
- `be/src/modules/tours/utils/merge-metadata.util.ts`
- `be/src/modules/tours/utils/composition-set-cover.util.ts`
- `be/src/modules/tours/services/experience-composition.service.ts`
- `be/src/modules/tours/utils/must-anchor-placement.util.ts`
- `be/src/commands/scripts/commands/classify-eval.command.ts`

### Canonical interfaces

```ts
export interface RequestedFacet {
  dimension: string;
  key: string;
  weight: number;
  source: 'wizard' | 'free_text';
  required: false;
}

export interface AnchoredPlace {
  rawName: string;
  kind: 'venue' | 'area' | 'route' | 'unknown';
  priority: 'soft' | 'must';
}

export interface PreferenceSpec {
  facets: RequestedFacet[]; // NEVER exploration_style
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

export interface FacetCandidates {
  facet: RequestedFacet;
  strongMatches: string[];
  weakMatches: string[];
  satisfied: boolean; // strongMatches.length >= 1
}

export interface PortfolioSufficiency {
  allFacetsSatisfied: boolean;
  basePortfolioTarget: number;
  portfolioTarget: number;
  distinctEligibleCount: number;
  sufficient: boolean;
}

export interface UnmetAnchor {
  anchor: AnchoredPlace;
  reason: 'UNRESOLVED' | 'INFEASIBLE';
}

export interface CompositionResult {
  selected: string[]; // initial portfolio, not final Tour cardinality
  rankedReservoir: string[]; // eligible unselected rows for duration-aware backfill
  perFacetCoverage: Record<string, string[]>;
  unmetFacets: string[];
  mustAnchorsForced: string[];
  softAnchorsBoosted: string[];
  unmetAnchors: UnmetAnchor[];
  portfolioTarget: number;
}
```

Provide one shared `facetKey({dimension,key}) => "dimension:key"` helper.

---

# Checkpoint A — PreferenceSpec, sufficiency, retrieval, exploration signals

Checkpoint A creates pure/canonical primitives and catalog retrieval. It does
not wire the live generation path yet.

## A1 — PreferenceSpec + facetKey

Create the interfaces above and tests proving:
- `facetKey(theme/history) === "theme:history"`;
- the type has a separate `explorationStyle` field;
- no helper treats exploration style as a facet.

Do not put `'exploration_style'` in the RequestedFacet documentation or builder.

## A2 — Interpreter anchors (D3)

Modify:
- `preference-interpretation.interface.ts`
- `preference-interpreter.service.ts`

Add `anchoredPlaces: AnchoredPlace[]` to `NormalizedPreferenceIntent`.

Prompt rule:

```text
priority=must ONLY for explicit named-place intent such as:
"quiero visitar X", "incluí X", "sí o sí X", "no me quiero perder X".
Anything weaker or ambiguous => soft.
```

Normalize unknown kinds to `unknown`, unknown priorities to `soft`, trim empty
names and cap count conservatively.

Tests:
- explicit “sí o sí Teatro Colón” → must;
- “me gustaría conocer Teatro Colón” → soft;
- mere mention “me interesa la arquitectura del Teatro Colón” → soft;
- malformed anchor payloads degrade safely.

## A3 — PreferenceSpec builder

Create `preference-spec-builder.util.ts`.

Merge:
- wizard interests → theme facets;
- wizard intents → intent facets;
- interpreted preferred facets → facets;
- exclusions → exclusions;
- anchoredPlaces → anchors;
- `explorationStyle` → **only** `PreferenceSpec.explorationStyle`;
- dietary/accessibility/budget/group into their correct soft-constraint arrays.

Do **not** repeat the previous bug that copied dietary restrictions into budget.

Deduplicate facets by `(dimension,key)` and keep the highest effective weight.
All positive facets remain `required:false` in v1.

Required tests:
- wizard history + interpreted history results in one history facet;
- exploration style produces zero facet entries;
- dietary restrictions stay in `softConstraints.dietary`;
- low budget goes to budget only;
- family group goes to group only;
- anchors pass through unchanged.

## A4 — Canonical sufficiency helper

Create `preference-sufficiency.util.ts` with:

```ts
paceFactor(relaxed)=3
paceFactor(moderate)=4
paceFactor(fast)=5
basePortfolioTarget(days, pace) = clamp(days,1,14) * paceFactor(pace)
facetSatisfied(strongCount) = strongCount >= 1
portfolioTarget(baseTarget, distinctReservations, distinctMustAnchors)
  = max(baseTarget, distinctReservations + distinctMustAnchors)
```

Do not implement `requiredMatchCount(days, pace)` per facet.

Important post-A4 clarification from canonical D6: these helpers estimate
**pre-planner candidate breadth only**. Do not retrofit duration/travel/opening
hours into A4 and do not interpret `portfolioTarget` as the exact or maximum
final Tour size. Duration-aware refinement belongs in Checkpoint C planning.

Tests MUST include:
- 5 moderate days → base target 20 TOTAL;
- history strongCount=1 → history satisfied;
- history=1 + architecture=1 + tango=1 for a 5-day trip does not make the
  portfolio sufficient if there are only 3 distinct eligible Experiences;
- exploration style cannot change any sufficiency result.

## A5 — Strong/weak match helper

Add a pure helper used by retrieval:
- first call `candidateMatchesPreferenceFacet`;
- require >=1 resolved component with valid geography;
- require quality floor (initial policy `3.0`);
- require current classification/evidence not explicitly degraded/thin;
- apply only obvious feasibility checks available pre-planner (for example an
  Experience duration longer than the entire planning window).

The daily planner remains authoritative for full feasibility.

Tests include strong, below-quality, no-component, degraded-classification and
non-matching cases.

## A6 — FacetRetrievalService with canonical catalog boundary

Create `FacetRetrievalService` but **do not inject Prisma for a separate raw
bounding-box query**.

Preferred implementation:
- call `ExperienceCatalogService.findVerifiedWithin(...)`, or
- add a deterministic catalog method if the existing limit is insufficient.

If a new catalog method is added it must preserve:
- deterministic order;
- component + trait hydration;
- true radius filtering;
- no arbitrary truncation before semantic matching.

The service returns strong and weak IDs ordered strongest-first within the
facet, and `satisfied = strongMatches.length >= 1`.

**A6 MUST NOT use embeddings/vector similarity to decide match, strong/weak or
`satisfied`.** A high cosine similarity is ranking context for Checkpoint C only;
coverage remains `candidateMatchesPreferenceFacet` + A5 strong-match policy.
Do not generate a query embedding in A6 and do not use vector search as a
substitute for canonical facet retrieval.

Integration test with real Postgres:
- seed >500 Experiences so retrieval proves a relevant row is not lost by an
  arbitrary first-500 truncation;
- one strong history Experience is enough to mark history satisfied;
- a name containing “history” with no history facet does not match;
- an Experience with no history facet remains non-matching even if a later
  embedding similarity would be very high;
- bare/no-component rows never become strong.

## A7 — Evidence-Backed Exploration Signals

`PreferenceSpec.explorationStyle` remains:

```ts
'iconic' | 'local_deep_dive' | 'balanced'
```

but it is a traveler-side meta-preference, **not** a standardized taxonomy on
Experiences, not a facet and not a categorical property persisted on an
Experience.

Implement a pure deterministic utility, preferably:

`be/src/modules/tours/utils/exploration-signals.util.ts`

Detailed design rationale is retained in
`docs/superpowers/specs/2026-09-11-exploration-signals-design.md`, but this main
plan is sufficient to execute A7.

### A7.1 Canonical signal model

Model three independent evidence-backed signals:

```ts
export interface ExplorationSignalEvidence {
  source: string;
  key: string;
  value?: string | number | boolean;
}

export interface EvidenceBackedExplorationSignal {
  value: number | null; // normalized 0..1 when known
  confidence: number;   // normalized 0..1
  evidence: ExplorationSignalEvidence[];
  reasonCodes: string[];
}

export interface ExplorationSignals {
  prominence: EvidenceBackedExplorationSignal;
  tourismIntensity: EvidenceBackedExplorationSignal;
  localCharacter: EvidenceBackedExplorationSignal;
}
```

Canonical rules:

```text
low prominence != local character
high prominence != low quality
unknown != zero
local_deep_dive != 1 - prominence
```

No single opaque `iconicity` scalar is the canonical representation.

### A7.2 Normalized input contract

Do not couple the utility to Prisma or a provider service. Consume a small
normalized grounded-fact input, conceptually:

```ts
export interface ExplorationSignalInput {
  placesReviewCount?: number | null;
  wikidataSitelinkCount?: number | null;
  wikipediaPresent?: boolean | null;
  wikivoyageListed?: boolean | null;
  heritageOrLandmark?: boolean | null;

  explicitTourismIntensityEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;

  explicitLocalCharacterEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;
}
```

Do not keyword-scan names, descriptions, snippets or raw JSON in A7. If current
metadata cannot supply a signal, return unknown; do not fabricate it.

### A7.3 Prominence

Prominence may use measurable evidence such as:
- Places review count (count, never star rating);
- Wikidata sitelink count;
- Wikipedia presence;
- Wikivoyage listing;
- heritage/landmark as a modest supporting term.

Use named constants and saturating/log-like normalization for unbounded counts.
`50_000` vs `50_100` reviews should move little compared with `50` vs `100`.
Heritage alone must not force a near-1 score. If no meaningful prominence input
exists, return `value:null`, not zero.

### A7.4 Tourism intensity

Do **not** derive `tourismIntensity` from prominence or review count alone.
Consume only explicit normalized grounded tourism-intensity evidence. Without
such evidence, return `value:null`.

Future upstream evidence may include explicit tourist-hotspot / heavy-tourist-
circuit / tourism-density facts, but A7 itself performs no provider or LLM call
and no keyword classification.

### A7.5 Local character

Do **not** derive `localCharacter` from obscurity, low review count, missing
Wikidata/Wikivoyage or low prominence. Consume only explicit normalized grounded
local-character evidence. Without it, return `value:null`.

Future upstream evidence may represent neighborhood institutions, traditional
markets, local cultural practices, community venues, “popular with locals” or
similar grounded facts.

### A7.6 Unknown semantics and sanitization

`value:null` means insufficient grounded evidence. `value:0` means actual
grounded support for the low endpoint. Confidence for an unknown signal may be
zero, but the value remains null.

Sanitize `NaN`, infinities, negative counts and out-of-range strengths
deterministically. Known values and confidence must remain within `0..1`.
Malformed metadata degrades to ignored/unknown rather than inventing a score.

### A7.7 Exploration-style ranking projection

Also expose a pure canonical projection, conceptually:

```ts
export interface ExplorationTilt {
  score: number;
  contributions: Array<{
    signal: 'prominence' | 'tourismIntensity' | 'localCharacter';
    contribution: number;
    reasonCode: string;
  }>;
}

computeExplorationTilt(style, signals): ExplorationTilt
```

Semantics:
- `iconic`: known prominence contributes positively; unknown prominence is
  neutral; no signal becomes a hard filter;
- `local_deep_dive`: known positive localCharacter contributes positively and
  known high tourismIntensity may moderate/penalize; low or unknown prominence
  by itself gives **no** bonus;
- `balanced`: exact neutral tilt, preferably `0`.

Keep weights as named deterministic constants. A7 defines this primitive but
**does not wire it into composition yet**; C1/C2 consume it later.

### A7.8 Architectural boundary

A7 has:
- no provider calls;
- no LLM calls;
- no embeddings;
- no acquisition;
- no PostGIS/Prisma writes;
- no database migration;
- no live orchestration wiring;
- no effect on facet matching, strong/weak, sufficiency or acquisition.

It is ranking context only.

### A7.9 Required tests

At minimum prove:
- many reviews > few reviews for prominence, all else equal;
- huge review counts saturate;
- more Wikidata sitelinks increases prominence;
- Wikipedia/Wikivoyage/heritage contribute only according to named policy;
- no prominence evidence => `value:null`;
- corrupt counts sanitize safely;
- no explicit tourism evidence => tourismIntensity `value:null` even when
  prominence is high;
- explicit tourism evidence produces a deterministic known value and retains
  provenance;
- obscure/low-review candidate with no explicit local evidence => localCharacter
  `value:null`;
- explicit grounded local evidence produces a deterministic known value and
  retains provenance;
- `iconic`: higher known prominence gives higher tilt;
- `iconic`: unknown prominence is neutral;
- `local_deep_dive`: grounded localCharacter gives positive tilt;
- `local_deep_dive`: grounded high tourismIntensity moderates/penalizes;
- `local_deep_dive`: low prominence + unknown localCharacter gives no bonus;
- `balanced`: exact neutral tilt;
- same input repeated => deep-equal result;
- utility has no provider/Prisma/LLM/embedding dependency and exposes no
  `matches`/`satisfied` result.

If current real metadata only supports robust `prominence` while
`tourismIntensity` and `localCharacter` remain unknown, that is acceptable and
preferable to absence-based heuristics.

### Checkpoint A verification

Run targeted unit/integration tests plus backend typecheck/lint. All green before
Checkpoint B.

---

# Checkpoint B — Acquisition, evidence preservation, classification, quality

## B1 — Preserve adapter evidence

OSM:
- preserve `narrativeContext` as structured metadata when present;
- retain full OSM tags.

Wikivoyage:
- preserve `sectionType` and `templateName`.

Google Places:
- request/map `editorialSummary`;
- preserve `websiteUri`, `priceLevel`, `businessStatus`, rating/count and types;
- include `primaryTypeDisplayName` if supported by current API mapping.

Unit-test every field. Do not change the invariant that generic operational
food/nightlife venues do not automatically become tourism Experiences.

## B2 — Evidence-only classifier + trait guard

Create:
- `experience-semantic-classification.prompt.ts`
- `trait-shape-guard.util.ts`
- `experience-classification.service.ts`

Classification output:

```ts
interface ClassificationResult {
  themes: string[];
  intents: string[];
  traits: string[];
  reasoningEvidence: Array<{
    facet: string;
    evidenceKeys: string[];
    reason: string;
  }>;
  modelId: string;
  promptVersion: number;
  state: 'classified' | 'degraded';
}
```

Prompt requirements:
- evidence only;
- no user preferences;
- empty arrays allowed;
- themes/intents only when substantially supported, not incidental words;
- every accepted semantic fact references evidence keys;
- no `dimensionedFacets`;
- no generic sentence-shaped traits.

Sequential calls, bounded retry/backoff on 429.

### Correct D2 reuse predicate

Add a pure helper, e.g.:

```ts
canReuseClassification(metadata, CURRENT_PROMPT_VERSION): boolean
```

True only when:
- `metadata.classification` exists;
- prompt version is current;
- payload passes deterministic shape guards.

**Never implement `if (experienceId) return 'skipped'`.**

Cases:
- existing + current valid classification → reuse, zero LLM calls;
- existing + no classification → classify;
- existing + stale prompt version → classify/reclassify;
- brand-new → classify;
- repeated failure → degraded empty facets, no throw.

## B3 — Quality score including composite-component signals

Create `quality-score.util.ts`.

Support:
- direct Places rating + review-count confidence;
- Wikivoyage listed;
- Wikidata sitelink signal;
- `componentQualityScores[]` / component notability for multi-component
  Experiences without a direct rating.

Do not assign a flat magic score to a route.

Required tests:
- high rating with many reviews > same rating with two reviews;
- WV/WD can produce non-null quality without Places;
- a walk with no direct rating but several high-quality grounded components can
  clear quality floor;
- zero signals → null.

## B4 — Order-independent metadata merge; no invented trait dimensions

Extract pure `mergeExperienceMetadata` and use it in
`ExperienceCatalogService`.

Rules:
- union themes/intents/freeform traits;
- richer non-empty scalar wins over empty;
- quality keeps strongest valid signal according to policy;
- classification replacement is version-aware, not arbitrary provider order;
- provider order A→B and B→A converges for semantic arrays.

**Do not rewrite freeform classifier traits into `tourism_intensity`,
`local_character` or any other structured dimension.** The classifier does not
produce a dimension taxonomy in v1.

Keep existing freeform/general trait persistence for classifier strings.
Preserve explicit dimensioned evidence only when the source already supplied a
real dimension.

Remove/replace any old characterization test that expected
`exploration_style:iconic` to match a fabricated `tourism_intensity:iconic`
trait created from a freeform string.

## B5 — Area/route walk acquisition (D5)

Add area-scoped walk routing, preferably through the existing acquisition
planner/source-capability model rather than a parallel bespoke architecture.

For `(areaAnchor + walk/route_like)`:
- first query catalog for a compatible persisted multi-component Experience in
  the area;
- only if absent, route to web/source discovery for a real guided/self-guided
  walk/route article;
- extraction enumerates each real named component hint;
- resolver grounds every component;
- no invented coordinates;
- order only from explicit sequence evidence;
- insufficient evidence => no fake walk;
- successful result persists normally.

There is no `NEIGHBORHOOD_WALK` enum/type.

Tests:
- routing contains area name + walk objective;
- cold request acquires grounded multi-component Experience;
- second request reuses the same persisted Experience ID;
- the reuse test must NOT assert “no acquisition of any kind happened” if other
  facets legitimately still need acquisition. Assert specifically that the
  San-Telmo walk was reused / not reacquired.

## B6 — Narrow web extraction contract

Update `experience-candidate-extraction.util.ts` / prompt contract:
- entity/Experience name;
- evidenceKeys;
- componentHints for real named components;
- `orderedByEvidence` semantics;
- no semantic themes/intents/traits authority from discovery extraction.

Themes/intents/traits default empty at this stage and are filled by Stage 6.

### Checkpoint B verification

Run provider tests, classifier tests, quality tests, metadata convergence tests,
area-walk routing tests, real-Postgres round trips, typecheck and lint.

---

# Checkpoint C — Deterministic composition, planner handoff and explainability

## C1 — Composition candidate model

```ts
interface CompositionCandidate {
  id: string;
  componentCount: number;
  satisfiedFacets: string[];
  qualityScore: number | null;
  explorationSignals: ExplorationSignals;
  explorationTilt: number;
  semanticSimilarity: number;
  groundingStrength: number;
  matchesHardExclusion: boolean;
  softAnchorBoost: number;
  isPerformanceVenue: boolean;
}
```

`explorationSignals` are evidence-backed factual/ranking inputs. `explorationTilt`
is the request-specific result of
`computeExplorationTilt(PreferenceSpec.explorationStyle, explorationSignals)`.
Neither participates in eligibility or facet truth.

`softAnchorBoost > 0` only for resolved soft venue anchors. It is a ranking
signal, not a forced selection bit.

## C1b — Embedding-backed semantic similarity (D7)

Implement one canonical semantic-similarity contract for composition. Reuse the
existing persisted Experience embedding fields/infrastructure; do **not** add a
parallel vector table/store solely for this flow.

Rules:
1. If `PreferenceSpec.semanticQuery` is non-empty, compute at most one query
   embedding for the generation/composition context using the active embedding
   contract.
2. Candidate vectors come from persisted canonical `Experience.embedding` plus
   its embedding metadata (`embeddingProvider`, `embeddingModel`,
   `embeddingDimensions`, `embeddingDocumentVersion`).
3. Validate query/candidate compatibility before trusting cosine similarity.
4. Compute `semanticSimilarity` from compatible vectors and attach it to
   `CompositionCandidate`.
5. Empty semanticQuery, missing candidate vector, stale/incompatible metadata or
   query-embedding failure => deterministic neutral/unknown similarity plus a
   reason for trace/debug. Do not fail tour generation.
6. Do not call the embedding provider once per candidate. Do not synchronously
   generate/repair missing candidate Experience embeddings inside composition.
   Candidate embedding creation/refresh belongs to normal catalog/enrichment;
   stale/missing rows may be marked/queued for async repair.
7. Embedding similarity is ranking-only. It cannot create a facet match, convert
   weak→strong, contribute to coverage/sufficiency, stop acquisition, bypass
   hard exclusions/geography/evidence/identity or alter planner hard feasibility.

Required tests:
- non-matching candidate with `semanticSimilarity=0.99` still cannot cover a facet;
- two otherwise-comparable strong candidates order by semantic similarity at the
  documented tie-break position;
- empty semanticQuery => deterministic neutral similarity;
- missing/stale/incompatible candidate embedding => neutral/unknown, no throw;
- one generation with N candidates performs at most one query-embedding call and
  zero per-candidate embedding-generation calls;
- identical query + persisted compatible vectors => deterministic scores/order.

## C2 — Canonical weighted set-cover composition

Create `composition-set-cover.util.ts`.

Algorithm:

1. Drop hard-excluded / no-component / out-of-scope candidates.
2. Process venue `must` anchors:
   - unresolved => `UNRESOLVED`;
   - resolved eligible => put in selected and record `mustAnchorsForced`.
3. For each requested facet, reserve exactly one strongest strong match if not
   already covered by a selected candidate.
4. Compute **global initial** portfolio target using the A4 helper.
5. Fill the initial selected set until portfolio target (or candidates exhausted).
6. Keep every remaining eligible candidate in a deterministic ranked reservoir
   using the same preference-aware ordering; do not discard them merely because
   the initial target was reached.
7. Recompute initial per-facet coverage/unmet facets.

Within-facet strength should prioritize:
- grounding/match strength;
- requested facet weight;
- semantic similarity;
- quality;
- exploration-style tilt from `computeExplorationTilt`;
- soft anchor boost;
- diversity/stable id tie break.

Remainder fill and reservoir ordering use:

```text
weightedCoverage(c) = Σ requestedFacet.weight for each requested facet c satisfies
```

Then similarity / quality / evidence-backed exploration tilt / soft-anchor boost /
diversity / stable id.

Do not use raw facet count as the primary objective.
Do not hardcode `days * 4`; call the canonical portfolio-target helper.
Do not interpret `portfolioTarget` as a maximum final Tour size.
Do not let semantic similarity or exploration signals participate in eligibility/
coverage: C2 consumes them as ranking signals only after canonical match/strongness
is known. In particular, do not implement local-deep-dive as inverse prominence.

Required unit cases:
- 5 moderate days targets 20 initial candidates, not 20 per facet;
- one strong history match reserves history;
- a non-matching candidate with extremely high semantic similarity cannot reserve
  or cover history;
- among otherwise-comparable strong matches, higher semantic similarity wins at
  the semantic-similarity ranking position;
- iconic style can prefer higher known prominence among otherwise-comparable
  eligible candidates without changing coverage;
- local-deep-dive can prefer explicit localCharacter and/or moderate known high
  tourismIntensity, but obscure+unknown-local gets no automatic bonus;
- balanced exploration style contributes exactly neutral tilt;
- monothematic strongest tango-performance venue survives even if a weaker
  candidate covers 3 labels;
- weighted two-low-priority facets do not automatically beat one high-priority
  facet;
- hard exclusions drop before reservation;
- bare AREA/ROUTE/no-component candidate cannot cover anything;
- soft venue anchor can be selected because of boost but is allowed to lose;
- must venue anchor is forced;
- unresolved must → exact UNRESOLVED;
- candidates beyond the initial target remain in deterministic reservoir order;
- deterministic deep equality on repeat includes both selected and reservoir.

## C3 — ExperienceCompositionService

Thin service that:
- unions candidate IDs returned from facet retrieval plus resolved anchors;
- hydrates canonical rows through catalog service / deterministic Prisma lookup;
- computes satisfied facets only with the canonical matching primitive;
- computes weighted preference coverage;
- derives `ExplorationSignals` only from grounded normalized evidence and computes
  the request-specific `explorationTilt`, with unknown signals remaining neutral;
- obtains the one request/query embedding when applicable and attaches
  embedding-backed `semanticSimilarity` through the C1b contract without
  creating a second semantic/coverage engine;
- computes soft anchor boost;
- calls pure `composeSet`;
- returns both the initial selected portfolio and ranked reservoir.

No second semantic engine. The composition service may rank with embeddings and
exploration tilt but must never use either to recompute facet truth or
sufficiency.

## C4 — Planner candidate contract

Modify `PlanningExperienceCandidate`:

```ts
preferenceWeight?: number;
mustInclude?: boolean;
qualityScore?: number; // raw 0..5
```

Normalizer:
- passes raw `Experience.qualityScore`;
- receives `preferenceWeightById`, calculated from DISTINCT requested facets the
  Experience satisfies (sum their weights once each);
- marks only resolved must venue Experiences as `mustInclude`.

Planner soft score applies quality and preference once each.

The same normalization contract is used for initial selected candidates and
reservoir candidates promoted during backfill; backfill does not create a second
planner-candidate semantics path.

## C5 — Must-anchor pinned placement

Create `must-anchor-placement.util.ts` and adapt deterministic candidate sorting
/ local improvement.

Rules:
- `mustInclude` candidates attempt placement before normal greedy competition;
- hard feasibility is still checked;
- infeasible must candidate remains unselected and maps to exact
  `unmetAnchor{reason: INFEASIBLE}`;
- solver continues;
- local improvement cannot evict placed must candidate.

Acceptance test MUST assert exact `INFEASIBLE`; do not use vacuous assertions
such as `length >= 0`.

## C5b — Duration-aware planner backfill and bounded convergence (D6)

Implement the Stage 10 refinement loop from canonical spec §13.1. This task does
**not** change A4's `days × pace` formula; it interprets that formula correctly
as initial candidate breadth.

After the initial solver pass:
1. derive meaningful residual capacity from the actual schedule, using known
   Experience duration, travel time, opening hours/day windows, geography,
   mobility constraints and must placements;
2. if no meaningful residual capacity remains, stop even if the final scheduled
   count is below `portfolioTarget`;
3. otherwise promote the next best feasible candidate(s) from the deterministic
   ranked reservoir and re-run the affected planning pass;
4. never append an Experience without rechecking hard feasibility;
5. continue only while the schedule makes deterministic progress;
6. if meaningful capacity remains and the reservoir is exhausted, return a
   structured planner-capacity deficit to orchestration;
7. orchestration may then run bounded targeted acquisition using the normal
   evidence/resolve/classify/persist/re-retrieve path, recompose the reservoir,
   and replan;
8. terminate on no meaningful capacity, no feasible reservoir candidate, no
   progress, exhausted provider/acquisition budget, or configured pass limit.

Capacity-deficit context should be as concrete as the planner can prove, e.g.:

```ts
interface PlannerCapacityDeficit {
  dayIndex: number;
  availableMinutes: number;
  areaOrScope?: string;
  preferredFacets: Array<{ key: string; weight: number }>;
}
```

Do not hardcode a universal minute threshold in A4. “Meaningful residual
capacity” is planner/policy-level and may account for travel overhead and
quality. Do not force filler into tiny/awkward gaps or degrade the itinerary just
to maximize occupied minutes.

Required tests:
- long Experiences can yield a valid final Tour with fewer scheduled rows than
  the initial `portfolioTarget`;
- short Experiences with useful capacity promote additional candidates from the
  reservoir, so final scheduled count may exceed the initial target;
- promoted candidates still obey travel/opening-hours/day feasibility;
- reservoir exhaustion with meaningful capacity emits a structured capacity
  deficit rather than silently stopping;
- newly acquired backfill candidates are not schedulable until they complete the
  canonical persistence/re-retrieval path;
- tiny/awkward gaps do not force filler;
- repeated identical input produces identical backfill decisions;
- no-progress/pass-budget termination prevents infinite loops.

## C6 — Overlap resolution

Where overlap candidates conflict, use requested weighted coverage before legacy
component-count tie-breaking when preference context is available. Preserve the
legacy comparator only for callers that do not provide preference context.

## C7 — Generation trace v4

Trace separately records:
- PreferenceSpec facets;
- explorationStyle as meta-preference;
- per-facet strong/weak matches and `satisfied`;
- basePortfolioTarget / portfolioTarget / distinctEligibleCount;
- acquisition deficits;
- classification reused vs classified vs degraded + evidence keys;
- exploration-signal provenance: known/unknown prominence, tourismIntensity and
  localCharacter, confidence/evidence/reason codes, plus request-specific tilt
  contributions; never fabricate missing signals as zero;
- semantic-ranking provenance without raw vectors: semanticQuery present/absent,
  query-embedding success/fallback, non-secret embedding provider/model/
  dimensions/document-version compatibility metadata, and candidate similarity
  score or neutral/fallback reason;
- composition reservations, initial selected IDs and ranked reservoir size/order;
- soft anchor boosts;
- must anchors forced;
- unmet facets / anchors;
- planner initial placements/unselected feasibility reasons;
- residual-capacity calculations and backfill iterations;
- whether each backfill came from reservoir or planner-triggered acquisition;
- initial selected count, final scheduled count and convergence stop reason.

Never persist or expose raw embedding arrays in generation trace/Bitácora.
Delete JSON-string keyword theme matching from trace generation.

Trace v4 is the machine/audit contract. Do not shape backend trace fields around
current frontend widgets. Preserve enough structured information for the UI to
produce concise human summaries while technical details remain exact.

Required trace tests:
- `version === 4` for the new path;
- `explorationStyle` is separate from facets;
- exploration signals preserve known/unknown state and the tilt is explainable
  from recorded contributions;
- each facet exposes strong/weak counts and satisfaction;
- acquisition records exact deficit/reason and sources/queries/evidence;
- classification records reused/classified/degraded and evidence keys;
- semantic ranking records score/fallback provenance but no raw vectors;
- composition records reservations, initial selection, ranked reservoir,
  selected/unselected reason data and anchors;
- planner records initial placement, residual capacity, backfill decisions,
  final placement and unselected feasibility reasons;
- trace generation never performs semantic matching by JSON/string keywords.

## C8 — Product-readable Generation Bitácora v4

Implement the frontend presentation contract from spec §14.

Primary file:
- `fe/components/tour-details/GenerationBitacora.tsx`

Inspect and update any nearby Bitácora types/tests/helpers rather than creating a
parallel second Bitácora component.

### C8.1 Trace-version/types

The current frontend type only knows legacy trace versions. Add native v4
support. Prefer explicit structured v4 fields/types over adding more `unknown`
compatibility bags.

Legacy traces must remain viewable. Do not delete the V1/V2/V3 compatibility
renderer solely because v4 exists.

Conceptually:

```ts
export interface GenerationTrace {
  version?: 1 | 2 | 3 | 4;
  ...
}
```

The v4 renderer must consume trace semantics; it must not recompute matching,
coverage, selection or feasibility in the frontend.

### C8.2 Product view information hierarchy

Every product-facing step uses this compact structure:

```text
Human-readable title
Purpose — max one short line
2–5 key metrics/results
Decision — one short line
Expandable details
```

Do not render explanatory paragraphs when a compact metric/status/table conveys
the same information.

A step should be understandable in approximately 10 seconds.

### C8.3 Product-facing groupings

Render/group the machine trace into these human concepts where applicable:

1. `Qué viaje entendimos`
2. `Destino resuelto`
3. `Cobertura de preferencias`
4. `Qué faltaba`
5. `Búsqueda de nuevas opciones`
6. `Verificación y clasificación`
7. `Selección de Experiences`
8. `Armado del itinerario`
9. `Resultado final`

These are presentation groupings only. Do NOT add fake backend orchestration
stages just to match the UI.

### C8.4 Required compact presentations

Preference coverage must expose per facet at least:

```text
Historia       3 strong · 2 weak   ✅ Cubierta
Arquitectura   1 strong · 4 weak   ✅ Cubierta
Tango          0 strong · 2 weak   ⚠️ Falta
```

and one concrete decision line, e.g.:

```text
Decisión: buscar nuevas opciones sólo para Tango.
```

Portfolio sufficiency must show:
- covered facets / total;
- distinct eligible count;
- global **initial breadth** target;
- sufficient/not sufficient for first planning attempt;
- whether the deficit is facet coverage or global pre-planner capacity.

Acquisition must show compactly:
- target facet/capacity objective;
- sources consulted;
- candidates/observations found;
- verified/accepted/rejected counts;
- final decision/result.

Classification must show compactly:
- reused count;
- newly classified count;
- degraded count;
- concise semantic labels per inspected Experience where useful.

Composition must show:
- global initial target;
- facets covered;
- reservations;
- soft-anchor boosts;
- must anchors;
- initial selected count;
- reservoir count;
- final decision.

Planner must show:
- days;
- initially placed Experiences per day / total;
- meaningful residual capacity when present;
- reservoir backfill count;
- planner-triggered acquisition count/pass when present;
- final placed Experiences per day / total;
- hard conflicts or feasibility failures;
- must placement result;
- convergence stop reason and final feasible/degraded outcome.

### C8.5 Human rule rendering

The primary view MUST NOT lead with internal codes.

Bad:

```text
PREF_STRONG_MATCH_QUALITY_FLOOR
PASS
actual=4.4 expected=3.0
```

Good:

```text
✅ Calidad suficiente
4.4/5 · mínimo 3.0
```

Implement a deterministic rule-presentation mapping/helper for rules that can
surface in the primary Bitácora. It may live in `GenerationBitacora.tsx` if small
or a nearby utility if substantial.

Each human rule presentation includes:
- short label;
- PASS/WARN/FAIL visual state;
- concrete actual/threshold or one-line reason when useful.

Do not generate these labels with an LLM.

Unknown/new rule IDs must degrade safely to a generic concise label without
breaking rendering; the exact rule ID remains visible in technical details.

### C8.6 Selected and unselected explanations

For relevant candidates, expose a short human reason based only on trace data.
Examples:
- `Reservada como mejor opción para Arquitectura`;
- `Priorizada porque pediste Teatro Colón` for a soft anchor boost;
- `Incluida obligatoriamente por tu pedido` for a resolved must;
- `Agregada porque quedaba capacidad útil en el itinerario` for reservoir
  backfill supported by trace;
- `No seleccionada: preferencia ya cubierta; otra opción aporta más peso/diversidad`;
- `Descartada: sin ubicación verificable`;
- `No pudo ubicarse: cerrada/no factible en el horario disponible`.

Do not invent explanations that are not supported by the trace.
Exact scores/reasonCodes remain in details.

### C8.7 Technical-details layer

Keep the engineering/audit information accessible but collapsed by default:
- internal stage/component/service names;
- rule IDs and reason codes;
- actual/expected thresholds;
- raw/normalized inputs/outputs;
- provider queries and source URLs;
- evidence keys;
- prompts/raw model responses already retained by trace policy, redacted;
- exploration-signal values/confidence/evidence/reason codes and ranking-tilt
  contribution breakdown;
- semantic-similarity score and embedding contract/fallback metadata, never raw
  embedding arrays;
- score breakdowns;
- timings;
- persisted IDs;
- raw trace JSON/download.

Do not remove debugging capability to make the product view simpler.

### C8.8 Acceptance tests

Add focused frontend tests and/or Playwright coverage proving at least:
- v4 renders without falling through to the legacy generic renderer;
- `explorationStyle` appears as a meta-preference, never as a coverage facet;
- covered facet renders `Cubierta` with strong/weak counts;
- uncovered facet visibly renders `Falta`;
- acquisition decision is understandable without opening technical details;
- soft anchor reads as prioritization, never as forced;
- must anchor clearly differentiates included / UNRESOLVED / INFEASIBLE;
- composition displays initial global target, initial selected count and
  reservoir count;
- planner distinguishes initial placements from duration-aware backfill and
  final scheduled count;
- a selected and an unselected Experience have concise human reasons;
- planner displays feasibility/result;
- primary view does not require a `ruleId` or `reasonCode` to understand any
  decision;
- expanding technical details still exposes underlying rule/evidence/exploration-
  signal/raw debugging data without exposing raw embedding vectors;
- product copy remains compact: no stage renders a long narrative paragraph for
  information already represented as metrics/status/decision.

Acceptance criterion:

> A product person must be able to scan only titles, metrics and decision lines
> and correctly explain what the traveler wanted, what was covered, what was
> missing, why research ran, what was initially selected, whether the planner
> found useful spare capacity, what was added through backfill, and whether the
> final itinerary is feasible — without interpreting a rule ID, enum or service
> name.

### Checkpoint C verification

Run embedding-semantic-ranking tests, pure composition tests, duration-aware
backfill/convergence tests, solver unit/acceptance tests, overlap tests, trace v4
tests, frontend Bitácora tests/Playwright, backend/frontend typecheck and relevant
lint. Do not enter Checkpoint D with C7 green but C8 unimplemented.

---

# Checkpoint D — Live-path cutover and removal of superseded orchestration

## D1 — Wire preference-first live orchestration

Modify `ExperienceGenerationService.generateTourExperiences` using the canonical
Stages 1–11:

1. interpret request;
2. build PreferenceSpec;
3. resolve destination;
4. resolve named anchors deterministically where possible;
5. retrieve per real facet;
6. compute global pre-planner portfolio sufficiency;
7. while insufficient and within pass/provider budget:
   - acquire uncovered facet(s) first;
   - if all facets covered but portfolio thin, acquire against highest-weight
     relevant facets / broad destination source routes;
   - corroborate / resolve identity;
   - reuse current classification or classify/reclassify as required;
   - compute quality including component signals;
   - persist/enrich;
   - re-retrieve canonical rows;
   - recompute global sufficiency;
8. after coverage/sufficiency is settled, derive evidence-backed
   `ExplorationSignals` and request-specific `explorationTilt`, then compute
   embedding-backed `semanticSimilarity` from one `PreferenceSpec.semanticQuery`
   query embedding against compatible persisted Experience embeddings, with
   deterministic neutral fallback. Neither ranking signal may feed back into
   step 5–7 coverage or acquisition decisions;
9. compose weighted deterministic **initial** portfolio + ranked reservoir;
10. normalize initial planner candidates with preferenceWeight/mustInclude;
11. deterministic initial solver + feasibility;
12. while meaningful residual capacity remains and convergence budget allows:
    - promote next feasible reservoir candidate(s), normalize through the same
      planner-candidate contract and replan;
    - if reservoir is exhausted, emit structured planner-capacity deficit;
    - run bounded targeted acquisition for that concrete capacity deficit only;
    - send discoveries through corroboration/classification/persistence/
      re-retrieval, recompute compatible ranking signals for newly eligible
      candidates without changing historical coverage truth, recompose reservoir
      and replan;
    - stop on no progress, no useful capacity or pass/provider budget;
13. map infeasible must anchors;
14. materialize + trace initial vs final planner state and convergence reason.

Do not call acquisition for exploration style.
Do not stop after “N candidates per facet”; only facet>=1 + global capacity can
stop pre-planner acquisition.
Do not let embedding similarity or exploration tilt satisfy a facet or stop
acquisition.
Do not stop final planning merely because `portfolioTarget` candidates were
initially selected; D6 backfill is authoritative for useful residual capacity.
Do not acquire filler for tiny/awkward gaps or solely to inflate catalog size.

Register new services in `tours.module.ts`.

## D2 — Cold-catalog E2E

Create `experience-selection-preference-first.e2e-spec.ts` with real Postgres and
faked external transports.

Required cases:
- history+architecture one-day request: both facets covered by grounded
  Experiences;
- initial composition target follows global pace target;
- a non-history Experience with near-perfect embedding similarity still cannot
  satisfy history or prevent targeted history acquisition;
- two otherwise-equivalent grounded history Experiences can reorder based on
  semanticQuery embedding similarity;
- iconic exploration style can reorder otherwise-comparable eligible candidates
  using known prominence without changing coverage;
- local-deep-dive never rewards obscurity by itself; explicit localCharacter is
  required for positive local tilt, while known high tourismIntensity may
  moderate it;
- balanced exploration style is neutral;
- missing exploration evidence and missing/incompatible embeddings both fall
  back neutrally and generation succeeds;
- long-duration candidates may schedule fewer rows than initial target without
  being considered incomplete solely by count;
- short-duration candidates with useful spare capacity pull deterministic
  backfill from reservoir, allowing final scheduled count > initial target;
- exhausted reservoir + meaningful capacity triggers bounded targeted
  acquisition and replanning;
- tiny/awkward gaps do not trigger low-quality filler;
- no-progress/pass-budget bounds terminate convergence;
- changing one preference changes selected composition deterministically;
- hard exclusion survives pressure;
- soft anchor has boost semantics (test a corpus where it wins and another
  where it legitimately loses);
- must anchor resolved+feasible ends up scheduled;
- must anchor unresolved → exact UNRESOLVED;
- must anchor resolved but impossible → exact INFEASIBLE and tour succeeds;
- bare area never selected;
- walk request with area anchor gets a multi-component grounded Experience.

## D3 — Remove superseded legacy pieces AFTER cutover compiles

Delete only once the new live path is green enough to replace callers:
- `coverage-analyzer.service.ts` + obsolete tests;
- `candidate-window-selection.util.ts` + obsolete tests;
- legacy global ranking functions no longer used by another legitimate caller;
- keyword/JSON theme matching helpers;
- structured synthesizer only if every structured source now truly flows
  through the new evidence/classification path and no non-tour caller still
  depends on it.

Use typecheck/import search as the worklist. Do not pre-delete dependencies and
leave a knowingly broken intermediate checkpoint.

Do not delete Bitácora legacy compatibility rendering while historical traces
still exist; removal of orchestration authority does not imply removal of trace
read compatibility.

## D4 — Adapt scale / competitive acceptance corpus

Keep the large (hundreds of Experiences) competitive corpora. Change assertions
from old “window size / global rank” mechanics to preference-first semantics:
- requested facets each have >=1 strong candidate;
- initial composition size aims at global portfolio target;
- final scheduled cardinality is feasibility-driven and may be below or above
  the initial target through deterministic backfill;
- a facet delta changes selected IDs;
- semanticQuery deltas may reorder otherwise comparable eligible candidates via
  embedding-backed similarity but never change factual facet coverage;
- explorationStyle deltas may reorder otherwise comparable eligible candidates
  only through evidence-backed exploration signals; unknown/low prominence is
  never treated as local evidence and coverage remains unchanged;
- dominance/regret is evaluated against weighted preference coverage + quality,
  not legacy global score;
- no arbitrary database row order changes outcome.

## D5 — Area-walk acquire + reuse E2E

Cold request:
- area anchor + walk intent;
- acquisition returns evidence naming multiple real stops;
- resolver creates real GeoEntities/components;
- walk Experience persisted;
- order remains null unless evidence proves sequence.

Second request:
- obtains the same Experience ID from catalog;
- specifically prove the walk was not reacquired;
- do not assert the entire `ExperienceAcquisitionService` was never called if
  other unrelated facets still need acquisition.

## D6 — Classification validation gate

Add `classify-eval.command.ts`, but make it truthful.

The previous draft built `SourceObservation`s from persisted evidence while
throwing all provider metadata away (`metadata:{}`), then attempted to judge
classification quality. Do not do that.

Use one of:
1. stored original observation/evidence metadata when available; or
2. a captured fixture corpus from real acquisition runs that includes the
   original structured metadata and evidence keys.

Report at minimum:
- Experience id/name;
- themes/intents/traits;
- reasoningEvidence;
- model/prompt version;
- accepted facet count;
- malformed trait count;
- unevaluable rows explicitly counted rather than silently classified from empty
  metadata.

Gate targets from the design:
- >=90% hand-reviewed theme/intent precision on the sample;
- 0 malformed accepted traits;
- 100% accepted semantic facets have >=1 evidenceKey.

Commit the reviewed report under `docs/superpowers/characterization/`.

## D7 — Formal Buenos Aires live spec

Run against an empty test catalog and real providers with:
- history;
- architecture;
- tango;
- visit;
- walk;
- San Telmo area anchor;
- Teatro Colón soft venue anchor;
- balanced exploration style;
- 2 days.

Assertions:
- every requested facet has >=1 strong match before composition OR is explicitly
  surfaced unmet (for provider reality failures; the expected canonical smoke
  should converge green before closure of the live-gate step);
- exploration style never appears as a facet;
- balanced exploration style produces a neutral exploration tilt regardless of
  whatever exploration evidence happens to be known;
- selected rows are grounded Experiences with components;
- San Telmo polygon itself is not scheduled;
- any acquired walk is multi-component and grounded;
- classification provenance exists for newly classified Experiences;
- embedding-backed semantic ranking, when available, uses persisted compatible
  Experience vectors and cannot alter the trace's factual coverage decision;
- exploration signals retain evidence/unknown provenance and cannot alter factual
  coverage decisions;
- if the planner reports meaningful residual capacity, any reservoir/acquisition
  backfill is grounded and traceable, and convergence remains bounded;
- the generated v4 trace can be rendered by the product Bitácora with the same
  coverage/acquisition/initial-composition/backfill/final-planner decisions
  visible without raw codes.

This live spec validates real provider behavior. Deterministic semantics remain
owned by unit/integration/e2e acceptance.

## D8 — Full verification and Phase 7 closure record

Before merge, run:

```bash
cd be
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn test --runInBand
yarn test:integration
yarn test:e2e --runInBand
yarn test:acceptance
yarn test:characterization
yarn workspace backend build
```

Run the frontend test/typecheck/lint matrix plus Playwright for Bitácora v4. A
backend-green trace with a broken or unintelligible Bitácora is not sufficient.

When the preference-first branch is stable and the deterministic acceptance
matrix is green:
1. merge `feat/preference-first-selection` → `feat/experience-domain-v2`;
2. record **Phase 7 CLOSED** in the progress document;
3. run Argentina Live Smoke against the merged ref;
4. if live smoke is acceptable, proceed to the agent Integration Gate.

Do NOT write the contradictory pair “Phase 7 CLOSED” and “Phase 7 remains NOT
CLOSED until live smoke”. Live smoke gates convergence; it is not the closure
definition.

---

# Required deletion / migration checklist

The old implementation concepts may be removed only after their replacement is
wired and tested:

- global CoverageAnalyzer decision as orchestration authority;
- `selectBoundedWindow`;
- global catalog-first rank/truncate path;
- keyword/JSON-string theme matcher;
- any vector/embedding similarity path that acts as coverage or strong-match
  authority instead of ranking-only personalization;
- any `exploration_style` coverage routing;
- any single opaque `iconicity` score or inverse-prominence heuristic acting as
  the canonical representation of exploration style;
- any per-facet `days×pace` quota;
- any interpretation of `days×pace` as exact/max final Tour cardinality;
- any composition path that discards all eligible rows beyond initial target
  instead of preserving the ranked reservoir;
- any `soft anchor => force include` behavior;
- any `experienceId => classification skipped` shortcut;
- any classifier-trait => fabricated structured-dimension conversion.

Do not delete generic score building blocks still used by the deterministic
planner unless search proves they have no legitimate caller.

Do not remove legacy Bitácora trace-read compatibility as part of this deletion
list. New v4 must have a native renderer, while old persisted traces remain
inspectable.

---

# Definition of Done

The implementation is complete when all of the following are true:

1. `PreferenceSpec.facets` contains real semantic/requested facets only;
   exploration style is separate.
2. Each requested facet needs one strong match for facet satisfaction.
3. `days×pace` is used as the global **initial breadth** target, never a
   per-facet quota or final Tour cardinality requirement.
4. Per-facet acquisition runs only for uncovered facets; global pre-planner
   capacity refill happens only after facet coverage and only while breadth is
   short.
5. Existing current classification is reused; missing/stale classification is
   classified/reclassified.
6. Freeform classifier traits do not fabricate structured dimensions.
7. Retrieval cannot lose a relevant Experience because of arbitrary `take:500`
   database ordering.
8. Composite quality can derive from grounded component signals.
9. Soft venue anchors are boosted, not forced.
10. Must venue anchors have exact RESOLVED+FEASIBLE / UNRESOLVED / INFEASIBLE
    semantics.
11. AREA/ROUTE anchors are scopes, not selectable stops.
12. Area+walk acquisition creates/reuses a normal multi-component Experience;
    there is no `NEIGHBORHOOD_WALK` type.
13. Composition uses one reservation per facet + weighted initial remainder fill
    and preserves a deterministic ranked reservoir beyond the initial target.
14. `ExplorationSignals` keeps prominence, tourismIntensity and localCharacter
    independent and evidence-backed; unknown is distinct from zero; low
    prominence never becomes localCharacter; `computeExplorationTilt` is
    ranking-only and balanced is neutral.
15. `semanticSimilarity` is embedding-backed fine ranking from at most one
    request/query embedding against compatible persisted Experience vectors;
    missing/stale/incompatible vectors degrade neutrally, no per-candidate inline
    embedding generation occurs, and vector similarity never creates coverage or
    strongness.
16. Planner receives raw quality once and preferenceWeight once for both initial
    and promoted reservoir candidates.
17. Duration-aware planning determines final cardinality: long Experiences may
    yield fewer rows than the initial target; short Experiences may trigger
    deterministic reservoir backfill and, only after reservoir exhaustion,
    bounded planner-triggered acquisition.
18. Backfill convergence stops deterministically on no useful capacity, no
    progress, exhausted candidate/provider budget or pass limits and never adds
    poor filler solely to occupy every minute.
19. Large-corpus e2e proves preference deltas change the best selected set,
    explorationStyle deltas refine ordering only through evidence-backed signals,
    and semanticQuery deltas can refine ordering without changing factual
    coverage.
20. Trace v4 explains facet coverage, global initial sufficiency, classification
    reuse, exploration-signal/tilt provenance, embedding-ranking provenance
    without raw vectors, acquisition, anchor semantics, composition reservoir,
    residual capacity/backfill and final planner outcome.
21. Bitácora v4 renders that trace natively as concise product decisions: a
    product person can understand the flow without rule IDs, while technical
    details/evidence/raw diagnostics remain available on demand.
22. Frontend acceptance verifies covered/uncovered facets, acquisition reason,
    anchor semantics, initial selection/reservoir, backfill, selected/unselected
    reasons and final planner feasibility in the primary Bitácora.
23. Full backend + relevant frontend deterministic matrix is green.
24. The merged preference-first core is recorded as Phase 7 CLOSED; Argentina
    live smoke then gates convergence to the unified agent branch.

---

# Execution order summary

```text
Checkpoint A
  PreferenceSpec / anchors / builder
  facet>=1 + global initial portfolio sufficiency
  canonical per-facet retrieval (NO embedding coverage)
  evidence-backed exploration signals + deterministic ranking tilt
        ↓
Checkpoint B
  evidence preservation
  classifier + correct reuse predicate
  quality incl. composite components
  metadata convergence without fake dimensions
  area-walk acquisition
        ↓
Checkpoint C
  explorationSignals + explorationTilt (ranking only)
  embedding-backed semanticSimilarity (ranking only)
  weighted deterministic initial composition + ranked reservoir
  soft vs must anchor semantics
  planner preferenceWeight + pinned must placement
  duration-aware reservoir backfill + bounded capacity-driven acquisition
  overlap
  trace v4 machine contract
  product-readable Bitácora v4
        ↓
Checkpoint D
  live orchestration cutover + convergence loop
  cold-catalog + large-corpus E2E
  delete superseded flow
  truthful classifier eval
  BA live characterization
  full backend/frontend verification → merge → Phase 7 CLOSED
  Argentina smoke → Integration Gate
```
