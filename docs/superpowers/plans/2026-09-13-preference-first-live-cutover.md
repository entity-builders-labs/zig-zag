# Preference-First Live Cutover — canonical tour-generation orchestration

Status: **implementation plan. Docs-only. Not authorization to implement.**
Written: 2026-09-13.
Branch: `feat/preference-first-selection`.

Related (read these first; this plan does not repeat their content):
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` (canonical target design — Stages 1–11, all invariants)
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md` (Checkpoints A–D, **already contains the detailed C1–C8/D1–D8 task breakdown this cutover executes** — this plan does not re-derive those tasks, it re-sequences and hardens them against what RW1 actually found live)
- `docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`
- `docs/superpowers/progress/2026-09-13-pre-b6-gates-progress.md`
- `docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
- `docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`
- `spikes/rw1-san-telmo-historical-walk/assessment.md` (the empirical trigger for this plan)

---

## 0. Why this plan exists

RW1 (`spikes/rw1-san-telmo-historical-walk/assessment.md`) proved, against the
real live application path with real providers, that:

1. `PreferenceInterpreterService` correctly extracts a real, "must"-priority
   `anchoredPlaces: [{kind:"area", rawName:"San Telmo"}]`.
2. That signal is **never consumed** anywhere downstream. Confirmed by direct
   code inspection (§2 below), not inference: `anchoredPlaces` appears exactly
   once in `ExperienceGenerationService` (a `[]` default) and is never read
   again in the file's 1606 lines.
3. Every Checkpoint-A/B canonical primitive (`PreferenceSpec` builder,
   `preference-sufficiency.util.ts`, `FacetRetrievalService`,
   `AreaRouteWalkAcquisitionService`, `AreaRouteAnchorResolverService`,
   `ExperienceClassificationService`) exists, is unit/integration-tested, and
   has **zero live callers**. The production orchestrator
   (`ExperienceGenerationService.generateTourExperiences`) still runs entirely
   on the pre-preference-first `NormalizedPreferenceIntent` shape, the legacy
   `CoverageAnalyzer` (keyword theme-matching, not
   `candidateMatchesPreferenceFacet`), and `selectBoundedWindow` ranking.
4. Checkpoint C (composition, planner-candidate contract changes, trace v4,
   Bitácora v4) **has not been started at all** — `composition-set-cover.util.ts`,
   `experience-composition.service.ts` and `must-anchor-placement.util.ts` do
   not exist in the repository.

This is why RW1's verdict was `ORCHESTRATION_GAP`, not a fixable one-line
patch: there is no partial wiring to complete. There are two fully-built,
fully-disconnected worlds — the legacy `NormalizedPreferenceIntent`/
`CoverageAnalyzer` orchestration that owns the live product today, and the
preference-first primitives (Checkpoints A+B, complete; C, not started) that
own nothing yet.

**This plan is the missing Checkpoint C + Checkpoint D work, re-sequenced as
incremental, individually-shippable milestones and hardened with the explicit
single-owner/no-dual-pipeline constraints below**, which the original
2026-09-11 plan's C/D sections did not need to state as explicitly because
they were written before any live orchestration existed to accidentally keep
running in parallel.

---

## 1. Architectural correction — read before anything else

**Forbidden shape** (do not build this):

```text
legacy ExperienceGenerationService (owns the live path)
  → detect anchoredPlaces present + intent contains walk/route_like
      → call AreaRouteWalkAcquisitionService
      → return to legacy acquisition/coverage/ranking
  → otherwise
      → continue exactly as today
```

This creates two competing architectures with different behavior by request
shape (exactly the "walk → new pipeline, history → legacy pipeline" pattern
the authorization explicitly forbids), and it does not fix the root cause:
`CoverageAnalyzer`'s keyword matching, `selectBoundedWindow`'s ranking, and
the complete absence of classification in the persistence path would all
still run for every non-walk request, forever.

**Required shape**: preference-first orchestration becomes the **one**
authoritative flow for every request. AREA/ROUTE/WALK acquisition is one
`AcquisitionStrategy` selected by structured deficit data, exactly like
"query Wikivoyage" or "query Google Places" are today — never a special
branch keyed on `anchoredPlaces.length > 0`.

---

## 2. Current live call graph (verified against real code, 2026-09-13)

```text
POST /tours/generate-tour
  → CreateTourFromWizardDto → buildTourGenerationRequest (contractVersion:1)
  → TourGenerationService.createTourFromWizard
  → ToursService.create (Tour row + outbox "TourGenerationRequested" in one tx)
  → OutboxPublisherService (1500ms poll) → InMemoryQueueService
  → TourGenerationProcessorService.handleGenerationRequested
  → ExperienceGenerationService.generateTourExperiences(tourId)
      ├─ PreferenceInterpreterService.interpret(...)   [@Optional(), real LLM call]
      │    → NormalizedPreferenceIntent { preferredFacets, anchoredPlaces, ... }
      │    → anchoredPlaces is read into a default object shape and NEVER READ AGAIN
      ├─ DestinationResolutionService.resolve(...)
      │    → real Nominatim; area-scale ONLY for addresstype city/town/village;
      │      everything else (including a real, resolvable "suburb" like San
      │      Telmo) degrades to point + a fixed-radius fallback (25km observed)
      ├─ ExperienceCatalogService.findVerifiedWithin(...) — initial catalog pool
      ├─ CoverageAnalyzer.analyze(...)
      │    → matches via theme-matching.util.ts keyword heuristic
      │      (THEME_KEYWORDS), NOT candidateMatchesPreferenceFacet
      │    → deficits drive the acquisition loop below
      ├─ loop (bounded by MAX_ACQUISITION_PASSES):
      │    ExperienceAcquisitionPlannerService.buildAcquisitionPlan({
      │      destination, legacyDeficits, preferredFacets, candidates,
      │      semanticQuery, breadth
      │      // NOTE: `anchors` field exists on BuildPlanInput (added in B5)
      │      // but is never passed here.
      │    })
      │    → ExperienceAcquisitionService.executePlan(plan)
      │    → ExperienceAcquisitionService.materializeExecution(execution, {
      │        destinationName, destinationCountryCode, destinationBoundary,
      │        destinationPointRadius
      │        // NOTE: `validationScope`/`validationIntent` (added in B5)
      │        // exist on this context type but are never passed here.
      │      })
      │        → ExperienceProposalResolverService.resolve(...)
      │            → real OSM/Nominatim/Places entity resolution
      │            → CompositeGeographicValidationService.validate(...)
      │            → ExperienceCatalogService.persistVerifiedExperience(...)
      │                → decideExperienceDedupe (real, correct)
      │                → NO CLASSIFICATION CALL — metadata.themes/intents/
      │                  classification persist empty/null every time
      │    → re-query persisted rows directly via raw Prisma + hydrate
      │    → CoverageAnalyzer.analyze(...) again → loop or stop
      ├─ rankAndSliceExperiences (private) → selectBoundedWindow(...)
      │    (legacy global-rank + window-truncation ranking, not weighted
      │    facet-coverage composition)
      ├─ PlanningCandidateNormalizerService → GreedyDailyPlanningSolver →
      │    TourPlanningFeasibilityValidatorService
      ├─ TourCompletenessValidator (independently flagged RW1's own gap:
      │    UNMET_REQUESTED_FORMAT, "asked for walk, none in final itinerary")
      └─ generationTrace version 3 persisted on the Tour row
```

**Services that exist, are tested, and are never reached from the above**:
`preference-spec-builder.util.ts` (zero non-spec references anywhere in
`src/`), `preference-sufficiency.util.ts`, `FacetRetrievalService` (not even
registered in `tours.module.ts`), `AreaRouteAnchorResolverService`,
`AreaRouteWalkAcquisitionService`, `ExperienceClassificationService` (zero
production call sites).

## 3. Target canonical call graph

```text
POST /tours/generate-tour  (unchanged entry point)
  → TourGenerationProcessorService  (unchanged: outbox/queue plumbing)
  → PreferenceFirstOrchestrationService.generateTourExperiences(tourId)
      [renamed/refactored ExperienceGenerationService — see §5 Q2]
      │
      ├─ 1. PreferenceInterpreterService.interpret(...)        [KEEP, unchanged]
      ├─ 2. buildPreferenceSpec(interpreted, request)          [WIRE — exists, A3]
      │       → canonical PreferenceSpec { facets, anchors, exclusions,
      │         semanticQuery, explorationStyle, softConstraints, trip }
      ├─ 3. resolve destination + named anchors               [§7 — scope unification]
      ├─ 4. FacetRetrievalService.retrieve(spec, scope)        [WIRE — exists, A6]
      │       → per-facet strong/weak matches via
      │         candidateMatchesPreferenceFacet (the ONE matching primitive)
      ├─ 5. computePortfolioSufficiency(...)                   [WIRE — exists, A4]
      ├─ 6. while insufficient (bounded):
      │       deficit → AcquisitionStrategySelector → one of:
      │         - AreaRouteWalkAcquisitionService   (area/route anchor + walk/route_like)
      │         - generic structured/web acquisition (today's planner/executor,
      │           reused as a strategy, not the whole orchestrator)
      │       → shared canonical materialization (§6):
      │           resolve → validate → CLASSIFY (new, mandatory) → persist → re-retrieve
      │       → recompute sufficiency
      ├─ 7. ExplorationSignals + explorationTilt                [BUILD — C, missing]
      ├─ 8. embedding-backed semanticSimilarity                 [BUILD — C1b, missing]
      ├─ 9. ExperienceCompositionService.compose(...)            [BUILD — C2/C3, missing]
      │       → weighted deterministic initial portfolio + ranked reservoir
      ├─ 10. PlanningCandidateNormalizerService (+ preferenceWeight/mustInclude) [REFACTOR — C4]
      ├─ 11. GreedyDailyPlanningSolver + TourPlanningFeasibilityValidatorService [KEEP]
      ├─ 12. duration-aware backfill / bounded planner-triggered acquisition    [BUILD — C5b]
      ├─ 13. TourCompletenessValidator                          [REFACTOR — see §5 Q on legacy pieces]
      └─ 14. generationTrace version 4                          [BUILD — C7], rendered by Bitácora v4 [BUILD — C8]
```

---

## 4. KEEP / REFACTOR / REPLACE / DELETE / TEMPORARY ADAPTER

| Service / path | Status | Notes |
|---|---|---|
| `POST /tours/generate-tour` controller, `CreateTourFromWizardDto`, `buildTourGenerationRequest` | **KEEP** | Entry contract is unaffected; the request already carries everything (`intent.interests`, `intent.intents`, `intent.additionalPreferences`) `PreferenceSpec` needs. |
| Outbox (`OutboxPublisherService`, `OutboxService`) | **KEEP** | Durable-delivery plumbing, orthogonal to this cutover. |
| `TourGenerationProcessorService` | **KEEP** | Only calls `experienceGenerationService.generateTourExperiences(tourId)` by interface; unaffected by what that method does internally, as long as the method name/signature it calls is preserved or updated in this same class (see Q2). |
| `PreferenceInterpreterService` | **KEEP** | Already produces real `anchoredPlaces`/`preferredFacets`/`positiveSemanticQuery`. The gap is entirely downstream. |
| `ExperienceGenerationService` | **REFACTOR (in place, renamed)** | Becomes the preference-first orchestrator. See Q2 for the rename-vs-facade decision. |
| `NormalizedPreferenceIntent` → `PreferenceSpec` conversion | **WIRE** (code exists, `preference-spec-builder.util.ts`, unused) | Becomes the very first thing the orchestrator does with interpreter output. |
| `preference-sufficiency.util.ts` | **WIRE** (exists, unused) | Replaces `CoverageAnalyzer`'s sufficiency decision. |
| `FacetRetrievalService` | **WIRE** (exists, unused, not even in `tours.module.ts`) | Replaces `CoverageAnalyzer`'s candidate matching. |
| `CoverageAnalyzer` (`coverage-analyzer.service.ts`) | **REPLACE** | Superseded by `preference-sufficiency.util.ts` + `FacetRetrievalService`. Its keyword-matching (`theme-matching.util.ts`) is exactly the "second hidden semantic engine" invariant #2 forbids. Named for deletion in the 2026-09-11 plan's own "Required deletion / migration checklist" — this cutover is what finally makes that deletion safe. |
| `theme-matching.util.ts` | **DELETE** (after CoverageAnalyzer's removal has no other caller) | Confirm via import search before deleting (§9). |
| `ExperienceAcquisitionPlannerService` | **REFACTOR** | Keep as the source-capability router; its existing `anchors?: AnchoredPlace[]` field (B5) finally gets populated by the new orchestrator instead of being permanently `undefined`. |
| `ExperienceAcquisitionService` (`executePlan`/`materializeExecution`) | **REFACTOR** | Keep as-is; the new orchestrator finally passes the `validationScope`/`validationIntent` context fields that already exist on its input type (B5) but are never populated today. |
| `ExperienceProposalResolverService` | **REFACTOR (becomes the canonical materialization boundary)** | See §6 — this is the answer to "is this the correct convergence boundary." It already owns resolve→validate→persist; classification moves INTO this same call path rather than remaining a side-channel only `AreaRouteWalkAcquisitionService` invokes. |
| `CompositeGeographicValidationService` | **KEEP** | Already the single geography authority; already receives `validationScope`/`validationIntent` correctly when supplied — the gap is upstream (nothing supplies them today). |
| `ExperienceCatalogService` | **KEEP** | Canonical persistence/hydration/dedupe boundary; `findVerifiedWithin`, `persistVerifiedExperience`, `upsertGeoEntity` etc. all stay. Gains no new public surface beyond what B5/B2 already added (`applyEvidenceClassification` and friends), if not already present. |
| `experience-dedupe.util.ts` / identity gate | **KEEP, untouched** | Proven correct on real Postgres (2026-09-13 identity gate). This cutover must not touch dedupe policy. |
| `ExperienceClassificationService` | **WIRE** (exists, zero production call sites) | Called from the shared materialization boundary (§6) for every newly-persisted candidate and every re-encountered candidate whose classification is stale/missing, using the exact `canReuseClassification` predicate already implemented. |
| `AreaRouteAnchorResolverService` | **WIRE** (exists, unused) | Becomes one of possibly several scope-resolution primitives — see §7 for whether it merges with `DestinationResolutionService` or stays separate. |
| `AreaRouteWalkAcquisitionService` | **REFACTOR (becomes one `AcquisitionStrategy`, not a special branch)** | Its internals (reuse-first check, classification wiring, `validationScope` construction) are exactly right and stay; what changes is that the *orchestrator* selects it via structured deficit data (`anchor.kind === 'area' or 'route'` AND requested facet `intent:walk`/`intent:route_like`), never via an `if (anchoredPlaces.length)` special case. |
| `rankAndSliceExperiences` (private method) / `selectBoundedWindow` | **DELETE** (after composition ships) | Named in the 2026-09-11 plan's deletion checklist; superseded by `ExperienceCompositionService`. |
| `candidate-window-selection.util.ts` | **DELETE** (after composition ships, confirm no other caller) | |
| `candidate-ranking.util.ts` | **REFACTOR or DELETE** — audit at implementation time whether any of its scoring building blocks are reused by `composition-set-cover.util.ts`; do not delete blindly (2026-09-11 plan's own instruction). |
| `composition-set-cover.util.ts`, `experience-composition.service.ts`, `must-anchor-placement.util.ts` | **BUILD (new, does not exist)** | Checkpoint C1–C5 of the 2026-09-11 plan, executed here as milestones M4–M5 (§8). |
| `PlanningCandidateNormalizerService` | **REFACTOR** | Gains `preferenceWeight`/`mustInclude` per C4; scheduling algorithm itself (`GreedyDailyPlanningSolver`) is untouched. |
| `GreedyDailyPlanningSolver`, `TourPlanningFeasibilityValidatorService` | **KEEP** | Final scheduling authority is unaffected; they just receive richer candidate metadata. |
| `TourCompletenessValidator` / `TourFormatCoverageValidator` | **REFACTOR** | Both are independent post-generation quality gates (not orchestration authority) per CLAUDE.md's own description; keep them, but confirm their own "requested theme/intent" matching also goes through `candidateMatchesPreferenceFacet` rather than a parallel heuristic — audit at implementation time (open question, §10). |
| generation trace v3 builders (`generation-trace-builder.util.ts`, `generation-trace-v2.ts` etc.) | **TEMPORARY ADAPTER for read compatibility, then KEEP as read-only** | Per the 2026-09-11 plan: legacy trace *rendering* compatibility must never be deleted (historical Tours still carry v1–v3 traces). Only trace *generation* for new Tours moves to v4. Removal step: none — this adapter is permanent by design, not a bridge to retire. |
| Frontend `GenerationBitacora.tsx` | **REFACTOR** | Adds native v4 rendering (C8) alongside existing v1–v3 compatibility rendering (kept, not removed). |
| Any transitional "legacy orchestrator" wrapper this plan might otherwise introduce | **NOT BUILT** | Per §1, no compatibility bridge is planned. If implementation discovers one is unavoidable for a single incremental milestone, it must be named explicitly with its own removal milestone before that code is written — see §8's milestone-exit rule. |

---

## 5. Answers to the required questions

**1. What service becomes the canonical preference-first orchestrator?**
`ExperienceGenerationService`, refactored in place (see Q2) — not a new
parallel class. `TourGenerationProcessorService` keeps calling
`experienceGenerationService.generateTourExperiences(tourId)`; only that
method's internals change, milestone by milestone.

**2. Should `ExperienceGenerationService` be replaced, renamed/refactored, or become a thin facade?**
**Refactored in place, kept as the same injected class** (optionally
renamed at the very end, once the cutover is fully complete and stable, to
reduce blast radius on every DI site during the incremental milestones — a
rename is cosmetic and can be its own final, trivial commit; it must not be
conflated with the behavioral cutover itself). A thin facade over a
*different* orchestrator class would itself be an indefinite bridge layer,
which §1 forbids without an explicit removal step; renaming the same class'
internals avoids ever creating that bridge in the first place.

**3. Where are normalized `PreferenceRequirements` built?**
`PreferenceSpec` (already specified, already has a builder) is that
normalized model — this plan does not introduce a second name/shape for the
same concept. Built once per generation, immediately after step 1
(`PreferenceInterpreterService.interpret`), via `buildPreferenceSpec` in
`preference-spec-builder.util.ts` (already exists, currently dead code).

**4. Where are `anchoredPlaces` consumed?**
Twice, both inside the new orchestrator, never inside `CoverageAnalyzer`'s
replacement's core matching logic (anchors are not a facet):
- **Scope resolution** (§7): an `area`/`route` anchor is resolved to real
  geometry once per generation and used to scope retrieval/validation for any
  deficit that names it.
- **Acquisition-strategy selection** (§6): the deficit resolver reads
  `PreferenceSpec.anchors` alongside `PreferenceSpec.facets` to decide
  whether an unmet deficit should route through the AREA/ROUTE/WALK strategy.
  A resolved venue `must` anchor separately forces inclusion in composition
  (§12.3 of the design spec) — unrelated to acquisition-strategy selection.

**5. How does the system distinguish AREA-scoped simple preferences, requested walk, requested route-like, and generic theme preferences?**
By the **combination** of `PreferenceSpec.anchors[].kind` and
`PreferenceSpec.facets` — never by anchor presence alone. Concretely, for
each unmet facet deficit, the acquisition-strategy selector asks:

```text
does this deficit's facet key ∈ {intent:walk, intent:route_like}?
  AND does PreferenceSpec.anchors contain an area/route anchor
      relevant to this destination scope?
    → yes to both: AREA/ROUTE/WALK strategy (AreaRouteWalkAcquisitionService)
    → anchor present, walk/route_like NOT requested: ordinary acquisition,
      scoped/filtered to the resolved anchor geometry when retrieving/
      validating candidates, but never routed through the walk-specific
      primitive
    → walk/route_like requested, no anchor: ordinary acquisition with a
      `walk`/`route_like` facet deficit like any other theme/intent —
      B5's primitive is anchor-driven, not intent-driven alone, so this
      case is NOT expected to synthesize a citywide walk; it remains a
      normal (likely EXPECTED_B6_GAP-flavored) generic deficit
    → neither: ordinary generic acquisition
```

Worked examples (answering the authorization's explicit test cases):

```text
"caminata histórica por San Telmo"
  anchors: [{kind:area, rawName:"San Telmo", priority:must}]
  facets:  [{theme:history}, {intent:walk}]
  → San Telmo intent:walk deficit routes through AREA/ROUTE/WALK strategy

"museos de San Telmo"
  anchors: [{kind:area, rawName:"San Telmo", priority:must}]
  facets:  [{theme:museum-ish / intent:visit — exact facet key per interpreter}]
  → no walk/route_like facet requested
  → San Telmo anchor scopes retrieval/acquisition geographically
    (AREA-scoped, via the resolved anchor geometry) but never invokes
    AreaRouteWalkAcquisitionService — no walk is manufactured

"quiero comer en San Telmo"
  anchors: [{kind:area, rawName:"San Telmo"}]
  facets:  [{theme:food} or {intent:food}]
  → same as above: AREA-scoped generic acquisition, no walk strategy
```

**6. How are multiple anchors represented and satisfied?**
`PreferenceSpec.anchors: AnchoredPlace[]` already supports a list (the
design's own D5 note on "multiple relevant anchors" and B5's own documented
mode-D non-goal: a single-anchor primitive is simply not invoked when 2+
relevant anchors exist for one deficit — this plan does not change that
scope; multi-anchor AREA/ROUTE/WALK acquisition remains a documented,
separate follow-up, consistent with B5's own plan).

**7. When does catalog retrieval happen?**
Immediately after `PreferenceSpec` is built and destination/anchor scope is
resolved (steps 3–4 of §3) — **before** any acquisition call, matching
invariant #1 ("preference-first, not catalog-first" is about not starting
from a broad geographic pool; it does not mean skipping the catalog — it
means retrieval is the very first thing that happens, per real facet, and
acquisition only fires for what retrieval could not satisfy).

**8. How is a requirement considered strongly satisfied?**
Exactly the A5/A6 policy already implemented and unit-tested:
`candidateMatchesPreferenceFacet` match + ≥1 resolved component with real
geography + quality floor + non-degraded classification. This plan does not
change that predicate; it wires it into the orchestrator for the first time.

**9. How are deficits represented?**
`FacetCandidates`/`PortfolioSufficiency` (already specified in the 2026-09-11
plan's "Target shapes and helpers" section) — this plan reuses those
interfaces verbatim rather than inventing new deficit types.

**10. How is the acquisition strategy selected for each deficit?**
See Q5. A new, small `AcquisitionStrategySelector` (pure function, new file
`acquisition-strategy-selector.util.ts`) takes one `FacetCandidates` deficit
plus `PreferenceSpec.anchors` and the resolved anchor-geometry map, and
returns one of: `AREA_ROUTE_WALK`, `GENERIC`. This is the ONLY place
anchor-kind/intent combination logic lives — never duplicated inline inside
the orchestrator's acquisition loop.

**11. How do B5 results re-enter the same canonical catalog/coverage loop?**
`AreaRouteWalkAcquisitionService.acquireOrReuse(...)` already returns
`{outcome: 'reused'|'acquired'|'no_result', experienceId?}`. The orchestrator
treats this identically to a generic acquisition pass's outcome: on
`acquired`/`reused`, it re-runs `FacetRetrievalService` for the affected
facet(s) against the now-updated catalog (the SAME retrieval call every
other strategy triggers), so there is exactly one coverage-recomputation
path regardless of which strategy ran.

**12. How does generic acquisition converge through the same classification, identity and persistence boundary?**
Via §6: classification moves from being B5-only logic into
`ExperienceProposalResolverService`'s own materialization path (or an
immediately-adjacent, always-invoked step it calls), so every strategy's
accepted candidates pass through it identically.

**13. Where does evidence-only classification occur?**
Inside the shared materialization boundary (§6), grouped by canonical
`experienceId` exactly as `AreaRouteWalkAcquisitionService` already does it
(union of evidence keys across candidates converging to the same canonical
id, classify once) — that per-canonical-id grouping logic is extracted into
a shared helper both the generic path and the AREA/WALK path call, rather
than duplicated.

**14. How does existing classification get reused?**
`canReuseClassification(metadata, CURRENT_PROMPT_VERSION)` — already
implemented, already correct (proven by the identity gate's own review
rounds this session) — called unconditionally before any classification
LLM call, in the shared boundary, for every candidate regardless of
strategy.

**15. What happens to existing unclassified Experiences?**
Two real options exist; recommendation below, but this is exactly the kind
of decision the authorization says must be evaluated against the current
architecture rather than assumed:

```text
Option A — lazy backfill on next encounter (RECOMMENDED default):
  an existing unclassified/stale row encountered again by retrieval or
  materialization is classified at that point, using whatever evidence is
  already attached to it (ExperienceEvidence rows), then persisted —
  no separate migration job required, consistent with D2's existing
  "classify an existing row if missing/stale" rule.

Option B — one-time batch backfill command:
  a nest-commander script (mirroring `classify-eval.command.ts`'s shape)
  that classifies every currently-VERIFIED, unclassified Experience once,
  ahead of the cutover, so warm-reuse works from the very first post-
  cutover request instead of the first time each row is re-encountered.
```

This plan recommends **A as the mandatory mechanism** (it is required
anyway, for any row the shared boundary re-touches) **plus B as an optional,
separately-authorized one-time operational script** if a warm start is
desired for already-large catalogs (e.g. the normal dev DB, not the spike
DB). B is explicitly NOT required for cutover correctness and is not part
of the milestone sequence in §8 unless separately requested.

**16. How does warm reuse prevent external rediscovery?**
`FacetRetrievalService`'s retrieval step (§3, step 4) runs BEFORE any
acquisition-strategy call. If it returns ≥1 strong match for a facet, that
facet's deficit never enters the acquisition loop at all for this request —
no SerpAPI, no extraction LLM, no persistence attempt. This is the structural
fix to RW1's confirmed anti-pattern: `CoverageAnalyzer` was capable of a
catalog-first check too (`db_search` did find 65 rows on RUN 2), but its
*intent* deficit could never be satisfied by anything in the catalog because
nothing there was ever classified — classification (§6/Q13) is what makes
this retrieval step's "strong match" outcome actually reachable for
intent-based facets going forward.

**17. How is the old generic acquisition sequencing removed?**
Only after milestone M4 (§8) proves the new composition/retrieval path
produces equivalent-or-better selections on the existing large-corpus
acceptance suites. `CoverageAnalyzer`, `selectBoundedWindow`,
`rankAndSliceExperiences` and `theme-matching.util.ts` are deleted in
milestone M7, guarded by a compile-time import search (no remaining
callers) plus the full test suite passing without them.

**18. How is destination/AREA scope resolution unified or clearly separated?**
See §7 — recommendation: **unify** into one canonical scope-resolution
boundary, not left as two contradictory AREA concepts indefinitely.

**19. Which legacy methods become unreachable/deleted after cutover?**
`CoverageAnalyzer.analyze` and its private keyword-matching helpers,
`rankAndSliceExperiences`, `selectBoundedWindow`, `theme-matching.util.ts`'s
exports once no caller remains (§4/§9).

**20. What temporary adapters, if any, are required and exactly when are they removed?**
**None are planned.** The one candidate that might look like an adapter —
keeping legacy trace-v1–v3 *rendering* compatibility — is explicitly a
permanent read-compatibility feature per the 2026-09-11 plan (historical
Tours must remain viewable), not a bridge over live orchestration, so it has
no removal step by design (§4 table). If a genuine transitional adapter
turns out to be unavoidable for keeping the repo buildable mid-milestone
(§8's own compilability requirement), it must be added to this document with
an explicit removal milestone before it is written — this plan does not
pre-authorize an unnamed one.

---

## 6. Shared canonical materialization pipeline

Answering "is `ExperienceProposalResolverService` the correct convergence
boundary, or must responsibilities be refactored":

**It is the correct boundary for resolution, geographic validation and
persistence.** It is **not yet** the correct boundary for classification,
because classification currently lives only inside
`AreaRouteWalkAcquisitionService`'s own post-acquisition step, not inside
`ExperienceProposalResolverService.resolve()`/
`ExperienceAcquisitionService.materializeExecution()` themselves. The fix is
structural, not a new resolver:

```text
ExperienceAcquisitionService.materializeExecution(execution, context)
  → ExperienceProposalResolverService.resolve(candidates, context)
      → per accepted candidate: entity resolution → geographic validation
        → ExperienceCatalogService.persistVerifiedExperience(...)
      → NEW: after resolve() returns, materializeExecution groups its own
        accepted results by canonical experienceId (the exact grouping
        logic AreaRouteWalkAcquisitionService already implements — extract
        it into a shared helper, e.g. `classifyAcceptedResultsByExperience`
        in a small new util) and classifies each canonical id exactly once,
        using the union of that id's converged candidates' evidenceKeys
      → this makes materializeExecution itself the single place EVERY
        acquisition strategy's output gets classified, not a per-strategy
        opt-in
```

`AreaRouteWalkAcquisitionService` then **removes its own duplicate
classification step** (§4 — this is a real behavior change to existing,
tested code, and must ship with its own updated tests proving classification
still happens exactly once per canonical id, now performed by the shared
boundary instead of by the caller).

No second resolver is created. No parallel persistence path is created for
"preference-first" candidates as distinct from "legacy" candidates — there
is only ever one acquisition executor from this point on.

---

## 7. Destination / AREA scope resolution — recommend unification

`DestinationResolutionService` and `AreaRouteAnchorResolverService` currently
implement two independently-maintained, behaviorally-different real-boundary
resolution paths against the same real provider (Nominatim):

```text
DestinationResolutionService
  accepts: addresstype ∈ {city, town, village} only
  used for: the whole-trip destination scope (radius fallback, 25km observed)

AreaRouteAnchorResolverService
  accepts: any real way/relation Nominatim returns (no addresstype filter)
  used for: B5's area/route anchors — never called live today
```

RW1 directly demonstrates the cost of the split: San Telmo (`addresstype:
suburb`) fails `DestinationResolutionService`'s check and degrades to a
25km point, while the SAME real Nominatim result would have satisfied
`AreaRouteAnchorResolverService`'s more permissive acceptance.

**Recommendation: unify into one canonical scope-resolution primitive.**
Concretely:

1. Extract `AreaRouteAnchorResolverService.resolveArea`'s acceptance logic
   (any real way/relation, not just city/town/village) as the canonical
   "resolve a named place to real geometry" primitive.
2. `DestinationResolutionService` calls that same primitive for the
   whole-trip destination instead of its own narrower addresstype filter,
   with its point+radius path becoming the true fallback only when
   Nominatim genuinely returns nothing resolvable (not merely "resolvable
   but not city-shaped").
3. `AreaRouteAnchorResolverService` keeps its own name/class as the
   anchor-specific caller (it also owns the `GeoEntity` upsert + geometry
   return contract B5's `ExperienceValidationScope` needs, which
   `DestinationResolutionService` does not currently produce) — this is a
   shared-primitive extraction, not a service merge that changes either
   class's public contract more than necessary.

This is included as milestone M3.5 (§8) rather than folded silently into
destination resolution's existing behavior, because widening
`DestinationResolutionService`'s acceptance criteria is itself a real,
observable behavior change (more requests will get area-scale destination
treatment than before) that deserves its own tests and its own commit,
separate from the orchestration cutover itself. If, once implementation
begins, the two services' contracts turn out too different to share cleanly
(e.g. destination resolution needs country-level disambiguation the anchor
resolver doesn't), this milestone documents that as a discovered
architectural finding and keeps them separate with a written justification
— it does not silently proceed with two contradictory AREA concepts either
way.

---

## 8. Milestones

Each milestone ends with a buildable, fully green (`typecheck`, `lint:check`,
`test`, `test:integration`) repository. No milestone may leave the live path
in a partially-cut-over state across a commit boundary — the orchestrator
either still fully owns the old flow or fully owns the new one at every
point where CI could run.

```text
M0  Call-graph audit (this document) — DONE, no code
M1  PreferenceSpec wired: interpreter → buildPreferenceSpec → orchestrator
    reads real PreferenceSpec, still delegates matching/acquisition to the
    OLD CoverageAnalyzer/acquisition loop underneath (a real, verified
    intermediate step, not a bridge left in place past M2)
M2  FacetRetrievalService + preference-sufficiency.util.ts replace
    CoverageAnalyzer as the sufficiency/deficit authority; acquisition loop
    still calls the existing generic acquisition path only (no strategy
    selector yet) — proves canonical facet matching end-to-end before
    touching acquisition routing
M3  AcquisitionStrategySelector + wiring PreferenceSpec.anchors into
    ExperienceAcquisitionPlannerService's existing `anchors` field;
    AreaRouteWalkAcquisitionService becomes reachable as one strategy
M3.5 Destination/anchor scope-resolution unification (§7)
M4  Shared canonical materialization classification (§6): classification
    moves into ExperienceProposalResolverService/materializeExecution;
    AreaRouteWalkAcquisitionService's own classification step is removed
    and its tests updated
M5  Checkpoint C composition: composition-set-cover.util.ts,
    ExperienceCompositionService, must-anchor-placement.util.ts (C1-C5
    of the 2026-09-11 plan, executed here) replace
    rankAndSliceExperiences/selectBoundedWindow
M6  Planner-candidate contract (C4): preferenceWeight/mustInclude wired
    through PlanningCandidateNormalizerService; duration-aware backfill
    (C5b)
M7  Delete superseded legacy pieces (§4/§9): CoverageAnalyzer,
    selectBoundedWindow, candidate-window-selection.util.ts,
    theme-matching.util.ts (confirm zero remaining callers first)
M8  Trace v4 (C7) + Bitácora v4 (C8)
M9  Full verification matrix (backend + frontend), large-corpus acceptance
    adapted to preference-first semantics (D4), Test L (no-dual-pipeline
    architectural check, §10) added and green
M10 RW1 RERUN (authorization required separately — see §11)
```

M1–M2 are the two milestones most likely to reveal that
`ExperienceGenerationService`'s existing internal structure needs deeper
surgery than a clean drop-in replacement (e.g. shared local variables between
the old coverage loop and the ranking/planning code that follows it) — if so,
that discovery gets documented as an amendment to this plan rather than
worked around silently.

---

## 9. Files expected to change

**New:**
- `be/src/modules/tours/utils/acquisition-strategy-selector.util.ts` (§5 Q10)
- `be/src/modules/tours/utils/experience-materialization-classification.util.ts` (§6 shared grouping helper, extracted from `AreaRouteWalkAcquisitionService`)
- `be/src/modules/tours/utils/composition-set-cover.util.ts` (C2, already named in 2026-09-11 plan)
- `be/src/modules/tours/services/experience-composition.service.ts` (C3)
- `be/src/modules/tours/utils/must-anchor-placement.util.ts` (C5)
- `be/src/modules/tours/utils/generation-trace-v4.util.ts` (or equivalent — C7)
- (optional, §5 Q15) `be/src/commands/scripts/commands/classify-backfill.command.ts`

**Modified:**
- `be/src/modules/tours/services/experience-generation.service.ts` (the cutover itself, across M1–M8)
- `be/src/modules/tours/services/experience-acquisition-planner.service.ts` (finally receives real `anchors`)
- `be/src/modules/tours/services/experience-acquisition.service.ts` (finally passes `validationScope`/`validationIntent`)
- `be/src/modules/tours/services/experience-proposal-resolver.service.ts` / `materializeExecution` (classification wiring, §6)
- `be/src/modules/tours/services/area-route-walk-acquisition.service.ts` (remove now-duplicate classification step)
- `be/src/modules/tours/services/destination-resolution.service.ts` (§7, M3.5)
- `be/src/modules/tours/services/area-route-anchor-resolver.service.ts` (§7, extract shared primitive)
- `be/src/modules/tours/services/planning-candidate-normalizer.service.ts` (C4)
- `be/src/modules/tours/tours.module.ts` (register `FacetRetrievalService`, `ExperienceCompositionService`, etc.)
- `fe/components/tour-details/GenerationBitacora.tsx` (C8)

**Deleted (M7, guarded by import-search):**
- `be/src/modules/tours/services/coverage-analyzer.service.ts` (+ its spec)
- `be/src/modules/tours/utils/candidate-window-selection.util.ts` (+ its spec)
- `be/src/modules/tours/utils/theme-matching.util.ts` (+ its spec, if no other caller)
- `rankAndSliceExperiences` private method in `experience-generation.service.ts`

---

## 10. Open architectural questions this plan cannot resolve from existing docs/code alone

1. **`TourCompletenessValidator`/`TourFormatCoverageValidator`'s own matching
   primitive.** Not fully audited in this pass — if either implements its
   own keyword/heuristic matching independent of
   `candidateMatchesPreferenceFacet`, that is a second hidden semantic engine
   the design's invariant #2 also forbids, and would need its own
   REFACTOR entry. Flagged for audit at M2/M9, not resolved here.
2. **`candidate-ranking.util.ts`'s exact fate.** Some of its scoring
   primitives may be legitimately reusable inside
   `composition-set-cover.util.ts`'s within-facet ordering (§12.2 of the
   design doc); this needs a read of that file's current contents at M5
   implementation time, not a decision made sight-unseen in this planning
   pass.
3. **Whether `DestinationResolutionService`/`AreaRouteAnchorResolverService`
   unification (§7) is fully compatible** — flagged as a real risk in §7
   itself, with an explicit fallback (documented separation) if the two
   contracts prove incompatible.
4. **Exact place for `AcquisitionStrategySelector` multi-anchor behavior**
   (§5 Q6) beyond "not invoked for 2+ anchors" — B5's own mode-D non-goal
   is inherited as-is; a genuine multi-anchor AREA/ROUTE/WALK capability
   remains unscoped future work, not part of this cutover.

---

## 11. Spike regression

Per this task's authorization: after this plan's implementation completes
(through at least M9), **RW1 must be rerun before RW2 is authorized.**
Expected outcomes:
- `ORCHESTRATION_GAP` must not recur for the San Telmo case specifically —
  the orchestrator must now at least attempt the AREA/ROUTE/WALK strategy
  and reach real geographic validation against San Telmo's real boundary.
- A residual `EXPECTED_B6_GAP` (extraction/composition still cannot
  establish a real composed walk from available evidence) is an acceptable,
  valuable outcome — it means the cutover succeeded at reaching the correct
  primitive, and what remains is B6's own territory.
- If cold materializes a real canonical walk Experience, the warm rerun
  must prove true catalog reuse per the already-hardened §7a contract in
  the spike-gate plan (no SerpAPI/extraction-LLM/persistence-attempt on the
  second request) — not merely a repeated matching ID.

RW2–RW6 remain explicitly blocked on this cutover, per this task's own
authorization; this plan does not request or assume authorization to run
them.

---

## 12. Mandatory tests (see the authorization's test list A–L)

Tests A–K are already specified, near-verbatim, across the 2026-09-11 plan's
Checkpoint A/B/C/D task sections (each task in §8's milestones references
its originating Checkpoint task) — this plan does not duplicate that list.
The genuinely new addition is:

### Test L — No dual-pipeline regression

A new architectural-boundary test,
`be/test/architecture/single-orchestration-owner.architecture-spec.ts`
(new test category/directory — no existing harness fits this), asserting:

1. `TourGenerationProcessorService` has exactly one code path to Experience
   generation — a static/import-graph assertion (e.g. via a dependency-graph
   check or a straightforward source-text assertion that
   `generateTourExperiences` is the only method it calls) that a future
   contributor cannot silently add a second conditional call path (e.g. "if
   request has anchors, call serviceB instead").
2. A live-style test (real Postgres, faked external transports) that issues
   two structurally different requests in the same run — one with an
   area+walk anchor, one purely generic (no anchors, plain theme facets) —
   and asserts both traces show the identical `version: 4` trace shape,
   identical stage sequence (`preference_interpretation` →
   `facet_retrieval` → ... → `composition` → `planning`), and that neither
   produces a `version: 3` trace or any stage name unique to the legacy
   path (`coverage_analysis` in its old shape, `db_search`'s old reason
   codes). This directly encodes "walk → new pipeline, history → legacy
   pipeline" as a failing condition rather than an assumption.
3. `CoverageAnalyzer`/`selectBoundedWindow`/`theme-matching.util.ts` are
   asserted absent from the compiled call graph once M7 ships (this
   specific sub-assertion is only meaningful after M7 and should be added
   then, not before — added here as a placeholder milestone-exit check).

---

## 13. Non-negotiable invariants this plan must not violate (carried over)

Restated from the design spec and this task's authorization, because an
implementer reading only this file should not need to reconstruct them from
memory:

- No fallback to legacy orchestration on new-path failure — a failure in the
  new orchestrator is a real, surfaced failure (retryable per the existing
  outbox/`classifyGenerationFailure` semantics), never a silent revert to
  the old flow for that one request.
- User preferences never become classification evidence (identity/
  classification boundary already correct; this cutover must not blur it
  while wiring classification into a new call site).
- Identity/dedupe policy is not touched by this plan.
- Geographic validation thresholds are not weakened by this plan.
- No manual classification of existing rows outside the documented lazy/
  batch mechanisms in §5 Q15.
