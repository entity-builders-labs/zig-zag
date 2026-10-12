# Spec Delta

## Purpose

Retains research evidence across runs (documents, captures, pending claims
and unoffered mentions) so corroboration can accumulate and live web research
is reduced, without ever becoming canonical knowledge.

## ADDED Requirements

### Requirement: Evidence memory is non-canonical
Research evidence memory SHALL store fetched document snapshots, evidence captures, pending claims and unoffered mentions. Nothing in it SHALL be read as canonical knowledge by readiness, composition or planning.

#### Scenario: Pending claim in memory
- **WHEN** memory holds a pending claim that San Telmo is relevant for history
- **THEN** readiness does not count San Telmo as relevant until grounding authorizes an assertion

### Requirement: Pending claims are keyed by evaluation question
A proposed claim that grounding did not authorize on sufficiency grounds SHALL be retained as pending under its evaluation question (claim type, canonical candidate identity, facet), together with its verified captures and rejection reason.

#### Scenario: Single-publisher evidence
- **WHEN** a claim is rejected with INSUFFICIENT_CORROBORATION
- **THEN** its captures are retained under the evaluation question for later corroboration

### Requirement: Memory is consulted before live research
For a meaning gap, retained captures for the offered evaluation questions SHALL be retrieved and offered to grounding before live web research runs. Retrieval SHALL NOT authorize a claim by itself.

#### Scenario: Second run with retained evidence
- **WHEN** a later generation evaluates the same question and memory holds a capture from one publisher
- **THEN** grounding receives that capture together with any new ones, and live research is needed only if sufficiency is still not met

### Requirement: Retained captures are re-verified
A retained capture SHALL be re-verified for reproducibility when grounding uses it; fingerprint drift SHALL be recorded and an unreproducible capture SHALL NOT count toward sufficiency.

#### Scenario: Page changed since capture
- **WHEN** a retained capture's span is no longer present in the re-fetched page
- **THEN** the capture does not count toward sufficiency and the drift is recorded

### Requirement: Unoffered mentions are diagnostics only
Entities mentioned by research that are not offered canonical candidates SHALL be retained as unoffered mentions for diagnostics. An unoffered mention SHALL NOT create a candidate or trigger acquisition by itself.

#### Scenario: Agent mentions an informal area
- **WHEN** research mentions "Microcentro" and no offered candidate has that identity
- **THEN** the mention is stored as an unoffered mention and no candidate or assertion is created
