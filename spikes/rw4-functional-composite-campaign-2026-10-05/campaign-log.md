# RW4 functional composite campaign — run log

Every attempted run, favorable or not. Source qualification rule (task brief):
a real **editorial** source that explicitly defines the multi-stop experience;
no booking marketplace, no sandbox source.

## C1 — Buenos Aires, San Telmo walk (COLD)

- Run: `c1-cold/`, DB `zigzag_spike_rw4_composite_c1` (fresh), HEAD
  `672bf231`, canonical provenance verified. Providers: serper, Cloudflare
  `@cf/qwen/qwen3.8-27b` extractor, Cloudflare Browser Rendering content,
  geoapify, local Nominatim/Overpass (Argentina), Gemini classification.
- Request: `requests/c1-buenos-aires-san-telmo-walk.json` (history +
  architecture, `intent:walk`, `enjoys_walking` 10000/3000).
- Completed in 367 s. COLD counts `geoEntity 0→21`, `experience 0→19`,
  `experienceComponent 0→23`; 0 duplicate identity rows, 0 duplicate names.
- **One multi-component Experience persisted**:
  `801dcda6-25ae-448a-8b25-deaf8b4b8837` "San Telmo and Monserrat Free
  Walking Tour", 5/5 components resolved and ordered (Cabildo museum
  `osm:node:767690911`, Manzana de las Luces `osm:relation:3228119`, Plaza de
  Mayo `osm:relation:17076039`+wikidata `Q1126357`, Mercado de San Telmo
  `osm:way:158893271`, Plaza Dorrego `osm:way:31364659`).
  - **Source does not qualify**: `guruwalk.com/walks/63551-…`, a free-tour
    booking marketplace listing. Recorded as functional evidence only; it is
    NOT the RW4 milestone source.
- Sources attempted and outcome:
  | Source | Kind | Outcome |
  |---|---|---|
  | buenosairesfreewalks.com/tour-san-telmo | free-tour operator page | extracted "San Telmo & Market Tour"; REJECTED `INCOMPLETE_SOURCE_COMPOSITION` 1/4 (San Ignacio Church, Minimal House `CANDIDATE_UNCONFIRMED`; Santo Domingo `AMBIGUOUS`) — fail-closed, correct |
  | agusyornet.com self-guided San Telmo walk | **editorial** | selected for deep retrieval, never extracted: Cloudflare Browser Rendering `429 Rate limit exceeded` (code 2001) on the second sequential fetch |
  | tangol.com/blog free walking tour of San Telmo | tour-agency blog (editorial article on an operator site) | GENERIC pass: 6 windows, no qualifying candidate; PLANNER_CAPACITY pass: extracted "Free Walking Tour of San Telmo" with only 2 stops (Mercado, Plaza Dorrego) of an article route that names more; 2/2 resolved, then REJECTED `AMBIGUOUS_DEDUPE` against the GuruWalk composite (shared components) — fail-closed |
  | guruwalk.com/walks/63551 | booking marketplace | persisted 5/5 (above), non-qualifying |
  | secretsofbuenosaires.com self-guided day 1 | editorial | in search results, not selected (deep selection limit 2) |
- Findings:
  - **RW4-FUNC-TRANSPORT-1**: Cloudflare Browser Rendering free tier rate
    limits the second sequential deep fetch; an editorial source is lost
    with no retry. Next run uses the other configured content provider
    (Tavily). Not fixed here (out of the authorized scope).
  - The 2-of-N tangol extraction is an extraction-fidelity observation
    (same family as RW4-EXTRACT-SECTIONS-1), not a resolver defect.

## C2 — Mendoza city centre walk (COLD)

- Run: `c2-cold/`, DB `zigzag_spike_rw4_composite_c2` (fresh), HEAD
  `672bf231`, canonical provenance verified. Same providers as C1 except
  content retrieval = **Tavily** (avoids RW4-FUNC-TRANSPORT-1).
- Request: `requests/c2-mendoza-city-centre-walk.json`.
- COLD counts `geoEntity 0→15`, `experience 0→10`,
  `experienceComponent 0→12`; 0 duplicates.
- **One multi-component Experience persisted**:
  `f68fc15b-6440-4aef-8cfa-32f020b6c7f0` "Mendoza City Walking Tour", 3/3
  resolved (Plaza España `osm:way:556096055`, Plaza San Martín
  `osm:way:556096059`, Plaza Independencia `osm:way:556096060`), order null
  (not evidence-ordered).
  - **Source does not qualify**: `walkingtoursmendoza.com.ar` homepage, a
    guided free-walking-tour operator's product listing. The snippet also
    names "Banco Hipotecario", which the extractor did not emit — a mandatory
    stop silently missing at extraction, so composite fidelity is unproven.
- Other composites reaching the resolver (all editorial-ish, all fail-closed):
  | Candidate | Source | Outcome |
  |---|---|---|
  | Historic Mendoza City Tour | grounded snippets (generic pass) | `INCOMPLETE_SOURCE_COMPOSITION` 2/4: Franciscan Ruins `NO_CANDIDATE_ACQUIRED`, Central Market `CANDIDATE_UNCONFIRMED` |
  | Mendoza City Historic Walking Tour | timeout.com (deep content) | `INCOMPLETE_SOURCE_COMPOSITION` 2/3: Casa de San Martín `CANDIDATE_UNCONFIRMED` |
- Not reached: wander-argentina.com Mendoza city walking tour (editorial) —
  in search results, not selected for deep retrieval (limit 2).
- Observation: `intent:walk` queries ("walking tours walks …") rank
  tour-operator/marketplace pages first; editorial itineraries are present
  but lose deep selection.

## C3 — Buenos Aires, self-guided San Telmo walk (COLD + WARM)

- Request: `requests/c3-buenos-aires-san-telmo-self-guided.json` — C1 with the
  free text phrased as a self-guided traveller ("por mi cuenta, sin guía,
  siguiendo un itinerario autoguiado"); names no target place.
- COLD run `c3-cold/`, DB `zigzag_spike_rw4_composite_c3` (fresh), HEAD
  `672bf231`, canonical provenance verified, content = Tavily, 0 HTTP 429.
- COLD counts `geoEntity 0→26`, `geoEntityIdentity 0→56`,
  `experience 0→20`, `experienceComponent 0→28`; 0 duplicate identity rows,
  0 duplicate names.
- Search now ranks editorial self-guided itineraries first (agusyornet,
  secretsofbuenosaires, solsalute, gpsmycity).

### Persisted editorial composites

| | A | B |
|---|---|---|
| Experience | `ca18c700-7434-4f1a-99bd-31690846e290` "Self-Guided Historical Walk in San Telmo" | `177a2ae7-654f-4568-bc26-3138c2b727fb` "Self Guided Walking Tour San Telmo" |
| Source | secretsofbuenosaires.com/day-1-self-guided-walking-tour-in-buenos-aires (editorial blog) | agusyornet.com/2020/03/self-guided-walking-tour-san-telmo.html (editorial blog) |
| Components | 7/7 VERIFIED, `orderedByEvidence=true`, order 1–7 | 3/3 VERIFIED, ordered |
| GeoEntities | Plaza de Mayo `e33ad258` (osm:relation:17076039, wikidata Q1126357, geoapify); Casa Rosada `7dff94fe` (osm:way:185738988); Catedral Metropolitana `d9fdcf89` (osm:way:265344159); Museo del Cabildo `96781b8c` (osm:node:767690911); Mercado de San Telmo `958781bf` (osm:way:158893271); Plaza Dorrego `8f9bf4fe` (osm:way:31364659); Parque Lezama `e4eab251` (osm:way:17441757) | Mercado de San Telmo `958781bf` (same row as A); Casa Mínima `34f100f3` (osm:node:4440588689); Defensa `e0da3551` (ROUTE, 14 osm ways) |
| Geography | all `RESOLVED/INSIDE` | INSIDE ×2, Defensa `INTERSECTS` |
| COLD selection | candidate pool, not planned | planned day 1 position 2 (`FEASIBLE_AND_SELECTED`) |

### Fidelity check against the live source (independent fetch)

- **A — truncated by windowing.** The article states "Start: Plaza de Mayo /
  End: La Boca". After Parque Lezama it continues: "Make a stop at the
  national history museum", bus to Caminito, "Visit La Bombonera". Window 1
  kept excerpts 644–3536 and 4667–7593 of 17027 chars and elided the rest;
  the persisted composite ends at Parque Lezama. Three explicit stops are
  missing. Same family as RW4-EXTRACT-SECTIONS-1.
- **B — selective extractor omission.** The article numbers its stops
  (Stop 5 Farmacia la Estrella, 6 Librería del Ávila, 7 Monumento de
  Mafalda, 8 Casa Mínima, 9 San Telmo Market, 10 Patio de los Ezeiza, plus
  Plaza de Mayo / Defensa). The extracted window **contained** Farmacia,
  Librería, Mafalda and Plaza de Mayo, yet the extractor emitted three hints.
  The WARM backfill pass re-extracted the same source differently (with
  Mafalda) and that version failed closed `INCOMPLETE_SOURCE_COMPOSITION`
  2/3, so the emitted stop set is also non-deterministic.
- Neither omission happened at identity resolution: every hint the extractor
  emitted for A and B resolved. The resolver did not drop anything.

### WARM

- Run `c3-warm/`, same DB, same request, no reset; canonical provenance
  verified.
- Counts unchanged: `geoEntity 26→26`, `geoEntityIdentity 56→56`,
  `experience 20→20`, `experienceComponent 28→28`; 0 duplicates.
- `coverage.analysis` = `SUFFICIENT` (history 5 strong, architecture 3,
  walk 1); `catalog.search` = `CATALOG_POOL_AVAILABLE`. No AREA_ROUTE_WALK or
  GENERIC acquisition. One `PLANNER_CAPACITY` backfill pass ran (20
  eligible vs 21 required); it materialized nothing new.
- Composite A retrieved from `db`, `SELECTED`, planned **day 1 position 1**,
  with its 7 component GeoEntities unchanged (same IDs as COLD). B was
  retrieved into the reservoir.
- Provider requests WARM vs COLD: serper 1/3, tavily 1/3, cloudflare
  workers-ai 3/13, gemini classification 0/20, wikidata 4/45,
  geoapify place-details 0/20, nominatim 4/10.
- No PD1 catalog-query defect surfaced; no catalog fix was needed.

## Verdict

- Mechanics PASS: an editorial source-defined composite with ≥2 verified
  components (7) was persisted COLD and reused WARM through the real HTTP
  pipeline, with no seeding, no identity change and no duplicate rows.
- Fidelity FAIL: both editorial composites are subsets of what the source
  defines (A truncated by windowing, B selectively omitted by the
  extractor). Under the brief's fidelity rule neither is an authentic
  materialization of the source-defined experience.
- **RW4_FUNCTIONAL_MILESTONE_PASSED: NO** — the generic blocker is
  extraction fidelity (RW4-EXTRACT-COMPLETENESS-1, below), not identity.
  Every editorial composite in the campaign that reached the resolver
  either resolved every emitted stop or failed closed on a genuinely
  unconfirmed one.

## New findings

- **RW4-EXTRACT-COMPLETENESS-1**: the discovery extractor emits a subset of
  a source's explicitly enumerated stops (agusyornet: 3 of ≥8 visible in the
  window), non-deterministically. Nothing downstream can detect it because
  the resolver only sees what was emitted.
- **RW4-EXTRACT-SECTIONS-1 (reconfirmed on a destination-bounded source)**:
  windowing elides the continuation of a single-day itinerary
  (secretsofbuenosaires) and the scan stops once a candidate qualifies.
- **RW4-FUNC-TRANSPORT-1**: Cloudflare Browser Rendering free tier returns
  429 on the second sequential deep fetch (C1).
- Source-class observation: `intent:walk` queries favour free-tour
  operator/marketplace pages (guruwalk, walkingtoursmendoza,
  buenosairesfreewalks), which deep selection treats as editorial-eligible.
  Two of three persisted composites in C1/C2 came from such pages. Whether
  they are admissible sources is a product decision; this campaign excluded
  them.

## C3 re-run after RW4-EXTRACT-COMPLETENESS-1 fix (COLD) — 2026-10-05

- Run: `c3fix-gemini-cold/`, DB `zigzag_spike_rw4_c3fix_gemini` (fresh),
  HEAD `635ea6f0` (fix `ebfe0ed9`), canonical provenance verified.
  Extractor: **Gemini `gemini-3.5-flash-lite`** (owner decision: Cloudflare
  daily allocation exhausted, Groq output capped at 1000 tokens/minute,
  stronger Gemini models answered 503). Content: Tavily.
- An earlier launch of the same label aborted at the harness provider
  preflight (Gemini not yet admitted), before any DB or provider call.
- COLD counts `geoEntity 0→31`, `experience 0→18`,
  `experienceComponent 0→18`; 0 duplicates; **0 multi-component rows**.
- Windowing fix confirmed live: both sources reached the extractor as one
  complete unit (`SECTION_UNIT`, `sectionComplete=true`, 14926 and 13309
  characters). No truncated composite was persisted.
- secretsofbuenosaires: one candidate with 12 ordered stops (Plaza de Mayo …
  Parque Lezama). Museo Histórico Nacional was omitted by the model, and the
  La Boca part was not emitted. It was REJECTED `INCOMPLETE_SOURCE_COMPOSITION`
  10/12: every oracle-mandatory stop resolved INSIDE, but the passing streets
  the model also emitted failed identity ("Estados Unidos" AMBIGUOUS,
  "Paseo de Colon" NO_CANDIDATE).
- agusyornet: one candidate with stops 5–10 in order (it omitted Teatro
  Colón, Obelisco and Plaza de Mayo). REJECTED 4/6: Monumento de Mafalda and
  El Patio de los Ezeiza `CANDIDATE_REJECTED` (identity; out of scope).
- WARM not run: no composite persisted (brief: WARM only if it persists).

## Extractor reliability determination — 2026-10-06

- No C3 run. Cloudflare `qwen3.8-27b` replay: 0 valid / 6 INVALID_RUN
  (daily allocation already exhausted, HTTP 429 code 4006).
- Same-input Gemini replays, a deterministic-guard probe and an
  atom-labelling probe show that model selection cannot close the defect.
  Recommended mechanism (owner decision pending):
  `../rw4-extract-completeness-2026-10-05/determination-2026-10-06.md`.
- C3 COLD prerequisites (extractor reliability, or generic completeness
  protection) are not met; WARM is not applicable.

## Exhaustive atom-labelling spike — 2026-10-06

- No C3 run. The architecture is amended (PROPOSED). Bounded spike:
  `../rw4-atom-labelling-2026-10-06/README.md`.
- Gemini flash-lite, batched + relabel, 10 runs, every atom labelled
  exactly once:
  - 7/10 units assembled, 6/10 oracle-exact;
  - 0 segment mixing; AG S2/S3 always assembled; the SOB museum is always
    an explicit `ITINERARY_STOP`.
- Recommendation: PROCEED_TO_PRODUCTIZATION, pending owner authorization.
  Walked streets and areas are promoted to mandatory and remain a C3 risk.

## C3 COLD after milestone B (atomized extraction) — 2026-10-06

- Run: `c3-atomized-cold/`, DB `zigzag_spike_rw4_c3_atomized` (fresh),
  HEAD `9a9eca47`, canonical provenance verified. Same providers as
  C3fix: serper search, Gemini `gemini-3.5-flash-lite` extractor, Tavily
  content, geoapify, local Nominatim/Overpass. Same request file.
- Completed in ~171 s. COLD counts `geoEntity 0→18`,
  `geoEntityIdentity 0→33`, `experience 0→13`, `experienceComponent 0→13`;
  0 duplicates. **0 multi-component Experiences persisted.** WARM not run
  (rule: WARM only if COLD persists a qualifying composite).
- Analysis: `analyze-atomized.cjs` → `c3-atomized-cold/atomized-analysis.json`.

### C3 precondition: NOT MET (oracle sources never examined)

- Search returned both oracle sources (agusyornet ev-4 and
  secretsofbuenosaires ev-7 in the AREA_ROUTE_WALK pass), but:
  - AREA_ROUTE_WALK selected buenosairesfreewalks + agusyornet. Round-robin
    examined buenosairesfreewalks window 1 first (`WHOLE_DOCUMENT`,
    generative path), whose candidate closed the requirement, so the scan
    stopped before agusyornet's window 1 was ever examined.
  - secretsofbuenosaires lost deep selection (limit 2) in every pass.
- So this run did **not** exercise B on the frozen oracle units and gives
  no RW4-EXTRACT-COMPLETENESS-1 verdict. This is a source
  selection/scan-order outcome, not a B failure.
- Generative attempt on buenosairesfreewalks (`WHOLE_DOCUMENT`,
  complete): "San Telmo & Market Tour", REJECTED
  `INCOMPLETE_SOURCE_COMPOSITION` 1/3 (as in C1). `WHOLE_DOCUMENT` is
  outside B's scope (RW4-ATOM-SCOPE-1).

### B live behaviour (two tangol `SECTION_UNIT` units, no oracle)

| Pass | Unit | Outcome | Calls (elapsed) | Mandatory before identity | Downstream |
|---|---|---|---|---|---|
| generic | ev-2:w1 (25 atoms, 0 non-editorial) | ASSEMBLED after relabel of `a-009` (`SPAN_NOT_IN_ATOM`) | batch 4.3 s, batch 3.7 s, relabel 1.6 s, member_kind 2.0 s | Manzana de las Luces Historical and Cultural Complex, San Telmo Square, Plaza Dorrego, El Balcón de la Plaza in San Telmo, San Telmo and Mataderos Market Tour [ROUTE], Mataderos neighborhood [AREA], San Telmo antique market, The San Telmo Market | REJECTED `INCOMPLETE_SOURCE_COMPOSITION` 2/8 (Plaza Dorrego, Mercado resolved INSIDE) |
| planner_capacity | ev-7:w1 (9 atoms) | ASSEMBLED, first pass | batch 2.9 s, member_kind 1.8 s | Bar El Federal, Bar La Poesía, Casa Mínima | REJECTED `INCOMPLETE_SOURCE_COMPOSITION` 2/3 (Bar La Poesía AMBIGUOUS) |

- Operational: 0 INVALID_RUN, 0 CONTRACT_FAIL_CLOSED; every call 1.6–4.3 s,
  far below the 25 s Gemini timeout.
- One composition authority held: no generative attempt examined either
  complete unit.
- Visible semantic disagreements, on named atoms (no oracle exists for
  tangol): a tour product ("San Telmo and Mataderos Market Tour", `a-016`)
  and an out-of-walk area ("Mataderos neighborhood", `a-016`) labelled
  `ITINERARY_STOP`; "San Telmo Square" and "Plaza Dorrego" emitted as two
  members (string equality is not identity). Alternatives (food/coffee)
  stayed choice groups; streets stayed `ROUTE_LEG`.
- Downstream gates unchanged; both rejections are identity/composition
  outcomes (`FIDELITY_*_IDENTITY_BLOCKED` class), never an extraction
  workaround.

### Verdict

- RW4_FUNCTIONAL_MILESTONE_PASSED: **NO** (no qualifying composite).
- RW4-EXTRACT-COMPLETENESS-1: **not evaluated** by this run (oracle units
  not reached). B is operationally sound live.

## C3 COLD retry after the bounded-plan scan fix — 2026-10-07

- Run: `c3-retry-cold/`, DB `zigzag_spike_rw4_c3_retry` (fresh), HEAD
  `d4e0754f`, canonical provenance verified. Same providers and request as
  `c3-atomized-cold`: serper search, Gemini `gemini-3.5-flash-lite`
  extractor, Tavily content, geoapify, local Nominatim/Overpass.
- Completed in ~500 s (was ~171 s; more atomized units ran). COLD counts
  `geoEntity 0→36`, `geoEntityIdentity 0→68`, `experience 0→19`,
  `experienceComponent 0→20`; 0 duplicate identity rows or names.
- Provider requests: serper 3, Tavily 3 (one fetch per pass, no extra
  fetch), Gemini 67, wikidata 85, geoapify 127 (59 routing).
- Analysis: `analyze-atomized.cjs` → `c3-retry-cold/atomized-analysis.json`.

### Selected / examined / atomized (from `scan.plan`)

Search returned both oracle sources this time, so the earlier
selection-limit loss of secretsofbuenosaires (SOB) did not recur. That is
search variance, not a fix.

| Pass | Selected (order) | Examined | Per source: windows examined, local stop | Atomized windows |
|---|---|---|---|---|
| AREA_ROUTE_WALK | agusyornet (AG), SOB | AG, SOB | AG 1/5 `SOURCE_REQUIREMENT_SATISFIED` (w1); SOB 3/3 `SOURCE_REQUIREMENT_SATISFIED` (w3) | AG w1 `SECTION_UNIT` ASSEMBLED (95 atoms, 1 relabel); SOB w1 `SECTION_UNIT` ASSEMBLED (11-atom intro, "San Telmo" only, no qualifying candidate); SOB w2, w3 `DOCUMENT_ORDER_CONTINUATION` → generative (RW4-ATOM-SCOPE-1); w3 satisfied |
| GENERIC | solsalute, argentina4u | both | solsalute 5/5 `SOURCE_WINDOWS_EXHAUSTED`; argentina4u 1/3 satisfied (w1) | solsalute w1 `CONTRACT_FAIL_CLOSED` (181 atoms, 5 issues after relabel); argentina4u w1 ASSEMBLED |
| PLANNER_CAPACITY | AG, SOB | AG, SOB | AG 1/5 satisfied (w1); SOB 1/2 satisfied (w1) | AG w1 ASSEMBLED; SOB w1 `SECTION_UNIT` ASSEMBLED (182 atoms, 63 non-editorial) |

- All three passes: `completion = ALL_SELECTED_SOURCES_EXAMINED`,
  `selectedSources == examinedSources`. In the AREA_ROUTE_WALK pass, AG
  satisfied first and SOB was still examined: that is exactly the
  `c3-atomized-cold` failure mode, now fixed live.
- 0 INVALID_RUN. One `CONTRACT_FAIL_CLOSED` (solsalute).

### Downstream

- AG part 1 (both passes): REJECTED `INCOMPLETE_SOURCE_COMPOSITION` 6/15
  and 7/12.
- AG part 2 ("Caminito", "Don Carlos", "Caminito Street"):
  - AREA_ROUTE_WALK: REJECTED `external_scope_mismatch` (Caminito
    outside San Telmo). Correct.
  - PLANNER_CAPACITY (city scope): ACCEPTED 3/3 and **persisted**
    `3eefb37e-…` with 2 components: Caminito ROUTE (both Caminito hints
    collapse to `osm:way:144844726`) + "Carlos Pellegrini" PLACE.
- SOB (PLANNER_CAPACITY) part 1: REJECTED `INCOMPLETE_SOURCE_COMPOSITION`
  10/18. Part 2 (El Caminito, La Bombonera, La Boca): REJECTED 1/3.
- argentina4u "Tour Description": REJECTED 4/8.

### The persisted composite does not qualify

- "Don Carlos" is a stop in the source's La Boca segment (reached by bus
  to Caminito/La Boca). It was VERIFIED via `LOCAL_OSM_POOL` as
  `osm:node:5332434913` "Carlos Pellegrini" at -34.5872,-58.3935.
  - Tags: `historic=tomb`, `wikidata=Q270446` (the person). It is a tomb
    ~6 km away in Recoleta, not the La Boca venue.
  - The geography check passed only because the pass scope is the whole
    city (`WITHIN_DESTINATION`).
  - **False-positive identity: RW4-ID-FALSE-VERIFY-1.**
- Even with a correct identity it would be a 2-stop part of a 3-part
  walk, not the source-defined Experience.
- WARM not run (rule: WARM only if COLD persists a qualifying composite).

### Verdict

- Scan-order fix (RW4-C3-SELECTION-1 scan half): **confirmed live**.
- RW4_FUNCTIONAL_MILESTONE_PASSED: **NO**.
- RW4-EXTRACT-COMPLETENESS-1: both oracle units were atomized and
  ASSEMBLED in PLANNER_CAPACITY, AG also in AREA_ROUTE_WALK. Not formally
  scored against the oracle here. The stops lost to identity
  (Mafalda/Ezeiza, AMBIGUOUS Plaza de Mayo/Cathedral) are downstream
  blockers, not extraction failures.
- New: **RW4-ID-FALSE-VERIFY-1** (HIGH): a token-overlapping OSM record
  of a different physical kind was VERIFIED. Not fixed here; thresholds
  untouched.
- RW4-ATOM-SCOPE-1 reconfirmed: SOB's walk reached AREA_ROUTE_WALK as a
  continuation window and took the generative path.

## C3 COLD identity retry — 2026-10-07 — INVALID_RUN

- Authorized as `READY_FOR_C3_IDENTITY_RETRY`. Run: `c3-idretry-cold/`, DB
  `zigzag_spike_rw4_c3_idretry` (fresh), HEAD `3e945160`. Same request and
  providers as `c3-retry-cold`: serper, Gemini `gemini-3.5-flash-lite`
  extractor, Tavily, geoapify, local Nominatim/Overpass. No code change.
- **NOT CANONICAL, no generation trace.** The runner's status poll got
  `ECONNRESET` at 21:22:33Z (~347 s). The orchestrator then exited and
  `run.sh` killed the backend while the tour was still `generating`
  (planning had started: 14 geoapify routing calls at 21:22:34–40Z).
  `tour.metadata` has no trace. Evidence: `log-excerpt.txt`.
- Before the reset, the backend served no HTTP from 21:19:50Z to
  21:22:33Z. A Gemini classification call ("Plaza Dorrego") was in flight
  and timed out at 21:22:33Z. Why polls were not served is not determined.
- Provider degradation during acquisition: the Gemini discovery extractor
  timed out twice (retried), then
  `Web acquisition threw during EXTRACTION: Gemini error 503` ("high
  demand"). Serper made 2 calls (prior run 3), Tavily 1 (prior run 3),
  Gemini 26 (prior run 67). The web deep-source path did not run as in
  the prior runs, so this run says nothing about selection, atomization
  or composite identity.
- Partial DB state (`db-after.json`; it is not the trace): 17 GeoEntities,
  16 Experiences, 15 single-place plus one 2-component
  "Caminando por San Telmo" (Plaza Dorrego + Defensa ROUTE). That one was
  resolved at 21:14:34Z, before any web extraction, so it does not come
  from the oracle walk sources. None of the known false identities
  (Carlos Pellegrini, Catedral Constructiva, Plaza República Federal de
  Brasil, Club Atlético Atlanta) was persisted, and neither was Cabildo,
  but the hints that produced them were never extracted in this run. That
  is not evidence that the fix works.
- WARM not run. RW4_FUNCTIONAL_MILESTONE_PASSED: **NO** (not evaluable).
- The objectives of the identity retry (Cabildo `recordEquivalence`,
  Don Carlos, per-component identity recall) remain **unmeasured**.
