# Stage 3 COMPOSITE control — San Telmo historical/cultural walk — Geoapify — Assessment

Human request: **"caminata histórica por San Telmo"** (see `request.json`, copied
verbatim from `spikes/rw1-san-telmo-historical-walk/request.json`, unmodified —
same fixture used by every prior San Telmo spike).

Real, unmodified application path only:
`POST /auth/email/request-code` → `POST /auth/email/verify` →
`POST /tours/generate-tour` → outbox(`TourGenerationRequested`) →
`TourGenerationProcessorService` → `ExperienceGenerationService`. No
lower-level service invoked manually, no candidate/component hand-seeded.

## Git state

- Starting remote HEAD (before the Bitácora fix): `a6cf37265b38c623fd4b9aa4a17d4c19ad1622a0`
  (`test(tours): record Stage 3 COMPOSITE positive-control spike (San Telmo)`).
- Bitácora provider-mislabel fix commit: `03046fd45f4c8acd4c83b17efb9d40a28477cd4b`
  (`fix(tours): report actual Places provider in generation trace`), pushed to
  `fork/feat/preference-first-selection` before this spike started.
- Remote HEAD re-verified unmoved (still `03046fd...`) immediately before COLD
  and again before writing this report — no other agent advanced the branch
  during this session's work.
- No production code changed between the fix commit and this spike; only this
  new `spikes/` directory and env-override file are added (verified below).

## Configured vs. observed runtime Places provider (required proof)

| | Value |
|---|---|
| **Configured** (`PLACES_PROVIDER` in `.env.spike.stage3-santelmo-geoapify-control`) | `geoapify` |
| **Observed at runtime** | `geoapify` |

This is not inferred from the env var. It is proven by the corrected trace,
live, in this run:

1. Backend startup log: `[IntegrationsModule] Places provider: Geoapify; available=true; cache=disabled`.
2. `cold/steps/12-discovery-PASS.json` → `acquisition.sourcePlans[1]`:
   ```json
   { "provider": "google_places", "runtimeProviders": ["geoapify"], "observationCount": 16, "status": "success" }
   ```
   `provider: "google_places"` is the historical Places-*capability* discriminator
   (unchanged by the fix — renaming it was explicitly out of scope for the
   Bitácora fix). `runtimeProviders: ["geoapify"]` is the new, typed field this
   spike's own fix (`be/src/modules/tours/utils/generation-trace-builder.util.ts`)
   added, populated from the real `SourceObservation.provider` values the
   Geoapify adapter produced. **This is the fix working correctly outside of
   unit tests, on a real Geoapify-backed generation.**
3. Every persisted Experience's evidence carries a `geoapify:<opaque-id>`
   prefix (e.g. `geoapify:51a401655e702f4dc05915d4f7ad3f5041c0f00102f901a75e5407000000009203194d7573656f2048697374c3b37269636f204e6163696f6e616c`
   for Museo Histórico Nacional).
4. `entityResolutionAudit` component-resolution attempts explicitly show
   `"provider": "geoapify", "strategy": "PLACES"` (e.g. for "El Zanjón de
   Granados", "Basílica de San Francisco", "Monumento a Pedro de Mendoza").
5. Zero occurrences of a real Google Places call anywhere in the backend log
   or trace for either run (`grep -i google` against `backend-combined.log`
   returns nothing but the historical `google_places` capability label).

## Result

```text
COLD:  completed, tour 1cef2587-b62f-45c9-a91f-d950e57956c1, 419,728 ms
WARM:  completed, tour ed3d70b9-ad27-494a-99c3-e9471d246b89,  32,468 ms
Strategy selected: AREA_ROUTE_WALK (anchor=San Telmo AREA, intent=walk) + GENERIC (theme=history)
COLD verdict: FAIL on the primary composite criterion (same locus as the Google control spike)
WARM verdict: PASS on catalog-reuse mechanics (zero re-acquisition, zero new rows) but does NOT
              faithfully reproduce COLD's exact selection — see "WARM" below.
```

**The primary positive-control expectation — at least one Experience candidate
that satisfies `MULTI_COMPONENT_EXPERIENCE` (2+ real, source-backed components)
gets identity-resolved and persisted — was NOT met**, exactly as with Google.
Both runs produced a final tour of 5 independent, single-component
(`componentCount: 1`) POI Experiences. No composite
(`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`-kind, multi-waypoint) Experience was
ever created in COLD or WARM.

This reproduces the same causal shape already characterized for Google today
(`spikes/stage3-santelmo-composite-control-2026-09-23/assessment.md`) and one
day earlier (`spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/`).
**Switching the Places provider to Geoapify does not close the composite gap.**
The gap is inside component identity resolution, upstream of any Places
provider choice.

## First causal point of divergence

Traced forward from the top, exactly as with Google:

1. **`preference_interpretation`** — PASS. `intent:walk` + `theme:history`,
   `anchoredPlaces: [{rawName: "San Telmo", ...}]`. Correct.
2. **Anchor resolution** — PASS. "San Telmo" → real OSM AREA boundary
   `osm:relation:2223069` (admin_level 9, wikidata `Q1026688`). Identical to
   Google's run (same shared local Nominatim/Overpass infra, provider-independent).
3. **Deficit routing** — 1 → `AREA_ROUTE_WALK` (intent:walk), 1 → `GENERIC`
   (theme:history). Correct.
4. **`AREA_ROUTE_WALK` acquisition** — **diverges here, same locus as Google.**
   Grounded search (SerpAPI, location "San Telmo" rejected and retried
   location-less — same as Google) + extraction (Groq `qwen/qwen3.8-27b`)
   produced **4 real, structurally valid `MULTI_COMPONENT_EXPERIENCE`
   candidates** this time (Google's run only extracted 2 — see comparison
   below), each with 2–5 source-backed `componentHints`. All 4 were rejected
   at entity resolution, every one for `UNRESOLVED_REQUIRED_COMPONENT`:

   | Candidate | Components | Resolved | Rejected |
   |---|---|---|---|
   | San Telmo Self-Guided Historical Walk | Basílica de San Francisco (venue), Defensa Street (route) | 1 (Basílica, via **geoapify PLACES**, VERIFIED) | 1 (Defensa Street, `UNCONFIRMED_MATCH`) |
   | San Telmo & Caminito History Walk | Mafalda Statue, San Telmo Market, Dorrego Square, Lezama Park, Caminito | 2 (Market, Lezama Park, via LOCAL_OSM_POOL) | 3 (Mafalda `NO_OSM_MATCH`, Dorrego `UNCONFIRMED_MATCH`, Caminito `UNCONFIRMED_MATCH`) |
   | La Boca and San Telmo History Walk | San Telmo Market, Dorrego Square, Defensa Street, Caminito Street, Boca Juniors Stadium | 1 (Market) | 4 |
   | San Telmo Colonial Walking Tour | San Telmo Market, Ezeiza Mansion, Lezama Park, San Lorenzo Passage | 2 (Market, Lezama Park) | 2 |

   A required-component contract rejects the whole candidate if even one
   required hint is unresolved — a candidate with 1-of-2 or 3-of-5 components
   resolved still yields **zero** persisted composites. A bounded second
   `AREA_ROUTE_WALK` continuation attempt then returned 0 new candidates
   (genuinely nothing further to try, matching Google's pattern exactly).

5. **`GENERIC` (theme:history) acquisition** — ran independently. Produced 22
   structured candidates (Geoapify Places + Wikivoyage), 11 accepted after
   geographic validation (**vs. Google's 6/26** — Geoapify's GENERIC pass
   surfaced almost twice as many admissible candidates here). All 11 are
   `SINGLE_PLACE`/`venue_centric` — this pass was never expected to produce a
   composite for a `theme` deficit, and it didn't, exactly as designed.
6. **`candidate_pool` / `daily_planning`** — built a valid, deterministic
   1-day itinerary from the 11 persisted Experiences: Museo Histórico Nacional,
   Plaza Dorrego, Mercado San Telmo, Casa Mínima, Monumento Canto al Trabajo
   selected (5/11); 6 left unselected. `tour_completeness`: WARN, "Formato
   pedido sin cubrir: walk" — same expected/documented behavior as Google
   (no corrective regeneration exists on this path since PR 10).

**Conclusion: the causal divergence is entirely inside component identity
resolution for the `AREA_ROUTE_WALK`-sourced composite candidates** — not in
preference interpretation, anchor resolution, deficit routing, or
discovery/extraction (which again genuinely proposed real, multi-component
compositions — more of them than Google did). Switching Places provider to
Geoapify changed *which* components resolve and *how many* GENERIC candidates
get admitted, but it did not change *where* the composite pipeline breaks.

## COLD

- Anchor: resolved (`osm:relation:2223069`, San Telmo AREA polygon) — identical
  to Google (shared local OSM infra).
- Strategy selected: `AREA_ROUTE_WALK` (walk) + `GENERIC` (history).
- `AREA_ROUTE_WALK`: **4** real composite candidates discovered (vs. Google's 2),
  evidence-backed (18+ evidence keys), all structurally satisfying
  `MULTI_COMPONENT_EXPERIENCE` → **0 accepted** (all 4 `UNRESOLVED_REQUIRED_COMPONENT`)
  → bounded retry → 0 new candidates → `no_result`.
- `GENERIC`: 22 structured candidates → **11 accepted** (vs. Google's 6), all
  `SINGLE_PLACE`, `venue_centric`, `GEO_VERIFIED`.
- Persistence: **11 new `Experience` rows, 11 `ExperienceComponent`, 12
  `ExperienceEvidence`, 15 `GeoEntity`, 15 `GeoEntityIdentity`, 13
  `TraitDefinition`/14 `ExperienceTrait`**. Zero composite-kind `Experience`.
- Final tour: 5 experiences selected (Museo Histórico Nacional, Plaza Dorrego,
  Mercado San Telmo, Casa Mínima, Monumento Canto al Trabajo), all
  `componentCount: 1`.
- Notable named-entity outcomes (per the spike's own points of interest):
  - **Mafalda Statue** — `NO_OSM_MATCH` at every strategy including
    `geoapify PLACES` (`providerResultCount: 0`) — never resolved, same
    negative result Google's run implicitly had (Mafalda was one of Google's
    8 never-resolved hints too).
  - **El Zanjón de Granados** — resolved as a **real, verified, persisted
    `Experience`** via the *GENERIC* pass (not `AREA_ROUTE_WALK`): Geoapify
    Places surfaced it, `TRUSTED_OBSERVATION_REUSE` initially `REJECTED` it,
    but `LOCAL_OSM_POOL` then `VERIFIED` it against `osm:node:9953027884`
    (39-candidate local pool, `EXACT_NAME`/`SINGLE` identity multiplicity).
    Separately, the *same* entity name reached via a **Wikivoyage** hint in
    the `AREA_ROUTE_WALK` pass was `unresolved` (`UNCONFIRMED_MATCH`) —
    two different acquisition paths reaching the same real place with
    different resolution outcomes, worth a follow-up note but not a blocker
    (the GENERIC path's success is what actually persisted it).
  - **"San Pedro Telmo Church"** — the real entity is
    **"Parroquia San Pedro González Telmo"**, hinted as "Iglesia de San Pedro
    González de Aportela". `LOCAL_OSM_POOL` found `osm:way:210442913` with a
    genuine `WIKIDATA_IDENTITY_MATCH` (`OWN_QID`, `candidateMatched: true`)
    but still `REJECTED` it (`hintMatched: false` — the hint's own name string
    didn't match closely enough for the current identity contract), and
    Geoapify `PLACES`/Nominatim found nothing (`providerResultCount: 0`).
    Unresolved overall (`UNCONFIRMED_MATCH`). A near-miss: the correct real
    place was found and QID-matched, but current identity-evidence rules
    still rejected it.
- **COLD verdict: FAIL** on the composite criterion; PASS on every other
  mechanical criterion (tour materializes, real evidence, real identity
  resolution for the accepted POIs, no fabrication, valid deterministic daily
  plan, correct Geoapify runtime-provider reporting).

## WARM

Same request, same DB, no reset.

- `db_search`: PASS, 11 Experiences reused directly from catalog.
- `coverage_analysis`: `AREA_ROUTE_WALK=1; GENERIC=0` — the `history` facet was
  already fully covered by the catalog, so the GENERIC/Places acquisition pass
  did **not** run at all this time (0 structured candidates attempted, vs. 22
  in COLD) — same shape as Google's WARM.
- `AREA_ROUTE_WALK`: re-attempted (correctly — no composite Experience exists
  yet to reuse), both grounded-search passes returned 0 candidates this time
  (0 evidence-backed proposals at all). Still `no_result`.
- External providers called in WARM: SerpAPI (1 call) + Groq
  (extraction/interpretation). **Zero** Geoapify Places calls, **zero**
  Wikidata calls beyond anchor resolution. Providers attempted per trace:
  `["wikivoyage", "web"]` only (vs. COLD's `["wikivoyage", "google_places"
  (runtime: geoapify), "web"]`).
- Persistence: **0 new rows in all 7 knowledge tables** (identical counts to
  post-COLD: 11/11/12/14/15/15/13). Strong catalog reuse, matching Google's
  WARM invariant exactly.
- Runtime: 32,468 ms vs. COLD's 419,728 ms (12.9× faster).
- **Selection difference from COLD (unlike Google's WARM, which reproduced
  COLD byte-for-byte):** WARM selected **Museo Histórico Nacional, Plaza
  Dorrego, Monumento Canto al Trabajo, Casa Mínima, El Zanjón de Granados** —
  swapping out **Mercado San Telmo** for **El Zanjón de Granados** relative to
  COLD's selection, and reordering the middle three. Root cause traced to the
  `candidate_pool` step itself: the 11-candidate pool is in a **different
  order** between COLD (built incrementally across interleaved acquisition
  passes) and WARM (built from one direct `db_search` catalog query) — same
  11 names, different sequence. With `daily_planning`'s solver picking a
  fixed-size top-N under day-capacity, several candidates with tied/close
  scores land on different sides of the cutoff depending on pool order. This
  is a **pre-existing Stage 3 candidate-pool-ordering behavior**, not a
  Geoapify-specific defect — it was invisible in the Google control spike
  only because Google's smaller GENERIC pool (6 candidates, all selected) had
  no surplus candidates for order to matter. Not fixed here per the spike's
  own ground rules (no speculative fixes); flagged as a finding for
  follow-up planning, not a blocker.
- **WARM verdict: PASS** on the catalog-reuse mechanics Stage 3 actually
  claims (zero re-acquisition, zero duplication, zero new rows, correct
  Geoapify-vs-catalog routing) — but **not** a byte-for-byte reproduction of
  COLD's selection, unlike Google's WARM. The underlying cause is a Stage-3
  candidate-pool ordering sensitivity that Geoapify's larger candidate pool
  happened to expose.

## Providers used, COLD vs. WARM

| Provider | COLD | WARM |
|---|---|---|
| SerpAPI (grounded search) | 2 queries (both AREA_ROUTE_WALK attempts) | 1 query (AREA_ROUTE_WALK) |
| Groq (extraction + preference interpretation) | multiple calls, 1 rate-limited retry (self-healed) | multiple calls, no rate limiting observed |
| Geoapify Places | 16 real observations in the GENERIC pass + multiple PLACES-strategy component-resolution attempts | **0 calls** (GENERIC pass did not run) |
| Wikidata | several proximity lookups, mix of HTTP 429 and 10s timeouts (best-effort) | 0 |
| Overpass/Nominatim | anchor boundary resolution only | anchor boundary resolution only |
| Tavily | not used (confirmed) | not used (confirmed) |

## Comparison against the Google control spike (`stage3-santelmo-composite-control-2026-09-23`)

**A. Behavior shared regardless of provider:**
- Preference interpretation, anchor resolution, and deficit routing are
  byte-for-byte equivalent (same fixture, same local OSM infra).
- The composite gap's locus is identical: `AREA_ROUTE_WALK` genuinely
  discovers real, source-backed multi-component candidates via
  SerpAPI+Groq, and every one is rejected at component identity resolution
  for `UNRESOLVED_REQUIRED_COMPONENT`. Neither provider closes this gap.
- SerpAPI rejects the bare "San Telmo" location string and retries
  location-less, every single call, in both spikes.
- Wikidata proximity best-effort failures (timeouts/429), Groq rate-limit
  self-healing — present in both.
- `tour_completeness` correctly flags the uncovered `walk` format in both;
  no corrective regeneration on this path in either (PR 10 behavior).
- WARM's catalog-reuse invariant (zero new rows, zero duplication) holds in
  both.

**B. Behavior specific to Google (from the Google spike, not reproduced here):**
- Google's Places daily `SearchTextRequest` quota (20/day) was exhausted
  mid-COLD-run, causing 2 fallback lookup failures late in the run. Geoapify
  hit no quota/rate-limit failures in either run here.
- Google's `AREA_ROUTE_WALK` extraction pass proposed only **2** composite
  candidates; every one of its 8 distinct component hints failed to resolve
  (`"[P2-B] reuse none"` for all 8).
- Google's `GENERIC` pass admitted only 6 of 26 candidates (23% acceptance).

**C. Behavior specific to Geoapify (this spike, not present with Google):**
- Geoapify's own text-search safety guard (`GeoapifyPlacesApiService`)
  explicitly skips a plain-text query without a `locationBias`
  (`"Geoapify Places text search requires a locationBias to search safely;
  skipped query: \"San Telmo\""`), logged once per run — a different
  provider-level constraint than Google's field-mask/quota shape, with no
  observed negative effect since the NEARBY-shaped GENERIC search still ran.
- Geoapify's `AREA_ROUTE_WALK` extraction pass proposed **4** composite
  candidates (double Google's 2), and its `PLACES` strategy successfully
  **resolved and verified** at least one venue-type component
  (Basílica de San Francisco) that a `AREA_ROUTE_WALK` candidate needed —
  something Google's run never achieved for any of its 8 hints. The
  candidate was still rejected overall because its *other* required
  component (a route/street-type hint, "Defensa Street") did not resolve.
- Geoapify's `GENERIC` pass admitted 11 of 22 (50% acceptance) — roughly
  double Google's admission rate and total persisted-Experience count
  (11 vs. 6).
- Route/street-type hints (`Defensa Street`, `Caminito`, `San Lorenzo
  Passage`) failed to resolve under Geoapify exactly as they did under
  Google — this looks like a shared limitation of the current OSM
  way/street-matching path rather than a Places-provider difference (see D).

**D. Differences attributable to current Stage 3 code (not provider-specific):**
- The WARM-vs-COLD candidate-pool-ordering sensitivity described above (WARM
  swapped one selected Experience relative to COLD) is a Stage-3
  candidate-pool-assembly behavior exposed here only because Geoapify's
  larger GENERIC pool created enough tied/close-scoring candidates for pool
  order to change the top-5 cut. It is not something Geoapify caused; it is
  a latent behavior of the current `candidate_pool`/`daily_planning` pairing
  that a smaller Google-shaped pool never exercised.
- Route/street-type component hints (not point venues) appear structurally
  under-served by the current identity-resolution ladder for both providers
  (see C) — a Stage 3 gap, independent of which Places backend answers.

**E. Differences that were purely Bitácora-observability artifacts of the
now-fixed bug, not real runtime differences:**
- Nothing in *this* spike's own artifacts falls in this category (its
  Bitácora is already corrected). The category applies retroactively to
  **prior** artifacts — see the forensic-rerun comparison below.

## Comparison against the forensic rerun (`rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/`)

That rerun's manifest records `"PLACES_PROVIDER": "google"` — but its own
`cold-1/generation-trace.json` tells a different runtime story, and is a
concrete, historical example of the exact Bitácora bug this session fixed:

```json
{"provider": "google_places", "status": "success", "observations": [], "observationCount": 0}
```

Meanwhile that **same** trace's `acquisition.candidates` array contains 16
candidates whose `evidenceKeys` are `geoapify:<id>`-prefixed (e.g. "Solar
French" → `geoapify:511a9cd20b882f4dc059f7e406e8634f41c0f00103f9016a1d829b0100000092030c536f6c6172204672656e6368`).
**The `google_places` source plan really did receive 16 real Geoapify
observations — the pre-fix Bitácora bug (exact-string-equality association
between `sourcePlan.provider` and `SourceObservation.provider`) silently
dropped every one of them from that specific audit surface, reporting
`observationCount: 0` for a source that actually succeeded with real data.**
This is the same class of defect described in this session's PART 1 fix,
confirmed here on a real historical artifact, not only in the new unit tests.

Implication for reading *any* pre-fix artifact (this forensic rerun, and by
extension any spike before today's fix commit `03046fd`): `observationCount`
and `routedProviders`/`structuredProviders` on a `google_places` source plan
are **not reliable evidence of zero Geoapify activity**. The only reliable
signals in those older artifacts are the provider-native ones the user
correctly anticipated: `evidenceKey` prefixes (`geoapify:...`),
`entityResolutionAudit` attempt `provider` fields, and persisted
`GeoEntityIdentity.provider` values — never the old `sourcePlans[].provider`
association or its derived counts.

Distinguishing the categories for that forensic rerun specifically:
- **Real Geoapify runtime activity, correctly attributable**: the 16
  `geoapify:`-evidenced candidates themselves, and any `entityResolutionAudit`
  entry naming `provider: "geoapify"` directly.
- **Bitácora-only artifact (fixed by this session)**: the `google_places`
  source plan's `observationCount: 0` / empty `observations` array, and any
  narrative in that rerun's `assessment.md` that took `routedProviders` /
  `structuredProviders` at face value as evidence about which backend ran.

## Secondary anomalies (not blockers, kept separate from the causal finding)

See `campaign-manifest.json` → `secondaryAnomaliesObserved` for the full list:
SerpAPI location-string rejection (shared with Google), Geoapify's
locationBias text-search guard (Geoapify-specific, non-blocking), Wikidata
best-effort timeouts (shared), one self-healed Groq rate limit (shared), and
the absence of any Geoapify quota/rate-limit failure (unlike Google's
exhausted daily quota).

## Artifacts

- `spikes/stage3-santelmo-composite-geoapify-control-2026-09-23/request.json`
- `spikes/stage3-santelmo-composite-geoapify-control-2026-09-23/campaign-manifest.json`
- `spikes/stage3-santelmo-composite-geoapify-control-2026-09-23/cold/` — `create-response.json`, `terminal-tour.json`, `generation-trace.json`, `run-manifest.json`, `steps/*.json` (trace split per stage)
- `spikes/stage3-santelmo-composite-geoapify-control-2026-09-23/warm/` — same shape
- `spikes/stage3-santelmo-composite-geoapify-control-2026-09-23/backend-combined.log` — full backend process log, both runs, redacted of nothing sensitive (dev-mode devCode flow only)

## Recommendation

Do not fix anything discovered in this session per the spike's own ground
rules (positive control, no speculative fixes, no Stage 4, no identity
relaxation, no touching IdentityEvidenceCollector/IdentityVerifier/Wikidata
NEARBY/requireAllTokens/fuzzy matching/extractor/source grounding/partial
composites/route_like/Tavily). Findings to carry into planning:

1. The already-known Stage 3 "Remaining Stage 3 work" item (full
   bounded-continuation characterization for a catalog-miss hint through the
   rest of the strategy ladder) remains the correct next piece of work to
   close the composite gap — confirmed reproducible under **both** Places
   providers with this exact fixture, so it is not a provider-selection
   problem.
2. Route/street-type component hints appear structurally weaker than
   venue-type hints across both providers — worth a dedicated look distinct
   from the general identity-resolution work.
3. The WARM-vs-COLD candidate-pool-ordering sensitivity (section "WARM"
   above) is new information not visible in the Google control spike; it
   should be characterized before relying on WARM runs to prove
   byte-for-byte selection determinism.
4. Any spike/forensic artifact created before commit `03046fd` (this
   session's Bitácora fix) should not be trusted for `google_places`
   source-plan `observationCount`/`routedProviders`/`structuredProviders` as
   proof of runtime provider identity — re-derive that from evidenceKey
   prefixes or `entityResolutionAudit` `provider` fields instead.
