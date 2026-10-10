# Source member identity (2026-10-08)

Track `preference-first-selection`, base `28242023`, code `273bf4aa`.
The last bounded fix before C3, on top of the accepted
`DEDUPE_STRUCTURAL_AUTHORITY` (`../dedupe-structural-authority-2026-10-08/`)
and partial composite persistence. Not merged. C3 was not run. No live
provider was called.

Code: `be/src/modules/tours/utils/experience-dedupe.util.ts`
(`sourceCompositionIdentity`, `sourceMemberCorrespondence`), trace in
`component-resolution-facts.util.ts`, incoming `sourcePosition` in
`experience-catalog.service.ts`. Spec: identity spec §6.1 "Source member
identity" and hard invariant 15.

## 1. Old structural-member identity

```text
resolved member   -> geo:<GeoEntity id>
unresolved member -> source:<normalized wording>
no wording        -> side-unique key
```

Resolving a member changed its key, so the composition identity of an
Experience moved with its resolution state. A PARTIAL A-B-C-D (C, D
unresolved) vs its COMPLETE view was PARTIAL_OVERLAP (then AMBIGUOUS through
the composite overlap cut), and a PARTIAL with {A,B} resolved vs one with
{C,D} resolved was DISJOINT.

## 2. New source-member identity

`SourceMemberIdentity = { sourcePosition, sourceWording }`: the persisted
position inside its Experience and the normalized source wording. No
GeoEntity and no resolution state. `sourcePosition` is source membership,
never visiting order: it is not read by the evidenced-order check.

## 3. Persisted fields used

| Field | Role |
| --- | --- |
| `ExperienceComponent.sourcePosition` | member identity inside its Experience (`@@unique([experienceId, sourcePosition])`); null only on legacy rows, kept null |
| `ExperienceComponent.sourceName` | source wording, present on resolved and unresolved rows; the cross-Experience correspondence key (via `normalizeGeoName`) |
| `ExperienceComponent.geoEntityId` + `resolutionState` | supporting correspondence evidence only |
| `ExperienceComponent.order` | evidenced order (conflict check), unchanged semantics |

No schema change, no new key, no LLM-generated identity. Admin CONFIRM and
REVOKE rewrite only `geoEntityId` / `resolutionState` / reason / source, so
the identity is stable through them (verified on Postgres, §7). The incoming
fingerprint now carries `sourcePosition` (its array index, the value it is
persisted with).

## 4. Cross-Experience correspondence rule

Positions are never compared across Experiences. Members of the two sides
(and of one side) are linked, transitively, when they

1. carry the same normalized source wording, unless the members bearing that
   wording resolve to more than one distinct GeoEntity anywhere in the pair
   (an ambiguous wording, e.g. "Plaza Mayor" in two cities, is no identity);
   or
2. both resolved to the same GeoEntity (links differently worded members:
   "National Bank" and "Banco de la Nacion" once both resolve to it).

Each class therefore spans at most one GeoEntity, and the result does not
depend on comparison direction or member order. A class is **shared** when
it has members on both sides, and **grounded** when one of its members (on
either side) is resolved. Relation:

| Relation | Rule (over classes) |
| --- | --- |
| DISJOINT | no grounded shared class (shared unresolved wording alone, and members without wording, are never structure) |
| EXACT_COMPOSITION | every class of each side is shared |
| SUBCOMPOSITION | one side's classes inside the other's, no evidenced-order conflict |
| PARTIAL_OVERLAP | otherwise |

The decision table (`judgeDedupeComparison`) is unchanged. `componentOverlap`,
`roleAwareComponentOverlap` and `orderConflict` are computed over the same
classes. No threshold was added or changed.

## 5. PARTIAL vs COMPLETE, same source

| Pair | Old | New |
| --- | --- | --- |
| A-B-C-D {A,B} vs {A,B,C,D} | PARTIAL_OVERLAP | EXACT_COMPOSITION, SAME (both directions) |
| A-B-C-D {A,B} vs {C,D} | DISJOINT | EXACT_COMPOSITION |
| every pair of resolution subsets (left non-empty) | varies | EXACT_COMPOSITION (exhaustive test) |

Trace of {A,B} vs {A,B,C,D}: `sharedSourceMembers` lists positions 0..3
(basis `SOURCE_WORDING` + `RESOLVED_GEOENTITY` for A, B; `SOURCE_WORDING`
for C, D); `sharedResolvedGeoEntities` = [A, B], separately. No GeoEntity id
appears as a member identity.

## 6. SUBCOMPOSITION / overlap / disjoint

Exhaustive over resolution states (both directions):

- A-B vs A-B-C-D: SUBCOMPOSITION, `INCOMING_WITHIN_EXISTING`, NEW in all 60
  grounded states (the 4 with no A/B resolved on either side are ungrounded
  and DISJOINT by rule).
- A-B-C vs B-C-D: PARTIAL_OVERLAP in every grounded state.
- A-B vs C-D: DISJOINT in all 16 states.

## 7. Admin confirm / revoke invariance

Unit and Postgres (`partial-composite-administration` "enrichment
invariance"): persisted PARTIAL Plaza de Mayo walk (National Bank
UNRESOLVED) → ADMIN CONFIRM National Bank → Banco Nacion (COMPLETE) →
ADMIN REVOKE of that assertion (PARTIAL). At each state, read from the real
rows:

- `sourceCompositionIdentity` = [(0, plaza de mayo), (1, cabildo),
  (2, national bank), (3, casa rosada)], unchanged;
- vs the same-source COMPLETE: EXACT_COMPOSITION both directions;
- vs Plaza de Mayo + Cabildo: SUBCOMPOSITION both directions;
- after revoke, the same source submitted COMPLETE dedupes SAME onto the
  PARTIAL Experience (EXACT_COMPOSITION); 1 Experience.

The only resolution-driven relation change is the one invariant 15 permits:
a differently worded member ("National Bank" vs "Banco de la Nacion")
becomes corresponding once both resolve to one GeoEntity (new identity
evidence; the members' own identities do not change).

## 8. A-F / A-B

PARTIAL A-F with {A,B,D,F}, {A,B}, {C,D,E,F} resolved, and COMPLETE A-F, each
vs a later COMPLETE A-B: SUBCOMPOSITION, NOT SAME, NEW. The accepted
`INTENTIONAL_PRODUCT_CHANGE: DEDUPE_STRUCTURAL_AUTHORITY` outcome holds,
now independent of which A-F members are resolved.

## 9. Historical impact matrix

Baseline: the forensic probe
(`../semantic-overlap-threshold-forensic-2026-10-08/probe/`) re-captured
at `28242023` (before this change): 217 real `decideExperienceDedupe`
calls (unit 57, characterization 16, integration 144; e2e makes none).

| Replay of 217 through the new code | Calls |
| --- | --- |
| SAME → SAME | 76 |
| NEW → NEW | 116 |
| AMBIGUOUS → AMBIGUOUS | 25 |
| decision flips | 0 |
| per-candidate relation flips | 0 |
| changed `componentOverlap` / `roleAware` / `orderConflict` / name / semantic | 0 |
| relation differs by comparison direction | 0 |

Live re-run with the probe after the change: all 112 pre-existing tests that
call dedupe produce the identical decision sequence; the 10 new tests add the
calls above. No expectation of any pre-existing test changed except two
exact-shape `structure` assertions that now also list `sharedSourceMembers`
(and the trace field rename `structuralRelation` →
`sourceCompositionRelation`, no compatibility alias). The corpus had no
resolved-vs-unresolved same-wording pair, which is why nothing flips; the
behavior change is exactly the new cases in §5–§8.

Behavior intentionally changed (no corpus instance before):

- PARTIAL vs COMPLETE (or two PARTIALs resolved differently) of one source
  composition: PARTIAL_OVERLAP / DISJOINT → EXACT_COMPOSITION (SAME when the
  existing SAME confirmation holds). Label:
  `INTENTIONAL_PRODUCT_CHANGE: SOURCE_MEMBER_IDENTITY` (this brief's Case 1).
- A source member resolved on one side now corresponds to the same wording
  unresolved on the other, and grounds the relation.
- An evidenced-order conflict is now also seen on members resolved on one
  side only.

## 10. Tests, mutations, tooling

New `experience-dedupe.source-member-identity.spec.ts` (20 tests) covers
brief tests 1–9, Case 4, the National Bank lifecycle, the "Plaza Mayor"
wording veto, and the trace. New integration test in
`partial-composite-administration` (Postgres admin lifecycle).

Mutations (util restored after each; dedupe suites, 60 tests):

| Mutation | Failing |
| --- | --- |
| M1 restore old rule: resolved → GeoEntity, unresolved → wording, literal shared-GeoEntity gate, resolved-only order | 13, incl. every enrichment-invariance test (1–6, National Bank, A-F with A,B unresolved) |
| M2 old member key rule only | 13 |
| M3 no ambiguous-wording veto | 1 (Plaza Mayor) |
| M4 ungrounded shared wording relates compositions | 2 |
| M5 evidenced order on resolved members only | 1 |

Tooling (final code): unit 204/204 suites, 2907/2907; integration (`zigzag_test`)
26/26, 124/124; e2e 4/4, 41/41; characterization 35/36, CHAR-7 `A vs [B]`
failing identically at baseline (stale pre-existing expectation); typecheck,
`lint:check`, prettier `--check`, `git diff --check` clean. During the
baseline capture one integration test failed once with the probe attached
and passed on a plain rerun (123/123 at `28242023`): flaky, not touched.

## 11. Open debt

- A SAME onto a PARTIAL Experience merges evidence/metadata only; it does not
  adopt the incoming resolution of still-unresolved members (before this fix
  that pair was AMBIGUOUS and nothing was persisted, so no knowledge is lost
  relative to before). Recorded in spec §6.1.
- Candidate retrieval still loads existing Experiences by name or shared
  resolved GeoEntity; a same-source PARTIAL with no resolved member in common
  with the incoming one and a different name is not retrieved. Unchanged.
- Thresholds (`name >= 0.72`, component `>= 0.5`, role-aware `>= 0.4`) were
  not reopened; none blocks invariant 15.
