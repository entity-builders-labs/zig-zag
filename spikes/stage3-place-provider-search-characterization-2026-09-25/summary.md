# PLACE provider search characterization -- summary

Generated from `matrix.json` (290 rows, final run 2026-09-25T12:20:30.255Z). Cell = rank of the correct real object in the provider's own result list (`✗` = not returned, `—` = no single ground truth, `UNAV` = provider unavailable). `(sel✗)` = provider DID return it, but Zig-Zag's current `selectBestPlaceCandidate` would pick a different candidate from that same list.

Destination baseline (resolved once): `Buenos Aires, Argentina`, point {'latitude': -34.6037, 'longitude': -58.3816}, radius 50000 m, countryCode `AR`, Nominatim relation 1224652; DestinationResolutionService degraded to `scale=point` (`provider_failed`) -- the same point+radius `resolveViaPlaces` uses.

## GA

Geoapify `/v1/geocode/autocomplete` -- A1 = production (`type=amenity`, circle filter 50 km, proximity bias, limit 3, via `GeoapifyPlacesApiService.searchText`); A1w = same, limit 10; A2 = no type; A3 = filter only; A4 = bias only (no filter); A5-xx = A2 + `lang`.

| query | A1 | A1w | A2 | A3 | A4 | A5-es | A5-en |
|---|---|---|---|---|---|---|---|
| Mafalda Statue | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Mafalda | #1 (sel✗) | #1 (sel✗) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Estatua de Mafalda | ✗ | ✗ | #1 | #5 (sel✗) | #1 | #1 | #1 |
| Farmacia la Estrella | #1 | #1 | #1 | #1 | #1 (sel✗) | #1 | #1 |
| Casa Mínima | #1 | #1 | #1 | #1 | #1 |  |  |
| Mercado de San Telmo | #1 | #1 | #1 | #1 | #1 |  |  |
| Plaza Dorrego | #1 | #1 | #1 | #1 | #1 |  |  |
| El Zanjón de Granados | #1 | #1 | #1 | #1 | #1 |  |  |
| Basílica de San Francisco | #1 | #1 | #1 | #1 | #1 |  |  |
| Parque Lezama | #1 | #1 | #3 (sel✗) | #1 (sel✗) | #4 (sel✗) |  |  |
| Galería Güemes | ✗ | ✗ | #2 (sel✗) | #3 (sel✗) | #2 (sel✗) |  |  |
| Cementerio de la Recoleta | ✗ | ✗ | #1 | #1 | #1 (sel✗) |  |  |
| Defensa Street | ✗ | ✗ | ✗ | ✗ | ✗ |  |  |
| Recoleta Cemetery | ✗ | ✗ | #1 | #1 | #1 | #1 | #1 |
| Plaza San Martín | #1 | #1 | ✗ | ✗ | ✗ |  |  |
| San Martín | — | — | — | — | — |  |  |

## GS

Geoapify `/v1/geocode/search` -- G1 = free-form `text`, no type, filter+bias; G2 = G1 + `type=amenity`; G3 = structured `name`+`city=Buenos Aires`+`country=Argentina`, no geo params; G4 = G3 + filter+bias; G5 = structured `name` + filter+bias (no city); G1-xx = G1 + `lang`. Never `text` and structured params in one call.

| query | G1 | G2 | G3 | G4 | G5 | G1-es | G1-en |
|---|---|---|---|---|---|---|---|
| Mafalda Statue | #1 | #1 | #5 (sel✗) | #2 (sel✗) | #1 | #1 | #1 |
| Mafalda | ✗ | #1 (sel✗) | #1 (sel✗) | #1 (sel✗) | #1 (sel✗) | ✗ | ✗ |
| Estatua de Mafalda | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Farmacia la Estrella | #1 | #1 | #1 | #1 | #1 | #1 | #1 |
| Casa Mínima | #1 | #1 | #1 | #1 | #3 |  |  |
| Mercado de San Telmo | #1 | #1 | #1 | #1 | #2 |  |  |
| Plaza Dorrego | #1 | #1 | #1 | #1 | #1 |  |  |
| El Zanjón de Granados | #1 | #1 | #1 | #1 | #2 (sel✗) |  |  |
| Basílica de San Francisco | #1 | #1 | #1 | #1 | #2 |  |  |
| Parque Lezama | #1 | #1 | #1 | #1 | #1 |  |  |
| Galería Güemes | ✗ | ✗ | #1 (sel✗) | #2 (sel✗) | #1 (sel✗) |  |  |
| Cementerio de la Recoleta | #1 | ✗ | #1 | #1 | #1 |  |  |
| Defensa Street | #1 | ✗ | ✗ | ✗ | #1 |  |  |
| Recoleta Cemetery | #1 | ✗ | #1 | #1 | #4 (sel✗) | #2 (sel✗) | #1 |
| Plaza San Martín | #1 | #1 | #1 | #1 | #1 |  |  |
| San Martín | — | — | — | — | — |  |  |

## GP

Google Places `places:searchText` via `GooglePlacesApiService` (Pro-SKU field mask override) -- P1 = production shape (`maxResultCount=3`, 50 km `locationBias`); P1w = `maxResultCount=10`; P6 = `pageSize=10` (no `maxResultCount`); P2 = `"<q>, Buenos Aires, Argentina"`, no bias; P3 = `languageCode=es regionCode=AR`; P4 = `languageCode=en regionCode=AR`; P5 = `includedType=<Google's own primaryType of the correct object>`.

| query | P1 | P1w | P6 | P2 | P3 | P4 | P5 | P5 strict |
|---|---|---|---|---|---|---|---|---|
| Mafalda Statue | ✗ | ✗ | ✗ | #1 | #1 | ✗ | UNAV | ✗ |
| Mafalda | #1 | #1 | #1 | ✗ | #1 | #1 | UNAV | #1 |
| Estatua de Mafalda | #1 | #1 | #1 | #1 | #1 | UNAV | UNAV | UNAV |
| Farmacia la Estrella | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Casa Mínima | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Mercado de San Telmo | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Plaza Dorrego | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| El Zanjón de Granados | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Basílica de San Francisco | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Parque Lezama | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Galería Güemes | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Cementerio de la Recoleta | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Defensa Street | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Recoleta Cemetery | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| Plaza San Martín | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |
| San Martín | UNAV | UNAV | UNAV | UNAV | UNAV | UNAV |  |  |

## SA

SerpApi `engine=google_maps type=search` -- S1 = `ll=@-34.6037,-58.3816,12z`; S2 = city in `q`, no `ll`; S3 = `hl=es gl=ar` with `ll`. Budget-capped at 8 calls (account had 11 left this month).

| query | S1 | S3 | S2 |
|---|---|---|---|
| Mafalda Statue | #1 | #1 | #1 |
| Mafalda | #2 |  |  |
| Estatua de Mafalda |  | #1 |  |
| Farmacia la Estrella | #1 |  |  |
| Recoleta Cemetery | #1 |  |  |
| San Martín | — |  |  |

## Per-variant aggregate (rows with ground truth, provider available)

| provider | variant | rows | correct returned | returned AND selector picks it | candidates outside 50 km |
|---|---|---|---|---|---|
| geoapify-autocomplete | A1 | 15 | 9 | 8 | 0 |
| geoapify-autocomplete | A1w | 15 | 9 | 8 | 0 |
| geoapify-autocomplete | A2 | 15 | 11 | 9 | 0 |
| geoapify-autocomplete | A3 | 15 | 11 | 8 | 0 |
| geoapify-autocomplete | A4 | 15 | 11 | 7 | 55 |
| geoapify-search | G1 | 15 | 12 | 12 | 0 |
| geoapify-search | G2 | 15 | 10 | 9 | 0 |
| geoapify-search | G3 | 15 | 13 | 10 | 7 |
| geoapify-search | G4 | 15 | 13 | 10 | 0 |
| geoapify-search | G5 | 15 | 14 | 10 | 0 |
| geoapify-autocomplete | A5-es | 5 | 3 | 3 | 0 |
| geoapify-search | G1-es | 5 | 3 | 2 | 0 |
| geoapify-autocomplete | A5-en | 5 | 3 | 3 | 0 |
| geoapify-search | G1-en | 5 | 3 | 3 | 0 |
| google-places | P1 | 3 | 2 | 2 | 1 |
| google-places | P1w | 3 | 2 | 2 | 1 |
| google-places | P6 | 3 | 2 | 2 | 1 |
| google-places | P2 | 3 | 2 | 2 | 0 |
| google-places | P3 | 3 | 3 | 3 | 1 |
| google-places | P4 | 2 | 1 | 1 | 1 |
| google-places | P5 strict | 2 | 1 | 1 | 1 |
| serpapi-google-maps | S1 | 4 | 4 | 4 | 1 |
| serpapi-google-maps | S3 | 2 | 2 | 2 | 0 |
| serpapi-google-maps | S2 | 1 | 1 | 1 | 0 |

## Diagnosis counts (all rows)

- OK / no truth: 133
- PROVIDER_UNAVAILABLE: 83
- ZIGZAG_SELECTION_BUG: 23
- WRONG_ENDPOINT: 21
- OVER_RESTRICTIVE_TYPE_FILTER: 11
- LANGUAGE_QUERY_MISMATCH: 9
- INSUFFICIENT_GEO_CONTEXT: 6
- RESULT_WINDOW / RANKING: 3
- UNKNOWN: 1

## Requests and latency

| provider | live requests (whole spike, 3 runs) | median ms | p95 ms | failures |
|---|---|---|---|---|
| Geoapify autocomplete | 270 | 920 | 2166 | 0 |
| Geoapify geocode/search | 274 | 982 | 2985 | 0 |
| Geoapify place-details | 26 | 616 | n<20 | 0 |
| Google places:searchText | 24 HTTP (21 × 200, 3 × 429) | 500 | n<20 (max 1146) | daily quota exhausted after 21 calls |
| SerpApi google_maps | 8 | 1129 | n<20 (max 2090) | 0 |

Final-run counters as written by the harness: `{"geoapify.autocomplete": 90, "geoapify.search": 92, "geoapify.place-details": 13, "google.searchText (reused cached 200)": 19, "google.searchText": 1, "google.searchText (blocked locally, no HTTP)": 82}`.
Google field mask used: `places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType` (Pro SKU).
