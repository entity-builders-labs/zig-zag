# Wikivoyage Is POI-Only By Design, and TripAdvisor Feasibility (2026-09-19)

Two verified findings from a user question ("wikivoyage no está siendo
bien usado... es un análisis que hizo otro agente, ¿me confirmás esto?
¿Y podemos incorporar TripAdvisor?"). Both checked against real code and
real external documentation, not taken on the other agent's word or
assumed from the Track B plan sketch.

## Finding 1: confirmed — Wikivoyage can structurally never produce a composite

Two independent points in the pipeline both flatten Wikivoyage content to
single-component candidates:

1. `WikivoyageAcquisitionProvider.acquire()`
   (`be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts`)
   parses only `{{see}}`/`{{do}}`/`{{eat}}` per-POI listing templates out
   of a Wikivoyage article — one `SourceObservation` per listing entry,
   `evidenceType: 'place'` (or `'tourism_activity'` for DO). It never
   reads a "Walking tours"/"Itineraries" section's own connected prose,
   even when the article has one (the parser's `WikivoyageSectionType` is
   `'SEE' | 'DO' | 'EAT' | 'OTHER'` — structurally scoped to listings, not
   narrative sections; confirmed in
   `be/src/modules/tours/interfaces/wikivoyage-api.interface.ts`).
2. `StructuredExperienceCandidateSynthesizerService.synthesizeProposals()`
   maps every `SourceObservation` to exactly one `GeoEntityHint` — "place
   -> venue/PLACE, area -> area/AREA, route -> route/ROUTE", one
   observation in, one componentHint out, always (its own comment calls
   this "Strictly mechanical mapping"). Even if step 1 somehow produced
   richer data, this step would still flatten it.

Live-checked whether Buenos Aires's own real Wikivoyage content actually
has itinerary sections worth capturing: neither the main `Buenos Aires`
article nor its `Buenos Aires/Centro` district sub-article has a
dedicated "Itineraries"/"Walking tours" section (real API query against
`en.wikivoyage.org`, `action=parse&prop=sections`) — both use the generic
Understand/Get in/Get around/See/Do/Eat/Drink/Sleep structure. So for
THIS destination specifically, the practical content being left on the
table by the design gap may be smaller than it looks; other, more
itinerary-documented destinations were not checked. The architectural
finding stands regardless: the code could not use such a section even if
one existed.

## Finding 2: TripAdvisor via SerpAPI is real and feasible on the existing paid account

Verified via real SerpAPI documentation (not assumed): SerpAPI offers
`engine=tripadvisor` (Tripadvisor Search API — search results with
`place_id`, ratings, address) and `engine=tripadvisor_reviews` (full
review text per place), both on the **same SerpAPI account already paid
for and in use** (`SerpApiGroundedSearchService` already switches
`engine` between `google` and `google_ai_mode` in the same client —
adding a third engine value is extending an existing pattern, not
building a new integration).

Why this is more promising than the current web+LLM path specifically:
TripAdvisor's Search API returns **structured JSON** (name, place_id,
rating, address), not prose — meaning it could plausibly route through
the same deterministic `StructuredExperienceCandidateSynthesizerService`
path Wikivoyage/Places already use, needing **no LLM extraction at all**
for the basic POI-level data. This directly reduces exposure to the
non-determinism the discovery LLM introduces (see the same day's
conversation about why discovery needs an LLM at all for free-text web
evidence).

Same caveat as Finding 1 applies if wired the same way: routing
TripAdvisor through the structured 1-observation-to-1-hint synthesizer
would make it another POI-only source, not a composite-generating one,
unless designed differently from the start (e.g. deliberately capturing
TripAdvisor's own "Things to do" itinerary-style content, if any, as
multi-component evidence rather than flattening it).

## Status

Both findings are analysis only — nothing implemented. Track B
(TripAdvisor, Tasks B1-B3 in
`docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md`)
remains not started. If picked up, read the real
`ExperienceGroundedSearchProvider`/`SerpApiGroundedSearchService`
interfaces first (not the plan's original sketch, written before this
session's changes), and decide explicitly whether TripAdvisor content
should flatten to single-POI observations (simple, safe, same
architecture as Wikivoyage/Places today) or route through a new
composite-aware path (higher value, more design work, would also need
composition-evidence handling this branch has deliberately not built —
see the architecture review's Recommendation #4).
