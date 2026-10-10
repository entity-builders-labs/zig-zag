# Agentic ↔ Acquisition Integration Handoff

Status: canonical handoff note. Docs-only. Branch of record: `feat/experience-domain-v2`.
Written: 2026-09-09. HEAD when written: `adae0c0`.

Short, operative companion to:
- `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`
- `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`

**Purpose:** when the time comes to merge/rebase `feat/agentic-travel-planning`
onto the canonical Experience Domain, the implementing agent must know exactly
what to keep and what to delete. This note is that checklist. It does **not**
authorize doing it now — see STOP conditions.

---

## Preserve from the agentic branch

- `TravelPlanningAgent.run()` — the bounded reasoning loop.
- `AgentPolicy` — `decide(state) → AgentDecision` (what to do next, when to
  research, when to plan, when to finish/fail).
- The natural-language request interpreter
  (`AgentNaturalLanguageRequestInterpretation`: destination, days, normalized
  preferences, ambiguities, structural parsing, preference trace).
- `AgentState` + the decision / tool-execution trace
  (`decisions`, `toolExecutions`, `coverageHistory`, `researchHistory`,
  `planningAttempts`).
- The `ToolRegistry` concept (`load_catalog`, `analyze_coverage`,
  `research_gap`, `run_planner`) and its handler-map shape.
- The iterative coverage → research → coverage → plan structure, with explicit
  iteration / research budgets and an internal step guard.
- The fact that `run_planner` **invokes** the deterministic core
  (`rankCandidatesByRelevance` + `PlanningCandidateNormalizerService` +
  `DAILY_PLANNING_SOLVER` + `TourPlanningFeasibilityValidator`) rather than
  reimplementing it.

---

## Replace / adapt

**Current live `research_gap`** (`LiveAgentResearchProvider`):

```
research_gap
  → ExperienceDiscoveryPlannerService.plan(request).queries[0]
  → one configured EXPERIENCE_GROUNDED_SEARCH_PROVIDER
  → EXPERIENCE_DISCOVERY_PROVIDER extractor
  → ExperienceProposalResolver.resolve()   (persists accepted Experiences)
```

**Target `research_gap` / `acquire_gap`:**

```
research_gap / acquire_gap
  → ExperienceAcquisitionPlannerService.buildAcquisitionPlan(...)   (deficit → source-capability plan)
  → ExperienceAcquisitionService.executePlan(plan)                  (Wikivoyage / OSM / Places / Web, isolated failures)
  → shared corroboration (StructuredCandidateCorroborationService)
  → materialize / resolve (ExperienceProposalResolver → geographic validation → dedupe → persist)
  → catalog refresh
  → agent re-runs CoverageAnalyzer
```

Notes:
- The **resolver → geographic validation → dedupe → persistence** tail is
  already correct in the agent's live path and is kept — only the **source
  planning / acquisition** front half changes.
- The agent still selects *which gap* to work
  (`AgentGap`: theme / trait / intent / quantity). It does **not** select a
  provider — `ExperienceAcquisitionPlanner`'s routing table does.
- `FixtureAgentResearchProvider` (ephemeral, non-persisted, deterministic) is
  kept as-is for offline loop tests; it does not touch acquisition.

---

## Remove duplication

There must be **one** acquisition architecture after convergence. Do not keep,
side by side:

```
legacy web discovery   (ExperienceDiscoveryPlannerService + one grounded provider)
        vs
canonical multi-source acquisition   (ExperienceAcquisitionPlanner + ExperienceAcquisitionService)
```

The legacy web-only acquisition path used by `research_gap` is removed /
deprecated at the gate. (`ExperienceDiscoveryPlannerService` itself may still
exist if Phase 6/7 keep it as an internal web-query builder used *inside*
`ExperienceAcquisitionService`; what goes away is the agent calling it as its
own parallel acquisition entrypoint.)

---

## Canonical ownership (conflict resolution)

**Experience Domain V2 wins** conflicts for:
`ExperienceCandidate` shape · preferences / `PreferenceFacet` vocabulary ·
`ExperienceAcquisitionPlan` / `SourcePlan` · the resolver · geographic
validation · dedupe (`SAME`/`NEW`/`AMBIGUOUS`) · catalog contracts · ranking ·
`DailyPlanning*` / solver / feasibility contracts.

**The agentic branch owns** orchestration-level behaviour:
`AgentPolicy` · `AgentState` · `ToolRegistry` · the request interpreter · the
loop structure · agent traces.

If the agent branch has drifted its own copy of an Experience-domain concept
(e.g. `AgentCandidate` fields that shadow `ExperienceCandidate`, or a private
ranking), reconcile toward the canonical type; `AgentCandidate` should stay a
thin view/DTO over catalog rows, not a second domain model.

---

## Integration branch

```
feat/unified-agentic-travel-planning
  base: feat/experience-domain-v2        (NOT feat/agentic-travel-planning)
```

Bring the agentic commits/capabilities onto that base; do not rebase the
canonical domain onto the agent branch.

---

## STOP conditions

- **If Phase 7 is not CLOSED (per the progress doc): do not converge branches.**
- If `ExperienceAcquisitionPlanner` / `ExperienceAcquisitionService` contracts
  are still churning: do not converge.
- If the agent branch still has un-stabilised `AgentPolicy` / `ToolRegistry` /
  state: stabilise first, then converge.
- Do not delete the legacy `research_gap` path before the canonical
  `acquire_gap` path is wired and green in the integration branch.
