# A7 Design Correction — Exploration Signals Replace Iconicity

Status: **A6/A6.1 APPROVED; A7 integrated into the main plan/spec before implementation**
Branch: `feat/preference-first-selection`
Written: 2026-09-11
Updated: 2026-09-12

Approved A6/A6.1 branch HEAD before this docs correction:
`088ca4fea32cd91cf256e6c57bf09ce6b1a86dce`

Canonical execution plan:
`docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`

Canonical design spec:
`docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`

Supplemental rationale / detailed historical expansion:
- `docs/superpowers/specs/2026-09-11-exploration-signals-design.md`
- `docs/superpowers/plans/2026-09-11-a7-evidence-backed-exploration-signals.md`

---

## Review decision

The old main-plan A7 wording:

```text
A7 — Iconicity util
computeIconicity(): 0..1
```

was superseded before any A7 code was written.

`explorationStyle` remains a useful user preference, but it is not a standard
Experience taxonomy and must not force each Experience into an `iconic` vs
`local` category.

A7 now models independent evidence-backed signals:

```text
prominence
tourismIntensity
localCharacter
```

with explicit unknown state and provenance.

Canonical corrections:
- low prominence is not evidence of local character;
- high prominence is not evidence of low quality;
- tourism intensity is not inferred from popularity alone;
- missing evidence is `unknown`, not zero;
- `local_deep_dive` is not `1 - prominence`;
- explorationStyle remains ranking-only and outside coverage/sufficiency/
  acquisition authority.

---

## Main-document integration

The correction is now incorporated directly into the two documents an execution
agent should normally read:

```text
progress / execution gate
        ↓
main implementation plan
  A7 — Evidence-Backed Exploration Signals
        ↓
main canonical design spec
  explorationStyle + ExplorationSignals semantics
        ↓
implementation
```

The main plan now contains the A7 interfaces, input contract, prominence policy,
tourism/local-character semantics, unknown-state rules, exploration-tilt rules,
required tests and scope boundary. It also carries the corrected signal model
forward into C1/C2/C3, trace, E2E, Definition of Done and execution summary.

The main spec now contains the canonical exploration-style semantics and carries
them through classification boundaries, Stage 6c, deterministic composition,
trace/Bitácora, testing and the resolved design-decision summary.

The two A7-specific files above remain useful for rationale and extra detail, but
an agent **must not need them to discover or understand the next executable
step**. If wording ever diverges again, the main plan/spec are authoritative.

---

## Execution gate

```text
A1    ✅
A2    ✅
A3    ✅
A4    ✅
A5    ✅
A6    ✅
A6.1  ✅ APPROVED
A7    ⏭️ NEXT — Evidence-Backed Exploration Signals
B1    ⛔ do not start before A7 review
```

Normal agent navigation from this point:

1. read current progress / execution gate;
2. identify `A7` as NEXT;
3. read the **main implementation plan** A7 section;
4. read the **main canonical spec** exploration-style/exploration-signal sections;
5. implement only A7;
6. update progress with real SHAs/tests;
7. STOP before B1.

No A7 implementation exists yet at the time of this correction.

No meaningful local-app manual test is expected from A7 itself; it is a pure
ranking primitive and is not live-wired until later composition/orchestration
checkpoints.
