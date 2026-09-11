# Preference-First Selection & Tour-Agent Convergence — Design

Status: **canonical design decision record. Docs-only. Not authorization to implement.**
Branch of record: `feat/experience-domain-v2` (this doc travels to the future refactor / integration branch).
Written: 2026-09-10. Canonical corrections incorporated: 2026-09-11.

Related:
- `docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md`
- `docs/superpowers/characterization/2026-09-10-preference-first-buenos-aires-dry-run.md`
- `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`
- `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`
- `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`

> **This document does not authorize implementation.** It records the canonical
> preference-first design and the decisions that the implementation plan must
> follow. It does not merge branches, touch `feat/agentic-travel-planning`, add
> Activities / Events / Operational Stops, or make an LLM authoritative for
> geography, dedupe, persistence, ranking, or scheduling.

---

## 1. Problem

The current live tour-generation path begins from a broad geographically-near
catalog pool and only applies user preferences late as ranking bonuses. That is
structurally wrong for the product we are building: irrelevant inventory can
occupy the bounded candidate window before a relevant Experience is ever seen,
coverage can be inferred from weak or accidental text, and the planner receives
candidates whose relationship to the user's actual request is already diluted.

The replacement is **preference-first selection**:

```text
user request
  ↓
PreferenceSpec
  ↓
retrieve the catalog per real requested facet + resolve named anchors
  ↓
measure facet coverage + global portfolio sufficiency
  ↓
acquire only for missing knowledge
  ↓
corroborate / resolve identity / classify evidence / persist
  ↓
re-retrieve canonical Experiences
  ↓
deterministic composition
  ↓
deterministic daily planner + feasibility
```

The catalog remains cumulative shared knowledge. Acquisition that discovers a
valid Experience persists it even when it is not selected for the current Tour.
Sufficiency only stops unnecessary provider calls for the current request; it
never discards valid knowledge.

---

## 2. Architectural invariants

1. **Preference-first, not catalog-first.** Retrieval starts from requested
   facets and anchors, not from a globally ranked nearby pool.
2. **One matching primitive.** A `(dimension,key)` match is decided only by
   `candidateMatchesPreferenceFacet` (or its eventual canonical successor).
   Names/descriptions/diagnostic blobs are never keyword-scanned as a second
   hidden semantic engine.
3. **LLM classification is evidence-only.** User preferences never appear in
   the semantic-classification prompt.
4. **LLM never establishes identity/geography.** Coordinates, provider IDs,
   component identity and geographic truth come from the resolver / Places /
   OSM / deterministic validation.
5. **No invented Experience composition.** The planner may not join nearby
   POIs into a fake route or walk. Multi-component Experiences require evidence
   that the Experience exists and evidence for every real component.
6. **Deterministic composition and planning.** Identical PreferenceSpec +
   identical canonical catalog → identical composition and planner inputs.
7. **No bare AREA/ROUTE as a schedulable Experience.** A selectable Experience
   has at least one resolved `ExperienceComponent` with real geography.
8. **Catalog is reusable knowledge.** Discover → validate → classify →
   canonicalize → persist → re-retrieve → compose.
9. **Hard feasibility always wins.** Even a user `must` anchor cannot force the
   solver to violate opening hours, day capacity, mobility or geography.

---

## 3. Canonical `PreferenceSpec`

```ts
interface RequestedFacet {
  dimension: string;       // theme | intent | trait | supported structured dimensions
  key: string;
  weight: number;          // importance × confidence, normalized 0..1
  source: 'wizard' | 'free_text';
  required: false;         // positive facets remain soft in v1
}

interface AnchoredPlace {
  rawName: string;
  kind: 'venue' | 'area' | 'route' | 'unknown';
  priority: 'soft' | 'must';
}

interface PreferenceSpec {
  facets: RequestedFacet[];
  exclusions: {
    themes: string[];
    traits: string[];
    hard: string[];
  };
  anchors: AnchoredPlace[];
  semanticQuery: string;

  // IMPORTANT: a meta-preference, not a RequestedFacet.
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
```

### 3.1 `explorationStyle` is NOT a facet

This is a canonical correction and must not regress.

`exploration_style`:
- is not inserted into `PreferenceSpec.facets`;
- is not retrieved as a facet;
- is not part of the sufficiency denominator;
- never produces an acquisition deficit;
- never appears in `unmetFacets`;
- never asks the classifier to emit `tourism_intensity:iconic` or similar.

It is a **within-facet / remainder-fill ranking tilt** driven by deterministic
`iconicity` and grounded local-character evidence where available:
- `iconic` biases toward higher iconicity;
- `local_deep_dive` biases toward lower iconicity plus explicit grounded
  local/authentic/traditional signals;
- `balanced` adds no tilt.

There is no valid code path `FacetRouter → acquire exploration_style`.

---

## 4. Stage 1 — interpretation and anchors

Wizard fields and the free-text interpreter merge into `PreferenceSpec`.
Duplicate facets collapse by `(dimension,key)` and keep the strongest weight.
Exclusions are kept separate from positive facets.

The interpreter also extracts concrete named anchors, conservatively.

### D3 — `must` anchor semantics — RESOLVED

`must` exists in v1.

The interpreter emits `priority: must` only for explicit, unambiguous intent,
for example:
- “quiero visitar X”;
- “incluí X”;
- “sí o sí quiero ir a X”;
- “no me quiero perder X”.

Weak wording or ambiguity defaults to `soft`.

Semantics:
- venue + `soft` → **strong inclusion tilt**, not guaranteed inclusion;
- venue + `must` + resolved + feasible → hard include;
- venue + `must` + unresolved → `unmetAnchor{reason: UNRESOLVED}`, tour continues;
- venue + `must` + resolved + infeasible → `unmetAnchor{reason: INFEASIBLE}`, tour continues;
- area/route anchors are boundaries/scopes, never direct selected stops.

A soft anchor MUST NOT be pushed into `anchorsForced` or `mustInclude`.

---

## 5. Stage 2 — destination resolution

Unchanged. Destination identity and geographic scope remain deterministic and
provider-grounded.

---

## 6. Stage 3 / Stage 8 — per-facet catalog retrieval

For each **real** `PreferenceSpec.facets[]` entry, retrieve verified canonical
Experiences in geographic scope. Retrieval should reuse
`ExperienceCatalogService` geography/hydration boundaries rather than invent a
second raw-Prisma bounding-box implementation with arbitrary truncation.

For each Experience:
1. reject bare/no-component rows from composition eligibility;
2. evaluate the facet with the one canonical matching primitive;
3. evaluate strong-vs-weak match;
4. order matches within that facet deterministically.

### 6.1 Strong match

For acquisition/sufficiency purposes, a strong match means:
- `candidateMatchesPreferenceFacet(experience, facet) === true`;
- at least one resolved component with real geography;
- classification/evidence grounding is not known-thin;
- `qualityScore >= QUALITY_FLOOR` (policy, initially 3.0/5);
- it is not already obviously impossible for the trip (for facts available at
  this stage, such as a duration exceeding the whole planning window).

Exact final opening-hours / routing feasibility remains Stage 10's authority.
A weak match may still be useful for ranking or enrichment but does not by
itself stop targeted acquisition for a missing facet.

### 6.2 Canonical sufficiency model — GLOBAL portfolio target

This is a canonical correction and must not regress.

**Facet satisfaction:**

```text
facetSatisfied(f) = strongMatches(f) >= 1
```

v1 reserves one strongest strong match per requested facet when available:

```text
reservedPerFacet = 1
```

**`days × pace` is NOT required per facet.** It is the desired total portfolio
capacity for the trip:

```text
paceFactor(relaxed)  = 3
paceFactor(moderate) = 4
paceFactor(fast)     = 5

basePortfolioTarget = clamp(days, 1, 14) × paceFactor
```

The actual composition target is at least large enough to hold distinct facet
reservations and resolved must anchors:

```text
portfolioTarget = max(
  basePortfolioTarget,
  distinctReservedStrongMatches + distinctResolvedMustVenueAnchors
)
```

Overall knowledge is sufficient when:

```text
allRequestedFacetsHaveAtLeastOneStrongMatch
AND
totalDistinctEligibleExperiences >= portfolioTarget
```

Consequences:
- 5 days × moderate ≈ 20 Experiences TOTAL, not 20 history + 20 food + ...;
- one Experience may satisfy multiple facets;
- one multi-facet Experience does not by itself satisfy a multi-day portfolio;
- acquisition is targeted first at uncovered facets, then only at genuine
  global capacity shortage if the portfolio is still too thin;
- `explorationStyle` never participates in sufficiency.

---

## 7. Stage 4 — targeted acquisition

Acquisition runs only where the current request has a real knowledge deficit.
The agent is not involved yet; this is deterministic preference-first core.

For an uncovered facet:

```text
facet deficit
  ↓
ExperienceAcquisitionPlanner
  ↓
source-capability routing
  ↓
Wikivoyage / OSM / Places / Web
  ↓
SourceObservations
```

For a global capacity shortage after every facet is covered, acquisition may
continue using the highest-weight facets / broad destination sources, bounded by
existing acquisition pass and provider budgets. It must not call providers only
to inflate the catalog after the request is already sufficient.

Places invariant remains unchanged: generic restaurant/cafe/bakery/bar/
night_club rows do not automatically originate tourism Experiences.

### D5 — area/route anchor + walk/route intent — RESOLVED

When an `area`/`route` anchor is combined with `intent:walk` or `route_like`:
1. **reuse first:** look for a compatible persisted multi-component Experience
   whose components/geography belong to that scope;
2. if absent, acquire evidence for a real walk/route Experience;
3. represent it as a normal `Experience` with normal `ExperienceComponent`s;
4. resolve every component through the normal Places/OSM resolver path;
5. never invent stops or coordinates;
6. `ExperienceComponent.order` is non-null only when cited evidence explicitly
   establishes the visiting sequence; otherwise it stays `null`;
7. insufficient evidence means no fabricated walk; surface normal unmet/weak
   coverage;
8. persist successful acquisitions so later requests reuse them.

There is **no `NEIGHBORHOOD_WALK` structural type** in Experience Domain V2.

A `must` area/route anchor means acquisition of the corresponding grounded
walk/route is high priority; the AREA/ROUTE itself is still never scheduled.

---

## 8. Stage 5 — identity and corroboration

Unchanged in authority: corroboration, resolver, geographic validation and
dedupe decide real-world identity before semantic classification.

Evidence from multiple providers is merged into one provider-neutral bundle.
If it maps to an existing Experience, the existing row is enriched instead of
duplicated.

Provider order must not erase richer metadata. Metadata merge semantics must be
order-independent for union-valued semantic arrays and conservative for scalar
facts.

---

## 9. Stage 6 — evidence-only semantic classification

Model for v1: Groq `qwen/qwen3.8-27b`, temperature 0, with Gemini grounded/model
fallback only where the existing AI abstraction explicitly supports it.

Classification input is evidence only. It emits:
- canonical `themes[]`;
- canonical `intents[]`;
- concise open-ended `traits[]`;
- claim/facet-to-`evidenceKey` reasoning provenance;
- model id + prompt version.

It does **not** emit user-specific preferences or `dimensionedFacets` in v1.

### 9.1 Trait semantics — no invented dimensions

Freeform classifier traits remain freeform traits. The classifier does not
return a dimension taxonomy for them in v1, so persistence MUST NOT invent one
such as `tourism_intensity` merely from the string `iconic`.

Until a closed trait-dimension taxonomy exists:
- persist freeform classifier traits as strings / the existing general trait
  representation;
- preserve explicit structured dimensions only when a trusted source already
  supplied them as explicit dimensioned evidence;
- do not use classifier traits to manufacture `exploration_style` coverage.

`explorationStyle` uses the deterministic iconicity/local-character tilt from
§3.1 instead.

### D1 — critical-path classification — RESOLVED

For a genuinely new/unclassified bundle, v1 classifies sequentially, one bundle
at a time, before composition. Use bounded retry/backoff on `429`. Do not batch
or parallelize in v1. Do not ship a knowingly thin first tour and fix it later.

### D2 — reuse/caching — RESOLVED

No separate classification cache table and no `AiCacheService` dependency.
Reuse is catalog-native.

**Do not skip classification merely because `experienceId` exists.** Reuse is
valid only when the matched catalog Experience carries a reusable classification
for the current classifier contract, e.g.:

```text
metadata.classification exists
AND
metadata.classification.prompt_version == CURRENT_PROMPT_VERSION
AND
classification payload passes the deterministic shape/normalization guard
```

Then Stage 6 is skipped and the persisted classification is reused.

If an existing Experience is missing classification or its `prompt_version` is
stale, Stage 6 may classify/reclassify it from available evidence and persist
the new classification. Batch reclassification remains a direct Prisma query on
`metadata.classification.prompt_version`, not a second cache subsystem.

Accepted race: two simultaneous discoveries of the same brand-new entity may
both classify before `pg_advisory_xact_lock` dedupes persistence. The duplicate
LLM call is harmless.

On classifier failure, persist/degrade with empty semantic arrays and mark the
classification state so a later reclassification job can repair it. Failure is
not fatal to the tour.

---

## 10. Stage 6c — quality and iconicity

### 10.1 `qualityScore`

One scale: `0..5`, stored on `Experience.qualityScore`. It is computed from
provider evidence and applied **once** by the planner's quality weight.

Signals can include:
- Places rating + review-count confidence;
- Wikivoyage-listed;
- Wikidata sitelink/notability signals;
- for a multi-component Experience with no direct rating: quality/notability of
  its resolved components.

A route/walk MUST NOT become weak solely because the composite itself has no
Places rating. Aggregate component signals deterministically (policy-defined,
for example a robust mean/top-component blend) and combine with WV/WD signals.
If neither the Experience nor its components have usable signals, quality is
`null`; it remains weak rather than receiving a magic default.

### 10.2 `iconicity`

Separate `0..1` deterministic score used only as the exploration-style tilt.
Possible signals:
- log-normalized Places review count;
- Wikidata sitelink count;
- Wikivoyage listing;
- OSM heritage tag;
- future measured appearance in multiple independent “top things to do” lists.

Quality and iconicity are different concepts and must not be conflated.

---

## 11. Stage 7 — persistence and re-retrieval

Every valid newly resolved Experience is persisted through the one canonical
catalog path. Existing rows are enriched, not duplicated. Then Stage 8
re-runs per-facet retrieval against persisted canonical state.

Persistence must preserve:
- classification payload + prompt/model version;
- themes/intents/traits without invented trait dimensions;
- qualityScore;
- component evidence and order semantics;
- provider evidence/provenance;
- idempotent canonical dedupe semantics.

---

## 12. Stage 9 — deterministic composition

Composition consumes the union of all per-facet strong candidates plus resolved
anchors and builds a portfolio for the deterministic planner.

### 12.1 Eligibility

Drop before matching:
- hard-excluded candidates;
- rows with no resolved components;
- bare AREA/ROUTE representations;
- candidates outside required destination/geographic scope.

### 12.2 Reservation

For each requested facet with >=1 strong candidate, reserve exactly the
strongest match in v1 (`reservedPerFacet = 1`). The same Experience can reserve
multiple facets.

Within-facet ordering is deterministic and considers, in order:
1. facet match strength / grounding confidence;
2. requested facet weight;
3. semantic similarity where applicable;
4. quality;
5. exploration-style iconicity/local tilt;
6. diversity / stable id tie-break.

A single dominant monothematic Experience therefore cannot be displaced merely
because another weaker Experience covers more facet labels.

### 12.3 Anchors

- resolved venue `must` → add to selected set and mark `mustInclude`;
- unresolved venue `must` → `UNRESOLVED`;
- resolved venue `soft` → add a strong deterministic **anchor boost** to its
  composition ordering; do not force it;
- area/route anchors never become direct selected rows.

### 12.4 Remainder fill to the GLOBAL portfolio target

After reservations and must anchors, fill until `portfolioTarget` (§6.2).
Remainder priority is based on **weighted preference coverage**, not raw facet
count alone:

```text
weightedCoverage(c) = sum(weight(f) for each requested facet satisfied by c)
```

Then use similarity, quality, exploration tilt, diversity and stable id tie
breaks. Multi-facet Experiences are valuable because they cover more weighted
user intent, not because “facet count” is privileged regardless of weight.

Composition never uses `days × 4` as a hard-coded target; it calls the one
canonical `portfolioTarget(days, pace, reservations, mustAnchors)` helper.

---

## 13. Stage 10 — deterministic planner

The existing deterministic solver remains final scheduling authority.

`PlanningExperienceCandidate` gains:
- raw `qualityScore` (`0..5`);
- `preferenceWeight` derived from requested facets the Experience satisfies;
- `mustInclude` for resolved must venue anchors only.

Planner soft score adds a preference term exactly once. Quality is also weighted
exactly once.

Must candidates get a pinned placement pass before normal greedy competition,
but every hard feasibility constraint still applies. A must candidate rejected
by genuine hard feasibility becomes `unmetAnchor: INFEASIBLE` and the rest of
the tour continues.

Local improvement may not evict an already placed `mustInclude` candidate.

Positive non-must facets remain preferences rather than hard scheduling
constraints; the composition portfolio and preference term make their relevance
survive into final placement without making an ordinary preference fatal.

---

## 14. Stage 11 — trace and async enrichment

Generation trace v4 must explain:
- normalized PreferenceSpec (with explorationStyle separate from facets);
- per-facet strong/weak candidates;
- facet satisfaction (`>=1 strong`);
- **global** portfolio target/current distinct count;
- targeted acquisition reasons;
- providers/queries/evidence;
- classification provenance + whether reused / classified / degraded;
- composition reservations and remainder fill;
- soft-anchor boost vs must-anchor forcing;
- unmet facets and unmet anchors;
- planner placements/unselected reasons.

No trace field may itself become input to matching.

Existing async media/enrichment remains separate and unchanged by this refactor.

---

## 15. Testing strategy

### Unit

Prove:
- PreferenceSpec never puts exploration style in `facets`;
- `facetSatisfied == strongCount >= 1`;
- portfolio target is days×pace globally;
- soft anchors are not forced;
- must anchors are forced only when resolved and feasible;
- classification reuse requires a current valid classification;
- freeform traits do not fabricate dimensions;
- composite quality derives from component signals;
- weighted remainder coverage respects facet weights;
- deterministic deep-equal composition.

### Integration — real Postgres

Prove:
- per-facet retrieval goes through canonical catalog geography/hydration and is
  deterministic with >500 rows;
- classify → persist → re-retrieve preserves classification, quality and traits;
- provider-order metadata merge converges;
- stale/missing classification reclassifies rather than incorrectly skipping;
- area-walk first acquisition persists and second request reuses the same
  Experience id.

### E2E / acceptance

Use large competing catalogs (hundreds of Experiences) and prove:
- every requested facet has at least one strong candidate before composition;
- total composition size targets the global days×pace capacity, not per facet;
- changing one preference changes the composed set predictably;
- hard exclusions win;
- soft anchor can win via boost but is allowed to lose;
- must anchor resolved+feasible appears in final scheduled Tour;
- must anchor unresolved/infeasible is surfaced with the exact reason;
- bare AREA/ROUTE never leaks into selected Experiences;
- route/walk acquisition uses grounded multi-component evidence.

### Live

Formalize the Buenos Aires cold-catalog probe with real providers. Live tests
must not redefine deterministic acceptance semantics; they validate provider
reality and evidence quality.

---

## 16. Phase / branch semantics — D4 RESOLVED

Preference-first is **not Phase 8**. It is the correction/finalization of the
Phase 7 live orchestration.

Definition:

```text
Phase 7 CLOSED = preference-first core stable + acceptance green
```

Sequence:
1. implement on `feat/preference-first-selection` created from the current
   `feat/experience-domain-v2`;
2. preference-first unit/integration/e2e/acceptance matrix green;
3. merge back to `feat/experience-domain-v2` → Phase 7 CLOSED;
4. run the Argentina live smoke against the merged ref;
5. if live smoke is acceptable, cross the Integration Gate into
   `feat/unified-agentic-travel-planning`.

The Argentina live smoke is a **post-closure integration gate check**, not a
second contradictory definition of Phase 7 closure.

---

## 17. Resolved design decisions

### D1 — classification critical path
Sequential per new/unclassified bundle, bounded retry/backoff on 429. No v1
parallel/batch optimization.

### D2 — classification reuse
No separate cache. Reuse current valid `metadata.classification`; classify an
existing row if missing/stale. No `if (experienceId) skip` shortcut.

### D3 — anchor `must`
Allowed in v1, conservatively. Must+resolved+feasible hard includes; unresolved
and infeasible are surfaced, never fatal. Soft is a strong tilt only.

### D4 — phase semantics
Preference-first closes Phase 7; no Phase 8. Acceptance green + merge closes it;
Argentina live smoke gates convergence.

### D5 — area/route walk
Acquire/reuse a normal grounded multi-component Experience in v1. No
`NEIGHBORHOOD_WALK` type, no bare AREA/ROUTE scheduling, no invented sequence.

---

## 18. Explicit non-goals

This refactor does not add:
- Activities;
- Events;
- OperationalStop / TourStop;
- autonomous deep research / site crawl/map/extract orchestration;
- long-term personal taste memory;
- a new schema solely for classification caching;
- LLM geographic truth;
- LLM dedupe;
- dimensioned-facet emission from the semantic classifier;
- a new structural Experience kind for walks/routes.

Those belong to the target architecture / post-gate roadmap after this core is
stable.

---

## 19. Final invariant

Not:

```text
nearby catalog → global score → truncate → hope preferences survive
```

Not:

```text
one days×pace quota PER preference
```

Target:

```text
PreferenceSpec
  → per-real-facet canonical retrieval
  → >=1 strong match per requested facet
  → global days×pace portfolio sufficiency
  → targeted acquisition only where needed
  → evidence-only classification + canonical persistence
  → deterministic weighted set-cover composition
  → deterministic feasible planning
```
