# Preference-First Selection — CURRENT MAIN PROGRESS

<!-- agent-track: id=preference-first-selection; status=ACTIVE; branch=feat/preference-first-selection; integration=main; base=016f10586d4faf9fe7e703a2d28684136cf99abe; plan=docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md -->

Updated: 2026-09-30
Branch: `feat/preference-first-selection`
Repository: `entity-builders-labs/zig-zag`
Canonical live-cutover plan: `docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`
Canonical implementation plan: `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
Canonical design: `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`

Current AI capability override: evidence-only classification is configured
independently through `CLASSIFICATION_PROVIDER` and provider-owned model
variables. The original Groq-only v1 claim is superseded; the evidence-only
classification contract and deterministic validation are unchanged.

> This file is the CURRENT execution pointer. Older checkpoint detail remains available in Git history and must not override the current branch state below.
>
> Code wins over stale progress text. The cutover has progressed non-linearly: M4 is already landed and substantial M5 work is already landed. Do not revert later milestone work merely because an earlier milestone needed a forward correction.

## Current execution verdict — 2026-09-29

**Trace v5 cutover — COMPLETE / ACTIVE TRACE AUTHORITY (native producer cutover complete; v4 legacy paths deleted; modular domain audit split complete; zero avoidable `any`).**  
**RW3 final classification/warm-reuse gate — CLOSED / ACCEPTED.**  
**RW4 — AUTHORIZED / NEXT GATE.**

**Active track: Gate C real-world generalization — RW4 NEXT. RW3 final live COLD/WARM acceptance passed on 2026-09-29 with sequence integrity, canonical catalog reuse, zero WARM walk acquisition/classifier calls, and Generation Trace v5 evidence.**

### Product finish-line clarification — 2026-09-29

The canonical roadmap now distinguishes two closures that must not be conflated:

```text
RW4 → RW5 → RW6
        ↓
Preference-First Core CLOSED
(research / knowledge / canonical Experience core)
        ↓
Planner Product Acceptance
        ↓
Tour Engine v1 COMPLETE
        ↓
Agentic convergence
```

RW4 remains the current execution gate. Planner Product Acceptance is **future
work, not authorization to interrupt RW4**, but it is now a mandatory product
gate before declaring Tour Engine v1 complete.

That planner gate must live-prove semantic preference influence, real routing /
travel estimates, duration/opening-hours feasibility, coherent multi-day
planning and Generation Trace v5 explainability.

The semantic-catalog retrieval choice is deliberately **DEFERRED** until that
gate. Current behavior remains embedding similarity as ranking over the
already-retrieved candidate pool. During Planner Product Acceptance, evidence
must determine whether ranking-only is sufficient or whether a VERIFIED,
destination-scoped top-K vector retrieval stage is necessary because relevant
Experiences are being excluded before semantic ranking. No change to the current
ranking-only contract is authorized merely by this documentation update.

RW3-N6 resolution and live verification status:
- **Defect:** `RW3-N6 — fixed-distance route corridor encoded semantic scope`.
- **Root cause:** A geometric diagnostic (distance from canonical route) was elevated
  into domain identity/scope policy through an arbitrary fixed 300m threshold,
  arbitrarily rejecting coherent walking components (e.g. La Bombonera at 428m from
  Caminito while accepting Quinquela Martín at 188m).
- **Architectural correction:** Pure policy `evaluateRouteScopeMembership` separates
  responsibilities cleanly:
  1. Geographic validation answers: *Does this source-backed Experience belong
     coherently to the requested geographic scope?* Anchor satisfaction is
     evaluated via real canonical identity / name match / polygon topology (`ANCHOR_COMPONENT` /
     `ON_ROUTE`), destination boundary compatibility is enforced, and coherent stops in the
     enclosing area or destination are accepted (`SAME_LOCAL_SCOPE`, `DESTINATION_COMPATIBLE_EXTENSION`).
     The residual 20m ON_ROUTE proximity threshold was removed: metric proximity never creates
     anchor truth or alters semantic membership.
  2. Planner mobility answers: *Can the user realistically walk this itinerary under
     their mobility constraints?* The canonical walking constraints
     (`maxWalkingDistancePerDayMeters`, `maxContinuousWalkingDistanceMeters`) remain
     the authority for walking feasibility (`MAX_WALKING_PER_DAY_EXCEEDED`).
  3. Distance from route is preserved strictly as diagnostic evidence
     (`distanceFromRouteMeters`), never an arbitrary semantic cut-off threshold.
- **Deterministic regressions (G1–G6 & M1–M5):** All GREEN across 50 tests in
  `composite-geographic-validation.service.spec.ts` and 10 in
  `route-scope-membership-policy.spec.ts`.
- **Clean live rerun:** Executed in `spikes/rw3-route-scope-rerun-2026-09-28/` on dedicated
  database `zigzag_spike_rw3_routescope`. Preflight confirmed canonical Serper + Cloudflare
  pair. Serper returned 10 relevant Caminito results. Cloudflare extraction returned 0
  candidates on this run. Fail-closed termination preserved. Sequence integrity preserved
  (no synthetic DB injection; WARM not run on empty catalog).
- Historical 2026-09-28 state: RW3 remained OPEN at this checkpoint. Superseded by the 2026-09-29 final acceptance below.

### RW4 COLD finding and composition-contract correction — 2026-09-30

- Canonical RW4 COLD (`spikes/rw4-mendoza-tourism-route-cloudflare-2026-09-30/`,
  HEAD `ab63132a`): **FAIL_PRODUCT_BLOCKER**, zero Experiences persisted, WARM
  not run. First causal defect: **extraction composition**, not identity. The
  Wine Bus source's distinct variants (Maipú / El Sol / Luján Sur) were merged
  into one candidate carrying a fabricated `Ruta del Vino de Mendoza` ROUTE
  self-component. Dossier assessment §5 corrected (including its wrong
  "≥ 70% threshold" claim — production requires complete resolution).
- Correction: amendment §16.1 (Experience structurally generic; GeoEntity owns
  PLACE/AREA/ROUTE; `walk`/`route_like` are semantic intents only; one
  candidate = one coherent source-backed variant; alternatives are not
  membership), enforced in the single shared extraction contract
  (`buildExperienceCompositionRules`). No schema, IdentityVerifier, gate,
  radius, provider-config or destination-specific change; no deterministic
  validator (exact name equality would reject legitimate single-place visits).
- **RW4 remains the current gate.** Next action after review: a fresh
  canonical RW4 COLD with the same Serper → Tavily → Cloudflare extractor →
  Gemini classification topology.


### RW4 COLD live-6 finding and anchor-semantics correction — 2026-09-30

- Canonical RW4 COLD live-6
  (`spikes/rw4-mendoza-tourism-route-cloudflare-live6-2026-09-30/`, HEAD
  `2ffd99c3`): **FAIL_PRODUCT_BLOCKER**, zero rows, WARM not run. Acquisition
  anchor retention, §16.1 composition semantics and the Cloudflare 4096-token
  budget were all proven working. Regional-overview sources correctly failed
  closed (wineries listed only as examples).
- First causal blocker: **extraction anchor semantics**. The shared anchor
  rule ("materially about at least one named anchor … do not emit an
  Experience the evidence does not connect to any named anchor") was applied
  as a lexical/identity gate, rejecting a concrete source-backed "Mendoza Wine
  Bike Tour" (Maipú winery sequence) because the English source never
  repeated "Ruta del Vino de Mendoza".
- Correction: amendment §16.2 — named anchors are acquisition/relevance
  context, not evidence authority; no literal occurrence required; the source
  owns identity/membership/themes/intents; generic-theme-only candidates stay
  excluded. Enforced in `buildDiscoveryAnchorContext` only. No `anchorMode`
  or anchor taxonomy, no aliases/fuzzy matching, no acquisition/query,
  source-support, IdentityVerifier, geography, candidate-count, Cloudflare
  budget or provider-topology change. §16.1 composition rules unchanged.
- Secondary (not addressed): Markdown-link `supportSpan` verification —
  becomes the next blocker only if a fresh canonical run reaches it.
- **RW4 remains the current gate.** Next action after review: a fresh
  canonical RW4 COLD with the same Serper → Tavily → Cloudflare extractor →
  Gemini classification topology.


### RW4 canonical-run provenance hardening — 2026-09-30

- live7 was noncanonical because executed build provenance was unverifiable;
  instrumentation was hardened before the next canonical RW4 COLD.
- Harness `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/`
  refuses a dirty checkout, builds the backend from HEAD for the run, launches
  it with `BUILD_COMMIT=HEAD`, and fails the run as NOT CANONICAL unless the
  trace `runtime.buildCommit` and the manifest both report that HEAD
  (`canonical-provenance.test.sh`).
- Web acquisition diagnostics (no behavior change): every extraction attempt
  is kept (`extractionAttempts`: snippet-only and deep-source), deep-source
  selection audits keep each result's search snippet, and a web failure
  records its stage (`failedStage`: SEARCH / SOURCE_SELECTION / SOURCE_FETCH /
  EXTRACTION) with the raw error.
- **RW4 remains the current gate.** Next action: a fresh canonical RW4 COLD
  through this harness with the same topology; WARM only after COLD persists
  a qualifying reusable Experience.


### RW4 side spike — Viator structured itineraries — 2026-10-01

- HEAD `53eb0674`. Supporting evidence only; RW4 gate status unchanged, no
  production code touched. Artifacts:
  `spikes/rw4-viator-structured-itinerary-2026-10-01/` (README = findings).
- Access: the available key is a **sandbox** affiliate key (production
  `/products/tags` → 401 Invalid API Key; sandbox → 200). The spike ran on
  the sandbox: schema conclusions hold, per-product counts need production
  re-confirmation.
- Sample: 10 Mendoza wine products (6 fixed queries, content-blind rank
  round-robin) + 1 labeled HOHO supplement (Wine Bus `5674P1222`).
  STRUCTURED_COMPLETE 3 / STRUCTURED_BUT_AMBIGUOUS 3 / UNSTRUCTURED 1 /
  NO_USABLE_COMPOSITION 3. ≥2 concrete stops 6/10; all itinerary
  locations with coordinates 9/10; textual extraction needed 1/10.
- Strongest: `199477P3` Chandon → Budeguer → Lagarde; `5668946P2` Viña el
  Cerno → Pasrai → Florio → Vistandes → Chocolezza (TRIPADVISOR refs with
  name + coordinates, ordered).
- Main conclusion: **PARTIALLY**. STANDARD items give ordered, source-owned
  refs with names + coordinates. But Viator exposes no optional/alternative
  flag (only `passByWithoutStopping`) and no location type. Substitutions
  ("may vary: X, Y or Z") and area-vs-place both live in prose/names, so A
  and B are structurally identical. The Wine Bus product reproduces RW4's
  merged-variant trap as a weekday-union HOHO with 6 options.
- Identity: `TRIPADVISOR` refs = Viator-native opaque id + name + address +
  coords, stable across products/suppliers. No OSM/Wikidata/external TA id.
  `GOOGLE` refs (all logistics/HOHO stops) = Google place id only.
- Open: production counts; whether the API exposes structured substitution
  data; a component-level `attractionId` contract; Google ref resolution
  cost/terms; an AREA-item policy.
- Recommended next step (not authorized by this entry): a production-key
  rerun of the same harness. If counts hold, design a
  `ViatorStructuredExperienceSource` adapter emitting source-owned
  candidates (STANDARD only, ambiguity screened with the existing evidence
  classifier) into the existing identity/geography validation. Do not
  interrupt the RW4 web-acquisition gate for it.


### RW4 deterministic request control + canonical COLD #9 — 2026-10-01

- Why COLD #8 was not downstream-comparable: COLD #7's `intent:visit` came
  only from free-text interpretation (`source: free_text`, weight 0.9).
  Both runs sent `canonicalRequest.intent.intents = ["route_like"]`. COLD #8's
  interpreter did not emit `visit`, so the generic partition was
  `theme:wine` only (COLD #7: `theme:wine` + `intent:visit`).
- Request control (harness commit `c0c90269`
  `test(spikes): stabilize RW4 canonical request intents`): the fixture
  `request.json` now states the scenario's request semantics explicitly
  through the normal wizard contract: `interests: [wine]`,
  `intents: [route_like, visit]`. The free text is unchanged and is still
  interpreted normally. `request-stimulus.cjs` gates the fixture before any
  build/provider call and records `input-control.json` (wizard facets +
  area_route_walk/generic partition) after the run. It never asserts on
  sources, candidates or places (`request-stimulus.test.sh` 9/9).
- Production code unchanged: `git diff 1e3eceb8 c0c90269 -- be/` is
  empty. COLD #9 source HEAD = harness commit `c0c90269`, whose production
  tree equals fix `1e3eceb8`. Dist SHA256 `e0211015a3208e07...` is
  byte-identical to COLD #8's.
- Canonical COLD #9: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold9/`
  (label `cold9` because `cold/` is the versioned COLD #8 dossier; DB
  `zigzag_spike_rw4_canonical_cold_9`, port 4109). **CANONICAL**: source
  HEAD = manifest `sourceHead`/`buildCommit` = trace `runtime.buildCommit` =
  `c0c90269de2a1acaa519e311e306e041dc2be403`; `canonical: true`,
  `failures: []`; `AI_CACHE_MODE=off`; fresh DB; preflight PASS. Provider
  chain identical to COLD #7/#8.
- Input control: **PASS**. Wizard facets `theme:wine`,
  `intent:route_like`, `intent:visit`; routing `area_route_walk`:
  `intent:route_like`, generic: `theme:wine`, `intent:visit`.
  **REQUEST REPRODUCIBILITY VS COLD #7 = PASS.**
- Upstream vs COLD #7:
  - Facets: SEMANTICALLY_EQUIVALENT (`visit` is now wizard/1.0, was free_text/0.9).
  - Deficits and partition: SAME.
  - Generic source plan (wikivoyage, google_places, web): SAME.
  - `requestedIntents` [`visit`]: SAME.
  - Generic `anchorNames` (none): SAME.
  - `semanticQuery`: SEMANTICALLY_EQUIVALENT ("wine route mendoza wineries" vs "wine route Mendoza vineyards").
  - Generic web query: SEMANTICALLY_EQUIVALENT (only that suffix differs).
  - Search results: SolSalute at rank 1 in both.
  - Deep fetch: triggered in both (no admissible multi-component candidate); SolSalute selected in both.
  - The COLD #8 divergence (snippet-qualified candidate suppressing deep fetch) is gone.
- Live acquisition: SolSalute retrieved through Cloudflare (88,401 chars,
  87 chunks; identical to COLD #7). `RELEVANCE_WINDOWS` kept excerpts
  9033–10465, 17400–18757, 23637–25694 and 35229–36327, but NOT
  41153–43907 ("Sample Mendoza Winery Itineraries"), which COLD #7 kept.
  Deep extraction returned 0 candidates. The Uco candidate was NOT exercised.
- Earliest divergence, proven by deterministic offline replay of the
  production `windowSourceContent` over the same SolSalute markdown
  (`cold9/analysis/window-replay.cjs`, `.out.json`, source
  `spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md`):
  - COLD #7 inputs → COLD #7 excerpts exactly; Alfa Crux, SuperUco, Bodega
    Azul, Corazon del Sol and Solo Contigo all retained.
  - COLD #9 inputs → COLD #9 excerpts exactly; only Alfa Crux retained.
  - Swapping only the Serper snippet for the SolSalute URL flips the result
    both ways; the query difference is irrelevant.
  - COLD #7's snippet contained "…sample itineraries…"; COLD #9's did not.
  - Classification: OTHER — windowing relevance sensitive to the volatile
    search snippet used as same-source context.
- Did the request control remove the COLD #8 divergence? **YES**. The
  remaining nondeterministic seam is the Serper snippet text for the same
  URL, consumed by windowing relevance. Not fixed in this task.
- Route intent propagation: the generic pass materialized 10 single-PLACE
  Experiences from structured sources (wikivoyage + google_places
  corroboration, 14 proposals). Generic `geography.validation` recorded
  `validationIntent: route_like`, so `routeScale = true` by construction;
  the trace does not record `routeScale` itself. No `WITHIN_*`/`OUTSIDE_*`
  destination-compatibility verdict was emitted. Three single-venue
  candidates were rejected `destination_mismatch` (OUTSIDE 2.4–4.3 km)
  under the existing venue polygon policy, which is unchanged.
- Outcome: `generationStatus: completed`, 5 Experiences planned (1 day).
  DB before → after: GeoEntity 0 → 13 (PLACE), GeoEntityIdentity 0 → 13,
  Experience 0 → 10, ExperienceComponent 0 → 10, verifiedHintMemoryEntries
  0 → 13. No multi-component candidate reached resolution, so the Uco
  Experience was not persisted and is not planner-eligible. WARM: NOT RUN
  (no qualifying reusable multi-component Experience).
- Previous fixes:
  - `GROUNDED EVIDENCE TRACE`: LIVE-PROVEN
  - `SOURCE WINDOWING`: LIVE-PROVEN as a deterministic mechanism (replay
    reproduces both runs; not regressed). It is also where the blocker lives.
  - `ANCHOR RELEVANCE`: LIVE-PROVEN (area_route_walk selection used anchor "Ruta del Vino de Mendoza")
  - `MARKDOWN SUPPORT`: NOT EXERCISED
  - `CANDIDATE-INVALIDITY DEEP-FETCH`: NOT EXERCISED (both triggers were "no admissible multi-component candidate")
  - `CLOUDFLARE SOURCE RETRIEVAL FIDELITY`: LIVE-PROVEN (SolSalute 88,401 chars, identical normalization to COLD #7)
  - `REQUEST-LEVEL ROUTE INTENT PROPAGATION`: LIVE-PROVEN (10 generic materializations under `route_like`)
- First causal blocker: `deep-source relevance windowing ranks SolSalute's
  87 chunks with the volatile Serper snippet as same-source context; with
  COLD #9's snippet the "Sample Mendoza Winery Itineraries" chunk
  (41153–43907) is dropped, so the source-defined Uco composition never
  reaches extraction (replay: COLD #7 snippet 5/5 retained, COLD #9
  snippet 1/5)`.
- Convergence: **COLD #9 FARTHER DOWNSTREAM THAN COLD #7 = NOT COMPARABLE**.
  The input was reproduced, but the live path diverged before Uco extraction
  because of external snippet variation. This is not a regression of
  `1e3eceb8`.
- Evidence (versioned with this entry): `cold9/generation-trace.json`,
  `provenance.json`, `run-manifest.json`, `request-stimulus.json`,
  `input-control.json`, `db-before.json`, `db-after.json`,
  `provider-preflight.json`, `provider-config.txt`,
  `provider-requests.ndjson`, `backend.log`, `build.log`, `run.log`,
  `terminal-tour.json`, `analysis/window-replay.{cjs,out.json}`, plus the
  replay source dossier `spikes/rw4-cloudflare-source-fidelity-2026-10-01/`.


### RW4 request-level route intent propagation + canonical COLD #8 — 2026-10-01

- Fix `1e3eceb8` (`fix(tours): preserve request route intent across
  acquisition passes`): `deriveRequestValidationIntent`
  (`be/src/modules/tours/utils/request-validation-intent.util.ts`) derives
  the geographic `validationIntent` ONCE from `PreferenceSpec.facets`
  (intent dimension only) and `ExperienceGenerationService` passes it through
  the execution context of every generic and `planner_capacity`
  materialization. It is no longer reconstructed from strategy-local
  `plan.deficits`. Mixed `walk` + `route_like` still fails closed
  (`undefined` + warning). Candidate `intents` never grant geographic
  authority. Destination resolution, compatibility policy, radii,
  Places/Geoapify, composition, prompts and AreaRouteWalk's own
  `intentKey` are unchanged.
- Deterministic regressions: `request-validation-intent.util.spec.ts`
  (route_like / walk / none / mixed / intent-dimension-only) and
  `experience-generation.acquisition-orchestration.spec.ts` (Case A generic
  partition `theme:wine`+`intent:visit` with request `route_like` →
  `route_like`; B walk; C none → `undefined`; D mixed → `undefined`;
  plan-deficit route_like without request intent → `undefined`; E same
  request intent across `generic` and `planner_capacity` → identical).
  Gates: typecheck, lint, unit 177/2262, integration 23/103 and e2e 4/41 on
  `zigzag_test`, build, `git diff --check` — all green.
- Canonical COLD #8: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold/`
  (DB `zigzag_spike_rw4_canonical_cold_8`, port 4108,
  `WEB_SOURCE_CONTENT_PROVIDER=cloudflare`). **CANONICAL**: source HEAD =
  manifest = trace `runtime.buildCommit` = fix commit
  `1e3eceb8030869f317f09014d08981ad391eeb24`; dist SHA256
  `e0211015a3208e07...`; `canonical: true`, `failures: []`;
  `AI_CACHE_MODE=off`; fresh DB; preflight PASS. COLD #7 artifacts moved to
  `cold_prev_13933cc7/`. Same provider chain as COLD #7 (serper / cloudflare
  Browser Rendering / cloudflare `@cf/qwen/qwen3.8-27b` / geoapify).
- Route-intent propagation, live: request facets `theme:wine`,
  `intent:route_like`; routing sent `route_like` to `area_route_walk` and
  only `theme:wine` to generic; generic `geography.validation`
  (`acquisition-pass-1-generic`) recorded `validationIntent: route_like`
  (COLD #7: `undefined` on all 11 candidates).
- Uco candidate NOT rediscovered (upstream non-determinism, not a
  regression). The preference interpreter (groq `qwen/qwen3.8-27b`) did not
  emit `intent:visit` this time, so generic deficits and the Serper query
  differed. SolSalute was still `ev-0`, but snippet-level extraction
  produced "Mendoza Traditional Wineries Tour" (Bodega Don Manuel Villafañe +
  Bodega El Enemigo de Alejandro Vigil, `ev-5`). That already satisfied
  `MULTI_COMPONENT_EXPERIENCE`, so no composition gap → no deep fetch →
  SolSalute never retrieved. Composition/optional semantics were therefore
  not re-exercised.
- Component resolution (generic, `route_like` active): both hints went
  catalog → trusted observation → local OSM pool (176) → Nominatim (0) →
  Geoapify `geocode-search` (10 results). Selected Bodega Centenario /
  Bodega Gieco were REJECTED by IdentityVerifier → `UNCONFIRMED_MATCH`, 0/2
  resolved. No component obtained coordinates for its own identity, so
  destination compatibility was never evaluated (zero
  `WITHIN_*`/`OUTSIDE_*` verdicts in the trace).
- 50 km radius observation (observe only, not changed): replaying the
  exact Geoapify request at 50 km returns only token-level "Bodega …"
  matches (all < 40 km); at 80 km neither winery appears either. Local
  Nominatim has OSM "Restaurante El Enemigo" / "Casa El Enemigo Vigil"
  (Maipú) but nothing under the source names. **The 50 km hard filter is
  NOT the causal blocker in COLD #8.**
- area_route_walk: deep fetch triggered with reason "no admissible
  multi-component candidate" (argentina.travel retrieved and windowed to
  5,959 chars; discoverywinemendoza `rate_limited` by Cloudflare); deep
  extraction returned 0 candidates.
- Outcome: `generationStatus: failed` (coverage insufficient for
  `theme:wine`, `intent:route_like`). DB before → after: GeoEntity 0 → 0,
  GeoEntityIdentity 0 → 0, Experience 0 → 0, ExperienceComponent 0 → 0,
  verifiedHintMemoryEntries 0 → 0. Uco Experience persisted: NO; planner
  eligible: NO. WARM: NOT RUN (nothing reusable persisted).
- Previous fixes:
  - `GROUNDED EVIDENCE TRACE`: LIVE-PROVEN
  - `SOURCE WINDOWING FIX`: LIVE-PROVEN (argentina.travel)
  - `ANCHOR RELEVANCE FIX`: LIVE-PROVEN (anchor "Ruta del Vino de Mendoza" in ARW source selection)
  - `MARKDOWN SUPPORT FIX`: NOT EXERCISED (deep extraction produced no candidate)
  - `CANDIDATE-INVALIDITY DEEP-FETCH FIX`: NOT EXERCISED
  - `CLOUDFLARE SOURCE RETRIEVAL FIDELITY`: NOT EXERCISED for SolSalute (1 retrieved, 1 `rate_limited`)
  - `REQUEST-LEVEL ROUTE INTENT PROPAGATION`: LIVE-PROVEN at the
    materialization seam. The route-scale destination policy it enables
    was NOT EXERCISED (no component reached compatibility).
- First causal blocker: `named winery PLACE identity acquisition for the
  generic multi-component candidate: Nominatim returns 0 for the source
  names and Geoapify geocode-search returns only token-level "Bodega …"
  matches that IdentityVerifier correctly rejects, so no component reaches
  destination compatibility (radius-independent: absent at 50 km and 80 km)`.
- Convergence: **Farther downstream than COLD #7 = NO**. The run diverged
  upstream (LLM preference interpretation → query → snippet-level candidate),
  the Uco candidate was not rediscovered and no tour was produced. The fix
  itself is live-proven at its seam.
- Evidence (versioned with this entry): `cold/generation-trace.json`,
  `cold/provenance.json`, `cold/run-manifest.json`, `cold/build.log`,
  `cold/db-before.json`, `cold/db-after.json`,
  `cold/provider-preflight.json`, `cold/provider-config.txt`,
  `cold/provider-requests.ndjson`, `cold/backend.log`, `cold/run.log`,
  `cold/terminal-tour.json`. The COLD #7 dossier is versioned under
  `cold_prev_13933cc7/`.


### RW4 Cloudflare source fidelity spike + canonical COLD #7 — 2026-10-01

- Part 1 Standalone Fidelity Spike: `spikes/rw4-cloudflare-source-fidelity-2026-10-01/`.
  Tested exact bare URL `https://solsalute.com/blog/mendoza-argentina-wine-capital/` via production
  `CloudflareWebSourceContentProvider` semantics (Browser Rendering `/markdown`, no URL mutation).
  Result: **CLOUDFLARE FIDELITY = PASS** (88,401 chars in 2,625ms; 11/11 deterministic assertions
  PASS: Alfa Crux, SuperUco, Bodega Azul, Corazon del Sol, Solo Contigo, 10 am, 12 pm, 2:30 pm,
  ordered list numbering, and optional bonus tasting prose intact).
- Canonical COLD #7: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold/`
  (DB `zigzag_spike_rw4_canonical_cold_7`, port 4107, `WEB_SOURCE_CONTENT_PROVIDER=cloudflare`).
  **CANONICAL**: source HEAD = manifest sourceHead/buildCommit = trace `runtime.buildCommit` =
  `13933cc7885249ff9316303e0dd9f8d7cd8c4bab`; dist SHA256 `0c5d8f537a9d34a7...`;
  `canonical: true` in `provenance.json`; `AI_CACHE_MODE=off`; preflight PASS.
  COLD #6 artifacts preserved in `cold_prev_0e6d8d6d/`.
- Provider Chain: `GROUNDED_SEARCH_PROVIDER=serper`, `WEB_SOURCE_CONTENT_PROVIDER=cloudflare`,
  `DISCOVERY_EXTRACTOR_PROVIDER=cloudflare` (`@cf/qwen/qwen3.8-27b`), `PLACES_PROVIDER=geoapify`.
- Lifecycle Execution:
  - Deep retrieval (Step 25): SolSalute retrieved via Cloudflare Browser Rendering in 6,233ms,
    delivering 88,401 chars of rich markdown.
  - Windowing: `RELEVANCE_WINDOWS` selected chunk 41,153–43,907 retaining 5,953 chars containing
    the complete Uco Valley itinerary (all 5 entities confirmed present before and after windowing).
  - Semantic Extraction (Step 26): Cloudflare Qwen extracted "Uco Valley Wine Tasting Itinerary"
    with 3 mandatory components (Alfa Crux, SuperUco, Bodega Azul), respecting source structure and
    omitting optional bonus tasting (Corazon del Sol / Solo Contigo).
  - Source Support Audit: Verified all 3 components against markdown link spans (`DECLARED_KEY_VERIFIED`,
    `SUPPORTED`). Admitted as `MULTI_COMPONENT_EXPERIENCE`.
  - Entity Resolution (Step 27): Evaluated against destination geography: Bodega Azul rejected as
    `DESTINATION_INCOMPATIBLE` (outside Ciudad de Mendoza boundary), Alfa Crux / SuperUco `NO_CANDIDATE_ACQUIRED`.
  - Tour Generation: Succeeded (`generationStatus: completed`), persisting 10 verified urban experiences
    (DB before: 0 → after: 10 GeoEntities, 10 Identities, 10 Experiences, 10 Components, 10 Hints).
- First causal blocker for persisting the Uco Valley multi-component experience:
  `destination scope incompatibility: "Mendoza, Argentina" resolved to the tight administrative boundary of Ciudad de Mendoza (osm:relation:4206710), rejecting Valle de Uco components located ~80 km south (Bodega Azul DESTINATION_INCOMPATIBLE, Alfa Crux/SuperUco NO_CANDIDATE_ACQUIRED)`.
- Previous fixes status:
  - `GROUNDED EVIDENCE TRACE`: LIVE-PROVEN
  - `SOURCE WINDOWING FIX`: LIVE-PROVEN
  - `ANCHOR RELEVANCE FIX`: LIVE-PROVEN
  - `MARKDOWN SUPPORT FIX`: LIVE-PROVEN
  - `CANDIDATE-INVALIDITY DEEP-FETCH FIX`: NOT EXERCISED
  - `TAVILY ADVANCED REQUEST CONFIGURATION`: NOT EXERCISED in COLD #7 (Cloudflare used)
  - `CLOUDFLARE SOURCE RETRIEVAL FIDELITY`: LIVE-PROVEN
- Convergence: **Farther downstream than COLD #6 = YES** (progressed past retrieval loss, past windowing,
  past extraction, past source-support audit, past admission, reaching entity resolution and completing
  a verified tour).
- Forensic refinement (2026-10-01, after COLD #7): the blocker above
  describes the observed failure point. Trace forensics refined the FIRST
  causal blocker to: **request-level `route_like` context was lost in the
  generic acquisition pass before regional destination compatibility could
  be exercised**. Evidence: the request had `intent:route_like`; routing
  moved it to `area_route_walk` (generic got `theme:wine`, `intent:visit`);
  generic `geography.validation` recorded `validationIntent` undefined
  (`routeScale=false`). Fixed by `1e3eceb8` (see COLD #8). The dossier moved
  from `cold/` to `cold_prev_13933cc7/`.


### RW4 Tavily advanced extraction fix + canonical COLD #6 — 2026-10-01

- Fix `0e6d8d6d`: `TavilyWebSourceContentProvider` explicitly requests `extract_depth = 'advanced'`
  and `format = 'markdown'`. Client `AbortSignal` timeout increased to 45s (compatible with
  Tavily's documented 30s server default for advanced extraction). Local AI cache key versioned
  as `extract:v2:advanced:markdown:<url>` so stale legacy basic extractions (missing lists)
  are isolated and never reused. Tests pass: 14/14 focused, 128/128 tours suite, 1837/1837 tests.
- COLD #6: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold/`
  (DB `zigzag_spike_rw4_canonical_cold_6`, port 4106, Tavily). **CANONICAL**:
  source HEAD = manifest sourceHead/buildCommit = trace `runtime.buildCommit` = `0e6d8d6d877bb3629104d055aaefda921e0345de`;
  `canonical: true` in `provenance.json`; `AI_CACHE_MODE=off`; preflight PASS.
  COLD #5 artifacts preserved in `cold_prev_029730a6/`.
- Outcome: generation `failed` (coverage: `theme:wine`, `intent:route_like`),
  DB 0 → 0 for every table. WARM not run (as per rule: no qualifying Experience persisted).
- Fix verification:
  - Request payload: live logs confirm `[TavilyWebSourceContentProvider] Tavily extract: requesting 2 URLs (depth=advanced, format=markdown, timeout=45000ms)`.
  - Cache isolation: Zig-Zag local AI cache had a clean miss on the fresh database, sending the live request to Tavily.
  - Deep fetch triggering: Pass 0 and Pass 1 both triggered deep retrieval (`attempted: true`, `reExtractionAttempted: true`).
- Provider behavior / Causal blocker:
  - **Tavily edge/server-side cache trap confirmed live**: Tavily's servers cached the prior basic extraction for the exact bare URL `https://solsalute.com/blog/mendoza-argentina-wine-capital/`. Despite Zig-Zag explicitly sending `extract_depth: "advanced"`, Tavily responded in 635ms with its cached 52,974-character basic payload where all `<ol>` list elements remain stripped (`Alfa Crux: false`, `SuperUco: false`, `Bodega Azul: false`).
  - Pass 0 deep fetch retrieved `discoverywinemendoza.com` (11,756 chars) and `argentina.travel` (2,709 chars).
  - In both passes, Cloudflare Qwen extractor received the truncated/list-free source text and returned `{"candidates": []}`.
  - As observed in the fidelity spike and per production rules, Zig-Zag does NOT invent artificial URL mutations or query parameter cache-busting in production unless supported by official provider contracts. Official Tavily Extract API documentation confirms no `use_cache` or refresh parameter exists for `/extract`.
- Previous fixes status:
  - `029730a6` (candidate invalidity does not block deep fetch): LIVE-PROVEN / ACTIVE (deep fetch triggered in both passes).
  - `0e6d8d6d` (Tavily advanced request contract): LIVE-PROVEN / ACTIVE (explicit advanced payload, 45s timeout, and v2 cache key sent in production runtime).
- **RW4 remains the current gate.**


### RW4 Tavily extract fidelity spike — 2026-10-01

- Spike: `spikes/rw4-tavily-extract-fidelity-2026-10-01/`.
- Tested URL: `https://solsalute.com/blog/mendoza-argentina-wine-capital/`.
- Origin reference: direct HTTP fetch (476,591 chars, SHA256 `f1af4e42...`).
  Proves origin HTML contains `<ol class="wp-block-list">` under "Uco Valley Itinerary"
  with stops Alfa Crux (10 am), SuperUco (12 pm), and Bodega Azul (2:30 pm), plus
  Lujan de Cuyo itinerary (A16, Ojo de Agua).
- Four-arm live evaluation against Tavily `/extract`:
  - `basic + markdown`: 52,974 chars, 1.80s, stops LOST (0/3), ordered list dropped.
  - `advanced + markdown`: 85,287 chars, 5.58s, stops PRESERVED (3/3: Alfa Crux,
    SuperUco, Bodega Azul), schedules, outbound links, and prose intact.
  - `basic + text`: 34,123 chars, 1.90s, stops LOST (0/3), ordered list dropped.
  - `advanced + text`: 50,517 chars, 16.50s, stops PRESERVED (3/3).
- **Spike verdict: RESULT A — ADVANCED FIXES IT.**
  The COLD #5 source-content loss was a configuration issue: Zig-Zag relied on Tavily
  `/extract`'s default `extract_depth = "basic"`, whose HTML parser systematically
  strips HTML list blocks (`<ol>`, `<ul>`), losing all structured itinerary stops.
  `extract_depth = "advanced"` uses deep DOM rendering and preserves the complete
  itinerary composition.
- **Format impact**: Format (`markdown` vs `text`) does NOT resolve the loss (`basic + text`
  also strips all lists). The loss happens at HTML filtering before serialization.
- **Provider server-side cache trap**: Tavily caches extractions on its servers by URL.
  If a URL was previously extracted with `basic`, subsequent requests with `advanced`
  for that identical URL return the cached `basic` payload (in ~10ms, usage credits = 0).
  Production deep extraction must account for provider cache behavior.
- **Timeout risk**: Tavily documentation specifies a 30s default timeout for `advanced`
  (up to 60s). In this spike, `advanced-text` took 16.50s, which would have aborted
  under Zig-Zag's current hardcoded 15s client timeout.
- **Credit cost**: Basic = 0.2 credit/URL; Advanced = 0.4 credit/URL. At `selectionLimit = 2`,
  advanced costs 0.8 credits ($0.0064) vs basic 0.4 credits ($0.0032). Delta is $0.0032
  per tour run (negligible).
- **COLD #6 recommendation**: Run COLD #6 with Tavily `advanced` once production
  provider configuration and timeout are updated. No replacement provider needed for RW4.


### RW4 deep-fetch eligibility fix + canonical COLD #5 — 2026-10-01

- Fix `029730a6`: a candidate-level validation error (canonical COLD #4,
  `componentHints: []` over the WelcomeArgentina "outings" snippet) no
  longer suppresses deep-source retrieval for an unsatisfied
  `MULTI_COMPONENT_EXPERIENCE`. Typed
  `ExperienceExtractionResult.extractionFailures` now carries only
  whole-response failures (credentials, truncation, unparseable JSON,
  unrecognized envelope); only those keep deep retrieval fail-closed.
- COLD #5: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold/`
  (DB `zigzag_spike_rw4_canonical_cold_5`, port 4105, Tavily). **CANONICAL**:
  source HEAD = manifest sourceHead/buildCommit = trace
  `runtime.buildCommit` = `029730a6`; `AI_CACHE_MODE=off`; preflight PASS.
  COLD #4 artifacts moved to `cold_prev_53eb0674/`.
- Outcome: generation `failed` (coverage: `theme:wine`, `intent:route_like`),
  DB 0 → 0 for every table. WARM not run.
- Fix path **not exercised**: no candidate-level validation error occurred.
  Run diverged upstream of the fix: the live preference interpreter emitted
  `theme:wine` (COLD #4: `theme:food`), so the COLD #4 food/POI
  materializations and the pass-3 query that surfaced the outings page never
  happened; pass-2 web plans were ledger-skipped as identical.
- Deep retrieval ran in both pass-1 web plans (existing trigger, no
  errors): discoverywinemendoza + sakwinetravel (area plan), solsalute +
  winesofargentina (generic plan). Every deep extraction returned
  `{"candidates": []}`.
- What the full sources contained: discoverywinemendoza lists per-subroute
  "Featured wineries" (highlights, not a defined itinerary); winesofargentina
  describes three wineries visited separately over a month; sakwinetravel
  is product links. None is one coherent source-defined composition
  (§16.1), so `[]` there is consistent. **solsalute's HTML does define one**
  ("Uco Valley Itinerary": Alfa Crux 10am → SuperUco 12pm → Bodega Azul
  2:30pm; optional stops excluded), but Tavily's Markdown (52,974 chars;
  a forensic re-extract had the same length) keeps only the itinerary headings and intros
  and drops both stop lists. Windowing kept that region intact; the stops
  never reached it.
- **First causal blocker:** source-content retrieval drops the ordered
  itinerary stop list present in the source HTML (solsalute), so the only
  coherent source-defined composition never reaches deep extraction.
- Previous fixes: grounded evidence trace LIVE-PROVEN; source windowing
  LIVE-PROVEN (RELEVANCE_WINDOWS on 3 of 4 sources, audited offsets);
  anchor relevance NOT EXERCISED; Markdown support NOT EXERCISED (no deep
  candidate reached source support).
- **RW4 remains the current gate.** Next step (not authorized by this
  entry): characterize retrieval fidelity for list-structured itineraries
  (Tavily Markdown vs Cloudflare transport on the same URL) before any
  change, then a fresh canonical COLD.


## RW3 final acceptance — 2026-09-29

**RW3 = CLOSED / ACCEPTED. RW4 = AUTHORIZED / NEXT GATE.**

Canonical evidence: `spikes/rw3-final-acceptance-2026-09-29/`.

Acceptance facts:

- deterministic verification passed: 126 tours suites / 1737 tests, targeted invariant suites, typecheck, lint, build and `git diff --check`;
- COLD started from an empty dedicated database and materialized the verified 4-component Experience `f5dee6f9-6070-437e-bdf1-e8262af6d27d` (`La Boca Walking Tour: Caminito, Museum, and Bridge`);
- COLD persisted current evidence-only classification including `intent:walk`;
- `cold/db-after.json` matched `warm/db-before.json` byte-for-byte; no inter-run patching or reset occurred;
- WARM initial catalog coverage was sufficient and reused the same canonical Experience;
- WARM performed zero Caminito/walk web acquisition, zero Tavily extraction and zero Gemini classification calls;
- WARM database cardinalities did not grow and the same Experience was scheduled as Day 1 stop #1;
- both runs completed through the real HTTP/outbox/processor path with native Generation Trace v5;
- no production behavior change was required for acceptance; the only non-spike source changes in the evidence commit were formatting-only.

The final acceptance supersedes every earlier RW3 OPEN / pending-rerun statement below. Historical RW3 defect/rerun detail remains evidence, not current status.

The component-resolution / RW1 milestone is **COMPLETE / CLOSED** and must not
be reopened unless a real regression invalidates an accepted invariant. The
post-milestone Experience-dedupe defect is also **fixed deterministically**.
The remaining live confirmation of that dedupe shape is observationally
inconclusive because the upstream web extractor did not emit a qualifying
standalone+composite pair during the bounded rerun.

Current execution state:

- **Component-resolution / RW1:** CLOSED.
- **Experience dedupe policy correction:** DONE. Commit
  `d6f060344073eba101f16ee8ebc1a798a9aed378`
  (`fix(tours): separate membership from experience identity`) preserves
  standalone/composite coexistence without weakening same-Experience dedupe.
- **Focused deterministic dedupe regression:** GREEN. The historical
  standalone-vs-composite order-dependence is fixed in deterministic coverage.
- **Post-dedupe live re-confirmation:** **INCONCLUSIVE DUE TO EXTRACTION
  VARIANCE**. Three bounded COLD reruns emitted no qualifying composite, so the
  target live shape was never reached. This does not reopen or invalidate the
  deterministic dedupe fix.
- **RW2 findings closure:** DONE (committed in `b6d2e1ae`). Finding 1
  (GENERIC structured-anchor propagation) fixed; Finding 2 wording corrected
  (walking-constraint rejection, not "planner preferred museums"); Finding 3
  (bitácora composition gap) fixed; walking rejection now auditable with
  actual-vs-limit facts. Walking policy itself unchanged.
- **RW3 Caminito route:** IN PROGRESS (N5 design proven) — F1 generalized,
  audit-free fingerprints and typed anchor handoff landed in `d6149363`; post-run
  hardening in `bb51a253` closed fuzzy Nominatim screening, Places candidate
  selection, and verified supportSpan auditability deterministically.
  RW3-N5 design closed via provider-neutral typo normalization. Preceding rerun
  in `spikes/rw3-typo-normalization-rerun-2026-09-27/` had invalid sequence
  integrity (`cold/db-after` != `warm/db-before`) and no walk candidate persisted
  in COLD. Clean rerun pending; RW4 NOT AUTHORIZED. See §RW3.
- **Extractor/provider reliability:** supporting evidence track. The frozen
  Run-3 corpus remains the controlled boundary for isolating evidence, model,
  transport and sampling behavior (e.g. the RW2 Serper → Cloudflare delta).

### Extractor/provider evidence landed

1. **Frozen extractor corpus built.** Exact Run-3 requests and normalized
   evidence are preserved under
   `spikes/extractor-reliability-run3-replay-2026-09-25/`, including
   `case-a`, `case-b`, and the strongest `single-evidence` fixture.
2. **Groq/Qwen stochasticity characterized.** With
   `qwen/qwen3.8-27b`, temperature `.7` and the exact frozen inputs, the
   same evidence produced CANDIDATE, semantic-empty and invalid-output
   outcomes. `max_completion_tokens=4096` also caused a hard Groq OTPM
   blocker on the on-demand tier.
3. **Token budget isolated from semantic yield.** A 900-token completion
   budget is sufficient for the complete three-component San Telmo candidate
   and removes the observed Groq OTPM request-size blocker; lowering the budget
   did not by itself repair semantic yield. Groq's 200k TPD quota later blocked
   completion of the controlled matrix.
4. **Temperature signal remains provisional.** At `temperature=0`,
   the two clean Groq single-evidence samples were byte-identical and emitted
   the same complete three-component candidate. The third logical call failed
   on TPD, so this remains a strong but small-N signal rather than a completed
   conclusion.
5. **Cloudflare is now a first-class fourth discovery extractor.** Commit
   `b3ce4ec` added `cloudflare` beside Gemini/Groq/Ollama, with
   `CLOUDFLARE_DISCOVERY_MODEL` configurable and
   `@cf/qwen/qwen3.8-27b` used initially to isolate provider behavior without
   changing model family. No automatic fallback was added and Groq remained
   independently selectable.
6. **Cloudflare reasoning transport was characterized and corrected.** Live
   smoke evidence showed the Cloudflare Qwen variant spending the 900-token
   budget in `message.reasoning`, returning `content=null` with
   `finish_reason=length`. The provider-specific transport fix in
   `c1aa8d2` sets
   `chat_template_kwargs: { enable_thinking: false }` and strips the observed
   JSON code fence before the existing deterministic JSON/parser boundary.
   The prompt, model, candidate semantics, temperature and 900-token budget
   were not changed.
7. **Cloudflare frozen single-evidence ×5 characterized.** Evidence in
   `b57519c` produced **4/5 CANDIDATE + 1/5 PROVIDER_FAILURE (60s timeout)**.
   The four successful raw model contents were byte-identical, with the same
   `San Telmo Walking Tour` and ordered component set
   `Lezama Park → Plaza Dorrego → El Mercado de San Telmo`, all source
   supported. There were **0 NO_CANDIDATE, 0 INVALID_JSON and 0 HTTP 429**
   outcomes. Successful latency was approximately **22–40s**, versus roughly
   **1.5s** for the small successful Groq temperature-0 sample.

8. **Cloudflare frozen case-b ×5 characterized.** Evidence in `7c5ed36c`
   produced **5/5 CANDIDATE, 0 timeout, 0 HTTP 429** (latency 7.9–10.3s).
   Component set **not stable**: `Lezama Park` omitted in 4/5 despite explicit
   `ev-4` support; `Calle Defensa` present in `ev-1` but omitted from all
   extracted composites. `temperature=0` does not eliminate
   bundle-context/component-set sensitivity. `case-a` deferred / not required
   before RW2.

Interpretation stays deliberately bounded:

```text
successful Cloudflare samples
→ strong semantic/output determinism for this frozen fixture

4/5 overall with one 60s timeout
→ NOT evidence of 5/5 provider reliability

Groq TPD / Cloudflare timeout
→ provider-capacity/operational failures, not semantic empty output
```

### RW2 — Buenos Aires multi-area walk (executed 2026-09-26)

Evidence: `spikes/rw2-buenos-aires-multi-area-walk-2026-09-26/` (1 COLD + 1 WARM
on `zigzag_spike_rw2`; serpapi + cloudflare `@cf/qwen/qwen3.8-27b` +
geoapify + groq classification + local Overpass/Nominatim).

- Interpreter emitted both anchors (San Telmo, La Boca) as
  `usage=geographic_scope`, `priority=soft`; both resolved to OSM areas
  (`osm:relation:2223069`, `osm:relation:2223879`).
- `intent:walk` deficit routed **GENERIC** (2 relevant area anchors →
  `AREA_ROUTE_WALK=0`), reproducing the documented single-anchor precondition.
- **Finding (routing):** the GENERIC `buildAcquisitionPlan` call drops the
  structured anchors; both names survive only inside the free-text
  `semanticQuery` string, not as `SourcePlan.web.anchorNames`.
- Extractor produced a real source-backed `San Telmo to La Boca History Walk`
  (7 components: Plaza de Mayo → Calle Defensa → Plaza Dorrego → Mercado de
  San Telmo → Av. Almirante Brown → Caminito → Riachuelo), 7/7 resolved to OSM,
  geo-ACCEPTED, persisted (id `b353fc85-…`), WARM-reused canonically (34s, no
  SerpAPI/extraction re-run).
- **Finding 1 (routing):** the GENERIC `buildAcquisitionPlan` call drops the
  structured anchors at the planner call boundary; both names survive only via
  the free-text `semanticQuery` string, not as `SourcePlan.web.anchorNames`.
- **Finding 2 (planning mobility — corrected wording):** the composite reached
  `GreedyDailyPlanningSolver` and was **rejected by the request's active
  walking constraints** (`MAX_WALKING_PER_DAY_EXCEEDED` +
  `MAX_CONTINUOUS_WALKING_EXCEEDED`); `TourCompletenessValidator` then emitted
  `UNMET_REQUESTED_FORMAT(walk)`. It was **not** ignored by the planner and
  **not** lost at ranking. The earlier "planner preferred museums" wording was
  too loose.
- **Finding 3 (Bitácora gap):** the 15-eligible → composition → 6
  planning-candidate transition was not sufficiently auditable from trace: the
  bitácora exposed only `candidate_pool` (15 offered) and `daily_planning` (6
  represented / 5 selected / 1 unselected) without explaining composition
  reservations, reservoir size, or per-candidate walking rejection facts.
- Multi-area semantics PASS; crossing neighborhood boundaries was not rejected;
  no proximity fabrication. Verdict MIXED (three named findings, no semantic
  blocker).

Product observation (recorded, not changed here): the real frontend default is
`walkingEffortProfile = moderate` → `daily = 5000 m`, `continuous = 1500 m`.
RW2 used `daily = 5000 m`, `continuous = 3000 m`, so RW2's mobility shape was
**not** the exact current default preset (the current default is even more
restrictive on continuous walking). Do not describe 5000/3000 as "the default".

### RW2 findings closure (2026-09-26)

- **Finding 1 (GENERIC structured-anchor propagation): FIXED.** The GENERIC
  `buildAcquisitionPlan` call now forwards `anchors: resolvedAnchors`, reusing
  the existing canonical contract; `semanticQuery` is preserved independently.
  Regression coverage: architecture test proves the call site forwards anchors;
  the existing planner test proves both names reach `SourcePlan.web.anchorNames`.
- **Finding 3 (Bitácora composition gap): FIXED.** `CompositionSelectionResult`
  now carries typed candidate-level decisions (eligible / initial-selected /
  reserved-for-facet / must-forced / soft-anchor-boosted / remainder-fill /
  reservoir / excluded) computed in the same canonical `composeSet` pass, and
  the `candidate_pool` trace exposes `portfolioTarget`, `initialSelectedIds`,
  `reservoirIds`, `perFacetCoverage`, `mustAnchorsForced`,
  `softAnchorsBoosted`, `unmetFacets`, `unmetAnchors`. The canonical Experience
  ID is traceable across `catalog_materialization → candidate_pool →
  daily_planning`.
- **Walking rejection now auditable with actual-vs-limit facts.** Planner
  walking rejections carry typed `walkingDiagnostics` (daily actual vs limit,
  longest continuous leg vs limit, internal vs incoming-travel contribution),
  surfaced in the `daily_planning` trace. The canonical mobility constraint
  snapshot is also surfaced.
- **Walking policy unchanged.** `MAX_WALKING_PER_DAY_EXCEEDED` /
  `MAX_CONTINUOUS_WALKING_EXCEEDED` remain hard constraints. No threshold
  changed; `intent:walk` does not override them. A provider-free deterministic
  control proves the same RW2-shaped composite is rejected under the exact RW2
  limits (5000/3000) and feasible under explicitly non-binding limits
  (50000/20000, the DTO upper bound — a control value, not a recommendation).
- **Frontend preset label mismatch fixed.** `TourWizardMobilityStep` walking
  descriptions now derive from `WALKING_EFFORT_PRESETS` (2000/5000/10000 m),
  removing the stale "4 km"/"6 km" literals.

### RW3 — Caminito canonical geographic ROUTE (three runs, 2026-09-27)

Chronological evidence (each directory is immutable; read its assessment):

1. `spikes/rw3-caminito-canonical-route-2026-09-27/` — historical SerpAPI run,
   verdict **FAIL**: RW3-F1 (Caminito discarded: an out-of-destination
   Nominatim venue homonym vetoed the real route cross-branch), SerpAPI quota
   429 hidden as success (F2), missing anchor-branch facts (F3), minor trace
   omissions (F4).
2. `spikes/rw3-rerun-serper-cloudflare-2026-09-27/` — after `b31f5f33`
   (supporting report:
   `docs/superpowers/progress/2026-09-27-rw-bitacora-defect-fixes-and-reruns-progress.md`,
   evidence only, not an execution pointer). State after that run:
   - **F1** observed Caminito/Ezeiza cross-branch defect: fixed and
     live-proven for that case (route `osm:way:144844726` SELECTED; Ezeiza
     homonym REJECTED, audit-only, never persisted);
   - **F2**: deterministically test-proven; the live run had no grounded
     provider failure (Serper succeeded, `providersFailed=[]`), so only the
     successful provider identity was live-proven — the failure path was not
     live-exercised;
   - **F3 / F4**: live-proven;
   - review found F1 only partially generic (a branch still picked its
     favorite homonym before destination screening), audit `candidateFacts`
     leaking into source-plan fingerprints, and N1 mis-diagnosed (the typed
     anchor was lost at the search → extractor handoff, not missing from the
     query);
   - RW3 end-to-end: **NOT CLOSED**.
3. `spikes/rw3-anchor-handoff-rerun-2026-09-27/` — after `d6149363`
   (`fix(tours): preserve destination and anchor semantics`: per-candidate
   destination screening before ranking in every anchor branch with
   compatible-only multiplicity; `materialAnchorProjection` fingerprints —
   `candidateFacts` behavioral consumers: NONE; typed
   `ExperienceDiscoveryRequest.anchorNames` rendered in the shared prompt for
   all extractors). Serper + Cloudflare, preflight-verified, fresh DB,
   50000/20000 control. COLD failed closed in 40.5 s:
   - anchor: route `osm:way:144844726` (MultiLineString) SELECTED; all 5
     Nominatim homonyms individually REJECTED_DESTINATION_INCOMPATIBLE;
   - routing `AREA_ROUTE_WALK=1`, `anchorMode: canonical`;
     `SourcePlan.web.anchorNames` = `extractor.requestAnchorNames` =
     `["Caminito"]` (handoff live-proven);
   - Serper evidence overwhelmingly Caminito/La Boca-specific; Cloudflare
     extracted `Private Caminito & La Boca Walking Tour` (ev-5; Caminito,
     Benito Quinquela Martín Museum, "La Bambonera stadium"; 3/3 SUPPORTED) —
     no longer the unrelated Avenida de Mayo route;
   - **RW3-N5 (blocker):** "La Bambonera" (the source's own misspelling of
     La Bombonera) is unresolvable by every strategy, so the composite is
     rejected `INCOMPLETE_SOURCE_COMPOSITION` (2/3) before geographic
     validation. Route-geometry membership, regional coherence and planning
     were still not exercised. WARM not run.
   - RW3-N6 (observation): Caminito persisted as ROUTE way (anchor) and as
     PLACE node `osm:node:10303343309` (component).

4. **Post-run hardening after last RW3 run (`bb51a253`):**
   - cross-branch homonyms: CLOSED
   - same-branch exact homonyms: CLOSED
   - same-branch fuzzy homonyms: CLOSED
   - Places candidate selection: CLOSED
   - verified supportSpan auditability: CLOSED deterministically

5. `spikes/rw3-typo-normalization-rerun-2026-09-27/` — after RW3-N5 closure:
   - **RW3-N5 (PROVEN):** Provider-neutral typo normalization implemented.
     Extractor proposes normalized canonical name `La Bombonera` while preserving
     source text `La Bambonera stadium` in `sourceName` and `verifiedSupportSpan`.
     IdentityVerifier independently confirms against Nominatim (`osm:way:248598885`)
     and Wikidata.
   - **Sequence integrity audit:** Material state contamination detected.
     `cold/db-after.json` (15 GeoEntities, 14 experiences, walk tour absent) !=
     `warm/db-before.json` (16 GeoEntities, 15 experiences, walk tour present).
     Because state was inserted between COLD and WARM, the warm reuse proof is
     invalid as an end-to-end continuous proof. Furthermore, COLD rejected its
     single-component extracted candidate for `NO_MATCHING_EVIDENCE_REQUIREMENT`
     and persisted zero walking experiences.

6. `spikes/rw3-final-clean-rerun-2026-09-27/` — clean machine-checked rerun:
   - **Harness & Sequence Integrity:** Dedicated DB `zigzag_spike_rw3_clean`,
     canonical Serper + Cloudflare pair. Sequence integrity machine check
     implemented (`verify-db-sequence.cjs`).
   - **COLD execution:** Terminated fail-closed in 22.2s with `generationStatus: failed`.
     Extractor emitted `Caminito Walking Tour` with 1 route (`Caminito`) and 1
     area (`La Boca`). Under canonical admission rules, area components are
     excluded from meaningful components; candidate rejected honestly with
     `NO_MATCHING_EVIDENCE_REQUIREMENT` ($1 < 2$).
   - **Catalog & WARM:** Zero experiences persisted in COLD. Per invariant
     ("Execute WARM only if COLD persists a relevant RW3 Experience"), WARM
     was correctly NOT executed on empty catalog. No synthetic state injected.
   - **Route geometry corridor audit:** Evaluated `Caminito` MultiLineString way
     (`osm:way:144844726`) via canonical `distancePointToLineStringMeters`:
     `Museo Benito Quinquela Martín` is 188.1m away ($\le 300\text{m}$, passes corridor);
     `La Bombonera` is 428.2m away ($> 300\text{m}$), which fails corridor
     membership with `EXTERNAL_ROUTE_SCOPE_MISMATCH`. Existing geometry rules
     were preserved strictly without loosening, exposing defect RW3-N6.

7. `spikes/rw3-route-scope-rerun-2026-09-28/` — route-scope policy & feasibility separation:
   - **Defect resolution (RW3-N6):** Removed arbitrary 300m hard cliff. Implemented
     pure policy `evaluateRouteScopeMembership` combining real anchor satisfaction
     (`ANCHOR_COMPONENT` / `ON_ROUTE`), destination boundary compatibility
     (`OUTSIDE_DESTINATION_BOUNDARY`), local scope sharing (`SAME_LOCAL_SCOPE`),
     and coherent extensions (`DESTINATION_COMPATIBLE_EXTENSION`).
   - **Separation of concerns:** Geographic validation verifies spatial scope
     coherence; planner owns walking feasibility via canonical constraints
     (`maxWalkingDistancePerDayMeters`, `maxContinuousWalkingDistanceMeters`).
     Distance from route is preserved as diagnostic evidence (`distanceFromRouteMeters`),
     never semantic reject authority.
   - **Deterministic regressions (G1–G6):** All GREEN (G1 no 300m cliff, G2 real
     Caminito/Bombonera case, G3 anchor required, G4 destination mismatch, G5 area
     context does not fake cardinality, G6 planner owns walking feasibility).
   - **COLD execution:** Terminated fail-closed in 10.1s on dedicated DB
     `zigzag_spike_rw3_routescope`. Serper returned 10 relevant Caminito results.
     Cloudflare extractor yielded 0 candidates on this run. No synthetic DB
     injection; WARM not run on empty catalog.

8. `spikes/rw3-acceptance-rerun-2026-09-28/` — extractor characterization & observability:
   - Positive control verified (5/5 admitted on frozen multi-component evidence).
   - Trace observability gap (Case D) resolved: `rawOutput` captured in generation trace.
   - COLD run honestly failed closed when search snippets lacked 2nd component (Case A).

9. `spikes/rw3-source-retrieval-acceptance-2026-09-28/` — deep source content retrieval & acceptance campaign:
   - **Source Retrieval Boundary**: Provider-neutral `IWebSourceContentService` with
     `TavilyExtractService` (and Cloudflare Browser Run capability).
   - **Deterministic Gated Trigger**: Fires only when `MULTI_COMPONENT_EXPERIENCE` is
     required and initial snippet extraction yields no admissible multi-component candidate.
     Never wired unconditionally into top-N search results.
   - **Live COLD Run**: Triggered deep retrieval, fetched full markdown (`solsalute.com` 32,121 chars,
     `buenosairesfreewalks.com` 2,980 chars) in 2,166ms. Extracted `La Boca Walking Tour`
     with 3 components: `Caminito` (ROUTE), `Plazoleta Bomberos Voluntarios de La Boca` (PLACE),
     `La Bombonera` (PLACE) with verified support spans.
   - **Resolution & Materialization**: All 3 components resolved against trusted geography,
     passed spatial validation as `GEO_VERIFIED`, and persisted in PostgreSQL catalog (18 GeoEntities,
     14 Experiences, 18 ExperienceComponents).
   - **Live WARM Run & Catalog Reuse**: Sequence integrity proven (`cold/db-after == warm/db-before`).
     All 3 components resolved via `CATALOG_REUSE` (`status: true, verdict: VERIFIED`).
     Tour generated cleanly with zero web calls.

> **SUPERSEDED / HISTORICAL CLAIM — do not use as current status.** This was
> the conclusion of an earlier evidence checkpoint. It is superseded by the
> 2026-09-28 Trace v5 sequencing superseder below: RW3's final
> classification/warm-reuse finding is **OPEN**, RW4 is **NOT AUTHORIZED**, and
> this passage's “100% catalog reuse in WARM” is historical evidence only.

RW2 canonical-provider rerun (`spikes/rw2-rerun-serper-cloudflare-2026-09-27/`,
corrected): Serper returned relevant San Telmo/La Boca walking evidence and
Cloudflare extracted 0 web candidates; the composite delta is at the Serper
evidence → Cloudflare extraction boundary (or their interaction) and is
unisolated; classification cannot explain zero pre-classification
candidates. That rerun used 5000/3000 m, not the 50000/20000 control (no
effect on the extraction result). RW2 is not reopened.

### Open next steps

- next canonical gate: **RW4 (generalization)** — NOT AUTHORIZED (superseded: RW3 final classification/warm-reuse finding remains OPEN).
- future frozen-corpus investigation of the RW2 Serper → Cloudflare
  multi-area extraction delta (use `50000 / 20000` for any controlled RW2
  rerun);
- the walking feasibility policy itself remains **unchanged pending a separate
  product decision** — we now have correct diagnostics, not a threshold change;
- benchmark alternate Cloudflare models later through the already-configurable
  `CLOUDFLARE_DISCOVERY_MODEL`, using the same frozen corpus and parser;
- design provider fallback separately, with explicit policy and observability;
  **no automatic fallback exists today**;
- eventually re-attempt the bounded live dedupe shape when extraction actually
  emits the required standalone+composite pair.

Do **not** reopen component-resolution, dedupe identity policy, geography or
planner semantics to address extractor/provider variance.

M3.5 remains **COMPLETE / APPROVED**; its accepted Nominatim policy and the
older cutover checkpoint detail are retained below for provenance, but they
are no longer the current execution pointer.

---

## Historical cutover milestone checkpoint — retained for provenance

| Milestone | Status | Evidence / notes |
| --- | --- | --- |
| M0 | COMPLETE | Live-cutover call-graph/design audit documented. |
| M1 | COMPLETE | `PreferenceSpec` wired into the live orchestrator. Historical M1 commit: `8905f66...`. |
| M2 | COMPLETE | `FacetRetrievalService` + canonical sufficiency replaced legacy coverage authority. Relevant commits include `7c6555e...`, `d8a8828...`, `13ee702...`, `03a4728...`. |
| M3 | COMPLETE | `51989f321db6cb6bea7fbd6620a5714942723a91` — strategy selector + AREA/ROUTE/WALK acquisition live. |
| M3.5 | **COMPLETE / APPROVED** | JSONv2 normalization landed in `91ab491...`; rank hardening/fixes culminate in canonical branch commit `a38da85a26a514674d679bf78c0d27cbd2119538` (`13..25` + boundary regressions). |
| M4 | COMPLETE IN CODE | `8fac82d384cdbc20f54b004a2f3e428aa8285be3` — classification converges at the shared materialization boundary; AreaRouteWalk local classification authority removed. |
| M5 | **IN PROGRESS / PARTIALLY LANDED** | `09616dd...` adds preference-first composition; `3a7e965...` adds canonical venue-anchor resolution; `a7b841...` adds venue-anchor tests/hardening. P1 C5 semantic handoff and pinned-MUST implementation are implemented in the current worktree, awaiting package commit/review; C5b remains pending. |
| M6 | **C4 CORRECTED — awaiting independent review** | Independent review found weak-facet weighting and ignored typed planner signals; correction landed in `827b3ce`. P1 implements C5 semantic handoff and pinned MUST lifecycle; C5b duration-aware reservoir backfill remains pending. |
| M7 | NOT COMPLETE | Superseded legacy deletion milestone not yet closed against the current checklist. |
| M8 | **SUPERSEDED / CUTOVER TO V5** | Trace v4 superseded by Generation Trace v5 cutover (COMPLETE / ACTIVE TRACE AUTHORITY). |
| M9 | NOT COMPLETE | Full verification matrix + no-dual-pipeline architecture acceptance. |
| M10 | BLOCKED | RW1 rerun only after the required cutover gate and separate authorization. |

---

# C4 — planner candidate contract

Status: **C4 CORRECTED — awaiting independent review**. The previous C4
implementation failed independent review on two blockers: weak matches were
counting toward planner preference weight, and an ordinal `rankingScore` made
the planner ignore typed preference/quality signals. M3.5 remains
**COMPLETE / APPROVED**; this correction does not reopen or redesign it. C5
and C5b remain unimplemented.

- Starting remote HEAD: `d16ebf44ac2010c1fbc7cbc9db1c09cf08659b5e`.
- Previous implementation commit: `83b5dce` (`feat(cutover-C4): wire planner preference contract`) — failed independent review.
- Correction commit: `827b3ce` (`fix(cutover-C4): preserve canonical preference scoring`).
- Execution-contract commit: `827b3ce`.
- `PlanningExperienceCandidate` now carries optional `preferenceWeight`,
  `mustInclude`, and raw canonical `qualityScore` (0..5).
- `preferenceWeight` is produced by the shared strong-match policy, summing the
  weights of distinct strongly satisfied requested facets. Weak quality,
  geography, or degraded-classification matches contribute zero; duplicate
  representations count once; semantic similarity/name/description cannot
  establish facet truth.
- `mustInclude` is true only for IDs returned by the resolved MUST venue-anchor
  contract. Soft anchors, AREA/ROUTE anchors, high preference matches, and
  unresolved MUST anchors do not set it; unresolved anchors do not synthesize
  candidates.
- `qualityScore` is read from `Experience.qualityScore`; transformed ranking
  `qualityBonus` is no longer exposed as planner quality.
- `rankingScore` is removed from the live planner candidate contract. Planner
  sorting and placement share one explicit formula: semantic contribution plus
  strong `preferenceWeight` plus raw canonical quality normalized from 0..5
  exactly once. Unknown quality is neutral.
- Initial selected candidates and the ordered reservoir use the same typed
  normalizer context/maps; no separate future-backfill candidate shape was
  introduced. Reservoir promotion itself remains C5b scope.

Fresh verification for C4:

- Targeted normalizer/matcher/planner suites: **6 suites passed, 96 tests passed**.
- Targeted planner-boundary characterization suites: **2 suites passed, 6 tests passed**.
- Full unit: **143 suites passed, 1,443 tests passed**.
- Integration: **16 suites passed, 72 tests passed**.
- Typecheck: **PASS**.
- Lint: **PASS**.
- Build: **PASS**.
- Full characterization: **7 non-DB suites passed, 2 DB-backed suites failed
  at setup** because the repository disposable-database guard rejected the
  configured target `localhost:5432/zigzag`. Exact guard message: `Refusing to
  TRUNCATE a database that is not provably disposable (localhost:5432/zigzag).
  Point DATABASE_URL at a dedicated test database (e.g. zigzag_test) or set
  ALLOW_DESTRUCTIVE_TEST_DB=1.` No guard bypass was attempted.

Architecture gate:

- single semantic authority: **PASS**;
- strong-vs-weak facet consistency: **PASS**;
- no double counting: **PASS**;
- raw canonical quality scale: **PASS**;
- hard-feasibility isolation: **PASS**;
- typed boundary contract: **PASS**;
- single normalization path: **PASS**;
- rankingScore ordinal override: **PASS — removed from planner handoff**;
- no provider-specific planner logic: **PASS**;
- no parallel legacy path: **PASS**;
- deterministic behavior: **PASS**.
- mustInclude transport-only: **PASS**;
- C5/C5b untouched: **PASS**.

### C4 overlap-priority correction — implementation checkpoint

Starting fork HEAD for this task: `51315f64d95b148cf75504d7edaf3b8d1ebc7198`.

Independent-review regression addressed: equal-component overlap filtering
was receiving `CandidateScoreBreakdown.totalScore`, which had collapsed equal
`preferenceWeight` candidates and could let lexical Experience ID decide the
winner instead of the ordering already chosen by composition.

Implementation commit: `610c14e` (`fix(cutover-C4): preserve composition priority through overlap filtering`).

Exact fix:

- `CandidateSelection` now carries `compositionOrderScoreById`, derived once
  from `composition.result.selected` followed by `composition.result.reservoir`.
- Orchestration carries that ordinal into overlap filtering as the transient
  `compositionOrderScore` field; `CandidateScoreBreakdown.totalScore` is no
  longer overlap authority.
- The overlap tie-break now uses component count, then composition order, then
  lexical ID. `PlanningExperienceCandidate` and planner semantics are
  unchanged; `rankingScore` was not restored.

Fresh verification for this correction (agent-executed):

- targeted overlap/composition/planner suites: **6 suites passed, 48 tests passed**;
- planner-boundary and shared-component characterization: **2 suites passed, 8 tests passed**;
- full unit: **144 suites passed, 1,444 tests passed**;
- integration: **16 suites passed, 72 tests passed**;
- typecheck: **PASS**;
- lint: **PASS**;
- build: **PASS**.

Full characterization: **7 non-DB suites passed, 32 tests passed**; **2 DB-backed
suites failed at setup** because the disposable-database guard rejected
`localhost:5432/zigzag`. No guard bypass was attempted.

Status remains: **C4 CORRECTED — awaiting independent review**. C5 and C5b
remain unimplemented.

---

# M3.5 — final accepted state

## Canonical policy

M3.5 owns one domain question:

> Is this Nominatim result a real, usable, bounded AREA-scale scope for destination/anchor resolution?

The canonical answer is `isAreaScaleEligible()`.

Current accepted rules:

- `osmType === node` → reject for polygon/boundary AREA use;
- provider classification must be normalized from JSONv2 `category` into internal `class` at the adapter boundary;
- `class === boundary` requires `type === administrative`;
- `class === place` is eligible only with supported numeric scale evidence;
- supported rank band is **13..25 inclusive**;
- rank `<=12` is too broad for this policy;
- rank `>=26` is too granular for this policy;
- `placeRank` is primary, `addressRank` is fallback when `placeRank` is unavailable;
- missing rank/classification fails closed;
- no `addresstype` whitelist is the source of truth;
- no destination-specific exceptions.

The same policy is consumed by:

1. `DestinationResolutionService`;
2. `AreaRouteAnchorResolverService`;
3. AREA component-hint resolution in `ExperienceProposalResolverService`.

## Final correction on canonical branch

Canonical branch implementation commit:

`a38da85a26a514674d679bf78c0d27cbd2119538`

This reproduces the previously reviewed implementation tree exactly on the correct repository/branch and changes only:

- `be/src/modules/tours/utils/nominatim-match.util.ts`
- `be/src/modules/tours/utils/nominatim-match.util.spec.ts`
- `be/src/modules/tours/services/destination-resolution.service.spec.ts`

It:

- changes `AREA_SCALE_MIN_RANK` from `16` to `13`;
- adds explicit boundary coverage for ranks `12, 13, 15, 16, 25, 26`;
- proves `placeRank: 15, addressRank: 20` is accepted because rank 15 itself is valid;
- proves a rank-15 administrative city follows the AREA boundary-hydration path instead of degrading to point fallback.

## Verification evidence

Fresh verification was executed by the implementation agent against the byte-identical implementation tree before the repository-target correction:

- targeted M3.5 tests: **6 suites / 115 tests PASS**;
- full unit: **143 suites / 1,438 tests PASS**;
- integration: **16 suites / 72 tests PASS**;
- typecheck: **PASS**;
- lint: **PASS**;
- build: **PASS**.

Verification classification:

- remote commit/diff/code inspection on the accepted implementation: **reviewer-verified**;
- single-policy call sites and JSONv2 boundary normalization: **reviewer-verified**;
- Nominatim rank semantics used for the final correction: **reviewer-verified against provider documentation**;
- test/typecheck/lint/build execution counts: **agent-reported**, not re-executed by the independent reviewer.

Architecture gate from independent review:

- provider isolation: **PASS**;
- typed boundary normalization: **PASS**;
- single policy authority: **PASS**;
- unknown/fail-closed semantics: **PASS**;
- no destination/provider special cases: **PASS**;
- dependency direction: **PASS**;
- no duplicate legacy path introduced: **PASS**.

---

# M4 — current real state

Commit: `8fac82d384cdbc20f54b004a2f3e428aa8285be3`

Current code state:

- classification converges through `ExperienceAcquisitionService.materializeExecution()`;
- accepted results are grouped by canonical `experienceId`;
- classification reuse uses the canonical reuse predicate;
- evidence is scoped/unioned per canonical Experience;
- `AreaRouteWalkAcquisitionService` no longer owns a second classification policy/path.

Do not roll M4 back while continuing M5/M6.

---

# M5 — current real state

M5 is partially implemented, not complete.

Landed:

- `09616dd1098de80fe2064977ba7aef669d89c964`
  - `composition-set-cover.util.ts`;
  - `ExperienceCompositionService`;
  - live preference-first composition;
  - deterministic ranked reservoir;
  - semantic similarity / exploration tilt remain ranking-only.
- `3a7e965bcc185b7b42696fc52995813f246e8efa`
  - canonical venue-anchor resolution;
  - resolved must/soft venue IDs reach composition;
  - soft anchors boost rather than force;
  - unresolved must anchors are tracked.
- `a7b841c6517001184c52fbeb7722b818ec34ea65`
  - venue-anchor tests/hardening;
  - also contained earlier M3.5 rank hardening now superseded by the approved correction above.

Still pending before Checkpoint C can be called complete:

- complete planner-candidate contract (`preferenceWeight` / `mustInclude` as required by the current plan);
- true pinned feasible must-anchor behavior in planner placement;
- duration-aware reservoir backfill;
- bounded planner-capacity acquisition after reservoir exhaustion;
- later trace/Bitácora work remains M8.

---

# Verification semantics for future agents/reviewers

Use these labels strictly:

- **reviewer-verified** — actually inspected/executed by the current independent reviewer;
- **agent-reported** — reported by an implementation agent or commit/progress entry but not independently rerun;
- **not verified** — no reliable evidence available.

Never infer green execution merely because a progress file or commit message says it passed.

---

# Current execution pointer

## Master-plan continuous execution — P1 implementation checkpoint

Starting local/fork HEAD: `3d1c1d4d1fe25ebd88657c6775df993f71b1ff79`.

P1 is implemented in the worktree and remains **IMPLEMENTED — awaiting independent review**:

- composition preserves semantic similarity scores and typed ranking provenance;
- generation handoff keeps missing embedding scores observable as `null` while planner normalization remains neutral;
- MUST candidates are partitioned and attempted before regular candidates;
- local improvement cannot move or swap MUST candidates;
- routing repair removes non-MUST candidates before MUST candidates.

Fresh P1 verification: targeted 6 suites / 45 tests passed; full unit 145 suites / 1,448 tests passed; integration 16 suites / 72 tests passed; typecheck, lint, and build passed. No disposable DB reset was attempted.

P2/P3 implementation checkpoint: initial and reservoir collections now remain distinct through the internal composition boundary; bounded deterministic reservoir promotion uses duration-aware residual capacity, MUST preservation, shared normalization, and no-degradation/progress checks. Planner residual capacity and planner-capacity deficits are explicit typed metadata. Preference-aware overlap now compares canonical weighted preference coverage before component count, preserves MUST candidates, and context-free callers retain the old comparator. The legacy trace helper no longer infers theme coverage from names/metadata.

Fresh P2/P3 targeted verification: overlap/composition/trace 3 suites / 33 tests passed; typecheck and lint passed. Full backend unit/integration/build evidence remains green from the preceding P2 checkpoint (145 suites / 1,448 tests; 16 suites / 72 tests). P2 is **IMPLEMENTED — awaiting independent review**, with one material remaining gap: the plan requires a bounded planner-capacity acquisition pass after reservoir exhaustion; current code records the typed deficit but does not yet execute that pass.

P4 implementation checkpoint: superseded candidate-window selection and keyword theme-matching authorities were deleted; the large characterization harness now uses the direct ranking window, and a static single-orchestration-owner architecture test is present. P4 remains **IMPLEMENTED — awaiting independent review**. The canonical planner-capacity acquisition/requery pass is still not implemented, so M9/M10 remain blocked.

P5/P6 implementation checkpoint: new backend generation traces emit version 4 while V1/V2/V3 contracts remain readable; the frontend Bitácora recognizes v4 stage groupings and keeps technical detail/export behavior available. P5/P6 remain **IMPLEMENTED — awaiting independent review**. Backend trace targeted verification passed 3 suites / 30 tests plus typecheck, lint, and build. Frontend `tsc --noEmit` remains FAIL on pre-existing repository errors in API generics, notification typings, bottom-sheet/icon typings, and a missing `tailwind-variants` declaration; no error was reported in the modified Bitácora file.

M9 remains blocked: planner-capacity acquisition is not yet executed after reservoir exhaustion; native v4 trace payloads do not yet include the full convergence/classification dossier; the complete frontend matrix and disposable-DB characterization gate remain outstanding.

P7 database checkpoint: a dedicated local Postgres database `zigzag_test` was created and all 16 repository Prisma migrations were applied successfully. Fresh acceptance verification against that database passed 20 suites / 30 tests. Fresh characterization ran 8 suites / 36 tests, with 6 suites / 28 tests passing and 2 DB-backed suites / 8 tests failing during Prisma raw-SQL initialization. Fresh e2e verification reached the disposable database but failed across the DB-reset-dependent selection suites with Prisma `Invalid $executeRawUnsafe` / `$queryRawUnsafe` errors; the disposable-database guard itself passed. P7 remains **BLOCKED — implementation and DB verification incomplete** pending the canonical planner-capacity acquisition gap and DB-backed suite initialization repair.

The required frontend typecheck remains blocked by pre-existing repository errors outside the modified Bitácora file. No live Buenos Aires gate or M10 RW1 run was authorized by prerequisite state; RW1 has not been run.

Next gate: finish P2 acquisition convergence and complete the trace/Bitácora v4 contracts before M9 acceptance.

M3.5 is closed. Do not reopen it unless a new regression is demonstrated.

Next work must start from the **actual remote HEAD of `jiseruk/zig-zag` / `feat/preference-first-selection`** and must be stateless/new-chat.

Before implementing another milestone:

1. fetch current remote HEAD;
2. read this CURRENT MAIN PROGRESS;
3. read the live-cutover plan and relevant canonical design/implementation sections;
4. inspect the real M5/M6 implementation frontier rather than assuming the older linear milestone picture;
5. preserve completed M0–M4 and already-landed M5 work;
6. choose the next smallest coherent task from the real remaining M5/M6 gap;
7. update this progress before stopping.

The next frontier is **M5 completion / M6 planner handoff and backfill**, not M3.5 and not a restart from earlier checkpoints.

## 2026-09-28 Trace v5 cutover — COMPLETE / ACTIVE TRACE AUTHORITY

Generation Trace v5 cutover is COMPLETE and is the single active trace authority.
Native envelope version 5 is emitted across the backend pipeline and rendered natively
by the Bitácora. All legacy v4 interfaces, builders, projections, and types have been
permanently removed.

Status summary:
- **Trace v5: COMPLETE / ACTIVE TRACE AUTHORITY**
- **RW3 final warm classification-reuse finding: OPEN**
- **RW4: NOT AUTHORIZED**

## STOP condition

Do not run RW1 and do not call the full live cutover complete until the later M5–M9 gates required by the canonical live-cutover plan are satisfied.

## 2026-09-14 M9 recovery — disposable database boundary

Starting local/fork HEAD: `c472924b552bb03b3cbe3bca82fdc83b9520eff9`.

The original DB initialization symptom was reproduced with a minimal
`SELECT 1`: sandboxed execution returned Prisma 7.3.0 `EPERM` because local
PostgreSQL access was denied by the execution environment. With local DB access
enabled, the same Prisma adapter and raw-query calls succeeded; the previously
reported DB-backed characterization failures were environment/setup failures,
not migration or SQL failures.

Recovery changes in this worktree:

- the shared reset helper now uses Prisma's tagged raw-query API with a
  source-controlled table list, and rechecks the disposable-database guard at
  the destructive boundary;
- E2E competitive/scale reset paths reuse the shared helper;
- a real Postgres regression resets the same migrated `zigzag_test` twice,
  verifies application rows are removed, confirms PostGIS and pgvector remain
  usable, and inserts/queries again;
- the provider-order characterization was updated from its superseded failing
  expectation to the already-landed canonical convergence behavior.

Fresh verification (agent-executed): characterization **8 suites / 36 tests
passed**; integration **17 suites / 73 tests passed** including the reset
regression; backend typecheck, lint, and build passed. E2E executed against
`zigzag_test` but remains red on existing M9 cutover gaps: stale v3 trace
assertions, large-corpus preference/planner expectations, and one deadlock
during the scale reset. P2 planner-capacity acquisition, the complete v4
convergence/classification dossier, frontend Bitácora verification, and the
Buenos Aires live gate remain outstanding. Status: **DB boundary repaired —
M9 still blocked, awaiting independent review**.

## 2026-09-14 M9/C5b completion evidence

Starting HEAD: `675f71356c689d2c3835d9b603b1c371a254c552`.

The stale competitive corpus contract was migrated in `27b5600` and the
remaining lifecycle/C5b test and scope corrections were committed in
`38cef45`. Competitive assertions now encode P7C directional preference,
facet coverage, exact-fit preference over generic quality, strict hard
exclusion, preference-delta selection change, no-strict-dominance, and
determinism. They no longer require global 100% cluster dominance.

The E2E harness now waits for generation terminal status plus relevant outbox
quiescence and isolates the unawaited image transport with a deterministic
test double. The dedicated `zigzag_test` verification is green:

- full E2E: 4 suites / 40 tests;
- competitive corpus: 17 tests;
- scale corpus: 7 tests;
- acceptance: 20 suites / 30 tests;
- integration: 17 suites / 73 tests;
- characterization: 8 suites / 36 tests;
- unit: 144 suites / 1,443 tests;
- architecture, typecheck, lint, and build: PASS.

C5b implementation is **IMPLEMENTED**. The canonical path is gated by
`RESERVOIR_EXHAUSTED` with meaningful residual capacity, then executes
`AcquisitionDeficit(global_capacity)` → acquisition plan/execution → canonical
materialization/persistence → catalog re-read → recomposition → replan. The
bounded pass count and no-progress termination are persisted in convergence
trace metadata. The point-radius resolver regression was fixed so this path
has a valid typed destination scope when no area boundary exists. Acceptance
evidence is **PASS** through the C5b integration, E2E, unit, and architecture
matrix listed above.

RW1 was rerun against `zigzag_spike_preb6` with local PostgreSQL, SerpAPI,
Nominatim, and Overpass. The five-minute cold observation was a harness
timeout only; persisted terminal evidence shows completion after **403,767 ms**.
All four routed providers completed, both discovery passes were `PASS`, and
`providersFailed` was empty. The cold result did not create a composed walk:
`AreaRouteWalkAcquisitionService` was not invoked, and the planner selected
five independent single-component venue Experiences. Correct product verdict:
**EXPECTED_B6_GAP**. A warm run without reset completed in **32,355 ms**, reused
the same five individual Experience IDs, and kept the catalog identity-stable;
it did not prove composed-walk reuse because no composed walk exists. The
previous `INFRASTRUCTURE_GAP / provider-coverage gap` label is superseded and
retained only as historical mistaken diagnosis. RW2 remains unauthorized.

## 2026-09-14 RW1 canonical B5 rerun correction

The current build was verified with runtime identity
`811830bde0ad81656c89f9ffa807e3fcb40e597f`. The earlier live process had
fallen back from invalid remote preference-interpreter credentials, producing
no interpreted anchor; that was the actual reason the earlier trace showed
`AREA_ROUTE_WALK=0`, not a defect in `buildPreferenceSpec` or the selector.

With a working local Ollama interpreter on a clean dedicated spike database,
the terminal cold trace proved:

- interpreter anchor: `San Telmo`, `area`, `must`;
- `PreferenceSpec.anchors`: the same `San Telmo` area anchor;
- unsatisfied deficit: `preference_facet`, `intent:walk`;
- partition: `AREA_ROUTE_WALK=1`, `GENERIC=1`, with only `theme:history` in
  generic;
- `AreaRouteWalkAcquisitionService.acquireOrReuse()`: invoked, outcome
  `no_result`;
- final generation: `completed` in **13,254 ms**.

No grounded multi-component walk was established, so the correct current RW1
verdict is **EXPECTED_B6_GAP**. The planner selected four independent
single-component venue Experiences. No warm run was started because there is
no composed-walk Experience ID to reuse. The current `google_places` failure
is retained as provider diagnostic data, but the B5 routing contract passed;
this run is not classified as an orchestration or infrastructure gap.

## M5-M10 ARCHITECTURE DEBT CLOSURE

This supersedes any prior blanket claim that M5-M10 architecture was fully
closed before the D0-D7 audit. D0 verified the existing `ConfigModule` owner
with a real Groq interpreter call (`groq`, `qwen/qwen3.8-27b`, `applied`, San
Telmo area anchor); no code commit was needed. D1 (`1527b79`) moved downstream
preference authority to one `PreferenceSpec` build and removed request
mutation; targeted preference/composition/completeness tests passed. D2
(`7ab1519`) made typed `PortfolioTargetFacts` and distinct-ID union semantics
the shared coverage/composition policy; sufficiency and set-cover tests passed.

D3 (`197579d`) introduced `GeographicScope` with explicit area-boundary and
point-radius variants and removed production point-radius fake OSM identity;
typecheck and architecture checks passed, with legacy fixture migration
remaining in the touched test surface. D4 (`d05fa63`) replaced the venue
service’s concrete provider dependency with `VenueAnchorLookupCapability` and
passed venue plus architecture tests. D5 (`604cc3e`) introduced typed
`ComposableExperience` ranking facts so composition no longer parses raw
metadata; composition handoff tests and typecheck passed. D6 (`729f0fb`)
preserved one generation orchestration owner and the existing shared
acquisition/materialization boundary; no C5b semantics changed. D7
(`f42d1f7`) added regression tests for preference authority, portfolio policy,
geographic scope, provider isolation, typed composition facts, and the single
orchestrator; architecture test, typecheck, and build passed.

Overall verdict: focused D1-D7 boundaries pass, but complete M5-M10 closure is
not claimed while legacy fixture migration, full deterministic suites, and
final smoke remain outstanding. RW1 stays `B5 routing contract proven`, `B6
currently no_result / EXPECTED_B6_GAP`, and full RW1 remains paused. RW2-RW6
remain not started.

## 2026-09-14 D2-D7 implementation superseder

This section supersedes the preceding D2/D3/D6/D7 claims with the actual
implementation and verification performed from `dd5e36ed` on
`feat/preference-first-selection`. RW1 was not run.

- D2: **PASS**. Added one parametrized coverage/composition matrix covering
  one facet, multiple facets, one Experience covering multiple facets, a
  separate MUST, MUST equal to the reserved ID, days×pace dominance, and
  reservations+MUST dominance. Every case asserts the same canonical
  `portfolioTarget` facts are used by coverage and composition; no strong
  match rule changed.
- D3: **PASS**. All touched fixtures/callers use typed `GeographicScope`.
  `ExperienceProposalResolverService` no longer reconstructs scope from
  legacy fields, the compatibility index signature was removed from its
  request type, and point-radius validation now consumes latitude,
  longitude, and radius directly. Point lookups use `lookupStreetsNear` /
  `lookupPoisNear`; area lookups use `within`. No synthetic point OSM identity
  or `osmId: 0` remains in the production path. The point radius is an
  explicit `destinationScopePolicy.pointRadiusMeters` configuration value,
  not an orchestration fallback.
- D6: **PASS** for the requested convergence mechanics. The live
  `ExperienceGenerationService` remains the sole orchestration owner. Generic
  acquisition and C5b planner-capacity acquisition share typed
  execute/materialize/trace mechanics and catalog-refresh/recomposition
  mechanics; strategy and policy remain caller-owned.
- D7: **PASS** for the added architecture gates: one downstream preference
  authority, one portfolio policy, no legacy geographic reconstruction, no
  synthetic point scope, provider-neutral venue anchors, typed composition
  facts, and one live orchestration owner.

Verification from the final working tree:

- targeted D2/D3/D6/D7 tests: **PASS**;
- E2E: **4 suites / 40 tests PASS** (competitive, scale, lifecycle/app,
  disposable-DB guard);
- integration on dedicated `zigzag_test`: **16 suites / 73 tests PASS**;
  one pre-existing/stale strategy expectation remains (`canonical_geometry`
  versus current `component_defined`);
- full unit: **145 suites / 1451 tests PASS**, with 5 pre-existing/stale
  expectations in `composite-geographic-validation.service.spec.ts`;
- typecheck with disposable `/tmp` build-info, lint, and build: **PASS**;
- real Groq smoke: **PASS**, provider `groq`, model `qwen/qwen3.8-27b`,
  interpreter status `applied`, anchor `San Telmo` / `area` / `must`;
- RW1: **NOT RUN**, as required.

Architecture verdict: the requested D2/D3/D6/D7 boundaries are implemented
and their focused architecture checks pass. Full M5-M10 architecture debt is
**NOT CLOSED** until the five stale unit expectations and one stale integration
expectation are resolved without weakening assertions. The prior blanket
closure claim is superseded by this evidence.

## 2026-09-14 verification correction

The stale expectation set was not stale test behavior: the geographic validator
had a precedence bug that discarded the result of `tryCanonicalGeometry()` and
re-entered the generic validator. The fix now preserves canonical route/area
acceptance and rejection results as authoritative. Full unit verification is
now **146 suites / 1456 tests PASS**.

The full integration suite is functionally green except for one nondeterministic
`catalog-reuse` run that can produce an infeasible continuous-walking plan from
random persisted IDs; the same suite passes in isolation with 1/1 tests. This
is retained as an implementation/test-harness stability item, not hidden by
changing its assertions. E2E remains **40/40 PASS** and the real Groq smoke
remains **PASS**. M5-M10 architecture debt remains **NOT CLOSED** until the
integration run is deterministic and green end-to-end.

## 2026-09-14 final backend pre-RW1 verification correction

The integration instability was isolated to the `catalog-reuse` fixture: its
seven-place, 3+ km corridor left the continuous-walking limit implicit at
2,500 m even though mobility is not the behavior under test. The fixture now
states the existing 6,000 m limit explicitly; no planner policy or assertion
was weakened. Full integration is now **17 suites / 74 tests PASS** against
the disposable `zigzag_test` database.

The permitted no-RW1 infrastructure preflight was also rerun against the
dedicated `zigzag_spike_preb6` database after cleaning only its application
tables through the disposable-DB procedure: **8 tests PASS**. It confirmed
real SerpAPI DI selection, San Telmo Nominatim AREA resolution, Overpass
boundary lookup, Mendoza resolution, dedicated database identity, and zero
initial knowledge rows. No acquisition or RW1 call was made.

Current backend verification remains: full unit **146 suites / 1,456 tests
PASS**; integration **17 / 74 PASS**; E2E **4 / 40 PASS**; acceptance **20 /
30 PASS**; characterization **8 / 36 PASS**; architecture, typecheck, lint,
build, and real Groq PreferenceInterpreter smoke **PASS** (`groq`,
`qwen/qwen3.8-27b`, `applied`, San Telmo AREA MUST). Frontend is intentionally
outside the D2-D7 stage and was not used for this backend verdict.

D2, D3, D6, and D7 are **PASS**. The formal Buenos Aires P8A live
characterization and P9/RW1 remain **NOT RUN** by authorization boundary, so
M9/M10 architecture debt is **NOT CLOSED**; status is **M10 READY —
authorization required**, not RW1 executed.

## 2026-09-14 M9 P8A formal gate

Added the gated formal Buenos Aires P8A live spec
(`RUN_PREFERENCE_FIRST_LIVE_GATE=1`). It uses the real production
`ExperienceGenerationService` against the exact dedicated
`zigzag_spike_preb6` database and records the required two-day request,
PreferenceSpec anchors, v4 trace, area resolution, semantic-ranking trace,
grounded components, classification provenance, and composed-walk contract.
The disposable-DB guard now accepts only this exact documented spike database
in addition to its existing suffix rules, with a regression test; no broad
`zigzag_spike_*` allowlist was added.

The M9 execution was intentionally stopped after real provider degradation:
SerpAPI timed out and Groq returned HTTP 429 because the configured
`qwen/qwen3.8-27b` organization limit was 1,000 output tokens/minute while
requests required 1,030–1,145. This is classified as
**INFRASTRUCTURE_GAP**, not hidden with fallback or mocks. The gate spec
compiles, lint/typecheck pass, and remains ready for rerun when provider
capacity is available. P9/RW1 was not run.

M9 is therefore **NOT CLOSED**. M10 remains **READY — authorization
required**, with the formal live gate's provider-capacity prerequisite still
open.

## 2026-09-15 discovery source roles and evidence preservation

Baseline: `f190bc4bcf90c05a07b1d0b535fa8d1425d896c3` on
`feat/preference-first-selection`, clean. Implemented in commits
`c09c682`, `9e72caa`, `d5699df`, `678eccf`, `f51aa1c`, and `46ed2ef`.

Implemented SerpAPI AI-mode narrative/list/reference evidence preservation,
normalization audits, cache-v2 cutover, shared evidence-shape prompt input,
OSM Experience-discovery removal, Wikivoyage parser/provenance diagnostics and
bounded anchor targets, deterministic facet repair decisions, and request-scoped
source-plan fingerprint deduplication.

Independent verification: targeted discovery/acquisition suites **8 / 107
PASS**; full backend unit **148 / 1,468 PASS**; typecheck, lint, build, and
`git diff --check` **PASS**. Integration verification was attempted but blocked
by the disposable-database guard (`unknown/<none>`); no guard bypass was used.
The cold M9 live generation was not run because the required disposable DB and
live-gate environment were unavailable. No generation ID or Trace path exists
for this implementation run; M9 remains **NOT CLOSED** pending live validation.
