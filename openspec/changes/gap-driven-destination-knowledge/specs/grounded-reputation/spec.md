## Purpose

Evaluate optional, grounded web reputation for already-admitted Experiences as
a separate ranking signal. This capability is experimental and does not make
web research a requirement for admission, composition, preference relevance or
planning.

## ADDED Requirements

### Requirement: Reputation is post-admission and bounded
Grounded reputation acquisition SHALL accept only independently admitted
Experiences and SHALL operate on a bounded competitive shortlist, not every
discovered POI. Reputation SHALL NOT participate in admission or revoke an
Experience when absent, failed, unsupported or `UNKNOWN`.

#### Scenario: No query for unadmitted candidates
- **WHEN** a candidate has no admitted Experience
- **THEN** the grounded-reputation path does not query it

#### Scenario: Only shortlisted Experiences are queried
- **WHEN** the catalog contains more discovered POIs than the competitive
  reputation shortlist
- **THEN** grounded research is limited to the offered admitted shortlist

#### Scenario: Reputation failure preserves the Experience
- **WHEN** the grounding provider is unavailable, fails or returns no usable
  evidence for an admitted Experience
- **THEN** reputation is `UNKNOWN` and the Experience remains admitted,
  composed and available

### Requirement: Reputation facts are typed, grounded and provenance-backed
Reputation SHALL be provider-neutral `KNOWN { evidence } | UNKNOWN`. Each
positive fact SHALL reference a returned grounding source and retain
inspectable provenance. Unsupported, uncited or identity-ambiguous claims
SHALL produce `UNKNOWN`. Free-form prose and opaque model-generated numeric
scores SHALL NOT be ranking authority.

#### Scenario: Citation-backed positive fact
- **WHEN** returned grounding sources establish a typed reputation fact for
  the same canonical Experience identity
- **THEN** the fact is `KNOWN` with its source citation and provenance

### Requirement: Reputation evidence uses an approved typed vocabulary
Initial evidence types SHALL be `OFFICIAL_TOURISM_MENTION`,
`REPEATED_TRAVEL_GUIDE_RECOMMENDATION`, `REPUTABLE_EDITORIAL_MENTION` and
`CURRENT_VENUE_PRESENCE`. Additional types require an OpenSpec revision.

#### Scenario: Reputation type is explicit
- **WHEN** a source supports a positive reputation fact
- **THEN** the normalized fact uses an approved evidence type rather than a
  free-form category

#### Scenario: No returned source supports the claim
- **WHEN** a model assertion has no corresponding returned source citation
- **THEN** the assertion is discarded and reputation is `UNKNOWN` if no other
  supported fact remains

#### Scenario: Wrong or ambiguous place identity
- **WHEN** returned sources refer to a different or ambiguous real-world place
- **THEN** those sources contribute no reputation evidence and cannot affect
  ranking

### Requirement: Reputation remains distinct from other catalog concerns
Reputation SHALL remain separate from admission, encyclopedic prominence,
preference relevance and planning readiness. It SHALL NOT be stored in
`GeoEntityTargetObservation` or used to fabricate a legacy `qualityScore`.
Wikidata remains optional identity corroboration and encyclopedic
notability/prominence; its absence SHALL NOT erase non-Wikidata preference
observations.

#### Scenario: Reputation does not establish admission
- **WHEN** a candidate has grounded reputation evidence but lacks independent
  structured admission evidence
- **THEN** the candidate remains unadmitted

#### Scenario: Preference facts remain independent
- **WHEN** an admitted Experience has structured gastronomy, art, history or
  architecture observations and no Wikidata enrichment
- **THEN** those observations remain usable independently of reputation

### Requirement: Reputation may affect ranking only when evidence is usable
Only validated typed reputation evidence MAY affect ranking, as a separate,
deterministic and explainable dimension among valid Experiences. `UNKNOWN` is
neutral and SHALL NOT invalidate an Experience or substitute for
encyclopedic prominence or preference relevance. Ranking explanations SHALL
expose the typed reputation evidence that changed ordering.

#### Scenario: Unknown reputation is neutral
- **WHEN** one admitted Experience has `UNKNOWN` reputation
- **THEN** missing reputation alone does not lower its admission or assign a
  negative ranking fact

#### Scenario: Ranking explains grounded reputation effect
- **WHEN** supported reputation evidence changes ordering between admitted
  Experiences
- **THEN** the ranking reason identifies its typed evidence and source
  provenance, not a free-form model score

### Requirement: The experiment reports measured grounding quality
The Buenos Aires experiment SHALL use a bounded, stratified sample of roughly
50–100 admitted Experiences when runtime/cost permits. It SHALL report
queries, grounded matches, `UNKNOWN`, citation/source coverage, identity
mismatches, evidence/source categories, latency, token usage, provider-reported
cost when available, and cache availability plus actual hit/miss behavior.
Absence of a reusable cache SHALL be reported, not concealed by a synthetic
cache result.

#### Scenario: Sample is representative and bounded
- **WHEN** a reputation experiment is run
- **THEN** the sample includes current top, middle, gastronomy and
  low-prominence candidates, plus named diagnostics when present, without
  querying every discovered POI or hardcoding desired ranks

#### Scenario: Provider configuration and measurements are captured
- **WHEN** the Groq grounded-web path is measured
- **THEN** the actual configured model/tool, latency, token usage and
  available cost/cache fields are recorded from the run rather than assumed

### Requirement: Reputation experiment does not change admission or planning
The grounded-reputation capability SHALL remain off the discovery/admission
and planning critical paths. It SHALL NOT be required for Experience existence
and SHALL NOT supply duration, opening hours, identity or visit-unit facts.

#### Scenario: Planning remains independent
- **WHEN** grounded reputation is missing or unavailable
- **THEN** duration, opening-hours, routing and planning-readiness behavior
  remain unchanged
