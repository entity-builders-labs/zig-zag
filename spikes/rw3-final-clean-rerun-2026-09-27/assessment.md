# RW3 final clean rerun — assessment (Serper + Cloudflare, clean database)

Run directory: `spikes/rw3-final-clean-rerun-2026-09-27/`
Dedicated DB: `zigzag_spike_rw3_clean`
Provider pair: Serper (`groundedSearchProvider`) + Cloudflare Workers AI (`@cf/qwen/qwen3.8-27b`, 60s timeout), Geoapify Places, local Overpass & Nominatim.
Trace-first source of truth: `cold/generation-trace.json` (Tour ID `7f5f86d4-2f8d-484e-9bd5-c3af6af2ee24`).

## Gate outcome: **BLOCKED — RW3 NOT CLOSED (LIVE MULTI-COMPONENT ADMISSION MISS); RW4 NOT AUTHORIZED**

### Summary of Result
1. **N5 Typo Normalization Design:** **PROVEN** (via controlled unit test suite `experience-proposal-normalization.spec.ts` with 12 tests, and controlled Cloudflare prompt execution on frozen `ev-5`).
2. **RW3 Live COLD Run:** **BLOCKED at Checkpoint 5 (Candidate Admission)**.
   - Serper returned 10 walking search results.
   - Cloudflare extracted candidate `"Caminito Walking Tour"` with only 1 non-area component (`Caminito` route; `La Boca` was marked `role: "area"`).
   - Acquisition candidate admission strictly enforced `candidateSatisfiesEvidenceRequirement`: area roles are filtered out by `distinctMeaningfulComponents`, leaving only 1 distinct component. Because `MULTI_COMPONENT_EXPERIENCE` requires $\ge 2$ distinct non-area components, the candidate was honestly rejected with `NO_MATCHING_EVIDENCE_REQUIREMENT`.
   - With 0 admitted candidates, `AreaRouteWalkAcquisitionService` reported `outcome: "no_result", reason: "no_accepted_results"`.
   - Tour generation terminated fail-closed with:
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
| 1. Interpretation | **PASS** | `Caminito` anchored as `named_path`/`must`, `intent:walk`. |
| 2. Anchor resolution (+ same-branch audit) | **PASS** | `Caminito` resolved to canonical OSM ROUTE `osm:way:144844726` (`MultiLineString`, 9 vertices). All out-of-destination / incompatible homonyms screened. |
| 3. Routing | **PASS** | `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `SourcePlan.web.anchorNames=["Caminito"]`. |
| 4. Search → extractor handoff | **PASS** | `extractor.requestAnchorNames=["Caminito"]`, query `"Buenos Aires Caminito walking tours walks walk caminito representative places"`. |
| 5. Relevant source-backed multi-component walk admitted | **FAIL / BLOCKED** | Extractor emitted `Caminito` + `La Boca` (area). Area excluded by `distinctMeaningfulComponents`; rejected as `NO_MATCHING_EVIDENCE_REQUIREMENT` ($1 < 2$). 0 candidates admitted. |
| 6. Components resolved | **NOT REACHED** | 0 candidates admitted to reach entity resolution. (Controlled N5 path proven strictly via `IdentityVerifier`). |
| 7. Route-geometry gate actually exercised | **AUDITED CANONICALLY** | Canonical evaluation of `Caminito ROUTE osm:way:144844726` (`MultiLineString`) against components: `Museo Quinquela Martín` = 188.1m ($\le 300\text{m}$, passes); `La Bombonera` = 428.2m ($> 300\text{m}$, triggers `EXTERNAL_ROUTE_SCOPE_MISMATCH`). Rules not loosened. |
| 8. Persisted | **FAIL** | 0 experiences persisted in database. Only anchor GeoEntity (`Caminito`) persisted. |
| 9. Planner accepts or rejects for explicit feasibility reason | **PASS (Explicit)** | Explicit fail-closed coverage message emitted. No silent fallback or crash. |
| 10. Multi-component integrity | **PASS** | Extractor did not hallucinate stops; backend strictly rejected candidate where area was used to fake multi-component structure. |
| 11. Cold run completion | **FAIL (Terminal error)** | Terminated cleanly with `generationStatus: "failed"` due to unsatisfied coverage. |

---

## Detailed Analysis

### 0. Run Configuration
- Dedicated database: `zigzag_spike_rw3_clean`
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
- Tour ID: `7f5f86d4-2f8d-484e-9bd5-c3af6af2ee24`
- Elapsed: 22,207 ms
- HTTP Status: Completed with generationStatus `failed`.

### 1. Extractor Output and Admission Decision
From `cold/generation-trace.json` (`discovery` / `area_route_walk_acquisition`):
- Extracted candidate: `"Caminito Walking Tour"`
  - `componentHints[0]`: `{ name: "Caminito", role: "route", sourceName: "Caminito" }`
  - `componentHints[1]`: `{ name: "La Boca", role: "area", sourceName: "La Boca" }`
- Admission evaluation:
  ```typescript
  // candidateSatisfiesEvidenceRequirement(candidate, 'MULTI_COMPONENT_EXPERIENCE')
  // distinctMeaningfulComponents excludes role === 'area'
  // distinctHints: [Caminito] (length = 1)
  // distinctHints.length >= 2 === false
  ```
- Result: `accepted: false, reason: "NO_MATCHING_EVIDENCE_REQUIREMENT"`.

### 2. Route Geometry Evaluation (Audit)
Canonical anchor: `Caminito` (`osm:way:144844726`), geometry `MultiLineString` (9 coordinates).
Measured via canonical `distancePointToLineStringMeters`:
1. `Museo Benito Quinquela Martín` (`lat: -34.63776, lon: -58.36128`):
   - Distance: 188.1 meters.
   - Status: Within corridor threshold (`maxComponentDistanceFromRouteMeters: 300`).
2. `La Bombonera` (`lat: -34.6355171, lon: -58.3649163`):
   - Distance: 428.2 meters.
   - Status: Exceeds corridor threshold ($428.2\text{m} > 300\text{m}$).
   - Decision under canonical `CompositeGeographicValidationService`: `EXTERNAL_ROUTE_SCOPE_MISMATCH`.
   - **Conclusion:** As instructed, canonical geography rules were NOT modified or loosened to force a pass.

### 3. Engineering-Principles Gate

| Principle | Result | Detail |
| --- | --- | --- |
| Provider isolation | **PASS** | No provider-name branching in domain or admission logic. |
| Typed domain contracts | **PASS** | Explicit `GeoEntityHint.sourceName` and `normalizationKind`. |
| Normalize at boundaries | **PASS** | Serper and Cloudflare payloads normalized strictly at adapter boundaries. |
| Single policy authority | **PASS** | `candidateSatisfiesEvidenceRequirement` and `distinctMeaningfulComponents` strictly govern candidate admission. |
| No magic semantic defaults | **PASS** | Missing/invalid normalization kinds fail closed as `SOURCE_CONTRACT_VIOLATION` (verified in commit `787a0845`). |
| Tests & fixtures parity | **PASS** | 12 unit tests in `experience-proposal-normalization.spec.ts` pass cleanly. |
| Honest reporting | **PASS** | Rerun results reported without manual DB injection or false reuse claims. |

---

## Verdict

**RW3 is BLOCKED / OPEN. RW4 is NOT AUTHORIZED.**
Next action: Address the extraction shape variance for walking tour evidence (e.g. prompt/model tuning or multi-component extraction fidelity) before RW3 can be closed.
