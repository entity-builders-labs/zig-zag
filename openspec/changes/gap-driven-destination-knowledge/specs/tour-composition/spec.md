# Spec Delta

## Purpose

Selects and arranges Experiences for one user's request and freezes
that request-specific composition only in the Tour, never in the catalog.

## ADDED Requirements

### Requirement: Selection only among offered Experiences
Tour composition SHALL select only Experiences present in the final catalog snapshot. A language model MAY rank or select among offered Experience identities but SHALL NOT introduce units, components, coordinates or durations.

#### Scenario: Model returns an unknown identity
- **WHEN** a selection includes an identity that was not offered
- **THEN** the whole selection is rejected and no part of it is salvaged into a plan

### Requirement: Structured prominence orders valid Experience candidates
Experience candidate ordering SHALL consume canonical GeoEntity prominence per `structured-catalog-prominence`, only for otherwise valid candidates. It SHALL remain request-specific and SHALL NOT alter identity, visit unit, admission, preference relevance, planning readiness or reusable Experience state. UNKNOWN SHALL NOT be negative evidence.

#### Scenario: Low-prominence Experience remains valid
- **WHEN** a valid Experience has UNKNOWN or lower prominence than another valid candidate
- **THEN** it may rank lower for the request but remains in the valid candidate set and is not rejected or removed from the catalog

#### Scenario: Preference relevance remains separate
- **WHEN** request-specific selection combines catalog prominence with user preference relevance
- **THEN** the two signals remain separately typed and traceable, and preference relevance never changes admission

### Requirement: Request-specific composition stays in the Tour
Selection, stop trimming, day assignment, ordering and travel between Experiences for one request SHALL be persisted only in the Tour snapshot, and SHALL NOT create or modify catalog Experiences.

#### Scenario: Four-day selection
- **WHEN** a Tour combines a San Telmo corridor walk, Recoleta places and a food stop across four days
- **THEN** that combination exists only in the Tour snapshot and the catalog gains no Experience for it

### Requirement: Optional stop trimming is a snapshot decision
When an Experience marks components as optional (`required` false), Tour composition MAY omit them to fit the plan, and the omission SHALL appear only in that Tour's component snapshot.

#### Scenario: Time-constrained corridor walk
- **WHEN** a Tour omits one optional component of a walking Experience to fit a day
- **THEN** the Tour snapshot lists the remaining stops and the catalog Experience content is unchanged

### Requirement: Deterministic planning on the final snapshot
Selection, day assignment, ordering, visit times, travel modes and feasibility SHALL be decided by the deterministic planner (tour-planning) over candidates projected from the final catalog snapshot of the generation.

#### Scenario: Knowledge added mid-generation
- **WHEN** research and grounding added knowledge during the generation
- **THEN** the plan is computed from candidates projected from a snapshot read after the last write

### Requirement: No silent empty Tour
When readiness returns INSUFFICIENT_KNOWLEDGE or the final snapshot offers no schedulable Experience, generation SHALL return an explicit insufficient-knowledge outcome listing the limitations instead of an empty Tour. When some units exist, the Tour SHALL carry the remaining limitations.

#### Scenario: Nothing grounded
- **WHEN** a generation ends with no eligible Experiences
- **THEN** it returns INSUFFICIENT_KNOWLEDGE with the limitations and persists no Tour

### Requirement: Explicit planning outcomes instead of an empty Tour
When the eligible supply is sufficient but the planner schedules nothing, generation SHALL return PLANNER_INFEASIBLE with the planner feasibility diagnostic. When routing unavailability prevents a valid itinerary, generation SHALL return the explicit travel-estimation-unavailable outcome. Neither SHALL persist a Tour or be reported as missing knowledge.

#### Scenario: Routing down under FAIL policy
- **WHEN** the routing provider is unavailable for the legs the itinerary requires
- **THEN** generation returns the travel-estimation-unavailable outcome and persists no Tour

#### Scenario: Supply present, nothing schedulable
- **WHEN** many eligible single-place Experiences exist but every one is rejected by planner constraints
- **THEN** generation returns PLANNER_INFEASIBLE with the planner feasibility diagnostic and persists no empty Tour

### Requirement: Tour snapshot keeps the planning evidence
The Tour snapshot SHALL persist the planner's scheduled-activity output (identity, day, planned start and end, duration and provenance, opening window or UNKNOWN with provenance, incoming leg with mode, estimate and routing provider), its per-day summaries, its policy versions and the routing provider(s) used.

#### Scenario: Leg provenance in a Tour
- **WHEN** a Tour leg is inspected
- **THEN** its snapshot names the routing provider that produced its estimate

#### Scenario: Fallback duration in a Tour
- **WHEN** a scheduled component's duration came from the fallback policy
- **THEN** the Tour snapshot records durationSource FALLBACK_POLICY with the policy and rule versions and the minutes used, distinguishable from evidence-backed durations

#### Scenario: Uncertain opening hours in a Tour
- **WHEN** a scheduled visit's opening hours were UNKNOWN under the default PENALIZE policy
- **THEN** the Tour snapshot records opening-hours status UNKNOWN for that component with the policy version and no opening window

### Requirement: Planner-limited Tours carry their diagnostic
When readiness returns PLANNER_LIMITED, Tour composition SHALL produce the Tour from the schedulable units and attach the planner feasibility diagnostic, without further acquisition. The Tour SHALL carry its readiness verdict as an explicit state (READY or PLANNER_LIMITED for a produced Tour), never derived from unused time.

#### Scenario: Days end early because of walking limits
- **WHEN** a 3-day Tour leaves time unused because unscheduled candidates exceed walking limits
- **THEN** the Tour is produced and carries a planner feasibility diagnostic, not an insufficient-knowledge limitation

### Requirement: Un-enriched admitted places are composable
Tour composition SHALL accept single-place Experiences of admitted GeoEntities that carry no enrichment, using their structured provider data for naming, location and category.

#### Scenario: Structured-only Tour
- **WHEN** every offered single-place Experience lacks narratives and thematic assertions
- **THEN** a Tour is composed from them and presented with structured data
