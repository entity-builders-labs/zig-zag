# Design

## Context

See `proposal.md` (Why) and the six capability specs for the behavior
contract. Implementation facts that shape the approach:

- `GreedyDailyPlanningSolver` consumes `PlanningExperienceCandidate`
  (`interfaces/daily-planning.interface.ts`): string `experienceId`,
  `durationMinutes`, `SpatialFootprint` (`POINT | AREA | LINE` with simplified
  line geometry), ordered `componentFootprints`, derived start/end
  footprints, `NormalizedOpeningHours` with an explicit `unknown` state. It
  needs only a `TravelEstimateProvider` (`ApproximateTravelEstimateProvider`
  is network-free) and `dailyPlanningPolicyConfig`. A corridor walk with
  stops already fits this contract; the solver needs no change.
- `TourExperience.experienceId` is a Restrict FK to `Experience`, and
  `TourExperienceComponent` snapshots `geoEntityId`, `required`, `geometry`.
  Persisted reusable Experiences keep this model intact; request-specific
  composition already has a home in these snapshot rows.
- Reusable geographic resolution exists: `TargetedRouteResolverService`
  (OSM highways by exact name, topology grouping, destination compatibility;
  depends only on `OsmPlacesService`), Nominatim/Overpass destination and area
  resolution, Places adapters, and the dependency-free `IdentityVerifier`
  policy.
- Search/fetch exist behind provider services (`SerperGroundedSearchService`,
  Tavily search/extract, `CloudflareWebSourceContentProvider`), some coupled
  to `AiCacheService`. SerpApi quota is exhausted and must not be used.
- `PreferenceInterpreterService` produces canonical facets
  (`dimension`/`key`) from free text; `TraitDefinition` holds the canonical
  vocabulary. Existing deficit types (`preference_facet`, `global_capacity`,
  `planner_capacity`) and `constants/acquisition-source-routing.ts`
  (hard-coded Wikivoyage/web routes) belong to the superseded pipeline.
- `ExperienceComponent` cannot express corridor segment bounds; this is a
  real production schema gap, deferred to the cutover change.
- Spike convention: `spikes/<topic>-<date>/` with README verdict, scripts,
  recorded I/O; production code unchanged.

## Goals / Non-Goals

**Goals:**

- Amend the canonical architecture document so the target contract is the
  design truth before any production work.
- Prove the contract end-to-end on one realistic request with real providers,
  including catalog-first reuse, recursive gap discovery, stable L4 identity,
  and the reusable-vs-Tour boundary.
- Produce measurements that decide the production cutover (grounding
  rejection quality, research cost per gap, L4 stability).

**Non-Goals:**

- Prisma schema, migrations, production services, controllers, queue wiring.
- Deleting the old pipeline (happens in the cutover change, early-stage
  deletion rule applies there).
- `AREA_WALK` admission, meal-slot planning, narrative/media generation,
  admin backoffice for assertions.
- Multi-destination generality beyond what Buenos Aires plus one variant
  request exercise.

## Decisions

### D1. Spike-first, contract in canonical docs, specs not synced on spike alone

The canonical document is amended now (status: target contract, spike-gated);
the spike validates it; production schema/cutover is a separate change.
Alternative: implement production directly — rejected because the L2/L3/L4
schema shape and grounding predicates are the uncertain parts, and a schema
committed before evidence would be expensive to reverse. Alternative: spike
without doc amendment — rejected by the canonical-docs rule (code must not
contradict design truth, and the superseded rules would still read as
canonical).

### D2. Spike location and runtime

`spikes/gap-driven-destination-knowledge-<date>/`, TypeScript run with the
backend's toolchain, importing backend modules read-only through this
worktree's paths (not another worktree's). Providers are instantiated
directly, not through the Nest module graph. `AiCacheService` dependencies
get a spike no-op/in-memory cache so the spike neither reads nor pollutes the
dev DB cache. A recording layer wraps every external call (search, fetch,
LLM, OSM/Nominatim/Places); runs can replay recordings, and every run's
trace states live vs replayed calls per provider.

### D3. Stores: typed in-memory ports, JSON snapshots

`GeographyStore` (L1), `AssertionStore` (L2), `ResearchLedger` (L3),
`ExperienceStore` (L4) are typed interfaces with in-memory implementations
serialized to JSON between runs so run B/C read what run A wrote. No Prisma.
Alternative: use the integration test DB for L1 — rejected for the spike
because no persistence behavior of L1 is under test and it adds setup cost;
the cutover change owns schema. Every store write passes an authority token
type (`GeographyResolution`, `Grounding`, `GapOutcomeRecording`,
`ReusableComposition`) so the single-writer rule is enforced by types.
Grounding writes L1 only by passing a `GeographyResolution` result from the
geographic resolvers; it never constructs L1 entities itself.

### D4. Core typed contracts (spike, intended as production templates)

```text
GeoEntityRef      { id, kind: PLACE|AREA|ROUTE, identities[], geometry }
SegmentBound      = { kind: GEO_ENTITY, geoEntityId }
                  | { kind: AREA_CLIP, areaGeoEntityId }
CorridorSubject   { routeGeoEntityId, from: SegmentBound, to: SegmentBound,
                    boundKind: STATED_ANCHORS | AREA_CLIP }
Assertion         { key, claimType, subject, facetKeys[], destinationId,
                    evidence: EvidenceCapture[], status: ACTIVE|RETRACTED }
  claimType       = RELEVANT_FOR (AREA|PLACE) | NOTABLE_WITHIN (PLACE in AREA)
                  | WALKING_CORRIDOR (CorridorSubject)
EvidenceCapture   { locator: {url} | {dataset, recordId, fieldPath},
                    retrievedAt, contentFingerprint,
                    capture: {kind: PROSE_SPAN, start, end, text}
                           | {kind: STRUCTURED_FIELD, values},
                    proposedAuthorityClass? (untrusted hint),
                    provenanceSignals[], supportVerdicts[] }
KnowledgeGap      { key, type, scopeGeoEntityId, facetKey?, threshold,
                    observed }
LedgerEntry       { gapKey, outcome: SATISFIED|INSUFFICIENT_EVIDENCE|
                    BUDGET_EXHAUSTED|FAILED, budgetUsed, snapshotEpoch, at }
ReusableExperience{ key, unitKind, anchors, facetKey?, justification[],
                    contentRevision, content: {stops[], order, duration,
                    footprint, name}, status: ACTIVE|ARCHIVED }
```

Keys are canonical strings built from these fields only (for example
`CORRIDOR_WALK|route=<id>|from=geo:<id>|to=area:<id>`). Corridor direction is
canonicalized by ordering the two bounds deterministically; the walk is
bidirectional and a Tour may traverse it in either direction in its snapshot.

### D5. Readiness policy (explicit, versioned, spike-calibrated)

A single `ReadinessPolicy` object with a version and a rationale per value:

- AREA_RELEVANCE(dest, facet): satisfied when ≥ `minRelevantAreasPerFacet`
  grounded areas exist for the facet.
- NOTABLE_PLACES(area, facet): for each relevant area in the destination,
  satisfied when ≥ `minNotablePlacesPerAreaFacet` grounded places exist.
- WALKING_CORRIDOR(destination, walking-format facet): emitted only when the
  interpreted request carries a walking experience-format facet (today the
  canonical `intent:walk` key in `preference-facet-vocabulary.ts`), never from
  walking transport permission alone (architecture invariant 22 keeps
  experience intent and transport permission separate). Scoped to the
  destination so the gap key has one scope id; satisfied by ≥ 1 grounded
  corridor in any area relevant to the request's thematic facets. The
  research excerpt lists those relevant areas to guide the search.
- SCHEDULE_CAPACITY: evaluated last, only when the above are satisfied; runs a
  PROVISIONAL plan through the real solver and emits the gap when residual
  capacity is `meaningful` (existing planner semantics). Satisfied by a new
  AREA_RELEVANCE round excluding known areas.
- Ledger freshness window for negative outcomes.

Initial values are chosen in the spike, recorded with rationale in the spike
README, and are not production defaults. Alternative: LLM decides whether to
research — rejected by the spec. Alternative: raw candidate counts for
capacity — rejected; planner residual capacity already measures schedulable
sufficiency.

### D6. Facet canonicalization

Request facets come from the existing preference interpretation output. Claim
themes proposed by the agent are mapped to the same canonical facet keys by a
single deterministic mapping over the canonical vocabulary; unmapped themes
are dropped (spec: no free-text facets). Alternative: let the agent emit
canonical keys directly — still allowed as a hint, but the mapping validates
it against the vocabulary.

### D7. Research agent runtime

A `ResearchAgent` port: input = one gap + snapshot excerpt (known entities and
assertions in scope) + budget; tools = `search(query)`, `fetch(locator)`,
`catalogRead(scope)`; output = `ProposedClaim[]` + outcome. Implemented with
the repository's existing LLM provider abstraction (`LangChainService`) in a
tool-loop with structured output; model/provider recorded in the trace.
Search via Serper (and/or Tavily), fetch via the existing web content
providers. The prompt states the epistemic rules and the gap; it contains no
website list. Budget enforcement is in the loop, not the prompt. The loop
filters proposed claims to the claim types the gap permits (spec
`gap-research`, "Permitted claim types per gap"); SCHEDULE_CAPACITY research
receives the already-known areas as exclusions. The agent reports an outcome;
the ledger entry is written only after grounding and readiness re-evaluation
(`GapOutcomeRecording`).
Alternative: reuse grounded-search providers' synthesized answers as claims —
rejected because their prose is model output, not captured evidence.

### D8. Grounding: provenance, support, and claim-type authorization

Grounding evaluates two independent questions per capture and then applies
a claim-type predicate. No predicate consults the agent's proposed
publisher/source classification (`proposedAuthorityClass`), which is stored
only for audit.

**1. Provenance (authenticity) — per capture, recorded as verified signals.**

- `REPRODUCIBLE`: the locator re-fetches/re-reads and the captured span or
  fields are present (fingerprint compared; drift reported).
- `PUBLISHER_ESTABLISHED`: who published the evidence is established from
  machine-checkable properties of the retrieved content or record, for
  example publisher identity declared in the document's structured metadata
  and consistent with its host, a structured record whose dataset identity is
  known, or an identity-provider link (e.g. an official-website property on
  a resolved entity) that matches the host. A government-hosted domain is one
  such signal; it is not a definition of authority and not required.
- `PUBLISHER_INDEPENDENT_OF`: two captures are independent when their
  established publishers differ (falling back to distinct registrable
  domains when no publisher is established).

Provenance alone never authorizes a claim.

**2. Support (sufficiency for this claim) — per capture and claim.**

A constrained support verifier, separate from the research agent, judges
only the pinned capture against the claim (subject, claim type, facet,
corridor bounds): `EXPLICIT`, `IMPLICIT`, or `NONE`. Its verdict and model are
stored on the capture. Structured captures are supported only by the fields
they contain. Fully deterministic keyword checking is rejected by the
repository rule against keyword semantics; trusting the agent's own
assessment is rejected by the spec.

**3. Source capability per claim property.** A source contributes only the
properties it can establish: geographic providers (OSM, Nominatim, Places)
establish identity, geometry and walkability, never tourism relevance; a
structured record establishes only its own fields; prose sources may
support relevance and corridor claims.

**4. Spike sufficiency rule (conservative).**

```text
authorized(claim) =
     identity resolved via geographic resolution
  && geometric consistency (where the claim type requires it)
  && ( exists capture c:  c.provenance ⊇ {REPRODUCIBLE, PUBLISHER_ESTABLISHED}
                          && c.support == EXPLICIT
       || exists captures c1, c2 with independent publishers:
              both REPRODUCIBLE && both support ∈ {EXPLICIT, IMPLICIT}
              && at least one EXPLICIT )
```

No website or domain allowlist and no government-domain special case appear
in the predicate.

**5. Claim-type specifics.**

| Claim type | Additional required properties |
|---|---|
| RELEVANT_FOR (area/place, facet) | subject compatible with destination |
| NOTABLE_WITHIN (place, area, facet) | place geometry within area geometry |
| WALKING_CORRIDOR | support states walking along the named street; base ROUTE RESOLVED by targeted route resolution; bounds STATED_ANCHORS (both anchors resolved, on/at the route within policy tolerance) or AREA_CLIP (area named in the supporting capture, resolved, intersects the route) |

Production predicates (which publisher signals count, whether `IMPLICIT`
support may ever corroborate, per-claim-type thresholds) stay open until the
spike's hand-labelled sample (task 8.4) gives evidence; see Open Questions.

### D9. Reusable composition rules

- PLACE_VISIT per place with an ACTIVE RELEVANT_FOR or NOTABLE_WITHIN
  assertion. Duration from a policy dwell table by facet; opening hours only
  when a provider supplied them, else `unknown`.
- CORRIDOR_WALK per ACTIVE WALKING_CORRIDOR. Segment geometry = base route
  geometry clipped between the bounds (anchors projected onto the line, or
  area clip). Stops = PLACE subjects with ACTIVE relevance assertions within a
  policy buffer of the segment, ordered by projection from the canonical
  start; stops are `required: false` (trimmable). Duration = segment walking
  time at the policy walking speed plus per-stop dwell.
- Composition reruns after each grounding write; upsert by key; content
  revision increments when derived content changes; archive when admission
  fails.

Proximity is used to choose stops among already-relevant places; it never
creates relevance (amended rule, see D11).

### D10. Tour composition in the spike

Project ACTIVE reusable Experiences to `PlanningExperienceCandidate`
(`semanticScore` from facet overlap; no embeddings in the spike), run the
real solver, and emit a Tour-snapshot-shaped JSON (`TourExperience` +
component rows with clipped corridor geometry and trimmed stops). No LLM
selection step in the spike; the selection contract is only checked by the
"unknown identity rejected" test.

### D11. Canonical document amendment content

Add "Destination knowledge catalog and gap-driven research (2026-10)" with:
layers and write authorities; epistemic rules as invariants; readiness gap
types; research/grounding boundary; stable identity rule; reusable vs Tour
composition; status `TARGET CONTRACT — spike-gated`. Mark as
`SUPERSEDED (pending cutover)`: "Component resolution does not create
standalone Experiences" (source-backed authority clause), the
exhaustive source-atom labelling amendment, partial source compositions
admission, SAME source reconciliation, invariant 20's provider-trigger table,
and the hard-coded deficit source routing. Reword "Geographic proximity never
proves composite membership" to "proximity never proves relevance". Keep
gather/reconcile/plan snapshot discipline (research is a new acquisition
execution inside it).

## Risks / Trade-offs

- [Support verifier is still an LLM judgment] → stored per capture for
  audit; provenance and support verified separately; corroboration by
  independent publishers unless one capture has both; spike measures
  false accepts on a hand-labelled sample of grounded and rejected claims.
- [Agent wanders or burns budget on one gap] → hard loop limits, per-gap
  ledger outcome, cost per gap reported.
- [Web pages drift, breaking re-verification] → fingerprint + recorded
  fetch; drift is reported, not silently accepted; production revalidation
  policy deferred.
- [Thresholds become magic numbers] → one versioned policy object with
  rationale per value; spike values explicitly labelled non-production.
- [Corridor clipping/anchor projection errors] → geometry checks with
  tolerance; corridor geometry rendered in the evidence (GeoJSON) for manual
  review.
- [OSM ROUTE resolution AMBIGUOUS for common street names] → the claim is
  rejected (no guessing); measured.
- [Food without meal slots yields odd plans] → recorded as an observation;
  meal slots stay a deferred design topic.
- [Spike drifts into production code] → spike imports backend read-only;
  completion check confirms `git diff` touches no `be/` or `fe/` file.

## Migration Plan

No runtime migration in this change. The cutover change (follow-up) will:
add typed L2/L3/L4 schema and segment bounds on components, wire readiness/
research/grounding into generation, delete the superseded pipeline and its
tests, and discard existing catalog contents. Rollback for this change is
reverting the doc amendment and deleting the spike directory.

## Open Questions

- Exact initial policy values (thresholds, dwell table, buffer, walking
  speed, budgets, freshness window) — chosen and justified during the spike;
  they do not change the tasks.
- Which LLM provider/model runs the agent and the support verifier — chosen by
  availability at run time and recorded; does not change the tasks.
- Whether `AREA_WALK` has stable content — explicitly a follow-up question
  informed by spike observations.
- Production authorization predicates: which `PUBLISHER_ESTABLISHED` signals
  are accepted, whether `IMPLICIT` support may corroborate, and per-claim-type
  corroboration counts — decided in the cutover change from the spike's
  measured false accept/reject rates; the spike rule in D8 does not change
  the tasks.
