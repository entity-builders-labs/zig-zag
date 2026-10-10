# Stage 3 — Serper provider characterization (2026-09-25)

Questions:

1. Can Serper `/search` be a clean, explicit alternative for **ordinary
   grounded Google Search** (SerpApi `engine=google`), without claiming to
   replace SerpApi `engine=google_ai_mode`?
2. What do Serper `/maps` and `/places` give us as a Google Maps/Places
   acquisition surface for PLACE hints, compared with the frozen baselines?

- Branch `feat/preference-first-selection`, starting HEAD `e6b366d`
  (checked against `fork/feat/preference-first-selection` before any change).
- Harness: `be/test/live/serper-provider-characterization.live-spec.ts`
  (`RUN_SPIKE_PREFLIGHT=1`, real Serper, nothing persisted). `/search` runs
  through the production `SerperGroundedSearchService`; `/maps` and `/places`
  run through the production `SerperApiService` client.
- Evidence: `matrix.json` (search rows + 42 PLACE rows with full candidate
  lists), `summary.md` (generated tables), `raw/<endpoint>/*.json` (Serper
  responses; the key never appears — it travels only in the `X-API-KEY`
  header, and every file is additionally scrubbed). Raw files are reused on
  re-run: re-running the harness spends nothing.
- **No SerpApi, Geoapify or Google Places request was made.** Their columns
  are read from the frozen
  `spikes/stage3-place-provider-search-characterization-2026-09-25/matrix.json`
  and, for `/search`, from the persisted generation traces of
  `stage3-buenosaires-walks-component-survey-2026-09-24/{cold,cold-laboca,cold-recoleta}`
  and `stage3-santelmo-composite-control-2026-09-23/cold`. The harness wraps
  `fetch` and asserts `serpapi.com` calls = 0 (measured: 0; the only host
  contacted was `google.serper.dev`).

## 1. Live-verified Serper contract

Serper's public docs are a JS playground without a readable reference, so
every field below comes from live responses (`raw/`), not from memory.

| | `/search` | `/maps` | `/places` |
|---|---|---|---|
| Method / URL | `POST https://google.serper.dev/search` | `POST …/maps` | `POST …/places` |
| Auth | header `X-API-KEY` | same | same |
| Body sent | `q`, `num` (+ `gl`, `hl`, `location` in the locale probe) | `q`, `ll="@lat,lng,12z"`, `gl` (+ `hl`) | `q`, `location`, `gl` (+ `hl`) |
| Echo | `searchParameters` echoes exactly what was applied (`gl/hl/location/num`, `type`, `engine: google`) | echoes `ll`, `num: 10`, `page: 1` | echoes `location` **and a derived Google `uule`** |
| Results | `organic[]`: `title, link, snippet, position, date?, rating?, ratingCount?`; plus `peopleAlsoAsk`, `relatedSearches` sections | `places[]`: `position, title, address, latitude, longitude, type, types[], placeId, cid, fid, rating, ratingCount, website?, phoneNumber?, openingHours?, description?, thumbnailUrl?` | `places[]`: `position, title, address, latitude, longitude, category, cid, rating?, ratingCount?` — **no `placeId`, no `types[]`** |
| Credits reported (`credits`) | 1 per call (`num=10`) | **3 per call** | 1 per call |
| Invalid key | HTTP **403** `{"message":"Unauthorized.","statusCode":403}` | — | — |

Rate limits: no 429 or throttling was observed at this volume (sequential
calls); none are claimed. Default locale when `gl/hl` are omitted is the
provider's own (English titles — see §5), and `location`/`ll` are ranking
context, not boundaries (see §4).

## 2. `/search` — production adapter

`SerperGroundedSearchService` (selected only by
`GROUNDED_SEARCH_PROVIDER=serper`) sends `{ q, num: 10 }` (+ `gl` only when the
request carries an ISO-2 `destinationCountry`, which the live wizard path does
not set today) and converts **organic results only** into
`kind: organic_result` evidence. `peopleAlsoAsk` / `relatedSearches` /
`knowledgeGraph` / `answerBox` stay in `rawOutput` only.

Live, on the four real production discovery queries from the historical
traces (all four historically served by SerpApi **`google_ai_mode`**):

| query (production) | status | organic | evidence | ms | historical SerpApi (google_ai_mode) |
|---|---|---|---|---|---|
| BA … historical and cultural walking tours in Buenos Aires | applied | 9 | 9 | 5180 | 16 ev (9 paragraphs, 2 list items, 5 refs), 5 URLs |
| BA … caminata cultural por La Boca | applied | 10 | 10 | 1484 | 17 ev (2 / 10 / 5), 5 URLs |
| BA Recoleta … historic cultural walking tour in Recoleta | applied | 10 | 10 | 1187 | 30 ev (4 / 21 / 5), 7 URLs |
| San Telmo … caminata histórica por San Telmo | applied | 10 | 10 | 2646 | 18 ev (8 / 5 / 5), 5 URLs |

**NOT APPLES TO APPLES.** The historical rows are AI-Mode output: a
server-side synthesized narrative split into paragraphs/list items plus a few
references. Serper returns a traditional SERP: one title+URL+short snippet per
page. The counts cannot be compared as "more/less evidence"; the shape
differs. Shared domains were few (tripadvisor, guruwalk — 0–1 per query).
Serper evidence points at the original source pages (GetYourGuide, GuruWalk,
turismo.buenosaires.gob.ar, TimeOut, GPSmyCity, NYT…), whereas AI Mode's
paragraphs are Google's synthesis with a handful of reference links. Whether
the SERP snippet granularity is enough for walk/route extraction is an
extraction-quality question this spike does **not** answer (no extractor was
run).

Other measured facts:

- Normalization: 39/39 organic results emitted (`ORGANIC_RESULT_EMITTED`); no
  empty snippets or duplicates occurred live (both paths are unit-tested).
- Cache: the adapter wrote 4 applied results to the
  `serper-grounded-search:v1:` namespace; an identical repeat was served from
  cache with **0** Serper requests.
- Locale probe (`gl=ar hl=es location="Buenos Aires, Argentina"`, San Telmo
  query): all echoed as applied; **0/10 URL overlap** with the no-locale
  baseline and a visibly local result set (`tripadvisor.com.ar`, Civitatis,
  Tangol, Instagram). Locale materially changes the evidence, so the adapter
  deliberately derives it only from request facts (none today) instead of
  hardcoding `ar/es`.
- Latency (n=5): median 1648 ms, max 5180 ms (the first, cold call).
- Missing key → `unavailable/missing_serper_key` with no HTTP call; invalid
  key → HTTP 403 → `failed/serper_error_403`.

**Gate (`/search`): PASS** — explicit selection works end-to-end at the
provider contract, real calls succeed, organic results normalize with a full
audit, evidence is usable, caching is Serper-namespaced, provenance is
`serper / google-search`, SerpApi calls = 0, unit tests pass. This does **not**
mean equivalence to `google_ai_mode`.

## 3. PLACE matrix (production hint forms)

Geographic context identical to the prior spike: center −34.6037, −58.3816,
50 km radius; Maps `ll=@-34.6037,-58.3816,12z` (same viewport as SerpApi S1),
Places `location="Buenos Aires, Argentina"`; `gl=ar` from the resolved
destination country. Cell = rank of the correct object / result count.

| hint | Serper Maps M1 | Serper Places PL1 | Geoapify A1 (prod) | Geoapify G1 | Google P1 | Google P3 (es/AR) | SerpApi Maps |
|---|---|---|---|---|---|---|---|
| Mafalda Statue | **#1/3** | ✗ (1: **Oviedo, Spain**) | ✗ | #1 | ✗ (Oviedo) | #1 | #1 |
| Farmacia la Estrella | #1/4 | #1/4 | #1 | #1 | UNAV | UNAV | #1 |
| Casa Mínima | #1/1 | #1/1 | #1 | #1 | UNAV | UNAV | |
| Mercado de San Telmo | #1/20 | #1/10 | #1 | #1 | UNAV | UNAV | |
| Plaza Dorrego | #1/1 | #1/1 | #1 | #1 | UNAV | UNAV | |
| El Zanjón de Granados | #1/1 | #1/1 | #1 | #1 | UNAV | UNAV | |
| Basílica de San Francisco | #1/1 | #1/1 | #1 | #1 | UNAV | UNAV | |
| Parque Lezama | #1/6 | #1/1 | #1 | #1 | UNAV | UNAV | |
| Galería Güemes | #1/3 | #1/3 | ✗ | ✗ | UNAV | UNAV | |
| Cementerio de la Recoleta | #1/1 | #1/1 | ✗ | #1 | UNAV | UNAV | |
| Recoleta Cemetery | #1/1 | #1/1 | ✗ | #1 | UNAV | UNAV | #1 |
| Plaza San Martín | #1/20 | #1/10 | #1 | #1 | UNAV | UNAV | |
| **PLACE hits (12)** | **12/12** | **11/12** | 8/12 | 11/12 | — | — | 3/3 measured |
| San Martín (bare, no truth) | — (12 results) | — (**0 results**) | — | — | UNAV | UNAV | — (single `place_results`) |
| Defensa Street (ROUTE control) | ✗ (1: San Telmo Fair) | ✗ (4 POIs on Defensa) | ✗ | #1 (street) | UNAV | UNAV | |

Experimental Mafalda controls (not production rules): "Mafalda" Maps #2/20
(Plaza Mafalda #1), Places #1/10; "Estatua de Mafalda" #1/1 in both.

Label caveats (spike labels only, stated because they changed cells):
(a) Google localizes titles to the request language — with no `hl`, the
pharmacy is titled "Pharmacy Star" and the gallery "Mirador Guemes Gallery",
which the loose name labels could not match; a candidate is therefore also
counted correct when it is **exactly the same Google identity** (placeId or
cid) as the historical row (Mafalda, Farmacia) or as the same-request `hl=es`
control (Güemes, §5). (b) The Güemes label excludes the "Galería Güemes .
Árbol de Navidad" listing, which `hl=es` types as *Mirador* (the rooftop
viewpoint), not the gallery. (c) The ROUTE control counts only a street-typed
object; markets/fairs located *on* Defensa are not the street.

## 4. Mafalda

| | Serper Maps (M1) | Serper Places (PL1) |
|---|---|---|
| correct present / rank | **yes, #1 of 3** (Plaza Mafalda 6.4 km, Camino de la Historieta #2/#3) | **no** — the only result is "Estatua de Mafalda", C. Uría s/n, **Oviedo, Spain** (10,172 km) |
| placeId | `ChIJeRQn1k01o5UR5o5Yb5aJJ5Y` | none (endpoint never returns placeId) |
| cid | `10819767908987080422` | Oviedo's `17096444111895391042` |
| coordinates | −34.615832, −58.3716461 (6 m from label point) | 43.362373, −5.850391 |
| type | `Sculpture`; types `[Sculpture, Tourist attraction]` | category `Tourist attraction` |

Serper Maps returned **exactly the historical Google Place ID and CID**
(Google Places API P2/P3 and SerpApi S1/S2/S3 in the prior spike): exact
Google-identity convergence. It is the only measured production-shaped call
besides Geoapify G1 that finds the English gloss "Mafalda Statue" without
per-place wording, and the only one that returns Google identity with it.
Serper Places reproduces the Google Places P1 failure mode: with
`location=Buenos Aires` (sent as a `uule`), the English gloss still resolves
to the Oviedo statue only. Without `ll`/`location` both endpoints return only
Oviedo (§6). OSM `node/2472979623` is not referenced by any Serper field —
Google ↔ OSM correlation remains downstream.

## 5. Farmacia la Estrella and locale

| call | result list (rank · title · type · Google ids) |
|---|---|
| Maps M1 (no hl) | #1 "Pharmacy Star" Pharmacy `ChIJkxt8rtTKvJURbYdelktFp-A` / cid `16187983576554178413` · #2 Florería La Estrella (9.8 km) · #3 Ex Droguería La Estrella (apartment building) · #4 "Museo de la Ciudad - Farmacia la Estrella" Educational institution `ChIJ8-9y59LLvJURS93MNMZrE9E` / cid `15065503677517978955` |
| Maps M1 + `hl=es` | #1/1 "Farmacia De La Estrella" Farmacia, **same** placeId/cid |
| Places PL1 (no hl) | #1 "Pharmacy Star" cid `16187983576554178413` · #2 Museo… cid `15065503677517978955` · #3 Ex Droguería · #4 "Pharmacy La Estrella", **La Plata** (52.3 km) |
| Places PL1 + `hl=es` | same four, Spanish titles; La Plata still #4 |

- Serper → **same Google Place ID** as the historical SerpApi row
  (`ChIJkxt8rtTKvJURbYdelktFp-A`), and the same CID: exact convergence.
- Google has **two objects** at this corner (47–50 m from the OSM pharmacy
  node `3348573778`): the pharmacy itself and the Museo de la Ciudad listing
  that operates it, with different placeIds. So "one physical site" is not
  "one Google identity"; a correlator must not assume a 1:1 OSM ↔ Google
  mapping, and must not treat the second placeId as a contradiction either.
- `hl` changes both the **title** and the **result window**: Maps `hl=es`
  collapsed to one result and dropped the museum object.
- Galería Güemes: default-hl `#1 "Mirador Guemes Gallery"` (Shopping mall,
  Florida 165) is the **same placeId** `ChIJ5TzWetLKvJURxzt1cDvPF-k` that
  `hl=es` titles "Galería Güemes" (Centro comercial). Name-based verification
  against Spanish hints needs the destination language, not the provider
  default.

## 6. Negative controls

| control | Maps M1 | Places PL1 | geo-context control (no ll / no location) |
|---|---|---|---|
| Galería Güemes | #1 = the gallery; same-name **Ramos Mejía** gallery visible at #3 (17 km) → ambiguity visible | #1; Ramos Mejía absent; a rooftop bar at #2 | Maps: 1 result (the gallery, English title); Places: **0 results** |
| Recoleta Cemetery (EN) | #1/1 | #1/1 | — |
| Plaza San Martín | #1/20 (Retiro); other Plazas San Martín at 7.5–19.6 km visible | #1/10; also an office building and the San Martín monument | — |
| San Martín (bare) | 12 results: partido, train station, Instituto Sanmartiniano, Centro Cultural San Martín, Plaza San Martín… → **ambiguity visible** | **0 results** | Maps: **Dallas, TX** bakery (single result); Places: **San Antonio, TX** orthodontist |
| Defensa Street | **single-result collapse** to a market on Defensa (wrong structural type) | 4 POIs on Defensa (wrong structural type) | — |
| Mafalda Statue | — | wrong **country** (Oviedo) despite `location` | both: Oviedo only |

- **Wrong locality / city / country:** with `ll`, Maps production rows had 0
  candidates beyond 50 km. Places with `location` still produced a
  wrong-country single answer (Mafalda) and a 52 km La Plata row (Farmacia).
  Without context both endpoints default to the US or Spain. `ll`/`location`
  are ranking context, never a boundary: any PLACE use needs Zig-Zag's own
  post-filter against the destination scope.
- **Single-result collapse:** 12/21 Maps rows and 12/21 Places rows returned
  exactly one result. For unambiguous landmarks that is fine; for Defensa it
  hid that no street object exists, and for Mafalda-without-context it hid the
  real statue entirely. A single result is **not** evidence of
  non-ambiguity.
- **Wrong structural type:** neither endpoint returns streets as objects;
  Serper is not a ROUTE resolver, and a PLACE resolver must not accept a
  business "on Defensa" as the street.

## 7. Maps vs Places

| | Serper Maps | Serper Places |
|---|---|---|
| Recall (12 PLACE hints) | **12/12**, all at #1 | 11/12 (Mafalda gloss → Oviedo) |
| Google `placeId` | **every** result (102/102) | **never** (0/57) |
| `cid` | every result | every result |
| Types | `type` + `types[]` (e.g. Sculpture, Cemetery, Market, Basilica) | single `category` |
| Geo control | `ll` viewport bias (not a boundary); wrong country without it | `location` → `uule` bias; wrong country **even with it** for the gloss; 0 results for bare "San Martín" |
| Ambiguity | lists up to 20 for ambiguous names (San Martín 12, Plaza San Martín 20, Mafalda 20); single-result collapse on specific names | shorter windows (≤10), 0 results for bare "San Martín" |
| Latency | median 953 ms, p95 1340 ms (n=21) | median 1008 ms, p95 1886 ms (n=21) |
| Credits | **3 / call** | 1 / call |

## 8. Identity findings

- **Google Place ID availability:** only `/maps` returns it. When it does, it
  is Google's own identifier — measured identical to the IDs Google Places
  API and SerpApi returned for Mafalda and Farmacia.
- **Acquisition provider ≠ identity provider:** a Serper Maps observation must
  be recorded as *acquisition strategy = Serper Maps* with *identity
  namespace = Google Places* (`ChIJ…`), never as a `serper:` identity. The
  harness and docs keep the two apart; nothing is persisted.
- `cid` and `placeId` are different Google identifiers; Serper returns both
  for Maps. No CID → Place ID conversion was designed: `/places` gives only
  CID, and CID alone is recorded as a fact, not converted.
- **Correlation opportunity (documented, not implemented):** exact
  `placeId`/`cid` equality lets a correlator group Serper Maps, Google Places
  API and SerpApi observations of the same Google object without any name or
  distance heuristic. It does **not** bridge Google ↔ OSM, and Farmacia shows
  Google itself can hold two objects for one physical site. This is input for
  the provider-neutral correlation stage before `IdentityVerifier`; it does
  not authorize identity by itself.

## 9. Comparison with existing providers

- **Geoapify G1 (recommended in the prior spike):** 11/12, OSM identity via
  Place Details, hard circle filter, ~1 s, 1 request (+1 Place Details). Misses
  Güemes. Returns streets (needs PLACE type rejection).
- **Geoapify A1 (production today):** 8/12 — unchanged finding: Autocomplete +
  `type=amenity` is the wrong production strategy.
- **Google Places measured subset:** only Mafalda measured (quota); production
  shape fails the gloss (Oviedo), `es/AR` fixes it.
- **Historical SerpApi Maps:** 3/3 production hints measured, same Google IDs as Serper Maps,
  single-`place_results` collapse; no quota left.
- **Serper Maps:** 12/12, Google identity on every candidate, best Mafalda
  behavior among production-shaped calls; bias-only geography; 3 credits.
- **Serper Places:** 11/12, no placeId, the weakest geographic behavior.

Serper Maps and Geoapify G1 are **complementary identity surfaces** (Google
vs OSM), not substitutes. Neither result is a vote for the other.

## 10. Grounding capability gap

- **Serper replaces:** SerpApi `engine=google` — the general organic-SERP
  path — behind the same `ExperienceGroundedSearchProvider` contract.
- **Still missing without SerpApi:** `google_ai_mode` — Google's server-side
  AI-synthesized narrative with structured paragraphs/list items/references
  (what the semantic path consumes today for walk/route evidence). Serper has
  no equivalent; the adapter never emulates it and never labels itself AI
  Mode. `SerpApiGroundedSearchService` stays selectable for when quota
  returns.

## 11. Decision

- **`/search`:** production-selectable via explicit
  `GROUNDED_SEARCH_PROVIDER=serper`. **Not** the default; the implicit default
  is unchanged (serpapi-if-key, else groq) and `SERPER_API_KEY` alone never
  changes it. No fallback in either direction between SerpApi and Serper.
- **Serper Maps: option C — proposed as an independent Google-identity
  acquisition strategy, NOT wired here.** Evidence: 12/12 recall, exact
  Google identity on every candidate, correct Mafalda handling. Preconditions
  before any wiring: (1) `hl`/`gl` derived from the resolved destination
  (titles and windows change with language); (2) a hard post-filter against
  the destination scope (bias-only geography, wrong country without `ll`);
  (3) a single result must never be read as non-ambiguity; (4) streets never
  accepted as PLACE; (5) identity recorded in the Google namespace with Serper
  as provenance; (6) cost (3 credits) budgeted; (7) `IdentityVerifier` stays
  the only authority — no provider voting, no threshold changes.
- **Serper Places: option D — characterization capability only.** No
  placeId, wrong-country answer even with `location`, 0 results for a bare
  common name.
- **Geoapify:** the prior finding (A1 wrong, G1 11/12) stands untouched.

## 12. Requests, cost, caveats

- Successful live requests (all runs): `/search` 5, `/maps` 21, `/places` 21
  = **47**; credits reported by Serper: 5 + 63 + 21 = **89**. Plus 4
  unauthenticated invalid-key probes (HTTP 403; the probe is cached now) and 0
  SerpApi / Geoapify / Google requests.
- Pricing: the Serper site advertises 2,500 free queries on signup; per-call
  credits above are what the API reported, not a price table. No price is
  hardcoded anywhere.
- Results are live and can drift; ground-truth points/tolerances are hand-set
  spike labels, not production logic, and the label corrections in §3 were
  made after reading the raw data (stated, as in the prior spike).
- Stage 3: remains **IN PROGRESS**. Stage 4: **untouched / BLOCKED**
  (`required`, `isMigrationRequiredHint`, partial composite lifecycle and
  planner eligibility not touched). No `IdentityVerifier`, threshold,
  Wikidata or catalog-correlation change.
