# Spec Delta

## Purpose

Supplies the planner with travel estimates between activities through the
existing travel-estimate provider abstraction, backed by a routing/directions
provider, for every allowed mode. The estimator estimates; the planner
chooses the mode (tour-planning). When routing is unavailable the condition
is explicit and fails the affected feasibility decision; travel times are
never fabricated.

## ADDED Requirements

### Requirement: Per-mode estimation contract
Travel estimation SHALL accept an origin, a destination, a requested mode and, where the provider supports time-dependent estimates, a departure time, and SHALL return ESTIMATE_AVAILABLE (duration, distance where available, walking portion including access and egress, provider), MODE_UNAVAILABLE for that pair, or PROVIDER_UNAVAILABLE. Estimation SHALL be requestable for every allowed mode of a leg. Providers SHALL NOT choose the travel mode.

#### Scenario: Two allowed modes
- **WHEN** a leg is estimated with walking and public transport allowed
- **THEN** the planner receives one result per mode, each with its own duration, walking portion and provider, and no provider has selected between them

#### Scenario: Mode not served for a pair
- **WHEN** the routing provider returns no public-transport route between two points
- **THEN** public transport for that leg is MODE_UNAVAILABLE, not estimated from a speed constant

### Requirement: Provider-backed estimates only
Travel-time decisions SHALL come only from a configured routing/directions provider behind the travel-estimate abstraction, supporting at least walking and one non-walking urban mode. The concrete provider is a configuration choice. No network-free, speed-based, wait-time, access-time or destination-specific estimate SHALL be used in production planning.

#### Scenario: Routed estimates
- **WHEN** a routing provider is configured and reachable
- **THEN** every leg estimate used by the plan names the routing provider that produced it

#### Scenario: Provider unavailable
- **WHEN** the routing provider returns PROVIDER_UNAVAILABLE for a leg
- **THEN** no substitute estimate is computed for that leg

### Requirement: Partial mode availability
When some allowed modes are MODE_UNAVAILABLE or PROVIDER_UNAVAILABLE for a leg, the planner SHALL continue with the provider-backed estimates of the remaining allowed modes and SHALL record the unavailable modes. A leg SHALL be unevaluable only when no allowed mode has a usable estimate. Not every routing mode SHALL be required to be available.

#### Scenario: Transit unavailable, walking available
- **WHEN** public transport is MODE_UNAVAILABLE for a leg and walking has a provider-backed estimate within the walking limits
- **THEN** the leg can be planned on foot and the public-transport unavailability is recorded

#### Scenario: No usable mode for a leg
- **WHEN** every allowed mode of a required leg is unavailable
- **THEN** the leg is not treated as feasible and the affected candidate carries TRAVEL_ESTIMATE_UNAVAILABLE

### Requirement: Routing outage fails explicitly
When routing unavailability prevents the planner from producing a valid itinerary, generation SHALL end with the explicit travel-estimation-unavailable outcome, its typed planner diagnostics and no Tour. It SHALL NOT be reported as NEEDS_ACQUISITION, INSUFFICIENT_KNOWLEDGE, missing POI coverage or missing tourism knowledge.

#### Scenario: Full provider outage
- **WHEN** the routing provider is unavailable for every leg of a request
- **THEN** generation returns the travel-estimation-unavailable outcome, persists no Tour, and no acquisition or research is triggered

### Requirement: Required traversals are respected
Routing SHALL be free between unconstrained components and between Experiences, and SHALL NOT replace a required bounded traversal of a ROUTE with a different path. A provider output that does not follow the segment SHALL yield CONSTRAINT_UNSATISFIED; when no estimate is available the traversal SHALL be TRAVEL_ESTIMATE_UNAVAILABLE; its time SHALL NOT be derived from distance and speed.

#### Scenario: Shorter parallel street
- **WHEN** a provider's fastest walking path between the Defensa bounds uses a parallel street
- **THEN** that path is not used for the required traversal, and only an estimate along the Defensa segment is accepted

### Requirement: Constrained traversal estimation
Estimating a required bounded traversal SHALL take the mode and the stored segment geometry with its version and SHALL return ESTIMATE_AVAILABLE with duration, distance, the validated output geometry, provider, provider API and version and traversal geometry version, or MODE_UNAVAILABLE, PROVIDER_UNAVAILABLE or CONSTRAINT_UNSATISFIED. Endpoint-only routing SHALL NOT count as a traversal estimate.

#### Scenario: Car through a pedestrian street
- **WHEN** a drive traversal of a street segment closed to cars is requested and the provider's match leaves the segment
- **THEN** the outcome is CONSTRAINT_UNSATISFIED for drive

#### Scenario: Bicycle validity is evaluated for bicycle
- **WHEN** a required traversal accepted on foot is requested for bicycle and the provider's bicycle output leaves the segment
- **THEN** the outcome is CONSTRAINT_UNSATISFIED for bicycle, and the walking result is not reused as a bicycle estimate

### Requirement: Deterministic traversal validation
Compliance of a provider output with a required segment SHALL be decided by a versioned, deterministic geometric validator using coverage of the segment by the output, the fraction of the output on the segment, a symmetric distance bound, no backtracking and, where available, unmatched provider points. Language models, street-name strings and manual inspection SHALL NOT decide it.

#### Scenario: Empty match
- **WHEN** a provider returns an empty or near-empty match for the segment
- **THEN** the validator rejects it because the segment is not covered, even though no output lies off the segment

### Requirement: Validator tolerances are calibrated and fail closed
The validator's tolerances SHALL be derived from a recorded calibration dataset of labelled positive and negative real traversals from several destinations and providers, SHALL be recorded with the dataset version, SHALL produce no known false positive on that dataset, and SHALL be recalibrated with a new dataset version when a provider or geometry source changes. Undeterminable compliance SHALL be CONSTRAINT_UNSATISFIED.

#### Scenario: Reversed traversal
- **WHEN** a provider output follows the required segment's streets in the opposite order
- **THEN** it is CONSTRAINT_UNSATISFIED although it coincides with the segment geometrically

#### Scenario: San Telmo contract case
- **WHEN** Defensa from Chile to Humberto I is map-matched on foot by either evaluated provider
- **THEN** the output is accepted as a valid required traversal

### Requirement: Bulk pair estimation
The planner SHALL obtain pair costs for many origins and destinations through a provider-neutral bulk contract (sources, targets, mode, optional departure time) returning a typed outcome per pair. Chunking, vendor size and rate limits, billing units and batching SHALL be adapter concerns; the planner SHALL request only the pair shape it needs.

#### Scenario: Pool larger than a vendor's matrix limit
- **WHEN** the planner requests costs among 50 candidates from a provider limited to 25 coordinates per request
- **THEN** the adapter splits the request and the planner receives one outcome per pair without seeing the vendor limit

### Requirement: Estimate provenance includes provider API and traffic model
Every estimate SHALL record the provider, the provider API used (for example routing, matrix or map matching), its version and, for motorized modes, the traffic model (free-flow, typical or predicted). Estimates from different providers or APIs SHALL NOT be mixed within one plan without that provenance.

#### Scenario: Same path, different APIs
- **WHEN** a provider's map-matching and routing APIs return different durations for the same 521 m walk
- **THEN** each estimate records which API produced it, and the plan records which one it used

### Requirement: Routing data attribution and provider terms
Legs, routes and travel times shown to users SHALL carry the routing data's required attribution (OpenStreetMap, plus the routing provider's attribution where its plan or API requires it). Persisted estimates, cached pair costs and recordings SHALL keep the provider's attribution metadata when the provider returns it. Persisting or caching a provider's results in production SHALL require a recorded verification of that provider's terms.

#### Scenario: Tour itinerary shows data attribution
- **WHEN** a Tour's legs or map computed from OpenStreetMap-based routing are displayed on web, iOS or Android
- **THEN** an OpenStreetMap attribution with a path to its licence is visible, and the provider's attribution is shown where required

#### Scenario: Unverified storage terms
- **WHEN** a provider's terms for persisting its results have not been verified
- **THEN** production wiring does not persist or cache that provider's results

### Requirement: Degraded estimation requires a separate approved policy
Degraded or network-free travel estimation SHALL NOT be enabled in production. It MAY be introduced only by a separately approved, evidence-calibrated policy that defines its calibration, uncertainty bounds where possible, policy/version provenance, conditions of use and the marking of degraded plans.

#### Scenario: No approved policy
- **WHEN** no degraded-estimation policy has been approved
- **THEN** no planner leg is ever estimated without a routing-provider result

### Requirement: Leg exposure
Every planned leg SHALL expose origin, destination, chosen mode, estimated duration, estimated distance where available, walking portion, the routing provider and a typed selection reason; the other allowed modes evaluated for that leg SHALL be retained with their result or rejection reason (for example WALKING_LIMIT, SLOWER, MODE_UNAVAILABLE, PROVIDER_UNAVAILABLE). Planner diagnostics SHALL count legs per mode and unavailable estimates per mode.

#### Scenario: Explaining an unscheduled landmark
- **WHEN** an admitted landmark is not scheduled
- **THEN** the planner diagnostic shows its rejection reason and the modes and estimates of the legs evaluated for it

### Requirement: Reproducible estimates from recorded routing
Estimates used by a plan SHALL be recordable and replayable from a real routing source so that the same planning input with the same recordings yields the same estimates. Recorded responses SHALL keep their provider, mode and departure time where used, and SHALL be test fixtures, never degraded estimates.

#### Scenario: Replay with zero live calls
- **WHEN** a recorded planning input is replayed against its routing recordings
- **THEN** no live routing call is made and every leg estimate is identical

### Requirement: Travel estimation never decides knowledge sufficiency
Travel estimates, mode availability and routing outages SHALL feed only planner feasibility and planning outcomes. A candidate rejected because of travel feasibility or unavailable estimates SHALL count as unused eligible supply for readiness, never as missing knowledge.

#### Scenario: Distant admitted museum
- **WHEN** an admitted museum is unreachable within the day's travel constraints
- **THEN** readiness counts it as unused eligible supply rejected for TRAVEL_TIME or WALKING_LIMIT
