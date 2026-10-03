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
   **A serious gap in this fix as first written was found and fixed the
   next day — see "Follow-up: a critical hole in the observation-QID
   check" below. Do not treat the description above as safe on its own;
   read that section.**
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

---

## Follow-up: "Recoleta Cemetery" verified with real data (not yet a fresh live run)

The user pushed back on "Recoleta Cemetery did not appear as a hint,
not re-verified" above — it's a real, major tourist attraction with
guided tours, it should resolve, and not via a case-specific rule. Live
Overpass query confirmed the real entity is already in the candidate pool
today, no new tag category needed: OSM way `183842128` "Cementerio de la
Recoleta", `landuse=cemetery`, `tourism=attraction`,
`wikidata=Q831322`. Live Wikidata query on that exact QID: `label.en =
"Recoleta Cemetery"` — an exact match to the hint.

A new unit test
(`experience-proposal-resolver.service.spec.ts`, `"resolves the real
'Recoleta Cemetery' case end to end"`) reproduces this exact real data
(the real cemetery vs. the historically-wrong "Hotel Urban Suites
Recoleta", which carries no wikidata tag) and passes: the general
mechanism (best-fuzzy-match tiebreak by wikidata-tag presence, then
direct-QID confirmation) resolves it correctly with **zero case-specific
code**. This is evidence the fix generalizes, but it is a unit test
against real fixture data, **not** a fresh live 6-theme run that actually
re-exercised this specific hint in production — the next live run that
happens to surface "Recoleta Cemetery" again should still be checked by
hand, same discipline as every other collision case in this document.

A known, unhardened residual gap was flagged and left open: if the
WRONG candidate also happened to carry its own wikidata tag (a full tie
on every signal `bestFuzzyMatch` currently checks), selection would fall
back to arbitrary pool order again. No evidence this happens in practice
(hotels rarely carry wikidata tags) — not fixed, deliberately, pending
real evidence it's needed.

## Follow-up: addressHint signal added, live-measured, low yield (not a regression)

Per the same conversation, a new independent, non-name-based
confirmation signal was added: `GeoEntityHint.addressHint`, populated by
the discovery LLM only when cited evidence explicitly states a street
address for that exact hint (prompt already forbade putting an address
in `name`; it was previously just discarded instead of captured
elsewhere). Used two ways, both additive/safe: as the top-priority
tiebreak in `matchOsmCandidateByName`'s fuzzy branch (a real address
match beats token-count or wikidata-tag presence), and as a direct,
network-free confirmation in `confirmMatch` (an address either matches a
candidate's own `addr:housenumber`/`addr:street` tags or it doesn't).
Committed `6222565`.

Live-measured (6-theme Buenos Aires, run in six separate single-theme
`npx jest` invocations due to severe, recurring host memory pressure this
session — see below): **144 real hint opportunities, `addressHint`
populated by the LLM exactly once.** That one case ("Reserva Ecológica
Costanera Sur", addressHint a postal-style address with no street
number) correctly fell through unconfirmed — the real OSM entity for a
nature reserve has no `addr:housenumber` tag to check against, so there
was nothing to confirm, not a false positive and not a bug.

**Honest conclusion: cannot claim this improved the composite-persistence
rate** — the sample is too small (1 real use) to say anything about
impact. The code is safe (unit-tested for both the match and the
full-tie-broken case) and the mechanism is sound, but **grounded web
evidence for typical tourist attractions rarely states a street address**
for the featured place — the practical yield of this signal is real but
low, given today's evidence sources. Do not expect this alone to move the
composite-persistence number; it is a genuine, safe addition, not a
proven lever.

This run's own headline numbers (144 raw, 10 composite generated, 2
persisted = 20%) are **not evidence the fixes regressed** — composite
generation volume from the discovery LLM varies run to run regardless of
resolver code (136-152 raw candidates observed across three separate
post-fix-era runs this session), and this run barely exercised the one
new signal being measured.

## Aside: severe host memory pressure this session (operational note, not a code finding)

The live runs in this document were repeatedly killed by the OS for low
system memory — four separate times across the addressHint measurement
alone, even after reducing batch size from all 6 themes at once, to 2 at
a time, down to 1 theme per `npx jest` invocation. Root cause was **not**
this test suite or the app itself (Docker containers stayed under
2.5GB combined throughout) — it was unrelated host processes (a running
Android emulator, ~15 Firefox/Cursor renderer processes, a
Virtualization.framework VM) competing for RAM on an already-tight
machine. Closing the Android emulator recovered ~1.3GB and helped
temporarily. A real, unimplemented optimization identified but not
acted on: these live-spec runs boot the full NestJS app through
`ts-jest`, which transpiles the entire dependency graph on the fly in
one Node process — running against a pre-built `dist/` (via `yarn
build` once, then a plain Node bootstrap script) would very likely use
substantially less memory and start faster, but was not worth the
setup cost mid-session with only a handful of measurements left to run.
Worth doing before the next live-measurement-heavy session on this
branch.

## Follow-up: a critical hole in the observation-QID check, found and fixed

The user found a real, serious gap in Fix #2 above (the observation-QID
generalization) the day after it shipped, before either fix had been
pushed. Worth recording precisely, since the original description above
undersold the risk.

**The hole:** a QID on a `SourceObservation` (e.g. Wikivoyage claiming
`title: "Recoleta Cemetery"`, `canonicalIdentity.wikidataQid: "Q831322"`)
proves the SOURCE correctly identified the HINT text — it proves nothing
about whether the OSM candidate the local fuzzy matcher actually picked
is that same QID. Those are two different relationships, and
`confirmMatch` as first written conflated them: it fetched the
observation's QID, checked its Wikidata label against the HINT, and
confirmed on a match — without ever checking the label against the
entity that was actually matched. A wrong local candidate with no
wikidata tag of its own (nothing to check independently) would sail
through confirmed, purely because the SOURCE happened to correctly
describe what the hint was asking for.

Concretely: hint "Recoleta Cemetery" fuzzy-matches the real, unrelated
"Hotel Urban Suites Recoleta" (shares the "recoleta" token, no wikidata
tag of its own). The observation's QID (Q831322, genuinely "Recoleta
Cemetery" in Wikidata) would confirm the HOTEL as the cemetery, because
the check never looked at what was actually matched.

**Why the OSM-tag-sourced path (`confirmViaOwnWikidataTag`) was never at
risk of this:** there, the QID comes directly off the matched entity's
own tags — a structural self-declaration by that exact record, not an
independent claim about a hint string. There's nothing to cross-check
against, because the entity->QID link IS the thing being trusted, made
by a human OSM mapper on that specific node.

**The fix:** `confirmViaObservationWikidataTag` now requires the same
dual-check the geo-proximity path already uses (added by the
final-review fix, commit `2c2e412`, for exactly this class of problem in
a different mechanism): the candidate Wikidata record must satisfy the
HINT (strict, all tokens) AND the MATCHED ENTITY's own name (default
bar) — never the hint alone. A new regression test reproduces the exact
collision with real QID/label data; the pre-existing legitimate-case
test (correct entity, no OSM tag, observation QID) still passes
unchanged.

**Lesson for next time:** any new "known identity" signal introduced for
`confirmMatch` needs an explicit adversarial test — hint resolves
correctly at the source, but the LOCAL MATCHER picks the wrong
candidate anyway — not just a happy-path test where the matched entity
already happens to be correct. The original 3 tests for this fix all
used a correctly-matched entity; none exercised the actual failure mode
the fix was supposed to guard against.
