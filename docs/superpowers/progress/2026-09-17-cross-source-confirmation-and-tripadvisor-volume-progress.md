# Cross-Source Confirmation + TripAdvisor Volume — Progress

Status: **Track A: A1–A4 COMPLETE (this plan). A5–A7 COMPLETE under a
separate follow-up plan. Root Cause #5 (Overpass reliability) FIXED and
live-verified (Task A8) — `OSM_QUERY_EMPTY` went from 21 occurrences to 0.
Both original collision bugs ("Recoleta Cemetery", "Galería Güemes") are
now confirmed fixed with real, unmasked live traffic, not just unit tests.
A one-off diagnostic script (never committed, results below) classified
every real A8 `UNCONFIRMED_MATCH` case by hand against live Overpass/
Wikidata and found the 0/9 composite result was NOT mainly a language
problem: roughly half were genuinely NEW wrong-identity collisions the
gate correctly caught (a broader pattern than Recoleta/Güemes — generic
Spanish CATEGORY words like Mercado/Museo/Pasaje/Palacio/Viejo/Residencia,
not just neighborhood/hero names), a real minority were genuine
translation-only losses, one was a distinct token-ratio design quirk
(MAFALDA), and several of the wrong local matches were HOTELS, which led
to a real product-scope fix (`019fccd`): hotels/hostels/guest_houses/
apartments/motels are now excluded from the local OSM candidate pool
entirely (33-40% of the real pool was accommodation businesses, not
tourist experiences — out of this product's stated scope regardless of
matching correctness). Task A9 (hotel-exclusion fix live-measured) plus 5
targeted resolver/matching fixes (direct-QID confirmation generalized
beyond OSM tags, Places top-N reconciliation, `role: "area"→"venue"`
fallback, best-fuzzy-match tie-break, own-name-tag comparison) landed and
live-measured 2026-09-18: composite persistence **8.3% → 33.3%** (same
harness, before/after), and the "Galería Güemes" collision fixed **at its
root** (a candidate-selection bug the confirmation gate could only mask as
a symptom, never fix) — see
`docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md`.
"Recoleta Cemetery" did not appear as a hint in either live run that
session, but was separately verified with real data (real OSM tags, real
Wikidata QID/label) in a dedicated unit test: the general mechanism
resolves it correctly, no case-specific code — **still not re-confirmed
by an actual fresh live run**, see the live-remeasure doc's follow-up
section. A full adversarial review of a larger proposed architecture
change (provider-neutral gather/reconcile/verify, composition-evidence-
as-a-gate, full source extraction) was done against the real branch
state — nothing from it was implemented; see
`docs/superpowers/characterization/2026-09-18-composite-materialization-architecture-review.md`
for what's verified-real, what's stale-assumption, and the ranked
recommendation. A 6th fix, `GeoEntityHint.addressHint` (an independent,
non-name-based confirmation signal), was added and live-measured
2026-09-19: used by the discovery LLM only once in 144 real hint
opportunities — safe and correct, but not proven to move the
persistence number given how rarely grounded web evidence states a
street address. Two more findings verified against real code/external
docs the same day: Wikivoyage is structurally POI-only (can never
produce a composite, by design, at two separate points in the pipeline)
and TripAdvisor via SerpAPI (`engine=tripadvisor`) is real and feasible
on the already-paid account — see
`docs/superpowers/characterization/2026-09-19-wikivoyage-poi-only-and-tripadvisor-feasibility.md`.
A CRITICAL gap in the 6th fix's own predecessor (the observation-QID
generalization, part of the 5 fixes above) was found by user review and
fixed the same day: an observation QID only proves the SOURCE correctly
identified the HINT text, never that the OSM candidate the local
matcher actually picked is that same QID — a wrong local candidate with
no wikidata tag of its own could get silently confirmed. Fixed by
requiring the same dual-check (hint + matched entity) the geo-proximity
path already uses — see
`docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md`'s
"Follow-up: a critical hole..." section. **This fix was never live
(shipped and caught before push) — no production data was ever
affected.** All 3 of the FIRST batch of commits (`1ba8c03`, `b2e52b6`,
`6222565`) are **pushed** to `fork/feat/preference-first-selection`; 4
more commits (docs, a housenumber-extraction bugfix, a small caller
fix, and this critical fix) are committed **locally, NOT yet pushed**
as of this writing — check `git log --oneline
fork/feat/preference-first-selection..HEAD` before assuming push state.
Track B: NOT STARTED.**
Written: 2026-09-17, updated 2026-09-19.
Branch: `feat/preference-first-selection`.

> **Follow-up plan pointer:** Task A5/A6/A7 referenced throughout this file
> from here on were executed under a separate, dedicated plan document —
> `docs/superpowers/plans/2026-09-17-confirmation-collision-fix-and-anchor-scope-narrowing.md`
> — created after A4 found the confirmation gap below. That plan has its
> own full task-level detail (exact code, TDD steps); this file only
> summarizes outcomes and points to it plus the two characterization
> reports it produced.

This is the current operational progress pointer for this plan. It follows
directly from `2026-09-17-composite-experience-adversarial-review-progress.md`
(Tasks 1/2/3 of the prior plan): after Task 3's re-run (SerpAPI timeout raised,
Geoapify fallback made real) still persisted 0 fully-geographically-validated
composite Experiences, the user stated a hard, non-negotiable requirement —
every persisted Experience's components must be 100% geographically
confirmed — which this plan (Track A) directly implements.

Canonical documents for this effort:

- **Plan**: `docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md`
- **Prior diagnostic**: `docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md`
- **Prior progress**: `docs/superpowers/progress/2026-09-17-composite-experience-adversarial-review-progress.md`

---

## Current state

```text
TRACK A — cross-source confirmation (Wikidata)
  A1 — export hasSpecificNameOverlap for reuse            COMPLETE
  A2 — Wikidata geographic-proximity lookup                COMPLETE
  A3 — wire confirmation into the resolver                 COMPLETE
  A4 — re-measure (Task 3 pattern) with confirmation live  COMPLETE (found a real gap)
  A5 — stricter confirmation-only token bar                COMPLETE (separate plan)
  A6 — narrow local pool to resolved AREA anchor           COMPLETE (separate plan, Root Cause #4)
       (+ final-review fix round: tie corroboration to
       the MATCHED entity, not just the hint — closed a
       SECOND real gap the final review itself found)
  A7 — re-measure with A5+A6+fix live                      COMPLETE — 2/11 composites
       persisted, first non-zero result all session
  Root Cause #5 (Overpass reliability under load)          COMPLETE — see below
  Product-scope fix: exclude hotels from local pool        COMPLETE — commit 019fccd
  A9 — re-measure with hotel-exclusion fix live             COMPLETE — see
       docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md
  5 targeted resolver/matching fixes (direct-QID           COMPLETE — 8.3% -> 33.3%
       generalized, Places top-N, role=area->venue         composite persistence,
       fallback, best-fuzzy-match tie-break, own-name-tag  "Galería Güemes" fixed
       comparison)                                          at its root
  Architecture review of a larger proposed refactor        COMPLETE (analysis only,
       (gather/reconcile/verify, compositionEvidence gate) nothing implemented) — see
                                                             docs/superpowers/characterization/2026-09-18-composite-materialization-architecture-review.md
  "Recoleta Cemetery" verified with real data (unit test,  COMPLETE — general
       not a fresh live run)                                mechanism resolves it,
                                                             no case-specific code
  6th fix: addressHint (independent, non-name-based        COMPLETE — safe, but
       confirmation signal)                                 used only 1/144 times
                                                             live; not proven to
                                                             move the % — see
                                                             docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md
  Wikivoyage POI-only + TripAdvisor feasibility            COMPLETE (analysis only)
       (confirmed against real code + real SerpAPI docs)    — see
                                                             docs/superpowers/characterization/2026-09-19-wikivoyage-poi-only-and-tripadvisor-feasibility.md
  Small caller fix: thread observations through            COMPLETE — commit
       acquireNearby too (currently zero production          695cdb3, zero live
       callers, found by user review)                        impact today
  Bug fix: extract housenumber at the END of               COMPLETE — commit
       addressHint, not the first digit (street names        f081da6
       like "Avenida 9 de Julio" broke the old regex,
       found by user testing)
  CRITICAL fix: observation QID proved hint==QID,           COMPLETE — commit
       never that the MATCHED entity==QID -- a wrong          4f3c0a3, found
       local candidate with no wikidata tag of its own         by user review
       could get silently confirmed by an observation
       QID that correctly described the HINT but said
       nothing about what was actually matched. See
       docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md's
       own "Follow-up: a critical hole..." section.
  Push status: 3 commits pushed (1ba8c03, b2e52b6,
       6222565); 4 more commits LOCAL, NOT YET PUSHED
       (3f22626, f081da6, 695cdb3, 4f3c0a3)            <-- WE ARE HERE

TRACK B — TripAdvisor as an additional volume source
  B1 — TripAdvisorGroundedSearchService                     NOT STARTED
  B2 — wire into executeWebSourcePlan as a 2nd evidence pass NOT STARTED
  B3 — re-measure combined Track A + Track B impact          NOT STARTED
```

---

# DONE — Task A1: export `hasSpecificNameOverlap`

**Commit:** `4d408a1` — `refactor(entity-resolution): export hasSpecificNameOverlap for reuse by cross-source confirmation`

Trivial export of the module-private function Task 2 (prior plan) added, so
Task A3 can reuse the exact same specificity rule for confirmation
comparisons instead of inventing a second matching policy. No behavior
change. TDD evidence: new import-and-call test in
`nominatim-match.util.spec.ts` RED (function undefined) → GREEN after adding
`export`.

---

# DONE — Task A2: Wikidata geographic-proximity lookup

**Commit:** `48cdf21` — `feat(wikidata): add geographic-proximity lookup for cross-source confirmation`

New `findNearbyPlaces(latitude, longitude, radiusMeters): Promise<WikidataNearbyPlace[]>`
on `IWikidataApiService`, implemented in `WikidataApiService` via a SPARQL
`wikibase:around` query against `https://query.wikidata.org/sparql`
(`SELECT ?item ?itemLabel ?location WHERE { SERVICE wikibase:around {
?item wdt:P625 ?location. bd:serviceParam wikibase:center "Point(lon
lat)"^^geo:wktLiteral. bd:serviceParam wikibase:radius "<km>". } ... }`),
parsing `Point(lon lat)` and the QID out of each binding. Never throws — a
provider outage (network error, timeout) is logged and returns `[]`, which
callers must treat as "cannot confirm", never "confirmed absent". Passed
through uncached in `CachedWikidataApiService` (unlike the QID-keyed
narrative lookups, which cache per-entity) since this is a real-time
confirmation signal that must stay fresh.

Live-validated before writing code (see the plan's "Current real state"
section): `wikibase:around` correctly found the real MALBA museum entity
within 200m of its OSM-derived coordinate, and correctly found nothing
relevant within 350m of a real known-wrong OSM match.

TDD evidence: 3 new tests in `wikidata-api.service.spec.ts`
(`findNearbyPlaces (Task A2, cross-source confirmation)` describe block) —
maps bindings correctly (asserting the exact SPARQL query string sent),
returns `[]` on SPARQL failure, returns `[]` on empty bindings. All green;
full `wikidata-api.service.spec.ts` and `cached-wikidata-api.service.spec.ts`
suites unaffected.

---

# DONE — Task A3: wire confirmation into the resolver

**Commit:** `673a556` — `feat(tours): cross-source confirmation for OSM/Nominatim matches (Task A3)`

## What was built

`ExperienceProposalResolverService` no longer treats a fuzzy (non-exact)
name match as sufficient for `status: 'resolved'`. New `confirmMatch(entity,
hint)`:
- Exact name match (`normalizeGeoName(entity.canonicalName) ===
  normalizeGeoName(hint.name)`) always auto-confirms — no Wikidata call.
- Otherwise, requires Wikidata's `findNearbyPlaces` (200m radius) to return
  at least one place whose label has specific token overlap
  (`hasSpecificNameOverlap`, same rule as matching) with the hint name.
- No Wikidata provider injected, or the live call throwing → fails closed
  (`false`) — a matched-but-unconfirmed entity becomes `unresolved` with
  reason `UNCONFIRMED_MATCH`, going through the exact same
  `UNRESOLVED_REQUIRED_COMPONENT`/rejection path as a hint that never
  matched at all (per the plan's Global Constraints — not a softer failure
  category).

Both success branches in `resolveCandidate` (local OSM pool match, and the
trusted-global/Nominatim path) now route through this gate. `wikidata` is
the resolver's 7th constructor parameter, `@Optional() @Inject(...)` —
resolver still works with zero Wikidata wiring, it just can never confirm a
fuzzy match without it (fails closed, as designed).

## Root-cause fix found while making this task's tests pass

Two pre-existing test suites broke when the new gate went in — as
anticipated by the plan itself ("do not silently loosen the new gate to
avoid touching a test"). Investigating why an apparently *exact* match
(`"Place B"` hint against a pool literally containing a `"Place B"` node)
was failing revealed a real, previously-silent bug in
`matchOsmCandidateByName`, not a test-only concern:

`matchOsmCandidateByName`'s `.find()` returned the **first** pool entry
satisfying `hasSpecificNameOverlap`, even when a **later** pool entry was
an *exact* match. `hasSpecificNameOverlap`'s token filter drops tokens
under 4 characters, so `"Place A"` and `"Place B"` (and, worse,
`"Venue 000"`..`"Venue 024"` in the concurrency spec's 25-candidate batch)
all collapse to the single shared generic token `"place"`/`"venue"` — the
first pool entry containing that token silently won the match for every
hint sharing it, regardless of which pool entry was that hint's real,
exact match. This was already producing wrong entity identities before
Task A3 (invisible then, because `ResolvedGeoEntity.hintName` — what the
old tests' mocked validators checked — stays the hint's own name
regardless of which entity actually got matched); Task A3's confirmation
gate is precisely what caught it, by comparing the matched entity's own
`canonicalName` against the hint name and finding they disagreed.

**Fix**: `matchOsmCandidateByName` now checks for an exact match across the
*whole* pool first, falling back to the first fuzzy match only if no exact
match exists anywhere. New regression test in `nominatim-match.util.spec.ts`
(`"Venue 007"` must match pool entry `"Venue 007"`, not `"Venue 000"`).
This fixed `experience-proposal-resolver.concurrency.spec.ts`'s 3 failures
**without touching that file at all** — confirming the concurrency spec's
own fixture was fine; the bug was purely in the shared matching utility.

The one pre-existing fixture that *was* edited:
`experience-proposal-resolver.service.spec.ts`'s
`"never lets one candidate consume a same-named sibling candidate's
validation result"` test used `"Place A"`/`"Place B"` fixture names that
collide on the shared `"place"` token — renamed to `"Alpha Landmark"`/
`"Beta Monument"` (no shared ≥4-char token) so the test exercises its
actual intent (per-object validation-result correlation), independent of
the matching bug above. The other broken test ("resolves a global hint
whose grounded-evidence name is a translated form...") was fixed by adding
a `wikidata` mock confirming the translated match, not by touching the
fixture's real names.

## TDD evidence

5 new tests added directly for Task A3's `confirmMatch`/`unconfirmedEntity`
logic (`cross-source confirmation (Task A3)` describe block): auto-confirms
exact match without calling Wikidata; confirms a fuzzy match via Wikidata;
rejects an unconfirmed fuzzy match (real regression: "San Ignacio Church"
→ "Ignacio Pirovano"); fails closed when Wikidata throws; confirms via the
global/Nominatim path too. All green from first run once the implementation
landed (each was written RED-first against the not-yet-modified resolver).

Full verification after the root-cause fix:
- `experience-proposal-resolver.service.spec.ts`: 38/38 green.
- `nominatim-match.util.spec.ts`: 42/42 green.
- Full backend suite (`yarn test` from `be/`): **1501/1501 green, 148/148
  suites** — including `experience-proposal-resolver.concurrency.spec.ts`,
  fixed by the root-cause fix alone.
- `yarn typecheck` clean, `yarn lint:check` clean.

## Files changed

- `be/src/modules/tours/services/experience-proposal-resolver.service.ts`
- `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
- `be/src/modules/tours/utils/nominatim-match.util.ts`
- `be/src/modules/tours/utils/nominatim-match.util.spec.ts`

## Deviations from the plan

The `matchOsmCandidateByName` exact-match-precedence fix was **not** in the
original plan — it surfaced only while making Task A3's own tests pass and
was fixed at its root cause (per `systematic-debugging`) rather than
patched around in each affected test file. Flagged here explicitly per the
plan's own instruction to do so, same as the Task 2/Geoapify precedent.

---

# DONE — Task A4: re-measure with confirmation live

Full report: `docs/superpowers/characterization/2026-09-17-task-a4-confirmation-live-remeasure.md`.
Ran the same 6-theme live Buenos Aires methodology (temporary,
never-committed `characterize-composite` command — mechanism, revert
discipline, and confirmed-clean `git status --short` afterward same as
every prior run on this branch) with Task A3's confirmation gate live.

**Headline numbers:** 22 raw candidates, 7 composite (>=2 hints), **0
composite persisted (0%)**, 17 unique resolved entities, 9
`UNCONFIRMED_MATCH` hint outcomes (the new category Task A3 introduces).

**The important result is not the 0% number itself** (a lower raw
persistence count is the plan's own expected, correct trade-off of a real
confirmation gate — see the plan's own Task A4 checklist). **The important
result is a second, previously-unknown false-positive class Task A4's
live spot-checking found**: two of the 17 "confirmed" entities are wrong
identities that slipped through confirmation —
`"Recoleta Cemetery"` → `"Hotel Urban Suites Recoleta"`, and
`"Galería Güemes"` → `"Martín Miguel de Güemes"` (a monument, unrelated to
the real shopping arcade). Both live-verified against the real Wikidata
SPARQL endpoint. Root cause: `confirmMatch`'s fuzzy branch searches
Wikidata *around the matched (possibly wrong) entity's own coordinates*
and reuses the exact same permissive `hasSpecificNameOverlap` rule used
for matching — so when the wrong entity happens to sit near some other
real place sharing one generic neighborhood/historical-figure token
("Recoleta", "Güemes" — both extremely common Argentine names), that
unrelated nearby place gets accepted as "independent confirmation" of an
identity it says nothing about. Confirmation here is independent of
*provider* (OSM vs. Wikidata) but not independent of the *matched
entity's own coordinates*, which is the actual thing needing verification.

This directly matters for the user's stated non-negotiable requirement —
as built today, Task A3 does not yet deliver "100% geographically
confirmed" for this specific, reproducible collision class. **Track A's
product guarantee is not yet considered met.** See the full report for:
individually live-spot-checked `UNCONFIRMED_MATCH` cases (some are honest
Wikidata-label-translation gaps — "MALBA"/"Paz Palace" — distinct from the
false-positive class above; one, "San Ignacio", is the plan's own cited
regression working as intended), and the two concrete tightening options
proposed (stricter confirmation-only token bar, or anchoring confirmation
to an independently-resolved area/anchor instead of the matched entity's
own coordinates).

## Deviations from the plan

Task A4 itself was executed exactly as planned. What it found was NOT
anticipated by the plan: the plan's Global Constraint said to reuse the
existing token-specificity logic for confirmation "not invent a second,
parallel matching policy" — this run is live evidence that reuse alone is
insufficient for a confirmation guarantee, since the two failure classes
(matching vs. confirming) have different risk profiles. Flagged here
explicitly rather than silently deciding unilaterally to relax or bypass
this constraint outside a real task/review cycle.

---

# DONE — Task A5, A6, and the final-review fix round

Full plan (own file, own task-level detail): `docs/superpowers/plans/2026-09-17-confirmation-collision-fix-and-anchor-scope-narrowing.md`.
Executed via subagent-driven-development (fresh implementer + reviewer per
task, final whole-plan review, one fix round). Commits, in order:

- `1f41251` — Task A5: `hasSpecificNameOverlap` gains an opt-in
  `requireAllTokens` mode (100% of significant tokens, not ≥50%), used only
  by `confirmMatch`. Closes the exact collision class A4 found *in
  principle* — but see the final-review finding below, which found the
  fix as first written was still incomplete.
- `9b1c86d` — Task A6 (Root Cause #4): threads a resolved AREA anchor's own
  `OsmCandidate` boundary (already fetched during anchor resolution,
  previously discarded) through `ResolvedAnchor` → `AreaRouteWalkAcquisitionService`
  → `materializeExecution` → a new `entityResolutionScope` on
  `ExperienceResolutionRequest`, narrowing ONLY the local OSM pool fetch to
  that area — `CompositeGeographicValidationService`'s destination-wide
  boundary is untouched everywhere (verified directly in review).
- `2c2e412` — **Final whole-plan review fix round 1**: the review (most
  capable model, full A5+A6 combined diff) found that `confirmMatch` still
  only checked whether a nearby Wikidata place's label satisfied the
  HINT's tokens — never whether it had anything to do with the entity that
  was ACTUALLY matched. Concretely: if the wrong local match (e.g. "Hotel
  Urban Suites Recoleta") happened to sit within 200m of the REAL correct
  place's own real Wikidata entry (e.g. "La Recoleta Cemetery" — which
  legitimately contains both "recoleta" and "cemetery"), the wrong match
  would still get confirmed — and Task A6 makes this geometrically MORE
  likely by shrinking the search radius to one small anchor area. Verified
  by hand against the real live case before dispatching the fix. Fix:
  `confirmMatch` now requires a SECOND, independent check — the
  corroborating label must ALSO satisfy `hasSpecificNameOverlap(entity.canonicalName,
  place.label)` (default, non-strict bar) — on the SAME candidate Wikidata
  place as the hint check, not independently on any place in the array.
  Re-reviewed clean (both findings ADDRESSED, no new breakage).

Full whole-plan review also flagged two lower-priority findings, ruled and
parked rather than fixed now (see that plan's own SDD ledger history,
already deleted per convention once clean — the outcome is: (a) the
strict token bar is intentionally language-blind, now documented with a
code comment rather than "fixed", a deliberate fail-closed trade-off; (b)
anchor `osmBoundary` duplicates `geometry` into the generation bitácora
trace and the acquisition source-plan fingerprint hash — a real payload/
perf concern, explicitly out of this plan's file scope, needs its own
future task).

`yarn test` from `be/`: 1512/1512 passing, 148/148 suites, throughout.
`yarn typecheck`/`yarn lint:check` clean throughout.

---

# DONE — Task A7: re-measure with A5+A6+fix live

Full report: `docs/superpowers/characterization/2026-09-17-task-a7-post-fix-live-remeasure.md`.
Same 6-theme live Buenos Aires methodology as A4/Task 3.

**Headline: 26 raw candidates, 11 composite (>=2 hints), 2 composite
persisted (18.2%)** — the first non-zero composite-persistence result of
this entire session (Task 3's re-run: 0; A4: 0/7). Both accepted
composites spot-checked with no signs of a wrong identity — one is entirely
exact-name matches (Casa Rosada / Catedral Metropolitana / Cabildo de
Buenos Aires, auto-confirmed without needing Wikidata at all); the other
includes one genuine fuzzy/translated match ("Kavanagh Building" →
"Edificio Kavanagh") that had to pass BOTH the hint check and the new
final-review entity-identity check against real Wikidata corroboration,
and did — real, live, positive-path evidence the Round 1 fix doesn't
needlessly block a legitimate translated match on a genuinely specific
(non-generic) identifying token.

**The two original real bugs, re-checked live:**
- **"Galería Güemes" → wrong monument: CONFIRMED FIXED, consistently.**
  Landed on `UNCONFIRMED_MATCH` in every one of the 3 theme runs where the
  local OSM pool actually returned data — zero wrong-resolution
  occurrences this run.
- **"Recoleta Cemetery" → wrong hotel: INCONCLUSIVE this run, not
  disproven.** Both occurrences hit `OSM_QUERY_EMPTY` (Root Cause #5 infra
  flakiness) before matching/confirmation ever ran, so this specific
  collision wasn't live-re-exercised. The fix is still verified by hand
  against the real Wikidata endpoint and by a dedicated TDD regression
  test (commit `2c2e412`) — but per this session's own discipline (live-
  verify, don't just trust unit tests), this should be explicitly
  re-attempted once Overpass reliability stops masking it, not silently
  assumed fixed.

**`OSM_QUERY_EMPTY` (21 hint-level occurrences) is now the single largest
loss category by far** — bigger than in any prior run this session. Task
A6's narrower per-anchor queries did not, on their own, fix Overpass's own
reliability under sustained load (Root Cause #5, still completely
unaddressed). This is now the clearest remaining lever for raising
composite persistence further, ahead of Track B (volume) by the same
"fix the funnel before widening the top of it" logic that put A5/A6 ahead
of Track B.

---

# DONE — Root Cause #5 (Overpass reliability) + Task A8 re-measurement

Live-diagnosed (not planned first — reproduced the real failure with real
curl/axios calls against the local Overpass instance before writing any
fix), per the user's own question about whether the observed `HTTP 200 +
HTML error body` behavior was configurable. It was: Overpass's dispatcher
default `OVERPASS_ALLOW_DUPLICATE_QUERIES=no` rejects a second identical
query while an earlier instance of it is still recent — exactly this app's
own usage pattern (the same destination-scoped "within area" query
repeated once per requested theme/candidate in one acquisition run, made
more likely by Task A6's own narrowing). Live-verified: with the default
`no`, 7/8 identical sequential requests failed this way; with `yes`,
12/12 sequential and 6/6 truly concurrent identical requests all
succeeded.

**Commits:**
- `ecba56a` — `docker-compose.yml`: `OVERPASS_ALLOW_DUPLICATE_QUERIES=yes`
  for the local `osm-local` dev fixture. The actual fix.
- `e70f3e2` — `OverpassApiService.execute()`: defense-in-depth — a
  non-JSON response body (verified via a real axios+HTTP-server test that
  axios does NOT throw for this, it leaves `response.data` as a raw
  string) is now thrown as a new `OverpassMalformedResponseError` and
  routed through the existing 429/502/503/504 retry/backoff path, instead
  of silently becoming `[]`. TDD, 2 new tests, full suite 1514/1514 green.

**`docs/development/local-overpass.md` already documents this profile as
"a reproducible development fixture, not the production deployment
design"** — production capacity planning for a real OSM query backend
remains separate, future, unstarted work; this only fixes the dev
fixture's own config default.

## Task A8: re-measure with Root Cause #5 fixes live

Full report: `docs/superpowers/characterization/2026-09-18-task-a8-root-cause-5-live-remeasure.md`.
Same 6-theme methodology.

**`OSM_QUERY_EMPTY` dropped from 21 (A7) to 0 (A8).** Clean confirmation
the fix works. **Both original collision bugs are now confirmed fixed with
real, unmasked live traffic** — "Recoleta Cemetery" (2 live occurrences
this run, both correctly `UNCONFIRMED_MATCH`, the first time this specific
case was actually live-re-exercised rather than infra-masked) and
"Galería Güemes" (5/5 occurrences, consistent with A7).

**But composite persistence dropped to 0/9** (worse in raw count than
A7's 2/11), and `UNCONFIRMED_MATCH` more than doubled (13 -> 34). This is
NOT a regression the Overpass fix caused — it's the Overpass fix removing
an infra failure that was silently hiding the confirmation gate's own true
honest-loss rate. Spot-checking the 25 distinct `UNCONFIRMED_MATCH` hints
this run shows a real pattern beyond the 2 known collisions and the
already-known acronym gap (MALBA): many look like plausibly CORRECT
matches failing to confirm purely on translation grounds (`"SAN TELMO
MARKET"`/`"Mercado San Telmo"`, `"Miter Station"`, `"Monumental Tower"`,
several `"San Martín ..."` variants). Likely mechanism: A5's
`requireAllTokens` hint check and the final-review's entity-identity check
are both independently language-blind, and now BOTH must pass on the same
Wikidata place — stacking two lossy checks plausibly compounds the
honest-loss rate for legitimate translated matches by more than the
isolated final-review discussion anticipated.

**Open question, explicitly not resolved:** is the stacked strictness
correctly calibrated, or over-rejecting real matches that a
multilingual-alias-aware corroboration check (Wikidata `skos:altLabel`,
not just one primary label) would correctly confirm without reopening
either collision case? This needs the user's explicit input before
touching the confirmation logic again — the non-negotiable requirement is
about never confirming a WRONG identity, not about maximizing recall, and
there's no evidence yet that loosening anything would still hold the line
on the two real collisions this whole plan was built around.

---

# DONE — Diagnosed A8's 0/9 result by hand + fixed a real product-scope gap (not a matching bug)

The user pushed back on the "language problem" framing from A8's report,
asking for evidence rather than a plausible-sounding explanation. A
temporary, never-committed diagnostic script (`diagnose-unconfirmed.command.ts`
— replicated `confirmMatch`'s exact logic inline, with FULL visibility
into what production strips for unconfirmed entities: the matched
candidate's own name/coordinates and every Wikidata nearby-place
corroboration attempt) was run against the real 23 distinct hints A8's
`UNCONFIRMED_MATCH` cases covered, live against the real local Overpass
pool and Wikidata.

**Result: "it's just language" was wrong.** Categorized:
- **~12 of 23** were genuinely NEW wrong-identity collisions the gate
  correctly caught — a broader pattern than the plan's original two cases
  (Recoleta/Güemes, neighborhood/hero proper nouns): generic **Spanish
  category words** (Mercado, Museo, Pasaje, Palacio, Viejo, Residencia)
  caused the local matcher to pick an unrelated real place sharing only
  that one word. Concretely: "Mercado San Telmo" → "Hotel Viejo Telmo";
  "Monumental Tower" → a hotel branded "Dazzler Tower San Martin" (this
  independently resolves an ambiguity A4's report had left open); "Patio
  Bullrich" → "Adolfo Bullrich" (a person, not the mall); several more.
- **~4-5** were genuine correct matches rejected purely on translation
  (e.g. "Russian Orthodox Church" vs. its only-Spanish Wikidata label,
  zero shared vocabulary at all).
- **1** ("MAFALDA!") was a distinct design quirk: the entity-check's
  token-ratio penalizes a LONGER local name against a SHORTER
  corroborating label, unrelated to language.
- The rest were genuine Wikidata coverage gaps or ambiguous
  same-name-different-referent cases.

**The real, actionable finding**: several of the wrong local matches in
that first ~12 were **hotels** — not a resolution-algorithm defect at
all, but a **product-scope gap**. The user clarified (again, restating an
earlier session boundary): this is a tourist-EXPERIENCE engine, not a
business directory — hotels are explicitly out of scope, and
restaurants/cafes belong to the not-yet-built "TourStop" concept unless
independently iconic.

**Fix, commit `019fccd`**: the local Overpass POI query's
`nwr["tourism"]["name"]` wildcard matched every `tourism=*` subtype
indiscriminately, including pure accommodation categories. Live-verified
against the real Buenos Aires pool: 259/779 (33%) of ALL POIs were
`tourism=hotel` alone; 310/779 (40%) once hostels/guest_houses/
apartments/motels/etc. are counted. Excluded these categories from BOTH
`buildPoisWithinAreaQuery` and `buildPoisQuery` (the area-scale and
point-scale siblings, both had the identical wildcard).

**On being a word list — addressed directly, twice, at the user's
challenge**: this excludes by OSM's own closed, standard `tourism=*`
**tag value** vocabulary (the same structured-tag technique the
pre-existing `amenity~"^(marketplace|place_of_worship)$"` filter in this
same file already used) — never by scanning the free-text `name` field
for words in any language. Verified live this doesn't need separate
handling for "bar"/"heladería" (ice cream)/"apart hotel": those aren't
`tourism=*` values at all (a different OSM key, `amenity=bar|cafe|
ice_cream`, already excluded since the `amenity` filter was never a
wildcard); 1132 real Buenos Aires bars/cafes/restaurants/ice-cream shops
exist and only 2 carry a secondary `tourism=attraction` tag (an
OSM-community "this one is genuinely iconic" signal, matching the
product's own stated exception) and would still surface as candidates.
"Apart hotel" already maps to the already-excluded `tourism=apartment`
(verified against real listings: "Suipacha Suites", "Icaro Suites",
"Top Rentals").

TDD: 3 new/updated tests in `overpass-query.util.spec.ts`. Full backend
suite: 1517/1517, 148/148 suites. Typecheck/lint clean.

**Not yet done**: a live re-measurement with this fix included (would be
"Task A9" in this plan's numbering) — the pool shrank from 779 to 469
real POIs, which should reduce false-collision candidates further, but
this has not been empirically re-verified with a live 6-theme run yet.

---

## Deferred / not started — Track B

Not started. Track B (`TripAdvisorGroundedSearchService`, wired as a
second additive evidence pass in `executeWebSourcePlan`, engine=tripadvisor
via the already-paid SerpAPI subscription) is a volume/acquisition problem,
explicitly independent of Track A's confirmation-correctness problem per
the plan's Global Constraints. Read Tasks B1–B3 in the plan in full before
starting — B1/B2's code sketches in the plan were flagged during planning
as needing the real `ExperienceGroundedSearchProvider` interface read
first, since it wasn't re-verified live during planning (unlike every other
claim in this plan, which was live-validated).

---

## Agent handoff rule

An implementation agent starting from this branch should:

1. Read this file's "Current state" block first. A1–A9, the 6 targeted
   resolver/matching fixes, and the addressHint follow-up are all
   COMPLETE and **pushed** to `fork/feat/preference-first-selection`
   (`1ba8c03`, `b2e52b6`, `6222565`). Beyond those, as of 2026-09-19
   there are 4 further commits still **local/unpushed**
   (`3f22626` docs, `f081da6` addressHint housenumber bugfix,
   `695cdb3` `acquireNearby` observations fix, `4f3c0a3` the critical
   observation-QID identity fix — see item 3 below) plus a pending
   docs-only commit for this section's own updates. Do not trust these
   hashes as current — always verify with
   `git log --oneline fork/feat/preference-first-selection..HEAD`
   yourself before assuming push state, since later local commits may
   exist unpushed by the time you read this. Never push without the
   user's explicit confirmation for that specific push, same as always.
2. Read, in order: `docs/superpowers/characterization/2026-09-18-task-a8-root-cause-5-live-remeasure.md`,
   this file's "DONE — Diagnosed A8's 0/9 result by hand..." section,
   `docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md`
   (Task A9, the 5 resolver/matching fixes, live-measured 8.3% -> 33.3%
   composite persistence, PLUS its own "Follow-up" sections covering the
   Recoleta Cemetery real-data verification and the addressHint
   live-measurement — read the whole file, not just the top),
   `docs/superpowers/characterization/2026-09-18-composite-materialization-architecture-review.md`
   (a larger proposed refactor, reviewed against real code, nothing
   implemented from it), and
   `docs/superpowers/characterization/2026-09-19-wikivoyage-poi-only-and-tripadvisor-feasibility.md`
   (Wikivoyage confirmed structurally POI-only; TripAdvisor via SerpAPI
   confirmed feasible on the existing paid account, not yet built).
3. **The confirmation gate itself (`confirmMatch`'s core strictness) was
   never relaxed this session** — every fix landed either gives the
   resolver a better/additional candidate to try (Places top-N,
   best-fuzzy-match, role=area->venue fallback) or a cheaper/additional
   way to confirm one using data the matched entity or its originating
   observation/evidence already declares (own name:xx/wikipedia tags,
   `SourceObservation.canonicalIdentity.wikidataQid`, addressHint) —
   never a loosened bar. **"Galería Güemes" is confirmed fixed at its
   root** (a candidate-SELECTION bug, not a confirmation-strictness one).
   **"Recoleta Cemetery" is verified with real data in a unit test (the
   general mechanism resolves it, no case-specific code) but still has
   NOT been re-confirmed by an actual fresh live run** — the next agent
   that sees it appear in a live run must still check its outcome by
   hand, same discipline as every other collision case in this document.
   **Important correction found the day after the initial 5 fixes landed
   (by the user, before anything was pushed):** the first version of the
   `SourceObservation.canonicalIdentity.wikidataQid` confirmation path
   (item 2 above) had a real soundness bug, not just a missing edge case
   — it proved `hint text == QID` (the source's own claim about the
   HINT), but never proved the OSM candidate the local fuzzy matcher
   actually picked was also that QID. A wrongly-matched candidate with
   no wikidata tag of its own (the real "Recoleta Cemetery" hint
   resolving to "Hotel Urban Suites Recoleta") could have been silently
   confirmed this way in production. Fixed in `4f3c0a3` by adding
   `confirmViaObservationWikidataTag`, which requires the same dual-check
   (hint strict, matched entity's own name default) that the
   geo-proximity path already used for an analogous reason since
   `2c2e412` (pre-existing before this session). **This fix was never
   live** — caught and fixed entirely within local, unpushed commits,
   before any push, so no production data was ever affected. See
   `docs/superpowers/characterization/2026-09-18-task-a9-live-remeasure-post-fixes.md`'s
   "Follow-up: a critical hole in the observation-QID check, found and
   fixed" section for the full writeup.
4. **Lesson from the item-3 correction, for any future new
   identity/confirmation signal added to `confirmMatch` (or anywhere in
   the resolver):** a happy-path unit test proving the signal works when
   everything lines up is not enough. Every new signal needs its own
   adversarial test that deliberately mismatches the signal's source
   from the actually-matched candidate (e.g. "the observation/tag
   correctly describes the HINT, but the local matcher picked a
   different, wrong real-world entity that the signal says nothing
   about") — otherwise this exact class of conflation bug (proving A
   implies B when it only proves A implies C) can pass review and ship.
   Apply this before trusting any future signal, not only wikidata QIDs.
5. `role` misclassification in the OPPOSITE direction from what this
   session fixed (a genuine neighborhood/area classified `role: "waypoint"`
   or `"venue"` instead of `"area"`) is real and measured — not yet
   designed or implemented.
6. `addressHint` (the 6th fix) is safe and correct but was live-measured
   to be used by the discovery LLM only once in 144 real hint
   opportunities — do not expect it to move the composite-persistence
   number on its own; grounded web evidence for typical tourist
   attractions rarely states a street address. Not a reason to revert it
   (it's additive and zero-risk), just don't oversell its impact.
7. Track B (TripAdvisor volume) has still not been started, but its
   feasibility is now confirmed (SerpAPI `engine=tripadvisor` /
   `engine=tripadvisor_reviews`, same paid account, structured JSON that
   could skip the discovery LLM entirely for basic POI data). Widening
   acquisition volume before item #5 above would mostly produce more
   noise to sort through, not more real composites — still lower
   priority. Whoever starts it must decide explicitly whether TripAdvisor
   content flattens to single-POI observations (safe, same pattern as
   Wikivoyage/Places today, but inherits Wikivoyage's own POI-only
   limitation) or routes through a new composite-aware path — read the
   real `ExperienceGroundedSearchProvider`/`SerpApiGroundedSearchService`
   interfaces first, not the plan's original (pre-this-session) sketch.
8. Severe host memory pressure repeatedly killed live-measurement runs
   this session (four times, unrelated to this app's own resource use —
   see the live-remeasure doc's "Aside" section). Before the next
   live-measurement-heavy session, consider running against a pre-built
   `dist/` instead of booting the full app through `ts-jest` each time —
   identified as a likely large memory/time win, not yet implemented.
9. The non-negotiable product requirement driving all of this: every
   persisted Experience's components must be geographically confirmed —
   never relax `confirmMatch`'s fail-closed behavior without the user's
   explicit direction, and never mark a case "fixed" without live
   re-verification, even when the code fix and its unit tests are solid.
