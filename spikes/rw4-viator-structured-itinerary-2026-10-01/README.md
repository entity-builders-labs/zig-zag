# RW4 side spike — Viator structured itineraries (Mendoza wine)

Date: 2026-10-01 · Branch `feat/preference-first-selection` · HEAD `53eb0674`
Status: **SUPPORTING EVIDENCE** (no production change, no execution-pointer change)

Question: can Viator reliably provide source-owned Experiences whose itinerary
exposes a complete, structured composition of real geographic components that
Zig-Zag could later materialize?

## Environment — read this first

- **SANDBOX, not production.** The available key is a Viator *sandbox*
  affiliate key: `GET https://api.viator.com/partner/products/tags` → **401
  `Invalid API Key`** (credential not valid for production — not a tier
  restriction); the same call on `https://api.sandbox.viator.com/partner` →
  **200**. The whole spike ran on the sandbox.
- Sandbox products here look like real Mendoza supplier content (real
  wineries, real coordinates, ACTIVE status), but sandbox content is not
  guaranteed identical/current vs production. Conclusions about the *schema*
  are robust; per-product counts must be re-confirmed on production before
  any integration decision is final.
- Access tier: every endpoint used (`/destinations`, `/search/freetext`,
  `/products/{code}`, `/locations/bulk`) returned 200 → at least Basic-access
  affiliate content endpoints. No transactional endpoint was called.

## Reproduce

```bash
# key only from a gitignored env file; never on the command line
VIATOR_API_BASE_URL=https://api.sandbox.viator.com/partner \
  node --env-file=../../.env run.cjs      # live calls, cached in raw/
node analyze.cjs                          # offline, writes analysis.json
```

`run.cjs` reuses `raw/` (pass `--refresh` to re-call). It scans every
artifact for the key and deletes any file that contains it (none did).

## Files

| File | Content |
| --- | --- |
| `run-manifest.json` | endpoints, statuses, queries, sampling rule, sampled codes |
| `search-results.json` | full ranked result set (20/query) for 6 fixed queries, Mendoza destination 931 |
| `products.json` | per sampled product: code, title, status, URL, destinations, itinerary, logistics, options |
| `product-details/*.json` | full `GET /products/{code}` bodies |
| `locations.json` | all 290 itinerary/logistics refs → `POST /locations/bulk` |
| `analysis.json` | mechanical facts + classification judgments with quoted evidence |
| `raw/` | verbatim cached responses (status + body; never headers) |

## Sample

Queries (destination 931 Mendoza): `Mendoza wine tour`, `Maipu wine tour`,
`Lujan de Cuyo winery tour`, `Uco Valley wine tour`, `Mendoza wine bus`,
`Mendoza full day wine excursion`. Rule: round-robin over queries by rank,
dedupe, cap 10 — content-blind. Plus one **labeled out-of-sample supplement**
(`5674P1222`, rank 19, the Wine Bus) inspected only to observe
`HOP_ON_HOP_OFF`; excluded from counts.

| productCode | title | itineraryType | concrete structured stops | class |
| --- | --- | --- | --- | --- |
| 5573772P5 | Tour of 3 Wineries and Olive Trees with Tastings | STANDARD | 4 | B AMBIGUOUS |
| 5530264P4 | Tour wineries Lujan de Cuyo | STANDARD | 2 | **A COMPLETE** |
| 70442P6 | Uco Valley Wine Tour | STANDARD | 0 | D NONE |
| 40520P12 | Half Day Winery Tour | STANDARD | 4 | B AMBIGUOUS |
| 199477P2 | Uco Valley Day Wine Tour with Private Driver | STANDARD | 3 | B AMBIGUOUS |
| 5674P681 | Vineyards Tour in Mendoza: Wine & Olive Oil Tasting Experience | STANDARD | 0 | D NONE |
| 475969P2 | Maipu Tour 3 wineries with lunch + olive all inclusive! | STANDARD | 1 | C UNSTRUCTURED |
| 199477P3 | Private Mendoza WineTour: 3 Premium Wineries Michelin-Guide Lunch | STANDARD | 3 | **A COMPLETE** |
| 5668946P2 | Chocolates and Olive Winery Tour in Mendoza | STANDARD | 5 | **A COMPLETE** |
| 44877P6 | All Day, Small Group, Luxury Wine Tour with Gourmet Lunch | UNSTRUCTURED | 0 | D NONE |
| *5674P1222* | *Mendoza Wine Bus Tour Hop On Hop Off Wineries Experience* | *HOP_ON_HOP_OFF* | *0* | *B (supplement)* |

```text
sampled products: 10
STRUCTURED_COMPLETE: 3
STRUCTURED_BUT_AMBIGUOUS: 3
UNSTRUCTURED: 1
NO_USABLE_COMPOSITION: 3

products with >=2 concrete structured stops: 6/10
products whose itinerary locations all expose coordinates: 9/10
products requiring textual extraction for membership: 1/10
```

"Concrete" excludes pass-by items and items whose location is an area
(Mendoza, Maipu, Lujan de Cuyo, Valle de Uco, Chacras de Coria, Agrelo) —
**that PLACE/AREA reading is a spike judgment; Viator gives no location type.**

## Observed itinerary schema (live sandbox)

- `STANDARD` (9/10): ordered `itineraryItems[]`, each with
  `pointOfInterestLocation.location.ref`, optional `attractionId` (Viator
  attraction), `passByWithoutStopping` (bool), `admissionIncluded`
  (YES/NO/NOT_APPLICABLE), `duration`, free-text `description`.
  - **Only structured visit semantics: `passByWithoutStopping`.** There is no
    optional/alternative/substitution flag. Every substitution observed was
    in item prose.
  - Items can be areas (start/end city pass-bys, "Maipu" holding prose about
    unnamed or prose-only wineries).
- `UNSTRUCTURED` (1/10): `unstructuredDescription` prose + empty
  `unstructuredItinerary` + **unordered** `pointOfInterestLocations[]` (no
  visit semantics; here areas only).
- `HOP_ON_HOP_OFF` (supplement): `routes[]` with `name`,
  `operatingSchedule` (prose, weekday-dependent), `stops[]` (Google-only
  pickup points with a time in prose) and `pointsOfInterest[]` (unordered).
- `MULTI_DAY_TOUR`, `ACTIVITY`: not present in the sample.
- Meeting/start/end: in `logistics.start/end` (Google refs) plus
  `travelerPickup` (pickup pool of 0–170 refs) — **never** itinerary
  membership.
- Product options: separate `productOptions[]` (code/title/description); the
  itinerary is per *product*, not per option.

## Location refs (`POST /locations/bulk`)

| form | count | fields |
| --- | --- | --- |
| `TRIPADVISOR` | 248 | `reference`, `name`, `address`, `center{lat,lng}`; **no `providerReference`** |
| `GOOGLE` | 42 | `reference`, `providerReference` (Google place id) only — **no name, no coordinates** |

- All itinerary visit stops in the sample are `TRIPADVISOR` refs with name +
  coordinates. All logistics start/end and all HOHO stops are `GOOGLE` refs
  (need a Google Place Details call to get name/coords).
- Refs are stable across products and suppliers: Bodega Chandon is the same
  ref in 5530264P4, 199477P3 and 5674P1222; Olivicola Pasrai in 4 products.
- No OSM, Wikidata or external Tripadvisor location id is exposed. The
  `LOC-…` ref is a Viator-native opaque identity, not an OSM identity.

## Best compositions (A)

**199477P3 — Private Mendoza WineTour: 3 Premium Wineries Michelin-Guide Lunch**
(STANDARD, 1 option, pickup)

1. Bodega Chandon — `LOC-6eKJ+or5y8o99Qw0C8xWyP9qW+y4O2/AYEL/nPHEOdY=` — -33.137985,-68.8897 — visit (attractionId 27255)
2. Bodega Budeguer — `LOC-6eKJ+or5y8o99Qw0C8xWyPFcLXp+w6yUMXpsVFTkwhU=` — -33.15176,-68.89233 — visit
3. Bodega Lagarde — `LOC-6eKJ+or5y8o99Qw0C8xWyMc52Ry+uFjLlusfxOLpQiM=` — -33.023663,-68.87322 — visit (lunch)

**5668946P2 — Chocolates and Olive Winery Tour in Mendoza**
(STANDARD, 1 option, meet at start)

1. Bodega Artesanal Viña el Cerno — `LOC-6eKJ+or5y8o99Qw0C8xWyLR5oqrmjzYQkfWsqlQy80E=` — -33.00335,-68.75023
2. Olivicola Boutique Pasrai — `LOC-6eKJ+or5y8o99Qw0C8xWyDP4RKAMuVgMyCeQtc5HIv4=` — -33.013653,-68.799286
3. Bodega Florio — `LOC-6eKJ+or5y8o99Qw0C8xWyBcQjTJ/2F+lu1Ga7THrE6Q=` — -33.03206,-68.7771
4. Vistandes Winery — `LOC-6eKJ+or5y8o99Qw0C8xWyAkiGQy5nuoaUdW5z7CoAUc=` — -33.024857,-68.758575
5. Chocolezza — `LOC-6eKJ+or5y8o99Qw0C8xWyG+mHt7L9nWHX41HhcMypJ8=` — -32.88511,-68.84388

Item 1's prose never names the winery: membership identity comes only from
the structured ref. Excluded: logistics start/end (Google refs).

**5530264P4 — Tour wineries Lujan de Cuyo** (STANDARD, 1 option, pickup)

1. Bodega Chandon — same ref as above — visit
2. Bodega Sottano — `LOC-6eKJ+or5y8o99Qw0C8xWyPEIHRg4MZMoXsx4Zs8Aais=` — -33.09382,-68.92468 — lunch (duration field says 4 min: duration data is unreliable)

Caveat on all three: "complete" means *the source states no substitution*.
It is absence of contrary evidence in prose, not a structured guarantee.

## Why Viator must not be flattened

- **5674P1222 Wine Bus (HOP_ON_HOP_OFF)** — the exact product family RW4's
  web pipeline mis-merged. One product sells three distinct routes (Maipú
  Mon, El Sol Tue, Luján Sur Fri) as 6 options, with `X or Y` alternatives
  ("Chandon and Zolo or Budeguer"; "Casa El Enemigo Vigil and a choice
  between Bressia or Viña Las Perdices"). `routes[].pointsOfInterest` is the
  weekday *union*. Flattening it yields one fake 7-winery Experience.
- **40520P12** — 4 structured stops, but every item says "order, stops and
  times can change … between these selection wineries: Don Manuel Villafañe,
  Casa Corbel, Cecchin Family, Florio, Esencia 1870".
- **199477P2** — "WE LIST 6 WINERIES but … we visit 3 of them"; Finca
  Adelma appears only as an "Option:" in prose with no ref.
- **5573772P5** — "Availability … may vary: Vistandes, Viña el Cerno or
  Domiciano" per item.

All four look structurally identical to an A product. Ambiguity is only in
prose.

## Interpretation

- **Generic (schema-level, any destination):** STANDARD itineraries give an
  ordered, source-owned list of refs with name + coordinates; no type, no
  optional flag; options are separate from the itinerary; HOHO/UNSTRUCTURED
  carry unordered/union POIs; logistics is separate from membership.
- **Mendoza-specific:** the share of A vs B (supplier substitution is endemic
  in Maipú boutique-winery tours), area-only itineraries for Uco Valley
  regional tours, the Wine Bus variant structure.

Verdict: **PARTIALLY** — only `STANDARD` itinerary items that are non-pass-by
concrete places, in products whose prose states no substitution/alternative,
are safe as source-backed composition. See the progress-doc bitácora entry
for the mapping proposal and next step.
