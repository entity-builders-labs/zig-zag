# Multi-source Experience acquisition — design

Status: draft, pending user review
Branch: `feat/experience-domain-v2`
Related: `docs/architecture/activity-discovery-and-tour-generation.md`, `CONTEXT.md`,
`docs/superpowers/specs/2026-09-06-tour-materialization-exposure-design.md`
(sibling sub-project, independent — see that spec's own scope)

## Context

Live testing this session (San Telmo, La Boca, Palermo, Recoleta — see session
transcript) repeatedly found that grounded web search (Tavily) + LLM
extraction (Gemini/Groq) produces thin, sometimes-wrong composite Experiences:
single-component "walks" that should have several real stops, occasional
wrong-country/wrong-city matches, and candidates lost entirely to transient
provider failures. Separately, live research into Wikivoyage/Wikidata found a
structured, curated, free data source — organized per neighborhood/city into
`Ver`/`Hacer` (See/Do) sections, often already carrying exact coordinates or a
Wikidata QID — describing the *same real places* the current pipeline was
trying to extract from free-text blogs.

The current acquisition path asks one thing (grounded web search + LLM
extraction) to do three jobs at once: discover what exists, interpret it into
tourism concepts, and prove it's real. This design separates those jobs:
structured sources (Wikivoyage, OSM, Google Places) supply facts directly;
free-text web search + LLM extraction (Tavily/SerpAPI/Gemini) remains for
genuine long-tail content structured sources don't cover. One narrow
exception to "unchanged": `TavilyGroundedSearchService.buildWalkQuery`
(added `2026-09-05`/`ff2aa70`) hardcodes a single phrase — `"10 caminatas
icónicas en {destino}"` — for *every* `walk`-or-`route_like` request
regardless of requested theme or exploration style, verified directly in
code this session. That is exactly the kind of query-construction fragility
this whole design exists to reduce reliance on; Rollout step 4 fixes it.

Verified directly against the running code (not assumed):

- `ExperienceCandidate` (`experience-discovery.interface.ts:16`) —
  `name, description?, themes, traits, intents?, suggestedDurationMinutes?,
  componentHints: GeoEntityHint[], evidenceKeys, shortReason` — deliberately
  has no structural `kind`; single-place visits and multi-component
  experiences already share this one contract.
- `GeoEntityHint` (`experience-discovery.interface.ts:2`) —
  `key, name, role: 'area'|'waypoint'|'route'|'venue', expectedKind:
  'PLACE'|'AREA'|'ROUTE', required, evidenceKeys`.
- `ExperienceDiscoveryPlan` (`experience-discovery.interface.ts:68`) is just
  `{ queries: ExperienceDiscoveryQuery[], enrichmentAllowed }` — one flat
  keyword-joined query per call, built by `ExperienceDiscoveryPlannerService`
  regardless of *which* preference is deficient.
- `CoverageDeficit` (`coverage-analysis.interface.ts:54`) already carries
  `theme?`, `trait?`, `intent?` — `CoverageAnalyzer` already measures coverage
  per individual theme/trait/intent, not just in aggregate. This is real,
  working infrastructure this design builds on, not something to invent.
- `ExperienceCatalogService.acquireNearbyAsExperiences` (verified this
  session) calls `placesApi.searchNearby()` and turns each admissible Place
  **directly** into a persisted `Experience` — bypassing candidate synthesis,
  evidence merging, and the shared resolver entirely. A generic, well-rated
  chain location (the "Starbucks problem") can reach the catalog through this
  path with nothing to stop it beyond a coarse Google-type allowlist.
- `findVerifiedWithin`'s own doc comment (verified) explicitly separates
  *quality* from *relevance*: "do not pre-rank the catalog by quality here...
  Relevance is applied later." This design keeps that same three-way
  separation (source/evidence confidence ≠ quality ≠ user relevance) and does
  not touch ranking.
- `TraitDefinition` (`schema.prisma:136`) is `{ dimension, key, label? }`,
  unique on `(dimension, key)` — a real, DB-backed, migration-free extensible
  vocabulary. Confirmed live: every caller today writes `dimension: 'general'`
  unconditionally (`experience-catalog.service.ts:349`) — the column exists
  and is unused for its real purpose.

## Goals

1. Add Wikivoyage and OSM as new, structured Experience-acquisition sources,
   alongside a refactored Google Places, so a coverage gap gets resolved from
   facts a source already curated instead of always going through free-text
   search + LLM extraction.
2. Give discovery a real, weighted, dimension-aware picture of what a user
   wants (extending `NormalizedPreferenceIntent`, not replacing it), and route
   each coverage deficit to the source(s) actually capable of filling it —
   not one generic query fired at whichever single provider is configured.
3. Let multiple sources corroborate the *same* real-world concept into one
   richer `ExperienceCandidate` instead of each source's observations
   becoming independent, competing candidates.
4. Keep every downstream stage — `ExperienceProposalResolver`, geographic
   validation, dedupe, embeddings, `CoverageAnalyzer`, ranking, the solver,
   the planner — completely untouched. This is an acquisition-layer change
   only.

## Non-goals

- No change to `ExperienceCandidate`'s shape, to `themes`/`traits`/`intents`
  as concepts, to the resolver/validator/dedupe/embedding pipeline, to
  ranking, or to the solver/planner.
- No backward compatibility requirement for the current
  `acquireNearbyAsExperiences` Place→Experience shortcut, and no data
  migration for existing catalog rows produced by it — this is pre-production
  data; if a schema or behavior change leaves existing rows inconsistent with
  the new model, they get deleted and regenerated, not migrated in place.
- No abstract, provider-agnostic "intrinsic quality score." `qualityScore`
  stays what it is today (Places' own rating where available); this design
  does not add a new composite quality metric.
- No per-source global ranking ("Wikivoyage = 0.8, Places = 0.9"). Source
  capability is dimension-specific (a source is good *at* existence,
  geography, activity-description, or currency — not generically "better" or
  "worse" than another source).
- Tavily/SerpAPI/Gemini grounded search + LLM extraction are **not removed** —
  they remain the long-tail path for destinations/concepts the structured
  sources don't cover, wired exactly as today, **except** for
  `TavilyGroundedSearchService`'s own walk/route query-construction fix
  (Rollout step 4) — a narrow, self-contained correction to that one query
  builder, not a redesign of the tier-2 path itself.

## Design

### Facet vocabulary: reuse `TraitDefinition.dimension`, don't invent one

Confirmed (Q1 of this session's brainstorm): no schema change. `dimension`
starts getting populated meaningfully — a small, hand-maintained initial set
(e.g. `theme`, `trait`, `intent`'s existing categories, plus new ones this
design's sources motivate: `winery_scale`, `tourism_intensity`,
`nature_type`, `local_character`) — instead of the current unconditional
`'general'`. New dimensions are new *rows*, never a migration. `TraitDefinition`
already being real, DB-backed data (not a closed enum) is exactly why this
works without touching the model.

### `NormalizedPreferenceIntent` gains weights, stays one source of truth

Confirmed (Q2): extend the existing interpreter output, not a parallel
`DiscoveryProfile`. Each `preferredThemes`/`preferredTraits`/`preferredIntents`
entry becomes `{ dimension, key, weight: number }` instead of a bare string
(weight defaults to 1.0 for a wizard-selected chip; the LLM interpreter
assigns a confidence weight when inferring from free text — "quiero bodegas
chicas" → `{dimension: 'winery_scale', key: 'boutique', weight: 0.9}`).
`hardExclusions`/`softConstraints`/etc. are untouched — this only adds weight
to the three preference-facet arrays.

### `SourceObservation`: a common normalized shape per raw provider result

```ts
interface SourceObservation {
  provider: 'wikivoyage' | 'osm' | 'wikidata' | 'google_places' | 'web';
  externalId?: string;   // Wikidata QID, OSM id, Google place_id, etc.
  title: string;
  description?: string;
  geo?: { latitude?: number; longitude?: number; geometry?: unknown };
  evidenceType:
    | 'tourism_activity'  // Wikivoyage Do/itinerary entry
    | 'place'             // a single named POI
    | 'route'             // OSM way/Wikivoyage-described street
    | 'area'              // OSM/Wikivoyage-described district
    | 'operator'          // a named tour operator/business
    | 'editorial';        // free-text web content, pre-LLM-extraction
  evidenceKey: string;    // same evidenceKeys scheme ExperienceCandidate already uses
}
```

**Not every provider produces `SourceObservation[]` the same way.** Structured
sources (Wikivoyage, OSM, Places) parse their own already-structured content
mechanically — no LLM involved. Wikivoyage's `{{see}}`/`{{do}}` templates
already group what constitutes one activity (verified live this session: "Ver"
entries carry `lat`/`long` inline or a `wikidata` QID directly); OSM's
`route=*`/`leisure=park`/etc. tags are already typed; Places' own `types`
field is already typed. Tavily/SerpAPI/Gemini's raw web evidence is *not*
pre-structured — for that one provider family, the existing LLM extraction
step (`gemini-discovery.provider.ts`/`groq-discovery.provider.ts`) is
unchanged; its output is treated as already being `ExperienceCandidate[]`
directly, same as today, not routed through `SourceObservation` first.

### Candidate synthesis: per-source mechanical mapping, then one shared corroboration merge

1. Each structured source's own adapter turns its `SourceObservation[]` into
   `ExperienceCandidate[]` proposals mechanically (a Wikivoyage `{{do}}` entry
   maps directly to one candidate with `componentHints` built from whatever
   sub-places it names; an OSM/Places observation usually becomes a
   single-`componentHints` candidate, or pure geographic corroboration for an
   existing one — see below).
2. **Corroboration merge** (new, shared, deterministic): candidates from
   *different* providers describing the same real concept — matched by the
   same proximity+name reconciliation already built this session
   (`ExperienceCatalogService.upsertGeoEntity`'s cross-provider GeoEntity
   reconciliation, `filterOverlappingExperienceCandidates`'s pool-level
   overlap check) — merge into one candidate, unioning `evidenceKeys` from
   every contributing source rather than producing separate, competing
   candidates. Same discipline `decideExperienceDedupe` already applies
   downstream (SAME/NEW/AMBIGUOUS, never force a merge on a weak signal):
   below the proximity+name threshold, candidates stay separate rather than
   risk a false-positive merge.
3. **Google Places refactor**: `acquireNearbyAsExperiences`'s direct
   Place→Experience path is replaced — a Place result becomes a
   `SourceObservation` (`evidenceType: 'place'`) like any other source, which
   either corroborates an existing candidate (a winery Wikivoyage/OSM already
   named) or, on its own, becomes a simple single-component candidate exactly
   as a plain visit-Experience does today — now flowing through the same
   candidate → resolver → validation → dedupe path everything else does,
   rather than a parallel shortcut. No behavior-preservation requirement for
   the old shortcut (Non-goals) — this is a clean replacement.

### `ExperienceAcquisitionPlan`: gap-routed source plans, not one generic query

Replaces `ExperienceDiscoveryPlan`:

```ts
interface ExperienceAcquisitionPlan {
  destination: ExperienceDiscoveryScope;
  deficits: CoverageDeficit[];        // unchanged shape, already has theme/trait/intent
  sourcePlans: SourcePlan[];          // only providers actually relevant to these deficits
  breadth: ExperienceDiscoveryBreadth; // unchanged
}

interface SourcePlan {
  provider: SourceObservation['provider'];
  // Provider-specific hints, not a generic query string:
  wikivoyage?: { sections: ('SEE' | 'DO' | 'EAT')[] };
  osm?: { concepts: string[] };            // e.g. 'winery', 'cycleway', 'viewpoint'
  places?: { searchTypes: string[] };      // Google Places type taxonomy
  web?: { query: string };                 // today's flat keyword/phrase query, unchanged mechanism
}
```

**Deficit → source routing is an explicit, hand-maintained table keyed by
`dimension`** (confirmed, Q3 of this session's brainstorm) — not an inferred
runtime rule, matching the existing `EXPERIENCE_FORMAT_ACTIVITY_KIND`
centralized-mapping precedent. Each `TraitDefinition.dimension` the initial
vocabulary defines gets an entry naming which source(s) to consult and in
what shape (e.g. `nature_type` → `{wikivoyage: {sections:['DO']}, osm:
{concepts:['trail','viewpoint','park']}}`; `winery_scale` → `{web: {query:
'{value} wineries {destination}'}, places: {searchTypes:['winery']}}`).
**This table is deliberately small and reviewed by hand when a new dimension
is added** — it is the one piece of this design that encodes a real,
hard-won judgment call (which sources can actually answer which kind of
question) rather than something safely inferable from data.

This directly reuses `CoverageAnalyzer`'s existing per-dimension deficit
output — no change to `CoverageAnalyzer` itself, only to what
`ExperienceDiscoveryPlannerService` (renamed conceptually to an acquisition
planner) does with a `CoverageDeficit[]` it already receives.

### What stays completely untouched

`ExperienceProposalResolver`, `CompositeGeographicValidationService`, dedupe
(`experience-dedupe.util.ts`), embeddings, `CoverageAnalyzer`,
`candidate-ranking.util.ts`, `candidate-window-selection.util.ts`,
`GreedyDailyPlanningSolver`, the planner. Every `ExperienceCandidate` this
acquisition layer produces — regardless of which source(s) contributed —
enters the exact same resolution/validation/dedupe/persistence path already
in production. `qualityScore`/user-preference ranking stay two separate
concepts from source/evidence confidence, per `findVerifiedWithin`'s own
existing separation.

## Data flow

```
WIZARD
   │
   ▼
PreferenceInterpreter → NormalizedPreferenceIntent (themes/traits/intents, now weighted)
   │
   ▼
LOCAL CATALOG (semantic + geographic match) — unchanged
   │
   ▼
CoverageAnalyzer — unchanged, already per-dimension
   │
   ├── sufficient ──────────────────────────────────────┐
   │                                                     │
   └── insufficient                                      │
        │                                                │
        ▼                                                │
   ExperienceAcquisitionPlan (sourcePlans per deficit)    │
        │                                                │
        ▼                                                │
   ┌─────────┬─────┬────────┬─────────────┐              │
   │Wikivoyage│ OSM │ Places │ Web (Tavily/│              │
   │         │     │        │ SerpAPI/    │              │
   │         │     │        │ Gemini)     │              │
   └─────────┴─────┴────┬───┴─────────────┘              │
                        ▼                                │
              SourceObservation[]                        │
             (web/Gemini path already                    │
              produces ExperienceCandidate                │
              directly, unchanged)                        │
                        │                                │
                        ▼                                │
              per-source candidate synthesis              │
                        │                                │
                        ▼                                │
              corroboration merge (shared, deterministic) │
                        │                                │
                        ▼                                │
              ExperienceCandidate[] ─────────────────────┤
                        │                                │
                        ▼                                ▼
          ExperienceProposalResolver → GeographicValidation → Dedupe
                        │
                        ▼
                Experience (persisted) → embeddings → catalog re-query
                        │
                        ▼
                CoverageAnalyzer (again)
                        │
                        ▼
              preference ranking → solver → PLANNER → TOUR
```

## Error handling

- Any single source failing (Wikivoyage no article for this destination,
  Overpass down, Places over quota) degrades to `{status:'failed', value:
  [], failureReason}` for that provider only — matches the existing
  `OsmLookupResult`/`TavilyExtractResult` pattern already in the codebase.
  Other sources' observations are unaffected; acquisition proceeds with
  whatever it has.
- A deficit with zero observations from every applicable source is not a
  hard failure — falls through to `CoverageAnalyzer`'s existing gate (only a
  genuinely empty/unusable pool fails generation, per `CONTEXT.md`'s
  documented rule).
- Corroboration-merge ambiguity (proximity+name match below a confident
  threshold) keeps candidates separate rather than force-merging — same
  discipline as `decideExperienceDedupe`'s `AMBIGUOUS` outcome.
- No behavior-preservation path for the current `acquireNearbyAsExperiences`
  shortcut (Non-goals) — its replacement is a clean cut, not a
  parallel-tracked migration.

## Testing

- Unit tests for the corroboration-merge function (same style as this
  session's `candidate-overlap-filter.util.spec.ts`): two observations from
  different providers within the reconciliation radius+name match merge into
  one candidate with unioned `evidenceKeys`; outside that threshold, or with
  a name mismatch, they stay separate.
- Unit tests for the deficit→`sourcePlans` routing table: given a
  `CoverageDeficit` for a known dimension, the correct source(s)/shape are
  produced; an unknown dimension degrades to the existing web-search path
  rather than producing an empty plan.
- Live verification (this session's established discipline — never trust a
  new external-provider integration without a real call) for the Wikivoyage
  adapter against real articles already characterized this session (San
  Telmo, La Boca, Recoleta, Palermo) before relying on it in production.
- End-to-end: a destination with real Wikivoyage coverage (e.g. San Telmo)
  produces a richer composite Experience than the current web-search-only
  path did for the same request — the concrete outcome this design exists to
  achieve, checked against a real generation, not just unit-level.

## Rollout

Three steps, in order of value-to-risk:

1. **Wikivoyage adapter** — highest value (structured, free, precise
   coordinates/QIDs, already characterized live this session), lowest risk
   (purely additive, nothing existing depends on it).
2. **Google Places refactor** — replaces the direct Place→Experience
   shortcut with the shared candidate/synthesis/resolver path. Higher risk
   only in the sense that it changes an existing code path (not in the sense
   of needing careful data migration — none is required, per Non-goals).
3. **OSM as a proactive gap-filling source** — OSM is already used
   extensively for geographic resolution; this step is about querying it
   *before* a candidate exists (trails/viewpoints/parks/wineries near a
   destination) rather than only to resolve an already-proposed hint. Lowest
   priority of the three — smallest incremental value given OSM's existing
   role in the pipeline.
4. **Fix `TavilyGroundedSearchService.buildWalkQuery`'s theme/style
   blindness** — small, self-contained, and independent of steps 1-3 (could
   land first or last, no ordering dependency). Three concrete gaps found
   live this session, all in the same function
   (`tavily-grounded-search.service.ts:217-227`):
   - `isWalkOrRouteRequest` buckets `walk` and `route_like` together and
     `buildWalkQuery` emits the identical phrase for both — a themed route
     (wine route, architecture route, mural route) gets the same generic
     `"10 caminatas icónicas en {destino}"` as a plain walk request, with no
     way for the route's actual theme to shape the query.
   - `request.requestedThemes` is never read in this function — a
     history-themed and a food-themed walk request for the same city
     produce byte-identical Tavily queries.
   - No `explorationStyle` (iconic vs. local/off-the-beaten-path) input
     exists in this function at all; it always says "icónicas" ("iconic").
     Note: this session's Wikivoyage research (step 1) found no reliable
     *structural* signal for `explorationStyle` either — so this fix is
     necessarily query-phrasing-level (e.g. swapping "icónicas" for
     "auténticas"/"locales" style language when requested), not a deeper
     data-driven distinction.
   Scope: adapt `buildWalkQuery` to incorporate the request's theme(s) and,
   where present, exploration style into the generated phrase — still a
   single Tavily query per request, still free-text, no new provider, no
   schema change. Out of scope: making `route_like` structurally distinct
   from `walk` anywhere else in the pipeline (`intents` stay soft facets,
   per this codebase's existing invariant — CLAUDE.md/CONTEXT.md).

Tavily/SerpAPI/Gemini remain wired exactly as today otherwise — steps 1-3
don't touch them, and step 4 is scoped to this one query-builder function,
not a redesign of the tier-2 path itself.

## Open questions

1. **Initial `TraitDefinition.dimension` vocabulary** — this design proposes
   reusing existing themes/traits/intents categories plus new ones motivated
   by session research (`winery_scale`, `tourism_intensity`, `nature_type`,
   `local_character`); the exact starting list should be finalized during
   implementation planning, not frozen here — it is explicitly meant to grow
   by inserting rows, not by re-opening this spec.
2. **Wikivoyage/OSM/Places → dimension routing table's exact initial
   entries** — same nature as (1): a real, hand-maintained table that starts
   small and grows with evidence, not something to fully enumerate before
   any implementation begins.
3. **Wikivoyage rate limits / caching policy** — not investigated this
   session beyond confirming the API works and requires a descriptive
   User-Agent header (matches this session's Overpass/Nominatim experience);
   should get the same "verify live, don't assume" treatment during
   implementation as every other external provider in this codebase.
