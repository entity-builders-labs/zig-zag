# Spec Delta

## Purpose

Defines structured prominence as reusable, provenance-bearing knowledge about
a canonical GeoEntity and as a ranking input for request-specific Experience
candidates, separately from admission and user preference relevance.

## ADDED Requirements

### Requirement: Structured prominence is a separate typed concern
Structured prominence SHALL be typed GeoEntity evidence, separate from
identity, visit unit, admission, preference relevance and planning readiness.
It SHALL reuse existing canonical evidence vocabulary and SHALL NOT create a
second provider-tag mapping or admission policy.

#### Scenario: Wikidata identity without notability
- **WHEN** a GeoEntity has a Wikidata QID but no linked article/sitelink facts
- **THEN** the QID remains identity evidence and prominence is UNKNOWN

#### Scenario: Historic classification without prominence
- **WHEN** a GeoEntity carries only HISTORIC_CLASSIFICATION
- **THEN** no prominence is inferred from that fact alone

### Requirement: Prominence evidence keeps its source semantics and provenance
Each fact SHALL retain its evidence kind, canonical GeoEntity, source identity,
record and field, observed value and time. Applicable language,
authority/level, provider metric and comparison scope SHALL be typed fields.
Kinds MAY include linked sitelinks, heritage designation, visitor class and
provider prominence actually supplied by an enabled structured provider.

#### Scenario: Sitelink fact is auditable
- **WHEN** an identity-linked structured provider supplies a sitelink count
- **THEN** the persisted fact identifies the linked item, the provider field,
  count and observation time, and does not infer a value from the QID alone

#### Scenario: Provider rank is scoped
- **WHEN** a structured provider supplies a popularity/rank value
- **THEN** its metric and comparison scope are retained and no cross-provider
  comparability is assumed

### Requirement: Missing prominence remains UNKNOWN
When no applicable prominence evidence is acquired, when the source returns no
such fact, or when the source is unavailable, prominence SHALL remain UNKNOWN
with the acquisition outcome preserved where known. Absence SHALL NOT be
converted to a zero, a negative classification, a default score or evidence
that another candidate is more important.

#### Scenario: Source has not supplied prominence
- **WHEN** the current provider supplies no structured prominence fact for a
  candidate
- **THEN** those facts remain UNKNOWN and no synthetic substitute is stored

### Requirement: Prominence evidence is persisted as GeoEntity knowledge
Known prominence evidence SHALL be persisted against its canonical GeoEntity
with typed source-specific values and provenance. It SHALL NOT be hidden in
metadata, stored as an admission result or Experience field, or create a
second place catalog.

#### Scenario: Identity remains stable when prominence changes
- **WHEN** new or revised prominence evidence is acquired for a GeoEntity
- **THEN** its identity and Experience composition signature remain unchanged
  while the GeoEntity prominence knowledge is updated with provenance

### Requirement: Prominence orders only valid Experience candidates
The versioned structured-prominence policy SHALL order valid request-specific
Experience candidates using their GeoEntity evidence. It SHALL NOT change
identity, visit unit, admission, preference relevance or planning readiness.
The transient ordering records policy/evidence references and SHALL NOT persist
an editorial rank on a reusable Experience.

#### Scenario: Prominence comparison is evidence-based
- **WHEN** two valid candidates have comparable positive structured prominence
  evidence
- **THEN** the versioned policy may order them by that evidence and breaks a
  tie deterministically by canonical identity, without a universal numeric
  score or arbitrary threshold

#### Scenario: Incomparable or unknown candidates
- **WHEN** prominence evidence is absent or values come from incomparable
  sources or scales
- **THEN** the candidates remain incomparable on prominence and use the
  neutral deterministic tie-break, with UNKNOWN preserved

#### Scenario: Lower-ranked candidate remains valid
- **WHEN** one valid Experience ranks below another for a request
- **THEN** it remains admitted, composable and available in the catalog

#### Scenario: Preference relevance is not prominence
- **WHEN** request-specific selection also evaluates the user's stated
  preferences
- **THEN** preference relevance remains a separately typed signal and never
  becomes admission evidence or is persisted as catalog prominence
