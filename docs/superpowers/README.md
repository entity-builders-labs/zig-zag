# Superpowers documentation map

Status: **canonical navigation index; not execution authority**.

This file answers one question:

> Where is the canonical documentation for a given kind of project knowledge?

It intentionally does **not** duplicate current milestone status, blockers,
execution history, roadmap sequencing, or architectural decisions. Those belong
to the documents that own those concerns.

The codebase remains the ultimate implementation source of truth.

---

## Canonical project direction

### Product / convergence roadmap

plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md

This is the canonical roadmap for Preference-First, Planner Product Acceptance,
Tour Engine v1, and later agentic convergence.

The roadmap owns product sequencing and future capability placement. It is not
an execution log.

---

## Active execution tracks

Track state is declared by the machine-readable agent-track header in each
track's progress document.

Use:

~~~bash
scripts/agent-track list
scripts/agent-track context
scripts/agent-track locate <track-id>
~~~

Do not infer active state from filenames or dates.

Current Preference-First navigation:

- Track: preference-first-selection
- Progress:
  progress/2026-09-11-preference-first-selection-progress.md
- Implementation plan:
  plans/2026-09-11-preference-first-selection-implementation.md
- Canonical design:
  specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
- Real-world acceptance gates:
  plans/2026-09-12-real-world-tourism-research-spike-gate.md

The progress document owns current execution state for that track. The plan owns
intended implementation/gates. Specs own durable behavior and architecture.

---

## Canonical specs and amendments

Read the applicable durable contract before changing its domain.

Key current references include:

- specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
  — Preference-First architecture.
- specs/2026-09-12-places-provider-cost-control-amendment.md
  — Places-provider acquisition/cost policy.
- specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md
  — component-resolution and enrichment contract.
- specs/2026-10-02-geographic-validation-authorization-review.md
  — work-unit authorization and Experience geographic scope.
- specs/2026-10-08-experience-duration-knowledge.md
  — proposed/deferred evidence-backed Experience-duration knowledge.
- specs/2026-10-09-city-geoentity-catalog-bootstrap-and-learning.md
  — proposed/deferred durable contract for city GeoEntity bootstrap, alias/translation authority, simple-Experience seeding, backoffice correction and runtime catalog learning.

Future feature specs may exist before their implementation tracks are active.
A proposed/deferred spec is **not** authorization to create a branch, worktree,
PR, or implementation plan.

---

## Document roles

~~~text
specs/
  Durable product/domain/architecture contracts.
  Answers: what must be true?

plans/
  Roadmaps, implementation plans and acceptance sequencing.
  Answers: where are we going / how do we intend to get there?

progress/
  Per-track execution state and resumability.
  Answers: where is this track now?

characterization/
  Measured behavior, adversarial reviews and experiments.

reports/
  Bounded execution/review reports.

spikes/
  Immutable run artifacts and forensic evidence. Located outside
  docs/superpowers when run-local artifacts belong with the campaign.
~~~

Do not create a new progress file merely to record a finding, future idea, or
supporting experiment.

---

## Authority rules

- Code beats stale documentation about implemented behavior.
- A canonical spec defines durable intended behavior until deliberately amended.
- A roadmap defines sequencing, not current execution state.
- A plan defines intended implementation/gates, not proof of completion.
- A track's ACTIVE progress document owns its current checkpoint, next
  authorized action and open blockers.
- Evidence can invalidate an assumption but does not become execution authority
  merely because it is newer.
- Do not infer authority from a filename containing current, final, master,
  plan or progress.

Governance and collaboration rules live in repository-root /AGENTS.md, not in
this README.

Backend architectural engineering principles live in
docs/architecture/engineering-principles.md.

---

## Navigation by question

### Where is this track now?

Run:

~~~bash
scripts/agent-track context
~~~

Then read the progress/plan/specs it reports.

### Where is the product going?

Read:

plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md

### What behavior is canonical?

Read the applicable document under specs/, then confirm implementation status
in code and the active track progress.

### Why did behavior change?

Use characterization, reports, spikes and Git history as supporting evidence.
Promote durable conclusions into the appropriate canonical spec or roadmap
instead of turning evidence files into new authorities.
