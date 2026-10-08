# Partial composite persistence: implementation evidence (2026-10-08)

Track `preference-first-selection`. Implements the owner decisions D1–D7
taken on the accepted investigation dossier
`../partial-composite-investigation-2026-10-07/README.md` (commit
`6688d2ef`). No live provider was called and C3 was not run.

Commits:

| Commit | Content |
| --- | --- |
| `e5ff867a` | D7 characterization, written before any dedupe change |
| `8bd16b97` | schema + source members + PARTIAL policy + readers + dedupe |
| `d047b179` | verified-hint assertion audit + admin revoke/confirm |
| (this commit) | docs, evidence, progress |

## 1. Final schema

`ExperienceComponent` (one row per SOURCE-DECLARED member):

| Field | Type | Meaning |
| --- | --- | --- |
| `geoEntityId` | `String?` | null only while UNRESOLVED |
| `sourcePosition` | `Int?` | 0-based position in the source composition; member identity; never renumbered; null only on legacy rows |
| `sourceName` | `String?` | the member's component hint name; null only on legacy rows; never backfilled from `GeoEntity.name` |
| `order` | `Int?` | evidenced visiting sequence over ALL members (unchanged meaning) |
| `role`, `required` | unchanged | |
| `resolutionState` | `RESOLVED \| UNRESOLVED` (default RESOLVED) | |
| `resolutionReason` | enum of PARTIAL-eligible reasons + `RESOLUTION_REVOKED` | |
| `resolutionSource` | `AUTOMATIC \| ADMIN`, null when unknown (legacy) | |

- `@@unique([experienceId, geoEntityId])` is dropped;
  `@@unique([experienceId, sourcePosition])` replaces it (NULLs distinct, so
  legacy rows are valid).
- CHECK `experience_component_resolution_consistent`: RESOLVED ⇒ GeoEntity
  set and no reason; UNRESOLVED ⇒ no GeoEntity, no source, and source name,
  position and reason set.
- The reason enum holds exactly the eligible reasons, so a blocking deficit
  has no persisted form (a unit test pins enum == eligible set).

`GeoEntityVerifiedHintAssertion`: `geoEntityId`, `hintName`, `hintKey`,
`source (AUTOMATIC|ADMIN)`, `actorUserId?`, `createdAt`, `revokedAt?`,
`revokedByUserId?`, `revocationReason?`. A partial unique index allows one
active assertion per `(geoEntityId, hintKey, source)`. The migration
backfills one AUTOMATIC row per key already in `verifiedHintNameKeys` (the
automatic resolver was the only writer); `createdAt` is the migration time.

No COMPLETE/PARTIAL column: completeness is derived from the rows.

## 2. Source-member identity

`(experienceId, sourcePosition)`. There was no stable source key to reuse:
`hintKey` is per run. The position is the index of the member in the
source composition at persistence. It is unique and stable inside one
Experience because members are only ever written once, in source order,
and enrichment updates a row in place.

## 3. Canonical component policy

`be/src/modules/tours/utils/experience-source-membership.policy.ts`:
`allSourceMembers`, `resolvedSourceMembers`, `unresolvedSourceMembers`,
`distinctResolvedGeoEntityIds`, `distinctResolvedSourceMembers` (the
navigable view: first resolved member per GeoEntity), `isCompositeMembership`,
`sourceCompositionCompleteness`, `decideSourceCompositionAdmission`.

Migrated consumers: catalog projection and detail (`findById` adds
`sourceComposition`), composite retrieval by area / exact component / route
name (distinct count, not row count), generation hydration + trace
`componentCount` + media outbox, Tour snapshot, embedding document, dedupe
(member keys, standalone test, order conflict), resolver persistence and
admission, the geographic validator's completeness gate, the trace
`buildCompositeOutcome`. The PostGIS boundary keeps its inner join (the SQL
form of "resolved"). Planner duration/footprints, composition, overlap
filter and preference evaluators read the projection, which holds only
navigable members, so they needed no change.

## 4. PARTIAL eligibility rule

```text
COMPLETE: every member resolved                      -> admitted (unchanged)
PARTIAL : >= 2 DISTINCT resolved GeoEntities
          AND every unresolved member MISSING_KNOWLEDGE -> admitted
else    : INCOMPLETE_SOURCE_COMPOSITION (unchanged reason)
```

The floor reuses `MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS` (2). Applied at
the resolver seam, the validator, `persistVerifiedExperience` (defense in
depth) and the trace outcome, all through the same function.

## 5. Deficit classification matrix

`be/src/modules/tours/utils/component-deficit-classification.policy.ts`
(exhaustive switches; the research axis `deficitClassification` moved here
unchanged).

| Reason | Producing branch | Class | PARTIAL |
| --- | --- | --- | --- |
| NO_CANDIDATE_ACQUIRED | no admissible candidate (incl. per-candidate admission filters) | MISSING_KNOWLEDGE | eligible |
| CANDIDATE_UNCONFIRMED | acquired, verdict not corroborated | MISSING_KNOWLEDGE | eligible |
| AMBIGUOUS_CANDIDATES | AMBIGUOUS verdict / route ambiguity | MISSING_KNOWLEDGE | eligible |
| CANDIDATE_REJECTED | every acquired candidate REJECTED (candidate-level) | MISSING_KNOWLEDGE | eligible (D3) |
| RESOLUTION_REVOKED | admin revocation (persisted only) | MISSING_KNOWLEDGE | eligible |
| IDENTITY_CONFLICT | strong identities owned by 2+ GeoEntities | CONTRADICTORY_EVIDENCE | blocks |
| DESTINATION_INCOMPATIBLE | area hint outside/coarser than destination | CONTRADICTORY_EVIDENCE | blocks |
| DESTINATION_COMPATIBILITY_UNKNOWN | destination geography unknown | UNKNOWN | blocks |
| PROVIDER_FAILURE | failed acquisition attempt | SYSTEM_FAILURE | blocks |
| IDENTITY_AUTHORITY_UNAVAILABLE (new) | acquired candidate whose verdict rule was WIKIDATA_UNAVAILABLE | SYSTEM_FAILURE | blocks (D4) |
| INVALID_SOURCE_COMPONENT | not produced at runtime | — | blocks |

## 6. Expectation changes

| Test | Old | New | Label |
| --- | --- | --- | --- |
| `required-geographic-authority.spec.ts` A–F (C/E missing) | rejected, validator not called | accepted, all 6 members persisted, C/E unresolved | INTENTIONAL_PRODUCT_CHANGE: PARTIAL_COMPOSITE_POLICY |
| `partial-composite-isolation` A–F | rejected, 0 rows | 1 PARTIAL Experience, 6 members, planner-visible, no standalone | same |
| `partial-composite-isolation` A-B-C, B AMBIGUOUS | rejected | PARTIAL, B unresolved AMBIGUOUS_CANDIDATES, no winner | same |
| `trace-failure-semantics` "Partial walk" | NOT_EVALUATED / NOT_PERSISTED | ACCEPTED / PERSISTED; the old assertion moved verbatim onto a below-floor and a PROVIDER_FAILURE fixture | same |
| `partial-composite-isolation` later A-B after A–F | A-B accepted, 1 Experience | see §7: held AMBIGUOUS by semantic overlap; independent A-B NEW (new test) | CONSEQUENCE of the A–F change, **owner review required** |
| resolver spec: 4 "converging hints" tests + 14.F | one persisted component for 2 hints on one GeoEntity | both members persisted (D2); notability still counted once | INTENTIONAL_PRODUCT_CHANGE: SOURCE_MEMBER_IDENTITY (D2), **not in the pre-authorized four** |
| resolver spec "3 evidence-backed components" | `{geoEntityId, order, role}` | same + `sourceName` | SOURCE_MEMBER_IDENTITY (D2) |

Fixture-shape only (no asserted outcome changed): the catalog spec's
exact-component query mock (`_count` → member rows), route-name fixtures
and embedding-indexer fixture gain `geoEntityId` (real rows always have
it), the hint-memory unit mock gains `$transaction` and the assertion
delegate, and the A–F unit catalog mock returns a persisted id.

## 7. Partial vs complete dedupe

A member key is `geo:<GeoEntity>` when resolved, else
`source:<normalized source wording>`; never `null`.

| Case | Decision |
| --- | --- |
| PARTIAL A–F (A,B resolved) vs COMPLETE A-B, identical name/concept | AMBIGUOUS (never SAME), both directions; overlap 2/6 |
| COMPLETE A-B vs PARTIAL A–F (A,B,D,F resolved), distinct names, no shared text | NEW |
| two unrelated PARTIALs with unresolved members | overlap 0, NEW |
| the same PARTIAL source seen twice | SAME (no duplicate) |
| standalone A vs PARTIAL A–F | standalone-vs-composite (distinct count) |

Finding (owner review): in the integration fixture both walks share an
identical description and themes. The unchanged rule "semantic overlap
>= 0.58 ⇒ AMBIGUOUS" then holds the later A-B back — exactly as it would
against a COMPLETE A–F with the same text. Structurally the pair is
distinct (D7 holds: never SAME, never promoted). The dossier required NEW
here; that holds only when the two sources do not share their description.
No dedupe threshold was changed.

## 8. Tour snapshot behavior

`buildTourExperienceCreateData` writes `distinctResolvedSourceMembers`
only: an unresolved member never becomes a navigable POI, and two members
on one GeoEntity are one stop. Existing Tours keep their
`TourExperienceComponent` rows after enrichment; Tours materialized later
see it (integration-tested with the production builder).

## 9–12. Admin lifecycle and National Bank

`be/src/modules/tours/services/catalog-knowledge-administration.service.ts`.

- REVOKE (`revokeVerifiedHintAssertion`): stamps `revokedAt`/actor/reason;
  if no active assertion still supports the pair, removes the key (and its
  aligned name) from the index, sets every RESOLVED member linked to that
  GeoEntity under that hint key to UNRESOLVED / RESOLUTION_REVOKED, and
  re-admits each Experience (stays COMPLETE/PARTIAL, or ARCHIVED with rows
  kept). The automatic resolver then returns `SUPPRESSED_BY_REVOCATION`
  instead of re-learning the pair.
- CONFIRM (`confirmSourceMember`): UNRESOLVED member → existing GeoEntity,
  `resolutionSource=ADMIN`, ADMIN assertion (+ actor), index append; fails
  with `HINT_OWNED_BY_ANOTHER_GEOENTITY` when the key is active elsewhere.
- Embeddings of affected Experiences are cleared for re-indexing.

National Bank (integration-tested with synthetic rows):

```text
before : findGeoEntityCandidatesForHint("National Bank")
         -> Edificio First National Bank of Boston, VERIFIED_HINT
REVOKE : assertion stamped (AUTOMATIC, createdAt, revokedAt, reason kept)
         index emptied; member "National Bank" UNRESOLVED/RESOLUTION_REVOKED
         walk persists PARTIAL (3 distinct resolved)
         lookup -> no candidate; automatic re-learn suppressed
CONFIRM: member -> Banco de la Nacion Argentina (ADMIN, actor recorded)
         walk COMPLETE; no new Experience or GeoEntity
after  : lookup -> Banco de la Nacion Argentina, VERIFIED_HINT
```

The automatic resolution of "National Bank" is unchanged (not required to
improve); no translation, distance, headquarters or stop-word rule.

## 13. PARTIAL → COMPLETE

Confirming the last unresolved member makes completeness COMPLETE in place
(same Experience id, same GeoEntities). A later COLD run that resolves more
members does NOT upgrade a PARTIAL: SAME-dedupe merges evidence, never
components (unchanged); enrichment is the explicit admin path.

## 14. Catalog / WARM

A PARTIAL Experience is VERIFIED and visible through `findVerifiedWithin`,
`findVerifiedWithinForMatching` (PostGIS join on resolved members),
`findVerifiedByIds` and composite retrieval when it has ≥ 2 distinct
resolved GeoEntities. Re-persisting the same PARTIAL source dedupes SAME.
No live WARM run was executed.

## 15. Migration / reset

Migration `20261008120000_experience_source_members_and_hint_assertions`
applies over existing data: legacy rows stay RESOLVED with null
position/name/source; hint keys are backfilled as AUTOMATIC assertions.
The next C3, when separately authorized, must use a fresh/reset catalog:
the previous C3 catalog holds the false National Bank and Club Atlético
memories. Alternatively, revoke them through the admin primitive.

## 16. Non-regression matrix

Identity verifier code and its specs are untouched; all pass:
Club Atlético → San Lorenzo NOT VERIFIED, El Zanjón VERIFIED, Farmacia la
Estrella VERIFIED, Cabildo VERIFIED, Don Carlos → Carlos Pellegrini NOT
VERIFIED, Catedral / Bar El Federal false positives NOT VERIFIED, A4, P0.2,
FADU/Exactas separation, RW1 and RW4 trust matrices (unit + integration
suites green). Hint multiplicity across GeoEntities from automatic memory
is unchanged (`verified-hint-memory` integration).

Pre-existing, not caused here: `test/characterization/shared-component-identity`
CHAR-7 "A vs [B] → AMBIGUOUS" fails identically against the HEAD dedupe
util (it returns NEW since `d6f06034` introduced the standalone-vs-composite
rule). Left untouched.

## 17. Verification

| Check | Result |
| --- | --- |
| unit (`yarn jest`) | 202 suites / 2866 tests pass (baseline 199 / 2824) |
| integration (`zigzag_test`) | 26 suites / 123 tests pass |
| e2e | 4 suites / 41 tests pass |
| characterization | 7/8 suites; 1 pre-existing failure (CHAR-7, above) |
| typecheck / lint / prettier / `git diff --check` | clean |

Targeted mutations (each run against its targeted specs, then reverted):

| Mutation | Result |
| --- | --- |
| distinct floor counts resolved rows | killed (policy + facts specs) |
| PROVIDER_FAILURE eligible | killed |
| CANDIDATE_REJECTED blocking | killed |
| D4 branch removed | killed |
| dedupe ignores unresolved members | killed |
| unresolved dedupe key is a shared `null` | killed |
| revoke keeps the lookup index | killed (integration) |
| confirm skips the ownership conflict | killed (integration) |
| snapshot includes every member | killed (integration) |
| automatic re-learn after revocation | killed (integration) |

## 18. Remaining limitations

- `strictNullChecks` is off, so the type checker does not flag a raw
  `component.geoEntity.x`; the policy and this audit are the guard.
- A member whose candidate was acquired by one strategy while another
  strategy failed is CANDIDATE_UNCONFIRMED (existing reason derivation),
  so it is eligible; only an all-failed member is PROVIDER_FAILURE.
- Revocation unresolves members by `normalizeGeoName(sourceName)` = hint
  key; legacy members (null `sourceName`) are never touched.
- CONFIRM does not restore an ARCHIVED Experience to VERIFIED, and does not
  check the member's expected physical kind (no persisted expectedKind).
- Admin actions have no authorization layer, controller or UI.
- The frontend detail screen still counts `components.length` of the
  navigable list (no unresolved member reaches it).
- `TourExperienceComponent` keeps no source position.
- The case in §7 needs an owner decision.
