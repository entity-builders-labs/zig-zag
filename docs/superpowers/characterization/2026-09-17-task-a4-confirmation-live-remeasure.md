# Task A4 — Re-measurement With Cross-Source Confirmation Live

Ran per `docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md`,
Task A4. Same 6-theme (`history, food, culture, art, architecture, nature` ×
`intent=walk`) live Buenos Aires methodology as the 2026-09-15 review and its
2026-09-16-plan Task 3 re-run, with Task A3's confirmation gate (commit
`673a556`) live. `AI_PROVIDER=groq`, `DISCOVERY_EXTRACTOR_PROVIDER=groq`,
`CLASSIFICATION_PROVIDER=groq`, `GROUNDED_SEARCH_PROVIDER=serpapi`,
`PLACES_PROVIDER=geoapify`, real Postgres, real local Overpass/Nominatim.
Mechanism: temporary, never-committed `characterize-composite` command
(`ScriptsModule`/`ToursModule` reverted afterward via `git checkout`,
command file deleted, `.env` restored — confirmed via `git status --short`
showing zero scaffolding left afterward).

## Headline numbers

```text
raw candidates fed to resolver:              22
composite candidates generated (>=2 hints):   7
composite candidates persisted:               0   (0%)
ANY candidate persisted (POI or composite):   0   (0%)
unique resolved entities (by geoEntityId):   17
resolved entity mentions (not deduped):      20

Component-hint outcomes (unresolved only):
  UNCONFIRMED_MATCH:    9   <- NEW category, direct product of Task A3
  NO_OSM_MATCH:         6
  OSM_QUERY_EMPTY:      6   (known infra flakiness, Root Cause #5, deferred)

Candidate-level rejection reasons:
  NO_OSM_MATCH:                    8
  UNRESOLVED_REQUIRED_COMPONENT:   7
  AMBIGUOUS_DEDUPE:                4   (unrelated to Task A3 — see below)
  OSM_QUERY_EMPTY:                 2
  destination_mismatch:            1
```

**0 composite Experiences persisted** — same headline number as the very
first baseline (though that one was 1/8, not 0/7). This is NOT simply "no
improvement, revert": read the rest of this report before drawing that
conclusion. The story is materially different once you look at *which*
entities were being persisted before and would be blocked now.

## Critical finding — confirmation reusing the matching rule lets a real false-positive class through

**This is the headline finding of this run and the reason Track A is not
being marked complete.** Two of the 17 uniquely-resolved entities that
reached `status: 'resolved'` (i.e., Task A3 treated them as fully
confirmed — either exact match, or fuzzy match + Wikidata corroboration)
are **wrong identities**:

| Hint | Wrongly matched to | Real thing the hint means |
|---|---|---|
| "Recoleta Cemetery" | "Hotel Urban Suites Recoleta" (a hotel) | Cementerio de la Recoleta |
| "Galería Güemes" | "Martín Miguel de Güemes" (a monument to the historical general) | The 1915 Galería Güemes shopping arcade on Florida St. |

Both are real places in Buenos Aires' Overpass/Nominatim data — this is
not a hallucinated candidate. The resolver's local-pool match
(`matchOsmCandidateByName`/`hasSpecificNameOverlap`) is *designed* to
accept these as candidate matches: each hint shares exactly one
sufficiently-specific token with the wrong entity's name (`"recoleta"`,
`"güemes"`) and clears the ≥50%-of-tokens / ≥1-token-≥5-chars bar. That
part is expected, tolerated permissiveness (translation/substring
matches must stay possible) — **Task A3 exists specifically to catch
this class via independent confirmation before persistence.**

It did not catch it, live-verified against the real Wikidata SPARQL
endpoint (not simulated):

```text
$ curl .../sparql with wikibase:around around Martín Miguel de Güemes' real coordinates area
→ Wikidata really does have a distinct entity "Martín Miguel de Güemes" (Q111695025) nearby
```

Both "Recoleta" and "Güemes" are common Argentine place/hero names —
Recoleta is an entire neighborhood with dozens of independently-real
"Recoleta"-labeled Wikidata entities, and Martín Miguel de Güemes is a
national independence hero whose name genuinely appears on many separate
streets/monuments across the country. `confirmMatch`'s fuzzy branch calls
`this.wikidata.findNearbyPlaces(matchedEntity.lat, matchedEntity.lon,
200)` — i.e. it searches **around the coordinates of the entity that was
(possibly wrongly) matched**, not around any independently-known-correct
location — and then reuses the exact same `hasSpecificNameOverlap` rule to
decide if any nearby Wikidata place's label corroborates it. When the
*wrong* matched entity happens to sit near *some other* real place sharing
the same one generic token, that nearby real place is accepted as
"independent confirmation" of an identity it says nothing about. **The
confirmation is only independent of the local match's provider (OSM vs.
Wikidata) — it is not independent of the local match's specific (possibly
wrong) coordinates, and it reuses a token rule that was tuned for finding
plausible candidates, not for ruling out same-name-different-place
collisions.**

This directly matters for the user's stated non-negotiable requirement
("experiencias 100% confirmadas geográficamente") — as built today, Task
A3 does not yet deliver that guarantee for this specific, real,
reproducible collision class (a hint sharing exactly one neighborhood-name
or historical-figure-name token with an unrelated nearby entity).
**Recommendation: do not mark Track A's confirmation guarantee complete
without a follow-up task tightening this.** Concrete options for that
follow-up (not implemented here — this run is measurement only, per the
plan's Task A4 scope):
- Require a *stricter* token-overlap threshold for confirmation than for
  matching (e.g. all of the needle's significant tokens, not ≥50%) — the
  plan's Global Constraint said reuse the same policy for both; this
  evidence is the concrete counter-case that constraint didn't anticipate.
- Or bound confirmation by proximity to the *hint's own* independently
  resolved area/anchor (when one exists) rather than only the matched
  entity's own coordinates, so a wrong match "confirming itself" via a
  same-neighborhood coincidence is structurally harder.

## The `UNCONFIRMED_MATCH` cases — spot-checked individually, live

Per the plan's own instruction ("was it a real, previously-undetected
wrong match, or an accepted honest loss — do not treat this as a bug to
fix by loosening the gate"), each distinct hint that hit
`UNCONFIRMED_MATCH` was checked against the real Wikidata endpoint
(`unconfirmedEntity` deliberately strips the matched entity's own
coordinates before persistence, so this used independently-known real
coordinates for each landmark, not data recovered from the run):

- **"Paz Palace" (Palacio Paz)** — live SPARQL around Palacio Paz's real
  coordinates confirms Wikidata has it, with English label literally
  `"Palacio Paz"`. The hint's only ≥4-char token is `"palace"` (`"paz"` is
  3 chars, filtered) — `"palace"` never appears in the Spanish label
  `"palacio paz"`. **Honest loss, but caused by a rule gap, not a coverage
  gap**: an English translation of a Spanish name with no shared literal
  token can never confirm under the current rule, however correct the
  underlying match is.
- **"MALBA"** — live SPARQL around MALBA's real coordinates confirms
  Wikidata has it (Q1808336), labeled `"Museum of Latin American Art of
  Buenos Aires"` — the acronym `"MALBA"` never appears in that label.
  **Same rule-gap class as Paz Palace**: acronym-only hints can't confirm
  against a spelled-out Wikidata label even when it is the correct entity.
- **"Monumental Tower" (Torre Monumental)** — live SPARQL around the real
  Torre Monumental confirms Wikidata's English label is literally `"Torre
  Monumental"`, which **does** share a token (`"monumental"`, ≥5 chars)
  with the hint and should pass `hasSpecificNameOverlap`. Since this one
  still failed to confirm, the likely explanation is the underlying
  OSM/Nominatim match this run pointed to a different coordinate entirely
  (a real catch, not a rule gap) — `unconfirmedEntity` stripping the
  matched coordinates before persistence means this can't be fully
  disambiguated from this run's data alone; flagging as an instrumentation
  gap worth fixing in a future characterization run (e.g. a debug-only
  side channel logging the pre-confirmation candidate).
- **"Iglesia San Ignacio de Loyola"** (4/6 themes) — this is the plan's own
  cited real regression case (`"San Ignacio Church" -> "Ignacio
  Pirovano"`). Task 2's specificity guard already blocks the naive generic
  "Iglesia" match; without an exact match and without Wikidata corroborating
  whatever the fuzzy local candidate was this time, it now correctly lands
  as "cannot confirm" instead of silently persisting a possibly-wrong
  match — this is Task A3 working as designed, an accepted honest loss
  (interestingly, one run — architecture theme — *did* get an exact match
  for this same hint and passed straight through, showing the underlying
  extraction/matching path is not fully deterministic run to run).
- **"Calle Defensa"**, **"Riachuelo"** — not individually live-verified in
  this pass (time-boxed); same category as the above, flagged for a future
  pass rather than asserted either way.

## Other rejection reasons — confirmed unrelated to Task A3

- **`AMBIGUOUS_DEDUPE`** (4 occurrences, all "Galería Güemes" candidates
  across different themes) — this fired at the *persistence/dedupe* layer,
  after entity resolution had already (wrongly, see above) marked the
  entity `resolved`. It is a side effect of running the same
  theme-independent Wikivoyage-sourced single-place candidate 6 times in
  one DB session (each run's candidate looks similar enough to the
  previous run's to trip dedupe ambiguity) — an artifact of this
  characterization methodology re-using one live database across themes,
  not a Task A3 regression.
- **`NO_OSM_MATCH` for "Centro Científico Tecnológicos."`** (5/6 themes) —
  this is the *original* review's cited false-positive case ("CE" matched
  "Centro Científico Tecnológicos") — Task 2's fix (already shipped,
  `7469619`) means this hint now correctly finds no match at all instead
  of a wrong one. An honest loss, and expected.
- **`OSM_QUERY_EMPTY`** (6 hint-level, 2 candidate-level) — the
  already-known, already-deferred Root Cause #5 (local Overpass returning
  empty under load), unrelated to this plan's tracks.
- **`destination_mismatch`** (1) — `CompositeGeographicValidationService`'s
  own separate destination-scope check, unrelated to entity-resolution
  confirmation.

## Verdict

Task A3's confirmation gate is doing real, verifiable work — it
successfully suppresses the exact regression case the plan was written
around ("San Ignacio Church" → "Ignacio Pirovano"-style wrong matches now
default to "cannot confirm" instead of silently persisting) — but this
live run surfaced a **second, previously-unknown false-positive class**
(same-token neighborhood/historical-figure-name collisions) that the
current confirmation rule does not catch, because it reuses the matching
rule's permissiveness and searches around the *matched* entity's own
(possibly wrong) coordinates rather than an independently-trusted anchor.
**Per the user's stated non-negotiable requirement, this must be closed
before Track A can be considered to deliver "100% geographically
confirmed" in practice.** Recommend a follow-up task (see options above)
before moving to Track B or declaring Track A's product guarantee met.

Do not react to the 0% persistence rate by loosening `confirmMatch` — per
the plan's own instruction, a lower raw number is the expected, correct
trade-off of a real confirmation gate; the corrective work needed here is
tightening the gate further (closing the same-token-collision hole), not
relaxing it.

## Raw data

Full per-theme JSON (`task-a4-full-results.json`) and run log
(`run.log`) are session-local under this session's scratchpad directory,
not committed to the repo — not reproducible from the repo alone, only
this report's aggregated findings and the specific Wikidata SPARQL
verifications quoted above (independently re-runnable against the live
endpoint) are durable.
