# Task A8 — Live Re-measurement With Root Cause #5 Fixes Live

Ran the same 6-theme live Buenos Aires methodology as A4/A7, now with
Root Cause #5's fixes live on top of A5/A6/the final-review entity-identity
fix: `docker-compose.yml`'s `OVERPASS_ALLOW_DUPLICATE_QUERIES=yes`
(commit `ecba56a`) and `OverpassApiService`'s non-JSON-response detection
(commit `e70f3e2`). Same provider config, same temporary
`characterize-composite` mechanism, fully reverted afterward.

## Headline numbers

```text
raw candidates fed to resolver:              25
composite candidates generated (>=2 hints):   9
composite candidates persisted:               0   (0%)
ANY candidate persisted:                      1   (a single-hint venue)

Component-hint outcomes (unresolved only):
  UNCONFIRMED_MATCH:    34   (up sharply from A7's 13)
  NO_OSM_MATCH:         10
  OSM_QUERY_EMPTY:       0   <- was 21 in A7, the largest category there
```

## The headline result: Root Cause #5's fix is confirmed live, cleanly

**`OSM_QUERY_EMPTY` dropped from 21 (A7) to 0 this run.** Zero
infra-flakiness losses. This is the fix (`ecba56a`/`e70f3e2`) working
exactly as verified in isolation earlier — no hint was lost to Overpass
failing to answer a query it should have answered.

**Both of the plan's original real collision bugs are now confirmed fixed
with real, live, unmasked traffic — the thing A7 could not do:**

- **"Recoleta Cemetery"**: appeared twice this run (culture, architecture
  themes) — both times correctly landed on `UNCONFIRMED_MATCH`, never
  wrongly resolved. In A7 this hint hit `OSM_QUERY_EMPTY` both times it
  appeared, so this is the *first* live confirmation this specific
  collision is actually closed, not just fixed by unit test and hand
  verification.
- **"Galería Güemes"**: appeared 5 times (history, culture, art,
  architecture, nature) — `UNCONFIRMED_MATCH` in all 5, zero wrong
  resolutions, consistent with A7.

## The concerning result: composite persistence dropped to 0/9, and `UNCONFIRMED_MATCH` more than doubled

This needs to be reported honestly rather than folded into the good news
above. With `OSM_QUERY_EMPTY` no longer masking anything, far more hints
now actually reach the matching/confirmation stage — and a much larger
fraction of them are landing on `UNCONFIRMED_MATCH` than before. Spot-check
of the 25 distinct hints that hit `UNCONFIRMED_MATCH` this run shows a
pattern: alongside the two genuine collision cases above and the
already-known acronym/translation gaps (`MALBA`), a large number look like
**plausibly correct matches failing to confirm for translation reasons**:

- `"SAN TELMO MARKET"` and `"Mercado San Telmo"` (same real place, two
  different LLM-generated hint phrasings across different candidates) —
  both `UNCONFIRMED_MATCH`.
- `"Miter Station"` (likely "Estación Mitre" in real data), `"Monumental
  Tower"` (the same case flagged as ambiguous in A4 — real corroboration
  exists in Wikidata under the Spanish name, per that report's own live
  SPARQL check), `"San Martín Plaza"` / `"San Martín Palace"` / `"Parque
  San Martin"`, `"Palace de Glace"`, `"Russian Orthodox Church"` — all
  plausible real places with an English/Spanish naming mismatch between
  the hint, the locally-matched entity's own name, and/or Wikidata's
  corroborating label.

**Likely mechanism**: the final-review fix (commit `2c2e412`) added a
SECOND check — the corroborating Wikidata label must also overlap with
the matched entity's own `canonicalName` (default, non-strict bar) — on
top of A5's stricter `requireAllTokens` hint check. Both checks can
independently fail on a language mismatch (Spanish OSM name vs. English
Wikidata label, or vice versa), and now BOTH must pass on the *same*
Wikidata place. Stacking two independently-lossy checks plausibly
compounds the honest-loss rate for legitimate translated matches by more
than either individually. This was flagged as an accepted trade-off during
the final review ("fail-closed is the sanctioned direction... I'm not
asking to revert it") and documented with a code comment rather than
"fixed" — but this run's *volume* of affected-looking cases (not just the
1-2 anticipated) suggests the real-world cost of that trade-off is larger
than the isolated review discussion anticipated.

**This is not evidence Root Cause #5's fix did anything wrong** — removing
an infra-masking failure mode was always going to reveal whatever the
underlying confirmation bar's true honest-loss rate is; it didn't create
this rate, it stopped hiding part of it. But it does mean the actual,
current composite-persistence rate with everything now live is **worse in
raw numbers than A7's 2/11, not better** — because A7 was silently
benefiting from Overpass failures removing candidates from the pool before
they ever had a chance to hit the (already strict) confirmation gate.

## Recommendation

Do not read this as "Root Cause #5 made things worse" — read it as "Root
Cause #5 stopped hiding the confirmation gate's true honest-loss rate."
The next real question, not yet answered, is whether the STACKED
strictness (A5's `requireAllTokens` + the final-review entity-identity
check, both language-blind, now both required against the same
corroborating place) is calibrated correctly, or whether it's
over-rejecting real matches that a smarter (e.g. multilingual-alias-aware)
corroboration check would correctly confirm. This needs the user's
explicit input before touching it further: the non-negotiable requirement
is about never confirming a WRONG identity, not about maximizing how many
real ones get through — and this session has no evidence yet that a
looser check would still hold the line on the two real collisions this
plan was built around. Recommend: sample a handful of this run's
`UNCONFIRMED_MATCH` cases (the ones that look like real, just
mistranslated places) and manually verify against Wikidata by hand
(same method as A4's spot-checks) whether a smarter check (checking
Wikidata's aliases/`skos:altLabel`, not just its single primary label)
would correctly confirm them without reopening either collision case —
before deciding whether to loosen anything.

## Raw data

Full per-theme JSON (`task-a8-full-results.json`) and run log (`run.log`)
are session-local, not committed to the repo.
