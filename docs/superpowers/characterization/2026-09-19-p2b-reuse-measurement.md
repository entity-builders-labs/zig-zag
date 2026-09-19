# P2-B (trusted-observation reuse) — coverage and incremental-recovery measurement

Live measurement of the P2-B Phase 1 mechanism committed separately
(`f2a871e`, "reuse trusted place observations during entity resolution").
This document answers one question only: **does the mechanism actually fire
often enough, on real acquisition data, to matter** — not whether it is
implemented correctly (that was verified with unit tests + a live
functional check before commit).

## Methodology

For each of the same 6 themes used throughout this branch's live
measurements (`history, food, culture, art, architecture, nature` ×
`intent=walk`, destination "Buenos Aires, Argentina"):

1. Acquire REAL candidates + observations once via
   `ExperienceAcquisitionService.executePlan` — real SerpAPI grounded
   search, real LLM extraction, real Geoapify structured search (a
   `google_places` source plan resolves to the active Geoapify backend, per
   `PLACES_PROVIDER=geoapify`).
2. Call `ExperienceProposalResolverService.resolve()` **twice** on the
   exact same already-acquired request (same candidates, same
   observations, same evidence):
   - once normally ("real" — P2-B active, the actual committed behavior);
   - once with `resolveViaTrustedObservation` monkey-patched to always
     return `undefined` ("shadow" — P2-B disabled, everything else
     identical).
3. Reuse-outcome counters (attempts/rejections) are read off the
   resolver's own already-committed `[P2-B]` debug log lines, intercepted
   for the duration of the "real" call only.

Discovery/acquisition — the expensive, LLM-non-deterministic part — runs
only **once** per theme; only the resolution step (cheap, and
deterministic given fixed input) is doubled. This isolates P2-B's effect
from LLM run-to-run variance, at the cost of doubling live Nominatim/
Overpass/Places/Wikidata calls for the resolution step specifically.

Went through the harness in a 1-theme smoke test first (per plan), then
the remaining 5. `food` and `culture` returned zero web candidates on
their first sampling (LLM/grounded-search discovery yielded nothing that
run — a real, already-documented acquisition-volume characteristic of this
branch, not a harness bug) and were re-sampled; both samples are included
below rather than discarded, since more real data is strictly better than
less. Total: 8 acquisition samples across the 6 themes.

**A methodological correction made mid-run, worth flagging explicitly**: the
first version of the incremental-recovery diff counted ANY hint whose
resolved/unresolved status differed between the real and shadow call. Live
data caught this immediately — one hint (`"1st Synagogue of Buenos Aires"`,
theme `culture`) flipped between the two calls with **zero** P2-B reuse
activity anywhere in its chain (no `[P2-B] reuse candidate acquired` line
for it at all). Since the "real" and "shadow" calls each independently hit
live external APIs (Wikidata's geo-proximity confirmation, in particular)
moments apart, a flip can be pure network/timing noise, not a P2-B effect.
Fixed before continuing: incremental recovery now counts **only** hints
where the real run's resolved entity's `externalId` matches exactly what
a logged `[P2-B] reuse candidate acquired` line produced for that same
hint. The unattributed-flip case is tracked separately
(`rawUnattributedFlips`) and never counted as recovery.

## Results (aggregated across all 8 samples)

| Metric | Value |
|---|---|
| Total web component hints | 35 |
| Hints with 0 correlatable observations | 34 |
| Hints with exactly 1 (reuse-eligible) | 1 |
| Hints with 2+ (ambiguous) | 0 |
| Reuse attempts that reached acquisition (`getPlaceDetails` called) | 0 |
| Successful reuse (confirmed, persisted via reuse) | 0 |
| Rejected by geographic scope | 0 |
| Rejected by provider mismatch | 0 |
| Rejected by `getPlaceDetails` failure | 0 |
| Rejected by freshness (`CLOSED_PERMANENTLY`) | 0 |
| Rejected by `confirmMatch` after acquisition | 0 |
| Failed reuse that the normal fallback then resolved anyway | 0 |
| **Incremental recovery attributable to P2-B** | **0** |
| Unattributed real/shadow flips (network noise, not counted) | 1 |
| Provider calls avoided (lower bound) | 0 |
| Composites considered (web candidates) | 7 |
| Composites persisted, P2-B active | 1 |
| Composites persisted, P2-B disabled (shadow) | 1 |
| `NO_OSM_MATCH` | 2 |
| `UNCONFIRMED_MATCH` | 6 |

## Honest read

**Coverage: ~3%** (1/35 hints even had a name-correlatable structured
observation available). **Incremental recovery: 0%.** Composite
persistence was identical with P2-B on vs. off in this sample
(1 persisted either way) — the mechanism did not move the metric this
round, at this sample size.

This is close to the pessimistic branch flagged before implementing:
*"coverage = 20%, reuse success = 90%, pero casi todos ya se resolvían
después por OSM/Places: incremental recovery = 2%"* — except coverage
itself came in far lower than even that pessimistic case, low enough that
no reuse ever reached the acquisition step at all in this sample.

**Why coverage is this low (diagnosis, not yet acted on):** the structured
`google_places`/`geoapify` source plan in this harness searches generic
tourism `searchTypes` (`tourist_attraction, museum, historical_landmark,
park, church`) independently of the web/LLM discovery query. The two
pipelines are drawing from the same city but not the same *specific*
places unless a place both matches one of those generic categories AND
happens to also be the exact venue the web discovery surfaced by name —
a real, structural reason two independent acquisitions of "Buenos Aires
history" rarely name-collide on the same *specific* venue, distinct from
a harness defect.

**Sample size caveat, stated plainly:** 8 acquisition runs, 35 hints
total, only 7 web candidates ever discovered. This is a small sample by
this branch's own standards (previous 6-theme composite-persistence
measurements this session used dozens of candidates). The 0% result is a
real, honestly-obtained data point, but a wider sample (more themes,
more repeats, or a longer `breadth: 'broad'` run) could still surface
rare cases this run didn't happen to hit — 0/35 is not proof reuse never
fires, only that it did not fire in this sample.

## Recommendation

- **Do not consolidate further effort into P2-B Phase 1 reuse right now.**
  The mechanism is correct, safe, and committed — no reason to revert it
  (`compositesPersistedWithReuse` never regressed vs. `WithoutReuse`, and
  it is architecturally sound per the design review) — but this sample
  gives no evidence it is currently a meaningful lever for composite
  persistence.
- **On-demand identity acquisition (`getPlaceDetails` woven into the
  existing `resolveViaPlaces` searchText path, rather than requiring a
  pre-existing structured observation) is the more promising next P2
  direction**, per the original P2 design review's own ranking — this
  measurement is consistent with, not contradictory to, that ranking.
- Before investing there too: the honest prerequisite is a larger sample
  (more themes/repeats) to rule out "P2-B just doesn't fire much at this
  sample size" before concluding "P2-B doesn't fire much, period" —
  cheap to re-run this same harness again later if useful, since it never
  required schema/interface changes.
- No new fixes were made during this measurement, per plan. No bugs were
  found in the P2-B mechanism itself during this run — the one
  correction made (the incremental-recovery diff's false positive from
  live-API noise) was a harness/methodology fix, not a production code
  change.
