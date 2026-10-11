# Spec Delta

## Purpose

Is the sole authority that turns proposed claims into grounded L2 assertions,
by independently verifying every property a claim type requires and
rejecting anything it cannot verify.

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
A single evidence capture SHALL authorize a claim only when grounding establishes both independently verifiable provenance and explicit support for the claim from that capture. Otherwise the claim SHALL require corroborating support from captures of independent publishers. No fixed website or domain allowlist SHALL define sufficiency.

#### Scenario: Single verified and explicit capture
- **WHEN** one capture has independently verified provenance and explicitly supports the claim
- **THEN** the claim may be authorized without corroboration

#### Scenario: Unverifiable publisher
- **WHEN** a capture explicitly supports the claim but its publisher cannot be independently verified
- **THEN** the claim is authorized only if a capture from an independent publisher also supports it

### Requirement: Source capability is claim-type specific
A source SHALL contribute only to the claim properties it can establish. Geographic data sources SHALL be able to establish identity, geometry and walkability, and SHALL NOT establish tourism relevance.

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

### Requirement: Identity only through geographic resolution
The subject mention of a claim SHALL be mapped to an L1 GeoEntity only through geographic identity resolution. Language model output SHALL NOT establish GeoEntity identity, coordinates or geometry.

#### Scenario: Ambiguous place name
- **WHEN** the subject mention resolves to more than one compatible GeoEntity candidate
- **THEN** the claim is rejected with reason IDENTITY_AMBIGUOUS and no GeoEntity is chosen

#### Scenario: New geography from a grounded claim
- **WHEN** the subject resolves to a provider entity not yet in L1
- **THEN** the resolved provider entity is recorded in L1 through geographic identity resolution, with its provider identity and geometry, before the assertion is recorded

### Requirement: Geometric consistency
Grounding SHALL verify that the subject geometry is consistent with the claim's scope: a NOTABLE_WITHIN place SHALL lie within its area, corridor anchors SHALL lie on or at the base route, and every subject SHALL be compatible with the destination.

#### Scenario: Place outside the claimed area
- **WHEN** a claim states a place is notable within San Telmo and its resolved geometry lies outside San Telmo
- **THEN** the claim is rejected with reason GEOMETRY_INCONSISTENT

### Requirement: Corridor segment bounds are stated or explicitly derived
A WALKING_CORRIDOR assertion SHALL bound its segment by anchors stated in evidence and resolved as GeoEntities, or by clipping the base route to an area named by the evidence. The assertion SHALL record which bound kind was used. Grounding SHALL NOT invent endpoints.

#### Scenario: Evidence names endpoints
- **WHEN** evidence describes walking Defensa from Plaza de Mayo to Parque Lezama and both resolve
- **THEN** the corridor segment is bounded by those two GeoEntities with bound kind STATED_ANCHORS

#### Scenario: Evidence names only the street and area
- **WHEN** evidence describes Defensa as San Telmo's walking street without endpoints
- **THEN** the segment is the base route clipped to San Telmo with bound kind AREA_CLIP

### Requirement: Typed rejections
Every rejected claim SHALL carry a typed rejection reason and SHALL be retained in the research outcome. A transient resolver or fetch failure SHALL be reported as a failure, not as a rejection on the merits.

#### Scenario: Geographic resolver unavailable
- **WHEN** identity resolution fails because a provider is unavailable
- **THEN** the claim outcome is RESOLUTION_UNAVAILABLE and the gap is not recorded as lacking evidence

### Requirement: Gap outcome recording
After grounding a gap's claims and re-evaluating readiness on a fresh snapshot, the gap's outcome SHALL be recorded once in the ledger as SATISFIED, INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED or FAILED, with gap key, budget used and snapshot epoch. FAILED SHALL be used for tool or resolver failures.

#### Scenario: All claims rejected
- **WHEN** research proposed claims for a gap and grounding rejected all of them on the merits
- **THEN** the gap outcome is INSUFFICIENT_EVIDENCE

#### Scenario: Gap filled
- **WHEN** re-evaluated readiness no longer emits the gap after grounding
- **THEN** the gap outcome is SATISFIED

#### Scenario: Resolver outage
- **WHEN** the gap remains unsatisfied because research or identity resolution failed
- **THEN** the gap outcome is FAILED
