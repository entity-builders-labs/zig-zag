## Purpose

Evaluate optional provider-neutral reputation and popularity evidence for
already-admitted Experiences as a separate ranking dimension. The completed
39.16 Groq-grounding pilot is historical evidence. The bounded Foursquare
spike in 39.17 evaluates structured reputation enrichment without making any
provider or reputation fact a requirement for admission, composition,
preference relevance or planning.

## ADDED Requirements

### Requirement: Reputation is optional and post-admission

Reputation enrichment SHALL accept only independently admitted and composed
Experiences from a bounded competitive shortlist. It SHALL NOT participate in
discovery or admission, create a GeoEntity or Experience, or revoke an
Experience when unavailable, failed, missing, unsupported or `UNKNOWN`.

#### Scenario: No enrichment for an unadmitted candidate
- **WHEN** a candidate has no independently admitted and composed Experience
- **THEN** the reputation provider is not queried for that candidate

#### Scenario: Reputation failure preserves the Experience
- **WHEN** the reputation provider is unavailable, fails, or returns no usable
  evidence for an admitted Experience
- **THEN** reputation is `UNKNOWN` and admission, composition and catalog
  presence remain unchanged

### Requirement: Reputation facts are typed and provenance-backed

Reputation SHALL be represented by a provider-neutral `KNOWN { facts } | UNKNOWN`
contract. Each known fact SHALL identify its canonical GeoEntity, fact kind,
value and scale, provider, provider place identifier, observation time and
source field. Provider-specific response fields SHALL be normalized at the
adapter; raw provider JSON and free-form prose SHALL NOT be ranking authority.

#### Scenario: Normalize rating and popularity independently
- **WHEN** a provider returns a supported reputation rating, popularity
  measure, or both for a consistently matched canonical place
- **THEN** each available fact is represented as its own typed, scaled fact
  with provider and source-field provenance

#### Scenario: Missing provider fields remain unknown
- **WHEN** one or more reputation fields are missing, unavailable or
  unsupported
- **THEN** only those facts are `UNKNOWN`; missing data is not negative
  evidence and does not overwrite other known facts

### Requirement: External reputation identity must be spatially consistent

The reputation adapter SHALL consume external facts only when the matched
place is spatially consistent with the canonical GeoEntity under the
applicable canonical identity authority. Ambiguous, conflicting, unmatched
or insufficiently supported identity SHALL yield `UNKNOWN`. Matching SHALL
NOT rely on name alone, place-specific exceptions or arbitrary global
distance thresholds.

#### Scenario: One spatially consistent place match
- **WHEN** one external place is established as spatially consistent with the
  canonical GeoEntity by the applicable canonical identity authority
- **THEN** its supported reputation facts may be consumed

#### Scenario: Ambiguous or geographically conflicting match
- **WHEN** multiple external places remain plausible, or a same-name place
  has conflicting geography or category evidence
- **THEN** no linked reputation fact affects ranking and reputation remains
  `UNKNOWN`

### Requirement: Reputation remains distinct from other catalog concerns

Reputation SHALL remain separate from admission, encyclopedic prominence,
preference relevance and planning readiness. It SHALL NOT be stored in
`GeoEntityTargetObservation` or used to fabricate a legacy `qualityScore`.
Wikidata remains optional identity corroboration and encyclopedic
notability/prominence; its absence SHALL NOT erase non-Wikidata preference
observations.

#### Scenario: Reputation does not establish admission
- **WHEN** a candidate has reputation facts but lacks independent structured
  admission evidence
- **THEN** the candidate remains unadmitted

#### Scenario: Preference facts remain independent
- **WHEN** an admitted Experience has structured gastronomy, art, history or
  architecture observations and no Wikidata enrichment
- **THEN** those observations remain usable independently of reputation

### Requirement: Reputation ranking is experimental, neutral and explainable

Only validated typed reputation facts MAY affect the bounded ranking
comparison as separate dimensions. Preference relevance and structured
prominence SHALL retain precedence; rating and popularity SHALL not be
combined into a scalar. `UNKNOWN` is neutral under the current within-tier
unknown behavior. The spike SHALL NOT enable production ranking authority.

#### Scenario: Unknown reputation is neutral
- **WHEN** reputation is unknown for an admitted Experience
- **THEN** missing reputation does not lower admission or create a negative
  ranking fact

#### Scenario: Preference relevance remains higher priority
- **WHEN** two candidates differ on an existing preference-relevance level
  and reputation facts favor the candidate with lower preference relevance
- **THEN** the reputation experiment does not reverse their preference-level
  order

#### Scenario: Ranking explains a reputation-driven order change
- **WHEN** known reputation changes ordering among candidates tied on all
  higher-priority preference and prominence dimensions
- **THEN** the explanation identifies the rating or popularity fact and its
  provider/source-field provenance

### Requirement: The Foursquare experiment is bounded and measured

The Buenos Aires experiment SHALL use a bounded shortlist of already-composed
Experiences and report reputation coverage, match outcomes, call/billing
details, cache behavior, latency and actual/estimated cost. It SHALL capture
canonical and external identity evidence sufficient to audit attempted
matches.

#### Scenario: The shortlist is bounded and stratified
- **WHEN** the measured catalog has more eligible Experiences than the
  enrichment shortlist
- **THEN** only the bounded stratified shortlist is queried, with diagnostics
  included only when they are already composed

#### Scenario: The shortlist covers catalog strata
- **WHEN** enough composed candidates and budget are available
- **THEN** the roughly 50–100 candidate sample includes top, middle,
  gastronomy, museum/attraction and secondary/niche places, with requested
  diagnostics when present and no hardcoded desired matches or ranks

#### Scenario: The run records provider coverage and cost
- **WHEN** the bounded provider experiment completes
- **THEN** the evidence records rating/popularity present and missing counts,
  match outcomes, API calls by billing tier, cache hits/misses or cache
  unavailability, latency, identity mismatches and actual/estimated cost

#### Scenario: Provider billing and field availability are explicit
- **WHEN** the Foursquare experiment returns or omits reputation fields
- **THEN** the report records the selected API version, endpoint, actual
  rating/popularity availability, billing tier and observed or estimated
  cost, without assuming a legacy API contract

### Requirement: Reputation does not change admission or planning

The reputation capability SHALL remain off discovery/admission and planning
critical paths. It SHALL NOT supply visit-duration, opening-hours, identity or
visit-unit facts.

#### Scenario: Planning remains independent
- **WHEN** reputation is missing or unavailable
- **THEN** duration, opening-hours, routing and planning-readiness behavior
  remain unchanged
