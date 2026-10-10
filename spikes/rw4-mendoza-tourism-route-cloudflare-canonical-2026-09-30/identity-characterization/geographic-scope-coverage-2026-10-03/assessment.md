# RW4: geographic scope vs. identity coverage (2026-10-03)

Characterization only, at HEAD `1ec18b9e`. No production code, identity
policy, import or persisted state changed. No COLD #12 or WARM was run. The
only new data access is a read-only DuckDB scan of the public Overture
release (`country_probe.py`).

Question: are Alfa Crux and SuperUco `EXACT_NAME / UNKNOWN →
INSUFFICIENT_EVIDENCE` because the required identity coverage is broader
than the geography the Experience is authorized for?

**Verdict: `UNKNOWN_IS_JUSTIFIED`.** The required coverage is the
destination country. That requirement comes from the canonical contract
(§P2-18), and the current code propagates it correctly. The Overture index
holds a 1°×1° operational AOI, which is a material coverage gap against that
scope. The public release, scanned country-wide, holds exactly one
exact-name record for each of the two venues. So the gap is in our **data**,
not in the contract. A country-complete snapshot would yield
`SINGLE → VERIFIED` under the unchanged policy, which the integration test
already pins. That fix does not complete the Uco composition (see Q7).

## 1. The geographic authority, traced

Inputs come from the real replay
`../locality-recovery-2026-10-03/replay-gemini-8/contextual-replay.json`
(the SolSalute deep-source window, COLD #11 ROUTE_LIKE grant, real
resolver, real Overture index, 0 writes).

| # | Transition | Production owner | Decision for Alfa Crux / SuperUco |
| --- | --- | --- | --- |
| 1 | Work unit → authorization | `GeographicValidationAuthorization` on the work unit | `ROUTE_LIKE`. No user-named anchor, so `workUnitScope` is undefined. |
| 2 | Requested destination | destination resolution → `GeographicScope.AREA_BOUNDARY` | Ciudad de Mendoza polygon (S-d). Both venues lie outside it. |
| 3 | Source-defined Experience | extraction + `evaluateSourceCompositionSupport` | One SolSalute record supports 4 hints: `Valle de Uco` (role `area`), plus three `venue`s. The heading "Uco Valley Winery Itinerary" is a candidate **name**, not a typed fact. |
| 4 | AREA component | phase-1 scope hints, `resolveHint` | `Valle de Uco` is **unresolved**. Local Nominatim (`countrycodes=ar`, re-queried for this report) holds only two `highway=residential` ways with that name, one in Rivadavia (Mendoza) and one in Rawson (San Juan). No AREA polygon exists. |
| 5 | Experience scope | `deriveExperienceGeographicScope` (`experience-geographic-scope.policy.ts`) | No S-a, no S-b/S-c. The result is the destination scope with `mayExtendBeyondDestination = ROUTE_LIKE && !workUnitScope = true`. |
| 6 | Component admission scope | `componentAcquisitionScope` → `ComponentAcquisitionScope.admitsCountryBoundedBeyondDestination = true` (resolver `:1739-1746`). `admitComponentLocation`, policy `:416` | A location outside the destination is admitted when the query is country-bounded. **Admission scope = AR.** |
| 7 | Component-specific locality | `groundIdentityContext` → `ComponentIdentityContext` | Alfa Crux has none. SuperUco's only report, "NEAR Alfa Crux", was rejected (`LOCATION_QUALIFIED`). Only `sourceLink` reached the context, as provenance. |
| 8 | Operational provider extents | per strategy | LOCAL_OSM_POOL is the destination pool. NOMINATIM is country-bounded with a window of 40. PLACES is a Geoapify circle over the destination (`DESTINATION_AREA`, r = 12,964 m). OVERTURE_IDENTITY is the `PUBLISHED` session for `AR`. |
| 9 | Pool coverage | `destinationPoolCoverage` (resolver `:2389`), Nominatim `windowReached` (`:2731`), Overture `lookup.coverage` (`:1476`) | Local and Places pools are `PARTIAL` because admission extends beyond the destination. Nominatim is `COMPLETE` with 0 results. Overture is `PARTIAL`: the session `rw4-uco-aoi-20261003` is `PARTIAL_PARTITION / OPERATIONAL_AOI` with bbox `[-69.5,-34,-68.5,-33]`. |
| 10 | Name multiplicity | `OverturePlacesIndexService.lookupExactPlace` `:217-222` | 1 row in a non-country snapshot gives `UNKNOWN`. |
| 11 | Competitors | `examineCompetitors` (`competitor-examination.policy.ts:89`) | No pool is both `COMPLETE` and holding the candidate, so the outcome is `NO_COMPETITOR_OBSERVED`. |
| 12 | Decision | `IdentityVerifier` rules 4–8 | No contradiction, no discriminating fact, no known competitor, no convergence, and `EXACT_NAME` is not `SINGLE`. NEARBY `(false,false)` is NOT_CORROBORATED. Rule 8 then gives `EXACT_NAME UNKNOWN → INSUFFICIENT_EVIDENCE`. |

The heading label never becomes a component locality or a scope:

- The `area` hint failed to resolve.
- Even if it had resolved, §P2-18 makes a source-named `CANDIDATE_AREA`
  **DESCRIPTIVE**: `admitComponentLocation` admits points inside it, then
  judges every other point like any scope. The admission scope would still
  be AR.
- `destinationPoolCoverage` would still return `PARTIAL`, because
  `admitsCountryBoundedBeyondDestination` stays true.

## 2. The coverage requirement

1. **Territory to examine.** The admission scope, which here is the
   destination country (AR). A competitor is material anywhere it could be
   admitted (`admitsCompetitor` delegates to `admitComponentLocation`).
2. **Where it is defined.** Spec
   `2026-10-02-geographic-validation-authorization-review.md` §P2-18
   ("Identity acquisition without an enclosing AREA" and "Residual risk").
   Its code owners are `mayExtendBeyondDestination`,
   `admitComponentLocation`, `destinationPoolCoverage`, `poolMultiplicity`
   and `examineCompetitors`. The vocabulary is in
   `../contextual-identity-2026-10-03/ambiguity-policy-characterization.md`
   ("Complete pool").
3. **Is it justified.** Yes. A ROUTE_LIKE Experience with no strict anchor
   may place a component anywhere in the country, so a homonym anywhere in
   the country is a candidate for what the source meant. No existing
   contract provides a narrower authority for this candidate. There is no
   user anchor (S-a), no resolved AREA/ROUTE (S-b/S-c), and S-b would be
   DESCRIPTIVE anyway. There is also no component locality.
4. **Does the current snapshot cover it.** No. The AOI is about 1°×1°
   around the venues. It is typed `PARTIAL_PARTITION`, and its extent
   exists only in the untyped `manifest` (`RW4-ID-OVERTURE-COVERAGE-1`).
5. **Can existing typed metadata establish completeness.** Only
   `completeness = COMPLETE_COUNTRY` (gated by
   `expectedSourceCoverage = COUNTRY_ENUMERATED`). This snapshot carries
   neither.
6. **Known material competitors.** In the index: none. In the public
   release scanned country-wide: none (§3).

Situation classification:

| Situation | Alfa Crux | SuperUco |
| --- | --- | --- |
| A. One candidate, complete relevant coverage | not in the index. **Yes in the external release** (§3). | same |
| B. One candidate, incomplete relevant coverage | **current state** | **current state** |
| C. Multiple materially compatible candidates | no | no |
| D. One candidate + source-grounded distinguishing fact | no. The source states no locality, address or QID. The link is the group homepage, not facility identity. | no. A same-host `superuco.com` link is provenance, not an existing evidence type (`../overture/assessment.md` §4). |

## 3. Country-wide evidence (new)

`country_probe.py` performs a read-only scan of release `2026-09-23.1`
places:

- AR bbox pruning, `addresses[].country = 'AR'`.
- `names.primary` normalized like `normalizeGeoName`, the same field the
  index matches.

Output is in `country-multiplicity.json` (28 s).

| Name | In AR | Country undeclared | Record |
| --- | ---: | ---: | --- |
| Alfa Crux | **1** | 0 | `79eb9ee4…` winery, Villa San Carlos (meta) |
| SuperUco | **1** | 0 | `753ed444…` restaurant, El Manzano Histórico (meta) |
| Ojo de Agua | **1** | 0 | `c4b741f2-8098-4a02-abb9-4e41c88a6d3c` **cabin, San Martín de los Andes (Neuquén)**. This is not the source's Luján de Cuyo restaurant. |
| Bodega Azul | 0 | 0 | none |
| Bodega La Azul | 3 | 0 | winery (Godoy Cruz), grocery store (Tunuyán), winery (Tupungato) |

Sanity control (`sanity-control.json`, records truncated to 3): `YPF`
returns 1,495 records in AR and `Plaza San Martin` returns 143, so the scan
does cover the country. The AOI records are the same features the index
returns.

Caveat: the scan sees only what Overture holds. "Exactly one in AR" is
complete enumeration **of that dataset**, the same kind of claim an
untruncated Nominatim response makes for OSM (El Zanjón). It is not proof
that no unindexed homonym exists in the world (§P2-18 residual risk).

## 4. The scope-mismatch hypothesis

Rejected. No narrower geographic authority is being lost on the way:

- **Requested destination.** Ciudad de Mendoza. Both venues are outside
  it, which is permitted only through §P2-18's country bound.
- **Source-defined Experience geography.** `SOURCE_DEFINED_COMPONENTS` has
  no geometry and no search window by design. Its geography is its
  verified components, which are what is being verified. Using them to
  bound their own identity search would be circular.
- **AREA component.** Unresolved: OSM has no such area. If it resolved, it
  would be DESCRIPTIVE and would not bound admission.
- **Component locality.** None was asserted.

Narrowing the scope would require one of two things:

- Treating the itinerary heading as a strict constraint, which §P2-18
  forbids: STRICT is never decided by "an AREA hint's presence … a title".
- Redefining the Experience as destination-local, which is false: the
  venues are 87–105 km from the destination centroid.

**`GEOGRAPHIC_AUTHORITY_DEFECT` is not confirmed.**

## 5. Candidate corrections, evaluated (none implemented)

| Option | Effect on Alfa Crux / SuperUco | Assessment |
| --- | --- | --- |
| Fix propagated geographic authority | none | No propagation defect was found (§1, §4). |
| Expose the AOI extent as a typed coverage capability (`RW4-ID-OVERTURE-COVERAGE-1`) | **none**. The AOI does not contain the admission scope (AR). | Still useful for a scope the AOI does contain: a strict anchor, a destination-bounded Experience, or a grounded locality (situation D). It is not the fix here. |
| Correct the completeness calculation | none | The calculation is right: the snapshot really is partial. |
| **Publish a verifiably country-enumerated AR snapshot** | `EXACT_NAME/SINGLE → VERIFIED` for both, with policy unchanged (integration test "a complete-country snapshot establishes uniqueness"). | This is the smallest generic correction. It is a **data/operational** change, not a policy change. It needs the prerequisites below. |
| Leave `UNKNOWN` | — | Correct for the current index. |

Prerequisites for the country snapshot (open findings, not new policy):

- **Overture storage finding (3).** `COMPLETE_COUNTRY` is a declared
  string. `beginImport` checks only `expectedSourceCoverage`. Completeness
  needs a verifiable enumeration with these parts:
  - the page keys are every release partition intersecting the country;
  - the country rule is explicit;
  - rows with no declared country are handled deliberately. The production
    importer must not silently drop them.
- **No repo importer exists** (2026-10-03 verifier characterization).
  Building one is new tooling and needs authorization.
- **Lookup scope.** The lookup matches `names.primary` only. A homonym
  declared only in `names.common`/`names.rules` would be missed by
  multiplicity. That share is 1% of rows (rules) in the Mendoza domain
  profile. Record it as a known completeness limit of the name field, or
  include those names.

## 6. Regression analysis

| Case | Effect of a country-complete AR snapshot (policy unchanged) |
| --- | --- |
| **Ojo de Agua** | **Risk found.** Overture's only AR exact match is a Neuquén cabin, so Overture alone would report `SINGLE` for the **wrong** homonym. Protection today: OVERTURE_IDENTITY runs after NOMINATIM, and Nominatim's untruncated country pool (31 results in the 2026-10-03 replay) is in `competition.pools`. The cabin's namespace differs, so `examineCompetitors` counts all admissible exact-name members but one as competitors, giving `MATERIAL_COMPETITOR_KNOWN` whenever ≥2 remain. Rule 4 (AMBIGUOUS) then precedes rule 6 (`SINGLE`). If Nominatim **fails** and no other pool exposes a homonym, rule 6 would VERIFY the cabin. A stated locality, if the extractor emitted one, would REJECT it as `LOCALITY` `OUTSIDE`. |
| RW1 El Zanjón, Farmacia la Estrella | No change expected. Both are decided at NOMINATIM or PLACES, before OVERTURE_IDENTITY runs (strategy order, resolver `:1318-1462`). Not re-run live. |
| RW3 acceptance | No policy change, so the verifier is identical. A snapshot affects only hints that reach OVERTURE_IDENTITY. RW3 WARM reuses the catalog and makes no acquisition. **Not re-run.** |
| Experiences beyond the destination | This is the only class that needs country coverage. They gain `SINGLE` only where the dataset holds exactly one in-country exact-name record. |
| Multiple exact-name establishments in a region | `MULTIPLE → AMBIGUOUS`. Bodega La Azul has 3 records (integration test "same brand, different physical facility"). |
| Partial or truncated queries | Unchanged: `PARTIAL` never establishes `SINGLE` (`poolMultiplicity`). It can still expose competitors. |
| Records from different providers for one installation | Unchanged. Namespaces never merge. A lone record of another namespace is neither a competitor nor proof (`examineCompetitors` "comparable" rule). |

## 7. Answers

1. **Cause.** The only pool holding each venue is the Overture AOI snapshot
   (`PARTIAL_PARTITION`), so `EXACT_NAME` is `UNKNOWN` and
   `COMPETITOR_EXAMINATION` is `NO_COMPETITOR_OBSERVED`. Nominatim's
   complete country pool is empty, and no discriminating source fact
   exists. Rule 8 therefore returns `INSUFFICIENT_EVIDENCE`.
2. **Is the admission scope unnecessarily broad?** No. It is the country,
   per §P2-18, and no narrower existing authority applies.
3. **Does our index cover it?** No. It holds an operational AOI. The public
   release does cover it.
4. **Is there a proven false negative caused by the coverage contract?**
   No. The negative comes from the indexed data, not the contract. Under
   the contract, the release would yield `SINGLE`.
5. **Smallest generic correction.** No policy change. Publish a verifiable
   country-enumerated snapshot, gated on storage finding (3), an
   authorized importer, and the Ojo de Agua tests below.
6. **Tests that prove Ojo de Agua stays protected.** Each is a resolver
   test with a real Overture index:
   - (a) A country-complete snapshot with one exact-name record outside
     the source's locality, plus an untruncated Nominatim pool with ≥2
     homonyms, gives `AMBIGUOUS` with no writes.
   - (b) The same with Nominatim **failed**. This pins the current
     behavior (`VERIFIED` on the lone dataset member), so the risk gets an
     explicit decision before the snapshot ships.
   - (c) The same with a grounded locality the Overture record lies
     outside gives `REJECTED` (LOCALITY contradiction).
   - (d) A country-complete snapshot with two exact-name records gives
     `AMBIGUOUS`.
   - (e) RW1 El Zanjón and Farmacia la Estrella still verify at their
     original strategy with a populated AR snapshot present.
7. **Before RW4 COLD/WARM.**
   - The Uco composition still needs **Bodega Azul**: the release has 0
     records under the source name, and `Bodega La Azul` is `MULTIPLE`.
     So COLD #12 remains NOT READY even if Alfa Crux and SuperUco verify.
   - The Luján composition still needs A16 and the Ojo de Agua locality
     assertion (`RW4-EXTRACT-CANDIDATE-1`, extractor re-run).
   - A beyond-destination Experience is not retrieved WARM from a
     destination-only request (PD1).
   - Independent review of the ambiguity policy is still requested.

## Conclusion

```text
UNKNOWN_IS_JUSTIFIED
```

The geographic authority is propagated correctly. The coverage contract
asks for the right territory. The current index cannot establish
completeness over it. The remedy is coverage data, gated by the
prerequisites and regression tests above. It is not authorized here.
