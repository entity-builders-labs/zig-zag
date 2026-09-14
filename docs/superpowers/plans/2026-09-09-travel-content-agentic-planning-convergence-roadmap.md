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
Preference-First implementation / M9
        ↓
M10 RW1 rerun
        ↓
RW1 real PASS + warm catalog reuse
        ↓
RW2–RW6 real-world corpus
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

---

# 3. Gate A — finish the Preference-First implementation through M10

The current master implementation plan owns this work.

M10/RW1 exists to prove that the corrected live orchestration reaches the real-world research path and can persist/reuse real tourism knowledge.

The desired RW1 product result is:

```text
COLD REQUEST
human request for a historical walk in San Telmo
  ↓
real preference interpretation / scope
  ↓
no sufficient canonical walk in catalog
  ↓
real acquisition planning
  ↓
real discovery + source evidence
  ↓
real extraction of a composed Experience
  ↓
real component grounding
  ↓
geographic validation
  ↓
canonical identity / classification / persistence
  ↓
canonical multi-component Experience
  ↓
composition + planner

WARM REQUEST
same relevant request
  ↓
canonical catalog retrieval
  ↓
same persisted Experience id
  ↓
no reacquisition of that walk
  ↓
composition + planner
```

An `ORCHESTRATION_GAP` remains a hard M10 failure.

`EXPECTED_B6_GAP`, `PROVIDER_COVERAGE_GAP`, or `INFRASTRUCTURE_GAP` may still be truthful diagnostic outcomes of the M10 spike contract, but **they do not close the full Preference-First core**. Product closure requires successful real composed-Experience behavior, not merely proof that execution reached the right service.

---

# 4. Gate B — RW1 real PASS and warm reuse

Before broadening the corpus, RW1 must prove at least one difficult area-scoped composed Experience end to end.

Required closure facts:

- human-level request, not hand-built candidate input;
- real discovery/source evidence;
- evidence proves the Experience itself exists;
- evidence proves the real component composition;
- every persisted real component is grounded;
- deterministic geographic validation passes;
- canonical dedupe/identity path runs;
- evidence-only classification is persisted or validly reused;
- a normal canonical Experience is re-read from the catalog before planning;
- the final Experience has multiple real components when the source proves a composed walk;
- cold request can use it in the tour flow;
- warm request reuses the same canonical Experience id;
- warm request does not reacquire that same walk;
- no nearby-POI fabrication is accepted as a substitute.

If RW1 reaches research correctly but cannot prove a real composed walk, that is valuable diagnosis but not final closure. Fix the responsible research/extraction/source problem without weakening evidence, identity or geography, then rerun RW1.

---

# 5. Gate C — RW2–RW6 real-world generalization

After RW1 passes, execute the remaining real-world corpus defined by:

`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

Do not replace the corpus with easier variants of RW1.

The purpose of RW2–RW6 is to demonstrate generality across different failure modes, including:

- multi-area / cross-neighborhood research;
- real route-like geography;
- destination-specific tourism structures such as wine routes;
- a foreign-city case using the correct non-Argentina geographic providers;
- a negative anti-fabrication case where real nearby POIs exist but source evidence does **not** prove a composed walk/route.

The negative case is as important as a positive case. Zig-Zag must be able to conclude:

```text
I found real places, but I did not find evidence for a real composed Experience.
```

It must not manufacture a plausible route from proximity.

### Real-world corpus acceptance

Preference-First core closure requires:

- positive cases can discover, ground, persist and reuse canonical Experiences when reality supports them;
- negative cases fail safely without invented composition;
- warm reuse is proven wherever a cold run persisted reusable knowledge;
- provider outages/rate limits are reported truthfully;
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
  + real RW1 PASS with warm reuse
  + RW2–RW6 generalization/anti-fabrication gate accepted
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

As of this rewrite, the immediate implementation work remains the M9/M10 recovery on `feat/preference-first-selection`.

Do not begin agentic convergence merely because this roadmap is now updated.

Sequence from the current frontier:

```text
finish M9 prerequisites
→ M10 RW1 rerun
→ obtain real RW1 PASS + warm reuse
→ authorize/run RW2–RW6
→ close Preference-First core
→ audit existing agentic work
→ create/recreate unified branch from Preference-First
→ port/adapt agent capabilities
→ unified Agentic E2E
```

The current main progress document remains the source of truth for the exact implementation checkpoint before RW1.
