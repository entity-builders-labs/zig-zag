# RW3 — Caminito canonical geographic ROUTE: assessment

Branch `feat/preference-first-selection`. Starting HEAD `70868e6a`
(`docs(presentation): add Zig-Zag business strategy deck`), equal to the fork
remote before any change. **No production code changed.**

Evidence: `cold/` (`generation-trace.json`, `terminal-tour.json`,
`create-response.json`, `run-manifest.json`, `db-before.json`,
`db-after.json`, `provider-requests.ndjson`, `provider-config.txt`,
`backend.log`, `run.log`, `migrate.log`), plus `cold/analysis.json`
(trace-first summary), `cold/anchor-resolution-repro.json` and
`cold/caminito-route-geometry.json`.

## Verdict: **FAIL**

RW3's primary question — does route membership use real route geometry? —
could not be exercised: the product **discards the real Caminito route it
finds**, deterministically, before any acquisition. The discovery /
composition / anti-fabrication half is **INCONCLUSIVE** because the pinned
grounded-search provider (SerpAPI) had exhausted its monthly quota. Two
Bitácora defects hide both root causes from the trace.

| RW3 truth condition | Result |
| --- | --- |
| real Caminito representation obtained | **FAIL** — exists in OSM and found by the route branch, then discarded |
| real route geometry used | **FAIL** — never reached validation |
| source-backed Experience composition | INCONCLUSIVE — 0 evidence (SerpAPI 429) |
| real component resolution | not reached |
| route geometry participates in membership | not reached |
| regional coherence preserved | not reached |
| no proximity fabrication | vacuously held (nothing composed or persisted) |
| trace explains decisions | **FAIL** — gaps T1, T2 |

## 0. Run

| | |
| --- | --- |
| tour | `3ebf172f-ef0f-46d8-91b7-4d75744cb031` |
| status | `failed` after **6 s** (`coverage_analysis` FAIL) |
| failure | `Coverage insuficiente … Preference facet [intent:walk] has no strong catalog match yet.` |
| COLD precondition | `db-before.json`: 0 geo_entity / identity / experience / component rows |
| DB after | still 0 rows of every knowledge table |
| outbound requests | nominatim.local ×3, overpass.local ×2, groq ×1, serpapi ×1, es.wikivoyage ×1, es.wikipedia ×1; **0 cloudflare, 0 geoapify** |
| mobility control | 50000 / 20000 m, intentionally non-binding; **never reached planning** |

The outbox re-delivered `TourGenerationRequested` once after the failure;
the processor logged `already failed terminally; duplicate delivery is a
no-op` (no second generation, no extra provider calls).

## 1. Preference interpretation — PASS (from trace)

Groq `qwen/qwen3.8-27b`. Wizard `intent:walk` preserved (spec facet
`intent:walk`, source `wizard`, weight 1); free text also yields
`intent:walk` (confidence 0.95, evidence "recorrer Caminito caminando").

| rawName | usage | priority |
| --- | --- | --- |
| Caminito | `named_path` | `must` |

`semanticQuery = "walking tour of the Caminito neighborhood focusing on
representative landmarks"` — a small interpretation drift: Caminito is a
pedestrian street/passage in La Boca, not a neighborhood. Recorded, not
corrected (prompt out of scope).

## 2. Anchor resolution — FAIL (root cause established)

**Trace:** `anchor_geo_resolution` (`AreaRouteAnchorResolverService`, WARM):
`{status: unresolved, unresolvedReason: NO_CONFIDENT_GEO_ENTITY_MATCH}` —
nothing else. The trace cannot say what was found, by which branch, or why it
was not confident (→ gap **T1**).

**Reality in OSM (local Overpass, La Boca):**
`way 144844726` — `highway=pedestrian`, `name=Caminito`,
`tourism=attraction`, `wikidata=Q1029566`, `wikipedia=es:Caminito`; plus an
`attraction` node `10303343309` and an unrelated shop node. OSM therefore does
represent Caminito as a named way — the expected canonical ROUTE shape exists.

**Root cause** (after the trace gap was established; read-only repro running
the compiled production resolver branches against the same local providers
and the same destination scope, `repro-anchor-resolution.cjs`):

`resolveNamedAnchors` runs three discoveries in parallel and accepts only if
every matching branch agrees on one `kind:normalizedName` identity
(`selectCandidate`).

| branch | outcome |
| --- | --- |
| `discoverRoute` (targeted OSM, destination-scoped) | **match** `route` Caminito, `openstreetmap` `osm:way:144844726`, `MultiLineString`, `SINGLE_COMPATIBLE_CLUSTER`, `WITHIN_DESTINATION_BOUNDARY` |
| `discoverArea` (Nominatim → boundary) | `no_match` `NO_CONFIDENT_AREA_MATCH` |
| `discoverPlace` (Nominatim, then Places) | **match** `venue` Caminito, `nominatim` `osm:way:269972048` — a residential street in **La Unión, Partido de Ezeiza**, ~32 km from the real Caminito, **outside** the CABA destination boundary |
| `selectCandidate` | `undefined` — two identities (`route:caminito`, `venue:caminito`) → `NO_CONFIDENT_GEO_ENTITY_MATCH` |

Contributing facts:

1. `NominatimApiService` uses `RESULT_LIMIT = 5` and the anchor search passes
   only `countryCode=AR` (no destination viewbox/bias). "Caminito" is a common
   street name; all 5 results are other Argentine streets (Ezeiza, La Rioja
   ×2, Merlo, Neuquén). The La Boca way is not among them (it appears only in
   a wider result set).
2. `discoverPlace` calls `bestNominatimMatch(rawName, results)` **without**
   `destinationPoint` and applies **no destination-compatibility check**
   (unlike `discoverArea` and `discoverRoute`), and short-circuits before
   Places, so a nationwide same-name street becomes a `venue` candidate.
3. `selectCandidate` treats that out-of-destination false positive as a
   genuine cross-kind ambiguity and discards the correct, destination-scoped
   route match too.

Owner / root-cause candidate: `AreaRouteAnchorResolverService.discoverPlace`
(destination scoping of the venue branch) and the `selectCandidate`
cross-kind rule that lets an unscoped branch veto a scoped one. This is
general (any common street/place name), not Caminito-specific. Whether the
route candidate would then pass `IdentityVerifier` is **unknown** — never
reached. **Not fixed here** (characterization only).

## 3. Actual geometry (not used by the run)

From `discoverRoute` (production code, read-only) — `cold/caminito-route-geometry.json`:

| | |
| --- | --- |
| OSM | `way:144844726` |
| geometry type | `MultiLineString` (1 line) |
| coordinate count | 9 |
| bounds (lon/lat) | `[-58.3632988, -34.639397, -58.3617988, -34.6391307]` |
| length | ~143 m (haversine, computed in the spike; not a product fact) |

Route-like geometry is available; it simply never reached the pipeline.

## 4. Acquisition routing (from trace)

- Deficit: `intent:walk` (`preference_facet`, "no strong catalog match yet").
- `partitionDeficitsByStrategy`: `AREA_ROUTE_WALK=1; GENERIC=0` — exactly one
  relevant anchor (unresolved `named_path`), so the walk deficit routes to
  AREA_ROUTE_WALK in **tourism_route** mode (anchorMode itself is not traced;
  inferable only from `anchor.status` → minor gap **T3**).
- SourcePlan: `wikivoyage` (`DO` section) + `web`.
- `web.query = "Buenos Aires walking tours walks walking tour of the Caminito
  neighborhood focusing on representative landmarks"`.
- `SourcePlan.web.anchorNames`: **absent**. The planner forwards only
  *resolved* `area`/`route` anchor names; an unresolved `named_path` is
  excluded by design, so Caminito reaches the query only via `semanticQuery`.
  The typed anchor does **not** disappear from the trace (it is carried in
  `acquisitionContext.anchor` on both passes) — this is not a regression of
  the RW2 Finding-1 fix (which concerned GENERIC + resolved anchors), but it
  means tourism_route mode never has a typed anchor name in the web plan.
- Pass 2: same plan, skipped as `DUPLICATE_SOURCE_PLAN_EXECUTION` (traced).

## 5. Evidence — INCONCLUSIVE (provider quota)

- SerpAPI `google_ai_mode` returned **HTTP 429 "Your account has run out of
  searches."** (`backend.log`); the account endpoint afterwards reported the
  Free Plan at 250/250 used, `total_searches_left = 0`.
- Evidence count 0 → the Cloudflare extractor was never called; Wikivoyage
  `DO` gave 0 observations.
- **Trace:** web result `status: success`, `groundingStatus: failed`, **no
  `failureReason`**; `executionSummary.acquisition.providersFailed = []`;
  rule `ACQ-ISOLATION-001` PASS "Todas las fuentes atendidas respondieron".
  The provider adapter does return `failureReason`, but
  `ExperienceAcquisitionService.executeWebSourcePlan` builds its `base`
  result with a fixed `status: 'success'` and without `grounded.failureReason`
  (→ gap **T2**). A quota outage is indistinguishable from "the web had
  nothing" in the Bitácora.

Sections 6–10 of the RW3 brief (extracted Experience, component resolution,
ROUTE membership, regional coherence, anti-fabrication) were **not reached**:
no evidence, no candidate, no components, no geographic validation, no
persistence, no composition, no planning. Nothing was fabricated; the
anti-fabrication invariant holds only vacuously.

## 6. Bitácora reconstruction

Could the run be reconstructed from the trace alone? **Partially.**
Interpretation, routing, pass structure, pass-2 dedupe skip and the final
coverage failure are fully explained. The two decisions that actually
determined the outcome are **not**:

- **T1** `anchor_geo_resolution` has no per-branch discovery facts
  (area/route/place candidates, provider + external ids, geometry type,
  destination-compatibility verdicts, and the cross-kind `selectCandidate`
  decision). Without code archaeology the reader cannot learn that the real
  route was found and vetoed by an out-of-destination venue.
- **T2** grounded-search provider failure is masked as success (above).
- **T3** (minor) routing output omits `anchorMode`.
- **T4** (minor) `destination_resolution` outputs only `boundaryName`, not the
  boundary identity (`osm:relation:1224652`, obtained from the repro).

## 7. COLD acceptance answers

| question | answer |
| --- | --- |
| Caminito became an interpreted anchor? | yes — `named_path` / `must` |
| canonical geographic object? | **none** (unresolved); OSM truth is `way:144844726` |
| real route geometry obtained? | by the route branch, yes (MultiLineString); by the product, **no** |
| exact OSM type/id/geometry used? | none used |
| evidence for a real Caminito walking Experience? | unknown — 0 evidence (SerpAPI 429) |
| source-supported components? | none (no evidence) |
| each component resolved? | n/a |
| route membership based on route geometry? | not exercised |
| regional coherence ran? | not exercised |
| composite persisted? | no |
| classified walk/route-like? | n/a |
| entered composition/planning? | no |
| mobility non-blocking as intended? | not reached (failed before planning) |
| final output used the Experience? | no — tour `failed` |

## 8. WARM

Not run: the COLD run persisted no Experience (the brief's precondition for
WARM).

## 9. Tour quality

No tour was produced; nothing to characterize.

## 10. Findings (recorded, not fixed)

| id | finding | owner / root-cause candidate | severity |
| --- | --- | --- | --- |
| RW3-F1 | named-anchor resolution discards the correct destination-scoped ROUTE because an unscoped Nominatim venue branch returns a same-name street outside the destination | `AreaRouteAnchorResolverService.discoverPlace` + `selectCandidate` | **blocker for RW3** |
| RW3-F2 (T2) | grounded-search provider failure (incl. 429 quota) traced as `status: success`, `providersFailed: []`, isolation rule PASS | `ExperienceAcquisitionService.executeWebSourcePlan` base result | high (Bitácora) |
| RW3-F3 (T1) | `anchor_geo_resolution` trace lacks per-branch discovery facts and the selection decision | anchor resolution trace builder | high (Bitácora) |
| RW3-F4 | tourism_route mode never carries a typed `anchorNames` in `SourcePlan.web` (planner forwards only resolved area/route) | `ExperienceAcquisitionPlannerService` | observation |
| RW3-F5 (T3/T4) | routing omits `anchorMode`; destination step omits boundary id | trace builders | minor |
| RW3-OPS | SerpAPI Free Plan exhausted (0/250); pinned grounded provider unusable until quota resets or plan changes | operations | blocks any live rerun |

## 11. Next

RW3 is **not DONE**; do not advance to RW4. A meaningful RW3 rerun needs
RW3-F1 fixed (and ideally RW3-F2/F3 so the rerun is auditable) plus a working
grounded-search quota. Re-run the same request unchanged after that.
