# Spec Delta

## Purpose

Turns an eligible set of Experiences into the best feasible
multi-day itinerary for one request. The planner decides jointly which
candidates are scheduled, on which day, in which order, at which times and
with which travel mode between consecutive activities, under hard
feasibility constraints, and explains every eligible candidate it did not
schedule. Ranking says how desirable a candidate is; planning says which
desirable candidates can form the best feasible itinerary.

## ADDED Requirements

### Requirement: Planner responsibility is joint itinerary construction
Given an eligible set of Experiences, a requested number of days, candidate utility, visit durations, opening-hours knowledge, travel estimates, user schedule constraints and mobility constraints, the planner SHALL decide jointly the selected candidates, the day of each selected candidate, the visit order within each day, the planned start and end of each visit and the travel mode of each leg. Selection SHALL NOT be fixed by ranking order before feasibility is evaluated.

#### Scenario: Highly ranked candidate moved to another day
- **WHEN** the highest-utility candidate is closed on day 1 and open on day 2 of a 2-day request
- **THEN** the planner schedules it on day 2 instead of omitting it or scheduling it on day 1

#### Scenario: Highly ranked candidate omitted
- **WHEN** a high-utility candidate cannot be reached within any day's constraints
- **THEN** it is not scheduled and carries a typed planner rejection reason, and the remaining itinerary is still built

### Requirement: Planning is separate from ranking, admission and acquisition
The planner SHALL consume candidate utility as an input and SHALL NOT discover POIs, resolve entity identity, decide admission, run research, call language models or generate narrative. Planner outcomes SHALL NOT modify a candidate's admission, identity, ranking inputs or catalog content, and SHALL NOT be used as evidence that more tourism knowledge is required.

#### Scenario: Rejected landmark stays admitted
- **WHEN** an admitted museum is rejected by the planner for opening hours in one generation
- **THEN** its admission evaluation, its Experience's identity and catalog content are unchanged and it remains eligible for the next request

#### Scenario: Ordinary planning makes no research call
- **WHEN** a Tour is planned from single-place Experiences of admitted structured GeoEntities
- **THEN** the planning stage makes zero LLM, web-search and page-fetch calls

### Requirement: Planner candidates are Experiences
The planner SHALL be offered only eligible Experiences, one candidate per Experience; a VISIT component SHALL reference a GeoEntity that is its own visit unit. Children classified CHILD_REQUIRES_PARENT_VISIT (SUB_FEATURE_OF or PARENT_NOT_ADMITTED) and children with AMBIGUOUS_PARENT_RELATIONSHIP SHALL NOT be visited as their own Experience; independently visitable admitted children MAY be.

#### Scenario: Museum then tomb
- **WHEN** a destination has an admitted museum and tombs that require a cemetery visit
- **THEN** no itinerary can contain an individual tomb as a stop; only the cemetery's Experience can represent them

### Requirement: Composite Experiences are one candidate
A composite Experience SHALL be scheduled as one planner candidate. The planner MAY decide whether it is selected, its day, its start and its position among other Experiences, and SHALL NOT flatten it into independent candidates, reorder or drop its required components, or rewrite its internal composition.

#### Scenario: San Telmo walk in a plan
- **WHEN** the San Telmo walk is selected
- **THEN** it appears as one scheduled Experience whose components keep their order, and no component is scheduled separately

### Requirement: Composite internal timeline feasibility
A composite Experience SHALL be feasible only if its internal timeline — components in order, internal travel and required traversal time, component visit durations — reaches every internal PLACE component with known opening hours inside a valid opening window. One opaque candidate-level opening-hours value SHALL NOT suffice for a composite; a single-place Experience collapses to its one component's availability.

#### Scenario: Market closed at arrival
- **WHEN** a walk's internal timeline would reach its market component after the market closes
- **THEN** that start time is infeasible for the walk and the planner chooses another start, another day, or rejects the walk with OPENING_HOURS

### Requirement: Typed planning input per candidate
The planning input SHALL contain, for each candidate, its canonical Experience identity, utility from ranking, its ordered components with participation, each VISIT component's duration and opening-hours knowledge with provenance, each required traversal constraint, spatial footprints and any request-declared inclusion constraint. Invalid input SHALL be rejected, never defaulted.

#### Scenario: Missing duration provenance
- **WHEN** a candidate reaches the planner without a duration provenance
- **THEN** the input is rejected as invalid rather than defaulted

### Requirement: Typed planning input per request
The planning input SHALL contain the number of days, each day's calendar date and destination-local timezone, daily start and end times, optional user unavailable windows, allowed travel modes, maximum continuous walking, maximum daily walking, a resolved cycling limit when BICYCLE is allowed (with surface-neutral provenance such as a named mobility profile and its version) and the versioned planner policies in force (objective, UNKNOWN opening-hours policy).

#### Scenario: Policies recorded
- **WHEN** a plan is produced
- **THEN** the objective and UNKNOWN opening-hours policy versions used are part of the recorded input

#### Scenario: Cycling limit is explicit and traceable
- **WHEN** BICYCLE is allowed and the planning input carries no resolved cycling limit
- **THEN** it is invalid planning input and no universal default limit is applied; when a resolved limit is present, the plan records it with its surface-neutral provenance

#### Scenario: Planner is independent of the input surface
- **WHEN** the same resolved cycling limit reaches the planner from explicit user input, conversational intent, a contextual UI action or a named mobility profile
- **THEN** planning behaves identically, and the planning input does not identify the interaction surface that produced the value

### Requirement: Opening hours are hard feasibility constraints
For every scheduled visit whose opening-hours knowledge for the planned date is KNOWN_OPEN_WINDOW, the complete visit interval SHALL lie inside one applicable opening window, and when a last-admission time is known the visit SHALL start no later than it. A candidate whose knowledge for the planned date is KNOWN_CLOSED SHALL never be scheduled on that date.

#### Scenario: Known-closed day
- **WHEN** a museum is known closed on Mondays and day 1 is a Monday
- **THEN** the museum is never scheduled on day 1

#### Scenario: Visit would run past closing
- **WHEN** a 90-minute visit could start at 17:00 and the place closes at 18:00
- **THEN** that start time is infeasible and the visit is either scheduled no later than 16:30 or not on that day

#### Scenario: Split opening windows
- **WHEN** a place opens 09:00-12:00 and 15:00-19:00 and the visit lasts 120 minutes
- **THEN** the visit is scheduled entirely inside one window, never spanning 12:00-15:00

#### Scenario: Last admission
- **WHEN** a place closes at 18:00 with last admission at 17:00 and the visit lasts 45 minutes
- **THEN** the visit never starts after 17:00

### Requirement: Opening hours are resolved per calendar date
Opening-hours knowledge SHALL be resolved per calendar date in the destination's local time, supporting day-specific hours, closed days, multiple windows per day and date-specific exceptions when available, with exceptions taking precedence over the regular weekly pattern.

#### Scenario: Date-specific exception
- **WHEN** a place's weekly pattern says open on a date for which a closure exception is known
- **THEN** the place is not scheduled on that date

### Requirement: Opening-hours knowledge is explicit
Opening-hours knowledge for a candidate on a date SHALL be one of KNOWN_OPEN_WINDOW (one or more windows), KNOWN_CLOSED or UNKNOWN, with its provenance. UNKNOWN SHALL NOT be treated as equivalent to open.

#### Scenario: No hours in the provider record
- **WHEN** a structured provider record carries no opening hours
- **THEN** the candidate's knowledge is UNKNOWN for every date, not an assumed all-day window

### Requirement: UNKNOWN opening hours follow a versioned planning policy
The treatment of UNKNOWN opening hours SHALL be a versioned planning policy chosen outside the optimizer, with the options ALLOW_WITH_UNCERTAINTY, PENALIZE and EXCLUDE; the default SHALL be PENALIZE. The policy and its version SHALL be recorded with the plan. UNKNOWN SHALL NOT be treated as open or closed and SHALL NOT be resolved by web or LLM research on the planning path.

#### Scenario: Exclude policy
- **WHEN** the policy is EXCLUDE and a candidate's hours are UNKNOWN
- **THEN** the candidate is not scheduled and carries the reason OPENING_HOURS_UNKNOWN_EXCLUDED

#### Scenario: Allow policy
- **WHEN** the policy is ALLOW_WITH_UNCERTAINTY and a candidate with UNKNOWN hours is scheduled
- **THEN** the scheduled visit is marked OPENING_HOURS_UNKNOWN with the policy version, and no research is triggered

### Requirement: Default PENALIZE semantics
Under PENALIZE, UNKNOWN hours SHALL create no opening-hours hard constraint, so a VISIT component with UNKNOWN hours is feasible on hours alone; it SHALL NOT override any other hard infeasibility. The objective SHALL include the soft term openingHoursUncertaintyPenalty over scheduled VISIT components with UNKNOWN hours; its weight and form belong to the objective policy.

#### Scenario: Comparable candidates
- **WHEN** candidate A is known open during its planned visit, candidate B has comparable utility and UNKNOWN hours, and only one fits
- **THEN** the planner may prefer A, B is not excluded for its hours, and if B is unscheduled its reason is DOMINATED_BY_HIGHER_UTILITY_PLAN

#### Scenario: Unknown hours become enrichment demand
- **WHEN** a scheduled visit is accepted with UNKNOWN hours
- **THEN** the generation does not wait, and deduplicated opening-hours enrichment demand is recorded for that GeoEntity

#### Scenario: Only unknown-hours candidates
- **WHEN** the remaining feasible candidates all have UNKNOWN hours
- **THEN** they are scheduled and each scheduled visit is marked OPENING_HOURS_UNKNOWN

#### Scenario: Uncertainty cost never erases an Experience by itself
- **WHEN** an UNKNOWN-hours Experience of any positive preference utility fits the plan without displacing another Experience or adding travel
- **THEN** the uncertainty cost alone does not make leaving it out the better plan

### Requirement: UNKNOWN hours inside composites and must-include items
The UNKNOWN-hours policy SHALL apply per internal VISIT component of a composite; the Experience SHALL expose the set of its uncertain components rather than one candidate-level flag. A must-include Experience or component with UNKNOWN hours SHALL NOT be removed or given invented hours and SHALL be scheduled under the policy with its uncertainty surfaced.

#### Scenario: Market hours unknown in a walk
- **WHEN** the San Telmo walk's Mercado component has UNKNOWN hours and its other components fit their known windows
- **THEN** the walk is feasible, and its Mercado visit is marked OPENING_HOURS_UNKNOWN

#### Scenario: Internal component known closed
- **WHEN** an internal component of a composite is known closed at its planned internal arrival
- **THEN** that schedule of the composite is infeasible

#### Scenario: Must-include known closed throughout
- **WHEN** a must-include place is known closed on every feasible interval of the trip
- **THEN** the planner reports a constraint conflict with OPENING_HOURS instead of dropping it silently

### Requirement: Visit duration is an input with provenance
The planner SHALL consume each candidate's visit duration as normalized visit-duration knowledge projected into its input, with the winning authority class (STRUCTURED_PROVIDER, OFFICIAL_SITE, OFFICIAL_TOURISM_OR_INSTITUTIONAL, REFERENCE_TRAVEL, USER_GENERATED, GROUNDED_SYNTHESIS or FALLBACK_POLICY), resolution status and versions. The planner SHALL NOT discover, infer or research durations and SHALL NOT contain category-duration logic.

#### Scenario: Duration participates in scheduling
- **WHEN** two otherwise identical candidates have durations of 30 and 180 minutes and only 60 minutes remain in a day
- **THEN** only the 30-minute candidate can be scheduled in that remainder

#### Scenario: Fallback duration
- **WHEN** no structured or catalog duration exists for a candidate
- **THEN** the configured fallback policy supplies the duration, the visit is marked FALLBACK_POLICY with the policy version, and the Experience identity is unchanged

#### Scenario: Fallback inside a composite
- **WHEN** a walk's Mercado VISIT component has no duration knowledge and its Defensa TRAVERSE has a provider-backed estimate
- **THEN** only the Mercado visit uses the fallback (marked FALLBACK_POLICY), the traversal uses its routing estimate, and the walk stays one candidate

#### Scenario: Typical duration preferred
- **WHEN** a place's duration knowledge holds minimum 45, typical 90 and maximum 150 minutes
- **THEN** the planner input uses 90 minutes and records that the typical value was projected

### Requirement: Multi-day temporal feasibility
Each planned day SHALL start no earlier than the daily start time and end no later than the daily end time, SHALL not overlap user unavailable windows with visits or travel, and SHALL account for every visit duration and every travel leg between consecutive activities. Each selected candidate SHALL be scheduled at most once across all days.

#### Scenario: User unavailable window
- **WHEN** the user is unavailable 13:00-15:00 on day 2
- **THEN** no visit or travel leg on day 2 overlaps 13:00-15:00

#### Scenario: Travel time is part of feasibility
- **WHEN** two visits fit back to back without travel but the leg between them takes 40 minutes
- **THEN** the second visit starts no earlier than 40 minutes after the first ends

### Requirement: Optional day anchors
Each planned day MAY have an optional start anchor and end anchor (for example the traveller's hotel). When present, the leg from the start anchor to the first Experience and from the last Experience to the end anchor SHALL be planned like any other leg. When absent, no anchor SHALL be invented, first- and last-mile travel SHALL be excluded, and the plan SHALL record that exclusion.

#### Scenario: No anchors supplied
- **WHEN** a request supplies no start or end location
- **THEN** only legs between Experiences are estimated and the plan records that first- and last-mile travel is not included

#### Scenario: Hotel each day
- **WHEN** day 2 has a hotel as start and end anchor
- **THEN** day 2 includes the hotel → first Experience and last Experience → hotel legs within its time window

### Requirement: Mobility constraints are hard and affect mode choice
The planner SHALL respect the user's allowed travel modes, maximum continuous walking and maximum daily walking budget, counting every walking portion of every leg (including access and egress of non-walking legs). Walking limits SHALL shape mode choice and feasibility and SHALL NOT be reported as missing candidate knowledge.

#### Scenario: Walking only with distant candidates
- **WHEN** only walking is allowed and a candidate is beyond the walking limits from every feasible predecessor
- **THEN** the candidate is rejected with WALKING_LIMIT, and readiness treats it as unused eligible supply

### Requirement: Cycling limit is a hard constraint
When BICYCLE is allowed, the planner SHALL enforce the planning input's resolved cycling limit on BICYCLE travel, measured on provider-backed bicycle estimates. Input adapters SHALL resolve the limit before planning; its representation and unit are part of the planning-input contract. The limit SHALL be a feasibility constraint, never an objective weight, and SHALL NOT be reported as missing candidate knowledge.

#### Scenario: Ride beyond the cycling limit
- **WHEN** only BICYCLE is allowed and every feasible BICYCLE leg to a candidate exceeds the resolved cycling limit
- **THEN** the candidate is rejected with CYCLING_LIMIT regardless of its preference utility, and readiness treats it as unused eligible supply

### Requirement: Travel mode is a planner decision, not a default
For each leg the planner SHALL choose among the allowed modes for which a travel estimate exists, as part of the itinerary optimization, and SHALL NOT choose walking merely because walking is allowed. A non-walking mode SHALL be able to make geographically separated candidates feasible.

#### Scenario: Faster non-walking leg chosen
- **WHEN** walking and driving are allowed, a leg is 50 minutes on foot and 15 minutes by car, and the walking leg would prevent scheduling another visit
- **THEN** the leg uses driving

#### Scenario: Separated candidates become feasible
- **WHEN** two high-utility candidates are too far apart to walk within the walking limits and driving is allowed with a feasible estimate
- **THEN** both can be scheduled on the same day connected by a driving leg

### Requirement: Hard constraints are never traded for utility
The planner SHALL maximize itinerary utility only over itineraries that satisfy every hard constraint: opening hours and closed days, day windows, user unavailable windows, visit durations, travel times, allowed modes, walking limits, the cycling limit, at most one visit per candidate and request-declared inclusion constraints. No hard constraint SHALL be converted into an objective weight.

#### Scenario: High utility cannot buy a constraint violation
- **WHEN** scheduling a candidate past its closing time would raise total utility
- **THEN** the candidate is not scheduled past closing regardless of its utility

### Requirement: Versioned planner objective
The objective SHALL maximize the request's preference utility over hard-feasible itineraries minus soft costs for travel burden, optional vehicle mode friction and UNKNOWN-hours uncertainty. Further terms SHALL be enabled only on measured evidence. One baseline policy SHALL apply to every destination, without destination-specific weights. The enabled terms and their weights SHALL be a versioned planner policy recorded with the plan.

#### Scenario: Objective change is versioned
- **WHEN** the weight of the travel-time cost changes
- **THEN** plans produced afterwards record a new objective policy version

#### Scenario: Same policy across destinations
- **WHEN** Tours are planned for a dense and a dispersed destination
- **THEN** both use the same objective policy version and weights

#### Scenario: Mode friction is not travel time
- **WHEN** the objective charges a per-leg friction cost for a vehicle mode
- **THEN** the leg's planned duration and estimate remain the provider-backed travel time

### Requirement: Preference utility is derived upstream of the optimizer
Each candidate's preference utility SHALL be derived once, before optimization, at exactly one canonical derivation boundary, as a typed breakdown (explicit preference evidence with provenance, soft venue-anchor affinity, semantic affinity, generic quality) under a versioned preference-utility policy. No consumer SHALL recombine or recompute it. The optimizer SHALL receive only the prize the versioned objective policy projects from it, never embeddings, text, facets or provider metadata.

#### Scenario: Explicit facets outrank semantic similarity
- **WHEN** Experience A strongly matches more of the requested facets than Experience B and B has higher semantic similarity
- **THEN** A's preference utility is not lower than B's

#### Scenario: Quality does not override semantic refinement
- **WHEN** Experiences A and B have equal explicit preference evidence, A has higher semantic similarity and B has higher generic quality
- **THEN** A ranks above B

#### Scenario: Missing embedding is unknown, not zero
- **WHEN** an otherwise eligible Experience has no compatible embedding
- **THEN** its semantic affinity is UNKNOWN, it still participates, and it is ranked neither as if its similarity were zero nor below every peer with known similarity and equal explicit evidence

#### Scenario: Ordering position is not semantic evidence
- **WHEN** an Experience with UNKNOWN semantic affinity is ordered among peers with known similarity
- **THEN** its assessment, trace and planning candidate report UNKNOWN, and no imputed similarity value is stored or reported

#### Scenario: Known peers keep their order
- **WHEN** an Experience with UNKNOWN semantic affinity joins candidates of equal explicit evidence
- **THEN** the relative order of the candidates with known similarity is unchanged

#### Scenario: Order-preserving prize repair adds no signal
- **WHEN** the objective policy's projection gives two candidates equal or near-equal prizes although the derived breakdown orders them
- **THEN** a deterministic repair restores that order only, adds no preference signal, never reverses materially different satisfaction, and the generation trace records the pre-repair prize and the order it preserved

#### Scenario: Single scoring authority
- **WHEN** the planner orders or values candidates
- **THEN** it consumes the derived breakdown and its order and does not combine semantic, facet and quality signals itself

#### Scenario: Channel is not authority
- **WHEN** one preference is stated directly in the request's free text and another is selected in the wizard
- **THEN** neither outranks the other merely because of the channel through which it was captured

#### Scenario: Soft venue anchor is a separate signal
- **WHEN** an Experience is a resolved soft venue anchor of the request
- **THEN** its anchor affinity is a separate typed signal, it never counts as a facet match and the Experience is never forced into the plan

#### Scenario: Accessibility need versus preference
- **WHEN** the request states an explicit accessibility need and an Experience is known not to meet it or its accessibility is UNKNOWN
- **THEN** the Experience is not offered to the optimizer, whereas an accessibility preference only changes preference utility; while no accessibility classification completeness is recorded, a need ends generation with HARD_CONSTRAINT_UNENFORCEABLE

#### Scenario: Hard exclusion never reaches the optimizer
- **WHEN** the request has a hard exclusion whose compatibility can be proven and an Experience matches it
- **THEN** it is not offered to the optimizer and no objective weight can bring it back; when compatibility cannot be proven, generation ends with HARD_CONSTRAINT_UNENFORCEABLE instead

### Requirement: UNKNOWN ordering projection is tier-local
For ordering only, an UNKNOWN semantic affinity or generic quality SHALL take the median of the KNOWN values among candidates tied on every earlier canonical level (DIRECT, INFERRED, soft-exclusion avoidance, soft anchor). Quality SHALL use the same tier, not subdivided by semantic value. A tier with no KNOWN value SHALL skip that level. The breakdown SHALL keep UNKNOWN and no median SHALL be stored.

#### Scenario: Other tiers do not move an UNKNOWN
- **WHEN** an UNKNOWN-similarity Experience is tied on explicit evidence only with peers of similarity 0.3 and 0.5, while other tiers hold peers of 0.9
- **THEN** it orders as 0.4 within its tier and its breakdown still reports UNKNOWN

### Requirement: The planner follows the canonical preference rank
Every planning candidate SHALL carry its canonical preference policy version, a strict within-request rank and the numeric breakdown, with no embedding, text, facet structure or untyped score. The greedy planner SHALL order candidates by rank, then id, and SHALL NOT combine breakdown signals into a score; a candidate of another ranking policy or without a distinct rank SHALL be refused.

#### Scenario: A richer breakdown does not outrank a better rank
- **WHEN** a planning candidate with higher quality and similarity in its breakdown has a worse rank than another
- **THEN** the planner orders the better-ranked candidate first

### Requirement: Reservoir promotion preserves preference rank positions
A reservoir promotion SHALL be accepted only if must-includes are preserved, planning strictly progresses (more scheduled candidates or strictly better utilization) and, for every position of the current schedule, the trial's k-th best rank is equal or better. No sum, average, weighting or compensation between positions SHALL be used.

#### Scenario: Improvement at every occupied position
- **WHEN** the current schedule holds ranks 1, 3, 5 and a trial holds 1, 2, 5 with more utilization
- **THEN** the promotion is accepted

#### Scenario: A worse position is not compensated
- **WHEN** the current schedule holds ranks 1, 3, 5 and a trial holds 1, 4, 4
- **THEN** the promotion is rejected

### Requirement: Preference evidence precedence
Within one request, eligible candidates SHALL be ordered lexicographically by DIRECT facet evidence, then INFERRED facet evidence, then soft-exclusion avoidance, then soft venue-anchor affinity, then semantic affinity, then generic quality. No exchange rate SHALL let a lower level outweigh a higher one, and the capture channel SHALL NOT be a level.

#### Scenario: Direct evidence outranks inferred evidence
- **WHEN** Experience A matches a DIRECT facet and Experience B matches only INFERRED facets with a larger total weight, a higher interpretation confidence or higher semantic similarity
- **THEN** A ranks above B

#### Scenario: Confidence does not discount direct evidence
- **WHEN** a wizard-selected facet and a DIRECT free-text facet of the same stated importance are matched by two Experiences, and the interpreter's confidence in the free-text facet is below 1
- **THEN** both facets carry the same authority and the order between the two Experiences is decided by the lower levels, not by confidence or channel

#### Scenario: Soft venue anchor follows facet evidence and precedes semantic refinement
- **WHEN** a resolved soft venue anchor has equal facet evidence with another Experience that has higher semantic similarity, and less facet evidence than a third Experience
- **THEN** the anchor ranks above the second Experience and below the third

### Requirement: Soft exclusions are a preference level, not a constraint
A SOFT EXCLUDE assertion SHALL only order candidates, at its own lexicographic level after positive explicit evidence: a candidate with a confirmed typed fact matching a SOFT EXCLUDE target SHALL rank below an otherwise equal candidate without one. An absent or unknown fact SHALL be neutral, never proof of avoidance. It SHALL NOT filter, add a numeric penalty or coefficient, or fold into any aggregate score.

#### Scenario: Avoidance orders equal positive evidence
- **WHEN** the request asserts a SOFT EXCLUDE of nightlife and two Experiences have equal DIRECT and INFERRED evidence, one with a confirmed nightlife fact
- **THEN** the other Experience ranks above it, before soft-anchor, semantic or quality signals are considered

#### Scenario: Avoidance never outranks positive evidence
- **WHEN** an Experience with a confirmed nightlife fact has more DIRECT evidence than one without it
- **THEN** it still ranks above, and it is never removed from the candidates

#### Scenario: Unknown is neutral for a soft exclusion
- **WHEN** an Experience has no recorded nightlife fact
- **THEN** it is treated as neither matching nor avoiding the target, and planning continues

### Requirement: Contradictory polarity is an explicit conflict
When one typed target is asserted both as INCLUDE and as EXCLUDE and both assertions are SOFT, neither SHALL participate in preference ordering or exclusion, planning SHALL continue, and the conflict SHALL be recorded as PREFERENCE_POLARITY_CONFLICT with both assertions' provenance and evidence. Provenance, importance, confidence, channel and polarity SHALL NOT decide between them.

#### Scenario: Structured include and extracted exclude of the same target
- **WHEN** the traveller selects the history interest and the extractor asserts history with polarity EXCLUDE
- **THEN** history is neither a requested facet nor an exclusion, and the trace records PREFERENCE_POLARITY_CONFLICT for theme:history

### Requirement: Contradictory hard intent blocks generation
When one typed target is asserted both as INCLUDE and as EXCLUDE and either assertion is HARD, generation SHALL end before destination resolution with AMBIGUOUS_HARD_CONSTRAINT, recording both assertions' constraint, provenance and evidence. It SHALL NOT drop both and plan, SHALL NOT pick a winner, and SHALL be distinct from HARD_CONSTRAINT_UNENFORCEABLE (clear intent, unprovable compatibility). It SHALL NOT be retried.

#### Scenario: Selected interest contradicted by a hard exclusion
- **WHEN** the traveller selects the history interest and the extractor asserts a HARD exclusion of history
- **THEN** generation ends with AMBIGUOUS_HARD_CONSTRAINT for theme:history, no Tour is planned, and neither assertion is chosen over the other

### Requirement: Preference assertions are extracted semantically
Natural-language preferences SHALL be interpreted only by a semantic extractor. For each preference it SHALL assert a typed target (a dimension and canonical key of the versioned facet schema), a polarity (INCLUDE or EXCLUDE), a constraint (SOFT or HARD), a provenance (DIRECT or INFERRED), an importance, a confidence and verbatim user-text evidence.

#### Scenario: The extractor asserts provenance and validation keeps it
- **WHEN** the free text says "me encanta la arquitectura" and the extractor asserts the architecture theme as DIRECT with that span as evidence
- **THEN** validation keeps the assertion as DIRECT; no word list decides or confirms it

#### Scenario: Inference stays inferred
- **WHEN** the free text says "quiero ver los edificios de Gaudí" and the extractor asserts the architecture theme as INFERRED
- **THEN** the assertion is kept as INFERRED and no confidence value, embedding similarity or lexical match upgrades it

#### Scenario: Paraphrases are interpreted by the extractor, not by vocabulary
- **WHEN** two requests express the same preference in different words, languages or paraphrases
- **THEN** both reach the same typed target only through the extractor's assertions, and deterministic code never maps a word to a schema key

### Requirement: Preference assertions are validated deterministically
Deterministic code SHALL only validate an extracted assertion: its target SHALL be a key of the versioned schema, enumerated fields SHALL hold schema values, confidence SHALL be within [0, 1] and each evidence span SHALL occur token-bounded in the user's text. A failing assertion SHALL be dropped with a typed reason, never repaired, defaulted or reclassified.

#### Scenario: Ungrounded evidence is rejected, not repaired
- **WHEN** an asserted evidence span does not occur token-bounded in the user's text, or the asserted key is not a key of the schema
- **THEN** the assertion is dropped with MISSING_EVIDENCE or UNKNOWN_KEY and nothing is substituted for it

#### Scenario: Duplicate assertion keeps its direct provenance
- **WHEN** the same target and polarity are asserted both as DIRECT and as INFERRED
- **THEN** the DIRECT assertion is kept with its own importance and confidence, whatever the INFERRED assertion's weight

### Requirement: No word list interprets preferences
No maintained natural-language keyword, alias, synonym, canonical-word or regex list SHALL interpret preferences, decide provenance or polarity, or translate a word into a schema key anywhere in the preference or exclusion path. When extraction fails, no lexical fallback SHALL produce an assertion from the text.

#### Scenario: Negation is a polarity, not a positive facet
- **WHEN** the free text says "no me interesa la arquitectura" and the extractor asserts the architecture theme with polarity EXCLUDE
- **THEN** no positive architecture facet participates in preference utility at any weight

#### Scenario: Extraction failure has no lexical fallback
- **WHEN** the extractor fails or returns an invalid response
- **THEN** the interpretation is recorded as failed, only structured selections produce assertions, and no keyword or regex reading of the text produces one

### Requirement: Structured selections are direct assertions
A typed structured selection (a wizard option or a typed dietary restriction) SHALL yield a DIRECT assertion whose evidence is that selection, with no language interpretation. Untyped dietary strings SHALL be rejected at the request boundary.

#### Scenario: Structured selection is direct by construction
- **WHEN** the traveller selects the history interest or the vegan dietary restriction as a typed option
- **THEN** it yields a DIRECT assertion whose evidence is that structured selection, without calling the extractor; an untyped dietary string is rejected at the request boundary

### Requirement: Accessibility is a typed assertion dimension
Accessibility needs and preferences SHALL be typed assertions on the `accessibility` dimension of the versioned facet schema. A structured need SHALL be a typed identifier (anything else is rejected at the request boundary) yielding a DIRECT HARD INCLUDE assertion without the extractor; free text SHALL reach these targets only through the extractor, which decides HARD or SOFT. No untyped accessibility list SHALL exist.

#### Scenario: Wizard wheelchair need
- **WHEN** the traveller selects the wheelchair-access need
- **THEN** it yields a DIRECT HARD INCLUDE assertion on accessibility:wheelchair_access and never a preference facet

#### Scenario: Free-text accessibility preference
- **WHEN** the extractor asserts "preferiría evitar escaleras" as a SOFT accessibility:avoid_stairs assertion
- **THEN** it is a requested facet that ranks only Experiences with a confirmed typed fact, and no embedding or wording decides accessibility

### Requirement: Open concepts without a shared typed identity are unresolved
A concept the extractor understands but that has no typed identity shared with Experience facts (for example an open trait) SHALL be recorded as an unresolved concept (UNRESOLVED_OPEN_CONCEPT) and never matched lexically against Experience facts. An INCLUDE unresolved concept SHALL NOT participate in retrieval, coverage, acquisition or preference utility.

#### Scenario: Open include concept does not participate
- **WHEN** the free text asks for "cerveza artesanal" and the schema has no typed key for that concept
- **THEN** it is recorded as an unresolved concept and neither creates a facet, a deficit nor a forwarded acquisition trait, nor matches an Experience trait "craft beer"

### Requirement: Unprovable hard constraints end generation explicitly
A HARD assertion or HARD unresolved concept SHALL be honoured only when every offered Experience's compatibility can be proven; unknown is never compatible. Without recorded classification completeness or a shared typed identity, generation SHALL end before destination resolution with HARD_CONSTRAINT_UNENFORCEABLE, recording each constraint and its missing knowledge. It SHALL be distinct from an infeasible plan, not retried and not relaxed.

#### Scenario: Typed dietary restriction without classification completeness
- **WHEN** the request selects the vegan dietary restriction and the catalog does not record whether Experiences' dietary classification is complete
- **THEN** generation ends with HARD_CONSTRAINT_UNENFORCEABLE recording dietary_suitability:vegan and CLASSIFICATION_COMPLETENESS, and no Tour is planned

#### Scenario: Hard exclusion of an open concept
- **WHEN** the extractor asserts a HARD exclusion of "religious places" and the schema has no typed key for it
- **THEN** generation ends with HARD_CONSTRAINT_UNENFORCEABLE recording SHARED_CONCEPT_IDENTITY, instead of guessing the exclusion from words in Experience names or descriptions

### Requirement: Allowed travel modes are a hard boundary
Only the request's allowed travel modes that the release supports and a routing provider serves SHALL be offered to the optimizer. No objective weight SHALL make another mode usable, and an unavailable mode SHALL NOT be substituted by another mode.

#### Scenario: Walking only
- **WHEN** the request allows only walking
- **THEN** no planned leg uses another mode

#### Scenario: Only a feature-gated mode requested
- **WHEN** the request allows only public transport and the release has no public-transport estimates
- **THEN** generation ends with TRAVEL_ESTIMATION_UNAVAILABLE recording MODE_UNAVAILABLE for public transport, no other mode is substituted and no Tour is persisted

### Requirement: Days are optimized jointly
For a multi-day request the planner SHALL assign candidates to days as part of one optimization across all days, not by filling day 1 to capacity before considering day 2.

#### Scenario: Better assignment across days
- **WHEN** greedily filling day 1 with nearby high-utility candidates leaves day 2 with only infeasible candidates, while a different split schedules more total utility on both days
- **THEN** the planner returns the split with the higher total utility

### Requirement: Deterministic planning
For identical planning inputs, identical travel-estimate recordings and identical policy and optimizer versions, the planner SHALL return an identical itinerary and identical diagnostics. Any search budget SHALL be deterministic (not wall-clock dependent), and any randomness SHALL use a recorded fixed seed. A wall-clock limit MAY exist only as an operational safety guard; when it ends the search, the plan SHALL record that it is not reproducible.

#### Scenario: Replay
- **WHEN** a recorded planning input is planned twice with the same recordings and policies
- **THEN** both outputs are byte-identical

#### Scenario: Slower host
- **WHEN** the same planning input is planned on a slower or more loaded machine and the safety guard does not fire
- **THEN** the itinerary is identical to the one produced on the faster machine

#### Scenario: Safety guard fires
- **WHEN** the operational time guard ends the search before the deterministic budget is reached
- **THEN** the returned itinerary still satisfies every hard constraint and the plan records that it is not reproducible

### Requirement: Scheduled activity output
For each scheduled activity the planner output SHALL contain the canonical Experience identity, day, planned start, planned end, visit duration with provenance, the applied opening window or UNKNOWN with provenance, the incoming travel leg with its mode, duration, distance where available and routing provider, and the constraints that bound the visit.

#### Scenario: Explaining a scheduled visit
- **WHEN** a scheduled visit is inspected
- **THEN** its output shows the opening window it fits, its duration provenance and the incoming leg's mode and estimate provenance

### Requirement: Day and plan output
For each day the planner output SHALL contain used time, remaining time with the planner's meaningful-residual judgement, total travel time, total walking where available and that day's diagnostics. The plan SHALL record the policy versions, the optimizer identity (optimizer, optimizer version, optimizer policy version) and whether the plan is reproducible, the routing provider(s) used, unavailable estimates per mode and the constraint snapshot it evaluated.

#### Scenario: Day summary
- **WHEN** a planned day is inspected
- **THEN** its used and remaining time, travel time and walking total are present without recomputation

### Requirement: Typed rejection diagnostics for every eligible unscheduled candidate
Every eligible candidate offered to the planner and not scheduled SHALL carry one or more typed reasons from: OPENING_HOURS, OPENING_HOURS_UNKNOWN_EXCLUDED, TRAVEL_TIME, TRAVEL_ESTIMATE_UNAVAILABLE, REQUIRED_TRAVERSAL_UNSATISFIED, DAILY_CAPACITY, WALKING_LIMIT, CYCLING_LIMIT, NO_ALLOWED_TRAVEL_MODE, VISIT_DURATION, USER_TIME_WINDOW, DOMINATED_BY_HIGHER_UTILITY_PLAN or OTHER_PLANNER_CONSTRAINT, with the evaluated evidence where applicable.

#### Scenario: Feasible but displaced
- **WHEN** a feasible candidate is not scheduled because a higher-utility itinerary uses its time
- **THEN** its reason is DOMINATED_BY_HIGHER_UTILITY_PLAN

#### Scenario: Routing unavailable for a candidate
- **WHEN** every allowed mode to and from a candidate is PROVIDER_UNAVAILABLE or MODE_UNAVAILABLE
- **THEN** the candidate is not scheduled, carries TRAVEL_ESTIMATE_UNAVAILABLE, and no leg to it is assumed feasible

#### Scenario: Diagnostics consumed by readiness
- **WHEN** readiness evaluates the provisional plan
- **THEN** it reads the typed reasons directly from the planner output without re-deriving them

### Requirement: Input errors and shortage are not feasibility reasons
Invalid planner input (duplicate identity, invalid footprint, invalid composite) SHALL be reported as input errors, separate from feasibility rejections. No planner reason SHALL be reported as candidate shortage or missing knowledge.

#### Scenario: Duplicate identity in the pool
- **WHEN** the same Experience identity is offered twice
- **THEN** it is reported as an input error and not as a feasibility rejection

### Requirement: Optimizer failure is explicit
When the optimizer cannot produce a usable itinerary for any reason other than a proven or explicit constraint conflict, generation SHALL report OPTIMIZER_FAILED with a typed reason, distinct from PLANNER_INFEASIBLE, NEEDS_ACQUISITION and every knowledge verdict, and SHALL persist no Tour. PLANNER_INFEASIBLE SHALL be reserved for proven or explicit constraint conflicts.

#### Scenario: Solver returns no solution in time
- **WHEN** the optimizer stops at its budget with no itinerary for a 30-candidate request
- **THEN** generation reports OPTIMIZER_FAILED, not PLANNER_INFEASIBLE and not INSUFFICIENT_KNOWLEDGE

#### Scenario: Optimizer unavailable
- **WHEN** the optimizer runtime is unreachable, crashes during the request, rejects the request or exceeds the request deadline
- **THEN** generation reports OPTIMIZER_FAILED with the typed reason, requests no acquisition and persists no Tour

#### Scenario: Malformed optimizer result
- **WHEN** the optimizer returns a result that does not satisfy the result contract
- **THEN** generation reports OPTIMIZER_FAILED, never a Tour

### Requirement: Optimizer results are validated
Every itinerary returned by the optimizer SHALL be validated against the hard constraints of the planning input before it is used; an itinerary that fails validation SHALL be treated as an optimizer failure.

#### Scenario: Optimizer returns an invalid itinerary
- **WHEN** the optimizer returns an itinerary with a visit outside its feasible window or a leg without a matching travel estimate
- **THEN** the itinerary is discarded and generation reports OPTIMIZER_FAILED, never a Tour

### Requirement: Provider-neutral optimizer boundary
The planner SHALL invoke the optimizer through a provider-neutral contract that carries the whole normalized planning problem of one request in one bounded call and returns a feasible plan, an explicit infeasibility or an explicit optimizer failure. No optimizer-specific structure SHALL cross into the Tour domain.

#### Scenario: Replacing the optimizer
- **WHEN** the production optimizer is replaced by another implementation of the contract
- **THEN** no Tour-domain code, planning input preparation or snapshot structure changes

#### Scenario: One call per plan
- **WHEN** a 30-candidate, 3-day request is planned
- **THEN** the optimizer receives one request containing every candidate, feasible start window, travel estimate and limit, and is never called per candidate or per travel edge

### Requirement: Single reachable optimizer
Exactly one optimizer SHALL be reachable for new requests; a request whose optimizer call fails SHALL NOT be re-planned by a different optimizer.

#### Scenario: No silent failover
- **WHEN** the optimizer reports OPTIMIZER_FAILED
- **THEN** generation reports that failure and no other optimizer produces a Tour for the request

### Requirement: Planner algorithm selected by evidence
The production optimizer SHALL be selected only after a recorded comparison of at least the current greedy planner, an established routing-with-time-windows approach and, where materially different and practical, a constraint-programming orienteering formulation, run on identical recorded inputs from several destinations. The selection SHALL be recorded with the evidence; correctness of hard constraints SHALL be a gate, not a weighted metric.

#### Scenario: Candidate violates opening hours
- **WHEN** an evaluated algorithm schedules any visit outside a known opening window on the recorded datasets
- **THEN** it is ineligible for selection regardless of its utility or speed

#### Scenario: Identical travel data for every algorithm
- **WHEN** the algorithms are compared for one destination
- **THEN** each consumes the same candidate set and replays the same recorded routing estimates, and none calls a routing provider live
