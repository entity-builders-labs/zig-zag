# Stage 3 SIMPLE / COMPOSITE / MIXED real-world spike — comparison

Branch `feat/preference-first-selection` @ `26f2f30842129f01c855e44fcdbb4863dedac7ee` (remote HEAD verified
unmoved before and after the campaign). Real runtime path only:
`POST /auth/email/request-code → POST /auth/email/verify → POST /tours/generate-tour → outbox
TourGenerationRequested → TourGenerationProcessorService → ExperienceGenerationService.generateTourExperiences`.
Provider baseline: `GROUNDED_SEARCH_PROVIDER=serpapi`, `PLACES_PROVIDER=google`, `AI_CACHE_MODE=off`,
`USE_MOCK_MAPS=false`, local Overpass/Nominatim. Preflight (8/8) confirmed SerpAPI selected (not Tavily),
local OSM topology reachable, dedicated DBs, zero starting knowledge rows. No production code was
modified during this campaign; no issue found below was fixed.

One deviation from the literal task template, recorded for transparency: `allowedTransportationModes`
for COMPOSITE and MIXED was set to `["driving"]` instead of `["walking"]` — Luján de Cuyo bodegas are
spread across a rural department, not walkable within the requested day's mobility budget, and
`driving` is a real, normal user-facing `TransportationMode` option, not an invented one.

## Metrics table

All values are measured from `generationTrace.json` / `terminal-tour.json` / catalog row-count
snapshots for each run. `NOT OBSERVABLE` means the metric has no reliable signal in the current
runtime/logging — not that the true value is zero.

| metric | SIMPLE cold | SIMPLE warm | COMPOSITE cold | COMPOSITE warm | MIXED cold | MIXED warm |
|---|---|---|---|---|---|---|
| tour completed | YES | YES | **NO** (failed) | **NO** (failed) | **NO** (failed) | **NO** (failed) |
| runtime ms | 436,282 | 128,954 | 16,509 | 14,130 | 26,246 | 22,289 |
| selected Experiences | 4 | 4 | 0 | 0 | 0 | 0 |
| selected SINGLE_PLACE | 4 | 4 | 0 | 0 | 0 | 0 |
| selected MULTI_COMPONENT | 0 | 0 | 0 | 0 | 0 | 0 |
| new Experiences | 18 | **0** | 0 | 0 | 0 | 0 |
| reused Experiences | 0 | 18 (all 18 catalog-eligible; 4 selected) | 0 | 0 | 0 | 0 |
| new GeoEntities | 22 | **0** | 0 | 0 | 0 | 0 |
| reused GeoEntities | 0 | 22 (implicit via catalog; no re-resolution needed) | 0 | 0 | 0 | 0 |
| CATALOG_REUSE (hint-level) | n/a (cold) | 17 attempted, 17 "reuse none" (all hints were previously-*rejected* candidates, never persisted, so no match is the correct outcome) | n/a | n/a (0 rows to reuse from) | n/a | n/a (0 rows to reuse from) |
| SerpAPI calls | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ (location rejected, retried) | NOT OBSERVABLE¹ (location rejected, retried) | NOT OBSERVABLE¹ (location rejected, retried) | NOT OBSERVABLE¹ (location rejected, retried) |
| Wikivoyage calls | included in 2 discovery passes (source attempted both passes) | included in 1 discovery pass | attempted, 0 candidates | attempted, 0 candidates | attempted, 0 candidates | attempted, 0 candidates |
| Places acquisition calls | 1 pass succeeded (source attempted) | 0 (not in pass-2 provider list) | **1 failed call** (400 INVALID_ARGUMENT) | **1 failed call** (400, reproduced) | **1 failed call** (400, reproduced) | **1 failed call** (400, reproduced) |
| OSM pool calls (Overpass) | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ |
| Nominatim calls | 1 (destination_resolution: 1 forward geocode) | 1 (same) | 4 (forward→reverse→forward→containing-boundary) | 4 (same) | 4 (same) | 4 (same) |
| Places identity calls | NOT OBSERVABLE¹ | NOT OBSERVABLE¹ | n/a (acquisition failed before identity stage) | n/a | n/a | n/a |
| Wikidata calls | 17 (proximity enrichment) — **17/17 timed out** (10s) | **0** | 0 (never reached) | 0 | 0 (never reached) | 0 |
| SOURCE_CONTRACT_VIOLATION | 0 | 0 | 0 | 0 | 0 | 0 |
| unresolved components | 4 (pass 1) + 4 (pass 2, overlapping names) | 2 | 1 (`Ruta del Vino en Bici en Chacras de Coria`: NO_OSM_MATCH — pass 1 only) | n/a (0 candidates surfaced) | 1 (`Ruta del Vino en Bici en Chacras de Coria`: NO_OSM_MATCH) | n/a (0 candidates surfaced) |
| ambiguous components | 0 observed | 0 observed | 0 observed | 0 observed | 0 observed | 0 observed |
| geographically rejected | 2 (`Puerto De Olivos`, `Iglesia San Ignacio de Loyola`: destination_mismatch) | 1 (`Iglesia San Ignacio de Loyola`: destination_mismatch, re-surfaced) | 0 (nothing reached this stage) | 0 | 0 | 0 |
| unmet facets | 0 (both satisfied post-acquisition) | 0 | 2 (`theme:wine`, `intent:route_like`) | 2 (same) | 3 (`theme:wine`, `intent:route_like`, `intent:visit`) | 3 (same) |
| completeness notices | 0 issues, `complete: true` | 0 issues, `complete: true` | n/a (failed before planning) | n/a | n/a | n/a |

¹ *No per-call HTTP instrumentation surfaces successful SerpAPI/Overpass/Places-identity calls in
application logs at LOG level in this build — only error/warn-level events do (e.g. the Google Places
400s and SerpAPI location-rejection warnings below were directly observed). `generationTrace`'s
`structuredCandidateCount`/`webCandidateCount`/`providersAttempted` fields were used as the best
available proxy for acquisition volume; this is itself an OBSERVABILITY finding (see below).*

## Findings

### F1 — COMPOSITE_DISCOVERY / GEOGRAPHIC_VALIDATION — Google Places Nearby Search radius overflow for large administrative-boundary destinations
- **Expected:** Luján de Cuyo (destination scaleHint `settlement`, resolved to the department's
  administrative boundary) should be searchable via Google Places like any other destination.
- **Actual:** Every Google Places acquisition attempt across all 4 non-SIMPLE runs failed identically
  with `400 INVALID_ARGUMENT: "Invalid radius. Radius must be in [0, 50000] inclusively."` — the
  radius derived from the resolved administrative boundary exceeds Google's 50 km Nearby-Search cap.
  This is reproducible byte-for-byte across COMPOSITE cold, COMPOSITE warm, MIXED cold, MIXED warm.
- **Evidence:** `spikes/.../composite/cold` backend log: `GooglePlacesApiService Error in searchNearby:
  Request failed with status code 400` / `{"error":{"code":400,"message":"Invalid radius. Radius must
  be in [0, 50000] inclusively.","status":"INVALID_ARGUMENT"}}`. Identical in `composite/warm`,
  `mixed/cold`, `mixed/warm`.
- **Impact:** Blocks the entire Google Places acquisition path for any destination whose resolved
  boundary implies a >50 km search radius (a real, unremarkable case — a wine-producing department is
  a completely normal tourism destination shape). This alone was sufficient to fail COMPOSITE and MIXED
  generation outright in this spike, before any composite-specific logic ran.

### F2 — MIXED_SHAPE_COVERAGE — `intent:route_like` deficits are never routed through the AREA_ROUTE_WALK acquisition strategy
- **Expected:** A `route_like` intent (explicitly requesting a route-shaped composite) should route
  through composite/route-specific acquisition (`AREA_ROUTE_WALK` per `partitionDeficitsByStrategy`'s
  own vocabulary), not the same generic point-search path as an ordinary "visit" deficit.
- **Actual:** In both COMPOSITE and MIXED (cold and warm, all 4 runs), the `coverage_analysis`
  deficit-routing step reported `AREA_ROUTE_WALK=0; GENERIC=2` (COMPOSITE) / `GENERIC=3` (MIXED) — every
  deficit, including `intent:route_like`, was classified GENERIC and acquired through the same
  `searchNearby` call that hit F1's radius bug.
- **Evidence:** `generation-trace.json` `coverage_analysis` step summaries in
  `composite/cold`, `composite/warm`, `mixed/cold`, `mixed/warm`.
- **Impact:** This is the answer to the task's explicit "where was shape information lost?" question:
  the loss point is between **deficits → SourcePlans** (`partitionDeficitsByStrategy`), not later at
  candidate admission or classification. A route-shaped Experience request never reaches whatever
  route-aware acquisition machinery exists (if any is wired for this deficit-origin), so it competes for
  discovery through the exact same generic path as a single-place "visit" deficit — and inherits that
  path's radius-cap failure mode. Compounds F1 rather than being fully independent of it.

### F3 — COMPOSITE_DISCOVERY / IDENTITY_RESOLUTION — grounded web discovery DID surface one real, plausible route candidate, but it failed OSM identity resolution
- **Expected/observed nuance:** Not everything was blocked by F1. In MIXED COLD pass 1, the web/SerpAPI
  channel (which does not share Google Places' radius mechanics) surfaced a genuine, source-backed
  candidate: **"Ruta del Vino en Bici en Chacras de Coria"** ("Wine Route by Bike in Chacras de
  Coria") — Chacras de Coria is a real neighborhood inside Luján de Cuyo, and a bike wine-route there is
  a plausible, on-theme composite. It was rejected at `entity_resolution` with `NO_OSM_MATCH`.
- **Evidence:** `mixed/cold/generation-trace.json` `entity_resolution` step:
  `"Rechazadas: Ruta del Vino en Bici en Chacras de Coria: NO_OSM_MATCH."` Local Overpass/Nominatim
  reachability was independently confirmed healthy by the preflight suite minutes earlier, so this is
  not local-OSM-infra unreachability — the specific route concept has no clean OSM
  way/relation/node match, which is plausible for an informally-named bike route.
- **Impact:** Confirms grounded web discovery *can* propose a real composite for this destination even
  though structured Google Places/OSM search cannot (F1); the bottleneck for COMPOSITE is downstream at
  entity resolution / OSM matchability for route-shaped concepts, not solely acquisition access. A
  clean run (without F1) would still need to clear this identity-resolution bar for a route composite.

### F4 — OBSERVABILITY — `tour.metadata.generationMessage` goes stale during a secondary discovery pass
- **Expected:** The frontend-facing `generationStatus`/`generationMessage` fields are documented (per
  `CLAUDE.md`) to "track live progress through a real sequence of stages," not a simulated one.
- **Actual:** During SIMPLE WARM, the backend log shows a real secondary acquisition pass running
  (`Built acquisition plan for "Buenos Aires" with 1 deficits: [wikivoyage, web]`, catalog-reuse lookups,
  geographic validation of 3 new hints) for over 90 seconds while polling `GET /tours/:id` continuously
  returned the stale message `"Planificando el itinerario día a día..."` — i.e. the exposed message
  named the *wrong* stage (planning) while the system was actually back in discovery/entity-resolution.
- **Evidence:** `spikes/.../simple/warm/run-manifest.json` (`pollElapsedMs: 128954`) cross-referenced
  with `stage3-simple-backend.log` timestamps 03:49:26–03:49:51 (`ExperienceAcquisitionPlannerService`,
  `ExperienceProposalResolverService`, `CompositeGeographicValidationService` activity) against the
  poll log showing `generationMessage: "Planificando el itinerario día a día..."` throughout that
  window.
- **Impact:** Minor for this spike's own analysis (trace-level truth was still available after the
  fact), but real for the in-app loading screen (`GenerationPipeline` component) — a user watching a
  warm regeneration would see a misleading stage name during a real ~90s secondary discovery window.

### F5 — OBSERVABILITY / INFRASTRUCTURE — Wikidata proximity enrichment: 17/17 calls timed out in SIMPLE COLD
- **Expected:** Wikidata enrichment is documented as best-effort ("generation succeeds without it").
- **Actual:** All 17 Wikidata proximity lookups attempted during SIMPLE COLD failed with
  `timeout of 10000ms exceeded`. Generation still succeeded (confirming the "best-effort" contract
  holds end-to-end), but 100% of the calls were wasted latency (part of the 436s cold runtime).
- **Evidence:** `stage3-simple-backend.log`, 17 `WikidataApiService WARN` lines, e.g. `Wikidata
  proximity lookup failed (-34.5826725,-58.4010755,200m): timeout of 10000ms exceeded`.
- **Impact:** EXPECTED_PRODUCT_BEHAVIOR in the sense that it degrades gracefully, but the 100% failure
  rate (not an occasional flake) suggests the public Wikidata endpoint/query shape used here is
  currently unreliable from this environment — worth a look independent of this spike's scope.

### F6 — INFRASTRUCTURE (confound, not a product finding) — Groq OTPM rate limit during MIXED COLD
- **Observed:** `preference_interpretation` fell back to deterministic parsing in MIXED COLD after 3
  Groq 429 retries (`Request too large ... output tokens per minute (OTPM): Limit 1000, Requested
  1190`), most plausibly caused by this spike deliberately running 3 backend processes concurrently
  against the same Groq API key/quota (SIMPLE + COMPOSITE overlapped in wall-clock time with MIXED
  following closely after).
- **Impact:** Flagged transparently as a likely artifact of this spike's own parallelization strategy,
  not necessarily representative of a single isolated production request. The deterministic-fallback
  *mechanism itself* firing correctly is real, useful evidence (degrades gracefully), but the *trigger
  frequency* here should not be read as a baseline Groq-reliability number.

### F7 — SIMPLE_DISCOVERY / EXPECTED_PRODUCT_BEHAVIOR — SIMPLE cold selection is genuinely sensible
- **Observed:** The 4 selected Experiences in SIMPLE COLD/WARM are Museo Nacional de Arte Decorativo
  (art, quality 4.7), Museo de Arte Latinoamericano de Buenos Aires / MALBA (art, 4.6), Museo Evita
  (history/culture, 4.5), National Museum of Fine Arts (art, 4.8) — all real, well-known, on-theme
  Buenos Aires art/culture institutions. No generic/commercial noise, no off-theme filler. Museo Evita
  is themed `history`/`culture` rather than strictly `art`, a minor but defensible adjacency (a
  culturally significant museum, not noise).
- **Impact:** Directly answers the SIMPLE key question: **YES**, a normal "visit art places" request
  materializes useful, real, sensible simple Experiences end-to-end through the live system.

## Key questions

### SIMPLE: Can a normal "visit art places" request materialize useful simple Experiences?
**YES.** Both COLD and WARM completed with `generationStatus: completed`, 4 real, on-theme, high-quality
(4.5–4.8) Buenos Aires art/culture museums selected, zero SOURCE_CONTRACT_VIOLATION, `tour_completeness`
PASS with no issues. See F7.

### COMPOSITE: Can the current system discover and materialize a real, source-backed multi-component wine Experience?
**NO — not in this spike, but not for lack of a real candidate exactly.** Both COLD and WARM failed
before any composite-specific logic (component resolution, geographic validation, family/variant
persistence) could run at all, gated entirely by F1 (Google Places radius overflow) and F2 (route
deficits never routed to route-aware acquisition). Web/grounded discovery *did* surface one plausible
real composite name in the sibling MIXED run (F3), which itself then failed at OSM identity resolution
— so even the one candidate that got past acquisition did not clear the next gate either. The honest
answer given only this evidence is **NO**, with the failure localized to two concrete, reproducible
points (F1, F2) rather than "COMPOSITE_DISCOVERY is broadly unworkable."

### MIXED: Can one request produce and select a useful mix of SINGLE_PLACE + MULTI_COMPONENT Experiences?
**NO.** MIXED COLD failed before any selection step — all three requested facets (`theme:wine`,
`intent:route_like`, `intent:visit`) remained unsatisfied, including the SINGLE_PLACE-oriented
`intent:visit` facet, which succeeded fine for SIMPLE's Buenos Aires destination but failed here too.
This confirms the blocker (F1: radius overflow for the Luján de Cuyo boundary) is **destination-driven,
not shape-driven** — it blocked the SINGLE_PLACE side of MIXED just as thoroughly as the MULTI_COMPONENT
side, because both funnel through the same `GENERIC`-routed Google Places acquisition call (F2). Shape
information was lost at the deficit→SourcePlan routing stage (F2), before shape ever mattered again.

### STAGE 3: Does catalog-first GeoEntity reuse materially reduce external identity work on warm runs?
**YES, for the case actually exercised.** SIMPLE WARM produced **zero new Experiences and zero new
GeoEntities** (18/18 and 22/22 fully reused) against an identical request, selected the exact same 4
Experience IDs as COLD, completed in 129s vs 436s cold (~3.4x faster), used 1 discovery pass with 2
providers instead of 2 passes with 3 providers, and made 0 Wikidata calls vs 17 in COLD. The only
external identity work retried on WARM was for *previously-rejected* hints (17 "reuse none" — correct,
since those specific candidates were never persisted, so there was nothing to reuse) — no
previously-*resolved* GeoEntity was ever re-fetched externally. COMPOSITE/MIXED could not exercise this
question at all (0 rows existed after COLD to reuse from) — **NOT EXERCISED** for those two shapes.

### Catalog behavior: Does accumulated catalog knowledge improve subsequent Tour materialization rather than merely deduping writes afterward?
**YES**, for SIMPLE. WARM's `coverage_analysis` step reported `18 Experience(s) elegible(s) frente a 4
requerida(s); todos los facets solicitados satisfechos` — the accumulated catalog is what let
`coverage_analysis` PASS immediately (vs FAIL→needs_additional_discovery on COLD) and let `db_search`
recover candidates directly, materially changing the generation path taken (shorter, fewer providers),
not just avoiding duplicate rows at the end of an otherwise-identical pipeline.

## Recommendation gate

**B. ONE CONTAINED FIX FIRST.**

F1 (Google Places Nearby-Search radius >50km for a large administrative-boundary destination) is a
specific, narrow, fully reproducible blocker that prevented *any* real evidence being gathered for
COMPOSITE or MIXED in this spike — both shapes failed at the exact same acquisition call before any
shape-specific, discovery-quality, or identity-resolution behavior could even be exercised. F2 (route
deficits never reaching a route-aware acquisition strategy) compounds it and is likely the more
architecturally significant of the two. Scaling to a larger destination corpus (option A) right now
would mostly re-collect the same F1/F2 failure for every destination whose resolved boundary implies a
>50km radius — a common shape for wine regions, rural departments, and other non-city destinations that
COMPOSITE/MIXED are explicitly meant to serve well. Stage 3's own catalog-reuse mechanism (option C) is
not in question — it worked cleanly on the one shape (SIMPLE) that got far enough to exercise it; there
is no evidence here that catalog-first identity behavior itself is failing to deliver reuse benefit.

Recommended narrow fix before further COMPOSITE/MIXED spiking: (1) clamp or otherwise handle Google
Places Nearby-Search radius requests derived from large administrative boundaries so they don't 400
outright, and (2) route `intent:route_like` (and likely other route/area/walk-shaped deficits) through
route-aware acquisition instead of `GENERIC`. Re-run COMPOSITE/MIXED against the same Luján de Cuyo
request afterward to see whether F3's underlying identity-resolution gap for route-shaped candidates is
the next real ceiling.
