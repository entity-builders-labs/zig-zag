# RW4 Mendoza Tourism Route Assessment Dossier (COLD Run - Cloudflare Workers AI)

**Date**: 2026-09-30  
**Campaign**: RW4 Mendoza Tourism Route (`Ruta del Vino de Mendoza`)  
**Run Mode**: COLD (Fresh Dedicated Database)  
**Database**: `zigzag_spike_rw4_cold_live_4`  
**Git HEAD**: `ab63132acf4c09a7ed9975f3ffb39c82eb9671e2` (`fix(tours): preserve route anchor name and semantic query in web plan`)  
**Branch**: `feat/preference-first-selection`  
**Port**: `3035`  

---

## 1. Executive Summary & Verdict

### Gate Verdict: **FAIL_PRODUCT_BLOCKER** (with **REGRESSION FIX VERIFIED & PROVEN PASS**)

The canonical RW4 COLD run was executed cleanly on an empty, dedicated database (`zigzag_spike_rw4_cold_live_4`) with no pre-seeded state and `AI_CACHE_MODE=off`.

1. **Named-Path Regression Fix Verification (ab63132a)**: **PASS**
   - In contrast to prior runs where unresolved `named_path` anchors were dropped from acquisition planning, the `AREA_ROUTE_WALK` web search query preserved both the anchor name and the semantic query:
     `"Ciudad de Mendoza Ruta del Vino de Mendoza scenic routes tours wine route tour mendoza representative wineries"`
   - `anchorNames` in Trace v5 explicitly contained `["Ruta del Vino de Mendoza"]`.
   - The query no longer degraded to `Ciudad de Mendoza scenic routes tours`.

2. **Grounded Search & Deep Retrieval**: **PASS**
   - Serper returned 10 grounded results (`gl: ar`), including guides for the Mendoza Wine Route and the Wine Bus Tour (`ev-8`: Tangol Bus Vitivinícola).
   - Deep source selection scored and selected `ev-8` (Tangol, score 15) and `ev-1` (Sol Salute, score 5).
   - Tavily retrieved clean markdown for both sources in 872 ms (16,562 chars and 52,974 chars).

3. **Cloudflare Workers AI Discovery Extractor**: **PASS**
   - Configured with `DISCOVERY_EXTRACTOR_PROVIDER=cloudflare` (`@cf/qwen/qwen3.8-27b`).
   - Replaced Groq and completed all extraction calls without HTTP 429 quota exhaustion.
   - Extracted 1 multi-component candidate: `"Ruta del Vino de Mendoza: Wine Bus Tour"`.

4. **Source Support Audit & Admission**: **PASS**
   - All 5/5 components audited and verified against `ev-8` with `status: "SUPPORTED"`, `attributionStatus: "DECLARED_KEY_VERIFIED"`, and exact text spans:
     * `Ruta del Vino de Mendoza` (route)
     * `Bodega Santa Julia` (venue)
     * `Bodega La Rural` (venue)
     * `Chandon` (venue)
     * `Terrazas de los Andes` (venue)
   - Admitted downstream with `MATCHING_EVIDENCE_REQUIREMENT` (`status: PASS`, `outcome: ACCEPTED`).

5. **First Observed Failure in Pipeline Order**: **`identity resolution` (Step 16, `resolution.entity`)** — *reinterpreted 2026-09-30: the first causal defect is upstream, in extraction composition; see §5.*
   - The admitted candidate required resolving real identities for 5 components:
     * `Ruta del Vino de Mendoza`: `UNRESOLVED` (`NO_OSM_MATCH` / `NO_ROUTE_OBJECT_ACQUIRED` — no OSM route relation for "Ruta del Vino" exists).
     * `Bodega Santa Julia`: `UNRESOLVED` (`CANDIDATE_REJECTED` — Nominatim 0 results; Geoapify returned "Bodega Centenario", rejected by verifier as name mismatch).
     * `Bodega La Rural`: **RESOLVED** (`osm:way:425175968`, `canonicalName: "Bodega La Rural"`, `status: VERIFIED`, distance 10,440 m outside boundary).
     * `Chandon`: `UNRESOLVED` (`CANDIDATE_REJECTED` — Nominatim returned `osm:node:4219095090` `"Bodega Chandon"`, which failed strict name verification against hint name `"Chandon"`).
     * `Terrazas de los Andes`: **RESOLVED** (`osm:way:931488145`, `canonicalName: "Terrazas de los Andes"`, `status: VERIFIED`, distance 19,730 m outside boundary).
   - Only 2 of 5 components resolved (`resolutionRatio = 0.4`). Production requires **complete** resolution of the emitted source-backed composition (`sourceCompositionComplete`), so this triggered `INCOMPLETE_SOURCE_COMPOSITION`. *(Corrected 2026-09-30: an earlier version of this line claimed a "≥ 70% threshold"; no percentage threshold exists — `resolutionRatio` is observability only. See §5.)*
   - Step 18 (`catalog.materialization`) rejected the candidate with `NOT_PERSISTED`.

6. **WARM Execution Rule**:
   - Because COLD failed to materialize a qualifying reusable RW4 Experience (`experiences: 0` in DB), **WARM was not executed**.

---

## 2. Runtime Identity & Configuration

| Parameter | Runtime Value |
| :--- | :--- |
| **Git HEAD** | `ab63132acf4c09a7ed9975f3ffb39c82eb9671e2` |
| **Branch** | `feat/preference-first-selection` |
| **Database** | `zigzag_spike_rw4_cold_live_4` |
| **Port** | `3035` |
| **Grounded Search Provider** | `serper` |
| **Discovery Extractor Provider / Model** | `cloudflare` / `@cf/qwen/qwen3.8-27b` |
| **Discovery Extractor Timeout** | `60000 ms` |
| **Web Source Content Provider** | `tavily` (markdown extract) |
| **Places Provider** | `geoapify` |
| **Local Geographic Providers** | Overpass (`localhost:12345`), Nominatim (`localhost:8088`) |
| **AI Provider / Classification Provider** | `groq` (`qwen/qwen3.8-27b`) / `gemini` (`gemini-3.5-flash-lite`) |
| **AI Cache Mode** | `off` |

---

## 3. Database State (Before & After)

### Before Run (`cold/db-before.json`)
```json
{
  "database": "zigzag_spike_rw4_cold_live_4",
  "geoEntity": 0,
  "geoEntityIdentity": 0,
  "experience": 0,
  "experienceComponent": 0
}
```

### After Run (`cold/db-after.json`)
```json
{
  "database": "zigzag_spike_rw4_cold_live_4",
  "geoEntity": 2,
  "geoEntityByKind": { "PLACE": 2 },
  "geoEntityIdentity": 2,
  "verifiedHintMemoryEntries": 2,
  "duplicateIdentityRows": 0,
  "duplicateVerifiedHintKeysWithinKind": [],
  "experience": 0,
  "experienceByStatus": {},
  "experienceComponent": 0,
  "duplicateExperienceNames": 0,
  "experiences": [],
  "geoEntities": [
    {
      "id": "a984cfba-72e6-4df1-bdfe-d45da5ada07e",
      "name": "Bodega La Rural",
      "kind": "PLACE",
      "identities": ["openstreetmap:osm:way:425175968"]
    },
    {
      "id": "95d63e75-eaa4-458a-b142-099175546fbd",
      "name": "Terrazas de los Andes",
      "kind": "PLACE",
      "identities": ["openstreetmap:osm:way:931488145"]
    }
  ]
}
```

---

## 4. Key Pipeline Findings

1. **Acquisition Context Retention**:
   The fix in `ab63132a` successfully carried the tourism-route name and semantic search through to `relevantAnchorNames` and the web search query.
2. **Cloudflare Stability**:
   Cloudflare Workers AI provided prompt, deterministic extraction without rate limits or token quota exhaustion.
3. **Identity Verification Strictness**:
   The primary blocker is identity resolution on tourism route components:
   - "Bodega Chandon" vs "Chandon" name matching.
   - OSM coverage for regional marketing routes (which are not represented as single OSM ways/relations).
   - Nominatim / Geoapify discovery for specific winery venues.

---

## 5. Interpretation corrections (2026-09-30)

These amend the human interpretation above; the raw artifacts under `cold/`
are unchanged.

### 5.1 No `>= 70%` resolution threshold exists

§1 item 5 originally said the candidate failed "the ≥ 70% threshold". That is
incorrect. The component-resolution amendment
(`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`
§3, §12) explicitly adopts **no** percentage threshold, and production
(`CompositeResolutionCoverage`) treats `resolutionRatio` as observability only:
the admission fact is `sourceCompositionComplete` — every source-backed
component must have a RESOLVED canonical identity. 2/5 failed because it was
incomplete, not because it was below 70%.

### 5.2 The first causal defect is extraction composition, not identity

The admitted candidate was not a legitimate source-backed composition, so its
resolution failure is a downstream symptom:

- **Error A — Experience identity emitted as a fake geographic component.**
  `Ruta del Vino de Mendoza` (role `route`, `ROUTE`) is the tourism concept /
  Experience identity, not a geographic route the source establishes. RW4
  exists precisely to prove a tourism route can be a real reusable Experience
  without one canonical OSM ROUTE; its `NO_ROUTE_OBJECT_ACQUIRED` is the
  correct outcome for a component that should never have been emitted.
- **Error B — distinct source variants merged.** The Tangol Wine Bus source
  (`ev-8`) defines separate routes (Maipú: Santa Julia, Zuelo, La Rural, …;
  El Sol: Casa El Enemigo, Bressia, Séptima, …; Luján Sur: Chandon, Zolo,
  Budeguer, Casarena, Terrazas de los Andes). The candidate unioned Santa Julia
  / La Rural (Maipú) with Chandon / Terrazas (Luján Sur) — a composition the
  source never defined. Every span was a real substring (source support PASS),
  but per-component span support does not prove same-composition membership.
- **Alternatives inside a variant.** Each variant's tickets are themselves
  option sets (e.g. Luján Sur full day: "Chandon + Zolo or Budeguer + lunch …
  to choose between Terrazas de los Andes or Casarena"; Terrazas also appears
  as a lunch choice on the El Sol route). Only the "Wineries and places
  visited" line of one variant lists its members without alternation; ticket
  option sets are not mandatory membership.

Correction: the shared provider-neutral extraction contract now states that
Experience is structurally generic, GeoEntity owns PLACE/AREA/ROUTE, semantic
intents never imply a ROUTE component, the Experience identity is never its
own component, and one candidate is one coherent source-defined variant
(amendment §16.1). No downstream gate was weakened.

The Santa Julia / Chandon identity rejections remain real observations. Whether
they block a coherent single-variant candidate is for the next canonical RW4
COLD (same Serper → Tavily → Cloudflare extractor → Gemini classification
topology) to show; they are not addressed here.
