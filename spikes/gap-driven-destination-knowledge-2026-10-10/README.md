# Gap-driven destination knowledge spike (2026-10-10)

Question: can a catalog-first destination knowledge catalog, with bounded
agentic research only for typed readiness gaps and grounding as the sole
authority, produce grounded reusable Experiences (including a bounded Calle
Defensa corridor discovered from a plain "Buenos Aires" request) that the
existing planner can schedule, while later requests reuse the knowledge
without research?

Contract: `openspec/changes/gap-driven-destination-knowledge/` (proposal,
specs, design) and the canonical section "Destination knowledge catalog and
gap-driven research (2026-10)" in
`docs/architecture/activity-discovery-and-tour-generation.md`.

Production code is unchanged (`git diff 16f41e89 -- be fe` is empty). The
spike imports backend modules read-only.

## Post-verdict diagnosis (owner review, 2026-10-10)

Added after the verdict; nothing below this section was changed.

The root cause is not the corroboration threshold, the verifier, aliases or
research memory. This spike repeated the discovery failure that
Preference-First was meant to retire. Its acquisition direction was:

```text
web search -> LLM proposes entities / areas / claims -> resolve identity and geography afterwards
```

The research agent was the primary discovery authority for physical
candidates: it chose which barrios, streets and places to talk about from
web prose, and grounding then tried to resolve those names. That is why
every failure mode documented before this spike (single-source prose,
informal area names, Montserrat/Monserrat, directions instead of routes,
boilerplate pages) reappeared.

The OpenSpec change was revised around "structured world first": structured
providers discover physical candidates and their identity; a deterministic
acquisition router chooses source classes per knowledge type; research only
evaluates tourism meaning for already-canonical candidates. A second,
separate spike tests that direction. This spike's evidence stays as the
record of the web-first experiment.

## Verdict: REVISE_CONTRACT

The architecture's mechanics hold, but the end-to-end claim was **not
demonstrated**. In four live Run A attempts the research agent proposed 33
claims (32 in A, 1 more in B); grounding authorized **none** of them. So no
L2 knowledge, no reusable Experiences, no Defensa corridor and no planned
Tour came out of live research. Hand-labelling shows zero false accepts.
12 true claims were lost to the corroboration/publisher rule, plus support
and identity errors. With the current D8 bar, area-identity vocabulary and
corridor-gap ordering, gap-driven research does not produce knowledge. These
contract points must be revised before a production cutover; see
"Contract revisions required".

What the evidence supports (no contradiction found):

- **Catalog-first and ledger suppression work on live data.** Runs B and C
  did zero research for the gap keys Run A recorded as
  INSUFFICIENT_EVIDENCE (`AREA_RELEVANCE|history`, `AREA_RELEVANCE|food`).
- **Research never authorizes.** The agent holds no store; the agent's
  "official_tourism" labels were ignored; no hard-coded source list exists
  (sources found: turismo.buenosaires.gob.ar, solsalute.com, goaskalocal.com,
  visitbue.com, careergappers.com, lonelyplanet.com, argentina-excepcion.com,
  esplendortango.com).
- **Grounding failures are typed and honest.** Every rejection carries a
  typed reason; provider failures became FAILED (Groq 429), never absence of
  evidence.
- **Identity goes through the backend IdentityVerifier.** The local-OSM
  probe (`runs/PROBE/probe.json`) verifies San Telmo, Plaza Dorrego, Mercado
  de San Telmo, Plaza de Mayo and Parque Lezama (GROUNDED_UNIQUE_EXACT_NAME)
  and Defensa (STRUCTURED_ROUTE, 14 OSM ways).
- **Reusable Experience identity is stable.** Live: M1 created
  `PLACE_VISIT|place=geo:osm:way:31364659`; M3 (policy bump) kept the key at
  revision 2, no duplicate. Fixtures: corridor stop added -> same key, new
  revision; corridor retracted -> archived; repeated composition identical.
- **The existing planner consumes the units unchanged.** Fixture tests run
  the real `GreedyDailyPlanningSolver`: CORRIDOR_WALK as a LINE footprint,
  routed through its ordered stops, optional-stop trimming only in the Tour
  snapshot.
- **L4 did not grow with requests.** 0 -> 0 across A/B/C live; fixtures
  show L4 is bounded by L2 subjects.

## Findings

| ID | Finding | Kind |
|---|---|---|
| F1 | 33 claims, 0 authorized, 0 false accepts. 22 rejections were INSUFFICIENT_CORROBORATION (15) / EVIDENCE_DOES_NOT_SUPPORT_CLAIM (7) on single-publisher evidence; 12 of the 15 corroboration rejections were hand-labelled true. Only 2 of 33 claims ever carried two independent publishers (San Telmo in attempt 1, lost to a provider rate limit; Microcentro in B, see F3). The official tourism site exposes no machine-checkable publisher (no JSON-LD), so even its explicit statements need corroboration, and the agent rarely brings a second independent publisher for the same claim. | contract (D8) |
| F2 | Support verifier precision: 2 false NONE ("one of BA's oldest neighbourhoods" for San Telmo/history; La Boca immigrant history), 1 false non-NONE (capture that does not name San Telmo). The corroboration rule masked the false accept. | contract (D8 verifier) |
| F3 | Area identity vocabulary: tourism areas are not OSM admin barrios ("Palermo Soho", "Microcentro", "City Centre (San Nicolás & Montserrat)") and "Montserrat" vs OSM "Monserrat" fails exact-name identity. The Microcentro claim (2 independent publishers) died here. | contract (L1 area identity) |
| F4 | WALKING_CORRIDOR with zero known relevant areas is unsatisfiable by construction (a corridor only counts inside relevant areas), yet it is emitted and researched. Its key omits the area context, so its INSUFFICIENT_EVIDENCE outcome suppresses it for 30 days even after areas become known. Sources returned turn-by-turn directions (Florida, Suipacha, Corrientes), not bounded tourist walks; Defensa never surfaced. | contract (readiness) |
| F5 | Equivalent research is not prevented across gap types: Run B researched `SCHEDULE_CAPACITY|theme:history`, which asks the same question as the suppressed `AREA_RELEVANCE|theme:history`. | contract (gap identity) |
| F6 | When every gap is a known limitation, readiness returns READY and the orchestrator composes an empty Tour. An explicit "insufficient knowledge" terminal state is needed; an empty Tour must not look like success. | contract (readiness verdict) |
| F7 | The backend `GEOGRAPHIC_CORRESPONDENCE` vocabulary has no "source-named route" basis; the spike maps "endpoint within tolerance of the verified street" to SOURCE_AREA. Corridor endpoints cannot be verified at city scope without it. | production gap |
| F8 | OSM adapter facts the production path must handle: the neighbourhood pool carries centers only (polygon hydration via `lookupBoundaryById` needed); transit stops named after landmarks (reused canonical `structuralKindFromNominatim`, TRANSPORT_STOP); parks need polygon geometry so a corridor anchors at the park edge. | production gap |
| F9 | Research tooling: page previews are dominated by navigation; a find-in-document tool was required for the agent to quote passages (attempt 3 -> 4). | tooling |
| F10 | The Groq tier in the dev env (7k input / 1k output tokens per minute) cannot run the agent (HTTP 413/429). Attempts 2-4 used Gemini (`gemini-3.5-flash-lite`) from the same env file. | infrastructure |

## Run attempts (all preserved)

| Run | Provider | Change before run | Gaps researched | Claims | Authorized | L2 / L4 after | Tour |
|---|---|---|---|---|---|---|---|
| A-attempt1-groq | groq qwen3.8-27b | - | 4 | 11 | 0 (1 FAILED: rate limit) | 0 / 0 | empty |
| A-attempt2-gemini | gemini flash-lite | rate-limit retry, bounded previews | 4 | 11 | 0 | 0 / 0 | empty |
| A-attempt3-gemini | gemini flash-lite | corroboration rule in agent prompt | 4 | 2 | 0 | 0 / 0 | empty |
| A | gemini flash-lite | find-in-document tool, 12 rounds/gap | 4 | 8 | 0 | 0 / 0 | empty |
| B (input: A) | gemini flash-lite | - | 1 (`SCHEDULE_CAPACITY|history`) | 1 | 0 | 0 / 0 | empty |
| C (input: A) | gemini flash-lite | - | 1 (`SCHEDULE_CAPACITY|food`) | 0 | - | 0 / 0 | empty |
| MUTATIONS (input: A) | - | - | 0 | - | - | 1 synthetic / 1 | - |

Grounding and readiness rules were never changed between attempts. Only the
research tooling, the agent prompt and the research budget (8 -> 12 rounds)
changed, and the readiness policy version was bumped. Every attempt's
catalog, report, Tour, provider counts and corridor GeoJSON are in its
`runs/<run>/` directory.

### Provider calls (live; replay 0 everywhere)

| Run | LLM | Serper | Web fetch | Overpass | Nominatim |
|---|---|---|---|---|---|
| A-attempt1-groq | 29 (+3 failed) | 6 | 21 | 12 | 1 |
| A-attempt2-gemini | 32 | 6 | 17 (+2 failed) | 13 | 1 |
| A-attempt3-gemini | 25 | 8 | 8 (+2 failed) | 5 | 1 |
| A | 41 | 9 | 19 | 9 | 1 |
| B | 9 | 3 | 4 (+1 failed) | 2 | 1 |
| C | 7 | 2 | 1 | 1 | 1 |
| MUTATIONS | 0 | 0 | 0 | 4 | 2 |

### Grounding verdicts (33 claims, A attempts + B)

| Reason | Count |
|---|---|
| INSUFFICIENT_CORROBORATION | 15 |
| EVIDENCE_DOES_NOT_SUPPORT_CLAIM | 7 |
| CORRIDOR_BOUNDS_UNRESOLVED | 5 |
| IDENTITY_NOT_FOUND | 4 |
| IDENTITY_AMBIGUOUS | 1 |
| FAILED: VERIFIER_UNAVAILABLE | 1 |
| AUTHORIZED | 0 |

Hand labels (`runs/evidence-summary.json`, labelled from the captured text):
29 verdicts applied the contract as intended, 2 support false rejects,
1 support false accept (blocked by corroboration), 1 identity false reject
(Montserrat/Monserrat). Research cost per gap: 4-12 rounds, 1-3 searches,
1-4 fetches.

## Contract revisions required before cutover

1. **D8 evidence accumulation.** Corroboration must be able to come from
   different research executions and gaps. Equivalent proposed claims that
   fail sufficiency should persist as pending evidence, not be discarded.
   The publisher-establishment basis needs more machine-checkable signals
   than JSON-LD host match (for example an identity-provider
   official-website link).
2. **Support verifier.** It needs a stronger or ensembled verifier, and a
   capture must name its subject (or carry page-level subject context
   explicitly).
3. **Tourism-area identity.** Define how informal tourism areas ("Palermo
   Soho", "Microcentro") map to L1: alias resolution constrained to the
   destination's barrios, or a non-administrative AREA kind with provider
   geometry. Never by inventing geometry.
4. **Readiness gap dependencies.** Emit WALKING_CORRIDOR only once relevant
   areas exist, or include the relevant-area context in its key.
5. **Gap identity by knowledge question.** SCHEDULE_CAPACITY should not
   re-ask a question a suppressed AREA_RELEVANCE key already answered.
6. **Insufficient-knowledge terminal state.** Readiness must distinguish
   READY from "all remaining gaps are known limitations"; the generation must
   say so explicitly instead of returning an empty Tour.
7. **Route correspondence basis** in the identity vocabulary (F7).

## Policy values used (spike calibration, not production defaults)

| Policy | Value | Rationale |
|---|---|---|
| readiness version | readiness-spike-2 | bumped when the research budget changed |
| minRelevantAreasPerFacet | 1 | breadth comes from planner-measured capacity |
| minNotablePlacesPerAreaFacet | 2 | one place is a place, not an area visit |
| negativeOutcomeFreshnessDays | 30 | destination knowledge changes slowly |
| research budget per gap | 12 rounds, 4 searches, 6 fetches | raised from 8 rounds for find steps |
| max researched gaps / generation | 10 | bounds the recursive chain |
| placeVisitDwellMinutes | 60 | explicit product assumption |
| corridorStopDwellMinutes | 15 | short pause on a walk |
| corridorStopBufferMeters | 150 | about one block |
| anchorOnRouteToleranceMeters | 120 | a plaza/park touches the street |
| walkingSpeedKmh | 4.5 (planner policy) | single definition |

## Observations

- **Food / meal slots:** not observable; no food knowledge was grounded.
  The deferred meal-slot topic stays open.
- **AREA_WALK stability:** not observable; no area produced grounded stops.
- **Defensa:** the corridor was never proposed by live research. The
  grounding/composition path for a stated-anchor and an area-clip Defensa
  corridor is proven only on fixtures plus the live identity probe.

## Files

- `src/`: contracts, keys, authority-typed stores, recorder, readiness,
  research agent and tools, grounding (provenance, support verifier,
  identity, sufficiency, gap outcome), reusable and Tour composition, planner
  adapter, orchestrator, run wiring.
- `test/`: 92 unit tests (fixtures labelled synthetic).
- `runs/<run>/`: `run.log`, `report.json`, `tour.json`, `catalog-before.json`,
  `catalog-after.json`, `provider-calls.json`, `corridors.geojson`;
  `runs/PROBE/probe.json`; `runs/MUTATIONS/mutations.json`;
  `runs/evidence-summary.json`; `runs/recordings/` (recorded provider I/O,
  including third-party page text; no secrets).

## Run

From the worktree root:

~~~bash
node_modules/.bin/jest -c spikes/gap-driven-destination-knowledge-2026-10-10/jest.config.js
node_modules/.bin/tsc -p spikes/gap-driven-destination-knowledge-2026-10-10/tsconfig.json
# local OSM only (docker osm-local profile)
TS_NODE_PROJECT=spikes/gap-driven-destination-knowledge-2026-10-10/tsconfig.json \
  node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
  spikes/gap-driven-destination-knowledge-2026-10-10/src/run.ts --run PROBE --mode record
# live runs: A first, then B, C, MUTATIONS (they read runs/A/catalog-after.json)
TS_NODE_PROJECT=spikes/gap-driven-destination-knowledge-2026-10-10/tsconfig.json \
  node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
  spikes/gap-driven-destination-knowledge-2026-10-10/src/run.ts --run A --mode record \
  --ai-provider gemini --env-file <env file with SERPER_API_KEY and GEMINI_API_KEY>
~~~
