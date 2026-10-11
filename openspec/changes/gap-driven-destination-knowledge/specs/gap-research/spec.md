# Spec Delta

## Purpose

Fills one typed knowledge gap by discovering relevant sources dynamically and
proposing small evidence-backed claims, within a bounded budget and without
any authority to change the catalog.

## ADDED Requirements

### Requirement: Research runs only for emitted gaps
Research SHALL run only for a gap emitted by readiness evaluation, one gap per research execution, and SHALL NOT run on a READY verdict.

#### Scenario: READY request
- **WHEN** readiness returns READY
- **THEN** no research execution starts

### Requirement: Research has no write authority
A research execution SHALL have read access to the catalog snapshot and access to web search and document fetch tools, and SHALL NOT write any catalog layer. Its only output SHALL be proposed claims and a research outcome.

#### Scenario: Agent attempts persistence
- **WHEN** a research execution produces a claim
- **THEN** the claim is returned for grounding and nothing is persisted by the research execution

### Requirement: Dynamic source discovery
Research SHALL discover sources through search for each execution. No fixed list of websites or providers SHALL be required or preferred by the research contract.

#### Scenario: No configured source list
- **WHEN** a research execution starts for AREA_RELEVANCE in a destination never researched before
- **THEN** it formulates research questions and finds sources through search without a predefined site list

### Requirement: Permitted claim types per gap
Research SHALL propose only the claim types permitted for its gap: AREA_RELEVANCE permits RELEVANT_FOR on areas; NOTABLE_PLACES permits NOTABLE_WITHIN and RELEVANT_FOR on places; WALKING_CORRIDOR permits WALKING_CORRIDOR; SCHEDULE_CAPACITY permits RELEVANT_FOR on areas not already known for the requested facets. Other claims SHALL be discarded before grounding.

#### Scenario: Capacity gap research
- **WHEN** research runs for SCHEDULE_CAPACITY in Buenos Aires where San Telmo is already known for history
- **THEN** it proposes only RELEVANT_FOR claims on areas other than San Telmo

#### Scenario: Off-gap claim
- **WHEN** research for AREA_RELEVANCE proposes a WALKING_CORRIDOR claim
- **THEN** that claim is discarded and counted in the research outcome

### Requirement: Proposed claims carry captured evidence
Each proposed claim SHALL contain a claim type permitted for the gap, a subject mention, proposed themes, an evidence capture from a fetched document or structured record, and an optional proposed source authority class. A claim without captured evidence SHALL be discarded before grounding.

#### Scenario: Claim from model knowledge only
- **WHEN** the agent proposes a claim without a fetched evidence capture
- **THEN** the claim is discarded and counted as unsupported in the research outcome

### Requirement: Bounded research
Each research execution SHALL enforce policy limits on rounds, search queries and fetches, and each generation SHALL enforce a limit on researched gaps. Reaching a limit SHALL end the execution with an explicit outcome.

#### Scenario: Budget exhausted
- **WHEN** a research execution reaches its fetch limit before finding supportable claims
- **THEN** it ends with outcome BUDGET_EXHAUSTED and returns the claims gathered so far

### Requirement: Research outcome is reported
Every research execution SHALL report an outcome (CLAIMS_PROPOSED, BUDGET_EXHAUSTED, NO_EVIDENCE_FOUND, TOOL_FAILURE) with its gap key, budget used and snapshot epoch. The outcome SHALL be an input to gap-outcome recording after grounding and SHALL NOT be written to the ledger by research.

#### Scenario: Search provider unavailable
- **WHEN** the search tool fails during research
- **THEN** the reported outcome is TOOL_FAILURE and nothing is written to the ledger by research
