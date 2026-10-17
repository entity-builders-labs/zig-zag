# Spec Delta

## Purpose

Selects, deterministically and by policy, which classes of sources may fill
each kind of missing knowledge, so that physical candidates come from
structured providers and only tourism meaning is researched on the web.

## ADDED Requirements

### Requirement: Every gap is routed by a deterministic policy
Each emitted knowledge gap SHALL be passed to an acquisition router that returns an ordered list of acquisition strategies from a versioned routing policy keyed by gap type. Routing SHALL be a pure function of the gap and provider availability. No language model SHALL choose the source class or acquisition mechanism.

#### Scenario: Same gap, same route
- **WHEN** the same gap is routed twice with the same policy version and provider availability
- **THEN** both routes list the same strategies in the same order

### Requirement: One canonical concept identity per preference concept
The interpretation vocabulary SHALL define exactly one canonical facet key per concept, so two keys such as `food` and `gastronomy` SHALL NOT both remain canonical for the same semantic concept. Acquisition routing SHALL be keyed by canonical gap type and source capability, never by a second preference-to-provider-type lookup table.

#### Scenario: Divergent concept keys
- **WHEN** a request expresses the same food interest using wording that could map to two different canonical theme keys
- **THEN** interpretation produces one canonical key and routing does not depend on the wording

### Requirement: Bounded acquisition capacity is recorded as a limitation
When an acquisition strategy's capacity is bounded for operational reasons, the bound SHALL be attributable to the demand or gap being satisfied and recorded as an acquisition-strategy limitation, never as a rejection.

#### Scenario: Bounded acquisition capacity
- **WHEN** an acquisition strategy bounds its result capacity for operational reasons
- **THEN** the bound is recorded as an acquisition-strategy limitation tied to the gap it satisfied, never as a rejection

### Requirement: Source classes are defined by knowledge type, not by website
The routing policy SHALL name source classes (GEOGRAPHIC_STRUCTURE, STRUCTURED_POI, STRUCTURED_ENTITY_FACTS, ROUTE_GEOMETRY, RESEARCH_MEMORY, WEB_EVIDENCE) and the providers that implement them. It SHALL NOT contain lists of websites or domains.

#### Scenario: Inspecting the policy
- **WHEN** the routing policy is read
- **THEN** it contains source classes and provider adapters only, and no website or domain list

### Requirement: Discovery gaps use structured source classes only
Gaps for missing physical candidates (areas, places, routes) SHALL be routed only to GEOGRAPHIC_STRUCTURE, STRUCTURED_POI, STRUCTURED_ENTITY_FACTS or ROUTE_GEOMETRY. They SHALL NOT be routed to WEB_EVIDENCE or RESEARCH_MEMORY.

#### Scenario: No areas known for a destination
- **WHEN** an area-candidate gap is routed for Buenos Aires
- **THEN** the route contains only structured geographic strategies and no web research

### Requirement: Cheapest sufficient authority
For each product decision the router SHALL select the cheapest source class that the authority matrix marks sufficient. No research strategy SHALL be placed on the critical path of a decision that an authorized structured provider can establish.

#### Scenario: Ordinary place admission
- **WHEN** a gap needs more admissible places for an ordinary Tour
- **THEN** the route contains structured POI strategies only and no research

### Requirement: Meaning gaps evaluate known candidates
Gaps for missing tourism meaning SHALL be routed to STRUCTURED_ENTITY_FACTS where the policy allows it, then RESEARCH_MEMORY, then WEB_EVIDENCE, and every strategy SHALL receive the offered canonical candidate identities the gap concerns. Their outcomes SHALL NOT affect structured admission.

#### Scenario: Area relevance for history
- **WHEN** an area-relevance gap for history is routed with San Telmo and Monserrat as offered candidates
- **THEN** every strategy in the route evaluates only those candidate identities

### Requirement: No fallback across unauthorized source classes
When every strategy authorized for a gap is unavailable or fails, the gap outcome SHALL be FAILED. The router SHALL NOT fall back to a source class not authorized for that gap type.

#### Scenario: Structured provider outage
- **WHEN** the structured geographic provider is unavailable during an area-candidate gap
- **THEN** the gap outcome is FAILED and no web research runs for it

### Requirement: Routes are recorded
Each routed gap SHALL record the routing policy version, the strategies selected, which ran, and each strategy's outcome.

#### Scenario: Tracing a generation
- **WHEN** a generation finishes
- **THEN** its trace lists, for each researched gap, the route and per-strategy outcomes

### Requirement: Shortfalls are classified before routing
Every shortfall in a generation SHALL be classified from typed evidence as CANDIDATE_SUPPLY (structured strategies remain), PROVIDER_COVERAGE (authorized structured strategies exhausted), ADMISSION_POLICY, IDENTITY, RANKING, PLANNER_FEASIBILITY or SEMANTIC_KNOWLEDGE.

#### Scenario: Recorded classification
- **WHEN** a generation finishes with fewer scheduled units than requested
- **THEN** its trace lists each shortfall with one class and the typed evidence behind it

### Requirement: Only supply and semantic shortfalls are routed
Only CANDIDATE_SUPPLY shortfalls SHALL be routed to structured acquisition, and only SEMANTIC_KNOWLEDGE shortfalls of a product that declares a semantic dependency SHALL be routed to research. Planner, ranking, identity and admission-policy shortfalls SHALL NOT be routed to any acquisition.

#### Scenario: Landmark missing because of a walking limit
- **WHEN** an admitted landmark is absent from the Tour because the planner rejected it for a walking limit
- **THEN** the shortfall is PLANNER_FEASIBILITY and no acquisition or research is routed

#### Scenario: Landmark missing because the admission policy rejected it
- **WHEN** a landmark exists in the structured provider but the admission policy rejected it
- **THEN** the shortfall is ADMISSION_POLICY and no acquisition or research is routed

### Requirement: Visit-duration gaps route catalog and structured first
A VISIT_DURATION enrichment gap SHALL be satisfied first from persisted knowledge and structured provider facts, and SHALL route to WEB_EVIDENCE research only for shortlisted admitted places without sufficient evidence-backed duration. It SHALL never be a core gap.

#### Scenario: Structured duration present
- **WHEN** a structured provider record states a visit length for an admitted place
- **THEN** no research is routed for that place's duration
