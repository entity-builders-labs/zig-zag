# Travel Content + Agentic Planning — Convergence Roadmap

Status: canonical roadmap. Docs-only. Branch of record: `feat/experience-domain-v2`.
Written: 2026-09-09. HEAD when written: `adae0c0`.

Companion to `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`
(the "why"). This document is the executable sequence: the phases, the gate, and
the order of work *after* the gate. It does not repeat the architecture — read
the spec first.

> **Docs-only.** This roadmap does not start Phase 6 or Phase 7, does not merge
> branches, does not change schemas or the agent or acquisition, and does not
> add `Activities` / `Events` / `OperationalStop`.

---

## Track A — Experience Domain V2 (`feat/experience-domain-v2`)

### Phase 5 — OSM proactive acquisition

**Status (per `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md`
as of `adae0c0`):** implemented, hardened, and CLOSED — verified hardening code
commit `f24f6f4efff270f3a08d4616f1628b619c7f1302`; previous Phase 5 code
`54eceebbec90a1662f32b44385364d091b3be55e`. The progress doc is the source of
truth; this roadmap does not re-decide that status.

Scope delivered: `OsmAcquisitionProvider` wired into
`ExperienceAcquisitionService.executePlan` (dormant path — not yet consumed by
live tour generation), concept→selector registry, one bounded Overpass union
query, deterministic output order, defensive identity/geo validation, structured
provider provenance, food/nightlife excluded from proactive Experience
acquisition, `winery = craft=winery` only.

### Phase 6 — Web acquisition improvements

**Status: NOT started.** Do not start it from this roadmap.

Scope (per `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md`,
"PHASE 6 — Tavily + explorationStyle"):
- make the Tavily walk/route query theme-aware (still one grounded query per
  request; no theme explosion into multiple requests);
- keep `explorationStyle` **out** of the search query;
- represent `explorationStyle` as a `PreferenceFacet`
  (`{ dimension: 'exploration_style', key, importance, confidence, source }`),
  reusing the existing `ExplorationStyle` values;
- route it through the existing preference evaluator / ranking seam.

Constraints for whoever executes Phase 6:
- Phase 6 **may** improve Tavily query behaviour and **may** land
  `exploration_style` as a facet per the existing plan.
- Phase 6 does **not** need to resolve the full Search Retrieval vs Grounded
  Research architecture (§4 of the spec).
- Phase 6 must **not close the door** on separating Search Retrieval from
  Grounded Research — do not collapse them into "one grounded provider" as a
  permanent decision, and do not remove the seam that lets a future capability
  split happen.

### Phase 7 — Canonical multi-source orchestration, live

**Status: NOT started.** Do not start it from this roadmap.

Scope (per the implementation plan, "PHASE 7 — Final orchestration"): make the
following real in the live tour-generation path
(`experience-generation.service.ts`), replacing today's Google-Places-only
`acquireNearby` refill:

```
local catalog
  → CoverageAnalyzer
  → deficits (dimension-classified)
  → ExperienceAcquisitionPlanner → ExperienceAcquisitionPlan (source-capability plan)
  → ExperienceAcquisitionService.executePlan  (Wikivoyage / OSM / Places / Web, isolated failures)
  → structured synthesis + web candidate integration
  → shared corroboration
  → resolver → geographic validation → dedupe
  → persistence + embeddings
  → catalog re-query
  → CoverageAnalyzer again → refill/requery if still deficient
  → preference ranking
  → GreedyDailyPlanningSolver → TourPlanningFeasibilityValidator
  → Tour materialization
```

Plus: acceptance suite, live smoke verification, full tests, progress
checkpoint, commit.

**Phase 7 is the prerequisite for convergence** — it defines the canonical
acquisition API the agent must consume.

---

## Track B — Agentic Travel Planning (`feat/agentic-travel-planning`)

Continues in parallel, un-merged, while Track A finishes Phases 6–7:

- request interpreter (`AgentNaturalLanguageRequestInterpretation`)
- `AgentPolicy` (`decide(state) → AgentDecision`)
- `AgentState` + decision / tool-execution trace
- `ToolRegistry` (`load_catalog`, `analyze_coverage`, `research_gap`, `run_planner`)
- the bounded coverage → research → coverage → plan loop
- deterministic planner invocation (`DAILY_PLANNING_SOLVER` +
  `TourPlanningFeasibilityValidator`)
- traceability

**Constraint:** do **not** consolidate the current live `research_gap`
(`LiveAgentResearchProvider` → `ExperienceDiscoveryPlannerService` → one
grounded provider → extractor → resolver) as the permanent acquisition
architecture. It is a bridge, not a destination — see the integration handoff
(`docs/superpowers/plans/2026-09-09-agentic-acquisition-integration-handoff.md`).

---

## Integration Gate

**Timing: AFTER Phase 7.** Not before, absent an extraordinary documented need.

**Prerequisites** (all must hold — see the target-architecture spec §16):

| Experience Domain (Track A) | Agentic (Track B) |
|---|---|
| Phase 5 CLOSED | request interpreter stable |
| Phase 6 CLOSED | `AgentPolicy` stable |
| Phase 7 CLOSED | `ToolRegistry` stable |
| `ExperienceAcquisitionPlanner` stable | agent state / trace stable |
| `ExperienceAcquisitionService` stable | deterministic-planner invocation stable |
| resolver / validation / dedupe path stable | no duplicated Experience-domain concepts in the agent branch |
| no direct-persistence shortcuts | |
| acceptance tests green | |

**Action at the gate** (documented, not executed here):

1. create `feat/unified-agentic-travel-planning` **from `feat/experience-domain-v2`**
   (not from the agentic branch);
2. bring agentic functionality onto that base;
3. resolve conflicts favouring Experience Domain V2 contracts
   (`ExperienceCandidate`, preferences/facets, acquisition plan, resolver,
   geographic validation, dedupe, catalog, ranking, planner contracts);
4. adapt agent tools to the canonical acquisition APIs;
5. remove/deprecate the old web-only `research_gap` acquisition path;
6. preserve the useful `AgentPolicy` / `AgentState` / `ToolRegistry` loop;
7. fixture tests → acquisition tests → real-provider characterization →
   E2E (agent → acquisition → resolver → coverage → planner);
8. only then stop evolving the old branches independently.

---

## Post-convergence capabilities

Recommended order (relative order may shift with evidence/product needs;
**none may contaminate Phase 5/6/7**):

1. **Activities** provider family (guided tours, classes, tastings, tickets;
   e.g. Viator adapter) — enters the same candidate → resolver → validation →
   dedupe path; no privileged global score.
2. **Events** provider family (date-bound; concerts, festivals, markets) —
   separate temporal source; depends on trip dates / timezone / start-end /
   availability / location; never mixed into the evergreen catalog without
   explicit temporality.
3. **Operational requirements** — `DailyOperationalRequirements` (meals,
   breaks) as a *responsibility of the deterministic core after Experience
   scheduling*. Definition of ownership, then a schema, then implementation —
   in that order.
4. **Operational Stop Resolver** — fills only requirements not already
   satisfied by scheduled Experiences (§8 of the spec); Places/OSM + routing +
   opening-hours + detour validation.
5. **Wizard optional controls** — an optional "Meals and breaks" section
   (`automatic` / `customize`); never a mandatory screen.
6. **Conversational iterative replanning** — the user iterates on a generated
   tour in dialogue; the agent turns feedback into requirement deltas and
   re-enters the loop.

These are a post-convergence roadmap, **not** numbered as "Phase 8" until both
tracks are aligned.

---

## Acceptance gates

### Phase 7 gate
- live tour generation runs the full canonical orchestration (catalog →
  coverage → deficits → acquisition plan → structured/web → corroboration →
  resolver → catalog refresh → coverage → ranking → planner → materialization);
- Google-Places-only `acquireNearby` refill is replaced;
- no direct persistence shortcuts;
- **Places food/nightlife admission respects the Experience vs Operational Stop
  invariant.** A bare Places result whose only significance is `restaurant` /
  `cafe` / `bakery` / `bar` / `night_club` must not originate a tourism
  Experience merely because a food/nightlife preference or a
  `acquisition-source-routing.ts` entry requested that type. Those Places
  entities may only (1) corroborate / enrich a tourism Experience discovered
  through stronger evidence, (2) represent a venue itself proven to be a
  tourism Experience, or (3) resolve Operational Stops after operational
  planning exists. The deterministic mechanism — routing changes / provider
  admission changes / a corroboration requirement / an evidence threshold /
  another mechanism — is **not decided here**; this gate only fixes the
  invariant and the closure criterion. (This is **not** Phase 6 scope; Phase 6
  is Tavily walk/route theme-awareness + `exploration_style` facet activation.
  It belongs to Phase 7 closure because Phase 7 is when the canonical
  multi-source acquisition path becomes live.)
- acceptance suite + live smoke green;
- full backend tests green; `yarn run check` shows no *new* tsc errors vs the
  documented baseline.

### Integration gate
- all §16 prerequisites hold;
- `feat/unified-agentic-travel-planning` created from `feat/experience-domain-v2`;
- one acquisition architecture only (no parallel `research_gap` legacy path);
- agent tools call the canonical acquisition APIs;
- E2E agent → acquisition → resolver → coverage → planner green.

### Operational planning gate
- `DailyOperationalRequirements` ownership defined and documented;
- scheduler resolves requirements *after* Experience scheduling;
- a scheduled Experience can satisfy an operational requirement with no extra
  stop inserted (§8);
- Operational Stop Resolver only fills unsatisfied requirements;
- generic `restaurant`/`cafe`/`bar` is never promoted to an Experience.

### Agentic E2E gate
- request interpretation → coverage → agent decision → acquisition → coverage
  again → planner, all observable in one unified trace;
- the agent decides "need more acquisition", never "use provider X";
- deterministic core owns geography / dedupe / persistence / ranking /
  feasibility throughout;
- the canonical acceptance scenario (spec §20) produces a feasible tour.
