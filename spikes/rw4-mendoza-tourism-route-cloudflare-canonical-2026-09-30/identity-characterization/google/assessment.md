# Google identity characterization — legal, cost and portability gates (2026-10-02)

Characterization only. No production change, no COLD/WARM, no persisted
diagnostic data, **zero live Google requests**. Fixtures (Alfa Crux,
SuperUco, Bodega Azul / La Azul, A16) are specimens of generic problem
classes, not product cases.

Files: `terms-gate.json` (clauses, URLs, field-by-field retention),
`cost-gate.json` (field masks, SKUs, budget, calls), `comparison.json`
(cross-provider matrix from existing evidence).

## 1. Evidence provenance

| Level | Example | Authority |
| --- | --- | --- |
| 1. Original tourism source | SolSalute names "Alfa Crux" and links to a page | grounded recommendation, not identity |
| 2. Source-linked page | `agostinowinegroup.com/alfa-crux-wines` declares "Calle Los Indios s/n, M5567 Valle de Uco" | entity-adjacent declaration; may be a group/chain/aggregator page |
| 3. Independent identity provider | OSM / Nominatim / Geoapify / Wikidata / Google | identity candidates |

The Alfa Crux address exists only at level 2. The level-1 extraction had no
address to put into `GeoEntityHint.addressHint`; the field exists and is
used by OSM `addressConfirmed`, but nothing populates it from level 2.

## 2. Google terms gate — FAILED for canonical identity

Verified clauses (`terms-gate.json`, non-EEA Service Specific Terms):

- **Place ID**: may be stored indefinitely (SST A.3; refresh if >12 months).
- **Names, addresses**: ToS 3.2.3(a)(iii) forbids copying/saving business
  names and addresses; no Places caching permission exists for them.
- **Coordinates**: max 30 consecutive days (SST 14.3); and ToS 3.2.3(c)(iv)
  forbids using Places latitude/longitude **as input for point-in-polygon
  analysis**.
- **websiteUri, phone, businessStatus, types**: no caching permission.
- **Non-Google maps**: Places content must not be used with a non-Google map
  (ToS 3.2.3(e), SST 14.2).

Against Zig-Zag's model:

- `persistVerifiedCandidate` copies the candidate's name and coordinates
  into `GeoEntity` permanently → incompatible.
- Destination compatibility is polygon containment on candidate
  coordinates → the identity pipeline itself performs the prohibited
  analysis.
- Native app: `react-native-maps` without a `provider` prop renders Apple
  Maps on iOS → non-Google map. Web uses Google Maps.
- `GeoEntityIdentity(google, placeId)` alone is compatible.

**Verdict: Google is NOT legally compatible with Zig-Zag's canonical
catalog** (verified text). Unresolved interpretations: Place ID as a pure
cross-reference to an independently sourced entity when the link decision
used Google content; whether a non-persisted diagnostic comparison counts as
point-in-polygon analysis; EEA terms (billing region not established).

**Pre-existing finding (outside this task):** the deployed backend sets
`PLACES_PROVIDER: "google"` (`terraform/templates/backend-user-data.sh.tftpl`),
so production already persists Google names/coordinates and runs polygon
checks on Places coordinates. Needs a product/legal decision.

## 3. Cost gate

- `searchText` mask requests rating, userRatingCount, priceLevel,
  regularOpeningHours, websiteUri → **Text Search Enterprise** SKU.
- Place Details requests nationalPhoneNumber, websiteUri → **Place Details
  Enterprise**; the resolver never calls it for Google
  (`declaresSourceIdentitiesInDetails = false`).
- An identity-only mask (id, displayName, formattedAddress, location, types,
  businessStatus) would be **Text Search Pro**; `websiteUri` alone forces
  Enterprise.
- Quota state not inspectable from this session. Budget ceilings were
  12/8/0; **calls made: 0**. Reason: the legal gate failed first, the real
  resolver path would itself run point-in-polygon on Places coordinates, and
  results could not be retained; a coverage-only lookup would not change the
  recommendation.

## 4. Per fixture (existing evidence; Google NOT_PROBED)

| Fixture | Generic class | Acquisition | Verification |
| --- | --- | --- | --- |
| Alfa Crux | provider coverage gap; identity facts only on a source-linked (group-host) page | NO_CANDIDATE in OSM, Nominatim, Geoapify, Wikidata | not reached |
| SuperUco | sparse public footprint; inaccessible official page | NO_CANDIDATE everywhere; page 403 | not reached |
| Bodega Azul | non-exact display name across source and provider | Geoapify candidate "Bodega La Azul" (only under ROUTE_LIKE) | REJECTED: only `WIKIDATA_IDENTITY_MATCH(NEARBY,false,false)`; no EXACT_NAME/ALIAS/ADDRESS/CONVERGENCE; provider exposes no website |
| A16 | short non-distinctive name | wrong object acquired ("FC Belgrano") | correctly REJECTED — fail-closed preserved |

## 5. Capability assessment

| Capability | Technically useful | Legal for canonical persistence | Economical | Architecture fit | Global |
| --- | --- | --- | --- | --- | --- |
| A. Google as explicit acquisition strategy | unknown (not probed) | **NO** | Enterprise SKU as configured | would be an explicit strategy, never a fallback | yes technically, blocked legally |
| B. Source-linked official page enrichment | partial: 2 of 4 pages declare an address; 1 blocked; 1 is a group host | depends on page terms; facts are entity-declared | bounded fetches | needs link capture as a typed fact + new evidence type | yes, with safeguards |
| C. Official-domain corroboration | not today: neither side carries a domain for these fixtures | yes (own facts) | cheap | new evidence type | yes, with safeguards |
| D. Fuzzy name | discovery only | — | — | never identity authority | — |

None of B, C, D gives Alfa Crux or SuperUco a **candidate**: they corroborate
or locate, but the canonical sources contain no entity to verify. B could
geocode a declared street, but a street point is not an entity identity; a
source-declared entity without any provider identity would be a new identity
authority (architecture decision), not a bounded fix.

## 6. Portability negative controls (in-memory, outside Mendoza/wine)

Any future mechanism must keep these fail-closed:

| Scenario | Trap | Required outcome |
| --- | --- | --- |
| Chain café, one domain for 200 branches (e.g. `cafe-chain.example`) | domain equality | domain multiplicity MULTIPLE → AMBIGUOUS, never VERIFIED |
| City museum linked to a municipal portal (`city.gov.example/museums/…`) | portal host hosts many entities | path-scoped page ≠ entity; no domain identity |
| Restaurant linked to a booking aggregator / social profile | aggregator host | excluded host class |
| Short hint "Room 39" (bar) near an address "Calle 39" | short-name collision | no EXACT_NAME SINGLE → not VERIFIED (A16 class) |
| Source link that is a Google Maps share URL | Google content as identity | never an identity fact (Google terms) |

## 7. Decision

Branch: **unresolved coverage**. No production implementation is justified
by the evidence:

- Google: legally incompatible as a canonical identity source.
- Official-page enrichment / domain corroboration: cannot create candidates
  that no licensable source contains.

**ONE next task:** a bounded, read-only coverage characterization of an
**openly licensed global POI dataset** — Overture Maps Places
(CDLA-Permissive-2.0; Foursquare OS Places under Apache-2.0; AllThePlaces
CC0; commercial storage and redistribution permitted, attribution required,
per https://docs.overturemaps.org/attribution/) — for the same four fixtures
plus the negative controls above, offline (no per-request cost), recording
names, categories, websites and source IDs. If it covers the coverage-gap
class, the implementation that follows is a generic, explicit identity
acquisition strategy over a licensed POI dataset (own invocation decision,
trace, persistence rights, no fallback chain); official-domain corroboration
becomes viable only where such a source declares websites.

Genericity: the recommended path contains no names, categories, locations,
domains or provider IDs of the fixtures; it applies unchanged to restaurants,
museums, galleries, shops, trails and wineries in any country.
