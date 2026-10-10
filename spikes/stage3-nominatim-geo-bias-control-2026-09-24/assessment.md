# Nominatim soft geographic-bias fix — live control spike

Validates the fix in commit (see below) that adds a soft `viewbox` proximity
bias to `NominatimApiService.search()`, mirroring `resolveViaPlaces`' existing
`PLACES_FALLBACK_BIAS_RADIUS_METERS` pattern.

## Problem

`NominatimApiService.search()` only restricted results by `countrycodes`. It
had no proximity bias to the request's destination, unlike `resolveViaPlaces`
(50km bias already in place). `bestNominatimMatch()` re-ranks by proximity
among whatever Nominatim already returned, but Nominatim only returns the
top 5 results ranked by global `importance` within the country — a real match
of low `importance` can be pushed entirely out of that window by a same/
similar-named, more "important" place elsewhere in a large country (e.g.
Argentina), before any client-side re-ranking ever gets a chance to run.

## Fix

Added `NominatimSearchOptions.bias` (`{ latitude, longitude }`).
`NominatimApiService.search()` sends it as a soft `viewbox` param (no
`bounded=1`, so a real match outside the box is deprioritized, never
hard-excluded) — same 50km radius constant family as Places'. Wired at the
resolver's one Nominatim call site (`resolveViaNominatim`), reusing the same
`destinationPoint` it already threads into `bestNominatimMatch`.

TDD: `nominatim-api.service.spec.ts`, `cached-nominatim-api.service.spec.ts`
(cache key folds in the bias point), `experience-proposal-resolver.service.spec.ts`.

## Real, unmodified application path only

Same real HTTP path as every prior Stage 3 spike:
`POST /auth/email/request-code` → `POST /auth/email/verify` →
`POST /tours/generate-tour` → outbox(`TourGenerationRequested`) →
`TourGenerationProcessorService` → `ExperienceGenerationService`. Real local
Nominatim (`zigzag-nominatim-argentina`, port 8088) and Overpass
(`zigzag-overpass-argentina`, port 12345) instances, real SerpAPI-grounded
discovery, dedicated fresh DB (`zigzag_spike_ba_walks_nominatim_bias`,
dropped after the run), `PLACES_PROVIDER=geoapify`.

Baseline: the 4 pre-fix runs already captured in
`spikes/stage3-buenosaires-walks-component-survey-2026-09-24/` (`cold`,
`cold-laboca`, `cold-recoleta`, `cold-multi-anchor`), same 4 request bodies,
same real backends, run the day before this fix existed.

## Method

Compared each pair's `entityResolutionAudit` (per-hint, per-strategy
attempts) by normalized hint name, isolating attempts whose `strategy` is
`NOMINATIM`. A hint counts as **flipped** only if its NOMINATIM attempt was
non-`VERIFIED` at baseline and `VERIFIED` after the fix. Live grounded
discovery is not deterministic between runs — hints that appear in only one
of the two runs for a request are reported separately and excluded from the
flip/regression counts, since they aren't a like-for-like comparison.
Script: kept out of the repo (throwaway), logic and full output below.

## Result

| Request | Baseline NOMINATIM hints | New-run NOMINATIM hints | Flipped to VERIFIED | Regressed |
|---|---|---|---|---|
| main (San Telmo) | 9 | 10 | 1 | 0 |
| laboca | 2 | 6 | 1 | 0 |
| recoleta | 3 | 10 | 1 | 0 |
| multi-anchor | 3 | 2 | 1 | 0 |
| **Total** | | | **4** | **0** |

All 4 flips are the **same real-world component**: a candidate named
**"José de San Martín"** (a monument/statue), independently proposed by
grounded discovery in every one of the 4 requests. In every baseline run it
was rejected as a whole candidate (`accepted: false`,
`rejectionReasons: ["NO_OSM_MATCH"]`) because Nominatim's plain
country-scoped search let a same/similar-named result elsewhere in Argentina
(San Martín is one of the most common Argentine street/monument/place names)
win the top-5 window on global `importance`, so the real Buenos Aires
candidate was never even seen by `bestNominatimMatch`'s re-ranking. With the
bias fix, all 4 runs verify it via `NOMINATIM` and accept the candidate
(`accepted: true`).

Zero regressions: no hint that was previously `VERIFIED` via Nominatim
became non-`VERIFIED` in any of the 4 runs.

No other NOMINATIM-strategy hint changed outcome. This fix closes one real,
reproducible failure mode (countrywide name-collision starving the
Nominatim result window) out of the 3 root-cause mechanisms identified in
the original 74-unresolved-case survey; it does not claim to close the
other two (Overpass POI tag-filter gap, `map_to_area` geometric edge case).
