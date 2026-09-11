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
3. `days × pace` is a **GLOBAL portfolio target**, never a quota per facet.
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

---

## 1. Target shapes and helpers

### New files

- `be/src/modules/tours/interfaces/preference-spec.interface.ts`
- `be/src/modules/tours/utils/preference-spec-builder.util.ts`
- `be/src/modules/tours/utils/preference-sufficiency.util.ts`
- `be/src/modules/tours/services/facet-retrieval.service.ts`
- `be/src/modules/tours/utils/iconicity.util.ts`
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
  selected: string[];
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

# Checkpoint A — PreferenceSpec, sufficiency, retrieval, iconicity

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

Integration test with real Postgres:
- seed >500 Experiences so retrieval proves a relevant row is not lost by an
  arbitrary first-500 truncation;
- one strong history Experience is enough to mark history satisfied;
- a name containing “history” with no history facet does not match;
- bare/no-component rows never become strong.

## A7 — Iconicity util

Create deterministic `computeIconicity(): 0..1` from available measurable
signals (review count, Wikidata sitelinks, Wikivoyage-listed, OSM heritage).

This value is used only for exploration-style ranking tilt. No acquisition or
coverage code consumes `explorationStyle` as a facet.

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
  iconicity: number;
  semanticSimilarity: number;
  groundingStrength: number;
  matchesHardExclusion: boolean;
  softAnchorBoost: number;
  isPerformanceVenue: boolean;
}
```

`softAnchorBoost > 0` only for resolved soft venue anchors. It is a ranking
signal, not a forced selection bit.

## C2 — Canonical weighted set-cover composition

Create `composition-set-cover.util.ts`.

Algorithm:

1. Drop hard-excluded / no-component / out-of-scope candidates.
2. Process venue `must` anchors:
   - unresolved => `UNRESOLVED`;
   - resolved eligible => put in selected and record `mustAnchorsForced`.
3. For each requested facet, reserve exactly one strongest strong match if not
   already covered by a selected candidate.
4. Compute **global** portfolio target using the A4 helper.
5. Fill remainder until portfolio target (or candidates exhausted).
6. Recompute final per-facet coverage/unmet facets.

Within-facet strength should prioritize:
- grounding/match strength;
- requested facet weight;
- semantic similarity;
- quality;
- exploration-style tilt;
- soft anchor boost;
- diversity/stable id tie break.

Remainder fill uses:

```text
weightedCoverage(c) = Σ requestedFacet.weight for each requested facet c satisfies
```

Then similarity / quality / exploration tilt / soft-anchor boost / diversity /
stable id.

Do not use raw facet count as the primary objective.
Do not hardcode `days * 4`; call the canonical portfolio-target helper.

Required unit cases:
- 5 moderate days targets 20 total candidates, not 20 per facet;
- one strong history match reserves history;
- monothematic strongest tango-performance venue survives even if a weaker
  candidate covers 3 labels;
- weighted two-low-priority facets do not automatically beat one high-priority
  facet;
- hard exclusions drop before reservation;
- bare AREA/ROUTE/no-component candidate cannot cover anything;
- soft venue anchor can be selected because of boost but is allowed to lose;
- must venue anchor is forced;
- unresolved must → exact UNRESOLVED;
- deterministic deep equality on repeat.

## C3 — ExperienceCompositionService

Thin service that:
- unions candidate IDs returned from facet retrieval plus resolved anchors;
- hydrates canonical rows through catalog service / deterministic Prisma lookup;
- computes satisfied facets only with the canonical matching primitive;
- computes weighted preference coverage;
- computes soft anchor boost;
- calls pure `composeSet`.

No second semantic engine.

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
- composition reservations;
- soft anchor boosts;
- must anchors forced;
- unmet facets / anchors;
- planner outcome.

Delete JSON-string keyword theme matching from trace generation.

Trace v4 is the machine/audit contract. Do not shape backend trace fields around
current frontend widgets. Preserve enough structured information for the UI to
produce concise human summaries while technical details remain exact.

Required trace tests:
- `version === 4` for the new path;
- `explorationStyle` is separate from facets;
- each facet exposes strong/weak counts and satisfaction;
- acquisition records exact deficit/reason and sources/queries/evidence;
- classification records reused/classified/degraded and evidence keys;
- composition records reservations, selected/unselected reason data and anchors;
- planner records placement/unselected feasibility reasons;
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
- global target;
- sufficient/not sufficient;
- whether the deficit is facet coverage or global capacity.

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
- global target;
- facets covered;
- reservations;
- soft-anchor boosts;
- must anchors;
- selected count;
- final decision.

Planner must show:
- days;
- placed Experiences per day / total;
- hard conflicts or feasibility failures;
- must placement result;
- final feasible/degraded outcome.

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
- composition displays global target and selected count;
- a selected and an unselected Experience have concise human reasons;
- planner displays feasibility/result;
- primary view does not require a `ruleId` or `reasonCode` to understand any
  decision;
- expanding technical details still exposes the underlying rule ID/evidence/raw
  debugging data;
- product copy remains compact: no stage renders a long narrative paragraph for
  information already represented as metrics/status/decision.

Acceptance criterion:

> A product person must be able to scan only titles, metrics and decision lines
> and correctly explain what the traveler wanted, what was covered, what was
> missing, why research ran, what was selected and why, and whether the final
> itinerary is feasible — without interpreting a rule ID, enum or service name.

### Checkpoint C verification

Run pure composition tests, solver unit/acceptance tests, overlap tests, trace
v4 tests, frontend Bitácora tests/Playwright, backend/frontend typecheck and
relevant lint. Do not enter Checkpoint D with C7 green but C8 unimplemented.

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
6. compute global portfolio sufficiency;
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
8. compose weighted deterministic portfolio;
9. normalize planner candidates with preferenceWeight/mustInclude;
10. deterministic solver + feasibility;
11. map infeasible must anchors;
12. materialize + trace.

Do not call acquisition for exploration style.
Do not stop after “N candidates per facet”; only facet>=1 + global capacity can
stop acquisition.

Register new services in `tours.module.ts`.

## D2 — Cold-catalog E2E

Create `experience-selection-preference-first.e2e-spec.ts` with real Postgres and
faked external transports.

Required cases:
- history+architecture one-day request: both facets covered by grounded
  Experiences;
- total composition target follows global pace target;
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
- composition size aims at global portfolio target;
- a facet delta changes selected IDs;
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
- selected rows are grounded Experiences with components;
- San Telmo polygon itself is not scheduled;
- any acquired walk is multi-component and grounded;
- classification provenance exists for newly classified Experiences;
- the generated v4 trace can be rendered by the product Bitácora with the same
  coverage/acquisition/composition/planner decisions visible without raw codes.

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
- any `exploration_style` coverage routing;
- any per-facet `days×pace` quota;
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
3. `days×pace` is used exactly once as the global base portfolio target.
4. Per-facet acquisition runs only for uncovered facets; global capacity refill
   happens only after facet coverage and only while capacity is short.
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
13. Composition uses one reservation per facet + weighted remainder fill to the
    global portfolio target.
14. Planner receives raw quality once and preferenceWeight once.
15. Large-corpus e2e proves preference deltas change the best selected set.
16. Trace v4 explains facet coverage, global sufficiency, classification reuse,
    acquisition, anchor semantics, composition and planner outcome.
17. Bitácora v4 renders that trace natively as concise product decisions: a
    product person can understand the flow without rule IDs, while technical
    details/evidence/raw diagnostics remain available on demand.
18. Frontend acceptance verifies covered/uncovered facets, acquisition reason,
    anchor semantics, selected/unselected reasons and planner feasibility in the
    primary Bitácora.
19. Full backend + relevant frontend deterministic matrix is green.
20. The merged preference-first core is recorded as Phase 7 CLOSED; Argentina
    live smoke then gates convergence to the unified agent branch.

---

# Execution order summary

```text
Checkpoint A
  PreferenceSpec / anchors / builder
  facet>=1 + global portfolio sufficiency
  canonical per-facet retrieval
  iconicity
        ↓
Checkpoint B
  evidence preservation
  classifier + correct reuse predicate
  quality incl. composite components
  metadata convergence without fake dimensions
  area-walk acquisition
        ↓
Checkpoint C
  weighted deterministic composition
  soft vs must anchor semantics
  planner preferenceWeight + pinned must placement
  overlap
  trace v4 machine contract
  product-readable Bitácora v4
        ↓
Checkpoint D
  live orchestration cutover
  cold-catalog + large-corpus E2E
  delete superseded flow
  truthful classifier eval
  BA live characterization
  full backend/frontend verification → merge → Phase 7 CLOSED
  Argentina smoke → Integration Gate
```
