# Preference-First Selection — Current execution pointer after B5

Status: **B5 COMPLETE; B6 BLOCKED.**
Written: 2026-09-13.
Branch: `feat/preference-first-selection`.

This is the current operational progress pointer for work immediately after B5.
It supersedes the historical `Next task: B6` lines in:

`docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

Those older lines were written before the mandatory identity and real-world
research gates were added. Do not use them to jump directly into B6.

Canonical main implementation plan:

`docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`

The main plan now contains the same mandatory B5 → B6 gate sequence explicitly.

---

## Current state

```text
A1–A7                         COMPLETE
B1–B4 / B4.1                  COMPLETE
B5 + B5 review hardening      COMPLETE

Experience Identity Gate      NEXT
Real-World PRE-B6 Spikes      BLOCKED on Identity Gate
B6                             BLOCKED on both gates
```

B5's review blockers were fixed and its deterministic/Postgres verification was
accepted. Do not reopen B5 for unrelated planner/composition work merely because
later real-world research may expose a new problem. If a real spike does expose
an actual B5/identity defect, classify it honestly and repair that exact defect.

---

# NEXT — Experience Identity / Dedupe Postgres Gate

Execute this plan next, in full:

`docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`

**Do not start B6 before this gate is green.**

Required real-Postgres outcomes include:

```text
SAME
  same real Experience from another observation
  → one canonical row
  → evidence enrichment
  → idempotent repetition
  → provider/input-order invariant identity outcome

NEW
  distinct real Experiences may share
  destination + area + theme + intent
  → both canonical rows survive

AMBIGUOUS
  insufficient/conflicting identity evidence
  → no create
  → no mutation of canonical row
  → resolver rejects with AMBIGUOUS_DEDUPE
```

The gate must use real Prisma/Postgres persistence, component/evidence relations,
transaction/advisory-lock behavior and DB re-reads. Unit-only dedupe tests are not
sufficient.

If a fixture that is clearly a distinct real Experience becomes `SAME` or
`AMBIGUOUS`, repair the identity policy rather than weakening the fixture. If an
`AMBIGUOUS` observation mutates canonical state, stop and fix that before moving
on.

Exit criteria are the checklist in the gate plan. Record exact verification
results and commit/update progress before advancing.

---

# THEN — Real-World Tourism Research Spike Baseline, PRE-B6

Only after the identity gate is green, execute:

`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

This is a **mandatory characterization gate**, not a normal mocked integration
suite.

Minimum corpus — all six must actually run:

1. `RW1` — historical walk in San Telmo;
2. `RW2` — San Telmo → La Boca multi-area walk;
3. `RW3` — Caminito canonical ROUTE;
4. `RW4` — Ruta del Vino de Mendoza tourism route;
5. `RW5` — at least one foreign-city walk, initially Montmartre or Trastevere;
6. `RW6` — negative anti-fabrication case: real POIs exist, but no evidence of a
   real composed walk/route.

Required reality chain:

```text
human tourism request
  ↓
real acquisition planning
  ↓
real discovery/search
  ↓
real source content
  ↓
real extraction LLM
  ↓
ExperienceCandidate created by the system
  ↓
real component hints from evidence
  ↓
real OSM / Overpass / Nominatim / Places resolution as applicable
  ↓
real geographic validation
  ↓
real dedupe / canonicalization
  ↓
real evidence-only classification
  ↓
real PostgreSQL/PostGIS persistence
  ↓
canonical re-read
```

Mocks are disabled for the research chain. Do not hand-write or repair candidate
components to make a spike pass.

Every run must leave a diagnosable trace/dossier as defined by the spike plan.
The current local OSM profile self-hosts Overpass for Argentina only; Nominatim
is configured separately/public by default. Foreign-city spikes must explicitly
use an appropriate real OSM source rather than querying the Argentina-only local
extract and treating an empty answer as a product failure.

Classify every run using the plan's verdicts. In particular:

```text
B5_OR_IDENTITY_BUG
  → STOP progression
  → fix the exact bug
  → reverify deterministic gate + affected spike

EXPECTED_B6_GAP
  → keep as concrete B6 characterization/acceptance input

ORCHESTRATION_GAP
PROVIDER_COVERAGE_GAP
INFRASTRUCTURE_GAP
  → record honestly; do not relabel as B6 extraction defects
```

The pre-B6 corpus does not need six positive successes. It does need six real
executions with enough evidence to explain what happened.

---

# ONLY THEN — B6

B6 remains blocked until both prior gates satisfy their exit criteria.

B6 canonical section:

`docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
→ `B6 — Narrow web extraction contract`

The purpose of the pre-B6 baseline is to make B6 respond to observed reality,
not hypothetical fixtures. Preserve the baseline dossiers unchanged enough to
compare behavior later.

After B6, rerun the **same real-world corpus** as the post-B6 acceptance gate.
Do not replace hard cases with easier examples and do not weaken geographic or
identity truth just to make the post-B6 run green.

---

## Canonical execution order from here

```text
B5 COMPLETE
    ↓
Experience Identity Postgres Gate
  SAME / NEW / AMBIGUOUS
  idempotency
  provider/input-order invariance
    ↓
Real-World PRE-B6 Spike Baseline
  RW1..RW6
  real providers/models/DB
  mocks disabled
    ↓
fix/reverify every B5_OR_IDENTITY_BUG
    ↓
characterize remaining EXPECTED_B6_GAPs
    ↓
B6 — Narrow web extraction contract
    ↓
rerun RW1..RW6
    ↓
Real-World POST-B6 Acceptance
    ↓
continue Checkpoint C
```

---

## Agent handoff rule

An implementation agent starting from this branch should:

1. read this current execution pointer;
2. read the main implementation plan's `Mandatory B5 → B6 gates` section;
3. execute the Experience Identity Postgres gate next;
4. update progress with real commits/test counts and stop for review if identity
   semantics require a code fix;
5. after approval/green identity gate, execute all six real-world spikes;
6. preserve their dossiers and classifications;
7. only when the B6 unlock checklist is satisfied, begin B6.

Do **not** interpret the old `Next task: B6` line in the historical progress file
as current authorization. It is explicitly superseded.
