# Stage 3 COMPOSITE positive control — San Telmo historical/cultural walk — Assessment

Human request: **"caminata histórica por San Telmo"** (see `request.json`, copied
verbatim from `spikes/rw1-san-telmo-historical-walk/request.json`).

Real, unmodified application path only:
`POST /auth/email/request-code` → `POST /auth/email/verify` →
`POST /tours/generate-tour` → outbox(`TourGenerationRequested`) →
`TourGenerationProcessorService` → `ExperienceGenerationService`. No
lower-level service invoked manually, no candidate/component hand-seeded.

Remote HEAD verified before touching anything: `fork/feat/preference-first-selection`
= `1181c67b6b66b73cfd36f81d804e952cdf268406`. The `.worktrees/ui-redesign` worktree
was already checked out exactly at that SHA and clean — no fetch/merge needed. Latest
commit on that HEAD: `test(tours): record stage 3 simple composite mixed spikes`,
on top of the Stage 3 "catalog-first identity resolution — first checkpoint"
entry (`docs/superpowers/plans/2026-09-22-component-resolution-and-partial-composite-recovery-plan.md`,
"CATALOG-FIRST WARM-REUSE READY FOR SPIKES").

Dedicated, freshly migrated database `zigzag_spike_stage3_santelmo_control`
(NOT the shared dev DB), confirmed empty (0 rows in all 7 knowledge tables) via
an 8/8-passing infrastructure preflight before COLD. See `campaign-manifest.json`.

## Result

```text
COLD:  completed, tour 35d69f67-64b4-4510-9874-c64ddb6fa97f, 163,319 ms
WARM:  completed, tour 932ae063-7ca4-4062-8f8b-845882ab4f6c,  30,239 ms
Strategy selected: AREA_ROUTE_WALK (anchor=San Telmo AREA, intent=walk) + GENERIC (theme=history)
COLD verdict: FAIL on the primary composite criterion (see below)
WARM verdict: PASS (faithfully reproduces COLD's — flawed — result with strong catalog reuse)
```

**The primary positive-control expectation — at least one Experience candidate
that satisfies `MULTI_COMPONENT_EXPERIENCE` (2+ real, source-backed components)
gets identity-resolved and persisted — was NOT met.** Both COLD and WARM
produced a tour of 5 independent, single-component (`componentCount: 1`) POI
Experiences. No composite (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`-kind, multi-
waypoint) Experience was ever created in either run.

This is **not a new regression** introduced by today's Stage 3 catalog-first
checkpoint. It reproduces, component-for-component, the exact same shape of
result already characterized in:

- the original RW1 canonical B5 rerun (2026-09-14, pre-Stage-2/3): "AreaRouteWalkAcquisitionService: invoked, outcome=no_result... verdict EXPECTED_B6_GAP";
- the RW1 forensic rerun one day before this checkpoint (2026-09-22, commit `774cf60`): all 3 COLD runs there also had the extractor propose 2 real multi-component candidates ("San Telmo Historical Walking Route", "San Telmo Step-by-Step Historical Walking Route", etc.) and all 3 still ended with exactly 5 selected Experiences, every one `componentCount: 1` (`forensic-rerun-2026-09-22/comparison-index.json`).

Today's plan document itself lists the specific unclosed gap under "Remaining
Stage 3 work": *"full bounded-continuation characterization for a catalog-miss
hint through the rest of the strategy ladder under Stage 3's new ordering...
now with CATALOG_REUSE as the new first attempt"* — i.e. this checkpoint
explicitly did not yet attempt to fix new-candidate component identity
resolution; it only proved catalog-first *reuse* of already-known GeoEntities.
This spike is a live, real-HTTP confirmation that the gap is exactly where the
plan says it is, and that Stage 3's catalog-first reordering did not disturb
anything upstream or downstream of it.

## First causal point of divergence

Traced forward from the top, every stage before component identity resolution
behaved correctly:

1. **`preference_interpretation`** — PASS. `preferredFacets`: `intent:walk`
   (evidence "caminata"), `theme:history` (evidence "histórica"), both
   confidence 1. `anchoredPlaces`: `[{rawName: "San Telmo", usage:
   geographic_scope, priority: soft}]`. Correct.

2. **`AreaRouteAnchorResolverService`** — PASS. "San Telmo" resolved to a real
   OSM AREA boundary: `osm:relation:2223069` (admin_level 9, wikidata
   `Q1026688`), persisted as `GeoEntity` `79effa94-ba26-4b63-b29a-c27314aaedeb`,
   `canonicalName: "San Telmo"`. Confirmed independently by the preflight's own
   live Nominatim/Overpass calls. Correct.

3. **`partitionDeficitsByStrategy`** — 1 deficit → `AREA_ROUTE_WALK`
   (`intent:walk`, paired with the resolved San Telmo anchor), 1 deficit →
   `GENERIC` (`theme:history`). Correct routing per the documented contract.

4. **`AREA_ROUTE_WALK` acquisition (`AreaRouteWalkAcquisitionService`)** —
   **this is where it first diverges.** Grounded search (SerpAPI — location
   param "San Telmo" rejected by SerpAPI, auto-retried without it) +
   extraction (groq/`qwen/qwen3.8-27b`) produced real evidence (18 evidence
   keys) and **2 structurally valid composite candidates**, each carrying ≥2
   distinct, source-backed `componentHints` (`candidateSatisfiesEvidenceRequirement`
   passed both — `resolvedCount: 2` in the trace, meaning both reached
   identity resolution). Backend log line: `ExperienceProposalResolverService
   Resolved 0/2 Experience candidate(s) against trusted geography` (05:12:54).
   `materialization.rejectionReasons`: `{"NO_OSM_MATCH": 1,
   "UNRESOLVED_REQUIRED_COMPONENT": 1}` — **one candidate lost a component to
   no OSM match at all, the other lost a required component that never
   resolved through the strategy ladder** (`CATALOG_REUSE` → miss, since the
   catalog was empty in COLD → `TRUSTED_OBSERVATION_REUSE` → "[P2-B] reuse
   none" for every one of the 8 component hints logged in this window
   ("San Telmo Food Market", "Mafalda Statue", "Casa Mínima", "San Telmo
   Market", "Paseo de la Historieta", "Lezama Park", "Iglesia de San Ignacio
   de Loyola", "Convento Santo Domingo") → further external strategies
   (`LOCAL_OSM_POOL`/`NOMINATIM`/`PLACES`) ran but are not logged at
   per-component granularity by production code today, only the aggregate
   `rejectionReasons` counts are). A bounded second `AREA_ROUTE_WALK`
   continuation attempt then ran (per the plan's "bounded acquisition
   continuation" invariant) but returned 0 new candidates entirely
   (`candidateCount: 0`) — genuinely nothing further to try, not a second
   rejection.

   Google Places' daily quota (`SearchTextRequest`, limit 20/day) was not yet
   exhausted at 05:12:54 (it exhausted later, at 05:13:26, inside the
   *separate* GENERIC/history pass) — so quota exhaustion is **not** the cause
   of this specific failure; it is a distinct, later, secondary anomaly (see
   manifest).

5. **`GENERIC` (theme:history) acquisition** — ran independently, in
   parallel/interleaved in the log with the above. Produced 26 structured
   candidates (mostly Google Places), 6 accepted after
   `CompositeGeographicValidationService` geographic validation (all
   `GEO_VERIFIED`, `strategy: venue_centric` — i.e. every accepted candidate
   was already a single-venue POI, never a multi-component proposal). This
   pass behaved exactly as designed for `SINGLE_PLACE` acquisition; it was
   never expected to produce a composite Experience for a `theme` deficit.

6. **`candidate_pool` / `daily_planning`** — correctly built a valid,
   deterministic 1-day itinerary from the only 6 Experiences that existed
   (all `SINGLE_PLACE`, all `componentCount: 1`): Museo Histórico Nacional,
   Plaza Dorrego, Feria De las Artes San Telmo, Mercado San Telmo, Museo
   Moderno selected (5/6, day-capacity-bound); Galeria Del Asombro left
   unselected. `tour_completeness`: WARN, `"Formato pedido sin cubrir: walk"` —
   correctly flags that the requested `walk` format was never satisfied. No
   corrective regeneration is expected on this path (PR 10 removed it) — this
   is documented, expected behavior for an unfilled format gap, not a bug.

**Conclusion: the causal divergence is entirely inside component identity
resolution for the two AREA_ROUTE_WALK-sourced composite candidates** — not
in preference interpretation, not in anchor resolution, not in deficit
routing, not in discovery/extraction (which genuinely proposed a real
composition), and not in the GENERIC/POI path (which worked exactly as
designed). This matches the plan document's own "Remaining Stage 3 work"
item verbatim and was already reproduced identically the day before this
checkpoint (forensic rerun, commit `774cf60`) — i.e. Stage 3's catalog-first
correction neither fixed nor broke it; it is simply not yet in scope.

## COLD

- Anchor: resolved (`osm:relation:2223069`, San Telmo AREA polygon).
- Strategy selected: `AREA_ROUTE_WALK` (walk) + `GENERIC` (history).
- AREA_ROUTE_WALK: 2 real composite candidates discovered (source-backed,
  evidenceCount 18, both structurally satisfying `MULTI_COMPONENT_EXPERIENCE`)
  → **0 accepted** (`NO_OSM_MATCH`×1, `UNRESOLVED_REQUIRED_COMPONENT`×1) →
  bounded retry → 0 new candidates → `no_result`.
- GENERIC: 26 structured candidates → 6 accepted, all `SINGLE_PLACE`,
  `venue_centric`, `GEO_VERIFIED`.
- Persistence: **6 new `Experience` rows, 6 `ExperienceComponent`, 6
  `ExperienceEvidence`, 10 `GeoEntity`, 10 `GeoEntityIdentity`, 9
  `TraitDefinition`/`ExperienceTrait`**. Zero `Experience` of any composite
  kind persisted. IDs: `cc0092c3…` Museo Histórico Nacional, `9c77dbbb…` Plaza
  Dorrego, `a539265a…` Feria De las Artes San Telmo, `4f8c6c4e…` Mercado San
  Telmo, `95638579…` Museo Moderno, `5f317b57…` Galeria Del Asombro
  (unselected into the final tour).
- Final tour: 5 experiences selected, all `componentCount: 1`.
- **COLD verdict: FAIL** on the composite criterion; PASS on every other
  mechanical criterion (tour materializes, real evidence, real identity
  resolution for the accepted POIs, no fabrication, valid deterministic
  daily plan).

## WARM

Same request, same DB, no reset.

- `db_search`: PASS, 6 Experiences reused directly from catalog.
- `coverage_analysis`: `GENERIC=0` — the `history` facet was already fully
  covered by the catalog, so **the GENERIC/google_places acquisition pass did
  not run at all** this time (0 structured candidates attempted, vs. 26 in
  COLD).
- `AREA_ROUTE_WALK`: re-attempted (correctly — no composite Experience exists
  yet to reuse), but this time both grounded-search passes returned 0
  candidates (0 evidence-backed proposals at all, not even a rejected one).
  Still `no_result`, for a different proximate reason than COLD (nothing
  extracted, vs. COLD's extract-then-reject), same ultimate outcome.
- External providers called in WARM: SerpAPI (1 call, `AREA_ROUTE_WALK` only)
  + Groq (extraction/interpretation). **Zero** Google Places calls, **zero**
  Wikidata calls, **zero** Overpass/Nominatim calls beyond what the anchor
  resolution needs. Providers attempted per trace: `["web", "wikivoyage"]`
  only (vs. COLD's `["google_places", "web", "wikivoyage"]`).
- Persistence: **0 new rows in all 7 knowledge tables** (identical counts to
  post-COLD). Final tour selected the **exact same 5 Experience IDs, same
  order** as COLD.
- Runtime: 30,239 ms vs. COLD's 163,319 ms (5.4× faster).
- **WARM verdict: PASS** — this is genuinely strong, correct catalog-first
  warm-reuse behavior for everything that Stage 3's checkpoint actually
  claims to have shipped (POI/GeoEntity reuse, zero re-acquisition, zero
  duplication, identity-stable selection). It faithfully reproduces COLD's
  incomplete composite result rather than masking or duplicating it.

## Providers used, COLD vs. WARM

| Provider | COLD | WARM |
|---|---|---|
| SerpAPI (grounded search) | 2 queries (both AREA_ROUTE_WALK attempts) | 1 query (AREA_ROUTE_WALK) |
| Groq (extraction + preference interpretation) | multiple calls, several rate-limited retries | multiple calls, 1 rate-limited retry |
| Google Places (searchText/details) | ~20+ calls (GENERIC pass), hit daily quota mid-run | **0 calls** |
| Wikidata | several proximity lookups, all timed out (best-effort) | 0 |
| Overpass/Nominatim | anchor boundary resolution only | anchor boundary resolution only (same anchor, likely cached at the OSM container level, not application level) |

## Secondary anomalies (not blockers, kept separate from the causal finding)

See `campaign-manifest.json` → `secondaryAnomaliesObserved`:

1. SerpAPI rejects the literal location string "San Telmo" on every call in
   both runs, auto-retrying without it. Degrades grounding precision; not
   fatal.
2. Google Places `SearchTextRequest` daily quota (20/day) was exhausted
   mid-COLD-run, after the composite failure was already determined. Confound
   for WARM's "0 Places calls" figure (partly quota, partly genuine
   `GENERIC=0` routing) — the trace's own `GENERIC=0` figure is the reliable
   signal, not the raw call count.
3. Wikidata proximity lookups timed out repeatedly (10s) throughout COLD;
   best-effort by design, did not block generation.
4. Groq rate-limited several calls in both runs; self-healed via existing
   retry/backoff.

## Artifacts

- `spikes/stage3-santelmo-composite-control-2026-09-23/request.json`
- `spikes/stage3-santelmo-composite-control-2026-09-23/campaign-manifest.json`
- `spikes/stage3-santelmo-composite-control-2026-09-23/cold/` — `create-response.json`, `terminal-tour.json`, `generation-trace.json`, `run-manifest.json`, `steps/*.json` (trace split per stage)
- `spikes/stage3-santelmo-composite-control-2026-09-23/warm/` — same shape
- `spikes/stage3-santelmo-composite-control-2026-09-23/backend-combined.log` — full backend process log, both runs, redacted of nothing sensitive (dev-mode devCode flow only)

## Recommendation

Do not fix anything in this session per the spike's own ground rules (positive
control, no speculative fixes, no Stage 4, no identity relaxation). The
finding to carry into planning: Stage 3's "Remaining Stage 3 work" item —
*full bounded-continuation characterization for a catalog-miss hint through
the rest of the strategy ladder* — is the correct, already-identified next
piece of work to close this gap; today's checkpoint did not regress it and
should not be blocked by it, but the gap is real and reproducible on demand
with this exact fixture whenever that work is picked up.
