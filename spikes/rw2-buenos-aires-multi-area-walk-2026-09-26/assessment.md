# RW2 — Buenos Aires multi-area walk (San Telmo + La Boca): assessment

> **Post-hoc correction (2026-09-26).** The original §9/§11 wording below
> described Finding 2 as "the planner materialized singletons and did not
> surface the composite". The canonical bitácora proves the composite
> **did** reach `GreedyDailyPlanningSolver` and was **rejected by explicit
> mobility constraints** (`MAX_WALKING_PER_DAY_EXCEEDED` +
> `MAX_CONTINUOUS_WALKING_EXCEEDED`); `TourCompletenessValidator` then emitted
> `UNMET_REQUESTED_FORMAT(walk)`. The corrected finding is recorded in §9/§11
> and in the main Progress doc. It was not "ranking lost the composite" nor
> "the planner ignored the composite".

Branch `feat/preference-first-selection`. Starting HEAD `7c5ed36c`
(`chore(spikes): characterize cloudflare extractor case-b x5`), verified equal
to the fork remote before any change. No production code changed.

- COLD: `spikes/rw2-buenos-aires-multi-area-walk-2026-09-26/cold/`
- WARM: `spikes/rw2-buenos-aires-multi-area-walk-2026-09-26/warm/`
- Raw evidence per run: `generation-trace.json`, `terminal-tour.json`,
  `create-response.json`, `run-manifest.json`, `db-before.json`,
  `db-after.json`, `provider-requests.ndjson`, `provider-config.txt`,
  `backend.log`, `run.log`, `migrate.log`. Derived summary: `analysis.json`.

## 0. Product request (real, not faked)

```json
{
  "destination": { "label": "Buenos Aires, Argentina",
                   "latitude": -34.6037, "longitude": -58.3816,
                   "scaleHint": "settlement" },
  "days": 1, "budgetLevel": "medium", "groupType": "solo",
  "intent": {
    "interests": ["history", "architecture"],
    "intents": ["walk"],
    "explorationStyle": "balanced",
    "additionalPreferences":
      "Me interesan San Telmo y La Boca, especialmente su historia, arquitectura y lugares emblemáticos."
  },
  "mobility": { "allowedTransportationModes": ["walking"],
                "maxWalkingDistancePerDayMeters": 5000,
                "maxContinuousWalkingDistanceMeters": 3000,
                "travelPace": "moderate" },
  "skipImageGeneration": true
}
```

`destination = Buenos Aires` (hard scope); San Telmo and La Boca come only
from free text. No `PreferenceSpec`, no `ResolvedAnchor`, no anchor injection
was done by hand — the live `PreferenceInterpreterService` and the whole
pipeline ran unmodified.

Providers pinned: `GROUNDED_SEARCH_PROVIDER=serpapi`,
`DISCOVERY_EXTRACTOR_PROVIDER=cloudflare` (`@cf/qwen/qwen3.8-27b`,
temperature 0, 900 completion tokens, `enable_thinking=false`, 60s timeout),
`PLACES_PROVIDER=geoapify`, `CLASSIFICATION_PROVIDER=groq`
(`qwen/qwen3.8-27b`), local Overpass (`:12345`, snapshot
`2026-09-25T20:21:25Z`), local Nominatim (`:8088`, snapshot
`2026-09-12T20:15:47Z`), dedicated disposable Postgres/PostGIS DB
`zigzag_spike_rw2` (COLD: dropped/created/migrated fresh, `db-before.json`
proves zero knowledge rows). `AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`.

## 1. Preference interpretation (COLD)

Model `qwen/qwen3.8-27b` (Groq). Wizard intent `walk` present.

Free text produced **both** anchors:

| rawName | usage | priority |
| --- | --- | --- |
| San Telmo | `geographic_scope` | `soft` |
| La Boca | `geographic_scope` | `soft` |

Free text also produced facets `theme:history` and `theme:architecture`
(confidence 0.9, importance 0.7), and
`positiveSemanticQuery = "history architecture landmarks in San Telmo La Boca"`.

Interpretation nuance (recorded, not corrected): both anchors are emitted as
`geographic_scope` / `soft` — **not** `named_path` and **not** `must`. So the
interpreter treats them as "areas to explore", not as a mandatory path.

## 2. Anchor resolution (COLD)

| rawName | status | kind | canonicalName | provider | externalId |
| --- | --- | --- | --- | --- | --- |
| San Telmo | resolved | area | San Telmo | openstreetmap | `osm:relation:2223069` |
| La Boca | resolved | area | La Boca | openstreetmap | `osm:relation:2223879` |

Both resolved to canonical OSM administrative boundaries (admin_level 9,
Wikidata `Q1026688` / `Q690649`) and are destination-compatible with Buenos
Aires.

## 3. Strategy routing (COLD)

`intent:walk` was a real `preference_facet` deficit on the cold catalog
("no strong catalog match yet"). `partitionDeficitsByStrategy` emitted:

```text
AREA_ROUTE_WALK=0; GENERIC=3   (history, architecture, walk)
```

Why GENERIC, from the exact canonical inputs: `selectAcquisitionStrategy`
filters anchors to resolved `area`/`route` or unresolved `named_path`; with
**two** resolved area anchors (San Telmo + La Boca) `relevantAnchors.length
=== 2 !== 1`, so the walk deficit falls through to `GENERIC`. This is the
documented single-anchor precondition, reproduced live.

## 4. Anchor propagation through GENERIC (the RW2 truth condition)

- Both anchors remain visible in the trace (`anchor_geo_resolution` step,
  `resolvedAnchors` carries both).
- **Not** propagated as structured anchors: the generic
  `buildAcquisitionPlan({ destination, deficits: generic, semanticQuery,
  breadth })` call in `experience-generation.service.ts` does **not** pass
  `anchors: resolvedAnchors`, so `SourcePlan.web.anchorNames` is absent.
- Both names are nonetheless visible in the generated web query — **only
  because** they are embedded in the free-text-derived `semanticQuery`
  (`"history architecture landmarks in San Telmo La Boca"`):

```text
query = "Buenos Aires architecture historic landmarks historic sites history
         walking tours walks history architecture landmarks in San Telmo La Boca"
```

- Generated search query / grounded-search request: both names present
  (via `semanticQuery`, not via `anchorNames`).
- Exact loss boundary: `experience-generation.service.ts` — the generic
  `buildAcquisitionPlan` call (the `GENERIC` branch of the acquisition loop)
  omits `anchors`. The structured anchor objects are dropped there; only the
  string-level `semanticQuery` carries the names. A later planner-capacity
  path (`global_capacity` backfill) **does** pass `anchors: resolvedAnchors`,
  but that path did not run for this request (no planner-capacity acquisition).

**Finding (routing/orchestration, not fixed):** two anchors correctly exist in
`PreferenceSpec`, but the `GENERIC` acquisition planner drops the structured
anchor objects; the names survive only incidentally inside the semantic query
string. Owner candidate: the generic `buildAcquisitionPlan` call site in
`experience-generation.service.ts` (and/or the planner's optional `anchors`
input not being threaded from the generic branch).

## 5. Web evidence depth (COLD)

SerpAPI Google AI-mode delivered 20 grounded evidence items (`ev-1`..`ev-20`).
Presence of notable stops **in the delivered evidence**:

- Present: San Telmo, La Boca (ev-1/2/13/14/18/20), Plaza de Mayo (ev-13),
  Calle Defensa/Defensa (ev-5/6/13/20), Plaza Dorrego (ev-4/13/20),
  Mercado de San Telmo (ev-5/13), Caminito (ev-9/20), El Zanjón (ev-7),
  La Bombonera/Boca Juniors (ev-10), conventillos (ev-11), old port (ev-12).
- Absent upstream (never appeared in evidence, so not an extractor failure):
  **Mafalda / Estatua de Mafalda**, **Parque Lezama / Lezama**.

The strongest walk evidence is the Google AI-mode synthesis
`ev-13` ("Self-Guided Route: Begin at the edge of San Telmo near Plaza de
Mayo, walk down Calle Defensa … into Plaza Dorrego, … Mercado de San Telmo,
and then continue southeast toward La Boca via Avenida Almirante Brown"),
corroborated by `ev-14`, `ev-18` (pelago.com) and `ev-20` (agoda.com) — all
describing the same published "Private La Boca and San Telmo History Walk".

## 6. Extractor output (COLD)

Cloudflare (`@cf/qwen/qwen3.8-27b`) produced exactly one web candidate:

- name: `San Telmo to La Boca History Walk`
- themes `[history, architecture]`, intents `[walk]`, `orderedByEvidence: true`,
  suggestedDuration 180 min, evidenceKeys `[ev-13]`.
- 7 component hints (all `SUPPORTED`, each cited to `ev-13`):
  1. Plaza de Mayo (waypoint) → 2. Calle Defensa (route) → 3. Plaza Dorrego
  (waypoint) → 4. Mercado de San Telmo (venue) → 5. Avenida Almirante Brown
  (route) → 6. Caminito (waypoint) → 7. Riachuelo (waypoint).
- `validationErrors: []`, `sourceSupportAudits`: 7/7 `SUPPORTED`.

Extractor omissions (present in evidence, not emitted): El Zanjón (ev-7),
La Bombonera (ev-10), conventillos (ev-11), the old port (ev-12). These are
legitimate subset selections of a longer published walk, not hallucinations.

## 7. Multi-area geographic semantics (COLD)

The composite is a **real source-backed multi-area walk**; it was not
mechanically assembled from nearby POIs. All 7 components resolved to OSM:

| # | component | kind | OSM identity |
| --- | --- | --- | --- |
| 1 | Plaza de Mayo | PLACE | `osm:node:11548018260` |
| 2 | Defensa | ROUTE | 14 `osm:way:*` segments |
| 3 | Plaza Dorrego | PLACE | `osm:way:31364659` |
| 4 | Mercado de San Telmo | PLACE | `osm:way:158893271` |
| 5 | Avenida Almirante Brown | ROUTE | 49 `osm:way:*` segments |
| 6 | Caminito | PLACE | `osm:node:10303343309` |
| 7 | Plaza Paseo del Riachuelo | PLACE | `osm:way:335291903` |

Geographic validation: **15/15 proposals verified, 0 rejected**. Crossing the
San Telmo → La Boca neighborhood boundary was **not** itself a rejection.
Composition is source-backed (ev-13, corroborated by ev-14/18/20), components
cross area boundaries legitimately, and no nearby POI was retrofitted.

## 8. Persistence / dedupe / classification (COLD)

- 15 `VERIFIED` Experiences persisted: 14 singletons + 1 composite.
- Composite: `San Telmo to La Boca History Walk`,
  id `b353fc85-2a41-4b23-af24-6814100f8d31`, 7 components, roles preserved
  (waypoint/route/waypoint/venue/route/waypoint/waypoint), order preserved.
- Dedupe: 0 duplicate identities, 0 duplicate experience names, 0 duplicate
  verified-hint keys. Source-backed composition was not trimmed silently and
  no unsupported stop was added.
- Classification converged to themes `[history, architecture]` / intents
  `[walk]` (evidence-only, Groq), matching the extractor.

## 9. Tour quality (COLD) — technically VERIFIED vs actually useful

The **final materialized tour selected 5 singleton Experiences**, not the
7-component composite walk:

1. Museo Casa Taller 'Celia Chevalier'
2. Museo Histórico de Cera
3. Museo de Artistas Argentinos Benito Quinquela Martín
4. La flor de la vida
5. La "Inmortal Polaca" del maestro ajedrecista Miguel Najdorf

`daily_planning`: "6 candidatas representadas, 5 seleccionadas, 1 sin
seleccionar", semantic ranking applied over all 15 eligible candidates, real
travel-time estimates used.

**Corrected root cause.** The composite walk (`b353fc85-…f8d31`) was
successfully discovered, source-supported, resolved, geographically verified,
persisted, classified (`history` + `architecture` + `walk`) and admitted to
planning. It reached `GreedyDailyPlanningSolver`. It was **rejected by the
request's active walking constraints**, which produced:

```text
MAX_WALKING_PER_DAY_EXCEEDED
MAX_CONTINUOUS_WALKING_EXCEEDED
```

`TourCompletenessValidator` then correctly exposed
`UNMET_REQUESTED_FORMAT(walk)`. The composite was **not** ignored by the
planner and was **not** lost at ranking — it was explicitly mobility-infeasible
under the RW2 request shape (`daily = 5000 m`, `continuous = 3000 m`).

Product observation (recorded, not changed here): the current frontend default
`walkingEffortProfile = moderate` maps to `daily = 5000 m`, `continuous = 1500
m`. RW2 used `daily = 5000 m`, `continuous = 3000 m`, so RW2's mobility shape
was **not** the exact current default preset (and the current default is even
more restrictive on continuous walking).

This remains a **product-quality finding**, now with the correct mechanism: the
multi-area walk was proven real and persisted; the active mobility contract
excluded it from the final itinerary.

## 10. WARM (same DB, new process)

- Completed in **34s** (COLD 252s). Steps: `preference_interpretation →
  tour_intent → destination_resolution → anchor_geo_resolution →
  coverage_analysis → db_search → candidate_pool → embeddings →
  daily_planning → tour_completeness`. **No `discovery` step.**
- First coverage pass: "Portafolio suficiente: 15 Experience(s) elegible(s)" —
  no acquisition deficit, so **no SerpAPI, no Cloudflare extraction, no
  geoapify places, no wikivoyage**.
- Same canonical Experience ID `b353fc85-2a41-4b23-af24-6814100f8d31`.
- No new rows: 15 → 15 Experiences, 23 → 23 GeoEntities, 21 → 21 components.
- 0 duplicate identities / names. Reuse was genuine catalog hit, not
  reacquisition-then-dedupe.
- Final tour identical (same 5 singletons).

## 11. Verdict

**MIXED — multi-area semantics PASS; two named findings (no blocker for the
semantic goal).**

- PASS: both anchors extracted and resolved; `GENERIC` routing reproduced the
  documented 2-anchor behavior; a real source-backed multi-area composite was
  extracted, resolved 7/7, geo-ACCEPTED, persisted, and WARM-reused
  canonically; crossing neighborhood boundaries was not a rejection; no
  proximity fabrication.
- FINDING 1 (routing): `GENERIC` drops structured anchors at the acquisition
  planner; names survive only via the `semanticQuery` string.
- FINDING 2 (planning mobility — corrected): the composite reached the planner
  and was rejected by the active walking constraints
  (`MAX_WALKING_PER_DAY_EXCEEDED` + `MAX_CONTINUOUS_WALKING_EXCEEDED`), then
  exposed by `TourCompletenessValidator` as `UNMET_REQUESTED_FORMAT(walk)`.
  It was **not** ignored and **not** lost at ranking.

Not fixed at spike time (per spike scope). These findings were later closed by
the RW2 tracing/anchor fix described in the main Progress doc. Next gate per
roadmap: RW3 (Caminito canonical OSM ROUTE).
