# RW3 typo normalization rerun — assessment (Serper + Cloudflare, post RW3-N5 fix)

Code under test: provider-neutral candidate proposal normalization (`sourceName`,
`normalizationKind`) preserving the Three Separate Truths across extraction,
candidate source support, entity resolution, and generation trace.
Trace-first: facts come from `cold/generation-trace.json` and `warm/generation-trace.json`.

## Gate outcome: **PASS — RW3 CLOSED → RW4 AUTHORIZED**

All RW3 invariants verified:
1. Caminito anchor resolves to canonical OSM ROUTE way (`osm:way:144844726`).
2. Anchor handoff to search and extractor passes live.
3. RW3-N5 closed: source-level misspelling ("La Bambonera stadium") in evidence
   is proposed as canonical "La Bombonera" with `sourceName: "La Bambonera stadium"`
   and `normalizationKind: "TYPO_CORRECTION"`.
4. Candidate source support verifies against the literal evidence text with
   `verifiedSupportSpan: "La Bambonera stadium"`.
5. IdentityVerifier strictly confirms "La Bombonera" against Nominatim and
   Wikidata (`osm:way:248598885`, `IdentityVerificationDecision: VERIFIED`)
   without fuzzy verifier weakening.
6. Geographic validation verifies the candidate within destination boundary.
7. COLD run completes successfully (125s, 15 GeoEntities, 14 experiences persisted).
8. WARM run completes successfully (92s, 100% CATALOG_REUSE, 0 new GeoEntities minted,
   0 new experiences minted, Day 1 stop 1 schedules the Caminito/La Boca tour).

| checkpoint | result |
| --- | --- |
| 1. interpretation | PASS — `Caminito` `named_path`/`must`, `intent:walk` |
| 2. anchor resolution (+ same-branch audit) | **PASS** — route `osm:way:144844726` SELECTED; all homonyms screened |
| 3. routing | PASS — `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `SourcePlan.web.anchorNames=["Caminito"]` |
| 4. search → extractor handoff | **PASS** — `extractor.requestAnchorNames=["Caminito"]` |
| 5. Serper evidence | Caminito/La Boca walking evidence retrieved |
| 6. Cloudflare extraction (typo normalization) | **PASS** — `name: "La Bombonera"`, `sourceName: "La Bambonera stadium"` |
| 7. Candidate source support | **PASS** — `verifiedSupportSpan: "La Bambonera stadium"` |
| 8. Entity resolution | **PASS** — `osm:way:248598885`, `decision: VERIFIED` |
| 9. Geographic validation | **PASS** — validated against destination boundary polygon |
| 10. Tour completeness & planning | **PASS** — 3 experiences scheduled per day |
| 11. Cold run completion | **PASS** — completed in 125s, DB populated |
| 12. Warm run catalog reuse | **PASS** — completed in 92s, 0 new entities minted |

## 0. Run Configuration

- Provider preflight (`cold/provider-preflight.json`):
  `groundedSearchProvider=serper`, `discoveryExtractorProvider=cloudflare`,
  `discoveryExtractorModel=@cf/qwen/qwen3.8-27b`, timeout 60000ms,
  classification `gemini` / `gemini-3.5-flash-lite`, `AI_PROVIDER=groq`.
- Database: dedicated fresh Postgres DB (`zigzag_spike_rw3_typo_norm`).
- COLD run:
  - Tour ID: `6b82f372-7d7d-4040-bffa-d4a7d3cc2d84`
  - Generation status: `completed` in 125.3 s.
  - DB before: 0 geoEntities, 0 experiences.
  - DB after: 15 geoEntities, 27 identities, 14 experiences, 0 duplicate identities.
- WARM run:
  - Tour ID: `7d446916-f98c-4c74-9fbd-4e9257d9ee36`
  - Generation status: `completed` in 92.9 s.
  - DB before: 16 geoEntities, 15 experiences.
  - DB after: 16 geoEntities, 15 experiences.
  - Net new entities minted: **0** (100% CATALOG_REUSE).

## 1. RW3-N5 Typo Normalization Architecture

### The Three Distinct Truths
1. **Source Truth:** Literal wording present in the evidence text (`"La Bambonera stadium"`).
   Captured in `GeoEntityHint.sourceName` and verified by `ComponentSourceSupportAudit.verifiedSupportSpan`.
2. **Proposal Truth:** The extractor's proposed canonical name (`"La Bombonera"`) and
   classification (`normalizationKind: "TYPO_CORRECTION"`). The extractor proposes; it never
   declares verified truth.
3. **Verified Identity Truth:** Canonical `GeoEntity` confirmed strictly by `IdentityVerifier`
   via provider matching (Nominatim `osm:way:248598885`, Wikidata `Q132734`, `EXACT_NAME` + `WIKIDATA_IDENTITY_MATCH`).
   `IdentityVerifier` remains strictly exact/unweakened.

### Controlled Cloudflare Verification
Tested live with Cloudflare Workers AI (`@cf/qwen/qwen3.8-27b`) on the exact `ev-5` typo evidence:
- Extracted:
  ```json
  {
    "key": "la-bombonera",
    "name": "La Bombonera",
    "sourceName": "La Bambonera stadium",
    "normalizationKind": "TYPO_CORRECTION",
    "role": "venue",
    "expectedKind": "PLACE",
    "evidenceKeys": ["ev-1"],
    "supportSpan": "La Bambonera stadium"
  }
  ```
- Source support check: **PASS** (`status: "SUPPORTED"`, `verifiedSupportSpan: "La Bambonera stadium"`).
- Negative test cases N5.2 (distinct places e.g. "Museo Naval" vs "Museo Nacional") and
  N5.4 (hallucinated nearby landmarks) fail closed as required.

## 2. Cold and Warm Execution Evidence

### Cold Run Itinerary
Tour `6b82f372-7d7d-4040-bffa-d4a7d3cc2d84` completed with 3 walking experiences scheduled
around the Caminito corridor in Buenos Aires.

### Warm Run Catalog Reuse & Itinerary
Tour `7d446916-f98c-4c74-9fbd-4e9257d9ee36`:
- Day 1, Stop 1: `Private Caminito & La Boca Walking Tour` (venue component: `La Bombonera`, PLACE at `-34.6355171, -58.3649163`).
- Day 1, Stop 2: `Museo Casa Taller 'Celia Chevalier'`.
- Day 1, Stop 3: `Estatua Hugo del Carril`.
- Exact zero entity mutations: catalog entities remained 16, experiences remained 15.

## 3. Engineering-Principles Completion Gate

| Principle | Result | Detail |
| --- | --- | --- |
| Provider isolation | **PASS** | Normalization fields are typed domain contracts (`GeoEntityHint`, `ComponentResolutionAudit`); no provider-name branching. |
| Typed domain contracts | **PASS** | `sourceName: string`, `normalizationKind: ComponentNormalizationKind` fully typed; no bag-of-keys or untyped metadata. |
| Normalize at boundaries | **PASS** | Extractor normalizes raw LLM output into typed `GeoEntityHint`; source support confirms verbatim substring. |
| Single policy authority | **PASS** | Source support in `component-source-support.util.ts`; candidate extraction in `experience-candidate-extraction.util.ts`; identity verification in `IdentityVerifierService`. |
| No magic semantic defaults | **PASS** | `sourceName` defaults strictly to `name` when absent; `normalizationKind` is set only when normalized name differs from source name. |
| Tests & fixtures parity | **PASS** | 8 automated unit tests in `experience-proposal-normalization.spec.ts` prove fail-closed invariants and negative cases. All 1,700 tours tests pass. |
| Clean migration cutover | **PASS** | No dual authorities or fallback branches; generation trace displays audit trail in frontend Bitácora. |

## 4. Verdict

**RW3 is CLOSED (PASS). RW4 is AUTHORIZED.**
