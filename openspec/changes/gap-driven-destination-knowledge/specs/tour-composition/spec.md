# Spec Delta

## Purpose

Selects and arranges reusable Experiences for one user's request and freezes
that request-specific composition only in the Tour, never in the catalog.

## ADDED Requirements

### Requirement: Selection only among offered reusable Experiences
Tour composition SHALL select only reusable Experiences present in the final catalog snapshot. A language model MAY rank or select among offered Experience identities but SHALL NOT introduce units, components, coordinates or durations.

#### Scenario: Model returns an unknown identity
- **WHEN** a selection includes an identity that was not offered
- **THEN** the whole selection is rejected and no part of it is salvaged into a plan

### Requirement: Request-specific composition stays in the Tour
Selection, stop trimming, day assignment, ordering and travel between Experiences for one request SHALL be persisted only in the Tour snapshot, and SHALL NOT create or modify catalog Experiences.

#### Scenario: Four-day selection
- **WHEN** a Tour combines a San Telmo corridor walk, Recoleta places and a food stop across four days
- **THEN** that combination exists only in the Tour snapshot and the catalog gains no Experience for it

### Requirement: Optional stop trimming is a snapshot decision
When a reusable Experience's derived content marks stops as optional, Tour composition MAY omit them to fit the plan, and the omission SHALL appear only in that Tour's component snapshot.

#### Scenario: Time-constrained corridor walk
- **WHEN** a Tour omits one optional stop of a CORRIDOR_WALK to fit a day
- **THEN** the Tour snapshot lists the remaining stops and the catalog Experience content is unchanged

### Requirement: Deterministic planning on the final snapshot
Day assignment, ordering, routing and feasibility SHALL be decided by the deterministic planner over candidates projected from the final catalog snapshot of the generation.

#### Scenario: Knowledge added mid-generation
- **WHEN** research and grounding added knowledge during the generation
- **THEN** the plan is computed from candidates projected from a snapshot read after the last write
