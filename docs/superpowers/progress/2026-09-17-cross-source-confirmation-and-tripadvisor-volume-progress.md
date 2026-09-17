# Cross-Source Confirmation + TripAdvisor Volume — Progress

Status: **Track A: A1, A2, A3 COMPLETE. A4 (re-measure) NOT STARTED. Track B: NOT STARTED.**
Written: 2026-09-17.
Branch: `feat/preference-first-selection`.

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
  A4 — re-measure (Task 3 pattern) with confirmation live  NOT STARTED  <-- WE ARE HERE

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

# NEXT — Task A4: re-measure with confirmation live

Read the plan's Task A4 section in full before running. In short: repeat
the same characterization methodology used for the prior plan's Task 3
(temporary, never-committed `characterize-composite` command; same
provider env; same revert discipline afterward) against Buenos Aires, now
with Task A3's confirmation gate live and a real Wikidata path wired in.
Report:
- How many candidates hit `UNCONFIRMED_MATCH` (fuzzy match, no independent
  corroboration) vs. resolved cleanly (exact, or fuzzy+confirmed).
- The new composite-Experience persistence count/rate, compared against
  the prior plan's baseline (8 candidates generated, 1 persisted before any
  fix; measure what Task 3's SerpAPI-timeout + Geoapify fixes alone
  achieved, if that number isn't already recorded, then the delta from A3).
- Whether the confirmation gate's fail-closed behavior is actually
  starving real, correct matches (Wikidata coverage was measured at 77.9%
  on a 95-title independent sample, not 100% — some real fuzzy matches
  will legitimately fail to confirm and must be reported as such, not
  treated as a bug).

This measurement is what should decide whether Track B (more acquisition
volume) is worth doing before or after further Track A tuning, though the
plan states the two tracks are independent and don't block each other.

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

1. Read this file's "Current state" block first, then the plan
   (`docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md`)
   section for whichever task is next.
2. A1/A2/A3 are COMPLETE and committed locally (`4d408a1`, `48cdf21`,
   `673a556`) — **not yet pushed** to `fork` as of this writing; check
   `git log --oneline fork/feat/preference-first-selection..HEAD` before
   assuming push state, don't trust a stale summary of it. Never push
   without the user's explicit confirmation for this push specifically.
3. Next is **Task A4** (re-measure) — a real, live, costed run against
   Groq/SerpAPI/Wikidata, not a mocked test. Read the plan's Task A4
   section in full before running it.
4. Track B has not been started and needs the real
   `ExperienceGroundedSearchProvider` interface read (not assumed from the
   plan's sketch) before implementing B1.
5. The non-negotiable product requirement driving this whole plan: every
   persisted Experience's components must be geographically confirmed —
   never relax `confirmMatch`'s fail-closed behavior to make a fixture or
   a characterization number look better.
