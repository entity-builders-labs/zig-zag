# Spec Delta

## Purpose

Derives schedulable Experiences from grounded destination knowledge only when
the unit has request-independent identity, so that L4 grows with knowledge
and never with the number of requests.

## ADDED Requirements

### Requirement: Stable identity key
A reusable Experience SHALL be identified by its unit kind and the constitutive anchors that kind declares (canonical GeoEntity identities and corridor segment bounds), plus one canonical facet key only for kinds whose justification is facet-specific. The key SHALL NOT include user, scores, days, neighbouring Experiences, policy version or any language model selection.

#### Scenario: Different requests
- **WHEN** two different requests lead to composition over the same L1/L2 knowledge
- **THEN** they observe the same set of reusable Experience keys

### Requirement: Supported unit kinds
Reusable composition SHALL support PLACE_VISIT keyed by one PLACE GeoEntity and CORRIDOR_WALK keyed by a base ROUTE GeoEntity plus its segment bounds. Other kinds SHALL NOT be admitted without a declared key, admission rule and content derivation.

#### Scenario: Corridor walk key
- **WHEN** a grounded WALKING_CORRIDOR exists for Defensa between Plaza de Mayo and Parque Lezama
- **THEN** exactly one CORRIDOR_WALK exists whose key is the Defensa route identity and those two bounds

### Requirement: Admission justified by assertions
A reusable Experience SHALL exist only while its kind's admission rule holds over L2. PLACE_VISIT requires an active RELEVANT_FOR or NOTABLE_WITHIN assertion on the place; CORRIDOR_WALK requires a grounded WALKING_CORRIDOR on its segment. When the rule stops holding the Experience SHALL be archived.

#### Scenario: Corridor assertion retracted
- **WHEN** the WALKING_CORRIDOR assertion for a segment is retracted
- **THEN** the corresponding CORRIDOR_WALK is archived and offered to no new Tour

### Requirement: Content is derived, not identity
Stops, intrinsic order, duration, footprint, name, description and embedding SHALL be a deterministic function of the key's anchors, the L2 snapshot and the composition policy version. A change in derived content SHALL produce a new content revision of the same Experience.

#### Scenario: New stop along a corridor
- **WHEN** a new place with a grounded relevance assertion is recorded along the Defensa segment
- **THEN** the existing CORRIDOR_WALK gains a content revision including the stop and keeps its key

#### Scenario: Policy version bump
- **WHEN** the composition policy version changes
- **THEN** existing Experiences are recomposed in place and no duplicate Experience is created

### Requirement: Deterministic composition without model choice
Reusable composition SHALL NOT use a language model to choose components, stops or order. Corridor stops SHALL be ordered by their position along the segment from its canonical start.

#### Scenario: Repeated composition
- **WHEN** reusable composition runs twice over the same snapshot and policy version
- **THEN** it produces identical keys and identical content

### Requirement: Bounded by knowledge
The number of reusable Experiences SHALL be bounded by the admitted L2 subjects for each kind, and SHALL NOT increase as a result of generating Tours.

#### Scenario: Many Tours, no new knowledge
- **WHEN** several Tours are generated for a destination without new L2 writes
- **THEN** the set of reusable Experiences for that destination is unchanged

### Requirement: Planner-compatible units
Each reusable Experience SHALL be projectable into the existing planner candidate contract with a derived duration, a spatial footprint (POINT for PLACE_VISIT, LINE with segment geometry for CORRIDOR_WALK), ordered component footprints, and opening hours that remain explicitly unknown when not known.

#### Scenario: Corridor walk planned as a line
- **WHEN** a CORRIDOR_WALK is offered to the planner
- **THEN** its start and end footprints are the segment ends and its internal routing follows its ordered stops
