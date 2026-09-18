# Cross-Source Confirmation + TripAdvisor Volume — Progress

Status: **Track A: A1–A4 COMPLETE (this plan). A5, A6, A7 COMPLETE under a
separate follow-up plan — see below — which closed the real confirmation
gap A4 found AND a second gap its own final code review found. First
non-zero composite-persistence result of the whole session (2/11, 18.2%).
Root Cause #5 (Overpass reliability) is now the clearest remaining lever
and is NOT yet started. Track B: NOT STARTED, still deprioritized behind
product-correctness work by priority (not a technical dependency).**
Written: 2026-09-17.
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
       persisted, first non-zero result all session   <-- WE ARE HERE
  Root Cause #5 (Overpass reliability under load)          NOT STARTED — now the
       clearest remaining lever, dominated A7's losses (21
       hint-level OSM_QUERY_EMPTY, the largest category)

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

1. Read this file's "Current state" block first. A1–A7 across both plans
   (`2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md` for
   A1–A4, `2026-09-17-confirmation-collision-fix-and-anchor-scope-narrowing.md`
   for A5–A7) are ALL COMPLETE and committed locally
   (`4d408a1`, `48cdf21`, `673a556`, `1f41251`, `9b1c86d`, `2c2e412`) —
   **not yet pushed** to `fork` as of this writing; check
   `git log --oneline fork/feat/preference-first-selection..HEAD` before
   assuming push state, don't trust a stale summary of it. Never push
   without the user's explicit confirmation for this push specifically.
2. Read `docs/superpowers/characterization/2026-09-17-task-a7-post-fix-live-remeasure.md`
   in full before doing anything else — it's the current real state: 2/11
   composites persisted live, no known false-positive identity in either,
   but one of the two original bugs ("Recoleta Cemetery") was not
   re-exercised live this run (infra masked it) and should be explicitly
   re-attempted once Overpass is stable, not assumed fixed just because
   its sibling case ("Galería Güemes") was live-confirmed.
3. **Root Cause #5 (Overpass reliability under sustained load) is now the
   clearest, highest-priority remaining lever** — it dominated A7's losses
   (21 of the run's hint-level failures, the largest single category,
   larger than in any prior run this session). This was already identified
   in the original 2026-09-15 adversarial review and has never been
   addressed. Consider it before Track B: more acquisition volume on top
   of an unreliable local-data provider mostly produces more
   infra-flakiness losses, not more real composites.
4. Track B (TripAdvisor volume) has still not been started, and by product
   priority should keep waiting behind correctness/reliability work — there
   is no technical dependency forcing this order, but widening the top of
   a funnel that's currently losing the most to infra flakiness (not to
   candidate scarcity) isn't the highest-leverage next move.
5. Track B, whenever it starts, needs the real
   `ExperienceGroundedSearchProvider` interface read (not assumed from the
   plan's sketch) before implementing B1.
6. The non-negotiable product requirement driving all of this: every
   persisted Experience's components must be geographically confirmed —
   never relax `confirmMatch`'s fail-closed behavior (now two independent
   checks: hint-tokens AND matched-entity-tokens, both against the same
   corroborating place), and never mark this requirement "met" for a case
   that hasn't actually been live-re-verified, even when the code fix and
   its unit tests are solid.
