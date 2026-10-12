# Spec Delta

## Purpose

Is the sole authority that turns proposed claims about canonical candidates
into grounded L2 assertions, by independently verifying every property a
claim type requires and rejecting anything it cannot verify.

## ADDED Requirements

### Requirement: Grounding authorizes, research proposes
A proposed claim SHALL become an L2 assertion only when grounding verifies every authorization predicate of its claim type. Properties proposed by the research agent, including its publisher or source classification, SHALL be treated as untrusted hints and SHALL NOT satisfy a predicate by themselves.

#### Scenario: Agent labels a source as official
- **WHEN** a claim arrives with a proposed classification "official tourism authority" and grounding cannot independently verify the publisher
- **THEN** the claim is evaluated without that classification and is rejected if the remaining verified properties do not authorize it

### Requirement: Provenance and support are verified separately
Grounding SHALL verify provenance (who published the evidence, reproducibility of retrieval, integrity of captured content) separately from support (whether the captured evidence supports this specific claim type for this subject and facet). Verified provenance SHALL NOT authorize a claim without verified support.

#### Scenario: Authentic publisher, passing mention
- **WHEN** the publisher of a capture is verified but the captured content only mentions the place without presenting it as relevant for the facet
- **THEN** the claim is not authorized by that capture

#### Scenario: Official domain is one signal only
- **WHEN** a capture comes from a government-hosted domain
- **THEN** that fact is recorded as one provenance signal and the claim still requires verified support for its claim type

### Requirement: Evidence sufficiency
A single evidence capture SHALL authorize a claim only when grounding establishes both independently verifiable provenance and explicit support for the claim from that capture. Otherwise the claim SHALL require corroborating support from captures of independent publishers, which MAY come from evidence memory accumulated across runs. No fixed website or domain allowlist SHALL define sufficiency.

#### Scenario: Single verified and explicit capture
- **WHEN** one capture has independently verified provenance and explicitly supports the claim
- **THEN** the claim may be authorized without corroboration

#### Scenario: Unverifiable publisher
- **WHEN** a capture explicitly supports the claim but its publisher cannot be independently verified
- **THEN** the claim is authorized only if a capture from an independent publisher also supports it

#### Scenario: Corroboration across runs
- **WHEN** evidence memory holds a re-verified supporting capture from one publisher and a later run adds one from an independent publisher for the same evaluation question
- **THEN** grounding evaluates both together and may authorize the claim

### Requirement: Source capability is claim-type specific
A source SHALL contribute only to the claim properties it can establish. Geographic data sources SHALL establish existence, identity, geometry and walkability, and SHALL NOT establish tourism relevance. A structured entity fact SHALL count as relevance evidence only where the versioned source-capability policy maps that field to the facet.

#### Scenario: OSM tags as relevance evidence
- **WHEN** a RELEVANT_FOR claim cites only OSM data for a place
- **THEN** the claim is rejected with reason EVIDENCE_DOES_NOT_SUPPORT_CLAIM

### Requirement: Evidence re-verification
Grounding SHALL re-verify each evidence capture against its locator before authorizing a claim: the prose span or structured fields SHALL be present in the retrieved content and SHALL support the claim's subject and claim type.

#### Scenario: Span not present
- **WHEN** a capture's prose span is not found in the fetched document
- **THEN** the claim is rejected with reason EVIDENCE_NOT_REPRODUCIBLE

#### Scenario: Passing mention
- **WHEN** the captured evidence names the place but does not present it as relevant for the claimed facet
- **THEN** the claim is rejected with reason EVIDENCE_DOES_NOT_SUPPORT_CLAIM

### Requirement: Subjects are offered canonical candidates
A claim's subject, area and corridor endpoints SHALL reference canonical candidates that were offered to the evaluation and already exist as GeoEntities. Grounding SHALL NOT resolve new identities from claim text, and language model output SHALL NOT establish identity, coordinates or geometry.

#### Scenario: Claim about an unoffered entity
- **WHEN** a claim references an identity that was not offered
- **THEN** the claim is rejected with reason NOT_OFFERED_CANDIDATE and no GeoEntity is added

### Requirement: Captures name their subject
A prose capture SHALL count as support only if it contains one of the subject's structured names or aliases recorded from its providers. A capture that does not name the subject SHALL be rejected for that claim before support is judged.

#### Scenario: Quote without the subject name
- **WHEN** a capture about restaurants in central neighbourhoods does not contain any structured name of San Telmo
- **THEN** it does not support "San Telmo RELEVANT_FOR food" and the reason is EVIDENCE_DOES_NOT_NAME_SUBJECT

### Requirement: Geometric consistency
Grounding SHALL verify that the subject geometry is consistent with the claim's scope: a NOTABLE_WITHIN place SHALL lie within its area, corridor anchors SHALL lie on or at the base route, and every subject SHALL be compatible with the destination.

#### Scenario: Place outside the claimed area
- **WHEN** a claim states a place is notable within San Telmo and its resolved geometry lies outside San Telmo
- **THEN** the claim is rejected with reason GEOMETRY_INCONSISTENT

### Requirement: Corridor segment bounds are stated or explicitly derived
A WALKING_CORRIDOR assertion SHALL apply to an offered canonical route and bound its segment by offered canonical anchors named in the evidence, or by clipping the route to an offered area named by the evidence. The assertion SHALL record which bound kind was used. Grounding SHALL NOT invent endpoints.

#### Scenario: Evidence names endpoints
- **WHEN** evidence describes walking Defensa from Plaza de Mayo to Parque Lezama and both are offered canonical places lying on Defensa
- **THEN** the corridor segment is bounded by those two GeoEntities with bound kind STATED_ANCHORS

#### Scenario: Evidence names only the street and area
- **WHEN** evidence describes Defensa as San Telmo's walking street without endpoints
- **THEN** the segment is the base route clipped to San Telmo with bound kind AREA_CLIP

### Requirement: Route correspondence for corridor endpoints
Proximity of an offered endpoint to the verified canonical route, within the policy tolerance, SHALL be recorded as an explicit route-correspondence fact. It SHALL NOT be reported as area correspondence.

#### Scenario: Park touching the street
- **WHEN** Parque Lezama's boundary lies within the tolerance of Defensa
- **THEN** grounding records ROUTE_CORRESPONDENCE for that endpoint

### Requirement: Typed rejections
Every rejected claim SHALL carry a typed rejection reason and SHALL be retained in the research outcome. A transient resolver or fetch failure SHALL be reported as a failure, not as a rejection on the merits.

#### Scenario: Geographic resolver unavailable
- **WHEN** identity resolution fails because a provider is unavailable
- **THEN** the claim outcome is RESOLUTION_UNAVAILABLE and the gap is not recorded as lacking evidence

### Requirement: Unauthorized claims become pending evidence
A claim rejected for INSUFFICIENT_CORROBORATION SHALL be handed to evidence memory as a pending claim under its evaluation question, with its re-verified captures. Claims rejected for other reasons SHALL NOT become pending.

#### Scenario: One explicit single-publisher capture
- **WHEN** a claim has one explicit capture from an unestablished publisher
- **THEN** it is rejected for INSUFFICIENT_CORROBORATION and stored as pending evidence

### Requirement: Gap outcome recording
After grounding and re-evaluating readiness on a fresh snapshot, each evaluation question's outcome and the gap's outcome SHALL be recorded once in the ledger as SATISFIED, INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED or FAILED, with keys, budget used and snapshot epoch. FAILED SHALL be used for tool or resolver failures.

#### Scenario: All claims rejected
- **WHEN** research proposed claims for a gap and grounding rejected all of them on the merits
- **THEN** the gap outcome is INSUFFICIENT_EVIDENCE

#### Scenario: Gap filled
- **WHEN** re-evaluated readiness no longer emits the gap after grounding
- **THEN** the gap outcome is SATISFIED

#### Scenario: Resolver outage
- **WHEN** the gap remains unsatisfied because research or identity resolution failed
- **THEN** the gap outcome is FAILED

### Requirement: Visit-duration source capability
VISIT_DURATION claims SHALL be authorized by source authority class: an official site, official tourism or institutional source, or reliable reference source MAY authorize alone; user-generated evidence SHALL require multiple consistent independent reports per a versioned policy; grounded synthesis SHALL carry only the authority of its cited captures.

#### Scenario: Single review
- **WHEN** one review states a visit took four hours
- **THEN** no VISIT_DURATION claim is authorized from it alone and the capture stays pending evidence
