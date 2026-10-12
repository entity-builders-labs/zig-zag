# Structured places baseline (spike 3, 2026-10-11)

Hypothesis: a cold destination request can produce an ordinary useful Tour
from authoritative structured POIs without tourism-relevance research.

Contract: `openspec/changes/gap-driven-destination-knowledge/` revision 3 and
the canonical section "Destination knowledge catalog and gap-driven research
(2026-10)", revision 3, in
`docs/architecture/activity-discovery-and-tour-generation.md`. Spikes 1 and
2 are used read-only (hash manifests unchanged). Production code unchanged
(`git diff 16f41e89 -- be fe` empty).

Owner decisions: Q1 admission vocabulary = the backend's existing tourism POI
classes; Q2 providers = local OSM/Overpass + Wikidata facts; Q3 deterministic
structured ranking (category, heritage, importance, spatial diversity,
sitelinks only as tie-breaker).

## Verdict: ACCEPT

The core hypothesis holds on live data. From an empty catalog, structured OSM
POIs + Wikidata facts produced 2,571 admitted PLACE_VISITs and a non-empty,
reasonable 3-day Buenos Aires Tour with **zero LLM, web-search, fetch or
research calls** and **zero L2 assertions**. The reuse run reproduced the same
identities, keys, ranking, planner input and Tour with zero discovery calls.

Two defects remain and must be fixed before production, neither of which
reintroduces research on the critical path (see "Architecture decisions
still required"):

1. **Readiness contract (OTHER_CONTRACT_DEFECT):** a provisional plan with
   residual capacity is always attributed to missing candidates; spike 3 shows
   the residual came from planner feasibility (walking limits), not supply —
   pools of 45, 120 and 400 candidates gave the same 16 stops.
2. **Planner travel estimate (PLANNER):** the network-free
   `ApproximateTravelEstimateProvider` always chooses WALKING when walking is
   allowed, so with walking + public transport every leg is walked and the
   8 km/day and 3 km continuous caps reject most of the city.

## S3-A — cold run ("3 days in Buenos Aires")

- **Verdict:** Tour produced (16 stops over 3 days); readiness ended
  INSUFFICIENT_KNOWLEDGE because of the residual-capacity defect above, with
  the evidence string "structured providers exhausted", which is wrong (see
  diagnostics).
- **Provider calls:** destination resolution 1 Nominatim + 1 Overpass;
  PLACE_CANDIDATES 1 Overpass (destination-scope POI query) + 21 Wikidata
  SPARQL batches (804 linked QIDs); planner 0. **LLM 0, Serper 0, fetch 0.**
  No LLM or search credentials were loaded (`llmLoaded: false`).
- **Counts:** raw 2,712 POIs; canonical 2,699 after 13 strong-identity
  collapses (all `wikidata:Q…`, way/relation kept over node; none by name);
  admitted 2,571; PLACE_VISITs 2,571.
- **Rejections:** DUPLICATE_OF 13; EXCLUDED_CATEGORY 128 (122 non-visitable
  infrastructure `tourism=information`, 6 structural kind ROAD, e.g.
  `highway=corridor` galleries). No NO_NAME / NO_COORDINATES /
  OUTSIDE_DESTINATION / UNKNOWN_CATEGORY (the POI query only returns named,
  admissible-class records inside the boundary).
- **Admitted classes (top):** leisure:park 872, amenity:place_of_worship 405,
  historic:tomb 329, tourism:artwork 313, historic:memorial 240,
  tourism:museum 152, tourism:attraction 111, historic:monument 30,
  tourism:gallery 25, amenity:marketplace 21.
- **L2 not required:** every PLACE_VISIT's justification is its structured
  admission record (`ADMISSION|<place>|admission-spike3-1`), facet keys are
  empty, and the catalog holds 0 assertions (`placeVisitsWithZeroL2: 2571`).
- **Ranking exercised (`ranking-spike3-1`):** category signal (attraction /
  museum 5, gallery / viewpoint 4, monument 4, historic building 3,
  marketplace 3, park / square / place of worship 2, artwork 2), heritage
  signal (Wikidata P1435 = 2, OSM historic/heritage tag = 1), importance
  signal unavailable from OSM POIs, spatial diversity (candidates within
  250 m of a better-ranked one demoted), sitelinks only as tie-breaker. Planner
  pool = 45 (3 days x 5 moderate-pace stops x 3), relevance passed to the
  unchanged planner as a rank-derived `semanticScore`.

### Generated Tour

| Day | # | Time | Place | Class | Category | Heritage | Sitelinks | Walk from previous (min) |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 09:00–10:00 | Teatro Colón | tourism:attraction | 5 | 2 | 36 | – |
| 1 | 2 | 10:06–11:06 | Obelisco | tourism:attraction | 5 | 1 | 25 | 6 |
| 1 | 3 | 11:17–12:17 | Museo Mitre | tourism:museum | 5 | 2 | 6 | 12 |
| 1 | 4 | 12:30–13:30 | Buque Museo Corbeta A.R.A. Uruguay | tourism:museum | 5 | 2 | 11 | 13 |
| 1 | 5 | 14:03–15:03 | Plaza Dorrego | tourism:attraction | 5 | 2 | 7 | 33 |
| 2 | 1 | 09:00–10:00 | Palacio Barolo | tourism:attraction | 5 | 2 | 29 | – |
| 2 | 2 | 10:09–11:09 | Club Español | tourism:attraction | 5 | 2 | 2 | 9 |
| 2 | 3 | 11:18–12:18 | Manzana de las Luces | tourism:museum | 5 | 2 | 6 | 9 |
| 2 | 4 | 12:31–13:31 | El Zanjón de Granados | tourism:museum | 5 | 1 | 0 | 13 |
| 2 | 5 | 13:47–14:47 | El Hipopótamo | tourism:attraction | 5 | 2 | 1 | 17 |
| 2 | 6 | 15:20–16:20 | Buque Museo Fragata A.R.A. "Presidente Sarmiento" | tourism:museum | 5 | 2 | 9 | 33 |
| 3 | 1 | 09:00–10:00 | Edificio Kavanagh | tourism:attraction | 5 | 2 | 17 | – |
| 3 | 2 | 10:23–11:23 | Catedral Metropolitana | tourism:attraction | 5 | 0 | 24 | 23 |
| 3 | 3 | 11:29–12:29 | Museo Casa Rosada | tourism:museum | 5 | 2 | 2 | 6 |
| 3 | 4 | 12:35–13:35 | Basílica de San Francisco | tourism:attraction | 5 | 2 | 7 | 5 |
| 3 | 5 | 14:08–15:08 | Confitería El Molino | tourism:attraction | 5 | 2 | 7 | 33 |

Planner output: 16 selected, 29 unselected (23 MAX_WALKING_PER_DAY +
MAX_CONTINUOUS_WALKING, 4 also DAILY_TIME_CAPACITY, 2 single walking
limits); residual 297 / 220 / 292 minutes on days 1-3. Full planner input
(45 candidates with points and scores) and the ranking inputs of every
selected candidate are in `runs/S3-A/report.json`.

## S3-B — reuse run

Same request on S3-A's catalog and admission ledger: **zero POI discovery
calls** (only destination resolution: 1 Nominatim + 1 Overpass); canonical
places identical (2,571); PLACE_VISIT keys identical; ranking, planner input
and Tour byte-identical to S3-A. Readiness re-emitted SCHEDULE_CAPACITY (same
residual) and stopped because no structured strategy remained.

## Diagnostics (replay only, zero live calls)

`DIAG-POOL-120` and `DIAG-POOL-400`: the same request with planner pools of
120 and 400 produced the same 16 stops and the same residual (67 / 206
candidates rejected for walking limits). The residual is planner feasibility,
not candidate supply or ranking.

## Qualitative review

The Tour is reasonable for a first visit: Teatro Colón, Obelisco, Palacio
Barolo, Manzana de las Luces, El Zanjón, Catedral, Museo Casa Rosada, Plaza
Dorrego, Edificio Kavanagh and two museum ships, in walkable clusters. It is
compact (5-6 stops/day, days end around 15:00-16:20) and confined to
Microcentro / Monserrat / San Telmo / Puerto Madero; Recoleta, Palermo and
La Boca are absent; El Hipopótamo and Club Español are weaker picks.

| Weakness | Evidence | Class |
|---|---|---|
| Days end early; whole city reduced to the centre | 29 pooled candidates rejected for walking limits; pool size irrelevant; approximate travel provider always walks | PLANNER |
| Readiness blames supply ("structured providers exhausted") | 2,571 admitted; residual unchanged with pools of 400 | OTHER_CONTRACT_DEFECT |
| Recoleta Cemetery, Caminito, MALBA, Bellas Artes, Planetario, El Rosedal, El Ateneo in the pool but not the Tour | admitted and pooled, dropped by walking feasibility | PLANNER |
| Casa Rosada and Cabildo carry `tourism=yes` and rank as generic tourism (weight 2) | admission records | STRUCTURED_DATA_QUALITY, RANKING |
| Caminito, Plaza de Mayo, Puente de la Mujer appear twice (no shared Wikidata link) | admission records | STRUCTURED_DATA_QUALITY (spatial diversity kept duplicates out of the pool) |
| 329 individual tombs (Recoleta/Chacarita) admitted as `historic:tomb` | admitted classes | ADMISSION_POLICY (backend vocabulary admits all `historic`), RANKING |
| La Bombonera absent | stadiums are not in the backend tourism POI classes | ADMISSION_POLICY (vocabulary), not provider coverage |
| Mercado de San Telmo not selected | admitted, marketplace weight 3 below museums/attractions | RANKING |

PROVIDER_COVERAGE: not limiting for this request; every landmark checked
except La Bombonera (a vocabulary issue) exists in OSM and was admitted.

## Optional enrichment opportunities (not performed)

- PLACE_RELEVANCE / highlights: El Hipopótamo, Club Español, Confitería El
  Molino would benefit from short narratives explaining why they matter;
  Casa Rosada / Cabildo need better type evidence than `tourism=yes`.
- AREA_RELEVANCE: San Telmo / Monserrat clusters could be presented as
  neighbourhood blocks ("historic centre") for explanation and day grouping.
- WALKING_CORRIDOR_RELEVANCE: Day 1 (Obelisco → Plaza Dorrego) and day 3
  (Catedral → San Francisco) follow Avenida de Mayo / Defensa / Bolívar
  stretches that could become corridor walks with grounded meaning.
- Relationships: tombs could be grouped under Recoleta Cemetery instead of
  competing individually; museum ships could be grouped under Puerto Madero.
- Visitor tips / durations: a uniform 60 min dwell is a policy placeholder;
  recommended visit durations would improve scheduling.

## Architecture decisions still required before production

1. **Readiness capacity semantics:** distinguish candidate-supply shortage
   (route to more structured providers) from planner-feasibility residual
   (a planning outcome, not a knowledge gap); INSUFFICIENT_KNOWLEDGE must not
   be emitted when supply is ample.
2. **Travel estimation in planning:** the approximate provider's mode choice
   (always walking) makes mixed-mode requests infeasible; production must use
   a transit-aware estimate or a distance-based mode choice before structured
   tours can cover a whole city.
3. **Admission vocabulary vs. tour-worthiness:** decide whether sub-features
   such as individual tombs are admitted as PLACE_VISITs or grouped under
   their parent site, and whether venues like stadiums join the vocabulary
   (owner decision; Q1 kept the backend vocabulary unchanged).
4. **Single-source category vocabulary:** export the backend's lodging /
   tourism-class lists instead of the spike's mirrored copy.
5. **Provider strategy:** OSM + Wikidata suffice for Buenos Aires; additional
   structured POI providers (Overture, Geoapify, Google Places) remain a
   provider-agnostic router decision for thinner destinations.

## Files

- `src/`: admission policy and dedupe, place discovery + PLACE_VISIT
  composition, ranking, readiness, routing, generation, run wiring;
  `src/reuse.ts` re-exports spikes 1-2 read-only.
- `test/`: 14 unit tests (synthetic fixture POIs).
- `runs/S3-A`, `runs/S3-B`: `run.log`, `report.json`, `tour.json`,
  `provider-calls.json`, `catalog-after.json`, `candidates-after.json`,
  `admissions-after.json` (and `*-before.json` for S3-B);
  `runs/DIAG-POOL-120`, `runs/DIAG-POOL-400`; `runs/recordings/`.

## Run

~~~bash
node_modules/.bin/jest -c spikes/structured-places-baseline-2026-10-11/jest.config.js
node_modules/.bin/tsc -p spikes/structured-places-baseline-2026-10-11/tsconfig.json
TS_NODE_PROJECT=spikes/structured-places-baseline-2026-10-11/tsconfig.json \
  node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
  spikes/structured-places-baseline-2026-10-11/src/run.ts --run S3-A --mode record
# then --run S3-B; diagnostics: --run DIAG-POOL-120 --mode replay
~~~
