# Agentic Deep Research & Experience Enrichment — Post-Gate Roadmap

Status: **canonical post-convergence roadmap; docs-only. Not authorization to implement.**
Branch of record: `feat/experience-domain-v2`; this document travels to
`feat/unified-agentic-travel-planning` when the Integration Gate is crossed.
Written: 2026-09-11.

Related:
- `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`
- `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`

> This work starts **after** preference-first Phase 7 closure and the
> Experience-Domain / Agentic Integration Gate. It must not expand the current
> preference-first implementation scope.

---

## 1. Product north star

Zig-Zag is a **personal travel research agent**, not a catalog recommender.

The verified Experience catalog is the system's persistent, shared tourism
knowledge base. It should make later trips faster and cheaper, but it must not
limit what the agent can discover. When the existing catalog is insufficient to
build the best trip for the traveler, the agent should be able to investigate
the real world autonomously, follow promising sources, deepen evidence, create
or enrich canonical Experiences, and then return to deterministic composition
and planning.

Target loop:

```text
traveler request + current-trip preferences + learned travel taste
        ↓
agent understands intent / ambiguity
        ↓
inspect catalog and measured preference gaps
        ↓
knowledge sufficient?
   ┌────┴────┐
  yes       no
   │         │
   │         ▼
   │    autonomous research
   │         ↓
   │    structured sources + web search + grounded research
   │         ↓
   │    discover promising original / official sources
   │         ↓
   │    map / crawl / extract / follow evidence
   │         ↓
   │    canonical validation / classification / persistence / enrichment
   │         ↓
   └─────────┘
        ↓
preference-first deterministic composition
        ↓
deterministic daily planner + feasibility
        ↓
tour explanation / user feedback
        ↓
learn / research again / replan
```

---

## 2. Non-negotiable boundaries

1. The agent may decide **what needs more research** and **which discovered
   source appears worth deeper investigation**.
2. The agent does not establish geographic truth, identity, dedupe, persistence
   or feasibility.
3. Every discovered entity/fact that may affect a Tour enters the same canonical
   evidence → corroboration → resolver → geographic validation → dedupe →
   classification → persistence path.
4. LLM output is not automatically factual evidence. Prefer original source
   content; model synthesis is reduced-quality evidence when originals cannot
   be recovered.
5. The agent must not create a second acquisition architecture beside the
   canonical Experience acquisition engine.
6. The deterministic planner remains the final authority for composition,
   schedule and hard constraints.
7. The Experience catalog remains cumulative product data: valid acquired or
   enriched knowledge is reusable for future users/tours even when not selected
   for the current Tour.

---

## 3. Source vs retrieval-tool distinction

The architecture must distinguish **where information came from** from **how it
was retrieved**.

Retrieval capabilities/tools:
- Search Retrieval (Tavily / SerpAPI / future engines)
- Extract
- Map
- Crawl
- grounded multi-query research (Gemini / OpenAI / future providers)

Information sources:
- official destination / tourism-board sites
- official attraction / museum / park / winery / venue sites
- Wikivoyage
- OSM
- Places
- Wikidata / Wikipedia
- local editorial sources
- specialist travel / food / outdoor sources
- community sources where appropriate
- future Activities / Events providers

Example provenance:

```text
retrievalProvider: tavily
sourceType: OFFICIAL_DESTINATION_SITE
sourceDomain: turismo.buenosaires.gob.ar
sourceUrl: https://...
```

Do not collapse this to `source = tavily`.

Authority is claim-specific:
- coordinates / physical existence → OSM / Places / official geo source
- current opening hours / tickets / price / restrictions → official entity site
- historical context → official cultural source / Wikidata / Wikipedia
- popularity → Places / review evidence
- local character / hidden-gem signal → specialist editorial / community
- media → Commons / Places / official or licensed media with provenance

---

## 4. Deep research capability

Search is an entry point, not necessarily the end of research.

The agent must eventually be able to express an objective such as:

> "The catalog has weak evidence for boutique, low-tourism wineries in Valle de
> Uco. This official destination site appears promising; investigate it further."

Canonical follow-source flow:

```text
search / grounded research
        ↓
discover promising URL/domain
        ↓
classify source role / authority
        ↓
map site or inspect relevant links
        ↓
crawl only relevant sections
        ↓
extract original content
        ↓
discover entities / claims / operational details
        ↓
canonical Experience pipeline
```

The agent chooses the research objective and whether the source is worth more
attention. The research/core layer owns provider mechanics, crawl limits,
budgets, retries, robots/provider policies, evidence normalization and
acceptance.

---

## 5. Official-source research

Official sources are especially important after an entity has already been
grounded.

Example:

```text
Catena Zapata already grounded as a real entity
        ↓
find official site
        ↓
visit / tours / reservations / restaurant / accessibility / hours pages
        ↓
extract current operational facts
        ↓
enrich the existing canonical Experience
```

Target official-source facts, when available:
- visit formats / what the traveler actually does
- opening hours
- booking / reservation requirements
- ticket / visit price
- expected duration
- age / child restrictions
- accessibility
- seasonality / closures
- official booking URL
- practical arrival instructions
- official media references where usable

Finding richer official evidence must normally **enrich**, not duplicate, an
existing Experience.

---

## 6. Experience enrichment convergence

The repository already contains useful enrichment infrastructure; do not build a
parallel subsystem.

Existing foundation includes:
- async media enrichment through Outbox
- Wikimedia Commons media
- Wikidata / Wikipedia narrative extracts
- photo-provider fallbacks including Places/SerpAPI paths
- URL + attribution/license metadata persistence (no image binaries)

Post-Gate work should converge these paths into one general Experience
enrichment lifecycle:

```text
canonical Experience persisted
        ↓
identify missing enrichment dimensions
        ↓
Wikidata / Wikipedia / Commons / Places / official sources / other trusted evidence
        ↓
merge evidence and traveler-facing fields
        ↓
refresh presentation without changing Experience identity
```

Enrichment and acquisition are related but not identical:
- acquisition asks whether a real Experience exists and belongs in the catalog;
- enrichment asks what a traveler needs to know about an already-canonical
  Experience.

---

## 7. Traveler-facing Experience content

A planning-ready Experience can be semantically correct and still be poor
product content.

Target traveler-facing content, when grounded evidence exists:
- concise description
- why it is worth doing
- what the visitor actually sees / does
- recommended duration
- best time / seasonality
- opening hours
- price / tickets / reservations
- accessibility / restrictions
- practical tips
- official site / booking link
- real hero/gallery media
- source/provenance for material claims

Stable descriptive knowledge and volatile operational facts must have different
freshness handling. Current hours, closures, prices and booking rules should be
refreshable independently from identity/history/classification.

---

## 8. Personal travel taste and learning

The target agent must not start every trip from a blank profile.

Inputs to future trip reasoning:

```text
current-trip preferences
        +
long-term travel taste
        +
conversation feedback
        ↓
PreferenceSpec + research strategy + composition
```

Long-term taste may encode relational patterns, not just scalar theme weights:
- architecture is preferred as part of neighborhood walking rather than long
  technical visits
- iconic sights are welcome, but not an all-"top 10" itinerary
- markets / neighborhoods outrank malls
- with children, avoid too many consecutive museums
- day trips are acceptable when payoff is high
- authentic food Experiences outrank tourist-packaged equivalents

Immediate conversational feedback also changes the active trip:
- "we already saw X"
- "too much walking on day 2"
- "I liked this kind of place"
- "less touristy"

Personal-memory persistence/schema is a separate future design. This roadmap
only establishes the product responsibility and integration points.

---

## 9. Proposed post-Gate increments

### Increment A — Research capability model

Define provider-neutral contracts for:
- search
- extract
- map
- crawl
- grounded research
- source provenance / source type
- bounded research budgets

No new Experience semantics in this increment.

### Increment B — Official-source discovery and traversal

Add:
- official destination-site discovery
- official entity-site discovery
- source authority classification
- map/crawl/extract bounded traversal
- original-content evidence capture

Acceptance example: a grounded winery/museum can recover its official visitor
information without manual domain configuration.

### Increment C — Enrichment convergence

Unify the existing async media/text enrichment paths with new official-source
enrichment around the same canonical Experience.

Acceptance example: one Experience can aggregate Commons media, Wikidata /
Wikipedia narrative, Places quality/location signals and official current visit
facts without duplication.

### Increment D — Agent research-loop integration

Extend the unified agent so it can:
- decide when catalog knowledge is insufficient;
- request deeper investigation of a promising source;
- observe measurable catalog/coverage improvement;
- stop on sufficiency, no-progress or budget exhaustion;
- explain why it kept researching or stopped.

The agent still does not call provider-specific HTTP APIs directly.

### Increment E — Traveler-facing Experience presentation

Expose enriched, provenance-backed information and real photos in the Tour UI.
Planning semantics and presentation copy remain separated.

### Increment F — Personal taste feedback loop

Design and implement long-term travel taste only after conversational feedback
and the unified agent loop are stable enough to produce meaningful signals.

---

## 10. Acceptance scenarios

### Scenario 1 — cold destination / official source

User requests a multi-day trip with specific qualitative preferences. Catalog
coverage is thin. Agent researches, discovers an official destination site,
traverses relevant pages, grounds new entities, persists valid Experiences,
reruns preference coverage and builds a materially better Tour.

### Scenario 2 — existing Experience / richer official facts

Experience already exists in catalog but has weak operational information.
Agent/research layer discovers the official entity site and enriches hours,
booking, price, restrictions and visit details without creating a duplicate.

### Scenario 3 — research source provenance

A fact discovered via Tavily but sourced from an official site is stored/traced
as official-site evidence with Tavily recorded only as retrieval transport.

### Scenario 4 — conversation causes research

User says: "Eso es demasiado turístico; quiero algo más local." The active
preference/taste signal changes. Existing catalog is insufficient, so the agent
performs targeted additional research rather than simply reshuffling the old
candidate set.

### Scenario 5 — warm catalog reuse

A later user asks for a similar destination. Experiences discovered and enriched
by earlier research are reused directly; no provider call is made unless new
preferences, freshness needs or coverage gaps justify it.

---

## 11. Observability requirements

Bitácora must eventually explain:

```text
user request
→ interpreted preferences + relevant learned taste
→ catalog coverage / gaps
→ why research continued
→ research objective
→ retrieval capability/provider
→ source URL/domain + source type
→ map/crawl/extract steps where applicable
→ original evidence vs reduced model synthesis
→ candidate / enrichment decisions
→ corroboration / rejects / accepted Experience changes
→ catalog/coverage delta
→ why research stopped
→ composition / planner result
→ user feedback / replanning delta
```

Secrets remain redacted.

---

## 12. Explicit non-goals for the current preference-first refactor

Do **not** implement any of the following merely because this roadmap exists:
- Tavily Map/Crawl integration
- official-site discovery
- deep autonomous research
- personal taste persistence
- traveler-facing enrichment schema redesign
- Activities / Events / Operational Stops
- conversational replanning

The current job remains: close preference-first Phase 7, pass acceptance, run
Argentina live smoke, cross the Integration Gate, and only then execute this
roadmap on the unified branch.


## 10. 2026-09-22 alignment — targeted component repair before broad deep research

The RW1 forensic rerun provides a concrete bridge into this roadmap.

A source-backed Experience may now expose a narrow research deficit such as:

```text
Experience: City Tour Through San Telmo
resolved components: 4/6
open questions:
- identity of Solar de French
- identity of Nuestra Señora de Belén
```

The future research agent should prefer these bounded deficits over restarting
generic destination discovery.

The component-resolution amendment also sharpens the boundary in §6:

- verification establishes real identity/geography/composition;
- enrichment makes verified knowledge richer and more useful to a traveler;
- the same provider may contribute to both, but one role must not be silently
  substituted for the other;
- missing enrichment never invalidates otherwise sufficient geographic
  identity;
- partial research state is not planner-eligible until canonical verification
  policy admits it.

See
`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`.
