# Experience dedupe structural authority (2026-10-08)

Track `preference-first-selection`, base `cb39f467`. Implements
`DEDUPE_STRUCTURAL_AUTHORITY` on the accepted forensic
`../semantic-overlap-threshold-forensic-2026-10-08/README.md`
(`DEDUPE_MODEL_MISSING_STRUCTURAL_AUTHORITY`, `NO_EVIDENCE_FOUND_FOR_0_58`).
Not merged. C3 was not run. No live provider was called.

Code: `be/src/modules/tours/utils/experience-dedupe.util.ts` (the only
dedupe authority), source documents wired in
`experience-catalog.service.ts`, trace in
`component-resolution-facts.util.ts`. Spec: identity spec §6.1
"Structural identity authority" and hard invariant 14.

## 1. Structural relation contract

Member key: resolved → `geo:<GeoEntity>`; unresolved → `source:<normalized
wording>`; unresolved without wording → a side-unique key that nothing can
share. Text never enters the relation.

| Relation | Definition |
| --- | --- |
| `EXACT_COMPOSITION` | same member-key set. A PARTIAL seen twice is exact without its members resolving |
| `SUBCOMPOSITION` | one key set strictly inside the other, no conflicting evidenced order; `containment` = `INCOMING_WITHIN_EXISTING` or `EXISTING_WITHIN_INCOMING` |
| `PARTIAL_OVERLAP` | >= 1 shared resolved GeoEntity, neither contains the other (or evidenced order conflicts) |
| `DISJOINT` | no shared resolved GeoEntity. Shared unresolved wording alone is not shared structure |

Sequence semantics are the existing evidenced-`order` ones (spec §9: no
manufactured order). Source position is not treated as visiting order.

## 2. Source provenance relation

From `ExperienceEvidence.url` (persisted) and `input.evidence[].url`
(incoming); no new provenance system. URLs are compared as documents
(fragment, trailing slash and scheme/host case ignored). Titles,
descriptions and the evidence channel (`web`) are not source identity.

`SAME_SOURCE` (a shared document), `DIFFERENT_SOURCE` (both have documents,
none shared), `SOURCE_UNKNOWN` (either side has none).

## 3. Decision table (`judgeDedupeComparison`, one policy)

| Relation | Outcome | `decisiveEvidence` |
| --- | --- | --- |
| EXACT | SAME if roleAware = 1, (name = 1 or concept = 1), no order conflict | `EXACT_COMPOSITION_IDENTITY_CONFIRMED` |
| EXACT | else AMBIGUOUS | `EXACT_COMPOSITION_IDENTITY_UNCONFIRMED` |
| SUBCOMPOSITION | AMBIGUOUS if name >= 0.72 | `STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME` |
| SUBCOMPOSITION | else NEW | `SUBCOMPOSITION_{SAME_SOURCE_CONTAINMENT,DIFFERENT_SOURCE,SOURCE_UNKNOWN}`, or `STANDALONE_COMPOSITE_MEMBERSHIP` |
| PARTIAL_OVERLAP | AMBIGUOUS if name >= 0.72 | `STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME` |
| PARTIAL_OVERLAP | AMBIGUOUS if composite-vs-composite and (component >= 0.5 or roleAware >= 0.4) | `PARTIAL_OVERLAP_IDENTITY_UNRESOLVED` |
| PARTIAL_OVERLAP | else NEW | `PARTIAL_OVERLAP_INSUFFICIENT` / `STANDALONE_COMPOSITE_MEMBERSHIP` |
| DISJOINT | AMBIGUOUS if name >= 0.72 | `SIMILAR_NAME_WITHOUT_SHARED_STRUCTURE` |
| DISJOINT | else NEW | `STRUCTURALLY_DISJOINT` |

Aggregation: SAME if any candidate is SAME (canonical = best-ranked SAME
candidate), else AMBIGUOUS if any is AMBIGUOUS, else NEW. Ranking only
orders candidates.

## 4. SUBCOMPOSITION

Never SAME. It is never made AMBIGUOUS by text overlap or by the
member-ratio cut (spec §8 A ⊂ B with 3/4 shared now coexists). Without a
similar name it is NEW for every source relation. A same-source containment
is recorded as `SUBCOMPOSITION_SAME_SOURCE_CONTAINMENT` in the trace, not as
identity. Persisted `CONTAINS` relations are future work.

## 5. 0.58 and semantic score

- `semanticSimilarity >= 0.58 → AMBIGUOUS`: removed.
- `strongConsistentIdentity` (name >= 0.86 ∧ semantic >= 0.72 ∧ roleAware
  >= 0.8 ∧ distance <= 1.5 km): removed. It was the only SAME branch that
  read the score, it never decided in the corpus (forensic §4), and with
  roleAware 4/5 it could SAME a SUBCOMPOSITION.
- `partial_semantic_overlap` / `strong_semantic_overlap` reason labels:
  removed.
- The score remains in `DedupeEvidence.semanticSimilarity` (diagnostic,
  trace `semanticScore`) and in candidate ranking (weight 0.2). It has no
  decision authority. Its trait-row asymmetry is unchanged and now harmless
  for identity.

## 6. A-F / A-B before and after

Integration fixture (`partial-composite-isolation`): existing PARTIAL A-F
(A,B,D,F resolved), incoming COMPLETE A-B, same description/themes, no URL.

| | Before | After |
| --- | --- | --- |
| decision | AMBIGUOUS, A-B rejected | NEW, A-B persists with 2 members |
| deciding fact | `semantic 0.667 >= 0.58` | `SUBCOMPOSITION` / `INCOMING_WITHIN_EXISTING` / `SOURCE_UNKNOWN` |
| catalog | 1 Experience | 2 Experiences; PARTIAL untouched (C/E unresolved) |

Unit: identical text → NEW; different text → identical decision; different
source → NEW; same source → NEW (`…SAME_SOURCE_CONTAINMENT`); identical
*name* → AMBIGUOUS (the remaining name rule, never SAME).

## 7. Ordering asymmetry

Before: forensic O1/O2, the same pair scored 0.500 (NEW) or 0.857
(AMBIGUOUS) depending on persistence order. After: every decision input
(relation up to containment direction, source relation, name Jaccard,
concept overlap, member overlaps, order conflict, standalone check) is
symmetric. The test reproduces the asymmetric score (0.5 vs 0.8) and gets
NEW both ways with inverted `containment`. Replay reversal of every
single-candidate baseline call: 0 asymmetric decisions.

## 8. Historical impact matrix

Baseline: the forensic probe on `cb39f467` captured 189 real
`decideExperienceDedupe` calls (unit 29, characterization 16, integration
144). Offline replay through the new policy, then a live re-run of all
suites with the probe (217 calls, including the new tests).

| Before → after (replay of 189) | Calls |
| --- | --- |
| SAME → SAME | 72 |
| NEW → NEW | 97 |
| AMBIGUOUS → AMBIGUOUS | 18 |
| AMBIGUOUS → NEW | 2 |

The two flips, both SUBCOMPOSITION:

| Test | Old | New | Label |
| --- | --- | --- | --- |
| `partial-composite-isolation` later A-B vs identically described PARTIAL A-F | AMBIGUOUS (semantic only) | NEW, persists | INTENTIONAL_PRODUCT_CHANGE: DEDUPE_STRUCTURAL_AUTHORITY (the required §4 outcome) |
| `experience-dedupe.partial-composite.spec` resolved-only A-B vs {A,B,D,F} characterization | AMBIGUOUS (component 2/4 >= 0.5) | NEW | INTENTIONAL_PRODUCT_CHANGE: DEDUPE_STRUCTURAL_AUTHORITY, **owner review**: the old shape was AMBIGUOUS by the structural ratio cut, not by semantic; it changes because a SUBCOMPOSITION now coexists |

Live re-run: every other pre-existing test produced an identical decision
sequence. Preserved explicitly: exact SAME (incl. PARTIAL twice), Case 1
SAME, Case 2 NEW, Case 2b same-title AMBIGUOUS, Case 3 AMBIGUOUS, all
exact-set/different-concept AMBIGUOUS, conflicting-order AMBIGUOUS, "Museo
Central" same-name disjoint AMBIGUOUS, standalone-vs-composite NEW,
false-friend wine routes AMBIGUOUS.

An intermediate draft also required structural overlap for the name rule;
replay showed it flipped "Museo Central" (DISJOINT, identical name) to NEW,
an unauthorized change, so the name rule was kept on DISJOINT pairs.

Edge case changed with no corpus instance: two unresolved members with
empty wording used to share the key `source:`; they no longer match.

Decisive evidence over the 217 live calls: SAME
`EXACT_COMPOSITION_IDENTITY_CONFIRMED` 76; AMBIGUOUS
`STRUCTURAL_OVERLAP_WITH_SIMILAR_NAME` 12, `EXACT_…_UNCONFIRMED` 8,
`PARTIAL_OVERLAP_IDENTITY_UNRESOLVED` 4, `SIMILAR_NAME_WITHOUT_SHARED_STRUCTURE` 1;
NEW `NO_EXISTING_CANDIDATES` 83, `SUBCOMPOSITION_*` 15,
`STANDALONE_COMPOSITE_MEMBERSHIP` 7, `STRUCTURALLY_DISJOINT` 7,
`PARTIAL_OVERLAP_INSUFFICIENT` 4.

## 9. Trace

`compositeOutcome.persistence` now records a `DedupeTraceEvidence` for
NOT_PERSISTED (`dedupe.evidence`) **and** PERSISTED (`dedupeEvidence`):
`structuralRelation`, `containment`, `sourceRelation`,
`sharedResolvedGeoEntities`, `sourceMemberCounts`, `decisiveEvidence`,
`nameSimilarity`, `componentOverlap`, `roleAwareComponentOverlap`,
`semanticScore` (diagnostic), `reasons`. `decisiveEvidence` is always a
structural/provenance label, never a number.

## 10. Remaining uncalibrated thresholds (deferred debt)

All from `57d2dfcf`, no evidence:

- `name >= 0.72` → AMBIGUOUS. **Still a standalone text authority** on
  DISJOINT pairs (and corroborating on SUBCOMPOSITION/PARTIAL_OVERLAP).
  Removing it flips accepted same-name cases (Museo Central, Case 2b), so
  it needs its own owner decision.
- `component >= 0.5`, `roleAware >= 0.4` → AMBIGUOUS, now only on
  composite-vs-composite PARTIAL_OVERLAP.
- `name >= 0.86`: removed with `strongConsistentIdentity`.
- Ranking weights (0.22/0.20/0.15/0.30/0.05, distance bonus): ordering only.

Also open: AMBIGUOUS is still not persisted for later resolution (spec §6);
no persisted CONTAINS relation; PARTIAL-vs-COMPLETE views of the same
source (an unresolved member vs its later resolved GeoEntity) are
PARTIAL_OVERLAP, not EXACT. **Superseded** by
`../source-member-identity-2026-10-08/README.md` (`273bf4aa`): members are
keyed by source identity and those views are EXACT_COMPOSITION.

## 11. Verification

| Check | Result |
| --- | --- |
| unit (`npx jest`) | 203/203 suites, 2887/2887 |
| dedupe suites | 40/40 (util, partial-composite, structural-authority) |
| characterization (`zigzag_test`) | 35/36; CHAR-7 `A vs [B]` fails identically before and after (NEW; stale expectation, forensic §verification) |
| integration (`zigzag_test`) | 26/26 suites, 123/123 |
| e2e (`zigzag_test`) | 4/4 suites, 41/41 |
| typecheck, eslint, prettier --check, git diff --check | clean |

Mutations (dedupe suites, util restored after each):

| Mutation | Failing tests |
| --- | --- |
| restore `semantic >= 0.58` standalone AMBIGUOUS | 10 |
| ignore source composition (resolved members only) | 4 (A-F/A-B in both suites) |
| unresolved `null` members shared (`geo:null`) | 4 |
| semantic-dependent SUBCOMPOSITION decision (order-dependent) | 6, incl. the symmetry test |
| containment-direction-dependent decision | 4, incl. both symmetry tests |
