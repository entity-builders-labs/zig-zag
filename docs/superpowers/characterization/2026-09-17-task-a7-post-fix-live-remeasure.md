# Task A7 — Live Re-measurement With A5+A6+Final-Review-Fix Live

Ran per `docs/superpowers/plans/2026-09-17-confirmation-collision-fix-and-anchor-scope-narrowing.md`,
Task A7. Same 6-theme (`history, food, culture, art, architecture, nature` ×
`intent=walk`) live Buenos Aires methodology as Tasks A4/Task 3, now with
Task A5 (stricter confirmation-only token bar), Task A6 (local-pool
narrowing to a resolved AREA anchor), and the final-review fix round
(commit `2c2e412` — entity-identity check tying Wikidata corroboration to
the actually-matched entity, not just the hint) all live. `AI_PROVIDER=groq`,
`DISCOVERY_EXTRACTOR_PROVIDER=groq`, `CLASSIFICATION_PROVIDER=groq`,
`GROUNDED_SEARCH_PROVIDER=serpapi`, `PLACES_PROVIDER=geoapify`, real
Postgres, real local Overpass/Nominatim. Mechanism: temporary,
never-committed `characterize-composite` command, fully reverted afterward
(confirmed via `git status --short` showing zero scaffolding left, `.env`
restored to its prior `ollama` values).

## Headline numbers

```text
raw candidates fed to resolver:              26
composite candidates generated (>=2 hints):  11
composite candidates persisted:               2   (18.2%)
ANY candidate persisted (POI or composite):   2

Component-hint outcomes (unresolved only):
  OSM_QUERY_EMPTY:      21   (known infra flakiness, Root Cause #5, still deferred/unaddressed)
  UNCONFIRMED_MATCH:    13
  NO_OSM_MATCH:          8

Candidate-level rejection reasons:
  NO_OSM_MATCH:                    9
  OSM_QUERY_EMPTY:                 9
  UNRESOLVED_REQUIRED_COMPONENT:   3
  destination_mismatch:            3
```

**2 composite Experiences persisted this run — the first non-zero
composite-persistence result across every characterization run this
session** (Task 3's re-run: 0; Task A4: 0/7; this run: 2/11). This is not
proof the pipeline is now reliably productive (see the infra-flakiness
caveat below), but it is the first live evidence the fixed pipeline can
produce a fully-resolved, fully-confirmed, multi-component Experience at
all.

## The two accepted composites — spot-checked

**"Buenos Aires Historic Center Tour"** (3 required hints, all EXACT
matches — auto-confirmed without needing Wikidata at all, per
`confirmMatch`'s exact-match shortcut):
- "Casa Rosada" → "Casa Rosada"
- "Catedral Metropolitana" → "Catedral Metropolitana"
- "Cabildo de Buenos Aires" → "Cabildo de Buenos Aires"

Unambiguous, iconic, single-identity landmarks — low collision risk by
construction (no generic/shared token drove the match).

**"Retiro & Recoleta Sophisticated Circuit"** (4 required hints):
- "Plaza San Martín" → "Plaza San Martin" (exact, diacritic-only difference)
- "Museo Nacional de Bellas Artes" → same (exact)
- "Floralis Genérica" → same (exact)
- "Kavanagh Building" → "Edificio Kavanagh" — **the interesting one**: a
  genuine FUZZY, translated match that had to pass BOTH the hint-token
  check and the new (final-review fix round 1) entity-identity check
  against real Wikidata corroboration, and did. "Kavanagh" is a specific,
  unique surname (not a generic neighborhood/hero name like "Recoleta"/
  "Güemes"), so this is a real, live, positive-path confirmation that the
  Round 1 fix does not needlessly block a legitimate translated match when
  the identifying token is genuinely specific — exactly the design intent.

No signs of a wrong identity in either accepted composite.

## The two original real bugs, re-checked live

**Bug #2 ("Galería Güemes" → "Martín Miguel de Güemes", a monument):
CONFIRMED FIXED, consistently.** Across every theme run where the local
OSM pool actually returned data (3 of 5 occurrences — history, art,
nature), the hint now correctly lands on `UNCONFIRMED_MATCH` instead of
silently resolving to the wrong monument. Zero occurrences of it wrongly
resolving this run — a clean, consistent result everywhere the logic
actually executed. (The other 2 occurrences — culture, architecture — hit
`OSM_QUERY_EMPTY` before ever reaching the matching stage, an unrelated
infra concern, not a matching/confirmation outcome either way.)

**Bug #1 ("Recoleta Cemetery" → a hotel): INCONCLUSIVE this run, not
disproven.** The hint appeared twice (in "Recoleta Museum & Monument
Trail" and "Recoleta Architecture & Museum Tour", both in the `culture`
theme), and both times the LOCAL OSM POOL QUERY ITSELF returned
`OSM_QUERY_EMPTY` before matching/confirmation ever ran — the same Root
Cause #5 infra flakiness this session has repeatedly observed, unrelated
to and not fixed by this plan. This run therefore did not exercise the
specific collision this plan's final-review fix targeted. This is **not**
evidence the fix doesn't work — the fix was verified by hand against the
real Wikidata SPARQL endpoint during the final review, and by a dedicated
TDD regression test reproducing the exact scenario (`experience-proposal-resolver.service.spec.ts`,
final-review fix round 1, commit `2c2e412`) — but it is not yet
independently re-confirmed by a live end-to-end run, and that gap should
be closed by a future run once Overpass reliability (Root Cause #5) stops
masking it.

## Other observations

- **`destination_mismatch`** appeared for two otherwise-exact-matched
  candidates ("Iglesia San Ignacio de Loyola" alone; "San Telmo" + "Teatro
  Colón" together) — this is `CompositeGeographicValidationService`'s own,
  separate destination-scope/coherence check, unrelated to entity
  resolution or this plan's tracks. Not investigated further here.
- **`OSM_QUERY_EMPTY` (21 hint-level occurrences, up from Task A4's 6)** —
  Root Cause #5 (Overpass reliability under load) is not just still open,
  it dominated this run's losses more than in any prior run this session.
  This is now the single largest loss category by far and should be the
  next priority if the goal is raising the composite-persistence rate
  further — Task A6's narrower per-anchor queries did not, on their own,
  fix Overpass's own reliability under sustained sequential load.
- **`NO_OSM_MATCH` for "Centro Científico Tecnológicos."`** (4/6 themes) —
  same known, expected, honest loss as every prior run (Task 2's fix
  correctly finds no match at all instead of a wrong one).

## Verdict

The two real, live-verified false-positive collisions this plan set out to
close: one (Güemes) is confirmed fixed live, consistently, everywhere it
was exercised. The other (Recoleta) remains fixed by code/test evidence
but was not re-exercised live this run due to unrelated infra flakiness.
Given the entity-identity fix is symmetric (it applies to every fuzzy
confirmation, not a hint-specific rule), and the Güemes case *is*
live-confirmed, there is no specific reason to doubt the Recoleta case
would also hold — but per this project's own discipline (live-verify before
declaring a live behavior fixed, not just from unit tests), this should be
called out honestly rather than silently assumed. Recommend a future,
short, targeted live check once Overpass is stable enough to reliably
return the Recoleta-area POI pool (or a synthetic Overpass fixture that
reproduces just this one query, since a live Overpass outage should not
indefinitely block re-verifying a specific, already-understood case).

Composite persistence went from 0/7 (Task A4) to 2/11 (18.2%) this run —
real, non-zero, and consistent with the plan's own expectation ("expect
this to be lower yet again in raw count... while being qualitatively
trustworthy for the first time" from Task A4's own instructions, now
looking directionally correct: no known false-positive class present in
either persisted result). Root Cause #5 (Overpass reliability) is now the
clearest remaining lever for raising this further — Root Cause #4
(anchor-scope narrowing, Task A6) is done; #5 is not.

## Raw data

Full per-theme JSON (`task-a7-full-results.json`) and run log (`run.log`)
are session-local, not committed to the repo — not reproducible from the
repo alone, only this report's aggregated findings are durable.
