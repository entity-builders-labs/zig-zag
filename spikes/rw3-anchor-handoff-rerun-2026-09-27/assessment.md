# RW3 anchor-handoff rerun — assessment (Serper + Cloudflare, post `d6149363`)

Code under test: commit `d6149363` (`fix(tours): preserve destination and
anchor semantics`) — same-branch destination screening before ranking,
audit-free source-plan fingerprints, typed `anchorNames` handed from
`SourcePlan.web` to `ExperienceDiscoveryRequest`. Trace-first: every run fact
comes from `cold/generation-trace.json` unless labelled; the derived summary
is `cold/analysis.json`. Earlier RW3 evidence
(`rw3-caminito-canonical-route-2026-09-27/`, `rw3-rerun-serper-cloudflare-2026-09-27/`)
is left untouched.

## Gate outcome: **C — RW3 BLOCKED → RW4 NOT AUTHORIZED**

Anchor resolution PASS, structured anchor handoff PASS, and the extractor now
emits a **Caminito-related**, source-supported Experience (so this is *not*
outcome B). The run is blocked by a different downstream semantic boundary:
one source-explicit component is written with a typo in the source itself
(`La Bambonera` for La Bombonera), cannot be resolved, and the canonical
source-composition rule rejects the composite
(`INCOMPLETE_SOURCE_COMPOSITION`) before geographic validation. Route-geometry
membership, regional coherence and planning were therefore still **not
exercised**.

| checkpoint | result |
| --- | --- |
| 1. interpretation | PASS — `Caminito` `named_path`/`must`, `intent:walk` |
| 2. anchor resolution (+ same-branch audit) | **PASS** — route `osm:way:144844726` SELECTED; 5 homonyms rejected individually |
| 3. routing | PASS — `AREA_ROUTE_WALK=1`, `anchorMode: canonical`, `SourcePlan.web.anchorNames=["Caminito"]` |
| 4. search → extractor handoff | **PASS** — `extractor.requestAnchorNames=["Caminito"]` |
| 5. Serper evidence | 10 items, overwhelmingly Caminito/La Boca-specific |
| 6. Cloudflare extraction | 1 Caminito-related composite, 3/3 components SUPPORTED |
| 7. geographic validation / route membership | **not reached** (rejected at entity resolution) |
| 8. anti-fabrication | PASS — composition came from one source listing its stops; nothing added |
| 9. planning | not reached (generation failed closed) |

## 0. Run

- Provider preflight (`cold/provider-preflight.json`, resolved from the
  compiled runtime selection with the run's exact env, before any live call):
  `groundedSearchProvider=serper`, `discoveryExtractorProvider=cloudflare`,
  `discoveryExtractorModel=@cf/qwen/qwen3.8-27b`, timeout 60000,
  classification `gemini` / `gemini-3.5-flash-lite` (repo `.env`, unchanged),
  `AI_PROVIDER=groq` (preference interpretation). No SerpAPI, no Tavily.
- COLD on fresh `zigzag_spike_rw3_anchor_handoff` (`db-before.json`: 0 rows of
  every knowledge table). Tour `failed` after **40.5 s**:
  `Coverage insuficiente … Preference facet [intent:walk] has no strong
  catalog match yet.`
- Mobility (experimental control only, not product defaults):
  `50000 / 20000` m. Never reached planning.
- Outbound requests: serper 1, cloudflare 1, groq 1, nominatim 4, overpass 3,
  wikivoyage 2, wikidata 2, wikipedia 1, geoapify geocode 1.
- WARM: **not run** — no relevant Experience was persisted.

## 1. Interpretation (trace)

`anchoredPlaces = [{rawName: Caminito, usage: named_path, priority: must}]`;
spec facet `intent:walk` (wizard). `semanticQuery = "walk caminito landmarks"`
(the Groq interpreter's wording differs from earlier runs; semantics are the
same).

## 2. Anchor resolution (trace — `anchor_geo_resolution`, status PASS)

Resolved: `route` `Caminito`, `openstreetmap` `osm:way:144844726`,
`MultiLineString` (1 line, 9 coordinates), destination
`osm:relation:1224652` (Buenos Aires).

`candidateFacts` (8 rows — multiple rows per branch now allowed):

| branch | candidate | eligibility / decision | compatibility |
| --- | --- | --- | --- |
| area | — | NO_CANDIDATE (`NO_CONFIDENT_AREA_MATCH`) | — |
| route | Caminito `osm:way:144844726` | ELIGIBLE / **SELECTED** | COMPATIBLE / WITHIN_DESTINATION_BOUNDARY |
| place | Caminito `osm:way:269972048` (Ezeiza) | REJECTED_DESTINATION_INCOMPATIBLE | INCOMPATIBLE / OUTSIDE |
| place | Caminito `osm:way:190947717` (Olta, La Rioja) | REJECTED_DESTINATION_INCOMPATIBLE | INCOMPATIBLE / OUTSIDE |
| place | Caminito `osm:way:46859224` (Chilecito, La Rioja) | REJECTED_DESTINATION_INCOMPATIBLE | INCOMPATIBLE / OUTSIDE |
| place | Caminito `osm:way:205650907` (Merlo) | REJECTED_DESTINATION_INCOMPATIBLE | INCOMPATIBLE / OUTSIDE |
| place | Caminito `osm:way:191914894` (Plaza Huincul) | REJECTED_DESTINATION_INCOMPATIBLE | INCOMPATIBLE / OUTSIDE |

All 5 Nominatim results were same-name streets outside the destination; the
place branch screened every one before ranking, none was selectable, none
counted toward multiplicity, and each is individually auditable (earlier runs
showed only the provider's first homonym). Rejected homonyms are audit
evidence only: `db-after.json` contains none of them.

Observation (not a defect of this task): Nominatim's `limit=5` country-wide
search never returned the La Boca way itself, so the place branch could not
contribute a compatible Caminito; the route branch (destination-scoped
Overpass) did.

## 3. Routing (trace)

`AREA_ROUTE_WALK=1; GENERIC=0` with `anchorMode: canonical`, `intentKey:
walk` on both passes. `SourcePlan.web.anchorNames = ["Caminito"]`;
`web.query = "Buenos Aires Caminito walking tours walks walk caminito
landmarks"`.

## 4. Search → extractor handoff (trace — new diagnostic)

```text
SourcePlan.web.anchorNames              = ["Caminito"]
extractor.requestAnchorNames (Bitácora) = ["Caminito"]   (ExperienceDiscoveryRequest.anchorNames)
extractor = cloudflare @cf/qwen/qwen3.8-27b
```

The typed anchor now survives the grounded-search → extraction boundary that
previously dropped it.

## 5. Serper evidence (trace, 10 items, `gl=ar`, grounding `applied`)

| class | keys |
| --- | --- |
| Caminito-specific | ev-1 *Caminito Buenos Aires* (buenosairesfreewalks), ev-4 *Caminito Tourist Assistance Center* (city gov), ev-5 *Private Caminito & La Boca Walking Tour* (Viator), ev-6 *Walking Tour \| Caminito, La Boca* (YouTube), ev-7 *La Boca Barrio and Caminito Street* (GPSmyCity), ev-8 *Caminito* (US News), ev-9 *What to do in Caminito* (bafreetour) |
| La Boca-specific | ev-10 *La Boca Tour* |
| generic Buenos Aires walks | ev-2 *One Day in Buenos Aires: A Self-Guided Walking Tour*, ev-3 *Explore the Best Walks in Buenos Aires* |
| unrelated route evidence | none |

`ev-5` snippet (verbatim): *"A private walking tour of the La Boca
neighborhood · Visit Caminito, Benito Quinquela Martin Museum, and La
Bambonera stadium · …"* — a real, source-described walking Experience whose
stops are listed by the source itself (note the source's own misspelling).

## 6. Cloudflare extraction (trace)

1 extracted, 1 admitted (`MATCHING_EVIDENCE_REQUIREMENT` /
`MULTI_COMPONENT_EXPERIENCE`), 0 validation errors.

- **Private Caminito & La Boca Walking Tour** — themes `culture, art,
  architecture`; intents `walk, visit`; `evidenceKeys [ev-5]`;
  `orderedByEvidence: false` (correct: the source lists stops, not a sequence).
- componentHints (all `waypoint`, `ev-5`): Caminito, Benito Quinquela Martin
  Museum, La Bambonera stadium.
- `sourceSupportAudits`: SUPPORTED, 3/3 components supported, 0 unsupported.

Primary question — *after receiving `anchorNames=["Caminito"]`, does the
extractor still select an unrelated route?* **No.** The prior rerun's
Avenida de Mayo → Casa Rosada → Congreso route (from a generic walk page) is
gone; the extracted Experience is materially about Caminito/La Boca and is
source-composed. This supports the finding-C hypothesis that the lost typed
handoff was the extraction-relevance blocker (single run; not a stability
claim).

## 7. Entity resolution — the new blocker (trace)

| hint | result | canonical GeoEntity |
| --- | --- | --- |
| Caminito | RESOLVED / INSIDE (LOCAL_OSM_POOL, VERIFIED via exact name + Wikidata NEARBY) | PLACE `osm:node:10303343309` (the `tourism=attraction` node), POINT |
| Benito Quinquela Martin Museum | RESOLVED / INSIDE (LOCAL_OSM_POOL, VERIFIED via own QID) | PLACE `osm:node:5721009562` *Museo de Artistas Argentinos Benito Quinquela Martín* |
| La Bambonera stadium | **UNRESOLVED** — catalog, trusted observation, local OSM pool (2711), Nominatim, Geoapify all acquired no candidate | — |

Composite decision: `REJECTED` / `INCOMPLETE_SOURCE_COMPOSITION`
(`resolutionRatio 0.67`, `sourceCompositionComplete: false`,
`componentScope: DESTINATION_AREA Buenos Aires`). Geographic validation
therefore saw 0 proposals; catalog materialization persisted no Experience.
Pass 2 produced nothing new (its web plan was skipped as
`DUPLICATE_SOURCE_PLAN_EXECUTION`, traced).

## 8. Persistence (`db-after.json`)

3 GeoEntities / 3 identities, 0 Experiences, 0 components:
`Caminito` ROUTE `osm:way:144844726` (the resolved anchor), `Caminito` PLACE
`osm:node:10303343309` and the Quinquela Martín museum (both component
resolutions, persisted as verified GeoEntities before the composite was
rejected). No homonym was persisted.

## 9. Findings (recorded, not fixed here)

- **RW3-N5 (blocker, entity resolution):** a source-explicit component whose
  name the *source itself* misspells (`La Bambonera`) is unresolvable by every
  provider, and `INCOMPLETE_SOURCE_COMPOSITION` then rejects an otherwise
  real, 2/3-resolved, Caminito-related walking Experience. The extractor did
  not normalize the name even though the shared prompt allows same-entity
  normalization when confident. Owner candidates: component-resolution name
  matching (tolerance to source typos) and/or the extractor's normalization
  behavior. Not patched: no special case, no fuzzy threshold added here.
- **RW3-N6 (observation, identity representation):** Caminito exists twice in
  the canonical store — ROUTE `osm:way:144844726` (anchor) and PLACE
  `osm:node:10303343309` (component). Both are real OSM objects; when a
  composite eventually reaches validation, route membership will relate the
  component's point to the anchor's MultiLineString. Worth watching, not a
  defect by itself.
- **Bitácora gap (minor):** `sourceSupportAudits` show `SUPPORTED` per
  component but not the verified `supportSpan` text, and the raw extractor
  output is not in the trace, so the exact quoted support cannot be re-read
  from the Bitácora.

## 10. Bitácora reconstruction

Reconstructable from the trace alone: interpretation, destination, anchor
candidate selection including every same-branch rejected homonym, routing and
`anchorMode`, search provider and query, evidence, extractor structured
anchor context, extracted candidate and admission, source-support status,
per-hint resolution attempts, composite rejection reason, pass-2 skip, and
the final coverage failure. **Not** reconstructable: the verified support
span text (gap above). Persistence counts come from `db-after.json`.

## 11. Tour quality

No tour was produced. The *extracted* Experience itself is relevant (about
the requested anchor), touristically valuable (Caminito, the Quinquela Martín
museum, La Bombonera are La Boca's core sights), fits the walk preference and
is source-composed — verified up to entity resolution, not as a final
recommendation.
