# Spec Delta

## Purpose

Adds optional, reusable semantic and tourism knowledge (thematic relevance,
narratives, highlights, context, relationships, tips) to admitted canonical
candidates without ever gating their ordinary use in tours.

## ADDED Requirements

### Requirement: Enrichment is downstream of admission
Enrichment SHALL apply only to canonical candidates that already exist as GeoEntities. It SHALL NOT create, admit or identify candidates.

#### Scenario: Enrichment about an unknown entity
- **WHEN** enrichment evidence names an entity that has no canonical candidate
- **THEN** no candidate is created and the name is kept only as a diagnostic mention

### Requirement: Enrichment is optional for ordinary products
Missing enrichment SHALL NOT prevent an admitted place from being composed, ranked or scheduled in an ordinary Tour. A Tour MAY use an admitted place with its structured provider data alone.

#### Scenario: Tour without enrichment
- **WHEN** no thematic assertion, narrative or highlight exists for any admitted place
- **THEN** a Tour can still be composed from single-place Experiences of admitted GeoEntities

### Requirement: Enrichment influences, never gates
Enrichment SHALL be usable for ranking, personalization, presentation, storytelling and semantic composition. It SHALL be required only for product decisions whose meaning depends on it, and each such product SHALL declare that dependency.

#### Scenario: Thematic request
- **WHEN** a request asks for history and some admitted places carry grounded history relevance
- **THEN** those places may rank higher, and admitted places without that enrichment remain eligible

### Requirement: Enrichment failure is not evidence of absence
A failed, stale or insufficiently corroborated enrichment attempt SHALL be recorded as such and SHALL NOT be stored as a negative fact about the place.

#### Scenario: Provider outage during enrichment
- **WHEN** enrichment research fails because a provider is unavailable
- **THEN** the outcome is recorded as FAILED and the place's admission and ranking inputs are unchanged

### Requirement: Enrichment is reusable catalog knowledge
Authorized enrichment SHALL be stored as reusable catalog knowledge with provenance, and SHALL be attachable to an Experience or GeoEntity without changing that Experience's identity.

#### Scenario: Highlight added later
- **WHEN** a grounded highlight is added to an admitted place that already has a single-place Experience
- **THEN** the Experience keeps its identity and is updated in place

### Requirement: Enrichment is not a cutover dependency
Production cutover of ordinary single-place Experience tours SHALL NOT depend on any enrichment capability. Recommended visit durations, sub-feature highlights, neighbourhood presentation, corridor meaning and narratives MAY later refine content, ranking or scheduling through in-place updates, and their absence SHALL leave the policy defaults and admission unchanged.

#### Scenario: No duration enrichment
- **WHEN** no recommended visit duration exists for an admitted place
- **THEN** its single-place Experience receives the explicit, versioned fallback duration marked FALLBACK_POLICY and remains schedulable

### Requirement: Visit duration is reusable evidence-backed knowledge
Visit duration SHALL be stored per admitted PLACE GeoEntity, as reusable knowledge about visiting it, in a normalized form that may hold a minimum useful, a recommended/typical and a maximum useful duration, a status (RESOLVED, CONFLICTING, INSUFFICIENT_EVIDENCE), evidence quality, the winning authority class, the evidence items used, the resolver/policy version and the resolution time. Not every field SHALL be required.

#### Scenario: Range only
- **WHEN** the only evidence says most visitors spend 1-2 hours
- **THEN** the knowledge records minimum 60 and maximum 120 minutes with that evidence, and no typical value is invented

### Requirement: Duration authority order
Duration evidence SHALL be ranked by authority: structured provider fact, official place/site information, official tourism or institutional source, other reliable reference source, user-generated evidence, grounded synthesis of cited evidence, and finally the fallback policy. Weaker evidence SHALL NOT automatically override stronger evidence. The order SHALL NOT require querying every source for every place.

#### Scenario: Official duration and reviews disagree
- **WHEN** the official site states a 90-minute guided tour and reviews suggest three hours
- **THEN** the official 90 minutes is the typical duration and the review evidence is retained as observed behavior

### Requirement: Duration claims require cited evidence
A duration derived by research SHALL be authorized only from captured, cited evidence about the offered admitted place. A language-model duration without a cited capture SHALL NOT be authority. User-generated evidence SHALL NOT be authoritative from a single anecdotal report.

#### Scenario: Uncited model estimate
- **WHEN** research returns "about two hours" with no captured source
- **THEN** no duration knowledge is written from it and the outcome is recorded as insufficient evidence

### Requirement: Conflicting duration evidence stays uncertain
When authorized duration evidence of equal authority conflicts materially, the knowledge SHALL keep the range and status CONFLICTING rather than a fabricated precise value.

#### Scenario: Two official sources disagree
- **WHEN** an official site says 60 minutes and the official tourism board says 3 hours
- **THEN** the knowledge records the 60-180 range with status CONFLICTING and both evidence items

### Requirement: Duration resolution never touches admission or identity
Visit-duration resolution SHALL run only for admitted places and SHALL NOT decide existence, canonical identity or admission, revoke an admission or archive an Experience, or create a tourism-relevance requirement for ordinary admission.

#### Scenario: Evidence about another place
- **WHEN** a capture describes a similarly named place elsewhere
- **THEN** it is rejected for subject mismatch and no candidate or identity change results

### Requirement: Lazy bounded duration resolution
Duration resolution SHALL use persisted knowledge first and SHALL be driven by bounded, prioritized demand (candidates offered to or scheduled by the planner whose knowledge is absent, fallback or stale, and the freshness policy) under versioned budgets. It SHALL NOT run blindly over a whole destination catalog.

#### Scenario: Large catalog
- **WHEN** a destination has 2,571 admitted PLACE GeoEntities with single-place Experiences and the planner pool holds 120 candidates
- **THEN** resolution is requested at most for the shortlisted candidates lacking evidence-backed duration, within the budget

### Requirement: Duration resolution is off the critical path
A Tour generation SHALL plan with the duration knowledge already persisted (or the fallback) and SHALL NOT wait on duration research. Resolved knowledge SHALL be persisted for reuse by later planning.

#### Scenario: Research unavailable
- **WHEN** the research provider is down during a generation
- **THEN** the Tour is planned with persisted or fallback durations and the resolution outcome is recorded as FAILED

### Requirement: Duration knowledge updates keep identity
Changing or enriching a place's duration knowledge SHALL NOT change any Experience's identity, SHALL update the knowledge in place with its provenance and resolver version, and MAY change future plans.

#### Scenario: Fallback replaced by evidence
- **WHEN** an official duration is resolved for a place previously planned with the fallback
- **THEN** the Experience identity is unchanged, the knowledge records the official evidence, and later plans use the official duration

### Requirement: Fallback is exceptional degraded planning
The duration fallback SHALL be one global, versioned planner policy with a single rule, used only when a VISIT component's GeoEntity has no usable duration knowledge. It SHALL NOT depend on category, destination, opening hours, popularity, distance, a language model or research, and SHALL be replaced in planning as soon as evidence-backed knowledge is persisted.

#### Scenario: Evidence later found
- **WHEN** a place planned with FALLBACK_POLICY gains RESOLVED knowledge
- **THEN** subsequent plans no longer mark it FALLBACK_POLICY

#### Scenario: Fallback is not stored as knowledge
- **WHEN** a place has no evidence-backed duration
- **THEN** no duration knowledge is persisted for it and the fallback is applied only when projecting planning input

#### Scenario: No category map
- **WHEN** a museum and a church both lack duration knowledge
- **THEN** both receive the same fallback value from the same rule and version

### Requirement: Fallback value is calibrated
The fallback value SHALL be approved only from calibration evidence (evidence-backed typical durations with sample size, source mix and spread) and recorded as a policy version; it SHALL NOT be chosen without evidence. Production planning SHALL NOT enable the fallback before a calibrated version exists.

#### Scenario: No calibration yet
- **WHEN** no calibrated fallback version has been approved
- **THEN** production wiring of the fallback is blocked rather than defaulting to an arbitrary number

### Requirement: Fallback use is explicit and creates enrichment demand
Every planner use of the fallback SHALL be recorded as durationSource FALLBACK_POLICY with the policy version, rule and minutes used, and SHALL emit deduplicated asynchronous VISIT_DURATION enrichment demand for that GeoEntity. Fallback values SHALL NOT be persisted as duration knowledge.

#### Scenario: Fallback during a generation
- **WHEN** a scheduled VISIT component has no duration knowledge
- **THEN** the Tour records FALLBACK_POLICY with its versions and minutes, enrichment demand is recorded for that place, and the generation does not wait

### Requirement: Missing reusable knowledge never blocks generation
When generation meets missing or stale reusable enrichment knowledge (at least opening hours and visit duration), it SHALL plan with the applicable degraded-mode policy, SHALL NOT launch synchronous research or wait for enrichment, SHALL NOT emit NEEDS_ACQUISITION or INSUFFICIENT_KNOWLEDGE for it, and SHALL emit enrichment demand so the catalog is repaired asynchronously.

#### Scenario: Missing hours and duration on a selected place
- **WHEN** a selected place has neither opening hours nor duration knowledge
- **THEN** the Tour is produced under PENALIZE and the fallback, both gaps become enrichment demand, and readiness is unaffected by them

### Requirement: Enrichment demand is deduplicated
Enrichment demand SHALL be keyed by fact type and canonical subject, and SHALL be recorded only when no demand for that key is pending and no attempt is within the versioned freshness or backoff policy. Repeated requests meeting the same gap SHALL NOT start repeated research.

#### Scenario: Many requests, one gap
- **WHEN** fifty generations in one day schedule the same place without duration knowledge
- **THEN** at most one enrichment run is due for it under the policy, and the other generations add no new research

### Requirement: Catalog health is separate from request diagnostics
Request diagnostics SHALL describe what a generation did (uncertain hours accepted, fallback used). Catalog-health signals (OPENING_HOURS_ENRICHMENT_REQUIRED, VISIT_DURATION_ENRICHMENT_REQUIRED, KNOWLEDGE_REFRESH_DUE) SHALL describe reusable knowledge to repair and SHALL NOT be user-visible errors.

#### Scenario: Health signal without a user error
- **WHEN** a Tour is produced with one fallback duration
- **THEN** the user receives the Tour without an error and a VISIT_DURATION_ENRICHMENT_REQUIRED signal exists for maintenance

### Requirement: Reusable knowledge has a freshness policy
Reusable knowledge SHALL be refreshable independently of user requests by a versioned, configurable freshness policy covering missing facts, stale facts, changed provider sources, conflicting evidence and facts produced by an outdated policy, parser or resolver version. Freshness SHALL be a maintenance signal: a stale KNOWN fact SHALL remain usable for planning unless an explicit versioned freshness rule says otherwise.

#### Scenario: Parser version change
- **WHEN** the opening-hours parser version changes
- **THEN** affected records become due for refresh while plans keep using their current KNOWN hours

