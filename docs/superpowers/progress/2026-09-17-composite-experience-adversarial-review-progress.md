# Composite Experience Acquisition — Adversarial Review + Fix Progress

Status: **Task 1 COMPLETE. Task 2 COMPLETE. Task 3 (re-measure) NOT STARTED.**
Written: 2026-09-17.
Branch: `feat/preference-first-selection`.

This is the current operational progress pointer for the composite-Experience
adversarial review requested independently of the M5–M10 package sequence
(`docs/superpowers/plans/2026-09-14-preference-first-m5-to-m10-master-implementation.md`).
It does not supersede that master plan's own pointer — this is a parallel,
self-contained diagnostic + fix effort that started from a live "0 composite
Experiences persisted" symptom report and produced its own spec/plan/progress
trio, the same convention `2026-09-13-pre-b6-gates-progress.md` uses.

Canonical documents for this effort:

- **Spec/diagnostic** (read this first — it is the evidence base every fix
  below cites): `docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md`
- **Implementation plan**: `docs/superpowers/plans/2026-09-16-composite-entity-resolution-and-extractor-fixes.md`

---

## Current state

```text
Adversarial characterization (6 themes, live Buenos Aires run)   COMPLETE
  Verdict: B — sound direction, 3 boundaries/contracts need real fixes
  Baseline: 8 composite candidates generated, 1 persisted (12.5%),
            16 unique entity resolutions, 8 false positives (50%)

Task 1 — extractor envelope-parsing fix                          COMPLETE
Task 2 — matchOsmCandidateByName specificity guards               COMPLETE
Task 3 — re-run characterization, measure delta                   NOT STARTED  <-- WE ARE HERE

Root Cause #3 (PLACES_PROVIDER=geoapify dead fallback)            DEFERRED (needs user cost/ToS decision)
Root Cause #4 (anchor-specific geographic scope narrowing)        DEFERRED (pending Task 3 measurement)
Root Cause #5 (Overpass resilience under sustained load)          DEFERRED (pending Task 3 measurement)
```

---

# DONE — Adversarial characterization (2026-09-15/16)

Ran a real, live, 6-theme (`history, food, culture, art, architecture,
nature` × `intent=walk`) characterization against Buenos Aires, using the
production services directly (`ExperienceAcquisitionPlannerService` →
`ExperienceAcquisitionService.executePlan` → `.materializeExecution` →
`ExperienceProposalResolverService.resolve` →
`CompositeGeographicValidationService.validate` →
`ExperienceClassificationService`), with `AI_PROVIDER=groq`,
`DISCOVERY_EXTRACTOR_PROVIDER=groq`, `CLASSIFICATION_PROVIDER=groq`,
`GROUNDED_SEARCH_PROVIDER=serpapi`, real Postgres, real local Overpass/
Nominatim. Mechanism: a temporary, never-committed nest-commander command
(`CharacterizeCompositeCommand`) added to `ScriptsModule`/`ToursModule`'s
DI graph, run via `yarn script characterize-composite`, then fully
reverted (`git checkout` on the two temporarily-modified module files,
command file deleted) — confirmed via `git status --short` showing zero
scaffolding left. `.env` provider values were also backed up and restored
to their prior values (`ollama`) afterward; the backend container was
recreated twice (once to switch to groq/serpapi, once to restore).

**No code was changed during this phase.** Full findings, funnel numbers,
source-by-source quality breakdown, entity-resolution false-positive
sample (16 unique resolutions, 50% false positive rate), and the ranked
Top 5 root causes are in the characterization doc above — not repeated
here. Verdict: **B** (sound direction, specific boundaries/contracts need
redesign — not A "just bugs", not C "over-engineered, redesign the whole
thing").

Raw run artifacts (full JSON funnel per theme, 30-hint provider trace
against live Nominatim/Overpass) are session-local, not in the repo:
`/private/tmp/.../scratchpad/characterization/` of the originating session
— not reproducible from the repo alone, only the aggregated findings in
the characterization doc are durable.

---

# DONE — Task 1: extractor envelope-parsing fix

Plan: `docs/superpowers/plans/2026-09-16-composite-entity-resolution-and-extractor-fixes.md`, Task 1.

**Commit:** `bccfab7` — `fix(discovery-extraction): recover bare-object extractor response instead of silently discarding it`

## What was found and fixed

Root Cause #1 from the characterization: Groq (`response_format:
{type:'json_object'}`, no enforced JSON schema — unlike Gemini/Ollama,
which both pass `buildDiscoveryResponseJsonSchema()`) sometimes returns a
single candidate object directly instead of the documented
`{"candidates":[...]}` envelope. `extractExperienceCandidates` treated
that shape as `entries = []` — **zero candidates, zero
`validationErrors`, completely silent.** Confirmed against the exact raw
output captured live during the characterization run: the "history"
theme's web query returned real SerpAPI evidence, Groq correctly
extracted a real "San Telmo Colonial Walking Tour" candidate (San Telmo
Market + Lezama Park, both evidence-backed), but it never reached
`extractedCandidateCount` because of this exact shape mismatch.

**Fix** (`be/src/modules/tours/utils/experience-candidate-extraction.util.ts`):
new `normalizeExtractorEnvelope(raw)` helper — array passthrough, then
`{candidates:[...]}` unwrap (existing behavior), then a new third branch:
a bare object with `typeof name === 'string' && Array.isArray(componentHints)`
is wrapped as a 1-item envelope, and the repair is always reported via
`validationErrors` (`'extractor_envelope_repaired: ...'`) — this already
flows unchanged into `WebAcquisitionResult.validationErrors`
(`executeWebSourcePlan` in `experience-acquisition.service.ts`), so no new
plumbing was needed for it to become trace-observable.

Provider-agnostic by construction (checks the two fields every real
candidate must have — `name`, `componentHints` — never a provider name or
candidate-name check). Verified it protects Gemini/Ollama too even though
their schema enforcement makes the drift less likely for them in practice
(see the plan's "current real state" note).

## TDD evidence

RED confirmed first (`yarn test src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`):
new test failed with `Expected length: 1, Received length: 0`, the exact
predicted failure. GREEN after the fix: 7/7 in that file. Regression
check against the three real discovery-extractor providers plus the
acquisition service: `groq-discovery.provider.spec.ts`,
`gemini-discovery.provider.spec.ts`, `ollama-discovery.provider.spec.ts`,
`experience-acquisition.service.spec.ts` — **38/38 green**, no behavior
change for any existing caller. `yarn typecheck` / `yarn lint:check`
clean.

## Files changed

- `be/src/modules/tours/utils/experience-candidate-extraction.util.ts`
- `be/src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`

## Deviations from the plan

None. Implemented exactly as specified in the plan's Task 1 Step 3.

---

# DONE — Task 2: local OSM name-matching specificity guards

Plan: `docs/superpowers/plans/2026-09-16-composite-entity-resolution-and-extractor-fixes.md`, Task 2.

**Commit:** `7469619` — `fix(entity-resolution): require specific token overlap in local OSM name matching, not raw substring containment`

## What was found and fixed

Root Cause #2 from the characterization: `matchOsmCandidateByName` used
unguarded bidirectional substring containment
(`haystack.includes(needle) || needle.includes(haystack)`). Confirmed live
across one characterization run: a single mistagged OSM node named `"B"`
was accepted as the identity of **four distinct real Buenos Aires
landmarks** (MALBA Museum, La Bombonera, Museo Nacional de Bellas Artes,
MALBA again in a separate candidate) purely because the letter "B"
appears inside each hint's name. Same pattern for `"MO"` matching
"Mercado de San Telmo" (the original bug report that triggered the whole
characterization), `"CE"` matching "Centro Científico Tecnológicos", and
`"Iglesia"` (a generic Spanish word, "church") matching "Iglesia San
Ignacio de Loyola" — the real church is ~8km from where that generic-named
node actually is. 8 of 16 unique entity resolutions in the characterization
sample (50%) were false positives of this kind.

**Fix** (`be/src/modules/tours/utils/nominatim-match.util.ts`): new
`hasSpecificNameOverlap(needle, haystack)` — exact equality always
accepted (regardless of length, never a false positive); anything short of
exact equality must clear the same token-overlap bar `bestNominatimMatch`'s
existing fuzzy path already uses for the *global* Nominatim search results
(≥50% of the hint's significant [≥4-char] tokens matched, with at least
one matched token ≥5 chars) — applied here to the *local* Overpass pool,
which had none of these guards before. `matchOsmCandidateByName` now
delegates to this helper instead of the old raw substring check.

## TDD evidence

RED confirmed first (`yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`):
the 2 new false-positive-reproduction tests failed exactly as predicted
(`"B"`/`"Iglesia"` matched today); the regression-guard test ("must not
become too strict") already passed before the fix, as expected. GREEN
after the fix: 40/40 in that file. Regression check against the only real
caller, `experience-proposal-resolver.service.spec.ts` — **33/33 green**;
every pre-existing positive-match fixture in that file uses exact string
equality (`"Plaza Dorrego"` ↔ `"Plaza Dorrego"`, `"Museum"` ↔ `"Museum"`,
etc.), which the new logic's first branch always accepts regardless of
length, so none of them could regress. `yarn typecheck` clean; one
prettier formatting error surfaced by `yarn lint:check` in the new test
file, fixed via `yarn lint --fix` and reverified (73/73 across both spec
files after the autofix).

## Files changed

- `be/src/modules/tours/utils/nominatim-match.util.ts`
- `be/src/modules/tours/utils/nominatim-match.util.spec.ts`

## Deviations from the plan

None. Implemented exactly as specified in the plan's Task 2 Step 3.

---

# NEXT — Task 3: re-run the characterization, measure the real delta

Read `docs/superpowers/plans/2026-09-16-composite-entity-resolution-and-extractor-fixes.md`'s
Task 3 in full before running. In short: repeat the exact same 6-theme
Buenos Aires characterization methodology from the 2026-09-15 review
(temporary, never-committed `characterize-composite` command; same
provider env; same revert discipline afterward), and compare against the
baseline numbers already recorded above and in the characterization doc:

```text
composite candidates generated:        8
composite candidates persisted:        1   (12.5%)
unique entity resolutions:            16
false positives:                       8   (50%)
```

Do not declare success qualitatively — use the same counting method
(§4's aggregation over `full-results.json`) and report the same 4 numbers
for the new run in a new dated file under `docs/superpowers/characterization/`.

This measurement is what decides whether Root Causes #3–#5 (deferred, see
below) are still worth doing, per the characterization doc's own §20
recommendation — do not decide that without it.

---

## Deferred — not started, and why

- **Root Cause #3** (`PLACES_PROVIDER=geoapify` makes the Google-Places
  venue-resolution fallback a complete no-op): switching provider has real
  cost and Google Terms-of-Service implications for how long place data
  may be persisted. Needs an explicit business decision from the user
  before any code change — not something to decide unilaterally.
- **Root Cause #4** (feed the resolver the already-resolved anchor scope,
  e.g. San Telmo AREA, instead of always the whole destination boundary):
  requires threading `resolvedAnchors` through orchestration
  (`ExperienceGenerationService` → `ExperienceAcquisitionService.materializeExecution`
  → the resolver's existing-but-currently-unused-for-this-path
  `validationScope` parameter) — bigger blast radius than the two isolated
  util fixes above. Explicitly deferred until Task 3 shows whether it's
  still needed once #1/#2 are in.
- **Root Cause #5** (local Overpass returning 0 POIs for all of Buenos
  Aires under sustained sequential load, observed live): infrastructure
  retry/circuit-breaker work, independent of the two code fixes above.
  Same reasoning — measure first.

---

## Agent handoff rule

An implementation agent starting from this branch should:

1. Read the characterization doc in full — it is the evidence base for
   everything below, not just a summary.
2. Task 1 and Task 2 are COMPLETE and committed locally (`bccfab7`,
   `7469619`) — **not yet pushed** to `fork` as of this writing; check
   `git log --oneline fork/feat/preference-first-selection..HEAD` before
   assuming push state, don't trust a stale summary of it.
3. Next is **Task 3** (re-run the characterization, measure the delta) —
   read the plan's Task 3 section in full before running it; it repeats a
   real, live, costed run against Groq/SerpAPI, not a mocked test.
4. Do not start Root Causes #3/#4/#5 without explicit new authorization —
   #3 specifically needs a product/cost decision from the user, not a
   unilateral code change.
5. This effort is independent of the M5–M10 master plan's package
   sequence (`docs/superpowers/plans/2026-09-14-preference-first-m5-to-m10-master-implementation.md`).
   Do not assume it blocks or is blocked by that plan's own current
   package unless a concurrent session's commits say otherwise — refetch
   `fork` and re-check before continuing either effort.
