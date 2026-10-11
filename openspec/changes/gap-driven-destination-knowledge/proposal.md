# Proposal

## Why

Tour generation currently depends on an acquisition pipeline (semantic web
search → LLM extraction of Experiences from prose → geographic validation)
that has not produced a trustworthy catalog: every piece of tourism meaning
has to be extracted as a source-declared Experience, and generic deficits
re-trigger generic crawling. The catalog contents produced by that pipeline
are disposable; the domain and infrastructure (GeoEntity, Experience, Tour,
planner, routing, provenance concepts) are worth keeping.

We want the catalog to become reusable **destination knowledge** that is
consulted first on every request, with bounded agentic research running only
for explicit, typed knowledge gaps, so that the system becomes progressively
less dependent on live research as a destination matures. A request such as
"Buenos Aires, 4 days, history, food, walking" must be able to discover that
San Telmo matters, that Mercado de San Telmo and Plaza Dorrego are relevant,
and that a bounded segment of Calle Defensa is a grounded tourist walking
corridor — without the user naming any of them and without a hard-coded list
of websites.

## What Changes

- Define the catalog as four layers with single write authorities:
  L1 geography (provider identity), L2 grounded tourism assertions with typed
  evidence captures, L3 research ledger (including negative outcomes),
  L4 reusable Experiences derived from L1/L2.
- Define a deterministic **readiness evaluation** that compares a request with
  the catalog snapshot and returns READY or typed, canonically keyed
  knowledge gaps. It is the only gate on research.
- Define a **bounded research agent** that, for one gap, discovers sources
  dynamically and proposes claims, but has no write authority and no
  hard-coded source list.
- Define **grounding** as the sole authority that turns proposed claims into
  L2 assertions: it independently verifies the properties each claim type
  requires (evidence re-verifiability, identity through geographic
  resolvers, geometric consistency, authority predicates). The agent's own
  authority classification is a hint, never truth.
- Define the **stable identity rule** for reusable derived Experiences
  (key = unit kind + constitutive anchors; content derived; existence
  justified by L2), and the boundary that keeps request-specific selection,
  stop trimming, day assignment and ordering exclusively in
  Tour / TourExperience.
- Amend `docs/architecture/activity-discovery-and-tour-generation.md` with the
  target contract and mark the source-extraction rules it supersedes
  (source-backed standalone Experiences, source-member admission, SAME source
  reconciliation, hard-coded deficit source routing, atom labelling) as
  superseded-pending-cutover. **BREAKING (architecture contract)**: the
  superseded rules stop being canonical for new work.
- Build an isolated, non-production **spike** under `spikes/` that exercises
  the whole contract end-to-end for Buenos Aires with real search/fetch and
  geographic providers, in-memory L1–L4 stores, the existing planner solver,
  and Tour-snapshot-shaped output; record evidence and a verdict.
- Rename the track's planned first change from `synthetic-experience-generation`
  to this change in the track progress/navigation documents.

Out of scope for this change: Prisma schema changes, production wiring,
deletion of the old acquisition pipeline, meal-slot planning, synthetic
narrative/media. These follow in a production cutover change gated on the
spike verdict.

## Capabilities

### New Capabilities

- `destination-knowledge-catalog`: the layered catalog (geography, grounded
  assertions, research ledger, reusable Experiences), write authorities,
  evidence capture/provenance, idempotent knowledge identity, catalog-first
  reads.
- `knowledge-readiness`: deterministic evaluation of a request against a
  catalog snapshot, typed knowledge gaps with canonical keys, ledger-aware
  suppression of repeated research, recursive gap discovery.
- `gap-research`: bounded, write-less research for one typed gap that
  discovers sources dynamically and returns proposed claims with captured
  evidence.
- `knowledge-grounding`: authorization of proposed claims into L2 assertions
  through claim-type predicates, re-verifiable evidence, geographic identity
  resolution and typed rejection.
- `reusable-experience-composition`: request-independent derivation of L4
  Experiences with stable identity, admission/justification, content
  revisions and archival.
- `tour-composition`: request-specific selection over reusable Experiences
  and planning, persisted only in the Tour snapshot.

### Modified Capabilities

None (no OpenSpec capability specs exist yet in this repository).

## Impact

- Canonical docs: `docs/architecture/activity-discovery-and-tour-generation.md`
  (new destination-knowledge section; superseded markers on existing
  sections); track progress and `docs/superpowers/README.md` pointers.
- New spike directory under `spikes/` (TypeScript harness, recorded provider
  I/O, evidence README). It imports existing backend code read-only:
  `GreedyDailyPlanningSolver` and the travel-estimate provider, the
  preference interpretation output contract, OSM/Nominatim/Places adapters,
  targeted route resolution, the identity verifier, and existing web
  search/fetch services (Serper/Tavily/Cloudflare).
- No change to production code paths, Prisma schema, APIs, or the frontend.
- External providers: live web search (Serper; SerpApi must not be used),
  page fetch, OSM/Nominatim/Overpass; Google Places only within its small
  quota.
