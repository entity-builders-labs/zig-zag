# Activity Discovery and Tour Generation

> **Status:** Target architecture and design invariants. Some stages already
> exist and others are planned. The current repository remains the source of
> truth for implementation status.
>
> **Mandatory reading:** Read this document before changing tour generation,
> activity retrieval/ranking, embeddings, destination resolution, composite
> Activities, Google Places/OSM integrations, or Activity Discovery.

This document describes how Zig-Zag should transform user preferences into a
grounded tour while growing a reusable catalog of neighborhood walks, food and
architecture walks, and route-based experiences.

Related documents:

- [Destination-aware activity engine design](../superpowers/specs/2026-08-21-activity-engine-design.md)
- [Destination-resolution implementation plan](../superpowers/plans/2026-08-21-activity-engine-destination-resolution.md)
- [Candidate quality, discovery, and mobility implementation plan](../superpowers/plans/2026-08-21-activity-engine-quality-discovery-mobility.md)
- [Generation bitacora design](../superpowers/specs/2026-08-20-generation-bitacora-design.md)

## Architectural invariants

1. Query the existing catalog before running Activity Discovery.
2. Keep Destination Resolution and Activity Discovery separate.
3. Discovery proposes semantic ideas; it never supplies trusted coordinates,
   Google Place IDs, OSM IDs, or geometry.
4. Google Places and OSM supply authoritative identity and geometry.
5. Persist only fully resolved and validated Activities.
6. The itinerary LLM may select only real Activity IDs offered by the backend.
7. Embedding similarity is a relevance signal, not proof of identity or truth.
8. Semantic relevance and spatial feasibility are separate decisions. A set of
   strong semantic matches is not sufficient unless it forms a viable tour.
9. The user's allowed transportation modes must drive deterministic travel-time
   analysis, spatial grouping, per-day routing, and feasibility validation. A
   prompt instruction is not enforcement.
10. Coverage means enough relevant Activities that can form feasible per-day
    groups for the requested transport, pace, and duration; it is not a raw
    candidate count.
11. For the first transport release, Zig-Zag owns leg feasibility, the selected
    mode, and a conservative time/distance estimate. Google Maps owns live
    transit lines, transfers, and turn-by-turn navigation.
12. Composite Activities are reusable catalog Activities grouped into stable
   families and variants. Waypoint content is not variant identity.
13. TourActivityWaypoint stores the effective ordered waypoint set used by a
   tour so later variant edits do not rewrite that set.
14. OSM streets and paths must never be materialized as kind=POI.
15. ActivityWaypoint continues to reference reusable Activity rows. Do not add
    a GeoFeature table without a demonstrated requirement.
16. Waypoint lifecycle changes are explicit: merge, replace/remove, or archive
    rather than silently corrupting a composite.
17. Provider/index availability and LLM reasoning are not verification. The
    generation bitacora may claim a semantic, transport, opening-hours, or
    feasibility signal was applied only when the corresponding deterministic
    stage records evidence that it actually ran successfully.

## End-to-end flow

```mermaid
flowchart TD
    A["Tour Wizard<br/>destination, dates, interests,<br/>pace, group, transport, budget"]
    A --> B["UserIntentBuilder<br/>normalize preferences"]
    B --> MOB["MobilityProfileBuilder<br/>allowed modes + pace + days<br/>travel constraints"]

    B --> C["DestinationResolutionService"]
    C --> C1{"Real bounded destination?"}
    C1 -- "Yes: city/neighborhood" --> C2["AREA DestinationContext<br/>OSM boundary + bbox + centroid<br/>locality/country"]
    C1 -- "No: hotel/POI/address" --> C3["POINT DestinationContext<br/>lat/lng + radius"]
    C1 -- "External failure" --> C3

    C2 --> D["ExistingActivityRetriever"]
    C3 --> D
    D --> E["Query existing catalog<br/>POI + ROUTE + NEIGHBORHOOD_WALK + EXPERIENCE<br/>exclude AREA and archived"]

    E --> F{"Pool too small?"}
    F -- Yes --> G["Catalog Refill<br/>Places at destination anchors<br/>see Catalog Refill zoom below"]
    G --> H["Persist and deduplicate real POIs"]
    H --> I["Re-query catalog"]
    F -- No --> I

    I --> SEM["Semantic retrieval and individual ranking<br/>interest relevance + quality"]
    SEM --> SF["SpatialFeasibilityAnalyzer<br/>mode-aware travel-time matrix<br/>cluster viable candidates by day"]
    MOB --> SF
    SF --> J["CoverageAnalyzer<br/>quantity + themes + kinds<br/>+ feasible per-day groups"]
    J --> J1{"Coverage sufficient?"}
    J1 -- Yes --> R["Set-level selection and unified ranking<br/>relevance + diversity + travel cost"]

    J1 -- No --> K["DiscoveryRequest<br/>only missing quantities/themes/kinds"]
    K --> L["ActivityDiscoveryService"]
    L --> M["SearchGroundedDiscoveryProvider<br/>Gemini / OpenAI / other adapter"]
    M --> N["ActivityProposal[] + evidence<br/>no invented coordinates or IDs"]

    N --> O["Schema validation<br/>kind, themes, hints, duration"]
    O --> P["ActivityProposalResolutionService"]
    P --> P1["POI / venue / museum / restaurant<br/>Google Places"]
    P --> P2["Street / path / route / neighborhood<br/>OSM / Nominatim / Overpass"]
    P1 --> Q["ResolvedActivityProposal"]
    P2 --> Q

    Q --> V["ActivityValidator<br/>identity, type, geography,<br/>coherence, distance, duration,<br/>waypoints and transport"]
    V --> V1{"Valid proposal?"}
    V1 -- No --> X["Discard<br/>record reason in generation trace"]
    V1 -- Yes --> W["CompositeActivityService<br/>reuse or persist<br/>AREA -> Family -> Variant -> Waypoints"]
    W --> REFRESH["Refresh semantic and spatial analysis<br/>for the expanded verified pool"]
    REFRESH --> R
    X --> R

    R --> S["Feasible candidate groups per day<br/>appropriate for allowed transport"]
    S --> T["Candidate window<br/>real IDs and feasible groups only"]
    T --> U["Itinerary LLM<br/>select and organize Activities<br/>never create entities"]
    U --> Y["Anti-hallucination verification<br/>offered IDs, duplicates,<br/>waypoints and subsets"]
    Y --> Z{"Valid picks remain?"}
    Z -- No --> ERR["Explicit failure<br/>never invent Activities"]
    Z -- Yes --> AA["Per-day route and schedule optimization<br/>mode-specific travel times<br/>opening hours + activity duration"]
    AA --> FEAS{"Schedule and mobility feasible?"}
    FEAS -- No --> RESELECT["Reselect or reduce stops<br/>never force an incoherent tour"]
    RESELECT --> R
    FEAS -- Yes --> LEG["Tour leg snapshot<br/>mode + estimated time + distance<br/>Google Maps handoff"]
    LEG --> AB["Persist generated tour"]
    AB --> AB1["TourActivity per selected Activity"]
    AB1 --> AB2["TourActivityWaypoint<br/>effective ordered snapshot"]
    AB2 --> AC["Generated tour + bitacora<br/>resolution, coverage, discovery,<br/>ranking and verification"]
```

The critical boundary is:

```text
Discovery proposes meaning.
Entity Resolution supplies identity.
Validation authorizes persistence.
Tour Generation only selects verified Activities.
```

## Stage responsibilities

| Stage | Responsibility | Must not do |
| --- | --- | --- |
| UserIntentBuilder | Normalize destination and preferences | Resolve external entities |
| MobilityProfileBuilder | Convert allowed transport, pace, days, and accessibility needs into routing constraints | Treat every mode as walking or rely on prompt text |
| DestinationResolutionService | Normalize structured locality/country context, classify point vs area, validate the result against destination coordinates, and build DestinationContext | Blindly trust a provider-specific display label or discover experiences |
| ExistingActivityRetriever | Retrieve geographically valid catalog Activities | Call a discovery LLM |
| Catalog Refill | Add conventional real POIs from Places when the catalog is thin | Invent composites |
| SpatialFeasibilityAnalyzer | Build mode-aware travel-time relationships and viable per-day candidate groups | Use semantic similarity as a proxy for proximity |
| CoverageAnalyzer | Measure quantity, themes, kinds, quality, and transport-feasible per-day coverage | Treat a raw candidate count as sufficient or persist Activities |
| ActivityDiscoveryService | Request missing concepts from a grounded provider | Access Prisma or persist output |
| Entity Resolution | Resolve hints through Places/OSM with destination context | Trust LLM identity or coordinates |
| ActivityValidator | Enforce semantic, geographic, structural, and transport rules | Repair by guessing |
| CompositeActivityService | Reuse/persist validated area, family, variant, and waypoints | Persist raw proposals |
| Unified Ranking | Select coherent candidate sets using relevance, quality, diversity, and travel cost | Rank each Activity independently and ignore the resulting route |
| Itinerary generation | Choose and schedule offered Activity IDs | Create entities |
| Verification | Drop hallucinated IDs, duplicates, invalid subsets, and infeasible schedules | Trust prompt compliance |

Destination resolution must not assume that the frontend display label is a
canonical Nominatim query. For example, the provider label `Montevideo,
Montevideo Department, Uruguay` can return no Nominatim result while the
structured locality/country query `Montevideo, Uruguay` resolves the real city
relation. A bounded fallback must be built from structured destination
components and disambiguated with the selected coordinates and country; it
must not remove arbitrary comma-separated components and accept the first
result blindly.

## Deferred design topic: food and drink stops

Food and drink venues need role-aware scheduling; they must not be treated as
interchangeable sightseeing POIs. This is intentionally deferred until the
provider, catalog-quality, discovery, and mobility foundations are stable.

The later design must distinguish at least:

- a general or mixed tour, where a meal, coffee, or snack is a schedule-support
  stop and repeated consecutive venues are normally invalid; and
- an explicitly food-centric experience, such as a tapas, market, tasting, or
  cafe walk, where multiple verified food venues are the primary experience.

Merely including `food` among several wizard interests must not automatically
make a tour food-centric. The design also needs to account for meal windows,
opening hours, duration, budget and dietary constraints, geographic coherence,
and the user's explicit intent. Route optimization must preserve those roles
and schedule constraints rather than globally reordering all selected
Activities only by geographic distance.

The Granada regression case—three cafe/coffee venues selected consecutively in
a mixed history, food, culture, and architecture tour—must become an acceptance
fixture when this work is implemented. No ad-hoc per-type cap is part of the
current provider/cache stabilization scope.

## Embeddings in the engine

Embeddings participate in retrieval, coverage analysis, semantic deduplication,
and unified ranking. They measure semantic relevance; they do not determine
whether a group of Activities can be visited efficiently.

```mermaid
flowchart TD
    U["Wizard input"] --> UI["Canonical semantic intent<br/>interests + themes + desired experience style"]
    UI --> B1["Embedding provider"]
    B1 --> QE["Query embedding"]

    U --> HARD["Structured constraints<br/>destination, budget, accessibility,<br/>opening hours, days"]
    U --> MOB["Mobility profile<br/>walking / cycling / driving / transit<br/>pace + allowed mode changes"]

    A["Persisted or updated Activity"] --> SD["SemanticActivityDocumentBuilder"]
    SD --> B2["Embedding provider"]
    B2 --> AE["Activity embedding"]
    AE --> PG[("PostgreSQL + pgvector")]
    QE --> PG

    HARD --> RET["Hybrid candidate retrieval<br/>hard eligibility + semantic relevance"]
    PG --> RET
    PG --> DUP["Semantic duplicate detection<br/>within the resolved destination"]
    PG --> RANK["Individual relevance scores<br/>interest similarity + quality"]

    RET --> SPATIAL["Transport-aware set selection"]
    RANK --> SPATIAL
    MOB --> MATRIX["Mode-aware travel-time matrix"]
    MATRIX --> SPATIAL
    SPATIAL --> TOUR["Feasible candidate groups per day"]
    SPATIAL --> COV["CoverageAnalyzer<br/>relevant and visitable matches<br/>per requested theme"]
    COV --> DECIDE{"Run discovery?"}
    DUP --> REUSE["Reuse or persist"]
```

Hard constraints run before semantic scoring: destination boundary/radius,
archive status, allowed Activity kinds, and deterministic budget,
accessibility, or operating constraints. This prevents a semantically similar
Activity in the wrong city from entering the pool. Transport mode is not text
to append to the embedding as a substitute for routing; it creates concrete
travel-time and feasibility constraints after relevant candidates are found.

All providers must embed the same canonical Activity document. For a composite
it should include verified name, kind, themes, area, duration, and waypoint
names/types. Coordinates, external IDs, ratings, and review counts are separate
identity, geographic, and quality signals and do not belong in semantic text.
Group and pace belong in the semantic document only when the Activity document
contains corresponding suitability information. Otherwise they remain
structured selection and scheduling signals.

Regenerate an Activity embedding when its semantic content changes. Embeddings
must not decide destination identity, Google/OSM identity, or anti-hallucination
verification.

## Amazon Bedrock's current role

Zig-Zag uses Amazon Bedrock as an embedding provider in production, not as the
chat or discovery provider. Titan Text Embeddings V2 produces the vectors
stored in PostgreSQL. Chat and itinerary generation remain behind the separate
OpenAI/Groq/Ollama abstraction.

```mermaid
flowchart LR
    INPUT["User intent"] --> INTENT["Canonical intent document"]
    ACT["Verified Activity"] --> DOC["Semantic Activity document"]

    INTENT --> TITAN["Amazon Bedrock<br/>Titan Text Embeddings V2"]
    DOC --> TITAN
    TITAN --> VECTORS["256-dimensional vectors"]
    VECTORS --> PG[("PostgreSQL + pgvector")]

    PG --> RETRIEVAL["Semantic retrieval"]
    PG --> COVERAGE["Coverage analysis"]
    PG --> DEDUPE["Semantic deduplication"]
    PG --> RANKING["Unified ranking"]
    RANKING --> FEASIBILITY["Transport-aware spatial feasibility<br/>separate deterministic stage"]

    DISCOVERY["Grounded discovery provider<br/>separate abstraction"] --> PROPOSALS["ActivityProposal[]"]
    PROPOSALS --> RESOLUTION["Google Places + OSM resolution"]
    RESOLUTION --> ACT
```

Vectors from different embedding models are not interchangeable even if their
dimensions match. Track provider/model/version and rebuild the full index when
switching models. Do not silently mix Titan and OpenAI/Ollama vectors.

`EMBEDDING_PROVIDER` is authoritative. An embedding-provider failure must
never select another provider automatically, regardless of which API keys are
present. The engine may retry the same provider under a bounded policy; if it
still fails, embeddings become explicitly unavailable for that operation and
retrieval degrades to the documented non-semantic signals. Changing provider
or model is an operator action followed by a complete index rebuild.

Local development uses Ollama with `nomic-embed-text`; production uses Bedrock
Titan. Both store vectors in PostgreSQL with pgvector. ChromaDB is not part of
the current architecture. Local Ollama tests validate the pipeline but do not
claim numerical parity with Titan.

The Prisma column is currently vector(256). Production configuration must stay
at 256 dimensions unless a schema migration and complete index rebuild happen
together.

## Transport-aware spatial feasibility

Semantic ranking answers whether one Activity matches the user's interests.
Spatial feasibility answers whether a set of matching Activities forms a good
tour. This is a set-level decision: distance from each Activity to the
destination center is not enough because the travel cost between Activities
determines the actual itinerary.

```mermaid
flowchart TD
    C["Semantically relevant Activities<br/>verified coordinates + duration + hours"]
    T["Wizard transportationMode[]<br/>walking / cycling / driving / public_transport"]
    P["Travel pace + days + daily time budget<br/>group and accessibility constraints"]

    T --> M["MobilityProfileBuilder"]
    P --> M
    C --> TM["Pairwise travel-time matrix"]
    M --> TM

    TM --> CL["SpatialFeasibilityAnalyzer<br/>build viable clusters per day"]
    C --> CL
    CL --> SEL["Set-level selection<br/>semantic coverage + quality + diversity<br/>minus travel and mode-change cost"]
    SEL --> ROUTE["Per-day route optimization<br/>using allowed modes"]
    ROUTE --> VAL{"Within leg and daily<br/>travel budgets?"}
    VAL -- Yes --> OUT["Feasible candidate groups<br/>for itinerary generation"]
    VAL -- No --> RETRY["Reselect, split across days,<br/>or reduce stops"]
    RETRY --> SEL
```

The matrix should represent travel time and operational friction, not only
straight-line distance:

| Mode | Required signals |
| --- | --- |
| `walking` | Pedestrian route, crossings, slopes, accessibility, maximum leg and daily walking time |
| `cycling` | Cycle-suitable route, bicycle infrastructure, slopes, parking, maximum riding time |
| `driving` | Road route, expected traffic, parking location, parking/search overhead |
| `public_transport` | Stops, schedules/frequency, waiting, transfers, and walking access/egress |

When the wizard allows multiple modes, the engine may choose a mode per leg but
must penalize excessive mode changes. Thresholds must derive from travel time,
pace, day duration, and destination context rather than one global kilometer
radius.

Coverage analysis runs after this stage. Twenty strong semantic matches can
still mean insufficient coverage when only three form a viable walking cluster.
For multi-day tours, coverage should be expressed as one or more coherent
geographic groups per day. Discovery is triggered only for themes or quantities
missing from those feasible groups, not merely because candidates are spread
across the destination.

### Accepted MVP transport contract

For the first transport-aware version, every transition between consecutive
Activities should expose this minimum snapshot:

```text
fromActivityId
toActivityId
transportMode: walking | cycling | driving | public_transport
estimatedDurationMinutes
distanceMeters
```

The existing `TourActivity.travelTimeToNext` and `distanceToNext` fields already
represent part of this transition. The smallest schema evolution is an explicit
`transportModeToNext`. A separate `TourLeg` model is deferred until the product
needs multimodal sublegs, route geometry, transfers, provider metadata, or
detailed route snapshots.

```mermaid
flowchart LR
    A["Activity A"] --> L["Zig-Zag leg snapshot<br/>selected mode + estimated time<br/>+ distance"]
    L --> B["Activity B"]
    L --> CTA["Open in Google Maps"]
    CTA --> LIVE["Live navigation<br/>current transit lines, stops,<br/>transfers and disruptions"]
```

Zig-Zag remains responsible for deciding that the leg fits the schedule and
uses a mode allowed by the user. For `public_transport`, the UI may show
"public transport, approximately 35 minutes" and open Google Maps with origin,
destination, transit mode, and, when available, the intended departure time.
The MVP does not persist a bus/subway line, stop sequence, transfer instructions,
turn-by-turn directions, or a detailed polyline. Those details are volatile and
belong to the live navigation provider.

Travel time must come from deterministic routing when available, not from an
LLM. If the first release lacks reliable public-transit routing, show a clearly
approximate conservative range, reserve the upper bound in the schedule, and
delegate the live route to Google Maps. Navigation is delegated; itinerary
feasibility is not.

### Current implementation gap

The current wizard captures `transportationMode` and includes it in the LLM
prompt, but deterministic post-processing does not yet implement the target
architecture above. [route-optimizer.util.ts](../../be/src/modules/tours/utils/route-optimizer.util.ts)
uses nearest-neighbor plus 2-opt over straight-line Haversine distance for every
request, and
[travel-time-calculator.util.ts](../../be/src/modules/tours/utils/travel-time-calculator.util.ts)
assumes walking at 5 km/h and stops calculating at a 2 km leg. It can reorder
selected stops but cannot reject, replace, cluster, or route them differently
for cycling, driving, or public transport. Treat this section as required
design input before extending candidate selection or route optimization;
consult the code for the current implementation state.

## Catalog Refill with destination anchors

This section is a **zoom into the `Catalog Refill` node of the end-to-end
flow**. It does not introduce a parallel flow: its output returns to `Persist
and deduplicate real POIs`, followed by catalog re-query, semantic/spatial
analysis, and coverage evaluation.

Places providers search around a point and radius. A city-scale destination is
a polygon, so refill uses a bounded set of representative points called
anchors. Google Places is the selected MVP provider; Geoapify remains an
explicitly selected adapter, not an automatic fallback.

```mermaid
flowchart TD
    A["Resolved destination boundary<br/>for example Buenos Aires"] --> B["Select 4-8 representative anchors<br/>neighborhood centroids or bounded grid"]

    B --> C1["Places search near San Telmo"]
    B --> C2["Places search near Palermo"]
    B --> C3["Places search near Recoleta"]
    B --> C4["Places search near La Boca"]

    C1 --> D["Union all results"]
    C2 --> D
    C3 --> D
    C4 --> D

    D --> E["Deduplicate by provider + external ID"]
    E --> F["Discard results outside destination boundary"]
    F --> G["Persist new real POIs"]
    G --> H["Generate Activity embeddings"]
    H --> I["Re-query catalog<br/>rerun semantic and spatial feasibility<br/>then rerun coverage"]
```

An anchor is an implementation point for calling a point-based API. It is not a
new domain entity and is not persisted as an Activity. Point-scale destinations
use their own point as the single anchor; area-scale destinations use a bounded
number to control latency, quotas, and cost.

### Provider-operation zoom inside each anchor search

The following diagram is a second-level zoom: each `Places search near ...`
node in the anchor diagram above executes this provider-operation subflow.

```mermaid
flowchart TD
    A["One bounded DestinationAnchor<br/>point + radius"] --> B["Missing-coverage category query<br/>type + keywords + result budget"]
    B --> C{"Explicitly selected<br/>Places provider"}

    C -- Google --> D{"Type supported by<br/>Google Nearby Search?"}
    D -- Yes --> E["Google Nearby Search<br/>included type + hard circle restriction"]
    D -- No --> F["Google Text Search<br/>free text + location bias<br/>only for configured unsupported types"]

    C -- Geoapify --> G{"Adapter operation"}
    G -- searchNearby --> H["Geoapify Places category search<br/>hard circle filter"]
    G -- searchText compatibility --> I["Map one of the configured query patterns<br/>to Geoapify categories"]
    I --> H

    E --> J["Normalized provider result<br/>PlaceData + truthful provenance"]
    F --> J
    H --> J

    J --> K["Hard geographic validation<br/>finite coordinates + requested radius<br/>and destination boundary when available"]
    K --> L["CatalogCandidateValidator<br/>name + provider ID + supported type<br/>business/quality rules"]
    L --> M["Union all anchor results"]
    M --> N["Deduplicate<br/>provider + external ID"]
    N --> O["Persist accepted real POIs"]
    O --> P["Return to the end-to-end flow<br/>re-query catalog"]
```

Operation semantics are deliberately not presented as equivalent:

- Google `searchNearby` is the normal operation for conventional typed POIs
  and enforces a circular location restriction at the provider request.
- Google `searchText` is free-text retrieval with a location bias. It is used
  only for explicitly configured concepts that Nearby does not support well;
  every result still requires a hard backend geography check.
- Geoapify Places has no equivalent free-text Places endpoint. Its
  `searchText` adapter method is a compatibility mapping for the small set of
  configured query patterns and executes a category search with a circle
  filter. An arbitrary text query is not supported.
- Exhausting or failing Nearby does not cause the same request to be retried
  through Text Search, and provider failure does not automatically switch
  Google to Geoapify. Independent configured operations may still produce a
  truthful partial result.
- If no valid candidate remains, any provider quota, rate-limit, strict-cache,
  or availability failure must remain visible; the engine must not rewrite it
  as "the destination has no places."

```text
Catalog Refill finds conventional real POIs through Google Places.
Activity Discovery proposes higher-level experiences missing from the catalog.
```

## Coverage decision

Coverage is not a single candidate count. It should report:

- usable quantity for requested days and pace;
- strong semantic matches for every requested interest;
- Activity kind diversity;
- transport-feasible candidate groups for each day;
- per-leg and per-day travel-time budgets for the allowed modes;
- destination distribution without forcing unrelated distant clusters into one day;
- quality/confidence;
- missing themes and kinds to request from discovery.

Discovery receives only missing coverage. It must not rediscover an entire
destination for every tour.

## Activity proposal boundary

A provider-neutral proposal is not a persisted Activity. At minimum it carries:

```text
name
kind: ROUTE | NEIGHBORHOOD_WALK | EXPERIENCE
themes[]
suggestedDurationMinutes
shortReason
entityHints[]
groundingEvidence[]
```

Entity hints use stable keys and controlled role/expected-type vocabularies.
AREA is resolution context rather than a discoverable proposal kind. POI
discovery can be added later if Places-based catalog refill proves
insufficient.

The short reason and raw provider output belong in the generation trace for
auditability. They must not be copied directly into persisted catalog prose.

## Change checklist

Before merging a change to this engine, verify:

- Does catalog retrieval still run before discovery?
- Are point-scale and area-scale destinations explicit?
- Are geography and identity authoritative rather than semantic?
- Can every persisted coordinate, geometry, and external ID be traced?
- Is discovery provider-neutral and free of Prisma dependencies?
- Does CoverageAnalyzer request only missing coverage?
- Does coverage represent feasible per-day groups rather than a raw count?
- Are embeddings generated from the canonical semantic document?
- Are embedding provider/model/version consistent with the index?
- Does `transportationMode` drive deterministic travel-time analysis and route
  validation instead of existing only in the LLM prompt?
- Does every persisted/displayed transition identify its selected mode and a
  defensible time estimate?
- Are live transit lines and turn-by-turn navigation delegated to the map
  provider without delegating itinerary feasibility?
- Are semantic relevance, set selection, and route ordering separate stages?
- Can an infeasible itinerary reselect, split, or reduce stops instead of being
  persisted unchanged?
- Does the itinerary model receive only verified Activity IDs?
- Are flat and composite hallucinations rejected server-side?
- Are historical waypoint snapshots preserved?
- Are lifecycle changes explicit and restrictive?
- Is the generation bitacora updated for new decisions and fallbacks?
