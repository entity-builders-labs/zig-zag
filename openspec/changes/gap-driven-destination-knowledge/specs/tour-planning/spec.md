# Spec Delta

## Purpose

Turns an eligible set of Experiences into the best feasible
multi-day itinerary for one request. The planner decides jointly which
candidates are scheduled, on which day, in which order, at which times and
with which travel mode between consecutive activities, under hard
feasibility constraints, and explains every eligible candidate it did not
schedule. Ranking says how desirable a candidate is; planning says which
desirable candidates can form the best feasible itinerary.

## ADDED Requirements

### Requirement: Planner responsibility is joint itinerary construction
Given an eligible set of Experiences, a requested number of days, candidate utility, visit durations, opening-hours knowledge, travel estimates, user schedule constraints and mobility constraints, the planner SHALL decide jointly the selected candidates, the day of each selected candidate, the visit order within each day, the planned start and end of each visit and the travel mode of each leg. Selection SHALL NOT be fixed by ranking order before feasibility is evaluated.

#### Scenario: Highly ranked candidate moved to another day
- **WHEN** the highest-utility candidate is closed on day 1 and open on day 2 of a 2-day request
- **THEN** the planner schedules it on day 2 instead of omitting it or scheduling it on day 1

#### Scenario: Highly ranked candidate omitted
- **WHEN** a high-utility candidate cannot be reached within any day's constraints
- **THEN** it is not scheduled and carries a typed planner rejection reason, and the remaining itinerary is still built

### Requirement: Planning is separate from ranking, admission and acquisition
The planner SHALL consume candidate utility as an input and SHALL NOT discover POIs, resolve entity identity, decide admission, run research, call language models or generate narrative. Planner outcomes SHALL NOT modify a candidate's admission, identity, ranking inputs or catalog content, and SHALL NOT be used as evidence that more tourism knowledge is required.

#### Scenario: Rejected landmark stays admitted
- **WHEN** an admitted museum is rejected by the planner for opening hours in one generation
- **THEN** its admission evaluation, its Experience's identity and catalog content are unchanged and it remains eligible for the next request

#### Scenario: Ordinary planning makes no research call
- **WHEN** a Tour is planned from single-place Experiences of admitted structured GeoEntities
- **THEN** the planning stage makes zero LLM, web-search and page-fetch calls

### Requirement: Planner candidates are Experiences
The planner SHALL be offered only eligible Experiences, one candidate per Experience; a VISIT component SHALL reference a GeoEntity that is its own visit unit. Children classified CHILD_REQUIRES_PARENT_VISIT (SUB_FEATURE_OF or PARENT_NOT_ADMITTED) and children with AMBIGUOUS_PARENT_RELATIONSHIP SHALL NOT be visited as their own Experience; independently visitable admitted children MAY be.

#### Scenario: Museum then tomb
- **WHEN** a destination has an admitted museum and tombs that require a cemetery visit
- **THEN** no itinerary can contain an individual tomb as a stop; only the cemetery's Experience can represent them

### Requirement: Composite Experiences are one candidate
A composite Experience SHALL be scheduled as one planner candidate. The planner MAY decide whether it is selected, its day, its start and its position among other Experiences, and SHALL NOT flatten it into independent candidates, reorder or drop its required components, or rewrite its internal composition.

#### Scenario: San Telmo walk in a plan
- **WHEN** the San Telmo walk is selected
- **THEN** it appears as one scheduled Experience whose components keep their order, and no component is scheduled separately

### Requirement: Composite internal timeline feasibility
A composite Experience SHALL be feasible only if its internal timeline — components in order, internal travel and required traversal time, component visit durations — reaches every internal PLACE component with known opening hours inside a valid opening window. One opaque candidate-level opening-hours value SHALL NOT suffice for a composite; a single-place Experience collapses to its one component's availability.

#### Scenario: Market closed at arrival
- **WHEN** a walk's internal timeline would reach its market component after the market closes
- **THEN** that start time is infeasible for the walk and the planner chooses another start, another day, or rejects the walk with OPENING_HOURS

### Requirement: Typed planning input per candidate
The planning input SHALL contain, for each candidate, its canonical Experience identity, utility from ranking, its ordered components with participation, each VISIT component's duration and opening-hours knowledge with provenance, each required traversal constraint, spatial footprints and any request-declared inclusion constraint. Invalid input SHALL be rejected, never defaulted.

#### Scenario: Missing duration provenance
- **WHEN** a candidate reaches the planner without a duration provenance
- **THEN** the input is rejected as invalid rather than defaulted

### Requirement: Typed planning input per request
The planning input SHALL contain the number of days, each day's calendar date and destination-local timezone, daily start and end times, optional user unavailable windows, allowed travel modes, maximum continuous walking, maximum daily walking and the versioned planner policies in force (objective, UNKNOWN opening-hours policy).

#### Scenario: Policies recorded
- **WHEN** a plan is produced
- **THEN** the objective and UNKNOWN opening-hours policy versions used are part of the recorded input

### Requirement: Opening hours are hard feasibility constraints
For every scheduled visit whose opening-hours knowledge for the planned date is KNOWN_OPEN_WINDOW, the complete visit interval SHALL lie inside one applicable opening window, and when a last-admission time is known the visit SHALL start no later than it. A candidate whose knowledge for the planned date is KNOWN_CLOSED SHALL never be scheduled on that date.

#### Scenario: Known-closed day
- **WHEN** a museum is known closed on Mondays and day 1 is a Monday
- **THEN** the museum is never scheduled on day 1

#### Scenario: Visit would run past closing
- **WHEN** a 90-minute visit could start at 17:00 and the place closes at 18:00
- **THEN** that start time is infeasible and the visit is either scheduled no later than 16:30 or not on that day

#### Scenario: Split opening windows
- **WHEN** a place opens 09:00-12:00 and 15:00-19:00 and the visit lasts 120 minutes
- **THEN** the visit is scheduled entirely inside one window, never spanning 12:00-15:00

#### Scenario: Last admission
- **WHEN** a place closes at 18:00 with last admission at 17:00 and the visit lasts 45 minutes
- **THEN** the visit never starts after 17:00

### Requirement: Opening hours are resolved per calendar date
Opening-hours knowledge SHALL be resolved per calendar date in the destination's local time, supporting day-specific hours, closed days, multiple windows per day and date-specific exceptions when available, with exceptions taking precedence over the regular weekly pattern.

#### Scenario: Date-specific exception
- **WHEN** a place's weekly pattern says open on a date for which a closure exception is known
- **THEN** the place is not scheduled on that date

### Requirement: Opening-hours knowledge is explicit
Opening-hours knowledge for a candidate on a date SHALL be one of KNOWN_OPEN_WINDOW (one or more windows), KNOWN_CLOSED or UNKNOWN, with its provenance. UNKNOWN SHALL NOT be treated as equivalent to open.

#### Scenario: No hours in the provider record
- **WHEN** a structured provider record carries no opening hours
- **THEN** the candidate's knowledge is UNKNOWN for every date, not an assumed all-day window

### Requirement: UNKNOWN opening hours follow a versioned planning policy
The treatment of UNKNOWN opening hours SHALL be a versioned planning policy chosen outside the optimizer, with the options ALLOW_WITH_UNCERTAINTY, PENALIZE and EXCLUDE; the default SHALL be PENALIZE. The policy and its version SHALL be recorded with the plan. UNKNOWN SHALL NOT be treated as open or closed and SHALL NOT be resolved by web or LLM research on the planning path.

#### Scenario: Exclude policy
- **WHEN** the policy is EXCLUDE and a candidate's hours are UNKNOWN
- **THEN** the candidate is not scheduled and carries the reason OPENING_HOURS_UNKNOWN_EXCLUDED

#### Scenario: Allow policy
- **WHEN** the policy is ALLOW_WITH_UNCERTAINTY and a candidate with UNKNOWN hours is scheduled
- **THEN** the scheduled visit is marked OPENING_HOURS_UNKNOWN with the policy version, and no research is triggered

### Requirement: Default PENALIZE semantics
Under PENALIZE, UNKNOWN hours SHALL create no opening-hours hard constraint, so a VISIT component with UNKNOWN hours is feasible on hours alone; it SHALL NOT override any other hard infeasibility. The objective SHALL include the soft term openingHoursUncertaintyPenalty over scheduled VISIT components with UNKNOWN hours; its weight and form belong to the objective policy.

#### Scenario: Comparable candidates
- **WHEN** candidate A is known open during its planned visit, candidate B has comparable utility and UNKNOWN hours, and only one fits
- **THEN** the planner may prefer A, B is not excluded for its hours, and if B is unscheduled its reason is DOMINATED_BY_HIGHER_UTILITY_PLAN

#### Scenario: Unknown hours become enrichment demand
- **WHEN** a scheduled visit is accepted with UNKNOWN hours
- **THEN** the generation does not wait, and deduplicated opening-hours enrichment demand is recorded for that GeoEntity

#### Scenario: Only unknown-hours candidates
- **WHEN** the remaining feasible candidates all have UNKNOWN hours
- **THEN** they are scheduled and each scheduled visit is marked OPENING_HOURS_UNKNOWN

### Requirement: UNKNOWN hours inside composites and must-include items
The UNKNOWN-hours policy SHALL apply per internal VISIT component of a composite; the Experience SHALL expose the set of its uncertain components rather than one candidate-level flag. A must-include Experience or component with UNKNOWN hours SHALL NOT be removed or given invented hours and SHALL be scheduled under the policy with its uncertainty surfaced.

#### Scenario: Market hours unknown in a walk
- **WHEN** the San Telmo walk's Mercado component has UNKNOWN hours and its other components fit their known windows
- **THEN** the walk is feasible, and its Mercado visit is marked OPENING_HOURS_UNKNOWN

#### Scenario: Internal component known closed
- **WHEN** an internal component of a composite is known closed at its planned internal arrival
- **THEN** that schedule of the composite is infeasible

#### Scenario: Must-include known closed throughout
- **WHEN** a must-include place is known closed on every feasible interval of the trip
- **THEN** the planner reports a constraint conflict with OPENING_HOURS instead of dropping it silently

### Requirement: Visit duration is an input with provenance
The planner SHALL consume each candidate's visit duration as normalized visit-duration knowledge projected into its input, with the winning authority class (STRUCTURED_PROVIDER, OFFICIAL_SITE, OFFICIAL_TOURISM_OR_INSTITUTIONAL, REFERENCE_TRAVEL, USER_GENERATED, GROUNDED_SYNTHESIS or FALLBACK_POLICY), resolution status and versions. The planner SHALL NOT discover, infer or research durations and SHALL NOT contain category-duration logic.

#### Scenario: Duration participates in scheduling
- **WHEN** two otherwise identical candidates have durations of 30 and 180 minutes and only 60 minutes remain in a day
- **THEN** only the 30-minute candidate can be scheduled in that remainder

#### Scenario: Fallback duration
- **WHEN** no structured or catalog duration exists for a candidate
- **THEN** the configured fallback policy supplies the duration, the visit is marked FALLBACK_POLICY with the policy version, and the Experience identity is unchanged

#### Scenario: Fallback inside a composite
- **WHEN** a walk's Mercado VISIT component has no duration knowledge and its Defensa TRAVERSE has a provider-backed estimate
- **THEN** only the Mercado visit uses the fallback (marked FALLBACK_POLICY), the traversal uses its routing estimate, and the walk stays one candidate

#### Scenario: Typical duration preferred
- **WHEN** a place's duration knowledge holds minimum 45, typical 90 and maximum 150 minutes
- **THEN** the planner input uses 90 minutes and records that the typical value was projected

### Requirement: Multi-day temporal feasibility
Each planned day SHALL start no earlier than the daily start time and end no later than the daily end time, SHALL not overlap user unavailable windows with visits or travel, and SHALL account for every visit duration and every travel leg between consecutive activities. Each selected candidate SHALL be scheduled at most once across all days.

#### Scenario: User unavailable window
- **WHEN** the user is unavailable 13:00-15:00 on day 2
- **THEN** no visit or travel leg on day 2 overlaps 13:00-15:00

#### Scenario: Travel time is part of feasibility
- **WHEN** two visits fit back to back without travel but the leg between them takes 40 minutes
- **THEN** the second visit starts no earlier than 40 minutes after the first ends

### Requirement: Optional day anchors
Each planned day MAY have an optional start anchor and end anchor (for example the traveller's hotel). When present, the leg from the start anchor to the first Experience and from the last Experience to the end anchor SHALL be planned like any other leg. When absent, no anchor SHALL be invented, first- and last-mile travel SHALL be excluded, and the plan SHALL record that exclusion.

#### Scenario: No anchors supplied
- **WHEN** a request supplies no start or end location
- **THEN** only legs between Experiences are estimated and the plan records that first- and last-mile travel is not included

#### Scenario: Hotel each day
- **WHEN** day 2 has a hotel as start and end anchor
- **THEN** day 2 includes the hotel → first Experience and last Experience → hotel legs within its time window

### Requirement: Mobility constraints are hard and affect mode choice
The planner SHALL respect the user's allowed travel modes, maximum continuous walking and maximum daily walking budget, counting every walking portion of every leg (including access and egress of non-walking legs). Walking limits SHALL shape mode choice and feasibility and SHALL NOT be reported as missing candidate knowledge.

#### Scenario: Walking only with distant candidates
- **WHEN** only walking is allowed and a candidate is beyond the walking limits from every feasible predecessor
- **THEN** the candidate is rejected with WALKING_LIMIT, and readiness treats it as unused eligible supply

### Requirement: Travel mode is a planner decision, not a default
For each leg the planner SHALL choose among the allowed modes for which a travel estimate exists, as part of the itinerary optimization, and SHALL NOT choose walking merely because walking is allowed. A non-walking mode SHALL be able to make geographically separated candidates feasible.

#### Scenario: Faster non-walking leg chosen
- **WHEN** walking and public transport are allowed, a leg is 50 minutes on foot and 15 minutes by public transport, and the walking leg would prevent scheduling another visit
- **THEN** the leg uses public transport

#### Scenario: Separated candidates become feasible
- **WHEN** two high-utility candidates are too far apart to walk within the walking limits and public transport is allowed with a feasible estimate
- **THEN** both can be scheduled on the same day connected by a public-transport leg

### Requirement: Hard constraints are never traded for utility
The planner SHALL maximize itinerary utility only over itineraries that satisfy every hard constraint: opening hours and closed days, day windows, user unavailable windows, visit durations, travel times, allowed modes, walking limits, at most one visit per candidate and request-declared inclusion constraints. No hard constraint SHALL be converted into an objective weight.

#### Scenario: High utility cannot buy a constraint violation
- **WHEN** scheduling a candidate past its closing time would raise total utility
- **THEN** the candidate is not scheduled past closing regardless of its utility

### Requirement: Versioned planner objective
Utility terms MAY include ranking utility, quality/notability, diversity and spatial coherence; cost terms MAY include travel time, idle time, geographic zig-zag, mode changes and UNKNOWN-hours penalties. The enabled terms and their weights SHALL be a versioned planner policy recorded with the plan.

#### Scenario: Objective change is versioned
- **WHEN** the weight of the travel-time cost changes
- **THEN** plans produced afterwards record a new objective policy version

### Requirement: Days are optimized jointly
For a multi-day request the planner SHALL assign candidates to days as part of one optimization across all days, not by filling day 1 to capacity before considering day 2.

#### Scenario: Better assignment across days
- **WHEN** greedily filling day 1 with nearby high-utility candidates leaves day 2 with only infeasible candidates, while a different split schedules more total utility on both days
- **THEN** the planner returns the split with the higher total utility

### Requirement: Deterministic planning
For identical planning inputs, identical travel-estimate recordings and identical policy versions, the planner SHALL return an identical itinerary and identical diagnostics. Any search budget SHALL be deterministic (not wall-clock dependent), and any randomness SHALL use a recorded fixed seed.

#### Scenario: Replay
- **WHEN** a recorded planning input is planned twice with the same recordings and policies
- **THEN** both outputs are byte-identical

### Requirement: Scheduled activity output
For each scheduled activity the planner output SHALL contain the canonical Experience identity, day, planned start, planned end, visit duration with provenance, the applied opening window or UNKNOWN with provenance, the incoming travel leg with its mode, duration, distance where available and routing provider, and the constraints that bound the visit.

#### Scenario: Explaining a scheduled visit
- **WHEN** a scheduled visit is inspected
- **THEN** its output shows the opening window it fits, its duration provenance and the incoming leg's mode and estimate provenance

### Requirement: Day and plan output
For each day the planner output SHALL contain used time, remaining time with the planner's meaningful-residual judgement, total travel time, total walking where available and that day's diagnostics. The plan SHALL record the policy versions, the routing provider(s) used, unavailable estimates per mode and the constraint snapshot it evaluated.

#### Scenario: Day summary
- **WHEN** a planned day is inspected
- **THEN** its used and remaining time, travel time and walking total are present without recomputation

### Requirement: Typed rejection diagnostics for every eligible unscheduled candidate
Every eligible candidate offered to the planner and not scheduled SHALL carry one or more typed reasons from: OPENING_HOURS, OPENING_HOURS_UNKNOWN_EXCLUDED, TRAVEL_TIME, TRAVEL_ESTIMATE_UNAVAILABLE, REQUIRED_TRAVERSAL_UNSATISFIED, DAILY_CAPACITY, WALKING_LIMIT, NO_ALLOWED_TRAVEL_MODE, VISIT_DURATION, USER_TIME_WINDOW, DOMINATED_BY_HIGHER_UTILITY_PLAN or OTHER_PLANNER_CONSTRAINT, with the evaluated evidence where applicable.

#### Scenario: Feasible but displaced
- **WHEN** a feasible candidate is not scheduled because a higher-utility itinerary uses its time
- **THEN** its reason is DOMINATED_BY_HIGHER_UTILITY_PLAN

#### Scenario: Routing unavailable for a candidate
- **WHEN** every allowed mode to and from a candidate is PROVIDER_UNAVAILABLE or MODE_UNAVAILABLE
- **THEN** the candidate is not scheduled, carries TRAVEL_ESTIMATE_UNAVAILABLE, and no leg to it is assumed feasible

#### Scenario: Diagnostics consumed by readiness
- **WHEN** readiness evaluates the provisional plan
- **THEN** it reads the typed reasons directly from the planner output without re-deriving them

### Requirement: Input errors and shortage are not feasibility reasons
Invalid planner input (duplicate identity, invalid footprint, invalid composite) SHALL be reported as input errors, separate from feasibility rejections. No planner reason SHALL be reported as candidate shortage or missing knowledge.

#### Scenario: Duplicate identity in the pool
- **WHEN** the same Experience identity is offered twice
- **THEN** it is reported as an input error and not as a feasibility rejection

### Requirement: Planner budget exhaustion is explicit
When the optimizer exhausts its search budget without producing any itinerary although the request may be feasible, generation SHALL report a planner failure distinct from PLANNER_INFEASIBLE and from every knowledge verdict, and SHALL persist no Tour; PLANNER_INFEASIBLE SHALL be reserved for proven or explicit constraint conflicts.

#### Scenario: Solver returns no solution in time
- **WHEN** the optimizer stops at its budget with no itinerary for a 30-candidate request
- **THEN** generation reports a planner budget failure, not PLANNER_INFEASIBLE and not INSUFFICIENT_KNOWLEDGE

### Requirement: Planner algorithm selected by evidence
The production optimizer SHALL be selected only after a recorded comparison of at least the current greedy planner, an established routing-with-time-windows approach and, where materially different and practical, a constraint-programming orienteering formulation, run on identical recorded inputs from several destinations. The selection SHALL be recorded with the evidence; correctness of hard constraints SHALL be a gate, not a weighted metric.

#### Scenario: Candidate violates opening hours
- **WHEN** an evaluated algorithm schedules any visit outside a known opening window on the recorded datasets
- **THEN** it is ineligible for selection regardless of its utility or speed

#### Scenario: Identical travel data for every algorithm
- **WHEN** the algorithms are compared for one destination
- **THEN** each consumes the same candidate set and replays the same recorded routing estimates, and none calls a routing provider live
