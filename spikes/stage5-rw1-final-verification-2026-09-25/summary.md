# Stage 5 RW1 — run summary (2026-09-25)

Request: `request.json` (RW1 San Telmo historical walk; byte-identical to the
Stage 3 E2E and Stage 4 control). Real HTTP path (auth → generate-tour →
outbox → processor → generation), one fresh backend process per run, dedicated
DBs `zigzag_spike_stage5_rw1_cold{1,2,3,4}` (never reused from other spikes).
Config per run (`*/provider-config.txt`): `GROUNDED_SEARCH_PROVIDER=serper`,
`PLACES_PROVIDER=geoapify`, `AI_PROVIDER=groq` (extractor `qwen/qwen3.8-27b`),
`AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`, local Nominatim/Overpass.

| Run | Code | DB | Status | Latency | Candidates (entity-resolution rows) | Composites (>1 hint) |
| --- | --- | --- | --- | --- | --- | --- |
| COLD 1 | `576bbe5` | cold1 (fresh) | completed | 338 s | 29 | 1 — "San Telmo Walking Tour" 2/2 |
| WARM | `576bbe5` | cold1 (reused, new process) | completed | 65 s | 7 | 0 |
| COLD 2 | `576bbe5` | cold2 (fresh) | completed | 260 s | 21 | 0 |
| COLD 3 | `576bbe5` | cold3 (fresh) | completed | 374 s | 21 | 0 |
| COLD 4 | `3097641` | cold4 (fresh) | completed | 312 s | 22 | 1 — "San Telmo Walking Tour" 2/2 |

COLD 4 is a targeted control (not campaign growth): it ran after
`3097641` made an unrecognized extractor envelope observable, to tell
whether COLD 2/3's zero web extraction was an empty model answer or a
silently dropped response.

## Extractor (web passes)

| Run | walk pass (area_route_walk) | generic pass | notes |
| --- | --- | --- | --- |
| COLD 1 | 7 evidence → 1 candidate (Lezama Park, Plaza Dorrego; both SUPPORTED) | 7 → 0; later pass 10 → 0 | |
| COLD 2 | 10 → 0 | 9 → 0 | Groq 429 (OTPM) degraded 2 classifications, not extraction |
| COLD 3 | 10 → 0 | 10 → 0 | no provider errors |
| COLD 4 | 10 → 0, **no** `extractor_envelope_unrecognized` note → genuine empty answer | 10 → 1 (bare object, `extractor_envelope_repaired`; Plaza Dorrego, El Mercado de San Telmo; SUPPORTED) | |

Every walk pass's evidence was San Telmo walking-tour pages (GuruWalk,
Tripadvisor, free-walk sites). No extraction pass had validation errors or a
source-support rejection.

## Composites observed

| Run | Composite | Components | Identity | Relation (scope) | CGV | Persistence | Planner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COLD 1 | San Telmo Walking Tour | Lezama Park → Parque Lezama `osm:way:17441757`; Plaza Dorrego → `osm:way:31364659` | 2 RESOLVED (LOCAL_OSM_POOL: Wikidata match; EXACT_NAME+ALIAS SINGLE) | INSIDE, INSIDE (VALIDATION_AREA San Telmo) | ACCEPTED `component_defined` | PERSISTED NEW, 2 components | eligible; selected (order 1) |
| COLD 4 | San Telmo Walking Tour | Plaza Dorrego; El Mercado de San Telmo | 2 RESOLVED | INSIDE, INSIDE | ACCEPTED `component_defined` | **NOT_PERSISTED — AMBIGUOUS_DEDUPE** | not eligible |

Coverage/ratio: both 2/2, `sourceCompositionComplete: true`,
`openResearchDeficits: []`. No partial composite, no ROUTE/AREA component,
no OUTSIDE/INTERSECTS/UNDETERMINED relation, no AMBIGUOUS/CONFLICTED
component was produced live.

## Component outcomes (all runs)

| Run | RESOLVED | UNRESOLVED | AMBIGUOUS | CONFLICTED | relations | deficits |
| --- | --- | --- | --- | --- | --- | --- |
| COLD 1 | 18 | 12 | 0 | 0 | INSIDE 18 | NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION 12 |
| WARM | 4 | 3 | 0 | 0 | INSIDE 4 | NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION 3 |
| COLD 2 | 12 | 9 | 0 | 0 | INSIDE 12 | NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION 9 |
| COLD 3 | 12 | 9 | 0 | 0 | INSIDE 12 | NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION 9 |
| COLD 4 | 14 | 9 | 0 | 0 | INSIDE 14 | NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION 9 |

Unresolved simple candidates repeat across runs (Geoapify structured
observations with no OSM counterpart found by the strategies that ran:
catalog → trusted observation → local OSM pool): Roca granitica, Monasterio
San SAVAS, La Hazana, Isidoro Cañones, Baloon, Museo de la Historia del
Traje, Princess, Manzana de las Luces, Pasaje San Lorenzo, Bar El Federal.
Scopes: VALIDATION_AREA (walk pass), DESTINATION_AREA (other passes); no
POINT_RADIUS.

## Named cases

| Case | Observed |
| --- | --- |
| El Zanjón de Granados | `osm:node:9953027884` in all 4 COLDs: structured "(historic ruins)" via LOCAL_OSM_POOL `IDENTITY_CONVERGENCE` (Geoapify observation REJECTED by non-corroborating Wikidata, then OSM converged); bare "El Zanjón de Granados" via NOMINATIM `IDENTITY_CONVERGENCE` onto the same GeoEntity; both hint texts in verified-hint memory; WARM `CATALOG_REUSE` via `CATALOG_VERIFIED_HINT_MATCH(SINGLE)`, 0 identity calls. Standalone "El Zanjón de Granados" Experience fails closed `AMBIGUOUS_DEDUPE` against "(historic ruins)" (same GeoEntity, different names). |
| Plaza de Mayo | Only inside evidence snippets (COLD 1 generic pass, COLD 2); never emitted as a component hint → acquisition and geographic relation NOT EXERCISED live. |
| Calle Defensa | Never a ROUTE hint; "Carnavales de la Calle Defensa" is a PLACE node (`osm:node:5410557722`, INSIDE). ROUTE/MultiLineString path NOT EXERCISED live. |
| Solar de French | Hint "Solar French" (Geoapify name) → `osm:node:6903962986` via LOCAL_OSM_POOL `EXACT_NAME(SINGLE)+IDENTITY_CONVERGENCE` in all 4 COLDs (Geoapify observation REJECTED by Wikidata). Stage 3 resolved hint "Solar de French" to `osm:relation:9314953`: the node/relation divergence stays explicit across runs; nothing merged by proximity. |
| Mafalda / Farmacia / Recoleta | Not emitted in any run. |

## Provider requests (host + path only; no keys)

| provider | COLD 1 | WARM | COLD 2 | COLD 3 | COLD 4 |
| --- | --- | --- | --- | --- | --- |
| serper | 3 | 1 | 2 | 2 | 2 |
| **serpapi** | **0** | **0** | **0** | **0** | **0** |
| **google places** | **0** | **0** | **0** | **0** | **0** |
| geoapify places (search) | 1 | 0 | 1 | 1 | 1 |
| geoapify place-details | 9 | 0 | 9 | 9 | 9 |
| geoapify routing (planner travel times) | 124 | 124 | 30 | 30 | 30 |
| nominatim (local) | 4 | 1 | 4 | 4 | 4 |
| overpass (local) | 6 | 2 | 4 | 4 | 4 |
| wikidata | 13 | 0 | 12 | 12 | 12 |
| wikipedia (en/es) | 5/1 | 0/1 | 3/1 | 3/1 | 3/1 |
| wikivoyage (es) | 3 | 1 | 2 | 2 | 2 |
| wikimedia commons (media) | 6 | 0 | 6 | 6 | 6 |
| groq | 29 | 5 | 30 | 25 | 25 |
| embeddings (local ollama) | 15 | 4 | 13 | 13 | 13 |

WARM's Nominatim/Overpass requests are destination resolution plus one POI
pool for the three hints that were unresolved in COLD too (failed
resolutions are not remembered).

## DB counts (before → after)

| Run | GeoEntity | GeoEntityIdentity | verified-hint entries | Experience | ExperienceComponent | dup identities | dup Experience names |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COLD 1 | 0 → 13 (12 PLACE, 1 AREA) | 0 → 17 | 0 → 13 | 0 → 11 | 0 → 12 | 0 | 0 |
| WARM | 13 → 13 | 17 → 17 | 13 → 13 | 11 → 11 | 12 → 12 | 0 | 0 |
| COLD 2 | 0 → 12 | 0 → 18 | 0 → 12 | 0 → 11 | 0 → 11 | 0 | 0 |
| COLD 3 | 0 → 12 | 0 → 18 | 0 → 12 | 0 → 11 | 0 → 11 | 0 | 0 |
| COLD 4 | 0 → 12 | 0 → 18 | 0 → 13 | 0 → 11 | 0 → 11 | 0 | 0 |

All Experiences `VERIFIED`, embedded at semantic-document version 3. No
ROUTE GeoEntity was created in any run.

## Planner boundary (real `findVerifiedWithin` / `findVerifiedWithinForMatching`)

`planner-boundary.js` calls the production `ExperienceCatalogService`
methods read-only on each COLD DB (`*/planner-boundary.json`,
`planner-check.json`). In every run both boundaries return exactly the
candidates whose trace outcome is `PERSISTED` (11/11), and nothing else;
every persisted composite's component set equals its full resolved source
composition; no non-persisted candidate's component set surfaces.

## Files

`matrix.json` (100 rows, one per run × candidate), `provider-counts.json`,
`planner-check.json`, `*/analysis.json`, `*/generation-trace.json`,
`*/db-before.json`, `*/db-after.json`, `*/provider-requests.ndjson`,
`*/backend.log` (Groq organization id redacted). Tools: `run.sh`,
`count-requests.cjs`, `db-snapshot.sh`, `analyze.py`, `planner-boundary.js`.
