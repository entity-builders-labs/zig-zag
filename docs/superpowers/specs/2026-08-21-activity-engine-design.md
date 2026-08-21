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

Point+radius should become an implementation detail used *within* a real sub-area (e.g., a 2km walkable radius around a neighborhood's own centroid to call Google Places or Overpass for that neighborhood) — never the definition of "what is Barcelona" at the top level. Composite activities (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`/`VariantTheme`) already model exactly the kind of multi-stop, themed experience a real trip should be full of; Google Places has no equivalent concept and never will (it only returns points). The gap today is entirely in orchestration, not in the underlying source integrations (`GooglePlacesService`, `OsmPlacesService`, Wikidata enrichment, `CompositeGenerationService`, the `generate-templates` CLI) — those already exist and are reused as-is by this design.

## Design

### 1. Destination resolution: point-scale vs. area-scale

New step at the start of `generateTourActivities`, before any candidate search: given the tour's destination coordinates (still supplied by the existing FE autocomplete flow as a lat/lng hint — Geoapify/Google remain the "what did the user mean by this text" lookup), attempt to resolve a real OSM administrative boundary via Overpass, reusing the existing `["boundary"="administrative"]` query pattern (`OsmPlacesService.findBoundaryByName`-style, or a name-optional variant keyed off the resolved place's name when the frontend has it, falling back to `findContainingBoundary` semantics when it doesn't).

- **Resolved to a city/region-level boundary** (`admin_level` typically 4-8, above the neighborhood range already reserved for `NEIGHBORHOOD_ADMIN_LEVEL_RANGE`): **area-scale**. Persist/reuse it as an `Activity.kind=AREA` row (the model already supports this — `boundary` field, existing `AREA` kind) and proceed to §2.
- **No administrative boundary found** (a street address, a named POI, an ambiguous or very small place): **point-scale**. Fall back to exactly today's point+radius flow, unchanged. This keeps the existing behavior for "search near my hotel"-style destinations, which it already serves correctly.

Degradation: if Overpass is unavailable or times out, treat as point-scale (same defensive fallback pattern `OsmPlacesService` already uses everywhere — never block or fail generation on this).

### 2. Area-scale exploration: real neighborhoods, not one lucky point

New `OsmPlacesService` method, e.g. `findNeighborhoodsWithin(boundary: OsmCandidate): Promise<OsmCandidate[]>`, using Overpass's `map_to_area` pattern to query real `admin_level` 8-11 sub-boundaries contained within the resolved city polygon (a true polygon-containment query, not a radius guess):

```
[out:json][timeout:25];
relation(<city_relation_id>);
map_to_area->.city;
(
  relation["boundary"="administrative"]["admin_level"~"^(8|9|10|11)$"](area.city);
  way["boundary"="administrative"]["admin_level"~"^(8|9|10|11)$"](area.city);
);
out geom;
```

A city can return dozens of these — not all are explored. Prioritize a bounded shortlist (K≈6-8, tunable) by, in order: (a) neighborhoods that already have a curated `ActivityFamily` in the DB (near-zero marginal cost, reuses trusted content — same principle `generate-templates` was built for), (b) existing POI density/quality within each neighborhood from a cheap DB query (a proxy for "this is a real, interesting area" without an extra external call). No interest-text matching against neighborhood names in this pass — YAGNI; interest matching happens once at candidate-ranking time (§4), uniformly, rather than duplicated here.

For each shortlisted neighborhood: reuse the existing per-area pipeline as-is — `findStreetsNear(neighborhood centroid, capped radius)`, Wikidata enrichment, and either surface its existing `ActivityFamily` variants directly (cheap, preferred) or synthesize new composite proposals via `CompositeGenerationService`'s existing propose→verify→persist chain (same code path `generate-templates` and today's single-point live flow both already use). No new LLM prompting logic — the same `createTourChain()`/verification/anti-hallucination guarantees apply unchanged.

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

## Explicitly out of scope

- Destinations larger than a city (a region, a country) — no evidence this is asked for today; YAGNI.
- Rewriting `HybridSearchService`'s dead 24h `crawler_search` freshness check — real bug, separate concern, not touched here.
- Formalizing a literal `ActivityEngine` class/module boundary — this design changes orchestration behavior inside the existing services (`TourActivityGenerationService`, `OsmPlacesService`, `CompositeGenerationService`); extracting a new named module is a pure refactor with no behavior change and can happen independently, if ever.
- Frontend changes beyond what already exists — the destination autocomplete flow (`places-autocomplete.ts`, `DestinationInput.tsx`) keeps resolving text to a lat/lng hint exactly as it does today; all the new logic here is backend-side.

## Testing

- Unit tests for destination resolution: area-scale boundary found → `AREA` activity persisted/reused; no boundary found → falls back to point-scale unchanged; Overpass failure/timeout → falls back to point-scale, never throws.
- Unit tests for `findNeighborhoodsWithin`: parses a multi-relation Overpass response into `OsmCandidate[]`, filters by admin_level range (reusing existing coverage patterns from `findContainingBoundary`'s tests).
- Unit tests for neighborhood shortlisting: prioritizes existing-`ActivityFamily` neighborhoods over cold ones given the same POI-density input.
- Unit tests for the crawl-refresh threshold: triggers below `MIN_SUFFICIENT_ACTIVITIES` even when count > 0; skips when at/above it.
- Unit tests for the unified relevance scorer: POI-vs-composite parity given matching interest similarity; empty `interests` reproduces today's exact sort; missing embedding degrades to `qualityBonus` only.
- Integration-style test reproducing the Barcelona scenario against a seeded thin DB: asserts the crawl gate fires and/or an area-scale neighborhood shortlist is produced instead of a flat 8-item point search.
