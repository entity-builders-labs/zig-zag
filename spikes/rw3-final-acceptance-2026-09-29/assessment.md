# RW3 Final Acceptance Gate Assessment (Caminito Walking Tour)

Date: 2026-09-29
Acceptance run code HEAD: cf2e9567663b39541b943f333b16a4833a00b03e
Evidence commit: e3d54b846db191b3ce852a17fc84260e28da44e4
Dedicated Database: zigzag_spike_rw3_final_acceptance
Provider Pair: Serper (`groundedSearchProvider`), Groq (`discoveryExtractorProvider`, `qwen/qwen3.8-27b`), Tavily Extract (`webSourceContentProvider`), Geoapify (Places, Routing), Google Gemini (`gemini-3.5-flash-lite`, semantic classification), local Overpass & Nominatim.

---

## 1. Executive Summary & Verdict

### Gate Verdict: **RW3 = CLOSED / ACCEPTED — RW4 = AUTHORIZED AFTER INDEPENDENT REVIEW**

All deterministic verification suites, live COLD and WARM runs, database sequence integrity checks, classifier-owned semantic projection, Generation Trace v5 invariants, and architectural boundaries PASSED completely.

1. **Deterministic Verification**:
   - `git diff --check`: PASS (clean).
   - `yarn lint:check`: PASS (0 errors).
   - `yarn typecheck`: PASS (0 errors).
   - Targeted unit suites (5 suites, 243 tests): PASS.
   - Full tours module unit suites (126 suites, 1737 tests): PASS.
   - Production build (`yarn build`): PASS.

2. **COLD Run Acceptance**:
   - Starting from empty DB (`zigzag_spike_rw3_final_acceptance`).
   - Tour ID: `30d9df68-a790-4607-bc96-6562039a8c8b`, duration 195.9s, status `completed`.
   - Anchor `Caminito` resolved to OSM canonical ROUTE `osm:way:144844726`.
   - Coverage analysis identified deficits for `intent:walk` and `theme:history`.
   - Deficit routed to `AREA_ROUTE_WALK=1` and `GENERIC=1`.
   - Deep source content retrieval triggered on Tavily Extract (2 requests), acquiring high-quality markdown sources.
   - Discovery extraction via Groq (`qwen/qwen3.8-27b`, temperature 0) extracted multi-component candidate `"La Boca Walking Tour: Caminito, Museum, and Bridge"` with 4 grounded component hints.
   - Entity resolution resolved all 4 components (Caminito node:10303343309, Museo node:5721009562, Puente way:256715723, La Bombonera way:248598885).
   - Spatial validation passed with `GEO_VERIFIED` under route-scope membership.
   - Composite Experience materialized as `f5dee6f9-6070-437e-bdf1-e8262af6d27d` with 4 `ExperienceComponent` records.
   - Semantic classification via Gemini (`gemini-3.5-flash-lite`) converged facets: `intent:walk`, `theme:history`, `art`, `culture`, `architecture`, `tango`, `shopping`.
   - Persisted in Postgres: 18 GeoEntities, 15 Experiences (all `VERIFIED`), 30 Identities, 18 Components, 0 duplicates.
   - Daily planning selected `"La Boca Walking Tour: Caminito, Museum, and Bridge"` as stop #1 of the day itinerary.
   - Generation Trace v5 captured 58 steps.

3. **WARM Run & Catalog-First Acceptance**:
   - Sequence integrity: `verify-db-sequence.cjs` verified `cold/db-after.json == warm/db-before.json` byte-for-byte.
   - Tour ID: `1280f947-ec24-4899-a1f5-8f9a5adeb13b`, duration 101.0s, status `completed`.
   - Catalog-first: In Step 4 (`coverage.analysis`), initial catalog evaluation reported `SUFFICIENT` (`deficits: []`) because the persisted composite Experience satisfied `intent:walk` (`strongMatchCount: 1`).
   - Internet acquisition for `AREA_ROUTE_WALK` was 100% bypassed: 0 web searches, 0 Tavily calls, 0 Gemini classification calls.
   - DB state after WARM: exactly 18 GeoEntities, 15 Experiences, 30 Identities, 18 Components (zero growth, zero duplicate rows).
   - Final tour scheduled `"La Boca Walking Tour: Caminito, Museum, and Bridge"` as stop #1 in the itinerary.
   - Generation Trace v5 captured 20 steps.

4. **RW4 Authorization Status**: **AUTHORIZED / NEXT GATE** after independent review of the committed evidence and current execution pointer update.

---

## 2. Quantitative Run Comparison

| Metric | COLD Run | WARM Run | Delta / Notes |
| :--- | :--- | :--- | :--- |
| **Tour ID** | `30d9df68-a790-4607-bc96-6562039a8c8b` | `1280f947-ec24-4899-a1f5-8f9a5adeb13b` | Both generated via real `/tours/generate-tour` HTTP path |
| **Status** | `completed` | `completed` | Zero errors, zero fatal timeouts |
| **Elapsed Polling** | 195,961 ms (~196s) | 101,025 ms (~101s) | ~48% latency reduction |
| **Trace Version** | v5 | v5 | Strict Generation Trace v5 schema |
| **Total Trace Steps** | 58 | 20 | 65% step reduction due to catalog-first |
| **Initial Coverage** | `NEEDS_ACQUISITION` (2 deficits) | `SUFFICIENT` (0 deficits) | Catalog-first short-circuit verified |
| **Final Coverage** | `SUFFICIENT` | `SUFFICIENT` | Met all preference facets |
| **GeoEntities Before** | 0 | 18 | Dedicated DB started empty |
| **GeoEntities After** | 18 | 18 | 0 entity inflation on WARM |
| **Experiences Before** | 0 | 15 | Dedicated DB started empty |
| **Experiences After** | 15 | 15 | 0 duplicate experience on WARM |
| **Identities Before/After**| 0 / 30 | 30 / 30 | 0 identity pollution |
| **Components Before/After**| 0 / 18 | 18 / 18 | Composite components intact |
| **Tavily Extract Calls** | 2 | 0 | 100% bypass on WARM |
| **Gemini AI Calls** | 15 | 0 | 100% reuse of persisted classification |
| **Serper Calls** | 3 | 1 (planner capacity pass) | 0 search for walk / Caminito |
| **Geoapify Routing Calls**| 142 | 190 | Planning solver itinerary distance calculations |
| **Stop #1 Scheduled** | `La Boca Walking Tour: Caminito...` | `La Boca Walking Tour: Caminito...` | Composite walk successfully scheduled in both |

---

## 3. Engineering Principles & Invariants Gate

| Invariant / Category | Verdict | Evidence |
| :--- | :--- | :--- |
| **Provider Isolation** | **PASS** | Adapters normalize raw provider responses. Downstream services reason exclusively over normalized facts and typed evidence models. |
| **Typed Domain Contracts** | **PASS** | `findClassificationContextById` used for typed classification context; evidence models strictly typed; no `Record<string, unknown>` bags. |
| **Single Source of Truth** | **PASS** | Single trace authority (Generation Trace v5); single classification convergence authority (`experience-classification-convergence.util.ts`); single identity verifier authority (`IdentityVerifier`). |
| **No Magic Semantic Defaults** | **PASS** | Strict classifier-owned semantic projection (`classificationSemanticView`); unknown states remain explicit. |
| **Database Sequence Integrity**| **PASS** | Strict sequence: empty dedicated DB -> COLD -> `cold/db-after` == `warm/db-before` (byte-for-byte verified) -> WARM -> `warm/db-after`. Zero synthetic DB patches. |
| **Frontend Layout Convention** | **PASS** | No frontend changes touched. |
| **Migration & Cutover** | **PASS** | No legacy pipeline paths reachable. |
