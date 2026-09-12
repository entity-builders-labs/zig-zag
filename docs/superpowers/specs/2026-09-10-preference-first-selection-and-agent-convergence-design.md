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
- `docs/superpowers/specs/2026-09-11-exploration-signals-design.md` (supplemental rationale for §10.2)

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
10. **Portfolio target is bootstrap breadth, not final itinerary cardinality.**
   `days × pace` estimates how broad the candidate portfolio should be before
   planning. Real Experience duration, travel time, opening hours and day
   windows determine how many Experiences are actually scheduled. The planner
   may consume additional ranked candidates when useful capacity remains.
11. **Embeddings rank; they do not establish truth or coverage.** Vector
   similarity may personalize ordering among already canonically eligible /
   matching Experiences, but it never creates a facet match, upgrades weak to
   strong, satisfies a facet, stops acquisition, bypasses exclusions/geography/
   identity/evidence, or overrides planner feasibility.
12. **Exploration style ranks; it is not Experience truth.**
   `PreferenceSpec.explorationStyle` is projected over independent grounded
   `prominence`, `tourismIntensity` and `localCharacter` signals. Unknown is not
   zero; low prominence is not local character; high prominence is not low
   quality; and `local_deep_dive` is never represented as `1 - prominence`.
   These signals may refine ordering only after eligibility/matching.

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

It is a **within-facet / remainder-fill ranking preference**. It is not a
standard tourism taxonomy and no Experience is categorically `iconic`,
`balanced` or `local_deep_dive`.

The ranking projection consumes independent grounded signals defined in §10.2:

```text
prominence
tourismIntensity
localCharacter
```

Semantics:
- `iconic` may positively weight **known prominence**;
- `local_deep_dive` may positively weight **explicit known localCharacter** and
  moderate/penalize **known high tourismIntensity**;
- low or unknown prominence alone provides no `local_deep_dive` bonus;
- `balanced` contributes an exactly neutral exploration tilt;
- any unknown signal is neutral, never silently coerced to zero.

There is no valid equality predicate
`experience.explorationStyle == preference.explorationStyle`, no valid
`localCharacter = 1 - prominence`, and no valid code path
`FacetRouter → acquire exploration_style`.

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

**Embedding/vector similarity and exploration signals are not part of this
predicate.** Neither semantic similarity, prominence, tourismIntensity,
localCharacter nor exploration tilt can make an Experience match a facet or make
a weak match strong. Per-facet retrieval, coverage and sufficiency remain
grounded in explicit classified/structured evidence plus the deterministic
strong-match policy above.

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
breadth before detailed scheduling:

```text
paceFactor(relaxed)  = 3
paceFactor(moderate) = 4
paceFactor(fast)     = 5

basePortfolioTarget = clamp(days, 1, 14) × paceFactor
```

The actual initial composition target is at least large enough to hold distinct
facet reservations and resolved must anchors:

```text
portfolioTarget = max(
  basePortfolioTarget,
  distinctReservedStrongMatches + distinctResolvedMustVenueAnchors
)
```

Overall **pre-planner knowledge** is sufficient when:

```text
allRequestedFacetsHaveAtLeastOneStrongMatch
AND
totalDistinctEligibleExperiences >= portfolioTarget
```

This condition means “we have enough grounded breadth to attempt planning without
more speculative provider calls.” It does **not** mean the final Tour must contain
exactly `portfolioTarget` Experiences. A4 intentionally ignores detailed
Experience duration, inter-Experience travel time, opening hours and the shape of
individual day windows; those facts become authoritative in Stage 10.

Consequences:
- 5 days × moderate ≈ 20 candidate Experiences TOTAL, not 20 history + 20 food + ...;
- one Experience may satisfy multiple facets;
- one multi-facet Experience does not by itself satisfy a multi-day portfolio;
- long Experiences may make the final scheduled count substantially lower than
  `portfolioTarget`;
- short Experiences may leave useful capacity after the initial portfolio is
  scheduled, so Stage 10 may consume additional candidates beyond the initial
  `portfolioTarget`;
- acquisition is targeted first at uncovered facets, then only at genuine
  global capacity shortage if the portfolio is still too thin;
- planner-discovered capacity shortage is a separate, later signal and may
  trigger bounded backfill/acquisition under D6;
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

A later **planner-discovered capacity deficit** is different from this pre-planner
portfolio shortage. If Stage 10 proves that meaningful usable time remains after
consuming the existing ranked reservoir, orchestration may run one or more
bounded targeted acquisition passes for that concrete residual capacity under
D6. That is demand-driven itinerary completion, not catalog inflation.

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

`explorationStyle` uses the independent evidence-backed exploration signals and
deterministic ranking projection from §10.2. Freeform classifier strings are not
silently promoted into those structured signals.

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

## 10. Stage 6c — quality and exploration signals

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

### 10.2 Evidence-backed exploration signals

A single scalar `iconicity` is **not** the canonical representation of
`explorationStyle`. Public prominence, tourism intensity and local cultural
character are independent concepts and may coexist in any combination.

Canonical model:

```ts
interface EvidenceBackedExplorationSignal {
  value: number | null; // normalized 0..1 when known
  confidence: number;   // normalized 0..1
  evidence: Array<{
    source: string;
    key: string;
    value?: string | number | boolean;
  }>;
  reasonCodes: string[];
}

interface ExplorationSignals {
  prominence: EvidenceBackedExplorationSignal;
  tourismIntensity: EvidenceBackedExplorationSignal;
  localCharacter: EvidenceBackedExplorationSignal;
}
```

Canonical distinctions:

```text
low prominence != local character
high prominence != low quality
unknown != zero
local_deep_dive != 1 - prominence
```

#### 10.2.1 Prominence

Prominence captures public notability/fame using measurable evidence such as:
- Places review count (count only; star rating belongs to quality);
- Wikidata sitelink count;
- Wikipedia presence;
- Wikivoyage listing;
- heritage/landmark evidence as a modest supporting signal.

Unbounded counts use deterministic saturating/log-like normalization so giant
counts do not dominate linearly. Missing sources lower available confidence;
they do not automatically assert a zero endpoint. With no meaningful prominence
evidence, `value:null`.

#### 10.2.2 Tourism intensity

Tourism intensity is **not inferred from popularity alone**. High review count or
high prominence does not prove mass tourism. A known value requires explicit
normalized grounded tourism-intensity evidence (for example a source explicitly
describing a tourist hotspot/circuit or future structured tourism-density data).
Without such evidence, `value:null`.

#### 10.2.3 Local character

Local character is **not inferred from obscurity**. Low review count, missing
Wikidata/Wikivoyage or low prominence does not establish that a place is local,
authentic or culturally valuable. A known value requires explicit normalized
grounded local-character evidence (for example a neighborhood institution,
traditional market, community cultural venue, local practice or explicit
“popular with locals” evidence). Without such evidence, `value:null`.

#### 10.2.4 Unknown semantics

`value:null` means insufficient grounded evidence. `value:0` means actual
grounded support for a low endpoint. Missing metadata is never silently coerced
to zero. Corrupt numeric inputs are deterministically ignored/clamped according
to policy and cannot create out-of-range values.

#### 10.2.5 Exploration-style ranking projection

A pure deterministic helper projects the traveler meta-preference over the known
signals:

```text
computeExplorationTilt(explorationStyle, ExplorationSignals)
```

The projection records its signal contributions/reason codes for auditability.

Rules:
- `iconic`: known prominence contributes positively; unknown prominence is
  neutral;
- `local_deep_dive`: known positive localCharacter contributes positively and
  known high tourismIntensity may moderate/penalize; low/unknown prominence
  alone gives no positive contribution;
- `balanced`: exact neutral contribution;
- no signal becomes a hard filter;
- no signal or tilt enters facet matching, strong/weak, sufficiency or
  acquisition decisions.

The detailed historical rationale remains in
`docs/superpowers/specs/2026-09-11-exploration-signals-design.md`; this section is
the canonical design authority used by the main implementation plan.

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
- provider evidence/provenance sufficient to derive exploration signals without
  fabricating missing evidence;
- idempotent canonical dedupe semantics.

A7 does not require a new opaque persisted iconicity column. If exploration
signals are ever cached/persisted later, their evidence/version provenance must
remain reconstructable; source evidence remains authoritative.

---

## 12. Stage 9 — deterministic composition

Composition consumes the union of all per-facet strong candidates plus resolved
anchors and builds an initial portfolio plus a deterministic ranked reservoir for
the planner.

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
5. evidence-backed exploration tilt from §10.2;
6. diversity / stable id tie-break.

Exploration tilt is computed only for already eligible candidates. It cannot
create factual coverage. `local_deep_dive` specifically cannot reward an obscure
candidate merely because its prominence is low or unknown.

A single dominant monothematic Experience therefore cannot be displaced merely
because another weaker Experience covers more facet labels.

### 12.2a Embedding-backed semantic similarity — D7 RESOLVED

`semanticSimilarity` is the user-specific fine-ranking signal for Experiences
that have already passed canonical eligibility/matching. In v1 it is backed by
vector similarity, not keyword matching and not an LLM judging candidates.

Canonical computation when data is available:

```text
queryVector = embed(PreferenceSpec.semanticQuery)
semanticSimilarity(experience) = cosineSimilarity(
  queryVector,
  Experience.embedding
)
```

Rules:
- generate at most **one query embedding per generation/composition context**
  from the non-empty positive `PreferenceSpec.semanticQuery`;
- reuse the persisted canonical `Experience.embedding` and its existing
  embedding metadata (`embeddingProvider`, `embeddingModel`,
  `embeddingDimensions`, `embeddingDocumentVersion`); do not add a parallel
  vector table/store for this feature;
- candidate and query vectors must be compatible for the active embedding
  contract before cosine similarity is trusted;
- composition MUST NOT call the embedding provider once per candidate and MUST
  NOT synchronously create missing/stale candidate Experience embeddings;
  catalog/enrichment owns candidate embedding generation/refresh;
- empty `semanticQuery`, missing candidate vector, stale/incompatible embedding
  metadata or an embedding-provider failure yields a deterministic neutral /
  unknown similarity for that candidate/context; ranking falls through to the
  next deterministic signals instead of failing tour generation;
- stale/missing Experience embeddings may be queued/marked for normal async
  enrichment, but that repair is not a prerequisite for the current Tour;
- vector similarity may affect within-facet ordering, weighted remainder fill
  and ranked-reservoir ordering only **after** canonical eligibility/matching;
- it never creates `candidateMatchesPreferenceFacet`, changes strong/weak,
  contributes to the sufficiency denominator, stops acquisition, bypasses a
  hard exclusion, proves geography/identity/evidence, or overrides planner
  feasibility.

This preserves the boundary: structured/evidence-backed semantics answer
“does this Experience really satisfy the requested facet?”, while embeddings
answer “among valid candidates, which one is closer to what this traveler
actually described?”.

### 12.3 Anchors

- resolved venue `must` → add to selected set and mark `mustInclude`;
- unresolved venue `must` → `UNRESOLVED`;
- resolved venue `soft` → add a strong deterministic **anchor boost** to its
  composition ordering; do not force it;
- area/route anchors never become direct selected rows.

### 12.4 Initial remainder fill to the GLOBAL portfolio target

After reservations and must anchors, fill the **initial** selected portfolio
until `portfolioTarget` (§6.2). Remainder priority is based on **weighted
preference coverage**, not raw facet count alone:

```text
weightedCoverage(c) = sum(weight(f) for each requested facet satisfied by c)
```

Then use semantic similarity, quality, evidence-backed exploration tilt,
diversity and stable id tie breaks. Multi-facet Experiences are valuable because
they cover more weighted user intent, not because “facet count” is privileged
regardless of weight.

Composition never uses `days × 4` as a hard-coded target; it calls the one
canonical `portfolioTarget(days, pace, reservations, mustAnchors)` helper.

Crucially, composition MUST NOT discard every eligible candidate after the first
`portfolioTarget` rows. It also exposes a deterministic **ranked reservoir** of
eligible, unselected candidates using the same preference-aware ordering. The
reservoir is available to Stage 10 when actual scheduling shows that short
Experiences leave meaningful usable capacity.

`portfolioTarget` therefore bounds the first planning attempt; it is not a hard
maximum on final Tour cardinality.

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

### 13.1 D6 — duration-aware backfill and bounded convergence — RESOLVED

`days × pace` is an initial candidate-breadth heuristic only. Stage 10 determines
final Tour cardinality from actual scheduling facts: Experience duration,
travel time, opening hours, daily windows, mobility constraints, already placed
must anchors and geography.

After the first planning pass:

1. compute **meaningful residual capacity** per day from the actual schedule;
2. if no useful capacity remains, stop — the final Tour may legitimately contain
   fewer Experiences than `portfolioTarget` when selected Experiences are long;
3. if useful capacity remains, consume the next best feasible candidates from
   the deterministic ranked reservoir produced by Stage 9;
4. re-run the affected planning pass deterministically; do not append a stop
   without re-checking travel/opening-hour/day constraints;
5. repeat while the schedule makes progress and a policy-defined meaningful gap
   remains;
6. if the reservoir is exhausted while meaningful capacity still remains,
   orchestration may emit a **planner capacity deficit** and run bounded targeted
   acquisition;
7. newly acquired valid Experiences follow the normal evidence → resolve →
   classify → persist → re-retrieve path before they can enter the reservoir;
8. recompose/replan after acquisition, bounded by explicit acquisition-pass and
   no-progress limits.

A planner capacity deficit should carry concrete scheduling context where
available, for example:

```text
day: 4
area/scope: Palermo
availableMinutes: 120
preferredFacets:
  - architecture: 0.9
  - local_food: 0.7
```

This context narrows retrieval/acquisition but never authorizes invention of an
Experience or coordinates.

The system does **not** optimize for filling every minute. Tiny/awkward gaps,
poor-quality filler, excessive travel or candidates that materially reduce
preference quality may be left unused. “Meaningful residual capacity” is a
policy decision; do not hardcode a universal minute threshold inside A4.

The convergence loop MUST terminate deterministically on at least one of:
- no meaningful residual capacity;
- no additional feasible reservoir candidate;
- no progress after an iteration;
- acquisition/provider budget exhausted;
- configured maximum backfill/acquisition passes reached.

This makes final cardinality an output of feasibility rather than an input quota.

---

## 14. Stage 11 — trace, product Bitácora and async enrichment

Generation trace v4 is the canonical machine-auditable record. It must explain:
- normalized PreferenceSpec (with explorationStyle separate from facets);
- per-facet strong/weak candidates;
- facet satisfaction (`>=1 strong`);
- **global initial** portfolio target/current distinct count;
- targeted acquisition reasons;
- providers/queries/evidence;
- classification provenance + whether reused / classified / degraded;
- exploration-signal provenance: known/unknown prominence, tourismIntensity and
  localCharacter; confidence/evidence/reason codes; and deterministic
  request-specific exploration-tilt contributions;
- embedding-backed semantic-ranking provenance: whether a semantic query existed,
  whether its query embedding was computed or neutral fallback was used, the
  non-secret provider/model/dimensions/document-version compatibility metadata,
  and per-candidate similarity score or neutral/fallback reason; never raw vector
  arrays;
- composition reservations, initial remainder fill and reservoir size;
- soft-anchor boost vs must-anchor forcing;
- unmet facets and unmet anchors;
- planner placements/unselected reasons;
- residual-capacity/backfill iterations, including whether extra candidates came
  from the reservoir or planner-triggered acquisition;
- initial selected count vs final scheduled count and convergence stop reason.

No trace field may itself become input to matching.

### 14.1 Bitácora v4 is a product decision surface, not a trace dump

The user-facing/debug Bitácora must render the v4 trace in two layers.

**Primary view — product-readable:**
- understandable without knowing code, service names, enums or rule IDs;
- each step should be scannable in roughly 10 seconds;
- one short sentence at most for the step purpose;
- 2–5 important metrics/results, preferably compact rows/chips/tables;
- one explicit decision/result line;
- technical internals collapsed by default.

Every primary step follows the same information hierarchy:

```text
Human-readable title
Purpose — one short line
Key results / metrics
Decision — one short line
[Candidates] [Rules] [Evidence] [Technical details]
```

The primary view MUST NOT become narrative prose. Avoid paragraphs that merely
retell the pipeline. If a value, status, compact table or short reason can convey
the information, prefer that over prose.

A product person looking only at titles, metrics and decisions must be able to
reconstruct:
1. what the traveler asked for;
2. what was already covered;
3. what was missing;
4. why acquisition ran;
5. what was accepted/rejected;
6. what was selected/unselected and why;
7. whether the final itinerary is feasible and what remains unmet.

**Technical details — engineering/audit:**
keep the full debugging material available behind expansion, including:
- internal stage/component/service names;
- rule IDs and reason codes;
- thresholds and actual/expected values;
- raw/normalized inputs and outputs;
- provider queries, URLs and evidence keys;
- prompts and raw/normalized model responses where already retained by trace
  policy, with secrets redacted;
- exploration-signal values/confidence/evidence/reason codes and exploration-tilt
  contribution breakdown;
- semantic-similarity scores and embedding contract metadata, but never raw
  embedding/vector arrays;
- score breakdowns, timings and persisted IDs.

The primary view must never require interpreting a code such as
`PREF_STRONG_MATCH_QUALITY_FLOOR` to understand the decision. Codes remain
stable engineering identifiers only.

### 14.2 Human rule rendering

Each deterministic rule that can appear in the primary Bitácora needs a short
human label and a concrete execution summary. Example:

```text
✅ Calidad suficiente
4.4/5 · mínimo 3.0
```

rather than:

```text
PREF_STRONG_MATCH_QUALITY_FLOOR
PASS · actual=4.4 · expected=3.0
```

The rule ID, exact comparator and raw inputs remain visible only in technical
details. Failed rules follow the same pattern, e.g. `Sin ubicación verificable`
with a one-line concrete reason rather than a bare reason code.

### 14.3 Canonical product-facing stages

The UI may group multiple machine trace steps where useful. The product-facing
flow should communicate these concepts, without exposing implementation names as
the headline:

1. **Qué viaje entendimos** — normalized preferences, anchors and constraints.
2. **Destino resuelto** — destination/scope and any relevant resolution result.
3. **Cobertura de preferencias** — per-facet strong/weak counts and covered/gap.
4. **Qué faltaba** — uncovered facets and/or global portfolio shortage.
5. **Búsqueda de nuevas opciones** — targeted acquisition objective, sources,
   found/verified/rejected counts.
6. **Verificación y clasificación** — identity/evidence/classification outcomes,
   including reused/classified/degraded counts.
7. **Selección de Experiences** — reservations, weighted fill, exploration tilt,
   soft/must anchors, initial target, reservoir and selected/unselected reasons.
8. **Armado del itinerario** — days, placements, residual capacity, backfill,
   feasibility/conflicts and must placement outcome.
9. **Resultado final** — final scheduled count, covered/unmet facets/anchors and
   final feasibility/status.

These are presentation concepts, not new orchestration stages. The trace remains
machine-oriented and may contain finer-grained steps.

### 14.4 Concise decision examples

Coverage should read like:

```text
Historia       3 strong · 2 weak   ✅ Cubierta
Arquitectura   1 strong · 4 weak   ✅ Cubierta
Tango          0 strong · 2 weak   ⚠️ Falta

Decisión: buscar nuevas opciones sólo para Tango.
```

Composition should read like:

```text
Objetivo inicial           12
Preferencias cubiertas     3/3
Reservadas por preferencia 3
Must anchors               1/1
Selección inicial          12
Reservoir elegible         8

Decisión: portfolio inicial listo; el planner puede consumir más si queda capacidad útil.
```

Planner/backfill can read like:

```text
Plan inicial               10 colocadas
Capacidad útil restante    150 min
Backfill desde reservoir   +1
Adquisición adicional      no
Plan final                 11 colocadas

Decisión: itinerario factible; sin capacidad útil relevante restante.
```

An unselected candidate should have a short human reason such as `preferencia ya
cubierta; otra opción aporta más peso/diversidad`, while exact scoring stays
collapsed.

Existing async media/enrichment remains separate and unchanged by this refactor.

---

## 15. Testing strategy

### Unit

Prove:
- PreferenceSpec never puts exploration style in `facets`;
- `facetSatisfied == strongCount >= 1`;
- exploration signals preserve independent `prominence`, `tourismIntensity` and
  `localCharacter` dimensions with `unknown != zero`;
- high prominence alone does not create tourismIntensity;
- low prominence/obscurity alone does not create localCharacter;
- `iconic` tilt responds to known prominence while unknown is neutral;
- `local_deep_dive` responds to explicit localCharacter and can moderate known
  high tourismIntensity but does not implement inverse prominence;
- `balanced` exploration tilt is exactly neutral;
- a non-matching Experience with vector similarity `0.99` still cannot cover a
  requested facet, become strong, or stop acquisition;
- among otherwise comparable canonically strong candidates, higher compatible
  embedding-backed semantic similarity wins at the documented similarity
  tie-break position;
- empty semanticQuery yields deterministic neutral similarity;
- missing/stale/incompatible candidate embedding yields deterministic neutral /
  unknown similarity without failing generation;
- composition never performs one embedding-provider call per candidate and never
  synchronously generates missing candidate embeddings;
- identical semanticQuery + compatible persisted vectors produce deterministic
  similarity/order on repeat;
- portfolio target is days×pace globally and represents initial breadth, not
  final itinerary cardinality;
- soft anchors are not forced;
- must anchors are forced only when resolved and feasible;
- classification reuse requires a current valid classification;
- freeform traits do not fabricate dimensions;
- composite quality derives from component signals;
- weighted remainder coverage respects facet weights;
- composition preserves a deterministic ranked reservoir beyond the initial
  portfolio target;
- deterministic deep-equal composition.

### Integration — real Postgres

Prove:
- per-facet retrieval goes through canonical catalog geography/hydration and is
  deterministic with >500 rows;
- classify → persist → re-retrieve preserves classification, quality and traits;
- provider-order metadata merge converges;
- stale/missing classification reclassifies rather than incorrectly skipping;
- grounded source metadata used by exploration-signal mapping preserves its
  provenance and missing evidence remains unknown rather than zero;
- persisted Experience embedding metadata is preserved/read consistently for
  composition similarity, with incompatible/stale metadata degrading to neutral
  rather than affecting coverage;
- area-walk first acquisition persists and second request reuses the same
  Experience id.

### E2E / acceptance

Use large competing catalogs (hundreds of Experiences) and prove:
- every requested facet has at least one strong candidate before composition;
- initial composition size targets the global days×pace breadth, not per facet;
- explorationStyle can reorder otherwise-comparable eligible candidates only
  through evidence-backed exploration signals without changing facet coverage;
- `local_deep_dive` never rewards obscurity/absence of evidence by itself;
- balanced exploration style is neutral;
- high vector similarity cannot rescue a non-matching/weak Experience into facet
  coverage;
- changing free-text semantic context can reorder otherwise comparable eligible
  Experiences through embedding-backed similarity without changing the factual
  facet-coverage result;
- long-duration Experiences can produce a valid final Tour with fewer scheduled
  rows than the initial portfolio target;
- short-duration Experiences can cause deterministic backfill from the ranked
  reservoir beyond the initial portfolio target when useful day capacity remains;
- when meaningful capacity remains and the reservoir is exhausted, bounded
  planner-triggered acquisition can add a grounded Experience and replan;
- tiny/awkward residual gaps do not force low-quality filler solely to consume
  time;
- the backfill/acquisition convergence loop stops deterministically on no
  progress/budget/pass limits;
- changing one preference changes the composed set predictably;
- hard exclusions win;
- soft anchor can win via boost but is allowed to lose;
- must anchor resolved+feasible appears in final scheduled Tour;
- must anchor unresolved/infeasible is surfaced with the exact reason;
- bare AREA/ROUTE never leaks into selected Experiences;
- route/walk acquisition uses grounded multi-component evidence;
- Bitácora primary view exposes covered/uncovered facets, acquisition decision,
  exploration-ranking explanation, initial composition decision, residual
  capacity/backfill and final planner result without requiring rule IDs;
- rule IDs, evidence and technical payloads remain available in expanded details;
- product-facing steps remain concise rather than duplicating raw trace prose.

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

### D6 — duration-aware planner backfill
`days × pace` is initial candidate breadth, never final Tour cardinality. The
planner decides final count from duration/travel/opening-hours/day feasibility,
consumes a deterministic ranked reservoir when meaningful capacity remains, and
may trigger bounded targeted acquisition only after that reservoir is exhausted.
Convergence stops on no useful capacity, no progress, exhausted budgets or pass
limits; the system never adds poor filler merely to occupy every minute.

### D7 — embedding-backed semantic ranking
`PreferenceSpec.semanticQuery` may produce one compatible query embedding for the
current generation/composition context. It is compared against persisted
canonical `Experience.embedding` vectors to produce `semanticSimilarity` for
fine ranking among already eligible/matching candidates. Missing/stale/
incompatible embeddings degrade deterministically to neutral/unknown similarity;
they never create coverage, strongness, acquisition sufficiency, factual truth or
planner feasibility. Candidate embedding creation/refresh remains catalog /
enrichment responsibility, not a per-candidate composition call.

### D8 — evidence-backed exploration-style ranking
`PreferenceSpec.explorationStyle` remains a traveler meta-preference rather than
an Experience taxonomy. Ranking consumes independent evidence-backed
`prominence`, `tourismIntensity` and `localCharacter` signals. Missing evidence
is unknown, not zero; low prominence never proves local character; tourism
intensity is not inferred from popularity alone; `local_deep_dive` is not inverse
prominence; `balanced` is neutral. The resulting deterministic tilt may reorder
already eligible candidates only and never participates in facet coverage,
sufficiency, acquisition or planner hard feasibility.

---
