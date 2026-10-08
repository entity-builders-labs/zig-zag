# Preference-First Selection — CURRENT MAIN PROGRESS

<!-- agent-track: id=preference-first-selection; status=ACTIVE; branch=feat/preference-first-selection; integration=main; base=016f10586d4faf9fe7e703a2d28684136cf99abe; plan=docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md -->

Updated: 2026-10-03
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

## Current execution verdict

*(Previously headed `Current execution verdict — 2026-09-29`. Renamed to the
canonical machine-readable heading so `scripts/agent-track context` resolves it
exactly; body unchanged.)*

**Trace v5 cutover — COMPLETE / ACTIVE TRACE AUTHORITY (native producer cutover complete; v4 legacy paths deleted; modular domain audit split complete; zero avoidable `any`).**  
**RW3 final classification/warm-reuse gate — CLOSED / ACCEPTED.**  
**RW4 — AUTHORIZED / NEXT GATE** (2026-10-02: stable deep-source examination [x]; work-unit geographic authorization landed; Experience geographic-scope architecture S1–S6 IMPLEMENTED with PD1/PD2/PD3 recorded, see "RW4 geographic scope cutover (S1–S6)" below; strict-vs-descriptive scope semantics + source-defined compositions amended by spec §P2-18, see "RW4 source-grounded geography amendment (§P2-18)" below — a missing Uco AREA polygon no longer blocks the composition; persistence/WARM of a REAL multi-component Experience still open — real component IDENTITY coverage/corroboration is the next blocker).

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


### RW4 source locality recovery (§19.1) — 2026-10-03

- Dossier: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/locality-recovery-2026-10-03/assessment.md`
  (real replays on the captured COLD #11 window, stub catalog, 0 rows
  persisted). No COLD #12 / WARM.
- Loss point: the extractor omitted the caption's locality it had received
  (failure mode 1). The prompt-only spike gave 0 assertions in 6 Gemini runs
  (current prompt and a strengthened one). A bounded recovery prompt gave
  6/6 (Gemini 3, Groq 3).
- Implemented: source locality recovery (§19.1), the only producer of
  `localityAssertion`, with deterministic selection, one model call and
  deterministic attribution-aware admission through the canonical gate.
  Script-aware literal matching backs the gate. The verifier is unchanged.
- Real replays on the new code:
  - Gemini 3 of 8 replays carried the Luján candidate, and each one ran the
    full chain: caption → ACCEPTED → GROUNDED `osm:relation:2989830` →
    `osm:node:4797394430` **VERIFIED**. The Córdoba hamlet was not selected.
  - The other 5 Gemini replays and all 3 Groq replays omitted the Luján
    candidate (failure mode 5, not addressed).
  - Cloudflare (the COLD #11 extractor): HTTP 429, daily allocation
    exhausted. **Not shown fixed.**
- Groq defect found and fixed: the shared LangChain transport formats the
  user prompt as an f-string template, so a literal `{` failed
  (`Single '}' in template`). The Groq adapter now escapes braces.

### RW4 candidate selection before identity verification — 2026-10-03

- Dossier: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/selection-characterization-2026-10-03/assessment.md`
  (real resolver replay; raw Nominatim pools recorded; stub catalog; 0 rows
  persisted). No COLD #12 / WARM.
- Ojo de Agua (observed): the resolver's `limit=5` Nominatim window held
  five non-Mendoza settlements (Córdoba, Neuquén, Tucumán, Salta, Jujuy).
  `destinationPoint` was available and correctly picked the nearest one,
  the Córdoba hamlet. The only Mendoza homonym, `osm:node:4797394430`
  (`amenity=restaurant`, Agrelo, Luján de Cuyo, importance 0), sits near the
  bottom of the 31-member pool and was truncated by provider importance
  before any evaluation. Overture independently holds "Ojo de Agua
  Argentina" (Meta) about 8 m away, which is not an exact name. The source
  asserts Luján de Cuyo and links `ojodeagua.ch`, but neither fact is typed
  on the component hint.
- Fixed (generic): NOMINATIM component acquisition requests the provider's
  whole window (`resultWindow: 'PROVIDER_MAXIMUM'`, cap 40). Post-fix replay:
  the Luján de Cuyo node is selected, EXACT_NAME/MULTIPLE (31), AMBIGUOUS,
  0 writes. Correct geography, insufficient identity. Proximity selects;
  it never verifies.
- Fixed (generic, RW4-ID-CONTRADICTION-1): typed `IDENTITY_CONTRADICTION`
  (`WIKIDATA_QID`, where the cited source's QID differs from the
  candidate's own QID). It is built locally and checked before every
  positive rule. Before this change, a local VERIFIED never collected
  Wikidata, and the collector silently preferred the candidate's QID over
  the source's.
- Unchanged: Alfa Crux and SuperUco are INSUFFICIENT_EVIDENCE (PARTIAL
  snapshot). Bodega Azul is INSUFFICIENT_EVIDENCE (no exact record; the
  winery and store stay distinct). A16 has nothing acquired. Previous
  NEARBY corrections are preserved.

### RW4 IdentityVerifier evidence-driven characterization — 2026-10-03

- Dossier: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/assessment.md`
  (live replay through the real resolver + real Overture index on a
  disposable DB; stub catalog; 0 rows persisted). No COLD #12 / WARM.
- Overture snapshot used: `rw4-uco-aoi-20261003` (release `2026-09-23.1`,
  AR, PARTIAL_PARTITION / OPERATIONAL_AOI). Exact-name multiplicity is
  therefore UNKNOWN by contract.
- Observed (post-fix): Alfa Crux and SuperUco are acquired from Overture,
  EXACT_NAME/UNKNOWN, no Wikidata item nearby -> INSUFFICIENT_EVIDENCE.
  Bodega Azul has no exact record; the Nominatim supermarket ->
  INSUFFICIENT_EVIDENCE. A16 has nothing acquired. Ojo de Agua (Lujan
  control) -> AMBIGUOUS.
- Demonstrated defects fixed in `IdentityVerifier` rule 4 (generic):
  (1) Wikidata NEARBY "nothing found" returned REJECTED, which collapses
  NOT_CORROBORATED into CONTRADICTED (amendment 2026-09-22 §6). It now
  falls through to the multiplicity fallback. (2) NEARBY corroboration
  disambiguated a MULTIPLE same-name pool: "Ojo de Agua" VERIFIED to a
  Cordoba hamlet 383 km away, with GeoEntity and hint-memory writes. It
  is now AMBIGUOUS. Neither change can produce a new VERIFIED.
  OWN_QID/OBSERVATION_QID behavior is retained (RW1 San Telmo).
- Gaps recorded, not changed: the Overture import drops locality, region,
  category, website and phone; the lookup ignores the stored address and
  `alternateNames`; `addressConfirmed` exists only on LOCAL_OSM_POOL; the
  evidence union has no contradiction type, so EXACT_NAME/SINGLE cannot be
  overridden by contradicting evidence; there is no repo importer.
- RW4 exit criteria unchanged: [ ] multi-component persisted; [ ] WARM.

### RW4 source-grounded geography amendment (§P2-18) — 2026-10-02

- Contract: spec `2026-10-02-geographic-validation-authorization-review.md`
  §P2-18 (amends PD2: UNKNOWN CANONICAL AREA does not imply UNKNOWN
  SOURCE-DEFINED COMPOSITION). Starting HEAD `4da25aef`.
- Invalid assumption removed: a regional Experience needs one enclosing
  canonical AREA/ROUTE, and a source-named AREA/ROUTE decides membership
  by point-in-polygon.
- Typed semantics: `ScopeMembershipSemantics` STRICT (user work-unit
  anchor; destination ceiling unless `mayExtendBeyondDestination` =
  ROUTE_LIKE without a strict anchor) vs DESCRIPTIVE (source-named
  AREA/ROUTE; mismatches are `outsideScopeComponentKeys` facts). New scope
  `SOURCE_DEFINED_COMPONENTS` (provenance `SOURCE_COMPOSITION`, no geometry,
  no search window) requires one supporting source record for every member
  (`evaluateSourceCompositionSupport`). `REGION_CONFLICT` re-targeted to a
  member outside a source-named AREA contradicting its region evidence;
  `COUNTRY_CONFLICT` kept; validator version 3.
- Identity acquisition: a destination-excluded location is admissible only
  from a COUNTRY-bounded provider query (Nominatim today; Places has no
  country bound) for a candidate that may extend beyond the destination;
  `IdentityVerifier` unchanged (homonyms AMBIGUOUS, non-exact INSUFFICIENT).
- WARM: `findVerifiedMultiComponentInArea` bounded (PostGIS window over the
  AREA's bbox ∪ exact area component; no global scan); a source-defined
  Experience is retrieved through a regional request scope without any
  area-role component (integration scenario J).
- Real Uco: geography no longer blocked by the missing "Valle de Uco"
  polygon; IDENTITY still blocks (Alfa Crux / SuperUco not acquired, Bodega
  Azul unverified, Overture not integrated). Nothing VERIFIED/persisted.
- Verification (executed): be typecheck, lint:check, build — exit 0; unit
  180 suites / 2384 tests PASS; integration (dedicated `zigzag_test`)
  24 suites / 107 tests PASS; e2e 4 suites / 41 tests PASS.
- Remaining RW4 blockers: real component identity (S7 Overture
  re-characterization → S8 decision); a destination-only request has no
  grounded context to retrieve a beyond-destination source-defined
  Experience and PD1 keeps it tour-ineligible (product decision needed for
  RW4 tour inclusion); descriptive user-region anchors need an explicit
  interpreted contract; canonical COLD #12 / WARM not run.

### RW4 geographic scope cutover (S1–S6) — 2026-10-02

- Contract: spec `2026-10-02-geographic-validation-authorization-review.md`
  Part II; implementation status in its §P2-17 (all of S1–S6 COMPLETE).
- Product decisions: PD1 (verified regional Experiences persist; from the
  destination window only WITHIN Experiences are tour-eligible; regional
  ones enter a tour only through an explicit ROUTE_LIKE `geographic_scope`
  anchor; no fabricated travel feasibility), PD2 (fail closed
  `GEOGRAPHIC_SCOPE_UNKNOWN`), PD3 (25 km point radius DEFERRED, unchanged).
- Removed authorities: `routeScaleDestinationRadius`, `routeScale` option,
  `ROUTE_SCALE` search scope, `WITHIN/OUTSIDE_ROUTE_DESTINATION_RADIUS`,
  `routeDestinationMismatch`, `authorizesRouteScale`,
  `DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS` (2/4/30/60/80/160 km),
  `PLACES_FALLBACK_BIAS_RADIUS_METERS`, `NOMINATIM_BIAS_RADIUS_METERS`, the
  T14 5 km default and the dead `StructuredGeoEntityResolverService`.
- Replacement authorities: `deriveExperienceGeographicScope` (scope),
  `scopeSearchWindow` (identity search), polygon-only
  `evaluateDestinationCompatibility` + `evaluateExperienceDestinationRelation`
  (destination fact), `isTourEligibleForDestinationRequest` (eligibility).
- Real Uco check: source supports a "Valle de Uco" AREA hint (not emitted
  live); canonical polygon NOT resolvable in public/local Nominatim (two
  streets only). The real candidate remains UNKNOWN-scoped; deterministic
  fixtures prove the scope path, not the live Uco result.
- COLD #11 proved candidate-scoped authorization propagation; it did NOT
  prove the 80 km policy (unchanged historical record).
- Remaining, kept separate: real Uco AREA availability (provider coverage /
  area-scale band for regions); identity coverage (Alfa Crux, SuperUco,
  Bodega Azul); identity corroboration (Overture evaluation, S7/S8);
  planning feasibility (routing-backed eligibility of regional Experiences,
  Planner Product Acceptance).

```text
RW4 EXIT CRITERIA
[x] stable deep-source examination
[ ] real multi-component Experience persisted
[ ] WARM reuses it
[ ] RW4 CLOSED
```

### RW4 geographic scope audit (distance thresholds) — 2026-10-02

- Docs-only architecture audit; no production change (`git diff -- be/src
  fe` empty). Contract: Part II of
  `docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md`.
- Trigger: Overture characterization
  (`spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/overture/assessment.md`)
  found Alfa Crux (105.2 km) and SuperUco (87.1 km) in a licensable source,
  outside the destination-centered 80 km "route-scale domain".
- History: `route.maxRadiusMeters = 80_000` was created on 2026-08-31
  (`e3c3d5d7`) as an internal route-coherence radius around the components'
  own centroid, with no rationale. `cc1e102b` (same evening) reused it as a
  destination-centroid circle, contradicting the same-day plan ("city plus
  surroundings remains out of scope"). `47ccae89` moved it into destination
  compatibility for identity resolution. `4da75fac` made it the ROUTE_LIKE
  Places identity search circle. No product requirement justified any reuse.
- Verdict: every geographic distance threshold in the tour engine is
  UNJUSTIFIED, UNKNOWN or an operational/provider cap. None is PRODUCT_POLICY
  (structural "≥2 components" excepted). `neighborhoodWalk` 2/4 km and
  `route.minAnchors` are dead code.
- Defect: one constant answered three different questions (composition
  coherence, destination compatibility, identity search scope). The existing
  candidate-owned AREA primitive (`canonical_area`, area-role hints,
  `evaluateAreaScopeMembership`) and route-scope membership are both gated by
  the destination polygon, so a regional Experience can never own a scope.
- Target: authorization (DEFAULT/WALK/ROUTE_LIKE) selects a policy class
  only. Experience scope = work-unit anchor ∧ (candidate-owned canonical
  AREA/ROUTE | destination AREA/POINT_RADIUS) else `GEOGRAPHIC_SCOPE_UNKNOWN`
  (fail-closed). Destination relation becomes a typed fact consumed by
  eligibility/planning. Identity search windows are derived from scope
  geometry. Milestones S0–S9 (spec §P2-14).
- Historical interpretation: COLD #11 correctly proved candidate-scoped
  ROUTE_LIKE authorization and its propagation into the then-current 80 km
  identity scope. It did not prove that 80 km is a correct product policy.
- Overture assessment corrected (annotations, not rewritten): provider
  coverage FOUND (Alfa Crux, SuperUco); current admission blocked by the
  superseded 80 km policy; identity value to be reassessed after S1–S5 and
  the S7 rerun. Verdict not upgraded.
- Open product decisions: PD1 tour eligibility of an Experience that extends
  beyond the trip destination before routing-backed feasibility exists; PD2
  UNKNOWN-scope policy (fail-closed recommended); PD3 point-destination
  radius value (25 km, UNKNOWN; may stay deferred).
- RW4 exit criteria unchanged: [x] stable deep-source examination;
  [ ] multi-component persisted; [ ] WARM reuse; [ ] RW4 CLOSED.
- Next blocker: the Experience geographic-scope architecture (S1–S5) is not
  implemented, and PD1 is open. Under the corrected architecture the COLD #11
  Uco candidate (3 venue hints, no area hint, components outside Ciudad de
  Mendoza) is `GEOGRAPHIC_SCOPE_UNKNOWN`. Its internal geometry is coherent
  (centroid radius ≈ 20.9 km, max pairwise ≈ 38.4 km).

### RW4 Google identity gates (legal, cost, portability) — 2026-10-02

- Characterization only: no production change, no COLD/WARM, no persisted
  diagnostic data, **0 live Google requests**. Dossier:
  `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/google/`.
- Provenance correction: the Alfa Crux address comes from the
  source-LINKED page (group host), not from the SolSalute source; level-1
  extraction had no address for `GeoEntityHint.addressHint`.
- Legal gate FAILED for Google as a canonical identity source (verified
  terms, non-EEA): only the Place ID may be stored; names/addresses may not
  be saved (ToS 3.2.3(a)(iii)); coordinates max 30 days (SST 14.3) and never
  input to point-in-polygon analysis (ToS 3.2.3(c)(iv)); no use with
  non-Google maps (ToS 3.2.3(e), SST 14.2). Zig-Zag persists candidate
  names/coordinates into GeoEntity, runs polygon destination compatibility
  on them, and renders Apple Maps on iOS. Unresolved: Place-ID-only
  cross-reference; EEA terms.
- Pre-existing finding: the deployed backend sets `PLACES_PROVIDER:
  "google"` (`terraform/templates/backend-user-data.sh.tftpl`). Needs a
  product/legal decision; not changed here.
- Cost gate: adapter `searchText` mask is Text Search Enterprise (rating,
  priceLevel, opening hours, websiteUri); an identity-only mask would be
  Pro. Calls skipped because the legal gate failed first and the real
  resolver path would itself perform the prohibited polygon analysis.
- Decision: unresolved coverage — no production implementation justified.
  Next task: bounded offline coverage check of an openly licensed global POI
  dataset (Overture Maps Places: CDLA-Permissive-2.0 / Apache-2.0 / CC0) for
  the four fixtures plus out-of-domain negative controls.
- RW4 exit criteria unchanged: [x] stable deep-source examination;
  [ ] multi-component persisted; [ ] WARM reuse; [ ] RW4 CLOSED.
- Next blocker: identity acquisition coverage in a licensable identity
  source for poorly indexed entities (Alfa Crux/SuperUco class).

### RW4 trace-policy fix + winery identity characterization — 2026-10-02

- Trace defect (found in COLD #11): the recorder's credential sanitizer
  (`SECRET_KEY` in `generation-trace-recorder.util.ts`) redacts any key
  containing "authorization", so `geographicAuthorization` was recorded as
  `[REDACTED]`. Fix `3066b4ad` `fix(trace): expose candidate geographic
  policy`: trace projections emit `geographicPolicy` (kind, workUnit,
  ownedIntent, ownedDeficit, admittedAs); domain type unchanged; credential
  redaction unchanged. Recorder-path regression proves the policy and
  work-unit provenance are visible while apiKey / Authorization header /
  token stay `[REDACTED]`; architecture guard forbids authorization-named
  trace keys. Gates: unit 178/2310, integration 23/104, typecheck, lint,
  build, `git diff --check` green.
- No COLD/WARM rerun. Characterization dossier:
  `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/`
  (README + per-component worksheets). Method: the COLD #11 composites
  replayed through the real resolver and real providers (local Nominatim/
  Overpass, Geoapify, Wikidata) with a stub catalog and a fresh disposable
  DB (0 rows after the probe), plus bounded source-justified query variants,
  local Overpass tag search, Wikidata search and one fetch of each
  source-linked official site. The replay reproduces COLD #11 exactly.
- Alfa Crux: no candidate in any enabled source (OSM, Nominatim, Geoapify,
  Wikidata; source-justified variants included) -> coverage gap. Its source
  link is a page on the group host agostinowinegroup.com; that page declares
  "Calle Los Indios s/n, El Cepillo, Valle de Uco", while the same host is the
  OSM website of a different winery (Finca Agostino, Maipú).
- SuperUco: no candidate anywhere -> coverage gap; official site behind a bot
  challenge (403), no address in the source.
- Bodega Azul: acquired "Bodega La Azul" (osm:node:4851595199, 73.2 km, only
  under ROUTE_SCALE). REJECTED because the only evidence was
  `WIKIDATA_IDENTITY_MATCH {NEARBY, hintMatched: false, candidateMatched:
  false}` (no Wikidata item exists); no exact name, alias, address or
  convergence. The OSM node and Geoapify details expose no website, alias or
  QID, so SAME identity cannot be strongly established even though the source
  links bodegalaazul.com ("Bodega La azul", Tupungato). A "La Azul"
  restaurant node sits at the same site.
- A16 (Luján composite): "A16" query acquires an unrelated "FC Belgrano"
  object (correctly rejected); A16 absent from all sources.
- Secondary findings, not blockers: non-matching Wikidata nearby search is
  encoded as REJECTED (should be unknown/insufficient); source hyperlink
  targets are dropped at extraction (`GeoEntityHint` has no URL field).
- Official-domain equality as future identity evidence: CONDITIONAL
  (safeguards in the dossier README: anchored link capture, redirect
  resolution, aggregator/group-host exclusion, single-candidate domain
  multiplicity, provider-declared website). Not implemented.
- first causal identity blocker = identity acquisition coverage: Alfa Crux and
  SuperUco have no candidate in any enabled identity source, so the Uco
  composite cannot complete regardless of verifier corroboration.
- Recommended next task: rerun the same harness with the existing Google
  Places adapter (`PLACES_PROVIDER=google`) for these components, within the
  Google quota, to decide whether an identity source covers them; if none
  does, reconsider the RW4 target composite (product decision).
- RW4 exit criteria:
  - [x] stable deep-source examination
  - [ ] real multi-component Experience persisted
  - [ ] WARM reuses it
  - [ ] RW4 CLOSED
- Next blocker: identity acquisition coverage for source-backed Uco winery
  components (Alfa Crux, SuperUco) in the enabled identity sources.

### RW4 work-unit geographic authorization + canonical COLD #11 — 2026-10-02

- Contract: `docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md`.
- Production `4da75fac` `fix(tours): scope geographic authorization to acquisition work`:
  - Work units (`partitionDeficitsIntoWorkUnits`): each open
    `intent:walk`/`intent:route_like` deficit is owned by its own
    `AREA_ROUTE_WALK` (single area/route/named-path anchor) or
    `DEDICATED_INTENT` unit (otherwise; plan built from that ONE deficit,
    so query, `requestedIntents`, evidence requirement and grant keep its
    provenance); every other deficit -> one `GENERIC` unit; planner
    backfill -> `PLANNER_CAPACITY`.
  - Global singleton removed: `request-validation-intent.util.ts`,
    `deriveRequestValidationIntent`, `validationIntentOf`,
    `MIXED_UNSUPPORTED`, `requestValidationIntent` and the batch
    `validationIntent` on resolver request/response are deleted
    (architecture guard in `preference-first-architecture.spec.ts`).
  - Typed `WorkUnitGeographicGrant` (`NONE | OWNED_INTENT`) and per-candidate
    `GeographicValidationAuthorization` (`DEFAULT | WALK | ROUTE_LIKE`, the
    latter two carrying the owning grant + `MULTI_COMPONENT_EXPERIENCE`),
    derived only from the unit's grant x `candidateSatisfiesEvidenceRequirement`.
    Resolver input is `AuthorizedExperienceCandidate[]`; GENERIC,
    PLANNER_CAPACITY, nearby and venue-anchor materialization are DEFAULT;
    single places inside owning units are DEFAULT.
  - Canonical physical ROUTE authority: canonical route geometry and
    route-scale thresholds require a resolved component with GeoEntity
    `kind === ROUTE` and usable LineString/MultiLineString geometry
    (`isUsableRouteGeometry`); the hint role `route` only confirms
    correspondence. AREA behaviour unchanged.
  - Identity-search scope: a ROUTE_LIKE-authorized candidate's Places
    search uses `routeScaleDestinationRadius` (destination centroid +
    `route.maxRadiusMeters` = 80 km, the same owner destination
    compatibility uses); DEFAULT/WALK keep the 50 km default circle.
    *(Historical code behavior / superseded interpretation: the 80 km
    destination-centered domain is not a valid authority — geographic scope
    audit 2026-10-02, spec Part II.)*
  - Observability: `resolution.component_identity` step per multi-component
    candidate (strategies, acquired?, selected candidate name/provider/
    coordinates, identity verdict, destination compatibility, final
    status/reason, search scope); selected-candidate coordinates added to
    attempt audits; `acquisition.pass` facts carry work unit, grant, web
    query, requested intents/themes, anchor names, evidence requirements.
  - RW4 input-control gate (`request-stimulus.cjs`) reads `workUnits`; a
    free-text `walk` owned by its own unit is valid (gate tests 12/12).
- Deterministic matrix A–M **PASS** (selector, authorization util,
  orchestration, acquisition materialization, ARW, resolver Places-scope L
  and batch heterogeneity M, validator F/G, compact-trace payload gate,
  integration 3b walk+route_like+visit/history).
  Gates: unit 178/2308, integration 23/104 (`zigzag_test`), e2e 4/41,
  typecheck, lint, build, `git diff --check` green.
- Canonical COLD #11: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold11/`
  (DB `zigzag_spike_rw4_canonical_cold_11`, port 4111). **CANONICAL**:
  source HEAD = manifest sourceHead = buildCommit = trace
  `runtime.buildCommit` = production `4da75fac260dfc0d...`;
  `canonical: true`, `failures: []`; dist `ff4c952fa036045e...`; fresh DB;
  `AI_CACHE_MODE=off`; preflight PASS; serper / cloudflare retrieval /
  cloudflare `@cf/qwen/qwen3.8-27b` / geoapify. Input control **PASS**
  (wizard `theme:wine`, `intent:route_like`, `intent:visit`; no free-text
  walk this run). Generation `completed` in 224 s.
- Work units (`cold11/analysis/cold11-summary.out.json`):
  - AREA_ROUTE_WALK `intent:route_like` ("Ruta del Vino de Mendoza"),
    grant OWNED_INTENT route_like. Pass 1 query "Ciudad de Mendoza Ruta del
    Vino de Mendoza scenic routes tours …", `requestedIntents=[route_like]`,
    requirement MULTI_COMPONENT_EXPERIENCE. SolSalute retrieved
    (discoverywinemendoza retrieval failed); deep window 1/17 ->
    `STOP_REQUIREMENT_SATISFIED`; admitted "Uco Valley Wine Tasting
    Itinerary" (Alfa Crux, SuperUco, Bodega Azul; source support 3/3
    `DECLARED_KEY_VERIFIED`) and "Lujan de Cuyo Wine Tasting Itinerary"
    (A16, Ojo de Agua). Outcome `no_result / no_accepted_results`.
    Pass 2: 0 candidates.
  - GENERIC `theme:wine`+`intent:visit`, grant NONE. 14 candidates (all
    single venues), 10 materialized as single-component Experiences;
    argentina4u deep window extracted 0. No generic Uco this run.
  - PLANNER_CAPACITY, grant NONE: 0 candidates (both deep sources failed
    retrieval).
  - DEDICATED_INTENT: not executed (route_like had a single anchor; no
    walk deficit).
- Route-like-owned lifecycle (Uco): route_like deficit -> AREA_ROUTE_WALK
  unit -> SolSalute -> extraction -> 3/3 source support -> admitted
  MULTI_COMPONENT -> ROUTE_LIKE authorization -> component identity:
  every Places attempt ran with `searchScope ROUTE_SCALE / 80000`
  (reachable only through a ROUTE_LIKE authorization):
  - Alfa Crux: catalog, trusted observation, local OSM, Nominatim, Places
    -> no candidate (Places 0 results at 80 km) -> `NO_OSM_MATCH`.
  - SuperUco: same strategies -> no candidate -> `NO_OSM_MATCH`.
  - Bodega Azul: Nominatim match `INCOMPATIBLE /
    OUTSIDE_ROUTE_DESTINATION_RADIUS`; Places "Bodega La Azul"
    (-33.4693, -69.2208, ~73 km) viable under route scale, identity
    verifier `REJECTED` -> `UNCONFIRMED_MATCH` (the source links
    bodegalaazul.com).
  - Candidate rejected (`NO_OSM_MATCH`, `UNCONFIRMED_MATCH`); geography
    not evaluated; not persisted.
  - Lujan de Cuyo: Ojo de Agua VERIFIED (Nominatim); A16 -> Places "FC
    Belgrano" REJECTED -> `INCOMPLETE_SOURCE_COMPOSITION`.
- Observability: compact steps 4,339 / 3,238 chars (intact) while
  `resolution.entity` (55,002 chars) was again truncated. **Defect found**:
  the trace sanitizer's secret-key pattern (`authorization`) redacts the
  per-candidate `geographicAuthorization` field to `[REDACTED]` in the
  compact and geography steps; the unit grant (`geographicGrant`) and the
  ROUTE_SCALE search scope are intact, so the ROUTE_LIKE authorization is
  established by construction + scope, not by the redacted field. The
  payload test projected the step but did not assert recorder
  sanitization. Fix pending (rename the trace field), not done in this run.
- First causal blocker = the route_like-owned AREA_ROUTE_WALK unit admits
  the source-backed Uco composite with ROUTE_LIKE authorization and
  route-scale identity search, but component Alfa Crux has no identity
  candidate under the enabled sources (also SuperUco; Bodega Azul's only
  candidate "Bodega La Azul" is rejected by identity verification).
- Persistence: GeoEntity 0 -> 11 (PLACE), Experience 0 -> 10 (all
  single-component, VERIFIED), ExperienceComponent 0 -> 10. No
  multi-component Experience persisted. **WARM: NOT RUN.**
- RW4 exit criteria:
  - [x] stable deep-source examination
  - [ ] real multi-component Experience persisted
  - [ ] WARM reuses it
  - [ ] RW4 CLOSED
- Next blocker: component identity coverage for source-backed winery
  components of the route_like-owned composite — Alfa Crux and SuperUco
  produce no identity candidate under enabled sources even within the
  route-scale Places domain, and "Bodega Azul" vs "Bodega La Azul" is
  rejected by IdentityVerifier. *(Superseded 2026-10-02: the "route-scale
  Places domain" is historical code behavior, not a valid authority; see the
  geographic scope audit above. COLD #11 proved authorization propagation,
  not the 80 km policy.)* Prerequisite before the next COLD: stop the
  trace sanitizer from redacting `geographicAuthorization`.
- Evidence: `cold11/` (`generation-trace.json`, `provenance.json`,
  `run-manifest.json`, `request-stimulus.json`, `input-control.json`,
  `db-before.json`, `db-after.json`, `provider-preflight.json`,
  `provider-config.txt`, `provider-requests.ndjson`, `backend.log`,
  `build.log`, `run.log`, `terminal-tour.json`,
  `analysis/cold11-summary.{cjs,out.json}`). Artifacts audited against all
  22 secret values in `.env`: 0 hits.

### RW4 progressive deep-source extraction + canonical COLD #10 — 2026-10-02

- Characterization correction: the COLD #9 hypothesis "the snippet should
  simply be bounded/subordinate in window ranking" was insufficient. The
  offline policy evaluation (`cold9/analysis/policy-eval/`, README) rejected
  every bounded snippet-weighting alternative; stable title/query context
  ranks the SolSalute itinerary chunk ~56–57/87, and no single ranking was
  shown to be both stable and to keep the itinerary. Refined defect: **a
  single heuristic source window was a correctness boundary**.
- Production fix `1769b5b5` `fix(tours): progressively scan deep source
  windows`:
  - `windowSourceContentSequence` (replaces `windowSourceContent`): window 1
    = the unchanged ranked selection; windows 2..N = every remaining chunk
    in document order, section-aware (a section that fits the budget is
    re-emitted whole; oversized sections are walked in runs sharing one
    boundary chunk). Finite, deterministic, every chunk examined, each
    window ≤ 6,000 chars.
  - Each source is fetched once; one extraction per source window,
    round-robin by window ordinal, exactly one source window substituted
    per attempt. Stops on the first attempt whose admitted candidates close
    the `MULTI_COMPONENT_EXPERIENCE` gap (shared `closesCompositionGap` over
    `candidateSatisfiesEvidenceRequirement`); continues past validation
    errors, unsupported or wrong-shape candidates; stops fail-closed on an
    extraction-level failure. Candidates are never merged across windows or
    sources. When nothing qualifies, the grounded-snippet result and
    evidence stand (previously the deep window-1 result replaced them).
  - Trace: per-source `windowSequence`, per-attempt `sourceWindow` +
    `scanDecision`, `scan` summary, one `acquisition.deep_source_window`
    step per attempt with its exact text.
  - DEBT: attempts are bounded only by the finite window sequence.
  - Gates: unit 177/2278; integration 23/103 on `zigzag_test` (first run had
    1 `catalog-reuse` failure, not reproduced in 2 isolated runs nor a full
    rerun; that test does not reach deep-source); e2e 4/41; typecheck,
    lint, build, `git diff --check` green.
- Offline SolSalute acceptance (`progressive-replay/`, production dist over
  the committed 88,401-char rendering): COLD #7 context → full mandatory Uco
  composition in window 1/17; COLD #9 context → window 9/18 (also with the
  stable title+query context alone). Mandatory components in one excerpt,
  optional Corazon del Sol / Solo Contigo in the same window; every chunk
  examined. **PROGRESSIVE WINDOWING OFFLINE = PASS.**
- Canonical COLD #10: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold10/`
  (DB `zigzag_spike_rw4_canonical_cold_10`, port 4110). **CANONICAL**:
  source HEAD = manifest = trace `runtime.buildCommit` =
  `1769b5b55321221e417be8bf77232d2418c42412`; `canonical: true`,
  `failures: []`; dist `edbfa6a2764c750e...`; `AI_CACHE_MODE=off`; fresh
  DB; preflight PASS. Provider chain identical to COLD #7–#9.
- **Input control = FAIL**: the free-text interpreter additionally emitted
  `intent:walk` (`free_text`) from the unchanged text ("Quiero recorrer la
  Ruta del Vino…"); COLD #9 had only the wizard facets. Generic partition
  unchanged (`theme:wine`, `intent:visit`); `area_route_walk` got
  `route_like`+`walk`. Request validation intent became
  `MIXED_UNSUPPORTED` (backend WARN) → `validationIntent` undefined →
  `routeScale=false` in every pass.
- Live progressive behaviour (`cold10/analysis/cold10-summary.out.json`):
  - generic: SolSalute (88,401 chars, 87 chunks, 17 windows) + winesofargentina
    (3 windows); window 1 of SolSalute kept 41153–43907 and closed the gap
    → `STOP_REQUIREMENT_SATISFIED` after 1 attempt.
  - area_route_walk ×2: discoverywinemendoza (15,654 chars, 4 windows)
    scanned 1→4 without a qualifying candidate (one window 4 ended
    `STOP_EXTRACTION_FAILED`: Qwen returned prose, "Failed to parse JSON
    response"); planner_capacity: puentesabroad 5/5 windows, exhausted.
  - Each source fetched once; 3 Cloudflare retrievals were `rate_limited`.
    18 extractor calls vs 4 in COLD #9; generation 254 s vs 99 s.
  - **PROGRESSIVE FALLBACK LIVE = LIVE-PROVEN** (attempts advanced past a
    non-qualifying window 1 to later source content), though the Uco
    candidate itself came from window 1.
- Uco lifecycle: "Uco Valley Wine Tasting Itinerary" extracted (Alfa Crux,
  SuperUco, Bodega Azul), source support 3/3 `DECLARED_KEY_VERIFIED`,
  admitted `MULTI_COMPONENT_EXPERIENCE`. A Luján de Cuyo itinerary (A16,
  Ojo de Agua) was also admitted. **UCO REDISCOVERED = YES.**
  `validationIntent = route_like` / `routeScale = true`: **NOT MET**
  (undefined / false, see input control).
- Identity/geography (observe only): resolved 0/3 —
  Alfa Crux `UNRESOLVED/NO_CANDIDATE_ACQUIRED`, SuperUco
  `UNRESOLVED/NO_CANDIDATE_ACQUIRED`, Bodega Azul
  `UNRESOLVED/DESTINATION_INCOMPATIBLE`; catalog reuse none for all three;
  local Nominatim + Geoapify geocode queried for each. Coordinates,
  per-provider candidates and verifier verdicts are NOT recoverable: the
  generic `resolution.entity` step exceeded `MAX_STEP_PAYLOAD_CHARS`
  (67,856 chars) and was truncated. Geography `NOT_EVALUATED`
  (`INCOMPLETE_SOURCE_COMPOSITION`). Destination compatibility for
  Nominatim/Places candidates is evaluated with `routeScale`, which was
  false — the same end state as COLD #7, by a different cause.
- First causal blocker (original, SUPERSEDED 2026-10-02 — see correction
  below): `free-text interpretation added intent:walk to the
  wizard's route_like, so the request validation intent was
  MIXED_UNSUPPORTED → routeScale=false; Uco components were judged against
  the Ciudad de Mendoza boundary (DESTINATION_INCOMPATIBLE /
  NO_CANDIDATE_ACQUIRED) and route-scale identity was never exercised`.
- Convergence: **COLD #10 FARTHER DOWNSTREAM THAN COLD #7 = NOT COMPARABLE**
  (input control FAIL; same stopping point as COLD #7).
- Persistence: GeoEntity 0 → 10 (PLACE), GeoEntityIdentity 0 → 10,
  Experience 0 → 10 (all single-component), ExperienceComponent 0 → 10,
  verifiedHintMemoryEntries 0 → 10. Uco: 3 source components, 0 resolved,
  0 geographically accepted, 0 persisted; not persisted; not planner
  eligible. `generationStatus: completed`, 4 experiences planned. WARM:
  NOT RUN (no qualifying reusable multi-component Experience).
- RW4 exit criteria:
  - [x] stable deep-source examination (deterministic progressive coverage;
    no known correctness hole in the bounded retrieved-source scan)
  - [ ] real multi-component Experience persisted
  - [ ] WARM reuses it
  - [ ] RW4 CLOSED
- Next blocker (original, SUPERSEDED 2026-10-02 — see correction below):
  request semantics are not reproducible — free-text intent
  interpretation can add `walk` beside the wizard's `route_like`, which
  disables route-scale destination compatibility before identity runs.
- **Interpretation correction (2026-10-02, architecture review
  `docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md`).**
  Run facts above are unchanged; only their interpretation changes.
  - `walk` + `route_like` in one request is a valid multi-intent tour, not
    an input defect. AREA_ROUTE_WALK units already validated with their own
    `intentKey`; only GENERIC and PLANNER_CAPACITY used the request-global
    `deriveRequestValidationIntent` → `MIXED_UNSUPPORTED` → no authority.
  - **First causal blocker = geographic validation authorization is modeled
    globally for the request/batch, so simultaneous walk + route_like
    collapses to no authorization instead of being applied through the
    correct acquisition work-unit / candidate authorization path.**
    Identity coverage is NOT the first blocker.
  - Precision from the review: "open route_like + admitted
    MULTI_COMPONENT_EXPERIENCE" is not authority (in the generic plan the
    multi-component requirement came from `theme:wine`; route_like was owned
    by the AREA_ROUTE_WALK unit). Under the recommended model the
    generic-discovered Uco validates under DEFAULT; a route-scale
    multi-component Experience must come from the unit that owns the
    route_like deficit.
  - KNOWN DOWNSTREAM FINDINGS / NOT YET PROMOTED TO BLOCKERS:
    - Alfa Crux: `NO_CANDIDATE_ACQUIRED` under currently enabled identity
      sources (trace-proven).
    - SuperUco: `NO_CANDIDATE_ACQUIRED` under currently enabled identity
      sources (trace-proven).
    - Bodega Azul: a candidate was acquired but later
      `DESTINATION_INCOMPATIBLE` under the incorrect default geography used
      in COLD #10 (verdict trace-proven; candidate coordinates/provider not
      recoverable — trace truncated).
    - `resolveViaPlaces` uses a fixed 50 km search circle
      (`PLACES_FALLBACK_BIAS_RADIUS_METERS`) while route-scale destination
      compatibility allows up to 80 km (code fact).
    - Prior manual checks (`cold10/analysis/uco-identity-probe.out.json`,
      observed, non-canonical) did not find the relevant wineries merely by
      raising Geoapify from 50 km to 80 km: Alfa Crux/SuperUco empty even at
      150 km; "Bodega La Azul" appears only at 73 km.
  - COLD #11 observability prerequisite: compact per-component evidence
    (component name, resolution strategies attempted, candidate acquired?,
    candidate coordinates, identity verifier verdict, destination
    compatibility verdict) — the `resolution.entity` payload (67,856 chars)
    exceeded the trace limit. Not solved yet.
  - RW4 EXIT CRITERIA

    ```text
    [x] stable deep-source examination
    [ ] real multi-component Experience persisted
    [ ] WARM reuses it
    [ ] RW4 CLOSED
    ```

  - **next blocker = geographic validation authority is request-global and
    batch-wide instead of being granted only by the acquisition work unit
    that exclusively owns an open walk/route_like deficit, and only to the
    candidates that unit admitted as MULTI_COMPONENT_EXPERIENCE
    (policy-bearing intent deficits must never be coalesced into generic
    plans).** No COLD #11 until that and the observability prerequisite land.
- Evidence: `cold10/` (`generation-trace.json`, `provenance.json`,
  `run-manifest.json`, `request-stimulus.json`, `input-control.json`,
  `db-before.json`, `db-after.json`, `provider-preflight.json`,
  `provider-config.txt`, `provider-requests.ndjson`, `backend.log`,
  `build.log`, `run.log`, `terminal-tour.json`,
  `analysis/cold10-summary.{cjs,out.json}`), `progressive-replay/`,
  `cold9/analysis/policy-eval/`.

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

## Current checkpoint

Source member identity (SOURCE_MEMBER_IDENTITY) is IMPLEMENTED, not merged
(2026-10-08, code `273bf4aa`). Evidence:
`spikes/source-member-identity-2026-10-08/README.md`.
- The structural relation reads source members (`sourcePosition` +
  `sourceName`), not resolution state; members correspond by wording or
  by a shared resolved GeoEntity. Hard invariant 15: enrichment, admin
  confirm and admin revoke never change composition identity.
- PARTIAL vs COMPLETE of one source is EXACT_COMPOSITION; A-B vs A-B-C-D
  SUBCOMPOSITION and A-F/A-B NEW in every resolution state.
- Replay of 217 baseline calls: 0 decision/relation flips. Decision table
  and thresholds unchanged. Verdict: READY_FOR_C3 (C3 itself still needs
  separate authorization). Debt: SAME onto a PARTIAL does not adopt the
  incoming member resolution.

Dedupe structural authority (DEDUPE_STRUCTURAL_AUTHORITY) is IMPLEMENTED,
not merged (2026-10-08). Evidence:
`spikes/dedupe-structural-authority-2026-10-08/README.md`.

- Identity is decided by a structural relation (EXACT_COMPOSITION /
  SUBCOMPOSITION / PARTIAL_OVERLAP / DISJOINT) + source-document relation
  in one policy; lexical semantic overlap is diagnostic/ranking only.
- `semantic >= 0.58 → AMBIGUOUS` and `strongConsistentIdentity` removed;
  spec §6.1 amended (invariant 14).
- A later A-B now coexists with a PARTIAL A-F (NEW). 2 expectation
  changes, both SUBCOMPOSITION; the resolved-only characterization needs
  owner review (dossier §8).
- Deferred: name >= 0.72 (still standalone on DISJOINT), component/role
  cuts. No C3, no live provider call.

Partial composite persistence (PARTIAL-COMPOSITE-1) is IMPLEMENTED,
not merged (2026-10-08, owner decisions D1–D7). Evidence:
`spikes/partial-composite-implementation-2026-10-08/README.md`.

- One `ExperienceComponent` row per source member (resolved or not),
  identity `(experienceId, sourcePosition)`; completeness derived.
- PARTIAL = >= 2 distinct resolved GeoEntities and only MISSING_KNOWLEDGE
  members, via one membership and one deficit-classification authority.
- Verified-hint assertions are audited; admin REVOKE / CONFIRM primitives
  exist (backend only). National Bank is administratively correctable.
- 4 pre-authorized expectation changes, plus D2 resolver changes and one
  dedupe interaction flagged for owner review (dossier §6–§7).
- No C3, no live provider call.

RW4 contextual physical identity: milestones 1, 2 and 3 are DONE
(2026-10-03, amendment §19, dossier
`identity-characterization/contextual-identity-2026-10-03/`).

- M1: ordered verifier policy with typed contradictions, independent-only
  convergence and contextual pool evaluation.
- M2: grounded component locality and kind assertions, the real OSM
  locality grounder, and hint memory reused only when it agrees with a
  stated locality.
- M3: Overture returns its whole pool. No storage change was needed: no
  discarded Overture field changes a fixture decision.
- Real decisions: Ojo de Agua is AMBIGUOUS on the Luján restaurant (the
  extractor emitted no locality assertion); Alfa Crux and SuperUco are
  INSUFFICIENT_EVIDENCE; Bodega Azul is INSUFFICIENT_EVIDENCE; A16 has no
  candidate. 0 rows persisted.
- No regression trading: an M1 rule broke RW1 El Zanjón and Farmacia la
  Estrella. Their historical tests are restored verbatim from `15af1ccb`
  and pass under a corrected generic rule. Shared-upstream convergence
  confirms a record only while no name collision is known; it never
  disambiguates one. Matrix: `contextual-identity-2026-10-03/regression-matrix.md`.
  No live RW1, RW2 or RW3 COLD/WARM run was executed.
- Ambiguity policy (2026-10-03, after `c708b9a9`). Defects A, B and C are
  closed. Characterization:
  `contextual-identity-2026-10-03/ambiguity-policy-characterization.md`.
  - Competitors are now a hint-level typed fact, `COMPETITOR_EXAMINATION`.
    It is computed from every pool examined for the hint and judged
    against the component's admission scope.
  - Convergence of any provenance decides only over an examined set
    (`NO_MATERIAL_COMPETITOR`).
  - A known material competitor makes the result AMBIGUOUS for every
    record-level fact.
  - A destination-bounded pool claims `SINGLE` only for a
    destination-bounded Experience.
  - A source QID equal to the candidate's QID is the typed
    `SOURCE_DECLARED_IDENTITY_MATCH`.
  - RW1 El Zanjón and Farmacia pass on unchanged fixtures.
  - The c708b9a9 code produced VERIFIED on three of the new regression
    cases. They are now INSUFFICIENT_EVIDENCE or AMBIGUOUS.
  - Two baseline verifier unit inputs (convergence with nothing about
    competitors) changed expectation. They are flagged in the matrix for
    independent review. Review outcome: Test A (INSUFFICIENT_EVIDENCE) is
    accepted; Test B's REJECTED was not, see RW4-ID-NEARBY-1.
- Source locality recovery (2026-10-03, after `1f48c462`, amendment §19.1).
  The source's locality now reaches the verifier without a hand-written
  assertion. In each real Gemini replay that extracted the Luján candidate
  (3 of 8), Ojo de Agua VERIFIED on `osm:node:4797394430` from the caption.
  The candidate itself is omitted in 5 of 8 Gemini and 3 of 3 Groq replays,
  and the Cloudflare replay is blocked by quota. This is a source-evidence
  milestone, not RW4 acceptance.
- NEARBY non-corroboration (2026-10-03, after `272d50ef`, RW4-ID-NEARBY-1).
  A NEARBY Wikidata result other than one item naming both the hint and
  the candidate is NOT_CORROBORATED, never REJECTED. Only that fallthrough
  changed. Running the new tests against `272d50ef` changed exactly 8
  cases, all REJECTED → INSUFFICIENT_EVIDENCE, and left 201 identical.
  El Zanjón, Farmacia, Ojo de Agua and `COMPETITOR_EXAMINATION` are
  unchanged.
- Geographic scope vs. identity coverage (2026-10-03, at `1ec18b9e`,
  characterization only). Verdict `UNKNOWN_IS_JUSTIFIED`. Dossier:
  `identity-characterization/geographic-scope-coverage-2026-10-03/assessment.md`.
  - Alfa Crux and SuperUco have admission scope AR (§P2-18, ROUTE_LIKE with
    no strict anchor). The authority is propagated correctly. The
    "Valle de Uco" heading creates no scope or locality. OSM holds no such
    AREA, and if it did, it would be DESCRIPTIVE.
  - The index holds the operational AOI only (`PARTIAL_PARTITION`), so the
    result is `UNKNOWN`. A read-only country-wide scan of release
    `2026-09-23.1` finds exactly one AR exact-name record for each, so a
    verifiable country-complete snapshot would verify them with the policy
    unchanged. That is a data gap, not a contract defect.
  - Typed AOI extent (RW4-ID-OVERTURE-COVERAGE-1) would not fix these two,
    because the AOI does not contain AR.
  - SUPERSEDED by the reassessment below: the contract itself was the
    defect. A country-complete snapshot no longer verifies them.
- Identity policy reassessment (2026-10-03, after `f8735a09`, amendment
  §19.2, RW4-ID-CORRESPONDENCE-1). Dossier:
  `identity-characterization/identity-policy-reassessment-2026-10-03/assessment.md`.
  - Name uniqueness, convergence over an examined set and NEARBY
    confirmation now decide only inside a grounded geography, carried as
    the typed fact `GEOGRAPHIC_CORRESPONDENCE`. Grounded means one of: a
    bounded admission scope, the component's grounded source locality, or
    a verified source-named AREA.
  - Country-wide uniqueness alone is not identity. At `f8735a09` the real
    Neuquén "Ojo de Agua" cabin VERIFIED from a complete-country snapshot
    when Nominatim failed. It is now INSUFFICIENT_EVIDENCE.
  - Overture AOI imports declare a typed enumerated extent (migration
    `20261003120000`, with a backfill of the real AOI). A partial snapshot
    is complete for a grounded locality its extent contains. No
    country-wide import is needed.
  - 10 adversarial resolver scenarios, with before/after verdicts on
    `f8735a09`; non-wine synthetic worlds included.
  - Real-provider replay (`replay-gemini-7` hints, no LLM, stub catalog, 0
    rows): Ojo de Agua VERIFIED (`SOURCE_LOCALITY`, Luján restaurant).
    Alfa Crux and SuperUco are INSUFFICIENT_EVIDENCE even with the
    full-article captions, because "Uco Valley" has no boundary
    (`NO_BOUNDARY`). Bodega Azul is the Azul supermarket,
    INSUFFICIENT_EVIDENCE.
  - Unit 2674/2674, integration 115/115, e2e 41/41; typecheck, lint and
    build green. No COLD/WARM run.

### RW4 functional COLD attempt — 2026-10-03

- **Non-canonical, isolated real campaign** (authorized functional evidence;
  not COLD #12):
  `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/functional-cold-20261003/`.
  It ran HEAD `8bfdc881f525711e0885b323c64b42546b9fe4a6` against
  `zigzag_spike_rw4_functional_cold_20261003` through the real configured
  acquisition, resolver, persistence and catalog path; the request completed
  in 153462 ms.
- COLD counts moved from `geoEntity=0, experience=0, experienceComponent=0`
  to `geoEntity=9, experience=9, experienceComponent=9`; all nine persisted
  Experiences have exactly one component. There are zero duplicate identity
  rows and zero duplicate Experience names, but **zero multi-component rows**.
  No target WARM run was performed and `RW4_FUNCTIONAL_MILESTONE_PASSED` is
  **not** recorded.
- The source-defined SolSalute Uco/Luján composites still did not materialize.
  This is evidence of the bounded source-composition/identity blocker, not a
  reason to relax identity or fabricate a composite.
- Existing Viator capture has three source-defined multi-stop products, but is
  sandbox-only and `viator.` is intentionally excluded from editorial web
  acquisition. Do not use cached/sandbox material as RW4 evidence or add a
  booking-site exception without separate product/provider authorization.

### RW4 functional composite campaign — 2026-10-05

- Evidence: `spikes/rw4-functional-composite-campaign-2026-10-05/`
  (`campaign-log.md` records every run). HEAD `672bf231`, canonical
  provenance verified on all four runs; identity policy unchanged.
- Correction to the 2026-10-03 attempt above: both of its web extraction
  attempts failed with Cloudflare Workers AI HTTP 429 (daily allocation).
  All nine singletons came from structured Geoapify results, so that run
  never exercised composite extraction.
- Bounded campaign: C1 Buenos Aires San Telmo walk, C2 Mendoza city-centre
  walk, C3 San Telmo self-guided walk (COLD + WARM). Destination-bounded
  walking shapes, `enjoys_walking` preset, fresh DB per COLD.
- C1 and C2 each persisted one composite, from free-tour operator or
  marketplace pages (guruwalk 5/5, walkingtoursmendoza 3/3). The campaign
  excluded these as sources. Editorial candidates in C1 and C2 failed
  closed (`INCOMPLETE_SOURCE_COMPOSITION`, `AMBIGUOUS_DEDUPE`), or were lost
  to a Browser Rendering 429.
- C3 persisted two **editorial** composites. Every hint the extractor
  emitted was VERIFIED:
  - `ca18c700-…` "Self-Guided Historical Walk in San Telmo"
    (secretsofbuenosaires.com Day 1): 7/7 components, evidence-ordered.
  - `177a2ae7-…` (agusyornet.com): 3/3 components.
- WARM on the same DB: 0 new rows of any kind, `coverage.analysis`
  SUFFICIENT, no walk/GENERIC acquisition, one PLANNER_CAPACITY backfill
  pass. `ca18c700` was retrieved from the catalog and planned day 1
  position 1, with the same 7 GeoEntity IDs. No PD1 defect surfaced.
- **Fidelity fails.** An independent fetch of each source shows both
  composites are subsets of what the source defines:
  - secretsofbuenosaires: windowing elided the day's continuation (national
    history museum, Caminito, La Bombonera).
  - agusyornet: the extractor's own window contained Farmacia la Estrella,
    Librería del Ávila, Mafalda and Plaza de Mayo, but only 3 stops were
    emitted, and a re-extraction emitted a different set.
- **RW4_FUNCTIONAL_MILESTONE_PASSED: NO.** Persistence and WARM reuse are
  proven for an editorial composite. The generic blocker is extraction
  completeness (RW4-EXTRACT-COMPLETENESS-1), not identity.

### RW4-EXTRACT-COMPLETENESS-1 fix — 2026-10-05

- Evidence: `spikes/rw4-extract-completeness-2026-10-05/` (frozen oracle,
  per-stop forensic loss table, real-extractor replays) and
  `spikes/rw4-functional-composite-campaign-2026-10-05/c3fix-gemini-cold/`.
- Root causes, all generic, fixed in `ebfe0ed9` and a follow-up prompt
  commit:
  1. Windowing cut heading sections into runs or ranked excerpts, and the
     scan accepted the first window whose candidate closed the gap.
     Windows now carry whole editorial units (heading sections up to
     `DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS`). A window that cuts a unit reports
     `sectionComplete: false` and cannot close the gap
     (`CONTINUE_SOURCE_UNIT_INCOMPLETE`).
  2. The parser kept only the first 8 `componentHints` (`MAX_HINTS`). It is
     now `MAX_COMPONENT_HINTS` (24), which rejects and never truncates.
  3. The prompt had no exhaustive-itinerary contract and treated
     "morning vs afternoon itinerary" as variants. It now requires
     exhaustive ordered extraction, a split at source-stated motorized
     transfers, no eat/drink suggestions and no passing mentions as stops,
     and a required `normalizationKind` with `sourceName`.
  4. The support gate turned `"**Name"**` into `" name" `; whitespace
     touching a quotation mark is now ignored on both sides.
- Unit 2690/2690, integration 115/115, e2e 41/41, typecheck, lint green;
  new guard, span and windowing tests proven red without the fix.
- Live C3 COLD (Gemini `gemini-3.5-flash-lite`, owner decision): both
  sources reached extraction as one complete unit, and no truncated
  composite was persisted. **0 composites persisted**:
  - secretsofbuenosaires: every oracle-mandatory stop that was emitted
    resolved INSIDE, but the model omitted Museo Histórico Nacional and also
    emitted passing streets that failed identity ("Estados Unidos",
    "Paseo de Colon"), so the candidate was rejected 10/12.
  - agusyornet: two mandatory stops (Mafalda, Patio de los Ezeiza) failed
    identity, so it was correctly rejected.
  - WARM not run, because nothing persisted.
- Status: the deterministic loss paths (window prefix, parser cut, span
  normalization) are CLOSED. Extractor recall/compliance remains OPEN and
  model-dependent: flash-lite still omits mandatory stops, emits passing
  mentions and drops `normalizationKind` run to run (`replays/fix-v*`).

### RW4-EXTRACT-COMPLETENESS-1 extractor reliability determination — 2026-10-06

- Evidence: `spikes/rw4-extract-completeness-2026-10-05/determination-2026-10-06.md`
  (frozen units, unchanged oracle, every run kept).
- Cloudflare `qwen3.8-27b`: 0 valid / 6 INVALID_RUN (daily allocation
  already exhausted, HTTP 429 code 4006); its reliability is undetermined.
- Gemini flash-lite on identical input: per-segment success is at most 1/6
  on any S1. The same input and prompt yield incompatible compositions.
  Some omissions are systematic (Obelisco 6/6). One unrelated
  naming-rule edit flipped AG's leading stops from 6/6 present to 9/9
  omitted.
- **Determination: model selection is not sufficient.** Every existing gate
  judges only emitted members, so an omission leaves no trace. A
  deterministic structural guard catches 0/12 incomplete SOB runs (a prose
  unit with no markers). On AG every numbered-stop rule flags the
  oracle-correct extraction.
- Recommended smallest mechanism (owner decision, needs a spec amendment,
  NOT implemented): exhaustive evidence-atom labelling. The unit is
  atomized deterministically, and the LLM must label every atom (STOP,
  TRANSFER, or OTHER with a reason). A missing label fails closed;
  membership, order and segments are assembled deterministically; names
  stay as evidenced, for the resolver. Probe: complete label coverage
  6/6. The SOB museum was STOP and the bus was TRANSFER in 3/3 runs. AG
  S2/S3 were emitted 3/3, against 1/15 for list extraction (that one
  mixed into S1). The STOP-vs-PASSING call stays semantic but becomes
  explicit.
- Normalization pressure (Part D): a corrected prompt reduced
  `MISSING_NORMALIZATION_KIND` from 2.0 to 0.7 per run but lowered recall.
  It was reverted. No production change in this checkpoint.
- C3 COLD not run: neither acceptance path is met. WARM is not applicable.

### RW4-EXTRACT-COMPLETENESS-1 exhaustive atom-labelling spike — 2026-10-06

- Owner direction: atomized exhaustive source labelling. Amend the
  architecture first, then run a bounded spike. No production cutover and
  no model search.
- Architecture amended (PROPOSED):
  `docs/architecture/activity-discovery-and-tour-generation.md`, section
  "exhaustive source-atom labelling amendment (2026-10-06)".
- Spike `spikes/rw4-atom-labelling-2026-10-06/` (README carries every
  run):
  - deterministic atomizer with exact unit coverage;
  - 6-way taxonomy; 0..n entities per atom with verbatim names, contained
    spans and verified anaphora (`mentionAtomId`);
  - exactly-once invariant, global-ID batching and one bounded relabel
    round, all fail closed;
  - deterministic segment/role assembly;
  - 16 deterministic tests pass.
- Gemini flash-lite, batched + relabel, 10 runs, 0 INVALID_RUN:
  - every atom labelled exactly once in every valid run;
  - 7/10 units ASSEMBLED, 6/10 oracle-exact on every segment, 3/10 fail
    closed on non-mandatory atoms;
  - SOB S1 8/8 and S2 2/2 in 5/5; AG S1 9/9 in 4/5 (Obelisco labelled
    `PASS_BY` once, visibly); AG S2/S3 in 5/5;
  - 0 segment mixing, 0 alternatives promoted;
  - the museum atom `a-079` was `ITINERARY_STOP` in 8/8 valid SOB runs.
- Residual: systematic promotion of walked streets and areas to mandatory
  (Defensa and Estados Unidos 5/5). The all-components identity gate would
  likely still reject SOB in C3. ~30% of units fail closed on contract
  slips.
- Recommendation: PROCEED_TO_PRODUCTIZATION (smallest cutover step in the
  spike README). Not implemented; production is unchanged.

### RW4 atom labelling milestone A (ROUTE_LEG gate) — 2026-10-06

- Owner approved productization in milestones A → B → C. B is not
  authorized until A passes.
- The amendment adds `ROUTE_LEG`, area and description rules,
  route-as-experience, the production trace and the outcome classes. The
  gate was frozen before the runs (`547d6acb`).
- v3 frozen replay:
  - recall equal or better per run (AG S1 9/9 in 5/5);
  - 0 mixing, 0 alternatives promoted;
  - CONTRACT_FAIL_CLOSED 1/8 (baseline 3/10);
  - RW3 route-as-experience fixtures PASS.
- **Gate FAIL:** route/area promotion rose from 2.9 to 3.4 per run.
  Causes: the transfer-destination rule, the v2 sight rule and directive
  verbs on streets in the prompt, plus the strongest-role merge across
  atoms. 2/10 INVALID_RUN: 4000-char batches exceeded the 25 s timeout.
  Details and the proposed v4 are in
  `spikes/rw4-atom-labelling-2026-10-06/README.md`.

- Re-gate v4 (frozen criteria and evaluator, `474b929a`): **FAIL** on
  criteria 2, 4, 5 and 9.
  - Streets are solved: SOB Defensa and Estados Unidos 0/4.
  - Puerto Madero is still promoted, 5/5, through its own TRANSFER atom.
  - Recall 94/95; contract fail-closed 2/9; operational 9/10.
  - Prompt tuning stopped by the stop rule.
  - Representation revision proposed (v5: a provenance-only
    `TRANSFER_DESTINATION` role; atom kind collapsed to
    content/transfer/non-itinerary with entity roles as the only role
    authority). An offline counterfactual over 23 recorded runs shows no
    recall cost.

- Last A re-gate v5 (R1 `TRANSFER_DESTINATION` + R2 entity-role
  authority, prompt unchanged, frozen `5aca6242`): **FAIL** on criteria
  2, 3, 5 and 9.
  - R1 and R2 worked: Puerto Madero 0/5, `ROLE_CONFLICT` 0,
    ROUTE_EXPERIENCE 3/3, operational 10/10.
  - Residual failures are label variance on borderline atoms, which v4 and
    v5 label identically by construction (Obelisco a-012 18/25 stop across
    batched runs; Avenida Caseros 1/4 vs 3/5); a navigation link a-172
    labelled a stop; and one systematic anaphora slip (a-078 "park")
    causing 3/10 contract fail-closed.
  - Stopped for owner review of the criteria (no v6). Questions are in the
    spike README.

### RW4 atom labelling milestone A closure + boundary hardening — 2026-10-06

- Owner decision: A is **COMPLETED_WITH_FINDINGS**. The frozen
  semantic-accuracy gate is not PASS. No v6/v7 prompt or taxonomy tuning.
- The acceptance model is now observable fidelity plus fail-safe
  processing. The ten-point definition, the outcome taxonomy and the
  minimum B trace contract are in the architecture amendment.
- **A.1 source-noise boundary:** the SOB unit runs to the page end, so
  its tail is site chrome. `a-172` "Best hotels in San Telmo" is a menu
  link. A generic rule now marks runs of ≥3 link-only atoms as
  `NON_EDITORIAL` before labelling. They are still accounted for exactly
  once and never presented to the model. No keyword list.
- **A.2 anaphora:** every `mentionAtomId` now resolves to an entity the
  cited atom carries: exact name, else the one whole-word match, else
  the sole entity. Otherwise it fails closed (`MENTION_ANTECEDENT_*`).
  This fixes the a-078 "park" fail-closed and the old silent "Plaza" and
  "Catedral" duplicate members.
- **A.3 batching:** 2500-char batches with a typed `TransportFailure` →
  `INVALID_RUN`, at most one relabel round.
- **Evidence:**
  - 32 deterministic spike tests pass.
  - Offline replay of all 16 recorded v5 units: 16/16 ASSEMBLED
    (recorded 13/16), with oracle recall unchanged.
  - Small live replay: SOB 8/8 + 2/2, AG 9/9 + 1/1 + 1/1, RW3 4/4,
    route 3/3.
  - 1 SOB `INVALID_RUN`: batch 1 timed out twice at 25 s.
- Remaining semantic disagreements stay visible on named atoms: Obelisco
  `a-012`, Avenida Caseros, San Telmo `a-041`, La Boca `a-043`, Defensa.
- All ten structural readiness properties hold, with batching near the
  25 s timeout as a measured B risk.
- Recommendation: **READY_FOR_B**. B is not started. Details are in the
  spike README, "Milestone A closure".

### RW4 atom labelling milestone B (production port) — 2026-10-06

- Owner authorized B only (no C3, no merge, no prompt tuning). Ported
  into `be/src/modules/tours`:
  - `utils/source-atomization.util.ts`: atomizer and A.1 editorial
    structure;
  - `utils/atom-labelling-contract.util.ts`: validation, merge,
    relabel scope, A.2 anaphora, batching;
  - `utils/atom-segment-assembly.util.ts`: assembly;
  - `utils/atomized-candidate-mapping.util.ts`: routing predicate,
    member kinds, naming, hints and trace;
  - `prompts/source-atom-labelling.prompt.ts`;
  - `services/atomized-source-unit-extractor.ts`;
  - trace steps `acquisition.atomized_source_unit` and
    `acquisition.atomized_source_atoms`.
- **Cutover:** in the deep-source scan, a `SECTION_UNIT` window with
  `sectionComplete=true` goes only to `AtomizedSourceUnitExtractor`
  (`inputKind: atomized_source_unit`). The generative extractor never
  sees that unit, and there is no fallback. Every other window keeps the
  generative path and its continuation rules.
- **Equivalence with the spike:**
  - atomization, separators and navigation blocks are byte-identical on
    the frozen SOB/AG units (`spike-golden.json`);
  - the batch plan and labelling prompt hashes match prompt v4;
  - the recorded live SOB run 1 and AG run 1 (with the AG relabel of
    `a-072`) replay offline to exactly the spike's segments.
- **Owner decisions taken during B:**
  - Identity routes on `GeoEntityHint.expectedKind`, which labelling does
    not produce. It comes from a separate, bounded per-segment
    member-kind call (`member-kind-prompt-v1`). It is exactly-once by
    member ID and never changes membership. The labelling prompt stays
    byte-identical.
  - Candidate names come from the source: the unit heading, then
    heading + the segment's unique source heading, then the grounded
    source title, then ` (part N of M)` only to disambiguate.
- **Downstream unchanged:**
  - candidates are raw extractor-shaped objects through the unchanged
    `extractExperienceCandidates` gate and source locality recovery;
  - hint `name` is the source wording, with no `sourceName` and no
    `normalizationKind`; the support span is a literal unit slice.
  - Recorded SOB: every hint is `SUPPORTED`.
  - Themes, intents and traits are empty and are owned by evidence-only
    classification.
- `MISSING_NORMALIZATION_KIND`: no bug. Name === source wording needs no
  kind, and a real normalization still requires one (tests).
- Verification on this tree:
  - `yarn test`: 195 suites, 2746 tests;
  - `yarn test:integration` (zigzag_test): 25 suites, 115 tests;
  - `yarn test:e2e`: 41/41 on 3 consecutive runs. One earlier run failed
    `experience-selection-competitive › CF5 5B-baseline` once; it did not
    reproduce in 3 isolated runs and does not touch acquisition;
  - typecheck and lint: clean.
- No live provider call was made in B. Per-call `elapsedMs` is now in the
  trace, so C3 measures the batching/timeout cost (25 s Gemini timeout
  unchanged).
- Recommendation: **READY_FOR_C3**, with the C3 precondition below.

### RW4 C3 COLD after milestone B — 2026-10-06

- Canonical run `c3-atomized-cold` at `9a9eca47`, same providers and
  request as C3fix. 0 multi-component Experiences persisted, so WARM was
  not run. Details: campaign log, "C3 COLD after milestone B".
- **The C3 precondition was not met:**
  - the AREA_ROUTE_WALK scan stopped at buenosairesfreewalks
    (`WHOLE_DOCUMENT`, generative) before agusyornet's window 1 was
    examined;
  - secretsofbuenosaires lost deep selection in every pass.
  - The oracle units were never atomized, so RW4-EXTRACT-COMPLETENESS-1
    is not evaluated.
- **B worked live** on two tangol `SECTION_UNIT`s:
  - both ASSEMBLED, one after a single relabel;
  - 0 INVALID_RUN, 0 CONTRACT_FAIL_CLOSED;
  - calls took 1.6–4.3 s against the 25 s timeout;
  - one composition authority held.
- Both tangol candidates were rejected downstream by
  `INCOMPLETE_SOURCE_COMPOSITION` (2/8, 2/3). Visible semantic
  disagreements: a tour product and an out-of-walk area labelled stops.

### RW4-C3-SELECTION-1 scan-order fix: bounded plan completion — 2026-10-07

- Root cause: the deep-source scan ran one round-robin schedule over the
  windows of every selected source and `break`ed on the first satisfying
  window, so `STOP_REQUIREMENT_SATISFIED` from source A ended the scan of
  every source, including already-selected and already-fetched source B.
- Fix (`experience-acquisition.service.ts`): source-local completion is
  now distinct from plan completion.
  - A satisfying window stops only its own source.
  - Every other selected source is still examined, until it satisfies
    or runs out of windows.
  - Only an extraction failure stops the plan early. A thrown failure
    after an earlier source satisfied keeps that source's result.
  - The plan's result is the union of the satisfying attempts. Each
    candidate keeps the evidence items its own attempt examined.
- Budget: selection (limit 2) and the single fetch are unchanged. No
  source is added. The worst case stays the finite window schedule; only
  extractor calls on already-fetched selected windows are added.
- Trace: `scan.plan` records `selectedSources`, `examinedSources`
  (first-examination order), per-source `localStop` (including
  `CONTENT_NOT_RETRIEVED`), and `completion`. `scan.satisfiedBy` is now a
  list.
- No extraction, identity, geography, source-support, dedupe or
  persistence semantics changed. No domain or source names are in
  production logic. No live provider call was made, and C3 was not run.
- Not addressed: a source that loses the selection limit (the
  secretsofbuenosaires case) is still never examined. That is selection,
  not scan order.

### RW4 C3 COLD retry at `d4e0754f` — 2026-10-07

- Canonical run `c3-retry-cold`, fresh DB, same providers and request.
  Details: campaign log, "C3 COLD retry after the bounded-plan scan fix".
- The scan fix held live:
  - in every pass, `selectedSources == examinedSources` and completion
    is `ALL_SELECTED_SOURCES_EXAMINED`;
  - in AREA_ROUTE_WALK, agusyornet satisfied first and
    secretsofbuenosaires was still examined.
- Both oracle units were atomized and ASSEMBLED in PLANNER_CAPACITY.
  This time search selected both, so the selection-limit loss did not
  recur (variance, not a fix).
- One 2-component Experience persisted (agusyornet part 2), but it does
  not qualify:
  - "Don Carlos" was VERIFIED as the OSM `historic=tomb` "Carlos
    Pellegrini", ~6 km away (RW4-ID-FALSE-VERIFY-1);
  - it is also only one part of the source walk.
- WARM not run. RW4_FUNCTIONAL_MILESTONE_PASSED: NO.

### RW4-ID-FALSE-VERIFY-1 identity trust fix — 2026-10-07

- Forensic: replayed the real resolver on the real local OSM pool and the
  real Wikidata item.
  - "Don Carlos" was AMBIGUOUS (11 material competitors) until the
    candidate's own QID arrived.
  - Rule 3d (`QID_LINK`) then VERIFIED it on a containment match
    ("carlos" ⊆ "Carlos Pellegrini"), ahead of competitor examination.
- Fix:
  - verification-grade name correspondence (`nameCorrespondence`:
    EQUIVALENT / OVERLAP / NONE);
  - a typed evidence-role authority (`identityEvidenceRole`); no
    RETRIEVAL_ONLY fact decides VERIFIED;
  - the QID link moved after competitor examination, the same rule for
    OWN_QID and OBSERVATION_QID;
  - competitors gated by the one structural-compatibility authority, for
    every provider.
- Spec: amendment §19.3 (rule 4b).
- Trace: every attempt carries `verificationRule`; the deciding attempt
  carries `identityDecision`.
- After the fix, the replay gives AMBIGUOUS for "Don Carlos". Four more
  false positives of the same class in the C3 trace are closed: Catedral,
  Bar El Federal, Club Atlético, Plaza.
- A4, P0.2 and the RW1 matrix are unchanged. Accepted recall loss:
  "La Librería del Avila", "The San Telmo Market", "Cabildo".
- Dossier:
  `spikes/rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2026-10-07/`.
  No C3 run.

### Recall forensic after the identity fix — 2026-10-07

- Owner state: `NOT_READY_FOR_C3_IDENTITY_RETRY`. A canonical place
  (Cabildo) must not be lost. No code change, no C3 run.
- Cabildo:
  - Blocked by 1 to 2 competitors, not 11 (the earlier report conflated
    it with Don Carlos).
  - The LOCAL competitor is the same building as the candidate (shared
    `wikidata=Q1024829`, same address, `short_name=Cabildo`), split across
    two OSM records.
  - Competitor identity keys ignore the shared QID, and the hint's exact
    name sits on the other record.
- La Librería del Avila and The San Telmo Market: no competitor; only a
  lexical gap ("del"/"de", "The"), with no non-lexical evidence.
- Shared-QID merge rules tested on the Buenos Aires pool:
  - containment misses Cabildo;
  - exact address merges FADU with Exactas (wrong).
- Recommendation: NEEDS_MORE_FORENSIC. Dossier:
  `spikes/rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2026-10-07/recall-forensic/`.

### Offline R1/R1+R2 simulation for Cabildo recall — 2026-10-07

- No production change; jest spies only.
- R1 groups:
  - Buenos Aires production pool: 1 (Cabildo, correct);
  - Mendoza production pool: 0;
  - broad Buenos Aires stress pool: 2 (Cabildo, plus FADU/Exactas, which is
    wrong).
- Real `CANDIDATE_AREA San Telmo` scope reproduced.
- Of 55 components, 6 change, all Cabildo hints, all to the correct
  record. R1 alone does not recover "Cabildo"; R1+R2 does
  (`GROUNDED_UNIQUE_ALIAS` via the way's `short_name`).
- Don Carlos, El Zanjón and Farmacia are unchanged. Fixtures never form an
  R1 group.
- FADU/Exactas: a self-contradicting QID tag on the Exactas node. R2 would
  copy FADU's names onto it (latent). Condition (a), each record's own
  name EQUIVALENT to the item, dissolves it and keeps Cabildo.
- Dossier:
  `spikes/rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2026-10-07/r1-r2-simulation/`.

### Record equivalence implemented (R1+R2 with member consistency) — 2026-10-07

- Owner-approved rule; spec §19.4. Single authority:
  `record-identity-equivalence.policy`, fed by the OSM boundary
  `osmEquivalenceRecord` and the typed `lookupPhysicalLocation` (P625,
  fail closed). LOCAL_OSM_POOL only.
- Cabildo: AMBIGUOUS before, VERIFIED (`GROUNDED_UNIQUE_ALIAS`) in all four
  replayed scopes. FADU/Exactas: no group, no alias transfer. Don Carlos:
  not verified.
- Real-data replay of the final code matches the simulation on 55 of 55
  components.
- Mutation runs:
  - without member consistency, FADU/Exactas fails;
  - without R2 aggregation, Cabildo fails;
  - without grouping, Cabildo fails (no fuzzy path is involved).
- No C3 run.

## Next authorized action

0000. (2026-10-08) Owner review of source member identity
      (`spikes/source-member-identity-2026-10-08/README.md`) together with
      the two reviews below; then a separately authorized C3 on a
      fresh/reset catalog. Do not merge; C3 not run.

000. (2026-10-08) Owner review of the dedupe structural authority
     (`spikes/dedupe-structural-authority-2026-10-08/README.md`), together
     with the partial composite review below. Do not merge; no C3.

00. (2026-10-08) Owner review of the partial composite implementation
    (`spikes/partial-composite-implementation-2026-10-08/README.md`),
    especially §6 (expectation changes outside the pre-authorized four)
    and §7 (identically described A-B held AMBIGUOUS). Do not merge. A
    later C3 needs separate authorization and a fresh/reset catalog.
    The §7 forensic is done
    (`spikes/semantic-overlap-threshold-forensic-2026-10-08/README.md`):
    verdict DEDUPE_MODEL_MISSING_STRUCTURAL_AUTHORITY,
    NO_EVIDENCE_FOUND_FOR_0_58. Owner decision needed on spec §6.1
    (name/semantic → AMBIGUOUS) and on containment/source-document evidence.
    No threshold change is authorized.

0. (2026-10-06, C3 COLD ran; precondition not met, no composite) Owner
   decision on how to reach the oracle units. Options, each needing
   authorization; none is started:
   - (a) rerun C3 COLD as is: search and selection vary per run;
   - (b) DONE 2026-10-07 for scan order, confirmed by the live C3 retry
     (`c3-retry-cold`, no qualifying composite). Selection-limit losses
     remain. RW4-ID-FALSE-VERIFY-1 and RW4-ID-RECALL-CABILDO-1 are fixed
     (2026-10-07). The authorized C3 identity retry (`c3-idretry-cold`,
       HEAD `3e945160`) was an INVALID_RUN: a Gemini 503/timeouts hit
       extraction, the runner poll got ECONNRESET, and the backend was killed
       before a terminal state, so no trace exists. The authorized rerun
       (`c3-idretry2-cold`, HEAD `11776382`, `be/` identical to `3e945160`)
       was canonical: 0 multi-component Experiences, WARM not run,
       RW4_FUNCTIONAL_MILESTONE_PASSED NO. Cabildo is VERIFIED in
       PLANNER_CAPACITY; there are 2 new false VERIFIED
       (RW4-ID-FALSE-VERIFY-2). Club Atlético is fixed in code
       (2026-10-07, §19.5); National Bank is blocked on an owner decision
       (RW4-ID-SOURCE-GROUNDING-1). Next step needs owner authorization;
   - (c) extend B's scope to complete `WHOLE_DOCUMENT` and whole-unit
     continuation windows (RW4-ATOM-SCOPE-1).
   C3 rules (kept from B):
   - C3 precondition: in the C3 trace, each oracle source's unit must be
     an `atomized_source_unit` attempt. Live C3fix put both at window 1,
     `SECTION_UNIT`. If a walk unit arrives as a continuation window
     instead, the run did not exercise B (RW4-ATOM-SCOPE-1); classify it
     that way, not as a B failure.
   - Classify outcomes with the amendment's taxonomy, from the
     `acquisition.atomized_source_unit` steps: `ASSEMBLED`,
     `CONTRACT_FAIL_CLOSED`, `INVALID_RUN`, then
     `FIDELITY_PASS_IDENTITY_*`.
   - No prompt tuning. Do not relax `INCOMPLETE_SOURCE_COMPOSITION`, source support,
   identity thresholds or `MISSING_NORMALIZATION_KIND`. A correctly
   extracted mandatory stop that fails identity (Mafalda, Patio de los
   Ezeiza) is a downstream blocker, never a reason to drop the stop.
1. Re-run the contextual replay with the COLD #11 extractor (Cloudflare
   `@cf/qwen/qwen3.8-27b`) once its daily allocation resets (`EXTRACTOR=cloudflare
   RUN_SUFFIX=../locality-recovery-2026-10-03/replay-cloudflare-N bash
   .../contextual-identity-2026-10-03/run.sh`). Record every run, not only a
   favorable one.
2. Characterize discovery-extraction candidate omission
   (RW4-EXTRACT-CANDIDATE-1). Do not fabricate the candidate or
   compensate in recovery, the gate or the verifier.

COLD #12 is NOT ready. The Uco composition requires Alfa Crux, SuperUco
and Bodega Azul, and all three are blocked:

- No geography reaches the resolver for Alfa Crux or SuperUco. The full
  article locates both "in the Uco Valley", but extraction never sees
  those sections (RW4-EXTRACT-SECTIONS-1), and "Uco Valley" has no
  groundable boundary (RW4-ID-REGION-GROUNDING-1).
- The release holds no "Bodega Azul" record, and "Bodega La Azul" is
  ambiguous.

Since §19.2, a country-complete Overture snapshot is neither required nor
sufficient. Do not import one for RW4. A regional boundary source would be
a new data capability and needs its own authorization.

The draft pull request for `feat/preference-first-selection` -> `main` exists
for review only. Do not merge to `main`, do not change RW4 conclusions, and do
not start an autonomous reviewer/fixer loop.

Independent review is requested for the 2026-10-03 ambiguity-policy
decisions recorded under RW4-ID-COMPETITOR-1, RW4-ID-DEST-UNIQUENESS-1 and
RW4-ID-CORRESPONDENCE-1 before RW4 COLD #12. That review does not block the extractor work above.

## Open findings / blockers

- RW4-DEDUPE-SEMANTIC-1: OPEN, owner decision. The lexical
  `semanticSimilarity >= 0.58` alone forces AMBIGUOUS (fail-closed reject).
  It is uncalibrated (`baba7da0`, no evidence), order-dependent through
  existing-side trait tokens, and the only reason the later A-B is held. The
  dedupe has no containment or source-document authority. Dossier:
  `spikes/semantic-overlap-threshold-forensic-2026-10-08/README.md`.
- PF-REVIEW-PROVIDER-1: OPEN, BLOCKING for automated review. The contextual
  review workflow cannot publish an artifact: the configured Groq endpoint
  rejects the Codex CLI request body (`invalid JSON body`, with
  `unknown field client_metadata` and unsupported `include` on replay). No
  canonical review exists for this branch's head. The first real product review
  of this head is therefore an independent ChatGPT review of the same SHA, not
  a Groq artifact. Provider choice is a human decision and is not made here.
- PF-CI-FLAKE-1: OPEN, MEDIUM. `backend-integration` failed once on
  `tour-generation/catalog-reuse` with
  `MAX_CONTINUOUS_WALKING_EXCEEDED` and passed on rerun of the identical
  merge result. The merge result's `be/` tree is byte-identical to this branch
  head, so this is product-suite flakiness in the RW4 area, not a governance
  regression. Do not weaken an invariant or a fixture to hide it.
  2026-10-03 local evidence: `catalog-reuse › reuses the persisted catalog on
  a second compatible request` failed 2 of 19 runs on the ambiguity-policy
  tree (`MAX_CONTINUOUS_WALKING_EXCEEDED`). With c708b9a9's production code
  swapped in, it failed 2 of 10 runs (`MAX_WALKING_PER_DAY_EXCEEDED`,
  `MAX_CONTINUOUS_WALKING_EXCEEDED`). Planner flake, unrelated to identity.
- RW4-ID-CONTRADICTION-1: CLOSED. Typed `IDENTITY_CONTRADICTION` covers
  WIKIDATA_QID, LOCALITY (outside a grounded stated locality) and
  PHYSICAL_KIND (structure contradicts a stated kind), and it precedes every
  positive rule. An address mismatch is still not a typed contradiction.
- RW4-ID-SEL-1: CLOSED. The NOMINATIM component window (top 5 by global
  importance) truncated the only plausible member before selection (Ojo de
  Agua). It now uses the provider-maximum window.
- RW4-ID-OVERTURE-SEL-1: CLOSED. Overture returns its whole exact-name
  pool. Selection uses the shared contextual policy plus nearest-to-window,
  and the selected member answers to the same scope admission.
- RW4-ID-CONVERGENCE-OSM-1: CLOSED. `CONVERGENCE_PROVENANCE` records only
  the upstream relation. Collision knowledge moved to the hint-level
  `COMPETITOR_EXAMINATION` (RW4-ID-COMPETITOR-1).
- RW4-ID-COMPETITOR-1: CLOSED (2026-10-03), independent review requested.
  - Defect A: convergence verified whenever no collision was *known*. That
    covered missing provenance, `UNKNOWN` multiplicity, partial or
    saturated pools and a failed Nominatim call. It now needs
    `NO_MATERIAL_COMPETITOR` from a complete pool that holds the
    candidate.
  - Defect B: a provider-local `SINGLE` ignored homonyms another pool had
    returned. Every pool examined for the hint now feeds the decision.
  - Defect C: `INDEPENDENT_UPSTREAMS` outranked known ambiguity. It now
    corroborates existence only.
  - Proof: the resolver-level tests were re-run against c708b9a9's
    production files. That code produced VERIFIED on the
    regional-destination pool, on the saturated-window convergence and on
    Places `SINGLE` over two Nominatim homonyms.
- RW4-ID-PLACES-LOCAL-SINGLE-1: CLOSED by RW4-ID-COMPETITOR-1. A Places
  `SINGLE` no longer verifies over a material homonym another pool
  returned. For a regional Experience a destination-bounded pool reports
  `UNKNOWN`, not `SINGLE`.
- RW4-ID-DEST-UNIQUENESS-1: OPEN, review. For a destination-bounded
  Experience, uniqueness inside the destination counts as uniqueness. This
  is the accepted contract (P0.2, A6, Galería Güemes G1), and 47 accepted
  tests depend on it. A homonym the component could never be admitted at
  is therefore not a competitor, even though the source might have meant
  it. Nominatim's own `EXACT_NAME` still counts country-wide homonyms. It
  is therefore stricter than the examination fact, in the safe direction.
  Changing the contract is a product/architecture decision, not part of
  this fix.
- RW4-ID-SOURCE-FACTS-1: PARTIALLY CLOSED. Locality, kind and link
  assertions are typed, grounded and audited. The locality is now produced
  by source locality recovery (§19.1), and the real replays show it reaching
  the verifier (Gemini). OPEN: the Cloudflare replay is blocked by quota.
  The Overture import still drops website, category and locality; no
  fixture decision depends on them.
- RW4-EXTRACT-CANDIDATE-1: OPEN, BLOCKING for the Luján composition. On the
  real window the extractor emits no Luján candidate in 5 of 8 Gemini
  replays and 3 of 3 Groq replays (failure mode 5). This is a discovery
  extraction failure, separate from locality recovery.
- RW4-I18N-NAME-1: OPEN, HIGH for non-Latin geographies (does not affect
  the Argentina fixtures). `normalizeGeoName` (64 callers, identity
  matching) folds every non-Latin name to `""`. "青山カフェ" and "銀座カフェ"
  therefore compare equal, and `buildIdentityEvidence` would emit
  `EXACT_NAME` for them (`locality-recovery-2026-10-03/normalize-geo-name-probe.txt`).
  Fixing it changes identity matching for every caller, so it needs its own
  characterized change. It was not done here.
- RW4-I18N-GROUNDING-1: OPEN, LOW. The locality grounder uses the same
  folding, so a non-Latin locality is `NO_BOUNDARY` (fail closed, pinned by
  a test). The local Nominatim covers Argentina only.
- RW4-LOC-RELATION-1: ACCEPTED RESIDUAL RISK. The containment relation is
  the model's semantic judgement. A single negated statement misread as
  `LOCATED_IN` cannot be detected in a language-neutral way. Literalness,
  attribution, unanimity, grounding and verifier contradictions still
  apply (§19.1).
- PF-CHAR7-1: OPEN, pre-existing. `test:characterization`
  `shared-component-identity` "A vs [B] ... AMBIGUOUS" fails with `NEW`. It
  fails identically at `1f48c462` without this change (checked on
  2026-10-03). It belongs to Experience dedupe and is untouched here.
- RW4-ID-OVERTURE-COVERAGE-1: CLOSED (2026-10-03, §19.2). AOI imports
  declare typed `extentWest/South/East/North`, which `beginImport`
  requires and validates. A partial snapshot is a complete comparison
  for a grounded locality its extent contains. The real AOI's extent was
  backfilled from its manifest by the migration; no code reads the
  manifest.
- RW4-ID-OVERTURE-SINGLE-DATASET-1: OPEN, MEDIUM, blocks publishing a
  country-complete Overture snapshot. Release `2026-09-23.1` holds exactly
  one AR "Ojo de Agua", a Neuquén cabin, which is not the source's Luján
  restaurant. On a country-complete snapshot, Overture alone would report
  `SINGLE` for the wrong homonym. Today it stays AMBIGUOUS only because
  Nominatim's earlier untruncated pool exposes the homonyms (rule 4
  precedes rule 6). If Nominatim fails and no other pool exposes a homonym,
  the cabin would VERIFY. Required tests are listed in the
  geographic-scope-coverage dossier, Q6 (a)–(e). A policy decision is
  needed before shipping.
  CLOSED (2026-10-03) by RW4-ID-CORRESPONDENCE-1. Country-wide `SINGLE`
  with no grounded geography is INSUFFICIENT_EVIDENCE (resolver scenario
  6; integration test "real false-positive shape"). With a Luján
  locality, the cabin is REJECTED (scenario 5).
- RW4-ID-CORRESPONDENCE-1: CLOSED (2026-10-03), independent review
  requested. Uniqueness decides only inside a grounded geography (§19.2).
  - Changed expectations: tests that encoded country-wide uniqueness as
    identity, listed in the dossier §6.
  - Residual risks: a homonym inside the stated geography, and a source
    listing a place outside the AREA it names.
- RW4-ID-REGION-GROUNDING-1: OPEN, BLOCKING for the Uco composition.
  "Uco Valley" / "Valle de Uco" is a wine region, not an administrative
  unit, so the OSM grounder returns `NO_BOUNDARY`. No configured provider
  grounds it, and a regional boundary source would be a new capability.
- RW4-EXTRACT-SECTIONS-1: OPEN. The extraction window holds the itinerary
  only. The full SolSalute article locates Alfa Crux and SuperUco in other
  sections, which recovery never sees.
  2026-10-05: reproduced on a destination-bounded editorial source. The
  secretsofbuenosaires Day 1 window kept 644–3536 and 4667–7593 of 17027
  chars, and the persisted composite ends before the day's last three
  stops.
- RW4-EXTRACT-COMPLETENESS-1: OPEN, BLOCKING (2026-10-06). The
  deterministic loss paths (window prefixes, the 8-hint parser cut, the
  quoted-span normalization) are fixed. The remaining defect is not
  model-dependent in a way model choice can close: an extractor can omit a
  source-defined stop silently, and no gate sees omissions. The
  atom-labelling mechanism is specified (APPROVED amendment) and
  demonstrated in a spike: omissions become explicit atom decisions and
  segments are assembled deterministically. Milestone A is
  COMPLETED_WITH_FINDINGS (2026-10-06), and the A.1 chrome boundary, the
  A.2 anaphora contract and A.3 batching have landed in the spike.
  Milestone B (2026-10-06) cut complete `SECTION_UNIT`s over to the
  atomized contract in production: one composition authority, and a
  pre-identity trace. Recommendation: READY_FOR_C3. It stays OPEN until
  C3; see "milestone B (production port)" above.
- RW4-ATOM-SCOPE-1: OPEN, MEDIUM (2026-10-06, B scope boundary).
  - Only a `SECTION_UNIT` window with `sectionComplete=true` is atomized.
    A whole editorial unit that reaches extraction as a
    `DOCUMENT_ORDER_CONTINUATION` window (also `sectionComplete=true`)
    still takes the generative path.
  - Example: the full SOB page with a plain snippet context puts the walk
    unit in window 3.
  - Atomizing such a window as-is is unsafe: it may hold several whole
    units, and assembly would mix them. Extending the scope (atomize per
    whole unit inside a window) is an owner decision.
  - Not a C3 blocker: live C3fix had both oracle units at window 1,
    `SECTION_UNIT`.
- RW4-C3-SELECTION-1: OPEN, MEDIUM (2026-10-06, C3 after B). Both oracle
  sources were in grounded search, but neither was atomized.
  - agusyornet was selected, but the scan stopped once
    buenosairesfreewalks (examined first) produced a qualifying
    generative candidate.
  - secretsofbuenosaires lost the deep selection limit (2) in all passes.
  - It is not an extraction defect, but it decides whether C3 can test
    RW4-EXTRACT-COMPLETENESS-1.
  - 2026-10-07: the scan-order half is fixed. Every selected source is
    examined before plan completion. The selection-limit half
    (secretsofbuenosaires) stays OPEN, and a live C3 retry has not run.
- RW4-ATOM-SCOPE-1 addendum (C3): a complete `WHOLE_DOCUMENT` window
  (buenosairesfreewalks) also stays on the generative path.
- RW4-ID-FALSE-VERIFY-1: FIXED, confirmed live in `c3-idretry2-cold`
  (2026-10-07): Don Carlos AMBIGUOUS/NAME_COLLISION, Catedral and
  Bar El Federal AMBIGUOUS; none persisted.
  The source stop "Don Carlos" was VERIFIED as the tomb of Carlos
  Pellegrini. The cause was a fuzzy hint-to-label match on the
  candidate's own QID, decided ahead of 11 known material competitors.
  Spec §19.3. Thresholds untouched.
- RW4-ID-FALSE-VERIFY-2: OPEN, HIGH (`c3-idretry2-cold`, 2026-10-07).
  `GROUNDED_CONVERGENCE` VERIFIED two hints whose names only OVERLAP the
  record: "Club Atlético" (the Paseo Colón memorial) as
  `Club Atlético San Lorenzo de Almagro - Sede Boedo` (`osm:way:23634484`)
  and "National Bank" (the HQ on Plaza de Mayo) as
  `Edificio First National Bank of Boston` (`osm:relation:9254658`).
  - In both, Nominatim and Places converged on one OSM record, there were
    0 known material competitors, and the geography basis was
    `BOUNDED_ADMISSION_SCOPE` (city).
  - Both were persisted as GeoEntities with the hint in
    `verifiedHintNames`, although their composite was REJECTED.
  - 2026-10-07: Club Atlético FIXED in code (spec §19.5: competitors
    counted at the candidate's own name grade; impact matrix 27/27
    unchanged, no test expectation changed). National Bank OPEN,
    BLOCKED_BY_MISSING_DISCRIMINATING_EVIDENCE: only the source context
    separates it from Farmacia la Estrella (RW4-ID-SOURCE-GROUNDING-1).
    An origin-independence fix (`b3a13e33`) regressed El Zanjón and
    Farmacia and was reverted (`89fcc6de`).
  - Both rows are persisted with the hint in `verifiedHintNames`: reset
    the C3 catalog before any WARM run on it.
  - 2026-10-08: the false learned mapping is administratively correctable
    (`CatalogKnowledgeAdministrationService` REVOKE, then CONFIRM against
    Banco de la Nación). Automatic resolution is unchanged.
- RW4-ID-SOURCE-GROUNDING-1: AUTHORIZED 2026-10-07 (typed adjacent-atom /
  anaphora assertions with provenance), not implemented:
  BLOCKED_BY_MISSING_DISCRIMINATING_EVIDENCE. The only fact separating
  Banco Nación (22 m) from First National Bank of Boston (159 m) relative
  to the Plaza de Mayo park is a distance. Canonical area relations,
  topology, Wikidata and administrative containment do not separate them.
  New thresholds are forbidden, so the assertion would be UNVERIFIABLE and
  change no decision. Evidence:
  `identity-false-verify-2-2026-10-07/association-evidence.md`. Unblock
  options need an owner decision (a city-block adjacency primitive).
  Correct-candidate retrieval is a separate deficiency: "National Bank"
  corresponds NONE to "Banco Nación"; the atomized path has no TRANSLATION
  normalization.
- PARTIAL-COMPOSITE-1: IMPLEMENTED 2026-10-08 (`8bd16b97`, `d047b179`),
  awaiting owner review; not merged. Evidence:
  `spikes/partial-composite-implementation-2026-10-08/README.md`.
  Open for the owner: the D2 resolver expectation changes and the
  identically described A-B case (dossier §6–§7). Pre-implementation
  investigation, kept for provenance: the owner's proposal is to persist a
  source composite with >= 2 distinct resolved GeoEntities, keeping its
  unresolved members.
  - Dossier: `spikes/partial-composite-investigation-2026-10-07/README.md`.
  - Feasible on the same `ExperienceComponent` table (nullable
    `geoEntityId`, plus source name and resolution fields), with
    completeness derived.
  - Impact: 4 intentional expectation changes and 1 dedupe risk to prove.
  - At HEAD, National Bank is still a false VERIFIED, not unresolved. It
    would persist as a routable stop. Its remembered hint would make an
    admin link AMBIGUOUS.
  - Tours freeze components in `TourExperienceComponent`, so enrichment
    reaches only new Tours.
  - Blocked on owner decisions D1–D7 in the dossier.
- RW4-ID-RECALL-CABILDO-1: FIXED, confirmed live in PLANNER_CAPACITY
  (`c3-idretry2-cold`, 2026-10-07): VERIFIED / `GROUNDED_UNIQUE_ALIAS`
  via LOCAL_OSM_POOL, recordEquivalence grouped Q1024829
  (`osm:node:767690911` + `osm:way:293947112`, "bolivar 65"). In
  AREA_ROUTE_WALK, LOCAL_OSM_POOL acquired no Cabildo candidate. NOMINATIM
  then stayed AMBIGUOUS/`MATERIAL_COMPETITOR_KNOWN` (1 competitor), and
  record equivalence is LOCAL_OSM_POOL-only.
  Record equivalence (spec §19.4). Introduced by the identity fix in
  PLANNER_CAPACITY (the route-scoped pass already failed).
  - One landmark is split across two OSM records that share a located QID
    and an address. The other record is counted as a material competitor,
    and the hint's exact name is only that record's `short_name`.
  - A recall fix needs a safe same-identity rule. The candidate rules
    tested so far either miss Cabildo or merge distinct faculties.
- RW4-ID-EQUIV-RECALL-1: OPEN, LOW (2026-10-07). Equivalence has no
  stopword handling, so article and preposition variants of a true
  referent ("La Librería del Avila" / "Librería de Ávila", "The San Telmo
  Market") no longer verify through a name-linked QID. Any fix must stay
  language-neutral and must not reopen OVERLAP as proof.
- RW4-ID-QID-NONPHYSICAL-1: OPEN, LOW (2026-10-07). A candidate's own QID
  can name a non-physical subject (Q270446 is a human, without P625; the
  "Catedral Constructiva" node's QID is a painting). This is a candidate
  generic contradiction for a PLACE, but the Wikidata summary does not
  carry P31/P625. It needs an adapter extension and an owner decision.
- RW4-ID-RETRIEVAL-QID-BIAS-1: OPEN, LOW (2026-10-07). Among fuzzy ties,
  `bestFuzzyMatch` prefers a record carrying a `wikidata` tag. It is
  harmless for verification now (an OVERLAP link decides nothing), but
  retrieval still favours the QID-tagged homonym over the source's place.
- RW4-ATOM-KIND-1: OPEN, LOW (2026-10-06).
  - The member-kind call is a new bounded semantic step (PLACE/AREA/ROUTE
    per mandatory member), decided in B because identity routes on it.
  - It cannot change membership, and any contract slip fails the unit
    closed. Its labels have not been measured live; a wrong ROUTE vs
    PLACE label shows up as an identity outcome in C3, attributable via
    `physicalKind` in the trace.
- RW4-ID-C3-AGUS-1: OPEN, separate from extraction. In C3 COLD the
  faithfully emitted agusyornet stops Monumento de Mafalda and El Patio de
  los Ezeiza were `CANDIDATE_REJECTED` by identity. Thresholds untouched.
- RW4-EXTRACT-NORMALIZATION-1: OPEN, MEDIUM. The prompt mandates
  normalization ("SHOULD translate or normalize"), and the schema calls
  `normalizationKind` "Optional". Gemini expands names already in the
  local language without the kind, so 5/6 SOB candidates with complete
  recall were rejected. A corrected wording lowered recall and was
  reverted (`normfix-prompt.diff`). The validator stays strict.
- RW4-EXTRACT-GEMINI-TRANSPORT-1: OPEN, MEDIUM. The Gemini extractor sends
  no temperature and no output budget, and it reads no finish status
  (`gemini-discovery.provider.ts`), unlike Cloudflare (temperature 0,
  rejects `finish_reason: length`). Gemini runs sample at the provider
  default, and truncation surfaces only as a JSON parse failure.
  Original finding (2026-10-05). The discovery extractor emits a non-deterministic
  subset of a source's explicitly enumerated stops. Example: agusyornet,
  3 emitted of at least 8 present in the same window. The resolver
  resolves what it is given, so a truncated composite persists as
  VERIFIED. Evidence: `rw4-functional-composite-campaign-2026-10-05/campaign-log.md`.
- RW4-FUNC-TRANSPORT-1: OPEN, LOW. Cloudflare Browser Rendering free tier
  answers 429 `Rate limit exceeded` to the second sequential deep fetch,
  with no retry, so an editorial source is lost (C1).
- RW4-SOURCE-CLASS-1: OPEN, product decision. Deep selection treats
  free-tour operator and marketplace pages (guruwalk, buenosairesfreewalks,
  walkingtoursmendoza) as editorial-eligible, and `intent:walk` queries
  rank them first. The RW4 functional campaign excluded them; admissibility
  is not decided here.
- RW4-ID-EXAMINATION-ORDER-1: OPEN, LOW. A decision by an earlier strategy
  ends examination, so a later pool's homonyms are never seen. Real
  shape: Nominatim holds one "Bodega La Azul" winery, while Overture holds
  two wineries and a store. Examining every cheap local pool before a
  uniqueness decision is a candidate fix; it is not done here.
- RW4-ID-ADDRESS-1: OPEN, LOW. `addressConfirmed` (ADDRESS_MATCH) is still
  computed only on LOCAL_OSM_POOL.
- Overture storage findings: OPEN, separate from identity, untouched here.
  (1) A historical Prisma migration was rewritten. (2) Publishing one
  partition supersedes the other independently imported partitions of the
  same country. (3) COMPLETE_COUNTRY declarations lack adequate proof.
- RW4-ID-NEARBY-1: CLOSED (2026-10-03). `NEARBY(true, false)` and
  `NEARBY(false, true)` returned REJECTED when no earlier rule decided.
  A nearby label naming only one of the two texts is textual
  non-corroboration. El Zanjón's "(historic ruins)" suffix is enough to
  produce it. It is not a contradiction (amendment §6). Five historical
  expectations moved from REJECTED to INSUFFICIENT_EVIDENCE with their
  inputs verbatim; the matrix records each one.
- RW4-ID-QID-LABEL-1: OPEN, LOW, review. A failing `OWN_QID` label match
  (the candidate's own item does not name the hint) or `OBSERVATION_QID`
  label match (the source's item does not name the candidate) is still
  REJECTED. That is label-text matching on an item structurally linked to
  one side, not a typed QID contradiction. It is accepted policy (Recoleta
  collision, `662d817c`) and was deliberately left unchanged. The verifier
  tests A9/A10 use `OWN_QID (true, false)`, a shape the collector never
  produces.
- RW4-ID-QID-HOMONYM-1: NARROWED (2026-10-07). A QID link now needs an
  EQUIVALENT name and runs after competitor examination. A known material
  competitor always blocks it. The residual case is a homonym no examined
  pool exposed.
- RW4-INT-FLAKE-2: MERGED into PF-CI-FLAKE-1. `catalog-reuse` failed COLD
  planning with `MAX_WALKING_PER_DAY_EXCEEDED` in 1 of 6 runs on this tree.
  The untouched baseline `15af1ccb` fails identically in 1 of 10 runs, so
  this is a pre-existing planner flake, not an identity regression.
- RW4-E2E-FLAKE-1: OPEN, LOW. One `yarn test:e2e` run on 2026-10-03 failed
  1 of 41 tests, and the failing test name was not captured. Six
  subsequent runs on the same tree passed 41/41.
- Local, untracked RW4 spike artifacts under
  `spikes/rw4-mendoza-tourism-route-cloudflare-*/` (raw run dumps, roughly
  7 MB) are excluded through `.git/info/exclude`, matching the existing entries
  for the earlier spikes. They are forensic material from prior canonical COLD
  runs, are not part of this branch, and were deliberately not deleted.
