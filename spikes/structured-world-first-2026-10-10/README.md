# Structured-world-first spike (spike 2, 2026-10-10/11)

Question: if structured providers discover the physical world first,
canonical identity exists before any semantic research, and the research
agent only evaluates offered canonical candidates, does gap-driven research
produce grounded reusable destination knowledge from a cold "Buenos Aires"
request?

Contract: `openspec/changes/gap-driven-destination-knowledge/` (revision 2)
and the canonical section "Destination knowledge catalog and gap-driven
research (2026-10)", revision 2, in
`docs/architecture/activity-discovery-and-tour-generation.md`. Spike 1
(`spikes/gap-driven-destination-knowledge-2026-10-10/`) is preserved
unchanged (hash manifest of its 338 files identical before and after).
Production code is unchanged (`git diff 16f41e89 -- be fe` is empty).

Owner decisions applied: P1 structured facts count only through the versioned
mapping `source-capability-spike2-1` and never alone; P2 local OSM
(Overpass/Nominatim) + public Wikidata only; P3 the spike 1 Gemini
configuration (`gemini-3.5-flash-lite`, free tier), unchanged.

## Post-verdict reinterpretation (owner review, 2026-10-11)

Added after the verdict; nothing below this section was changed.

Spike 2 proved structured discovery (130 canonical areas before any web
call), identity stability, candidate-bound research and zero identity
failures. It also revealed an architectural mistake that this README's
verdict describes too vaguely as "semantic sufficiency": **ordinary candidate
admission was incorrectly coupled to tourism-relevance evidence.** Revision 2
made AREA_RELEVANCE a prerequisite for place discovery and an L2 assertion a
prerequisite for every PLACE_VISIT, so web research sat on the critical path
of an ordinary tour even though structured providers already supply enough
authority to admit a real, named, categorized place.

The change was revised (revision 3): structured admission makes an ordinary
PLACE eligible for PLACE_VISIT composition; tourism assertions become
optional enrichment downstream of admission, required only for products that
depend on semantic meaning (e.g. tourism walking corridors). Spike 3 tests
the structured-only happy path. This spike's evidence stays as the record of
the coupled design.

## Verdict: REVISE_CONTRACT

**The direction change is confirmed; the semantic-authorization contract
still blocks knowledge.**

Confirmed on live data:

- Structured discovery ran first and alone: the cold A2 generation acquired
  **130 canonical area candidates** (48 administrative barrios + 82 OSM named
  places, Wikidata-linked where tagged) with 96 Overpass calls, 1 raw
  Overpass query and 2 Wikidata batches, and **zero LLM/search/fetch calls**
  before the first meaning gap.
- Every one of the 130 evaluation questions offered across A2 attempts, B2
  and C2 referenced a candidate that already existed in L1 with structured
  provenance. Research and grounding wrote **zero L1 entities**.
- After the anchor-validation fix (see attempt 1), **0** research answers
  tried to introduce a non-offered entity; entities the agent saw (Casa
  Rosada, Recoleta Cemetery, El Zanjón de Granados, ...) went only to
  unoffered mentions and created nothing.
- Identity failures that dominated spike 1 disappeared: no
  IDENTITY_NOT_FOUND / AMBIGUOUS on any claim (informal areas such as
  Palermo Soho and Microcentro exist as NAMED_PLACE candidates with extent
  UNKNOWN instead of failing name resolution).
- Catalog reuse works: B2 did no rediscovery and offered none of the
  questions A2 had evaluated.

Not achieved:

- Only **1** area was grounded relevant (Villa 31, history) and **0** POIs;
  no place or route discovery ever ran, so **Defensa never became a
  canonical candidate** and no corridor research happened. The only grounded
  area has extent UNKNOWN, which correctly blocks place/route discovery.
- 27 of 40 grounded claims were rejected INSUFFICIENT_CORROBORATION: the
  official tourism site exposes no machine-checkable publisher, the agent
  rarely brings a second independent publisher for the same candidate within
  a 4-search budget, and the support verifier under-rates explicit
  statements. Same bottleneck as spike 1 F1, now isolated from discovery.
- Evidence memory was **never reused** (0 reuse events) although it held 25
  pending captures: questions that end INSUFFICIENT are suppressed for 30
  days, so their retained evidence is never offered again.

The structured-world-first invariant should stay; the remaining blockers are
in the semantic sufficiency contract, listed under "Contract revisions
required".

## Runs

| Run | Change before run | Iterations | Offered questions | Grounded claims | Authorized | L2 / L4 after | Result |
|---|---|---|---|---|---|---|---|
| A2-attempt1 | - | 3 | 12 | 0 | 0 | 0 / 0 | INSUFFICIENT_KNOWLEDGE |
| A2-attempt2 | evaluator ignores anchor fields on non-street questions; scheduling per evaluation question | 13 | 72 | 13 | 1 (Villa 31) | 1 / 0 | INSUFFICIENT_KNOWLEDGE |
| A2 (attempt 3) | offer size 6/8/4 -> 2/3/2, gap budget 14 -> 20 (policy readiness-spike2-2) | 13 | 24 | 14 | 0 | 0 / 0 | INSUFFICIENT_KNOWLEDGE |
| B2 (input: A2) | - | 10 | 20 | 13 | 0 | 0 / 0 | INSUFFICIENT_KNOWLEDGE |
| C2 (input: A2) | - | 1 | 2 | 0 | - | 0 / 0 | blocked: Gemini free-tier quota (`RESOURCE_EXHAUSTED`) |
| MUTATIONS2 (input: A2) | - | - | - | - | - | - | not exercisable: no grounded corridor or reusable Experience |

Grounding, readiness rules and the routing policy were never changed between
attempts. Attempt 1 exposed two spike defects (an evaluator validation bug
that discarded valid answers as NOT_OFFERED_CANDIDATE because the answer
template invited from/to/area on every question, and per-gap-key scheduling
that blocked the next candidate batch); attempt 2 exposed an offer-size
calibration error (72 questions offered, 11 answered; unanswered questions
were recorded INSUFFICIENT_EVIDENCE without evaluation, San Telmo included).
Every attempt is preserved under `runs/`.

### Provider calls by stage (live; replay 0)

| Run | Discovery (AREA_CANDIDATES) | Meaning (AREA_RELEVANCE) |
|---|---|---|
| A2-attempt1 | overpass 96, overpass-raw 1, wikidata 2 | llm 24, serper 6, web 7 |
| A2-attempt2 | overpass 96, overpass-raw 1, wikidata 2 | llm 124, serper 32, web 55 |
| A2 | overpass 96, overpass-raw 1, wikidata 2 | llm 136, serper 28, web 60 |
| B2 | (reused, none) | llm 108, serper 20, web 44 |
| C2 | (reused, none) | llm 1 (quota) |

Each run also made 1 Nominatim + 1 Overpass call for destination resolution.
LLM counts include support-verifier calls.

### Candidate ids offered to the research agent

The full list (question key, candidate, L1 existence, discovering strategy)
is in `runs/evidence-summary.json` (`runs.<run>.offered`). A2 offered, in
structured-prominence order: La Boca, Puerto Madero, Palermo, Recoleta,
Belgrano, San Telmo, Retiro, Almagro, Balvanera, Monserrat, Caballito, Boedo,
Constitución, La Paternal (all ADMINISTRATIVE, discovered by
`osm-admin-areas`, Wikidata-linked). B2 continued with Constitución,
La Paternal, San Nicolás, Villa Lugano, Flores, Villa Urquiza, Núñez,
Colegiales, San Cristóbal, Barracas, Villa Santa Rita, Agronomía,
Villa Luro, Liniers, Villa Devoto, Chacarita, Villa Crespo, Versalles,
Parque Chacabuco, Parque Patricios.

### Grounding (40 claims: A2 attempts 2-3 + B2)

| Outcome | Count |
|---|---|
| INSUFFICIENT_CORROBORATION | 27 |
| EVIDENCE_DOES_NOT_SUPPORT_CLAIM | 7 |
| EVIDENCE_DOES_NOT_NAME_SUBJECT | 4 |
| FAILED (VERIFIER_UNAVAILABLE, Gemini 503) | 1 |
| AUTHORIZED | 1 (Villa 31, history, single established publisher + explicit support) |

Hand labels (`runs/evidence-summary.json`): 30 verdicts applied the contract
as intended; **0 false accepts**; 5 verifier under-ratings (explicit
statements judged IMPLICIT), one of them **decisive** (San Telmo: "the
oldest in Buenos Aires ... first stable settlement of the colonial city",
established publisher querandi.com.ar, would have authorized alone);
4 verifier over-ratings (two homonym hits on Viceroy Liniers, a quote that
contrasts Nueva Pompeya with the historic south, a flea market judged
historic), all blocked by the corroboration rule. The Villa 31 accept is
evidence-correct (a tourism article on Villa 31 history tours) but shows
that prominence ordering, not tourism relevance, decides which areas get
evaluated first.

## Acceptance (design "Spike 2 acceptance")

| # | Item | Result |
|---|---|---|
| 1 | Discovery routed only to structured classes, before web research | **Met** (A2: iteration 1, structured calls only) |
| 2 | Research receives offered ids; zero L1 from research/grounding | **Met** |
| 3 | At least one Buenos Aires area grounded relevant | **Met, weakly** (Villa 31 only; extent UNKNOWN) |
| 4 | At least one canonical POI grounded | **Not met** (place discovery never reached) |
| 5 | Identity and relevance are separate records | **Met** (Villa 31 in L1 from `osm-named-places` before its assertion) |
| 6 | Defensa canonical before corridor research | **Vacuous** (no corridor research ran; Defensa never discovered; the route path is proven only on fixtures and the spike 1 probe) |
| 7 | B2/C2 reuse A2's catalog, no re-asking | **Met for B2**; C2 blocked by provider quota |
| 8 | Evidence-memory reuse measured | **Measured: 0** (suppression prevents it) |
| 9 | Labels, provider calls, comparison | Met (this README, `runs/evidence-summary.json`) |

## Comparison with spike 1

| | Spike 1 (web first) | Spike 2 (structured first) |
|---|---|---|
| Who chose candidates | research agent from web prose | structured providers (130 canonical areas) |
| Claims grounded | 33 | 40 |
| Identity failures (not found / ambiguous) | 5 | 0 |
| Corroboration failures | 15 | 27 |
| Authorized | 0 | 1 |
| False accepts (hand-labelled) | 0 | 0 |
| Corridor claims | 5 (turn-by-turn directions) | 0 (route stage not reached) |
| Non-offered entity claims | n/a (all entities came from the web) | 0 after fix |

Spike 2 removes the discovery and identity failure class entirely and makes
the remaining failure explicit and measurable: semantic sufficiency.

## Contract revisions required

1. **Unevaluated vs. evaluated questions.** A question the agent did not
   address must not be recorded as INSUFFICIENT_EVIDENCE (spike 2 attempt 2
   suppressed San Telmo without evaluating it). Record evaluation coverage
   explicitly.
2. **Suppression vs. accumulation.** A question pending only for
   corroboration should remain eligible for evidence-memory corroboration
   (or a dedicated corroboration pass) instead of being suppressed with its
   evidence unused.
3. **Publisher signals.** The official tourism site carries no JSON-LD
   publisher; machine-checkable publisher establishment needs another basis
   (e.g. an identity-provider official-website link for the destination's
   tourism authority) without becoming a domain allowlist.
4. **Support verifier calibration.** Explicit statements are judged IMPLICIT
   (decisive once) and homonyms pass the subject-naming precondition
   (Viceroy Liniers vs. Liniers barrio). The precondition should anchor to the
   candidate kind/context, and the verifier needs calibration or an
   ensemble.
5. **Evaluation order vs. tourism relevance.** Structured prominence
   (sitelinks) evaluated La Boca and Belgrano before San Telmo and reached
   Villa 31 before the historic centre; ranking should use structured signals
   closer to tourism relevance (e.g. tourism/heritage POI density inside the
   area) while remaining ranking-only.
6. **Unknown-extent relevant areas.** A grounded NAMED_PLACE without a
   boundary ends the chain; the contract should say whether such an area
   contributes to place discovery through its administrative parent.
7. **Provider capacity.** The free-tier Gemini quota (15 requests/minute,
   daily cap) cannot run a cold generation plus B/C; spike runs need a
   configured paid tier or a provider with adequate limits (P3 kept the model
   unchanged; C2 was recorded as blocked).

## Policy values

| Policy | Value | Rationale |
|---|---|---|
| routing | routing-spike2-1 | structured classes for discovery; facts -> memory -> web for meaning |
| readiness | readiness-spike2-2 | min relevant areas/facet 1, places/area/facet 2, freshness 30 d (spike 1 values) |
| offer per execution | areas 2, places 3, routes 2 | lowered from 6/8/4 after attempt 2 coverage evidence |
| research budget | 12 rounds, 4 searches, 6 fetches | spike 1 final values |
| gaps per generation | 20 | raised from 14 with the smaller offers |
| source capability | source-capability-spike2-1 | Wikidata P1435 / OSM historic|heritage -> history; Wikidata museum class / OSM tourism=museum -> culture; none alone; none for walking |

## Files

- `src/`: contracts, catalog (L1 candidate-facts extension), routing,
  structured adapters (OSM, Wikidata), discovery boundary, offering, readiness,
  evidence memory, evaluator agent, grounding, orchestrator, run wiring;
  `src/spike1.ts` re-exports spike 1 modules read-only.
- `test/`: 52 unit tests (synthetic fixtures).
- `runs/<run>/`: `run.log`, `report.json`, `provider-calls.json`,
  `catalog-after.json`, `candidates-after.json`, `memory-after.json` (and
  `*-before.json` for B2/C2); `runs/MUTATIONS2/mutations.json`;
  `runs/evidence-summary.json`; `runs/recordings/` (recorded provider I/O
  including third-party page text; no secrets).

## Run

~~~bash
node_modules/.bin/jest -c spikes/structured-world-first-2026-10-10/jest.config.js
node_modules/.bin/tsc -p spikes/structured-world-first-2026-10-10/tsconfig.json
TS_NODE_PROJECT=spikes/structured-world-first-2026-10-10/tsconfig.json \
  node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
  spikes/structured-world-first-2026-10-10/src/run.ts --run A2 --mode record \
  --ai-provider gemini --env-file <env with SERPER_API_KEY and GEMINI_API_KEY>
# then B2, C2, MUTATIONS2 (they read runs/A2/*-after.json)
~~~
