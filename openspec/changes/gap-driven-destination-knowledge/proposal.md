# Proposal

## Why

Tour generation depended on an acquisition pipeline (semantic web search →
LLM extraction of Experiences from prose → geographic validation) that has
not produced a trustworthy catalog. Its catalog contents are disposable; the
domain and infrastructure (GeoEntity, Experience, Tour, planner, routing,
provenance concepts) are worth keeping.

Spike 1 (`spikes/gap-driven-destination-knowledge-2026-10-10/`) let web
research discover physical candidates and failed (33 claims, 0 grounded).
Revision 2 made the world structured-first; spike 2
(`spikes/structured-world-first-2026-10-10/`) proved structured discovery,
identity stability, candidate-bound research and zero identity failures, but
revealed an architectural mistake: **ordinary candidate admission was
incorrectly coupled to tourism-relevance evidence.** Web research sat on the
critical path of an ordinary tour although trusted structured providers
already supply enough authority to admit a real, named, categorized place.

Revision 3 removes semantic authorization from the ordinary happy path:
structured admission makes a PLACE GeoEntity eligible for single-place
Experience composition;
tourism assertions become optional enrichment downstream of admission,
required only where the product decision itself depends on semantic meaning.

Spike 3 (`spikes/structured-places-baseline-2026-10-11/`) returned **ACCEPT**:
from an empty catalog, OSM POIs + Wikidata facts produced 2,571 admitted
places composed as single-place Experiences (the spike called them
PLACE_VISITs) and a reasonable 3-day Buenos Aires Tour with zero LLM, web
search, page fetch, tourism-relevance assertions or enrichment; the reuse run
reproduced identities, keys, ranking and Tour with zero POI rediscovery.
**Authoritative structured POIs are sufficient to build ordinary single-place
Experiences and a useful Tour without tourism-relevance research.** The
admission/research architecture is closed.

Revision 4 turns the remaining spike 3 findings into the production-cutover
contract. They are planning, modeling and policy defects, not knowledge
defects: readiness blamed missing knowledge for a planner-feasibility
residual; SCHEDULE_CAPACITY re-requested acquisition on a catalog of 2,571
admitted places; the travel estimator walks every leg whenever walking is
allowed; sub-features (329 tombs) competed as independent stops; stadiums are
outside the admission vocabulary because category membership was the admission
authority; category lists are mirrored instead of
shared; and some duplicates survived because only shared Wikidata identity
merged records.

## What Changes

- **Minimum cold-start happy path (primary baseline):** request → catalog
  first → structured destination/POI discovery → canonical identity + dedupe
  → structured admission → ranking → single-place Experience → deterministic
  planner → Tour, with no web research.
- **Structured place admission:** an explicit, versioned policy over
  structured provider evidence (identity, coordinates, category, destination
  containment, provider-backed existence, basic completeness) decides whether
  an ordinary PLACE may be composed. Enrichment failure never revokes it.
- **AREA_RELEVANCE no longer gates POI discovery:** destination-level
  structured POI discovery is allowed directly; areas organize, cluster and
  rank but do not gate.
- **L2 is not a universal admission gate:** a GeoEntity's structured admission
  may be sufficient for a single-place Experience; L2 is required only where
  a component's justification depends on semantic meaning (e.g. a required
  traversal of a walking corridor). Eligibility is stated per component
  structure, never per Experience kind.
- **Readiness** asks whether enough schedulable structured candidates exist;
  READY is possible from structured POIs alone. Core structured gaps are
  separated from enrichment gaps, which never block READY. SCHEDULE_CAPACITY
  first seeks more eligible structured POIs.
- **Acquisition Router invariant:** no research step on the critical path
  when an authorized structured provider is sufficient for the decision.
- **Authority matrix** in the design for every product fact/decision.
- **Enrichment contract:** enrichment is downstream of admission, reusable,
  and its absence, failure or staleness never blocks or revokes ordinary
  single-place Experience eligibility.
- Canonical architecture section revised to revision 3; spike 1 and spike 2
  evidence preserved (dated reinterpretations only).
- **Spike 3** (separate experiment): "3 days in Buenos Aires" from an empty
  catalog through structured POIs → admitted single-place Experiences → ranking →
  planner → Tour, with zero web/LLM research calls on the core path.

Revision 4 (production cutover after spike 3 ACCEPT):

- **Spike 3 ACCEPT recorded** as the canonical baseline with durable
  invariants: structured providers establish ordinary POI eligibility; L2 is
  not required for a single-place Experience; enrichment is downstream and non-revoking;
  research only where a product decision depends on semantic meaning;
  provider, admission, ranking and planner defects are never classified as
  missing semantic knowledge.
- **Readiness names the limiting resource** (NONE, CANDIDATE_SUPPLY,
  PLANNER_FEASIBILITY) from the actual eligible pool and the planner's typed
  rejection reasons; adds the PLANNER_LIMITED verdict with a planner
  feasibility diagnostic. INSUFFICIENT_KNOWLEDGE only for candidate shortage
  after structured strategies are exhausted.
- **SCHEDULE_CAPACITY** is emitted only when candidate supply is the
  limiting resource; never when unused eligible supply could fill the
  residual.
- **Multi-day tour planner (planning amendment 2026-10-11):** spike 3 made
  planning, not acquisition, the unresolved problem. A formal planner
  contract decides jointly selection, day, order, visit times and per-leg
  travel mode under hard constraints (per-date opening windows incl. closed
  days, split windows, exceptions and last admission; day windows; user
  unavailable windows; visit durations; travel time; allowed modes; walking
  limits), maximizing a versioned utility objective. Opening hours are
  KNOWN_OPEN_WINDOW / KNOWN_CLOSED / UNKNOWN with a versioned UNKNOWN policy;
  visit durations are reusable evidence-backed knowledge (structured/catalog
  first, then lazy bounded cited-evidence enrichment off the critical path,
  explicit versioned fallback last; P-D2 resolved);
  travel estimates come per mode from a routing/directions provider behind
  the existing abstraction; when routing is unavailable the affected
  feasibility decision fails explicitly instead of fabricating travel times
  (P-D3 resolved; no degraded estimation in production). Every eligible unscheduled
  candidate carries a typed reason consumed by readiness. The production
  optimizer is selected from a recorded algorithm-comparison spike (greedy
  baseline, OR-Tools Routing, CP-SAT orienteering). No routing provider and
  no optimizer is selected by the amendment.
- **Parent sites and sub-features:** structured relationship/containment
  evidence groups sub-features under an admitted parent site; the planner
  receives the parent.
- **Structured visitability/notability admission (R4-D3):** ordinary
  admission no longer depends on an exhaustive tourism-category allowlist. A
  place is admitted on decisive structured signals (provider visitor or
  historic classification, heritage designation) or a visitable-place class
  plus independent notability (encyclopedic item, provider prominence),
  subject to a small generic exclusion policy whose transport, technical and
  accommodation classes yield to decisive evidence. Stadiums, cemeteries,
  gardens, theatres or a historic pharmacy qualify through evidence, never
  one-by-one exceptions. Structured Wikidata facts are admission evidence,
  not L2 research.
- **Single source of truth** for the structured admission policy; provider
  taxonomies map to canonical signals at adapters; discovery selectors are
  acquisition strategy, broad enough not to hide notable places by base
  category, and never admission truth.
- **Structured identity reconciliation:** strong vs supporting evidence,
  fail-closed merges, auditable merge and possible-duplicate diagnostics.
- **Production cutover tasks** in a fixed order, with acceptance criteria;
  the old acquisition path is retired only after production-equivalent
  validation.
- **Experience Domain V2 alignment (2026-10-11, design C0):** the change
  uses only the existing V2 model — GeoEntity (physical reality),
  Experience (the only schedulable unit), ExperienceComponent (how a
  GeoEntity participates: VISIT / TRAVERSE, order, required), Tour /
  TourExperience (snapshot). No PLACE_VISIT entity or kind, no
  CORRIDOR_WALK kind, no ExperienceKind, no second place catalog. A bounded
  ROUTE traversal is ExperienceComponent content and is normative for
  routing; composite Experiences are one planner candidate with an internal
  timeline. Admission is an evaluation of a GeoEntity; Experiences are
  updated in place with stable identity (no content-revision subsystem).

Out of scope: new research providers (Groq, native grounded LLM search),
narrative generation, LLM enrichment, ranking redesign around semantic
research, new structured POI providers (Geoapify, Overture, Google Places),
frontend, verifier tuning. Production code changes happen only through
`/opsx:apply` of the revision 4 task groups.

## Capabilities

### New Capabilities

- `destination-knowledge-catalog`: layered catalog, write authorities,
  evidence/provenance, catalog-first reads; L2 as enrichment, not a
  universal gate.
- `structured-place-admission`: versioned structured admission policy for
  ordinary PLACE candidates, typed rejections, retained provenance,
  non-revocable by enrichment outcomes.
- `knowledge-enrichment`: optional, reusable semantic/tourism enrichment
  downstream of admission.
- `knowledge-readiness`: deterministic readiness over schedulable structured
  candidates; core vs enrichment gaps; READY / NEEDS_ACQUISITION /
  INSUFFICIENT_KNOWLEDGE.
- `acquisition-routing`: deterministic routing by knowledge type; cheapest
  sufficient authority; no research on the critical path.
- `structured-candidate-discovery`: structured discovery of places, areas and
  routes, resolved to canonical identities, including destination-level POI
  discovery.
- `gap-research`: bounded, write-less semantic evaluation of offered
  canonical candidates for enrichment gaps.
- `research-evidence-memory`: non-canonical retention of research evidence.
- `knowledge-grounding`: authorization of semantic claims about canonical
  candidates.
- `reusable-experience-composition`: Experiences composed from
  ExperienceComponents (VISIT / TRAVERSE participation, bounded ROUTE
  traversal), eligibility from component justifications, stable composition
  identity; no Experience kind.
- `tour-composition`: request-specific composition persisted only in the
  Tour, using un-enriched admitted places where needed.

- `planning-travel-estimation` (revision 4, revised by the planning
  amendment): per-mode provider-backed travel estimation, explicit failure
  when routing is unavailable (no degraded estimation), leg exposure, record/replay; the provider never chooses the
  mode.
- `tour-planning` (planning amendment): multi-day planner responsibility,
  input/output contract, opening-hours and UNKNOWN policy, visit-duration
  input, hard constraints vs objective, joint multi-day optimization, typed
  rejection diagnostics, determinism, evidence-based algorithm selection.

Revision 4 also revises `knowledge-readiness` (limiting resource,
PLANNER_LIMITED, capacity semantics), `structured-place-admission`
(structured visitability/notability signals, generic exclusions, sub-feature
outcome, single admission policy),
`structured-candidate-discovery` (identity reconciliation; discovery that
does not hide notable places by base category),
`acquisition-routing` (failure classification), `reusable-experience-composition`
(parent visits; duration and opening-hours provenance in the planner
projection), `tour-composition` (planner-limited, planner-infeasible and
travel-estimation-unavailable outcomes; planning evidence in the Tour
snapshot), `knowledge-enrichment` (fallback duration provenance) and `destination-knowledge-catalog` (provenance via admission
records).

### Modified Capabilities

None (no OpenSpec capability specs exist yet in this repository).

## Impact

- Canonical docs: revised target-contract section; track progress.
- Spike 1 and spike 2 directories preserved; dated reinterpretation sections
  added to their READMEs.
- New spike 3 directory under `spikes/`, reusing spike 1/2 modules read-only.
- Spikes 1-3: no change to production code, Prisma, APIs or frontend.
- Providers for spike 3: local OSM (Overpass/Nominatim) and public Wikidata;
  no LLM or web search on the core path.
- Revision 4 cutover (only via `/opsx:apply`, after the owner decisions in
  design.md): backend readiness, the planning track (planning contract,
opening hours, visit duration, per-mode travel estimation, typed
diagnostics, planner comparison spike, selected optimizer), admission policy,
  structured discovery/identity/admission, single-place Experience composition,
  persistence (per decision R4-D1), generation wiring, and finally deletion
  of the superseded acquisition path and its catalog contents. Frontend
  unaffected except for presenting new typed outcomes if required.
- Spike 3 README and run evidence preserved unchanged.
