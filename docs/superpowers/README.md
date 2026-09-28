# Superpowers documentation map

Status: **canonical navigation index; not an execution log**.  
Updated: 2026-09-28.  
Active tour-engine branch: `feat/preference-first-selection`.

This file answers four questions before an engineer or agent reads the large
historical document set:

1. Where are we now?
2. Which document is authoritative for current execution?
3. Which plans define where we are going?
4. Which dated files are only historical evidence?

The codebase remains the ultimate source of truth. This index controls
**documentation navigation**, not runtime behavior.

---

## 1. Current state

The single current execution pointer is:

`docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

As of 2026-09-28 its gate-level state is:

```text
Component-resolution / RW1        CLOSED
Experience dedupe correction      DONE
RW2                               CLOSED
RW3 Caminito route                IN PROGRESS
RW4                               NOT AUTHORIZED
RW5                               PENDING
RW6 anti-fabrication              PENDING
Preference-First Core CLOSED      PENDING
Trace v5 maintainability cutover  IN PROGRESS (pulled forward from PF close)
Agentic convergence               PENDING AFTER TRACE V5
```

When this summary disagrees with the execution pointer or code, the execution
pointer/code wins and this index must be corrected.

The latest RW3 evidence dossiers live under `spikes/`; spike artifacts are
evidence, not execution authority.

---

## 2. Current authority set

| Role | Document | Authority |
| --- | --- | --- |
| Current execution state | `progress/2026-09-11-preference-first-selection-progress.md` | **CURRENT — single execution pointer** |
| Product/convergence direction | `plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md` | **CANONICAL ROADMAP** |
| Preference-First implementation | `plans/2026-09-11-preference-first-selection-implementation.md` | **ACTIVE IMPLEMENTATION REFERENCE** |
| Preference-First live cutover | `plans/2026-09-13-preference-first-live-cutover.md` | **ACTIVE/HISTORICAL CUTOVER REFERENCE; current progress wins on status** |
| Real-world gates RW1–RW6 | `plans/2026-09-12-real-world-tourism-research-spike-gate.md` | **ACTIVE ACCEPTANCE GATE** |
| Preference-First architecture | `specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` | **CANONICAL DESIGN** |
| Component-resolution amendment | `specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md` | **ACCEPTED DOMAIN REFERENCE; milestone closed unless regression** |
| Independent post-resolution review | `characterization/2026-09-25-post-component-resolution-independent-architecture-review.md` | **SUPPORTING EVIDENCE** |

Do not add another current execution pointer without changing this table and
explicitly demoting the old pointer.

---

## 3. Canonical forward sequence

```text
RW3 source-depth/composition/geography proven; warm-reuse finding open
→ Generation Trace v5 cutover
→ RW3 final acceptance
→ RW4
→ RW5
→ RW6
→ Preference-First Core CLOSED
→ Generation Trace v5 maintainability cutover
→ unified agentic branch from accepted Preference-First HEAD
→ selective agent capability port/adaptation
→ unified Agentic E2E
→ Autonomous Preference-First Tours
→ post-convergence product capabilities
```

The prior Trace v5 sequencing was explicitly superseded on 2026-09-28 after
RW3 demonstrated that v4 lost a classifier HTTP 503 cause. Trace v5 now occurs
before RW3 final acceptance; RW4 remains unauthorized. See
`specs/2026-09-28-generation-trace-v5-cutover.md`.

The detailed reasoning and acceptance invariants for Trace v5 live in the
canonical convergence roadmap.

---

## 4. Document lifecycle rules

Every `docs/superpowers/` document should be interpreted as one of these
classes:

### CURRENT EXECUTION POINTER

Exactly one document should own "where are we right now?". Today that is
`2026-09-11-preference-first-selection-progress.md`.

### CANONICAL ROADMAP / ACTIVE PLAN / CANONICAL SPEC

Defines direction, intended sequencing or contracts. A plan may be partially or
mostly executed; **its prose does not override the current execution pointer**.

### SUPPORTING EVIDENCE

Characterizations, spike reports, independent reviews and bounded rerun reports
record facts. They can invalidate an assumption, but they do not become a new
execution pointer merely because they are newer.

### HISTORICAL PROGRESS SNAPSHOT

A dated progress file records what was believed/current at that checkpoint. It
remains useful for archaeology and evidence, but it is not current state.

### SUPERSEDED

A document whose sequencing/authority has explicitly been replaced. Preserve it
only when its historical rationale remains useful; never execute from it as if
it were current.

Rules:

- Never infer authority merely from the newest date.
- Never infer authority because a filename contains `progress`, `master`,
  `final` or `current`.
- Code beats stale documentation.
- Current execution state beats an older plan's unfinished checklist.
- When promoting a new execution pointer, update this index in the same commit.
- When superseding a document, add an explicit status/header or successor link
  where practical.
- Do not create parallel current-progress documents for separate fixes inside
  the same tour-engine execution track; use supporting evidence documents and
  roll the accepted state into the single execution pointer.

---

## 5. Progress-file inventory

Only one of the existing files below is the current execution pointer.

| Progress file | How to read it now |
| --- | --- |
| `2026-09-11-preference-first-selection-progress.md` | **CURRENT execution pointer** |
| `2026-09-27-rw-bitacora-defect-fixes-and-reruns-progress.md` | Supporting evidence; it explicitly says it is not an execution pointer |
| `2026-09-17-cross-source-confirmation-and-tripadvisor-volume-progress.md` | Historical execution/evidence from the component-resolution journey |
| `2026-09-17-composite-experience-adversarial-review-progress.md` | Historical; successor work moved forward from this checkpoint |
| `2026-09-13-pre-b6-gates-progress.md` | Historical pre-cutover pointer; superseded by the current Preference-First progress |
| `2026-09-12-b1-places-cost-control-correction.md` | Completed/supporting correction record |
| `2026-09-11-a7-design-correction.md` | Historical design-correction checkpoint |
| `2026-09-11-a6-review-correction.md` | Historical review-correction checkpoint |
| `2026-09-11-ui-auth-cover-stabilization-progress.md` | Completed historical stabilization record |
| `2026-09-06-multi-source-acquisition-progress.md` | Historical predecessor on `feat/experience-domain-v2` |
| `2026-09-06-multi-source-acquisition-design.md` | Historical predecessor checkpoint despite its `progress/` location |

If a historical file contains a valuable fact not reflected in current
documentation, promote the fact into the appropriate current spec/roadmap/progress
document; do not promote the old file itself back to current authority.

---

## 6. How to navigate by task

### "Where are we?"

Read, in order:

1. this file;
2. `progress/2026-09-11-preference-first-selection-progress.md`;
3. the relevant latest immutable `spikes/<campaign>/assessment.md` only when
   investigating the evidence behind the current verdict.

### "Where are we going?"

Read:

1. `plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`;
2. the active plan/spec for the specific gate.

### "What must RW3–RW6 prove?"

Read:

- `plans/2026-09-12-real-world-tourism-research-spike-gate.md`;
- then the current execution pointer.

### "How is Preference-First supposed to work?"

Read:

- `specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`;
- `plans/2026-09-11-preference-first-selection-implementation.md`;
- current progress for what is actually landed/accepted.

### "Why was an old architecture changed?"

Use `characterization/`, older `progress/`, reports and Git history as
supporting evidence. Do not let them silently override current authority.

---

## 7. Plan completion and status discipline

A plan being present in `plans/` does not mean it is pending. A plan may be:

```text
NOT STARTED
IN PROGRESS
PARTIALLY EXECUTED
EXECUTED / ACCEPTED
SUPERSEDED
HISTORICAL REFERENCE
```

The **current progress pointer** owns execution status. Plans own intended
behavior/sequence.

When a material gate closes, update the current progress pointer rather than
creating a new competing progress file merely to say that it closed.

For large independent future tracks, a new progress pointer is acceptable only
when the current track has explicitly ended or the index clearly declares the
tracks independent and identifies one pointer per track.

---

## 8. Planned maintainability cleanup: Generation Trace v5

Trace v4 is intentionally frozen as the active forensic contract through
Preference-First real-world acceptance.

After Preference-First Core closes, simplify the Bitácora around a generic
execution/decision-step model instead of continuing to mirror every engine
subsystem in `generation-trace.interface.ts` and
`generation-trace-builder.util.ts`.

The canonical roadmap owns the detailed design direction. The core intent is:

```text
step name / description
input
output
decision
reason / reasonCodes
subjects
bounded facts
timing
parent-child correlation
```

Decision owners produce their canonical reasons and audit facts; the trace
recorder records them instead of reconstructing policy.

This is a maintainability refactor, not permission to weaken typed domain
contracts or lose the forensic evidence accumulated during RW1–RW6.

---

## 9. Directory semantics

```text
specs/
  durable architecture/domain contracts

plans/
  intended implementation/gate sequencing

progress/
  execution checkpoints; ONLY the index-designated pointer is current

characterization/
  measured observations, adversarial reviews, experiments

reports/
  bounded execution reports

spikes/
  immutable run artifacts/evidence (outside docs/superpowers)
```

If a document does not fit one of these roles, prefer improving an existing
canonical document over creating another ambiguous "progress" file.
