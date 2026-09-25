# Stage 3 — PLACE provider search characterization (2026-09-25)

Question: are PLACE misses caused by providers not knowing real places, or by
how Zig-Zag calls them (endpoint, type filter, geo filter/bias, language,
result window)?

- Branch `feat/preference-first-selection`, starting HEAD `d00b4ae` (verified
  against `fork/feat/preference-first-selection` before any change).
- Harness: `be/test/live/place-provider-search-characterization.live-spec.ts`
  (`RUN_SPIKE_PREFLIGHT=1`, real providers, mocks disabled, nothing persisted).
- Evidence: `matrix.json` (290 rows, normalized, with Zig-Zag's selector result
  as a separate column), `summary.md` (pivot tables, per-variant aggregates,
  cost/latency), `raw/<hint>/*.json` (raw provider responses, keys redacted).
- **No production behavior changed.** The only `src/` change exports
  `selectBestPlaceCandidate` so the harness can run the real selector on each
  provider list.

## 0. Provider availability

| Provider | Credential | Status during spike |
|---|---|---|
| Geoapify (autocomplete, geocode/search, place-details) | `GEOAPIFY_API_KEY` present | **AVAILABLE** — 570 live requests, 0 failures |
| Google Places `places:searchText` | `GOOGLE_MAPS_API_KEY` present | **PARTIALLY UNAVAILABLE** — the project's `searchText` *daily* quota was exhausted after 21 successful calls (HTTP 429, `quota_exhausted`, blocked until 2026-09-26T07:00Z). Only the three Mafalda query forms were measured; every other Google cell is `UNAV`, never mocked. |
| SerpApi `google_maps` | `SERPAPI_API_KEY` present | **AVAILABLE but budget-bound** — Free Plan, 11 searches left this month at start. Capped at 8 calls (Mafalda ×5, Farmacia, Recoleta Cemetery, San Martín); **3 left**. Responses are cached under `raw/` and reused on re-run. |

The Google gap is real and limits the Google verdict (see §7). The harness
reuses every successful Google raw response and re-attempts only the missing
cells, so re-running it after the quota reset fills the Google matrix without
re-spending (~87 calls are still missing, which may exceed the daily cap again).

## 1. Geographic baseline

Resolved once via `DestinationResolutionService.resolveDestination("Buenos
Aires, Argentina", {-34.6037, -58.3816})`: Nominatim relation `1224652`
(Buenos Aires, Comuna 1, CABA), `countryCode=AR`. Boundary resolution degraded
to `scale=point` (`provider_failed`, the local Overpass endpoint was
unreachable from the host), which is harmless here: the PLACE fallback
(`resolveViaPlaces`) only ever receives the selected point, and the spike uses
exactly that point and `PLACES_FALLBACK_BIAS_RADIUS_METERS` (50 km) for every
provider. San Telmo is never used as a hard scope.

Note: a 50 km circle around the BA center covers most of Greater Buenos Aires
(Ramos Mejía, San Martín, Pilar-adjacent partidos), which matters for §6.

## 2. Official documentation — what the parameters actually mean

### Geoapify Autocomplete (`/v1/geocode/autocomplete`) — current production PLACE text path

- `text`: "an address or part of the address to search". Autocomplete matches
  the typed text against feature names/addresses; it is not a free-form
  relevance search.
- `type`: one of `country, state, city, postcode, street, amenity, locality`.
  It **filters the result universe to that location type**, it is not a hint.
  `amenity` = the POI class. The docs do not enumerate which OSM features are
  in that class. Measured here: `type=amenity` **excludes** OSM
  `landuse=cemetery` (Cementerio de la Recoleta, way 183842128) and a
  `building` way with no POI tag (Galería General Güemes, way 240463124).
  `tourism=attraction` + `artwork_type=sculpture` (the Mafalda node) **is**
  inside the amenity class. So `type=amenity` is not neutral.
- `filter`: hard restriction (circle/rect/countrycode/place, AND semantics).
- `bias`: ranking preference only (OR semantics); it does not restrict.
- `lang`: result language (ISO 639-1). `limit`: maximum results.
- Response: `rank.confidence` (0..1), `rank.match_type`
  (`full_match`, `inner_part`, `match_by_*`), `result_type`
  (`amenity, building, street, …`), `category`, `datasource`.

### Geoapify Forward Geocoding (`/v1/geocode/search`)

- Two **mutually exclusive** input modes: free-form `text`, or structured
  `name/housenumber/street/postcode/city/state/country` ("do not combine
  them"). The spike never combines them.
- Same `type`, `filter`, `bias`, `lang`, `limit` semantics as Autocomplete.
- The Geocoding API docs do not document OSM ids in `datasource`. Measured:
  `format=json` **and** `format=geojson` responses carry only
  `datasource.{sourcename, attribution, license, url}` — **no
  `datasource.raw`**, so no explicit `osm_type/osm_id`.

### Geoapify Place Details (`/v2/place-details?id=<place_id>`)

Measured, not assumed: returns `properties.datasource.raw` with explicit
`osm_type` (`n/w/r`), `osm_id`, and the raw OSM tags (including `wikidata` /
`wikipedia` when mapped). This is the only Geoapify surface that exposes an
explicit OSM cross-identity. The opaque `place_id` was never parsed.

### Google Places Text Search (`POST /v1/places:searchText`)

- `locationBias`: "results around the specified location can be returned,
  **including results outside the specified area**".
- `locationRestriction`: hard restriction, documented "for categorical queries
  only".
- `includedType` biases to one Table-A type; `strictTypeFiltering=true` makes
  it a filter.
- `languageCode`: "the language in which to return results … defaults to
  `en`". Measured: it also changes **which** places match (§3.5).
- `regionCode`: CLDR region used to format the response.
- **`maxResultCount` is deprecated in favor of `pageSize`** ("If both are
  specified, `pageSize` will be used"). `pageSize` 1..20, default 20.
  Production still sends `maxResultCount`.
- Field-mask billing tiers: `id` = Essentials IDs-only; `displayName,
  formattedAddress, location, types, primaryType, primaryTypeDisplayName` =
  **Pro**; `rating, userRatingCount, priceLevel, regularOpeningHours,
  websiteUri` = **Enterprise**. Production `getFieldMask()` requests all five
  Enterprise fields on every Text Search, so every production PLACE lookup is
  billed at Enterprise. The spike overrides the mask to the six Pro identity
  fields (`id, displayName, formattedAddress, location, types, primaryType`).

### SerpApi Google Maps (`engine=google_maps`)

- `type=search` returns `local_results[]`; `ll=@lat,lng,zoom` is applied only
  to `type=search` and is map-viewport context (bias), not a boundary.
- `hl` language, `gl` country; `nearby` forces proximity (meant for "near me"
  queries; not used). Results expose `title, place_id, data_id, data_cid,
  gps_coordinates, type/types, address, rating, position`.
- Measured: when Google Maps decides a query has **one** answer, SerpApi
  returns a single `place_results` object instead of a `local_results` list,
  which hides every alternative (see San Martín, §6).

## 3. MAFALDA matrix (principal control)

Ground truth: the "Mafalda, Susanita y Manolito" bench/sculpture at Defensa &
Chile. OSM `node/2472979623` (`tourism=attraction`, `artwork_type=sculpture`,
`amenity=bench`, `wikidata=Q111038841`); Google place
`ChIJeRQn1k01o5UR5o5Yb5aJJ5Y` ("Estatua de Mafalda", `primaryType=sculpture`,
-34.615832, -58.3716461). Geoapify coordinates -34.6159617, -58.3716913.

Cell = rank of the correct object in the provider's list; `✗` = not returned;
`(sel✗)` = returned, but `selectBestPlaceCandidate` would pick another row.

| Provider / config | "Mafalda Statue" | "Mafalda" | "Estatua de Mafalda" |
|---|---|---|---|
| **GA A1 — production** (`type=amenity`, filter+bias, limit 3) | ✗ (0 results) | #1 (sel✗ → shop "Mafalda", 19 km) | ✗ (0 results) |
| GA A2 — no type | ✗ (0 results) | ✗ (7 results: bus stops, streets) | **#1** |
| GA A3 — filter only | ✗ | ✗ | #5 (sel✗) |
| GA A4 — bias only | ✗ (a "Mafalda" artwork 5,093 km away) | ✗ (11,300 km) | #1 |
| GA A5 — lang es / en | ✗ / ✗ | ✗ / ✗ | #1 / #1 |
| **GS G1 — `text`, no type, filter+bias** | **#1** | ✗ (Plaza Mafalda, Villa Mafalda) | ✗ (Anne Frank / Fangio statues) |
| GS G2 — `text` + `type=amenity` | #1 | #1 (sel✗) | ✗ |
| GS G3 — structured `name`+city+country | #5 (sel✗) | #1 (sel✗) | ✗ |
| GS G4 — structured + filter/bias | #2 (sel✗) | #1 (sel✗) | ✗ |
| GS G5 — structured `name` + filter/bias | #1 | #1 (sel✗) | ✗ |
| **GP P1 — production shape** (`maxResultCount=3`, 50 km bias) | ✗ — **only** "Estatua de Mafalda" in **Oviedo, Spain** (10,172 km) | #1 | #1 |
| GP P1w (`maxResultCount=10`) / P6 (`pageSize=10`) | ✗ / ✗ (identical) | #1 / #1 (identical) | #1 / #1 |
| GP P2 — "<q>, Buenos Aires, Argentina", no bias | **#1** | ✗ (a street named Mafalda) | #1 |
| GP P3 — `languageCode=es regionCode=AR` | **#1** (Oviedo still #3) | #1 | #1 |
| GP P4 — `languageCode=en regionCode=AR` | ✗ (Oviedo only) | #1 | UNAV |
| GP P5 — `includedType=sculpture` strict | ✗ (Oviedo is also a sculpture) | #1 (only result) | UNAV |
| SA S1 — `ll`, hl=en gl=ar | **#1** | #2 (Plaza Mafalda #1) | — |
| SA S3 — `ll`, hl=es gl=ar | #1 | — | #1 |
| SA S2 — "Mafalda Statue Buenos Aires", no `ll` | #1 | — | — |

### Mandatory questions

1. **Geoapify Autocomplete with `type=amenity`?** Not for the production hint
   "Mafalda Statue" (0 results) nor for "Estatua de Mafalda" (0). Yes for the
   bare name "Mafalda" (#1) — but Zig-Zag's selector then picks a
   different exact-name "Mafalda" (a shop 19 km away) over it.
2. **Without `type=amenity`?** "Mafalda Statue": no (0 results with the
   filter). "Mafalda": no (the no-type window fills with bus stops/streets).
   "Estatua de Mafalda": yes, #1.
3. **Forward Geocoding `text=`?** Yes — "Mafalda Statue" is #1 (G1, with or
   without `type`, `lang` es/en). Caveat: that correct `full_match` result
   carries `rank.confidence = 0`, so any confidence gate would discard it.
4. **Structured `name=`?** Yes for "Mafalda Statue" (#1 in G5, #2 in G4, #5
   in G3 without geo params) and for "Mafalda" (#1); no for "Estatua de
   Mafalda".
5. **Google Places "Mafalda Statue"?** Not with the production shape: the
   50 km `locationBias` does not prevent the *only* result from being the
   Oviedo, Spain statue. Yes with `languageCode=es`+`regionCode=AR` (#1) or
   with the city in the text (#1). `languageCode=en` (the API default) fails.
6. **Google Places "Mafalda"?** Yes, #1 in every shape except "Mafalda,
   Buenos Aires, Argentina" (which returns a street named Mafalda).
7. **SerpApi Maps "Mafalda Statue"?** Yes, #1 (with `ll` en/es, and with the
   city in `q` without `ll`).
8. **SerpApi Maps "Mafalda"?** Yes, #2 (Plaza Mafalda #1).
9. **Only with a Spanish query?** Geoapify Autocomplete finds it *only* with
   the Spanish form "Estatua de Mafalda" (no type) or the bare name (with
   type) — never with the English gloss. Google Places finds the English gloss
   only when `languageCode=es` is set (or the city is in the text). Geoapify
   Forward Geocoding and SerpApi find the English gloss as-is.
10. **Canonical/provider IDs:** Geoapify `place_id` `5197da9c…` (opaque) →
    Place Details gives explicit `osm n/2472979623` + `wikidata Q111038841`.
    Google Places and SerpApi return the **same** Google place id
    `ChIJeRQn1k01o5UR5o5Yb5aJJ5Y`; SerpApi adds `data_id
    0x95a3354dd6271479:0x962789966f588ee6` and `cid 10819767908987080422`.
    No provider returned a cross-reference to the other's identity space
    (Google ↔ OSM) — correlation still has to happen downstream.
11. **Minimal generic configuration:** Geoapify Forward Geocoding, free-form
    `text`, no `type`, circle `filter` + proximity `bias` (G1) is the only
    Geoapify configuration that finds the production hint form, with no
    per-place wording changes. For Google, the smallest generic change is the
    destination-derived locale (`languageCode`/`regionCode` from the resolved
    destination country), not an alias.

## 4. FARMACIA matrix

Every Geoapify configuration (all 14 autocomplete/search variants, both
languages) returned the real object at **#1**, and the selector picks it in
13/14 (A4 bias-only is the exception, not a production shape). This confirms
the premise: **Farmacia la Estrella is not an acquisition miss; the earlier
failure was downstream correlation.**

| Provider | Canonical name | Provider ID | Coordinates | Category / type | Datasource | Explicit OSM cross-identity |
|---|---|---|---|---|---|---|
| Geoapify (A1 production, G1) | Farmacia de la Estrella | `51fa545f…6f64652f33333438353733373738` (opaque) | -34.6102605, -58.3721513 | `commercial.health_and_beauty.pharmacy;healthcare.pharmacy`, `result_type=amenity`, `confidence 0.9`, `full_match` | `openstreetmap` | **Not in the search response.** Place Details: `osm_type=n`, `osm_id=3348573778` (`amenity=pharmacy`, `healthcare=pharmacy`, no wikidata) |
| Geoapify (G3 structured) | same | **different** id `51fa545f…45737472656c6c61` (a prefix of the text-mode id) | same | same | `openstreetmap` | — |
| Google Places | UNAV (daily quota) | — | — | — | — | — |
| SerpApi Maps (S1, hl=es) | Farmacia De La Estrella | `ChIJkxt8rtTKvJURbYdelktFp-A`, `data_id 0x95bccad4ae7c1b93:0xe0a7454b965e876d`, `cid 16187983576554178413` | -34.6101871, -58.3721455 | Farmacia | Google Maps | none |

So Geoapify **does** deliver an explicit `osm_type/osm_id` — but only via Place
Details (one extra request), never in the Geocoding/Autocomplete response.
And the Geoapify `place_id` is **not stable across modes**: the same OSM node
got two different ids from free-form vs structured search. Only the explicit
OSM id is a stable key.

## 5. Other corpus hints (production hint forms)

| Hint | GA A1 (production) | GS G1 (text, no type) | Root cause of the production miss |
|---|---|---|---|
| Casa Mínima | #1 | #1 | — |
| Mercado de San Telmo | #1 | #1 | — |
| Plaza Dorrego | #1 | #1 | — |
| El Zanjón de Granados | #1 | #1 | — |
| Basílica de San Francisco | #1 | #1 | — |
| Parque Lezama | #1 | #1 | — |
| Galería Güemes | ✗ (Mirador sub-feature + "Galería Güemes 51", Ramos Mejía) | ✗ (only the Ramos Mejía gallery, 17 km) | `OVER_RESTRICTIVE_TYPE_FILTER` (autocomplete); free-form mode also misses it — structured G3/G4/G5 find "Galería General Güemes" |
| Cementerio de la Recoleta | ✗ (0 results) | #1 | `OVER_RESTRICTIVE_TYPE_FILTER` (`landuse=cemetery` is outside `amenity`) |
| Recoleta Cemetery (EN) | ✗ (0 results) | #1 | `OVER_RESTRICTIVE_TYPE_FILTER` |
| Plaza San Martín | #1 | #1 | — |
| Mafalda Statue | ✗ | #1 | `WRONG_ENDPOINT` (autocomplete cannot match the gloss) |

Totals over the 12 PLACE hints (production wording): **A1 8/12, G1 11/12**
returned the correct object; the selector picks it in all 11 G1 hits. Across
all 15 truth rows (incl. Mafalda variants and the ROUTE control), A1 9/15
(8 selector-correct) vs G1 12/15 (12 selector-correct) — see `summary.md`.

Defensa Street (ROUTE control): no Autocomplete variant returns it; G1/G5
return the street "Defensa" (`result_type=street`) at #1. This is exactly why a
PLACE resolver must not accept a no-type geocoder's street result as a PLACE:
without `type`, streets are in the universe, and ROUTE resolution must stay
with the ROUTE resolver.

## 6. Negative controls — precision

- **Galería Güemes (same name, wrong locality inside the 50 km circle):**
  free-form G1 returns *only* "Galería Güemes" in Ramos Mejía (17.3 km), and
  the selector would accept it — a false positive. Structured G3/G4/G5 return
  the real "Galería General Güemes" at #1/#2, but the selector's exact-name
  rule still prefers the Ramos Mejía row (`ZIGZAG_SELECTION_BUG`). Neither
  endpoint change fixes this; it needs identity/locality verification.
- **Recoleta Cemetery:** `type=amenity` (G2) surfaces only businesses named
  after the barrio (Cantina Recoleta, Voyage Recoleta Hostel, Recoleta Urban
  Mall) and drops the cemetery. Structured G5 has the cemetery at #4 behind
  them, and the selector's rank-0 fallback picks **Cantina Recoleta**.
  Free-form G1 and autocomplete-no-type rank it #1. SerpApi returns only the
  cemetery.
- **Plaza San Martín:** production A1 is correct (#1), with other in-radius
  Plazas San Martín at 9.9 and 14.6 km. **Removing `type` from Autocomplete
  destroys it**: A2/A3 return only a "Plaza San Martín" 42 km away (A4 adds
  one 1,058 km away). G1 keeps it at #1.
- **Parque Lezama:** Autocomplete without `type` returns four "Parque
  Lezama" bus stops; the selector's exact-name + closest rule picks a bus
  stop over the park.
- **San Martín (bare common name):** Autocomplete A1 → Teatro General San
  Martín / Centro Cultural General San Martín (0.6 km); A2/G1 → the partido
  "Ciudad del Libertador General San Martín" (14.6 km); SerpApi → a single
  `place_results` for the partido (no list, so the ambiguity is invisible).
- **Geographic leakage:** every configuration without a hard `filter`
  leaks — Geoapify A4 returned 55 candidates beyond 50 km (up to 13,000 km);
  Google `locationBias` let the Oviedo, Spain statue be the *only* answer for
  "Mafalda Statue". A hard circle keeps everything inside 50 km, but 50 km
  still includes Greater Buenos Aires same-name places (Güemes, Plazas San
  Martín).

## 7. Root causes

Of the production PLACE misses measured (Geoapify, the active
`PLACES_PROVIDER`):

| Cause | Evidence |
|---|---|
| **Endpoint misuse** (`WRONG_ENDPOINT`) | Autocomplete is a name-completion endpoint; it cannot match a descriptive/English-gloss hint ("Mafalda Statue") that Forward Geocoding matches at #1. |
| **Parameter misuse** (`OVER_RESTRICTIVE_TYPE_FILTER`) | `type=amenity` excludes `landuse=cemetery` and untagged building ways (Recoleta ×2, Galería Güemes). |
| Parameter needed, but not sufficient alone | Dropping `type` on Autocomplete trades those hits for new misses (Mafalda bare, Plaza San Martín) and bus-stop/street noise: the Autocomplete endpoint is the problem, not only its filter. |
| **Provider limitation** (`PROVIDER_COVERAGE_GAP`) | None observed for Geoapify on this corpus: every PLACE hint was retrievable by *some* Geoapify configuration. |
| **Zig-Zag selector** (`ZIGZAG_SELECTION_BUG`, 23 rows) | Two patterns: exact-normalized-name wins over rank even when the exact match is a different object (shop "Mafalda", bus stop "Parque Lezama", Ramos Mejía "Galería Güemes"); rank-0 fallback picks businesses/sub-features (Cantina Recoleta, Mirador Galería Güemes). In today's production shape it only bites Güemes (the correct object is absent anyway); it becomes material as soon as recall improves. |
| Google (measured on Mafalda only) | Current shape (no `languageCode` → API default `en`, `locationBias` only) returns a wrong-country object for the English gloss: `LANGUAGE_QUERY_MISMATCH` / `INSUFFICIENT_GEO_CONTEXT`. `maxResultCount` vs `pageSize`: identical status, count and ranking in all 3 comparisons — the deprecation has no observable effect today. |

The diagnosis column in `matrix.json` is computed mechanically (the parameter
whose change turns a miss into a hit for the same wording). Where it is coarse,
the human-reviewed cause above wins: e.g. "Mafalda" A3/A4 are labeled
`INSUFFICIENT_GEO_CONTEXT` but are really type-removal noise like A2.

## 8. Gate verdict

The spike **PASSES**: the evidence is sufficient to decide the Geoapify
strategy, and is explicitly insufficient for Google.

- **Geoapify: "provider is capable but current endpoint/parameters suppress
  valid results."** Every PLACE hint in the corpus was retrievable by
  Geoapify; production misses 4/12 because of Autocomplete +
  `type=amenity`. Forward Geocoding free-form (G1) recovers 3 of them with no
  new geographic leakage, no selector regression on hits, and the same
  latency class (median 982 ms vs 920 ms). The remaining miss (Güemes) is a
  same-name/locality precision problem, not recall.
- **Google Places: "capable, but current parameters suppress valid results"
  — for Mafalda only.** Its production shape returns a wrong-country object
  for the English gloss; `languageCode=es regionCode=AR` or the city in the
  text fixes it. The rest of the Google matrix is **UNMEASURED** (quota), so
  no Google-wide conclusion is claimed.
- **SerpApi Google Maps: capable** on everything it was asked (Mafalda ×5
  forms, Farmacia, Recoleta Cemetery EN) and handles the English gloss with
  plain `ll` context. It returns the same Google place id as Places API, so
  it adds no independent identity. Not viable as an acquisition path at the
  current plan (250 searches/month, 3 left), ~1.1 s median, and its
  single-`place_results` collapse hides ambiguity.

## 9. Recommended direction

**B. Replace the Geoapify text endpoint/mode** — `searchText` should use
`/v1/geocode/search` free-form `text`, **no `type`**, hard circle `filter` +
proximity `bias`, and obtain explicit identity through Place Details
(`datasource.raw.osm_type/osm_id`, `wikidata`), never from the opaque
`place_id`.

| Criterion | Evidence |
|---|---|
| Coverage | 11/12 vs 8/12 PLACE hints; all Mafalda/Recoleta misses recovered. |
| Precision | No new out-of-radius leakage (0 beyond 50 km). New risk: without `type`, streets are candidates (Defensa) — PLACE must still reject `result_type=street`; and same-name places elsewhere in the 50 km circle (Güemes) still need verification. |
| Stable canonical ID | Geoapify `place_id` differs between modes for the same object → not canonical. Explicit OSM `type/id` from Place Details is. |
| Cross-provider identity | Place Details adds `wikidata` QIDs (Mafalda, Casa Mínima, Mercado, Plaza Dorrego, Basílica, Lezama, Recoleta, Plaza San Martín), usable later by the IdentityVerifier; no provider returns a Google ↔ OSM link. |
| Geographic control | Hard `filter` is honored by both Geoapify endpoints; Google `locationBias` is not a boundary. |
| Latency | G1 median 982 ms / p95 2,985 ms; + Place Details median 616 ms when identity is needed. |
| Cost | 1 geocode request per hint (+1 Place Details for the chosen candidate); Geoapify free-tier credits. |
| API semantics | Uses both endpoints as documented (no `text`+structured mixing; `type` only where a location-type restriction is intended). |

Not chosen, with reasons: **A** (fix parameters only) — dropping `type` on
Autocomplete loses Plaza San Martín and bare "Mafalda" and adds bus-stop
noise, so parameters alone are not enough. **C/D/E** (Google primary /
fallback / independent) — cannot be decided on one measured hint; completing
the Google matrix after the quota reset is a prerequisite, together with the
production field-mask cost issue (Enterprise tier). **F** (SerpApi fallback) —
quota, latency, and no identity beyond Google's own place id.

## 10. Production changes

**NONE in this spike.** Proposed for review only (not applied):

1. Geoapify `searchText`: Forward Geocoding free-form, no `type`,
   filter+bias; PLACE must still reject non-PLACE `result_type`s.
2. Explicit OSM identity via Geoapify Place Details for the selected
   candidate.
3. `selectBestPlaceCandidate`: the exact-name-first rule and the rank-0
   fallback both pick wrong objects once recall rises (23 rows) — to be
   handled by candidate correlation / IdentityVerifier, not by lexical lists.
4. Google (separate decision, after measurement): derive
   `languageCode`/`regionCode` from the resolved destination; migrate
   `maxResultCount` → `pageSize`; trim the Text Search field mask to Pro
   identity fields (production currently bills Enterprise).

No token stripping, word lists, aliases, IdentityVerifier behavior, Stage 4
flags, or voting were introduced.

## 11. Status

- Stage 3: **remains IN PROGRESS**.
- Stage 4: **untouched / BLOCKED** (`isMigrationRequiredHint`, `required`,
  partial composite lifecycle, planner eligibility not touched).

## 12. Caveats

- Ground truth (point + tolerance + a loose name predicate) is hand-set for
  labeling only and lives in the harness. Two labels were corrected during
  the spike after inspecting raw data: OSM's English name is literally
  misspelled "Recoleta Cemetry", and the Galería Güemes point was ~200 m off.
  Transit stops/bike docks named after a place are never counted as the place.
- Provider results are live and can drift between runs; the matrix is from the
  final run, and the per-run request totals are in `summary.md`.
