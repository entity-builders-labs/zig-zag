# Task A9 — Live Re-measurement With Hotel Exclusion + 5 Resolver Fixes

Two live 6-theme Buenos Aires runs this session, same methodology as
A4/A7/A8 in spirit (real Groq/SerpAPI/Overpass/Wikidata, no mocking) but a
different mechanism: instead of the old, never-committed
`characterize-composite` script (which isolated only the web-discovery
funnel), this used the real full production entry point
(`ExperienceGenerationService.generateTourExperiences`) via a temporary,
throwaway Jest live-spec against the **dedicated spike database**
`zigzag_spike_preb6` (whitelisted in `assert-disposable-database.ts`), never
the shared `zigzag` dev database. Both runs' scaffolding was fully deleted
afterward; nothing was left in the tree.

**Methodology caveat, stated once here rather than repeated below:** because
this exercises the whole generation pipeline (catalog + refill + discovery,
not just the narrow web-discovery slice A4/A7/A8 measured), raw candidate
counts are **not directly comparable** to A4/A7/A8's headline numbers. The
fair comparison is the two runs described below against each other — same
harness, same methodology, only the resolver code differs.

## Run 1 (before this session's 5 fixes): baseline

`AI_PROVIDER=groq`, `DISCOVERY_EXTRACTOR_PROVIDER=groq`,
`CLASSIFICATION_PROVIDER=groq`, `GROUNDED_SEARCH_PROVIDER=serpapi`,
`PLACES_PROVIDER=geoapify` (the standing local `.env`, unchanged). Only the
`wikidata=*` OSM-tag-direct-confirmation change (see the progress doc's own
"DONE" section for that work) was live; none of the 5 fixes below existed
yet.

```
raw candidates:              152
composite generated:          12
composite persisted:           1   (8.3%)
```

First attempt at this run used `OVERPASS_API_URL=http://host.docker.internal:12345/api/interpreter`
(the container-only hostname) directly from the host machine running
`npx jest` outside Docker — every local Overpass lookup failed at the DNS
level (`OSM_PROVIDER_FAILED`), producing a fully invalid first measurement
that was discarded. Re-run with `OVERPASS_API_URL=http://localhost:12345/api/interpreter`
(correct for host execution) produced the real numbers above.

A misdiagnosis during this run is worth recording: a first pass concluded
"Buenos Aires resolves to the wrong OSM relation (the Province, not the
city)" based on `boundaryName: "Buenos Aires"` string-matching two different
real Nominatim relations both literally named "Buenos Aires" (the Province,
`wikidata=Q44754`, and a `Comuna 1` sub-district relation that also happens
to be named plain "Buenos Aires" in OSM's data and whose actual geometry
matches the whole city's extent — 2706 POIs, identical to the real CABA
relation). Live-verified: the actual resolved boundary DOES contain Plaza de
Mayo and the real Obelisco. **The destination-resolution boundary was never
the problem.**

## The real root cause found this run: `role: "area"` misclassification

The discovery LLM (`GroqDiscoveryProvider`, `qwen/qwen3.8-27b`) sometimes
classifies a point-like place (a plaza, a monument) as `role: "area"`
instead of `role: "venue"` — against its own prompt instruction
(`experience-discovery-extraction.prompt.ts` line ~81: *"role 'venue' for a
point, ... 'area' for a district"*). An `area`-role hint is only ever
compared against the destination-wide boundary (never matching a
point-like place by name) and, as a fallback, Nominatim's administrative-area
search — never the local POI pool, where the real entity (e.g. "Plaza de
Mayo", `leisure=park`, `wikidata=Q1126357`) actually sits and would have
matched immediately. Verified live: "Plaza de Mayo" and "Retiro" both hit
`NO_OSM_MATCH` this way in the baseline run, even though both real places
are unambiguously present in the exact local pool query already used.

## Run 2 (after the 5 fixes): full 6 themes

Same harness, same 6 themes (`history, food, culture, art, architecture,
nature` × `intent=walk`), same `.env`. Fixes live this run (see the progress
doc's own section for the code-level detail):

1. Places top-N reconciliation (`selectBestPlaceCandidate`) — replaces
   blind `result.data[0]`.
2. `confirmMatch`'s known-QID check generalized beyond the OSM candidate's
   own `wikidata` tag to also read `SourceObservation.canonicalIdentity.wikidataQid`
   (structured/non-LLM origin only — `GeoEntityHint` itself untouched).
3. `role: "area" → venue` fallback in `resolveCandidate`: an AREA-role hint
   that fails both the destination-boundary match and the Nominatim
   administrative-area path is retried once against the local POI pool.
4. `matchOsmCandidateByName`'s fuzzy branch now picks the **best** candidate
   in the whole pool (most matched significant tokens, then presence of the
   candidate's own `wikidata` tag as tiebreak), not the first one found —
   same "best in the pool, not first found" discipline the exact-match
   branch already had.
5. `confirmMatch` compares the hint against the matched candidate's own
   `name:xx` / `official_name` / `alt_name` / `short_name` / `loc_name` tags
   and the title inside a `wikipedia=xx:Title` tag, before any network call
   (own declared names, not an independent cross-reference).

First attempt at Run 2 was killed mid-run by the OS for low system memory
(4/6 themes had already completed and written their artifacts to disk
before the kill; the dedicated spike DB was reset by hand since the
process died before its own `afterAll` cleanup could run). Closing an
unrelated Android emulator (freed ~1.3GB) let the retry finish clean.

```
raw candidates:              136
composite generated:           6
composite persisted:           2   (33.3%)
```

Both persisted composites are clean, real, two real components each:
- "Walk Around Plaza de Mayo and Casa Rosada" — Plaza de Mayo + Casa Rosada.
- "Buenos Aires: San Telmo and Boca Food and Walking Tour" — Mercado de San
  Telmo (`osm:way:158893271`, `wikidata=Q6010497`, live-verified earlier
  this session to carry a real English label "San Telmo market" and
  Spanish/French aliases) + Caminito.

A 4-theme partial run (before the memory kill) showed 3/8 (37.5%) persisted,
converging with this run's 33.3% — both a real, consistent ~4x improvement
over the 8.3% baseline, not a one-off.

## The Güemes collision: fixed at its root, not just masked

"Galería Güemes" — one of the two original collision cases this whole
multi-week effort was built around (`Task A3`/`A4` in this doc's earlier
sections) — resolved **correctly** in Run 2, all 10 occurrences across the
6 themes, for the first time all session. It matched OSM node
`2481986716`, live-verified: `tags: {name: "Mirador Galería Güemes",
tourism: viewpoint}` — a real, genuine rooftop viewpoint that is part of
the actual Galería Güemes building, not the unrelated "Martín Miguel de
Güemes" monument that kept stealing this hint in every prior run.

Root cause, confirmed by hand: `hasSpecificNameOverlap`-based fuzzy matching
scores "Mirador Galería Güemes" (shares 2 significant tokens with the hint:
"galeria", "guemes") strictly higher than "Martín Miguel de Güemes" (shares
only 1: "guemes") — but the OLD `.find()`-based fuzzy match returned
whichever appeared first in Overpass's arbitrary pool order, which happened
to be the wrong monument. Fix 4 (best-fuzzy-match, not first-found) picks
the objectively better candidate directly — the original collision was
never purely a confirmation-gate problem, it was **also** a
candidate-selection problem the confirmation gate could only catch as a
symptom (correct rejection), never fix at the source.

**"Recoleta Cemetery" (the other original collision case) did not appear as
a hint in either Run 1 or Run 2** — the discovery LLM's own output is
non-deterministic across runs, so this specific case was not re-exercised
live this session. Nothing in this session's changes had reason to affect
it differently than Güemes; it should be re-verified the next time it
naturally appears in a live run, not assumed fixed or unaffected.

## Recommendation

Do not read the persistence-rate jump (8.3% → ~33-38%) as "solved." The
dominant remaining loss categories in Run 2 (`NO_OSM_MATCH`: 34,
`UNCONFIRMED_MATCH`: 17) still contain: (a) the same fail-closed collision
guard correctly rejecting genuine identity ambiguity (working as intended,
not a bug), (b) `role` misclassification in directions this session's fix
doesn't cover (e.g. a real neighborhood classified `role: "waypoint"`
instead of `"area"` — the opposite direction from what Fix 3 addresses),
and (c) discovery-extraction quality issues (a hint name paraphrased far
enough from the real place's name — e.g. "City Museum" for "Museo de la
Ciudad" — that no matching mechanism can bridge it). See the companion
architecture review
(`docs/superpowers/characterization/2026-09-18-composite-materialization-architecture-review.md`)
for a full breakdown of what's next, ranked by evidence and risk.

## Raw data

Both runs' full per-theme trace JSON files were session-local (never
committed) and deleted after analysis, per this branch's own established
discipline — anyone needing to re-verify should re-run the same
methodology (`ExperienceGenerationService.generateTourExperiences` against
the `zigzag_spike_preb6` spike DB via a temporary live-spec), not assume
these numbers are still current.
