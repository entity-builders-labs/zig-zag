# Spec Delta

## Purpose

Evaluates the tourism meaning of already-canonical candidates for one meaning
gap, by discovering evidence dynamically and proposing small evidence-backed
claims within a bounded budget and without any authority to change the
catalog.

## ADDED Requirements

### Requirement: Research runs only for routed meaning gaps
Agentic research SHALL run only as the WEB_EVIDENCE strategy of an enrichment or product-semantic gap selected by the acquisition router, one gap per execution. It SHALL NOT run for structured gaps, SHALL NOT be on the critical path of an ordinary Tour, and SHALL NOT run when evidence memory already satisfies the gap.

#### Scenario: Structured gap
- **WHEN** readiness emits PLACE_CANDIDATES
- **THEN** no agentic research runs for it

#### Scenario: Ordinary three-day tour
- **WHEN** a request without semantic product dependencies is READY from admitted places
- **THEN** no agentic research runs during that generation

### Requirement: Research evaluates offered candidates only
A research execution SHALL receive the offered evaluation questions (claim type, canonical candidate identity with its structured names, facet). Every proposed claim SHALL reference offered candidate identities for its subject and, where applicable, its area and corridor endpoints. Claims about entities that were not offered SHALL be discarded and retained only as unoffered mentions.

#### Scenario: Agent finds a new place
- **WHEN** research for PLACE_RELEVANCE in San Telmo proposes a claim about a place that was not offered
- **THEN** the claim is discarded as NOT_OFFERED_CANDIDATE and the place name is stored as an unoffered mention

### Requirement: Research never establishes existence or identity
Research output SHALL NOT create or modify candidates, identities, coordinates or geometry. Its only output SHALL be proposed claims about offered candidates and a research outcome.

#### Scenario: Agent proposes coordinates
- **WHEN** a research reply includes coordinates or a new identity for an entity
- **THEN** those values are ignored and no GeoEntity changes

### Requirement: Research has no write authority
A research execution SHALL have read access to its offered candidates and evidence memory and access to web search, document fetch and in-document find tools. It SHALL NOT write any catalog layer.

#### Scenario: Agent attempts persistence
- **WHEN** a research execution produces a claim
- **THEN** the claim is returned for grounding and nothing is persisted by the research execution

### Requirement: Dynamic source discovery for evidence
Research SHALL discover evidence sources through search for each execution. No fixed list of websites or providers SHALL be required or preferred by the research contract.

#### Scenario: No configured source list
- **WHEN** a research execution starts for San Telmo and history
- **THEN** it formulates queries about the offered candidate and finds sources through search without a predefined site list

### Requirement: Permitted claim types per meaning gap
Research SHALL propose only the claim types permitted for its gap: AREA_RELEVANCE permits RELEVANT_FOR on offered areas; PLACE_RELEVANCE permits NOTABLE_WITHIN and RELEVANT_FOR on offered places; WALKING_CORRIDOR_RELEVANCE permits WALKING_CORRIDOR on offered routes; VISIT_DURATION permits VISIT_DURATION on offered admitted places. Other claims SHALL be discarded before grounding.

#### Scenario: Off-gap claim
- **WHEN** research for AREA_RELEVANCE proposes a WALKING_CORRIDOR claim
- **THEN** that claim is discarded and counted in the research outcome

### Requirement: Proposed claims carry captured evidence
Each proposed claim SHALL contain at least one evidence capture from a fetched document or structured record and an optional proposed source authority class. A claim without a capture SHALL be discarded before grounding.

#### Scenario: Claim from model knowledge only
- **WHEN** the agent proposes a claim without a fetched evidence capture
- **THEN** the claim is discarded and counted as unsupported in the research outcome

### Requirement: Bounded research
Each research execution SHALL enforce policy limits on rounds, searches, fetches and offered questions, and each generation SHALL enforce a limit on researched gaps. Reaching a limit SHALL end the execution with an explicit outcome.

#### Scenario: Budget exhausted
- **WHEN** a research execution reaches its fetch limit before finding supportable claims
- **THEN** it ends with outcome BUDGET_EXHAUSTED and returns the claims gathered so far

### Requirement: Research outcome is reported
Every research execution SHALL report an outcome (CLAIMS_PROPOSED, BUDGET_EXHAUSTED, NO_EVIDENCE_FOUND, TOOL_FAILURE) per evaluation question, with budget used and snapshot epoch. The outcome SHALL be an input to outcome recording after grounding and SHALL NOT be written to the ledger by research.

#### Scenario: Search provider unavailable
- **WHEN** the search tool fails during research
- **THEN** the reported outcome is TOOL_FAILURE and nothing is written to the ledger by research
