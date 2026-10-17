# Spec Delta

## Purpose

Decides, from structured provider evidence alone, whether an ordinary real
place may be considered by the tour composer, so that ordinary tours do not
depend on web research or tourism assertions.

## ADDED Requirements

### Requirement: Versioned structured admission policy
Admission of an ordinary PLACE candidate SHALL be decided by a deterministic, versioned admission policy over structured provider evidence: canonical provider identity, a name, coordinates, containment in the destination, provider-backed existence, and sufficient structured evidence of independent visitability or notability. No language model, web evidence or tourism assertion SHALL take part.

#### Scenario: Same evidence, same decision
- **WHEN** the same canonical candidate is evaluated twice under the same policy version
- **THEN** both evaluations return the same admission decision, reason and signals

### Requirement: Admitted places are eligible without tourism assertions
A PLACE GeoEntity admitted by the structured admission policy SHALL be eligible for ordinary single-place Experience composition with zero L2 tourism assertions. Admission SHALL be an evaluation recorded about the GeoEntity, never a separate place entity or catalog.

#### Scenario: Museum from a structured provider
- **WHEN** a canonical museum inside Buenos Aires is classified by its provider as a visitor attraction, has a name and coordinates, and no tourism assertion exists for it
- **THEN** it is admitted and can be the VISIT component of a single-place Experience

### Requirement: Admission is decided by structured evidence, not a category whitelist
The admission policy SHALL NOT require membership of a base category in an exhaustive list of tourism categories. A place SHALL be admitted when it carries a decisive structured signal (provider visitor-attraction classification, historic classification or heritage designation), or a visitable-place class plus an independent notability signal (identity-linked encyclopedic item or provider prominence). Otherwise it SHALL be rejected with INSUFFICIENT_ADMISSION_EVIDENCE.

#### Scenario: Ordinary pharmacy
- **WHEN** a pharmacy carries no historic, heritage, visitor-classification or notability signal
- **THEN** it is rejected with INSUFFICIENT_ADMISSION_EVIDENCE

#### Scenario: Historic pharmacy
- **WHEN** a pharmacy carries a heritage designation
- **THEN** it is admitted

#### Scenario: Notable stadium
- **WHEN** a named stadium inside the destination is linked to an encyclopedic item with its own articles
- **THEN** it is admitted as an ordinary place

#### Scenario: Ordinary neighbourhood sports ground
- **WHEN** a stadium carries no notability, visitor-classification, historic or heritage signal
- **THEN** it is rejected with INSUFFICIENT_ADMISSION_EVIDENCE

#### Scenario: Bare artwork
- **WHEN** a named sculpture carries only `tourism=artwork` and no historic or heritage classification, encyclopedic notability, provider prominence or parent-site relationship
- **THEN** it is rejected with INSUFFICIENT_ADMISSION_EVIDENCE

### Requirement: The visitable-place mapping is never a whitelist
The visitable-place class mapping SHALL be supporting evidence only. It SHALL NOT be required to be exhaustive, and absence of a category from it SHALL NOT by itself reject a place.

#### Scenario: Unusual category with decisive evidence
- **WHEN** a bookstore, whose category is absent from the visitable-place mapping, carries a historic classification
- **THEN** it is admitted

### Requirement: Admission signals are canonical and recorded
Admission signals SHALL be provider-neutral typed facts produced by provider adapters from provider categories, alternate taxonomies, encyclopedic classes and statements, heritage designations, prominence values and structured relationships. Each admission record SHALL list the signals it relied on and the rule that admitted it.

#### Scenario: Tracing an admission
- **WHEN** a cemetery is admitted
- **THEN** its admission record lists, for example, the visitable-place class and the encyclopedic notability signal with their provider sources

### Requirement: Structured encyclopedic facts are admission evidence, not research
Structured facts from an identity-linked encyclopedic provider (classes, heritage designations, article links) MAY act as admission signals. They SHALL NOT create L2 assertions, SHALL NOT establish thematic relevance, and SHALL NOT require any search, page fetch or language model call.

#### Scenario: Heritage designation from an encyclopedic provider
- **WHEN** a place's linked encyclopedic item records a heritage designation
- **THEN** the place is admitted with that signal and no L2 assertion or research call exists

### Requirement: Small generic exclusion policy
The admission policy SHALL keep a small, provider-neutral set of exclusion classes: administrative or locality records, roads or routes as places, information points and signage, children whose visit unit is not themselves (SUB_FEATURE_OF, PARENT_NOT_ADMITTED, AMBIGUOUS_PARENT_RELATIONSHIP), transport-service features, technical infrastructure and accommodation. A base category that is usually non-touristic SHALL NOT reject a place unless it maps to an exclusion class.

#### Scenario: Transit stop named after a landmark
- **WHEN** a structured record is a bus stop named "Parque Lezama" with no decisive signal
- **THEN** it is rejected with reason EXCLUDED_CATEGORY

### Requirement: Only service exclusions yield to decisive evidence
Transport-service, technical-infrastructure and accommodation exclusions SHALL yield to a decisive structured signal. Administrative/locality, road/route, information/signage and grouped sub-feature exclusions SHALL always reject.

#### Scenario: Historic station
- **WHEN** a railway station carries a heritage designation or historic classification
- **THEN** it is admitted despite the transport-service exclusion

#### Scenario: Hotel
- **WHEN** a structured record is an ordinary hotel
- **THEN** it is rejected with reason EXCLUDED_CATEGORY

#### Scenario: Tourist information point
- **WHEN** a structured record is a tourist information point
- **THEN** it is rejected with reason EXCLUDED_CATEGORY even if its provider files it under a tourism key

### Requirement: One canonical admission policy
Admission signal types and strengths, the admission rule, exclusion classes and their overridability, parent/child relationship classes with their default visit units and the provider-neutral classes and signals used by ranking SHALL be defined once, in a versioned canonical admission policy, and admission, sub-feature grouping, ranking and planning SHALL consume it. No other component, test or experiment SHALL maintain its own exclusion list or admission whitelist.

#### Scenario: Exclusion change
- **WHEN** a provider value is remapped to the accommodation exclusion class
- **THEN** admission and every test observe the change without any other edit

### Requirement: Provider taxonomies map at the provider boundary
Provider tags and taxonomies SHALL be translated into canonical admission signals, exclusion classes and place classes only at the provider adapter boundary; downstream components SHALL reason over canonical signals and classes, not provider tags.

#### Scenario: Duplicate vocabulary introduced
- **WHEN** a module outside the provider adapter mappings defines its own list of excluded or admissible provider category values
- **THEN** the architecture check fails

### Requirement: Typed admission rejections
Every rejected candidate SHALL carry a typed reason (EXCLUDED_CATEGORY, INSUFFICIENT_ADMISSION_EVIDENCE, OUTSIDE_DESTINATION, NO_COORDINATES, NO_NAME, NO_CANONICAL_IDENTITY, DUPLICATE_OF) recorded with the policy version. OUTSIDE_DESTINATION SHALL be evaluated per request scope and never stored as a property of the GeoEntity.

#### Scenario: Record outside the destination
- **WHEN** a structured record lies outside the destination boundary
- **THEN** it is rejected with reason OUTSIDE_DESTINATION and is not composed

### Requirement: Admission keeps structured provenance
An admission decision SHALL record the provider identities, the structured fields it relied on and the policy version.

#### Scenario: Tracing an admitted place
- **WHEN** a single-place Experience appears in a Tour
- **THEN** the admission record of its place lists the provider records and fields that admitted it

### Requirement: Enrichment outcomes never revoke admission
Absence, failure, provider outage, verifier failure, insufficient corroboration or staleness of enrichment SHALL NOT revoke or block the admission of a place that the structured policy admitted. Admission SHALL change only when the structured evidence or the admission policy changes.

#### Scenario: Enrichment research fails
- **WHEN** research about an admitted place ends with INSUFFICIENT_CORROBORATION
- **THEN** the place remains admitted and its single-place Experience remains offered to tour composition

### Requirement: Parent relationships need structured evidence
A parent relationship SHALL be established only by an explicit provider relationship (site or relation membership, a "part of" property) pointing at a canonical place-site candidate, or by containment inside the parent's provider geometry together with a relationship class declared in the canonical policy. Relationships to areas, districts, routes, collections or designations SHALL NOT be parent-site relationships.

#### Scenario: Landmark part of a historic district
- **WHEN** a landmark's structured record says it is part of a historic district or a heritage listing
- **THEN** no parent-site relationship is established and the landmark keeps its ordinary admission

#### Scenario: Containment without relationship
- **WHEN** a place lies inside a park's geometry, no explicit relationship exists and no relationship class is declared for the pair
- **THEN** no parent relationship is established and the place is evaluated like any other place

### Requirement: Direct visit parent only
Visit-unit classification and composition SHALL use only the child's direct visit parent. Admission, composition and planning SHALL NOT traverse parent hierarchies recursively. Deeper PART_OF or containment relationships MAY be kept as canonical knowledge and SHALL NOT create admission gates, ambiguity or planner effects.

#### Scenario: Cemetery inside a historic district
- **WHEN** a tomb is part of a cemetery and the cemetery is part of a historic district
- **THEN** the tomb's visit parent is the cemetery, the district relationship is kept as knowledge, and it does not affect the tomb's classification

#### Scenario: Nested chain
- **WHEN** an artwork's direct parent is a room that itself requires a museum visit
- **THEN** the artwork is PARENT_NOT_ADMITTED and is not offered, and no grandparent is searched for

### Requirement: No unstructured relationship authority
Proximity, name similarity, embeddings, language-model output and web research SHALL NOT establish or classify a parent relationship.

#### Scenario: Nearby named statue
- **WHEN** a named statue stands near a museum with no structured relationship or containment evidence
- **THEN** no parent relationship is established

### Requirement: Visit-unit classification of children
Every established parent relationship SHALL be classified from structured evidence as CHILD_REQUIRES_PARENT_VISIT or CHILD_INDEPENDENTLY_VISITABLE, using the policy's default visit unit for the declared relationship class and per-instance evidence (separate entrance or access, separate opening hours, separate provider identity with an independently visitable class, explicit provider venue evidence). A name or coordinates alone SHALL NOT establish independent visitability.

#### Scenario: Tomb in a cemetery
- **WHEN** a tomb has a structured relationship to a cemetery and the relationship class defaults to requiring the parent visit
- **THEN** the tomb is classified CHILD_REQUIRES_PARENT_VISIT

#### Scenario: Venue inside a park
- **WHEN** a planetarium has a structured relationship to a park, its own entrance and its own opening hours
- **THEN** it is classified CHILD_INDEPENDENTLY_VISITABLE

### Requirement: Ambiguous relationships fail closed
When structured evidence is insufficient or contradictory to classify the visit unit, or a child has several plausible direct visit parents, the outcome SHALL be AMBIGUOUS_PARENT_RELATIONSHIP; ancestors of a valid direct visit parent SHALL NOT cause it: the child SHALL be neither collapsed into a parent nor offered as its own Experience.

#### Scenario: Contradictory evidence
- **WHEN** the relationship class defaults to requiring the parent visit but the child has its own opening hours and entrance
- **THEN** the outcome is AMBIGUOUS_PARENT_RELATIONSHIP and the child is not offered to the planner

### Requirement: Context-dependent children are represented by their parent
A CHILD_REQUIRES_PARENT_VISIT child of an admitted parent SHALL receive SUB_FEATURE_OF with the parent identity and evidence and SHALL NOT be offered to the planner. When the parent is not admitted or not in the catalog, the child SHALL receive PARENT_NOT_ADMITTED (context required) and SHALL NOT be promoted to its own Experience.

#### Scenario: Tombs inside an admitted cemetery
- **WHEN** many named tombs require the visit of an admitted cemetery
- **THEN** each tomb is recorded SUB_FEATURE_OF the cemetery and the planner receives only the cemetery's Experience

#### Scenario: Cemetery not admitted
- **WHEN** a tomb requires the visit of a cemetery that is not admitted
- **THEN** the tomb is recorded PARENT_NOT_ADMITTED, kept with its relationship, and not offered to the planner

### Requirement: Independently visitable children follow ordinary admission
A CHILD_INDEPENDENTLY_VISITABLE child SHALL be evaluated by the ordinary structured admission policy, MAY participate in its own Experience when admitted, and SHALL keep its parent relationship, independently of the parent's admission.

#### Scenario: Parent not admitted
- **WHEN** an independently visitable museum lies in a complex that is not admitted
- **THEN** the museum is admitted or rejected on its own structured evidence

### Requirement: Admission independence between parents and children
An admitted child SHALL NOT admit its parent, an admitted parent SHALL NOT admit its children, and grouping SHALL NOT remove a child's canonical identity. No named place SHALL appear in the relationship policy.

#### Scenario: Notable child, non-admitted parent
- **WHEN** a notable tomb requires the visit of a parent site with insufficient admission evidence
- **THEN** the parent stays not admitted and the tomb stays a canonical entity recorded PARENT_NOT_ADMITTED

### Requirement: Admission is independent of planning outcomes
Planner rejections, unscheduled outcomes, travel-estimate availability and UNKNOWN opening hours SHALL NOT change, revoke or downgrade an admission outcome, and SHALL NOT be admission evidence.

#### Scenario: Repeatedly unscheduled place
- **WHEN** an admitted place is rejected by the planner for OPENING_HOURS in several consecutive generations
- **THEN** its admission outcome and admission record are unchanged
