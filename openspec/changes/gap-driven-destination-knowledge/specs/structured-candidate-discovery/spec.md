# Spec Delta

## Purpose

Discovers which physical areas, places and routes exist in a destination from
structured providers and resolves them to canonical identities before any
tourism meaning is researched about them.

## ADDED Requirements

### Requirement: Candidates come from structured providers
Area, place and route candidates SHALL be acquired only from structured providers through their adapters (for example administrative subdivisions, structured named places, points of interest, structured entity records, named highways). Web prose and language model output SHALL NOT create a candidate.

#### Scenario: Cold destination
- **WHEN** Buenos Aires has no area candidates in the catalog
- **THEN** area candidates are acquired from structured geographic sources before any semantic research runs

### Requirement: Candidates are canonical before they are evaluated
Every acquired candidate SHALL be resolved to a GeoEntity identity through geographic identity resolution, with provider identity and geometry, and reconciled by the structured identity reconciliation policy, before structured admission or semantic evaluation. A candidate that cannot be resolved SHALL NOT be admitted or offered.

#### Scenario: Transit stop named after a landmark
- **WHEN** a structured source returns a bus stop named "Parque Lezama" next to the park
- **THEN** the structural-kind classification excludes the stop and only the park is offered as a place candidate

### Requirement: Structured identity reconciliation
Candidates SHALL be merged only by a deterministic, versioned reconciliation policy over structured evidence. Strong evidence (identical provider-native identity, one shared encyclopedic identity with no conflicting one, a provider structural relationship between the records, or an explicit provider cross-link) MAY merge on its own. Name similarity, coordinate proximity alone and embeddings SHALL NOT merge candidates. Ambiguous evidence SHALL leave candidates separate.

#### Scenario: Node member of the other record
- **WHEN** an OSM node is a member of the relation that is the other record
- **THEN** they merge into one canonical place

#### Scenario: Shared encyclopedic identity
- **WHEN** an OSM way and an OSM node carry the same Wikidata identity and no conflicting identity
- **THEN** they merge into one canonical place, keeping the way as the survivor

#### Scenario: Similar names nearby
- **WHEN** two nearby records have similar but not equal normalized names
- **THEN** they stay separate

### Requirement: Supporting evidence merges only in combination
Exact equality of normalized names, geometry correspondence and compatible categories SHALL merge candidates only all together, only when exactly one such match exists within the containing geometry, and only when no conflicting strong identity exists.

#### Scenario: Same name, node inside the area, no shared identity
- **WHEN** an attraction node and a square area have the same normalized name, the node lies inside the area, their categories are compatible and no other record of that name lies inside the area
- **THEN** they merge, and the merge records the structural-correspondence rule and its evidence

#### Scenario: Conflicting identities
- **WHEN** two records with equal names and corresponding geometry carry different Wikidata identities
- **THEN** they stay separate with reason CONFLICTING_QID

### Requirement: Reconciliation is deterministic and auditable
Reconciliation SHALL produce the same canonical set regardless of input order; survivor fields SHALL be canonicalized from all merged records. Every merge SHALL record the survivor, the merged identities, the rule and the evidence items. Every unmerged pair with equal normalized names and corresponding geometry SHALL be recorded in the reconciliation trace as a possible duplicate with the reason it stayed separate (NO_STRONG_EVIDENCE, CONFLICTING_QID, AMBIGUOUS_MATCH, NAME_ONLY, GEOMETRY_ONLY).

#### Scenario: Shuffled provider records
- **WHEN** the same provider records are reconciled in two different orders
- **THEN** the canonical places, survivors and merge records are identical

### Requirement: Merge evidence is kept with the identity attachment
Each provider identity attached to a canonical GeoEntity SHALL durably keep the reconciliation rule, policy version and evidence that attached it. Possible duplicates SHALL NOT create catalog records.

#### Scenario: Explaining a merged place
- **WHEN** an OSM node and an OSM area were merged into one GeoEntity by structural correspondence
- **THEN** the area's identity attachment records that rule, its policy version and the evidence, without a separate merge ledger

### Requirement: Area candidates follow the tourism-area model
Area candidates SHALL be administrative boundaries or structured named places (for example a neighbourhood or quarter record with its own provider identity). Each SHALL record its area class and whether its extent is a provider boundary or unknown. No area SHALL be created by fuzzy or lexical name matching.

#### Scenario: Informal area with a structured record
- **WHEN** a structured source has a named-place record for "Palermo Soho" with a point but no boundary
- **THEN** it becomes an area candidate with area class NAMED_PLACE and extent UNKNOWN, and no boundary is invented

#### Scenario: Informal name without a structured record
- **WHEN** no structured source has a record for an area name that appears only in web prose
- **THEN** no area candidate exists for it

### Requirement: Place discovery may be destination-scoped
Place candidates SHALL be discoverable directly within the destination boundary without any area candidate, area relevance or tourism assertion. Areas MAY scope additional discovery for clustering, diversity or walking composition, but SHALL NOT gate ordinary place discovery.

#### Scenario: Cold destination POI discovery
- **WHEN** Buenos Aires has no area or place knowledge
- **THEN** structured place discovery runs over the destination boundary and its results go to structured admission

### Requirement: Discovery does not hide notable places by base category
Structured place discovery SHALL retrieve every record within its scope that can carry a decisive or supporting admission signal, including records whose base category is normally non-touristic but that carry a historic classification, heritage designation, visitor classification or an encyclopedic link.

#### Scenario: Heritage-designated pharmacy
- **WHEN** a pharmacy inside the destination carries a heritage tag
- **THEN** destination-scope discovery retrieves it and admission decides on its signals

### Requirement: Discovery selectors are acquisition strategy
Provider query selectors SHALL be acquisition strategy derived from the adapter's signal mapping and SHALL NOT be consulted by admission. A selector bounded for operational reasons SHALL be recorded as a strategy limitation, never as a rejection.

#### Scenario: Ordinary shops
- **WHEN** shops inside the destination carry no signal-bearing attribute
- **THEN** discovery need not retrieve them, and their absence is not recorded as a rejection

### Requirement: Area-scoped discovery needs a known extent
Discovery scoped to an area SHALL use only areas whose extent is a provider boundary. An area with unknown extent SHALL NOT scope place or route discovery.

#### Scenario: Corridor candidates in San Telmo
- **WHEN** San Telmo is known with its administrative boundary
- **THEN** named streets crossing that boundary are acquired as route candidates with their provider geometry

### Requirement: Structural signals rank, never authorize
Structured signals such as point-of-interest tags, encyclopedic links or proximity of a street to grounded places MAY rank or select which candidates are offered for evaluation within a budget. They SHALL NOT establish tourism relevance.

#### Scenario: Street near grounded places
- **WHEN** Defensa passes within the buffer of several grounded relevant places in San Telmo
- **THEN** Defensa is ranked high among route candidates offered for corridor evaluation, and no corridor assertion exists until grounding authorizes one

### Requirement: Discovery outcomes are recorded
Each discovery execution SHALL record the provider calls, candidates acquired, candidates resolved and candidates excluded with typed reasons. A provider failure SHALL be FAILED, never an empty candidate set.

#### Scenario: Overpass timeout
- **WHEN** the structured provider times out during place discovery
- **THEN** the discovery outcome is FAILED and the area is not recorded as having no places
