# Activity Engine: destination-aware, interest-aware tour generation

## Problem

Tour generation (`POST /tours/generate-tour` → `TourActivityGenerationService.generateTourActivities`) produces itineraries that don't reflect the user's stated interests and skew toward irrelevant, obscure places for city-scale destinations. Investigated with a real generation for "Barcelona" (interests: history, art, architecture, beach, sports) — the candidate pool offered to the LLM was 8 activities, mostly hiking trails and viewpoints near Collserola, with zero of Barcelona's well-known attractions.

Four confirmed root causes, all in the candidate-sourcing/ranking layer that runs before the LLM ever sees a candidate list — the LLM's own reasoning and the anti-hallucination verification downstream of it are not implicated:

1. **The Google Places crawl-refresh gate is binary, not quality-aware.** `generateTourActivities` only triggers a background crawl when `nearbyActivities.length === 0`. Confirmed against the live DB: Barcelona has 13 total activities in the entire city (vs. 834 for Buenos Aires, 202-206 for Madrid/Paris/Vienna) — evidence of a badly-covered area that will never self-heal, because any nonzero result (even 1) short-circuits the crawl. (Aside, not in scope here: `HybridSearchService`'s separate 24h freshness check on `crawler_search` is itself dead — nothing in the codebase ever writes a row to that table, so that table is permanently empty and the check always returns "not recent." Worth its own fix later.)
2. **POI ranking ignores `interests` entirely.** `ActivitiesService.findAll()` sorts candidates by a Bayesian-weighted Google rating (`weightedScore`) with distance as a tie-break only. `GenerateTourOptions.interests` is passed to the LLM as prompt text, but never used to filter or rank which 15 candidates make it into that prompt in the first place — the LLM can only pick from whatever geography+rating handed it, regardless of fit.
3. **Curated composite activities are structurally outranked by real POIs.** Composite `Activity` rows (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`, e.g. a real, already-curated "San Telmo Walk" confirmed in the DB) have `rating`/`ratingCount` = `NULL`, since they're not Google Places records. The `weightedScore` formula gives them a flat neutral prior (`PRIOR_MEAN = 4.0`). A well-reviewed real POI scores ~4.7-4.8. Since candidates are truncated to the top 15 by this same score, a curated composite routinely loses this competition and never reaches the LLM — except in a data-poor area like Barcelona, where it wins by default because there's no real competition.
4. **Area/street exploration only ever considers one arbitrary point.** `OsmPlacesService.findContainingBoundary(lat, lng)` returns the single administrative boundary containing one point; `findStreetsNear` hard-caps its radius to `OVERPASS_MAX_RADIUS_METERS` (2.5km default) regardless of the tour's own search radius. For a city-scale destination, this means the live flow only has a shot at synthesizing a themed neighborhood walk if the geocoded center of "Barcelona" happens to land inside the right neighborhood — pure chance.

## Reframing: what "destination" should mean

The deeper issue behind #3 and #4 is conceptual, not just a ranking bug: the system treats every destination — "123 Main St" and "Barcelona" alike — as a point + a Haversine radius. That model is correct for a point-scale destination (an address, a specific POI, "near this hotel") but wrong for an area-scale destination (a city, a region): searching a real city was never "find what's within N km of one coordinate," it's "explore this place's real structure and bring back its best, most relevant experiences — POIs and multi-stop composites alike."

Point+radius should be reserved for genuinely point-scale destinations (an address, a specific POI, "near this hotel") — never the definition of "what is Barcelona" at the top level. Within a real sub-area (a neighborhood), a polygon-containment query against that neighborhood's own OSM boundary replaces a radius guess entirely (confirmed feasible in the spike below); Google Places remains the exception, since its API only accepts a point+radius call, so a neighborhood's own centroid is used there — but only as an implementation detail of *calling that one API*, not as how the destination itself is modeled. Composite activities (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`/`VariantTheme`) already model exactly the kind of multi-stop, themed experience a real trip should be full of; Google Places has no equivalent concept and never will (it only returns points). The gap today is entirely in orchestration, not in the underlying source integrations (`GooglePlacesService`, `OsmPlacesService`, Wikidata enrichment, `CompositeGenerationService`, the `generate-templates` CLI) — those already exist and are reused as-is by this design.

## Design

This design was validated with a live spike before implementation — real calls to Nominatim, Overpass, and Groq (with the exact production prompt/schema), no mocks. See "Spike validation" below. Three refinements below (Nominatim for name resolution, `map_to_area` instead of radius, relative neighborhood admin_level) came directly out of that spike, replacing an earlier draft that assumed a fixed admin_level range and radius-based neighborhood queries — both of which the spike showed to be wrong.

### 1. Destination resolution: point-scale vs. area-scale

New step at the start of `generateTourActivities`, before any candidate search: given the destination text the user typed (not just the lat/lng hint the FE autocomplete already resolves it to), resolve it via **Nominatim's structured search** (`https://nominatim.openstreetmap.org/search`), not a raw Overpass name query. Nominatim returns an `addresstype` per result ranked by `importance` — this is what actually disambiguates "Buenos Aires the city" from "Buenos Aires the province" or a same-named place in another country, which a bare Overpass `["name"~"..."]` regex query cannot do (confirmed in the spike: querying Overpass directly for "Buenos Aires" returned the city, its containing province, *and* an unrelated comuna, indistinguishable by name or admin_level alone; Nominatim's top result by `importance` was correctly the city, tagged `addresstype: city`).

- **`addresstype` is `city`/`town`/`village`/similar**: **area-scale**. Take the result's OSM relation id, fetch its boundary via Overpass (`relation(<id>); out geom;`), persist/reuse it as an `Activity.kind=AREA` row (the model already supports this — `boundary` field, existing `AREA` kind), and proceed to §2.
- **`addresstype` is `state`/`country`**: out of scope per this design (see "Explicitly out of scope") — falls back to point-scale unless coordinate-validated reverse normalization identifies a contained city/town/village selected by the wizard.
- **`addresstype` is a finer-grained type (`house`, `amenity`, a specific POI)**: **point-scale only when the result is geographically consistent with the FE's selected lat/lng hint**. This keeps today's behavior for "search near my hotel"-style destinations.
- **Nominatim returns nothing, or only same-name POIs/buildings far from the selected coordinates**: treat the label as ambiguous, run a bounded settlement-level reverse lookup, then retry with its structured locality and country. If that still yields no usable boundary, fall back to point-scale. This prevents a non-empty but irrelevant response (for example businesses or streets named "Salta" in other provinces) from suppressing city resolution.

Degradation: if Nominatim or Overpass is unavailable or times out, treat as point-scale (same defensive fallback pattern `OsmPlacesService` already uses everywhere — never block or fail generation on this).

### 2. Area-scale exploration: real neighborhoods, not one lucky point

New `OsmPlacesService` method, e.g. `findNeighborhoodsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]>`, using Overpass's `map_to_area` pattern to query real administrative sub-boundaries contained within the resolved city polygon — a true polygon-containment query, not a radius guess:

```
[out:json][timeout:25];
relation(<city_relation_id>);
map_to_area->.city;
(
  relation["boundary"="administrative"](area.city);
  way["boundary"="administrative"](area.city);
);
out tags center;
```

Filter the results to `admin_level` = the resolved city's own `admin_level` + 1 (**relative**, not a fixed absolute range like "8-11") — the spike showed `admin_level` semantics aren't consistent across countries: Buenos Aires' own city boundary is `admin_level=8`, and its 48 real barrios (San Telmo, La Boca, Recoleta, Palermo, etc., all confirmed by name in the spike) sit at `admin_level=9`, immediately adjacent to the city's own level, not inside a fixed 8-11 window a different country's tagging could easily violate.

A city can return dozens of these — not all are explored. Use a bounded shortlist (currently K=6) combining: (a) neighborhoods that already have a curated `ActivityFamily` in the DB (near-zero marginal cost, reuses trusted content — same principle `generate-templates` was built for), (b) existing validated catalog POI coverage within each neighborhood, (c) rating/review-backed prominence of those POIs, and (d) aggregate pgvector similarity of the strongest contained POIs to the wizard interests. This is not semantic matching against a neighborhood's name: it reuses the same verified Activity embeddings that rank tour candidates. Normalize the local coverage/prominence signals across the resolved destination so one dense district does not win merely by absolute size. Alphabetical name/ID order is only a stable equal/no-evidence tie-break. Do not issue a detailed Overpass POI query for every raw neighborhood merely to score it.

A future `ActivityDiscoveryService` may add search-grounded iconic-neighborhood prominence only when `CoverageAnalyzer` reports that these local signals are insufficient. That provider output has no geographic authority: its `entityHints[role=area]` must resolve against the finite set of in-destination OSM neighborhood boundaries before affecting the shortlist, and unmatched/ambiguous hints are rejected. This fallback belongs to the Discovery implementation, not to destination-resolution/Overpass reliability.

For each shortlisted neighborhood: query its streets and POIs the same `map_to_area` way — `way["highway"]["name"](area.neighborhood)` and the equivalent `tourism`/`amenity`/`historic`/`leisure` node queries — scoped to the neighborhood's own real polygon instead of a radius guess around its centroid. This replaces `findStreetsNear`'s current `OVERPASS_MAX_RADIUS_METERS`-capped radius query for the area-scale path (point-scale destinations keep using the radius-based query — a real address has no polygon of its own to query against). Confirmed live in the spike: San Telmo's polygon alone yielded 178 real named streets and 50 real named POIs, no radius tuning needed. Wikidata enrichment and composite synthesis then proceed through `CompositeGenerationService`'s propose→verify→persist chain. Background activity generation now uses a compact selection-only schema; after anti-hallucination checks, flat picks are rehydrated from the exact catalog candidates before spatial ordering. The original live spike used the then-current full schema, but its identity and exact-area verification result remains applicable.

### 3. POI sourcing at area scale

`ActivitiesService.findAll` keeps its existing bounding-box + Haversine implementation (no rewrite needed) but is called with the resolved city boundary's own bbox rather than a radius derived from an autocomplete viewport — the OSM polygon is now the authoritative extent, not Geoapify/Google's arbitrary rectangle. Point-scale destinations are unaffected.

### 4. Crawl-refresh gate: quality-aware, not zero-vs-nonzero

Replace `nearbyActivities.length === 0` with `nearbyActivities.length < MIN_SUFFICIENT_ACTIVITIES` (proposed 15, matching the existing candidate slice size). Below that threshold, trigger the same `googlePlacesService.crawlAndSaveActivities` call that already exists today (same 5km cap, same synchronous await-then-re-query pattern), regardless of whether the existing count is zero or just thin. Applies to both point-scale and area-scale (per-neighborhood) sourcing.

### 5. Unified, interest-aware candidate ranking

Before truncating to the ~15-20 candidates sent to the LLM, compute one relevance score per candidate, source-agnostic (a POI and a composite are scored on the same scale, unlike today's rating-based leaderboard that structurally favors POIs):

- `interestSimilarity` (0-1): cosine similarity between an embedding of the user's `interests` (via the existing `AiEmbeddingService`, already indexed on every `Activity` write, including composites) and the candidate's own embedding. This is the primary term for every candidate type, POI or composite alike.
- `qualityBonus` (small, additive): for POIs, the existing normalized `weightedScore`; for composite variants, a flat curated-bonus when `isCurated: true`. Never a flat neutral prior masquerading as a real rating.
- `relevance = interestSimilarity + qualityBonus`, sorted descending, sliced to the existing candidate window.

If `interests` is empty, skip `interestSimilarity` and fall back to exactly today's `weightedScore` + distance sort — no behavior change for a request that didn't specify any. If a candidate has no indexed embedding, it falls back to `qualityBonus` alone (same graceful degradation already used for OSM/Wikidata failures elsewhere in this flow).

### Generation trace (bitácora)

`generation-trace-builder.util.ts` gains a step describing which destination-resolution branch was taken (point-scale vs. area-scale, and if area-scale, which neighborhoods were shortlisted and why) — extending the same per-step trace pattern the bitácora already uses, so this remains debuggable in-app exactly like every other stage today.

## Spike validation

Before writing an implementation plan, the core hypothesis — that a city-scale destination can be resolved to real neighborhoods and turned into a grounded, non-hallucinated composite walk, using only pieces that already exist — was tested with live API calls (Nominatim, Overpass, Groq with the exact `CREATE_TOUR_JSON_SYSTEM_PROMPT`/schema from `create-tour.prompt.ts`), independent of the app (`USE_MOCK_MAPS=true` in this environment, so the app itself wasn't exercised — these were direct calls replicating what the new code would do):

1. Nominatim resolved "Buenos Aires" to the correct city relation (`addresstype: city`, highest `importance`), correctly distinct from the Province of Buenos Aires and an unrelated Costa Rican county with the same name.
2. `map_to_area` + `admin_level`=city's own level + 1, scoped to that relation, returned all 48 real barrios of Buenos Aires, including San Telmo, La Boca, Recoleta, and Palermo — not a single arbitrary point's containing boundary.
3. The same `map_to_area` pattern, scoped to San Telmo's own polygon, returned 178 real named streets (including "Defensa", the neighborhood's famous main street) and 50 real named POIs (monuments, museums, galleries) — no radius tuning needed.
4. Feeding those real candidates into the production prompt/schema via a real Groq call produced a coherent `NEIGHBORHOOD_WALK` — "San Telmo Historic & Art Walk", themed HISTORY, 7 waypoints. Every waypoint id was cross-checked against the candidate set fed to the model: **all 7 were real, zero hallucinated** — the existing anti-hallucination contract held under this new sourcing path without any changes to the prompt or verification code.

This validates the design's feasibility end-to-end before committing to an implementation plan, and is the source of the three refinements folded into §1-2 above (Nominatim over raw Overpass name search, `map_to_area` over radius, relative over absolute `admin_level`). No code from this spike is kept — it was throwaway scripts run directly against public APIs, not part of the codebase.

## Explicitly out of scope

- Destinations larger than a city (a region, a country) — no evidence this is asked for today; YAGNI.
- Rewriting `HybridSearchService`'s dead 24h `crawler_search` freshness check — real bug, separate concern, not touched here.
- Formalizing a literal `ActivityEngine` class/module boundary — this design changes orchestration behavior inside the existing services (`TourActivityGenerationService`, `OsmPlacesService`, `CompositeGenerationService`); extracting a new named module is a pure refactor with no behavior change and can happen independently, if ever.
- Frontend changes beyond what already exists — the destination autocomplete flow (`places-autocomplete.ts`, `DestinationInput.tsx`) keeps resolving text to a lat/lng hint exactly as it does today; all the new logic here is backend-side.

## Testing

- Unit tests for destination resolution: Nominatim `addresstype: city`/`town` → area-scale, `AREA` activity persisted/reused; `state`/`country`/no result → point-scale; Nominatim or Overpass failure/timeout → falls back to point-scale, never throws.
- Unit tests for `findNeighborhoodsWithin`: parses a multi-relation Overpass response into `OsmCandidate[]`, filters by admin_level = city's own level + 1 (not a fixed range — reusing existing coverage patterns from `findContainingBoundary`'s tests).
- Unit tests for neighborhood shortlisting: prioritizes existing-`ActivityFamily` neighborhoods over cold ones given the same POI-density input.
- Unit tests for the crawl-refresh threshold: triggers below `MIN_SUFFICIENT_ACTIVITIES` even when count > 0; skips when at/above it.
- Unit tests for the unified relevance scorer: POI-vs-composite parity given matching interest similarity; empty `interests` reproduces today's exact sort; missing embedding degrades to `qualityBonus` only.
- Integration-style test reproducing the Barcelona scenario against a seeded thin DB: asserts the crawl gate fires and/or an area-scale neighborhood shortlist is produced instead of a flat 8-item point search.
