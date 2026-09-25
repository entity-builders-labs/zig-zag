# Stage 3 — PLACE cutover: live COLD/WARM controls (2026-09-25)

Branch `feat/preference-first-selection`, starting HEAD `9eaf5ec` (verified
equal to `fork/feat/preference-first-selection` before any change).

Harnesses (both `RUN_SPIKE_PREFLIGHT=1`, real providers, nothing mocked):

- `be/test/live/place-cutover-cold-warm.live-spec.ts` — the REAL production
  `ExperienceProposalResolverService.resolve` over a dedicated fresh
  database (`zigzag_spike_stage3_place_cutover`, reset before every run),
  real Geoapify (Forward Geocoding + Place Details), local Nominatim and
  Overpass, live Wikidata. COLD = empty catalog; WARM = same DB, same hints.
  A third, strategy-isolated phase runs the production `resolveViaPlaces` +
  `isVerified` alone (no prior strategy, nothing persisted).
- `be/test/live/serper-country-code.live-spec.ts` — one Serper `/search`
  through the DI-selected grounded provider with the country code from the
  real `DestinationResolutionService`.

Evidence: `matrix.json` / `summary.md` (full corpus), `matrix.solar-de-french.json`
/ `summary.solar-de-french.md` and `matrix.diagnostic.json` /
`summary.diagnostic.md` (narrowed reruns, Galería Güemes), and
`serper-country-code.json`. Geoapify request parameters are recorded without
keys.

Destination: `Buenos Aires, Argentina` → `osm:relation:1224652`, area scale
(MultiPolygon), `countryCode=AR`.

## 1. What the first live run found (and fixed, generically)

The first COLD run after the adapter/identity commits still left Farmacia
`UNCONFIRMED_MATCH` and accepted a false positive for Galería Güemes:

| Finding | Root cause | Generic fix (`c101fea`) |
| --- | --- | --- |
| Farmacia: PLACES selected "Farmacia ABC"; details returned a different OSM node, so no convergence | Production passed `maxResultCount: 3`. Geoapify's `limit` is **not** a truncation: around the same bias point, `limit=10` returns "Farmacia de la Estrella" at #1 (confidence 0.9, `full_match`) while `limit=3` omits it and returns three unrelated pharmacies. Every G1 spike row was characterized at `limit=10`. | `PLACES_TEXT_SEARCH_RESULT_WINDOW = 10` |
| Galería Güemes resolved to the Ramos Mejía gallery (−34.6398, −58.5658) via NOMINATIM `EXACT_NAME(SINGLE)` | The NOMINATIM PLACE branch never applied the single destination policy (its AREA branch already did); the Ramos Mejía gallery is Nominatim's only exact hit | NOMINATIM PLACE matches positively outside the destination are `no_candidate` with a typed `INCOMPATIBLE` verdict |

The destination rule is the same authority `CompositeGeographicValidationService`
already applies to accepted candidates (`OUTSIDE_DESTINATION_BOUNDARY`); it now
runs before an out-of-destination GeoEntity is persisted. UNKNOWN (point-scale
destination, no polygon) excludes nothing.

## 2. Full-corpus COLD/WARM (final run, after the fixes)

| Hint | COLD | decisive evidence | COLD provider calls / ms | WARM | WARM calls / ms | Same GeoEntity |
| --- | --- | --- | --- | --- | --- | --- |
| Farmacia la Estrella | RESOLVED via PLACES | `IDENTITY_CONVERGENCE(NOMINATIM; openstreetmap/osm:node:3348573778)` | 6 / 7.5 s | PLACES (re-acquired) | 6 / 7.2 s | yes |
| Mafalda Statue | RESOLVED via LOCAL_OSM_POOL | `WIKIDATA(OWN_QID Q111038841; hint+candidate)` | 3 / 4.4 s | LOCAL_OSM_POOL (re-acquired) | 3 / 4.4 s | yes |
| Casa Mínima | RESOLVED (LOCAL_OSM_POOL) | `EXACT_NAME(SINGLE)` | 2 / 3.9 s | **CATALOG_REUSE** | **0** / 0.12 s | yes |
| Mercado de San Telmo | RESOLVED (LOCAL_OSM_POOL) | `EXACT_NAME(SINGLE)` | 2 / 3.8 s | **CATALOG_REUSE** | **0** / 0.15 s | yes |
| Plaza Dorrego | RESOLVED (LOCAL_OSM_POOL) | `EXACT_NAME(SINGLE)` | 3 / 4.3 s | **CATALOG_REUSE** | **0** / 0.13 s | yes |
| El Zanjón de Granados | RESOLVED via NOMINATIM | `IDENTITY_CONVERGENCE(LOCAL_OSM_POOL; openstreetmap/osm:node:9953027884)` | 3 / 4.2 s | NOMINATIM (re-acquired) | 3 / 3.9 s | yes |
| Basílica de San Francisco | RESOLVED (LOCAL_OSM_POOL) | `EXACT_NAME(SINGLE)` | 2 / 4.7 s | **CATALOG_REUSE** | **0** / 0.13 s | yes |
| Parque Lezama | RESOLVED (LOCAL_OSM_POOL) — the park `osm:way:17441757` | `EXACT_NAME(SINGLE)` | 3 / 5.0 s | **CATALOG_REUSE** | **0** / 0.08 s | yes |
| Cementerio de la Recoleta | RESOLVED (LOCAL_OSM_POOL) `osm:way:183842128` | `EXACT_NAME(SINGLE)` | 3 / 4.2 s | **CATALOG_REUSE** | **0** / 0.13 s | yes |
| Recoleta Cemetery | RESOLVED via PLACES — the cemetery | `WIKIDATA(OWN_QID Q831322)`; persistence **REUSED** the Cementerio GeoEntity (attached `geoapify:…` + `Q831322`) | 9 / 6.6 s | PLACES (re-acquired) | 9 / 6.3 s | yes |
| Galería Güemes | **UNCONFIRMED** (fail closed) | local "Mirador Galería Güemes" REJECTED; NOMINATIM + PLACES only hit = Ramos Mejía → `INCOMPATIBLE / OUTSIDE_DESTINATION_BOUNDARY` | 4 / 5.0 s | same | 4 / 4.7 s | — |
| Plaza San Martín | RESOLVED via PLACES — Retiro `osm:relation:531073` | `EXACT_NAME(SINGLE)` after 9 same-name homonyms were dropped as outside the destination | 7 / 6.8 s | **CATALOG_REUSE** | **0** / 0.14 s | yes |
| Defensa Street | **UNCONFIRMED** (never a PLACE) | PLACES: 8/8 results `street` → structurally rejected; local "Plaza de la Defensa" REJECTED | 4 / 5.5 s | same | 4 / 6.1 s | — |
| San Martín | **RESOLVED** to "Monumento al General San Martín" (LOCAL_OSM_POOL) — **negative control FAILS** | `DECLARED_ALIAS_MATCH(MULTIPLE)` + `WIKIDATA(OWN_QID)` | 3 / 4.3 s | same | 3 / 5.2 s | yes |

Name multiplicity is counted over the provider's bounded window after the
structural and destination filters (Plaza San Martín: 10 results, 9
homonyms outside the destination, 1 left → SINGLE); an in-destination
homonym ranked beyond the 10-result window would not be seen.

Provider calls exclude the local embedding provider (1 call per accepted
Experience). Catalog after COLD: 11 GeoEntities / 16 identities; after WARM:
**11 / 16** — zero duplicate GeoEntities, zero duplicate identities.

### Solar de French (exit-gate control, `matrix.solar-de-french.json`)

COLD: LOCAL_OSM_POOL `osm:node:6903962986` ("Solar French") REJECTED;
NOMINATIM `osm:relation:9314953` REJECTED; PLACES → Place Details declares
`osm:relation:9314953` → `IDENTITY_CONVERGENCE(NOMINATIM;
openstreetmap/osm:relation:9314953)` → RESOLVED. The node-vs-relation
divergence stays explicit (the node is never merged). WARM: **CATALOG_REUSE,
0 provider calls, 107 ms**, same GeoEntity.

## 3. PLACES strategy in isolation (Geoapify path alone)

| Hint | Viable / results | Rejected before selection | Selected | Identities from Place Details | Decision alone |
| --- | --- | --- | --- | --- | --- |
| Mafalda Statue (raw text) | 2 / 10 | bike dock (`transport_stop`), 2 streets, 5 outside destination | "Mafalda, Susanita and Manolito" (−34.6160, −58.3717) | `osm:node:2472979623`, `Q111038841` | **VERIFIED** (`OWN_QID`: Wikidata label "Mafalda statue") |
| Farmacia la Estrella | 5 / 10 | 5 outside destination | "Farmacia de la Estrella" | `osm:node:3348573778` (no QID: unknown, not a contradiction) | REJECTED alone — verified only by convergence with NOMINATIM (§2) |
| Galería Güemes | 0 / 1 | Ramos Mejía, outside destination | — | — | no candidate (fail closed) |
| Parque Lezama | 1 / 1 | — | the park | `osm:way:17441757`, `Q1133613` | VERIFIED |
| Plaza Dorrego | 1 / 5 | González Catán plaza (outside), 3 bus stops (`transport_stop`) | San Telmo plaza | `osm:way:31364659`, `Q3392154` | VERIFIED |
| Recoleta Cemetery | 1 / 2 | Cementerio Parque Recoleta (Pilar, outside) | "Recoleta Cemetry" | `osm:way:183842128`, `Q831322` | VERIFIED |
| Defensa Street | 0 / 8 | 8 × `street` | — | — | no candidate |
| San Martín | 0 / 2 | partido + suburb (`administrative_area`) | — | — | no candidate |

Place Details ran exactly once per viable selected candidate (11 details for
14 searches; 0 for Güemes, Defensa and San Martín). The opaque `place_id` was
never parsed.

## 4. Request budget

| Provider | COLD | WARM | Isolated | Notes |
| --- | --- | --- | --- | --- |
| Geoapify geocode/search | 5 | 4 | 14 | + 1 (Solar COLD) + diagnostics |
| Geoapify place-details | 3 | 2 | 11 | only for a selected viable candidate |
| Nominatim (local) | 6 | 5 | 0 | + 1 for destination resolution |
| Overpass (local) | 14 | 7 | 0 | + 1 for destination resolution |
| Wikidata | 20 | 12 | 5 | |
| Serper /search | 0 | 0 | 0 | 1 in the country-code live check |
| SerpApi | **0** | **0** | **0** | |
| Google Places | **0** | **0** | **0** | |

WARM avoided every provider call for the 7 hints whose text equals the
canonical name (Casa Mínima, Mercado, Plaza Dorrego, Basílica, Parque
Lezama, Cementerio de la Recoleta, Plaza San Martín): 22 COLD provider calls
→ 0, ~4–7 s → 80–150 ms each.

## 5. Country code → Serper `gl` (live)

`DestinationResolutionService` → `countryCode=AR` → request
`destinationCountryCode=AR` → DI provider `serper / google-search` → HTTP body
`{"q":…, "gl":"ar", "num":10}` (no `hl`) → Serper echo
`searchParameters.gl = "ar"` → `providerLocale {gl:"ar"}`. Hosts contacted:
`google.serper.dev` only; SerpApi 0.

## 6. Remaining deficits (not fixed here)

1. **Name-divergent WARM reuse.** Catalog-first retrieval is exact-name only;
   a hint whose text differs from the canonical name (Farmacia, Mafalda, El
   Zanjón, Recoleta EN, San Martín) is re-acquired on WARM (3–9 calls) —
   always onto the same GeoEntity, with no duplicates. Remembering *which hint
   text was verified to which GeoEntity* needs a typed persisted
   observed-name/alias fact; the current schema has none (GeoEntity.name +
   GeoEntityIdentity only), and hiding it in `metadata` would violate the typed
   canonical contract rule. This needs a schema migration — **stopped here per
   task instructions; needs approval first**. *Resolved later on 2026-09-25
   by verified hint memory on `GeoEntity` — see
   `spikes/stage3-verified-hint-memory-cold-warm-2026-09-25/assessment.md`.*
2. **San Martín.** LOCAL_OSM_POOL observes `DECLARED_ALIAS_MATCH(MULTIPLE)`,
   but IdentityVerifier rule 4 lets `WIKIDATA_IDENTITY_MATCH(OWN_QID)` verify
   before the multiplicity fallback. For a single-significant-token hint the
   own-QID "hint match" only re-checks the name, so it cannot resolve an
   observed ambiguity. Pre-existing (the cutover does not touch this path).
   A generic rule ("a name-only Wikidata match cannot resolve an observed
   MULTIPLE ambiguity") must first be characterized with controls
   (Mafalda, El Zanjón, Plaza Dorrego, Recoleta) before it is integrated.
3. `representativePoint` averages the FIRST polygon of a MultiPolygon; for
   CABA that is a small 78-vertex part, so the Places/Nominatim bias center is
   (−34.5696, −58.3710), north of the city. Harmless with the hard 50 km
   filter and the 10-result window, but not a principled center.
4. `AreaRouteAnchorResolverService` still labels Nominatim anchor candidates
   with the `nominatim` identity namespace.
