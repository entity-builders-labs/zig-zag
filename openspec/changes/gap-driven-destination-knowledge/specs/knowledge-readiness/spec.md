# Spec Delta

## Purpose

Decides deterministically whether the catalog snapshot holds enough
schedulable admitted candidates to build the requested Tour, names the
resource that limits the plan (candidate supply or planner feasibility), and
separates the structured gaps on the ordinary happy path from optional
enrichment gaps.

## ADDED Requirements

### Requirement: Deterministic readiness evaluation
Readiness SHALL be a deterministic function of the catalog snapshot, the interpreted request (destination, facets, days, pace, mobility) and a versioned readiness policy. It SHALL return READY, PLANNER_LIMITED, NEEDS_ACQUISITION or INSUFFICIENT_KNOWLEDGE, together with the limiting resource (NONE, CANDIDATE_SUPPLY or PLANNER_FEASIBILITY). No language model SHALL decide whether acquisition is needed.

#### Scenario: Same inputs, same verdict
- **WHEN** readiness is evaluated twice with the same snapshot, request and policy version
- **THEN** both evaluations return identical verdicts, limiting resources and gap lists

### Requirement: READY is reachable from structured candidates alone
Readiness SHALL return READY when the eligible Experiences can fill the requested days according to a provisional plan, even if no tourism assertion has been researched.

#### Scenario: Three days in Buenos Aires without enrichment
- **WHEN** the catalog holds enough eligible single-place Experiences for a feasible 3-day plan and no AREA_RELEVANCE or PLACE_RELEVANCE assertion exists
- **THEN** readiness returns READY

### Requirement: Core gaps and enrichment gaps are distinct
Readiness SHALL emit core gaps only for knowledge the ordinary happy path needs (PLACE_CANDIDATES, SCHEDULE_CAPACITY, and route geometry or practical facts only when planning requires them). Enrichment gaps (AREA_RELEVANCE, PLACE_RELEVANCE, WALKING_CORRIDOR_RELEVANCE, VISIT_DURATION, context, narratives, relationships, tips) SHALL be reported separately and SHALL NOT change a READY verdict.

#### Scenario: Missing enrichment on a ready catalog
- **WHEN** the catalog is ready from admitted places and no place has thematic enrichment
- **THEN** the verdict stays READY and any enrichment gaps are listed as optional

### Requirement: Semantic gaps never gate structured acquisition
A missing area relevance or place relevance assertion SHALL NOT prevent a PLACE_CANDIDATES gap from being emitted or executed. Destination-level place discovery SHALL be allowed without any area knowledge.

#### Scenario: Cold destination
- **WHEN** the catalog has no candidates for Buenos Aires
- **THEN** readiness emits PLACE_CANDIDATES for the destination and no relevance gap

### Requirement: Unused eligible supply is measured from the plan
Readiness SHALL measure unused eligible supply as every admitted, planner-projectable Experience in scope that the provisional plan did not schedule, excluding children that are not their own visit unit (SUB_FEATURE_OF, PARENT_NOT_ADMITTED, AMBIGUOUS_PARENT_RELATIONSHIP), whether the planner rejected it (with its typed rejection reasons) or it was not offered to the planner. Residual capacity and whether it is meaningful SHALL be taken from the planner's own output.

#### Scenario: Rejected and unoffered candidates
- **WHEN** the planner rejected 29 pooled candidates and 2,526 admitted candidates were not in its pool
- **THEN** unused eligible supply includes all of them, with rejection reasons for the 29

### Requirement: The limiting resource is identified from evidence
When a provisional plan leaves meaningful residual capacity, readiness SHALL return limiting resource PLANNER_FEASIBILITY when the summed durations of unused eligible supply are at least that residual, and CANDIDATE_SUPPLY otherwise, without any additional numeric threshold. With no meaningful residual it SHALL be NONE.

#### Scenario: Large admitted pool, walking limits leave time unused
- **WHEN** 2,571 eligible single-place Experiences exist, the plan leaves several hours unused per day and the unscheduled candidates were rejected for daily and continuous walking limits
- **THEN** the limiting resource is PLANNER_FEASIBILITY

#### Scenario: Small destination with every place scheduled
- **WHEN** every eligible Experience is scheduled and a requested day still has meaningful residual capacity
- **THEN** the limiting resource is CANDIDATE_SUPPLY

#### Scenario: Pool size does not change a feasibility-limited plan
- **WHEN** re-planning with a wider pool drawn from the existing catalog yields the same schedule and the same rejection reasons
- **THEN** the limiting resource stays PLANNER_FEASIBILITY and no acquisition is requested

### Requirement: Planner feasibility is never insufficient knowledge
When the limiting resource is PLANNER_FEASIBILITY, readiness SHALL return PLANNER_LIMITED with a typed planner feasibility diagnostic, SHALL NOT return INSUFFICIENT_KNOWLEDGE and SHALL NOT emit any acquisition gap for that residual.

#### Scenario: Planner-limited request
- **WHEN** enough eligible candidates exist but travel-time, opening-hours, day-duration or walking constraints prevent scheduling more
- **THEN** readiness returns PLANNER_LIMITED with the planner feasibility diagnostic, no acquisition runs, and Tour composition proceeds

#### Scenario: Missing duration knowledge
- **WHEN** selected places lack visit-duration knowledge and are planned with the fallback
- **THEN** the verdict follows the limiting-resource rules unchanged and no gap, acquisition or INSUFFICIENT_KNOWLEDGE results from the missing durations

#### Scenario: Unknown hours under the default policy
- **WHEN** a usable Tour is produced and several scheduled visits are marked OPENING_HOURS_UNKNOWN
- **THEN** the verdict follows the limiting-resource rules unchanged, the uncertain visits are counted in the planning diagnostic, and no gap, acquisition, research or INSUFFICIENT_KNOWLEDGE results from them

#### Scenario: Strict UNKNOWN opening-hours policy
- **WHEN** the UNKNOWN opening-hours policy is EXCLUDE and the excluded candidates' durations would cover the residual
- **THEN** readiness returns PLANNER_LIMITED with OPENING_HOURS_UNKNOWN_EXCLUDED in the diagnostic, and no acquisition, research or opening-hours lookup runs

#### Scenario: Routing partly unavailable
- **WHEN** a Tour is produced but some eligible candidates were rejected with TRAVEL_ESTIMATE_UNAVAILABLE
- **THEN** those candidates count as unused eligible supply with that reason, the limiting resource never becomes CANDIDATE_SUPPLY because of them, and no acquisition or research is triggered

### Requirement: PLANNER_LIMITED is a first-class verdict
PLANNER_LIMITED SHALL be a distinct explicit verdict, never READY plus a flag or secondary field. It SHALL mean that a usable Tour was produced, eligible candidate supply is sufficient, no structured acquisition is required, and the material remaining capacity is explained by typed planner constraints. It SHALL NOT mean missing knowledge, insufficient provider coverage, acquisition need or failed generation.

#### Scenario: Consumer distinguishes verdicts
- **WHEN** two Tours are produced, one with no meaningful residual and one with meaningful residual explained by OPENING_HOURS and WALKING_LIMIT rejections while supply is sufficient
- **THEN** the first carries READY and the second PLANNER_LIMITED as explicit verdict values, without the consumer inspecting planner internals

### Requirement: READY versus PLANNER_LIMITED uses planner evidence only
Readiness SHALL return READY when the planner reports no meaningful residual capacity under the active planning policy, and PLANNER_LIMITED when meaningful residual remains and unused eligible supply is sufficient. The distinction SHALL use only the planner's feasibility result, its meaningful-residual judgement, its typed unscheduled diagnostics and the supply accounting, with no additional numeric threshold.

#### Scenario: Residual judged not meaningful
- **WHEN** a day ends with residual time the planner judges not meaningful and some eligible candidates were DOMINATED_BY_HIGHER_UTILITY_PLAN
- **THEN** readiness returns READY

### Requirement: Zero scheduled is never PLANNER_LIMITED
When eligible supply is sufficient but the planner schedules no activity, readiness SHALL NOT return PLANNER_LIMITED; generation SHALL end with the PLANNER_INFEASIBLE outcome, its typed planner diagnostics and no Tour.

#### Scenario: Every candidate rejected
- **WHEN** every eligible candidate is rejected by planner constraints
- **THEN** the outcome is PLANNER_INFEASIBLE, not PLANNER_LIMITED with an empty Tour

### Requirement: Planner feasibility diagnostic content
The planner feasibility diagnostic SHALL contain residual capacity per day, the number of unused eligible candidates, their typed planner rejection reasons aggregated by reason, walking diagnostics, the travel modes used, the routing provider(s) and unavailable estimates per mode, the UNKNOWN opening-hours policy and its exclusions, the constraint snapshot and the number of candidates not offered to the planner. Readiness SHALL read the reasons from planner output, not re-derive them.

#### Scenario: Reasons come from the planner
- **WHEN** the planner rejected candidates for WALKING_LIMIT and OPENING_HOURS
- **THEN** the diagnostic aggregates exactly those reasons as reported by the planner

### Requirement: Planner-limited evidence is retained
A PLANNER_LIMITED verdict SHALL additionally retain the identities of unused eligible candidates with their typed reasons and evidence (travel-mode and travel-time, opening-hours and walking/mobility constraints where relevant) and the planner policy versions.

#### Scenario: Explaining one unused landmark
- **WHEN** a consumer inspects a PLANNER_LIMITED result
- **THEN** it can list each unused eligible candidate with its typed reasons and the planner policy versions in force

### Requirement: Capacity gaps require exhausted candidate supply
SCHEDULE_CAPACITY SHALL be emitted only when the limiting resource is CANDIDATE_SUPPLY, and never with a PLANNER_LIMITED verdict. It SHALL be routed only to structured acquisition of additional admissible candidates, never to semantic research. Residual time alone SHALL NOT emit it. The capacity classification (limiting resource, residual, unused eligible supply) SHALL be recorded with the gap outcome.

#### Scenario: Not enough places for three days
- **WHEN** admitted places fill only one of three requested days and every eligible place is already scheduled
- **THEN** readiness emits PLACE_CANDIDATES or SCHEDULE_CAPACITY routed to structured providers, not semantic research

#### Scenario: Reuse request on a sufficient catalog
- **WHEN** the same request runs again on a catalog whose unused eligible supply exceeds the residual
- **THEN** no SCHEDULE_CAPACITY gap is emitted and no discovery provider is called

### Requirement: Product-dependent semantic gaps are explicit
A semantic gap SHALL be a core gap only when the requested product itself depends on semantic meaning (for example a requested walking-corridor Experience). Such gaps SHALL name the product that needs them.

#### Scenario: Walking experience requested
- **WHEN** the request includes the walking experience-format facet and corridor walks require WALKING_CORRIDOR assertions
- **THEN** a WALKING_CORRIDOR_RELEVANCE gap may be emitted for the corridor product, and its outcome does not affect single-place Experience eligibility

#### Scenario: Walking allowed only as transport
- **WHEN** the request allows walking as a transportation mode but includes no walking experience-format facet
- **THEN** no corridor gap is emitted

### Requirement: Canonical gap keys
A gap key SHALL be composed of the gap type, the canonical scope identity and the canonical facet key where the gap type has one. Gap keys SHALL NOT contain free text, user identity or request-specific scores.

#### Scenario: Synonymous user wording
- **WHEN** two requests express the same interest with different wording that maps to the same canonical facet
- **THEN** readiness produces the same gap key for both

### Requirement: Recursive evaluation after writes
After any catalog write, readiness SHALL be re-evaluated on a fresh snapshot.

#### Scenario: Places acquired
- **WHEN** structured discovery admits new places
- **THEN** the next readiness evaluation uses them in the provisional plan

### Requirement: Insufficient knowledge is explicit
Readiness SHALL return INSUFFICIENT_KNOWLEDGE only when the limiting resource is CANDIDATE_SUPPLY and no authorized structured acquisition strategy remains, listing the limitations, the provider outcomes and the planner rejections of the unused candidates it saw.

#### Scenario: Structured providers exhausted
- **WHEN** structured discovery returned too few admissible places, every eligible place is scheduled, and no further structured source is authorized
- **THEN** readiness returns INSUFFICIENT_KNOWLEDGE with the provider outcomes, not READY

#### Scenario: Structured providers exhausted but planner-limited
- **WHEN** no further structured source is authorized and unused eligible supply exceeds the residual
- **THEN** readiness returns PLANNER_LIMITED, not INSUFFICIENT_KNOWLEDGE
