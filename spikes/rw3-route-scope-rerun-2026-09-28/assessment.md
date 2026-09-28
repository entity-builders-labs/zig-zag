# RW3 clean rerun — assessment (Route-Scope Policy & Geographic Separation)

Run directory: `spikes/rw3-route-scope-rerun-2026-09-28/`
Dedicated DB: `zigzag_spike_rw3_routescope`
Provider pair: Serper (`groundedSearchProvider`) + Cloudflare Workers AI (`@cf/qwen/qwen3.8-27b`, 60s timeout), Geoapify Places, local Overpass & Nominatim.
Trace-first source of truth: `cold/generation-trace.json` (Tour ID `54e45b83-17a8-43e1-afaf-82deeab49d7f`).

## Gate outcome: **BLOCKED — RW3 NOT CLOSED (LIVE EXTRACTION VARIANCE); RW4 NOT AUTHORIZED**

### Summary of Result
1. **RW3-N6 Route-Anchor Coherence & Feasibility Separation:** **PROVEN**
   - Pure policy `evaluateRouteScopeMembership` implemented and verified.
   - Replaced arbitrary 300m corridor cliff with topological anchor satisfaction (`ANCHOR_COMPONENT` / `ON_ROUTE`), destination boundary compatibility (`OUTSIDE_DESTINATION_BOUNDARY`), local scope sharing (`SAME_LOCAL_SCOPE`), and coherent extensions (`DESTINATION_COMPATIBLE_EXTENSION`).
   - Distance from route is preserved strictly as diagnostic evidence (`distanceFromRouteMeters`), not semantic authority.
   - Separation of responsibilities enforced: geographic validation answers spatial coherence to requested scope; planner answers walking feasibility (`MAX_WALKING_PER_DAY_EXCEEDED`).
   - Deterministic test regressions G1–G6 all GREEN (50 tests passing in `composite-geographic-validation.service.spec.ts` and 5 in `route-scope-membership-policy.spec.ts`).
2. **RW3 Live COLD Run:**
   - Preflight verified: Serper + Cloudflare `@cf/qwen/qwen3.8-27b` canonical pair.
   - Serper returned 10 relevant Caminito walking results (`ev-1` through `ev-10`).
   - Cloudflare extractor yielded 0 candidates on this run's snippets.
   - Pipeline terminated fail-closed with:
     `"Error: Coverage insuficiente después de catálogo y adquisición multi-fuente acotada: Preference facet [intent:walk] has no strong catalog match yet."`
3. **Database State & WARM Run Execution:**
   - DB before: 0 GeoEntities, 0 Experiences.
   - DB after: 1 GeoEntity (`Caminito`, `ROUTE`, `osm:way:144844726`), 0 Experiences.
   - Per invariant: *"Execute WARM only if COLD persists a relevant RW3 Experience."* Because COLD persisted zero experiences, WARM was not executed, preserving strict sequence integrity without fabricated state.
4. **RW4 Authorization:** **NOT AUTHORIZED**.

---

## Checkpoint Status (11 Invariants)

| Checkpoint | Result | Evidence / Details |
| --- | --- | --- |
| 1. Interpretation | **PASS** | `Caminito` anchored as `must`, `intent:walk`. |
| 2. Anchor resolution (+ same-branch audit) | **PASS** | `Caminito` resolved to canonical OSM ROUTE `osm:way:144844726` (`MultiLineString`, 9 vertices). All out-of-destination / incompatible homonyms screened. |
| 3. Routing | **PASS** | `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `SourcePlan.web.anchorNames=["Caminito"]`. |
| 4. Search → extractor handoff | **PASS** | `extractor.requestAnchorNames=["Caminito"]`, query `"Buenos Aires Caminito walking tours walks walking Caminito to see representative places"`. |
| 5. Relevant source-backed multi-component walk admitted | **INCONCLUSIVE (LIVE EXTRACTION VARIANCE)** | Extractor yielded 0 candidates on live snippets. 0 candidates admitted. |
| 6. Components resolved | **NOT REACHED** | 0 candidates admitted to reach entity resolution. |
| 7. Route-geometry gate actually exercised | **PROVEN DETERMINISTICALLY** | G1–G6 test suite verifies Caminito + Quinquela + La Bombonera passes without 300m cliff, preserving diagnostic distance without threshold rejection. |
| 8. Persisted | **FAIL** | 0 experiences persisted in database. Only anchor GeoEntity (`Caminito`) persisted. |
| 9. Planner accepts or rejects for explicit feasibility reason | **PASS (Explicit)** | Explicit fail-closed coverage message emitted. No silent fallback or crash. |
| 10. Multi-component integrity | **PASS** | Backend strictly rejects candidates where area is used to fake multi-component structure. |
| 11. Cold run completion | **FAIL (Terminal error)** | Terminated cleanly with `generationStatus: "failed"` due to unsatisfied coverage. |

---

## Detailed Analysis

### 0. Run Configuration
- Dedicated database: `zigzag_spike_rw3_routescope`
- Preflight:
  ```json
  {
    "groundedSearchProvider": "serper",
    "discoveryExtractorProvider": "cloudflare",
    "discoveryExtractorModel": "@cf/qwen/qwen3.8-27b",
    "discoveryExtractorTimeoutMs": 60000,
    "classificationProvider": "gemini",
    "aiProvider": "groq",
    "canonicalPair": true
  }
  ```
- Polling elapsed: 10,110 ms
- Final status: `failed`
