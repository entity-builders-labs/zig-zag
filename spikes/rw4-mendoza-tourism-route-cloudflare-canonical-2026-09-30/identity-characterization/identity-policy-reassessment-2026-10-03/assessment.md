# RW4: evidence-driven identity policy reassessment (2026-10-03)

Starting HEAD: `f8735a09`. Finding ID: **RW4-ID-CORRESPONDENCE-1**.
Spec: amendment §19.2
(`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`).

No COLD #12, WARM, or canonical state change was run. The real-provider
replay used a stub catalog and a disposable DB, and persisted nothing
(`replay/db-after-probe.json`).

**Verdict.**

- **The country-complete uniqueness rule is replaced.** It was neither
  necessary nor sufficient. Uniqueness now decides only inside a grounded
  geography: a bounded admission scope, the component's grounded source
  locality, or a verified source-named composition AREA.
- **Partial snapshots can now cover a locality.** A partial Overture
  snapshot is a complete comparison for a grounded locality when its typed
  enumerated extent contains that locality.
- **Alfa Crux and SuperUco still do not verify.** No safe policy verifies
  them with the evidence that reaches the resolver. Their remaining
  blocker is grounding "Valle de Uco", which no configured provider can do.

## 1. Product invariants vs. implementation choices

Invariants held fixed:

- Never knowingly select an incompatible entity.
- Never ignore a known competitor.
- Never promote an unsupported assertion.
- Keep provenance.
- Keep source-faithful Experiences.
- Keep uncertainty explicit.
- Never duplicate a canonical entity.

Every rule below was treated as a hypothesis.

| Rule (pre-change) | Failure it prevents | Demonstrated by real evidence? | Prevents it? | Rejects legitimate candidates? | Narrower rule? | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Country-complete pool required for name-only uniqueness (§P2-18 + rules 5/6) | Picking a homonym elsewhere in the country | Yes, homonyms are real (31 "Ojo de Agua") | **No**: dataset-complete ≠ world-complete. Overture's only AR "Ojo de Agua" is the wrong place (Neuquén cabin) | Yes: Alfa Crux, SuperUco need a country import even when the source locates them | Count uniqueness only inside a source/request-grounded geography | **Replaced** (§19.2) |
| `EXACT_NAME / SINGLE` as the main criterion | Name-similar wrong places | Yes: "Bodega Azul" → Azul (BA) supermarket | Exactness yes; uniqueness alone no | — | Exactness kept; uniqueness grounded | Exactness **retained**, uniqueness **qualified** |
| A partial dataset never supplies sufficient evidence | Reading a lone partial member as unique | Yes: the AOI says nothing outside its bbox | Yes | Yes, inside the AOI: a locality fully inside the enumerated extent was never comparable | Coverage judged against the grounded locality, not the country | **Narrowed** (typed extent) |
| Material competitor = admissible exact-name record not excluded by a component fact | Ignoring a real homonym | Yes | Yes | Not observed | — | **Retained** |
| Admission and identity evidence are separate | Admission used as identity | Yes: the Azul supermarket is admissible (country) yet absurd for an Uco itinerary | — | — | Make the geography of uniqueness an explicit fact | **Made explicit** (`GEOGRAPHIC_CORRESPONDENCE`) |
| Composition context never corroborates a component | Title/heading inventing a locality | Yes, the heading risk is real | Yes | Yes: a resolved, verified source AREA could not ground anything | A verified source-named AREA grounds uniqueness only; never a contradiction or exclusion | **Narrowed** (`SOURCE_AREA`) |
| Completeness metadata decides verification | Untyped claims | `COMPLETE_COUNTRY` was a declared string; the AOI extent existed only in `manifest` | Partially | — | Typed extent, required for AOI imports | **Typed** |
| Rule precedence | Weak facts outranking strong ones | Defects A/B/C (earlier) | Yes | — | — | **Retained**; uniqueness rules gated |

## 2. Three concepts, separated

| Concept | Owner | Answer for a ROUTE_LIKE regional component |
| --- | --- | --- |
| Geographic admissibility | `admitComponentLocation` | Anywhere in AR (§P2-18). Unchanged. |
| Geographic correspondence | `geographicCorrespondence` (new typed fact) | Only a geography the source states (component locality, verified source AREA) or a bounded request scope. Never the candidate's own coordinates. |
| Identity ambiguity | `examineCompetitors` (unchanged) | Known admissible homonyms → AMBIGUOUS, whatever the correspondence. |

**The conflation found.** Policy A used admissibility (the country) as the
geography in which uniqueness becomes identity. Bodega Azul makes this
concrete: Nominatim's only candidate is a supermarket ~1,000 km from the
source's valley. It is admissible, and its complete pool shows
`NO_MATERIAL_COMPETITOR`. It was not verified only because the name was
not exact.

**Circularity.** The basis is computed from source and request facts
only. A sibling component's unverified position is never used.

## 3. Real evidence

| Fact | Source |
| --- | --- |
| 12 of 22 SolSalute venue names have no exact OSM record in AR; exact hits include houses ("A16" ×3), a village and rail stops ("Trapiche"), a road in Tierra del Fuego ("Mevi") | `nominatim-name-probe.json` (local Nominatim, country-bounded, limit 40) |
| Overture's only AR "Ojo de Agua": cabin, San Martín de los Andes | `../geographic-scope-coverage-2026-10-03/country-multiplicity.json` |
| Overture "Bodega La Azul" ×3: wineries in Godoy Cruz and Tupungato, a store in Tunuyán; Nominatim holds only the Tupungato winery | same + probe |
| The full article locates Alfa Crux ("in the Uco Valley"), SuperUco ("This Uco Valley winery") and La Azul ("in all of Mendoza") outside the extraction window | `spikes/rw4-tavily-extract-fidelity-2026-10-01/outputs/advanced-markdown.md` |
| "Uco Valley" / "Valle de Uco": `UNGROUNDED / NO_BOUNDARY`; "Lujan de Cuyo", "Mendoza", "Tupungato": grounded | `replay/policy-replay.json` → `groundingProbe` |
| The RW4 AOI imported every scanned record in its bbox (4328 = 4328) | session manifest; typed by migration (`replay/backfilled-extent.txt`) |

## 4. Policies compared

- **A (old).** Admission-scope completeness required for name-only
  uniqueness.
- **B.** Contextual correspondence with locality-bounded completeness for
  every pool type.
- **C.** A trusted provider record with bounded competitor examination: a
  lone record verifies when no competitor was observed.
- **D (selected).** Correspondence-bounded uniqueness: B, plus making the
  geography of every uniqueness claim explicit, plus `SOURCE_AREA`.

| Axis | A | B | C | D |
| --- | --- | --- | --- | --- |
| Evidence required | exact name + country-complete pool | locality + locality-complete pool | exact name + no observed competitor | exact name + grounded geography + complete pool over it + no known competitor |
| Alfa Crux / SuperUco (real) | INSUFFICIENT (AOI), VERIFIED after a country import | INSUFFICIENT (Uco ungroundable) | **VERIFIED** | INSUFFICIENT (Uco ungroundable). Verifies if the region grounds (scenario 1). |
| Ojo de Agua, no locality → Neuquén? | VERIFIED if Nominatim fails and the snapshot is country-wide (**false positive**) | not via locality; still has A's path | **VERIFIED** whenever Nominatim fails, even on today's partial index if the AOI held the cabin | INSUFFICIENT |
| Nominatim fails | Overture `SINGLE` decides alone | same as A | decides alone | needs a grounded geography |
| Overture omits a real homonym | undetected (dataset-relative) | undetected inside the locality | undetected anywhere | undetected inside the stated geography only |
| Providers disagree | known competitor → AMBIGUOUS; order-dependent if the first strategy decides | same | same | same (limitation recorded) |
| Same-brand branches / unconflated duplicates | AMBIGUOUS | AMBIGUOUS; a locality distinguishes | AMBIGUOUS if both seen | AMBIGUOUS; a locality distinguishes (scenarios 8, 9) |
| Beyond-destination components | only with a country import | with a grounded locality | yes | with a grounded locality or verified source AREA (scenario 10, J) |
| Cost / operations | country import per country | none new | none | one typed extent per AOI; no country import |

- **C is rejected** by the real Neuquén cabin and by the real
  dataset-miss rate: a lone record is frequently a homonym.
- **A is rejected** because it cannot distinguish Alfa Crux from the
  cabin.
- **B alone leaves A's false positive reachable.** D is B plus that
  closure.

## 5. Adversarial scenarios

Resolver-level tests are in
`experience-proposal-resolver.identity-selection.spec.ts`, "identity policy
reassessment scenarios". Each one asserts the decision evidence, not only
the verdict. The "before" column comes from running the same tests against
`f8735a09` production code.

| # | Scenario | Data | Before | After |
| --- | --- | --- | --- | --- |
| 1 | Exact name, explicit locality inside the enumerated AOI | real Alfa Crux row + real AOI extent; constructed locality | INSUFFICIENT (coverage `NOT_ESTABLISHED`) | **VERIFIED** (`COVERS_ASSERTED_LOCALITY`, `DISTINGUISHED`, `SOURCE_LOCALITY`) |
| 1b | Same, locality reaching beyond the AOI | constructed | INSUFFICIENT | INSUFFICIENT |
| 2 | One exact name, country-level compatibility only | real Alfa Crux, complete-country snapshot | **VERIFIED** | INSUFFICIENT (`ADMISSION_SCOPE_ONLY`) |
| 3 | Two genuine same-name establishments, both plausible | real La Azul wineries | AMBIGUOUS | AMBIGUOUS |
| 4 | Two homonyms, one inside the locality | synthetic museum | VERIFIED | VERIFIED |
| 5 | Incompatible lone record, complete provider | real Neuquén cabin, Luján locality | REJECTED | REJECTED |
| 6 | Misleading lone record, other provider fails | real cabin, Nominatim failed | **VERIFIED (false positive)** | INSUFFICIENT |
| 7 | Partial coverage, no known competitor | real Alfa Crux, real AOI | INSUFFICIENT | INSUFFICIENT |
| 8 | Two IDs 40 m apart (possible duplicate) | constructed duplicate | AMBIGUOUS | AMBIGUOUS |
| 9 | Same-brand branches | synthetic bookstore | AMBIGUOUS / VERIFIED with a locality | same |
| 10 | Real component beyond the destination | real Luján restaurant, 31-member pool | VERIFIED | VERIFIED |

Non-wine synthetic worlds:

- §P2-18 G, Fixtureland estates and Harborland lighthouses (both in
  `geographic-source-composition.spec.ts`):
  - **country-only:** VERIFIED → INSUFFICIENT;
  - **grounded locality:** VERIFIED both before and after;
  - **outside the locality:** REJECTED.
- Scenario 4 (synthetic museum) and scenario 9 (synthetic bookstore).

## 6. Tests changed and why

| Test | Old expectation | New | Reason |
| --- | --- | --- | --- |
| Verifier "Alfa Crux verifies only once complete-country uniqueness is established" | VERIFIED | INSUFFICIENT (country-only) / VERIFIED (`SOURCE_LOCALITY`) | Encoded Policy A |
| Integration "a complete-country snapshot establishes uniqueness" | VERIFIED | same split, plus the real cabin negative | Encoded Policy A |
| G "unique exact-name match from the COUNTRY-bounded query … verified" (×2 worlds) | resolved | acquired, INSUFFICIENT | Encoded Policy A; positive companion added |
| G homonym test | sibling verified on country uniqueness | sibling verified on a grounded locality | Same assertion (`INCOMPLETE_SOURCE_COMPOSITION`) kept |
| Selection "unique exact-name member in the right area" / "one provider is enough" | VERIFIED with no locality | VERIFIED with the source caption's locality; a no-locality twin is INSUFFICIENT | The title claimed geography the input did not carry |
| Regional catalog reuse J | country uniqueness | estates carry a grounded "Fixture Valley" locality | Reuse is the subject; the identity premise changed |
| Regional catalog reuse COLD | — | asserts `SOURCE_AREA` provenance | Verified via the resolved source AREA |
| 16 verifier units (RW1 shapes, A-series, Recoleta), place-cutover ×2, hint memory integration | VERIFIED | VERIFIED | Destination-bounded premise made explicit (`BOUNDED_ADMISSION_SCOPE`); verdicts unchanged |

## 7. Real-provider replay

Script: `replay/run.sh`. Live spec: `be/test/live/rw4-identity-policy-replay.live-spec.ts`.

Setup:

- **Input:** the real extractor hints of
  `../locality-recovery-2026-10-03/replay-gemini-7` (both itineraries; no
  LLM call).
- **Providers:** the real resolver, OSM grounder, local Nominatim,
  Overpass, Geoapify and Wikidata.
- **Overture:** the real AOI snapshot, with its extent typed by the
  migration backfill.

These are diagnostic replays, not RW4 COLD/WARM.

| Component | Observed candidate | Geography used | Competitors | Coverage | Decision | Persistable |
| --- | --- | --- | --- | --- | --- | --- |
| Alfa Crux | Overture `79eb9ee4…` (Villa San Carlos) | none (`ADMISSION_SCOPE_ONLY`) | `NO_COMPETITOR_OBSERVED` | AOI partial; Nominatim 0 | INSUFFICIENT | no |
| SuperUco | Overture `753ed444…` (El Manzano Histórico) | none | `NO_COMPETITOR_OBSERVED` | same | INSUFFICIENT | no |
| Bodega Azul | Nominatim "Supermercado del Vino 'La Bodega de Azul'", Azul (BA) | none | `NO_MATERIAL_COMPETITOR` | Nominatim complete | INSUFFICIENT (not exact) | no |
| A16 | none | — | — | — | unresolved | no |
| Ojo de Agua | Nominatim `osm:node:4797394430` (Luján restaurant) of 31 | `SOURCE_LOCALITY` (Departamento Luján de Cuyo, `osm:relation:2989830`) | `NO_MATERIAL_COMPETITOR` (the 30 homonyms are outside the locality) | `PROVIDER_WINDOW_NOT_REACHED` | **VERIFIED** (`DISTINGUISHED`) | yes (`upsertGeoEntity`, hint memory) |
| Valle de Uco / Luján de Cuyo (AREA hints) | none | — | — | — | unresolved | no |

The what-if pass adds the full-article captions to Alfa Crux and SuperUco.
It changes nothing: "Uco Valley" stays `UNGROUNDED / NO_BOUNDARY`.
Both compositions stay rejected:

- Uco: `DESTINATION_INCOMPATIBLE`, `UNCONFIRMED_MATCH`.
- Luján: `INCOMPLETE_SOURCE_COMPOSITION`.

## 8. Answers

1. **HEAD.** Starting `f8735a09`. The final HEAD is recorded in the commit
   that carries this dossier (see progress).
2. **Unnecessary rejections under A.** Real: an Overture-only venue inside
   an enumerated AOI with a grounded locality could never verify (scenario
   1). Alfa Crux and SuperUco are **not** false negatives of A alone: no
   grounded geography reaches the resolver for them.
3. **False-positive risks.** Real: the Neuquén cabin (scenario 6),
   verified by A whenever Nominatim fails and the snapshot is
   country-wide. Real dataset miss rate: 12/22 OSM. Real admissible absurd
   candidate: the Azul supermarket.
4. **Policies.** A, B, C and D (§4).
5. **Selected.** D (§19.2): A cannot distinguish Alfa Crux from the cabin,
   and C verifies the cabin. D needs no country import.
6. **Code.** See the commit. In short:
   - typed `GEOGRAPHIC_CORRESPONDENCE` evidence and its pure owner;
   - the verifier gate on rules 5, 6, 6b and NEARBY;
   - the resolver and the anchor resolver emit the fact;
   - typed Overture extent (schema, migration with backfill, `beginImport`
     validation, lookup);
   - `enumeratedSnapshotLocalityCoverage` for the Overture contextual pool.
7. **Tests.**
   - Added:
     - resolver scenarios 1–10 and 1b, plus a no-locality twin;
     - G positive and REJECTED tests in both synthetic worlds;
     - a verifier block for RW4-ID-CORRESPONDENCE-1;
     - policy tests for `geographicCorrespondence` and
       `enumeratedSnapshotLocalityCoverage`;
     - Overture service extent tests;
     - the integration cabin and extent tests.
   - Changed: §6.
   - Executed on the final tree: unit 2674/2674, integration 115/115,
     e2e 41/41; typecheck, lint and build green.
8. **Replay.** §7.
9. **Alfa Crux and SuperUco.** No.
10. **Ojo de Agua homonym protection.** Intact:
    - real 31-member pool with no locality: AMBIGUOUS (unchanged test);
    - with the locality, the cabin is REJECTED (scenario 5);
    - with no locality and Nominatim failed, the cabin is INSUFFICIENT
      (scenario 6, previously VERIFIED).
11. **Blockers to canonical RW4 COLD/WARM.**
    - Uco composition:
      - "Valle de Uco" is not groundable by OSM. A regional boundary
        source is needed: a new data capability, not policy.
      - Extraction never sees the article sections that locate Alfa Crux
        and SuperUco.
      - "Bodega Azul" has no exact record; "Bodega La Azul" is ambiguous
        in Overture.
    - Luján composition:
      - A16 has no candidate (RW4-EXTRACT-CANDIDATE-1).
      - The "Luján de Cuyo" AREA hint is unresolved (`NO_OSM_MATCH`),
        although the grounder grounds the same name as a locality.
        Uncharacterized.
    - Independent review of RW4-ID-COMPETITOR-1, RW4-ID-DEST-UNIQUENESS-1
      and now RW4-ID-CORRESPONDENCE-1 is still requested.
    - COLD #12 needs separate authorization.
