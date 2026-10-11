# Spec Delta

## Purpose

Holds reusable, provenance-bearing destination knowledge — geography, grounded
tourism assertions, research history and reusable schedulable Experiences —
so that Tour generation consults known knowledge before any live research.

## ADDED Requirements

### Requirement: Layered catalog with single write authorities
The catalog SHALL hold four layers: L1 geography, L2 grounded tourism assertions, L3 research ledger and L4 reusable Experiences. Each layer SHALL accept writes only from its authority: L1 from geographic identity resolution, L2 from grounding, L3 from gap-outcome recording after grounding and readiness re-evaluation, L4 from reusable Experience composition.

#### Scenario: Research output cannot write the catalog directly
- **WHEN** the research step returns proposed claims
- **THEN** no L1, L2 or L4 record is created until grounding authorizes the claims

#### Scenario: Composition cannot create geography or assertions
- **WHEN** reusable Experience composition runs
- **THEN** it reads L1 and L2 and writes only L4 records

### Requirement: Geography carries provider identity only
An L1 GeoEntity (PLACE, AREA or ROUTE) SHALL exist only with at least one geographic provider identity and provider-backed geometry or coordinates. Geometry SHALL NOT imply tourism relevance.

#### Scenario: Street geometry without tourism evidence
- **WHEN** a ROUTE GeoEntity for a street exists in L1 with no L2 assertion about it
- **THEN** readiness and composition treat the street as having no tourism relevance

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
Every L4 Experience SHALL reference the L2 assertions that justify it, and every L2 assertion SHALL reference its evidence captures.

#### Scenario: Tracing a scheduled unit
- **WHEN** a Tour contains a reusable Experience
- **THEN** its justifying assertions and their evidence captures can be enumerated from the catalog

### Requirement: Catalog-first reads
Every generation SHALL read a catalog snapshot for the destination before any research, and SHALL plan only from a snapshot read after the last knowledge write of that generation, including reusable composition writes.

#### Scenario: Mature destination
- **WHEN** the snapshot already satisfies the request
- **THEN** generation completes without any research step

#### Scenario: Knowledge written during generation
- **WHEN** grounding persists new knowledge during a generation and reusable composition recomposes affected Experiences
- **THEN** Tour composition and planning use a snapshot read after the recomposition writes
