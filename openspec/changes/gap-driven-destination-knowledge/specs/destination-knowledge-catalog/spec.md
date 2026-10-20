# Spec Delta

## Purpose

Holds reusable, provenance-bearing destination knowledge — canonical
GeoEntities with their evaluations, grounded tourism assertions, research
history and Experiences (the only schedulable unit) — so that Tour generation consults known knowledge before any live research.

## ADDED Requirements

### Requirement: Layered catalog with single write authorities
The catalog SHALL hold GeoEntities, L2 grounded tourism assertions, the L3 research ledger and Experiences. Each SHALL accept writes only from its authority: GeoEntities from geographic identity resolution of structured candidates, L2 from grounding, L3 from outcome recording after grounding and readiness re-evaluation, Experiences from Experience composition.

#### Scenario: Research output cannot write the catalog directly
- **WHEN** the research step returns proposed claims
- **THEN** no GeoEntity, L2 assertion or Experience is created until grounding authorizes the claims

#### Scenario: Composition cannot create geography or assertions
- **WHEN** Experience composition runs
- **THEN** it reads GeoEntities and L2 and writes only Experiences and their components

### Requirement: Geography comes from structured providers
A GeoEntity (PLACE, AREA or ROUTE) SHALL exist only when a structured provider supplied it, with at least one provider identity and provider-backed geometry or coordinates. Web evidence and language model output SHALL NOT create GeoEntities. Geometry SHALL NOT imply tourism relevance.

#### Scenario: Entity named only in web prose
- **WHEN** a web page names a place that no structured provider returned
- **THEN** no GeoEntity exists for it

#### Scenario: Street geometry without tourism evidence
- **WHEN** a ROUTE GeoEntity for a street exists with no L2 assertion about it
- **THEN** readiness and composition treat the street as having no tourism relevance

### Requirement: Tourism-area model
An AREA GeoEntity SHALL record its area class (ADMINISTRATIVE or NAMED_PLACE) and its extent (PROVIDER_BOUNDARY or UNKNOWN). Relations between areas (a named place within an administrative area) SHALL be derived from provider geometry only. An unknown extent SHALL stay unknown; no boundary SHALL be synthesized.

#### Scenario: Named quarter without a boundary
- **WHEN** a structured named place for an informal quarter has only a point
- **THEN** it is an AREA with class NAMED_PLACE and extent UNKNOWN, related to the administrative area containing its point

### Requirement: Evidence memory is outside the canonical layers
Research evidence memory SHALL be stored as its own record type, apart from GeoEntities, L2, L3 and Experiences (it may share their durable persistence and be referenced from them by stable id), and SHALL NOT be read by readiness, composition or planning as knowledge.

#### Scenario: Readiness with pending evidence
- **WHEN** evidence memory holds pending claims for a destination
- **THEN** readiness evaluates only GeoEntities, L2, Experiences and the ledger

### Requirement: L2 is not a universal admission gate
A GeoEntity with an ADMITTED structured admission evaluation SHALL be usable in ordinary single-place Experience composition without any L2 assertion. L2 SHALL be required only where a component's justification depends on semantic or tourism meaning.

#### Scenario: Catalog with geography only
- **WHEN** the catalog holds admitted places and no L2 assertions
- **THEN** single-place Experiences exist for those places

### Requirement: Assertions are typed claims about geography
An L2 assertion SHALL have a claim type, a subject (a GeoEntity, or a corridor segment of a ROUTE GeoEntity), canonical facet keys, a destination scope, and at least one evidence capture. Free-text themes that do not map to the canonical facet vocabulary SHALL NOT be stored as facets.

#### Scenario: Unmapped theme
- **WHEN** a grounded claim carries a theme with no canonical facet key
- **THEN** the assertion is stored without that facet, or rejected if no canonical facet remains

### Requirement: Evidence captures are re-verifiable
Every evidence capture SHALL record a locator (URL, or dataset plus record identifier and field path), retrieval time, a content fingerprint, and either a captured prose span with offsets or captured structured field values, sufficient to deterministically re-verify the claim later.

#### Scenario: Structured source evidence
- **WHEN** a claim is supported by a structured record rather than prose
- **THEN** the capture stores the record locator and field values, and re-verification compares those fields

#### Scenario: Prose source evidence
- **WHEN** a claim is supported by a web page
- **THEN** the capture stores the span text and offsets and re-verification finds the same span in the re-fetched content or reports drift

### Requirement: Idempotent knowledge identity
L2 assertions SHALL be identified by claim type, subject (including corridor segment bounds) and canonical facet key. Recording an equivalent claim SHALL add evidence to the existing assertion rather than create a parallel assertion.

#### Scenario: Second source for a known claim
- **WHEN** grounding authorizes a claim equivalent to an existing assertion from a different source
- **THEN** the existing assertion gains the new evidence capture and no new assertion is created

### Requirement: Provenance survives into derived knowledge
Every Experience SHALL reference what justifies each required component: the structured admission evaluation of a visited PLACE GeoEntity, or the L2 assertions a component's justification requires. Every L2 assertion SHALL reference its evidence captures. Every identity merge and parent relationship SHALL reference its structured evidence.

#### Scenario: Tracing a scheduled unit
- **WHEN** a Tour contains an Experience
- **THEN** its components' admission evaluations or justifying assertions, and their provider records or evidence captures, can be enumerated from the catalog

#### Scenario: Tracing a sub-feature
- **WHEN** a tomb is represented by its cemetery's Experience
- **THEN** its PART_OF relation, its visit-unit classification and the structured evidence for both can be enumerated from the catalog

### Requirement: Knowledge is owned by the entity it describes
Admission evaluations, direct PART_OF relationships, physical opening hours, reusable visit-duration knowledge and structured prominence evidence SHALL be stored as knowledge of the canonical GeoEntity with version, timestamp and provenance. They SHALL NOT create another place identity or catalog. Bounded traversals SHALL be stored on the ExperienceComponent and planning results only in the Tour snapshot.

#### Scenario: Re-evaluation under a new admission policy
- **WHEN** the admission policy version changes
- **THEN** each affected GeoEntity's admission evaluation is updated in place with the new version, and its identity and provider identities are unchanged

#### Scenario: Derived child states are not stored
- **WHEN** a parent site's admission changes from not admitted to admitted
- **THEN** its REQUIRES_PARENT_VISIT children read as SUB_FEATURE_OF without any child record being rewritten

#### Scenario: Prominence belongs to canonical geography
- **WHEN** a structured provider supplies a prominence fact for a canonical place
- **THEN** the fact and its source provenance are persisted as GeoEntity knowledge without changing the GeoEntity identity or its admission evaluation

### Requirement: Prominence uses its canonical typed contract
GeoEntity prominence evidence SHALL follow `structured-catalog-prominence`; it SHALL NOT be hidden in metadata, stored as an Experience field or represented as a universal quality score.

#### Scenario: Prominence does not create another catalog
- **WHEN** prominence evidence is attached to a place
- **THEN** it remains GeoEntity knowledge and the existing catalog and identity remain authoritative

### Requirement: Catalog-first reads
Every generation SHALL read a catalog snapshot for the destination before any research, and SHALL plan only from a snapshot read after the last knowledge write of that generation, including reusable composition writes.

#### Scenario: Mature destination
- **WHEN** the snapshot already satisfies the request
- **THEN** generation completes without any research step

#### Scenario: Knowledge written during generation
- **WHEN** grounding persists new knowledge during a generation and reusable composition recomposes affected Experiences
- **THEN** Tour composition and planning use a snapshot read after the recomposition writes
