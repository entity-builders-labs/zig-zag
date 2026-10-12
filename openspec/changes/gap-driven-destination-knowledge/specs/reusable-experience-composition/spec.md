# Spec Delta

## Purpose

Composes Experiences — the only reusable schedulable tourism unit — from
canonical GeoEntities and grounded knowledge, using ExperienceComponents to
express how each GeoEntity participates, so that the set of Experiences
grows with knowledge and never with the number of requests. There is no
structural Experience kind.

## ADDED Requirements

### Requirement: Composition is the semantic axis
An Experience SHALL be described by its ordered ExperienceComponents, each referencing one canonical GeoEntity with a participation (at least VISIT or TRAVERSE), an order and required/optional semantics. No Experience kind or subtype SHALL be introduced; rules SHALL be stated against components, participation and the referenced GeoEntity's kind.

#### Scenario: Single-place Experience
- **WHEN** the admitted PLACE GeoEntity MALBA is composed
- **THEN** the result is one Experience with one required VISIT component referencing MALBA, and no other identity or kind exists for it

#### Scenario: Composite walk
- **WHEN** a San Telmo walk is composed from a required traversal of Calle Defensa followed by Mercado de San Telmo, Plaza Dorrego and Plaza de Mayo
- **THEN** it is one Experience with four ordered components: one TRAVERSE of the Defensa ROUTE GeoEntity and three VISIT components of PLACE GeoEntities

### Requirement: Bounded route traversal is component content
A TRAVERSE component of a ROUTE GeoEntity MAY carry a bounded-traversal constraint retaining the start and end boundaries, direction where relevant, provider-backed boundary coordinates, provider-backed segment geometry built only from ways the component's mode may traverse in that direction, and spatial provenance. The bounds SHALL NOT create a new GeoEntity.

#### Scenario: Cycle track with the street's name
- **WHEN** a street's name is also carried by a separately mapped cycle track along part of the required section
- **THEN** a walking traversal is built only from ways pedestrians may use in the required direction, never from the cycle track

#### Scenario: Same route, different segments
- **WHEN** one Experience traverses Defensa from Chile to Humberto Primo and another from Avenida de Mayo to Chile
- **THEN** both components reference the same canonical Calle Defensa GeoEntity and differ only in their traversal bounds

### Requirement: Stable composition identity
An Experience composed from catalog knowledge SHALL be identified for idempotent composition by a composition signature derived from its constitutive components (GeoEntity, participation and traversal bounds), plus one canonical facet key only where its justification is facet-specific. The signature SHALL NOT include an Experience kind, user, scores, days, neighbouring Experiences, policy version or any language-model selection.

#### Scenario: Different requests
- **WHEN** two different requests lead to composition over the same catalog knowledge
- **THEN** they observe the same set of Experience composition signatures

### Requirement: Eligibility follows component justifications
An Experience SHALL be eligible only when every required component's justification holds: a VISIT of a PLACE GeoEntity requires that GeoEntity's structured admission evaluation to be ADMITTED and the GeoEntity to be its own visit unit, with no L2 assertion; a required bounded TRAVERSE of a ROUTE justified by corridor meaning requires a grounded WALKING_CORRIDOR assertion on that segment. When a required justification stops holding, the Experience SHALL be archived.

#### Scenario: Admitted place without assertions
- **WHEN** a PLACE GeoEntity is structurally admitted and has no RELEVANT_FOR or NOTABLE_WITHIN assertion
- **THEN** exactly one single-place Experience exists for it

#### Scenario: Enrichment fails for an admitted place
- **WHEN** a relevance claim about an admitted GeoEntity is rejected
- **THEN** its single-place Experience remains active

#### Scenario: Corridor assertion retracted
- **WHEN** the WALKING_CORRIDOR assertion for a traversed segment is retracted
- **THEN** every Experience whose required TRAVERSE depends on it is archived and offered to no new Tour

### Requirement: Parent context and sub-features
A child GeoEntity classified CHILD_REQUIRES_PARENT_VISIT SHALL NOT have its own schedulable Experience and SHALL remain a canonical GeoEntity whose PART_OF relationship exposes it as sub-feature knowledge of its direct parent. Sub-feature knowledge SHALL be derived from that relationship, not copied into the parent's Experience; a child SHALL become an ExperienceComponent only when it participates in that Experience's composition.

#### Scenario: Parent site with sub-features
- **WHEN** an admitted cemetery has tombs recorded SUB_FEATURE_OF it
- **THEN** exactly one single-place Experience exists for the cemetery, the tombs are reachable as its sub-features through PART_OF, and no Experience is offered for the tombs

#### Scenario: Parent admitted later
- **WHEN** a parent site whose children were PARENT_NOT_ADMITTED becomes admitted
- **THEN** the children become its sub-features after re-evaluation, and no child ever had its own Experience

#### Scenario: Highlights are not required
- **WHEN** an admitted parent site has no recorded children or highlights
- **THEN** its single-place Experience exists and is schedulable

### Requirement: In-place updates keep identity
Changes to derived content, enrichment, visit-duration or opening-hours knowledge SHALL update an Experience in place without changing its identity or composition signature. No Experience content-revision history SHALL be required; Tour snapshots preserve what each Tour received.

#### Scenario: New stop along a traversed segment
- **WHEN** a new grounded stop is recorded along the Defensa segment of an existing walk
- **THEN** the walk keeps its identity and its components are updated in place

#### Scenario: Policy version bump
- **WHEN** the composition policy version changes
- **THEN** existing Experiences are recomposed in place and no duplicate Experience is created

### Requirement: Deterministic composition without model choice
Composition SHALL NOT use a language model to choose components, stops or order. Stops along a traversed segment SHALL be ordered by their position along the segment from its start boundary.

#### Scenario: Repeated composition
- **WHEN** composition runs twice over the same snapshot and policy version
- **THEN** it produces identical signatures and identical components

### Requirement: Bounded by knowledge
The number of composed Experiences SHALL be bounded by admitted PLACE GeoEntities that are their own visit unit (single-place Experiences) and grounded semantic subjects (for example justified route traversals), and SHALL NOT increase as a result of generating Tours.

#### Scenario: Many Tours, no new knowledge
- **WHEN** several Tours are generated for a destination without new catalog writes
- **THEN** the set of Experiences for that destination is unchanged

### Requirement: Planner-compatible Experiences
Each Experience SHALL be projectable into the planning input (tour-planning) as one candidate carrying its ordered components with participation, each VISIT component's visit duration and per-date opening-hours knowledge with provenance, each required traversal constraint, and footprints derived from its components. Duration and opening-hours values SHALL NOT participate in the composition signature.

#### Scenario: Composite planned as one candidate
- **WHEN** the San Telmo walk is offered to the planner
- **THEN** it is one candidate whose start and end are its first and last components, whose internal order follows its components, and whose traversal follows the Defensa bounds

#### Scenario: Duration source changes
- **WHEN** the visit-duration knowledge of MALBA changes from FALLBACK_POLICY to OFFICIAL_SITE
- **THEN** the Experience's identity and signature are unchanged
