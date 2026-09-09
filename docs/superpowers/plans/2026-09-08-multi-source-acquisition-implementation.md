# Multi-source Experience acquisition — consolidated implementation plan

Status: ready for implementation
Branch: feat/experience-domain-v2

Canonical design:
docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md

Implementation plan:
docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md

Progress:
docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md


================================================================================
1. GOAL
================================================================================

Replace the current web-first Experience acquisition model with a multi-source acquisition pipeline where:

- structured sources provide factual observations directly;
- web + LLM remains available for genuine long-tail discovery;
- structured sources converge into the existing ExperienceCandidate boundary;
- corroboration across structured providers is deterministic;
- all candidates flow through the same resolver, geographic validation, dedupe and persistence path;
- preferences are normalized into explicit facets;
- preference importance and interpretation confidence are modeled separately;
- source selection is deterministic and deficit-driven;
- the deterministic planner remains responsible for composing the final Tour.

Target flow:

User preferences
        ↓
Preference normalization
        ↓
Local Experience catalog
        ↓
CoverageAnalyzer
        ↓
Coverage deficits
        ↓
ExperienceAcquisitionPlanner
        ↓
Deficit → source routing
        ↓
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Wikivoyage   │ OSM          │ GooglePlaces │ Web + LLM    │
└──────────────┴──────────────┴──────────────┴──────────────┘
        ↓

Structured providers:

Wikivoyage / OSM / Google Places
        ↓
SourceObservation[]
        ↓
Mechanical candidate synthesis
        ↓
ExperienceCandidate[]

Web providers:

Tavily / SerpAPI
        ↓
Grounded textual evidence
        ↓
Gemini / Groq extraction
        ↓
ExperienceCandidate[]

Both paths
        ↓
Combined candidate set
        ↓
Cross-source corroboration
        ↓
ExperienceProposalResolver
        ↓
Geographic validation
        ↓
Experience dedupe
        ↓
Verified Experience persistence
        ↓
Embeddings
        ↓
Catalog re-query
        ↓
Preference ranking
        ↓
Solver / deterministic planner
        ↓
Tour


================================================================================
2. NON-NEGOTIABLE INVARIANTS
================================================================================

2.1 Everything plannable remains an Experience

Do not reintroduce:

- Activity
- ActivityKind
- planner-specific POI entities
- route-specific planner domain types
- structural tour-item variants outside Experience

ExperienceCandidate remains the stable acquisition boundary.


2.2 Structured sources supply facts

Wikivoyage, OSM and Google Places provide factual observations.

Do not send structured data through an LLM merely to determine whether something exists.

LLMs remain appropriate for:

- free-text preference interpretation;
- grounded web discovery;
- semantic interpretation of genuinely unstructured long-tail content.


2.3 Resolver path remains authoritative

No acquisition provider may directly persist a verified Experience.

All candidates must flow through the existing downstream pipeline responsible for:

- entity resolution;
- geographic validation;
- SAME / NEW / AMBIGUOUS decisions;
- dedupe;
- persistence;
- embeddings.


2.4 Provider failures are isolated

Each provider returns something equivalent to:

interface AcquisitionProviderResult<T> {
  status: 'success' | 'failed';
  value: T[];
  failureReason?: string;
}

Example:

Wikivoyage failed
OSM succeeded
Places succeeded
Web succeeded

→ acquisition continues

Do not fail the entire acquisition because one provider fails.


2.5 No global provider-quality ranking

Do not introduce arbitrary rules such as:

wikivoyage = 0.9
google = 0.8
osm = 0.7

Evidence corroboration must be concept-based, not provider-score-based.


================================================================================
3. PREFERENCE MODEL
================================================================================

The previous design proposed:

{
  dimension,
  key,
  weight
}

Do NOT implement that model.

"weight" incorrectly mixes two independent concepts:

1. how important a preference is;
2. how certain the system is that it interpreted the user correctly.

Use:

type PreferenceFacetSource =
  | 'wizard'
  | 'free_text';

interface PreferenceFacet {
  dimension: string;
  key: string;

  // Ranking importance.
  // Must be deterministic.
  importance: number;

  // Confidence that this facet correctly represents
  // the user's intent.
  confidence: number;

  source: PreferenceFacetSource;
}

Explicit wizard example:

{
  "dimension": "theme",
  "key": "wine",
  "importance": 1,
  "confidence": 1,
  "source": "wizard"
}

Free-text inferred example:

{
  "dimension": "winery_scale",
  "key": "boutique",
  "importance": 1,
  "confidence": 0.9,
  "source": "free_text"
}

Ranking may derive:

effectiveWeight = importance × confidence

But importance and confidence MUST remain separately represented.

Do not collapse them into a single stored value.


================================================================================
4. PREFERENCE OWNERSHIP RULES
================================================================================

4.1 Wizard selections

Any explicit wizard choice produces:

importance = 1
confidence = 1
source = wizard

Example:

{
  dimension: 'theme',
  key: 'wine',
  importance: 1,
  confidence: 1,
  source: 'wizard'
}

No LLM participates in this decision.


4.2 Free-text preferences

The LLM may determine:

- dimension
- key
- confidence
- semantic strength

The LLM MUST NOT freely invent ranking importance.

Example user text:

"Quiero bodegas chicas y tranquilas, no esos lugares enormes llenos de turistas."

The interpreter may return:

{
  dimension: 'winery_scale',
  key: 'boutique',
  confidence: 0.93,
  strength: 'strong'
}

Normalization code assigns:

importance = deterministic rule
source = free_text

Final facet:

{
  dimension: 'winery_scale',
  key: 'boutique',
  importance: 1,
  confidence: 0.93,
  source: 'free_text'
}


4.3 Deterministic importance

Initial rule:

strong → 1.0
medium → 0.7
weak → 0.5

Examples:

"Quiero bodegas boutique"
→ strong
→ importance 1

"Preferiría bodegas boutique"
→ medium
→ importance 0.7

"Quizás alguna bodega boutique"
→ weak
→ importance 0.5

The exact vocabulary may evolve, but importance must remain:

- deterministic;
- code-driven;
- reviewable;
- testable.

Do not allow the LLM to output arbitrary importance floats.


4.4 Explicit + inferred merge rules

When wizard and free-text produce the same facet, merge deterministically.

Explicit wizard intent must never be weakened by free-text uncertainty.

Example:

wizard:
theme=wine
importance=1
confidence=1

free text:
theme=wine
confidence=.82

final:
theme=wine
importance=1
confidence=1
source=wizard

Do not duplicate identical facets.

If free text adds a different dimension:

wizard:
theme=wine

free text:
winery_scale=boutique

retain both.


================================================================================
5. PREFERENCE DIMENSIONS
================================================================================

Reuse the existing TraitDefinition.dimension.

Do not introduce a new persistence model solely for preference dimensions.

Initial dimensions:

theme
trait
intent
winery_scale
tourism_intensity
nature_type
local_character
exploration_style

Examples:

theme:
  wine
  history
  food
  architecture

winery_scale:
  boutique
  medium
  industrial

tourism_intensity:
  hidden
  local
  popular
  iconic

nature_type:
  mountain
  forest
  coast
  river
  desert
  park

local_character:
  authentic
  residential
  traditional
  contemporary

exploration_style:
  relaxed
  balanced
  intensive

Centralize this vocabulary.

Recommended file:

be/src/modules/tours/preferences/preference-facet-vocabulary.ts

Do not scatter arbitrary dimension/key string literals throughout the codebase.


================================================================================
6. ROLLOUT 1 — WIKIVOYAGE STRUCTURED ACQUISITION
================================================================================

This is the first implementation milestone.

Do not start later rollouts until this one is verified.


--------------------------------------------------------------------------------
6.1 Acquisition domain interface
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/interfaces/experience-acquisition.interface.ts

Add:

type ExperienceAcquisitionProvider =
  | 'wikivoyage'
  | 'osm'
  | 'google_places'
  | 'web';

interface SourceObservation {
  provider: ExperienceAcquisitionProvider;

  externalId?: string;

  title: string;
  description?: string;

  geo?: {
    latitude?: number;
    longitude?: number;
    geometry?: unknown;
  };

  evidenceType:
    | 'tourism_activity'
    | 'place'
    | 'route'
    | 'area'
    | 'operator'
    | 'editorial';

  evidenceKey: string;
}

interface AcquisitionProviderResult<T> {
  status: 'success' | 'failed';
  value: T[];
  failureReason?: string;
}

Do not persist SourceObservation at this stage.

It is an acquisition-layer structure.


--------------------------------------------------------------------------------
6.2 Wikivoyage API boundary
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/interfaces/wikivoyage-api.interface.ts
be/src/modules/tours/services/wikivoyage-api.service.ts

Responsibilities:

- destination article lookup;
- section retrieval;
- entry parsing;
- coordinate extraction;
- Wikidata QID extraction;
- provider error normalization.

The rest of the application must not depend directly on Wikimedia API payload structure.

Use a descriptive User-Agent.

Conceptually:

ZigZagTourPlanner/<version> contact-info

Do not silently use a generic HTTP-client User-Agent.


--------------------------------------------------------------------------------
6.3 Wikivoyage fixtures
--------------------------------------------------------------------------------

Add fixtures under:

be/test/fixtures/wikivoyage/

Required fixture coverage:

san-telmo.json
la-boca.json
recoleta.json
palermo.json
missing-article.json
malformed-entry.json
provider-error.json

Tests must not depend exclusively on live Wikimedia APIs.


--------------------------------------------------------------------------------
6.4 Wikivoyage parsing tests
--------------------------------------------------------------------------------

Cover at least:

- SEE entries;
- DO entries;
- EAT entries where useful;
- direct latitude/longitude;
- Wikidata QID;
- entries without coordinates;
- article missing;
- provider failure;
- one malformed entry among valid siblings.

A malformed sibling must not discard all valid observations.


--------------------------------------------------------------------------------
6.5 Wikivoyage acquisition provider
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts

Input:

destination
requested sections

Output:

AcquisitionProviderResult<SourceObservation>

Example:

{
  provider: 'wikivoyage',
  externalId: 'Q12345',
  title: 'Mercado de San Telmo',
  description: '...',
  geo: {
    latitude: -34.621,
    longitude: -58.371
  },
  evidenceType: 'place',
  evidenceKey: 'wikivoyage:Buenos_Aires/San_Telmo:Mercado_de_San_Telmo'
}

Do not create or persist Experiences directly.


--------------------------------------------------------------------------------
6.6 Mechanical structured candidate synthesis
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts

Input:

SourceObservation[]

Output:

ExperienceCandidate[]

This mapping must be mechanical.

It may map:

- title;
- description;
- evidenceKey;
- coordinates;
- basic evidence-derived component hints.

It MUST NOT invent:

- fake route ordering;
- fake components;
- fake multi-stop walks;
- unsupported themes;
- unsupported tourism concepts.

If Wikivoyage says:

Mercado de San Telmo

the system may synthesize a candidate representing Mercado de San Telmo.

It must NOT transform it into:

Historic San Telmo Walking Route

unless the source evidence actually describes such a concept.


--------------------------------------------------------------------------------
6.7 Module wiring
--------------------------------------------------------------------------------

Update:

be/src/modules/tours/tours.module.ts

Register:

WikivoyageApiService
WikivoyageAcquisitionProvider
StructuredExperienceCandidateSynthesizerService

Do not change the entire acquisition orchestration yet.

Keep Rollout 1 narrow.


--------------------------------------------------------------------------------
6.8 Live Wikivoyage characterization
--------------------------------------------------------------------------------

Perform live verification against:

San Telmo
La Boca
Recoleta
Palermo

Record:

- article availability;
- section structure;
- coordinates;
- QID coverage;
- missing-field behavior;
- request limits;
- latency;
- caching opportunities.

Investigate practical Wikimedia/Wikivoyage rate limits and caching requirements instead of guessing.

Rollout 1 is NOT complete until:

- fixture tests pass;
- relevant backend tests pass;
- live verification passes;
- progress file is updated.


================================================================================
7. ROLLOUT 2 — PREFERENCE FACETS
================================================================================

Do this immediately after Wikivoyage Rollout 1 and BEFORE deficit-to-source routing.

Source routing will consume normalized dimensions, so it must be built on the final preference model rather than the obsolete weight model.


--------------------------------------------------------------------------------
7.1 Introduce PreferenceFacet
--------------------------------------------------------------------------------

Locate the existing normalized preference model.

Replace bare preferred values such as:

preferredThemes: string[];
preferredTraits: string[];
preferredIntents: string[];

with PreferenceFacet collections.

Target conceptually:

interface NormalizedPreferenceIntent {
  preferredThemes: PreferenceFacet[];
  preferredTraits: PreferenceFacet[];
  preferredIntents: PreferenceFacet[];

  hardExclusions: ...;
  softConstraints: ...;
}

Preserve hard exclusions and soft constraints unless compatibility requires a mechanical adjustment.


--------------------------------------------------------------------------------
7.2 Wizard normalization
--------------------------------------------------------------------------------

Explicit user choices normalize to:

{
  dimension: 'theme',
  key: 'wine',
  importance: 1,
  confidence: 1,
  source: 'wizard'
}

No LLM involved.


--------------------------------------------------------------------------------
7.3 Free-text interpreter contract
--------------------------------------------------------------------------------

Update the free-text preference interpreter so it returns semantic interpretation confidence.

Prefer:

interface InterpretedPreferenceFacet {
  dimension: string;
  key: string;
  confidence: number;
  strength?: 'strong' | 'medium' | 'weak';
}

Do NOT request arbitrary importance from the model.

Code maps strength deterministically:

strong → 1.0
medium → 0.7
weak → 0.5

If strength is absent, use a documented deterministic default.


--------------------------------------------------------------------------------
7.4 Ranking
--------------------------------------------------------------------------------

The ranking layer may calculate:

effectiveWeight =
  facet.importance *
  facet.confidence

Examples:

wine:
1 × 1 = 1

boutique:
1 × .9 = .9

maybe museums:
.5 × .75 = .375

Do not discard the original fields after deriving effectiveWeight.


--------------------------------------------------------------------------------
7.5 Explainability
--------------------------------------------------------------------------------

Bitácora/debug output should expose:

dimension
key
importance
confidence
effectiveWeight
source

This must make it possible to explain why one Experience ranked above another.


--------------------------------------------------------------------------------
7.6 Preference tests
--------------------------------------------------------------------------------

Cover:

- wizard selection → importance 1 / confidence 1;
- strong free-text preference;
- medium free-text preference;
- weak free-text preference;
- low-confidence LLM interpretation;
- duplicate wizard + free-text facet;
- wizard takes precedence over same inferred facet;
- multiple distinct inferred facets;
- effectiveWeight calculation;
- importance and confidence remain separately observable.


================================================================================
8. FOUNDATION — DETERMINISTIC CROSS-SOURCE CORROBORATION
================================================================================

After Wikivoyage and preference facets are stable, implement shared corroboration.

Create:

be/src/modules/tours/services/experience-corroboration.service.ts

Purpose:

Wikivoyage
+
OSM
+
Google Places

→ determine whether observations/candidates represent the same real-world concept.

Reuse existing identity/reconciliation logic where possible.

The current code already contains useful geographic reconciliation based on concepts such as:

- name similarity;
- geographic proximity;
- approximately 150m reconciliation radius.

Extract/reuse common logic rather than creating incompatible duplicate algorithms.


--------------------------------------------------------------------------------
8.1 Corroboration decisions
--------------------------------------------------------------------------------

Use conservative decisions:

SAME
NEW
AMBIGUOUS

Behavior:

strong same name + strong geographic agreement
→ SAME

clearly different concept
→ NEW

insufficient evidence
→ AMBIGUOUS

Never force an uncertain merge.


--------------------------------------------------------------------------------
8.2 Evidence union
--------------------------------------------------------------------------------

If multiple providers corroborate the same concept, union their evidence.

Example:

{
  "evidenceKeys": [
    "wikivoyage:...",
    "osm:node:123",
    "google_places:ChIJ..."
  ]
}

Corroboration increases evidence richness.

It does NOT produce a provider-quality score.


--------------------------------------------------------------------------------
8.3 Determinism
--------------------------------------------------------------------------------

Identical input must yield identical output.

No LLM is allowed in corroboration.


================================================================================
9. FOUNDATION — ACQUISITION PLANNING AND SOURCE ROUTING
================================================================================

Extend acquisition planning beyond one generic web query.

Add to experience-acquisition.interface.ts structures equivalent to:

interface ExperienceAcquisitionPlan {
  destination: ExperienceDiscoveryScope;
  deficits: CoverageDeficit[];
  sourcePlans: SourcePlan[];
  breadth: ExperienceDiscoveryBreadth;
}

interface SourcePlan {
  provider: ExperienceAcquisitionProvider;

  wikivoyage?: {
    sections: ('SEE' | 'DO' | 'EAT')[];
  };

  osm?: {
    concepts: string[];
  };

  places?: {
    searchTypes: string[];
  };

  web?: {
    query: string;
  };
}


--------------------------------------------------------------------------------
9.1 Explicit routing table
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/services/experience-source-routing.ts

Maintain a deterministic routing table.

Examples:

theme/history
→ Wikivoyage SEE
→ OSM historic / monument
→ Places tourist_attraction
→ web fallback

theme/wine
→ Wikivoyage DO/EAT
→ Places winery
→ web

winery_scale/boutique
→ Places winery
→ web

tourism_intensity/hidden
→ Wikivoyage DO
→ OSM
→ web

nature_type/mountain
→ Wikivoyage SEE/DO
→ OSM natural features

nature_type/park
→ Wikivoyage SEE/DO
→ OSM park / protected area
→ Places park

This table must be explicit and reviewable.

No LLM decides which provider to call.


--------------------------------------------------------------------------------
9.2 Unknown dimensions
--------------------------------------------------------------------------------

Unknown dimensions must not crash routing.

Fallback:

unknown deficit
→ existing web discovery

This preserves long-tail support.


--------------------------------------------------------------------------------
9.3 Discovery planner evolution
--------------------------------------------------------------------------------

Update:

be/src/modules/tours/services/experience-discovery-planner.service.ts

so it can construct SourcePlan[] based on deficits.

Preserve the current web-query mechanism for web sources.

Do not unnecessarily rewrite the existing web discovery stack.


================================================================================
10. ROLLOUT 3 — GOOGLE PLACES CUTOVER
================================================================================

The current shortcut:

Google Places
→ GeoEntity
→ persistVerifiedExperience

must be removed.

Google Places currently has a privileged path that bypasses the shared candidate/resolver pipeline.

Replace it with:

Google Places
        ↓
SourceObservation
        ↓
ExperienceCandidate
        ↓
Corroboration
        ↓
Resolver
        ↓
Geographic validation
        ↓
Dedupe
        ↓
Experience persistence
        ↓
Embeddings


--------------------------------------------------------------------------------
10.1 Google Places acquisition provider
--------------------------------------------------------------------------------

Create:

be/src/modules/tours/providers/google-places-acquisition.provider.ts

Output:

AcquisitionProviderResult<SourceObservation>

Do not persist Experiences from this provider.


--------------------------------------------------------------------------------
10.2 Catalog cleanup
--------------------------------------------------------------------------------

Refactor:

be/src/modules/tours/services/experience-catalog.service.ts

Remove the direct raw Places-to-Experience persistence path currently associated with:

acquireNearbyAsExperiences()

If the method becomes obsolete, remove or redefine it.

Do not leave a second hidden acquisition path.


--------------------------------------------------------------------------------
10.3 Starbucks regression
--------------------------------------------------------------------------------

Add an explicit regression test.

Generic nearby Places results such as:

Starbucks
pharmacy
bank
convenience store

must NOT become verified tourism Experiences merely because Google returned them.

All results must go through the shared candidate/resolver pipeline.


================================================================================
11. ROLLOUT 4 — PROACTIVE OSM ACQUISITION
================================================================================

Today OSM is primarily useful after a candidate already exists.

Change that.

OSM must also be capable of proactively discovering factual observations when CoverageAnalyzer reports deficits.

Create:

be/src/modules/tours/providers/osm-acquisition.provider.ts

Input:

destination
requested concepts

Output:

AcquisitionProviderResult<SourceObservation>

Examples of discoverable concepts:

historic sites
markets
parks
viewpoints
pedestrian streets
routes
natural features
monuments
squares


--------------------------------------------------------------------------------
11.1 OSM provider states
--------------------------------------------------------------------------------

Keep these observably distinct:

OSM_PROVIDER_FAILED
OSM_QUERY_EMPTY
NO_OSM_MATCH
GEOGRAPHIC_VALIDATION_FAILED

Do not collapse them into one generic "OSM failed" state.


--------------------------------------------------------------------------------
11.2 Configurable Overpass
--------------------------------------------------------------------------------

Development must support local Overpass.

Example:

OVERPASS_API_URL=http://host.docker.internal:12345/api/interpreter

Do not hardcode public Overpass.


--------------------------------------------------------------------------------
11.3 OSM corroboration
--------------------------------------------------------------------------------

OSM observations enter the same corroboration stage as:

Wikivoyage
Google Places

No separate OSM-specific dedupe path.


================================================================================
12. ROLLOUT 5 — TAVILY WALK QUERY + EXPLORATION STYLE
================================================================================

There are two independent changes here.


--------------------------------------------------------------------------------
12.1 Tavily route/walk query
--------------------------------------------------------------------------------

Current behavior uses a hardcoded phrase similar to:

"10 caminatas icónicas en {destination}"

for every walk/route-like request.

Modify the existing query builder so requested themes influence the phrase.

Example:

history + food

→

"caminatas históricas y gastronómicas en San Telmo"

Still generate ONE grounded-search query.

Do not explode themes into multiple Tavily requests.


--------------------------------------------------------------------------------
12.2 explorationStyle must NOT alter Tavily query
--------------------------------------------------------------------------------

Do not generate search queries such as:

"relaxed walking route..."
"intensive walking route..."

Exploration style is not evidence that something exists.

It belongs downstream in preference matching/ranking.


--------------------------------------------------------------------------------
12.3 exploration_style facet
--------------------------------------------------------------------------------

Represent exploration style using the same preference system.

Example:

{
  dimension: 'exploration_style',
  key: 'relaxed',
  importance: 1,
  confidence: 1,
  source: 'wizard'
}

Reuse existing ExplorationStyle values where possible.


--------------------------------------------------------------------------------
12.4 Exploration style ranking
--------------------------------------------------------------------------------

Route exploration_style through the existing preference evaluator/ranking seam.

Conceptually:

relaxed
→ shorter duration preferred
→ fewer transitions preferred
→ lower density preferred

balanced
→ moderate duration
→ moderate density

intensive
→ longer duration acceptable
→ higher component density acceptable
→ richer schedules acceptable

Do not reintroduce route-specific structural planner types.

Do not put explorationStyle into Gemini/Groq/SerpAPI prompts as part of this rollout unless already required by an existing contract.

The required change is downstream preference/ranking.


================================================================================
13. FINAL ACQUISITION ORCHESTRATION
================================================================================

Once the preceding foundations exist, update:

be/src/modules/tours/services/experience-acquisition.service.ts

Target orchestration:

1. receive coverage deficits;

2. build ExperienceAcquisitionPlan;

3. determine source plans using deterministic routing;

4. execute source providers independently;

5. isolate provider failures;

6. collect structured SourceObservation[];

7. mechanically synthesize structured ExperienceCandidate[];

8. collect existing web ExperienceCandidate[];

9. combine candidate sets;

10. corroborate cross-provider evidence deterministically;

11. pass candidates through existing ExperienceProposalResolver;

12. perform geographic validation;

13. perform SAME / NEW / AMBIGUOUS resolution;

14. dedupe;

15. persist verified Experiences;

16. generate/store embeddings;

17. re-query the local Experience catalog;

18. run CoverageAnalyzer again;

19. if meaningful deficits remain, use the existing refill/requery mechanism;

20. rank verified Experiences against normalized user preferences;

21. send ranked Experiences to solver/planner;

22. materialize Tour.


================================================================================
14. WEB + LLM REMAINS INTENTIONALLY DIFFERENT
================================================================================

Do NOT force web search into SourceObservation.

Structured path:

Wikivoyage / OSM / Places
        ↓
SourceObservation[]
        ↓
mechanical synthesis
        ↓
ExperienceCandidate[]

Web path:

Tavily / SerpAPI
        ↓
grounded textual evidence
        ↓
Gemini / Groq extraction
        ↓
ExperienceCandidate[]

Both converge at:

ExperienceCandidate[]

That remains the stable downstream acquisition boundary.

This distinction is intentional.


================================================================================
15. CATALOG-FIRST BEHAVIOR
================================================================================

Multi-source acquisition does NOT mean calling every provider for every Tour.

The catalog remains first.

Required behavior:

Tour request
        ↓
query local verified Experience catalog
        ↓
CoverageAnalyzer
        ↓
enough coverage?
        ↓
YES → rank + plan
NO  → calculate deficits
        ↓
route deficits to appropriate sources

If sufficient verified Experiences already exist, do not unnecessarily call:

Wikivoyage
OSM
Google Places
web providers

The system must learn through persisted catalog reuse, not repeatedly reacquire the same destination.


================================================================================
16. END-TO-END ACCEPTANCE SCENARIOS
================================================================================

16.1 Wikivoyage richness

Given:

San Telmo
history
food
walks

Wikivoyage must contribute real structured places/concepts instead of relying exclusively on generated web concepts.


16.2 Cross-source corroboration

Given:

Mercado de San Telmo

returned independently by:

Wikivoyage
OSM
Google Places

the pipeline should produce one strongly evidenced concept when identity is sufficiently certain.

Evidence from all corroborating sources must remain observable.


16.3 Ambiguous identity

Two places with similar names but insufficient geographic/evidence agreement must remain separate or AMBIGUOUS.

Never auto-merge weak matches.


16.4 Provider degradation

Given:

Wikivoyage API failure

acquisition continues using available:

OSM
Places
web


16.5 Google Places cutover

No Google Places result may directly create a verified Experience.

All results must enter the shared acquisition pipeline.


16.6 Unknown preference dimension

Given:

dimension = street_art_style

with no explicit routing rule:

→ web fallback

No crash.


16.7 OSM gap filling

Given insufficient coverage for:

nature_type=park

OSM acquisition proactively discovers relevant geographic observations.


16.8 Explicit wizard preference

Wizard:

theme=wine

normalizes to:

dimension=theme
key=wine
importance=1
confidence=1
source=wizard


16.9 Free-text preference

Input:

"Quiero bodegas chicas y poco turísticas"

should be capable of producing normalized facets such as:

winery_scale=boutique
tourism_intensity=local or hidden

with:

confidence = interpreter confidence
importance = deterministic code
source = free_text


16.10 Confidence vs importance

A highly confident weak preference must remain distinguishable from a strongly important lower-confidence interpretation.

Example A:

importance=.5
confidence=.95

Example B:

importance=.95
confidence=.5

Even if their effective products are similar, they are semantically different and must remain separately observable.


16.11 Exploration style

Changing:

relaxed
→ intensive

should alter downstream ranking/selection.

It must NOT:

- alter whether an Experience exists;
- alter geographic validation;
- alter Tavily grounded-search query.


16.12 Catalog reuse

If sufficient verified Experiences already exist:

CoverageAnalyzer
→ no meaningful deficit
→ no unnecessary acquisition


16.13 Preference-sensitive Tour selection

Acceptance tests for Tour creation must use a sufficiently rich catalog containing many competing Experiences.

Do not prove preference matching with trivial fixtures containing only the expected Experiences.

Tests should contain enough alternatives to demonstrate that the system actually selects the best Experiences for the user's preferences.

Examples:

hundreds of Experiences
multiple themes
multiple traits
multiple intents
different tourism intensity
different exploration styles
different durations
different geographic distributions

Then assert that the final Tour contains the Experiences that best match the user's normalized preferences.


16.14 Long-tail preservation

A preference not covered by structured providers must still be discoverable through web + LLM.

Structured acquisition must supplement web discovery, not eliminate its long-tail capability.


================================================================================
17. TEST STRATEGY
================================================================================

Use targeted tests while implementing each task.

At the end of every coherent rollout, run relevant backend tests.

At milestone boundaries run:

yarn test --runInBand

Also run:

yarn run check

Distinguish:

new failure caused by implementation

from:

pre-existing baseline failure

Current known baseline from the existing progress checkpoint includes acceptance-fixture type errors involving missing required startFootprint/endFootprint fields and a validator assertion accessing dayNumber without proper narrowing.

Do not:

- claim the project is red solely because of known baseline failures;
- claim the implementation is green if it introduces additional failures.

Any newly introduced failure must be fixed before completing the corresponding milestone.


================================================================================
18. LIVE VERIFICATION
================================================================================

Tests alone are insufficient for external acquisition providers.

At minimum perform live characterization for:

Wikivoyage:
San Telmo
La Boca
Recoleta
Palermo

OSM:
representative PLACE
representative AREA
representative route/way
zero-result query

Google Places:
tourist attraction
market
winery where applicable
generic commercial place

Web:
existing grounded discovery smoke scenario

Record:

provider
query/request
response status
number of observations/candidates
provider-specific failures
resolver outcome
validation outcome

Do not put secrets into progress or Bitácora.


================================================================================
19. BITÁCORA / OBSERVABILITY
================================================================================

Preserve the existing requirement that Bitácora expose enough information to understand the complete acquisition decision.

The execution summary should make this visible:

catalog
→ deficit
→ source routing
→ acquisition
→ provider failures
→ observations
→ candidate synthesis
→ corroboration
→ resolution
→ geographic rejection
→ dedupe
→ refill/requery
→ ranking
→ planner
→ materialization

For preference ranking expose:

dimension
key
importance
confidence
effectiveWeight
source

For acquisition expose:

provider
request/query
evidence keys
failure status
candidate produced
corroboration decision

Prompts and raw LLM responses must remain observable where LLMs are actually involved.

Structured providers do not need fake prompts merely for Bitácora symmetry.

Secrets must remain redacted.


================================================================================
20. PROGRESS DISCIPLINE
================================================================================

After every coherent implementation checkpoint, update:

docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md

The progress document must record:

branch
HEAD commit
current milestone
completed work
files changed
tests executed
test results
live verification
known pre-existing failures
new failures if any
exact next action
verifiedAtCommit

Example:

verifiedAtCommit: abc123

Progress must describe repository reality, not intentions.

Do not mark a rollout complete before its verification requirements actually pass.


================================================================================
21. COMMIT STRATEGY
================================================================================

Prefer small coherent commits.

Suggested sequence:

feat: add acquisition observation interfaces

feat: add wikivoyage api adapter

test: add wikivoyage acquisition fixtures

feat: synthesize structured acquisition candidates

refactor: model preference importance and confidence separately

feat: normalize explicit and inferred preference facets

feat: add deterministic source corroboration

feat: add deficit based acquisition source routing

refactor: route google places through acquisition pipeline

feat: add proactive osm acquisition

fix: make tavily walk queries theme aware

feat: rank exploration style as preference facet

feat: orchestrate multi source experience acquisition

Do not combine the entire project into one giant commit.

Each commit should leave the branch in a coherent state where reasonably possible.


================================================================================
22. EXPLICIT NON-GOALS
================================================================================

Do not implement as part of this plan:

- new Activity model;
- new ActivityKind;
- new planner entity hierarchy;
- route-like structural planner domain;
- global provider ranking;
- LLM-based source routing;
- LLM-based corroboration;
- LLM-generated arbitrary preference importance;
- explorationStyle in Tavily grounded-search queries;
- forced SourceObservation representation for web results;
- provider-specific persistence shortcuts;
- destructive schema reset before runtime cutover is verified;
- unrelated refactors merely because nearby code can be cleaned up.


================================================================================
23. IMPLEMENTATION ORDER
================================================================================

The implementation order is mandatory unless repository reality discovered during implementation proves a dependency incorrect.

If that happens, document the reason in progress before changing order.


PHASE 1 — Wikivoyage

1. SourceObservation / acquisition interfaces
2. Wikivoyage API boundary
3. fixture-backed Wikivoyage parser tests
4. Wikivoyage acquisition provider
5. mechanical SourceObservation → ExperienceCandidate synthesis
6. module wiring
7. live characterization
8. tests
9. progress checkpoint
10. commit


PHASE 2 — Preference facets

1. PreferenceFacet
2. importance / confidence / source separation
3. wizard normalization
4. free-text interpreter contract
5. deterministic importance mapping
6. explicit/inferred merge rules
7. ranking adaptation
8. Bitácora explainability
9. tests
10. progress checkpoint
11. commit


PHASE 3 — Corroboration + source routing

1. extract/reuse existing identity logic
2. deterministic cross-provider corroboration
3. evidence union
4. ExperienceAcquisitionPlan
5. SourcePlan
6. explicit deficit → source routing
7. unknown-dimension web fallback
8. planner integration
9. tests
10. progress checkpoint
11. commit


PHASE 4 — Google Places cutover

1. GooglePlacesAcquisitionProvider
2. Places → SourceObservation
3. remove direct Places → Experience persistence
4. route through candidate/resolver pipeline
5. Starbucks regression
6. tests
7. progress checkpoint
8. commit


PHASE 5 — OSM proactive acquisition

1. OSM acquisition provider
2. deficit-driven OSM concepts
3. configurable Overpass
4. provider failure distinctions
5. corroboration integration
6. live verification
7. tests
8. progress checkpoint
9. commit


PHASE 6 — Tavily + explorationStyle

1. make walk query theme-aware
2. preserve single grounded query
3. keep explorationStyle out of query
4. represent explorationStyle as PreferenceFacet
5. route into ranking
6. tests
7. progress checkpoint
8. commit


PHASE 7 — Final orchestration

1. integrate source planning into ExperienceAcquisitionService
2. independent provider execution
3. failure isolation
4. structured observation synthesis
5. web candidate integration
6. corroboration
7. resolver
8. geographic validation
9. dedupe
10. persistence
11. embeddings
12. catalog re-query
13. refill/requery
14. preference ranking
15. planner
16. Tour materialization
17. acceptance suite
18. live smoke verification
19. full tests
20. final progress checkpoint
21. commit


================================================================================
24. FIRST EXECUTABLE CODEX TASK
================================================================================

Do NOT attempt to implement the entire plan immediately.

Start by inspecting repository reality at the current HEAD.

Confirm:

- current interfaces;
- current module wiring;
- current ExperienceCandidate shape;
- existing geographic reconciliation utilities;
- existing Wikivoyage-related code, if any;
- current backend test baseline.

Then implement ONLY Phase 1:

- SourceObservation/acquisition interfaces;
- Wikivoyage API boundary;
- fixture-backed parser tests;
- Wikivoyage acquisition provider;
- mechanical candidate synthesizer;
- module wiring;
- live characterization.

Do NOT modify during Phase 1:

- Google Places acquisition;
- OSM acquisition;
- source routing;
- preference ranking;
- explorationStyle;
- Tavily;
- downstream resolver behavior.

After Phase 1:

- run targeted tests;
- run full backend Jest;
- run yarn run check;
- perform live Wikivoyage verification;
- update progress;
- commit;
- STOP.

Before marking the milestone complete, compare the resulting repository against this plan and the canonical design.


================================================================================
25. DEFINITION OF DONE
================================================================================

The multi-source acquisition project is complete only when all of the following are true:

- structured sources can populate Experience candidates;

- Wikivoyage acquisition is fixture-tested and live-verified;

- multi-provider evidence corroborates deterministically;

- ambiguous cross-provider identity is not force-merged;

- Google Places no longer bypasses the candidate/resolver/validation pipeline;

- OSM can proactively fill coverage deficits;

- web + LLM remains available for long-tail gaps;

- source routing is dimension-aware and deterministic;

- unknown dimensions safely fall back to web discovery;

- preference importance and interpretation confidence are separate;

- explicit wizard preferences use importance=1/confidence=1;

- free-text confidence comes from interpretation while importance remains deterministic;

- identical explicit and inferred facets merge deterministically;

- ranking consumes normalized preference facets;

- ranking decisions remain explainable;

- explorationStyle affects relevance/ranking but not grounded discovery;

- Tavily route/walk queries are theme-aware;

- provider failures degrade locally;

- catalog reuse prevents unnecessary reacquisition;

- all structured candidates flow through one resolver/persistence path;

- no provider-specific Experience persistence shortcut remains;

- Tour acceptance tests demonstrate preference-sensitive selection against a rich competing catalog;

- Bitácora exposes acquisition and ranking decisions;

- relevant live provider checks pass;

- full backend tests pass;

- no new type/check regressions remain;

- progress matches the verified repository HEAD.


================================================================================
26. CORE ARCHITECTURAL RESULT
================================================================================

The final system must embody this separation of responsibilities:

STRUCTURED SOURCES
tell us what exists.

WEB + LLM
helps discover and interpret long-tail concepts that structured sources do not cover.

CORROBORATION
determines when multiple sources describe the same real-world concept.

RESOLVER + GEOGRAPHIC VALIDATION
determines whether a candidate is sufficiently grounded and valid.

DEDUPE
determines whether it is already represented in the catalog.

PREFERENCE NORMALIZATION
determines what the user actually wants and how strongly it should matter.

COVERAGE ANALYZER
determines what the catalog is missing.

SOURCE ROUTING
determines which sources are appropriate for those deficits.

RANKING
determines which verified Experiences best match the user's preferences.

DETERMINISTIC PLANNER
determines how the selected Experiences compose a feasible Tour.

The LLM must no longer be the component that implicitly decides what exists in the real world.
