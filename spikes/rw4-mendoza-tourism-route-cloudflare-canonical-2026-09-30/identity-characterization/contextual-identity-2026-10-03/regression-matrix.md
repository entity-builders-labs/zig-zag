# RW4 contextual identity: protected regression matrix (2026-10-03)

Baseline: `15af1ccb`, the last head before this identity work. The
historical tests below were restored verbatim from that baseline and run
against the final policy. "Unchanged" means the test's fixture data and
expected verdict are byte-identical to the baseline.

| Scenario (test) | Historical verdict | New verdict | Original evidence unchanged? | Explanation |
| --- | --- | --- | --- | --- |
| RW1 El Zanjón de Granados, Case A (`experience-proposal-resolver.service.spec`) | VERIFIED via LOCAL_OSM_POOL + NOMINATIM convergence on osm:node:9953027884, then persisted | VERIFIED, persisted | YES (verbatim) | Shared-upstream convergence with no known name collision in either pool still confirms the record. |
| RW1 Farmacia la Estrella, Farmacia gate (`place-cutover.spec`) | VERIFIED via NOMINATIM + Geoapify Place Details on osm:node:3348573778; one GeoEntity with both identities | same | YES (verbatim) | Same rule; neither pool saw a collision. |
| Farmacia IDENTITY_CONFLICT at persistence | fails closed | same | YES (verbatim) | Unchanged. |
| Trusted-observation reuse plus Nominatim convergence (Farmacia) | VERIFIED | same | YES (verbatim) | Same rule. |
| Verified hint memory, COLD remember / ALREADY_REMEMBERED / FAILED write (`place-cutover.spec`) | remembered after VERIFIED | same | YES (verbatim) | They depend on the Farmacia convergence path, which is preserved. |
| Verified hint memory COLD→WARM round trip (`verified-hint-memory.integration-spec`) | COLD remembers, WARM reuses, 0 provider calls | same | YES (verbatim) | Same. |
| Verifier unit: convergence alone, and convergence over a rejecting NEARBY | VERIFIED | VERIFIED | YES (verbatim) | Absent provenance means no collision known. |
| RW1 San Telmo OWN/OBSERVATION_QID (`identity-verifier.service.spec`) | VERIFIED | VERIFIED | YES | Unchanged rule. |
| "prefers the OSM candidate's own wikidata tag over an observation QID" (resolver spec) | own QID looked up (verdict not asserted) | own QID still looked up; the verdict is now REJECTED because the two QIDs differ | YES (verbatim) | The QID-contradiction block was explicitly required by the task brief ("contradictory source-declared and candidate-declared Wikidata IDs block verification"). The test passes unchanged. |
| Ojo de Agua, Córdoba hamlet (pre-fix pool, real capture) | must not verify | AMBIGUOUS, no writes; with a stated Luján locality: REJECTED (LOCALITY + PHYSICAL_KIND) | YES (real pool) | Collision-aware rules; NEARBY never decides a collision. |
| Ojo de Agua, Luján restaurant (full real pool) | depends on source evidence | AMBIGUOUS (no locality assertion reached the verifier in the real replay); contextual VERIFIED only in tests that state the locality | YES (real pool) | Missing fact: the extractor's component-specific locality assertion. |
| Convergence inside a known collision (new negative) | n/a; the old rule would have VERIFIED | not VERIFIED | new fixture (constructed in-destination homonym plus the real pre-fix pool) | New safety test. It does not replace any historical case. |
| Bodega La Azul, winery versus store (Overture integration) | AMBIGUOUS | AMBIGUOUS | YES (records unchanged; API rename `candidate` → `candidates[0]`) | The whole pool now reaches selection. |
| Alfa Crux / SuperUco (Overture integration, AOI) | INSUFFICIENT_EVIDENCE | same | YES (records unchanged; API rename) | |
| A16 negative control | no candidate; "Bodega A16" AMBIGUOUS | same | YES (records unchanged; API rename) | |
| Nominatim query-argument assertions (4 in the resolver spec, 1 in `geographic-scope-cutover`) | `{bias}` / `{countryCode}` | plus `resultWindow: 'PROVIDER_MAXIMUM'` | arguments only; no verdict | The provider-maximum window was explicitly required ("Preserve [the Nominatim full-result-window fix]"). |
| RW3 accepted composite: catalog reuse (`catalog-reuse.integration-spec`) | COLD ok, WARM reuses | same; 1 of 6 runs failed `MAX_WALKING_PER_DAY_EXCEEDED` on COLD planning | YES | Pre-existing flake: the untouched baseline `15af1ccb` fails identically 1 of 10. It is a planner flake, not an identity decision (PF-CI-FLAKE-1). |
| All other RW1/RW2/RW3 unit, integration and e2e tests | as recorded | unchanged and passing | YES (files untouched) | Unit 186/2500, integration 25/113, e2e 41/41 on the final tree. |

## Scope of the evidence

- These are deterministic test invariants plus diagnostic live replays
  (`run-*`, `fixtures-replay-m3`) with a stub catalog.
- **No live RW1, RW2 or RW3 COLD/WARM run was executed.** This is not a
  canonical rerun of RW3.

## Policy defect resolved without trading

- The milestone-1 rule ("shared-upstream convergence never verifies")
  broke El Zanjón and Farmacia.
- The corrected generic rule is: convergence over a shared or
  undetermined upstream confirms the record only while neither converging
  acquisition saw a known name collision. It never disambiguates a
  collision.
- This keeps both RW1 resolutions, blocks the Ojo de Agua convergence class
  (a resolver-level negative test), and needs no name-, provider- or
  case-specific exception.

## Open findings (unchanged behavior, not regressions)

- A Places (Geoapify) pool restricted to the destination circle verifies on
  EXACT_NAME/SINGLE even when another provider saw homonyms elsewhere. This
  is provider-local uniqueness and pre-existing behavior; changing it would
  alter accepted Places cases, so it needs a separate review.
