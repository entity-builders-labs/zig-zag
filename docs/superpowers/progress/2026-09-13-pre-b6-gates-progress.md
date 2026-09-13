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

## Review fix — the first fix over-corrected: perfect component match became unilateral SAME authority

A follow-up review caught that the fix above went too far: `exactStructure`
(`componentOverlap === 1 && roleAwareComponentOverlap === 1`) returned SAME
**unconditionally**, with no other check at all. That violates hard invariant
7 ("component overlap alone cannot force SAME") and gate §8's actual
requirement ("100% role-aware component identity **+ compatible real
name/evidence** → SAME" — two ANDed conditions, not one). Two independently
evidenced Experiences can legitimately share the exact same real stops/roles
while representing different tourism concepts (a historical walk and a beer
crawl over the identical 4 stops), or describe the same component set in
explicitly conflicting evidenced sequences — neither should collapse to SAME.

**RED added** (`experience-identity-dedupe.integration-spec.ts`, 2 new
tests): (1) exact component/role match, clearly different name/theme/
evidence ("San Telmo Historical Walking Tour" vs "Craft Beer and Empanada
Crawl" over the identical 4 stops) — must not be SAME; (2) exact component/
role/name match but an explicitly evidenced REVERSE visiting sequence on
each side — must not be SAME. Both confirmed RED against the
over-corrected code (temporarily reverted to verify, then restored) before
the second fix: **2/2 failed**, both `received "SAME"`, exactly the
predicted over-correction.

**Second fix**:
1. `DedupeComponentFingerprint` gained `order?: number | null`
   (`ExperienceComponent.order` was already flowing through at runtime via
   `persistVerifiedExperience`'s existing fingerprint construction — only
   the TYPE and the comparison logic were missing it).
2. New `hasConflictingEvidencedOrder()`: true only when BOTH sides carry a
   real (non-null) evidenced order for at least 2 of the same real
   components AND those two induced sequences genuinely disagree — a
   component with no evidenced order on either side never participates
   ("no manufactured order when order is null").
3. `exactStructure` now additionally requires `nameSimilarity > 0` (the
   natural floor between "zero lexical connection" and "some" — not a
   threshold tuned to fit a fixture) **and** `!orderConflict`.
   `strongConsistentIdentity` also now requires `!orderConflict`. Byte-
   identical names are still never required (that was the original,
   correct Case-1 finding) — a perfect component/role match remains a very
   strong signal, just no longer unilateral authority.

GREEN after the second fix: the 2 new regressions pass, all 12 previously-
green cases remain green (14/14 total), the pure unit suite remains 3/3
unaffected (its fixtures never set `order`, so `orderConflict` is always
`false` there — zero behavior change for anything that doesn't explicitly
evidence a sequence).

## Third fix — the second fix's remaining `nameSimilarity > 0` gap: shared generic words

A second review pass approved the evidenced-order fix but flagged that
`nameSimilarity > 0` is still not real compatible-identity evidence on its
own. Two independently evidenced Experiences over the exact same real stops
can share generic location/format words in their *names* too, not just their
components — "San Telmo Historical Walk" vs. "San Telmo Food Walk" both
truthfully contain "San Telmo" and "Walk" (nameSimilarity ≈ 0.6, non-zero)
while describing different real tourism concepts (history vs. food). Under
the second fix's rule, a perfect component/role match plus this kind of
partial, generic-word-driven name overlap still forced SAME.

**RED added** (`experience-identity-dedupe.integration-spec.ts`, 1 new test):
"EXACT COMPONENT SET, SHARED GENERIC LOCATION/TYPE WORDS ONLY" — identical 4
stops/roles, `canonicalName` "San Telmo Historical Walk" vs. "San Telmo Food
Walk" (shares "san"/"telmo"/"walk", differs on the one concept-bearing word),
`metadata.themes`/`intents` genuinely different (`['history']`/`['walk']` vs.
`['food']`/`['food']`), no evidenced order conflict. Confirmed RED against
the second fix: returned `SAME` (`nameSimilarity > 0` alone was satisfied).

**Third fix** (`be/src/modules/tours/utils/experience-dedupe.util.ts` +
`be/src/modules/tours/services/experience-catalog.service.ts`): added a
dedicated CONCEPT-evidence signal, deliberately excluding free text (title,
description) which is exactly the channel generic location/format words leak
through:
1. `DedupeExperienceFingerprint.conceptTerms?: string[]` — the curated
   `metadata.themes` + `metadata.intents` only (never `canonicalName`, never
   `description`). Populated by a new `ExperienceCatalogService.conceptTerms()`
   private helper, called for both the incoming and every existing candidate
   fingerprint.
2. `DedupeEvidence.conceptOverlap` — `setOverlap` of the two sides'
   `conceptTerms` token sets (same `setOverlap` primitive already used for
   `semanticSimilarity`/`provenanceOverlap`; both-empty is vacuously `1`,
   consistent with how every other overlap signal in this file already
   treats an empty/empty pair — i.e. "no concept data on either side to
   actually conflict").
3. `exactStructure` now requires, in addition to the existing
   `componentOverlap === 1 && roleAwareComponentOverlap === 1 &&
   nameSimilarity > 0 && !orderConflict`: **either** the two names being
   identical after normalization (`nameSimilarity === 1` — a strong,
   unambiguous textual identity signal on its own) **or** real positive
   `conceptOverlap > 0`. Neither disjunct is a tuned magic threshold:
   identical-after-normalization is a natural (not arbitrary) floor, and
   `conceptOverlap > 0` is the same "some real relationship, not none" floor
   already used for `nameSimilarity`, just applied to a curated-category
   signal instead of free text. The original Case 1 fixture (differently-
   worded names, but identical `themes`/`intents`: `history`/`walk` on both
   sides) satisfies the `conceptOverlap > 0` disjunct and remains SAME
   unchanged; the "different theme label" boundary test (`architecture` vs.
   `history`, but both `intents: ['walk']`) also remains SAME via the same
   disjunct (a shared `intent` alone is real concept-level compatibility).
   `nameSimilarity === 1` was NOT reintroduced as a hard requirement (that
   was the ORIGINAL bug this gate exists to fix) — it is only one of two
   alternative ways to satisfy compatibility, the other being
   `conceptOverlap`.

This first implementation of the third fix (requiring `conceptOverlap > 0`
unconditionally, with no `nameSimilarity === 1` escape hatch) was caught by
running the FULL `tours` module regression before declaring done: it broke
a pre-existing, unrelated `experience-catalog.service.spec.ts` boundary test
("merges the existing row and the new observation via
`mergeExperienceMetadata`") — a single-component, byte-identical-name
("museo central") case whose two observations intentionally carry
completely different `themes`/`traits` (to prove the merge itself unions
them) and legitimately expected SAME/merge, not AMBIGUOUS. Adding the
`nameSimilarity === 1` disjunct (rather than only `conceptOverlap > 0`)
fixed this without weakening the new adversarial test — a byte-identical
name is real identity evidence in its own right, independent of concept.

GREEN after the third fix: the 1 new regression passes (15/15 in this file),
all 14 previously-green cases remain green, the pure unit suite remains 3/3
unaffected, and the previously-broken `experience-catalog.service.spec.ts`
boundary test is green again.

## Exit criteria (from the gate plan, section 11) — all satisfied

- [x] Case 1 SAME is green on real Postgres (differently-worded second source).
- [x] SAME is idempotent under a repeated identical observation (Case 1b).
- [x] SAME convergence is provider/input-order independent (Case 1c, reversed order).
- [x] Case 2: two distinct San Telmo walks sharing `history`+`walk`+area survive as separate canonical Experiences.
- [x] Classification/facet equality alone cannot collapse identity (same components + different theme label => still SAME; same facets + different components => NEW).
- [x] Case 3 AMBIGUOUS creates no new row and mutates no canonical row (metadata/evidence/components on the existing row asserted unchanged after the ambiguous submission).
- [x] Resolver surfaces `AMBIGUOUS_DEDUPE` (Case 3b) without persistence corruption.
- [x] A perfect component/role match with a clearly conflicting name/concept/evidence is NOT SAME (review-fix regression).
- [x] A perfect component/role/name match with an explicitly conflicting evidenced order is NOT SAME (review-fix regression).
- [x] A perfect component/role match whose names overlap ONLY via shared generic location/type words (not real concept compatibility) is NOT SAME (third-fix regression).
- [x] All assertions verify via a real Postgres re-read (`prisma.experience.findUnique`/`count`), never trusting only the returned object.
- [x] Full existing integration suite remains green: 14 suites / 59 tests (was 13/44 before this file; 56 after the first fix, 58 after the review fix's 2 new tests, 59 after the third fix's 1 new test).
- [x] Full backend regression remains green: 141 suites / 1360 tests, no regressions.
- [x] `yarn typecheck`, `yarn lint:check` (scoped `eslint --fix`), `yarn build` all clean.

## Files changed

- `be/src/modules/tours/utils/experience-dedupe.util.ts` (`exactStructure`/`strongConsistentIdentity` fix + review fix + third fix; new `order` field + `hasConflictingEvidencedOrder`; new `conceptTerms`/`conceptOverlap` + `conceptTokenSet`)
- `be/src/modules/tours/services/experience-catalog.service.ts` (new `conceptTerms()` private helper, wired into both incoming and existing fingerprint construction)
- `be/test/integration/tour-generation/experience-identity-dedupe.integration-spec.ts` (15 tests total: 12 original + 2 review-fix regressions + 1 third-fix regression)

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
- No other deviations. Nothing was weakened to force a pass — both real
  gaps found (name-similarity originally gating out a legitimate exact-
  structure SAME, then the corrected version over-granting unconditional
  SAME authority to a perfect component match) were fixed at the algorithm
  level, never worked around in the fixtures.

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
