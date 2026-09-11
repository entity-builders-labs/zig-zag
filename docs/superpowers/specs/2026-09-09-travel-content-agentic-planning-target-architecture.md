# Travel Content & Agentic Planning — Target Architecture

Status: canonical cross-cutting architecture decision record. Docs-only.
Branch of record: `feat/experience-domain-v2` (these docs travel to the future
integration branch — see §17).
Written: 2026-09-09. HEAD when written: `adae0c0`.

Related:
- `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md` (current acquisition engine)
- `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md` (phase plan)
- `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md` (live status)
- `docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md` (deterministic solver)
- `docs/superpowers/plans/2026-08-28-pr10-deterministic-daily-planning.md`
- `docs/superpowers/specs/2026-09-06-tour-materialization-exposure-design.md`
- `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md` (executable sequence)
- `docs/superpowers/plans/2026-09-09-agentic-acquisition-integration-handoff.md` (merge handoff)
- Branch `feat/agentic-travel-planning` (inspected read-only; not modified)

> **This document does not authorize implementation.** It records decisions so
> future sessions/agents do not re-derive them. It does not start Phase 6 or
> Phase 7, does not merge branches, does not change schemas, does not add
> `TourStop`/`OperationalStop` to code, does not change Tavily/Gemini/OpenAI,
> and does not change the agent or acquisition. See §22 Non-goals.

---

## 0. Product vision: a personal travel research agent

**Zig-Zag's product is a personal travel agent, not a catalog recommender.**
The catalog is the agent's persistent shared tourism knowledge base: a growing,
reusable model of real Experiences that have been discovered, grounded,
classified, canonicalized, enriched and verified over time.

The product goal is to do, in minutes, the research work a traveler currently
does manually across search engines, maps, official tourism sites, attraction
sites, local media, specialist blogs, community sources and multiple browser
tabs — while remembering how that specific traveler likes to travel.

The target product loop is:

```text
understand what this traveler wants
        ↓
remember relevant long-term travel taste
        ↓
inspect what Zig-Zag already knows
        ↓
detect missing knowledge / preference gaps
        ↓
research autonomously when more knowledge can improve the trip
        ↓
follow promising sources and original evidence
        ↓
discover / validate / canonicalize new Experiences
        ↓
persist and enrich reusable catalog knowledge
        ↓
compose the best candidate set for THIS traveler
        ↓
build a physically feasible deterministic itinerary
        ↓
explain it to the traveler
        ↓
receive feedback
        ↓
learn / research again / replan
```

The catalog therefore sits **in the middle of the architecture, not at the top
of the product**. A warm catalog should make future trips faster and cheaper,
but the agent must not be constrained to whatever happens to already be in it.
When a trip would materially improve with new knowledge, the agent may initiate
further research, provided every discovered fact still passes through the same
grounded deterministic validation and persistence pipeline.

---

## 1. Purpose

Zig-Zag is being built as several tracks that must converge into one product:

- **Experience acquisition** — turning the real world into a verified catalog
  of tourism Experiences (`feat/experience-domain-v2`, the multi-source
  acquisition project).
- **Deterministic travel planning** — selecting, ranking, ordering, scheduling
  and checking the physical feasibility of a tour with no LLM in the loop
  (PR 10, `GreedyDailyPlanningSolver` + `TourPlanningFeasibilityValidator`).
- **Agentic orchestration** — a reasoning loop that interprets a natural-language
  trip request, decides what the trip still needs, and decides when another
  acquisition/research iteration is justified before planning
  (`feat/agentic-travel-planning`).
- **Conversational replanning** — future: the user iterates on a generated tour
  in dialogue rather than re-filling a form.
- **Operational itinerary needs** — future: meals, coffee, breaks — the plumbing
  a real day needs that is *not* itself a tourism Experience.
- **Future Activities** — guided tours, classes, tastings, tickets — content
  worth doing that is not a single physical POI.
- **Future Events** — time-bound content (concerts, festivals, markets) that
  depends on the trip's dates.

**Central invariant.**

> The agent decides *what the trip still needs* and *when additional work is
> justified*.
>
> The deterministic core decides *how facts are acquired, validated,
> corroborated, ranked, scheduled and materialized*.

The agent never becomes the authority for geographic truth, deduplication,
persistence, ranking, or feasibility. The deterministic core never guesses
what the traveler wants.

---

## 2. Architectural layers

```text
USER / WIZARD / CONVERSATION
        │  natural-language request, wizard fields, follow-up feedback
        ▼
AGENTIC TRAVEL PLANNER
        │  interpreted intent, ambiguities, "what's missing", "iterate again?"
        ▼
DETERMINISTIC TRAVEL CORE
        │  verified catalog, ranked pool, feasible scheduled days
        ▼
TOUR / ITINERARY
```

**Agentic Travel Planner** owns:
- interpreting intention from language;
- surfacing ambiguities;
- deciding *what is still missing* against measured coverage;
- deciding whether another acquisition/research iteration is worthwhile
  (bounded by explicit iteration/research budgets);
- deciding when a discovered source is worth deeper investigation;
- responding to conversational feedback and replanning requests;
- *requesting* capabilities of the core ("acquire more for this gap",
  "investigate this source further", "run the planner").

**Deterministic Travel Core** owns:
- acquisition; source-capability routing; corroboration; candidate synthesis;
- the resolver; geographic validation; dedupe;
- the catalog; embeddings; catalog refresh;
- preference ranking; daily scheduling; travel estimation; feasibility;
- evidence normalization, provenance and source-quality handling;
- (future) operational-stop placement; Tour materialization.

**Hard rule:** the agent cannot skip the deterministic validations. Anything
the agent proposes as content enters the same
`candidate → resolver → geographic validation → dedupe → catalog` path that
every other source uses. The agent cannot persist an Experience directly,
cannot inject POIs, cannot override a feasibility decision, and cannot
substitute its own ranking or scheduling.

---

## 3. Experience acquisition source families

Today's acquisition engine has four pillars (see the multi-source acquisition
design): **Wikivoyage, OSM, Google Places, Web**. The target generalises this
into three families:

```text
Experience Acquisition
│
├── Structured / evergreen
│   ├── Wikivoyage      (curated travel editorial: SEE / DO / EAT)
│   ├── OSM             (geographic / factual truth)
│   ├── Places          (POIs / businesses; physical adapter is swappable)
│   └── Activities      (FUTURE — tours, classes, tastings, tickets)
│
├── Web
│   ├── Search Retrieval    (we build the queries — Tavily / SerpAPI / …)
│   ├── Source Traversal    (Map / Crawl / Extract / follow original links)
│   └── Grounded Research   (we hand a research objective — Gemini / OpenAI / …)
│
└── Temporal
    └── Events          (FUTURE — date-bound content; concerts, festivals, markets)
```

Every family converges on the same downstream boundary: a provider-neutral
`ExperienceCandidate[]` that flows through mechanical synthesis (for structured
sources) or LLM extraction (for web), then shared corroboration, then the
shared resolver / validation / dedupe / catalog path. No family gets a
privileged global score.

### 3.1 Wikivoyage

Travel-oriented **editorial structure**: `SEE` / `DO` / `EAT` sections,
inline coordinates, Wikidata QIDs, per-neighborhood / per-destination
organisation, curated prose. Best at "what a traveller would actually seek
out here" and at composite/thematic framing. Currently: `WikivoyageAcquisitionProvider`
+ `WikivoyageApiService`, mechanical `SourceObservation` mapping.

### 3.2 OSM

**Geographic / factual truth**: places, areas, routes, parks, viewpoints,
wineries, monuments, historic sites, pedestrian streets. **No semantic
inference** — an OSM tag establishes that a real thing exists at a real
location, nothing about themes/traits/intents. Currently:
`OsmAcquisitionProvider` (proactive, Phase 5) via a hand-maintained
concept→selector registry + one bounded Overpass union query, plus the older
reactive component-hint resolution through `OsmPlacesService`.

### 3.3 Places

**POIs / businesses**: location, provider types, opening hours,
ratings/reviews where they exist. The physical abstraction is an adapter —
today Google Places; Geoapify or another provider can sit behind the same
interface (`IPlacesApiService` / the `PlacesApiService` token; the design
already distinguishes provider from capability).

**A Place is not automatically an Experience** — a Place becomes a candidate
that must survive corroboration + resolver + geographic validation + dedupe
like any other.

> **Target invariant.** A generic operational venue must **not** originate a
> tourism Experience — not because its Places type exists nearby, and not
> because a broad food/nightlife preference or a routing entry requested that
> category. Generic `restaurant` / `cafe` / `bakery` / `bar` / `night_club`
> venues are not Experiences by default.

> **Current state (not yet the invariant).** Phase 4 removed the direct
> `Place → Experience` shortcut and blocks generic *type-less* commercial
> refill pollution (the "Starbucks" fix). But an **explicitly-requested**
> contextual food/nightlife Places type is still admitted today, and
> `acquisition-source-routing.ts` still routes `theme:food` / `intent:food`
> → Places `restaurant` / `bakery` / `cafe` and `intent:nightlife` → `bar` /
> `night_club`. Phase 4 did **not** solve the whole
> Experience-vs-Operational-Stop problem for Places — that remaining semantic
> seam must be reconciled before Phase 7 can be declared CLOSED (see §7 and
> the convergence roadmap's Phase 7 gate).

Allowed roles for those Places entities, now and after the seam is closed:
(1) **corroborate / enrich** a tourism Experience discovered through stronger
evidence; (2) **represent** a venue that is itself proven to be a tourism
Experience; (3) **resolve Operational Stops** (lunch, coffee, dinner, a
snack) once operational planning exists (§10).

### 3.4 Activities (future family)

A new **conceptual** family — not implemented, not scheduled here.

Examples: guided tour, cooking class, food tour, kayaking, wine tasting,
boat trip, workshop, excursion, ticketed activity.

Potential adapters: Viator, other tour/activity inventories.

Key distinctions:

- **Place ≠ Activity.** An Activity can be worth doing even when it has no
  single canonical physical entity (a "tapas route", a "sunrise kayak
  excursion").
- An Activity must eventually enter the same
  `candidate → resolver → validation → dedupe` path. It resolves its own
  geography (a meeting point, a route, an operator location) through the
  same trusted geo providers.
- **No privileged global score.** An Activity competes in the same ranked
  pool as a POI Experience or a composite; its "worth doing" comes from
  preference/relevance matching, not from being an Activity.

### 3.5 Events (future family)

A **separate temporal** family — not implemented, not scheduled here.

Examples: concert, sports match, festival, temporary exhibition, fair, local
celebration, weekend market.

Events depend on:

- trip dates, timezone, event `start` / `end`;
- availability at those times;
- location.

> Events must **not** be mixed into the evergreen catalog without explicit
> temporality modeling. An evergreen `Experience` row is assumed to be
> "always there"; an Event is only relevant for a specific date window and
> must carry that, or it will pollute tours for the wrong dates.

---

## 4. Web is NOT one provider class

This is the most load-bearing distinction in this document.

```text
Web
├── Search Retrieval
│   └── Tavily / SerpAPI / future search APIs
│
├── Source Traversal
│   └── Map / Crawl / Extract / follow original links
│
└── Grounded Research
    └── Gemini + Google Search / OpenAI + web search / future grounded LLMs
```

"Web" is a set of capabilities with different control models, cost profiles,
and failure modes. Choosing between them is an **architecture** decision;
choosing a provider *inside* a capability is an interchangeable implementation
detail (see §8).

### 4.1 Search Retrieval

**We construct the queries.**

```text
deficit
  → deterministic query construction   (we own the phrasing)
  → search engine                       (Tavily / SerpAPI)
  → ranked URLs / snippets
  → content extraction
  → LLM candidate extraction            (only cites the retrieved evidence)
```

Strengths: control, observability, reproducibility, easy to test.

Weakness: **a bad query shrinks the candidate universe before the extractor
ever runs**, and no later ranking step can recover what was never retrieved.
(This is exactly why the multi-source design keeps `explorationStyle` out of
the walk query and routes it to downstream ranking instead.)

### 4.2 Source Traversal / deep source research

Search results are often only the entry point. A promising source — especially
an official destination site, official attraction site, park authority,
municipality, tourism board or operator site — may contain substantially richer
information behind internal navigation.

The research architecture therefore needs an explicit **follow-source** mode:

```text
Search / Grounded Research
        ↓
discover promising source URL/domain
        ↓
identify source role / authority
        ↓
Map site or inspect relevant links
        ↓
Crawl relevant sections only
        ↓
Extract original page content
        ↓
discover entities / claims / operational facts
        ↓
feed evidence into the normal validation pipeline
```

Examples of facts that are often best sourced from official pages:
- current opening hours;
- ticket / reservation requirements;
- current prices;
- visit duration / tour format;
- accessibility;
- age / child restrictions;
- seasonal closures;
- official descriptions of what the visitor actually does;
- temporary operational notices.

The agent may decide that a discovered domain or page is worth deeper research.
It does **not** bypass provider limits, evidence normalization, identity
resolution, validation or persistence. "Investigate this source further" is a
research objective; the core/tooling still owns the concrete safe retrieval and
normalization operations.

### 4.3 Grounded Research

**We hand the model a research objective.**

```text
qualitative / ambiguous / multi-step deficit
  → research instruction                (we own the objective, not the queries)
  → grounded LLM
  → one or more model-issued searches
  → cited real URLs
  → recover the ORIGINAL content of those URLs when possible
  → candidate extraction
```

Potential providers: Gemini + Google Search, OpenAI + web search, future
grounded LLMs.

Strengths: multi-query, self-reformulation, genuine qualitative research,
long-tail coverage.

Weaknesses: less deterministic, more expensive, harder to reproduce
run-to-run, and it can **synthesize a conclusion too early**.

### 4.4 Evidence discipline (critical)

> The text a grounded LLM synthesizes must **not** automatically become
> maximum-quality evidence.

Preferred flow:

```text
grounded LLM / search
  → cited real URLs
  → original-content extraction of those URLs
  → evidence  (full quality)
```

Fallback, explicit and marked:

```text
original content unavailable
  → model output used as evidence
  → evidenceQuality = reduced
```

This must stay consistent with how `GeminiGroundedSearchService` already
behaves — the grounded provider surfaces citations and grounding status, and
the extractor may only cite supplied evidence. The refinement here is to make
"original content vs reduced model output" an explicit, observable property
of the evidence, not an implicit one.

### 4.5 Retrieval provider ≠ information source

A retrieval mechanism is not the authoritative source of the fact it fetched.
This distinction is required for provenance, trust and future source weighting.

Examples:

```text
retrievalProvider: tavily
sourceType: OFFICIAL_DESTINATION_SITE
sourceDomain: turismo.buenosaires.gob.ar
sourceUrl: https://...
```

or:

```text
retrievalProvider: grounded_llm
sourceType: OFFICIAL_ATTRACTION_SITE
sourceDomain: louvre.fr
sourceUrl: https://...
```

Tavily, SerpAPI, Crawl, Extract, Gemini grounding, etc. describe **how Zig-Zag
retrieved information**. Buenos Aires Turismo, the Louvre, a park authority,
Wikivoyage, Reddit or a specialist local publication describe **where the
information came from**.

Source authority is claim-specific, not global. For example:
- coordinates / physical existence → OSM / Places / official geo data;
- current opening hours / ticket rules / price → official entity source;
- historical context → official cultural source / Wikidata / Wikipedia;
- popularity → Places/reviews;
- local character / hidden-gem signal → specialist editorial/community evidence;
- photos → Wikimedia Commons / Places / official/licensed media with provenance.

Do not collapse this into a single `source = tavily` field.

---

## 5. Web escalation policy

The target is **not** a single global switch (`GROUNDED_SEARCH_PROVIDER=one_provider`)
as the final architecture. The provider is swappable within a capability; the
*capability* is chosen per deficit.

```text
LOCAL CATALOG
      ↓
Coverage / preference-gap analysis
      ↓ insufficient

STRUCTURED ACQUISITION
Wikivoyage + OSM + Places + (future) Activities
      ↓
corroboration
      ↓
resolver / geographic validation / dedupe
      ↓
catalog re-query
      ↓
coverage again
      ↓ still insufficient?
      │
      ├── clear factual / queryable gap
      │        ↓
      │   Search Retrieval
      │
      ├── promising source discovered
      │        ↓
      │   Source Traversal / official-source research
      │
      └── qualitative / ambiguous / multi-step gap
               ↓
           Grounded Research
```

Worked examples:

- `theme=history` → structured first (Wikivoyage SEE, OSM historic, Places
  museums). Web only if still thin.
- `nature_type=mountain` → structured first (OSM `natural=peak`, Wikivoyage
  DO). Web for named trails / itineraries.
- `winery_scale=boutique` + `tourism_intensity=low` + `local_character=authentic`
  → likely structured *facts* (which wineries exist) **plus** grounded
  research (which ones are small, quiet, authentic — a qualitative judgment
  no single tag answers).
- a winery has been grounded and accepted, but its current visit/ticket details
  are incomplete → discover its official site, traverse only relevant visit /
  booking pages, and enrich the existing canonical Experience rather than
  creating another Experience.

**Rule:** the choice of source family / capability depends on the *kind* of
deficit. **Do not create a global source-quality score.** Source capability
is dimension-specific (existence vs geography vs activity-description vs
currency vs qualitative character), per the multi-source design's own
Non-goals.

---

## 6. Provider benchmark strategy

Tavily vs Gemini vs OpenAI (and Search Retrieval vs Grounded Research vs source
traversal) must **not** be decided by intuition. A future benchmark runs real
scenarios and measures, per **deficit class**:

Per-run outcome metrics:
- proposed candidate count
- accepted candidate rate
- unique accepted Experiences after corroboration
- wrong-city rejection rate
- wrong-country rejection rate
- duplicate rate
- composite Experience completeness
- preference-coverage gain (coverage before vs after)
- evidence quality (original content vs reduced model output)
- official-source recovery rate where one exists
- enrichment completeness for accepted Experiences
- run-to-run stability (identical scenario, N runs)

Operational metrics:
- latency p50 / p95
- cost per run

Deficit classes to separate: `theme`, `trait`, `intent`, `winery_scale`,
`tourism_intensity`, `nature_type`, `local_character`, `walk`, `route_like`,
`day_trip`.

**Objective:** not "the best provider" — the **best capability per deficit
class**. The routing table (`acquisition-source-routing.ts`) is where that
judgment is encoded; the benchmark is how it earns its entries.

---

## 7. Experience vs Operational Stop

Refined canonical invariant (this replaces the looser "everything schedulable
is an Experience"):

> **All tourism content worth choosing on its own is an Experience.**
>
> **Operational itinerary needs are not Experiences** — they are Operational
> Requirements, satisfied by Operational Stops.

Experience (worth choosing for itself):
- wine route, food tour, tapas crawl
- an iconic restaurant that is *specifically* worth visiting
- a historic food market
- a winery visit, a cooking class
- a museum, a neighborhood walk, a viewpoint route

Operational Stop (a need of the day, not a destination):
- lunch because it is lunchtime
- coffee, a snack, an ice cream
- a rest, a restroom, a charging stop

> Do not contaminate the Experience catalog with purely operational entities.
> In particular, a **generic** `restaurant` / `cafe` / `bar` / `pub` /
> `nightclub` must not become an Experience just because the tag exists
> nearby. Phase 5 hardening already made these concepts unsupported for
> proactive OSM Experience acquisition for exactly this reason.

The current **Places** contextual-admission seam (an explicitly-requested
food/nightlife Places type is still admitted, and `acquisition-source-routing.ts`
still routes food/nightlife deficits to those types) is tracked as a **Phase 7
closure criterion** — see §3.3 and the convergence roadmap's "Phase 7 gate".

And explicitly:

> **`food` Experience ≠ generic restaurant need.**
> A food tour, a wine tasting, a historic food market, a genuinely iconic
> restaurant — Experience. "Some restaurant to eat at 13:00" — Operational Stop.

---

## 8. One physical venue may satisfy both roles

A single real place can be both a chosen Experience *and* the thing that
covers an operational requirement.

```text
Requirement:        lunch, window 12:30–14:30
Selected Experience: historic food market, scheduled 13:00–14:30
Result:             lunch requirement satisfied → no extra stop inserted
```

This is a **principle of the future scheduler**: operational-requirement
resolution runs *after* Experience selection/scheduling and only fills
requirements that the already-scheduled Experiences do not already cover.

---

## 9. Future operational requirements (responsibility, not schema)

Conceptually there is a `DailyOperationalRequirements` notion:

- **Meals**: breakfast, lunch, dinner
- **Breaks**: coffee, snack, rest

Possible per-requirement constraints (illustrative, **not** a frozen schema):
`preferredWindow`, `duration`, `maxDetour`, dietary requirements, budget,
party size, opening hours.

> This section defines *whose responsibility* operational requirements are
> (the deterministic core, after Experience scheduling), not their
> implementation. **No schema, no `OperationalStop`/`TourStop` type, no
> new fields are authorized by this document.**

---

## 10. Operational Stop Resolver (future, conceptual)

```text
selected Experiences
        +
daily operational requirements
        ↓
scheduler places Experiences into days
        ↓
requirements already satisfied by a scheduled Experience?  (see §8)
        ↓
remaining unsatisfied requirements
        ↓
Operational Stop Resolver
        ↓
Places / OSM / appropriate operational providers
        ↓
routing / opening-hours / detour validation
        ↓
final day
```

Google Places (or the active Places adapter) is likely **especially
appropriate** here — a nearby, open, well-rated cafe on the route is exactly
what a coffee break needs, and none of the "is this worth doing?" bar
applies. The Operational Stop Resolver reuses the same travel-estimation and
opening-hours machinery the solver already has.

---

## 11. Wizard UX

**No new mandatory wizard screen.** Default behaviour is intelligent defaults.
The user should not be forced to answer "Do you want lunch?", "Do you want
coffee?", "At what exact time?".

A future **optional** section could exist:

- **Meals and breaks** — mode: `automatic` / `customize`
  - Lunch: `automatic` / `early` / `normal` / `late`; `quick` / `normal` / `relaxed`
  - Breaks: `few` / `normal` / `frequent`
  - Budget
  - Dietary requirements

The product loop stays:

1. user expresses the trip they want;
2. Zig-Zag generates;
3. user sees it;
4. user iterates conversationally.

---

## 12. Agentic planner responsibilities

**The agent owns:**
- language interpretation;
- ambiguity detection and surfacing;
- requirement interpretation;
- deciding whether more research/acquisition is needed (against measured coverage);
- deciding whether a newly-discovered source merits deeper traversal;
- feedback iteration;
- replanning requests.

**The agent does NOT own:**
- geographic truth;
- dedupe;
- direct Experience persistence;
- raw source-specific HTTP/provider mechanics;
- replacing deterministic ranking;
- replacing the deterministic planner/solver;
- silently invented POIs.

**Refined source-choice boundary.** The agent may decide the *research strategy*
and objective (for example: "the catalog still lacks credible boutique-winery
coverage; investigate this official Valle de Uco tourism domain further"). The
agent does not hard-code transport mechanics such as a specific Tavily HTTP call
or bypass the acquisition core. The research/acquisition capability selects and
executes concrete provider operations, enforces budgets and retries, normalizes
evidence and routes accepted facts through validation.

This refinement preserves the existing rule that the agent cannot create a
parallel source-specific acquisition architecture while allowing genuine
agentic research: the agent can choose **what question/source deserves more
attention**, while the core controls **how that research is safely executed and
accepted**.

---

## 13. Deterministic core responsibilities

The core owns, end to end:

catalog · coverage/preference-gap analysis · deficit classification ·
source-capability routing · acquisition · web-retrieval policy ·
source-traversal execution · grounded-research escalation policy · evidence ·
candidate synthesis · corroboration · resolver · geographic validation · dedupe ·
persistence · embeddings · catalog refresh · ranking/composition · daily
scheduling · travel estimation · feasibility · (future) operational-stop
placement · Tour materialization.

> **AMENDMENT 2026-09-10.** The *selection/coverage* slice of this list
> (`CoverageAnalyzer` monolith, ranking-as-pool-sort, `selectBoundedWindow`,
> the mechanical synthesizer) is being redesigned **preference-first** —
> per-facet retrieval + LLM semantic classification of grounded evidence +
> set-cover composition — see
> `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`.
> The agent/core split, the evidence discipline (§4.4), Web capability split
> (§4), the Experience-vs-Operational-Stop invariant (§7), and "no privileged
> global score" are all preserved. The classification LLM never establishes
> identity or geography. **RESOLVED 2026-09-11:** the Integration Gate
> prerequisite (§16) "Phase 7 CLOSED" now means "preference-first core stable +
> acceptance green" — read that design's §7.4 before executing Phase 7 closure
> or the Gate.

The LLM may still produce narrative / presentation copy afterwards. It never
repairs or overrides a deterministic feasibility decision (PR 10 invariant:
a tour is never generated and then handed to an LLM to "fix" impossible
days; identical inputs produce a deep-equal solution).

---

## 14. Experience enrichment and traveler-facing content

Acquisition answers: **"Is this a real tourism Experience and how does it match
travel intent?"** Enrichment answers a different product question:
**"Now that Zig-Zag knows this Experience is real, what does a traveler need to
know about it?"**

The target flow is:

```text
discover
  → validate / corroborate
  → classify
  → canonicalize
  → persist
  → enrich
  → present / reuse
```

Enrichment is additive to the canonical Experience. It must not create a second
Experience just because a richer source was found.

### 14.1 Existing enrichment foundation

The repository already has important pieces that should be converged rather
than reimplemented:
- async media enrichment through Outbox;
- Wikimedia Commons media;
- Wikidata / Wikipedia narrative extracts;
- verified photo providers (including Places/SerpAPI fallback paths);
- URL + attribution / license metadata persistence rather than image binaries.

Future work should unify these existing paths into the broader Experience
enrichment lifecycle rather than introducing a parallel enrichment subsystem.

### 14.2 Traveler-facing information target

A planning-ready Experience may only need semantics and logistics, but a
traveler-facing Experience should aim to provide, when evidence exists:
- a concise explanation of what it is;
- why it is worth doing;
- what the visitor actually sees/does;
- recommended duration;
- best time / relevant seasonality;
- opening hours;
- price / ticket / reservation requirements;
- accessibility and important restrictions;
- practical tips;
- official site / booking source;
- representative real photos and gallery metadata;
- provenance for material claims.

Different claims may come from different authorities. Do not force one provider
to own the whole object.

### 14.3 Operational freshness

Evergreen descriptive enrichment and operational facts have different freshness
needs. Current hours, ticket rules, prices, closures and booking requirements
should retain source + observed-at metadata and be refreshable independently of
stable identity/history/classification.

---

## 15. Personal travel taste / learning

The target agent should not start every trip from a blank user profile.

Conceptually:

```text
CURRENT TRIP PREFERENCES
        +
LONG-TERM TRAVEL TASTE
        +
CONVERSATIONAL FEEDBACK
        ↓
PreferenceSpec / research strategy / composition
```

Long-term learning is not limited to scalar theme weights. The useful knowledge
may be conditional and relational, for example:
- prefers architecture as part of neighborhood walking rather than long
  technical visits;
- likes iconic places, but not an itinerary made entirely of "top 10" sights;
- prefers markets and local neighborhoods over malls;
- with children, avoids too many consecutive museums;
- accepts a day trip when the payoff is high;
- prefers authentic food Experiences over packaged tourist versions.

Conversation should also produce immediate trip-specific learning:
"we already saw X", "day 2 is too much walking", "I liked this kind of place",
"less touristy than that". Replanning should update the active PreferenceSpec
and, where appropriate, the longer-term taste model rather than regenerating
from scratch.

This section defines a target responsibility, not a storage schema. Personal
memory/profile persistence is post-Gate work and must get its own design before
implementation.

---

## 16. Relationship to `feat/agentic-travel-planning`

**What that branch has today** (inspected read-only at `feat/agentic-travel-planning`;
CLI-only via a `travel-planning-agent` command — **not** wired into
`POST /tours/generate-tour`):

- `TravelPlanningAgent.run()` — a bounded loop: `AgentPolicy.decide(state)` →
  `ToolRegistry.execute(tool)` → apply result, repeat under
  `maxIterations` / `maxResearchCalls` / an internal step guard.
- Tools: `load_catalog`, `analyze_coverage`, `research_gap`, `run_planner`.
- Conceptual loop:
  `load_catalog → analyze_coverage → research_gap → analyze_coverage → run_planner`.
- `AgentState` carries a full trace: `decisions`, `toolExecutions`,
  `coverageHistory`, `researchHistory`, `planningAttempts`.
- `load_catalog` reuses `DestinationResolutionService` +
  `ExperienceCatalogService.findVerifiedWithin`.
- `analyze_coverage` reuses `CoverageAnalyzer`.
- `run_planner` reuses `rankCandidatesByRelevance` +
  `PlanningCandidateNormalizerService` + `DAILY_PLANNING_SOLVER` +
  `TourPlanningFeasibilityValidator` — i.e. it **invokes** the deterministic
  core, it does not replace it.
- `research_gap`:
  - **fixture mode** (`FixtureAgentResearchProvider`) fabricates deterministic,
    ephemeral, non-persisted candidates to exercise the loop offline;
  - **live mode** (`LiveAgentResearchProvider`) goes:
    `ExperienceDiscoveryPlannerService.plan(request).queries[0]`
    → one configured `EXPERIENCE_GROUNDED_SEARCH_PROVIDER`
    → `EXPERIENCE_DISCOVERY_PROVIDER` extractor
    → `ExperienceProposalResolver.resolve()` (persisting accepted Experiences).

**What is correct and must be preserved:** the agent's live path already
routes accepted candidates through the shared **resolver / geographic
validation / dedupe / persistence**. It does not persist Experiences directly
and does not invent geography.

**What must converge:** the agent's live `research_gap` still does its own
**source planning / acquisition** with the *legacy* single-grounded-provider
web pipeline (`ExperienceDiscoveryPlannerService` + one grounded provider).
It does **not** use the canonical multi-source engine
(`ExperienceAcquisitionPlannerService` → `ExperienceAcquisitionService` →
Wikivoyage / OSM / Places / Web with shared corroboration).

> The current live `research_gap` must **not** be allowed to solidify as a
> parallel acquisition architecture.

**Target:**

```text
Agent: coverage insufficient
        ↓
research_gap / acquire_gap        (agent decides "acquire more for this gap")
        ↓
ExperienceAcquisitionPlanner      (deficit → source-capability plan)
        ↓
ExperienceAcquisitionService      (executePlan)
        ↓
Wikivoyage / OSM / Places / (future) Activities / Web
        ↓
shared corroboration
        ↓
resolver / geographic validation / dedupe
        ↓
verified catalog
        ↓
agent re-runs preference-gap analysis → decide: iterate again OR run planner
```

The agent decides **"need more acquisition/research"** and may decide that a
particular discovered source merits deeper investigation. It does **not** own
provider-specific mechanics or bypass canonical acquisition/validation.

---

## 17. Branch convergence strategy

Two branches must not evolve indefinitely as parallel engines:

- `feat/experience-domain-v2` — **Track A**
- `feat/agentic-travel-planning` — **Track B**

**Track A — Experience Domain V2**
- Phase 5 — OSM proactive acquisition (per progress: hardened / CLOSED at `f24f6f4`)
- Phase 6 — Web / exploration improvements (NOT started)
- Phase 7 — canonical live multi-source acquisition orchestration (NOT started)

**Track B — Agentic Travel Planning** (continues in parallel):
request interpreter · `AgentState` · `AgentPolicy` · `ToolRegistry` ·
coverage loop · research loop · planner invocation · decision/tool traces.

**Convergence point: AFTER Phase 7.** Do not merge earlier absent an
extraordinary need.

**Why:** Phase 7 is what defines the canonical live acquisition orchestration
(catalog → coverage → deficits → acquisition plan → structured/web →
corroboration → resolver → catalog refresh → coverage again → ranking →
planner → materialization). The agent must consume *that* API. Converging
before it exists means the agent integrates against a moving target and the
legacy `research_gap` pipeline gets entrenched.

---

## 18. Integration Gate

Convergence may begin only when **all** of the following hold.

**Experience Domain (Track A):**
- Phase 5 CLOSED
- Phase 6 CLOSED
- Phase 7 CLOSED — per the 2026-09-11 resolution, this means
  **preference-first core stable + acceptance green**
- `ExperienceAcquisitionPlanner` stable (contract not churning)
- `ExperienceAcquisitionService` stable
- resolver / geographic validation / dedupe path stable
- no direct-persistence shortcuts anywhere in acquisition
- acceptance tests green

**Agentic (Track B):**
- request interpreter stable
- `AgentPolicy` stable
- `ToolRegistry` stable
- agent state / trace stable
- deterministic-planner invocation stable
- no duplicated Experience-domain concepts living in the agent branch

---

## 19. Physical branch integration

**Target (documented, not executed now):**

Create `feat/unified-agentic-travel-planning` **from `feat/experience-domain-v2`**
(the canonical-contracts base) — **not** from `feat/agentic-travel-planning`.

Then, in order:

1. create the integration branch from `feat/experience-domain-v2`;
2. bring the agentic capabilities/commits onto that base;
3. resolve conflicts favouring Experience Domain V2 contracts;
4. adapt the agent tools to the canonical acquisition APIs;
5. remove / deprecate the old web-only `research_gap` acquisition path;
6. preserve the useful `AgentPolicy` / `AgentState` / `ToolRegistry` loop;
7. fixture tests;
8. acquisition tests;
9. real-provider characterization;
10. E2E: agent → acquisition → resolver → coverage → planner;
11. only then stop evolving the old branches independently.

These docs travel to that integration branch when it is created.

---

## 20. Tool semantics after convergence

The tool may keep the name `research_gap`, or be renamed `acquire_gap`.
Semantically, immediately after convergence it means:

```text
research_gap / acquire_gap  →  canonical multi-source Experience acquisition
```

There must **not** be two acquisition architectures living side by side —
`research_gap → legacy web` and `acquire_gap → multi-source` cannot both
exist. One acquisition architecture.

Post-Gate, the tool surface may grow to support deeper research objectives such
as source traversal/enrichment, but those capabilities must still feed the same
canonical evidence/resolution/persistence path rather than forming a second
research engine.

---

## 21. Sequencing after convergence

```text
Phase 5   OSM proactive acquisition
Phase 6   Web acquisition improvements
Phase 7   preference-first canonical live acquisition / selection core
──────────  INTEGRATION GATE  ──────────
          Experience Domain + Agentic Planner convergence
          (feat/unified-agentic-travel-planning)
──────────  post-convergence roadmap  ──────────
          Agentic Deep Research & Official-Source Enrichment
          Personal Travel Taste / learning
          Conversational iterative replanning
          Activities provider family
          Events provider family
          Operational requirements
          Operational Stop Resolver
          Wizard optional controls
```

The post-convergence items are **not** numbered as "Phase 8" yet — they are a
post-convergence roadmap until both tracks are aligned. Their relative order
may shift with product/evidence needs, but **none of them may contaminate the
preference-first Phase 7 closure work**.

---

## 22. Canonical acceptance scenario

> "Quiero 3 días en Mendoza. Me gustan bodegas chicas, poco turísticas,
> paisajes de montaña y comer bien."

Expected end-to-end behaviour after convergence:

```text
Agent interpretation
  → boutique winery (winery_scale=boutique)
  → low tourism (tourism_intensity=low)
  → mountain (nature_type=mountain)
  → food (theme/intent food)
  → 3 days
        ↓
catalog query → preference-gap analysis → deficits
        ↓
agent decides: another acquisition iteration is needed
        ↓
ExperienceAcquisitionPlanner  (deficit → source-capability plan)
        ↓
structured providers  +  web Search Retrieval / Grounded Research where appropriate
        ↓
shared corroboration
        ↓
resolver → geographic validation → dedupe
        ↓
catalog refresh → preference-gap analysis again
        ↓
agent decides: iterate again OR run the deterministic planner
        ↓
preference-first composition → GreedyDailyPlanningSolver
        ↓
TourPlanningFeasibilityValidator → materialized Tour
```

A later post-Gate deep-research acceptance scenario extends this:

```text
catalog still lacks credible boutique-winery evidence
  ↓
web search discovers an official Valle de Uco / winery source
  ↓
agent decides the source is worth deeper investigation
  ↓
map/crawl/extract relevant original pages
  ↓
discover/verify entities + current visit details
  ↓
canonicalize/persist new Experiences OR enrich existing ones
  ↓
re-run preference coverage/composition
```

Later, once operational planning exists:

```text
lunch requirement (12:30–14:30)
  → a selected gastronomic Experience may already satisfy it (§8)
  → Operational Stop Resolver only fills unsatisfied requirements
```

---

## 23. Canonical end-to-end personal-agent loop

```text
                          USER
                           │
                    conversation
                           │
                           ▼
                 ┌──────────────────┐
                 │   TRAVEL AGENT   │
                 └────────┬─────────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
   trip preferences   taste memory    current feedback
          │               │                │
          └───────────────┬────────────────┘
                          ▼
                    PreferenceSpec
                          │
                          ▼
                 inspect shared catalog
                          │
                    identify gaps
                          │
                   enough knowledge?
                     │         │
                    YES        NO
                     │         │
                     │         ▼
                     │    RESEARCH AGENT
                     │         │
                     │     structured sources
                     │     web search
                     │     grounded research
                     │     source traversal
                     │     official sites
                     │         │
                     │         ▼
                     │      evidence
                     │         │
                     │    validation
                     │    classification
                     │    canonicalization
                     │    persistence / enrichment
                     │         │
                     └─────────┘
                          │
                          ▼
                preference-first composition
                          │
                          ▼
                deterministic planner
                          │
                          ▼
                        TOUR
                          │
                          ▼
                     USER REVIEW
                          │
                  feedback / changes
                          │
                          └──────► agent loop
```

This is the product-level north star. The catalog is the durable shared memory
between research and planning; it is not the boundary of what the agent may
know or investigate.

---

## 24. Observability

The unified Bitácora / trace must be able to explain, in order:

user request → interpretation → relevant long-term taste → coverage → gaps →
agent decision → acquisition/research objective → providers/capabilities called
→ search queries → grounded-research queries/actions (where observable) → source
URLs/domains → source type/authority → source traversal steps where used →
original-content vs reduced model-output evidence → candidates → corroboration
→ rejects → accepted Experiences → enrichment changes → coverage change → why
continue / why stop → composition → planner result → operational requirements →
requirements satisfied by Experiences → inserted Operational Stops.

Secrets are always redacted. The existing generation-trace and the agent's
`decisions` / `toolExecutions` / `coverageHistory` / `researchHistory` /
`planningAttempts` are the two halves that must merge into one narrative.

---

## 25. Non-goals

This document does **not** authorize, now:

- Activities implementation
- Events implementation
- an `OperationalStop` / `TourStop` schema or type
- personal-memory schema / storage
- deep-research / crawl implementation before the Integration Gate
- new wizard screens
- any branch merge
- LLM as the authority for geographic truth
- LLM-driven dedupe

---

## 26. Final architectural invariant

**Not:**

```text
LLM → search → itinerary
```

**Not:**

```text
catalog → rank → tour
```

**Target:**

```text
personal agent reasoning
  → current preferences + learned travel taste
  → inspect persistent shared tourism knowledge
  → research the world when important knowledge is missing
  → original evidence / authoritative sources where possible
  → deterministic validation + canonical Experience knowledge
  → reusable enrichment
  → preference-first deterministic composition
  → deterministic planning / feasibility
  → traveler explanation + conversational feedback
  → learn / research / replan
```
