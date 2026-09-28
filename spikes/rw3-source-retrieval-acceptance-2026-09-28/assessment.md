# RW3 Source Retrieval Acceptance — Assessment (Caminito Canonical Geographic ROUTE)

Date: 2026-09-28  
Run directory: `spikes/rw3-source-retrieval-acceptance-2026-09-28/`  
Dedicated DB: `zigzag_spike_rw3_retrieval`  
Provider pair: Serper (`groundedSearchProvider`) + Groq (`discoveryExtractorProvider`, `qwen/qwen3.8-27b`, temperature 0), Tavily Extract (`webSourceContentProvider`), Geoapify Places, local Overpass & Nominatim.  
Cold trace: `cold/generation-trace.json` (Tour ID `2fb948ba-b52b-42f2-93f5-6ce59460dcb8`).  
Warm trace: `warm/generation-trace.json` (Tour ID `b3462360-9859-45bc-9af8-542bd1b788c0`).  

---

## 1. Executive Summary & Verdict

### Gate Verdict: **RW3 ACCEPTANCE GATE PASSED — COLD & WARM CAMPAIGN COMPLETE — RW4 AUTHORIZED**

1. **Deep Source Content Retrieval Boundary Verified in Live Generation:**
   - **Trigger Condition**: When `MULTI_COMPONENT_EXPERIENCE` is required by the acquisition plan and initial extraction fails to yield an admissible multi-component candidate, deep source retrieval triggers automatically without provider leakage or N7 anti-patterns.
   - **Content Acquisition**: Tavily Extract retrieved full source markdown for top relevant URLs (`solsalute.com` 32,121 chars, `buenosairesfreewalks.com` 2,980 chars) in 2,166ms.
   - **Quality Threading**: Retrieved documents were tagged with `evidenceQuality: "original_content"`, recorded across evidence items, trace records, and the generation trace.

2. **Source Support Verification & Extraction:**
   - **Support Spans**: All 3 component hints had verbatim support spans extracted against the full source text and independently verified by the backend (`ComponentSourceSupportUtil`).
   - **Markdown Normalization**: Robust delimiter handling (`[*_~`#]+` replaced by whitespace) prevents character concatenation in markdown bold/italic tags (`the**famous` -> `the famous`).
   - **Extractor Determinism**: Extraction run on Groq (`qwen/qwen3.8-27b`) with explicit `temperature: 0` produced 100% stable JSON candidates.
   - **Admission**: `La Boca Walking Tour` was admitted under `MATCHING_EVIDENCE_REQUIREMENT` for `MULTI_COMPONENT_EXPERIENCE` with 3 component hints:
     1. `Caminito` (ROUTE, order 1, supportSpan: `"We will walk the**famous little street Caminito**"`)
     2. `Plazoleta Bomberos Voluntarios de La Boca` (PLACE, order 2, translation from `"Volunteer Firefighters Plaza"`, supportSpan: `"Our tour continues with visit to the square of the **volunteer Fire Fighters**"`)
     3. `La Bombonera` (PLACE, order 3, canonical name from `"Boca Juniors stadium"`, supportSpan: `"we will finish our tour seeing the **Boca Juniors Football Stadium**"`)

3. **Entity Resolution & Spatial Validation:**
   - **All 3 Components Resolved**:
     - `Caminito`: `osm:way:144844726` (ROUTE, canonical geometry LINE, `INSIDE`)
     - `Plazoleta Bomberos Voluntarios de La Boca`: `osm:way:450506706` (PLACE, canonical geometry POINT, `INSIDE`)
     - `La Bombonera`: `osm:way:248598885` (PLACE, canonical geometry POINT, `INSIDE`)
   - **Geographic Validation**: Proposal validated under `canonical_geometry` strategy as `GEO_VERIFIED` with zero rejection reasons.
   - **Catalog Materialization**: Persisted in PostgreSQL as verified composite `Experience` with 3 `ExperienceComponent` records.

4. **WARM Run & Catalog Reuse Verification:**
   - **DB Sequence Integrity**: `cold/db-after` matched `warm/db-before` byte-for-byte (18 GeoEntities, 22 GeoEntityIdentities, 14 Experiences, 18 ExperienceComponents).
   - **Catalog Reuse**: In the WARM pass, all 3 component hints resolved via `CATALOG_REUSE` (`status: true, verdict: VERIFIED`).
   - **Materialization**: Reused catalog entities cleanly without reacquisition or duplicate persistence.

5. **RW4 Authorization Status**: **AUTHORIZED**.

---

## 2. Checkpoint Status (11 Invariants)

| Checkpoint | Result | Evidence / Details |
| --- | --- | --- |
| 1. Interpretation | **PASS** | `Caminito` anchored as `must`, `usage: specific_destination`, `intent: walk`. |
| 2. Anchor resolution (+ same-branch audit) | **PASS** | `Caminito` resolved to canonical OSM ROUTE `osm:way:144844726` (`MultiLineString`, 9 vertices). Out-of-destination homonyms screened. |
| 3. Routing | **PASS** | Pass 1: `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `sourcePlan.web.anchorNames=["Caminito"]`. |
| 4. Search → extractor handoff | **PASS** | `extractor.requestAnchorNames=["Caminito"]`, query `"Buenos Aires Caminito walking tours walks"`. |
| 5. Source-backed multi-component walk admitted | **PASS** | Deep retrieval triggered upon initial snippet deficit; full source extracted. `La Boca Walking Tour` admitted with 3 components under `MULTI_COMPONENT_EXPERIENCE`. |
| 6. Components resolved | **PASS** | 3/3 components resolved: `Caminito` (OSM ROUTE), `Plazoleta Bomberos Voluntarios de La Boca` (OSM PLACE), `La Bombonera` (OSM PLACE). |
| 7. Route-geometry gate exercised | **PASS** | Evaluated under `canonical_geometry` strategy with `GEO_VERIFIED` verdict. |
| 8. Persisted | **PASS** | Composite Experience persisted with 3 components. `cold/db-after`: 18 GeoEntities, 14 Experiences. |
| 9. Planner acceptance | **PASS** | Tour generation completed (`generationStatus: completed`, failure: null). |
| 10. Multi-component integrity | **PASS** | Composite maintains 100% grounded integrity: 3 real components, verified support spans, canonical geometries. |
| 11. Cold & warm completion | **PASS** | COLD completed in 159s; WARM completed in 153s with 100% catalog reuse. |

---

## 3. Engineering Principles & Boundaries Gate

| Category | Result | Details |
| --- | --- | --- |
| **Provider Isolation** | **PASS** | Provider specifics terminate at adapters (`IWebSourceContentService`, `IPlacesApiService`, `IExternalAiService`). Domain services consume normalized facts and typed evidence. |
| **Typed Canonical Boundaries** | **PASS** | All evidence models (`ExperienceGroundingEvidence`, `TraceEvidenceReference`, `ResolverEvidenceItem`) strictly typed with `evidenceQuality`. No `Record<string, unknown>` bags. |
| **Single Policy Authority** | **PASS** | `IdentityVerifier` remains the sole authority for identity decisions. `ComponentSourceSupportUtil` remains the sole authority for support span verification. |
| **No Magic Semantic Defaults** | **PASS** | All components grounded in verified source spans and matched against authoritative OSM/Nominatim geometry. |
| **Database Sequence Integrity** | **PASS** | Verified with `verify-db-sequence.cjs`. Zero drift between COLD finish and WARM start. |
