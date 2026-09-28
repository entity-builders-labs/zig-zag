# Travel Content + Agentic Planning — Convergence Roadmap

Status: **canonical roadmap, rewritten for the Preference-First branch reality**. Docs-only.  
Originally written: 2026-09-09.  
Canonical rewrite: 2026-09-14.  
Current branch of record for the tour engine: `feat/preference-first-selection`.

This document replaces the obsolete sequencing that treated `feat/experience-domain-v2` as the branch to merge back into before agentic convergence. Git history established the opposite: `feat/preference-first-selection` is a descendant of `feat/experience-domain-v2` and has become the active, forward-moving tour-engine line. `feat/experience-domain-v2` is now historical ancestry, not an integration target.

The current through-M10 implementation authority remains:

- `docs/superpowers/plans/2026-09-14-preference-first-m5-to-m10-master-implementation.md`
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

This roadmap begins where that work leaves off and defines the convergence path to the autonomous product.

---

## 1. Branch reality and ownership

### `feat/experience-domain-v2`

Historical base for the Experience-domain architecture and multi-source acquisition work.

It is **not** the branch that Preference-First must merge back into. Do not create an artificial merge-back solely to satisfy the old roadmap. Its useful domain contracts already flowed forward into `feat/preference-first-selection`.

Treat it as:

```text
historical ancestor / reference
```

not:

```text
future canonical base
```

### `feat/preference-first-selection`

This is the active canonical tour-engine branch.

It owns the live convergence of:

- `PreferenceSpec`;
- facet-first catalog retrieval;
- sufficiency/deficits;
- multi-source acquisition;
- canonical resolve/validate/classify/dedupe/persist;
- grounded multi-component Experience handling;
- deterministic composition;
- semantic similarity as ranking-only;
- evidence-backed exploration ranking;
- MUST/SOFT anchors;
- duration-aware planner/backfill;
- trace v4;
- Bitácora v4;
- single live orchestration ownership.

After the Preference-First acceptance and real-world gates close, this branch — or a direct descendant of its accepted HEAD — is the base for agentic convergence.

### `feat/agentic-travel-planning`

This branch contains useful agentic work developed against an older tour-engine state. Preserve the **capabilities**, not its obsolete domain/acquisition internals.

Known valuable concepts include:

- `AgentPolicy`;
- `AgentState` and decision/tool-execution trace;
- request interpreter;
- `ToolRegistry`;
- `TravelPlanningAgent` bounded loop;
- deterministic planner invocation concept;
- CLI/test harnesses where still useful.

Its old `research_gap` provider path is a bridge implementation, **not** the future acquisition architecture.

Do not merge the branch wholesale into the canonical tour engine and thereby reintroduce stale catalog/acquisition/provider behavior.

### `feat/unified-agentic-travel-planning`

As of the 2026-09-14 remote audit, this branch was not present on `fork`. If a local/worktree-only version exists, inspect it before recreating anything and preserve any unique useful agentic work.

When convergence begins, create or recreate the unified branch **from the accepted Preference-First base**, not from `feat/experience-domain-v2` and not from the stale agentic branch.

---

## 2. Canonical high-level sequence

```text
Component-resolution / RW1 milestone COMPLETE
        ↓
Experience dedupe policy correction
        ↓
focused deterministic regression + live rerun
        ↓
RW2–RW6 real-world generalization
        + extractor reliability evidence
        + tour-quality evidence
        + structural performance accounting
        ↓
PREFERENCE-FIRST CORE CLOSED
        ↓
create/recreate unified agentic branch
FROM accepted Preference-First HEAD
        ↓
port useful agent capabilities selectively
        ↓
adapt tools to canonical Preference-First APIs
        ↓
remove old agent research/acquisition authority
        ↓
unified Agentic E2E
        ↓
AUTONOMOUS PREFERENCE-FIRST TOURS
        ↓
post-convergence product capabilities
```

There is no required `preference-first → experience-domain-v2 → unified` detour.

The component-resolution milestone is complete and stays closed unless a real
regression invalidates an accepted invariant. The immediate post-milestone
gate is the Experience-dedupe policy defect observed live in RW1, not more
component-resolution work.

---

# 3. Gate A — Experience dedupe policy correction

Status: **DONE**. The deterministic policy correction landed in
`d6f060344073eba101f16ee8ebc1a798a9aed378`
(`fix(tours): separate membership from experience identity`). Shared
standalone/composite membership no longer creates `AMBIGUOUS` by itself;
same-Experience duplicate behavior remains covered. This gate does not reopen
component-resolution.


The immediate deterministic product bug is in:

`be/src/modules/tours/utils/experience-dedupe.util.ts`

Current component overlap uses:

```text
intersection / max(left.size, right.size)
```

and `componentOverlap >= 0.5` can enter `AMBIGUOUS`. This makes a valid
standalone Experience and a valid two-component Experience collide:

```text
[A] vs [A,B]
→ overlap = 1/2
→ AMBIGUOUS
→ fail closed
```

RW1 Stage 5 observed both persistence orders:

- composite first, standalone lost;
- standalone first, complete CGV-accepted composite lost.

That means the final catalog depends on component cardinality and persistence
order rather than Experience identity.

Canonical principle:

```text
shared GeoEntity membership != Experience identity
GeoEntity existence != Experience existence
component membership != standalone Experience authority
```

A GeoEntity may legitimately participate in many Experiences. In particular,
these must be able to coexist:

```text
Experience("Visit Plaza Dorrego")
components = [Plaza Dorrego]

Experience("San Telmo Historical Walk")
components = [Plaza Dorrego, Mercado]
```

Do **not** fix this by changing `0.5` to another arbitrary threshold.
Partial component-set containment alone must not imply `SAME` or
`AMBIGUOUS`.

Required regression matrix:

```text
[A] then [A,B]       → both coexist
[A,B] then [A]       → same final catalog result

[A] vs [A,B,C]       → same semantics

same [A] vs same [A]
→ existing duplicate logic preserved

same [A,B] vs same [A,B]
→ existing duplicate logic preserved

partial overlap between two genuine composites
→ preserve current policy unless real evidence requires change
```

Required invariant:

```text
Persistence order must not change the final catalog result.
```

This correction should stay small and policy-focused. It must not reopen the
closed component-resolution milestone or trigger a broad dedupe rewrite.

---

# 4. Gate B — focused regression after dedupe correction

Status: **DETERMINISTIC REGRESSION COMPLETE; LIVE RE-CONFIRMATION
INCONCLUSIVE DUE TO EXTRACTION VARIANCE**.

The deterministic matrix is green. A bounded three-run live re-confirmation
was executed, but no run emitted the standalone+composite shape required to
exercise the corrected live dedupe path. The live result therefore remains
observationally inconclusive and does **not** invalidate the deterministic
fix. Extractor/provider reliability is the active upstream evidence track.


After the policy correction:

1. run the deterministic dedupe regression matrix;
2. rerun the affected RW1 live shape against the current architecture;
3. prove standalone and two-stop composite coexist in either persistence order;
4. prove exact duplicate behavior still works for identical single and
   identical composite Experiences;
5. verify no correctness invariant was weakened to obtain the pass.

The goal is not another broad San Telmo campaign. It is a bounded proof that
the observed COLD-1/COLD-4 order-dependent catalog defect is gone and that
existing same-Experience dedupe still behaves as intended.

Only after this focused gate is accepted should broad RW2–RW6 generalization
resume.

---

# 5. Gate C — RW2–RW6 real-world generalization + evidence tracks

Execute the remaining real-world corpus defined by:

`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

Do not replace the corpus with easier variants of RW1.

The purpose of RW2–RW6 is to demonstrate generality across different failure
modes, including:

- multi-area / cross-neighborhood research;
- real route-like geography;
- destination-specific tourism structures such as wine/regional routes;
- a foreign-city case using the correct non-Argentina geographic providers;
- a negative anti-fabrication case where real nearby POIs exist but source
  evidence does **not** prove a composed walk/route.

Mendoza SIMPLE/COMPOSITE/MIXED evidence already exists under:

`spikes/stage3-simple-composite-mixed-2026-09-23/`

Historical findings such as Google Places radius behavior above 50 km,
route-like routing behavior, or a route candidate ending in `NO_OSM_MATCH`
remain evidence from the architecture that produced them. They must **not** be
described automatically as current bugs; re-run against current HEAD before
promoting them to current-state findings.

The negative case is as important as a positive case. Zig-Zag must be able to
conclude:

```text
I found real places, but I did not find evidence for a real composed Experience.
```

It must not manufacture a plausible route from proximity.

### 5.1 Extractor reliability characterization

Status: **ACTIVE CURRENT EVIDENCE TRACK**.

Stage 5 originally observed:

```text
2 of 9 web extraction passes emitted candidates
```

That remains an observed historical sample, **not** a demonstrated success
rate. The post-dedupe bounded live rerun then produced no qualifying composite:
two runs were blocked by Groq output-token capacity and one had successful
Serper grounding but semantic-empty extraction. That moved extractor
reliability from a secondary observation to an explicit controlled
characterization track.

#### Frozen Run-3 replay

The exact Run-3 discovery requests and normalized evidence are frozen under:

`spikes/extractor-reliability-run3-replay-2026-09-25/`

The corpus contains:

- `case-a`: walk-focused pass, 10 evidence items;
- `case-b`: history-focused pass, 10 evidence items;
- `single-evidence`: the strongest TripAdvisor evidence item only.

This boundary deliberately removes Serper, DB, geography, planner and tour
generation from the experiment:

```text
frozen ExperienceDiscoveryRequest
+ frozen ExperienceGroundedSearchResult
        ↓
shared extraction prompt
        ↓
selected discovery extractor/model
        ↓
existing deterministic parser + source-support gate
```

#### Groq/Qwen findings

For `qwen/qwen3.8-27b`:

- baseline temperature `.7` produced stochastic
  `CANDIDATE / NO_CANDIDATE / INVALID_JSON` outcomes from identical frozen
  input;
- production-style `max_completion_tokens=4096` can exceed the Groq
  on-demand OTPM allowance;
- `max_completion_tokens=900` is sufficient for the complete known
  three-component candidate and removes that request-size blocker;
- lowering the token budget alone did not repair semantic yield;
- `temperature=0` produced two clean byte-identical single-evidence
  candidates before the third logical call hit Groq's 200k TPD limit;
- therefore temperature is a **provisional major variance signal**, not yet a
  completed conclusion.

Keep distinct:

```text
OTPM request-size blocker
TPM soft retry
TPD daily exhaustion
semantic empty
invalid model output
```

They are not interchangeable failure classes.

#### Cloudflare provider isolation

Cloudflare Workers AI is now a fourth first-class
`DISCOVERY_EXTRACTOR_PROVIDER` beside Gemini, Groq and Ollama. The first
Cloudflare characterization intentionally uses
`@cf/qwen/qwen3.8-27b` so provider transport can be compared without changing
the model family. The model remains configurable through
`CLOUDFLARE_DISCOVERY_MODEL`.

Live smoke characterization found that this Cloudflare Qwen deployment is a
reasoning variant: with the 900-token budget it consumed the completion in
`message.reasoning`, returned `content=null`, and stopped by length.
`reasoning_effort=low` did not change that behavior.
`chat_template_kwargs: { enable_thinking: false }` did: the model emitted the
JSON answer in `message.content` and stopped normally. The content is wrapped
in a ```json` fence, which the provider now normalizes before the existing
JSON/parser boundary. No Cloudflare-specific semantic prompt or parser was
introduced.

The frozen `single-evidence ×5` run recorded in
`spikes/cloudflare-discovery-x5-single-evidence-2026-09-26/` produced:

| outcome | count |
| --- | ---: |
| CANDIDATE | 4 |
| NO_CANDIDATE | 0 |
| INVALID_JSON | 0 |
| PROVIDER_FAILURE | 1 (60s timeout) |
| HTTP 429 | 0 |

All four successful raw contents are byte-identical and produce the same
ordered composition:

```text
San Telmo Walking Tour
→ Lezama Park
→ Plaza Dorrego
→ El Mercado de San Telmo
```

All three components are source-supported. Successful Cloudflare latency was
approximately 22–40 seconds; the fifth call timed out at 60 seconds. The small
successful Groq temperature-0 sample was roughly 1.5 seconds.

This supports **strong output determinism conditional on Cloudflare success for
this one fixture**, but it does **not** establish 5/5 provider reliability and
must not be extrapolated to all extraction inputs.

#### Next characterization steps

1. Keep the timeout as an operational signal; do not hide it by arbitrarily
   increasing the timeout without evidence.
2. Run `case-b ×5` next if continuing Cloudflare characterization.
3. Run `case-a` only if it remains informative after `case-b`.
4. Benchmark alternate Cloudflare models later through
   `CLOUDFLARE_DISCOVERY_MODEL` using the same frozen corpus.
5. Treat automatic provider fallback as a separate policy/observability task;
   no fallback is currently implemented.
6. Re-attempt the bounded live dedupe confirmation only when extraction emits
   the qualifying standalone+composite shape.

RW2–RW6 should continue to record, per relevant pass:

```text
usable evidence available?
extractor candidate produced?
well-formed empty response?
invalid/unrecognized envelope?
provider failure class?
candidate component set?
candidate quality?
```

The purpose remains to identify where useful evidence is lost or transformed,
not to force a candidate out of every source response.

### 5.2 Tour-quality evidence

Canonical correctness is necessary but not sufficient:

```text
verified != good recommendation
verified != good tour
```

The system already evaluates factual correctness, identity and geography
aggressively. Generalization must begin collecting product-quality evidence
for:

- relevance;
- touristic value;
- preference satisfaction;
- shape correctness;
- diversity;
- redundancy;
- feasibility.

Start with a small human-reviewed representative corpus (roughly 20–30
requests is a reasonable characterization size). Do not require a single
aggregate numeric score or a complicated feedback system before learning from
that corpus.

### 5.3 Performance characterization

Keep performance evidence separated into:

```text
STRUCTURAL
ENVIRONMENTAL
UNKNOWN UNTIL PRODUCTION-SHAPED BENCHMARK
```

Structural examples include provider/component fanout, sequential dependencies,
repeated resolution work and routing-call volume.

Environmental examples include free-tier/development quotas, public/shared
endpoints, local Docker/Postgres/OSM, cache-disabled test configurations,
timeouts and retries.

The current `260–374s` / roughly `400s` COLD spike timings are real
development evidence but are **not** demonstrated production-latency
predictions.

The independent post-milestone review observed roughly `124` Geoapify routing
calls in a run. Treat that as a characterization candidate, not an immediate
optimization mandate. Establish:

- whether they are actual HTTP calls;
- batching behavior;
- parallel vs sequential execution;
- cacheability by origin/destination pair + mode;
- provider cost;
- measured latency contribution.

Only production-shaped benchmarking can answer the remaining production
latency/cost question.

### 5.4 Repeated failed-resolution work

WARM evidence shows that some unresolved hints are acquired/resolved again.
Preserve this as a finding; do not jump directly to generic negative caching.

Failure knowledge has different semantics:

```text
PROVIDER_FAILURE
→ never negative knowledge

NO_CANDIDATE_ACQUIRED
→ may be temporary

AMBIGUOUS
→ may improve with new evidence

IDENTITY_REJECTED
→ may have stronger negative value but still needs policy
```

Any future failure-memory design must be typed, reason-aware and
TTL/expiry-aware.

### 5.5 Baseline red suites and CI signal

The component-resolution milestone closed with known baseline failures:

```text
unit:
preference-first-architecture

integration:
2x acquisition-degradation
canonical-orchestration
```

`preference-first-architecture.spec.ts` is source-text/regex based and still
catches `destinationBoundary` in the resolver. A permanently red suite
degrades CI signal.

Clean this up soon:

```text
either make the architecture test meaningful and green
or replace/remove the stale assertion
```

Apply the same standard to stale integration baselines. The operational goal
is simple:

```text
green means green
```

### 5.6 Catalog freshness and correction lifecycle

The shared catalog is cumulative knowledge and will eventually need explicit:

- provenance;
- freshness;
- reverification;
- identity correction;
- merge;
- supersession;
- stale-fact lifecycle.

`verifiedHintNames` is append-only after an externally VERIFIED identity. It
does **not** grow once per request. The risk is stale or wrong learned names,
not request-count explosion.

This is medium-term knowledge-base debt, not a reason to weaken current
catalog-first reuse.

### 5.7 Typed lifecycle state

Operational behavior currently depends on metadata fields such as:

```text
metadata.generationStatus
metadata.generationFailureKind
metadata.generationRetryCount
```

That is legitimate typed-boundary debt because lifecycle state influences
behavior. A future cleanup may move authoritative lifecycle state into typed
Tour columns/state while leaving audit payloads such as `generationTrace`
and `executionSummary` in JSON.

Not urgent.

### 5.8 Maintainability and deferred geography debt

Large services are a maintainability signal:

```text
ExperienceProposalResolverService ~2820 lines
ExperienceGenerationService ~2150 lines
```

Do **not** broadly refactor them while dedupe/generalization/product behavior
is still settling. Revisit after those semantics stabilize.

The independent review also noted that `representativePoint` averages
coordinates and, for MultiPolygon, uses only the first polygon. San Martín is
harness debt, not production hardcoding. Grounded-provider plurality is
acceptable while providers are still being characterized.

Keep the following deferred unless real product evidence promotes them:

```text
NEAR threshold
POINT_RADIUS ROUTE/AREA relation
MultiLineString planner footprint
representativePoint MultiPolygon refinement
required-column migration
San Martín hardening
anchor Nominatim namespace
broad service refactor
```

### Real-world corpus acceptance

Preference-First core closure requires:

- positive cases can discover, ground, persist and reuse canonical Experiences
  when reality supports them;
- negative cases fail safely without invented composition;
- warm reuse is proven wherever a cold run persisted reusable knowledge;
- provider outages/rate limits are reported truthfully;
- extractor outcomes are characterized without turning a small sample into a
  fake statistical rate;
- tour-quality evidence exists for a small representative human-reviewed
  corpus;
- structural performance costs are accounted for separately from environment;
- no correctness invariant is weakened just to make a spike pass.

---

# 6. Preference-First Core CLOSED

The old definition `Phase 7 CLOSED = merge back to feat/experience-domain-v2` is superseded.

The new closure definition is behavioral:

```text
PREFERENCE-FIRST CORE CLOSED =
  deterministic acceptance green
  + DB-backed verification green
  + single live orchestration owner
  + legacy authority removed
  + component-resolution / RW1 milestone accepted
  + Experience dedupe is order-independent for the verified containment case
  + focused live dedupe regression accepted
  + RW2–RW6 generalization/anti-fabrication gate accepted
  + extractor reliability evidence characterized
  + initial human-reviewed tour-quality evidence recorded
  + structural performance accounting separated from environment
```

At closure the engine must satisfy, at minimum:

- preference-first retrieval rather than bounded geo-pool-first selection;
- one factual facet-match authority;
- missing knowledge drives targeted acquisition;
- all new knowledge goes through canonical evidence → resolve → validate → classify → dedupe → persist → re-read;
- catalog is reusable cumulative knowledge;
- multi-component Experience existence/composition is evidence-backed;
- embeddings only rank;
- exploration style only ranks and is **not** a facet;
- hard exclusions and feasibility win;
- resolved feasible MUST anchors are protected;
- final tour cardinality comes from planner feasibility, not a fixed candidate quota;
- reservoir/backfill/acquisition convergence is bounded;
- trace v4/Bitácora v4 explain the real decisions;
- no second legacy tour-generation authority remains.

### `explorationStyle` canonical correction

Any older roadmap text that models `exploration_style` as a `PreferenceFacet` is obsolete.

Canonical behavior:

```text
explorationStyle = request-side ranking meta-preference
```

It:

- is not inserted into `PreferenceSpec.facets`;
- does not satisfy coverage;
- does not create acquisition deficits;
- does not become Experience truth;
- only projects over independent grounded exploration signals after factual eligibility/matching.

---

# 7. Agentic Convergence Gate

Only begin unified agentic convergence after the Preference-First core is accepted.

## 7.1 Base branch

Create/recreate:

```text
feat/unified-agentic-travel-planning
```

from the accepted `feat/preference-first-selection` HEAD (or its direct accepted successor).

Do **not** base it on `feat/experience-domain-v2`.

Do **not** use `feat/agentic-travel-planning` as the merge base.

## 7.2 Audit before porting

Before implementation:

1. inspect the remote `feat/agentic-travel-planning` unique commits;
2. inspect any local/worktree-only `feat/unified-agentic-travel-planning` if present;
3. classify each agentic component as `PORT`, `ADAPT`, `REWRITE`, or `DROP`;
4. do not copy stale Experience-domain/catalog/acquisition authority just because it lives next to useful agent code.

## 7.3 Capabilities to preserve

Prefer selective port/adaptation of:

- `AgentPolicy` bounded decision loop;
- `AgentState`;
- decision/tool execution trace;
- natural-language request interpretation where it still adds value;
- `ToolRegistry` abstraction;
- `TravelPlanningAgent` orchestration pattern;
- useful CLI/test harnesses.

## 7.4 Capabilities that must be rewired

The agent may decide **what capability is needed**. It does not decide provider implementation.

Canonical conceptual tool surface may remain similar to:

```text
load/retrieve catalog
analyze coverage
research gap
run planner
```

but the implementation below those tools must call the accepted Preference-First core.

For example:

```text
AgentPolicy:
"knowledge is insufficient for requested history/walk need"
        ↓
research_gap capability
        ↓
Preference-First deficit/acquisition boundary
        ↓
ExperienceAcquisitionPlanner / strategy selection
        ↓
structured/web/area-route research as appropriate
        ↓
canonical resolve / validate / classify / dedupe / persist
        ↓
canonical catalog re-retrieval
```

The agent must **not** decide:

- use Tavily;
- use Places;
- use Wikivoyage;
- create a route from these POIs;
- bypass persistence because this candidate looks useful.

Provider/source choice and canonicalization remain below the agent boundary.

## 7.5 Old `research_gap` path

The old agentic `research_gap` implementation that directly owns a web-only discovery/extraction path must not survive as a parallel acquisition architecture.

Allowed outcome:

```text
research_gap = agent-facing capability name
```

Forbidden outcome:

```text
research_gap = independent acquisition stack beside Preference-First
```

Reuse the name only if its implementation delegates to the canonical core.

---

# 8. Unified Agentic E2E gate

The unified product is accepted only when a real agent loop can do:

```text
human request
  ↓
agent/request interpretation
  ↓
canonical PreferenceSpec / trip context
  ↓
load/retrieve canonical knowledge
  ↓
coverage/sufficiency
  ↓
AgentPolicy decision
  ├─ enough knowledge → plan
  └─ missing knowledge → research capability
                         ↓
                    Preference-First acquisition
                         ↓
                    canonical persistence
  ↓
coverage again
  ↓
deterministic composition
  ↓
deterministic planner / feasibility
  ↓
final tour
```

Required invariants:

- one Experience-domain/acquisition architecture;
- no legacy research stack running in parallel;
- agent decisions are bounded and observable;
- deterministic core still owns geography, evidence truth, identity, dedupe, persistence, matching, ranking semantics and feasibility;
- agent cannot fabricate Experiences;
- warm catalog reuse still works under agent control;
- identical canonical state + request produces deterministic deterministic-core decisions even if the high-level agent loop is responsible for deciding whether more knowledge is needed;
- traceability links agent decisions to canonical Preference-First trace/Bitácora facts.

When this gate is green, the product reaches:

```text
AUTONOMOUS PREFERENCE-FIRST TOURS
```

---

# 9. Post-convergence product capabilities

These come **after** unified agentic convergence unless a separate product decision reprioritizes them. They must use the same canonical domain boundaries rather than creating privileged shortcuts.

Recommended sequence:

1. **Activities provider family** — guided tours, tastings, classes, tickets, Viator-like sources; candidate → evidence → resolver → validation → dedupe → catalog, with temporal/availability facts where needed.
2. **Events provider family** — explicit date/time/timezone/availability semantics; never silently treated as evergreen Experiences.
3. **Daily operational requirements** — meals, breaks and similar needs owned by the deterministic scheduling core after Experience scheduling.
4. **Operational Stop Resolver** — resolves only operational needs not already satisfied by scheduled Experiences; generic restaurant/cafe/bar remains an operational stop unless independently proven to be a tourism Experience.
5. **Optional wizard controls** — e.g. meals/breaks customization; no mandatory extra screen.
6. **Conversational iterative replanning** — user feedback becomes requirement/preference deltas and re-enters the same canonical agent/core loop.

Potential later capabilities should preserve the same separation:

```text
agent understands/decides what is missing
core proves what is real and feasible
catalog remembers reusable knowledge
```

---

# 10. Branch lifecycle after convergence

After the unified branch is accepted:

- stop independently evolving `feat/experience-domain-v2`;
- stop independently evolving the stale `feat/agentic-travel-planning` implementation;
- retain them as historical/reference branches until normal repository cleanup;
- evolve the accepted unified line (or its normal successor/default-branch integration) as the product source of truth.

Do not perform history rewrites or delete branches merely because this roadmap reclassifies them.

---

# 11. Current execution pointer

As of 2026-09-27, the component-resolution / RW1 milestone is complete on
`feat/preference-first-selection`, and the Gate C extractor/provider
characterization and the **RW2 (Buenos Aires multi-area walk) spike are
executed**. RW2's two named findings plus its bitácora gap are now closed
(GENERIC structured-anchor propagation fixed; planner walking-rejection wording
corrected; bitácora composition/walking diagnostics added; walking policy
unchanged).
RW3 (Caminito) has multiple characterized runs (2026-09-27 and 2026-09-28). The historical SerpAPI
run failed on RW3-F1 (a cross-branch out-of-destination homonym vetoed the
real route). After `b31f5f33` the Caminito/Ezeiza case was fixed and
live-proven (F1, F3, F4 live; F2 deterministic-test-proven, failure path not
live-triggered). After `d6149363` (same-branch destination screening with
compatible-only multiplicity, audit-free source-plan fingerprints, typed
anchor handoff to the extractor) the canonical Serper + Cloudflare rerun
proves anchor resolution and the search → extractor handoff live, and the
extractor emits a Caminito-related source-supported walk; the misspelling
blocker (RW3-N5) was closed via provider-neutral typo normalization.

Following the N5 fix, geometry audits exposed defect `RW3-N6 — fixed-distance route corridor encoded semantic scope`:
a geometric diagnostic (distance from canonical route) was elevated into domain identity/scope policy
through an arbitrary fixed 300m threshold, rejecting coherent walking components (La Bombonera at 428m)
while accepting Quinquela Martín at 188m. This defect was resolved via pure policy
`evaluateRouteScopeMembership` for route-anchor coherence (anchor satisfaction, destination boundary
compatibility, local scope sharing, coherent extensions), preserving `distanceFromRouteMeters` strictly as
observational evidence, and keeping walking feasibility ownership strictly in the mobility planner.
Deterministic regressions G1–G6 all pass green.

Clean rerun executed in `spikes/rw3-route-scope-rerun-2026-09-28/` on dedicated DB
`zigzag_spike_rw3_routescope` with canonical Serper + Cloudflare pair. Sequence integrity
was strictly preserved (no synthetic state injected; WARM not run on empty catalog).

**RW3 is OPEN (live multi-component admission required) → RW4 is NOT AUTHORIZED.**
Current characterization provider pair: Serper + Cloudflare; SerpAPI runs
are historical. See
`spikes/rw3-route-scope-rerun-2026-09-28/assessment.md` and the canonical
Progress. Do not reopen the closed component-resolution Progress for
post-milestone work unless a real regression disproves an accepted milestone
fact.

Do not begin agentic convergence merely because the component-resolution
milestone is complete.

Sequence from the current frontier:

```text
Experience dedupe policy correction          (DONE)
→ focused deterministic regression           (GREEN)
→ focused live rerun                         (done, dedupe shape inconclusive)
→ extractor/provider reliability             (bounded: case-b ×5 landed)
→ RW2 multi-area walk                        (EXECUTED 2026-09-26; findings closed)
→ RW3 Caminito canonical OSM ROUTE           (IN PROGRESS: N5 & N6 resolved;
                                               live multi-component admission pending;
                                               RW4 NOT AUTHORIZED)
→ RW4–RW6 generalization
   + initial tour-quality evaluation
   + structural performance accounting
→ clean stale red baseline suites so green means green
→ close Preference-First core
→ audit existing agentic work
→ create/recreate unified branch from Preference-First
→ port/adapt agent capabilities
→ unified Agentic E2E
```

The closed component-resolution Progress remains canonical historical evidence
for that milestone. Current code is implementation authority; this roadmap owns
post-milestone sequencing; historical spikes remain evidence rather than
automatic current truth.
