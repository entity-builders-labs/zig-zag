# RW3 Acceptance Rerun — Assessment (Caminito Canonical Geographic ROUTE)

Date: 2026-09-28
Run directory: `spikes/rw3-acceptance-rerun-2026-09-28/`
Dedicated DB: `zigzag_spike_rw3_accept`
Provider pair: Serper (`groundedSearchProvider`) + Cloudflare Workers AI (`@cf/qwen/qwen3.8-27b`, 60s timeout), Geoapify Places, local Overpass & Nominatim.
Trace-first source of truth: `cold/generation-trace.json` (Tour ID `9b9d65c0-ad3e-4ba9-a79b-cb9a1b88a98b`).

---

## 1. Executive Summary & Verdict

### Gate Verdict: **RW3 NOT CLOSED — WARM RUN NOT AUTHORIZED — RW4 NOT AUTHORIZED**

1. **Extractor Forensic Characterization & Trace Observability (COMPLETED & VERIFIED):**
   - 5 frozen samples of Positive Control (`anchor-handoff-rerun` ev-5): **5/5 (100%) admitted** with 3 components (Caminito, Benito Quinquela Martín Museum, La Bombonera with typo normalization).
   - 5 frozen samples of Semantic-Empty Evidence (`route-scope-rerun` ev-1 to ev-10): **5/5 (100%) emitted `{"candidates": []}`**.
   - Observability gap (Case D) resolved: `TraceAcquisitionSourcePlan.web.extractor.rawOutput` is now preserved in the trace, bounded (8,000 chars) and redacted (`redactTraceText`).
   - Proven by unit tests (45/45 pass in `generation-trace-builder.util.spec.ts`) and verified in live trace step 8.

2. **Live COLD Run Analysis:**
   - Preflight verified: Serper + Cloudflare `@cf/qwen/qwen3.8-27b` canonical pair.
   - Search query: `"Buenos Aires Caminito walking tours walks walking tour of caminito representative places"`.
   - Serper returned 10 snippets (`ev-1` through `ev-10`).
   - Extractor emitted candidate `"Caminito Walking Tour"`, but with only 1 component:
     `{"name": "Caminito", "role": "area", "expectedKind": "AREA"}`
     and explicitly reported in `shortReason`:
     > *"Evidence supports a walking tour in Caminito, but does not explicitly name a second distinct geographic component (like a specific street or venue) as part of a single defined route or itinerary within the anchor itself."*
   - Deterministic admission evaluated candidate against `MULTI_COMPONENT_EXPERIENCE`:
     Candidate lacked $\ge 2$ distinct non-area components.
     Admission decision: `NO_MATCHING_EVIDENCE_REQUIREMENT` -> **REJECTED (Fail-closed)**.
   - Pipeline continued with secondary catalog acquisition, materializing 14 single-component `PLACE` experiences in DB and scheduling 3 into Day 1.
   - `tour_completeness` flagged:
     `"You asked for \"walk\" experiences, but none made it into the final itinerary."` (`UNMET_REQUESTED_FORMAT`, `status: WARN`).

3. **Classification of the Current State:**
   - **Primary Classification: Case A (Expected Fail-Closed Anti-Fabrication Behavior).**
     The evidence returned by Serper did not contain $\ge 2$ distinct non-area components belonging to one real Experience. The extractor explicitly verified this and truthfully reported the absence of a second component. Deterministic admission correctly refused to admit a fake multi-component walk.
   - **Contributing Factor: Case E (Search Snippet Variance).**
     When Serper received `"walk caminito landmarks"`, it retrieved the TripAdvisor snippet listing the 3 stops. When receiving `"walking tour of caminito representative places"`, it retrieved a TripAdvisor review describing food and tango without listing the stops.
   - **Observability Gap: Case D (Resolved).**
     The bitácora is no longer blind. `rawOutput` is preserved and visible in `cold/generation-trace.json`.

4. **WARM Run & Database State:**
   - DB before: 0 GeoEntities, 0 Experiences.
   - DB after: 15 GeoEntities (1 ROUTE `Caminito`, 14 PLACE), 14 Experiences (all single-component PLACE).
   - Invariant: *"Execute WARM only if COLD persists a relevant RW3 Experience. If COLD fails to persist, DO NOT run WARM."*
   - Because COLD did NOT persist a multi-component Caminito walk, **WARM was NOT executed**, preserving strict database sequence integrity without fabricated or patched state.

5. **RW4 Authorization Status:** **NOT AUTHORIZED**.

---

## 2. Checkpoint Status (11 Invariants)

| Checkpoint | Result | Evidence / Details |
| --- | --- | --- |
| 1. Interpretation | **PASS** | `Caminito` anchored as `must`, `usage: specific_destination`, `intent: walk`. |
| 2. Anchor resolution (+ same-branch audit) | **PASS** | `Caminito` resolved to canonical OSM ROUTE `osm:way:144844726` (`MultiLineString`, 9 vertices). 5 out-of-destination Nominatim venue homonyms screened. |
| 3. Routing | **PASS** | Pass 1: `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `sourcePlan.web.anchorNames=["Caminito"]`. |
| 4. Search → extractor handoff | **PASS** | `extractor.requestAnchorNames=["Caminito"]`, query `"Buenos Aires Caminito walking tours walks walking tour of caminito representative places"`. |
| 5. Relevant source-backed multi-component walk admitted | **FAIL-CLOSED (Case A)** | Extractor identified that evidence did not contain a 2nd non-area component (`shortReason`). Emitted only 1 component (`Caminito` as `area`). Deterministic admission rejected candidate per `MULTI_COMPONENT_EXPERIENCE`. |
| 6. Components resolved | **PASS (for single POIs) / NOT REACHED (for walk)** | 14 POIs resolved to real GeoEntities (OSM/Geoapify/Wikidata). Multi-component walk not admitted. |
| 7. Route-geometry gate actually exercised | **PROVEN DETERMINISTICALLY** | Verified in unit test regressions G1–G6. Diagnostic `distanceFromRouteMeters` preserved without 300m cliff rejection. |
| 8. Persisted | **PARTIAL / FAIL for walk** | 15 GeoEntities (including `Caminito` ROUTE) and 14 PLACE experiences persisted. Multi-component walk: 0 persisted. |
| 9. Planner accepts or rejects for explicit feasibility reason | **PASS (Explicit)** | Daily planner scheduled 3 POIs; `tour_completeness` explicitly flagged `UNMET_REQUESTED_FORMAT` (`"You asked for \"walk\" experiences, but none made it into the final itinerary."`). |
| 10. Multi-component integrity | **PASS** | Anti-fabrication invariant held 100%: 1-component / area candidate was rejected, never forced into a multi-component experience. |
| 11. Cold run completion | **PASS (with WARN)** | Clean termination (`generationStatus: completed`, elapsed 137s) with explicit completeness warning. |
