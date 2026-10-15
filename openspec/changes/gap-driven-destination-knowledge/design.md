# Design

Revision 4 (2026-10-11, after spike 3 verdict ACCEPT) is the active design
and is stated first. Its section C0 aligns the whole change with the
Experience Domain V2 model and governs terminology everywhere below; its planning amendment (same date, "Planning track
P1-P13") defines the multi-day planner and replaces the original C4: it keeps the revision 3 core architecture unchanged and
defines the production-cutover contract for the defects spike 3 revealed.
Revision 3 follows; it remains in force except where "Superseded by revision
4" says otherwise. Revision 2 decisions follow as history; those that coupled
ordinary admission to tourism evidence are listed in "Superseded by revision
3". Revision 2 itself superseded revision 1's web-first discovery
("Superseded assumptions (revision 1)").

## Revision 4 — production cutover after spike 3 ACCEPT

### Context (revision 4)

Spike 3 (`spikes/structured-places-baseline-2026-10-11/`, verdict **ACCEPT**)
proved the revision 3 core on live data:

```text
request -> catalog first -> structured POI discovery
        -> canonical identity + dedupe -> structured admission
        -> single-place Experience -> deterministic structured ranking
        -> planner -> Tour
```

S3-A built a reasonable 3-day Buenos Aires Tour from OSM POIs + Wikidata
facts with 0 LLM, 0 web-search, 0 page-fetch calls, 0 tourism-relevance
assertions and 0 enrichment requirements (2,712 raw -> 2,699 canonical ->
2,571 admitted places, each composed as a single-place Experience — spike 3
called them PLACE_VISITs). S3-B reused the catalog with zero POI
rediscovery and byte-identical identities, Experience composition signatures, ranking,
planner input and Tour. The spike 3 README and run evidence are preserved
unchanged.

**Accepted hypothesis:** authoritative structured POIs are sufficient to
build ordinary single-place Experiences and a useful Tour without
tourism-relevance research. The admission/research architecture is closed;
revision 4 does not reopen it.

Spike 3 also exposed production-cutover defects, none of which is a
knowledge defect:

| Finding | Evidence | Class |
|---|---|---|
| Readiness ended INSUFFICIENT_KNOWLEDGE with 2,571 admitted places | residual identical with planner pools of 45, 120 and 400; rejections were MAX_WALKING_PER_DAY / MAX_CONTINUOUS_WALKING | readiness contract |
| S3-B re-emitted SCHEDULE_CAPACITY on a catalog of 2,571 admitted places | S3-B trace | capacity-gap contract |
| Every leg walked when walking + public transport were allowed | `ApproximateTravelEstimateProvider.pickMode` (and the same rule in `GeoapifyTravelEstimateProvider`) returns WALKING whenever allowed | planner travel estimation |
| Recoleta Cemetery, MALBA, Bellas Artes, Caminito, Planetario, El Rosedal pooled but unscheduled | dropped only by walking limits | planner travel estimation |
| 329 individual tombs admitted as independent single-place Experiences | `historic:tomb` admitted by the `historic` class | parent/sub-feature modeling |
| La Bombonera absent | stadiums outside the backend POI vocabulary | admission policy (category membership used as the admission authority) |
| Spike mirrors the backend lodging list and adds its own non-visitable list | `spikes/.../src/admission.ts` vs `NON_EXPERIENCE_TOURISM_VALUES` in `overpass-query.util.ts` (whose query still selects `tourism=information`) | category-policy duplication |
| Caminito, Plaza de Mayo, Puente de la Mujer duplicated | 13 collapses, all by shared Wikidata; the remaining pairs had no shared QID | identity reconciliation |
| Mercado de San Telmo ranked low; Casa Rosada / Cabildo carry weak `tourism=yes`; OSM has no importance signal | ranking inputs in `runs/S3-A/report.json` | ranking / structured data quality (recorded, not a cutover blocker) |

Provider coverage was not limiting: every landmark checked except La
Bombonera (a vocabulary issue) existed in OSM and was admitted.

### C0. Experience Domain V2 alignment (2026-10-11, model-sufficiency audit)

This change uses the existing V2 domain model and adds no schedulable-unit
taxonomy. The V2 invariants hold: `Experience` is the only schedulable
tourism unit; `GeoEntity` describes physical reality (`PLACE | AREA |
ROUTE`); there is no structural Experience kind
(`docs/superpowers/plans/2026-09-01-experience-domain-v2-tour-generation-rearchitecture.md`).

| Concept | Meaning |
|---|---|
| `GeoEntity` | canonical physical reality and provider identities |
| `Experience` | the only reusable schedulable tourism unit |
| `ExperienceComponent` | how one canonical GeoEntity participates in an Experience |
| `Tour` / `TourExperience` | generated planning snapshot; never canonical identity |
| `PlanningExperienceCandidate` | transient planner projection of an Experience; not a domain entity |

No `PLACE_VISIT` entity or kind, no `CORRIDOR_WALK` kind, no
`ExperienceKind`, no AdmittedPlace / StructuredPlace / PlannerPlace, no
visit-unit entity and no second place catalog exist. Earlier revision text
and spike evidence that use those words record what was run; they are
historical terminology, not model concepts. Mapping: "PLACE_VISIT" = a
single-place Experience (one VISIT component of a PLACE GeoEntity);
"CORRIDOR_WALK" = an Experience with a required bounded TRAVERSE of a ROUTE
GeoEntity; "admitted place" = a GeoEntity with an ADMITTED admission
evaluation; "L1" = GeoEntity; "L4" / "reusable Experience" = Experience;
"PLACE_VISIT key" = Experience composition signature.

**Examples.**

```text
Experience "Visit MALBA"
└── ExperienceComponent (VISIT, required)
    └── GeoEntity(MALBA, PLACE)

Experience "San Telmo walk"
├── ExperienceComponent (TRAVERSE, required, order 1)
│   └── GeoEntity(Calle Defensa, ROUTE)
│       + bounds: Defensa/Chile -> Defensa/Humberto Primo
├── ExperienceComponent (VISIT, order 2) -> GeoEntity(Mercado de San Telmo, PLACE)
├── ExperienceComponent (VISIT, order 3) -> GeoEntity(Plaza Dorrego, PLACE)
└── ExperienceComponent (VISIT, order 4) -> GeoEntity(Plaza de Mayo, PLACE)
```

Experience A (Defensa, Chile -> Humberto Primo) and Experience B (Defensa,
Avenida de Mayo -> Chile) reference the same canonical Calle Defensa
GeoEntity; the bounds belong to each component.

**Composition is the semantic axis.** Existing ExperienceComponent fields
already carry membership (`experienceId`), canonical reference
(`geoEntityId`), order (`order`) and required/optional (`required`). The
target participation semantics are at least VISIT and TRAVERSE. The
existing free-string `role` mixes source-hint roles with participation and
duplicates `GeoEntity.kind`; it is not removed here — R4-D1 and an
implementation consumer audit decide the migration path.

Rules are stated against structure, never against a kind:

- *Single-place Experience*: one required VISIT component of a PLACE
  GeoEntity. Eligible when that GeoEntity's admission evaluation is
  ADMITTED (C6) and it is its own visit unit (C5). No L2 needed.
- *Experience with a required TRAVERSE of a ROUTE*: its traversal component
  is justified by a grounded WALKING_CORRIDOR assertion on that route
  segment (L2, enrichment/semantic product; not part of the ordinary
  cutover). If that justification is retracted the Experience is ARCHIVED
  (existing `ExperienceStatus`).
- Footprints, internal order, start/end points and internal timeline derive
  from the ordered components and `GeoEntity.kind`.

**Bounded ROUTE traversal (normative).** A TRAVERSE component of a ROUTE
GeoEntity may carry a bounded-traversal constraint retaining: the canonical
ROUTE GeoEntity; the start and end boundaries (canonical GeoEntities as
anchors when naturally available — e.g. the crossing route — never new
identity models created only for bounds); direction/order where
semantically relevant; provider-backed resolved boundary coordinates;
provider-backed segment geometry or an equivalent reproducible routing
constraint; spatial provenance/source/version; and the existing
required/optional semantics. The segment geometry is built only from ways
the component's mode may traverse in the required direction (C16 G2
finding). The segment is Experience content: it never
creates a GeoEntity unless a provider identifies the segment itself as an
independent entity. Exact tables/columns: R4-D1.

**Responsibilities.**

- *Experience composition* defines what the Experience contains: ordered
  components, required visits, required traversals and internal structural
  constraints.
- *Global planner* schedules each Experience as one candidate (selection,
  day, start, position among Experiences). It never flattens a composite
  into independent candidates and never rewrites its internal composition.
- *Routing* materializes provider-backed paths/times. It is free between
  unconstrained components and between Experiences, never free to bypass a
  required bounded traversal (no shorter parallel street). If the provider
  cannot produce a valid estimate/path respecting the traversal, that is an
  explicit feasibility failure (TRAVEL_ESTIMATE_UNAVAILABLE); traversal time
  is never fabricated from distance/speed (P-D3). **Open:** the
  provider-backed mechanism for path-constrained traversal timing (e.g.
  waypoints along the segment, map matching) is not defined by any existing
  routing contract; it must be decided before a TRAVERSE-bearing Experience
  is planned in production. The ordinary single-place cutover does not
  depend on it.

**Composite internal timeline.** A composite Experience has an internal
timeline: ordered components, internal travel/traversal time, component
visit durations, opening hours of internal PLACE components and required
traversal constraints. It is feasible only if the planned timeline reaches
each time-constrained internal component inside a valid window (the market
of a walk must be reached while open). One opaque candidate opening-hours
value is not sufficient for composites; a single-place Experience collapses
naturally to its one component's availability.

**Ownership of facts.** Physical opening hours are knowledge about the
GeoEntity; an Experience has its own availability only when it genuinely
has its own schedule (e.g. a guided tour). Reusable visit-duration
knowledge (P4) is knowledge about visiting a canonical place. An
Experience's effective duration derives from its components (visit
durations, required traversal time, internal travel). `TourExperience`
stores the duration actually used. The existing opaque
`Experience.durationMinutes` / `Experience.openingHours` fields are not
evidence that ownership is already modeled; R4-D1 decides persistence.

**Admission is a GeoEntity evaluation.** Structured admission (C6), the
parent/child visit-unit classification (C5) and their evidence are
knowledge about a canonical GeoEntity, not separate entities.

**Stable identity, no content revisions.** An Experience keeps its identity
when enrichment, durations or derived content change; it is updated in
place. Idempotent structured composition uses an Experience composition
signature derived from its constitutive components (GeoEntity,
participation, traversal bounds) — never a kind. Tour / TourExperience
snapshots preserve what each traveller received; no Experience content
revision subsystem is introduced. No requirement found in this change
needs reusable Experience history beyond Tour snapshots.

**Sub-feature highlights** are derived from the canonical GeoEntity PART_OF
relationship (C5), not copied into the parent Experience. A child becomes an
ExperienceComponent only when it actually participates in that
Experience's route/composition.

**Source-declared / unresolved component machinery.** ExperienceComponent's
documentation and the fields `sourcePosition`, `sourceName`,
`resolutionState`, `resolutionReason`, `resolutionSource` describe
source-declared members of the superseded source-extraction pipeline.
Current consumers (non-test): `experience-proposal-resolver.service.ts`,
`experience-generation.service.ts`, `experience-catalog.service.ts`,
`catalog-knowledge-administration.service.ts`,
`experience-source-membership.policy.ts`,
`component-resolution-facts.util.ts`,
`source-knowledge-reconciliation.policy.ts`,
`atom-labelling-contract.util.ts`, `atomized-source-unit.interface.ts`,
`experience-resolution.interface.ts`, `preference-spec.interface.ts`,
`experience-dedupe.util.ts`, `must-anchor-placement.util.ts`,
`tour-experience-snapshot.util.ts`,
`shared/ai/services/experience-embedding-indexer.service.ts` and the tours
README. Some (snapshot, embedding indexer, dedupe, must-anchor placement,
admin revocation) are shared paths, not extraction-only. Status: retirement
candidate only; nothing is removed by this change until task 43's consumer
audit decides.

**Persistence of these concepts** (GeoEntity admission evaluation, direct
PART_OF relationship with visit-unit classification, typed opening-hours
and visit-duration knowledge, composition signature, typed participation,
bounded ROUTE traversal, Tour readiness and planning snapshot) is resolved by
R4-D1 in C14.

### C1. Durable invariants carried into production

1. Structured providers establish ordinary POI eligibility.
2. L2 is not required for an ordinary single-place Experience.
3. Enrichment is downstream of admission.
4. Failed or missing enrichment never revokes a GeoEntity's admission or
   archives its single-place Experience.
5. Research runs only when a product decision depends on semantic/tourism
   meaning (authority matrix S2).
6. Provider coverage, admission, ranking and planner defects are never
   classified as missing semantic knowledge (C9).

### C2. Readiness: identify the limiting resource

Readiness evaluates a provisional plan and names the resource that limits
it. It never infers "missing knowledge" from unused schedule time alone.

Definitions (all computed from the snapshot, the provisional plan and the
planner's own typed output; no new numeric threshold):

- **Eligible pool:** eligible Experiences (C0 structural rules) in the
  request scope that are projectable to the planner candidate contract and
  are not children excluded as visit units by C5 (SUB_FEATURE_OF,
  PARENT_NOT_ADMITTED, AMBIGUOUS_PARENT_RELATIONSHIP).
- **Residual capacity:** the planner's existing per-day
  `PlannerResidualCapacity` (`availableMinutes`, `meaningful`). The
  "meaningful" judgement stays the planner's existing policy; readiness does
  not add its own.
- **Unused eligible supply:** eligible candidates not scheduled, split into
  (a) evaluated by the planner and rejected, with the planner's typed
  `PlanningRejectionReason`s, and (b) not offered to the planner (outside the
  ranked planner pool).
- **Supply sufficiency test:** unused eligible supply is sufficient for a
  day's residual when the summed derived durations of unused eligible
  candidates are at least that day's `availableMinutes`. This compares two
  measured quantities in the same unit; it is resource accounting, not a
  tuned constant.

Limiting resource (`limitingResource`):

| Condition after the provisional plan | limitingResource | Readiness verdict |
|---|---|---|
| No meaningful residual on any day | NONE | READY |
| Meaningful residual and unused eligible supply is sufficient | PLANNER_FEASIBILITY | PLANNER_LIMITED |
| Meaningful residual and unused eligible supply is insufficient, structured strategies remain | CANDIDATE_SUPPLY | NEEDS_ACQUISITION (SCHEDULE_CAPACITY) |
| Meaningful residual and unused eligible supply is insufficient, no authorized structured strategy remains | CANDIDATE_SUPPLY | INSUFFICIENT_KNOWLEDGE |
| Eligible pool empty before any structured discovery for the scope | CANDIDATE_SUPPLY | NEEDS_ACQUISITION (PLACE_CANDIDATES) |

- Verdicts become READY, PLANNER_LIMITED, NEEDS_ACQUISITION,
  INSUFFICIENT_KNOWLEDGE (four distinct explicit states, R4-D4 resolved).
  PLANNER_LIMITED proceeds to Tour composition and
  carries a typed **planner feasibility diagnostic**: residual per day, the
  count of unused eligible candidates, their typed planner reasons (P10)
  aggregated by reason (e.g. WALKING_LIMIT, OPENING_HOURS,
  OPENING_HOURS_UNKNOWN_EXCLUDED, DAILY_CAPACITY, TRAVEL_TIME,
  NO_ALLOWED_TRAVEL_MODE), walking diagnostics, the leg modes and the plan's
  travel-estimate quality (P5/P6), the UNKNOWN-hours policy and its
  exclusions (P3), the planner constraint snapshot, and the count not
  offered to the planner, the unused eligible candidates' identities with
  their reasons, and the planner policy versions. Readiness reads these from
  planner output and never re-derives them, so consumers distinguish
  PLANNER_LIMITED from READY without reconstructing planner internals.
- When candidates not offered to the planner alone could cover the residual,
  readiness first re-plans with a widened pool from the existing catalog (a
  planner-pool decision, never acquisition) before classifying. Spike 3
  showed pool size does not change a feasibility-limited plan, so this step
  is diagnostic, bounded by the eligible pool, and records the pools tried.
- INSUFFICIENT_KNOWLEDGE requires `limitingResource = CANDIDATE_SUPPLY` and
  exhausted structured strategies, and lists the provider outcomes. It is
  never emitted for PLANNER_FEASIBILITY.
- When the planner schedules nothing although the eligible pool is
  sufficient, generation returns an explicit PLANNER_INFEASIBLE outcome with
  the diagnostic, never INSUFFICIENT_KNOWLEDGE and never a silent empty Tour.
- Mixed evidence is reported, not hidden: a CANDIDATE_SUPPLY verdict still
  attaches the planner rejections of the unused candidates it saw.

### C3. SCHEDULE_CAPACITY revised

SCHEDULE_CAPACITY no longer means "residual time exists". It is emitted only
when `limitingResource = CANDIDATE_SUPPLY` (C2), i.e. the provisional plan
has exhausted the eligible pool as a resource. It routes to structured
acquisition only (S6); it never routes to research. On a reuse request
(S3-B), the same classification yields PLANNER_FEASIBILITY and no gap, so
neither discovery nor the gap re-emission recurs. The ledger records the
capacity classification (limiting resource, residual, unused supply) with
the gap outcome so a suppressed capacity gap is auditable.

### C4. Travel estimation and planning (superseded by the planning track)

Revision 4 first framed the planner defect as "transit-aware travel
estimation": one planning-side mode-selection rule (walk whenever the leg
fits the walking limits, else the fastest non-walking mode) plus a
network-free approximate public-transport estimate with versioned speed and
wait parameters (former R4-D5). The planning amendment (2026-10-11) replaces
that framing: the unresolved problem is multi-day planning, not leg
estimation alone. Mode choice is an optimizer decision (P9), estimates come
from a routing/directions provider behind the existing abstraction (P5), and
routing unavailability fails explicitly with no fabricated estimate (P6,
P-D3).
The defect evidence is unchanged: `ApproximateTravelEstimateProvider.pickMode`
and `GeoapifyTravelEstimateProvider` both return WALKING whenever allowed, and
that mode-choice logic must leave the providers.

### Planning track (P1-P13, planning amendment 2026-10-11)

Spike 3 proved structured acquisition/admission sufficient; the next
unresolved problem is planning. The admission architecture is not reopened,
and no LLM research, enrichment or new POI provider enters ordinary planning.

Current implementation (inspected): `GreedyDailyPlanningSolver`
(`DAILY_PLANNING_SOLVER`) with `daily-planning-*` utils; the contract in
`interfaces/daily-planning.interface.ts` — `PlanningExperienceCandidate`
(single `durationMinutes` without provenance; `NormalizedOpeningHours` =
`known` weekly ranges | `unknown`, no closed-day/exception/last-admission
distinction, no provenance), `TravelEstimateProvider.estimate(from, to,
allowedModes)` returning one already-chosen-mode `TravelEstimate`,
`PlanningRejectionReason`, `PlannerResidualCapacity`. Spike 3 composition used
a flat 60-minute policy duration (C11). These are the starting point to
evolve, not a parallel contract to add beside.

#### P1. Planner responsibility

```text
structured providers / catalog -> eligible Experiences -> ranking (utility)
                                                              |
OpeningHours (catalog facts) --+                              v
VisitDuration boundary --------+--> planning inputs --> Tour Optimizer
TravelEstimateProvider --------+                              |
User constraints --------------+            multi-day itinerary + diagnostics
                                                              |
                                                    Readiness / Tour
```

The planner decides jointly: selection, day of each selected candidate,
order within the day, planned start/end, and mode of each leg. Ranking
answers "how desirable"; planning answers "which desirable candidates form
the best feasible itinerary". A highly ranked candidate may move day or be
omitted for opening hours, travel time, duration, day windows or walking
limits. Planner outcomes never touch admission, identity, ranking inputs or
catalog content and are never evidence of missing tourism knowledge. The
optimizer owns no discovery, identity, admission, research or narrative.

#### P2. Planning input/output contract

Input per candidate (one candidate per Experience, never per component):
canonical Experience identity, utility (from ranking, consumed as a number
with its ranking policy version), the ordered components with their
participation (VISIT / TRAVERSE), each VISIT component's visit duration +
provenance (P4) and opening-hours knowledge per date + provenance (P3), each
required TRAVERSE constraint (C0), start/end/component footprints, and a
request-declared inclusion constraint where the request has one. A
single-place Experience collapses to its one component's duration and
availability. Input per request: days, calendar date and
destination-local timezone per day, daily start/end, optional per-day
start/end anchor locations (C16; never invented, first/last mile excluded
and recorded when absent), optional user unavailable windows, allowed modes, walking limits (continuous, daily), and
the versioned policies in force (objective, UNKNOWN-hours).
Invalid input (no duration provenance, duplicate identity, invalid footprint
or composite) is an input error, never defaulted.

Output: per scheduled activity — identity, day, planned start/end, duration
+ provenance, applied opening window (or UNKNOWN) + provenance, incoming leg
(origin, destination, mode, duration, distance where available, walking
portion, routing provider, selection reason, the
other evaluated modes with rejection reasons), binding constraints. Per day —
used time, remaining time (the existing `PlannerResidualCapacity` with its
`meaningful` judgement), total travel, total walking where available, day
diagnostics. Per plan — unselected candidates with typed reasons (P10), input
errors, policy versions, travel-estimate quality, constraint snapshot, legs
per mode and per quality. The Tour snapshot persists this evidence
(tour-composition); the existing `TourActivity.travelTimeToNext` /
`distanceToNext` / mode transition is the minimum and is extended per R4-D1.

*Implemented contract (task 25.1, 2026-10-15).* `daily-planning.interface.ts`
carries the contract above, replacing the earlier types:
- **Candidate:** ordered `components` (VISIT / TRAVERSE / null for a legacy
  area member), VISIT facts (`duration` with provenance and
  `openingHoursByDay`, one entry per planning day), an optional bounded
  `requiredTraversal`, footprints and `mustInclude`. A single-place
  Experience's facts sit on its one VISIT component.
- **Request:** `days` (date, `timezone` RESOLVED / UNRESOLVED, window,
  anchors, unavailable windows), mobility constraints with the resolved
  cycling limit (P7) and the policy versions in force.
- **Output:** per visit `duration`, applied `openingHours` (window or
  UNKNOWN) and `bindingConstraints`; per day `residual` (the
  meaningful-residual judgement) and the first/last-mile record; per plan
  `inputErrors`, `policies`, `legs` (by mode, by estimate quality) and the
  constraint snapshot.
- **Cycling limit representation:** `maxContinuousCyclingMinutes`
  (required) and `maxDailyCyclingMinutes` (optional), measured on provider
  bicycle durations, with a surface-neutral `source` (`USER_STATED` or a
  named, versioned `MOBILITY_PROFILE`).
- **Planning readiness:** a catalogued Experience without a usable
  duration is not planning-ready. It is left out of composition and the
  planner with the typed reason `MISSING_REQUIRED_DURATION`, keeps its
  identity, and becomes planning-ready again once duration knowledge is
  enriched (C15 demand wiring, task 41.0). No default duration exists; the
  former 90-minute planner default is deleted, and `fallback-v1` (task 40.2)
  is a separate, future evidence-backed policy.
- **Transitional provenance (removed by group 41):** until GeoEntity
  knowledge is wired, durations and opening hours come from the legacy
  Experience fields and carry `LEGACY_EXPERIENCE_DURATION` /
  `LEGACY_EXPERIENCE_OPENING_HOURS` with `evidenceBacked: false`. They are
  visible in the plan and the trace, are not authority classes, are never
  persisted as knowledge, and no feature may depend on them semantically.
  Legacy weekly hours keep their legacy reading (a missing weekday or an
  undated day is UNKNOWN); the P3 closed-weekday rule applies to GeoEntity
  knowledge (task 26.1). Legacy composites hold their facts only for the
  whole Experience (`legacyExperienceFacts`).
- **Destination timezone:** no task yet resolves it; the planning input
  carries it explicitly UNRESOLVED (open finding).

#### P3. Opening-hours model and UNKNOWN policy

Knowledge per candidate and calendar date (destination-local time):
KNOWN_OPEN_WINDOW (one or more windows, optional last admission per window),
KNOWN_CLOSED, UNKNOWN; each with provenance (provider/catalog fact and its
source). Resolution order for a date: date-specific exception, then weekly
pattern; a known weekly pattern with no window for that weekday is
KNOWN_CLOSED; no hours at all is UNKNOWN. Hard constraint for KNOWN windows:
`visitStart >= window.start`, `visitEnd <= window.end`, and
`visitStart <= window.lastAdmission` when known. KNOWN_CLOSED is never
scheduled. The OSM `opening_hours` parse lives at the provider/catalog
boundary; the planner sees only the typed knowledge.

UNKNOWN is never OPEN. A versioned UNKNOWN-hours policy, chosen outside the
optimizer, selects ALLOW_WITH_UNCERTAINTY, PENALIZE (an objective cost term,
P9) or EXCLUDE (reason OPENING_HOURS_UNKNOWN_EXCLUDED). Every scheduled
UNKNOWN visit is marked uncertain with the policy version. UNKNOWN is never
resolved by web/LLM research on the planning path; future structured
opening-hours enrichment may change the catalog fact, not the planner.

**Default policy: PENALIZE (P-D4 RESOLVED).**

- *Feasibility:* UNKNOWN creates no opening-hours hard constraint; a VISIT
  component with UNKNOWN hours is feasible on the basis of hours alone. It
  never overrides another hard infeasibility (closing time of another
  component, day window, travel, walking, user window). KNOWN_CLOSED and
  KNOWN_OPEN_WINDOW stay hard exactly as above; UNKNOWN applies only when
  the GeoEntity's hours knowledge is genuinely UNKNOWN (no record, or a
  record with status UNKNOWN), never to a provider failure that is silently
  ignored and never by fabricating a window.
- *Preference:* the objective carries a dedicated soft term,
  `openingHoursUncertaintyPenalty`, over the scheduled VISIT components with
  UNKNOWN hours, so an otherwise comparable itinerary with known compatible
  hours is preferred. Its weight and functional form (per component, scaled
  by visit duration, …) are P-D7; P-D4 assigns no number. A candidate not
  chosen because a comparable known-hours plan scored higher carries
  DOMINATED_BY_HIGHER_UTILITY_PLAN with the uncertainty in its evidence —
  never an hours rejection.
- *Composites:* the policy applies per internal VISIT component. Known-hours
  components must fit their windows on the internal timeline; an UNKNOWN
  component makes the composite neither infeasible nor "open"; the
  Experience exposes the set of its uncertain components (not one opaque
  boolean) for the objective and diagnostics; one KNOWN_CLOSED component at
  its planned internal arrival makes that schedule infeasible.
- *Must-include:* a must-include Experience/component with UNKNOWN hours is
  never removed for that reason and never given invented hours; it is
  scheduled under the policy (a hard inclusion outranks the soft term) and
  its uncertainty is surfaced. Known-closed for every feasible interval is a
  genuine constraint conflict, reported with OPENING_HOURS.
- *Diagnostics:* OPENING_HOURS (known hours make the schedule infeasible),
  the scheduled-visit marker OPENING_HOURS_UNKNOWN (accepted under the
  uncertainty policy, with the policy version), and
  OPENING_HOURS_UNKNOWN_EXCLUDED only when EXCLUDE is configured. Typed hours
  reasons are never folded into OTHER_PLANNER_CONSTRAINT.
- *Readiness / acquisition:* UNKNOWN is planner uncertainty, not missing
  candidate knowledge: it never emits a gap, NEEDS_ACQUISITION or
  INSUFFICIENT_KNOWLEDGE, and never starts a synchronous research loop.
  Counts of uncertain scheduled visits enter the planning diagnostics; the
  verdict follows R4-D4 unchanged. Background enrichment may later refresh
  hours for future plans.
- *Snapshot:* each scheduled component records `openingHoursStatus = UNKNOWN`
  in its planning evidence (no window), and the Tour planning context records
  the UNKNOWN-hours policy and version (C14 fields, unchanged).
- *Other policies:* ALLOW_WITH_UNCERTAINTY and EXCLUDE remain supported,
  versioned policy values (tests, spike protocol, future strict products);
  this change exposes no request-level selection of them.

Rejected as default: EXCLUDE discards otherwise valid attractions for lack of
metadata and makes provider coverage masquerade as planner infeasibility;
ALLOW_WITH_UNCERTAINTY treats a visit of unknown availability as equally
safe as one proven open.

#### P4. Visit-duration knowledge and resolution (P-D2 RESOLVED)

The planner consumes normalized visit-duration knowledge; it never
discovers or infers it and contains no category-duration logic. Duration is
reusable knowledge about visiting an already-admitted PLACE GeoEntity, resolved through an
evidence-backed pipeline, not a single arbitrary constant:

```text
catalog (persisted duration knowledge, structured provider facts)
  -> optional, lazy, evidence-backed resolution (VISIT_DURATION enrichment)
  -> explicit, versioned fallback policy (last resort)
  -> planner input (projected duration + provenance)
```

**Authority order** (guidance for authority/provenance, not an instruction to
query every source for every place): (1) STRUCTURED_PROVIDER — an explicit
duration/visit-length fact in structured provider data; (2) OFFICIAL_SITE —
the place's own official information (e.g. official tour or timed-entry
length); (3) OFFICIAL_TOURISM_OR_INSTITUTIONAL; (4) REFERENCE_TRAVEL — other
reliable travel/reference sources; (5) USER_GENERATED — reviews and visitor
reports, as evidence of typical observed behavior; (6) GROUNDED_SYNTHESIS —
grounded research synthesizing cited evidence from 2-5; (7) FALLBACK_POLICY.
Weaker evidence never overrides stronger evidence automatically.

**Research boundary.** Resolution enriches knowledge about an admitted
GeoEntity. It never
decides existence, canonical identity, admission or revocation, and creates
no tourism-relevance requirement for ordinary admission. It reuses the
existing canonical primitives instead of a parallel pipeline: VISIT_DURATION
is an enrichment gap routed by the acquisition router (catalog/structured
first, then WEB_EVIDENCE); research receives the offered canonical place
(structured names, coordinates, structured official-website link where one
exists) and may propose only VISIT_DURATION claims with captured evidence;
grounding authorizes them under a VISIT_DURATION source capability;
unauthorized captures stay in research evidence memory. Input-level guard
against the spike 1 / Preference-First failure: the question is one narrow
factual question about one identified place, not open discovery; a capture
must name its subject; an LLM-produced duration without a cited capture is
never authority. The concrete research provider (Groq, Claude, Gemini or
other) is not selected here; it belongs to the enrichment/research
implementation policy.

**Reviews / user-generated evidence** contribute typical-behavior evidence,
kept distinct from official durations, never override stronger official or
structured evidence, and are never authoritative from a single anecdotal
report (the consistency requirement is a versioned grounding policy value).
Material conflicts are preserved as a range with CONFLICTING status, not
collapsed into false precision.

**Lazy / on-demand resolution.** Never research the whole catalog. Order:
catalog/cache first -> known structured duration -> resolve only a bounded
shortlist of candidates likely to participate in planning (the ranked
planner pool or the produced Tour's stops whose knowledge is absent, fallback
or stale), under a versioned budget -> persist for reuse. Resolution is
asynchronous catalog maintenance (C15): a generation plans with the duration
knowledge already in the catalog (or the fallback), emits deduplicated
enrichment demand, and never waits on research, preserving the "no research
on the ordinary critical path" invariant (C13 item 11, gap-research);
resolved knowledge improves later plans.

**Normalized duration model** (`VisitDurationKnowledge`, per admitted PLACE
GeoEntity, i.e. the reusable cost of visiting it): optional minimum useful duration, optional recommended/typical
duration, optional maximum useful duration (practical upper range), status
(RESOLVED, CONFLICTING, INSUFFICIENT_EVIDENCE), evidence quality /
confidence, the winning authority class, the evidence items used (source,
authority class, captured statement, retrieval time), resolver/policy
version and resolution timestamp. Not every source supplies every field.
Projection to the planner input is a versioned projection policy: the
recommended/typical duration when present; a range without a typical value
is projected by an explicit, recorded rule; any planner adaptation between
minimum and recommended duration is a future explicit planner policy, never
an undocumented adjustment. The planner output carries the authority class,
status and versions (tour-planning).

**Persistence and reuse.** Duration knowledge is reusable catalog knowledge
attached to the admitted GeoEntity, reused across Tours. Changing or
enriching it never changes any Experience's identity, updates the knowledge
in place (keeping provenance and resolver version), and may change future
plans. The stored value keeps provenance and
policy/version sufficient to explain its derivation. Storage mapping onto
the Prisma models follows R4-D1 (resolved, C14: `GeoEntityVisitDuration`).

**Fallback (P-D2-F RESOLVED).** Evidence-backed duration is the normal
planner input; the fallback is exceptional degraded planner behavior so the
current request can finish despite an unexpected catalog gap. It is not a
duration source, not canonical knowledge, not evidence and not a substitute
for catalog maintenance.

- *Shape:* one global, versioned planner fallback policy with a single rule,
  `GLOBAL_DEFAULT`, yielding one duration in minutes for any VISIT component
  whose GeoEntity has no usable duration knowledge (no record, or status
  INSUFFICIENT_EVIDENCE; a CONFLICTING record with a range uses the P4 range
  projection, not the fallback). No category, class, destination, opening
  hours, popularity or distance dependence; no LLM guess; no runtime
  research. The earlier allowance to key it by admission class is
  withdrawn.
- *Provenance:* planner input and the Tour snapshot carry
  `durationSource = FALLBACK_POLICY`, the fallback policy version, the rule
  (`GLOBAL_DEFAULT`) and its version, and the minutes used. It is never
  written to `GeoEntityVisitDuration` (C14).
- *Side effect:* every fallback use emits VISIT_DURATION_ENRICHMENT_REQUIRED
  demand for that GeoEntity (deduplicated, C15).
- *Value:* not chosen — no calibration evidence exists yet. A bounded
  calibration gate (task 40.2) must approve the value before production
  wiring (group 41): it computes, from evidence-backed typical durations in
  the task 27.3 probe sample and any RESOLVED catalog records across the
  P-D6 destinations, the 75th percentile (p75) of typical duration (owner,
  2026-10-15) with sample size, source mix and spread, and the owner
  approves or rejects that value as
  `fallback-v1`. Any later change is a new version from new calibration
  evidence. No universal 60 minutes is product truth.
- *Calibration status (2026-10-14, task 40.2; evidence
  `spikes/planner-comparison-2026-10-12/p-d2-f-40-2/`): numeric value OPEN.*
  - **The evidence-backed sample is empty.** There are no duration-knowledge
    records yet (task 39.0), and the task 27.3 probe has not run. Every
    duration in the planner fixtures and spikes is a fallback value, a
    fixture class rule or an assumption, so none can be used.
  - **Structural loss analysis** (OR-Tools, BA / Paris / LA, F = 30-120 min):
    - The optimizer packs days whatever F is. The same plan breaks once
      visits run more than about 0-10 % longer than planned (e\*), except
      where opening hours rather than the day bind.
    - Overestimation costs utilization almost proportionally: a saturated
      day drops from 15-16 to 4 Experiences as F goes from 30 to 120.
    - So the safety bias comes from the statistic, not from slack. A median
      underestimates about half of the places it is used for.
  - **Owner decisions (2026-10-15):**
    - the statistic is p75: the optimizer leaves effectively no slack, so a
      median systematically exposes plans to underestimation;
    - sufficiency: at least 30 evidence-backed observations, at least 8 per
      P-D6 destination, at least 2 source types (authority classes), no
      destination above 50 % of the sample;
    - robustness: the leave-one-destination-out check must pass (the global
      p75 stays within the leave-one-destination-out range) before the value
      is approved.
  - **Still OPEN: the numeric value only**, pending task 27.3 evidence that
    meets the sufficiency rule and the robustness check. No value is
    invented.
  - **Already defined for `fallback-v1`:** the rule `GLOBAL_DEFAULT`, which
    applies per VISIT component only (never TRAVERSE time, never composite
    internal travel), and the snapshot provenance.

#### P5. Travel estimation / directions contract

The existing `TravelEstimateProvider` abstraction (`TRAVEL_ESTIMATE_PROVIDER`)
is evolved, not replaced, into a per-mode contract:

```text
(origin, destination, mode, departureTime?)
  -> ESTIMATE_AVAILABLE { durationMinutes, distanceMeters?, walkingMinutes,
                          walkingDistanceMeters, provider }
   | MODE_UNAVAILABLE | PROVIDER_UNAVAILABLE
```

Providers estimate the requested mode and never choose it (the
`pickMode` logic is deleted from both providers). Two provider-neutral
companions follow from the P-D1 evaluation (C16): a constrained variant
for required bounded traversals (outcome adds CONSTRAINT_UNSATISFIED, with
the validated geometry) and a bulk `TravelMatrixProvider` for optimizer pair
costs, with chunking/limits/billing hidden in adapters. The planner may request
the allowed modes for a leg or a matrix for its pool; batching and caching
are adapter concerns. Normal operation is provider-routed (a directions /
routing provider) with at least walking and one non-walking urban mode. The
concrete provider is NOT selected by this amendment (P-D1). No fixed urban
speed, wait time or city heuristic is product truth. Estimates used by a plan
are recordable/replayable for deterministic tests.

#### P6. Routing unavailable (P-D3 RESOLVED)

The production planner never fabricates travel times. Estimate available ->
use the provider-backed estimate. Estimate unavailable -> explicit failure of
the affected feasibility decision; no speed, wait-time, access-time or
city-specific substitute.

- **Partial availability:** continue with provider-backed estimates for the
  remaining allowed modes, record MODE_UNAVAILABLE / PROVIDER_UNAVAILABLE per
  mode; a leg is unevaluable only when no allowed mode has a usable
  estimate. Not every mode must be available.
- **Unevaluable required leg:** never assumed feasible; the affected
  candidate carries TRAVEL_ESTIMATE_UNAVAILABLE (P10). A Tour may still be
  produced from evaluable candidates; readiness counts the affected
  candidates as unused eligible supply (PLANNER_LIMITED where C2 applies),
  never as CANDIDATE_SUPPLY.
- **No valid itinerary because of routing:** the explicit
  TRAVEL_ESTIMATION_UNAVAILABLE generation outcome with typed diagnostics and
  no Tour. Never NEEDS_ACQUISITION, INSUFFICIENT_KNOWLEDGE, POI-coverage or
  tourism-knowledge shortfall; routing availability is a planner /
  infrastructure concern (C9 classifies it PLANNER_FEASIBILITY, routed to no
  acquisition).
- **Degraded estimation:** not enabled in production and not part of this
  change. A future degraded estimator needs a separately approved,
  evidence-calibrated policy defining calibration, uncertainty/error bounds
  where possible, policy/version provenance, conditions of use and how
  degraded plans are marked. No degraded parameter is chosen or required.
- **Current code affected:** `ResilientTravelEstimateProvider` falls back to
  `ApproximateTravelEstimateProvider` when routing is unconfigured, fails or
  is configured "approximate"; that fallback is exactly what P-D3 forbids.
  The new per-mode contract returns PROVIDER_UNAVAILABLE instead; the
  approximate provider and fallback become unreachable from new requests at
  wiring (41) and are deleted at retirement (43).
- **Tests and spikes:** deterministic tests and the P11 spike replay
  recorded responses from a real routing source; recordings are fixtures,
  not degraded estimates.

#### P7. Multi-day temporal and mobility constraints

Each day: within daily start/end; no visit or leg overlaps user unavailable
windows; every visit duration and every leg counted; each candidate at most
once across days. A composite Experience is scheduled as one candidate with
an internal timeline (C0): its components in their order, internal travel
and required traversal time, component visit durations, and each internal
PLACE component reached inside a valid opening window; the planner never
reorders or drops required components and never bypasses a required
traversal. Walking: maximum continuous walking per leg segment and
daily walking budget, counting walking portions of non-walking legs
(access/egress); allowed modes only. Cycling (owner D3, 2026-10-15): when
BICYCLE is allowed, the PlanningRequest contains a resolved cycling limit
that bounds BICYCLE travel, measured on provider-backed bicycle estimates.
The value may originate from explicit user input, conversational intent, a
contextual UI action, a named/versioned mobility profile or a future input
adapter; the adapter resolves it before planning. The planner never knows
which surface (wizard, chat, UI action, API) produced it; the plan records
the resolved limit with surface-neutral provenance (for example a profile
name and version). No universal default exists: BICYCLE allowed with an
unresolved cycling limit is invalid planning input. Task 25.1 decides the
representation and unit; it is not assumed to be a single scalar. Walking and cycling limits shape mode
choice and feasibility, are never objective weights, and never produce
candidate-knowledge diagnostics.

#### P8. Optimization model (algorithm-independent)

The problem is a multi-day orienteering problem with time windows and
multimodal arcs (related: Team Orienteering with Time Windows, prize-collecting
VRP with time windows, constraint optimization). Days are the "vehicles";
candidates are optional nodes with a prize (utility) and a service time
(duration); arcs carry per-mode travel time and walking cost.

Decision variables: selection of each candidate, its day, successor order,
visit start time, and the mode of each used arc.

Hard constraints (never weighted): opening windows/closed days/last
admission (P3; EXCLUDE policy where configured), day window, user unavailable
windows, duration, travel-time consistency
(`start_j >= end_i + travel(i, j, mode_ij)`), allowed and estimable modes,
continuous and daily walking limits, the cycling limit (P7), at most one
visit per candidate,
request-declared inclusion constraints (reported if infeasible, never
silently dropped).

Objective (P-D7: preference-first; see "P-D7 preference-first objective"):
maximize total utility (the request's preference utility; optional
quality/notability, diversity and spatial-coherence terms) minus costs
(travel time, idle time, geographic zig-zag, mode changes,
`openingHoursUncertaintyPenalty` under the default PENALIZE policy (P-D4), optional day-imbalance cost). Terms and weights form a
versioned planner objective policy recorded with the plan; weights express
preference between feasible itineraries only.

#### P9. Mode choice inside the optimizer

Mode per arc is part of the optimization: the optimizer chooses among
allowed modes with an estimate, subject to walking limits, under the
objective. Walking is never forced because it is allowed and never forced
because it fits the limits; a non-walking mode can make distant candidates
feasible. Ties break by a fixed mode order for determinism. Whether a model
prunes dominated modes per arc before search (e.g. keep walking only when not
slower-and-more-walking than an alternative) or decides arc modes inside the
solver is a spike question (P11), because the daily walking budget couples
arc choices.

#### P10. Typed planner diagnostics

Every eligible candidate offered to the planner and not scheduled carries
typed reasons: OPENING_HOURS, OPENING_HOURS_UNKNOWN_EXCLUDED, TRAVEL_TIME,
TRAVEL_ESTIMATE_UNAVAILABLE, REQUIRED_TRAVERSAL_UNSATISFIED (a required
traversal's estimate is CONSTRAINT_UNSATISFIED for every allowed mode), DAILY_CAPACITY, WALKING_LIMIT,
CYCLING_LIMIT (new; BICYCLE legs beyond the cycling limit, P7), NO_ALLOWED_TRAVEL_MODE, VISIT_DURATION, USER_TIME_WINDOW,
DOMINATED_BY_HIGHER_UTILITY_PLAN, OTHER_PLANNER_CONSTRAINT, with evidence
(windows, legs and modes evaluated, walking figures). Mapping from the current
`PlanningRejectionReason`: DAILY_TIME_CAPACITY_EXCEEDED → DAILY_CAPACITY;
MAX_WALKING_PER_DAY_EXCEEDED / MAX_CONTINUOUS_WALKING_EXCEEDED → WALKING_LIMIT
(sub-kind retained in evidence); OPENING_HOURS_INCOMPATIBLE → OPENING_HOURS;
NO_ALLOWED_TRAVEL_MODE unchanged; LOWER_RANKED_THAN_SELECTED →
DOMINATED_BY_HIGHER_UTILITY_PLAN; NO_FEASIBLE_DAY → the specific binding
reason(s), OTHER_PLANNER_CONSTRAINT only when none applies;
DUPLICATE_EXPERIENCE / INVALID_SPATIAL_FOOTPRINT / INVALID_COMPOSITE → input
errors, not feasibility reasons. The old enum is replaced, not kept beside
the new one. Exact reason attribution for exact optimizers (which constraint
"caused" an omission) is a spike question: diagnostics may come from a
deterministic post-solve feasibility probe per unscheduled candidate.
Readiness consumes these reasons directly (C2).

#### P11. Planner algorithm-comparison spike

Bounded spike `spikes/planner-comparison-<date>/` before any optimizer is
chosen. Production code is not changed by it.

- **Approaches:** (1) current `GreedyDailyPlanningSolver` baseline, run
  through the new input contract; (2) OR-Tools Routing (days as vehicles,
  time dimension with windows, disjunction penalties = utility, walking
  dimension); (3) a CP-SAT orienteering formulation (optional intervals,
  circuit/arc literals including per-arc mode literals) if materially
  different and practical.
- **Purpose boundary (P-D6):** given the same feasible planning inputs and
  the same recorded travel estimates, which optimizer produces the best valid
  multi-day itinerary. The spike consumes planning-ready candidate datasets
  and does not test discovery, admission coverage, identity, web research,
  enrichment or provider completeness.
- **Destination datasets (P-D6):**
  - *Buenos Aires* — the real end-to-end structured candidates produced by
    spike 3 S3-A (read-only; spike 3 evidence unchanged): the dense
    large-city baseline and the only real-pipeline case.
  - *Paris* — reproducible planner fixture: dense urban layout, many nearby
    attractive candidates; exercises time windows, clustering and
    competition.
  - *Los Angeles* — reproducible planner fixture: spatially dispersed
    layout; exercises travel-time sensitivity, non-walking modes and
    multi-day geographic allocation.
  Paris and Los Angeles exercise planning geometry, not acquisition: no local
  OSM/Overpass/Nominatim installation is required. Their candidates are
  produced once (curated, or from a one-off public structured snapshot),
  then frozen and versioned; the spike never queries them live. Their
  opening hours and durations are representative fixture values, not a full
  real catalog, and claim no real-world accuracy. No destination-specific
  optimizer rule exists.
- **Candidate fixture contract (P-D6):** per candidate — stable identity,
  coordinates, ranking/reward score, visit duration with provenance,
  opening-hours knowledge (windows / KNOWN_CLOSED / UNKNOWN), must-include
  flag where a scenario needs it, and fixture/source provenance (spike 3
  run id for Buenos Aires; fixture version and origin for Paris/Los
  Angeles). Fixtures are deterministic and versioned; the same candidate set
  is used by every approach within a destination.
- **Constructed edge-case fixtures**, kept separate from destination-quality
  comparisons: mutually incompatible opening windows, must-include
  candidate, long-distance high-value candidate, split opening windows,
  walking-only limitation, mode unavailable, candidate dominated by a better
  feasible itinerary, insufficient daily capacity (plus closed days, last
  admission and user unavailable windows from P13).
- **Routing recordings (P-D6):** one real routing source records the
  provider-backed estimates for every mode the spike needs, for every
  ordered candidate pair (and day start/end anchors) of each destination;
  all approaches replay the identical recordings and never call the
  provider live. Each record keeps origin, destination, mode, departure-time
  context when relevant, duration, distance where available, provider,
  retrieval timestamp and provider response/version metadata. A mode the
  source cannot serve for a pair is recorded MODE_UNAVAILABLE (P6), never
  estimated. Recordings are fixtures, not degraded estimates.
- **Recording source (experimental only, not P-D1):** the existing Geoapify
  routing integration (`GeoapifyTravelEstimateProvider`, Geoapify Routing
  API: `walk`, `drive`, `transit`; Route Matrix API for supported modes,
  up to 1,000 cells per call), reused because it is the only routing source
  already integrated; Google Maps is used only for Places here. Recorded
  limitations: the Geoapify routing API takes no departure time, so
  recordings are time-independent; its `transit` mode is not documented as
  timetable-based. Both affect absolute feasibility, not the fairness of the
  comparison, because every approach replays identical data. Operational
  prerequisite: a Geoapify API key must be configured in this worktree's
  environment before recording.
- **Spike-local policies:** the spike's comparison objective, UNKNOWN-hours
  treatment and fixture durations are versioned spike-protocol values
  applied identically to every approach; they do not resolve P-D7, P-D4 or
  P-D2-F.
- **Metrics:** hard-constraint violations (gate: must be zero), total
  utility, scheduled visits, travel time share, idle time, geographic
  coherence (zig-zag/backtracking), multi-day balance, determinism (repeat
  runs byte-identical), computation time at realistic pool sizes,
  implementation and runtime-integration complexity for the NestJS backend,
  and diagnostic quality (every unscheduled candidate has a correct typed
  reason).
- **Protocol (pre-registered before any comparison run):** exact fixtures
  and versions per destination, candidate counts (bounded so that the
  ordered-pair x mode recording volume stays within the source's quota;
  fixed before results and never tuned afterwards), opening-hours policy,
  visit-duration values and provenance, allowed modes, routing-recording
  source, comparison objective version, pass/fail hard constraints and the
  metrics. Changing any of these after seeing results requires a new,
  recorded experiment version.
- **Rule:** the evaluation protocol and pool sizes are recorded before runs;
  selection is by evidence, never elegance or familiarity; the S3-A replay
  also records which previously walking-rejected landmarks become
  schedulable (evidence, not a tuning target).

#### P11 results (executed 2026-10-12)

Evidence: `spikes/planner-comparison-2026-10-12/` (`PROTOCOL.md`,
`README.md`, `RESULTS.md`, per-run outputs). BA (28 spike 3 candidates + the
San Telmo composite), Paris and Los Angeles fixtures, recorded Geoapify
walk/drive matrices, 13 scenarios per city, 234 runs, one independent
hard-constraint checker.

- Correctness: 0 hard-constraint violations by any produced Tour;
  must-include conflicts reported explicitly by every solver. The
  pre-registered CP-SAT configuration produced no Tour on 20 runs (every
  ~30-candidate pool).
- Quality (test weights): the current greedy is materially worse (fewer
  Experiences, idle-heavy; its walk-whenever-allowed rule collapses LA to 3
  Experiences). Greedy best-insertion is within 0-5 % of Routing on normal
  tours and within 1.1 % of the proven optimum on 10-candidate pools, but
  7-14 % behind Routing in constrained cases (tight hours, 1-day
  oversupply, start+end anchors). Routing (1-5 s) is best or near-best;
  CP-SAT is optimal up to ~20 candidates but does not scale to ~30 in this
  formulation (no solution with 1 worker; 7-55 s with 8 workers or a hint,
  never beating Routing 5 s).
- Composite, anchors, UNKNOWN hours (PENALIZE) and mode choice behave as
  specified in every approach; per-day node copies are needed in Routing
  because hours differ by weekday; mode choice is pre-pruned per arc.
- Readiness: a weaker planner inflates PLANNER_LIMITED; a solver that
  exhausts its budget without a Tour is a planner failure, not
  infeasibility.

#### G-P5 results (executed 2026-10-12)

Evidence: `spikes/planner-comparison-2026-10-12/g-p5/` (README, sidecar
and client prototype, raw runs). Same P11 fixtures and TEST-ONLY objective;
OR-Tools 9.15.6755.

- Integration options: no official or production-credible Node.js binding
  for Routing (abandoned `node_or_tools` on OR-Tools v5.1, 0.x or months-old
  single-maintainer ports) — rejected. OR-Tools ships manylinux wheels only,
  so it cannot live in the `node:22-alpine` backend image. A Python sidecar
  over HTTP/JSON is selected; a stdio child process saves ~1 ms of IPC but
  couples runtimes in one image; spawn-per-request adds 117-151 ms.
- Boundary: one bounded request per plan (`planning-problem-v1`, ~16 KB for
  30 candidates: per-day feasible start windows, service minutes, utility,
  uncertainty count, must-include, optional anchors, per-mode travel seconds,
  limits, objective terms, `optimizerPolicyVersion`) and one result
  (`planning-result-v1`, ~3.5 KB). Node and Python builders emit identical
  requests. Model = P11 Routing with must-include as a dominant-penalty
  optional node (a solution always exists; proven conflicts are reported
  before solving) and matrix-registered transit costs.
- Stopping: wall-clock stops are not reproducible (1 s: 3/39 scenarios
  changed plan on repeat; plans change with the CPU quota); the
  improvement-rate limit never stopped GLS. Solution limits are
  reproducible (39/39); SL1000 is the smallest tested limit with no scenario
  > 1 % below the recorded 5 s runs (mean +0.10 %, worst -0.67 %).
- Latency (laptop, warm, 30-candidate 3-day incl. composite, must-include,
  start+end anchors): total median/p95/max 2085/2306/2356 ms; solve 2070
  median; everything else ~13 ms (IPC 1.7 ms, model build 6 ms, validation
  0.06 ms). Cold sidecar process ready in 0.18-0.24 s with no first-request
  penalty; container 1.3 s at 2 vCPU, 41-58 MiB, 115 MB image. Container
  SL1000: 3.2-3.4 s at 2 vCPU, 7-7.8 s at 0.5 vCPU (same plan), safety cap at
  0.2 vCPU. Tour generation is already a background job.
- Quality vs greedy best-insertion (35 planned scenarios): > 1 % better in
  23, within ±1 % in 11, worse in 1 (-3.7 %, 10-candidate pool); +16
  scheduled Experiences over 15 scenarios.
- Failures (11/11 tested): proven must-include conflict → INFEASIBLE;
  unavailable, crash, timeout, malformed, constraint-violating result,
  rejected request, worker exit, no solution within budget →
  OPTIMIZER_FAILED with a typed reason; never PLANNER_INFEASIBLE or a
  knowledge verdict. A client timeout does not cancel the sidecar's solve,
  so the client deadline must exceed the safety cap.

#### P-D7 preference-first objective (2026-10-14)

The question P-D7 answers: how does the planner maximize satisfaction of
THIS request's preferences while accounting for travel burden and planning
uncertainty? Two stages stay separate: Stage 1 (candidate relevance:
eligibility, explicit facets, semantic matching, quality) and Stage 2
(itinerary optimization by OR-Tools over typed utility, durations, opening
hours, travel, allowed modes, must-include, uncertainty). OR-Tools never
performs semantic retrieval and never sees embeddings, text, facets or
provider metadata.

**Current implementation (code, 2026-10-14).**

- Request → `PreferenceInterpreterService` (LLM) → `NormalizedPreferenceIntent`
  → `buildPreferenceSpec`: `facets` (wizard themes/intents at weight 1.0;
  free-text facets weight = importance × confidence), `exclusions.hard`
  (plus `non-vegan food` for vegan requests), `exclusions.themes/traits`
  (soft avoidances), `softConstraints` (dietary, accessibility, budget,
  group), `semanticQuery` (= the interpreter's `positiveSemanticQuery`,
  positive interests only, ≤ 500 chars), `explorationStyle` (meta-
  preference, never a facet).
- Hard exclusions: `findHardExclusionMatches` — structural lexical match with
  aliases over the Experience's own evidence (name, description, themes,
  traits, intents, required components) — removes candidates before
  composition (`matchesHardExclusion`). Never embedding-based.
- Explicit facets: `candidateMatchesPreferenceFacet` is the one matching
  primitive; `isStrongFacetMatch` adds real geography, quality ≥ 3.0/5 (null
  quality is never a strong match), not-known-thin classification;
  `preferenceWeightForExperience` = Σ weights of strongly matched facets
  (deduplicated). Strong matches require known quality, so every
  Experience with non-zero facet affinity has known quality.
- Provenance (G-P7-U.A audit):
  - Wizard picks are direct user evidence by construction.
  - Every accepted interpreter facet carries verbatim excerpts, validated
    against the user's text. Nothing records whether the key is the user's
    own concept (direct) or a mapping the interpreter derived (inferred).
  - `RequestedFacet` keeps only `weight` (importance × confidence) and the
    UI `source`. It drops the excerpts and the strength/confidence split.
  - The evidence-support check is a substring match: "arte" is accepted
    from "martes".
  - The deterministic fallback keeps its own keyword table, which
    duplicates `DIMENSION_KEY_SYNONYMS`. It triggers on substrings and
    records the trigger word, not a user span, as evidence.
  - The facet vocabulary (`INITIAL_DIMENSION_VOCABULARY`,
    `DIMENSION_KEY_SYNONYMS`) carries no version.
  - Dedupe keeps the highest-weight facet per key, regardless of where it
    came from.
- The candidate pool is the verified catalog window plus resolved anchor
  ids. Embeddings never retrieve candidates (the similarity query is
  restricted to the pool's ids), so an Experience without an embedding
  still reaches composition and planning.
- Resolved soft venue anchors are live (`softAnchorBoost`). `composeSet`
  applies them as the last ordering key; the planner ignores them.
- Embeddings: the indexer embeds the Experience semantic document v3 (name,
  description, duration, price, themes, intents, traits with dimension:key,
  resolved components' role/kind/name/address) with model/version identity;
  at composition one query embedding of `semanticQuery` is compared by
  pgvector cosine (1 − distance) to compatible indexed Experiences only;
  incompatible / missing embeddings are absent from the result; provider
  failure → `unavailable`.
- Composition (`composeSet`): eligibility (no hard exclusion, real
  components) → must venues → one reserved strongest match per requested
  facet (order: grounding, semantic, quality, exploration tilt, soft anchor,
  id) → remainder fill by Σ matched facet weight, then semantic, quality,
  tilt → ranked reservoir. Explicit facet coverage is lexicographically
  first; semantic similarity refines within it (preference-first design
  §12.2a).
- Planner boundary (`PlanningCandidateNormalizerService`): each candidate
  carries `preferenceWeight`, raw `qualityScore` (0..5) and
  `semanticScore = semanticSimilarity ?? 0`; the greedy planner orders by
  `plannerRelevanceScore = 1·semanticScore + preferenceWeight +
  0.5·qualityScore/5`.

**Defects and duplicate authorities (to fix in groups 25/33, not
preserved).** Confirmed on the live code by the G-P7-U.A characterization
(2026-10-14, `spikes/planner-comparison-2026-10-12/g-p7-u-a/`); none was
disproven.

1. **Duplicate scoring authority — must be removed.** Composition orders
   explicit-first (lexicographic). The planner recombines the signals in
   `plannerRelevanceScore = 1·semanticScore + preferenceWeight +
   0.5·quality/5`, which is used by the greedy sort, placement scoring,
   must-anchor placement, ordering and the generation's solution
   comparison. The sum is not monotone in explicit evidence:
   - with free-text facet weights (0.42 each), one facet at similarity 0.98
     outranks two facets at 0.60 (1.90 vs 1.79);
   - quality also outranks a semantic difference (1.92 vs 1.80).
2. **Missing embedding coerced to 0.** The canonical rule is neutral /
   unknown (§12.2a), but two places map a missing or unavailable similarity
   to `0`, the lowest similarity:
   - the composition service: `scores.get(id) ?? 0`;
   - the planner normalizer: `semanticSimilarity ?? 0`.

   In the live `composeSet`, an Experience with equal facet evidence and
   the best quality is pushed out of the initial portfolio into the
   reservoir only because its embedding is missing. The dead
   `rankCandidatesByRelevance` used a separate lower tier.
3. **Dead preference paths.** `rankCandidatesByRelevance`
   (`candidate-ranking.util.ts`) and `evaluateExperiencePreferences` (the
   legacy evaluator with magic 0.45 / 0.8 penalties) are imported only by
   tests. In that file only `findHardExclusionMatches` is live.
4. **Soft avoidances and soft constraints: a gap.** `exclusions.themes` /
   `exclusions.traits` and the dietary / budget / group `softConstraints`
   are built into `PreferenceSpec` but:
   - have no live consumer;
   - carry no weight or confidence;
   - have no structural matcher.

   The interpreter fallback writes "avoid churches" into both
   `excludedThemes` and `hardExclusions`. The only live soft-to-hard rule is
   vegan → hard `non-vegan food`. They stay outside preference utility
   until either a structural negative-evidence signal is defined or the
   fields are deleted (early-stage deletion rule; task 25.5). No penalty is
   invented.
5. **Accessibility.**
   - The wizard's `mobility.accessibilityNeeds` and the interpreter's
     `accessibilityPreferences` are merged into one
     `softConstraints.accessibility` list that nothing consumes, so a stated
     need is not enforced anywhere.
   - The interpreter fallback files "silla de ruedas / wheelchair", a need,
     as a preference.
   - The schema has no canonical accessibility fact, so every Experience's
     accessibility is UNKNOWN today. Enforcing a need therefore requires
     that fact first, and until it exists a request carrying a need must end
     explicitly rather than silently plan without it (task 25.3).
6. **Mislabelled trace.** The composition trace's `qualityBonus` carries the
   raw 0..5 `qualityScore`, and `totalScore` is a placeholder.
7. **No-op key.** `groundingStrength` is constant within every facet
   reservation, so it never orders anything.
8. **Soft-anchor precedence is inconsistent.** The spec asks for a "strong
   inclusion tilt / strong boost" (§4 D3, §12.3) without a position; the
   accepted plan (2026-09-11, task C2) and the code apply it last. No live
   test exercises a soft anchor, and none exercises the plan's case
   "weighted two-low-priority facets do not automatically beat one
   high-priority facet".

**Resolved structure.**

- *Hard preferences* (hard exclusions, explicit accessibility
  needs/requirements, allowed travel modes, must-include feasibility)
  decide eligibility/feasibility; a hard-excluded Experience never reaches
  the optimizer; none becomes an objective weight.
- *Accessibility* is not generically soft. A preference for accessibility
  (e.g. "accessible places preferred") is a soft preference and contributes
  to preference utility through the structural matcher. An explicit
  accessibility need or requirement (e.g. wheelchair access required) is a
  hard eligibility constraint enforced from canonical accessibility facts
  before optimization; UNKNOWN accessibility is not evidence of
  accessibility. The request contract must carry the distinction (task
  25.3).
- *Preference utility* has exactly one canonical derivation boundary. It is
  derived once, consumed by composition, ranking and planning as each needs
  it, and never recomputed differently by a consumer; it crosses into the
  planning candidate as a typed, explainable breakdown — no opaque score.
  Which component owns that boundary (a dedicated preference-utility owner
  or an existing service) is decided by the implementation task (25.2)
  after inspecting the current layering; composition is a consumer, not
  presumed to be the owner. The G-P7-U.A analysis recommends a dedicated
  derivation step that runs once per composition snapshot, after hard
  eligibility and before composition:
  - it reuses `isStrongFacetMatch` as the only facet-truth primitive;
  - it owns the single semantic-similarity batch, which moves out of the
    composition service.

  The final owner is still chosen by task 25.2. The typed breakdown it
  produces:
  - *explicit facet evidence*: the strongly matched requested facets with
    their canonical weights, separated by **provenance**, `DIRECT` or
    `INFERRED` (the rule is below). Soft avoidances stay outside it until
    defined (defect 4);
  - *soft venue-anchor affinity*: a separate typed signal. It is never
    merged into facet affinity, never a theme, never forced;
  - *semantic affinity*: `KNOWN{similarity}` from `semanticQuery` against
    the Experience document, or `UNKNOWN{reason}` (no compatible embedding,
    empty query, provider unavailable). UNKNOWN is neutral: never 0, never
    a lower tier, and it never blocks participation.
    - For deterministic ordering only, an UNKNOWN candidate occupies the
      median position of the known similarities in the same higher-priority
      tier. The key is skipped when no peer is known.
    - This is an ordering projection, not semantic evidence. The assessment
      stays `UNKNOWN`, and the median is never stored or reported as its
      similarity.
    - Its request-relative rank may change with the cohort;
  - *generic quality*: canonical qualityScore (0..5) or UNKNOWN, labelled
    generic, not preference. UNKNOWN uses the same ordering projection.
- *Facet provenance* (owner rule, 2026-10-14; closes PROVENANCE-1). A
  deterministic provenance validator owns the classification; the LLM
  interpreter does not.
  - A wizard-selected facet is `DIRECT` by construction.
  - A free-text facet is `DIRECT` only when its quoted user-text excerpt
    maps deterministically to the same canonical key, through the
    versioned facet vocabulary or its explicit aliases/synonyms. Matching
    is token-bounded, with accents and case normalized. There is no
    stemming and no fuzzy matching. The excerpt itself must occur
    token-bounded in the user text.
  - Otherwise the facet is `INFERRED`. That covers any semantic inference,
    generalization, entity knowledge, ontology relation, embedding
    similarity, external knowledge or LLM interpretation beyond that
    mapping. Facets of the open `trait` dimension are therefore always
    `INFERRED`.
  - An `INFERRED` facet is still valid; it is never rejected for not being
    `DIRECT`.
  - Confidence stays confidence in the interpretation, never provenance.
    Embeddings never certify `DIRECT`. The mapping stays narrow: the
    ontology is not grown to make more facets `DIRECT`.
  - Each facet records the provenance, the excerpt that decided it and the
    vocabulary version.
  - Dedupe keeps one facet per (dimension, key): the highest provenance
    class wins, then the highest weight. An `INFERRED` duplicate never
    displaces a `DIRECT` one and never lends it weight.
  - Provenance is lexical. Polarity is not provenance, and confidence is not
    a proxy for polarity: "no me interesa la arquitectura" must never become
    a positive architecture facet, not even a weaker one. Polarity must be
    established before `DIRECT` evidence participates in preference utility
    (gap POLARITY-1, task 25.6).
  - Examples on the live vocabulary:
    - "me encanta la arquitectura" → architecture: `DIRECT`.
    - "quiero arte moderno" → art: `DIRECT` via the alias `arte`. No
      `modern_art` key exists.
    - "los edificios de Gaudí" → architecture: `INFERRED`.
    - "quiero conocer la ESMA" → history: `INFERRED`; intent visit:
      `DIRECT` via the alias `conocer`.
- *Precedence* (owner, 2026-10-14). Lexicographic, with no exchange rate
  between levels:
  1. `DIRECT` facet evidence: the Σ of the stated **importance** of matched
     `DIRECT` facets. Interpreter confidence never reduces a facet once
     deterministic validation has established `DIRECT`. Importance is the
     existing strength mapping (strong / medium / weak), kept separate from
     confidence; a wizard pick has importance 1.0.
  2. `INFERRED` facet evidence: the Σ of importance × confidence over
     matched `INFERRED` facets, where interpretation confidence stays
     meaningful. It is never added to `DIRECT`.
  3. Soft venue-anchor affinity.
  4. Semantic refinement.
  5. Generic quality.
  6. Stable Experience id.

  Constraints on the order:
  - The capture channel is not an authority tier. A wizard pick and a
    `DIRECT` free-text facet have the same authority. Within `DIRECT`,
    neither the channel nor interpreter confidence changes the order.
  - The ordering must be monotone in explicit evidence: an Experience with
    strictly stronger explicit evidence is never valued below one with
    weaker evidence because of anchor, semantic or quality signals.
  - Soft anchors follow facet evidence: no product or spec source places
    them above facet coverage. They precede semantic refinement by owner
    direction, which resolves defect 8 in favour of the spec's "strong".
  - When no facet is requested, semantic affinity leads and quality
    follows. With no embeddings at all, the order stays deterministic:
    explicit evidence → anchor → quality → stable id.
  - The precedence orders candidates within one request. It is not a
    scalar prize (see below).
- *What crosses the planner boundary*:
  - **Structured, not a scalar.** The planning candidate carries:
    - the typed breakdown;
    - the preference-utility policy version;
    - a within-request preference rank.

    These replace the untyped `semanticScore` / `preferenceWeight`. No
    consumer recombines them.
  - **Optimizer input.** The optimizer request carries no preference
    structure, embeddings, text, facets or provider metadata. It receives a
    per-candidate prize projected from the breakdown by the versioned
    objective policy (G-P7-U part B, a domain policy), plus:
    - the P-D4 uncertainty facts (uncertain / total VISIT components);
    - durations, feasible windows, travel and limits (G-P5 contract).

    The adapter only performs integer conversion.
  - **Why no scalar yet.** A per-candidate order does not determine the
    additive routing objective: order-preserving prize maps disagree on
    whether one higher-ranked visit outweighs two lower-ranked ones
    (G-P7-U.A spike). The cardinal projection is therefore a part-B
    decision.
- *Objective*: `TourUtility = PreferenceSatisfaction − TravelBurden −
  ModeFriction − PlanningUncertainty` over hard-feasible itineraries.
  TravelBurden uses provider-backed travel durations (factual) for the
  modes the request allows; how much a travel minute costs per mode is
  product policy. ModeFriction is an optional per-leg product-preference
  cost for vehicle modes (pick-up, parking, access friction) — never added
  to a travel estimate and never presented as routing truth.
  PlanningUncertainty is the PENALIZE cost of P-D4 (UNKNOWN stays feasible;
  known-compatible hours are preferred over otherwise-equivalent UNKNOWN
  hours; must-include UNKNOWN stays included). No idle, day-balance,
  count, clustering or diversity term without a measured problem; no
  destination-specific weights; one baseline policy for every destination.
  The only travel preference in the baseline is allowedTravelModes, which
  is hard.
- *Modes*: allowed modes come from the request and are hard; the objective
  ranks only allowed, release-supported, provider-served modes. TRANSIT is
  feature-gated in v1 (no matrix-capable provider, P-D1): WALK + TRANSIT
  plans with WALK and records TRANSIT MODE_UNAVAILABLE; TRANSIT-only ends
  with TRAVEL_ESTIMATION_UNAVAILABLE (MODE_UNAVAILABLE), no substitute mode,
  no Tour. BICYCLE is a confirmed first-release mode (G0) calibrated in
  G-P7-U.
  - *G-P7-B (2026-10-14), factual side resolved.* Recorded Geoapify
    `mode=bicycle` matrices exist for BA / Paris / LA, using the P11 points
    (`spikes/planner-comparison-2026-10-12/g-p7-b/`).
    - Bicycle is independent of the other modes: 0 unavailable pairs where
      walking has 60; bicycle ÷ walk 0.20-0.40; some pairs slower than
      walking and some faster than driving.
    - BICYCLE legs appear only when allowed.
    - A required walking traversal is never bicycle-timed: G2 rejects the
      bicycle outputs for Defensa.
  - *G-P7-B CLOSED (2026-10-15).* The bicycle cost is c_BICYCLE = 1 with
    per-leg friction A_BICYCLE = 4.5 in `preference-objective-v1` (owner D2).
    The resolved hard cycling limit (owner D3) bounds BICYCLE travel;
    it is a feasibility constraint, never an objective weight.

**Experimental evidence (`spikes/planner-comparison-2026-10-12/p-d7/`,
non-production).** 1,567 validated runs on BA / Paris / LA with a generic
desirability signal support the structure only: one objective shape
behaves across dense and dispersed cities; travel burden matters (too
little travel weight refuses worthwhile visits, too much adds travel for
nothing); minutes-only vehicle cost yields pervasive car hops, so a per-leg
mode-friction concept is needed; an absolute UNKNOWN-hours cost has a
suppression boundary (an Experience worth less than the cost is never
chosen) that a cost relative to the Experience's utility avoids; allowed
modes held as hard constraints (0 forbidden-mode legs); the extra terms
were unnecessary. Its coefficients (K = 120, +10 per DRIVE leg, 10 %
discount) are rejected as product semantics. Solver finding (for P-D5,
not changed here): single-start GLS at SL1000 is > 1 % below the best
known plan in 13/28 scenarios (max 8.7 %); 2× - 10× larger budgets barely
help, and the same holds under the P11 weights — a multi-start /
first-solution question, not a budget one.

**Gate G-P7-U — preference-utility calibration (one bounded gate, task
33.0), in two separate parts.** Part A must not borrow its numbers from
part B, and part B must not tune part A to fit travel behaviour.

**A. Preference-utility encoding** — how one Experience's preference
utility is represented for one request.
1. Encoding of the preference-utility policy satisfying the precedence
   rule (explicit authoritative and monotone; semantic within-tier with a
   neutral UNKNOWN representation; quality secondary), validated on curated
   preference scenarios built from the product vocabulary (for example
   architecture and history; modern art; local neighbourhoods avoiding
   churches; family-friendly; food and markets) against independently
   specified expected preference hierarchies, reusing the accepted
   Preference-First fixtures and characterization tests.

*Status: A RESOLVED (owner, 2026-10-14); B RESOLVED (owner, 2026-10-15);
P-D7 RESOLVED (2026-10-15).* The owner
decided the facet-provenance rule (PROVENANCE-1). The owner then confirmed
A with two adjustments:

1. UNKNOWN takes the median only as an ordering projection.
2. Confidence never discounts `DIRECT` evidence.

Evidence is in `spikes/planner-comparison-2026-10-12/g-p7-u-a/`:

- **Scenario set.** 27 scenarios and 46 checks, including mixed-source
  (DIRECT / INFERRED / wizard), confidence and soft-anchor cases.
- **Live-code characterization** (`runs/current_code.json`).
- **The provenance rule on the live vocabulary** (`runs/provenance.json`):
  19 cases, the owner's examples among them, all classified as the rule
  states.

Decision:
- The facet-provenance rule and the precedence above (`DIRECT` → `INFERRED`
  → soft anchor → semantic → quality → id). It is the only evaluated
  encoding that passes all 46 checks.
- `DIRECT` evidence is weighed by stated importance only. A wizard pick and
  a `DIRECT` free-text facet have the same authority. Confidence orders
  `INFERRED` evidence only.
- UNKNOWN semantic similarity or quality occupies the tier-median position
  of known peers, for ordering only; the assessment stays `UNKNOWN`. Zero, a
  lower tier, a fixed 0.5, skipping it for the whole tier, and a pairwise
  skip all fail; the pairwise skip is not even transitive.
- Dedupe by provenance class, then weight. The live max-weight dedupe lets
  a strong `INFERRED` duplicate displace the `DIRECT` statement.
- The structured planner boundary, with no scalar in A.
- Within one request, normalizing by requested weight never changes the
  order.

Rejected:
- a UI-channel tier, by the owner;
- Σ weight across provenance classes;
- LLM-asserted provenance;
- embedding similarity or stemming to certify `DIRECT`;
- confidence as a provenance or polarity proxy;
- confidence discounting `DIRECT` evidence;
- storing or reporting an imputed similarity for UNKNOWN.

Open gap: POLARITY-1 (task 25.6). Polarity must be established before
`DIRECT` facet evidence participates.

Implementation follows in tasks 25.2, 25.4 and 25.6.

A borrows no number from B.

**B. Preference-vs-travel / friction / uncertainty calibration** — how
much Tour-level cost a stronger preference match is worth.
2. Production coefficients — preference utility vs travel burden ("how
   much additional travel is a stronger preference match worth"), per-mode
   travel cost (WALK, DRIVE, BICYCLE from one recorded bicycle matrix per
   fixture city), mode friction, and the UNKNOWN-hours cost — from
   preference evidence: pairwise judgments of Tours for the same request
   (Tour A vs Tour B) on the recorded BA / Paris / LA fixtures, never from
   labels created to justify prior numbers. Semantic relevance and
   willingness to travel are calibrated separately.
3. Reuse the P-D7 spike machinery (recorded travel, SL1000, independent
   validation, best-known cross-evaluation) for stability, sensitivity and
   cross-city checks.

*Status B: RESOLVED (owner, 2026-10-15). P-D7 RESOLVED.* The analysis of
2026-10-14 is below; the owner decisions and the adopted policy follow it.
Evidence is in `spikes/planner-comparison-2026-10-12/g-p7-u-b/` (judgments,
regions, 732 OR-Tools runs at the proposed check point and 732 at the
adopted policy) and, for BICYCLE, in `g-p7-b/`.

Method:
- 32 pairwise Tour judgments, each stated before any parameter is examined.
  7 are DERIVED from accepted rules and 25 are PROPOSED, which needs owner
  confirmation.
- Each judgment becomes an inequality. Feasible regions come from grid
  enumeration; nothing is fitted to fixtures.

Findings that do not depend on the owner's answers:
- **Prize.** One cardinal prize per Experience is required. Routing has no
  lexicographic objective, and mixed-radix prizes would make one `DIRECT`
  match outweigh any number of others and any amount of travel. Tour
  satisfaction is the sum of the prizes.
- **Projection.** The smallest faithful projection builds the prize from
  A's stated quantities:
  `p = K · (D + β·I + γ·r) / max over the request`, where:
  - D = Σ `DIRECT` importance;
  - I = Σ `INFERRED` importance × confidence;
  - r = the within-request refinement position (anchor → semantic →
    quality).
- **Order-preserving repair.** Confidence is continuous, so the projection
  needs a deterministic step that raises prizes at near-ties. Equal-cost
  swaps then always follow A's order. Owner constraints (D4): the repair
  only preserves A's deterministic order at ties and near-ties created by
  the projection; it adds no preference signal, never overturns materially
  different satisfaction, is deterministic, and is explainable in the
  generation trace (each repaired prize records its pre-repair value and
  the A ordering it preserves).
- **Many lower vs one higher.** Whether several lower-ranked Experiences
  outweigh one higher-ranked one is a prize ratio, not a rule.
- **Mode friction is required.** Minutes alone cannot rank one long drive
  above two short drive legs. Friction is a per-leg product term; it is
  never added to a travel estimate.
- **UNKNOWN hours.** The cost is relative, ρ·f·p with 0 < ρ < 1, so it alone
  never erases an Experience.
- **Accepted semantics alone leave every coefficient effectively
  unbounded.** The DERIVED-only regions span 20× to 170×.

Under the 25 PROPOSED judgments (accepted by the owner on 2026-10-15 as the
initial judgment set):

| parameter | region |
|---|---|
| K, tme for the request's best Experience (1 walking minute = 1) | 61-144 |
| β | 0.10-0.30 |
| γ | 0.076-0.21 |
| A_DRIVE (c_DRIVE = 1) | 8.6-14.8 |
| ρ (at K = 100) | 0.054-0.27 |
| A_BICYCLE (c_BICYCLE ≤ 1.36) | 2.0-12.7 |
| A_BICYCLE if c_BICYCLE = 1 | 3.2-5.9 (narrow) |

The 2026-10-14 check point K 100 / β 0.2 / γ 0.12 / c_DRIVE 1 / A_DRIVE 11 /
c_BICYCLE 0.6 / A_BICYCLE 6 / ρ 0.15 satisfies all 32 judgments. Perturbing
each parameter ×0.75 / ×1.33 flips only P-O7 (semantic swap at +5 min, the
knife-edge judgment). In 732 runs across BA / Paris / LA and five mode
profiles there were:
- 0 hard-constraint violations and 0 forbidden-mode legs;
- identical repeats and SOLUTION_LIMIT stops on every run, with a 1.9 s
  median solve time;
- no city-specific value.

The SL1000 search gap against best-known plans (18/60 problems > 1 %, max
7.2 %, mostly start+end anchors) matches the recorded P-D5 finding and is
not a material worsening.

Owner decisions (2026-10-15), recorded in the spike README's decision
table:
- the 25 PROPOSED judgments are accepted as the initial, versioned
  product-policy judgment set (a baseline that may be revised, not a
  universal truth);
- D1: 1 DRIVE minute = 1 WALK minute (c_DRIVE = 1); DRIVE friction stays a
  separate per-leg term;
- D2: 1 BICYCLE minute = 1 WALK minute (c_BICYCLE = 1); BICYCLE friction
  stays a separate per-leg term;
- D3: when BICYCLE is allowed the PlanningRequest contains a resolved hard
  cycling limit, resolved by the input adapter (surface-neutral), a
  feasibility constraint and never an objective weight (P7); no universal
  numeric default is invented;
- D4: the order-preserving repair, with the constraints above.

**Adopted objective policy `preference-objective-v1`
(EVIDENCE_BACKED_INITIAL_POLICY, not a universal optimum):**

| term | value |
|---|---|
| K (tme for the request's best Experience) | 100 |
| β (INFERRED vs DIRECT) | 0.20 |
| γ (refinement) | 0.12 |
| c_WALK / A_WALK | 1 / 0 (the unit) |
| c_DRIVE / A_DRIVE | 1 / 11 |
| c_BICYCLE / A_BICYCLE | 1 / 4.5 |
| ρ (UNKNOWN hours) | 0.15 |

Validation at the adopted policy (`runs/judgments.json` → `adoptedPoint`,
`runs/tours_adopted.json`, `runs/tours_summary_adopted.json`,
`runs/crosseval_adopted.json`):
- all 32 judgments hold. The narrowest margin is B-O4 (bicycle 10 vs
  drive 5) at 0.098, then P-O7 at 0.18. A_BICYCLE 4.5 lies inside the
  c_BICYCLE = 1 region 3.2-5.9;
- one-at-a-time ×0.75 / ×1.33 perturbation flips P-O7 (K×0.75, γ×0.75)
  and B-O4 (A_DRIVE×0.75, c_BICYCLE×1.33). These are the narrow judgments
  the owner accepted with D2; any change is a new policy version;
- 732 OR-Tools runs: 732 PLANNED, 0 hard-constraint violations, 0
  forbidden-mode legs, identical repeats, every stop SOLUTION_LIMIT,
  median solve 1.9 s, max 5.1 s; the San Telmo composite is never
  scheduled without WALK;
- one policy across BA / Paris / LA: `DIRECT` share of scheduled
  Experiences 0.50-0.74; Paris uses no DRIVE leg in WALK+DRIVE+BICYCLE,
  LA uses 25 DRIVE and 11 BICYCLE legs;
- SL1000 gap against best-known plans: 17/60 problems > 1 %, max 6.9 %,
  mean 0.93 % — the recorded P-D5 pattern, not a material worsening;
- no cycling limit was applied in the runs (none is defined without a
  request). The longest planned single rides are 59 min (BA), 46 min (LA)
  and 11 min (Paris); under D3 a request's limit makes longer rides
  infeasible.

Bicycle sensitivity (calibration provenance, not a gate): B-O4 (a 10-min
bicycle leg preferred to a 5-min drive) is the tightest accepted judgment,
margin 0.098, so the bicycle terms of `preference-objective-v1`
(c_BICYCLE 1.0, A_BICYCLE 4.5) are sensitivity-bound by it. Any future
objective-policy version that changes bicycle cost or friction reruns B-O4,
the complete accepted judgment suite and the Tour / cross-evaluation
regression set before publication.

Recalibration: changing a coefficient, a judgment or the judgment set
requires rerunning the spike scripts and records a new objective policy
version (spec `tour-planning`, "Versioned planner objective").

P-D7 is fully resolved only when all are answered with evidence: what
represents preference satisfaction; how explicit facets participate; how
embeddings participate; how explicit evidence outranks semantic inference;
missing-embedding behaviour; whether quality stays secondary; the typed
signal reaching OR-Tools; preference vs travel; whether mode friction
exists and its value; UNKNOWN-hours pricing; allowed modes hard; one
baseline across destinations; coefficients from preference evidence.

#### P12. Optimizer selection and implementation

P-D5 is resolved: OR-Tools Routing (G-P5). It replaces the greedy solver
behind `DAILY_PLANNING_SOLVER`; no dual planner remains reachable after
cutover, and there is no per-request failover to another optimizer.

```text
DailyPlanningSolver (DAILY_PLANNING_SOLVER)   domain: feasible windows, utilities, diagnostics
  └─ PlanningOptimizer.plan(problem)            provider-neutral port, one bounded request
       └─ OR-Tools Routing sidecar adapter       transport, deadline, outcome mapping, validation
            └─ planner sidecar (Python)           RoutingModel, dimensions, search parameters
```

- The domain prepares the normalized problem; no RoutingModel, index
  manager, dimension or solver parameter crosses the port. Replacing the
  optimizer is a new adapter, not a Tour-domain change.
- Outcomes: PLANNED (validated against every hard constraint by the domain
  before use), INFEASIBLE (proven/explicit conflicts only) or
  OPTIMIZER_FAILED (typed reason; no Tour persisted).
- Stop policy `routing-gls-sl1000-v1`: count-based; the wall-clock cap is a
  safety guard and a capped plan is recorded as non-reproducible.
- Identity recorded in the planning context: `optimizer =
  OR_TOOLS_ROUTING`, `optimizerVersion` (pinned), `optimizerPolicyVersion`,
  adapter/formulation version.
- Topology: sidecar container in the backend deployment unit (same host,
  release and rollback, private network, health-gated, restart policy); no
  independent planner service. The host provides sustained CPU for planning.

#### P13. Planning acceptance

Tests (unit + production-equivalent, recorded providers) must prove: a
known-closed POI is never scheduled; no visit extends past a known closing
time; split windows are respected; last admission is respected; travel time
participates in feasibility; walking is not always selected merely because
it is allowed; non-walking routing makes geographically separated
candidates feasible; visit duration participates in scheduling; N-day
assignment is optimized across days rather than greedily filling one day;
planner limitations produce PLANNER_LIMITED, not INSUFFICIENT_KNOWLEDGE;
zero scheduled with sufficient supply produces PLANNER_INFEASIBLE; eligible
unscheduled candidates carry typed reasons; admission is unaffected by
planner rejection; UNKNOWN hours follow the configured policy and stay
visible; routing behaviour per P6 (provider-backed estimate used; one mode
unavailable with another usable mode; provider unavailable for a required
leg → TRAVEL_ESTIMATE_UNAVAILABLE; no Tour when required travel feasibility
cannot be established; routing failure never triggers acquisition or
INSUFFICIENT_KNOWLEDGE); zero LLM/web
research in ordinary planning; identical inputs and recordings give
identical output.

### C5. Parent sites and visit units (R4-D2 RESOLVED)

A structured PART_OF / containment relationship alone does not decide
whether a child place has its own schedulable Experience. The decision is
about the real
visit unit, not geometry. Every established parent relationship is
classified as one of two visit-unit relationships:

- **CHILD_REQUIRES_PARENT_VISIT** — visiting the child naturally requires
  entering, visiting or traversing the parent site (a tomb in a cemetery, an
  artwork or room in a museum, a monument consumed as part of a larger
  attraction, an internal feature whose access and visitor context come from
  the parent).
- **CHILD_INDEPENDENTLY_VISITABLE** — the child is naturally visited as its
  own destination although it lies inside or belongs to a larger site (a
  major venue inside a park, an independently accessed museum inside a
  complex, a site with its own entrance, hours, identity and visitor
  purpose).

**Establishing a parent relationship (structured only).** (1) An explicit
provider relationship — OSM site-relation or relation/way membership,
Wikidata "part of" (P361) or an equivalent property — pointing at a parent
that is a canonical place-site candidate; or (2) geometric containment of
the child inside the parent's provider area geometry **and** a (child class,
parent class) relationship class declared in the canonical policy (C7).
Relationships to areas, districts, routes, collections, heritage ensembles
or designations are not parent-site relationships (a landmark "part of" a
historic district or World Heritage listing keeps its ordinary admission).
Containment without an explicit relationship or a declared class
establishes no relationship (diagnostic CONTAINMENT_WITHOUT_RELATIONSHIP;
the child is evaluated as any other place). Proximity alone, name
similarity, embeddings, LLM output and web research never establish or
classify a relationship.

**Direct visit parent only (scope bound).** Visit-unit classification and
composition use only the child's *direct* visit parent: the plausible
place-site candidate that is its immediate visit context (tomb → cemetery,
artwork → museum, internal feature → directly visitable site). Neither
admission, composition nor the planner traverses parent hierarchies
recursively (child → parent → grandparent → complex → district → city).
Deeper PART_OF or containment relationships exposed by providers may be
preserved as canonical knowledge, but they create no admission gate, no
ambiguity and no planner effect. A consequence, accepted for this cutover:
when the direct parent is itself not its own visit unit (e.g. artwork →
room → museum, where the room requires the museum visit), the child is
PARENT_NOT_ADMITTED and is not offered; nested visit-unit composition is out
of scope for Revision 4 and would be designed separately.

**Classifying the visit unit (structured only).** The canonical policy
declares generic (child class, parent class) relationship classes with a
default visit unit (e.g. grave/tomb → cemetery: REQUIRES_PARENT_VISIT;
artwork/exhibit → museum: REQUIRES_PARENT_VISIT; museum/theatre/venue →
park or complex: INDEPENDENTLY_VISITABLE). Per-instance structured evidence
refines it: separate entrance/access, separate opening hours, separate
provider identity with an independently visitable class, or explicit
provider evidence of an independent venue support INDEPENDENTLY_VISITABLE;
a name or coordinates alone never do. When the policy default and
per-instance evidence agree, or only one of them exists and is sufficient,
the class is decided; when they contradict, or neither suffices, the
outcome is **AMBIGUOUS_PARENT_RELATIONSHIP**. Ambiguity about *which* parent
applies arises only among several plausible direct visit parents; a valid
direct visit parent that itself belongs to a larger site or area never
makes the child ambiguous (tomb → cemetery → historic district: the visit
parent is the cemetery; the district plays no part).

**Outcomes.**

| Visit unit | Parent state | Child outcome | Offered to planner |
|---|---|---|---|
| REQUIRES_PARENT_VISIT | admitted | SUB_FEATURE_OF(parent) — sub-feature knowledge of the parent, derived from PART_OF | no (the parent's Experience is the schedulable unit) |
| REQUIRES_PARENT_VISIT | not admitted / not in catalog | PARENT_NOT_ADMITTED (CONTEXT_REQUIRED) | no, until a valid visit context exists |
| INDEPENDENTLY_VISITABLE | any | normal structured admission (C6); PART_OF kept | yes, if admitted |
| AMBIGUOUS_PARENT_RELATIONSHIP | any | AMBIGUOUS_PARENT_RELATIONSHIP; neither collapsed into the parent nor promoted | no |

- The child always stays a canonical entity with its PART_OF relation and
  evidence; grouping never destroys child identity.
- Admission independence: an admitted child never admits its parent; an
  admitted parent never admits every child; a non-admitted parent never
  turns a context-dependent child into an independent visit; the planner
  never decides admission.
- **Parent Experience composition:** the parent's Experience stays the
  schedulable unit; REQUIRES_PARENT_VISIT children stay canonical
  GeoEntities whose PART_OF relationship exposes them as reusable
  sub-feature knowledge of the parent context (highlights, later in-site
  order/route, narratives, preferences, specialized sub-itineraries),
  derived from the relationship rather than copied into the Experience. A
  child becomes an ExperienceComponent only when it actually participates
  in that Experience's composition. Highlights/enrichment are never
  required for the parent's admission. When a parent becomes admitted
  later, PARENT_NOT_ADMITTED children are re-evaluated to SUB_FEATURE_OF;
  the parent's Experience identity is unchanged.
- No named place appears in policy or tests' policy expectations
  (no Recoleta, tomb, museum, park or destination names).
- The pattern prevents itineraries such as "MALBA → an individual tomb"
  without the cemetery visit itself.

### C6. Structured visitability/notability admission (decision R4-D3)

Ordinary GeoEntity admission does not depend on an exhaustive allowlist of
base POI categories. A provider's primary category says what a place *is*;
it does not by itself decide whether the place is worth offering as an
independent single-place Experience. A pharmacy, bookstore, station, bridge, market,
theatre, garden, stadium or cemetery may or may not be independently
notable; the structured evidence decides, never a one-by-one exception.

The admission question is: *is there sufficient structured evidence that
this canonical place should be offered as an independent single-place
Experience
candidate?* — not *is its base category in a tourism whitelist?*

**Canonical admission signals** (provider-neutral, typed, produced by
provider adapters, recorded with each admission):

| Signal | Strength | Typical provider sources |
|---|---|---|
| EXPLICIT_VISITOR_CLASSIFICATION — the provider classifies the place in its own attraction / sight / cultural-visit taxonomy | decisive | OSM `tourism=*` (except values the adapter maps to an exclusion class), other providers' attraction/culture branches, Wikidata class under a visitor-attraction root |
| HISTORIC_CLASSIFICATION — the provider classifies the place as a historic feature | decisive | OSM `historic=*`, Wikidata class under a historic-site root |
| HERITAGE_DESIGNATION — an official heritage designation | decisive | Wikidata P1435, OSM `heritage=*` |
| VISITABLE_PLACE_CLASS — the base or secondary category describes a place the public typically visits (open space, worship, venue, market, cemetery, ...) | supporting | provider category / alternate taxonomy |
| ENCYCLOPEDIC_NOTABILITY — a linked encyclopedic item with its own articles | supporting | Wikidata item linked by strong identity, with sitelinks |
| PROVIDER_PROMINENCE — a provider importance / rank / popularity value | supporting | providers that expose one (OSM does not) |

Decisive and supporting are policy strengths, not scores; no weighted sum
and no tuned cutoff exist.

**Admission rule** (`admission` policy, versioned), applied after identity,
name, coordinates and destination containment:

1. A non-overridable exclusion (below) rejects.
2. At least one **decisive** signal admits — including over an overridable
   exclusion (a heritage-designated station, a historic pharmacy).
3. Otherwise a **VISITABLE_PLACE_CLASS** plus at least one independent
   notability signal (ENCYCLOPEDIC_NOTABILITY or PROVIDER_PROMINENCE) admits,
   unless an overridable exclusion applies.
4. Otherwise the place is rejected with INSUFFICIENT_ADMISSION_EVIDENCE.

VISITABLE_PLACE_CLASS is supporting evidence only. Its mapping is not
required to be exhaustive and absence from it is never a rejection reason by
itself: a place of any base category qualifies through a decisive signal.
This is what prevents the policy from turning into another whitelist under
a different name. Categories still serve as positive evidence, exclusion
evidence, identity-compatibility evidence, parent/sub-feature evidence,
ranking features and provider-query selectors.

**Generic exclusions** (small, provider-neutral, structural):

| Exclusion class | Overridable by a decisive signal |
|---|---|
| ADMINISTRATIVE_OR_LOCALITY (settlements, administrative areas, postal units) | no — not a PLACE |
| ROAD_OR_ROUTE as a place | no — ROUTE identity; it may only be TRAVERSEd inside an Experience |
| INFORMATION_OR_SIGNAGE (information boards, signs, guideposts) | no |
| SUB_FEATURE grouped under an admitted parent (C5) | no — represented by the parent |
| TRANSPORT_SERVICE (stops, platforms, ordinary stations) | yes |
| TECHNICAL_INFRASTRUCTURE (utilities, technical facilities) | yes |
| ACCOMMODATION (outside the ordinary visit experience) | yes |

A usually non-touristic base category never rejects a place by itself; only
an exclusion class does, and the overridable ones yield to decisive
evidence. Expected outcomes, with no named place in policy:

- ordinary pharmacy, no other signal → INSUFFICIENT_ADMISSION_EVIDENCE;
  pharmacy with heritage or historic classification → admitted;
- ordinary transit stop → EXCLUDED_CATEGORY (TRANSPORT_SERVICE); historic or
  heritage-designated station → admitted;
- individual tomb with a structured parent cemetery → SUB_FEATURE_OF (C5);
- named cemetery or stadium with an encyclopedic item, or with a visitor /
  historic classification or heritage designation → admitted (as a parent
  site where C5 applies);
- ordinary neighbourhood stadium or garden with no notability signal → not
  admitted.

Spike 3's accepted Tour is preserved: every one of its 16 stops carries
EXPLICIT_VISITOR_CLASSIFICATION (`tourism=attraction|museum`). Places that
spike 3 admitted only by a visitable class (for example small parks without
any notability signal) may no longer be admitted; this is measured by task
29.2, not tuned.

**Wikidata boundary.** Wikidata classes (P31/P279 under a small set of root
classes held by the Wikidata adapter), heritage designation (P1435) and
sitelinks are authoritative structured facts about an identity-linked
entity. They participate in admission as structured signals, produce no L2
assertion, involve no research, LLM or web call, and never establish
thematic relevance (owner decision P1 still governs that). Tourism
assertions, web research and grounded LLM enrichment remain optional
downstream enrichment or specialized semantic Experience decisions.

### C7. Single source of truth for admission policy

- One canonical, versioned **structured admission policy** in the backend
  domain defines: the canonical admission signal types and their strengths,
  the admission rule, the generic exclusion classes and which are
  overridable, the parent/child relationship rules and the declared generic
  (child class, parent class) relationship classes with their default visit
  unit (C5), and the provider-neutral classes/signals ranking may read.
- **Provider adapters translate** provider tags and taxonomies into canonical
  signals, exclusion classes and canonical place classes (the OSM mapping
  lives with the OSM adapter; the Wikidata root classes with the Wikidata
  adapter). The domain never reads provider tags.
- **Discovery selectors are acquisition strategy, not admission truth.**
  Provider queries (e.g. Overpass selectors) are documented as provider
  acquisition strategy, derived from the adapter's signal mapping so they
  retrieve every record that can carry a decisive or supporting signal —
  including records whose base category is normally non-touristic but that
  carry `heritage`, `historic`, `tourism` or an encyclopedic link — and are
  never consulted by admission. Bounding a query for operational reasons is
  recorded as a strategy limitation (PROVIDER_COVERAGE), not as a
  rejection. A complementary STRUCTURED_ENTITY_FACTS strategy may discover
  identity-linked Wikidata items inside the destination that carry decisive
  signals.
- Hand-maintained selector literals such as `NON_EXPERIENCE_TOURISM_VALUES`
  are replaced by the adapter mapping. Discovery, admission, sub-feature
  grouping, ranking and the planner runtime consume the policy; spikes and
  tests import or export it, never copy it. An architecture test fails if a
  second exclusion list, admission whitelist or tag-selector literal exists
  outside the policy and the adapter mappings.

### C8. Structured identity reconciliation

Strengthens the canonical identity primitive (the structured discovery
dedupe and `IdentityVerifier`); no parallel implementation.

- **Strong evidence (may merge alone):** identical provider-native id; one
  shared Wikidata QID with no conflicting QID on either side; an OSM
  structural relationship (node is a member/label of the relation or way that
  is the other record); an explicit provider cross-link to the other record's
  id.
- **Supporting evidence (never merges alone):** exact equality of
  canonically normalized primary names or aliases (equality, not
  similarity); geometry correspondence (point inside the other's area
  geometry, or on the other's linear geometry within the provider geometry's
  versioned snapping tolerance); compatible canonical classes.
- **Merge rule:** strong evidence and no conflicting strong evidence; or the
  structural-correspondence rule — exact normalized name equality **and**
  geometry correspondence **and** compatible classes **and** exactly one
  such match inside the containing geometry **and** no conflicting QIDs or
  provider ids. Anything else stays separate.
- **Fail closed:** ambiguity (several matches, conflicting QIDs) never
  merges. Embeddings never establish identity.
- **Deterministic survivor:** way/relation over node, then provider id
  order; survivor fields are canonicalized from all merged records so the
  result is order-independent.
- **Diagnostics:** every merge records kept id, merged ids, rule and evidence
  items; every unmerged pair that shares a normalized name within
  corresponding geometry records POSSIBLE_DUPLICATE with the reason it stayed
  separate (NO_STRONG_EVIDENCE, CONFLICTING_QID, AMBIGUOUS_MATCH,
  NAME_ONLY, GEOMETRY_ONLY).

### C9. Failure classification

Generation diagnostics classify every shortfall as one of
CANDIDATE_SUPPLY (structured strategies remain), PROVIDER_COVERAGE
(authorized structured strategies exhausted), ADMISSION_POLICY, IDENTITY,
RANKING, PLANNER_FEASIBILITY or SEMANTIC_KNOWLEDGE, from typed evidence
(provider outcomes, admission rejections, merge diagnostics, ranking inputs,
planner rejections, gap outcomes). Only CANDIDATE_SUPPLY routes to
structured acquisition; only SEMANTIC_KNOWLEDGE may route to research, and
only for a product that declares a semantic dependency. Planner, ranking,
identity and admission-policy shortfalls route to no acquisition.

### C10. Ranking and providers (recorded, not cutover work)

- Spike 3 ranking (`ranking-spike3-1`) is sufficient as the baseline.
  Recorded issues: Mercado de San Telmo ranked low (marketplace weight 3);
  Casa Rosada and Cabildo carry weak `tourism=yes`; duplicates affected
  ordering (C8 fixes the identity part); OSM offers no importance signal. No
  L2 research is added for ranking. Ranking work waits until C2-C8 land;
  richer structured signals and optional enrichment may follow, non-blocking.
- No Geoapify, Overture, Google Places or other POI provider is added by
  the cutover. The provider-class abstraction stays; providers are activated
  by measured destination coverage. Provider insufficiency stays
  distinguishable from admission, ranking, planner and semantic failures
  (C9).

### C11. Deferred to optional enrichment

Not cutover blockers and not on the single-place Experience critical path: narratives
(e.g. El Hipopótamo, Club Español, Confitería El Molino), stronger type
context for weakly tagged places (Casa Rosada, Cabildo), neighbourhood-level
presentation (San Telmo, Monserrat), corridor experiences (Avenida de Mayo /
Defensa / Bolívar), highlights of grouped sub-features (tombs under a
cemetery), evidence-backed visit durations (optional lazy VISIT_DURATION
enrichment, P4; until resolved the explicit FALLBACK_POLICY applies),
historical context, thematic relevance, visitor tips,
meaningful relationships and tourism-corridor meaning. Groq / native
grounded search, narrative generation and LLM enrichment are not implemented
by this change.

### C12. Production cutover order

Planning track (amendment 2026-10-11, replaces the former single
"transit-aware travel estimation" step):

1. Formal planning input/output contract (P2).
2. Opening-hours model and UNKNOWN policy (P3).
3. Visit-duration knowledge model, boundary and fallback plumbing (P4);
   the evidence-backed resolver lands with wiring (step 16).
4. Routing/directions provider contract and routing-unavailable behaviour
   (P5, P6).
5. Typed planner rejection diagnostics (P10).
6. Readiness integration: limiting-resource semantics and capacity-gap
   behavior over the typed diagnostics (C2, C3).
7. Planner algorithm-comparison spike (P11).
8. Optimizer selection from spike evidence (P12, P-D5).
9. Selected optimizer implementation (P7-P9, P12).
10. Planner production-equivalent regression tests (P13).

Admission/identity track (independent of 1-10; may proceed in parallel on
its own sub-branch per governance):

11. Parent-site / sub-feature handling (C5).
12. Structured visitability/notability admission (C6).
13. Canonical admission-policy source of truth and adapter signal mappings
    (C7).
14. Structured identity reconciliation (C8).

Wiring and cutover (requires both tracks):

15. Production structured-POI acquisition/admission integration.
16. Production single-place Experience composition (durations and opening-hours
    knowledge with provenance).
17. Production readiness/optimizer integration.
18. Regression and cutover validation (C13, P13).
19. Retirement of the old acquisition path and the greedy planner, only
    after 18 passes in production-equivalent tests.

Steps 1-6 and 11-14 are contracts/policies/primitives unit-tested before
wiring; 7-8 are evidence and decision; 15-17 wire; nothing old is deleted
before 18. Step 13 lands before 12's production use if the dependency
requires it.

### C13. Production cutover acceptance

A cold ordinary destination request (production-equivalent integration test
against the test database and recorded providers) must:

1. discover structured POIs;
2. canonicalize them;
3. deduplicate with auditable structured evidence (C8 diagnostics);
4. apply structured admission with typed outcomes;
5. compose single-place Experiences without L2;
6. reuse the catalog on a repeated request with zero POI rediscovery;
7. distinguish candidate shortage from planner limitations (C2);
8. plan across realistic distances using non-walking travel when allowed and
   appropriate, with provider-routed estimates only and explicit failure
   when routing is unavailable (P5, P6, P9);
9. produce a non-empty multi-day Tour when sufficient eligible candidates
   exist;
10. avoid rediscovery when the catalog is sufficient;
11. run with zero web/LLM research calls on the ordinary happy path.

Required tests:

- failed enrichment cannot revoke a GeoEntity's admission or archive its
  single-place Experience;
- planner limitations cannot become INSUFFICIENT_KNOWLEDGE;
- SCHEDULE_CAPACITY does not trigger acquisition when unused eligible supply
  is sufficient;
- children that require a parent visit do not flood the planner, are
  never offered when the parent is not admitted, and independently
  visitable children inside a parent remain schedulable (C5);
- the structured admission policy has one production source of truth and
  admission never consults a category whitelist or discovery selector
  (architecture test);
- a normally non-touristic base category with a decisive structured signal
  is admitted, and without one is not;
- identity reconciliation is deterministic (order-independent) and auditable
  (merge and POSSIBLE_DUPLICATE diagnostics);
- every planning acceptance test in P13.

### C14. Persistence mapping onto the V2 models (R4-D1 RESOLVED)

Inspected (current worktree): `be/prisma/schema.prisma` (`GeoEntity`,
`GeoEntityIdentity`, `GeoEntityVerifiedHintAssertion`, `Experience`,
`ExperienceComponent`, `ExperienceEvidence`, `Tour`, `TourExperience`,
`TourExperienceComponent`, Overture index models), the V2 migrations
(`20260901*_experience_domain_v2`, `20260904101500_add_experience_opening_hours`,
`20260907022156_add_tour_experience_travel_from_previous`,
`20261008120000_experience_source_members_and_hint_assertions` with its
CHECK constraints), `experience-catalog.service.ts` (`upsertGeoEntity*` under
per-kind advisory locks, Experience persistence),
`planning-candidate-normalizer.service.ts` (reads `Experience.openingHours`
and falls back to `metadata.openingHours`), `tour-experience-snapshot.util.ts`
(copies `GeoEntity.geometry` into each component snapshot),
`daily-planning.interface.ts` (`TravelEstimate` stored as
`travelFromPrevious`), and the `role` consumers (`spatial-footprint.util.ts`,
`experience-geographic-scope.policy.ts`, `area-`/`route-scope-membership-policy.ts`,
`component-resolution-facts.util.ts`; persisted values `venue`, `waypoint`,
`route`, `area`).

**Principles applied.** GeoEntity stays the only physical identity,
Experience the only schedulable identity, ExperienceComponent the
composition relation, Tour/TourExperience the snapshot. Facts live with the
entity they describe. No history tables: no accepted requirement needs old
versions of an evaluation; every fact is updated in place with its policy /
resolver version, timestamp and provenance (Tour snapshots already preserve
what a traveller received). New 1:1 knowledge tables use the GeoEntity id as
primary key, so they cannot become a second identity.

#### Mapping

| Concept | Current model | Reused | Extension | Why minimal |
|---|---|---|---|---|
| GeoEntity identity | `GeoEntity` | all fields | none | already canonical physical identity |
| Provider identities | `GeoEntityIdentity` (provider, externalId, unique) | all | link evidence fields (below) | merges are identity attachments |
| Admission evaluation + signals | none | GeoEntity id | `GeoEntityAdmission` 1:1 | distinct writer, PLACE-only, re-evaluated by policy version (challenge below) |
| PART_OF + visit-unit classification | none | GeoEntity ids | `GeoEntityRelation` N:M | genuinely new N:M relationship |
| SUB_FEATURE_OF / PARENT_NOT_ADMITTED | none | relation + parent admission | **not stored** — derived at read | avoids a second, stale copy of two stored facts |
| Physical opening hours | `Experience.openingHours` Json (wrong owner) | — | `GeoEntityOpeningHours` 1:1 | owner is the GeoEntity; distinct provider freshness |
| Visit-duration knowledge | `Experience.durationMinutes` Int (wrong owner, no provenance) | — | `GeoEntityVisitDuration` 1:1 | P-D2 fields, distinct resolver writer and lazy-resolution queries |
| Fallback duration | none | — | **not stored** — applied at projection by the P-D2-F policy | fallback is policy, never knowledge, so it is always replaceable |
| Experience | `Experience` | identity, `status` (ARCHIVED on lost justification), `canonicalName`, `qualityScore`, embedding, media, traits | `compositionSignature String? @unique` | DB-enforced idempotency (below) |
| Experience duration / hours | `durationMinutes`, `openingHours` | kept for legacy Experiences only | none; not written by structured composition, not authoritative | effective values derive from components |
| Membership / order / required | `ExperienceComponent.experienceId`, `geoEntityId`, `order`, `required` | all | none | already present |
| Typed participation | `role String?` (mixed concerns) | `role` kept for legacy consumers | `participation ExperienceComponentParticipation?` | typed target without breaking consumers |
| Bounded ROUTE traversal | none | `required`, `geoEntityId` (the ROUTE) | traversal columns on `ExperienceComponent` | 0..1 per component, same lifecycle, row-level CHECKs |
| Experience evidence | `ExperienceEvidence` | unchanged for source-extracted Experiences | none | structured Experiences are justified through their components' GeoEntity knowledge |
| Tour readiness verdict | none (`Tour.metadata` Json) | — | `Tour.readinessVerdict TourReadinessVerdict?` | queried/consumed directly (R4-D4) |
| Tour planner context | `Tour.startDates`, `totalDays`, `metadata` | `startDates`, `totalDays` | `Tour.timezone String?`, `Tour.planningContext Json?` | timezone interprets every stored time; versions are explanatory snapshot |
| Planner diagnostics | none | — | `Tour.planningDiagnostics Json?` | explanation snapshot, never decision input |
| TourExperience scheduling | `dayNumber`, `order`, `startTime`, `duration` (hours, derived from planned minutes) | all | `endTime DateTime?` | exact end without float arithmetic |
| Travel leg | `TourExperience.travelFromPrevious Json` (`TravelEstimate`) | the column | none in schema; its typed TS contract grows (P2 leg fields) | already the leg snapshot |
| Internal composite snapshot | `TourExperienceComponent` (`order`, `role`, `required`, `name`, coords, `geometry`) | all | `participation?`, `plannedStart?`, `plannedEnd?`, `planningEvidence Json?`; `geometry` holds the bounded segment for TRAVERSE | per-component times/windows are the internal timeline |
| Merge diagnostics | `GeoEntityIdentity` rows | rows = merged identities, GeoEntity = survivor | `linkRule?`, `linkPolicyVersion?`, `linkEvidence Json?` | the merge decision is the identity attachment |
| Possible duplicates | none | — | **not persisted**; reconciliation/generation trace only | creates no canonical fact; reproducible from recorded provider inputs |
| L2 assertions, L3 ledger, evidence memory, enrichment demand/attempts | none | — | one planning-evidence persistence model (C14 "Planning-evidence persistence", RESOLVED 2026-10-15); tables written in task 41.0 | enrichment/semantic storage; not on the ordinary single-place path |

#### Proposed Prisma shape (pseudo-Prisma; schema is edited only by `/opsx:apply`)

```prisma
enum AdmissionOutcome { ADMITTED  EXCLUDED_CATEGORY  INSUFFICIENT_ADMISSION_EVIDENCE }
enum AdmissionSignal {            // canonical, provider-neutral (C6/C7)
  EXPLICIT_VISITOR_CLASSIFICATION HISTORIC_CLASSIFICATION HERITAGE_DESIGNATION
  VISITABLE_PLACE_CLASS ENCYCLOPEDIC_NOTABILITY PROVIDER_PROMINENCE
}
enum AdmissionExclusion {
  ADMINISTRATIVE_OR_LOCALITY ROAD_OR_ROUTE_AS_PLACE INFORMATION_OR_SIGNAGE
  TRANSPORT_SERVICE TECHNICAL_INFRASTRUCTURE ACCOMMODATION
}

model GeoEntityAdmission {                       // 0..1 per GeoEntity (PLACE)
  geoEntityId     String   @id
  outcome         AdmissionOutcome
  rule            String                          // admission rule id that decided
  signals         AdmissionSignal[]   @default([])
  exclusions      AdmissionExclusion[] @default([])
  policyVersion   String
  evidence        Json                            // per-signal provenance: provider, externalId, field, value
  evaluatedAt     DateTime
  geoEntity       GeoEntity @relation(fields: [geoEntityId], references: [id], onDelete: Cascade)
  @@index([outcome, policyVersion])
  @@map("geo_entity_admission")
}

enum GeoEntityRelationType { PART_OF }
enum RelationEvidenceSource { PROVIDER_SITE_MEMBERSHIP  ENCYCLOPEDIC_PART_OF  DECLARED_CONTAINMENT }
enum VisitUnitClassification { CHILD_REQUIRES_PARENT_VISIT  CHILD_INDEPENDENTLY_VISITABLE  AMBIGUOUS_PARENT_RELATIONSHIP }

model GeoEntityRelation {                        // N:M between GeoEntities
  id                     String   @id @default(uuid())
  childId                String
  parentId               String
  type                   GeoEntityRelationType
  evidenceSource         RelationEvidenceSource
  evidence               Json                     // provider record refs / relation class
  /// Set only on a direct visit-parent relationship (R4-D2); null for
  /// deeper or non-visit relationships kept as knowledge only.
  visitUnitClassification VisitUnitClassification?
  classificationVersion  String?
  evaluatedAt            DateTime
  child                  GeoEntity @relation("RelationChild",  fields: [childId],  references: [id], onDelete: Cascade)
  parent                 GeoEntity @relation("RelationParent", fields: [parentId], references: [id], onDelete: Cascade)
  @@unique([childId, parentId, type])
  @@index([parentId, type])
  @@index([childId, visitUnitClassification])
  @@map("geo_entity_relation")
}
// SQL CHECKs: childId <> parentId; (visitUnitClassification IS NULL) = (classificationVersion IS NULL)

enum OpeningHoursStatus { KNOWN  UNKNOWN }

model GeoEntityOpeningHours {                    // 0..1 per GeoEntity
  geoEntityId     String   @id
  status          OpeningHoursStatus
  timezone        String?                         // IANA; required when KNOWN
  /// Versioned typed document: weekly windows (multiple per day, optional
  /// lastAdmission), date exceptions (closed / special windows); validated
  /// at the adapter/repository boundary; null when UNKNOWN.
  schedule        Json?
  scheduleVersion Int?
  source          String                          // provider id
  sourceRecordRef String?                         // provider record / field
  sourceRaw       String?                         // e.g. raw OSM opening_hours
  parserVersion   String?
  retrievedAt     DateTime
  geoEntity       GeoEntity @relation(fields: [geoEntityId], references: [id], onDelete: Cascade)
  @@index([retrievedAt])
  @@map("geo_entity_opening_hours")
}
// SQL CHECK: status = 'KNOWN' => schedule, scheduleVersion, timezone NOT NULL

enum VisitDurationStatus { RESOLVED  CONFLICTING  INSUFFICIENT_EVIDENCE }
enum DurationAuthorityClass {
  STRUCTURED_PROVIDER OFFICIAL_SITE OFFICIAL_TOURISM_OR_INSTITUTIONAL
  REFERENCE_TRAVEL USER_GENERATED GROUNDED_SYNTHESIS
}

model GeoEntityVisitDuration {                   // 0..1 per GeoEntity (PLACE)
  geoEntityId       String   @id
  status            VisitDurationStatus
  minMinutes        Int?
  typicalMinutes    Int?
  maxMinutes        Int?
  authorityClass    DurationAuthorityClass?
  evidenceQuality   String?                       // versioned grounding scale
  evidence          Json                          // items: source, class, locator, statement, retrievedAt
  resolverVersion   String
  resolvedAt        DateTime
  geoEntity         GeoEntity @relation(fields: [geoEntityId], references: [id], onDelete: Cascade)
  @@index([status, resolvedAt])
  @@map("geo_entity_visit_duration")
}
// SQL CHECKs: min <= typical <= max where present; RESOLVED => typical OR (min AND max);
// INSUFFICIENT_EVIDENCE => no minute values. FALLBACK is never stored.

model Experience {                               // additions only
  /// Versioned hash of the ordered constitutive components (GeoEntity id,
  /// participation, traversal bounds) [+ facet key]; null for
  /// source-extracted/legacy Experiences.
  compositionSignature String? @unique
}

enum ExperienceComponentParticipation { VISIT  TRAVERSE }

model ExperienceComponent {                      // additions only
  participation              ExperienceComponentParticipation?
  traversalFromGeoEntityId   String?             // anchor when naturally available
  traversalToGeoEntityId     String?
  traversalFromLatitude      Float?
  traversalFromLongitude     Float?
  traversalToLatitude        Float?
  traversalToLongitude       Float?
  traversalDirected          Boolean?
  traversalGeometry          Json?               // GeoJSON LineString of the bounded segment
  traversalGeometrySource    String?             // provider + route geometry version
  traversalResolvedAt        DateTime?
  traversalFrom  GeoEntity? @relation("TraversalFrom", fields: [traversalFromGeoEntityId], references: [id], onDelete: Restrict)
  traversalTo    GeoEntity? @relation("TraversalTo",   fields: [traversalToGeoEntityId],   references: [id], onDelete: Restrict)
}
// SQL CHECKs: any traversal* set => participation = 'TRAVERSE'; from/to coordinates,
// traversalGeometry and traversalGeometrySource set together. "Referenced GeoEntity is a
// ROUTE" is enforced by the composer/repository (cross-table).

model GeoEntityIdentity {                        // additions only (merge evidence)
  linkRule          IdentityLinkRule?            // null on legacy rows
  linkPolicyVersion String?
  linkEvidence      Json?
}
enum IdentityLinkRule {
  FIRST_IDENTITY SAME_PROVIDER_ID SHARED_ENCYCLOPEDIC_ID
  PROVIDER_STRUCTURAL_RELATION PROVIDER_CROSS_LINK STRUCTURAL_CORRESPONDENCE
}

enum TourReadinessVerdict { READY  PLANNER_LIMITED }

model Tour {                                     // additions only
  readinessVerdict    TourReadinessVerdict?       // null on legacy tours
  timezone            String?                     // IANA destination timezone
  planningContext     Json?   // planner/optimizer + policy versions, routing providers, constraint snapshot
  planningDiagnostics Json?   // typed feasibility diagnostic snapshot (R4-D4 content)
}

model TourExperience {                           // additions only
  endTime DateTime?
}

model TourExperienceComponent {                  // additions only
  participation    ExperienceComponentParticipation?
  plannedStart     DateTime?
  plannedEnd       DateTime?
  planningEvidence Json?   // duration used + provenance, opening window used + provenance, internal leg
}
```

Only destination-independent outcomes are stored on `GeoEntityAdmission`
(ADMITTED, EXCLUDED_CATEGORY with its `exclusions`,
INSUFFICIENT_ADMISSION_EVIDENCE). The other typed rejections of the
admission spec are not GeoEntity facts: NO_NAME, NO_COORDINATES,
NO_CANONICAL_IDENTITY and DUPLICATE_OF happen before or instead of a
GeoEntity existing (trace only; DUPLICATE_OF is the identity attachment),
and OUTSIDE_DESTINATION is relative to the request's destination and is
evaluated at scope-query time, never stored. Children that are not their own
visit unit are expressed by `GeoEntityRelation`, not by an exclusion value.

NEEDS_ACQUISITION, INSUFFICIENT_KNOWLEDGE, PLANNER_INFEASIBLE,
OPTIMIZER_FAILED and TRAVEL_ESTIMATION_UNAVAILABLE produce no Tour; they live only in the
generation result/trace and are not Tour states.

#### Json boundaries

Json is used only where the content is a representation or explanation,
never as a hidden decision protocol: opening-hours `schedule` (a typed,
versioned document validated at the boundary; the planner consumes the
typed form, and no SQL query needs window-level filtering), traversal
geometry (GeoJSON, consistent with `GeoEntity.geometry`), evidence /
provenance items, Tour `planningContext` / `planningDiagnostics`,
component `planningEvidence` and the existing `travelFromPrevious`.
Every decision-bearing value (admission outcome/signals/exclusions,
visit-unit classification, opening-hours status, duration minutes/status,
participation, traversal bounds/coordinates, readiness verdict) is a typed
column or enum. The normalizer's `metadata.openingHours` fallback is a
hidden-metadata read and is removed when the projection moves to GeoEntity
hours (group 40).

#### New-table challenge

| Table | Why not on an existing model | Independent lifecycle | Queried independently | Correctness gain | Typed optional child instead? |
|---|---|---|---|---|---|
| `GeoEntityAdmission` | 8 PLACE-only columns on every GeoEntity; written by the admission authority, not identity resolution | re-evaluated on policy/evidence change without touching identity | yes: eligible-pool selection by outcome, re-evaluation by `policyVersion` | single-writer ownership; enum arrays and CHECKs scoped to evaluated rows | it *is* the typed optional 1:1 child (PK = FK) |
| `GeoEntityRelation` | N:M between two GeoEntities cannot be a column | yes | yes: children of a parent (highlights), a child's visit parent | yes: FK both ends, uniqueness, no Json-hidden graph | no — cardinality is N:M |
| `GeoEntityOpeningHours` | owner is GeoEntity; `Experience.openingHours` is the wrong owner; ~9 columns only for places with hours | provider refresh cadence independent of identity | yes: staleness refresh by `retrievedAt` | status/timezone CHECK; provenance beside the value | it *is* the 1:1 child |
| `GeoEntityVisitDuration` | P-D2 fields (status, range, authority, evidence, resolver) for PLACE only | lazy resolver writes later, separately from hours and admission | yes: lazy shortlist (`status`, `resolvedAt`) | range/status CHECKs | it *is* the 1:1 child |

Rejected alternatives: one combined "place knowledge" table (would mix three
writers and freshness cycles and drift toward a place entity); columns on
`GeoEntity` (≈25 nullable PLACE-only columns, mixed writers); a traversal
child table (0..1 per component with the same lifecycle — columns keep the
CHECKs on one row); a merge-ledger table (the identity attachment already is
the merge record); a generic polymorphic evidence table (no shared query
need).

#### Composition signature

Needed as a column: structured composition must be idempotent across
concurrent generations and reuse requests ("many Tours, no new
Experiences"). Today only GeoEntities are protected (advisory locks);
Experience dedupe is an in-memory fingerprint of source members. A nullable
unique `compositionSignature` makes the database reject a duplicate
composition and gives O(1) reuse lookup. It is a versioned hash
(`v1:` prefix) over the ordered constitutive components — GeoEntity id,
participation and, for TRAVERSE, the bound anchors or rounded boundary
coordinates — plus a facet key only for facet-justified Experiences. It
never contains description, hours, durations, media, quality or ranking.
A signature algorithm change is a recomputation migration.

#### Participation migration strategy

`participation` is added nullable beside `role`. The structured composer
always writes it (VISIT for a place, TRAVERSE for a bounded route) and
writes no `role` semantics of its own. Legacy rows keep `role` and a null
`participation`; no blind backfill. Mapping used by consumers during
migration: `venue`/`waypoint` → VISIT, `route` → TRAVERSE (unbounded),
`area` → no participation yet (area-scope membership stays on `role` until
the task 43 consumer audit decides whether area scope is a participation).
`participation` never encodes `GeoEntity.kind`. `role` is removed only
after its consumers (spatial footprint, geographic-scope and
membership policies, resolution facts) are migrated (task 43).

#### Provenance strategy

| Fact | Provenance |
|---|---|
| GeoEntity identity / merges | reused: `GeoEntityIdentity` (provider, externalId) + new link rule/evidence |
| Admission signals | stored minimally with the fact (`evidence` items referencing provider identity + field), policy version, timestamp |
| PART_OF | stored with the relation (`evidenceSource`, `evidence`), classification version |
| Opening hours | stored with the fact (`source`, `sourceRecordRef`, `sourceRaw`, `parserVersion`, `retrievedAt`) |
| Visit duration | stored with the fact (authority class, evidence items, resolver version); research-derived evidence items reference research evidence records by id (C14, "Planning-evidence persistence") |
| Bounded traversal | stored with the component (`traversalGeometrySource`, `traversalResolvedAt`) |
| Experience justification | derived through components → GeoEntity admission/relations; `ExperienceEvidence` stays for source-extracted Experiences |
| Verified hints | unchanged (`GeoEntityVerifiedHintAssertion`) |
| Planning | Tour `planningContext` / `planningDiagnostics`, component `planningEvidence`, `travelFromPrevious` |

No generic evidence framework is introduced.

#### Examples

```text
MALBA
  GeoEntity(MALBA, PLACE) + GeoEntityIdentity(osm, …)(linkRule FIRST_IDENTITY)
  GeoEntityAdmission{ADMITTED, signals [EXPLICIT_VISITOR_CLASSIFICATION, …]}
  GeoEntityOpeningHours{KNOWN, schedule …} ; GeoEntityVisitDuration{RESOLVED|…} or none (fallback at projection)
  Experience{compositionSignature v1:…} -> ExperienceComponent{VISIT, required, geoEntityId MALBA}

San Telmo walk
  Experience{compositionSignature over the 4 constitutive components}
  1 ExperienceComponent{TRAVERSE, required, geoEntityId Defensa(ROUTE),
       traversalFrom=Chile(ROUTE) / traversalTo=Humberto Primo(ROUTE),
       boundary coordinates, traversalGeometry LineString, source}
  2-4 ExperienceComponent{VISIT, order 2..4} -> Mercado / Plaza Dorrego / Plaza de Mayo
  Another Experience: TRAVERSE Defensa with traversalFrom=Avenida de Mayo,
  traversalTo=Chile -> same Defensa GeoEntity, different component columns.

Recoleta tomb
  GeoEntity(tomb, PLACE) (may carry its own GeoEntityAdmission)
  GeoEntityRelation{child tomb, parent Cementerio, PART_OF,
       visitUnitClassification CHILD_REQUIRES_PARENT_VISIT}
  -> no Experience is composed for the tomb; SUB_FEATURE_OF / PARENT_NOT_ADMITTED
     derived from the relation + the cemetery's GeoEntityAdmission.

Composite internal feasibility
  The planner reads the walk's components in order; for VISIT Mercado it
  joins GeoEntityOpeningHours(Mercado) and GeoEntityVisitDuration(Mercado);
  the internal timeline must reach Mercado inside a valid window. The Tour
  stores each component's plannedStart/plannedEnd and the window used in
  TourExperienceComponent.planningEvidence.
```

**Remaining open after R4-D1:** the area-scope participation question
(task 43 audit). Resolved since: P-D1, P-D5 and P-D7 (decision list), and
the persistence of L2 assertions, the L3 ledger, research evidence memory
and enrichment demand/attempts (owner, 2026-10-15; below).

#### Planning-evidence persistence (task 41.0 prerequisite — RESOLVED, owner 2026-10-15)

One durable planning-evidence persistence model with four logically
distinct record types. They are not four unrelated storage systems: they
share one persistence technology, one provenance envelope and stable-id
references between them. Each keeps its own write authority (spec
`destination-knowledge-catalog`).

| record type | meaning | written by | mutability |
|---|---|---|---|
| L2 assertion | a durable claim the system currently believes (e.g. RELEVANT_FOR, NOTABLE_WITHIN, WALKING_CORRIDOR) | grounding only | current head plus append-only revisions |
| research evidence | source-backed evidence that supports or refutes assertions (document snapshots, captures, pending claims, unoffered mentions) | research / evidence retrieval | append-only; a re-verification appends a new record |
| L3 ledger entry | a durable record of a domain decision, transition or selected action (gap and evaluation-question outcomes, demand transitions, typed-fact updates) | outcome recording and the maintenance path | append-only |
| enrichment demand / attempt | a missing or stale knowledge gap, and each attempt to fill it | demand: generation and catalog-health detection; attempt: the maintenance path | demand: one open record per key with signal counters; attempts append-only |

Relationships (stable ids, no duplicated evidence payloads):
- an L2 assertion revision references the research evidence that supports
  or refutes it (link role SUPPORTS / REFUTES);
- an L3 ledger entry may reference the assertion revisions and evidence
  its decision used;
- an enrichment demand records the gap, keyed by `(fact type, canonical
  subject id)` (C15);
- an enrichment attempt references its demand and either the evidence it
  produced or a typed failure (INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED,
  FAILED);
- a successful enrichment updates canonical knowledge only through its
  authority: grounding creates or revises L2 assertions; typed facts
  (visit duration, opening hours) are updated in their C14 tables. Either
  way an L3 entry links the attempt, the evidence and the resulting
  record.

Provenance envelope on every record, answering what / why / from which
evidence / for which subject and run / under which policy / when:
- stable id and record type;
- subject (kind + canonical id: GeoEntity, Experience, destination or
  area) and, where applicable, the evaluation-question or gap key;
- cause: the generation request, maintenance run or attempt id that
  produced it;
- source references (evidence ids, provider identity and retrieval time;
  never an inline copy of another record's payload);
- policy key and version, plus producer component and version;
- created-at time;
- an idempotency key, unique per record type, so a retried write never
  duplicates a record.

History semantics:
- nothing destructively overwrites historical truth;
- an L2 assertion has a head (current belief) and append-only revisions.
  Each revision keeps its belief and status (ACTIVE, RETRACTED, SUPERSEDED,
  CONFLICTING), its evidence links, its cause and its policy version, so
  the previous belief, the new belief, the evidence for the change and its
  time and version can be reconstructed. This follows the precedent of
  `GeoEntityVerifiedHintAssertion` (append plus revocation, never delete);
- C14 typed facts keep R4-D1's in-place update with no history table. The
  L3 entry recording each update keeps the previous and new values (typed,
  bounded), the evidence ids and the policy versions, so their history is
  reconstructable from the ledger;
- L3 entries and enrichment attempts are append-only. Demand state changes
  (PENDING → IN_PROGRESS → SATISFIED / BACKOFF / ABANDONED) are recorded as
  L3 transitions; the demand row keeps only its current state and its
  signal counters (first and last signal, count).

Read rules (unchanged layer semantics):
- readiness, composition and planning read GeoEntities, L2, Experiences,
  C14 facts and the ledger. They never read research evidence as
  knowledge; only grounding consumes evidence (spec
  `research-evidence-memory`);
- freshness and backoff checks (R9, C15) read the ledger and the demand by
  key.

Boundary with the generation trace:
- this model is durable domain state needed by later planning and research
  work. The generation trace is generic, business-agnostic operational
  observability for one execution;
- the trace may record references (`assertionId`, `evidenceId`,
  `ledgerEntryId`, `enrichmentDemandId`, `enrichmentAttemptId`,
  `policyVersion`). It is never the system of record for L2, L3, evidence
  or enrichment state, and no decision reads the trace. Planner
  diagnostics in the Tour snapshot are likewise explanation, not this
  state.

Storage: the existing canonical persistence (PostgreSQL through Prisma)
satisfies every requirement:
- durable storage;
- indexed lookup by subject, key, request, run and attempt;
- provenance links as foreign keys;
- version history as revision rows;
- idempotent writes through unique idempotency keys;
- bounded retrieval with keyset pagination per subject or key.

Fields that participate in decisions (keys, statuses, outcomes, policy
versions, subject ids) are typed columns. Bounded JSON is allowed only for
non-decision payloads (for example a capture excerpt). No separate database
is introduced. A separate physical store is escalated only if an existing
requirement proves it necessary (for example the deferred FTS/vector
retrieval over evidence memory, R8, which pgvector in the same database may
already cover). No retention TTL is fixed here (C15 freshness policy). The
concrete Prisma models are written by `/opsx:apply` in task 41.0.

### C15. Catalog-first operating model and asynchronous knowledge maintenance

**Hot path.** Almost every tour-generation decision is satisfied from the
catalog:

```text
request -> catalog -> planner -> Tour
```

GeoEntities and Experiences are living entities: their reusable facts may
be missing, stale, changed upstream, conflicting or superseded by better
evidence. Maintaining those facts is a separate, asynchronous responsibility.

**Invariant (all reusable enrichment knowledge; today opening hours and
visit duration, extensible to future facts).** When generation meets a
missing or stale reusable fact it:

1. never launches research synchronously and never waits for enrichment;
2. never converts the gap into NEEDS_ACQUISITION or INSUFFICIENT_KNOWLEDGE
   (missing enrichment is not a candidate-discovery gap; R4-D4 unchanged);
3. plans with the applicable degraded-mode policy (opening hours: P-D4
   PENALIZE; visit duration: the P-D2-F fallback);
4. exposes the degradation in request diagnostics and the Tour snapshot;
5. emits enrichment demand for the fact, deduplicated;
6. completes; the catalog improves afterward for future requests.

**Maintenance path (responsibility, not topology).**

```text
reusable fact on a GeoEntity / Experience
  -> detect missing / stale / conflicting / outdated-version fact
  -> enrichment demand (deduplicated, only if due)
  -> asynchronous provider lookup or research
  -> evidence validation (grounding)
  -> in-place update of canonical knowledge (C14 tables) with provenance
  -> future generations read the improved catalog
```

Scheduled jobs, queues, workers, periodic or event-triggered refresh are all
admissible implementations; none is chosen here. No scheduler or queue
schema, worker topology, cron, retry constants or TTL values are defined.

**Enrichment demand and deduplication (conceptual).** Demand is keyed by
`(fact type, canonical subject id)` — e.g. `(VISIT_DURATION, GeoEntity id)`,
`(OPENING_HOURS, GeoEntity id)` — reusing the gap-key idea and the L3
ledger semantics: on detection, the maintenance path checks whether demand
for that key is already pending or was attempted recently (per a versioned
freshness/backoff policy) and records new demand only if due. Repeated
requests that meet the same gap add at most a signal, never a new research
run. Demand, attempts and outcomes are stored in the planning-evidence
persistence model (C14, "Planning-evidence persistence").

**Request diagnostics vs catalog-health signals.**

- *Request diagnostics* (what happened in this generation; Tour snapshot /
  trace): OPENING_HOURS_UNKNOWN visits accepted, duration
  `durationSource = FALLBACK_POLICY` used.
- *Catalog-health signals* (what reusable knowledge to repair; operational,
  never user-visible errors): OPENING_HOURS_ENRICHMENT_REQUIRED,
  VISIT_DURATION_ENRICHMENT_REQUIRED, KNOWLEDGE_REFRESH_DUE (stale fact,
  changed provider source, conflicting evidence, or a fact produced by an
  outdated policy/parser/resolver version).

**Freshness.** Reusable knowledge has a freshness policy independent of user
requests, versioned and configurable, covering missing facts, stale facts,
facts whose provider source changed, conflicting evidence and facts produced
by an outdated policy/parser/resolver version. No interval or TTL is chosen.
Freshness is a maintenance signal, not a planning state: a stale KNOWN
opening-hours record stays KNOWN (hard) for planning until a refresh changes
it; downgrading to UNKNOWN would only happen through an explicit, versioned
freshness rule, none of which is defined here.

**Prioritization (P-D2 lazy rule preserved).** Maintenance never researches
the whole catalog blindly. Demand comes from (a) hot-path detection on
candidates actually offered to or scheduled by the planner and (b) the
freshness policy, prioritized toward knowledge likely to be planned and
bounded by versioned budgets. The goal is a steady state in which almost
every planner candidate is already enriched before a user asks.

**Per-fact sources.** Visit duration follows the P-D2 authority order and
evidence contract (structured provider, official site, official
tourism/institutional, reliable reference, user-generated as lower
authority, grounded synthesis of cited evidence; the fallback is planner-only
and never a source); the task 27.3 evidence-availability probe becomes the
cheap pre-check before any expensive duration research, outside the
generation path. Opening hours are refreshed from structured providers; any
research-sourced opening hours would need their own evidence contract under
the same grounding principles (not defined by this change). No asynchronous
LLM answer becomes canonical without validated evidence.

**Composites and must-include.** Detection, degraded policy and demand apply
per VISIT component; a composite stays one planner candidate whose duration
derives from component visit durations, required traversal time and internal
travel. TRAVERSE components never use the visit-duration fallback (their time
comes from routing; unavailable routing is P-D3). A must-include item with
missing duration or unknown hours is never dropped for that reason, never
triggers synchronous research, is planned under the degraded policy and
records the knowledge gap; known hard constraints stay hard.

### C16. Routing strategy evaluation (P-D1 — RESOLVED 2026-10-12 after G2)

Evidence: `spikes/routing-provider-evaluation-2026-10-12/` (executed
2026-10-12: self-hosted Valhalla on Argentina OSM, Geoapify live calls,
San Telmo traversal, cost model). P-D1 owns only routing / travel-time
computation; catalog PLACE knowledge and destination/geographic resolution
are separate problems.

#### Separated infrastructure roles

- **Catalog PLACE knowledge:** the GeoEntity catalog, Overture Places and
  structured OSM/Wikidata evidence. `OverturePlaceIndex` is a provider-owned
  PLACE index and identity/discovery source ("acquisition evidence, never
  canonical GeoEntity state"). It does not provide destination-area
  geocoding, administrative/neighbourhood boundaries, ROUTE geometry,
  routing or travel times, and is not a routing alternative.
- **Destination / geographic resolution (current Nominatim uses, audited
  2026-10-12):**

| Use (file) | Class | Revision 4 status |
|---|---|---|
| `destination-resolution.service.ts` (`search`, `reverse`) | destination resolution; country/locality context for the wizard's coordinates | still required (destination scope); once per request, cacheable per destination |
| `osm-places.service.ts` (operational polygon of a settlement from the destination result) | destination boundary | still required through destination resolution |
| `experience-proposal-resolver.service.ts` (hint → `search`) | PLACE identity resolution from source hints | old acquisition pipeline; retirement candidate (group 43) |
| `area-route-anchor-resolver.service.ts` (`search`), used by area-route walk acquisition and `resolveNamedAnchors` in generation | AREA / ROUTE anchor resolution | old pipeline; retirement candidate (future ROUTE bounds come from structured OSM, C0) |
| `osm-component-locality-grounder.service.ts` (`search`) | locality grounding of source components | old pipeline; retirement candidate |
| `nominatim-match.util.ts` and identity/correspondence utils | matching helpers for the uses above (Overture reuses only `normalizeGeoName`) | follow their callers |

  Under catalog-first planning, PLACE identity and coordinates come from
  the catalog, so hot-path geocoding volume is near zero: Nominatim's future
  production role can shrink to occasional destination resolution (and
  reverse lookup of selected coordinates), cached per destination. The
  public OSMF endpoint is development-only (`.env.example`). Choosing a
  managed Nominatim-compatible service, a regional self-host (the local
  Argentina instance uses a 6.4 GB database volume and ~1.4 GiB RAM) or
  another geocoder is a separate decision, not P-D1, and its cost is
  excluded from the routing break-even.

#### Capability matrix (evidence and current docs)

| | Valhalla (self-host) | Geoapify | Mapbox | Google Routes |
|---|---|---|---|---|
| Walk / drive / bicycle legs | yes / yes / yes (measured) | yes / yes / yes (measured) | yes / yes / yes (docs) | yes (docs) |
| Public transport | route only, requires GTFS ingestion; not in matrix | per-pair Routing `transit`; **not in Route Matrix** (measured: 400) | none | yes, incl. matrix (docs) |
| Bulk pair costs | `sources_to_targets`; full 45x45 4-10 s, kNN 45x10 0.2-0.5 s (measured, laptop) | Route Matrix ≤1,000 elements, cheap credit formula | Matrix ≤25x25, 60 req/min | Compute Route Matrix |
| Map matching / constrained traversal | `trace_route` / `trace_attributes` — San Telmo exact (measured) | Map Matching walk/drive/bicycle — San Telmo exact (measured) | Map Matching ≤100 points (docs; **not executed**, no token) | no direct equivalent (Roads/route shaping), not evaluated |
| Departure time / traffic | `date_time` supported; traffic only with external speed data | `traffic=approximated` for motorized; no departure time | `driving-traffic`, `depart_at` beta | predictive traffic |
| Result storage | OSM/ODbL, unrestricted with attribution | marketing says permissive; **terms not verified** | restricted per API (unverified per API) | restricted |

Endpoint-only routing is not a traversal guarantee: for San Telmo, walking
happened to stay on Defensa, but drive and bicycle routes left it (both
providers). Walking times for the same 521 m differ by provider/API (376 s
Valhalla, 405 s Geoapify map matching, 502 s Geoapify routing), so every
estimate carries provider + API + version provenance.

#### Constrained-route validation (deterministic, geometric)

A required bounded traversal is accepted only when the provider output,
compared with the stored segment geometry, satisfies all of: coverage of
the segment by the output, fraction of the output lying on the segment
(both directions are required — an empty match is vacuously "on source"),
symmetric Hausdorff distance, and no backtracking along the segment; where
the provider returns matched edges (Valhalla `trace_attributes` way ids,
Geoapify per-point `match_type`/`match_distance`), unmatched points also
reject. No LLM, no street-name string test, no visual check. On San Telmo
the separation is wide (respecting outputs: coverage 1.00 at 2 m, Hausdorff
≤0.2 m; violating outputs: coverage ≤0.06 at 15 m), but one case is not
calibration evidence: tolerances are fixed by the calibration gate G2 and
recorded as a versioned validator policy. A violation yields
CONSTRAINT_UNSATISFIED; an unavailable estimate stays
TRAVEL_ESTIMATE_UNAVAILABLE (P-D3).

#### Contract consequences (provider-neutral)

- **Per-leg and constrained estimation:** the existing per-mode
  `TravelEstimateProvider` stays for single legs and gains a constrained
  variant (mode + required segment geometry/version) returning
  ESTIMATE_AVAILABLE (duration, distance, validated geometry, provider,
  provider/API version, traversal geometry version), MODE_UNAVAILABLE,
  PROVIDER_UNAVAILABLE or CONSTRAINT_UNSATISFIED.
- **Bulk pair costs:** a separate provider-neutral `TravelMatrixProvider`
  (sources, targets, mode, optional departure time → per-pair outcomes) so
  the optimizer never issues N² leg calls; adapters own chunking, vendor
  limits, credits and batching. The optimizer requests a shape (full or
  sparse nearest-neighbour), never a vendor concept. P-D5 (G-P5) uses the
  full matrix per mode (~31 points, one ~16 KB optimizer request); a
  sparse shape is an optimization to adopt only when pool sizes require it.
- **Optional day anchors:** today `DailyPlanningInput` has no start/end
  location (only window, dates and destination), so only Experience →
  Experience legs are estimated. Anchors become optional per day
  (`dayStart`, `dayEnd`, e.g. a hotel each day); when absent none is
  invented, first/last-mile cost is excluded and the plan/snapshot records
  that; when present the anchor legs are included. Anchor UX is not decided.
- **Traffic:** not a primary selection criterion. Walk/bicycle ignore
  automotive traffic (graph correctness, access, connectivity and
  constrained paths matter). For drive, only historical/predicted traffic
  for a future departure could matter; live traffic is irrelevant for Tours
  planned ahead. Not required for the first release; drive estimates record
  their traffic model (free-flow/typical/predicted) in provenance.

#### Economics (2026-10-12 pricing; spike README tables)

Per Tour with 2 modes and 2 anchors: full pairs 264 / 924 / 1,984 / 5,304
elements and sparse (10 nearest) 260 / 560 / 840 / 1,400 for pools of
10 / 20 / 30 / 50. Monthly, pool 20, 2 modes, no cross-request caching:

| Tours/month | Geoapify | Mapbox (full / kNN) | Google (full / kNN) |
|---|---|---|---|
| 100 | $0 (free tier) | $0 / $0 | $412 / $230 |
| 1,000 | $109 | $1,478 / $896 | $4,570 / $2,750 |
| 10,000 | $609 | $11,488 / $7,120 | $46,150 / $27,950 |
| 100,000 | Custom (from $860, quote) | $111,280 / $67,600 | $461,950 / $279,950 |

Self-hosted Valhalla (regional, measured build; production sizing still
to be measured): ≈$78/month for one 2 vCPU/16 GiB instance, ≈$156 with a
second for availability, plus storage and the operations cost of a weekly
OSM rebuild, monitoring and upgrades (not priced). Approximate break-even:
against Mapbox within a few hundred Tours/month. Against Geoapify, on
infrastructure alone Geoapify exceeds one Valhalla instance at roughly
150-700 Tours/month and two instances at roughly 350-1,700 (pool 50 → 20);
because Geoapify's price then grows slowly ($609 at 10,000 Tours, pool 20),
the absolute gap stays a few hundred dollars per month — below the
operations cost of self-hosting — until Geoapify's custom tier, so
self-hosting pays off realistically near 10,000+ Tours/month (or earlier if
storage terms or rate limits force it). Mapbox and Google are not
materially competitive for this matrix-heavy workload; Google's only
distinctive advantages (transit matrix, predictive traffic) are not
first-release requirements.

#### Resolution (P-D1 RESOLVED 2026-10-12; was the recommendation)

- **Initial:** Strategy 4 — managed Geoapify for walk/drive/bicycle legs,
  bulk pair costs and constrained traversal (map matching), behind the
  provider-neutral contracts above; public transport MODE_UNAVAILABLE in the
  first release (G0).
- **Scale-up:** self-hosted Valhalla over OSM (regional first) behind the
  same contracts when the monthly routing spend, rate-limit headroom or a
  storage-terms restriction makes it cheaper or necessary; the trigger is a
  measured monthly comparison of routing spend against Valhalla's
  infrastructure + operations cost, not a fixed threshold. Switching is an
  adapter/configuration change.
- **Valhalla-first alternative (not triggered):** it applied only if G1
  showed Geoapify results could not be stored in Tour snapshots / catalog
  traversal timings. G1 CLOSED on 2026-10-15 with storage permitted, so
  production starts with Geoapify; Valhalla remains the scale-up path.

#### G2 — traversal-validator calibration (CLOSED 2026-10-12)

Evidence: `spikes/routing-provider-evaluation-2026-10-12/g2/` (dataset
`g2-2026-10-12`: manifest, OSM provenance, raw metrics, provider outputs,
calibration, reproducible scripts). 21 required walking segments from OSM
structure (Buenos Aires 9, Paris 7, Los Angeles 5, including the San Telmo
contract case), structural negatives built from OSM (reversed, partial,
parallel street, detour) and provider outputs (Geoapify Map Matching and
endpoint Routing; Valhalla 3.9.1 trace/route on Argentina and Ile-de-France
tiles): 264 outputs, 60 VALID and 204 CONSTRAINT_UNSATISFIED, 0 excluded.
Labels come from a threshold-free ground truth by OSM way identity
(nearest street-centerline way per densified output point; junction
neighbourhoods sized from the geometry), independent of the validator, and
agree with every construction label.

**Policy `traversal-validator-v1`** (provider-neutral; adapters normalize
output geometry to one LineString): VALID iff

1. max distance required→output ≤ 2.8 m (VALID max 0.6 m; nearest
   non-covering negative 5.15 m);
2. max distance output→required ≤ 4.1 m (VALID max 3.08 m, a junction
   overshoot; nearest negative that leaves the required ways 5.23 m);
3. forward progress along the segment > 0 (VALID ≥ 0.9998 of the length;
   reversed ≤ −0.49);
4. backtracking ≤ the coverage tolerance (VALID 0 m; reversed ≥ 143 m);
5. provider-unmatched points ≤ 0 (VALID 0; not exercised by negatives —
   fail-closed guard);

otherwise CONSTRAINT_UNSATISFIED; an empty output fails. Thresholds 1-2
are the midpoints of the observed gaps floored to 0.1 m (toward the
positives, fail-closed); 3 is the sign boundary; 4 reuses 1. Result: 0
false positives, 0 false negatives, the same rule for both providers
(Valhalla VALID ≤ 0.06 m, Geoapify VALID ≤ 0.6 / 3.08 m); San Telmo VALID
for both. On-segment never rejected alone here; it guards a covering
output that also leaves the segment (not reproducible structurally).
Unreproduced controls: off-segment excursion with full coverage, provider
output with unmatched portions. Any provider or geometry-source change
requires a new calibration dataset version.

**Finding for composition.** Both providers refused the same three Paris
segments because of the required geometry itself: a name-built chain
included a separately mapped cycle track (Rue Saint-Antoine), and two
pedestrian streets are tagged `oneway=yes` (treated as one-way on foot).
A bounded TRAVERSE must therefore be built only from ways the requested
mode may traverse in the required direction; otherwise
CONSTRAINT_UNSATISFIED is the correct outcome.

#### Gates before P-D1 can be resolved

- **G0 (product):** confirm the first-release mode set walk / drive /
  bicycle with public transport MODE_UNAVAILABLE (no matrix-capable transit
  except Google).
- **G1 (terms, CLOSED 2026-10-15):** verify from Geoapify's legal terms whether routing,
  matrix and map-matching results may be persisted (Tour snapshot legs,
  ExperienceComponent traversal timing, recorded test fixtures, cross-request
  pair caching). Decides Geoapify-first vs Valhalla-first.
- **G2 (calibration):** run the validator on a recorded calibration set of
  at least 20 bounded traversals across the P-D6 destinations (straight,
  curved, dual-carriageway, pedestrian streets, park/plaza paths) plus
  negative controls (endpoint routes known to deviate), for the chosen
  provider(s); fix the tolerances where respecting and violating outputs
  separate, as validator policy `v1`.
- Not gates: a Mapbox traversal run (not competitive economically); Valhalla
  production sizing (needed only when the scale-up trigger fires).

Gate status: G0 confirmed by the owner (first release walk / drive /
bicycle as enabled by product policy; no public transport); G2 CLOSED
(above); G1 CLOSED (2026-10-15, task 28.6): GO_WITH_REQUIREMENTS, so
Geoapify is the initial production provider and Valhalla-first is not
triggered.

*G1 — CLOSED 2026-10-15: GO_WITH_REQUIREMENTS.* The dated source record
is `spikes/routing-provider-evaluation-2026-10-12/g1/` (not legal
advice).

Authoritative evidence: Geoapify's explicit vendor confirmation, relayed
by the owner and recorded 2026-10-15. Geoapify API results may be cached,
stored and redistributed without retention restrictions; the confirmation
names geocoding data, Places API results and static-map outputs as
examples. This resolves the material term of G1 (persisting results in
Tour snapshot legs, ExperienceComponent traversal timings, recorded
fixtures and a cross-request pair cache).

History: the 2026-10-14 desk review classified G1 as
NEEDS_VENDOR_CONFIRMATION, because the storage permission then appeared
only in Geoapify's FAQ, while the Terms and Conditions (v5, 2024-02-02)
and the Routing, Route Matrix and Map Matching pages were silent. The
vendor confirmation above supersedes that classification. Facts from the
review that still hold:
- **Attribution.** OpenStreetMap attribution is always mandatory.
  Geoapify attribution is mandatory on the Free plan. Per-API attribution
  is returned in the result object.
- **Commercial use** is allowed, including the Free plan in production
  within its limits (3,000 credits/day, 5 req/s). A 31-point matrix costs
  310 credits. Splitting requests across accounts is forbidden.
- **ODbL.** Tours shown to users are Produced Works that need OSM
  attribution. An internal pair cache is not Public Use.

Requirements (implementation and compliance, task 28.7; not architecture
gates):
- show all required OpenStreetMap / provider attribution in the app;
- keep the provider's attribution metadata with stored results where the
  provider returns it;
- size the production Geoapify plan from measured credits per Tour;
- document the cache, storage and redistribution rights with the vendor
  confirmation;
- do not expose internal matrices or the pair cache unless the product
  intentionally requires it.

### Superseded by revision 4

| Revision 3 statement | Replaced by |
|---|---|
| READY / NEEDS_ACQUISITION / INSUFFICIENT_KNOWLEDGE as the only verdicts (S5) | adds PLANNER_LIMITED with a typed planner feasibility diagnostic (C2) |
| READY when the planner residual is below the meaningful threshold; otherwise more acquisition (S5) | limiting-resource classification (C2) |
| SCHEDULE_CAPACITY emitted whenever a provisional plan leaves meaningful residual (S5, spec) | only when candidate supply is the limiting resource (C3) |
| INSUFFICIENT_KNOWLEDGE when structured acquisition is exhausted and the plan cannot be filled (S5) | only when candidate supply is limiting and structured strategies are exhausted (C2) |
| Q1 / S3 item 5: admission by membership in the backend's tourism POI classes | structured visitability/notability admission over canonical signals with generic exclusions (C6, R4-D3); category membership alone is no longer the admission authority |
| UNKNOWN_CATEGORY rejection | INSUFFICIENT_ADMISSION_EVIDENCE |
| Dedupe only by shared strong identity (S1, R4) | structured identity reconciliation (C8) |
| Out of scope: production wiring, deleting the old pipeline | production cutover tasks in this change, deletion last (C12) |
| S8 Experience kinds (PLACE_VISIT, CORRIDOR_WALK) with per-kind identity and admission | no Experience kind; eligibility and identity from components, participation and `GeoEntity.kind` (C0, S8 restated) |
| Experience content revisions on enrichment | in-place update with stable identity; Tour snapshots preserve history (C0) |
| C4 (initial revision 4): walk whenever the leg fits the limits, else the fastest non-walking mode; network-free approximate public transport with versioned speed/wait parameters as the ordinary estimate | planning track: mode chosen by the optimizer (P9); provider-routed estimates only (P5); routing unavailability fails explicitly, no network-free estimate (P6, P-D3) |
| Greedy ranked-append planning as the production planner | optimizer selected from spike evidence (P11, P12) |
| Flat composition-policy visit duration | evidence-backed visit-duration knowledge with provenance, lazy enrichment, explicit versioned fallback as last resort (P4, P-D2) |
| `NormalizedOpeningHours` known/unknown without closed days, exceptions, last admission or provenance | KNOWN_OPEN_WINDOW / KNOWN_CLOSED / UNKNOWN per date with provenance and an UNKNOWN policy (P3) |

### Owner decisions for the cutover groups (required before /opsx:apply)

- **R4-D1. RESOLVED (owner, 2026-10-12): persistence mapping onto the
  existing V2 models.** No new identity layer: four GeoEntity-keyed
  knowledge structures (`GeoEntityAdmission`, `GeoEntityOpeningHours`,
  `GeoEntityVisitDuration` as 1:1 children; `GeoEntityRelation` N:M for
  direct PART_OF with visit-unit classification), and typed additions to
  existing models (`Experience.compositionSignature`, ExperienceComponent
  `participation` + traversal columns, GeoEntityIdentity link evidence, Tour
  `readinessVerdict` / `timezone` / planning snapshots, TourExperience
  `endTime`, TourExperienceComponent internal-timeline fields). Derived
  states (SUB_FEATURE_OF, PARENT_NOT_ADMITTED) and fallback durations are
  not stored; possible duplicates stay in the trace; no history tables.
  Contract: design C14. Follow-up resolved (owner, 2026-10-15): L2
  assertions, research evidence, the L3 ledger and enrichment
  demand/attempts form one planning-evidence persistence model in the
  existing database (C14, "Planning-evidence persistence"), separate from
  the generation trace; the task 41.0 prerequisite is met.
- **R4-D2. RESOLVED (owner, 2026-10-11): visit-unit distinction for
  children.** PART_OF / containment alone does not decide independent
  schedulable-Experience status. Each established relationship is classified from
  structured evidence as CHILD_REQUIRES_PARENT_VISIT (never offered
  independently; SUB_FEATURE_OF under an admitted parent, PARENT_NOT_ADMITTED
  / CONTEXT_REQUIRED otherwise — never promoted because the parent is
  absent) or CHILD_INDEPENDENTLY_VISITABLE (normal admission, relationship
  kept); insufficient or contradictory evidence → AMBIGUOUS_PARENT_RELATIONSHIP,
  failing closed against both collapsing and promoting. Children stay
  canonical entities and reusable parent knowledge; only the direct visit
  parent is considered (no recursive hierarchy; deeper PART_OF kept as
  knowledge only); admission stays independent in both directions; no named place in policy; no proximity,
  embeddings, LLM or web authority. Supersedes the earlier recommendation
  to keep a child independent when its parent is not admitted. Contract:
  design C5.
- **R4-D3. RESOLVED (owner, 2026-10-11): structured visitability/notability
  instead of an exhaustive tourism-type allowlist.** Ordinary admission is
  decided by canonical structured admission signals (C6) with a small
  generic exclusion policy; categories are evidence, not the authority;
  provider tags map to signals at adapters; discovery selectors are
  acquisition strategy, not admission truth (C7); structured Wikidata facts
  participate without becoming L2. The earlier "add gardens and theatres"
  direction is withdrawn: gardens, theatres, stadiums and cemeteries qualify
  through structured evidence like any other place.
- **R4-D4. RESOLVED (owner, 2026-10-11): PLANNER_LIMITED is a first-class
  readiness verdict.** The verdict set stays READY, PLANNER_LIMITED,
  NEEDS_ACQUISITION, INSUFFICIENT_KNOWLEDGE; PLANNER_LIMITED is never READY
  plus a boolean or secondary field. Meaning: a usable Tour was produced,
  sufficient eligible candidate knowledge exists, no structured acquisition
  is required, and the material remaining capacity is explained by planner
  feasibility or planner-owned constraints (opening hours, travel time,
  visit duration, walking/mobility, unavailable modes, user time windows,
  optimizer trade-offs, other typed planner constraints). It never means
  missing knowledge, provider-coverage insufficiency, acquisition need or
  failed generation. READY means the plan is satisfactory under the active
  planning policy with no material planner-owned limitation to surface. The
  distinction uses only the planner's own feasibility result, its
  meaningful-residual judgement and its typed unscheduled diagnostics, plus
  the C2 supply accounting; no new numeric threshold. PLANNER_LIMITED never
  emits SCHEDULE_CAPACITY or any acquisition gap. Zero scheduled activities
  with sufficient supply is the PLANNER_INFEASIBLE generation outcome (no
  Tour), never PLANNER_LIMITED with an empty Tour. The verdict is explicit
  domain state, never derived from an incidental flag such as
  "hasUnusedTime"; later persistence/API work keeps the four verdicts
  distinct (exact Prisma mapping: R4-D1).
- **R4-D5. WITHDRAWN (planning amendment 2026-10-11).** Approximate
  public-transport parameters are no longer product truth; the question is
  replaced by P-D3 (resolved: no degraded estimation in production).

### Owner decisions for the planning track

- **P-D1. RESOLVED (owner, 2026-10-12): routing strategy.** Initial
  production routing is Geoapify for ordinary legs, bulk pair costs and
  constrained map-matched traversals (walk / drive / bicycle as enabled by
  product policy; no public transport in the first release), behind the
  provider-neutral leg, bulk-pair and constrained-traversal contracts;
  required traversals are accepted only by `traversal-validator-v1` (G2).
  Scale-up: self-hosted Valhalla behind the same contracts when measured
  routing spend, rate limits or storage terms justify it. Traffic is not a
  first-release criterion (predicted traffic may be revisited for drive).
  Nominatim is outside P-D1 (destination / reverse resolution; old-pipeline
  uses retire); Overture is a PLACE source, not routing. G1 (storage terms)
  is CLOSED (2026-10-15, C16): GO_WITH_REQUIREMENTS on Geoapify's explicit
  vendor confirmation that results may be cached, stored and redistributed
  without retention restrictions; Valhalla-first is not triggered.
  Attribution, provenance, plan sizing and no exposure of internal
  matrices/cache are implementation requirements (task 28.7).
  Contract: design C16.
- **P-D2. RESOLVED (owner, 2026-10-11): evidence-backed visit-duration
  resolution.** No single arbitrary fallback constant. Duration is reusable
  knowledge about visiting an admitted PLACE GeoEntity, resolved
  catalog/structured first, then
  by optional, lazy, bounded, evidence-backed enrichment (official, tourism/
  institutional, reference, user-generated, grounded synthesis with cited
  evidence), with an explicit versioned fallback only as last resort; the
  planner consumes normalized knowledge (min / typical / max, status,
  confidence, provenance, versions) and never infers it. Research never
  decides existence, identity or admission. Contract: design P4. No research
  provider is selected.
- **P-D2-F. RESOLVED (owner, 2026-10-12): fallback is exceptional,
  global and calibrated.** One versioned planner fallback policy with a
  single `GLOBAL_DEFAULT` rule (no category/destination/derived maps, no LLM,
  no research), used only when a VISIT component's GeoEntity has no usable
  duration knowledge; snapshotted as `durationSource = FALLBACK_POLICY` with
  policy/rule versions and minutes; never persisted as knowledge; each use
  emits deduplicated asynchronous enrichment demand (C15). The numeric value
  is not chosen: the calibration gate (task 40.2) must approve `fallback-v1`
  from evidence-backed durations before group 41. Contract: design P4, C15.
  40.2 status (2026-10-15): statistic p75 and the sufficiency/robustness
  rule decided by the owner (P4); numeric value OPEN — the evidence-backed
  sample is empty until task 27.3 runs.
- **P-D3. RESOLVED (owner, 2026-10-11): routing unavailable fails
  explicitly; no fabricated travel times.** Provider-backed estimates only;
  partial mode availability continues with usable modes; an unevaluable
  required leg yields TRAVEL_ESTIMATE_UNAVAILABLE; no valid itinerary yields
  the TRAVEL_ESTIMATION_UNAVAILABLE outcome with no Tour, never acquisition
  or INSUFFICIENT_KNOWLEDGE. Degraded/network-free estimation is not enabled
  and requires a future, separately approved, calibrated policy; no degraded
  parameters are chosen or required. Contract: design P6.
- **P-D4. RESOLVED (owner, 2026-10-12): default UNKNOWN-hours policy is
  PENALIZE.** UNKNOWN is feasible on hours alone, never treated as open, and
  carries the symbolic soft term `openingHoursUncertaintyPenalty` (weight in
  P-D7); applied per internal VISIT component of composites; must-include
  items are kept and surfaced as uncertain; diagnostics OPENING_HOURS /
  OPENING_HOURS_UNKNOWN (marker) / OPENING_HOURS_UNKNOWN_EXCLUDED (EXCLUDE
  only); no acquisition, research or readiness change; snapshotted as
  `openingHoursStatus = UNKNOWN` plus policy version. No request-level
  strict mode in this change. Contract: design P3.
- **P-D5. RESOLVED (owner, gate G-P5, 2026-10-12): production optimizer =
  OR-Tools Routing** behind the provider-neutral `PlanningOptimizer`
  contract (P12), executed in a colocated Python sidecar (OR-Tools
  9.15.6755 pinned) in the backend deployment unit and stopped by the
  count-based policy `routing-gls-sl1000-v1` (solution limit 1000 as the
  quality control; 10 s wall-clock cap as an operational safety guard that
  marks a plan non-reproducible when it fires). Evidence: P11 results and
  G-P5 results (`spikes/planner-comparison-2026-10-12/g-p5/`): 0
  hard-constraint violations; identical plans on 39/39 scenarios, across CPU
  quotas ≥ 0.5 vCPU and across amd64/arm64; +0.10 % vs the recorded 5 s
  Routing runs; +3.8 % mean and up to +13.5 % vs greedy best-insertion in
  constrained cases; warm end-to-end 2.1-2.6 s of which ~13 ms is not the
  solve; failures typed and tested. Retired: the current greedy and the
  CP-SAT formulation. Greedy best-insertion stays spike reference code only:
  no runtime choice between optimizers and no failover from Routing to
  greedy for a request. Operational requirement: sustained CPU for planning
  on the production host (~2-3.5 vCPU-s per Tour; a burstable host at its
  credit baseline reaches the safety cap). The objective weights stay
  TEST-ONLY (P-D7).
- **P-D6. RESOLVED (owner, 2026-10-11): spike datasets and routing
  recordings.** Three datasets: Buenos Aires (real spike 3 S3-A structured
  candidates, end-to-end baseline), Paris (dense fixture) and Los Angeles
  (dispersed fixture), the latter two as frozen, versioned planner fixtures
  needing no local OSM/Overpass/Nominatim; plus separate constructed
  edge-case fixtures. The spike consumes planning-ready candidates under the
  P11 fixture contract. One real routing source records per-mode estimates
  replayed identically to every approach; the existing Geoapify routing
  integration is that experimental source and does not become P-D1.
  Candidate counts are fixed in the pre-registered protocol (task 31.1).
  Contract: design P11.
- **P-D7. Planner objective — RESOLVED (structure owner 2026-10-14;
  coefficients owner 2026-10-15, gate G-P7-U CLOSED).** Resolved: the objective is
  preference-first — maximize the request's preference satisfaction over
  hard-feasible itineraries, then account for travel burden, optional mode
  friction and opening-hours uncertainty as soft costs (section "P-D7
  preference-first objective"). Preference utility is derived once, upstream
  of the optimizer, at one canonical boundary:
  - explicit preference evidence is authoritative, ordered by provenance
    rather than UI channel: `DIRECT` (a wizard pick, or free text whose
    excerpt maps to the key through the versioned vocabulary or its
    aliases) before `INFERRED`, decided by a deterministic validator;
  - soft venue-anchor affinity is a separate typed signal;
  - semantic affinity refines within a tier and is UNKNOWN, never zero,
    when no compatible embedding exists;
  - generic quality is secondary.

  The planner boundary is structured: a typed breakdown plus its policy
  version. OR-Tools receives only the prize that the versioned objective
  policy projects from it. The planner's duplicate recombination
  (`plannerRelevanceScore`) is removed. Gate G-P7-U part A (encoding) is
  RESOLVED (owner, 2026-10-14); part B is RESOLVED (owner, 2026-10-15), so
  P-D7 is RESOLVED. Allowed modes, hard exclusions and every other
  hard constraint stay outside the objective; TRANSIT stays feature-gated in
  v1 and is never substituted. Not production policy: the experimental
  coefficients of `spikes/planner-comparison-2026-10-12/p-d7/` (K = 120,
  +10 per DRIVE leg, 10 % UNKNOWN discount) were fitted on generic
  desirability and are rejected as product semantics. Production
  coefficients (G-P7-U part B, task 33.0): objective policy
  `preference-objective-v1`, EVIDENCE_BACKED_INITIAL_POLICY — K 100, β 0.20,
  γ 0.12, c_DRIVE 1 / A_DRIVE 11, c_BICYCLE 1 / A_BICYCLE 4.5, ρ 0.15 — inside
  the region set by the 32 judgments (25 PROPOSED accepted as the initial
  versioned judgment set) and owner answers D1-D4; a hard request cycling
  limit (D3, P7). Recalibration records a new policy version.
  Part B analysis (2026-10-14, spike `g-p7-u-b/`):
  - **Structure established by evidence.** An additive per-Experience prize
    projected from A's stated quantities, with an order-preserving repair;
    per-leg vehicle friction required; a relative UNKNOWN-hours cost.
  - **Coefficients.** Accepted semantics alone do not bound them; the owner
    accepted the 25 PROPOSED judgments and answered D1-D4 on 2026-10-15,
    and the adopted policy satisfies all 32 judgments with 0 violations in
    732 OR-Tools runs. Part B and P-D7 RESOLVED.
- **Q1. Admissible categories: the backend's existing tourism POI classes.**
  The admission vocabulary is the tag classes the backend already treats as
  ordinary tourism POIs (`buildPoisWithinAreaQuery`: `tourism` except lodging
  values, `historic`, `amenity=marketplace|place_of_worship`,
  `leisure=park|square|beach_resort`, `natural=beach`) with the canonical
  structural-kind classifier. Excluded: accommodation, transport stops,
  streets/routes as single-place Experiences, administrative/locality records,
  non-visitable infrastructure and anything the backend does not treat as an
  ordinary tourism POI. No new category ontology. Every admission keeps
  structured provenance; every rejection has a typed reason.
- **Q2. Providers: local OSM/Overpass + Wikidata facts where linked.** A
  bounded experimental set, not the production strategy. No Geoapify,
  Overture, Google Places, web search or LLM to make spike 3 pass. Coverage
  gaps are reported as PROVIDER_COVERAGE, never as evidence against
  structured admission; production stays provider-agnostic.
- **Q3. Deterministic structured ranking, in priority order:** provider
  tourism/category signal; structured heritage/historic designation; provider
  importance/rank/popularity where available; spatial diversity (demoting
  redundant nearby candidates); Wikidata sitelinks only as a weak secondary
  signal / tie-breaker. No LLM, embeddings, web evidence or L2 assertions in
  core ranking. This supersedes the S4 ordering, which listed sitelinks first.

---

# Revision 2 (history)

(Historical record; its L1-L4 layer names and Experience kinds are
superseded terminology — see revision 4 C0.)

Revision 2 (2026-10-10, after spike 1 verdict REVISE_CONTRACT). Revision 1
decisions that still hold are restated or referenced; the ones that made web
research the discovery authority are marked superseded in "Superseded
assumptions".

## Context

See `proposal.md` (Why) and the capability specs for the behavior contract.

Spike 1 (`spikes/gap-driven-destination-knowledge-2026-10-10/`) proved the
mechanics: single-writer layers, catalog-first ledger suppression, typed
grounding failures, identity through the backend `IdentityVerifier`, stable
reusable Experience keys, and an unchanged `GreedyDailyPlanningSolver` that
consumes corridor walks as LINE footprints. It failed because research chose
the candidates: across 4 live Run A attempts, 33 claims about web-named areas,
streets and places, 0 grounded.

Implementation facts that shape revision 2:

- Structured providers available read-only: `OsmPlacesService` (admin
  neighbourhoods within a boundary, POIs within an area, highways by name,
  boundary by id), `NominatimApiService`, `OverpassApiService` (fixed query
  builders; arbitrary queries are not exposed), `WikidataApiService`
  (`findNearbyPlaces`, `getEntitySummaries` with labels/aliases/extract),
  `TargetedRouteResolverService`, `IdentityVerifier`,
  `structuralKindFromNominatim`/`structuralKindFromOsmTags`. Local
  Overpass/Nominatim containers serve Argentina.
- `OverturePlaceIndex` is an exact-place identity lookup that requires a DB
  import; it cannot enumerate candidates in an area.
- Spike 1 code (stores, keys, recorder, provenance, sufficiency, composition,
  projection, planner adapter) is reusable; its readiness, agent prompt and
  grounding entry point encode the superseded web-first contract.

## Goals / Non-Goals

**Goals:**

- Make structured providers the only source of physical candidates and their
  identity; make research a semantic evaluator of canonical candidates.
- Route every gap deterministically to source classes by knowledge type.
- Prove, from a cold Buenos Aires request, that at least one area and one
  POI become grounded through the new direction and that later requests reuse
  them.
- Carry forward spike 1's secondary fixes (question identity,
  INSUFFICIENT_KNOWLEDGE, subject-naming precondition, route correspondence,
  evidence accumulation).

**Non-Goals:**

- Prisma, production services, production wiring, deleting the old pipeline.
- Vector/FTS retrieval over evidence memory (exact evaluation-question keys
  only in spike 2).
- Overture enumeration, Google Places (small quota), meal slots,
  narrative/media.
- Tuning grounding thresholds toward a pass: a corridor that does not ground
  is a valid result.

## Superseded assumptions (revision 1)

| Revision 1 statement | Replaced by |
|---|---|
| The research agent discovers relevant areas/places/streets dynamically from the web (D7, gap descriptions "find neighbourhoods...", "find specific places...", "find streets...") | Structured discovery gaps (R2, R4); research evaluates offered candidates (R6) |
| Grounding resolves the claim's subject mention to an identity (D8 identity step, `resolveArea/Place/Route` from claim text) | Subjects, areas and endpoints are offered canonical candidate ids (R7) |
| AREA_RELEVANCE / NOTABLE_PLACES / WALKING_CORRIDOR as single gaps that both find candidates and establish meaning (D5) | Discovery gaps vs meaning gaps with dependencies (R2) |
| WALKING_CORRIDOR scoped to the destination, emitted without known areas (D5) | WALKING_CORRIDOR_RELEVANCE per relevant area, only with route candidates (R2) |
| Ledger outcomes only per gap key; SCHEDULE_CAPACITY researches "additional areas" on the web | Outcomes per evaluation question; capacity expands by lineage over candidates (R9) |
| READY when every remaining gap is a limitation | INSUFFICIENT_KNOWLEDGE (R9) |
| Unauthorized claims are discarded | Pending evidence in Research Evidence Memory (R8) |

Unchanged from revision 1: D3 (typed in-memory stores with authority
tokens), D4 core contracts (extended in R10), D6 (facet canonicalization),
D8 provenance/support separation and the spike sufficiency rule, D9
(reusable composition rules), D10 (Tour composition), D11's layering and
reusable-identity content.

## Decisions

### R1. Structured world first

```text
discovery:  KnowledgeGap(discovery) -> router -> structured providers
            -> canonical resolution (IdentityVerifier, structural kind) -> L1
meaning:    KnowledgeGap(meaning, offered candidate ids) -> router
            -> [structured entity facts] -> evidence memory -> bounded web evidence
            -> grounding -> L2 -> reusable composition -> L4
```

An LLM never establishes that an entity exists, who it is, or where it is.
Alternative: keep agentic discovery but add stronger identity checks.
Rejected by the spike 1 evidence: a stricter gate on web-named candidates
produced zero output and still depended on web vocabulary (informal areas,
directions).

### R2. Gap model

| Gap | Kind | Scope | Emitted when | Satisfied by |
|---|---|---|---|---|
| AREA_CANDIDATES | discovery | destination | no area candidates acquired for the destination | structured area acquisition recorded (>= 1 candidate, or a recorded empty/failed outcome) |
| AREA_RELEVANCE | meaning | destination + facet | fewer relevant areas than policy and unevaluated area candidates exist | grounded RELEVANT_FOR(area, facet) |
| PLACE_CANDIDATES | discovery | relevant area with provider boundary | no place candidates acquired in that area | structured POI acquisition recorded |
| PLACE_RELEVANCE | meaning | area + facet | fewer relevant places than policy and unevaluated place candidates exist | grounded NOTABLE_WITHIN / RELEVANT_FOR(place) |
| ROUTE_CANDIDATES | discovery | relevant area with provider boundary, walking facet requested | no route candidates acquired in that area | structured route acquisition recorded |
| WALKING_CORRIDOR_RELEVANCE | meaning | area + intent:walk | no grounded corridor in that area and unevaluated route candidates exist | grounded WALKING_CORRIDOR in that area |
| SCHEDULE_CAPACITY | meta | destination + facets | facet gaps satisfied, provisional plan leaves meaningful residual | spawns relevance evaluation of unevaluated candidates, or discovery in additional relevant areas (lineage recorded) |

PRACTICAL_FACT is declared in the router (structured providers only) but not
emitted in spike 2. Order of emission: discovery before meaning, then capacity.
NOTABLE_PLACES and WALKING_CORRIDOR (revision 1) are renamed because their
meaning changed; the old names are not kept as aliases.

### R3. Acquisition router

A versioned `RoutingPolicy` maps gap type -> ordered strategies; each
strategy = (source class, provider adapter, input shape). Availability is a
typed input (configured / unavailable). The router never adds a class that
the table does not authorize for the gap type.

| Gap | Strategies (spike 2) |
|---|---|
| AREA_CANDIDATES | GEOGRAPHIC_STRUCTURE: administrative subdivisions within the destination boundary (OSM); GEOGRAPHIC_STRUCTURE: structured named places (OSM `place=neighbourhood|quarter`) within the destination; STRUCTURED_ENTITY_FACTS: Wikidata items located in the destination whose class is a neighbourhood/quarter-like area (labels, aliases, coordinates) |
| PLACE_CANDIDATES | STRUCTURED_POI: OSM POIs within the area boundary (structural kind POINT_OF_INTEREST); STRUCTURED_ENTITY_FACTS: Wikidata items around the area, kept only when inside the boundary |
| ROUTE_CANDIDATES | ROUTE_GEOMETRY: named OSM highways crossing the area boundary, resolved through `TargetedRouteResolverService` |
| *_RELEVANCE | STRUCTURED_ENTITY_FACTS (only if pending decision P1 allows it); RESEARCH_MEMORY; WEB_EVIDENCE (bounded agent over offered questions) |
| PRACTICAL_FACT | STRUCTURED_POI only (not emitted in spike 2) |

Queries the backend services do not expose (named places, highways within
an area, Wikidata area SPARQL) are spike-local provider adapters that go
through the recorder; they are provider boundaries, not core logic.
Alternative: let the agent pick tools per gap. Rejected: the agent would
again decide which knowledge source establishes existence.

### R4. Structured discovery and canonical resolution

Each structured strategy returns provider records; one discovery boundary:

1. normalizes records (identity, names/aliases, kind, geometry, structural
   kind), excluding TRANSPORT_STOP/ROAD/POSTAL_UNIT for places;
2. merges records that share a strong identity (OSM id, Wikidata QID linked
   by an OSM `wikidata` tag) — never by name similarity;
3. hydrates provider geometry (boundary by id) where only a center exists;
4. records the candidate in L1 through `GeographyResolutionAuthority`, with
   area class/extent for areas.

No name-only matching decides identity; a candidate exists because a
structured record exists.

### R5. Candidate offering (budgeted, ranked, never authorizing)

Meaning gaps offer at most K unevaluated candidates per execution (policy).
Ranking uses structured prominence only, recorded with the offer: areas and
places by Wikidata sitelink count and presence of tourism/historic OSM tags;
routes by the number of grounded relevant places within the corridor buffer.
Ties break by identity. Ranking never enters an assertion. Alternative: offer
all candidates. Rejected: 48 barrios or about 50 San Telmo streets exceed any
research budget.

### R6. Research agent as semantic evaluator

Input: gap, offered evaluation questions (candidate id, structured names and
aliases, kind, area), evidence-memory summary, budget. Tools: search, fetch,
find (spike 1 tooling). Prompt asks whether the offered candidates have
grounded meaning for the facet; it contains no website list and no request to
find new entities. Claims cite candidate ids; any other entity is discarded
as NOT_OFFERED_CANDIDATE and stored as an unoffered mention. The spike 1
corroboration hint remains (it informs discovery of evidence, not truth).

### R7. Grounding revisions

- Subject/area/endpoints = offered ids; no identity resolution from text.
- Subject-naming precondition: a prose capture must contain a normalized
  exact structured name or alias of the subject (OSM `name`, `name:es`,
  `name:en`, `alt_name`, Wikidata labels/aliases); otherwise
  EVIDENCE_DOES_NOT_NAME_SUBJECT. This is identity-anchored matching against
  the provider's own names, not fuzzy matching.
- D8 provenance/support/sufficiency unchanged; sufficiency runs over current
  plus re-verified retained captures for the same evaluation question.
- Corridor endpoints: offered places/areas named in the evidence, within
  policy tolerance of the route, recorded as ROUTE_CORRESPONDENCE.
- INSUFFICIENT_CORROBORATION claims become pending evidence (R8).

### R8. Research Evidence Memory

JSON store in spike 2, separate from the catalog file: documents (url,
fingerprint, text), captures, pending claims keyed by evaluation question,
unoffered mentions. Retrieval is by exact evaluation-question key before live
research; retained captures are re-verified (re-fetch) when grounding uses
them. Memory never feeds readiness. FTS/vector retrieval is deferred.

### R9. Readiness revisions

- Discovery-before-meaning dependencies (R2).
- Ledger keyed by gap key and by evaluation question; a question with a
  recent INSUFFICIENT_EVIDENCE or BUDGET_EXHAUSTED outcome is not offered by
  any gap type within the freshness window; FAILED never suppresses.
- Verdict READY | GAPS | INSUFFICIENT_KNOWLEDGE; generation returns an
  explicit insufficient-knowledge result when no schedulable unit exists.
- Capacity spawns relevance evaluation over unevaluated candidates or
  discovery in further relevant areas, with recorded lineage.

### R10. Tourism-area model

`GeoEntityRef` for AREA gains `areaClass: ADMINISTRATIVE | NAMED_PLACE` and
`extent: PROVIDER_BOUNDARY | UNKNOWN`. Relations (NAMED_PLACE within
ADMINISTRATIVE) are derived from provider geometry. Areas with unknown
extent can carry relevance assertions but do not scope place/route
discovery or containment checks. Spike 2 measures how many tourism areas
have no provider boundary instead of inventing one.

### R11. Spike 2 placement

`spikes/structured-world-first-<date>/`, a separate experiment. It imports
spike 1 modules read-only where their contracts hold (stores, keys, recorder,
provenance, sufficiency, composition, projection, planner) and reimplements
contract-changed parts (contracts extension, router, discovery adapters,
readiness, agent, grounding entry, memory). Spike 1 files are not modified.

### R12. Canonical document revision

Revise "Destination knowledge catalog and gap-driven research (2026-10)":
add the structured-world-first invariant, the router and source classes, the
discovery/meaning gap split, the research agent's evaluator role, Research
Evidence Memory, the tourism-area model and INSUFFICIENT_KNOWLEDGE; keep the
spike 1 verdict paragraph; mark the revision 1 statements in "Superseded
assumptions" as superseded.

## Spike 2 acceptance

Evidence, not thresholds to tune toward. A failure to ground a corridor is a
valid result.

1. Run A2 (cold "Buenos Aires, 4 days, history, food, walking") trace shows
   discovery gaps routed only to structured classes and executed before any
   web research.
2. Every research execution receives offered candidate ids; zero L1 entities
   are created from research or grounding.
3. At least one Buenos Aires area is grounded RELEVANT_FOR a requested facet.
4. At least one canonical POI is grounded (NOTABLE_WITHIN or RELEVANT_FOR).
5. Physical identity and tourism relevance are separate records: the
   candidate exists in L1 before its assertion, with distinct provenance.
6. If Defensa is evaluated, its ROUTE entity exists before corridor research
   starts; corridor grounding or its typed failure is recorded either way.
7. Runs B2/C2 reuse A2's catalog: no discovery or research for gaps or
   questions A2 satisfied; any new research is listed by question key.
8. Evidence memory reuse is measured (retained captures used, live research
   avoided) but never authorizes by itself.
9. Hand-labelled grounding sample, provider calls per run, and comparison
   with spike 1 recorded in the spike 2 README with a verdict.

## Risks / Trade-offs

- [Structured sources lack tourism-area records] -> partly mitigated: a
  read-only check of local OSM (2026-10-10) found 82 `place=neighbourhood|
  quarter` records in Buenos Aires, including Palermo Soho, Palermo
  Hollywood, Microcentro and Las Cañitas as point nodes with Wikidata links
  (extent UNKNOWN). Areas without any structured record stay absent;
  reported as a coverage limit.
- [Candidate sets too large for research budgets] -> structured-prominence
  ranking with K per execution; unevaluated candidates stay available.
- [Prominence ranking biases toward famous places] -> it only orders
  evaluation; recorded per offer; acceptable for the spike.
- [Wikidata public endpoint rate limits] -> recorder plus bounded queries;
  outage is FAILED, never empty.
- [Subject-naming precondition rejects pages that use pronouns] -> measured;
  the find tool lets the agent quote sentences that name the subject.
- [Support verifier precision (spike 1 F2)] -> unchanged single LLM verifier,
  measured again; revision deferred to evidence.
- [Spike drifts into production code] -> `git diff -- be fe` empty checked at
  verdict.

## Migration Plan

No runtime migration in this change. The production cutover (follow-up,
only after a PROCEED verdict) adds typed L1 area class/extent, L2/L3/L4 and
evidence-memory schema, the router and discovery adapters, wires generation,
and deletes the superseded pipeline and catalog contents.

## Owner decisions (resolved 2026-10-10, before /opsx:apply)

- **P1. Structured facts as evidence: ACCEPTED with explicit mappings.** A
  structured fact counts as evidence only through an explicit, versioned,
  auditable field-to-claim/facet mapping, and supports only the meaning the
  field establishes (a verified heritage designation -> history relevance; a
  structured museum classification -> culture; structured opening hours -> a
  practical fact). It is never promoted to stronger tourism semantics. OSM
  tourism/historic/category tags may rank candidates and count as structured
  evidence where a mapping exists; they never establish WALKING_CORRIDOR or
  "recommended tourist route". Structured evidence contributes to
  corroboration; it authorizes alone only when the claim-specific mapping
  states that the field directly asserts the claimed meaning.
- **P2. Providers: local OSM (Overpass/Nominatim) + public Wikidata API.** No
  Overture import or Google Places unless a required contract cannot be
  exercised without them; that is recorded as a finding, not a scope change.
- **P3. LLM: the spike 1 Gemini configuration** (`gemini-3.5-flash-lite` via
  the same env file and `--ai-provider gemini`). No model change unless a
  provider failure prevents execution, which is then recorded.

## Open Questions

- Exact K, prominence weights, buffer and budgets: chosen in spike 2 and
  recorded with rationale; they do not change the tasks.
