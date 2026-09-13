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
Experience Identity Gate      COMPLETE (2026-09-13)

Real-World PRE-B6 Spikes      NEXT
B6                             BLOCKED on Real-World PRE-B6 Spikes
```

B5's review blockers were fixed and its deterministic/Postgres verification was
accepted. Do not reopen B5 for unrelated planner/composition work merely because
later real-world research may expose a new problem. If a real spike does expose
an actual B5/identity defect, classify it honestly and repair that exact defect.

---

# DONE — Experience Identity / Dedupe Postgres Gate

Executed in full against real Postgres:

`docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`

**Status: GREEN.** Real fix found and applied (see below) — this was not a
no-op verification pass.

## What was found and fixed

New integration file:
`be/test/integration/tour-generation/experience-identity-dedupe.integration-spec.ts`
(12 tests, real Postgres, seeded via the real `ExperienceCatalogService.upsertGeoEntity`/
`persistVerifiedExperience` boundary — Case 3b additionally exercises the real
`ExperienceProposalResolverService`).

RED (first run, unmodified `decideExperienceDedupe`): **5 of 12 failed**, all
"expected SAME, received AMBIGUOUS" — every failure was the literal Case-1
fixture from the design spec (two sources, byte-identical real component set
+ role, differently-worded `canonicalName`). Root cause: `exactStructure`
required `nameSimilarity === 1` in addition to a perfect component-set match,
so any two independent sources describing the identical real Experience with
different title wording (the realistic, expected case — not a hypothetical
edge case) fell through to the `AMBIGUOUS` branch purely because
`roleAwareComponentOverlap`/`componentOverlap` (both `1.0`) independently
crossed the `AMBIGUOUS` thresholds (`>=0.4`/`>=0.5`) while
`strongConsistentIdentity`'s `nameSimilarity >= 0.86` gate also failed (token-
Jaccard on genuinely different wording rarely clears 0.86).

**Fix** (`be/src/modules/tours/utils/experience-dedupe.util.ts`):
`exactStructure` no longer requires `nameSimilarity === 1` — only
`componentOverlap === 1 && roleAwareComponentOverlap === 1` (a COMPLETE,
role-consistent match of the real component set on both sides). This is not
"component overlap alone forcing SAME" in the sense hard invariant 7 warns
against (that's about a high-but-partial overlap, e.g. Case 3's 0.75, which
correctly still resolves AMBIGUOUS/unaffected by this change) — a true 1.0/1.0
match is the strongest non-name identity signal there is: literally the same
real places, same roles, on both sides. Verified against the existing pure
unit suite (`experience-dedupe.util.spec.ts`, 3/3, unaffected — its own SAME
fixture already used an identical name on both sides, so this fix is additive,
not a behavior change for that test) and the new integration suite (12/12
GREEN after the fix).

## Exit criteria (from the gate plan, section 11) — all satisfied

- [x] Case 1 SAME is green on real Postgres (differently-worded second source).
- [x] SAME is idempotent under a repeated identical observation (Case 1b).
- [x] SAME convergence is provider/input-order independent (Case 1c, reversed order).
- [x] Case 2: two distinct San Telmo walks sharing `history`+`walk`+area survive as separate canonical Experiences.
- [x] Classification/facet equality alone cannot collapse identity (same components + different theme label => still SAME; same facets + different components => NEW).
- [x] Case 3 AMBIGUOUS creates no new row and mutates no canonical row (metadata/evidence/components on the existing row asserted unchanged after the ambiguous submission).
- [x] Resolver surfaces `AMBIGUOUS_DEDUPE` (Case 3b) without persistence corruption.
- [x] All assertions verify via a real Postgres re-read (`prisma.experience.findUnique`/`count`), never trusting only the returned object.
- [x] Full existing integration suite remains green: 14 suites / 56 tests (was 13/44 before this file).
- [x] Full backend regression remains green: 141 suites / 1360 tests, no regressions.
- [x] `yarn typecheck`, `yarn lint:check` (scoped `eslint --fix`), `yarn build` all clean.

## Files changed

- `be/src/modules/tours/utils/experience-dedupe.util.ts` (`exactStructure` fix)
- `be/test/integration/tour-generation/experience-identity-dedupe.integration-spec.ts` (new, 12 tests)

## Deviations from the gate plan

- Section 8's illustrative Case-2 overlap example (2-of-4 shared components)
  was intentionally NOT used verbatim for the mandatory NEW assertion — the
  plan's own Case 2b text explicitly permits choosing a fixture with "enough
  independent identity evidence to justify NEW" for that specific assertion.
  A 2-of-4 overlap sits exactly on the current `componentOverlap >= 0.5`
  AMBIGUOUS boundary, so the mandatory Case 2 fixture here uses a 1-of-4
  overlap instead (clearly NEW under the current thresholds); the higher-
  overlap, boundary-straddling scenario is exercised separately by the
  "component overlap boundaries" AMBIGUOUS test and Case 2b (which
  explicitly accepts AMBIGUOUS as compliant, per the plan's own text).
- No other deviations. Nothing was weakened to force a pass — the one real
  gap found (name-similarity gating out a legitimate exact-structure SAME)
  was fixed at the algorithm level, not worked around in the fixtures.

---

# NEXT — Real-World Tourism Research Spike Baseline, PRE-B6

The identity gate above is now green — execute this plan next, in full:

`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

**Do not start B6 before this gate is green.**

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
