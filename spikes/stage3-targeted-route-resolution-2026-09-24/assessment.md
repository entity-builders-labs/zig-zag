# Targeted ROUTE resolution + AREA destination compatibility — spike assessment

**Verdict: ROUTE gate PASS, AREA destination-compatibility gate PASS.**
The next production integration is proposed at the end of this document.
Per the task, **nothing was integrated**: `ExperienceProposalResolverService`,
`IdentityVerifier`, and the live generation path are untouched. Stage 3
remains IN PROGRESS and Stage 4 remains BLOCKED.

Starting HEAD: `13e3500164ccc6a4ddbdff3a00a896e4e3dfb939` (the gate-FAILED
structured-resolution spike). Raw evidence: `matrix.json`. Tables:
`summary.md`.

## Why this spike exists

The previous spike (`../stage3-structured-geoentity-resolution-2026-09-24/`)
showed that ROUTE failures were **upstream of identity**:

```text
bare street name
→ Nominatim countrywide free-form search
→ soft viewbox
→ hard top-5 window
→ the Buenos Aires street never reaches the candidate set
```

This spike abandons Nominatim bare-name search as the ROUTE acquisition
strategy. It characterizes a targeted, destination-scoped OSM query and,
separately, fixes the AREA false positive ("San Martín" → Partido de General
San Martín) with administrative destination compatibility.

## What was built (isolated, unwired)

| Piece | Location | Role |
|---|---|---|
| `buildHighwaysByNameQuery` / `IOverpassApiService.queryHighwaysByName` | `osm/utils/overpass-query.util.ts`, `osm/services/overpass-api.service.ts` (+ cached wrapper) | `way["highway"]["name"="<exact>"](around:<r>,<destination point>); out geom;` — exact name, highway ways only, bounded radius (hard cap 50 km), geometry + node refs. No regex, no `map_to_area`, no "fetch all streets". |
| `buildContainingAdminBoundariesQuery` / `queryContainingAdminBoundaries` | same | `is_in(lat,lon)` → containing `boundary=administrative` relations, `out tags` only. |
| `OsmPlacesService.lookupHighwaysByName` | `osm/services/osm-places.service.ts` | Adapter-boundary normalization into typed `OsmRouteSegment` plus explicit rejections: `INVALID_IDENTITY`, `NOT_A_WAY`, `NOT_A_HIGHWAY`, `HIGHWAY_AREA_NOT_LINEAR` (`area=yes`), `MISSING_GEOMETRY`, `MISSING_NAME`. Provider failure → `status: failed`, never an empty success. |
| `OsmPlacesService.lookupContainingAdminUnits` | same | Typed `OsmAdminUnit` (id, name, admin level, ISO country code), coarse to fine. |
| `INominatimApiService.searchStructured` | `osm/interfaces/nominatim.interface.ts`, adapter + cached + fake | Explicit structured API (`street/city/county/state/country/postalcode`), **never mixed with `q=`**; rejects an empty query. `search()` is unchanged. Used only as a control. |
| `routeRetrievalQueryVariants` | `tours/utils/route-retrieval-name.util.ts` | At most 2 variants: RAW + one generic designator dropped (one leading Spanish, one trailing English, from a small closed taxonomy). Query generation only; documented as not identity policy. |
| `clusterRouteSegments` | `tours/utils/route-segment-clustering.util.ts` | `RouteCandidateCluster { canonicalName, segmentExternalIds[], representativeSegment, geometryFacts }`. Groups by **exact** name tag + **shared OSM node refs** (union-find, order-independent). Representative = longest segment (never proximity). An optional endpoint continuity gap exists **only as a what-if knob, off by default and outside the gate**. |
| `DestinationAdminCompatibilityService` | `tours/services/destination-admin-compatibility.service.ts` | COMPATIBLE iff the country matches and the **destination's own admin boundary** is in the candidate's containing-admin hierarchy, and the candidate is not the destination itself or an admin unit at/above its level. UNKNOWN (never COMPATIBLE) without a destination boundary, on lookup failure, or with an empty hierarchy. No distance anywhere. |
| `TargetedRouteResolverService` | `tours/services/targeted-route-resolver.service.ts` | variants → targeted lookup → dedupe by way id → clusters → per-cluster compatibility (a cluster is compatible when any segment probe lies inside the destination) → `RESOLVED` / `AMBIGUOUS` / `NOT_FOUND` / `INCOMPATIBLE` / `UNAVAILABLE`. |
| `StructuredGeoEntityResolverService.resolveArea` | existing isolated spike service | Now requires destination compatibility: RESOLVED only for exactly one COMPATIBLE candidate; any UNKNOWN → `AMBIGUOUS` (`DESTINATION_COMPATIBILITY_UNKNOWN`); all incompatible → `INCOMPATIBLE` with the rejected candidates. Its legacy Nominatim ROUTE path is unchanged and kept **only** as the "old" comparison control. |
| `destinationAcquisitionRadiusMeters` | `tours/utils/destination-acquisition-radius.util.ts` | Radius covering the resolved destination boundary (farthest bbox corner, capped at the shared 50 km scale); `undefined` for a point-scale destination. |
| Live harness | `be/test/live/targeted-route-resolution.live-spec.ts` | `RUN_SPIKE_PREFLIGHT=1`; resolves the destination through the real `DestinationResolutionService`, runs all three ROUTE strategies plus the AREA corpus, writes `matrix.json`. |

Geographic scope is the **destination**, not a neighborhood anchor. The
destination resolved to `osm:relation:1224652` "Buenos Aires" (admin_level 8,
coextensive with CABA `3082668`), and acquisition used an `around:` of
17 800 m around the selected destination point. San Telmo never scoped
acquisition. Defensa resolved to a 14-way CABA cluster that runs through San Telmo,
with no anchor involved.

## ROUTE: three strategies compared

| Strategy | Mandatory controls with the correct CABA street in the candidate set (6 hints) | Extended corpus (5 real CABA streets) | Negatives |
|---|---|---|---|
| **Old**: Nominatim free-form bare name + soft viewbox, top-5 | **0 / 6** | 0 / 5 | **1 false RESOLVED**: "Plaza Dorrego" as ROUTE resolved to La Matanza bus-stop *nodes* (`class=highway`, `type=bus_stop`), a POI-as-ROUTE false positive in the old structural filter |
| **Control**: Nominatim structured (`street=<variant>`, `city=<destination name>`), top-5 | **2 / 6** (Defensa Street, Defensa; both via "Defensa") | 3 / 5 (Chile, Avenida de Mayo, Giuffra) | 0 false RESOLVED (control only, no status) |
| **Targeted Overpass** (exact name, `around:` destination, admin compatibility) | **6 / 6** | 4 / 5 | 0 false RESOLVED; POI names → NOT_FOUND |

Why the structured control is not the answer: `city=Buenos Aires` also
matches the **province** of Buenos Aires, so the top-5 window is still
spent on Lomas de Zamora, Avellaneda, Ezeiza, and similar homonyms.
Caminito, Florida, and San Lorenzo were never reached. It is still a
top-N ranking window. Its one real advantage is recorded honestly: it
tolerates name-token differences ("Giuffra" → "Doctor José M. Giuffra") that
an exact Overpass tag match cannot.

### Mandatory controls (gate J)

| Control | Targeted result | Gate |
|---|---|---|
| Defensa / Defensa Street | **RESOLVED** to one 14-way cluster (secondary/residential/living_street, 2 282 m), compatible via its first probed segment. The 8 other "Defensa" clusters inside the 17.8 km acquisition radius (Lomas de Zamora ×4, La Matanza ×1, Avellaneda ×3) are INCOMPATIBLE by admin hierarchy (Provincia de Buenos Aires), not by distance. | **PASS** |
| Pasaje San Lorenzo / San Lorenzo Passage | Raw "Pasaje San Lorenzo" returns 0 (OSM names it "San Lorenzo"). The generic designator drop "San Lorenzo" acquires 60 ways → 17 clusters → **2 destination-compatible**: the real San Telmo cluster (3 ways, `22697007`…) and a separate 40 m `highway=footway` "San Lorenzo" in Flores (Villa 1-11-14). Result: **AMBIGUOUS**, correct cluster present, no arbitrary winner. | **PASS** (present, honest AMBIGUOUS) |
| Caminito / Caminito Street | **RESOLVED** to `way/144844726` (La Boca, `highway=pedestrian`, `tourism=attraction`); the Lomas de Zamora homonym is INCOMPATIBLE. | **PASS** |
| 0 wrong-city RESOLVED | 0 across all 14 ROUTE rows (`wrongResolved=false` everywhere). | **PASS** |
| 0 POI-as-ROUTE | Plaza Dorrego and El Zanjón → NOT_FOUND (no highway way has those names). The adapter also rejects nodes, relations, non-highway ways, and `area=yes` highway surfaces; Chile had 2 real `HIGHWAY_AREA_NOT_LINEAR` rejections live. | **PASS** |
| 0 arbitrary winner between two real clusters | San Lorenzo (2), Balcarce (5), Chile (2) → AMBIGUOUS; never resolved by proximity. | **PASS** |

The English/source glosses needed only the generic designator drop
("Street", "Passage"). No place-specific translation, alias, or similarity
was used.

## AREA destination compatibility (gate K/L)

| Case | Result | Gate |
|---|---|---|
| Positive: San Telmo, Recoleta, Monserrat, Belgrano (CABA barrios) | RESOLVED; each candidate's `is_in` hierarchy contains destination `1224652` | **PASS** |
| **San Martín** → `relation/9168783` (Ciudad del Libertador General San Martín, Partido de General San Martín, Provincia de Buenos Aires) | **INCOMPATIBLE** (`OUTSIDE_DESTINATION_ADMIN_UNIT`). This was the confident false RESOLVED in the previous spike. | **PASS** |
| Same country, incompatible hierarchy: La Plata, Villa General Belgrano (Lanús) | INCOMPATIBLE | **PASS** |
| Homonym in another province: Fisherton (Rosario, Santa Fe); Cerro de las Rosas (Córdoba **and** Catamarca) | INCOMPATIBLE (both Cerro de las Rosas candidates) | **PASS** |
| Rosario | NOT_FOUND (Nominatim's biased top-5 had no area-eligible object) | acceptable (not a confident wrong RESOLVED) |

Belgrano is the positive-with-homonyms case, and the homonyms never
competed: Nominatim's destination bias only returned the CABA barrio as
area-eligible. The "other province homonym" negatives were therefore
exercised explicitly with Fisherton and Cerro de las Rosas, which do reach
the compatibility check.

Compatibility is decided by the **destination**, not the anchor. The check
asks whether the destination's own OSM admin unit contains the candidate. A
Plaza de Mayo component of a San Telmo walk is compatible because it is in
the destination; whether it is in San Telmo is Stage 4 geographic
validation.

## False positives / false negatives

**False positives (targeted strategy): 0.**

**False negatives / non-resolutions, all fail-closed:**

1. **Pasaje San Lorenzo: AMBIGUOUS**, not RESOLVED. This is genuine per the
   task's rule: a second real, disconnected, destination-compatible "San
   Lorenzo" exists (a footway in Flores). Resolving it would need evidence
   beyond name + geography, such as the source's own San Telmo context
   entering as geographic-validation evidence in Stage 4. Distance must not
   be used.
2. **Balcarce: AMBIGUOUS (5 clusters)** and **Chile Street: AMBIGUOUS
   (2 clusters)**. One real street each, but OSM splits them into fragments
   that do not share a node (oneway pieces, interrupted blocks). Pure
   topology over-splits. The 60 m endpoint-gap what-if does not fix it
   either (Balcarce still 2, Chile still 2). The gaps are measured between
   endpoints, and some fragments are further apart or connect mid-way.
   This is the main open grouping problem, and it is not solved here.
3. **Pasaje Giuffra: NOT_FOUND.** The OSM name tag is "Doctor José M.
   Giuffra". An exact-name targeted query cannot reach it, and adding fuzzy
   matching would violate the invariants. The Nominatim structured control
   did find it.

## Debt deliberately not hidden

- **Cluster identity is not canonical yet.** A resolved ROUTE is a
  `RouteCandidateCluster` of N OSM ways. Persisting it as one `GeoEntity`
  (which external id? all segment ids as `GeoEntityIdentity` rows? a
  synthesized cluster key?) is undecided. Without a decision, catalog reuse
  and dedupe of the same street acquired from a different segment set will
  diverge.
- **Segment grouping over-splits** real streets (Balcarce, Chile). Topology
  is safe (it never merges two different streets) but incomplete. Candidate
  structural facts for later: OSM `type=street`/`associatedStreet`
  relations, shared nodes through a same-name junction way, or a
  continuity rule validated on a larger corpus. Not a threshold picked from
  these examples.
- **Exact-name retrieval misses name-form variants** (Giuffra). Only the
  generic designator drop is allowed. Anything broader needs its own design,
  still with no aliases or fuzzy authority.
- **Compatibility cost.** A cluster is probed segment by segment until a
  compatible one is found, so every segment of an incompatible cluster
  costs one `is_in` call: 23 lookups for Defensa, 53 for Avenida de Mayo,
  58 for San Lorenzo. This is fine on the local instance and too many for a
  shared public Overpass. Options: one batched `is_in` query, or point
  containment against the destination polygon the destination resolver
  already hydrated. Choosing the second needs a single-authority decision
  (see the next item).
- **Policy ownership.** `DestinationAdminCompatibilityService` is a new
  identity-side policy ("is this candidate within the destination's admin
  unit?"). Catalog admission already has a polygon-containment
  `outside_destination_boundary` rule for POIs. Before integration, decide
  whether these are one canonical destination-scope policy or two distinct
  questions, and document it. Do not ship two helpers that answer the same
  question differently.
- **ROUTE compatibility uses per-segment probe points** (a real vertex of
  each way), not LineString/intersection semantics. That is enough for
  admin compatibility. Component geography in Stage 4 must still use real
  line semantics, per the 2026-09-22 amendment.
- **Destination scale edge.** The destination resolved to the admin_level 8
  "Buenos Aires" relation, which coincides with CABA. For destinations whose
  resolved boundary is smaller than the product meaning (for example a
  partido inside a metro area), admin compatibility will be correspondingly
  strict. This is the documented city-and-surroundings deferral, not new
  behavior.
- **Legacy ROUTE path.** `StructuredGeoEntityResolverService.resolveRoute`
  (Nominatim bare-name) stays only as the comparison control. It must be
  deleted at integration, since it contains a live POI-as-ROUTE false
  positive (bus-stop nodes).
- **Cementerio de la Recoleta / `landuse=*` ground features** (PLACE) remain
  out of scope, as instructed.

## Validation performed

- TDD: new specs were written before the implementation and watched RED for
  the missing module/method, then GREEN. Specs: Overpass builders, Nominatim
  `searchStructured`, `OsmPlacesService` route/admin normalization,
  retrieval variants, clustering, compatibility (including a RED-first
  reason-ordering fix found live), targeted resolver, and structured-resolver
  AREA compatibility. Exception: `destination-acquisition-radius.util`'s spec
  and implementation were written in the same step, so its RED was not
  observed.
- `yarn typecheck`: clean except the pre-existing, already-documented
  `test/integration/tour-generation/support/fakes.ts(188)` TS7018.
- `yarn lint:check`: clean.
- `yarn test`: 1875/1876. The one failure is the pre-existing
  `preference-first-architecture.spec.ts` "no point-radius OSM identity". It
  statically reads `experience-proposal-resolver.service.ts`, which is
  unchanged versus the starting HEAD.
- Live: `RUN_SPIKE_PREFLIGHT=1 npx jest --config ./test/jest-live.json
  --runInBand --testPathPattern=targeted-route-resolution` against the
  local Overpass/Nominatim and the real `DestinationResolutionService`,
  24/24 harness rows. The harness only asserts a valid status; the gate
  evaluation is this document.

## Proposed next production integration (NOT performed)

Only after review of this evidence:

1. **Decide canonical ROUTE identity** for a multi-way cluster: persistence
   shape, `GeoEntityIdentity` rows, and how catalog-first lookup matches a
   later acquisition that returns a different segment subset of the same
   street.
2. **Decide single ownership of destination scope**: admin-hierarchy
   compatibility versus polygon containment. Then batch or replace the
   per-segment `is_in` probes.
3. Integrate `TargetedRouteResolverService` into
   `ExperienceProposalResolverService` **behind catalog reuse**, as the ROUTE
   acquisition strategy. RESOLVED enters candidate correlation →
   `IdentityVerifier` as a typed structural-resolution fact; it is not a
   bypass. AMBIGUOUS/INCOMPATIBLE/UNAVAILABLE stay explicit trace outcomes.
   Then **delete** the ROUTE `OWN_QID → requireAllTokens:false` workaround
   and the Nominatim bare-name ROUTE path, with no dual pipeline.
4. Apply `DestinationAdminCompatibility` to production AREA resolution
   (`resolveViaNominatim` AREA path) with the same UNKNOWN-is-not-COMPATIBLE
   rule.
5. Then run the small San Telmo E2E control and the Buenos Aires walks
   COLD/WARM spike. The Balcarce/Chile over-split and Giuffra exact-name
   misses should be measured there as expected AMBIGUOUS/NOT_FOUND rates,
   not patched in advance.
