# Spec Delta

## Purpose

Decides deterministically whether the catalog snapshot is sufficient for a
request and, when it is not, names the missing knowledge as typed gaps that
are the only trigger for research.

## ADDED Requirements

### Requirement: Deterministic readiness evaluation
Readiness SHALL be a deterministic function of the catalog snapshot, the interpreted request (destination, canonical facets, days, pace, mobility) and a versioned readiness policy. It SHALL return either READY or a non-empty list of typed knowledge gaps. No language model SHALL decide whether research is needed.

#### Scenario: Same inputs, same verdict
- **WHEN** readiness is evaluated twice with the same snapshot, request and policy version
- **THEN** both evaluations return identical verdicts and gap lists

### Requirement: Typed knowledge gaps
Readiness SHALL emit only these gap types: AREA_RELEVANCE (destination, facet), NOTABLE_PLACES (area, facet), WALKING_CORRIDOR (destination, walking-format facet), SCHEDULE_CAPACITY (destination, requested facets, days). Each gap SHALL state what is missing and the policy threshold it was measured against.

#### Scenario: Empty catalog for a requested facet
- **WHEN** the request includes facet history and no grounded area in the destination is relevant for history
- **THEN** readiness emits AREA_RELEVANCE for the destination and history

### Requirement: Walking corridor gaps follow experience intent
WALKING_CORRIDOR SHALL be emitted only for a requested walking experience-format facet, never for walking transport permission alone. It SHALL be scoped to the destination and satisfied by at least one grounded corridor in any area relevant to the request's thematic facets.

#### Scenario: Walking experience requested without a corridor
- **WHEN** the request includes the walking experience-format facet and no grounded corridor exists in any area relevant to the request's thematic facets
- **THEN** readiness emits WALKING_CORRIDOR for the destination and that facet

#### Scenario: Walking allowed only as transport
- **WHEN** the request allows walking as a transportation mode but includes no walking experience-format facet
- **THEN** readiness emits no WALKING_CORRIDOR gap

### Requirement: Canonical gap keys
A gap key SHALL be composed of the gap type, the canonical scope GeoEntity identity and the canonical facet key. Gap keys SHALL NOT contain free text, user identity or request-specific scores.

#### Scenario: Synonymous user wording
- **WHEN** two requests express the same interest with different wording that maps to the same canonical facet
- **THEN** readiness produces the same gap key for both

### Requirement: Recursive gap discovery
After knowledge is written, readiness SHALL be re-evaluated on a fresh snapshot so that newly known areas can produce area-scoped gaps.

#### Scenario: Area discovered from a destination-level gap
- **WHEN** grounding persists San Telmo as relevant for history in Buenos Aires and no notable places are known in it
- **THEN** the next readiness evaluation emits NOTABLE_PLACES for San Telmo and history

### Requirement: Ledger-aware suppression
Readiness SHALL NOT emit a gap that current L2 knowledge satisfies. It SHALL report, but not emit for research, a gap whose key has a ledger outcome INSUFFICIENT_EVIDENCE or BUDGET_EXHAUSTED within the policy freshness window. A FAILED outcome SHALL NOT suppress a gap.

#### Scenario: Known knowledge is reused
- **WHEN** the catalog already holds grounded assertions satisfying a gap's threshold
- **THEN** the gap is not emitted and no research runs for it

#### Scenario: Recently exhausted gap
- **WHEN** the ledger records a gap key with outcome INSUFFICIENT_EVIDENCE inside the freshness window
- **THEN** readiness reports it as a known limitation and does not emit it for research

#### Scenario: Previous attempt failed
- **WHEN** the ledger records a gap key with outcome FAILED
- **THEN** readiness emits the gap again if knowledge still does not satisfy it

### Requirement: Capacity measured by planning, not counts
SCHEDULE_CAPACITY SHALL be derived from a provisional plan over the reusable Experiences the snapshot offers, using planner residual capacity, not from raw candidate counts.

#### Scenario: Enough units but unfillable days
- **WHEN** facet gaps are satisfied but a provisional plan leaves meaningful residual capacity on requested days
- **THEN** readiness emits SCHEDULE_CAPACITY, and the provisional plan is discarded
