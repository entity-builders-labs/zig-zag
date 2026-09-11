# Preference-First Selection & Tour-Agent Convergence — Design

Status: **canonical design decision record. Docs-only. Not authorization to
implement.** Branch of record: `feat/experience-domain-v2` (this doc travels to
the future refactor / integration branch).
Written: 2026-09-10. HEAD when written: `1aa6d10`.

Related:
- `docs/superpowers/characterization/2026-09-10-real-catalog-selection-semantics-characterization.md` — the G.1 characterization that motivated this (7 confirmed defects + architectural gaps A–F).
- `docs/superpowers/characterization/2026-09-10-preference-first-buenos-aires-dry-run.md` — the manual end-to-end probe of the flow described here, run against real providers for a cold Buenos Aires catalog.
- `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md` — the cross-cutting agent/core split this design plugs into.
- `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md` — the phase sequence + Integration Gate this design redefines (§8 below).
- `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md` — live status (Phase 7 A–G COMPLETE, H not started, Phase 7 not CLOSED).

> **This document does not authorize implementation.** It records the design so a
> future session does not re-derive it. It does not merge branches, does not
> change schemas beyond what §5 lists, does not touch `feat/agentic-travel-planning`,
> does not start Activities / Events / Operational Stops, and does not close or
> re-number any Phase. The implementation plan is a separate artifact produced
> by the writing-plans skill after this spec is approved.

---

## 1. Problem

The G.1 characterization proved, with real Rosario/Bahía Blanca bitácora
evidence and a 58-test suite, that **the engine's final Experience selection
does not respect the user's stated preferences**. The failures are in layers,
not one point:

- **Semantic representation gap.** Structured providers (OSM/Wikivoyage/Places)
  produce Experiences with `themes:[] traits:[] intents:[]` — the synthesizer
  hardcodes empty arrays. There is nothing to match a preference against.
- **Preference-semantics inconsistency.** Coverage, ranking and the bitácora
  use three incompatible definitions of "does this Experience satisfy theme X"
  (exact-facet vs accent-naive keyword scan vs `JSON.stringify(metadata)` scan
  that self-contaminates from injected diagnostics).
- **Ranking-boundary loss.** `preferenceScore` is an authoritative hard tier in
  `rankCandidatesByRelevance`, but `selectBoundedWindow` re-sorts the window by
  `totalScore` and the planner contract carries no preference field, so the
  greedy order and the day-placement soft score are preference-blind.
- **Quality signal gap.** Places `rating` is dropped at synthesis; `qualityScore`
  is never populated on the structured path; the normalizer double-attenuates.
- **Catalog convergence / identity.** `mergeMetadata` is provider-order-dependent
  (rich arrays → `[]` one way); the overlap filter drops the more
  preference-relevant candidate; obvious aliases land in `AMBIGUOUS`.
- **Specific user intent.** `exploration_style` cannot match anything from
  structured acquisition (it also silently dilutes `positiveRatio`); a
  free-text named place ("quiero visitar X") has no structured channel.

Root cause of the *shape*: the live flow is **catalog-first / geography-first** —
it pulls everything verified within a radius, then tries to filter/re-score by
preference late. Irrelevant content (stadiums, empty-metadata museums) is in the
pool from the start and only suppressed by scoring that G.1 showed is weak or
lost. "Preferences respected" is *emergent from the scoring*, not structural.

---

## 2. The reframe: preference-first retrieval

**The requested facets ARE the query.** For each `RequestedFacet` (and each
anchored place), the pipeline's job is: *find the best real, grounded,
classified, feasible Experiences that satisfy this specific facet, here.* Then
**compose** an itinerary that covers every requested facet.

| | Catalog-first (today) | Preference-first (this design) |
|---|---|---|
| What drives retrieval | geography (radius) | the requested facets |
| What enters the pool | everything nearby | only what matches a requested facet |
| Coverage | one keyword gate over a geo pool | per-facet sufficiency check |
| Acquisition | "generic deficit → fetch 20 things" | per-facet targeted routing |
| Selection | rank a big undifferentiated pool, slice top-15 | set-cover composition over per-facet candidate lists |
| "Preferences respected" | emergent from scoring (G.1: broken) | **structural** — the set is built to cover the spec |
| Irrelevant leaks | suppressed by score (leak when score is weak) | never retrieved |

This is the "aggressive" option from the design discussion. It restructures the
live orchestration: `CoverageAnalyzer` (monolith), `rankCandidatesByRelevance`
(pool sort) and `selectBoundedWindow` are replaced; the synthesizer is replaced
by a classification stage; the planner stays (with a preference term added).

---

## 3. The new flow — stage by stage, with external calls

Central principle: **identity, geography and persistence stay deterministic and
grounded; the LLM only classifies the meaning of already-grounded evidence and
interprets free text.** The LLM never establishes that a place exists or where
it is.

```
┌─ 0. REQUEST INTAKE ─────────────────────────────────────────  [no ext calls] ─┐
│  wizard: interests[], intents[], explorationStyle, additionalPreferences,     │
│          days, mobility, groupType, budgetLevel, startDates, destination      │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
┌─ 1. PREFERENCE RESOLUTION → PreferenceSpec (the query object) ───────────────┐
│  1a. interpret free text     ── LLM (Groq) ── ONLY if additionalPreferences  │
│      ≠ "". Output: preferredFacets (controlled vocab), exclusions,           │
│      anchoredPlaces[], positiveSemanticQuery. Deterministic regex fallback.  │
│  1b. merge wizard + interpreted                              [no ext call]    │
│      PreferenceSpec {                                                        │
│        facets: RequestedFacet[] { dimension, key, weight, source, required } │
│        exclusions: { themes[], traits[], hard[] }                           │
│        anchors: AnchoredPlace[] { rawName, kind, priority: soft|must }       │
│        semanticQuery: string                                                │
│        explorationStyle: iconic | local_deep_dive | balanced                │
│        softConstraints: { dietary, accessibility, budget, group }           │
│        trip: { days, startDates, mobility, pace }                           │
│      }                                                                      │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
┌─ 2. DESTINATION RESOLUTION ─────────────────────────────────────────────────┐
│  resolveDestination()  ── Geocoder (Google Places / Nominatim) ── 1 call     │
│                        ── Overpass (area polygon) ──             0-1 call     │
│  → { scale, center, boundary?, countryCode, radiusMeters }                   │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
                 ╔═══════════════════════════════════════╗
                 ║ embedding of semanticQuery            ║ ── Gemini ── 1 call
                 ║ reused by every facet below           ║
                 ╚═══════════════════╤═══════════════════╝
                                     ▼
┌─ 3. PER-FACET CATALOG RETRIEVAL ───────────────────────────  [DB only] ──────┐
│  FOR EACH facet f in spec.facets  (+ each anchor):                           │
│    3a. match: VERIFIED Experiences in scope whose STORED semantic profile    │
│        satisfies f  ── via the ONE match primitive (§5.2)                    │
│    3b. order within f: pgvector cosine(semanticQuery), then                  │
│        iconicity tilt (§5.4), then quality, then diversity                   │
│    3c. sufficiency: |feasible, quality-ok matches| ≥ target(days, pace)?     │
│  → FacetCandidates[] { facet, matches[], sufficient, deficitCount }          │
└───────────────────────────────────┬──────────────────────────────────────────┘
                     all sufficient ─┴─ YES ──────────────────────────┐
                                     │ NO for some facets             │
                                     ▼                                │
┌─ 4. TARGETED ACQUISITION (only insufficient facets) ───────────────┐│
│  FOR EACH insufficient facet:                                      ││
│    4a. route (dimension,key) → provider actions  (routing table)   ││
│    4b. call providers, bounded, per facet:                         ││
│        • Overpass (OSM)         ── per facet concept-set            ││
│        • Google Places search   ── per facet type-set + per anchor ││
│        • Wikivoyage (MediaWiki)  ── 1× per destination, cached      ││
│        • Tavily (Search Retrieval — we build the query) ── per facet││
│        • Wikidata narrative      ── per OSM feature with a QID      ││
│    4c. web prose → entity names  ── LLM Gemini flash-lite ──        ││
│        "names + evidenceKeys only", NO themes/classification       ││
│    4d. normalize → SourceObservation[]  (adapters, deterministic)  ││
│        adapters preserve: Wikivoyage sectionType, Places editorial,││
│        OSM wikidata narrative  (§5.5)                              ││
└───────────────────────────────────┬───────────────────────────────┘│
                                    ▼                                │
┌─ 5. IDENTITY + CORROBORATION ─────────────  [deterministic, grounded] ─┐│
│  5a. resolve components → real GeoEntity ── Places / OSM ──            ││
│      the LLM NEVER establishes geography                              ││
│  5b. group observations for the SAME entity → evidence bundle        ││
│      (evidenceKey / wikidata QID / geo+name rules)                   ││
│      + fold in matching catalog rows (enrich, not duplicate)         ││
└───────────────────────────────────┬───────────────────────────────┘│
                                    ▼                                │
┌─ 6. SEMANTIC CLASSIFICATION ──────────────────  (the new call) ────┐│
│  FOR EACH new / unclassified evidence bundle:                      ││
│    6a. classify ── LLM (Groq qwen/qwen3.8-27b, temp 0) ── ONE call  ││
│        per bundle, sequential, bounded retry-on-429 (v1 — see D1); ││
│        cached by hash(bundle + model_id + prompt_version)          ││
│        input: OSM tags + Wikivoyage prose/section + Places         ││
│               editorial/types + web snippets + Wikidata narrative  ││
│        output: themes[] intents[] traits[]                         ││
│                reasoningEvidence[] (grounded → evidenceKeys)       ││
│        NO user preferences in the prompt. NO dimensionedFacets in  ││
│        v1 (§5.3).                                                  ││
│    6b. deterministic normalize + trait-shape guard   [no ext call] ││
│    6c. qualityScore from provider signals, 0..5      [no ext call] ││
└───────────────────────────────────┬───────────────────────────────┘│
                                    ▼                                │
┌─ 7. PERSISTENCE ─────────────────────────────────────────────────┐ │
│  7a. persistVerifiedExperience — CLASSIFIED metadata + qualityScore│ │
│      mergeMetadata order-independent; real trait dimensions       │ │
│  7b. embed new Experience documents ── Gemini ── small batch      │ │
└───────────────────────────────────┬───────────────────────────────┘ │
                                    ▼                                 ▼
┌─ 8. RE-RETRIEVE + RE-CHECK ──────────────────────────  [DB only] ───────────┐
│  re-run Stage 3 for the previously-insufficient facets                      │
│  still short after MAX_ACQUISITION_PASSES → facet = UNMET  (never fatal —   │
│  invariant: a missing positive preference never fails a tour by itself)     │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
┌─ 9. COMPOSITION (replaces ranking + selectBoundedWindow) ──  [no ext calls] ─┐
│  deterministic set-cover:                                                    │
│    • satisfy EVERY requested facet with ≥1 strong match                      │
│    • drop anything matching hardExclusions                                   │
│    • force-include resolved anchors (priority: soft = strong tilt, must =    │
│      hard include if resolvable)                                             │
│    • prefer multi-facet Experiences (cover more of the spec per slot)        │
│    • enough total for days × pace                                            │
│    • within-facet order: weight → similarity → iconicity tilt → quality →    │
│      diversity                                                               │
│  overlap resolution: shared component → keep the one covering MORE SPEC      │
│    (not more components), tie-break weight then quality                      │
│  → CompositionResult { selected[], perFacetCoverage, unmetFacets, anchors }  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
┌─ 10. DETERMINISTIC DAILY PLANNING ─────────────────────────────────────────┐
│  10a. normalize → PlanningExperienceCandidate[]  (+ preferenceWeight,       │
│       raw qualityScore 0..5, footprints, opening hours)      [no ext call]  │
│  10b. GreedyDailyPlanningSolver — hard constraints + soft score that NOW    │
│       includes a preference term; quality weight applied ONCE              │
│       travel ── Geoapify (+ Haversine fallback) ── per pair evaluated       │
│  10c. TourPlanningFeasibilityValidator (re-derives from solution) [no call] │
│  facet dropped for feasibility → moves to unmetFacets (reason: infeasible)  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    ▼
┌─ 11. MATERIALIZE + TRACE + ASYNC ENRICHMENT ──────────────────────────────┐
│  11a. persist Tour + TourExperience(+Component) snapshots                   │
│       generationTrace v4: PreferenceSpec, per-facet retrieval/acquisition/  │
│       sufficiency, every classification + its grounding, composition        │
│       decisions, per-facet coverage (met/unmet + why), the plan.           │
│       "what matched" computed from the SAME match primitive (no JSON scan)  │
│  11b. async (outbox): media (Wikimedia), cover image; SSE on completion    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 External-call inventory

| Call | Provider | Stage / why | Cold catalog | Warm catalog |
|---|---|---|---|---|
| Interpret free text | LLM Groq | 1a, only if `additionalPreferences` ≠ "" | 0–1 | 0–1 |
| Resolve destination | Geocoder (Places/Nominatim) + Overpass (area) | 2 | 1–2 | 1–2 |
| Query embedding | Gemini | 3b / 9 | 1 | 1 |
| OSM features | Overpass | 4b, per insufficient facet | 0–N | **0** |
| Places search | Google Places | 4b, per facet + per anchor | 0–N | **0** |
| Wikivoyage article | MediaWiki | 4b, 1× per destination, cached | 0–1 | **0** |
| Web search | Tavily (Search Retrieval) | 4b, per insufficient facet | 0–N | **0** |
| Wikidata narrative | Wikidata API | 4b, per OSM feature with a QID | 0–M | **0** |
| Identity resolution | Places / OSM | 5a, disambiguation | 0–K | **0** |
| **Web entity extraction** | **LLM Gemini flash-lite** | **4c, per web-search batch — names + evidenceKeys only** | **0–P** | **0** |
| **Semantic classification** | **LLM Groq qwen3.8-27b** | **6a, per NEW evidence bundle — one call each, sequential, cached (v1; batching deferred, D1)** | **0–B** | **0** |
| Document embedding | Gemini | 7b, per new Experience | 0–B | **0** |
| Travel estimates | Geoapify (+ Haversine fallback) | 10b, per candidate pair | many, cheap/cached | many |
| Media / cover | Wikimedia / image gen | 11b, async, off critical path | async | async |

**Warm catalog** (destination already acquired + classified): Stages 4–8 are
skipped. Flow = interpret (maybe) → resolve → per-facet catalog retrieval →
compose → plan. **0–1 LLM + 1 embedding + destination + travel.** Fast.

---

## 4. Component fate

| Today | Fate |
|---|---|
| `StructuredExperienceCandidateSynthesizerService` (hardcodes `[]`) | **REMOVED.** Replaced by Stage 6 classification. |
| `GroqDiscoveryProvider` / Gemini discovery extractor (extracts candidates *with* themes/traits from web) | **SPLIT.** Entity-name extraction → Stage 4c (Gemini flash-lite, names + evidenceKeys, anti-hallucination grounding). Themes/traits → Stage 6. |
| `CoverageAnalyzer` (keyword/JSON scan over a geo pool) | **REMOVED (monolith).** Sufficiency survives as a per-facet check (Stage 3c + 8). |
| `rankCandidatesByRelevance` (big-pool sort) | **REMOVED.** Only within-facet ordering remains (small, local, new tests). |
| `selectBoundedWindow` (top-15, re-sort by `totalScore`) | **REMOVED.** Replaced by Stage 9 set-cover. |
| `evaluateExperiencePreferences` / `candidateMatchesPreferenceFacet` (3 divergent definitions) | **UNIFIED** into one match primitive (§5.2), consumed by Stage 3, 9, 11 (trace). |
| `ExperienceAcquisitionPlannerService` (generic deficit → many things) | **CHANGED** to per-facet routing (Stage 4a). |
| `StructuredCandidateCorroborationService` | **KEPT** (5b) + catalog fold-in. |
| `ExperienceProposalResolverService` (grounded identity) | **KEPT** (5a). |
| `mergeMetadata` (shallow, order-dependent) | **CHANGED** to order-independent (union arrays, prefer non-empty, `max` quality). |
| `resolveOrCreateTraitDefinitions` (every dimension `'general'`) | **CHANGED** — real dimensions. |
| `PlanningCandidateNormalizerService` | **CHANGED** — carries `preferenceWeight` + raw `qualityScore`. |
| `GreedyDailyPlanningSolver` | **CHANGED** — preference term in the soft score; quality weight applied once. |
| `TourPlanningFeasibilityValidatorService` | **KEPT** (10c). |
| `filterOverlappingExperienceCandidates` | **CHANGED** — tie-break by "covers more spec", not by component count. |
| `PreferenceInterpreterService` | **CHANGED / MERGED** — becomes the `PreferenceSpec` builder (Stage 1); unified with the agent's request interpreter (§7). |
| `generationTrace` v3 | **CHANGED** → v4; per-facet section; "what matched" via the unified primitive. |
| OSM / Wikivoyage / Places acquisition adapters | **CHANGED** — stop discarding evidence (§5.5). |
| `ExperienceCatalogService` persist path, GeoEntity, components, dedupe | **KEPT** (dedupe logic unchanged; persist writes classified metadata). |
| `DestinationResolutionService`, embeddings, `TravelEstimateProvider`, media enrichment, outbox, SSE, Tour materialization | **KEPT.** |

---

## 5. Key sub-decisions

### 5.1 Web = Search Retrieval, not Grounded Research (for this refactor)
Per the target-architecture spec §4, "Web" is two capabilities. This refactor
uses **Search Retrieval** ("Modo A"): Tavily search (we build the query per
facet) → Gemini flash-lite extracts entity names citing only the retrieved
evidence. The **Grounded Research seam stays open** — `GROUNDED_SEARCH_PROVIDER`
already supports `gemini`; a future capability split (hand Gemini a research
objective) must remain possible. Do not collapse the two into "one grounded
provider" as a permanent decision.

### 5.2 One preference-match primitive
`candidateMatchesPreferenceFacet` becomes THE authority for
`experienceSatisfies(dimension, key)`, consumed by per-facet retrieval (3a),
composition (9) and the trace (11). `CoverageAnalyzer`'s keyword/accent-naive
scan and the bitácora's `JSON.stringify(metadata)` scan are deleted. Diagnostic
blobs (`preferenceEvaluation`) are never part of any match corpus (fixes
CHAR-4). This resolves G.1 group B.

### 5.3 Semantic classification (Stage 6)
- **Model:** Groq `qwen/qwen3.8-27b`, temp 0. The BA dry-run and the G.1
  provider comparison both showed it is materially better than the local
  `qwen2.5:7b` for this (correct trait shape, respects the "don't infer
  iconic/local from thin evidence" rules, grounding by evidenceKey). Gemini
  `gemini-3.6-flash` is the fallback.
- **Evidence-only, no user preferences in the prompt.** Classification is about
  what the evidence *means*, not what the user wants — this keeps it cacheable
  and non-contaminated.
- **No `dimensionedFacets` in v1.** Even the good model over-reached on
  `tourism_intensity:iconic` from marketing copy. `exploration_style` is
  handled by §5.4 instead.
- **Prompt guardrails (from probe #2, §8.1 Finding E).** The model surfaced a
  canonical theme wherever its word appeared: `theme:wine` for a venue that
  merely "serves wine" (`vino` in a Places editorial), `theme:tango` for a
  historic café that happens to host tango. The prompt must state: emit a
  canonical theme only when the place is substantially *about* that theme, not
  when the word appears incidentally in a menu / amenity list; prefer `traits`
  ("serves wine", "occasional live tango") for incidental facts. This is
  precision tuning, not a structural change — the deterministic normalizer still
  clamps vocabulary regardless.
- **Deterministic bracket:** identity resolution (5a, deterministic) before;
  `normalizeExperienceCandidateFacets` (controlled-vocab clamp) + a new
  trait-shape guard (must be a short string, not a canonical key, not a
  sentence) after. The raw LLM output is never persisted directly.
- **Caching:** keyed by `hash(evidence_bundle + model_id + prompt_version)`.
  Shared landmarks and re-runs are free. A prompt/model improvement bumps
  `prompt_version` and triggers a batch re-classification job, not a re-crawl.
- **Failure:** on LLM error/timeout the Experience persists with `themes:[]`
  (today's behavior) — degraded, not blocking. A later re-classification pass
  picks it up.
- **Critical-path decision (§11 D1 — RESOLVED 2026-09-11).** For a genuinely
  cold destination, Stage 6 is on the tour's critical path. **v1 runs it
  sequentially, one classification call per new bundle, before composition** —
  no "thin first tour", no async pre-warm job. Rationale: both probes hit
  Groq's rate limit (`429 rate_limit_exceeded`) at just 12 near-sequential
  calls on the free tier; parallelizing or batching classification calls
  *increases* that exposure per unit time, and the existing async
  `generationStatus`/SSE progress screen (already used for acquisition passes:
  `"Buscando más Experiences (fuentes: …)"`) already makes a longer sequential
  wait tolerable without new UX. Sequential classification MUST still use
  bounded retry-with-backoff on `429` (proven in probe #2). **Deferred, NOT v1
  scope:** parallelizing per-facet acquisition and batching classification
  calls (documented as "Option A′" during design) is a **future performance
  improvement**, to be taken up only if real telemetry after shipping shows
  cold-destination latency is a problem. The "thin first tour + pre-warm"
  shape (Option B) stays documented as a further fallback if A′ alone is not
  enough — it can reuse the existing `MediaEnrichmentProcessorService`
  async-job + SSE-push pattern rather than being built from scratch.

### 5.4 `exploration_style` becomes a within-facet ranking tilt
Not a facet to satisfy, not a denominator term (fixes CHAR-2's dead-denominator
defect). A deterministic `iconicity` score `0..1` per Experience is computed
from measurable signals — `log(userRatingCount)` normalized, Wikidata sitelink
count, presence in N "top things to do" web lists, OSM `heritage=*`. Then:
- `explorationStyle: iconic` → within each facet, bias ordering toward high
  `iconicity`.
- `explorationStyle: local_deep_dive` → bias toward low `iconicity` **and**
  traits the classifier grounded as `authentic` / `traditional` / "where locals
  go". There is no reliable deterministic signal for "hidden" from absence of
  fame — this is an accepted, documented limitation.
- `explorationStyle: balanced` → no bias.
It never excludes and never fails a facet; worst case the user gets a reasonable
mix. The 3-value enum stays for v1 (YAGNI); implementing it as a tilt makes a
future slider cheap.

### 5.5 Adapter evidence preservation
- **OSM:** copy `OsmCandidate.narrativeContext` (fetched Wikidata article text,
  when a `wikidata` tag exists) into the observation; it is defined today but
  never propagated. Full `osmTags` already survive — keep.
- **Wikivoyage:** add a `metadata` object carrying `sectionType` (SEE/DO/EAT)
  and `templateName`; today they are folded only into the opaque `evidenceKey`
  string and lost as structured signal.
- **Google Places:** widen the API field mask to include `editorialSummary` and
  `primaryTypeDisplayName`; carry `websiteUri`, `priceLevel`, `businessStatus`
  into the observation. The BA dry-run showed `editorialSummary` ("Teatro
  monumental 1908, acústica afamada…") is what gave the classifier the
  `architecture`/`music` signal — today that field is not even requested.
- **Places invariant (unchanged):** a bare `restaurant`/`cafe`/`bakery`/`bar`/
  `night_club` result does not originate an Experience; it may only corroborate
  one, be a proven-Experience venue, or (future) resolve an Operational Stop.

### 5.6 Quality signal
One scale, `0..5`, on `Experience.qualityScore` (the column exists). Populated
at acquisition (Stage 6c) from provider signals via a deterministic function
(`rating` × a `userRatingCount` confidence factor, Wikidata sitelink count as a
notability proxy, Wikivoyage-listed as a signal). Applied **once** — the
normalizer passes the raw `0..5`, the solver's `qualityWeight` acts on it
directly (fixes CHAR-6's double-attenuation and contract mismatch).

**Experiences with no rating (from probe #2, §8.1 Finding C).** A route-shaped or
area-scoped Experience (a neighborhood walk, a thematic route) has no Places
`rating`. Its quality is derived from: the notability of its resolved components
(their own `qualityScore`s), Wikivoyage-listed, and Wikidata sitelink counts of
its components. It is never assigned a flat default that silently clears the
quality floor. If none of those signals exist, its quality is `null` and it is a
**weak** match (§5.6a), not a strong one.

### 5.6a Definitions used above

- **Strong match** for a facet = `experienceSatisfies(dimension, key)` is true
  AND the Experience is feasible for the trip (opening hours / duration not
  obviously impossible) AND `qualityScore ≥ a floor` (floor is a policy
  constant, e.g. 3.0/5). A weak match satisfies the facet but fails the quality
  floor or has thin classification grounding.
- **Sufficiency target per facet** = the existing `CoverageAnalyzer` formula
  applied per-facet: `clamp(days, 1, 14) × pace_factor` (relaxed 3 / moderate 4
  / fast 5), capped by a per-facet ceiling so one facet cannot demand the whole
  trip. Exact constants pinned in the implementation plan.

### 5.7 Composition = deterministic set-cover
Greedy, deterministic, taste-free. Identical `PreferenceSpec` + identical
catalog → deep-equal `CompositionResult`. No privileged global score — an
Experience's "worth" is its preference-match strength + quality + similarity
within its facet.

**Only real, schedulable Experiences enter composition (from probe #2, §8.1
Finding D).** A candidate is eligible only if it is an `Experience` with **≥1
resolved `ExperienceComponent`** (a real `GeoEntity` with coordinates). A bare
`AREA` or `ROUTE` `GeoEntity` with no wrapping Experience / no components is
**never** a selectable pick — it is geographic reality, not a schedulable unit
(Experience Domain V2 invariant). In probe #2 a bare "San Telmo" neighborhood
polygon leaked in as a schedulable Experience and trivially "covered" every
facet because a whole neighborhood contains everything. The composition MUST
reject any candidate lacking components before facet matching.

**Anchor semantics by kind (refines the earlier soft/must model).**
- `anchor.kind = venue` (e.g. Teatro Colón) → a candidate Experience like any
  other, with a strong inclusion tilt. `priority: must` (only if the interpreter
  is confident the text was emphatic) = hard-include if it resolves.
- `anchor.kind = area` (e.g. San Telmo) or `route` → **never** a selected stop.
  It becomes (a) a **retrieval-scope bias**: per-facet retrieval (Stage 3)
  prefers Experiences whose components fall inside the anchor's polygon; and
  (b) a **trigger to acquire/compose a real multi-stop walk Experience** for
  that area (a neighborhood-walk-shaped Experience whose components — plazas,
  streets, landmarks — are resolved through OSM/Places, with the AREA as its
  boundary). That resolved walk Experience is what can be selected; the bare
  polygon cannot.

**Best-in-facet reservation (from probe #2, §8.1 Finding A).** Pure multi-facet
greedy can drop the single strongest match for a facet. Before the multi-facet
fill, **reserve the top-k strongest matches per requested facet** (k derived
from `days × pace`, ≥1), ranked by match strength → quality → similarity. A
monothematic but dominant match for a facet (e.g. a dedicated tango-show venue
for `intent:performance`) is guaranteed a slot; multi-facet Experiences then
fill the remainder. Match *strength* (grounded facet + high quality + on-theme
primary type) outranks facet *count*.

**`performance` is not `theme` (from probe #2, §8.1 Finding B).** When the
interpreter reads "ver un show / un espectáculo / a live performance of X", it
emits **`intent:performance` alongside** `theme:X`, not `theme:X` alone. A
requested `intent:performance` is satisfied only by an Experience the classifier
grounded as an actual performance (a venue with shows / a listed event) — a
place that is merely *themed* around X does not satisfy it. `theme:X` alone is
still satisfied by ambiance-level matches.

Multi-facet Experiences are preferred *within* the remainder fill (one slot
covers more of the spec). Hard exclusions drop any matching candidate before
any of the above.

### 5.8 Preference authority survives end-to-end
`RequestedFacet.weight` flows into `PlanningExperienceCandidate.preferenceWeight`;
`sortCandidatesDeterministically` and `scoreCandidateForDay` gain a preference
term; the composition-to-planner boundary carries it. The G.1 CHAR-5 inversion
(ranking-first candidate ordered planner-last) becomes structurally impossible
because there is no big-pool re-sort left.

### 5.9 `mergeMetadata` order-independence
Union array-valued keys (`themes/traits/intents`), prefer non-empty scalars,
`max` on `qualityScore`, never let an incoming empty array clear a populated
one. Fixes CHAR-8.

---

## 6. Schema changes

Minimal. This design does **not** add `TourStop` / `OperationalStop` /
`Activity` / `Event`.

| Change | Where | Note |
|---|---|---|
| Populate `Experience.qualityScore` | column already exists | no migration |
| `TraitDefinition.dimension` gets real values | column exists | no migration; a backfill job for existing `'general'` rows is optional and separate |
| `generationTrace` v4 shape | `Tour.metadata` JSON | no migration |
| `Experience.metadata.classification` sub-object (reasoningEvidence, model_id, prompt_version) | JSON | no migration |
| Classification cache | a new small table `experience_classification_cache` OR the file cache (`AiCacheService` pattern) | decision D2 (§11) |

---

## 7. Convergence with the Tour Agent

The preference-first flow **is the deterministic core** that `feat/agentic-travel-planning`
orchestrates. They are the two halves of the target-architecture central
invariant ("the agent decides *what the trip needs* and *when more work is
justified*; the core decides *how facts are acquired, validated, ranked,
scheduled, materialized*").

### 7.1 Tool-internals mapping (contracts unchanged, internals replaced)

| Agent tool (`AgentToolRegistry`) | Today's internals | After preference-first |
|---|---|---|
| `load_catalog` | geographic pool | Stage 3 — per-facet catalog retrieval via the unified primitive over classified semantics |
| `analyze_coverage` | `CoverageAnalyzer` keyword/JSON scan | Stage 3c + 8 — per-facet sufficiency; the `unmetFacets` output *is* the agent's gap list |
| `research_gap` | `LiveAgentResearchProvider` → one grounded provider → extractor → resolver (the "bridge, not destination" path) | Stage 4 (Modo A) + 5 + 6 + 7 — canonical multi-source per-facet acquisition + classification + persist |
| `run_planner` | normalizer + solver + feasibility | Stage 9 (set-cover) + Stage 10 — same contract, preference term added |

`AgentState` gains the `PreferenceSpec` (replacing the loose "interpreted
intent"). The agent's **"gap"** = preference-first's **"unmet facet"**. The
agent's fixed loop (`AgentPolicy.decide`: `load_catalog` → `analyze_coverage` →
`research_gap` → `analyze_coverage` → `run_planner` → `finish`/`fail`) is
**refactor-independent** — only what the tools return changes.

### 7.2 What the agent adds on top (post-Gate, not in this refactor)
1. Natural-language request instead of the wizard (its interpreter is the
   `PreferenceSpec` builder — see 7.3).
2. Reasoned research budget instead of a fixed `MAX_ACQUISITION_PASSES`
   ("tango is at 2/4, one more Tavily pass is cheap and likely to help" vs
   "hiking in BA: 0 matches, 2 failed passes → genuinely unavailable, mark
   unmet").
3. Ambiguity surfacing before spending acquisition ("shows" = tango / theater /
   live music?).
4. Conversational replanning ("too much walking on day 2" → re-run composition +
   planner with an added constraint, not a full regeneration).
5. Fuzzy cross-facet reasoning on top of the deterministic set-cover.

### 7.3 One component unified from day 1
`PreferenceInterpreterService` (Stage 1a) and the agent's
`AgentRequestInterpreter` **must be the same component**, built in this refactor,
with the agent's NL interpreter as a superset (it also extracts per-day pace
constraints, exclusions from "we already saw X", and ambiguities). This avoids
the "duplicated Experience-domain concepts in the agent branch" that the
Integration Gate prerequisites (target-arch spec §16) explicitly forbid.

### 7.4 Redefined Integration Gate prerequisite
The convergence roadmap's Gate requires "Phase 7 CLOSED". Preference-first
**is** "Phase 7's live orchestration, done right" — it rewrites the parts G.1
proved broken. Therefore:

> **The Gate prerequisite "Phase 7 CLOSED" is redefined to "preference-first
> core stable + acceptance green".** Phase 7 A–G's building blocks
> (`ExperienceAcquisitionPlanner`, `ExperienceAcquisitionService`, corroboration,
> resolver, validation, dedupe, catalog) are kept; its *live selection/coverage
> orchestration* (`CoverageAnalyzer` monolith, `rankCandidatesByRelevance` pool
> sort, `selectBoundedWindow`) is superseded by Stages 3/8/9. The canonical API
> the agent consumes becomes **`PreferenceSpec` + per-facet tools + `unmetFacets`**.

`feat/agentic-travel-planning` continues **un-merged, in parallel**, while the
refactor lands. The Gate action (create `feat/unified-agentic-travel-planning`
*from* the refactored `feat/experience-domain-v2`, bring the agent onto it,
favor Experience-Domain-V2 contracts, delete the legacy `research_gap` path)
is unchanged in spirit — it just gates on the refactored core.

### 7.5 Sequencing
1. **Refactor** on a new branch off `feat/experience-domain-v2` (preference-first
   Stages 1–11 + the unified interpreter + adapter evidence fixes + the G.1
   defect fixes that fall out for free).
2. **Refactor acceptance green** (§9) → merge to `feat/experience-domain-v2`.
   This is the redefined "Phase 7 CLOSED".
3. **Argentina live smoke** (was "Phase 7 H") against the refactored core.
4. **Integration Gate** → `feat/unified-agentic-travel-planning`.
5. Post-Gate: agent NL front door, reasoned budgets, conversational replanning,
   then Activities / Events / Operational Stops per the existing post-convergence
   roadmap.

---

## 8. Executable probes

`docs/superpowers/characterization/2026-09-10-preference-first-buenos-aires-dry-run.md`
records **two probes** against real providers for a **cold Buenos Aires
catalog** (history + architecture + tango; anchors San Telmo + Teatro Colón).

- **Probe #1 (manual):** the full 11-stage flow driven by hand. Produced a
  coherent 2-day itinerary where every stop mapped to a requested facet with
  grounded evidence. Confirmed the Places field-mask widening (§5.5) is
  load-bearing (`editorialSummary` is what produced Teatro Colón's
  `architecture`/`music` signal).
- **Probe #2 (executable):** real acquisition → real identity/corroboration →
  **real Groq classification of all 12 bundles** → in-memory per-facet retrieval
  using the **real** `candidateMatchesPreferenceFacet` + `normalizeExperienceCandidateFacets`
  → in-memory deterministic set-cover. Output: a `CompositionResult` with
  per-facet coverage, the selected set, why each entered, and unmet facets.
  Every requested facet was covered by ≥1 strong grounded match; `unmetFacets`
  was empty.

Both probes validate the core shape. Probe #2 also surfaced concrete
refinements, folded into §5 above:

### 8.1 Findings from probe #2

- **A — best-in-facet reservation.** Pure multi-facet greedy dropped **Bar Sur**
  (the strongest dedicated tango-show venue, 4.8/1869) because it covered only
  `theme:tango`; a multi-facet alternative was picked instead. The user still
  got a tango show *by luck*, not by design. → §5.7 reserves the top-k strongest
  matches per facet before the multi-facet fill; match *strength* outranks facet
  *count*.
- **B — `performance` is not `theme`.** `theme:tango` conflates "tango ambiance"
  (a historic café) with "a tango performance". "Ver un show" must become
  `intent:performance` at interpretation, and a requested `intent:performance`
  must require a real performance venue. → §5.7 + interpreter contract.
- **C — quality for un-rated Experiences.** An area/route Experience has no
  Places `rating`; a flat default silently cleared the quality floor. → §5.6
  derives quality from resolved-component notability instead; `null` → weak
  match, not strong.
- **D — anchor semantics / what can be an Experience.** A bare "San Telmo"
  neighborhood polygon (a `sublocality` `GeoEntity`, no rating, **no
  components**) leaked in as a schedulable Experience and trivially "covered"
  every facet. → §5.7: only Experiences with ≥1 resolved component enter
  composition; an `area`/`route` anchor is a retrieval-scope bias + a trigger to
  acquire a real multi-stop walk Experience, never a selected stop. D also
  absorbs the "thin `walk`" observation — point POIs classify as `visit`, so
  `intent:walk` / `route_like` genuinely wants a resolved multi-stop route
  Experience.
- **E — classifier theme over-reach.** `theme:wine` for a venue that merely
  serves wine; `theme:tango` for a café that hosts occasional tango. → §5.3
  prompt guardrail (theme only when the place is substantially *about* it);
  incidental facts go to `traits`.

---

## 9. Testing strategy

**Non-negotiable: every existing test layer keeps its gate.** Before the
refactor branch merges, all of these must be green:
`yarn test` (unit) · `yarn test:integration` (real Postgres) ·
`yarn test:e2e --runInBand` (real AppModule + Postgres + outbox) ·
`yarn test:acceptance` (deterministic solver scenarios) ·
`yarn test:live` (real providers) · provider smoke · Playwright `fe/e2e`.
The G.1 characterization suite (`yarn test:characterization`) stays isolated
from the CI-blocking gate until its `it.failing()` invariants flip (see 9.5).

**Discipline that must not regress:**
- Real Postgres for anything touching persistence — no mocked Prisma in
  integration/e2e.
- Fakes only at external boundaries: LLM transport, embeddings, travel
  estimator, web search. Same discipline as `experience-selection-scale.e2e-spec.ts`.
- Determinism: identical `PreferenceSpec` + identical catalog → deep-equal
  `CompositionResult` and deep-equal plan. Extends the solver's existing
  determinism guarantee to composition.
- **No net loss of coverage.** Every removed test's intent is re-covered by a
  new test at the same or a better layer. The implementation plan carries a
  removed-test → replacement mapping table.

### 9.1 Unit (`be/src/**/*.spec.ts`)

| Fate | Tests |
|---|---|
| **KEEP (unchanged)** | `experience-dedupe.util.spec.ts`, `experience-proposal-resolver.*.spec.ts`, `normalized-opening-hours.util.spec.ts`, `spatial-footprint.util.spec.ts`, `travel-*.spec.ts`, `destination-resolution.service.spec.ts`, opening-hours / footprint / feasibility util specs |
| **KEEP (expanded)** | `preference-facet-matching.util.spec.ts` — becomes the spec for THE match primitive; absorbs the useful cases from `experience-preference-evaluator.util.spec.ts`. `structured-candidate-corroboration.service.spec.ts` — + catalog fold-in cases. OSM/Wikivoyage/Places acquisition provider specs — + evidence-preservation assertions (§5.5). `greedy-daily-planning.*` acceptance unit specs — candidate inputs gain `preferenceWeight`; add a "preference term changes placement" case. |
| **CHANGE** | `planning-candidate-normalizer.service.spec.ts` (carries `preferenceWeight` + raw quality), `daily-planning-placement.util.spec.ts` / `daily-planning-candidate-sort.util.spec.ts` (preference term in soft score + greedy order), `candidate-overlap-filter.util.spec.ts` (tie-break by "covers more spec"), `theme-matching.util.spec.ts` (only the trace-safe subset survives; `matchesThemeKeywords`-over-`JSON.stringify` deleted), `generation-trace-builder.util.spec.ts` (v4 + per-facet + primitive-based "what matched") |
| **REMOVE** | `structured-experience-candidate-synthesizer.service.spec.ts` (service removed), `candidate-ranking.util.spec.ts` (big-pool sort removed — a much smaller `within-facet-ordering.spec.ts` replaces it), `candidate-window-selection.util.spec.ts` (`selectBoundedWindow` removed), `coverage-analyzer.service*.spec.ts` (monolith removed — `facet-sufficiency.spec.ts` replaces it), the theme/trait *extraction* cases in the discovery-extractor specs (Stage 4c extracts names only; anti-hallucination name-grounding cases stay and move to `web-entity-extraction.spec.ts`) |
| **NEW** | `preference-spec-builder.spec.ts` (Stage 1 merge, anchors, wizard+free-text precedence), `facet-router.spec.ts` (Stage 4a routing table, per-facet provider actions, `exploration_style` not routed), `iconicity.util.spec.ts` (deterministic score), `semantic-classification-normalizer.spec.ts` (Stage 6b + trait-shape guard: rejects sentences, canonical keys, empty), `quality-score.util.spec.ts` (Stage 6c deterministic function), `composition-set-cover.spec.ts` (Stage 9: covers every facet, drops exclusions, prefers multi-facet, deterministic — **plus probe #2 guards:** best-in-facet reservation not dropped by multi-facet fill [Finding A]; a bare `AREA`/`ROUTE` `GeoEntity` with no components is rejected before matching [Finding D]; `intent:performance` unsatisfied by an ambiance-only themed place [Finding B]), `anchor-semantics.spec.ts` (`kind:venue` → candidate; `kind:area`/`route` → scope bias + walk-acquisition trigger, never a stop — Finding D), `merge-metadata.spec.ts` (order-independence — promoted from characterization CHAR-8), `within-facet-ordering.spec.ts` |

### 9.2 Integration (`be/test/integration/`, real Postgres)

| Fate | Tests |
|---|---|
| **KEEP (harness + Postgres discipline)** | `be/test/integration/support/*` (`test-db.ts`, `seed.ts`) — unchanged. |
| **CHANGE** | the Phase 7 A–F canonical-orchestration integration specs — the orchestration shape changes (per-facet, no monolithic coverage gate); assertions move from "pool sufficient / ranked window = 15" to "per-facet coverage met" + "composed set covers the spec". |
| **NEW** | `per-facet-retrieval.integration-spec.ts` (Stage 3 over a seeded classified catalog), `classify-persist-reretrieve.integration-spec.ts` (Stage 6→7→8 round-trip: an OSM/Places evidence bundle classified, persisted with real metadata + `qualityScore`, re-retrieved and now satisfies its facet — the real-Postgres version of BA-dry-run Stages 6–8), `provider-order-convergence.integration-spec.ts` (promoted from characterization CHAR-8), `trait-dimension-roundtrip.integration-spec.ts` (promoted from characterization CHAR-2 DB) |

### 9.3 E2E (`be/test/*.e2e-spec.ts`, real AppModule + Postgres + outbox)

| Fate | Tests |
|---|---|
| **KEEP (catalog seeding + fakes discipline)** | `be/test/support/experience-selection/*` corpus/harness — the 320-row seeding + binary-embedding fake + fake interpreter + Haversine travel fake all stay. |
| **CHANGE** | `experience-selection-scale.e2e-spec.ts` — feasibility/exclusion scenarios stay; assertions shift from "geo pool → ranked window" to "per-facet coverage in the result + composed set". `experience-selection-competitive.e2e-spec.ts` (CP-G benchmark) — the ranking-as-pool-sort it benchmarks is replaced; its counterfactuals ("one preference delta → different selection") are re-expressed as "one facet added/removed → different composed set", which is a *better* fit for preference-first. Dominance/regret checks stay. |
| **NEW** | `preference-first-cold-catalog.e2e-spec.ts` (empty catalog for a city → full acquisition+classification path with faked provider transports → assert the tour's `perFacetCoverage` covers every requested facet, `unmetFacets` is explained, the trace has the per-facet section), `anchor-honored.e2e-spec.ts` (a `PreferenceSpec` with an anchor that exists in the seed → it appears in the composed set), `one-preference-delta.e2e-spec.ts` (adding `theme:tango` changes the composed set deterministically and in the right direction) |
| **REMOVE** | any assertion of "offered window length === 15" or "coverage decision `none` because N nearby rows exist" (concepts deleted) |

### 9.4 Acceptance (`be/test/acceptance/`, deterministic solver)

| Fate | Tests |
|---|---|
| **KEEP** | `be/test/acceptance/scenarios/*` (rosario-accessibility, buenos-aires-3days, san-rafael-2days, villa-general-belgrano-1day, idempotency) — they test feasibility, scheduling, determinism; candidate inputs adapt to the new `PlanningExperienceCandidate` shape (`preferenceWeight`, raw `qualityScore`). `be/test/acceptance/harness/*`, builders, invariant asserter — kept. |
| **CHANGE** | `greedy-daily-planning.spec.ts` (TC-SOLV-*) — add cases proving the preference term affects day/order placement and that quality weight is applied once. |
| **NEW** | `composition-scenarios.spec.ts` (set-cover: multi-facet preference, hard exclusion under pressure, anchor forced, unmet facet surfaced — deterministic, from the `PreferenceSpec` + a fixed classified corpus) |

### 9.5 Characterization (`be/test/characterization/`, `yarn test:characterization`)

The G.1 suite is the **RED baseline**. As the refactor lands, its `it.failing()`
invariants flip green:
- CHAR-3 (coverage vs primitive agree) → green when §5.2 unifies the primitive.
- CHAR-4 (bitácora self-contamination) → green when the JSON scan is deleted.
- CHAR-5 (ranking-first ≠ planner-last) → green when the big-pool sort is gone.
- CHAR-6 (quality signal) → green when §5.6 lands.
- CHAR-8 (provider-order convergence) → green when §5.9 lands; the spec then
  *promotes* it to integration (9.2).
- CHAR-2 DB (trait dimension) → green when `resolveOrCreateTraitDefinitions` uses
  real dimensions; promoted to integration.
When an invariant goes green its `it.failing` becomes a regular `it` and stays
as a permanent regression guard. The G.1 report gets a "Resolution" appendix
mapping each defect → the commit that fixed it → the guarding test.
**A new characterization suite** — `preference-first-selection-semantics` —
becomes the RED baseline for *this refactor's* own invariants (e.g. "a facet
with zero catalog matches and exhausted acquisition budget is `unmet`, never
fatal"; "identical `PreferenceSpec` → deep-equal composition"), then flips green
as the refactor completes.

### 9.6 Live (`be/test/live/`, real providers)

| Fate | Tests |
|---|---|
| **CHANGE** | `cold-start-experience-acquisition.live-spec.ts` → per-facet cold acquisition + real classification; still the real-provider cold-start check. |
| **NEW** | `preference-first-buenos-aires.live-spec.ts` — the BA dry-run, formalized: real providers, cold catalog, representative `PreferenceSpec`, assert the resulting tour's `perFacetCoverage` covers the requested facets and every selected Experience has a grounded classification. Tagged `@live` (not in the default gate; run in the live job). |

### 9.7 Provider smoke (`be/test/provider-smoke/`)

**KEEP.** Adapters change (field mask, section preservation) but the smoke
contract — "the adapter reaches the provider and returns the documented shape" —
holds. Add smoke assertions for the newly-preserved fields (`editorialSummary`,
Wikivoyage `sectionType`).

### 9.8 Frontend E2E (Playwright, `fe/e2e/`)

| Fate | Tests |
|---|---|
| **KEEP** | wizard → `POST /tours/generate-tour` → view flow (unchanged from the FE contract). |
| **CHANGE** | bitácora assertions (`GenerationBitacora`) — trace shape v4 (per-facet section). |

### 9.9 Stage-6 classification validation gate (release checkpoint)

Not a jest suite — a `yarn script classify-eval` run + a committed report.
Over **50–100 real Experiences across 3–4 destinations**: run Stage 6, review
by hand. **Acceptance thresholds:** theme/intent precision ≥ 90%; 0 unsupported
`dimensionedFacets` (v1 emits none); 0 malformed traits after the guard;
100% of accepted facets traceable to `evidenceKeys`. If it fails, adjust
prompt/model and re-run — a batch job, not a release. This gate must pass before
the refactor branch merges.

---

## 10. Non-goals

- No `Activity` / `Event` / `OperationalStop` / `TourStop` — those stay on the
  post-convergence roadmap.
- No conversational replanning in this refactor — that is post-Gate agent work.
- No Grounded Research capability split — the seam stays open, not built.
- No OSRM / routing-engine change — `TravelEstimateProvider` unchanged.
- No schema migration beyond populating existing columns + JSON shape changes.
- Does not merge branches, does not modify `feat/agentic-travel-planning`, does
  not re-number Phases unilaterally (the redefinition in §7.4 is a proposal for
  sign-off).
- Does not change the `Experience` / `GeoEntity` / `Tour` core models, dedupe
  thresholds, or the deterministic solver's hard constraints.
- **No parallelized per-facet acquisition, no batched Stage 6 classification
  calls, no "thin first tour" / async pre-warm** (D1, §5.3). v1 classifies
  sequentially with bounded retry-on-429. This is explicitly deferred future
  performance work, not built here — see the implementation plan's backlog.

---

## 11. Open decisions (need sign-off before the implementation plan)

- ~~**D1 — Cold-destination critical path.**~~ **RESOLVED 2026-09-11:**
  sequential Stage 6 on the critical path in v1 (no thin tour, no pre-warm);
  parallel/batched classification and the thin-tour fallback are deferred,
  documented future performance work — not built in this refactor. See §5.3.
- **D2 — Classification cache store.** New `experience_classification_cache`
  table vs the file-based `AiCacheService` pattern? Recommended: a table (queryable,
  survives container restarts, supports the batch re-classification job).
- **D3 — Anchor `must` semantics.** May the interpreter ever emit
  `anchor.priority: must` (hard include), or is every anchor `soft` in v1?
  Recommended: `soft` only in v1; `must` deferred with the named-request
  product decision. **Note (probe #2 Finding D):** this applies only to
  `anchor.kind = venue`. An `area`/`route` anchor is *never* a hard-included
  stop regardless of priority — it is always a retrieval-scope bias + a
  walk-Experience acquisition trigger (§5.7).
- **D5 — Area-anchor walk acquisition in v1.** When an `area` anchor is present
  and the user requested `intent:walk` / `route_like`, does v1 actually acquire
  and compose a real multi-stop walk Experience for that area (uses the existing
  composite/`NEIGHBORHOOD_WALK` resolution path), or does v1 only apply the
  retrieval-scope bias and leave the walk Experience to a later increment?
  Recommended: acquire the walk Experience in v1 — otherwise `intent:walk` is
  chronically thin for point-POI cities (probe #2).
- **D4 — Phase renumbering.** Adopt §7.4 (redefine "Phase 7 CLOSED" as
  "preference-first core stable"), or keep Phase 7 numbering and call
  preference-first "Phase 8"? Recommended: §7.4.

---

## 12. Acceptance criteria (the refactor is "done" when)

1. Every test gate in §9 is green; the removed-test → replacement mapping is
   complete with no coverage regression.
2. The G.1 `it.failing()` invariants CHAR-3/4/5/6/8 (+ CHAR-2 DB) are green and
   converted to permanent guards; the G.1 report has its Resolution appendix.
3. `preference-first-buenos-aires.live-spec.ts` produces a tour whose
   `perFacetCoverage` covers every requested facet, with every selected
   Experience carrying a grounded classification.
4. The Stage-6 validation gate (§9.9) passes with a committed report.
5. Determinism: identical `PreferenceSpec` + catalog → deep-equal
   `CompositionResult` + plan, proven by a test.
6. No `CoverageAnalyzer` monolith, no `rankCandidatesByRelevance` pool sort, no
   `selectBoundedWindow`, no `StructuredExperienceCandidateSynthesizerService`
   in the live path.
7. `PreferenceInterpreterService` and the agent's request interpreter are one
   component (§7.3).
10. **No bare `AREA` / `ROUTE` `GeoEntity` in a `CompositionResult`** — every
    selected item is an `Experience` with ≥1 resolved `ExperienceComponent`
    (probe #2 Finding D), proven by a test.
11. **Best-in-facet reservation holds** — a test proves the single strongest
    match for a facet is not dropped by the multi-facet fill (probe #2
    Finding A).
12. **`intent:performance` requires a performance venue** — a test proves an
    ambiance-only themed place does not satisfy a requested `intent:performance`
    (probe #2 Finding B).
8. `yarn workspace backend check` shows no new tsc/lint errors vs the documented
   baseline.
9. Argentina live smoke (ex-"Phase 7 H") green against the refactored core.
