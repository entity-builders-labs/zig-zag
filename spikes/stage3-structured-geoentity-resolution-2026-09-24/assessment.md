# Structured GeoEntity Resolution — isolated spike assessment

**Verdict: gate FAILS. STOP before Phase B (no production integration in
this task).** This document explains exactly why, with real evidence.

## What was built (Phase A only, not wired into production)

- `be/src/modules/tours/services/structured-geoentity-resolver.service.ts`:
  isolated `StructuredGeoEntityResolverService.resolve({name, expectedKind,
  destinationName, destinationCountryCode, destinationPoint})`, contract per
  the task prompt. PLACE via `IPlacesApiService.searchText` (destination-
  biased, reusing `PLACES_FALLBACK_BIAS_RADIUS_METERS`, now exported —
  no new bias mechanism). AREA and ROUTE via `INominatimApiService.search`
  (destination-biased, reusing the existing `bdd99c5` soft `viewbox`,
  `countryCode` — no new bias mechanism). ROUTE **does** query Nominatim
  (unlike today's `resolveViaNominatim`, which early-returns
  `not_applicable` for `hint.expectedKind === 'ROUTE'`) — this was the
  explicit point of the exercise.
- Structural filters used, all provider-native, no fuzzy string scoring for
  the terminal decision:
  - AREA: `isAreaScaleEligible` (existing, reused).
  - ROUTE (new): `class === 'highway'`, then grouped by
    (normalized street-name segment, real Nominatim address locality) so
    multiple OSM ways of the same real street collapse into one identity
    instead of being reported as internally ambiguous.
  - PLACE: excludes Geoapify's `accommodation.*` category (a fix was
    needed first — see below), then a hard 50km geographic cutoff.
- **Incidental fix required to make PLACE category filtering possible at
  all**: `GeoapifyPlacesApiService.mapAutocompleteResultToPlaceData` was
  silently discarding the real `category` field every raw Autocomplete
  response already carries (live-confirmed against the real API), always
  returning `types: []`/`primaryType: undefined`. Fixed to populate both
  from the real `category` (e.g. `"entertainment.museum"`). TDD'd
  (`geoapify-places-api.service.spec.ts`), typecheck/lint/full suite clean
  (see Validation below). This is a provider-adapter boundary fix — no new
  provider, no new bias mechanism, no identity-policy change.
- Isolated live harness: `be/test/live/structured-geoentity-resolution.live-spec.ts`,
  gated by `RUN_SPIKE_PREFLIGHT=1`, real Nominatim (local), real Geoapify,
  writes the full matrix to `matrix.json` in this directory. Does not touch
  `ExperienceProposalResolverService` or any production call path.

## Corpus run (19 resolutions: 14 from the task's fixed corpus + 5 real-name
addendum)

Full per-hint raw provider responses and candidate lists: `matrix.json`.
Human-readable table: `summary.md`. The addendum re-runs several Group
A/B/D hints under their real OSM/product name (e.g. "Defensa" instead of
"Defensa Street") to separate "the architecture cannot resolve this" from
"the English gloss doesn't match what OSM actually calls it" — a
name-quality question this task explicitly puts out of scope (no
per-place translation lists), so it must not be allowed to silently hide
what actually breaks.

## Gate evaluation (section 11 of the task)

| Requirement | Result | Verdict |
|---|---|---|
| Defensa Street → correct RESOLVED | English gloss: NOT_FOUND. Real name "Defensa": AMBIGUOUS across 5 segments, **none in San Telmo/CABA** (San Miguel, La Matanza x2, Morón, Moreno) | **FAIL** |
| El Zanjón → correct RESOLVED | RESOLVED, single clean Geoapify match, real category `entertainment.museum`, provider-native id embeds the same `osm:node:9953027884` this codebase has referenced since the original characterization | **PASS** |
| Dorrego Square → RESOLVED or honest AMBIGUOUS | English gloss: NOT_FOUND. Real name "Plaza Dorrego": AMBIGUOUS across 5 candidates, **and the correct one (leisure.park, San Telmo) is present in that set** | **PASS** (on the real name) |
| San Lorenzo Passage → RESOLVED or honest AMBIGUOUS | English gloss: NOT_FOUND. Real name "Pasaje San Lorenzo": AMBIGUOUS across 5 segments, **none in Buenos Aires at all** (Chaco x2, Santa Fe x2) | **FAIL** (technically returns the literal status `AMBIGUOUS`, but the correct entity never appears in the candidate set — this is a coverage miss wearing an AMBIGUOUS label, not an honest ambiguity a human could resolve from the reported candidates) |
| Galería Güemes → resolver path does not depend on `map_to_area` | AMBIGUOUS between 2 real places (the correct downtown one + the Ramos Mejía homonym, same one `d1637b9` found), reached **entirely through Geoapify Places**, zero Overpass/`map_to_area` calls | **PASS** |
| Negative controls → 0 false RESOLVED | "San Martín" (AREA): RESOLVED to `Ciudad del Libertador General San Martín` (Partido de General San Martín) — a real, structurally valid administrative boundary, but **~30km from the requested Buenos Aires destination and not what a "San Martín" component of a Buenos Aires walk means**. Nominatim's raw top-2 results contained only one `way`/`relation` at all (a bare `node` was correctly excluded by `isAreaScaleEligible`), so there was no ambiguity signal available to catch this — a single wrong-but-structurally-eligible candidate reads as confident RESOLVED | **FAIL** (1 false RESOLVED) |

**3 of 6 gate rows fail**, including one of the two hard "must be exactly
RESOLVED" requirements and the negative-control requirement. Per the task's
explicit instruction: *"Si este gate falla: STOP. No agregues excepciones
para hacer verde el spike."* This assessment stops here — Phases B/C/D
(production integration, small E2E, mega-spike) were **not started**.

## Root cause of the ROUTE failures (Defensa, Pasaje San Lorenzo, and the
Caminito-as-ROUTE addendum — all three, same mechanism)

Confirmed live and reproducible, not a one-off:

- All three real Argentine street/passage names have **many** same-named
  OSM highway segments nationwide, essentially tied on Nominatim's own
  `importance` score (all four "Defensa" results shared the identical
  `0.0533433333333333`).
- `NominatimApiService`'s existing `bdd99c5` bias is a genuinely *soft*
  `viewbox` (no `bounded=1`, by design, to never hard-exclude a real match)
  layered on top of a hard `RESULT_LIMIT = 5`. For a name with only a
  handful of national homonyms (e.g. "José de San Martín", the Nominatim-
  bias spike's own positive case), 5 slots and a soft nudge are enough to
  surface the right one. For a name with dozens of tied-importance
  homonyms nationwide (ordinary street names in a country with ~24
  provinces reusing the same historical figures/toponyms constantly), the
  soft bias does not reliably pull the destination's own segment into the
  top 5 at all — three separate real hints demonstrated this identically.
- This is **not** the same defect the Nominatim-bias spike (`bdd99c5`)
  already fixed. That fix targeted a name with few enough homonyms that the
  bias reliably wins; this is a name-frequency ceiling the same mechanism
  does not clear. It also is not a `map_to_area` issue (ROUTE resolution
  here never touches Overpass at all) and not a Places-provider issue
  (Nominatim only).
- A separate manual `curl` test earlier in this task's investigation
  *appeared* to succeed by appending `"Buenos Aires, Argentina"` directly
  into the free-text query string (`q=Defensa, Buenos Aires, Argentina`),
  not just passing `viewbox`/`countrycodes` as separate parameters — that
  is a **different, unimplemented mechanism** (query-text enrichment, which
  changes Nominatim's own internal text-relevance ranking, not just its
  proximity ranking) from what `resolveViaNominatim`/`NominatimApiService`
  actually send today. Conflating the two would have been a false positive;
  this assessment deliberately re-tested using only the real, already-
  landed bias mechanism.
- Per the task's explicit constraints, this assessment does **not** propose
  or implement query-text enrichment, a larger result limit, or any other
  new bias mechanism — that would be scope creep past what this task
  authorized ("no implementes otro mecanismo paralelo de bias"). It is
  recorded here as a precise, reproducible finding for whoever picks up
  ROUTE resolution next.

## Root cause of the AREA negative-control failure ("San Martín")

Not a bug in the new grouping/filter code (verified: the second raw result
was correctly excluded by the existing `isAreaScaleEligible`'s `osmType ===
'node'` rule, which is right — a bare point can never carry boundary
geometry). The real cause: Nominatim's own top-5 window for a bare, very
common given name returned only **one** structurally area-eligible object
at all, and that one object happens to be a real but distant administrative
entity. With only one candidate, there is no internal disagreement to
surface as AMBIGUOUS — the architecture has no way to know the single
survivor is "the wrong one" without either (a) a stronger destination
constraint than a soft bias, or (b) some form of distance-based rejection.
Rejecting on distance alone would reintroduce exactly the "distance/
proximity as identity" pattern this task explicitly forbids in section 11
("no usa distance/proximity sola como identidad") — so no such fix was
attempted here.

## What worked well (do not lose this evidence)

- **PLACE resolution via Geoapify's real category + a hard geographic
  cutoff is generally sound.** El Zanjón and Estadio Alberto J. Armando
  both resolved cleanly with zero fuzzy string matching, using only a
  provider-native category and a real geographic filter. Plaza Dorrego and
  Plaza San Martín correctly stayed AMBIGUOUS rather than guessing among
  several real, structurally identical candidates.
- **Galería Güemes decisively proves the Group C requirement**: identity
  resolution for this class of hint no longer needs to touch
  `map_to_area`/the local Overpass pool at all. The Geoapify-only path
  found both the correct object and the known Ramos Mejía homonym and
  reported the correct AMBIGUOUS verdict without a single Overpass call.
- **The multi-segment ROUTE grouping logic itself is validated** on the
  synthetic/unit level (`structured-geoentity-resolver.service.spec.ts`):
  when the right segments ARE in the provider's result window, grouping by
  (name, real address locality) correctly treats them as one identity
  instead of manufacturing false internal ambiguity. The live failures
  above are entirely upstream of this logic, in what Nominatim's bare-name
  search even returns.
- A genuine, separate structural gap was found (not fixed, per STOP
  discipline): "Cementerio de la Recoleta" is tagged `landuse=cemetery` in
  OSM, which satisfies neither the current AREA nor PLACE structural
  filters (`isAreaScaleEligible` requires `class` `boundary`/`place`;
  Geoapify's `type=amenity` autocomplete parameter does not surface
  cemetery-ground features either). Large "ground" features (cemeteries,
  and plausibly stadium grounds, university campuses, large parks tagged
  as `landuse=*`) are a real, undocumented blind spot for both existing
  structural predicates. Recorded here, not patched.

## Validation performed

- TDD: `structured-geoentity-resolver.service.spec.ts` (10 tests, all
  written before the implementation and watched RED then GREEN),
  `geoapify-places-api.service.spec.ts` (2 new/updated tests for the
  category-mapping fix).
- `yarn typecheck`: clean except the same pre-existing, already-documented
  `test/integration/tour-generation/support/fakes.ts` failure (unrelated,
  present before this task, reconfirmed via git stash on this branch
  earlier this session).
- `yarn lint:check`: clean.
- `yarn test`: 1813/1814 passing (the same one pre-existing failure).
- Live: `RUN_SPIKE_PREFLIGHT=1 yarn test:live:discovery --testPathPattern=structured-geoentity-resolution`,
  real local Nominatim (`zigzag-nominatim-argentina`) and real Geoapify API
  — 19/19 harness assertions passed (the harness only asserts a valid
  status was returned; the substantive gate evaluation is this document).

## Explicit conclusion

The structured provider-native approach is **not a uniform improvement**
over the current name/Wikidata-based pipeline. It clearly outperforms it
for PLACE resolution with a moderately specific real name (El Zanjón,
Estadio Alberto J. Armando: clean wins with zero fuzzy matching or
Wikidata) and decisively proves ROUTE/AREA identity resolution for common
hints can be made independent of `map_to_area` local-pool completeness
(Galería Güemes). But it does **not** reliably resolve ROUTE hints for
common Argentine street names using only the already-landed soft-bias
mechanism, and it introduced one confirmed false-positive-risk case for a
bare common given name used as an AREA hint. Both failure classes are
upstream of the identity-decision logic itself (in what Nominatim's
bare-name search window returns), not defects in the new grouping/filter
code, which held up correctly whenever given a fair result set.

**Per the task's explicit instruction, this is a STOP, not a partial
integration.** No `ExperienceProposalResolverService` change, no
`IdentityVerifier` `STRUCTURED_PROVIDER_RESOLUTION` evidence type, no
retirement of the ROUTE `OWN_QID -> requireAllTokens:false` workaround, no
small San Telmo E2E control, and no Buenos-Aires-walks mega-spike were
performed in this task. The `StructuredGeoEntityResolverService` and its
live harness remain committed as isolated, unwired characterization code
for whoever next attacks ROUTE resolution — the failure modes above are
precisely the problem that work needs to solve before this path can be
integrated.
