# Overpass `highway=corridor` POI tag-filter fix — live control spike

Validates the fix in commit (see below) that adds named indoor pedestrian
galleries/arcades (`highway=corridor`) to the shared POI tag whitelist used
by both `buildPoisQuery` and `buildPoisWithinAreaQuery`.

## Problem

Real, well-known landmarks like Buenos Aires' "Galería Güemes" (a 1915
historic shopping arcade, has its own Wikipedia article) are commonly tagged
in OSM *only* as `highway=corridor` + `indoor=yes` — no `tourism`/`historic`/
`amenity`/`leisure` tag at all. The shared POI query whitelist
(`overpass-query.util.ts`) never included this category, so such places
never entered the local OSM pool regardless of destination or hint name —
a structural blind spot, not a name-matching failure. Confirmed live: an
unfiltered name search against the real local Overpass instance found
"Galería Güemes" (way 586443476) with exactly these tags and nothing else.

## Fix

Added `nwr["highway"="corridor"]["name"]` to both query builders. Live-
verified scope: a 15km-radius scan around Buenos Aires turned up only 6
real named corridors total (Galería General Güemes, Galería Central, Galería
Colón, Galería, Calles internas schillig, Pasaje Roverano) — all genuine
named passages, not generic noise. Narrow, tag-category-level addition, not
name-specific.

TDD: `overpass-query.util.spec.ts` (2 new tests, one per query builder).

## Real, unmodified application path only

Same real HTTP path as prior Stage 3 spikes. Real local Nominatim/Overpass,
dedicated fresh DB (`zigzag_spike_overpass_corridor_control`, dropped after
the run), `PLACES_PROVIDER=geoapify`. Re-ran the `main` and `recoleta`
requests from `spikes/stage3-buenosaires-walks-component-survey-2026-09-24/`
against the fixed backend (which also already includes the previous
Nominatim geo-bias fix, since both live on the same branch).

## Result

Compared every candidate's `accepted`/`rejectionReasons` by normalized name
against the pre-both-fixes baseline (`cold`/`cold-recoleta`), for candidates
present in both runs (LLM discovery isn't deterministic, so unmatched names
are excluded, same methodology as the Nominatim spike).

| Request | Comparable candidates | Flipped to accepted | Regressed |
|---|---|---|---|
| main | 20 | 2 (`Guillermo Brown`, `José de San Martín`) | 0 |
| recoleta | 20 | 1 (`José de San Martín`) | 0 |

Both flips are attributable to the **Nominatim bias fix** (previous commit),
not this one — confirmed via `LOCAL_OSM_POOL`/`NOMINATIM` strategy in their
attempt traces. Zero regressions from the corridor addition.

**The corridor fix's own target case did not flip end-to-end**, and the
reason is itself a useful, precisely-measured finding: the destination
"Buenos Aires, Argentina" resolves to OSM relation `3082668` (Ciudad
Autónoma de Buenos Aires), confirmed by `poolCandidateCount: 2711` matching
exactly a direct `map_to_area` query against that relation. Live-querying
that exact relation directly:

- The corridor fix **does work**: `nwr["highway"="corridor"]["name"]` against
  relation 3082668 returns 5 real entities that were invisible before,
  including "Galería General Güemes" (way 240463124, `alt_name: "Pasaje
  Güemes"`, `wikipedia: es:Galería General Güemes`, `start_date:
  1915-12-15`).
- The specific way carrying the *exact* hint name, "Galería Güemes" (way
  586443476), is **not** returned by `map_to_area` against relation 3082668,
  even though it is unmistakably located in downtown Buenos Aires (Florida
  street) — confirmed absent by direct query. It *is* returned against the
  broader "Buenos Aires" relation `1632167`. This is a real geometric/
  topology gap in relation 3082668's mapped boundary, not a tag or
  name-matching problem — i.e., a live, concrete repro of the *second*
  root-cause mechanism from the original 74-case survey (`map_to_area`
  geometric edge case), independent of this fix.
- Separately, even where a corridor-tagged candidate *is* in the pool
  ("Galería General Güemes" / "Mirador Galería Güemes", two different real
  buildings both legitimately matching "Güemes" by token overlap), the
  fuzzy-match tie-break has no evidence to safely prefer one over the other,
  so `IdentityVerifier` correctly stays non-`VERIFIED` rather than guessing —
  correct fail-closed behavior, not a bug.

## Conclusion

The fix is real, generic, safe (zero regressions, narrow tag scope,
live-verified against real data) and closes the tag-filter-gap mechanism as
designed. It does not, by itself, resolve "Galería Güemes" in this specific
destination because that case is additionally blocked by the `map_to_area`
boundary gap — the next root-cause mechanism on the list, for which this
spike now has a concrete, real, reproducible example (relation 3082668
excluding way 586443476).
